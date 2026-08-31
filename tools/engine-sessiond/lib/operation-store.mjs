import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  MISSING_FILE_REVISION,
  RevisionConflictError,
  textContentRevision,
} from './session-store.mjs';
import {
  CodeTrustArtifactConflictError,
  codeTrustActions,
  codeTrustArtifactPromotionStatuses,
  codeTrustTiers,
  durableArtifactsEqual,
  snapshotCodeTrustArtifact,
} from '../../shared/code-trust-policy.mjs';

const operationStoreVersion = 1;
const ACTOR_KINDS = new Set(['human', 'shell', 'cli', 'mcp']);
const CODE_TRUST_TARGET_KINDS = new Set(['artifact', 'code', 'content', 'plugin']);
const PREVIEW_STATES = new Set(['previewed']);
const REJECTABLE_STATES = new Set(['previewed', 'approved']);
const SUPPORTED_STATES = new Set([
  'previewed',
  'approved',
  'rejected',
  'applying',
  'applied',
  'undoing',
  'undone',
  'conflicted',
]);
const EVENT_TYPES = new Set([
  'previewed',
  'approved',
  'rejected',
  'applying',
  'applied',
  'undoing',
  'undone',
  'conflicted',
  'apply_failed',
  'undo_failed',
  'recovered',
  'validated',
]);
const EVENT_TRANSITIONS = {
  previewed: new Set(['approved', 'rejected', 'validated']),
  approved: new Set(['applying', 'rejected', 'validated']),
  applying: new Set(['applied', 'conflicted', 'apply_failed', 'recovered']),
  applied: new Set(['undoing']),
  undoing: new Set(['undone', 'conflicted', 'undo_failed', 'recovered']),
  rejected: new Set(),
  undone: new Set(),
  conflicted: new Set(),
};
const VALIDATABLE_STATES = new Set(['previewed', 'approved']);
const VALIDATION_SCHEMA_VERSION = 1;
const VALIDATION_MAX_SAMPLES = 64;
const VALIDATION_MAX_EVENTS = 8;
const VALIDATION_MAX_PHASE_LENGTH = 128;
const VALIDATION_MAX_COUNT = 1_000_000;
const VALIDATION_MAX_ERROR_CODE_LENGTH = 128;
const VALIDATION_MAX_ERROR_MESSAGE_LENGTH = 512;
const VALIDATION_SAFE_TOKEN = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const VALIDATION_COUNT_KEYS = Object.freeze([
  'jointLimitViolationCount',
  'overlapCount',
  'toleranceFailureCount',
]);
const VALIDATION_FINDINGS_KEYS = new Set(VALIDATION_COUNT_KEYS);
const VALIDATION_SAMPLE_KEYS = new Set(['phase', 'normalizedTime', ...VALIDATION_COUNT_KEYS]);
const VALIDATION_COMPLETED_KEYS = new Set([
  'schemaVersion',
  'status',
  'proposedRevision',
  'sampleCount',
  'findings',
  'samples',
]);
const VALIDATION_FAILED_KEYS = new Set([...VALIDATION_COMPLETED_KEYS, 'error']);
const VALIDATION_ERROR_KEYS = new Set(['code', 'message']);
const EVENT_RESULT_STATE = {
  previewed: 'previewed',
  approved: 'approved',
  rejected: 'rejected',
  applying: 'applying',
  applied: 'applied',
  undoing: 'undoing',
  undone: 'undone',
  conflicted: 'conflicted',
  apply_failed: 'approved',
  undo_failed: 'applied',
};
const CODE_TRUST_EFFECT_STATUSES = new Set([
  'idle',
  'pending',
  'recorded',
  'reverted',
  'skipped',
  'failed',
]);
const CODE_TRUST_EFFECT_PHASES = new Set(['apply', 'undo']);
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const SPATIAL_SUBJECT_ID = /^[a-z0-9][a-z0-9._-]*$/;
const RESOURCE_KEY = /^[a-z0-9._-]+(?:\/[a-z0-9._-]+)*$/;
const SPATIAL_CONTEXT_FIELDS = new Set([
  'type',
  'label',
  'subjectId',
  'resourceKeys',
  'leaseId',
]);
const SCENE_CONTEXT_FIELDS = new Set([
  'type', 'assetKind', 'intent', 'label', 'subjectId', 'sourceSubjectId',
  'sourceRevision', 'resourceKeys', 'leaseId',
]);
const SCENE_ASSET_ID = /^[a-z0-9][a-z0-9_]*$/;
const DIFF_CONTEXT_LINES = 3;
const MAX_DIFF_INPUT_BYTES = 256 * 1024;
const MAX_DIFF_MATRIX_CELLS = 1_000_000;
const MAX_DIFF_OUTPUT_LINES = 400;

function createStoreError(statusCode, message, extras = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, extras);
  return error;
}

function defaultOperationStorePath() {
  const overrideDir = process.env.SHADER_FORGE_SESSIOND_DATA_DIR?.trim();
  const dataDir = overrideDir
    ? path.resolve(overrideDir)
    : path.join(os.homedir(), '.shader-forge', 'engine-sessiond');
  return path.join(dataDir, 'operations.json');
}

function requireTrimmedString(value, fieldName) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw createStoreError(400, `${fieldName} is required.`);
  }
  return normalized;
}

function isSha256Revision(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

function requireExactObjectKeys(value, allowedKeys, fieldName) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw createStoreError(400, `${fieldName} must be an object.`);
  }
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw createStoreError(400, `Unsupported ${fieldName} field: ${key}`);
    }
  }
  for (const key of allowedKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      throw createStoreError(400, `${fieldName}.${key} is required.`);
    }
  }
  return value;
}

function requireBoundedCount(value, fieldName) {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || Object.is(value, -0)
    || value < 0
    || value > VALIDATION_MAX_COUNT
  ) {
    throw createStoreError(
      400,
      `${fieldName} must be a safe nonnegative integer at most ${VALIDATION_MAX_COUNT}.`,
    );
  }
  return value;
}

function normalizeValidationFindings(value, fieldName) {
  requireExactObjectKeys(value, VALIDATION_FINDINGS_KEYS, fieldName);
  return {
    jointLimitViolationCount: requireBoundedCount(
      value.jointLimitViolationCount,
      `${fieldName}.jointLimitViolationCount`,
    ),
    overlapCount: requireBoundedCount(value.overlapCount, `${fieldName}.overlapCount`),
    toleranceFailureCount: requireBoundedCount(
      value.toleranceFailureCount,
      `${fieldName}.toleranceFailureCount`,
    ),
  };
}

function normalizeValidationSample(value, index) {
  const fieldName = `validation.samples[${index}]`;
  requireExactObjectKeys(value, VALIDATION_SAMPLE_KEYS, fieldName);
  const phase = typeof value.phase === 'string' ? value.phase.trim() : '';
  if (!phase || phase.length > VALIDATION_MAX_PHASE_LENGTH) {
    throw createStoreError(400, `${fieldName}.phase is invalid.`);
  }
  if (
    typeof value.normalizedTime !== 'number'
    || !Number.isFinite(value.normalizedTime)
    || Object.is(value.normalizedTime, -0)
    || value.normalizedTime < 0
    || value.normalizedTime > 1
  ) {
    throw createStoreError(400, `${fieldName}.normalizedTime is invalid.`);
  }
  return {
    phase,
    normalizedTime: value.normalizedTime,
    jointLimitViolationCount: requireBoundedCount(
      value.jointLimitViolationCount,
      `${fieldName}.jointLimitViolationCount`,
    ),
    overlapCount: requireBoundedCount(value.overlapCount, `${fieldName}.overlapCount`),
    toleranceFailureCount: requireBoundedCount(
      value.toleranceFailureCount,
      `${fieldName}.toleranceFailureCount`,
    ),
  };
}

function normalizeValidationError(value) {
  requireExactObjectKeys(value, VALIDATION_ERROR_KEYS, 'validation.error');
  const code = typeof value.code === 'string' ? value.code.trim() : '';
  if (
    !code
    || code.length > VALIDATION_MAX_ERROR_CODE_LENGTH
    || !VALIDATION_SAFE_TOKEN.test(code)
  ) {
    throw createStoreError(400, 'validation.error.code is invalid.');
  }
  const message = typeof value.message === 'string' ? value.message.trim() : '';
  if (!message || message.length > VALIDATION_MAX_ERROR_MESSAGE_LENGTH) {
    throw createStoreError(400, 'validation.error.message is invalid.');
  }
  return { code, message };
}

function normalizeValidationSummary(value) {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    throw createStoreError(400, 'validation must be an object.');
  }
  if (value.status !== 'completed' && value.status !== 'failed') {
    throw createStoreError(400, 'validation.status must be completed or failed.');
  }
  requireExactObjectKeys(
    value,
    value.status === 'failed' ? VALIDATION_FAILED_KEYS : VALIDATION_COMPLETED_KEYS,
    'validation',
  );
  if (!Number.isInteger(value.schemaVersion) || value.schemaVersion !== VALIDATION_SCHEMA_VERSION) {
    throw createStoreError(400, 'validation.schemaVersion must be 1.');
  }
  if (!isSha256Revision(value.proposedRevision)) {
    throw createStoreError(400, 'validation.proposedRevision must be a sha256 content hash.');
  }
  if (!Array.isArray(value.samples) || value.samples.length > VALIDATION_MAX_SAMPLES) {
    throw createStoreError(
      400,
      `validation.samples must be an array of at most ${VALIDATION_MAX_SAMPLES} samples.`,
    );
  }
  const sampleCount = requireBoundedCount(value.sampleCount, 'validation.sampleCount');
  if (sampleCount !== value.samples.length) {
    throw createStoreError(400, 'validation.sampleCount must equal samples.length.');
  }
  const samples = value.samples.map((sample, index) => normalizeValidationSample(sample, index));
  const findings = normalizeValidationFindings(value.findings, 'validation.findings');
  for (const key of VALIDATION_COUNT_KEYS) {
    const sampleTotal = samples.reduce((total, sample) => total + sample[key], 0);
    if (findings[key] !== sampleTotal) {
      throw createStoreError(400, `validation.findings.${key} must equal the sample total.`);
    }
  }
  const normalized = {
    schemaVersion: VALIDATION_SCHEMA_VERSION,
    status: value.status,
    proposedRevision: value.proposedRevision,
    sampleCount,
    findings,
    samples,
  };
  if (value.status === 'failed') {
    normalized.error = normalizeValidationError(value.error);
  }
  return normalized;
}

