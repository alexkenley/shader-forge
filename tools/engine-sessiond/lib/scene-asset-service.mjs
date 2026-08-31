import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { MISSING_FILE_REVISION } from './session-store.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const ASSET_ID = /^[a-z0-9][a-z0-9_]*$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;
const MAX_SOURCE_BYTES = 1024 * 1024;
const MAX_SNAPSHOT_FILES = 4096;
const MAX_SNAPSHOT_ENTRIES = 16384;
const MAX_SNAPSHOT_BYTES = 32 * 1024 * 1024;
const FOUNDATION_PATH = 'data/foundation/engine-data-layout.toml';

function serviceError(statusCode, message, extras = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, extras);
  return error;
}

function required(value, name) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw serviceError(400, `${name} is required.`);
  return text;
}

function normalizeActor(value) {
  if (!value || typeof value !== 'object') throw serviceError(400, 'actor is required.');
  return value;
}

function assetDescriptor(kind, id) {
  const assetKind = required(kind, 'assetKind').toLowerCase();
  const subjectId = required(id, 'subjectId').toLowerCase();
  if (!['scene', 'prefab'].includes(assetKind)) {
    throw serviceError(400, 'assetKind must be scene or prefab.');
  }
  if (!ASSET_ID.test(subjectId)) {
    throw serviceError(400, 'subjectId must be a canonical lowercase asset id.');
  }
  const directory = assetKind === 'scene' ? 'scenes' : 'prefabs';
  const extension = assetKind === 'scene' ? 'scene' : 'prefab';
  const resourcePrefix = assetKind === 'scene' ? 'scene/world' : 'scene/prefab';
  return {
    assetKind,
    subjectId,
    path: `content/${directory}/${subjectId}.${extension}.toml`,
    stagedPath: `${directory}/${subjectId}.${extension}.toml`,
    resourceKey: `${resourcePrefix}/${subjectId}`,
  };
}

function conflict(pathname, expectedRevision, actualRevision) {
  return serviceError(409, 'File revision conflict.', {
    conflict: { type: 'revision_conflict', path: pathname, expectedRevision, actualRevision },
  });
}

function normalizeRequest(input) {
  const intent = required(input?.intent, 'intent').toLowerCase();
  if (intent === 'rename') {
    throw serviceError(400, 'Renaming a scene asset requires a multi-file operation.', {
      code: 'multi_file_operation_required',
    });
  }
  if (!['save', 'create', 'duplicate'].includes(intent)) {
    throw serviceError(400, 'intent must be save, create, or duplicate.');
  }
  const target = assetDescriptor(input.assetKind, input.subjectId);
  const baseRevision = required(input.baseRevision, 'baseRevision');
  if (baseRevision !== MISSING_FILE_REVISION && !SHA256.test(baseRevision)) {
    throw serviceError(400, 'baseRevision must be a sha256 revision or missing.');
  }
  if (intent === 'save' && baseRevision === MISSING_FILE_REVISION) {
    throw serviceError(400, 'save requires an existing base revision.');
  }
  if (intent !== 'save' && baseRevision !== MISSING_FILE_REVISION) {
    throw serviceError(400, `${intent} requires baseRevision missing.`);
  }
  const content = typeof input.content === 'string' ? input.content : '';
  if (Buffer.byteLength(content, 'utf8') > MAX_SOURCE_BYTES) {
    throw serviceError(413, 'Scene asset source exceeds the 1 MiB preview limit.');
  }
  let source = null;
  let sourceRevision = null;
  if (intent === 'duplicate') {
    source = assetDescriptor(input.assetKind, input.sourceSubjectId);
    sourceRevision = required(input.sourceRevision, 'sourceRevision');
    if (!SHA256.test(sourceRevision)) throw serviceError(400, 'sourceRevision must be a sha256 revision.');
    if (source.subjectId === target.subjectId) throw serviceError(400, 'Duplicate source and target must differ.');
  }
  return {
    sessionId: required(input.sessionId, 'sessionId'), intent, target, source, sourceRevision,
    content, baseRevision, actor: normalizeActor(input.actor),
    agentId: required(input.agentId, 'agentId'), leaseId: required(input.leaseId, 'leaseId'),
    credential: required(input.credential, 'credential'),
    label: typeof input.label === 'string' && input.label.trim()
      ? input.label.trim() : `${intent} ${target.assetKind} ${target.subjectId}`,
  };
}

