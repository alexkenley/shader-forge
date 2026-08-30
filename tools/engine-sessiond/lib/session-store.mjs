import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getPlatformInfo } from './host-fs-service.mjs';

const sessionStoreVersion = 1;

function normalizeDisplayPath(rootPath, targetPath) {
  const relativePath = path.relative(rootPath, targetPath);
  if (!relativePath) {
    return '.';
  }
  return relativePath.split(path.sep).join('/');
}

function normalizePhysicalPathKey(targetPath) {
  const normalized = path.normalize(targetPath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function isNotFoundError(error) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT');
}

function isPathWithinRoot(rootPath, targetPath) {
  const normalizedRoot = normalizePhysicalPathKey(rootPath);
  const normalizedTarget = normalizePhysicalPathKey(targetPath);
  const relativePath = path.relative(normalizedRoot, normalizedTarget);
  return relativePath === ''
    || (relativePath !== '..'
      && !relativePath.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relativePath));
}

function defaultSessionStorePath() {
  const overrideDir = process.env.SHADER_FORGE_SESSIOND_DATA_DIR?.trim();
  const dataDir = overrideDir
    ? path.resolve(overrideDir)
    : path.join(os.homedir(), '.shader-forge', 'engine-sessiond');
  return path.join(dataDir, 'sessions.json');
}

function normalizePersistedSession(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }

  const {
    id = '',
    name = '',
    rootPath = '',
    createdAt = '',
    updatedAt = '',
  } = record;

  if (
    typeof id !== 'string'
    || typeof name !== 'string'
    || typeof rootPath !== 'string'
    || typeof createdAt !== 'string'
    || typeof updatedAt !== 'string'
    || !id.trim()
    || !rootPath.trim()
  ) {
    return null;
  }

  return {
    id: id.trim(),
    name,
    rootPath: path.resolve(rootPath),
    createdAt,
    updatedAt,
  };
}

export class SessionStore {
  #sessions = new Map();
  #sessionRootKeys = new Map();
  #storageFilePath;
  #mutationTail = Promise.resolve();

  constructor({ storageFilePath = defaultSessionStorePath() } = {}) {
    this.#storageFilePath = path.resolve(storageFilePath);
  }

  async loadSessions() {
    let rawPayload = '';
    try {
      rawPayload = await fs.readFile(this.#storageFilePath, 'utf8');
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        this.#sessions.clear();
        this.#sessionRootKeys.clear();
        return this.listSessions();
      }
      throw error;
    }

    const parsed = rawPayload.trim() ? JSON.parse(rawPayload) : {};
    const records = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.sessions)
        ? parsed.sessions
        : [];
    const restored = new Map();
    const restoredRootKeys = new Map();
    for (const record of records) {
      const normalized = normalizePersistedSession(record);
      if (normalized) {
        try {
          normalized.rootPath = await this.#resolveAndValidateRoot(normalized.rootPath);
        } catch {
          // Keep legacy records usable when a removable or network root is temporarily unavailable.
        }
        restored.set(normalized.id, normalized);
        restoredRootKeys.set(normalized.id, normalizePhysicalPathKey(normalized.rootPath));
      }
    }