function normalizePersistedValidation(record) {
  if (!Object.prototype.hasOwnProperty.call(record, 'validation') || record.validation == null) {
    return { ok: true, value: null };
  }
  try {
    const validation = normalizeValidationSummary(record.validation);
    return validation.proposedRevision === record.proposedRevision
      ? { ok: true, value: validation }
      : { ok: false, value: null };
  } catch {
    return { ok: false, value: null };
  }
}

function assertSpatialValidationCandidate(record) {
  if (record.context?.type !== 'spatial_attachment') {
    throw createStoreError(
      409,
      `Operation ${record.id} is not a spatial attachment validation candidate.`,
      { code: 'operation_validation_unavailable' },
    );
  }
  if (!VALIDATABLE_STATES.has(record.state)) {
    throw createStoreError(
      409,
      `Operation ${record.id} cannot be validated from state ${record.state}.`,
      { code: 'operation_validation_unavailable' },
    );
  }
}

function isIsoTimestamp(value) {
  return typeof value === 'string' && ISO_TIMESTAMP.test(value) && Number.isFinite(Date.parse(value));
}

function nextOperationTimestamp(...previousTimestamps) {
  const now = Date.now();
  const previous = Math.max(
    Number.NEGATIVE_INFINITY,
    ...previousTimestamps.map((timestamp) => Date.parse(timestamp)).filter(Number.isFinite),
  );
  return new Date(Math.max(now, previous + 1)).toISOString();
}

function normalizeRevision(value, fieldName) {
  const revision = requireTrimmedString(value, fieldName);
  if (revision !== MISSING_FILE_REVISION && !isSha256Revision(revision)) {
    throw createStoreError(
      400,
      `${fieldName} must be a sha256 content hash or the missing-file sentinel.`,
    );
  }
  return revision;
}

function normalizeOperationContext(value) {
  if (value == null) {
    return null;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw createStoreError(400, 'context must be an object.');
  }
  const allowedFields = value.type === 'scene_asset' ? SCENE_CONTEXT_FIELDS : SPATIAL_CONTEXT_FIELDS;
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      throw createStoreError(400, `Unsupported operation context field: ${key}`);
    }
  }
  if (!['spatial_attachment', 'scene_asset'].includes(value.type)) {
    throw createStoreError(400, 'context.type must be spatial_attachment or scene_asset.');
  }
  const label = requireTrimmedString(value.label, 'context.label');
  const subjectId = requireTrimmedString(value.subjectId, 'context.subjectId').toLowerCase();
  const leaseId = requireTrimmedString(value.leaseId, 'context.leaseId');
  if (!(value.type === 'scene_asset' ? SCENE_ASSET_ID : SPATIAL_SUBJECT_ID).test(subjectId)) {
    throw createStoreError(400, value.type === 'scene_asset'
      ? 'context.subjectId is not a canonical scene asset id.'
      : 'context.subjectId is not a canonical spatial attachment id.');
  }
  if (!Array.isArray(value.resourceKeys) || value.resourceKeys.length === 0) {
    throw createStoreError(400, 'context.resourceKeys must be a non-empty array.');
  }
  const resourceKeys = [...new Set(value.resourceKeys.map((resource) => {
    const normalized = requireTrimmedString(resource, 'context.resourceKeys entry')
      .replaceAll('\\', '/')
      .toLowerCase();
    if (!RESOURCE_KEY.test(normalized)) {
      throw createStoreError(400, `Invalid context resource key: ${normalized}`);
    }
    return normalized;
  }))].sort();
  if (value.type === 'spatial_attachment') {
    return { type: 'spatial_attachment', label, subjectId, resourceKeys, leaseId };
  }
  const assetKind = requireTrimmedString(value.assetKind, 'context.assetKind');
  const intent = requireTrimmedString(value.intent, 'context.intent');
  if (!['scene', 'prefab'].includes(assetKind)) throw createStoreError(400, 'context.assetKind must be scene or prefab.');
  if (!['save', 'create', 'duplicate'].includes(intent)) throw createStoreError(400, 'context.intent must be save, create, or duplicate.');
  const prefix = assetKind === 'scene' ? 'scene/world' : 'scene/prefab';
  const expectedResources = [`${prefix}/${subjectId}`];
  let sourceSubjectId;
  let sourceRevision;
  if (intent === 'duplicate') {
    sourceSubjectId = requireTrimmedString(value.sourceSubjectId, 'context.sourceSubjectId').toLowerCase();
    sourceRevision = normalizeRevision(value.sourceRevision, 'context.sourceRevision');
    if (!SCENE_ASSET_ID.test(sourceSubjectId) || sourceSubjectId === subjectId || sourceRevision === MISSING_FILE_REVISION) {
      throw createStoreError(400, 'context duplicate source is invalid.');
    }
    expectedResources.push(`${prefix}/${sourceSubjectId}`);
  } else if (value.sourceSubjectId != null || value.sourceRevision != null) {
    throw createStoreError(400, 'context source fields are only valid for duplicate.');
  }
  expectedResources.sort();
  if (JSON.stringify(resourceKeys) !== JSON.stringify(expectedResources)) {
    throw createStoreError(400, 'context.resourceKeys do not match the semantic scene asset subjects.');
  }
  return {
    type: 'scene_asset', assetKind, intent, label, subjectId,
    ...(sourceSubjectId ? { sourceSubjectId, sourceRevision } : {}), resourceKeys, leaseId,
  };
}

function tryNormalizeOperationContext(value) {
  try {
    return normalizeOperationContext(value);
  } catch {
    return undefined;
  }
}

function normalizeActor(value) {
  if (value == null || value === '') {
    throw createStoreError(400, 'actor is required.');
  }
  if (typeof value !== 'object') {
    throw createStoreError(400, 'actor must be an object.');
  }

  const kind = typeof value.kind === 'string' ? value.kind.trim() : '';
  if (!ACTOR_KINDS.has(kind)) {
    throw createStoreError(400, 'actor.kind must be human, shell, cli, or mcp.');
  }

  return {
    kind,
    id: typeof value.id === 'string' ? value.id.trim() : '',
    name: typeof value.name === 'string' ? value.name.trim() : '',
  };
}

function tryNormalizeActor(value) {
  try {
    return normalizeActor(value);
  } catch {
    return null;
  }
}

function splitLines(text) {
  if (text == null) {
    return [];
  }
  return String(text).split('\n');
}

function idleCodeTrustEffect() {
  return {
    status: 'idle',
    phase: null,
    actor: '',
    origin: '',
    evaluation: null,
    artifact: null,
    error: null,
    updatedAt: null,
  };
}

function publicCodeTrustEffect(effect) {
  const normalized = effect && typeof effect === 'object' ? effect : idleCodeTrustEffect();
  return {
    status: normalized.status || 'idle',
    phase: normalized.phase || null,
    actor: normalized.actor || '',
    origin: normalized.origin || '',
    artifact: normalized.artifact ? structuredClone(normalized.artifact) : null,
    error: normalized.error || null,
    updatedAt: normalized.updatedAt || null,
  };
}

function persistableCodeTrustEffect(effect) {
  const normalized = effect && typeof effect === 'object' ? effect : idleCodeTrustEffect();
  const persistable = {
    status: normalized.status || 'idle',
    phase: normalized.phase || null,
    actor: typeof normalized.actor === 'string' ? normalized.actor : '',
    origin: typeof normalized.origin === 'string' ? normalized.origin : '',
    evaluation: normalized.evaluation ? structuredClone(normalized.evaluation) : null,
    artifact: normalized.artifact ? structuredClone(normalized.artifact) : null,
    error: normalized.error || null,
    updatedAt: normalized.updatedAt || null,
  };
  if (Object.prototype.hasOwnProperty.call(normalized, 'priorArtifact')) {
    persistable.priorArtifact = normalized.priorArtifact
      ? structuredClone(normalized.priorArtifact)
      : null;
  }
  return persistable;
}

function normalizePersistedEffect(effect) {
  if (effect == null) {
    return idleCodeTrustEffect();
  }
  if (typeof effect !== 'object') {
    return null;
  }
  const status = typeof effect.status === 'string' ? effect.status.trim() : '';
  if (!CODE_TRUST_EFFECT_STATUSES.has(status)) {
    return null;
  }
  let phase = null;
  if (effect.phase != null && effect.phase !== '') {
    if (typeof effect.phase !== 'string' || !CODE_TRUST_EFFECT_PHASES.has(effect.phase.trim())) {
      return null;
    }
    phase = effect.phase.trim();
  }
  if (effect.evaluation != null && typeof effect.evaluation !== 'object') {
    return null;
  }
  if (effect.artifact != null && typeof effect.artifact !== 'object') {
    return null;
  }
  if (effect.error != null && typeof effect.error !== 'string') {
    return null;
  }
  const updatedAt = effect.updatedAt || null;
  if (
    (status === 'idle' && updatedAt !== null)
    || (status !== 'idle' && !isIsoTimestamp(updatedAt))
  ) {
    return null;
  }
  if (effect.priorArtifact != null && typeof effect.priorArtifact !== 'object') {
    return null;
  }
  const normalized = {
    status,
    phase,
    actor: typeof effect.actor === 'string' ? effect.actor.trim() : '',
    origin: typeof effect.origin === 'string' ? effect.origin.trim() : '',
    evaluation: effect.evaluation ? structuredClone(effect.evaluation) : null,
    artifact: effect.artifact ? structuredClone(effect.artifact) : null,
    error: typeof effect.error === 'string' && effect.error.trim() ? effect.error.trim() : null,
    updatedAt,
  };
  if (Object.prototype.hasOwnProperty.call(effect, 'priorArtifact')) {
    normalized.priorArtifact = effect.priorArtifact ? structuredClone(effect.priorArtifact) : null;
  }
  return normalized;
}

