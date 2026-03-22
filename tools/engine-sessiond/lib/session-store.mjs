import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getPlatformInfo } from './host-fs-service.mjs';

function normalizeDisplayPath(rootPath, targetPath) {
  const relativePath = path.relative(rootPath, targetPath);
  if (!relativePath) {
    return '.';
  }
  return relativePath.split(path.sep).join('/');
}

export class SessionStore {
  #sessions = new Map();

  async createSession({ name = '', rootPath } = {}) {
    if (!rootPath) {
      const platform = getPlatformInfo();
      rootPath = platform.defaultBrowsePath || process.cwd();
    }
    const resolvedRoot = await this.#resolveAndValidateRoot(rootPath);

    const timestamp = new Date().toISOString();
    const session = {
      id: `session_${randomUUID()}`,
      name: name.trim() || path.basename(resolvedRoot) || 'workspace',
      rootPath: resolvedRoot,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    this.#sessions.set(session.id, session);
    return structuredClone(session);
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
    const session = this.#requireSession(sessionId);
    const nextRootPath = rootPath ? await this.#resolveAndValidateRoot(rootPath) : session.rootPath;
    const timestamp = new Date().toISOString();
    const updated = {
      ...session,
      name: name.trim() || path.basename(nextRootPath) || session.name,
      rootPath: nextRootPath,
      updatedAt: timestamp,
    };
    this.#sessions.set(sessionId, updated);
    return structuredClone(updated);
  }

  deleteSession(sessionId) {
    this.#requireSession(sessionId);
    this.#sessions.delete(sessionId);
    return { ok: true };
  }

  resolveSessionPath(sessionId, relativePath = '.') {
    const session = this.#requireSession(sessionId);
    return this.#resolveWithinSession(session, relativePath);
  }

  async listFiles(sessionId, relativePath = '.') {
    const session = this.#requireSession(sessionId);
    const targetPath = this.#resolveWithinSession(session, relativePath);
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
          const entryStat = await fs.stat(entryPath);
          return {
            name: entry.name,
            path: normalizeDisplayPath(session.rootPath, entryPath),
            kind: entry.isDirectory() ? 'directory' : 'file',
            size: entry.isDirectory() ? 0 : entryStat.size,
            modifiedAt: entryStat.mtime.toISOString(),
          };
        }),
    );

    return {
      session,
      path: normalizeDisplayPath(session.rootPath, targetPath),
      entries: records,
    };
  }

  async readFile(sessionId, relativePath) {
    if (!relativePath) {
      throw new Error('File path is required.');
    }

    const session = this.#requireSession(sessionId);
    const targetPath = this.#resolveWithinSession(session, relativePath);
    const stat = await fs.stat(targetPath);
    if (!stat.isFile()) {
      throw new Error(`Path is not a file: ${relativePath}`);
    }

    const content = await fs.readFile(targetPath, 'utf8');
    return {
      session,
      path: normalizeDisplayPath(session.rootPath, targetPath),
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      content,
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
    const stat = await fs.stat(resolvedRoot);
    if (!stat.isDirectory()) {
      throw new Error(`Session root is not a directory: ${resolvedRoot}`);
    }
    return resolvedRoot;
  }

  #resolveWithinSession(session, relativePath = '.') {
    const resolvedPath = path.resolve(session.rootPath, relativePath);
    const relativeToRoot = path.relative(session.rootPath, resolvedPath);
    if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
      throw new Error(`Path escapes session root: ${relativePath}`);
    }
    return resolvedPath;
  }
}
