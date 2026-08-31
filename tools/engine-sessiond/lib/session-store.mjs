import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { getPlatformInfo } from './host-fs-service.mjs';

const sessionStoreVersion = 1;
export const MISSING_FILE_REVISION = 'missing';
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

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

export function textContentRevision(content) {
  const digest = createHash('sha256').update(String(content), 'utf8').digest('hex');
  return `sha256:${digest}`;
}

export class RevisionConflictError extends Error {
  constructor({ path: filePath, expectedRevision, actualRevision, operationId = null }) {
    super('File revision conflict.');
    this.name = 'RevisionConflictError';
    this.statusCode = 409;
    this.conflict = {
      code: 'revision_conflict',
      path: filePath,
      expectedRevision,
      actualRevision,
      ...(operationId ? { operationId } : {}),
    };
  }
}

function createUtf8Error(relativePath) {
  const error = new Error(`File is not valid UTF-8: ${relativePath}`);
  error.statusCode = 400;
  error.code = 'invalid_utf8';
  return error;
}

function createSessionError(statusCode, message, extras = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, extras);
  return error;
}

function normalizePersistedIdentity(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const canonicalPath = typeof value.canonicalPath === 'string' ? value.canonicalPath.trim() : '';
  const dev = typeof value.dev === 'string' ? value.dev.trim() : '';
  const ino = typeof value.ino === 'string' ? value.ino.trim() : '';
  if (!canonicalPath || !dev || !ino) {
    return null;
  }
  return {
    canonicalPath,
    dev,
    ino,
  };
}

export function filesystemIdentitiesEqual(left, right) {
  if (!left || !right) {
    return false;
  }
  return normalizePhysicalPathKey(left.canonicalPath) === normalizePhysicalPathKey(right.canonicalPath)
    && String(left.dev) === String(right.dev)
    && String(left.ino) === String(right.ino);
}

export async function captureFilesystemIdentity(targetPath) {
  const resolvedPath = path.resolve(targetPath);
  let canonicalPath;
  try {
    canonicalPath = await fs.realpath(resolvedPath);
  } catch (error) {
    if (isNotFoundError(error)) {
      throw createSessionError(
        409,
        'Operation workspace identity does not match the session root.',
        { code: 'workspace_identity_mismatch' },
      );
    }
    throw error;
  }

  const stat = await fs.stat(canonicalPath, { bigint: true });
  if (!stat.isDirectory()) {
    throw createSessionError(
      409,
      'Operation workspace identity does not match the session root.',
      { code: 'workspace_identity_mismatch' },
    );
  }

  return {
    canonicalPath,
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
  };
}

function decodeUtf8Strict(buffer, relativePath) {
  try {
    return utf8Decoder.decode(buffer);
  } catch {
    throw createUtf8Error(relativePath);
  }
}

async function applyExistingFileMode(targetPath, mode) {
  if (mode == null) {
    return;
  }
  try {
    await fs.chmod(targetPath, mode);
  } catch {
    // POSIX mode bits are not uniformly writable on Windows.
  }
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
    rootIdentity: normalizePersistedIdentity(record.rootIdentity),
    createdAt,
    updatedAt,
  };
}

export class SessionStore {
  #sessions = new Map();
  #sessionRootKeys = new Map();
  #storageFilePath;
  #mutationTail = Promise.resolve();
  #fileMutationTail = Promise.resolve();
  #beforeAtomicRename;

  constructor({ storageFilePath = defaultSessionStorePath(), beforeAtomicRename } = {}) {
    this.#storageFilePath = path.resolve(storageFilePath);
    this.#beforeAtomicRename = typeof beforeAtomicRename === 'function' ? beforeAtomicRename : null;
  }

