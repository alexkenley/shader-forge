import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const budgetStoreRelativePath = path.join('.shader-forge', 'ai-budget.json');
const monthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;

function emptyStore() {
  return { version: 1, updatedAt: null, months: [] };
}

function requireLimit(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value > 100_000) {
    throw new Error('AI monthly request limit must be an integer from 0 through 100000.');
  }
  return value;
}

function requireCount(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error('AI budget admittedRequestCount must be a non-negative safe integer.');
  }
  return value;
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

export class AiBudgetStore {
  async read(rootPath) {
    const storePath = path.join(path.resolve(rootPath), budgetStoreRelativePath);
    let parsed;
    try {
      parsed = JSON.parse(await fs.readFile(storePath, 'utf8'));
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return { storePath, store: emptyStore() };
      }
      throw error;
    }
    if (parsed?.version !== 1 || !Array.isArray(parsed.months) || parsed.months.length > 24) {
      throw new Error(`Invalid AI budget store: ${storePath}`);
    }
    const months = parsed.months.map((month) => ({
      month: typeof month?.month === 'string' && monthPattern.test(month.month) ? month.month : '',
      admittedRequestCount: requireCount(month?.admittedRequestCount),
      lastAdmissionAt: typeof month?.lastAdmissionAt === 'string' ? month.lastAdmissionAt : null,
    }));
    if (months.some((month) => !month.month)
        || new Set(months.map((month) => month.month)).size !== months.length) {
      throw new Error(`Invalid AI budget store: ${storePath}`);
    }
    return {
      storePath,
      store: {
        version: 1,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
        months,
      },
    };
  }

  async summary(rootPath, configuredLimit, month = currentMonth()) {
    const limit = requireLimit(configuredLimit);
    const { storePath, store } = await this.read(rootPath);
    const admittedRequestCount = store.months.find((entry) => entry.month === month)?.admittedRequestCount || 0;
    return {
      storePath,
      month,
      enabled: limit > 0,
      configuredLimit: limit,
      admittedRequestCount,
      remainingRequestCount: limit > 0 ? Math.max(0, limit - admittedRequestCount) : null,
      updatedAt: store.updatedAt,
    };
  }

  async admit(rootPath, configuredLimit) {
    const limit = requireLimit(configuredLimit);
    if (limit === 0) {
      return this.summary(rootPath, limit);
    }
    const { storePath, store } = await this.read(rootPath);
    const now = new Date().toISOString();
    const month = now.slice(0, 7);
    let entry = store.months.find((candidate) => candidate.month === month);
    if (!entry) {
      entry = { month, admittedRequestCount: 0, lastAdmissionAt: null };
      store.months.push(entry);
    }
    if (entry.admittedRequestCount >= limit) {
      const error = new Error(`AI monthly queued-request budget is exhausted for ${month}.`);
      error.statusCode = 429;
      error.code = 'ai_monthly_request_budget_exhausted';
      throw error;
    }
    entry.admittedRequestCount += 1;
    entry.lastAdmissionAt = now;
    store.updatedAt = now;
    store.months.sort((left, right) => left.month.localeCompare(right.month));
    store.months = store.months.slice(-24);

    await fs.mkdir(path.dirname(storePath), { recursive: true });
    const tempPath = `${storePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
      await fs.rename(tempPath, storePath);
    } finally {
      await fs.rm(tempPath, { force: true });
    }
    return this.summary(rootPath, limit, month);
  }
}
