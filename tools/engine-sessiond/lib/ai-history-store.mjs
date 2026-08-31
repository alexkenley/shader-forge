import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const historyStoreRelativePath = path.join('.shader-forge', 'ai-history.json');
const maxHistoryRecords = 128;
const terminalStatuses = new Set(['completed', 'failed', 'cancelled']);

function emptyStore() {
  return { version: 1, updatedAt: null, jobs: [] };
}

function requireString(value, fieldName, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim()) || value.length > 256) {
    throw new Error(`AI history ${fieldName} is invalid.`);
  }
  return value;
}

function requireCount(value, fieldName) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`AI history ${fieldName} must be a non-negative safe integer.`);
  }
  return value;
}

function normalizeUsage(usage) {
  if (usage === null || usage === undefined) {
    return null;
  }
  return {
    promptTokens: requireCount(usage.promptTokens, 'promptTokens'),
    completionTokens: requireCount(usage.completionTokens, 'completionTokens'),
    totalTokens: requireCount(usage.totalTokens, 'totalTokens'),
  };
}

function normalizeJob(job) {
  const status = requireString(job?.status, 'status');
  if (!terminalStatuses.has(status)) {
    throw new Error(`AI history status is not terminal: ${status}`);
  }
  const providerId = job?.providerId === null || job?.providerId === undefined || job.providerId === ''
    ? null
    : requireString(job.providerId, 'providerId');
  return {
    id: requireString(job?.id, 'id'),
    sessionId: requireString(job?.sessionId ?? '', 'sessionId', { allowEmpty: true }),
    providerId,
    status,
    createdAt: requireString(job?.createdAt, 'createdAt'),
    startedAt: job?.startedAt === null ? null : requireString(job?.startedAt, 'startedAt'),
    finishedAt: requireString(job?.finishedAt, 'finishedAt'),
    usage: normalizeUsage(job?.usage),
  };
}

export class AiHistoryStore {
  async read(rootPath) {
    const storePath = path.join(path.resolve(rootPath), historyStoreRelativePath);
    let parsed;
    try {
      parsed = JSON.parse(await fs.readFile(storePath, 'utf8'));
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return { storePath, store: emptyStore() };
      }
      throw error;
    }
    if (parsed?.version !== 1 || !Array.isArray(parsed.jobs) || parsed.jobs.length > maxHistoryRecords) {
      throw new Error(`Invalid AI history store: ${storePath}`);
    }
    const jobs = parsed.jobs.map(normalizeJob);
    if (new Set(jobs.map((job) => job.id)).size !== jobs.length) {
      throw new Error(`Invalid AI history store: ${storePath}`);
    }
    return {
      storePath,
      store: {
        version: 1,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
        jobs,
      },
    };
  }

  async record(rootPath, job) {
    const record = normalizeJob(job);
    const { storePath, store } = await this.read(rootPath);
    const existingIndex = store.jobs.findIndex((candidate) => candidate.id === record.id);
    if (existingIndex === -1) {
      store.jobs.push(record);
    } else {
      store.jobs[existingIndex] = record;
    }
    store.jobs.sort((left, right) => left.finishedAt.localeCompare(right.finishedAt) || left.id.localeCompare(right.id));
    store.jobs = store.jobs.slice(-maxHistoryRecords);
    store.updatedAt = new Date().toISOString();

    await fs.mkdir(path.dirname(storePath), { recursive: true });
    const tempPath = `${storePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
      await fs.rename(tempPath, storePath);
    } finally {
      await fs.rm(tempPath, { force: true });
    }
  }

  async list(rootPath, { status = 'all', limit = 50 } = {}) {
    if (status !== 'all' && !terminalStatuses.has(status)) {
      const error = new Error(`Unknown AI history status: ${status}`);
      error.statusCode = 400;
      throw error;
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > maxHistoryRecords) {
      const error = new Error(`AI history limit must be from 1 through ${maxHistoryRecords}.`);
      error.statusCode = 400;
      throw error;
    }
    const { storePath, store } = await this.read(rootPath);
    return {
      storePath,
      updatedAt: store.updatedAt,
      jobs: store.jobs
        .filter((job) => status === 'all' || job.status === status)
        .reverse()
        .slice(0, limit),
    };
  }
}