  get stateDirectory() {
    return path.dirname(this.#storageFilePath);
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
    let persistMigratedIdentity = false;
    for (const record of records) {
      const normalized = normalizePersistedSession(record);
      if (normalized) {
        try {
          const liveIdentity = await captureFilesystemIdentity(normalized.rootPath);
          normalized.rootPath = liveIdentity.canonicalPath;
          if (!normalized.rootIdentity) {
            normalized.rootIdentity = liveIdentity;
            persistMigratedIdentity = true;
          }
        } catch {
          // Keep legacy records usable when a removable or network root is temporarily unavailable.
        }
        restored.set(normalized.id, normalized);
        restoredRootKeys.set(normalized.id, normalizePhysicalPathKey(normalized.rootPath));
      }
    }

    this.#sessions = restored;
    this.#sessionRootKeys = restoredRootKeys;
    if (persistMigratedIdentity) {
      await this.#persistSessions();
    }
    return this.listSessions();
  }

  async createSession({ name = '', rootPath } = {}) {
    return this.#serializeMutation(async () => {
      if (!rootPath) {
        const platform = getPlatformInfo();
        rootPath = platform.defaultBrowsePath || process.cwd();
      }
      const rootIdentity = await captureFilesystemIdentity(rootPath);
      const resolvedRoot = rootIdentity.canonicalPath;
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
        rootIdentity,
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
      if (rootPath) {
        const requestedIdentity = await captureFilesystemIdentity(rootPath);
        const currentKey = this.#sessionRootKeys.get(sessionId)
          || normalizePhysicalPathKey(session.rootPath);
        if (normalizePhysicalPathKey(requestedIdentity.canonicalPath) !== currentKey) {
          throw createSessionError(
            409,
            'Session rootPath is immutable after creation. Delete and recreate the session to change workspace identity.',
            { code: 'workspace_root_immutable' },
          );
        }
        if (session.rootIdentity && !filesystemIdentitiesEqual(session.rootIdentity, requestedIdentity)) {
          throw createSessionError(
            409,
            'Operation workspace identity does not match the session root.',
            { code: 'workspace_identity_mismatch' },
          );
        }
      }
      const timestamp = new Date().toISOString();
      const updated = {
        ...session,
        name: name.trim() || session.name,
        updatedAt: timestamp,
      };
      await this.#commitSessionMutation(() => {
        this.#sessions.set(sessionId, updated);
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

  async resolveCanonicalWorkspaceRoot(sessionId) {
    const session = this.#requireSession(sessionId);
    return this.#resolvePhysicalSessionRoot(session);
  }

  async captureWorkspaceIdentity(sessionId) {
    const session = this.#requireSession(sessionId);
    return this.#assertSessionFilesystemIdentity(session);
  }

  async assertWorkspaceIdentity(sessionId, expectedRoot, expectedIdentity = null) {
    const expected = typeof expectedRoot === 'string' ? expectedRoot.trim() : '';
    if (!expected) {
      throw createSessionError(
        409,
        'Operation workspace identity is missing.',
        { code: 'workspace_identity_mismatch' },
      );
    }
    const liveIdentity = await this.captureWorkspaceIdentity(sessionId);
    if (normalizePhysicalPathKey(liveIdentity.canonicalPath) !== normalizePhysicalPathKey(path.resolve(expected))) {
      throw createSessionError(
        409,
        'Operation workspace identity does not match the session root.',
        { code: 'workspace_identity_mismatch' },
      );
    }
    if (expectedIdentity) {
      const normalizedExpected = normalizePersistedIdentity(expectedIdentity);
      if (!normalizedExpected || !filesystemIdentitiesEqual(normalizedExpected, liveIdentity)) {
        throw createSessionError(
          409,
          'Operation workspace identity does not match the session root.',
          { code: 'workspace_identity_mismatch' },
        );
      }
    }
    return liveIdentity.canonicalPath;
  }

  async listFiles(sessionId, relativePath = '.', { rejectSymbolicPath = false } = {}) {
    const session = this.#requireSession(sessionId);
    const displayPath = this.#resolveWithinSession(session, relativePath);
    if (rejectSymbolicPath) {
      await this.#assertNoSymbolicPath(session, displayPath, relativePath);
    }
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
            kind: entryStat.isSymbolicLink()
              ? 'symlink'
              : entryStat.isDirectory()
                ? 'directory'
                : 'file',
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

  async listFilesBounded(
    sessionId,
    relativePath = '.',
    { rejectSymbolicPath = false, maxEntries = 4096 } = {},
  ) {
    if (!Number.isInteger(maxEntries) || maxEntries < 0) {
      throw createSessionError(400, 'maxEntries must be a non-negative integer.');
    }
    const session = this.#requireSession(sessionId);
    const displayPath = this.#resolveWithinSession(session, relativePath);
    if (rejectSymbolicPath) await this.#assertNoSymbolicPath(session, displayPath, relativePath);
    const targetPath = await this.#resolveExistingPhysicalPath(session, displayPath, relativePath);
    const stat = await fs.stat(targetPath);
    if (!stat.isDirectory()) throw new Error(`Path is not a directory: ${relativePath}`);

    const records = [];
    const directory = await fs.opendir(targetPath);
    try {
      for await (const entry of directory) {
        if (records.length >= maxEntries) {
          throw createSessionError(413, `Directory exceeds the ${maxEntries}-entry limit.`, {
            code: 'directory_entry_limit_exceeded',
          });
        }
        const entryStat = await fs.lstat(path.join(targetPath, entry.name));
        records.push({
          name: entry.name,
          path: normalizeDisplayPath(session.rootPath, path.join(displayPath, entry.name)),
          kind: entryStat.isSymbolicLink() ? 'symlink' : entryStat.isDirectory() ? 'directory' : 'file',
          size: entryStat.isDirectory() ? 0 : entryStat.size,
          modifiedAt: entryStat.mtime.toISOString(),
        });
      }
    } finally {
      await directory.close().catch(() => {});
    }
    records.sort((left, right) => left.name.localeCompare(right.name));
    return { session, path: normalizeDisplayPath(session.rootPath, displayPath), entries: records };
  }

  async readFile(sessionId, relativePath, { rejectSymbolicPath = false } = {}) {
    if (!relativePath) {
      throw new Error('File path is required.');
    }

    const session = this.#requireSession(sessionId);
    const displayPath = this.#resolveWithinSession(session, relativePath);
    if (rejectSymbolicPath) {
      await this.#assertNoSymbolicPath(session, displayPath, relativePath);
    }
    const targetPath = await this.#resolveExistingPhysicalPath(session, displayPath, relativePath);
    const stat = await fs.stat(targetPath);
    if (!stat.isFile()) {
      throw new Error(`Path is not a file: ${relativePath}`);
    }

    const buffer = await fs.readFile(targetPath);
    const content = decodeUtf8Strict(buffer, normalizeDisplayPath(session.rootPath, displayPath));
    return {
      session,
      path: normalizeDisplayPath(session.rootPath, displayPath),
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      revision: textContentRevision(content),
      content,
    };
  }

  async readFileBounded(
    sessionId,
    relativePath,
    { rejectSymbolicPath = false, maxBytes = 1024 * 1024 } = {},
  ) {
    if (!relativePath) throw new Error('File path is required.');
    if (!Number.isInteger(maxBytes) || maxBytes < 0) {
      throw createSessionError(400, 'maxBytes must be a non-negative integer.');
    }
    const session = this.#requireSession(sessionId);
    const displayPath = this.#resolveWithinSession(session, relativePath);
    if (rejectSymbolicPath) await this.#assertNoSymbolicPath(session, displayPath, relativePath);
    const targetPath = await this.#resolveExistingPhysicalPath(session, displayPath, relativePath);
    const handle = await fs.open(targetPath, 'r');
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error(`Path is not a file: ${relativePath}`);
      if (stat.size > maxBytes) {
        throw createSessionError(413, `File exceeds the ${maxBytes}-byte limit.`, {
          code: 'file_size_limit_exceeded',
        });
      }
      const chunks = [];
      let size = 0;
      while (true) {
        const remaining = maxBytes - size;
        const chunk = Buffer.allocUnsafe(Math.min(64 * 1024, remaining + 1));
        const { bytesRead } = await handle.read(chunk, 0, chunk.length, size);
        if (bytesRead === 0) break;
        size += bytesRead;
        if (size > maxBytes) {
          throw createSessionError(413, `File exceeds the ${maxBytes}-byte limit.`, {
            code: 'file_size_limit_exceeded',
          });
        }
        chunks.push(chunk.subarray(0, bytesRead));
      }
      const content = decodeUtf8Strict(
        Buffer.concat(chunks, size),
        normalizeDisplayPath(session.rootPath, displayPath),
      );
      return {
        session,
        path: normalizeDisplayPath(session.rootPath, displayPath),
        size,
        modifiedAt: stat.mtime.toISOString(),
        revision: textContentRevision(content),
        content,
      };
    } finally {
      await handle.close();
    }
  }

  async writeFile(sessionId, relativePath, content = '') {
    const written = await this.writeTextFileAtomic(sessionId, relativePath, content);
    return {
      session: written.session,
      path: written.path,
      size: written.size,
      modifiedAt: written.modifiedAt,
      content: written.content,
    };
  }

  async inspectTextFile(sessionId, relativePath) {
    return this.#inspectTextFileUnlocked(sessionId, relativePath);
  }

  async writeTextFileAtomic(sessionId, relativePath, content = '', { afterMutation } = {}) {
    return this.#serializeFileMutation(async () => {
      await this.#assertLiveWorkspaceIdentity(sessionId);
      const written = await this.#writeTextFileAtomicUnlocked(sessionId, relativePath, content);
      if (typeof afterMutation === 'function') {
        await afterMutation(written);
      }
      return written;
    });
  }