function effectHasObject(value) {
  return value != null && typeof value === 'object';
}

function effectArtifactIsCoherent(value) {
  if (!effectHasObject(value)) {
    return false;
  }
  const artifactPath = typeof value.path === 'string' ? value.path.trim() : '';
  const contentHash = typeof value.contentHash === 'string' ? value.contentHash : '';
  const promotionStatus = typeof value.promotionStatus === 'string' ? value.promotionStatus.trim() : '';
  return Boolean(artifactPath)
    && (contentHash === '' || /^[a-f0-9]{64}$/.test(contentHash))
    && (contentHash ? value.hashAlgorithm === 'sha256' : value.hashAlgorithm === '')
    && codeTrustArtifactPromotionStatuses.includes(promotionStatus)
    && codeTrustTiers.includes(value.origin)
    && codeTrustTiers.includes(value.targetTier)
    && CODE_TRUST_TARGET_KINDS.has(value.targetKind)
    && codeTrustActions.includes(value.lastAction)
    && isIsoTimestamp(value.updatedAt);
}

function durableEffectArtifactsEqual(left, right) {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  const fields = [
    'path',
    'origin',
    'targetTier',
    'targetKind',
    'lastAction',
    'updatedAt',
    'hashAlgorithm',
    'contentHash',
    'promotionStatus',
    'promotedAt',
    'promotedBy',
    'promotionNote',
    'quarantinedAt',
    'quarantinedBy',
    'quarantineNote',
  ];
  return fields.every((field) => (left[field] ?? null) === (right[field] ?? null));
}

function effectMatchesOperation(effect, { path: operationPath, proposedRevision }) {
  if (effect.evaluation) {
    if (
      effect.evaluation.path !== operationPath
      || effect.evaluation.action !== 'apply'
      || !codeTrustTiers.includes(effect.evaluation.targetTier)
      || !CODE_TRUST_TARGET_KINDS.has(effect.evaluation.targetKind)
      || !codeTrustTiers.includes(effect.evaluation.effectiveOrigin)
    ) {
      return false;
    }
  }
  if (effect.artifact?.path !== undefined && effect.artifact.path !== operationPath) {
    return false;
  }
  if (effect.priorArtifact?.path !== undefined && effect.priorArtifact.path !== operationPath) {
    return false;
  }
  if (effect.status === 'recorded') {
    return effect.artifact.contentHash === proposedRevision.slice('sha256:'.length)
      && effect.artifact.origin === effect.evaluation.effectiveOrigin
      && effect.artifact.targetTier === effect.evaluation.targetTier
      && effect.artifact.targetKind === effect.evaluation.targetKind
      && effect.artifact.lastAction === effect.evaluation.action;
  }
  if (effect.status === 'reverted') {
    return durableEffectArtifactsEqual(effect.artifact, effect.priorArtifact);
  }
  return true;
}

function effectShapeIsCoherent(effect) {
  if (!effect || typeof effect !== 'object') {
    return false;
  }

  const status = effect.status;
  const phase = effect.phase;
  const hasEvaluation = effectHasObject(effect.evaluation);
  const hasArtifact = effectHasObject(effect.artifact);
  const hasPriorArtifact = Object.prototype.hasOwnProperty.call(effect, 'priorArtifact');
  const priorArtifactIsValid = effect.priorArtifact == null
    || effectArtifactIsCoherent(effect.priorArtifact);
  const hasError = typeof effect.error === 'string' && effect.error.trim().length > 0;
  if (effect.error != null && typeof effect.error !== 'string') {
    return false;
  }

  if (status === 'idle') {
    return phase == null && !hasEvaluation && !hasArtifact && !hasPriorArtifact && !hasError;
  }
  if (status === 'skipped') {
    return (phase === 'apply' || phase === 'undo')
      && !hasArtifact
      && (!hasPriorArtifact || priorArtifactIsValid)
      && !hasError;
  }
  if (status === 'pending') {
    return (phase === 'apply' || phase === 'undo')
      && hasEvaluation
      && (!hasArtifact || effectArtifactIsCoherent(effect.artifact))
      && (!hasPriorArtifact || priorArtifactIsValid)
      && !hasError;
  }
  if (status === 'failed') {
    return (phase === 'apply' || phase === 'undo')
      && hasEvaluation
      && (!hasArtifact || effectArtifactIsCoherent(effect.artifact))
      && (!hasPriorArtifact || priorArtifactIsValid)
      && hasError;
  }
  if (status === 'recorded') {
    return phase === 'apply'
      && hasEvaluation
      && effectArtifactIsCoherent(effect.artifact)
      && hasPriorArtifact
      && priorArtifactIsValid
      && !hasError;
  }
  if (status === 'reverted') {
    return phase === 'undo'
      && hasEvaluation
      && (!hasArtifact || effectArtifactIsCoherent(effect.artifact))
      && hasPriorArtifact
      && priorArtifactIsValid
      && !hasError;
  }
  return false;
}

function effectCompatibleWithState(state, effect) {
  if (!effectShapeIsCoherent(effect)) {
    return false;
  }
  if (state === 'previewed' || state === 'rejected') {
    return effect.status === 'idle' && effect.phase == null;
  }
  if (state === 'approved') {
    if (effect.status === 'idle' && effect.phase == null) {
      return true;
    }
    return effect.phase === 'apply'
      && ['pending', 'failed', 'skipped', 'recorded'].includes(effect.status);
  }
  if (state === 'applying') {
    return effect.phase === 'apply'
      && ['pending', 'failed', 'skipped', 'recorded'].includes(effect.status);
  }
  if (state === 'applied') {
    return effect.phase === 'apply'
      && (effect.status === 'recorded' || effect.status === 'skipped');
  }
  if (state === 'undoing') {
    return effect.phase === 'undo'
      && ['pending', 'failed', 'skipped', 'reverted'].includes(effect.status);
  }
  if (state === 'undone') {
    return effect.phase === 'undo'
      && (effect.status === 'reverted' || effect.status === 'skipped');
  }
  if (state === 'conflicted') {
    if (effect.status === 'idle' && effect.phase == null) {
      return true;
    }
    if (effect.phase === 'apply') {
      return ['pending', 'failed', 'skipped', 'recorded'].includes(effect.status);
    }
    if (effect.phase === 'undo') {
      return ['pending', 'failed', 'skipped', 'reverted'].includes(effect.status);
    }
    return false;
  }
  return false;
}

function previewMatchesStoredContent(preview, beforeContent, proposedContent) {
  const expected = summarizeLinePreview(beforeContent, proposedContent, {
    created: beforeContent == null,
  });
  return expected.addedLines === preview.addedLines
    && expected.removedLines === preview.removedLines
    && expected.beforeLineCount === preview.beforeLineCount
    && expected.afterLineCount === preview.afterLineCount
    && expected.created === preview.created
    && expected.summary === preview.summary;
}

function normalizeWorkspaceIdentity(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const canonicalPath = typeof value.canonicalPath === 'string' ? value.canonicalPath.trim() : '';
  const dev = typeof value.dev === 'string' ? value.dev.trim() : '';
  const ino = typeof value.ino === 'string' ? value.ino.trim() : '';
  if (!canonicalPath || !dev || !ino) {
    return null;
  }
  return { canonicalPath, dev, ino };
}

function expectedArtifactContentHash(record, phase) {
  if (phase === 'apply') {
    return record.proposedRevision === MISSING_FILE_REVISION
      ? ''
      : record.proposedRevision.slice('sha256:'.length);
  }
  const restored = restoredRevision(record);
  return restored === MISSING_FILE_REVISION ? '' : restored.slice('sha256:'.length);
}

function normalizePreviewSchema(preview) {
  if (!preview || typeof preview !== 'object') {
    return null;
  }
  const {
    addedLines,
    removedLines,
    beforeLineCount,
    afterLineCount,
    created,
    summary,
  } = preview;
  if (
    !Number.isInteger(addedLines)
    || addedLines < 0
    || !Number.isInteger(removedLines)
    || removedLines < 0
    || !Number.isInteger(beforeLineCount)
    || beforeLineCount < 0
    || !Number.isInteger(afterLineCount)
    || afterLineCount < 0
    || typeof created !== 'boolean'
    || typeof summary !== 'string'
    || !summary.trim()
  ) {
    return null;
  }
  return {
    addedLines,
    removedLines,
    beforeLineCount,
    afterLineCount,
    created,
    summary: summary.trim(),
  };
}

function expectedRecoveredState(fromState) {
  if (fromState === 'applying') {
    return 'approved';
  }
  if (fromState === 'undoing') {
    return 'applied';
  }
  return null;
}

function isValidEventSequence(events) {
  if (!Array.isArray(events) || events.length === 0) {
    return false;
  }

  let currentState = null;
  let validationCount = 0;
  let previousTimestamp = Number.NEGATIVE_INFINITY;
  for (const event of events) {
    if (!event || !EVENT_TYPES.has(event.type) || !SUPPORTED_STATES.has(event.state)) {
      return false;
    }
    const timestamp = Date.parse(event.at);
    if (timestamp < previousTimestamp) {
      return false;
    }
    previousTimestamp = timestamp;
    if (currentState == null) {
      if (event.type !== 'previewed' || event.state !== 'previewed') {
        return false;
      }
      currentState = 'previewed';
      continue;
    }
    const allowed = EVENT_TRANSITIONS[currentState];
    if (!allowed || !allowed.has(event.type)) {
      return false;
    }
    if (event.type === 'validated') {
      validationCount += 1;
      if (validationCount > VALIDATION_MAX_EVENTS) {
        return false;
      }
      if (event.state !== currentState) {
        return false;
      }
    } else if (event.type === 'recovered') {
      if (event.state !== expectedRecoveredState(currentState)) {
        return false;
      }
    } else if (event.state !== EVENT_RESULT_STATE[event.type]) {
      return false;
    }
    currentState = event.state;
  }
  return true;
}

function lastEventActor(record, eventType) {
  const events = Array.isArray(record?.events) ? record.events : [];
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type === eventType && event.actor) {
      return structuredClone(event.actor);
    }
  }
  return record?.actor ? structuredClone(record.actor) : null;
}

