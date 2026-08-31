import { randomUUID } from 'node:crypto';
import { testAiProvider } from '../../shared/engine-ai-service.mjs';

const terminalStatuses = new Set(['completed', 'failed', 'cancelled']);

export class AiRequestQueue {
  constructor({ execute = testAiProvider, emitEvent = () => {}, maxJobs = 128 } = {}) {
    this.execute = execute;
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
      if (!job || job.status !== 'queued') {
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
        this.emit(job);
      }
    }
  }

  snapshot(job) {
    return {
      id: job.id,
      sessionId: job.sessionId,
      providerId: job.providerId || null,
      status: job.status,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      result: job.result,
      error: job.error,
    };
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
    });
  }
}