async function copySnapshot(sessionStore, sessionId, root) {
  const files = [];
  let fileCount = 0;
  let entryCount = 0;
  let bytes = 0;
  async function walk(relative) {
    const listing = await sessionStore.listFilesBounded(sessionId, relative, {
      rejectSymbolicPath: true,
      maxEntries: MAX_SNAPSHOT_ENTRIES - entryCount,
    });
    for (const entry of listing.entries) {
      entryCount += 1;
      if (entry.kind === 'symlink') throw serviceError(400, `Symbolic content path is not allowed: ${entry.path}`);
      if (entry.kind === 'directory') await walk(entry.path);
      else if (entry.path.endsWith('.toml')) {
        fileCount += 1;
        if (fileCount > MAX_SNAPSHOT_FILES) throw serviceError(413, 'Scene validation snapshot has too many files.');
        const remainingBytes = MAX_SNAPSHOT_BYTES - bytes;
        if (entry.size > remainingBytes) throw serviceError(413, 'Scene validation snapshot exceeds 32 MiB.');
        const file = await sessionStore.readFileBounded(sessionId, entry.path, {
          rejectSymbolicPath: true,
          maxBytes: remainingBytes,
        });
        bytes += file.size;
        files.push({ path: entry.path, revision: file.revision, content: file.content });
      }
    }
  }
  await walk('content');
  if (fileCount >= MAX_SNAPSHOT_FILES) {
    throw serviceError(413, 'Scene validation snapshot has too many files.');
  }
  const foundation = await sessionStore.readFileBounded(sessionId, FOUNDATION_PATH, {
    rejectSymbolicPath: true,
    maxBytes: MAX_SNAPSHOT_BYTES - bytes,
  });
  fileCount += 1;
  bytes += foundation.size;
  if (fileCount > MAX_SNAPSHOT_FILES || bytes > MAX_SNAPSHOT_BYTES) {
    throw serviceError(413, 'Scene validation snapshot exceeds its bounded file or byte limit.');
  }
  files.push({ path: FOUNDATION_PATH, revision: foundation.revision, content: foundation.content });
  for (const file of files) {
    const destination = path.join(root, ...file.path.split('/'));
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, file.content, 'utf8');
  }
  return files;
}