function normalizeCodeTrustInput(value) {
  if (value == null || value === '') {
    return null;
  }
  if (typeof value !== 'object') {
    throw createStoreError(400, 'codeTrust must be an object.');
  }
  const actor = typeof value.actor === 'string' ? value.actor.trim() : '';
  const origin = typeof value.origin === 'string' ? value.origin.trim() : '';
  const evaluation = value.evaluation && typeof value.evaluation === 'object'
    ? structuredClone(value.evaluation)
    : null;
  return { actor, origin, evaluation };
}

function pendingCodeTrustEffect({ phase, actor = '', origin = '', evaluation = null, timestamp }) {
  return {
    status: evaluation ? 'pending' : 'skipped',
    phase,
    actor,
    origin,
    evaluation: evaluation ? structuredClone(evaluation) : null,
    artifact: null,
    error: null,
    updatedAt: timestamp,
  };
}

function effectAlreadyFinalized(effect, phase) {
  if (!effect || effect.phase !== phase) {
    return false;
  }
  if (phase === 'apply') {
    return effect.status === 'recorded' || effect.status === 'skipped';
  }
  if (phase === 'undo') {
    return effect.status === 'reverted' || effect.status === 'skipped';
  }
  return false;
}

function summarizeLinePreview(beforeText, afterText, { created = false } = {}) {
  const beforeLines = splitLines(beforeText);
  const afterLines = splitLines(afterText);
  const beforeCounts = new Map();
  for (const line of beforeLines) {
    beforeCounts.set(line, (beforeCounts.get(line) || 0) + 1);
  }

  let addedLines = 0;
  let removedLines = 0;
  const afterCounts = new Map();
  for (const line of afterLines) {
    afterCounts.set(line, (afterCounts.get(line) || 0) + 1);
  }

  const keys = new Set([...beforeCounts.keys(), ...afterCounts.keys()]);
  for (const key of keys) {
    const beforeCount = beforeCounts.get(key) || 0;
    const afterCount = afterCounts.get(key) || 0;
    if (afterCount > beforeCount) {
      addedLines += afterCount - beforeCount;
    } else if (beforeCount > afterCount) {
      removedLines += beforeCount - afterCount;
    }
  }

  return {
    addedLines,
    removedLines,
    beforeLineCount: beforeLines.length,
    afterLineCount: afterLines.length,
    created,
    summary: created
      ? `created file, ${addedLines} added`
      : `${addedLines} added, ${removedLines} removed`,
  };
}

function splitDiffLines(text) {
  if (!text) {
    return [];
  }
  const lines = [];
  const matcher = /([^\r\n]*)(\r\n|\r|\n|$)/g;
  for (let match = matcher.exec(text); match && match[0]; match = matcher.exec(text)) {
    lines.push({
      text: match[1],
      ending: match[2] === '\r\n'
        ? 'crlf'
        : match[2] === '\r'
          ? 'cr'
          : match[2] === '\n'
            ? 'lf'
            : 'none',
    });
  }
  return lines;
}

function diffLinesEqual(left, right) {
  return left.text === right.text && left.ending === right.ending;
}

function summaryOnlyDiff(record, reason, { truncated = false } = {}) {
  return {
    operationId: record.id,
    path: record.path,
    beforeRevision: record.baseRevision,
    afterRevision: record.proposedRevision,
    status: 'summary_only',
    reason,
    truncated,
    summary: structuredClone(record.preview),
    hunks: [],
  };
}

function operationDiff(record) {
  const beforeText = record.baseRevision === MISSING_FILE_REVISION
    ? ''
    : record.beforeContent;
  const afterText = record.proposedContent;
  if (typeof beforeText !== 'string' || typeof afterText !== 'string') {
    return summaryOnlyDiff(record, 'unavailable');
  }
  if (beforeText.length + afterText.length > MAX_DIFF_INPUT_BYTES) {
    return summaryOnlyDiff(record, 'too_large', { truncated: true });
  }
  const binaryLike = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;
  if (binaryLike.test(beforeText) || binaryLike.test(afterText)) {
    return summaryOnlyDiff(record, 'binary');
  }
  if (
    Buffer.byteLength(beforeText, 'utf8') + Buffer.byteLength(afterText, 'utf8')
      > MAX_DIFF_INPUT_BYTES
  ) {
    return summaryOnlyDiff(record, 'too_large', { truncated: true });
  }

  const beforeLines = splitDiffLines(beforeText);
  const afterLines = splitDiffLines(afterText);
  const rowLength = afterLines.length + 1;
  const cellCount = (beforeLines.length + 1) * rowLength;
  if (cellCount > MAX_DIFF_MATRIX_CELLS) {
    return summaryOnlyDiff(record, 'too_large', { truncated: true });
  }

  const longestCommonSubsequence = new Uint32Array(cellCount);
  for (let beforeIndex = beforeLines.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = afterLines.length - 1; afterIndex >= 0; afterIndex -= 1) {
      const index = beforeIndex * rowLength + afterIndex;
      longestCommonSubsequence[index] = diffLinesEqual(
        beforeLines[beforeIndex],
        afterLines[afterIndex],
      )
        ? longestCommonSubsequence[(beforeIndex + 1) * rowLength + afterIndex + 1] + 1
        : Math.max(
          longestCommonSubsequence[(beforeIndex + 1) * rowLength + afterIndex],
          longestCommonSubsequence[index + 1],
        );
    }
  }

  const lines = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  let oldLine = 1;
  let newLine = 1;
  while (beforeIndex < beforeLines.length || afterIndex < afterLines.length) {
    const oldPosition = oldLine;
    const newPosition = newLine;
    if (
      beforeIndex < beforeLines.length
      && afterIndex < afterLines.length
      && diffLinesEqual(beforeLines[beforeIndex], afterLines[afterIndex])
    ) {
      lines.push({
        type: 'context',
        oldLine,
        newLine,
        oldPosition,
        newPosition,
        ...beforeLines[beforeIndex],
      });
      beforeIndex += 1;
      afterIndex += 1;
      oldLine += 1;
      newLine += 1;
    } else if (
      beforeIndex < beforeLines.length
      && (
        afterIndex >= afterLines.length
        || longestCommonSubsequence[(beforeIndex + 1) * rowLength + afterIndex]
          >= longestCommonSubsequence[beforeIndex * rowLength + afterIndex + 1]
      )
    ) {
      lines.push({
        type: 'removed',
        oldLine,
        newLine: null,
        oldPosition,
        newPosition,
        ...beforeLines[beforeIndex],
      });
      beforeIndex += 1;
      oldLine += 1;
    } else {
      lines.push({
        type: 'added',
        oldLine: null,
        newLine,
        oldPosition,
        newPosition,
        ...afterLines[afterIndex],
      });
      afterIndex += 1;
      newLine += 1;
    }
  }

  const ranges = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].type === 'context') {
      continue;
    }
    const start = Math.max(0, index - DIFF_CONTEXT_LINES);
    const end = Math.min(lines.length, index + DIFF_CONTEXT_LINES + 1);
    const prior = ranges.at(-1);
    if (prior && start <= prior.end) {
      prior.end = Math.max(prior.end, end);
    } else {
      ranges.push({ start, end });
    }
  }

  const hunks = [];
  let remaining = MAX_DIFF_OUTPUT_LINES;
  let truncated = false;
  for (const range of ranges) {
    if (remaining === 0) {
      truncated = true;
      break;
    }
    const completeLines = lines.slice(range.start, range.end);
    const selectedLines = completeLines.slice(0, remaining);
    if (selectedLines.length < completeLines.length) {
      truncated = true;
    }
    const first = selectedLines[0];
    const oldLines = selectedLines.filter((line) => line.oldLine !== null).length;
    const newLines = selectedLines.filter((line) => line.newLine !== null).length;
    hunks.push({
      oldStart: oldLines === 0 ? Math.max(0, first.oldPosition - 1) : first.oldPosition,
      oldLines,
      newStart: newLines === 0 ? Math.max(0, first.newPosition - 1) : first.newPosition,
      newLines,
      lines: selectedLines.map(({ oldPosition: _, newPosition: __, ...line }) => line),
    });
    remaining -= selectedLines.length;
    if (truncated) {
      break;
    }
  }

  return {
    operationId: record.id,
    path: record.path,
    beforeRevision: record.baseRevision,
    afterRevision: record.proposedRevision,
    status: 'available',
    reason: null,
    truncated,
    summary: structuredClone(record.preview),
    hunks,
  };
}

function revisionConflict({
  path: filePath,
  expectedRevision,
  actualRevision,
  operationId = null,
}) {
  return {
    code: 'revision_conflict',
    path: filePath,
    expectedRevision,
    actualRevision,
    ...(operationId ? { operationId } : {}),
  };
}

function isRevisionConflictError(error) {
  return error instanceof RevisionConflictError
    || (error && typeof error === 'object' && error.conflict?.code === 'revision_conflict');
}

function isArtifactConflictError(error) {
  return error instanceof CodeTrustArtifactConflictError
    || (error && typeof error === 'object' && error.conflict?.code === 'code_trust_artifact_conflict');
}

function artifactConflict(record, error) {
  return {
    code: 'code_trust_artifact_conflict',
    path: error?.conflict?.path || record.path,
    ...(record.id ? { operationId: record.id } : {}),
  };
}

function operationView(record) {
  return {
    id: record.id,
    kind: record.kind,
    sessionId: record.sessionId,
    path: record.path,
    workspaceRoot: record.workspaceRoot,
    workspaceIdentity: record.workspaceIdentity ? structuredClone(record.workspaceIdentity) : null,
    actor: structuredClone(record.actor),
    context: record.context ? structuredClone(record.context) : null,
    state: record.state,
    baseRevision: record.baseRevision,
    proposedRevision: record.proposedRevision,
    appliedRevision: record.appliedRevision,
    resultingRevision: record.resultingRevision,
    preview: structuredClone(record.preview),
    codeTrustEffect: publicCodeTrustEffect(record.codeTrustEffect),
    validation: record.validation ? structuredClone(record.validation) : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    events: structuredClone(record.events),
  };
}