    this.#sessions = restored;
    this.#sessionRootKeys = restoredRootKeys;
    return this.listSessions();
  }

  async createSession({ name = '', rootPath } = {}) {
    return this.#serializeMutation(async () => {
      if (!rootPath) {
        const platform = getPlatformInfo();
        rootPath = platform.defaultBrowsePath || process.cwd();
      }
      const resolvedRoot = await this.#resolveAndValidateRoot(rootPath);
      const rootKey = normalizePhysicalPathKey(resolvedRoot);
      const existingSessionId = Array.from(this.#sessionRootKeys.entries())
        .find(([, existingRootKey]) => existingRootKey === rootKey)?.[0];
      if (existingSessionId) {
        return structuredClone(this.#sessions.get(existingSessionId));
      }

      const timestamp = new Date().toISOString();
      const session = {
        id: `session_${randomUUID()}`,
        name: name.trim() || path.basename(resolvedRoot) || 'workspace',
        rootPath: resolvedRoot,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      await this.#commitSessionMutation(() => {
        this.#sessions.set(session.id, session);
        this.#sessionRootKeys.set(session.id, rootKey);
      });
      return structuredClone(session);
    });
  }

  listSessions() {
    return Array.from(this.#sessions.values())
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((session) => structuredClone(session));
  }

  getSession(sessionId) {
    const session = this.#sessions.get(sessionId);
    return session ? structuredClone(session) : null;
  }

  async updateSession(sessionId, { name = '', rootPath } = {}) {
    return this.#serializeMutation(async () => {
      const session = this.#requireSession(sessionId);
      const nextRootPath = rootPath ? await this.#resolveAndValidateRoot(rootPath) : session.rootPath;
      const nextRootKey = normalizePhysicalPathKey(nextRootPath);
      const conflictingSessionId = Array.from(this.#sessionRootKeys.entries())
        .find(([existingSessionId, existingRootKey]) => (
          existingSessionId !== sessionId && existingRootKey === nextRootKey
        ))?.[0];
      if (conflictingSessionId) {
        throw new Error(`Session root is already open: ${nextRootPath}`);
      }
      const timestamp = new Date().toISOString();
      const updated = {
        ...session,
        name: name.trim() || path.basename(nextRootPath) || session.name,
        rootPath: nextRootPath,
        updatedAt: timestamp,
      };
      await this.#commitSessionMutation(() => {
        this.#sessions.set(sessionId, updated);
        this.#sessionRootKeys.set(sessionId, nextRootKey);
      });
      return structuredClone(updated);
    });
  }

  async deleteSession(sessionId) {
    return this.#serializeMutation(async () => {
      this.#requireSession(sessionId);
      await this.#commitSessionMutation(() => {
        this.#sessions.delete(sessionId);
        this.#sessionRootKeys.delete(sessionId);
      });
      return { ok: true };
    });
  }

  resolveSessionPath(sessionId, relativePath = '.') {
    const session = this.#requireSession(sessionId);
    return this.#resolveWithinSession(session, relativePath);
  }

  async listFiles(sessionId, relativePath = '.') {
    const session = this.#requireSession(sessionId);
    const displayPath = this.#resolveWithinSession(session, relativePath);
    const targetPath = await this.#resolveExistingPhysicalPath(session, displayPath, relativePath);
    const stat = await fs.stat(targetPath);
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${relativePath}`);
    }

    const entries = await fs.readdir(targetPath, { withFileTypes: true });
    const records = await Promise.all(
      entries
        .sort((left, right) => left.name.localeCompare(right.name))
        .map(async (entry) => {
          const entryPath = path.join(targetPath, entry.name);
          const entryStat = await fs.lstat(entryPath);
          return {
            name: entry.name,
            path: normalizeDisplayPath(session.rootPath, path.join(displayPath, entry.name)),
            kind: entryStat.isDirectory() ? 'directory' : 'file',
            size: entryStat.isDirectory() ? 0 : entryStat.size,
            modifiedAt: entryStat.mtime.toISOString(),
          };
        }),
    );

    return {
      session,
      path: normalizeDisplayPath(session.rootPath, displayPath),
      entries: records,
    };
  }

  async readFile(sessionId, relativePath) {
    if (!relativePath) {
      throw new Error('File path is required.');
    }

    const session = this.#requireSession(sessionId);
    const displayPath = this.#resolveWithinSession(session, relativePath);
    const targetPath = await this.#resolveExistingPhysicalPath(session, displayPath, relativePath);
    const stat = await fs.stat(targetPath);
    if (!stat.isFile()) {
      throw new Error(`Path is not a file: ${relativePath}`);
    }

    const content = await fs.readFile(targetPath, 'utf8');
    return {
      session,
      path: normalizeDisplayPath(session.rootPath, displayPath),
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      content,
    };
  }

  async writeFile(sessionId, relativePath, content = '') {
    if (!relativePath) {
      throw new Error('File path is required.');
    }

    const session = this.#requireSession(sessionId);
    const displayPath = this.#resolveWithinSession(session, relativePath);
    const targetPath = await this.#resolvePhysicalWritePath(session, displayPath, relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const physicalParent = await fs.realpath(path.dirname(targetPath));
    const physicalRoot = await this.#resolvePhysicalSessionRoot(session);
    this.#assertPhysicalPathInsideRoot(physicalRoot, physicalParent, relativePath);
    const verifiedTargetPath = path.join(physicalParent, path.basename(targetPath));
    await fs.writeFile(verifiedTargetPath, String(content), 'utf8');
    const stat = await fs.stat(verifiedTargetPath);

    return {
      session,
      path: normalizeDisplayPath(session.rootPath, displayPath),
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      content: String(content),
    };
  }

  #requireSession(sessionId) {
    if (!sessionId) {
      throw new Error('sessionId is required.');
    }
    const session = this.#sessions.get(sessionId);
    if (!session) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    return session;
  }

  async #resolveAndValidateRoot(rootPath) {
    const resolvedRoot = path.resolve(rootPath);
    const physicalRoot = await fs.realpath(resolvedRoot);
    const stat = await fs.stat(physicalRoot);
    if (!stat.isDirectory()) {
      throw new Error(`Session root is not a directory: ${physicalRoot}`);
    }
    return physicalRoot;
  }

  #resolveWithinSession(session, relativePath = '.') {
    const resolvedPath = path.resolve(session.rootPath, relativePath);
    const relativeToRoot = path.relative(session.rootPath, resolvedPath);
    if (
      relativeToRoot === '..'
      || relativeToRoot.startsWith(`..${path.sep}`)
      || path.isAbsolute(relativeToRoot)
    ) {
      throw new Error(`Path escapes session root: ${relativePath}`);
    }
    return resolvedPath;
  }

  async #resolvePhysicalSessionRoot(session) {
    const physicalRoot = await fs.realpath(session.rootPath);
    const expectedRootKey = this.#sessionRootKeys.get(session.id)
      || normalizePhysicalPathKey(session.rootPath);
    if (normalizePhysicalPathKey(physicalRoot) !== expectedRootKey) {
      throw new Error(`Session root physical target changed: ${session.rootPath}`);
    }
    return physicalRoot;
  }

  #assertPhysicalPathInsideRoot(physicalRoot, targetPath, relativePath) {
    if (!isPathWithinRoot(physicalRoot, targetPath)) {
      throw new Error(`Path escapes physical session root: ${relativePath}`);
    }
  }

  async #resolveExistingPhysicalPath(session, displayPath, relativePath) {
    const physicalRoot = await this.#resolvePhysicalSessionRoot(session);
    const physicalPath = await fs.realpath(displayPath);
    this.#assertPhysicalPathInsideRoot(physicalRoot, physicalPath, relativePath);
    return physicalPath;
  }

  async #resolvePhysicalWritePath(session, displayPath, relativePath) {
    const physicalRoot = await this.#resolvePhysicalSessionRoot(session);
    try {
      const physicalPath = await fs.realpath(displayPath);
      this.#assertPhysicalPathInsideRoot(physicalRoot, physicalPath, relativePath);
      return physicalPath;
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }

    try {
      await fs.lstat(displayPath);
      throw new Error(`Cannot write through an unresolved symbolic path: ${relativePath}`);
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }

    let existingAncestor = path.dirname(displayPath);
    while (true) {
      try {
        const physicalAncestor = await fs.realpath(existingAncestor);
        this.#assertPhysicalPathInsideRoot(physicalRoot, physicalAncestor, relativePath);
        const missingSuffix = path.relative(existingAncestor, displayPath);
        const physicalPath = path.resolve(physicalAncestor, missingSuffix);
        this.#assertPhysicalPathInsideRoot(physicalRoot, physicalPath, relativePath);
        return physicalPath;
      } catch (error) {
        if (!isNotFoundError(error)) {
          throw error;
        }
      }

      try {
        await fs.lstat(existingAncestor);
        throw new Error(`Cannot write through an unresolved symbolic path: ${relativePath}`);
      } catch (error) {
        if (!isNotFoundError(error)) {
          throw error;
        }
      }

      const parentPath = path.dirname(existingAncestor);
      if (parentPath === existingAncestor) {
        throw new Error(`Cannot resolve a writable parent inside the session root: ${relativePath}`);
      }
      existingAncestor = parentPath;
    }
  }

  #serializeMutation(operation) {
    const result = this.#mutationTail.then(operation, operation);
    this.#mutationTail = result.catch(() => {});
    return result;
  }

  async #commitSessionMutation(applyMutation) {
    const previousSessions = new Map(this.#sessions);
    const previousSessionRootKeys = new Map(this.#sessionRootKeys);
    applyMutation();
    try {
      await this.#persistSessions();
    } catch (error) {
      this.#sessions = previousSessions;
      this.#sessionRootKeys = previousSessionRootKeys;
      throw error;
    }
  }

  async #persistSessions() {
    const payload = JSON.stringify(
      {
        version: sessionStoreVersion,
        sessions: this.listSessions(),
      },
      null,
      2,
    ) + '\n';
    await fs.mkdir(path.dirname(this.#storageFilePath), { recursive: true });
    const tempPath = `${this.#storageFilePath}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, payload, 'utf8');
    await fs.rename(tempPath, this.#storageFilePath);
  }
}
