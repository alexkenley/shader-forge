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

function parseAttachmentPath(value) {
  const relativePath = requiredString(value, 'path').replaceAll('\\', '/');
  const match = attachmentPathPattern.exec(relativePath);
  if (!match) {
    throw serviceError(
      400,
      'spatial_attachment_path_invalid',
      'path must match animation/attachments/*.attachment.toml.',
    );
  }
  return {
    path: relativePath,
    stagedSource: `attachments/${match[1]}`,
  };
}

function parseBaseRevision(value, { allowMissing = false } = {}) {
  const baseRevision = requiredString(value, 'baseRevision');
  if (allowMissing && baseRevision === MISSING_FILE_REVISION) {
    return baseRevision;
  }
  if (!revisionPattern.test(baseRevision)) {
    throw serviceError(400, 'spatial_request_invalid', 'baseRevision is invalid.');
  }
  return baseRevision;
}

function normalizeRequest(request = {}) {
  const parsedPath = parseAttachmentPath(request.path);
  if (typeof request.content !== 'string') {
    throw serviceError(400, 'spatial_request_invalid', 'content must be a string.');
  }
  return {
    sessionId: requiredString(request.sessionId, 'sessionId'),
    path: parsedPath.path,
    stagedSource: parsedPath.stagedSource,
    content: request.content,
    baseRevision: parseBaseRevision(request.baseRevision, { allowMissing: true }),
    label: requiredString(request.label, 'label'),
    actor: normalizeActor(request.actor),
    agentId: requiredString(request.agentId, 'agentId'),
    leaseId: requiredString(request.leaseId, 'leaseId'),
    credential: requiredString(request.credential, 'Agent credential'),
  };
}

function normalizeEvaluateRequest(request = {}) {
  const parsedPath = parseAttachmentPath(request.path);
  return {
    sessionId: requiredString(request.sessionId, 'sessionId'),
    path: parsedPath.path,
    stagedSource: parsedPath.stagedSource,
    baseRevision: parseBaseRevision(request.baseRevision),
  };
}

function boundedDiagnostic(error) {
  const diagnostic = typeof error?.diagnostic === 'string' && error.diagnostic.trim()
    ? error.diagnostic.trim()
    : typeof error?.stderr === 'string' && error.stderr.trim()
      ? error.stderr.trim()
      : error instanceof Error
        ? error.message
        : String(error);
  return diagnostic.slice(0, 8000);
}

function validationFailure(code, message, error) {
  return serviceError(422, code, message, { diagnostic: boundedDiagnostic(error) });
}

function evaluationFailure(code, message, error) {
  return serviceError(422, code, message, { diagnostic: boundedDiagnostic(error) });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isEvaluatorInfrastructureError(error) {
  return Boolean(
    error?.killed
    || error?.signal
    || (typeof error?.code === 'string'
      && ![
        'spatial_evaluator_unavailable',
        'spatial_evaluator_protocol_error',
      ].includes(error.code)),
  );
}

function revisionConflict(filePath, expectedRevision, actualRevision) {
  return serviceError(409, 'revision_conflict', 'File revision conflict.', {
    conflict: {
      code: 'revision_conflict',
      path: filePath,
      expectedRevision,
      actualRevision,
    },
  });
}

async function readOptionalUtf8(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
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

function requiredProfileId(profile, code, message) {
  const attachmentId = typeof profile?.id === 'string' ? profile.id.trim() : '';
  if (!profile || !attachmentId) {
    throw serviceError(code === 'spatial_candidate_source_missing' ? 422 : 500, code, message);
  }
  return attachmentId;
}

function publicEvaluation(report, expectedAttachmentId) {
  if (
    !isPlainObject(report)
    || report.schema !== 'shader_forge.spatial_attachment_evaluation'
    || report.schemaVersion !== 1
    || !isPlainObject(report.pose)
    || report.pose.kind !== 'rest'
    || report.pose.sampled !== false
    || !isPlainObject(report.attachment)
    || report.attachment.id !== expectedAttachmentId
    || !Array.isArray(report.bones)
    || !Array.isArray(report.segments)
    || !Array.isArray(report.sockets)
    || !isPlainObject(report.item)
    || !isPlainObject(report.hands)
    || !isPlainObject(report.diagnostics)
  ) {
    throw serviceError(
      500,
      'spatial_evaluator_protocol_error',
      'Spatial evaluator returned an invalid rest-pose evaluation.',
    );
  }
  const { animationRoot: _discardedRoot, ...publicReport } = report;
  return structuredClone(publicReport);
}

function resolveSpatialBinaryPath() {
  const binaryName = process.platform === 'win32'
    ? 'shader_forge_spatial.exe'
    : 'shader_forge_spatial';
  return process.env.SHADER_FORGE_SPATIAL_BINARY?.trim()
    || path.join(repoRoot, 'build', 'runtime', 'bin', binaryName);
}

async function runSpatialJsonCommand(args, unavailableCode, toolName) {
  const binaryPath = resolveSpatialBinaryPath();
  try {
    const { stdout } = await execFileAsync(
      binaryPath,
      args,
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true },
    );
    return JSON.parse(stdout);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw serviceError(
        503,
        unavailableCode,
        `Spatial ${toolName} was not found at ${binaryPath}. Build it with engine build spatial.`,
      );
    }
    throw error;
  }
}

