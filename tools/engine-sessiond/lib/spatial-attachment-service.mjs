import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  MISSING_FILE_REVISION,
  textContentRevision,
} from './session-store.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const animationDirectories = Object.freeze({
  skeletons: '.skeleton.toml',
  clips: '.anim.toml',
  graphs: '.animgraph.toml',
  attachments: '.attachment.toml',
});
const attachmentPathPattern = /^animation\/attachments\/([^/]+\.attachment\.toml)$/;
const revisionPattern = /^sha256:[a-f0-9]{64}$/;
const actorKinds = new Set(['human', 'shell', 'cli', 'mcp']);

function serviceError(statusCode, code, message, extras = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  Object.assign(error, extras);
  return error;
}

function requiredString(value, fieldName) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw serviceError(400, 'spatial_request_invalid', `${fieldName} is required.`);
  }
  return normalized;
}

function normalizeActor(actor) {
  if (!actor || typeof actor !== 'object' || Array.isArray(actor)) {
    throw serviceError(400, 'spatial_request_invalid', 'actor must be an object.');
  }
  const kind = typeof actor.kind === 'string' ? actor.kind.trim() : '';
  if (!actorKinds.has(kind)) {
    throw serviceError(400, 'spatial_request_invalid', 'actor.kind must be human, shell, cli, or mcp.');
  }
  return actor;
}

function normalizeRequest(request = {}) {
  const relativePath = requiredString(request.path, 'path').replaceAll('\\', '/');
  const match = attachmentPathPattern.exec(relativePath);
  if (!match) {
    throw serviceError(
      400,
      'spatial_attachment_path_invalid',
      'path must match animation/attachments/*.attachment.toml.',
    );
  }
  const baseRevision = requiredString(request.baseRevision, 'baseRevision');
  if (baseRevision !== MISSING_FILE_REVISION && !revisionPattern.test(baseRevision)) {
    throw serviceError(400, 'spatial_request_invalid', 'baseRevision is invalid.');
  }
  if (typeof request.content !== 'string') {
    throw serviceError(400, 'spatial_request_invalid', 'content must be a string.');
  }
  return {
    sessionId: requiredString(request.sessionId, 'sessionId'),
    path: relativePath,
    stagedSource: `attachments/${match[1]}`,
    content: request.content,
    baseRevision,
    label: requiredString(request.label, 'label'),
    actor: normalizeActor(request.actor),
    agentId: requiredString(request.agentId, 'agentId'),
    leaseId: requiredString(request.leaseId, 'leaseId'),
    credential: requiredString(request.credential, 'Agent credential'),
  };
}

function validationFailure(code, message, error) {
  const diagnostic = typeof error?.diagnostic === 'string' && error.diagnostic.trim()
    ? error.diagnostic.trim()
    : typeof error?.stderr === 'string' && error.stderr.trim()
      ? error.stderr.trim()
      : error instanceof Error
        ? error.message
        : String(error);
  return serviceError(422, code, message, { diagnostic: diagnostic.slice(0, 8000) });
}

function publicValidation(report) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.attachmentProfiles)) {
    throw serviceError(500, 'spatial_validator_protocol_error', 'Spatial validator returned an invalid report.');
  }
  const { animationRoot: _discardedRoot, ...publicReport } = report;
  return structuredClone(publicReport);
}

function profileBySource(report, source) {
  const matches = report.attachmentProfiles.filter((profile) => profile?.source === source);
  if (matches.length > 1) {
    throw serviceError(500, 'spatial_validator_protocol_error', `Validator returned duplicate source: ${source}`);
  }
  return matches[0] || null;
}

async function defaultValidateAnimationRoot(animationRoot) {
  const binaryName = process.platform === 'win32'
    ? 'shader_forge_spatial.exe'
    : 'shader_forge_spatial';
  const binaryPath = process.env.SHADER_FORGE_SPATIAL_BINARY?.trim()
    || path.join(repoRoot, 'build', 'runtime', 'bin', binaryName);
  try {
    const { stdout } = await execFileAsync(
      binaryPath,
      ['validate', '--animation-root', animationRoot],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true },
    );
    return JSON.parse(stdout);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw serviceError(
        503,
        'spatial_validator_unavailable',
        `Spatial validator was not found at ${binaryPath}. Build it with engine build spatial.`,
      );
    }
    throw error;
  }
}

export class SpatialAttachmentService {
  #sessionStore;
  #coordinationStore;
  #operationStore;
  #validateAnimationRoot;

  constructor({ sessionStore, coordinationStore, operationStore, validateAnimationRoot } = {}) {
    this.#sessionStore = sessionStore;
    this.#coordinationStore = coordinationStore;
    this.#operationStore = operationStore;
    this.#validateAnimationRoot = typeof validateAnimationRoot === 'function'
      ? validateAnimationRoot
      : defaultValidateAnimationRoot;
  }