  async removeTextFileAtomic(sessionId, relativePath) {
    return this.#serializeFileMutation(async () => {
      await this.#assertLiveWorkspaceIdentity(sessionId);
      return this.#removeTextFileAtomicUnlocked(sessionId, relativePath);
    });
  }

  async compareAndWriteTextFile(
    sessionId,
    relativePath,
    { expectedRevision, content = '', beforeMutation, afterMutation } = {},
  ) {
    return this.#serializeFileMutation(async () => {
      await this.#assertLiveWorkspaceIdentity(sessionId);
      const inspection = await this.#inspectTextFileUnlocked(sessionId, relativePath);
      if (inspection.revision !== expectedRevision) {
        throw new RevisionConflictError({
          path: inspection.path,
          expectedRevision,
          actualRevision: inspection.revision,
        });
      }
      if (typeof beforeMutation === 'function') {
        await beforeMutation(inspection);
      }
      const written = await this.#writeTextFileAtomicUnlocked(sessionId, relativePath, content);
      if (typeof afterMutation === 'function') {
        await afterMutation(written);
      }
      return written;
    });
  }

  async compareAndRemoveTextFile(sessionId, relativePath, { expectedRevision, beforeMutation, afterMutation } = {}) {
    return this.#serializeFileMutation(async () => {
      await this.#assertLiveWorkspaceIdentity(sessionId);
      const inspection = await this.#inspectTextFileUnlocked(sessionId, relativePath);
      if (inspection.revision !== expectedRevision) {
        throw new RevisionConflictError({
          path: inspection.path,
          expectedRevision,
          actualRevision: inspection.revision,
        });
      }
      if (typeof beforeMutation === 'function') {
        await beforeMutation(inspection);
      }
      const removed = await this.#removeTextFileAtomicUnlocked(sessionId, relativePath);
      if (typeof afterMutation === 'function') {
        await afterMutation(removed);
      }
      return removed;
    });
  }

  async runSerializedFileMutation(operation, { sessionId } = {}) {
    if (typeof operation !== 'function') {
      throw new Error('Serialized file mutation requires a callback.');
    }
    return this.#serializeFileMutation(async () => {
      if (sessionId) {
        await this.#assertLiveWorkspaceIdentity(sessionId);
      }
      return operation();
    });
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

  async #assertLiveWorkspaceIdentity(sessionId) {
    const session = this.#requireSession(sessionId);
    await this.#assertSessionFilesystemIdentity(session);
  }

  async #assertSessionFilesystemIdentity(session) {
    const liveIdentity = await captureFilesystemIdentity(session.rootPath);
    if (!session.rootIdentity) {
      session.rootIdentity = liveIdentity;
    } else if (!filesystemIdentitiesEqual(session.rootIdentity, liveIdentity)) {
      throw createSessionError(
        409,
        'Operation workspace identity does not match the session root.',
        { code: 'workspace_identity_mismatch' },
      );
    }
    return liveIdentity;
  }

  async #inspectTextFileUnlocked(sessionId, relativePath) {
    if (!relativePath) {
      throw new Error('File path is required.');
    }

    const session = this.#requireSession(sessionId);
    await this.#assertSessionFilesystemIdentity(session);
    const displayPath = this.#resolveWithinSession(session, relativePath);
    const normalizedPath = normalizeDisplayPath(session.rootPath, displayPath);

    try {
      const targetPath = await this.#resolveExistingPhysicalPath(session, displayPath, relativePath);
      const stat = await fs.stat(targetPath);
      if (!stat.isFile()) {
        throw new Error(`Path is not a file: ${relativePath}`);
      }
      const buffer = await fs.readFile(targetPath);
      const content = decodeUtf8Strict(buffer, normalizedPath);
      return {
        session,
        path: normalizedPath,
        exists: true,
        revision: textContentRevision(content),
        content,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
      };
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }

    await this.#resolvePhysicalWritePath(session, displayPath, relativePath);
    return {
      session,
      path: normalizedPath,
      exists: false,
      revision: MISSING_FILE_REVISION,
      content: null,
      size: 0,
      modifiedAt: null,
    };
  }

  async #writeTextFileAtomicUnlocked(sessionId, relativePath, content = '') {
    if (!relativePath) {
      throw new Error('File path is required.');
    }

    const session = this.#requireSession(sessionId);
    await this.#assertSessionFilesystemIdentity(session);
    const { displayPath, verifiedTargetPath } = await this.#preparePhysicalWriteTarget(session, relativePath);
    const written = String(content);
    await this.#atomicReplaceTextFile(verifiedTargetPath, written, session);
    const stat = await fs.stat(verifiedTargetPath);

    return {
      session,
      path: normalizeDisplayPath(session.rootPath, displayPath),
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      content: written,
      revision: textContentRevision(written),
    };
  }

  async #removeTextFileAtomicUnlocked(sessionId, relativePath) {
    if (!relativePath) {
      throw new Error('File path is required.');
    }

    const session = this.#requireSession(sessionId);
    await this.#assertSessionFilesystemIdentity(session);
    const displayPath = this.#resolveWithinSession(session, relativePath);
    const targetPath = await this.#resolveExistingPhysicalPath(session, displayPath, relativePath);
    const stat = await fs.stat(targetPath);
    if (!stat.isFile()) {
      throw new Error(`Path is not a file: ${relativePath}`);
    }
    await fs.unlink(targetPath);
    await this.#assertSessionFilesystemIdentity(session);

    return {
      session,
      path: normalizeDisplayPath(session.rootPath, displayPath),
      revision: MISSING_FILE_REVISION,
    };
  }

  async #atomicReplaceTextFile(targetPath, content, session = null) {
    const tempPath = path.join(
      path.dirname(targetPath),
      `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`,
    );
    let existingMode = null;
    try {
      const existing = await fs.stat(targetPath);
      if (existing.isFile()) {
        existingMode = existing.mode & 0o7777;
      }
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }

    try {
      await fs.writeFile(
        tempPath,
        content,
        existingMode != null ? { encoding: 'utf8', mode: existingMode } : 'utf8',
      );
      await applyExistingFileMode(tempPath, existingMode);
      if (session) {
        await this.#assertSessionFilesystemIdentity(session);
      }
      if (this.#beforeAtomicRename) {
        await this.#beforeAtomicRename(targetPath, tempPath);
      }
      if (session) {
        await this.#assertSessionFilesystemIdentity(session);
      }
      await fs.rename(tempPath, targetPath);
      if (session) {
        await this.#assertSessionFilesystemIdentity(session);
      }
      await applyExistingFileMode(targetPath, existingMode);
    } catch (error) {
      await fs.unlink(tempPath).catch(() => {});
      throw error;
    }
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

  async #assertNoSymbolicPath(session, displayPath, relativePath) {
    const relative = path.relative(session.rootPath, displayPath);
    let current = session.rootPath;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) {
        throw createSessionError(400, `Symbolic paths are not allowed: ${relativePath}`, {
          code: 'symbolic_path_rejected',
        });
      }
    }
  }

  async #resolvePhysicalSessionRoot(session) {
    const liveIdentity = await this.#assertSessionFilesystemIdentity(session);
    const expectedRootKey = this.#sessionRootKeys.get(session.id)
      || normalizePhysicalPathKey(session.rootPath);
    if (normalizePhysicalPathKey(liveIdentity.canonicalPath) !== expectedRootKey) {
      throw createSessionError(
        409,
        'Operation workspace identity does not match the session root.',
        { code: 'workspace_identity_mismatch' },
      );
    }
    return liveIdentity.canonicalPath;
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

  async #preparePhysicalWriteTarget(session, relativePath) {
    const displayPath = this.#resolveWithinSession(session, relativePath);
    const targetPath = await this.#resolvePhysicalWritePath(session, displayPath, relativePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const physicalParent = await fs.realpath(path.dirname(targetPath));
    const physicalRoot = await this.#resolvePhysicalSessionRoot(session);
    this.#assertPhysicalPathInsideRoot(physicalRoot, physicalParent, relativePath);
    return {
      displayPath,
      verifiedTargetPath: path.join(physicalParent, path.basename(targetPath)),
    };
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

  #serializeFileMutation(operation) {
    // Global file-mutation queue. Upgrade to per-path serialization only if throughput later matters.
    const result = this.#fileMutationTail.then(operation, operation);
    this.#fileMutationTail = result.catch(() => {});
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