function persistableRecord(record) {
  return {
    id: record.id,
    kind: record.kind,
    sessionId: record.sessionId,
    path: record.path,
    workspaceRoot: record.workspaceRoot,
    workspaceIdentity: record.workspaceIdentity ? structuredClone(record.workspaceIdentity) : null,
    actor: {
      kind: record.actor.kind,
      id: record.actor.id,
      name: record.actor.name,
    },
    context: record.context ? structuredClone(record.context) : null,
    state: record.state,
    baseRevision: record.baseRevision,
    proposedRevision: record.proposedRevision,
    appliedRevision: record.appliedRevision,
    resultingRevision: record.resultingRevision,
    preview: structuredClone(record.preview),
    codeTrustEffect: persistableCodeTrustEffect(record.codeTrustEffect),
    validation: record.validation ? structuredClone(record.validation) : null,
    beforeContent: record.beforeContent,
    proposedContent: record.proposedContent,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    events: Array.isArray(record.events)
      ? record.events.map((event) => ({
        type: event.type,
        at: event.at,
        state: event.state,
        actor: event.actor
          ? {
            kind: event.actor.kind,
            id: event.actor.id,
            name: event.actor.name,
          }
          : null,
        ...(event.conflict ? { conflict: structuredClone(event.conflict) } : {}),
      }))
      : [],
  };
}

function normalizePersistedEvent(event, fallbackActor, fallbackState, fallbackTimestamp) {
  if (!event || typeof event !== 'object') {
    return null;
  }
  if (!EVENT_TYPES.has(event.type) || !isIsoTimestamp(event.at) || !SUPPORTED_STATES.has(event.state)) {
    return null;
  }

  let actor = null;
  if (event.actor != null) {
    actor = tryNormalizeActor(event.actor);
    if (!actor) {
      return null;
    }
  } else if (event.type === 'validated') {
    return null;
  } else {
    actor = structuredClone(fallbackActor);
  }

  const normalized = {
    type: event.type,
    at: event.at,
    state: event.state,
    actor,
  };

  if (event.conflict != null) {
    if (!event.conflict || typeof event.conflict !== 'object') {
      return null;
    }
    if (typeof event.conflict.path !== 'string' || !event.conflict.path.trim()) {
      return null;
    }
    if (event.conflict.code === 'code_trust_artifact_conflict') {
      normalized.conflict = {
        code: 'code_trust_artifact_conflict',
        path: event.conflict.path.trim(),
        ...(typeof event.conflict.operationId === 'string' && event.conflict.operationId.trim()
          ? { operationId: event.conflict.operationId.trim() }
          : {}),
      };
    } else if (event.conflict.code === 'revision_conflict') {
      if (
        event.conflict.expectedRevision !== MISSING_FILE_REVISION
        && !isSha256Revision(event.conflict.expectedRevision)
      ) {
        return null;
      }
      if (
        event.conflict.actualRevision !== MISSING_FILE_REVISION
        && !isSha256Revision(event.conflict.actualRevision)
      ) {
        return null;
      }
      normalized.conflict = {
        code: 'revision_conflict',
        path: event.conflict.path,
        expectedRevision: event.conflict.expectedRevision,
        actualRevision: event.conflict.actualRevision,
        ...(typeof event.conflict.operationId === 'string' && event.conflict.operationId.trim()
          ? { operationId: event.conflict.operationId.trim() }
          : {}),
      };
    } else {
      return null;
    }
  }

  if (!normalized.at) {
    normalized.at = fallbackTimestamp;
  }
  if (!normalized.state) {
    normalized.state = fallbackState;
  }
  return normalized;
}

function normalizePersistedOperation(record) {
  if (!record || typeof record !== 'object') {
    return null;
  }

  const {
    id = '',
    kind = '',
    sessionId = '',
    path: filePath = '',
    workspaceRoot = '',
    workspaceIdentity,
    actor,
    context = null,
    state = '',
    baseRevision = '',
    proposedRevision = '',
    appliedRevision = null,
    resultingRevision = null,
    preview,
    codeTrustEffect,
    beforeContent = null,
    proposedContent = '',
    createdAt = '',
    updatedAt = '',
    events,
  } = record;

  if (
    typeof id !== 'string'
    || typeof kind !== 'string'
    || typeof sessionId !== 'string'
    || typeof filePath !== 'string'
    || typeof workspaceRoot !== 'string'
    || typeof state !== 'string'
    || !id.trim()
    || kind !== 'file_write'
    || !sessionId.trim()
    || !filePath.trim()
    || !workspaceRoot.trim()
    || !SUPPORTED_STATES.has(state)
    || !isIsoTimestamp(createdAt)
    || !isIsoTimestamp(updatedAt)
    || Date.parse(createdAt) > Date.parse(updatedAt)
  ) {
    return null;
  }

  const normalizedActor = tryNormalizeActor(actor);
  if (!normalizedActor) {
    return null;
  }
  const normalizedContext = tryNormalizeOperationContext(context);
  if (normalizedContext === undefined) {
    return null;
  }

  if (typeof proposedContent !== 'string') {
    return null;
  }
  if (beforeContent != null && typeof beforeContent !== 'string') {
    return null;
  }
  if (!isSha256Revision(proposedRevision)) {
    return null;
  }
  if (textContentRevision(proposedContent) !== proposedRevision) {
    return null;
  }
  if (beforeContent == null) {
    if (baseRevision !== MISSING_FILE_REVISION) {
      return null;
    }
  } else if (!isSha256Revision(baseRevision) || textContentRevision(beforeContent) !== baseRevision) {
    return null;
  }

  if (appliedRevision != null && !isSha256Revision(appliedRevision)) {
    return null;
  }
  if (resultingRevision != null && resultingRevision !== MISSING_FILE_REVISION && !isSha256Revision(resultingRevision)) {
    return null;
  }

  if (['previewed', 'approved', 'rejected', 'applying'].includes(state)) {
    if (appliedRevision != null || resultingRevision != null) {
      return null;
    }
  }
  if (['applied', 'undoing'].includes(state)) {
    if (appliedRevision !== proposedRevision || resultingRevision != null) {
      return null;
    }
  }
  if (state === 'undone') {
    if (appliedRevision !== proposedRevision) {
      return null;
    }
    const expectedResult = beforeContent == null
      ? MISSING_FILE_REVISION
      : textContentRevision(beforeContent);
    if (resultingRevision !== expectedResult) {
      return null;
    }
  }

  if (!Array.isArray(events) || events.length === 0) {
    return null;
  }
  const normalizedEvents = [];
  for (const event of events) {
    const normalizedEvent = normalizePersistedEvent(event, normalizedActor, state, createdAt);
    if (!normalizedEvent) {
      return null;
    }
    normalizedEvents.push(normalizedEvent);
  }
  if (!isValidEventSequence(normalizedEvents)) {
    return null;
  }
  const finalEvent = normalizedEvents[normalizedEvents.length - 1];
  if (
    !finalEvent
    || finalEvent.state !== state
    || Date.parse(createdAt) > Date.parse(normalizedEvents[0].at)
    || Date.parse(updatedAt) < Date.parse(finalEvent.at)
  ) {
    return null;
  }

  const normalizedPreview = normalizePreviewSchema(preview);
  if (!normalizedPreview) {
    return null;
  }
  if (!previewMatchesStoredContent(normalizedPreview, beforeContent, proposedContent)) {
    return null;
  }

  const normalizedEffect = normalizePersistedEffect(codeTrustEffect);
  const effectTimestamp = normalizedEffect?.updatedAt
    ? Date.parse(normalizedEffect.updatedAt)
    : null;
  if (
    !normalizedEffect
    || !effectCompatibleWithState(state, normalizedEffect)
    || !effectMatchesOperation(normalizedEffect, {
      path: filePath.trim(),
      proposedRevision,
    })
    || (effectTimestamp !== null && (
      effectTimestamp < Date.parse(createdAt)
      || effectTimestamp > Date.parse(updatedAt)
    ))
  ) {
    return null;
  }

  const normalizedIdentity = normalizeWorkspaceIdentity(workspaceIdentity);
  if (!normalizedIdentity) {
    return null;
  }

  const persistedValidation = normalizePersistedValidation(record);
  if (!persistedValidation.ok) {
    return null;
  }
  const hasValidatedEvent = normalizedEvents.some((event) => event.type === 'validated');
  if ((persistedValidation.value !== null) !== hasValidatedEvent) {
    return null;
  }
  if (hasValidatedEvent && normalizedContext?.type !== 'spatial_attachment') {
    return null;
  }

  return {
    id: id.trim(),
    kind: 'file_write',
    sessionId: sessionId.trim(),
    path: filePath.trim(),
    workspaceRoot: workspaceRoot.trim(),
    workspaceIdentity: normalizedIdentity,
    actor: normalizedActor,
    context: normalizedContext,
    state,
    baseRevision,
    proposedRevision,
    appliedRevision: typeof appliedRevision === 'string' ? appliedRevision : null,
    resultingRevision: typeof resultingRevision === 'string' ? resultingRevision : null,
    preview: normalizedPreview,
    codeTrustEffect: normalizedEffect,
    validation: persistedValidation.value,
    beforeContent: typeof beforeContent === 'string' ? beforeContent : null,
    proposedContent,
    createdAt,
    updatedAt,
    events: normalizedEvents,
  };
}

function appendEvent(record, type, actor, extras = {}) {
  record.events.push({
    type,
    at: record.updatedAt,
    state: record.state,
    actor: actor ? structuredClone(actor) : null,
    ...extras,
  });
}

function restoredRevision(record) {
  if (record.baseRevision === MISSING_FILE_REVISION) {
    return MISSING_FILE_REVISION;
  }
  return textContentRevision(record.beforeContent ?? '');
}

export class OperationStore {
  #operations = new Map();
  #sessionStore;
  #storageFilePath;
  #emitEvent;
  #mutationTail = Promise.resolve();
  #beforePersist;
  #finalizeEffect;