async function defaultValidateAnimationRoot(animationRoot) {
  return runSpatialJsonCommand(
    ['validate', '--animation-root', animationRoot],
    'spatial_validator_unavailable',
    'validator',
  );
}

async function defaultEvaluateRestAttachment(animationRoot, attachmentId) {
  try {
    return await runSpatialJsonCommand(
      ['evaluate-rest', '--animation-root', animationRoot, '--attachment', attachmentId],
      'spatial_evaluator_unavailable',
      'evaluator',
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw serviceError(
        500,
        'spatial_evaluator_protocol_error',
        'Spatial evaluator returned malformed JSON.',
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
  #evaluateRestAttachment;

  constructor({
    sessionStore,
    coordinationStore,
    operationStore,
    validateAnimationRoot,
    evaluateRestAttachment,
  } = {}) {
    this.#sessionStore = sessionStore;
    this.#coordinationStore = coordinationStore;
    this.#operationStore = operationStore;
    this.#validateAnimationRoot = typeof validateAnimationRoot === 'function'
      ? validateAnimationRoot
      : defaultValidateAnimationRoot;
    this.#evaluateRestAttachment = typeof evaluateRestAttachment === 'function'
      ? evaluateRestAttachment
      : defaultEvaluateRestAttachment;
  }

  async previewAttachment(request = {}) {
    const normalized = normalizeRequest(request);
    const inspection = await this.#sessionStore.inspectTextFile(normalized.sessionId, normalized.path);
    if (inspection.revision !== normalized.baseRevision) {
      throw revisionConflict(inspection.path, normalized.baseRevision, inspection.revision);
    }

    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-spatial-preview-'));
    try {
      const stagedAnimationRoot = path.join(temporaryRoot, 'animation');
      await this.#stageAuthoredAnimation(normalized.sessionId, stagedAnimationRoot);
      const stagedAttachmentPath = path.join(stagedAnimationRoot, normalized.stagedSource);
      const stagedBaselineContent = await readOptionalUtf8(stagedAttachmentPath);
      const stagedBaselineRevision = stagedBaselineContent === null
        ? MISSING_FILE_REVISION
        : textContentRevision(stagedBaselineContent);
      if (stagedBaselineRevision !== normalized.baseRevision) {
        throw revisionConflict(inspection.path, normalized.baseRevision, stagedBaselineRevision);
      }

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
        stagedAttachmentPath,
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
      const newAttachmentId = requiredProfileId(
        newProfile,
        'spatial_candidate_source_missing',
        'Validator did not return the proposed attachment source.',
      );
      const oldAttachmentId = inspection.exists
        ? requiredProfileId(
          oldProfile,
          'spatial_baseline_source_missing',
          'Validator did not return the authored attachment source.',
        )
        : null;

      const subjectId = newAttachmentId.toLowerCase();
      const previousSubjectId = oldAttachmentId ? oldAttachmentId.toLowerCase() : null;
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

      const evaluation = { baseline: null, candidate: null };
      if (oldAttachmentId) {
        await fs.writeFile(stagedAttachmentPath, stagedBaselineContent, 'utf8');
        evaluation.baseline = await this.#evaluateStagedAttachment(
          stagedAnimationRoot,
          oldAttachmentId,
          'baseline',
        );
      }
      await fs.writeFile(stagedAttachmentPath, normalized.content, 'utf8');
      evaluation.candidate = await this.#evaluateStagedAttachment(
        stagedAnimationRoot,
        newAttachmentId,
        'candidate',
      );

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
        evaluation,
      };
    } finally {
      await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
  }

  async evaluateAttachment(request = {}) {
    const normalized = normalizeEvaluateRequest(request);
    let initial;
    try {
      initial = await this.#sessionStore.readFile(
        normalized.sessionId,
        normalized.path,
        { rejectSymbolicPath: true },
      );
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw serviceError(404, 'spatial_attachment_missing', 'Authored spatial attachment does not exist.');
      }
      throw error;
    }
    if (initial.revision !== normalized.baseRevision) {
      throw revisionConflict(initial.path, normalized.baseRevision, initial.revision);
    }

    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-spatial-evaluate-'));
    try {
      const stagedAnimationRoot = path.join(temporaryRoot, 'animation');
      await this.#stageAuthoredAnimation(normalized.sessionId, stagedAnimationRoot);
      const stagedContent = await readOptionalUtf8(
        path.join(stagedAnimationRoot, normalized.stagedSource),
      );
      const stagedRevision = stagedContent === null
        ? MISSING_FILE_REVISION
        : textContentRevision(stagedContent);
      if (stagedRevision !== normalized.baseRevision) {
        throw revisionConflict(initial.path, normalized.baseRevision, stagedRevision);
      }

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

      const attachmentId = requiredProfileId(
        profileBySource(baseline, normalized.stagedSource),
        'spatial_baseline_source_missing',
        'Validator did not return the authored attachment source.',
      );
      const evaluation = await this.#evaluateStagedAttachment(
        stagedAnimationRoot,
        attachmentId,
        'baseline',
      );

      let current;
      try {
        current = await this.#sessionStore.readFile(
          normalized.sessionId,
          normalized.path,
          { rejectSymbolicPath: true },
        );
      } catch (error) {
        if (error?.code === 'ENOENT') {
          throw revisionConflict(initial.path, normalized.baseRevision, MISSING_FILE_REVISION);
        }
        throw error;
      }
      if (current.revision !== normalized.baseRevision) {
        throw revisionConflict(current.path, normalized.baseRevision, current.revision);
      }

      return {
        evaluation,
        path: current.path,
        revision: current.revision,
      };
    } finally {
      await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
  }

  async #evaluateStagedAttachment(animationRoot, attachmentId, role) {
    let report;
    try {
      report = await this.#evaluateRestAttachment(animationRoot, attachmentId);
    } catch (error) {
      if (error?.code === 'spatial_evaluator_unavailable' || error?.code === 'ENOENT') {
        throw serviceError(
          503,
          'spatial_evaluator_unavailable',
          boundedDiagnostic(error) || 'Spatial evaluator was not found.',
        );
      }
      if (error?.code === 'spatial_evaluator_protocol_error') throw error;
      if (isEvaluatorInfrastructureError(error)) {
        throw serviceError(
          500,
          'spatial_evaluator_infrastructure_error',
          'Spatial evaluator could not complete.',
          { diagnostic: boundedDiagnostic(error) },
        );
      }
      throw evaluationFailure(
        role === 'candidate'
          ? 'spatial_candidate_evaluation_invalid'
          : 'spatial_baseline_evaluation_invalid',
        role === 'candidate'
          ? 'Proposed spatial attachment evaluation is invalid.'
          : 'Authored spatial baseline evaluation is invalid.',
        error,
      );
    }
    return publicEvaluation(report, attachmentId);
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
