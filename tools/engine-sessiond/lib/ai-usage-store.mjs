import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const usageStoreRelativePath = path.join('.shader-forge', 'ai-usage.json');

function emptyStore() {
  return { version: 1, updatedAt: null, providers: [] };
}

function requireCount(value, fieldName) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`AI usage ${fieldName} must be a non-negative safe integer.`);
  }
  return value;
}

function addCount(left, right, fieldName) {
  const value = left + right;
  if (!Number.isSafeInteger(value)) {
    throw new Error(`AI usage ${fieldName} exceeded the safe integer range.`);
  }
  return value;
}

export class AiUsageStore {
  async read(rootPath) {
    const storePath = path.join(path.resolve(rootPath), usageStoreRelativePath);
    let parsed;
    try {
      parsed = JSON.parse(await fs.readFile(storePath, 'utf8'));
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        return { storePath, store: emptyStore() };
      }
      throw error;
    }
    if (parsed?.version !== 1 || !Array.isArray(parsed.providers)) {
      throw new Error(`Invalid AI usage store: ${storePath}`);
    }
    const providers = parsed.providers.map((provider) => ({
      providerId: String(provider?.providerId || '').trim(),
      requestCount: requireCount(provider?.requestCount, 'requestCount'),
      promptTokens: requireCount(provider?.promptTokens, 'promptTokens'),
      completionTokens: requireCount(provider?.completionTokens, 'completionTokens'),
      totalTokens: requireCount(provider?.totalTokens, 'totalTokens'),
      lastRequestAt: typeof provider?.lastRequestAt === 'string' ? provider.lastRequestAt : null,
    }));
    if (providers.some((provider) => !provider.providerId)
        || new Set(providers.map((provider) => provider.providerId)).size !== providers.length) {
      throw new Error(`Invalid AI usage store: ${storePath}`);
    }
    return {
      storePath,
      store: {
        version: 1,
        updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
        providers,
      },
    };
  }

  async record(rootPath, result) {
    if (!result?.usage) {
      return null;
    }
    const providerId = String(result.providerId || '').trim();
    if (!providerId) {
      throw new Error('AI usage result is missing providerId.');
    }
    const promptTokens = requireCount(result.usage.promptTokens, 'promptTokens');
    const completionTokens = requireCount(result.usage.completionTokens, 'completionTokens');
    const totalTokens = requireCount(result.usage.totalTokens, 'totalTokens');
    const { storePath, store } = await this.read(rootPath);
    const now = new Date().toISOString();
    let provider = store.providers.find((candidate) => candidate.providerId === providerId);
    if (!provider) {
      provider = {
        providerId,
        requestCount: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        lastRequestAt: null,
      };
      store.providers.push(provider);
    }
    provider.requestCount = addCount(provider.requestCount, 1, 'requestCount');
    provider.promptTokens = addCount(provider.promptTokens, promptTokens, 'promptTokens');
    provider.completionTokens = addCount(provider.completionTokens, completionTokens, 'completionTokens');
    provider.totalTokens = addCount(provider.totalTokens, totalTokens, 'totalTokens');
    provider.lastRequestAt = now;
    store.updatedAt = now;
    store.providers.sort((left, right) => left.providerId.localeCompare(right.providerId));

    await fs.mkdir(path.dirname(storePath), { recursive: true });
    const tempPath = `${storePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
      await fs.rename(tempPath, storePath);
    } finally {
      await fs.rm(tempPath, { force: true });
    }
    return this.summary(rootPath);
  }

  async summary(rootPath) {
    const { storePath, store } = await this.read(rootPath);
    const total = (fieldName) => store.providers.reduce(
      (sum, provider) => addCount(sum, provider[fieldName], fieldName),
      0,
    );
    return {
      storePath,
      updatedAt: store.updatedAt,
      requestCount: total('requestCount'),
      promptTokens: total('promptTokens'),
      completionTokens: total('completionTokens'),
      totalTokens: total('totalTokens'),
      providers: store.providers,
    };
  }
}