function manifestOf(files) {
  return files.map(({ path: pathname, revision }) => ({ path: pathname, revision }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function sameManifest(left, right) {
  return JSON.stringify(manifestOf(left)) === JSON.stringify(manifestOf(right));
}

async function defaultValidate({ root, target, expectAbsent }) {
  const executable = process.env.SHADER_FORGE_DATA_BINARY?.trim()
    || path.join(repoRoot, 'build', 'runtime', 'bin', process.platform === 'win32' ? 'shader_forge_data.exe' : 'shader_forge_data');
  let stdout;
  try {
    ({ stdout } = await execFileAsync(executable, [
      'validate-asset', '--content-root', path.join(root, 'content'),
      '--data-foundation', path.join(root, FOUNDATION_PATH), '--kind', target.assetKind,
      '--id', target.subjectId, '--expected-path', target.stagedPath,
      ...(expectAbsent ? ['--expect-absent'] : []),
    ], { timeout: 10_000, maxBuffer: 1024 * 1024, windowsHide: true }));
  } catch (error) {
    if (error?.code === 'ENOENT') throw serviceError(503, 'Native DataFoundation validator is unavailable.', { code: 'scene_asset_validator_unavailable' });
    throw serviceError(500, 'Native DataFoundation validator failed to execute.');
  }
  try { return JSON.parse(stdout); } catch { throw serviceError(500, 'Native DataFoundation validator returned invalid JSON.'); }
}

function assertValidation(result, target, expectAbsent) {
  if (!result || result.schema !== 'shader_forge.data_foundation_validation'
      || result.schemaVersion !== 1 || result.assetKind !== target.assetKind
      || result.assetId !== target.subjectId || result.expectedPath !== target.stagedPath
      || typeof result.valid !== 'boolean') {
    throw serviceError(500, 'Native DataFoundation validator returned an invalid response.');
  }
  if (!result.valid) {
    throw serviceError(422, 'Scene asset failed native DataFoundation validation.', {
      code: 'scene_asset_validation_failed',
      diagnostic: typeof result.diagnostic === 'string' ? result.diagnostic.slice(0, 2000) : '',
    });
  }
  return { ...result, expectAbsent };
}

export class SceneAssetService {
  constructor({ sessionStore, coordinationStore, operationStore, validateDataFoundation = defaultValidate } = {}) {
    this.sessionStore = sessionStore;
    this.coordinationStore = coordinationStore;
    this.operationStore = operationStore;
    this.validateDataFoundation = validateDataFoundation;
  }

  assertLease(request) {
    const resources = [request.target.resourceKey, request.source?.resourceKey].filter(Boolean).sort();
    return this.coordinationStore.assertGrantedWriteLease({
      sessionId: request.sessionId, agentId: request.agentId, credential: request.credential,
      leaseId: request.leaseId, resources,
    });
  }

  async validateCandidate(request, content, expectAbsent = false) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-scene-'));
    try {
      const files = await copySnapshot(this.sessionStore, request.sessionId, root);
      const targetPath = path.join(root, ...request.target.path.split('/'));
      if (expectAbsent) await fs.rm(targetPath, { force: true });
      else {
        await fs.mkdir(path.dirname(targetPath), { recursive: true });
        await fs.writeFile(targetPath, content, 'utf8');
      }
      const validation = assertValidation(await this.validateDataFoundation({
        root, target: request.target, expectAbsent,
      }), request.target, expectAbsent);
      return { validation, manifest: files };
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  }

  async previewAsset(input = {}) {
    const request = normalizeRequest(input);
    this.assertLease(request);
    const target = await this.sessionStore.inspectTextFile(request.sessionId, request.target.path);
    if (target.revision !== request.baseRevision) throw conflict(target.path, request.baseRevision, target.revision);
    if (request.source) {
      const source = await this.sessionStore.inspectTextFile(request.sessionId, request.source.path);
      if (source.revision !== request.sourceRevision) throw conflict(source.path, request.sourceRevision, source.revision);
    }
    const checked = await this.validateCandidate(request, request.content);
    const resourceKeys = [request.target.resourceKey, request.source?.resourceKey].filter(Boolean).sort();
    const operation = await this.operationStore.previewFileWrite({
      sessionId: request.sessionId, path: request.target.path, content: request.content,
      baseRevision: request.baseRevision, actor: request.actor,
      context: {
        type: 'scene_asset', assetKind: request.target.assetKind, intent: request.intent,
        label: request.label, subjectId: request.target.subjectId,
        ...(request.source ? { sourceSubjectId: request.source.subjectId, sourceRevision: request.sourceRevision } : {}),
        resourceKeys, leaseId: request.leaseId,
      },
      beforePreview: async () => {
      const liveTarget = await this.sessionStore.inspectTextFile(request.sessionId, request.target.path);
      if (liveTarget.revision !== request.baseRevision) {
        throw conflict(liveTarget.path, request.baseRevision, liveTarget.revision);
      }
      if (request.source) {
        const liveSource = await this.sessionStore.inspectTextFile(request.sessionId, request.source.path);
        if (liveSource.revision !== request.sourceRevision) {
          throw conflict(liveSource.path, request.sourceRevision, liveSource.revision);
        }
      }
      const liveRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-scene-check-'));
      try {
        const liveFiles = await copySnapshot(this.sessionStore, request.sessionId, liveRoot);
        if (!sameManifest(checked.manifest, liveFiles)) {
          throw serviceError(409, 'Scene validation inputs changed.', { code: 'scene_asset_inputs_changed' });
        }
      } finally { await fs.rm(liveRoot, { recursive: true, force: true }); }
      this.assertLease(request);
      },
    });
    return { operation, validation: checked.validation };
  }

  async validateOperationMutation(mutation, { agentId, credential, leaseId } = {}) {
    if (mutation?.context?.type !== 'scene_asset') return;
    const target = assetDescriptor(mutation.context.assetKind, mutation.context.subjectId);
    if (mutation.path !== target.path) {
      throw serviceError(409, 'Scene operation path does not match its semantic context.', {
        code: 'scene_asset_context_mismatch',
      });
    }
    const expectsExistingBase = mutation.context.intent === 'save';
    if ((mutation.baseRevision !== MISSING_FILE_REVISION) !== expectsExistingBase) {
      throw serviceError(409, 'Scene operation intent does not match its base revision.', {
        code: 'scene_asset_context_mismatch',
      });
    }
    const request = {
      sessionId: mutation.sessionId, target, source: mutation.context.sourceSubjectId
        ? assetDescriptor(mutation.context.assetKind, mutation.context.sourceSubjectId) : null,
      agentId: required(agentId, 'agentId'), credential: required(credential, 'credential'),
      leaseId: required(leaseId, 'leaseId'),
    };
    const expectedTargetRevision = mutation.phase === 'undo'
      ? mutation.appliedRevision
      : mutation.baseRevision;
    if (!expectedTargetRevision) {
      throw serviceError(409, 'Scene operation is missing its expected mutation revision.', {
        code: 'scene_asset_context_mismatch',
      });
    }
    if (request.source) {
      const source = await this.sessionStore.inspectTextFile(mutation.sessionId, request.source.path);
      if (source.revision !== mutation.context.sourceRevision) {
        throw conflict(source.path, mutation.context.sourceRevision, source.revision);
      }
    }
    const checked = await this.validateCandidate(request, mutation.content ?? '', mutation.content == null);
    const stagedTarget = checked.manifest.find((entry) => entry.path === target.path);
    const stagedTargetRevision = stagedTarget?.revision ?? MISSING_FILE_REVISION;
    if (stagedTargetRevision !== expectedTargetRevision) {
      throw conflict(target.path, expectedTargetRevision, stagedTargetRevision);
    }
    if (request.source) {
      const stagedSource = checked.manifest.find((entry) => entry.path === request.source.path);
      const stagedSourceRevision = stagedSource?.revision ?? MISSING_FILE_REVISION;
      if (stagedSourceRevision !== mutation.context.sourceRevision) {
        throw conflict(request.source.path, mutation.context.sourceRevision, stagedSourceRevision);
      }
    }
    const liveRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-scene-check-'));
    try {
      const liveFiles = await copySnapshot(this.sessionStore, mutation.sessionId, liveRoot);
      if (!sameManifest(checked.manifest, liveFiles)) {
        throw serviceError(409, 'Scene validation inputs changed.', { code: 'scene_asset_inputs_changed' });
      }
    } finally { await fs.rm(liveRoot, { recursive: true, force: true }); }
    this.assertLease(request);
  }
}