  constructor({
    sessionStore,
    storageFilePath,
    emitEvent,
    beforePersist,
    finalizeEffect,
  } = {}) {
    this.#sessionStore = sessionStore;
    this.#storageFilePath = path.resolve(
      storageFilePath
        || (sessionStore && typeof sessionStore.stateDirectory === 'string'
          ? path.join(sessionStore.stateDirectory, 'operations.json')
          : defaultOperationStorePath()),
    );
    this.#emitEvent = typeof emitEvent === 'function' ? emitEvent : () => {};
    this.#beforePersist = typeof beforePersist === 'function' ? beforePersist : null;
    this.#finalizeEffect = typeof finalizeEffect === 'function' ? finalizeEffect : null;
  }

  async loadOperations() {
    let rawPayload = '';
    try {
      rawPayload = await fs.readFile(this.#storageFilePath, 'utf8');
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
        this.#operations.clear();
        return this.listOperations();
      }
      throw error;
    }

    const parsed = rawPayload.trim() ? JSON.parse(rawPayload) : {};
    const records = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed.operations)
        ? parsed.operations
        : [];
    const restored = new Map();
    for (const record of records) {
      const normalized = normalizePersistedOperation(record);
      if (normalized) {
        restored.set(normalized.id, normalized);
      }
    }
    this.#operations = restored;

    let changed = false;
    for (const record of [...this.#operations.values()]) {
      if (record.state !== 'applying' && record.state !== 'undoing') {
        continue;
      }
      const reconciled = await this.#reconcileRecord(record, { persist: false, emit: false });
      if (reconciled !== record && reconciled.state !== record.state) {
        changed = true;
      }
    }
    if (changed) {
      try {
        await this.#persistOperations();
      } catch {
        // In-memory journal already reflects recovered state; the next successful persist will catch up.
      }
    }
    return this.listOperations();
  }

  listOperations({ sessionId = '', state = 'all' } = {}) {
    const normalizedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    const normalizedState = typeof state === 'string' && state.trim() ? state.trim() : 'all';
    return Array.from(this.#operations.values())
      .filter((record) => {
        if (normalizedSessionId && record.sessionId !== normalizedSessionId) {
          return false;
        }
        if (normalizedState !== 'all' && record.state !== normalizedState) {
          return false;
        }
        return true;
      })
      .sort((left, right) => {
        const updated = right.updatedAt.localeCompare(left.updatedAt);
        return updated !== 0 ? updated : right.id.localeCompare(left.id);
      })
      .map((record) => structuredClone(operationView(record)));
  }

  getOperation(operationId) {
    return structuredClone(operationView(this.#requireOperation(operationId)));
  }

  getOperationDiff(operationId) {
    return structuredClone(operationDiff(this.#requireOperation(operationId)));
  }

  async getSpatialValidationCandidate(operationId) {
    const record = this.#requireOperation(operationId);
    assertSpatialValidationCandidate(record);
    await this.#assertWorkspaceIdentity(record);
    return structuredClone({
      id: record.id,
      sessionId: record.sessionId,
      path: record.path,
      state: record.state,
      baseRevision: record.baseRevision,
      proposedRevision: record.proposedRevision,
      proposedContent: record.proposedContent,
      context: record.context,
      updatedAt: record.updatedAt,
    });
  }

  async recordSpatialValidation(
    operationId,
    { actor, expectedProposedRevision, expectedUpdatedAt, validation } = {},
  ) {
    return this.#serializeMutation(async () => {
      const resolvedActor = normalizeActor(actor);
      const record = this.#requireOperation(operationId);
      assertSpatialValidationCandidate(record);
      await this.#assertWorkspaceIdentity(record);
      if (
        record.proposedRevision !== expectedProposedRevision
        || record.updatedAt !== expectedUpdatedAt
      ) {
        throw createStoreError(409, 'Operation validation snapshot is stale.', {
          code: 'operation_validation_stale',
        });
      }
      if (record.events.filter((event) => event.type === 'validated').length >= VALIDATION_MAX_EVENTS) {
        throw createStoreError(409, 'Operation validation history is full.', {
          code: 'operation_validation_limit_reached',
        });
      }
      const normalizedValidation = normalizeValidationSummary(validation);
      if (normalizedValidation.proposedRevision !== record.proposedRevision) {
        throw createStoreError(
          400,
          'validation.proposedRevision must match the operation proposed revision.',
        );
      }
      const next = structuredClone(record);
      next.validation = normalizedValidation;
      next.updatedAt = nextOperationTimestamp(record.updatedAt);
      appendEvent(next, 'validated', resolvedActor);
      await this.#commit(() => {
        this.#operations.set(record.id, next);
      });
      const view = operationView(next);
      this.#emitEvent('operation.validated', view);
      return structuredClone(view);
    });
  }

  async previewFileWrite({
    sessionId,
    path: relativePath,
    content = '',
    baseRevision,
    actor,
    context = null,
    beforePreview,
  } = {}) {
    return this.#serializeMutation(async () => {
      if (!this.#sessionStore) {
        throw createStoreError(500, 'Operation store is missing a session store.');
      }

      const resolvedSessionId = requireTrimmedString(sessionId, 'sessionId');
      const requestedPath = requireTrimmedString(relativePath, 'path');
      const proposedContent = typeof content === 'string' ? content : '';
      const expectedBase = normalizeRevision(baseRevision, 'baseRevision');
      const resolvedActor = normalizeActor(actor);
      const resolvedContext = normalizeOperationContext(context);
      return this.#sessionStore.runSerializedFileMutation(async () => {
        if (typeof beforePreview === 'function') {
          await beforePreview();
        }
        const workspaceIdentity = await this.#sessionStore.captureWorkspaceIdentity(resolvedSessionId);
        const workspaceRoot = workspaceIdentity.canonicalPath;
        const inspection = await this.#sessionStore.inspectTextFile(resolvedSessionId, requestedPath);

        if (inspection.revision !== expectedBase) {
          throw createStoreError(409, 'File revision conflict.', {
            conflict: revisionConflict({
              path: inspection.path,
              expectedRevision: expectedBase,
              actualRevision: inspection.revision,
            }),
          });
        }

        const timestamp = new Date().toISOString();
        const record = {
        id: `op_${randomUUID()}`,
        kind: 'file_write',
        sessionId: resolvedSessionId,
        path: inspection.path,
        workspaceRoot,
        workspaceIdentity: structuredClone(workspaceIdentity),
        actor: resolvedActor,
        context: resolvedContext,
        state: 'previewed',
        baseRevision: expectedBase,
        proposedRevision: textContentRevision(proposedContent),
        appliedRevision: null,
        resultingRevision: null,
        preview: summarizeLinePreview(inspection.content, proposedContent, {
          created: !inspection.exists,
        }),
        codeTrustEffect: idleCodeTrustEffect(),
        validation: null,
        beforeContent: inspection.exists ? inspection.content : null,
        proposedContent,
        createdAt: timestamp,
        updatedAt: timestamp,
        events: [],
        };
        appendEvent(record, 'previewed', resolvedActor);

        await this.#commit(() => {
          this.#operations.set(record.id, record);
        });
        const view = operationView(record);
        this.#emitEvent('operation.previewed', view);
        return structuredClone(view);
      }, { sessionId: resolvedSessionId });
    });
  }

  async approve(operationId, { actor } = {}) {
    return this.#transition(operationId, {
      allowedStates: PREVIEW_STATES,
      nextState: 'approved',
      eventType: 'approved',
      sseEvent: 'operation.approved',
      actor,
    });
  }

  async reject(operationId, { actor } = {}) {
    return this.#transition(operationId, {
      allowedStates: REJECTABLE_STATES,
      nextState: 'rejected',
      eventType: 'rejected',
      sseEvent: 'operation.rejected',
      actor,
    });
  }

  async apply(operationId, { actor, codeTrust, authorize, validateMutation } = {}) {
    return this.#serializeMutation(async () => {
      const resolvedActor = normalizeActor(actor);
      const incomingTrust = normalizeCodeTrustInput(codeTrust);
      let record = this.#requireOperation(operationId);
      await this.#assertWorkspaceIdentity(record);
      if (typeof authorize === 'function') {
        await authorize(structuredClone(operationView(record)));
      }
      if (record.state === 'applying') {
        record = await this.#reconcileRecord(record);
        if (record.state === 'applied') {
          return structuredClone(operationView(record));
        }
        if (record.state === 'conflicted') {
          throw createStoreError(409, 'File revision conflict.', {
            conflict: record.events.find((event) => event.conflict)?.conflict,
            operation: operationView(record),
          });
        }
      }
      if (record.state !== 'approved') {
        throw createStoreError(
          409,
          `Operation ${record.id} cannot be applied from state ${record.state}.`,
          { code: 'operation_state_conflict', operation: operationView(record) },
        );
      }

      const applying = structuredClone(record);
      applying.state = 'applying';
      applying.updatedAt = nextOperationTimestamp(record.updatedAt);
      applying.codeTrustEffect = incomingTrust?.evaluation
        ? pendingCodeTrustEffect({
          phase: 'apply',
          actor: incomingTrust.actor,
          origin: incomingTrust.origin,
          evaluation: incomingTrust.evaluation,
          timestamp: applying.updatedAt,
        })
        : pendingCodeTrustEffect({
          phase: 'apply',
          timestamp: applying.updatedAt,
        });
      appendEvent(applying, 'applying', resolvedActor);
      await this.#replaceRecord(record, applying);

      let written;
      try {
        written = await this.#sessionStore.compareAndWriteTextFile(
          applying.sessionId,
          applying.path,
          {
            expectedRevision: applying.baseRevision,
            content: applying.proposedContent,
            beforeMutation: async () => {
              if (typeof validateMutation === 'function') {
                await validateMutation({
                  phase: 'apply', sessionId: applying.sessionId, path: applying.path,
                  baseRevision: applying.baseRevision, proposedRevision: applying.proposedRevision,
                  appliedRevision: applying.appliedRevision, content: applying.proposedContent,
                  context: structuredClone(applying.context),
                });
              }
              await this.#persistPriorArtifactSnapshot(applying);
            },
            afterMutation: async () => {
              await this.#finalizePendingEffect(applying, 'apply');
              await this.#persistInFlightEffect(applying);
            },
          },
        );
      } catch (error) {
        if (isRevisionConflictError(error)) {
          return this.#markConflicted(applying, {
            actor: resolvedActor,
            conflict: error.conflict,
          });
        }
        if (isArtifactConflictError(error)) {
          return this.#markConflicted(applying, {
            actor: resolvedActor,
            conflict: artifactConflict(applying, error),
          });
        }
        if (applying.codeTrustEffect?.status === 'failed') {
          applying.updatedAt = nextOperationTimestamp(
            applying.updatedAt,
            applying.codeTrustEffect.updatedAt,
          );
          this.#operations.set(applying.id, applying);
          try {
            await this.#persistOperations();
          } catch {
            // Keep applying + failed effect in memory; restart recovery retries the finalizer.
          }
          throw error;
        }
        if (applying.codeTrustEffect?.status === 'recorded') {
          this.#operations.set(applying.id, applying);
          try {
            await this.#persistOperations();
          } catch {
            // Keep applying + recorded effect in memory for restart recovery.
          }
          throw error;
        }
        await this.#failInFlight(applying, {
          eventType: 'apply_failed',
          restoredState: 'approved',
          actor: resolvedActor,
        });
        throw error;
      }

      const applied = structuredClone(applying);
      applied.state = 'applied';
      applied.appliedRevision = written.revision;
      applied.updatedAt = nextOperationTimestamp(applying.updatedAt);
      appendEvent(applied, 'applied', resolvedActor);
      try {
        await this.#replaceRecord(applying, applied, { rollbackOnFailure: false });
      } catch (error) {
        this.#operations.set(applying.id, applying);
        throw error;
      }
      const view = operationView(applied);
      this.#emitEvent('operation.applied', view);
      return structuredClone(view);
    });
  }

  async undo(operationId, { actor, authorize, validateMutation } = {}) {
    return this.#serializeMutation(async () => {
      const resolvedActor = normalizeActor(actor);
      let record = this.#requireOperation(operationId);
      await this.#assertWorkspaceIdentity(record);
      if (typeof authorize === 'function') {
        await authorize(structuredClone(operationView(record)));
      }
      if (record.state === 'undoing') {
        record = await this.#reconcileRecord(record);
        if (record.state === 'undone') {
          return structuredClone(operationView(record));
        }
        if (record.state === 'conflicted') {
          throw createStoreError(409, 'File revision conflict.', {
            conflict: record.events.find((event) => event.conflict)?.conflict,
            operation: operationView(record),
          });
        }
      }
      if (record.state !== 'applied') {
        throw createStoreError(
          409,
          `Operation ${record.id} cannot be undone from state ${record.state}.`,
          { code: 'operation_state_conflict', operation: operationView(record) },
        );
      }

      const undoing = structuredClone(record);
      undoing.state = 'undoing';
      undoing.updatedAt = nextOperationTimestamp(record.updatedAt);
      const previousEffect = record.codeTrustEffect || idleCodeTrustEffect();
      undoing.codeTrustEffect = previousEffect.status === 'skipped' || previousEffect.status === 'idle'
        ? {
          ...previousEffect,
          status: 'skipped',
          phase: 'undo',
          error: null,
          updatedAt: undoing.updatedAt,
        }
        : pendingCodeTrustEffect({
          phase: 'undo',
          actor: previousEffect.actor,
          origin: previousEffect.origin,
          evaluation: previousEffect.evaluation,
          timestamp: undoing.updatedAt,
        });
      if (Object.prototype.hasOwnProperty.call(previousEffect, 'priorArtifact')) {
        undoing.codeTrustEffect.priorArtifact = previousEffect.priorArtifact
          ? structuredClone(previousEffect.priorArtifact)
          : null;
      }
      if (previousEffect.artifact) {
        undoing.codeTrustEffect.artifact = structuredClone(previousEffect.artifact);
      }
      appendEvent(undoing, 'undoing', resolvedActor);
      await this.#replaceRecord(record, undoing);

      const restoreArtifactAfterMutation = async () => {
        await this.#finalizePendingEffect(undoing, 'undo');
        await this.#persistInFlightEffect(undoing);
      };

      let resultingRevision = MISSING_FILE_REVISION;
      try {
        if (undoing.baseRevision === MISSING_FILE_REVISION) {
          await this.#sessionStore.compareAndRemoveTextFile(undoing.sessionId, undoing.path, {
            expectedRevision: undoing.appliedRevision,
            beforeMutation: async () => {
              if (typeof validateMutation === 'function') {
                await validateMutation({
                  phase: 'undo', sessionId: undoing.sessionId, path: undoing.path,
                  baseRevision: undoing.baseRevision, proposedRevision: undoing.proposedRevision,
                  appliedRevision: undoing.appliedRevision, content: null,
                  context: structuredClone(undoing.context),
                });
              }
              await this.#assertUndoArtifactProvenance(undoing);
            },
            afterMutation: restoreArtifactAfterMutation,
          });
        } else {
          const restored = await this.#sessionStore.compareAndWriteTextFile(
            undoing.sessionId,
            undoing.path,
            {
              expectedRevision: undoing.appliedRevision,
              content: undoing.beforeContent ?? '',
              beforeMutation: async () => {
                if (typeof validateMutation === 'function') {
                  await validateMutation({
                    phase: 'undo', sessionId: undoing.sessionId, path: undoing.path,
                    baseRevision: undoing.baseRevision, proposedRevision: undoing.proposedRevision,
                    appliedRevision: undoing.appliedRevision, content: undoing.beforeContent ?? '',
                    context: structuredClone(undoing.context),
                  });
                }
                await this.#assertUndoArtifactProvenance(undoing);
              },
              afterMutation: restoreArtifactAfterMutation,
            },
          );
          resultingRevision = restored.revision;
        }
      } catch (error) {
        if (isRevisionConflictError(error)) {
          return this.#markConflicted(undoing, {
            actor: resolvedActor,
            conflict: error.conflict,
          });
        }
        if (isArtifactConflictError(error)) {
          return this.#markConflicted(undoing, {
            actor: resolvedActor,
            conflict: artifactConflict(undoing, error),
          });
        }
        if (undoing.codeTrustEffect?.status === 'failed') {
          undoing.updatedAt = nextOperationTimestamp(
            undoing.updatedAt,
            undoing.codeTrustEffect.updatedAt,
          );
          this.#operations.set(undoing.id, undoing);
          try {
            await this.#persistOperations();
          } catch {
            // Keep undoing + failed effect in memory; restart recovery retries the finalizer.
          }
          throw error;
        }
        if (undoing.codeTrustEffect?.status === 'reverted') {
          this.#operations.set(undoing.id, undoing);
          try {
            await this.#persistOperations();
          } catch {
            // Keep undoing + reverted effect in memory for restart recovery.
          }
          throw error;
        }
        await this.#failInFlight(undoing, {
          eventType: 'undo_failed',
          restoredState: 'applied',
          actor: resolvedActor,
        });
        throw error;
      }

      const undone = structuredClone(undoing);
      undone.state = 'undone';
      undone.resultingRevision = resultingRevision;
      undone.updatedAt = nextOperationTimestamp(undoing.updatedAt);
      appendEvent(undone, 'undone', resolvedActor);
      try {
        await this.#replaceRecord(undoing, undone, { rollbackOnFailure: false });
      } catch (error) {
        this.#operations.set(undoing.id, undoing);
        throw error;
      }
      const view = operationView(undone);
      this.#emitEvent('operation.undone', view);
      return structuredClone(view);
    });
  }

  #requireOperation(operationId) {
    const id = typeof operationId === 'string' ? operationId.trim() : '';
    if (!id) {
      throw createStoreError(400, 'operationId is required.');
    }
    const record = this.#operations.get(id);
    if (!record) {
      throw createStoreError(404, `Unknown operation: ${id}`);
    }
    return record;
  }

  async #transition(operationId, {
    allowedStates,
    nextState,
    eventType,
    sseEvent,
    actor,
  }) {
    return this.#serializeMutation(async () => {
      const record = this.#requireOperation(operationId);
      if (!allowedStates.has(record.state)) {
        throw createStoreError(
          409,
          `Operation ${record.id} cannot be ${eventType} from state ${record.state}.`,
          { code: 'operation_state_conflict', operation: operationView(record) },
        );
      }

      const resolvedActor = normalizeActor(actor);
      const timestamp = nextOperationTimestamp(record.updatedAt);
      const next = structuredClone(record);
      next.state = nextState;
      next.updatedAt = timestamp;
      appendEvent(next, eventType, resolvedActor);

      await this.#commit(() => {
        this.#operations.set(record.id, next);
      });
      const view = operationView(next);
      this.#emitEvent(sseEvent, view);
      return structuredClone(view);
    });
  }

  async #markConflicted(record, { actor, conflict }) {
    const resolvedConflict = conflict?.code
      ? structuredClone(conflict)
      : revisionConflict({
        path: record.path,
        expectedRevision: conflict?.expectedRevision,
        actualRevision: conflict?.actualRevision,
        operationId: record.id,
      });
    if (resolvedConflict.code === 'revision_conflict' && !resolvedConflict.operationId && record.id) {
      resolvedConflict.operationId = record.id;
    }
    const timestamp = nextOperationTimestamp(record.updatedAt, record.codeTrustEffect?.updatedAt);
    const next = structuredClone(record);
    next.state = 'conflicted';
    next.updatedAt = timestamp;
    appendEvent(next, 'conflicted', actor, { conflict: resolvedConflict });

    await this.#commit(() => {
      this.#operations.set(record.id, next);
    });
    const view = operationView(next);
    this.#emitEvent('operation.conflicted', view);
    throw createStoreError(
      409,
      resolvedConflict.code === 'code_trust_artifact_conflict'
        ? 'Code-trust artifact conflict.'
        : 'File revision conflict.',
      { conflict: resolvedConflict, operation: view },
    );
  }

  async #replaceRecord(previous, next, { rollbackOnFailure = true } = {}) {
    this.#operations.set(next.id, next);
    try {
      await this.#persistOperations();
    } catch (error) {
      if (rollbackOnFailure) {
        this.#operations.set(previous.id, previous);
      }
      throw error;
    }
  }

  async #assertWorkspaceIdentity(record) {
    if (!this.#sessionStore || typeof this.#sessionStore.assertWorkspaceIdentity !== 'function') {
      return;
    }
    try {
      await this.#sessionStore.assertWorkspaceIdentity(
        record.sessionId,
        record.workspaceRoot,
        record.workspaceIdentity,
      );
    } catch (error) {
      if (error && typeof error === 'object' && error.statusCode) {
        throw error;
      }
      throw createStoreError(409, 'Operation workspace identity does not match the session root.', {
        code: 'workspace_identity_mismatch',
      });
    }
  }

  async #failInFlight(intermediate, { eventType, restoredState, actor }) {
    const next = structuredClone(intermediate);
    next.state = restoredState;
    next.updatedAt = nextOperationTimestamp(intermediate.updatedAt);
    appendEvent(next, eventType, actor);
    try {
      await this.#replaceRecord(intermediate, next, { rollbackOnFailure: false });
    } catch {
      this.#operations.set(intermediate.id, next);
    }
    return next;
  }

  async #persistPriorArtifactSnapshot(record) {
    const effect = record.codeTrustEffect || idleCodeTrustEffect();
    const timestamp = nextOperationTimestamp(record.updatedAt, effect.updatedAt);
    record.codeTrustEffect = {
      ...effect,
      priorArtifact: effect.evaluation
        ? await snapshotCodeTrustArtifact(record.workspaceRoot, record.path)
        : null,
      updatedAt: timestamp,
    };
    record.updatedAt = timestamp;
    this.#operations.set(record.id, record);
    await this.#persistOperations();
  }

  async #persistInFlightEffect(record) {
    record.updatedAt = nextOperationTimestamp(
      record.updatedAt,
      record.codeTrustEffect?.updatedAt,
    );
    this.#operations.set(record.id, record);
    await this.#persistOperations();
  }

  async #assertUndoArtifactProvenance(record) {
    const effect = record.codeTrustEffect || idleCodeTrustEffect();
    if (!effect.evaluation || effect.status === 'skipped' || effect.status === 'idle') {
      return;
    }
    const current = await snapshotCodeTrustArtifact(record.workspaceRoot, record.path);
    const expectedCurrent = effect.artifact || null;
    const prior = Object.prototype.hasOwnProperty.call(effect, 'priorArtifact')
      ? effect.priorArtifact
      : null;
    if (durableArtifactsEqual(current, expectedCurrent) || durableArtifactsEqual(current, prior)) {
      return;
    }
    throw new CodeTrustArtifactConflictError({
      path: record.path,
      message: `Code-trust artifact '${record.path}' changed after this operation and will not be clobbered.`,
    });
  }

  async #finalizePendingEffect(record, phase) {
    const current = record.codeTrustEffect || idleCodeTrustEffect();
    if (effectAlreadyFinalized(current, phase)) {
      return record;
    }

    if (!this.#finalizeEffect || !current.evaluation) {
      record.codeTrustEffect = {
        ...current,
        status: 'skipped',
        phase,
        error: null,
        updatedAt: nextOperationTimestamp(record.updatedAt, current.updatedAt),
      };
      return record;
    }

    try {
      const result = await this.#finalizeEffect(record, { phase });
      if (
        phase === 'apply'
        && result?.artifact
        && typeof result.artifact.contentHash === 'string'
      ) {
        const expectedHash = expectedArtifactContentHash(record, phase);
        if (result.artifact.contentHash !== expectedHash) {
          throw createStoreError(409, 'Code-trust artifact hash does not match the operation result.', {
            conflict: {
              code: 'code_trust_artifact_hash_mismatch',
              path: record.path,
              expectedHash,
              actualHash: result.artifact.contentHash,
            },
          });
        }
      }
      const status = result?.status
        || (phase === 'undo' ? 'reverted' : (result?.artifact ? 'recorded' : 'skipped'));
      record.codeTrustEffect = {
        ...current,
        status,
        phase,
        artifact: result?.artifact ? structuredClone(result.artifact) : (phase === 'undo' ? null : current.artifact),
        error: null,
        updatedAt: nextOperationTimestamp(record.updatedAt, current.updatedAt),
      };
      return record;
    } catch (error) {
      record.codeTrustEffect = {
        ...current,
        status: 'failed',
        phase,
        error: error instanceof Error ? error.message : String(error),
        updatedAt: nextOperationTimestamp(record.updatedAt, current.updatedAt),
      };
      throw error;
    }
  }

  async #reconcileRecord(record, { persist = true, emit = true, fileMutationLocked = false } = {}) {
    if (record.state !== 'applying' && record.state !== 'undoing') {
      return record;
    }
    if (!this.#sessionStore) {
      return record;
    }
    if (
      !fileMutationLocked
      && typeof this.#sessionStore.runSerializedFileMutation === 'function'
    ) {
      return this.#sessionStore.runSerializedFileMutation(
        () => this.#reconcileRecord(record, { persist, emit, fileMutationLocked: true }),
        { sessionId: record.sessionId },
      );
    }

    try {
      await this.#assertWorkspaceIdentity(record);
    } catch {
      return record;
    }

    let inspection;
    try {
      inspection = await this.#sessionStore.inspectTextFile(record.sessionId, record.path);
    } catch {
      return record;
    }

    const next = structuredClone(record);
    const transitionTimestamp = () => nextOperationTimestamp(
      record.updatedAt,
      next.updatedAt,
      next.codeTrustEffect?.updatedAt,
    );
    const recoveryActor = lastEventActor(
      record,
      record.state === 'applying' ? 'applying' : 'undoing',
    );
    let sseEvent = '';

    if (record.state === 'applying') {
      if (inspection.revision === record.proposedRevision) {
        let finalizeCompleted = true;
        try {
          await this.#finalizePendingEffect(next, 'apply');
        } catch (error) {
          if (isArtifactConflictError(error)) {
            const conflict = artifactConflict(record, error);
            next.state = 'conflicted';
            next.updatedAt = transitionTimestamp();
            appendEvent(next, 'conflicted', recoveryActor, { conflict });
            sseEvent = 'operation.conflicted';
            finalizeCompleted = false;
          } else {
            next.updatedAt = transitionTimestamp();
            this.#operations.set(record.id, next);
            if (persist) {
              try {
                await this.#persistOperations();
              } catch {
                // Keep applying + failed effect; a later recovery pass can retry.
              }
            }
            return next;
          }
        }
        if (finalizeCompleted) {
          next.state = 'applied';
          next.appliedRevision = record.proposedRevision;
          next.updatedAt = transitionTimestamp();
          appendEvent(next, 'applied', recoveryActor);
          sseEvent = 'operation.applied';
        }
      } else if (inspection.revision === record.baseRevision) {
        next.state = 'approved';
        next.updatedAt = transitionTimestamp();
        appendEvent(next, 'recovered', recoveryActor);
      } else {
        const conflict = revisionConflict({
          path: record.path,
          expectedRevision: record.baseRevision,
          actualRevision: inspection.revision,
          operationId: record.id,
        });
        next.state = 'conflicted';
        next.updatedAt = transitionTimestamp();
        appendEvent(next, 'conflicted', recoveryActor, { conflict });
        sseEvent = 'operation.conflicted';
      }
    } else {
      const expectedRestored = restoredRevision(record);
      if (inspection.revision === expectedRestored) {
        let finalizeCompleted = true;
        try {
          await this.#finalizePendingEffect(next, 'undo');
        } catch (error) {
          if (isArtifactConflictError(error)) {
            const conflict = artifactConflict(record, error);
            next.state = 'conflicted';
            next.updatedAt = transitionTimestamp();
            appendEvent(next, 'conflicted', recoveryActor, { conflict });
            sseEvent = 'operation.conflicted';
            finalizeCompleted = false;
          } else {
            next.updatedAt = transitionTimestamp();
            this.#operations.set(record.id, next);
            if (persist) {
              try {
                await this.#persistOperations();
              } catch {
                // Keep undoing + failed effect; a later recovery pass can retry.
              }
            }
            return next;
          }
        }
        if (finalizeCompleted) {
          next.state = 'undone';
          next.resultingRevision = expectedRestored;
          next.updatedAt = transitionTimestamp();
          appendEvent(next, 'undone', recoveryActor);
          sseEvent = 'operation.undone';
        }
      } else if (inspection.revision === record.appliedRevision) {
        next.state = 'applied';
        next.updatedAt = transitionTimestamp();
        appendEvent(next, 'recovered', recoveryActor);
      } else {
        const conflict = revisionConflict({
          path: record.path,
          expectedRevision: record.appliedRevision,
          actualRevision: inspection.revision,
          operationId: record.id,
        });
        next.state = 'conflicted';
        next.updatedAt = transitionTimestamp();
        appendEvent(next, 'conflicted', recoveryActor, { conflict });
        sseEvent = 'operation.conflicted';
      }
    }

    this.#operations.set(record.id, next);
    if (persist) {
      try {
        await this.#persistOperations();
      } catch {
        // Keep the recovered in-memory state; restart can persist it later.
      }
    }
    if (emit && sseEvent) {
      this.#emitEvent(sseEvent, operationView(next));
    }
    return next;
  }

  #serializeMutation(operation) {
    const result = this.#mutationTail.then(operation, operation);
    this.#mutationTail = result.catch(() => {});
    return result;
  }

  async #commit(applyMutation) {
    const previous = new Map(
      Array.from(this.#operations.entries()).map(([id, record]) => [id, structuredClone(record)]),
    );
    applyMutation();
    try {
      await this.#persistOperations();
    } catch (error) {
      this.#operations = previous;
      throw error;
    }
  }

  async #persistOperations() {
    const payload = {
      version: operationStoreVersion,
      operations: Array.from(this.#operations.values()).map((record) => persistableRecord(record)),
    };
    if (this.#beforePersist) {
      await this.#beforePersist(payload);
    }
    const serialized = JSON.stringify(payload, null, 2) + '\n';
    await fs.mkdir(path.dirname(this.#storageFilePath), { recursive: true });
    const tempPath = `${this.#storageFilePath}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(tempPath, serialized, 'utf8');
    await fs.rename(tempPath, this.#storageFilePath);
  }
}
