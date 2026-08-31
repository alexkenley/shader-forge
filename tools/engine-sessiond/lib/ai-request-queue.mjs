import { randomUUID } from 'node:crypto';
import { testAiProvider } from '../../shared/engine-ai-service.mjs';

const terminalStatuses = new Set(['completed', 'failed', 'cancelled']);
const jobStatuses = new Set(['queued', 'running', ...terminalStatuses]);

export class AiRequestQueue {
  constructor({
    execute = testAiProvider,
    recordUsage = null,
    recordHistory = null,
    emitEvent = () => {},
    maxJobs = 128,
  } = {}) {
    this.execute = execute;
    this.recordUsage = recordUsage;
    this.recordHistory = recordHistory;
    this.emitEvent = emitEvent;
    this.maxJobs = maxJobs;
    this.jobs = new Map();
    this.pendingIds = [];
    this.drainPromise = null;
    this.closed = false;
  }

  submit({ sessionId = '', rootPath, providerId = '', prompt, systemPrompt }) {
    if (this.closed) {
      throw new Error('AI request queue is closed.');
    }
    this.pruneTerminalJobs();
    if (this.jobs.size >= this.maxJobs) {
      const error = new Error(`AI request queue is full (${this.maxJobs} jobs).`);
      error.statusCode = 429;
      throw error;
    }

    const job = {
      id: `ai_job_${randomUUID()}`,
      sessionId,
      rootPath,
      providerId,
      prompt,
      systemPrompt,
      status: 'queued',
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      result: null,
      error: null,
      usageRecorded: null,
      usageError: null,
      historyRecorded: null,
      historyError: null,
      controller: null,
    };
    this.jobs.set(job.id, job);
    this.pendingIds.push(job.id);
    this.emit(job);
    this.scheduleDrain();
    return this.snapshot(job);
  }

  get(jobId) {
    const job = this.jobs.get(jobId);
    return job ? this.snapshot(job) : null;
  }

  list({ sessionId = '', status = 'all' } = {}) {
    if (status !== 'all' && !jobStatuses.has(status)) {
      const error = new Error(`Unknown AI job status: ${status}`);
      error.statusCode = 400;
      throw error;
    }
    return [...this.jobs.values()]
      .filter((job) => (!sessionId || job.sessionId === sessionId) && (status === 'all' || job.status === status))
      .reverse()
      .map((job) => this.snapshot(job, { includeResult: false }));
  }

  cancel(jobId) {
    const job = this.jobs.get(jobId);
    if (!job) {
      return null;
    }
    if (!terminalStatuses.has(job.status)) {
      job.status = 'cancelled';
      job.finishedAt = new Date().toISOString();
      job.controller?.abort();
      this.emit(job);
    }
    return this.snapshot(job);
  }

  async close() {
    this.closed = true;
    for (const job of this.jobs.values()) {
      this.cancel(job.id);
    }
    if (this.drainPromise) {
      await this.drainPromise;
    }
  }

  pruneTerminalJobs() {
    if (this.jobs.size < this.maxJobs) {
      return;
    }
    for (const [jobId, job] of this.jobs) {
      if (terminalStatuses.has(job.status)) {
        this.jobs.delete(jobId);
      }
      if (this.jobs.size < this.maxJobs) {
        return;
      }
    }
  }

  scheduleDrain() {
    if (this.drainPromise || this.closed) {
      return;
    }
    this.drainPromise = this.drain().finally(() => {
      this.drainPromise = null;
      if (!this.closed && this.pendingIds.length) {
        this.scheduleDrain();
      }
    });
  }

  async drain() {
    while (this.pendingIds.length) {
      const job = this.jobs.get(this.pendingIds.shift());
      if (!job) {
        continue;
      }
      if (job.status !== 'queued') {
        await this.persistHistory(job);
        this.emit(job);
        continue;
      }

      job.status = 'running';
      job.startedAt = new Date().toISOString();
      job.controller = new AbortController();
      this.emit(job);
      try {
        const result = await this.execute(job.rootPath, {
          providerId: job.providerId,
          prompt: job.prompt,
          systemPrompt: job.systemPrompt,
          signal: job.controller.signal,
        });
        if (!job.controller.signal.aborted) {
          job.status = 'completed';
          job.providerId = result.providerId;
          job.result = result;
          if (result.usage && this.recordUsage) {
            try {
              await this.recordUsage(job.rootPath, result);
              job.usageRecorded = true;
            } catch (error) {
              job.usageRecorded = false;
              job.usageError = error instanceof Error ? error.message : String(error);
            }
          }
        }
      } catch (error) {
        if (!job.controller.signal.aborted) {
          job.status = 'failed';
          job.error = error instanceof Error ? error.message : String(error);
        }
      } finally {
        if (!job.finishedAt) {
          job.finishedAt = new Date().toISOString();
        }
        job.controller = null;
        await this.persistHistory(job);
        this.emit(job);
      }
    }
  }

  snapshot(job, { includeResult = true } = {}) {
    const snapshot = {
      id: job.id,
      sessionId: job.sessionId,
      providerId: job.providerId || null,
      status: job.status,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      error: job.error,
      usageRecorded: job.usageRecorded,
      usageError: job.usageError,
      historyRecorded: job.historyRecorded,
      historyError: job.historyError,
    };
    if (includeResult) {
      snapshot.result = job.result;
    }
    return snapshot;
  }

  async persistHistory(job) {
    if (!this.recordHistory || job.historyRecorded !== null || !terminalStatuses.has(job.status)) {
      return;
    }
    try {
      await this.recordHistory(job.rootPath, {
        id: job.id,
        sessionId: job.sessionId,
        providerId: job.providerId || null,
        status: job.status,
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        usage: job.result?.usage || null,
      });
      job.historyRecorded = true;
    } catch (error) {
      job.historyRecorded = false;
      job.historyError = error instanceof Error ? error.message : String(error);
    }
  }

  emit(job) {
    const snapshot = this.snapshot(job);
    this.emitEvent('ai.job', {
      id: snapshot.id,
      sessionId: snapshot.sessionId,
      providerId: snapshot.providerId,
      status: snapshot.status,
      createdAt: snapshot.createdAt,
      startedAt: snapshot.startedAt,
      finishedAt: snapshot.finishedAt,
      error: snapshot.error,
      historyRecorded: snapshot.historyRecorded,
    });
  }
}