  async previewAttachment(request = {}) {
    const normalized = normalizeRequest(request);
    const inspection = await this.#sessionStore.inspectTextFile(normalized.sessionId, normalized.path);
    if (inspection.revision !== normalized.baseRevision) {
      throw serviceError(409, 'revision_conflict', 'File revision conflict.', {
        conflict: {
          code: 'revision_conflict',
          path: inspection.path,
          expectedRevision: normalized.baseRevision,
          actualRevision: inspection.revision,
        },
      });
    }

    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-spatial-preview-'));
    try {
      const stagedAnimationRoot = path.join(temporaryRoot, 'animation');
      await this.#stageAuthoredAnimation(normalized.sessionId, stagedAnimationRoot);

      let baseline;
      try {
        baseline = publicValidation(await this.#validateAnimationRoot(stagedAnimationRoot));
      } catch (error) {
        if (error?.code === 'spatial_validator_unavailable') throw error;
        throw validationFailure(
          'spatial_baseline_invalid',
          'Authored spatial baseline is invalid.',
          error,
        );
      }

      await fs.writeFile(
        path.join(stagedAnimationRoot, normalized.stagedSource),
        normalized.content,
        'utf8',
      );

      let candidate;
      try {
        candidate = publicValidation(await this.#validateAnimationRoot(stagedAnimationRoot));
      } catch (error) {
        if (error?.code === 'spatial_validator_unavailable') throw error;
        throw validationFailure(
          'spatial_candidate_invalid',
          'Proposed spatial attachment is invalid.',
          error,
        );
      }

      const oldProfile = profileBySource(baseline, normalized.stagedSource);
      const newProfile = profileBySource(candidate, normalized.stagedSource);
      if (!newProfile || typeof newProfile.id !== 'string' || !newProfile.id.trim()) {
        throw serviceError(
          422,
          'spatial_candidate_source_missing',
          'Validator did not return the proposed attachment source.',
        );
      }
      if (inspection.exists && (!oldProfile || typeof oldProfile.id !== 'string' || !oldProfile.id.trim())) {
        throw serviceError(
          500,
          'spatial_baseline_source_missing',
          'Validator did not return the authored attachment source.',
        );
      }

      const subjectId = newProfile.id.trim().toLowerCase();
      const previousSubjectId = oldProfile?.id?.trim().toLowerCase() || null;
      const resourceKeys = [...new Set([
        ...(previousSubjectId ? [`spatial/attachment/${previousSubjectId}`] : []),
        `spatial/attachment/${subjectId}`,
      ])].sort();

      this.#coordinationStore.assertGrantedWriteLease({
        sessionId: normalized.sessionId,
        agentId: normalized.agentId,
        credential: normalized.credential,
        leaseId: normalized.leaseId,
        resources: resourceKeys,
      });

      const operation = await this.#operationStore.previewFileWrite({
        sessionId: normalized.sessionId,
        path: normalized.path,
        content: normalized.content,
        baseRevision: normalized.baseRevision,
        actor: normalized.actor,
        context: {
          type: 'spatial_attachment',
          label: normalized.label,
          subjectId,
          resourceKeys,
          leaseId: normalized.leaseId,
        },
      });
      return {
        operation,
        validation: {
          baseline,
          candidate,
          previousSubjectId,
          subjectId,
        },
      };
    } finally {
      await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
  }

  async #stageAuthoredAnimation(sessionId, stagedAnimationRoot) {
    await fs.mkdir(stagedAnimationRoot, { recursive: true });
    for (const [directory, suffix] of Object.entries(animationDirectories)) {
      const destination = path.join(stagedAnimationRoot, directory);
      await fs.mkdir(destination, { recursive: true });
      let listing;
      try {
        listing = await this.#sessionStore.listFiles(
          sessionId,
          `animation/${directory}`,
          { rejectSymbolicPath: true },
        );
      } catch (error) {
        if (error?.code === 'ENOENT') continue;
        throw error;
      }
      for (const entry of listing.entries) {
        if (entry.kind === 'symlink') {
          throw serviceError(
            400,
            'spatial_source_symlink_rejected',
            `Symbolic links are not allowed in animation/${directory}: ${entry.name}`,
          );
        }
        if (entry.kind !== 'file' || !entry.name.endsWith(suffix)) continue;
        const source = await this.#sessionStore.readFile(
          sessionId,
          entry.path,
          { rejectSymbolicPath: true },
        );
        await fs.writeFile(path.join(destination, entry.name), source.content, 'utf8');
      }
    }
  }
}
