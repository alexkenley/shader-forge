export type SpatialVector3 = [number, number, number];

export type SpatialAttachmentDraft = {
  id: string;
  skeleton: string;
  itemPrefab: string;
  perspective: string;
  socket: string;
  translation: SpatialVector3;
  rotationDegrees: SpatialVector3;
};

export type SpatialMotionEnvelopePhase = {
  phase: string;
  clip: string;
  normalizedTimes: number[];
};

export type SpatialOperationReconciliation = {
  refreshAuthored: boolean;
  clearCandidate: boolean;
  clearOperation: boolean;
  closeConnection: boolean;
};

export function spatialOperationReconciliation(state: string): SpatialOperationReconciliation {
  if (state === 'conflicted') {
    return { refreshAuthored: true, clearCandidate: false, clearOperation: false, closeConnection: false };
  }
  if (state === 'rejected') {
    return { refreshAuthored: true, clearCandidate: true, clearOperation: true, closeConnection: true };
  }
  if (state === 'applied') {
    return { refreshAuthored: true, clearCandidate: true, clearOperation: false, closeConnection: true };
  }
  if (state === 'undone') {
    return { refreshAuthored: true, clearCandidate: true, clearOperation: true, closeConnection: true };
  }
  return { refreshAuthored: false, clearCandidate: false, clearOperation: false, closeConnection: false };
}

export function sameSpatialConnection<T extends object>(current: T | null, expected: T | null) {
  return expected !== null && current === expected;
}

export function shouldCloseSpatialConnection<T extends object>(
  current: T | null,
  expected: T | null,
  expectedWasCaptured: boolean,
) {
  return !expectedWasCaptured || current === expected;
}

export function spatialActionStillCurrent(
  currentGeneration: number,
  expectedGeneration: number,
  currentSelection: string,
  expectedSelection: string,
) {
  return currentGeneration === expectedGeneration && currentSelection === expectedSelection;
}

export function spatialLeaseCoversAttachment(resources: readonly string[], attachmentId: string) {
  return resources.includes(`spatial/attachment/${attachmentId.toLowerCase()}`);
}

type SourceLine = {
  text: string;
  start: number;
  end: number;
  section: string;
};

type ArrayField = {
  line: SourceLine;
  prefix: string;
  suffix: string;
  values: number[];
};

function sourceLines(source: string) {
  const lines: SourceLine[] = [];
  let offset = 0;
  let section = '';
  for (const match of source.matchAll(/.*?(?:\r\n|\n|\r|$)/g)) {
    const raw = match[0];
    if (!raw) continue;
    const text = raw.replace(/(?:\r\n|\n|\r)$/, '');
    const header = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/.exec(text);
    if (header) section = header[1].trim();
    lines.push({ text, start: offset, end: offset + text.length, section });
    offset += raw.length;
  }
  return lines;
}

function requireOne<T>(values: T[], label: string) {
  if (values.length !== 1) {
    throw new Error(`Attachment source must contain exactly one supported ${label}.`);
  }
  return values[0];
}

function stringField(lines: SourceLine[], section: string, key: string) {
  const candidates = lines.filter((line) => line.section === section && new RegExp(`^\\s*${key}\\s*=`).test(line.text));
  const line = requireOne(candidates, section ? `[${section}] ${key}` : key);
  const match = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]+)"\\s*(?:#.*)?$`).exec(line.text);
  if (!match) throw new Error(`Attachment ${key} uses an unsupported layout.`);
  return match[1];
}

function arrayField(lines: SourceLine[], section: string, key: string, length: number) {
  const candidates = lines.filter((line) => line.section === section && new RegExp(`^\\s*${key}\\s*=`).test(line.text));
  const line = requireOne(candidates, `[${section}] ${key}`);
  const match = new RegExp(`^(\\s*${key}\\s*=\\s*)\\[([^\\]]*)\\](\\s*(?:#.*)?)$`).exec(line.text);
  if (!match) throw new Error(`Attachment [${section}] ${key} uses an unsupported layout.`);
  const values = match[2].split(',').map((value) => Number(value.trim()));
  if (values.length !== length || values.some((value) => !Number.isFinite(value))) {
    throw new Error(`Attachment [${section}] ${key} must be a finite ${length}-value array.`);
  }
  return { line, prefix: match[1], suffix: match[3], values } satisfies ArrayField;
}

function numberArrayValues(lines: SourceLine[], section: string, key: string) {
  const candidates = lines.filter((line) => line.section === section && new RegExp(`^\\s*${key}\\s*=`).test(line.text));
  const line = requireOne(candidates, `[${section}] ${key}`);
  const match = new RegExp(`^\\s*${key}\\s*=\\s*\\[([^\\]]*)\\]\\s*(?:#.*)?$`).exec(line.text);
  if (!match) throw new Error(`Attachment [${section}] ${key} uses an unsupported layout.`);
  const inner = match[1].trim();
  if (!inner) throw new Error(`Attachment [${section}] ${key} must be a finite unique array.`);
  const tokens = inner.split(',').map((value) => value.trim());
  if (tokens.some((value) => !value || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value))) {
    throw new Error(`Attachment [${section}] ${key} must be a finite unique array.`);
  }
  const values = tokens.map(Number);
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error(`Attachment [${section}] ${key} must be a finite unique array.`);
  }
  return values;
}

function quaternionToDegrees(values: number[]): SpatialVector3 {
  let [x, y, z, w] = values;
  const length = Math.hypot(x, y, z, w);
  if (!Number.isFinite(length) || length === 0) throw new Error('Attachment rotation quaternion is invalid.');
  [x, y, z, w] = [x / length, y / length, z / length, w / length];
  const roll = Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y));
  const pitchTerm = Math.max(-1, Math.min(1, 2 * (w * y - z * x)));
  const pitch = Math.asin(pitchTerm);
  const yaw = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  const scale = 180 / Math.PI;
  return [roll * scale, pitch * scale, yaw * scale];
}

function degreesToQuaternion([rollDegrees, pitchDegrees, yawDegrees]: SpatialVector3) {
  const scale = Math.PI / 360;
  const [roll, pitch, yaw] = [rollDegrees * scale, pitchDegrees * scale, yawDegrees * scale];
  const [cr, sr] = [Math.cos(roll), Math.sin(roll)];
  const [cp, sp] = [Math.cos(pitch), Math.sin(pitch)];
  const [cy, sy] = [Math.cos(yaw), Math.sin(yaw)];
  let values = [
    sr * cp * cy - cr * sp * sy,
    cr * sp * cy + sr * cp * sy,
    cr * cp * sy - sr * sp * cy,
    cr * cp * cy + sr * sp * sy,
  ];
  if (values[3] < 0) values = values.map((value) => -value);
  return values;
}

function formatNumber(value: number) {
  if (!Number.isFinite(value)) throw new Error('Attachment transform values must be finite.');
  const rounded = Math.abs(value) < 0.0000005 ? 0 : Number(value.toFixed(6));
  return String(rounded);
}

export function parseSpatialAttachment(source: string): SpatialAttachmentDraft {
  const lines = sourceLines(source);
  requireOne(lines.filter((line) => /^\s*\[primary_grip\]\s*(?:#.*)?$/.test(line.text)), '[primary_grip] section');
  const translation = arrayField(lines, 'primary_grip', 'translation', 3);
  const rotation = arrayField(lines, 'primary_grip', 'rotation', 4);
  return {
    id: stringField(lines, '', 'id'),
    skeleton: stringField(lines, '', 'skeleton'),
    itemPrefab: stringField(lines, '', 'item_prefab'),
    perspective: stringField(lines, '', 'perspective'),
    socket: stringField(lines, 'primary_grip', 'socket'),
    translation: translation.values as SpatialVector3,
    rotationDegrees: quaternionToDegrees(rotation.values),
  };
}

export function parseSpatialAttachmentMotionEnvelope(source: string): SpatialMotionEnvelopePhase[] {
  const lines = sourceLines(source);
  const headerPhases: string[] = [];
  for (const line of lines) {
    const header = /^\s*\[motion_envelope\.([^\]]*)\]\s*(?:#.*)?$/.exec(line.text);
    if (!header) continue;
    const phase = header[1];
    if (!phase || phase !== phase.trim()) {
      throw new Error('Attachment motion envelope phase must be a unique non-empty name.');
    }
    headerPhases.push(phase);
  }
  if (new Set(headerPhases).size !== headerPhases.length) {
    throw new Error('Attachment motion envelope phases must be unique.');
  }

  const envelope: SpatialMotionEnvelopePhase[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (!line.section.startsWith('motion_envelope.') || seen.has(line.section)) continue;
    seen.add(line.section);
    const phase = line.section.slice('motion_envelope.'.length);
    if (!phase || phase !== phase.trim()) {
      throw new Error('Attachment motion envelope phase must be a unique non-empty name.');
    }
    const clip = stringField(lines, line.section, 'clip');
    if (!clip) throw new Error(`Attachment [${line.section}] clip uses an unsupported layout.`);
    const normalizedTimes = numberArrayValues(lines, line.section, 'normalized_times');
    if (
      normalizedTimes.length === 0
      || normalizedTimes.some((value) => value < 0 || value > 1 || Object.is(value, -0))
      || new Set(normalizedTimes).size !== normalizedTimes.length
    ) {
      throw new Error(`Attachment [${line.section}] normalized_times must be finite unique values in [0,1].`);
    }
    envelope.push({ phase, clip, normalizedTimes });
  }
  return envelope;
}

export function spatialSourceRevisionsCoverAttachment(
  sourceRevisions: unknown,
  attachmentPath: string,
  revision: string,
): sourceRevisions is Array<{ path: string; revision: string }> {
  if (!Array.isArray(sourceRevisions) || sourceRevisions.length === 0 || sourceRevisions.length > 4096) return false;
  if (
    typeof attachmentPath !== 'string'
    || !attachmentPath
    || attachmentPath.length > 2048
    || attachmentPath.startsWith('/')
    || /^[A-Za-z]:/.test(attachmentPath)
    || attachmentPath.includes('\\')
    || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(attachmentPath)
    || attachmentPath.split('/').some((segment) => !segment || segment === '.' || segment === '..')
    || typeof revision !== 'string'
    || !/^sha256:[a-f0-9]{64}$/.test(revision)
  ) {
    return false;
  }
  let previousPath = '';
  let totalTextLength = 0;
  let covers = false;
  for (const entry of sourceRevisions) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const record = entry as Record<string, unknown>;
    const keys = Object.keys(record);
    if (
      keys.length !== 2
      || !keys.includes('path')
      || !keys.includes('revision')
      || typeof record.path !== 'string'
      || !record.path
      || record.path.length > 2048
      || typeof record.revision !== 'string'
      || !/^sha256:[a-f0-9]{64}$/.test(record.revision)
      || record.path.startsWith('/')
      || /^[A-Za-z]:/.test(record.path)
      || record.path.includes('\\')
      || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(record.path)
      || record.path.split('/').some((segment) => !segment || segment === '.' || segment === '..')
    ) {
      return false;
    }
    totalTextLength += record.path.length + record.revision.length;
    if (totalTextLength > 65536) return false;
    if (previousPath && record.path <= previousPath) return false;
    previousPath = record.path;
    if (record.path === attachmentPath && record.revision === revision) covers = true;
  }
  return covers;
}

export type SpatialReviewPacket = {
  schema: 'shader_forge.spatial_review_packet';
  schemaVersion: 1;
  immutable: true;
  reviewId: string;
  operationId: string;
  selection: { attachmentId: string };
  sourceRevisions: { inputs: unknown[] };
  samples: Array<{
    posePhase: string;
    normalizedTime: number;
    clip: string;
    captures: { clean: Record<string, string> };
  }>;
};

const reviewIdPattern = /^rev_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const reviewResourceIdPattern = /^[a-z0-9][a-z0-9._-]*$/;
const closeReviewCameras = ['close_front', 'close_side', 'close_top', 'close_three_quarter'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function safeReviewCapturePath(value: unknown) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 512
    && value.endsWith('.png')
    && !value.startsWith('/')
    && !value.includes('\\')
    && !/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value)
    && value.split('/').every((part) => part && part !== '.' && part !== '..');
}

export function parseSpatialReviewPacket(value: unknown): SpatialReviewPacket {
  if (
    !isRecord(value)
    || value.schema !== 'shader_forge.spatial_review_packet'
    || value.schemaVersion !== 1
    || value.immutable !== true
    || typeof value.reviewId !== 'string'
    || !reviewIdPattern.test(value.reviewId)
    || typeof value.operationId !== 'string'
    || !value.operationId
    || value.operationId.length > 128
    || !isRecord(value.selection)
    || typeof value.selection.attachmentId !== 'string'
    || !value.selection.attachmentId
    || !isRecord(value.sourceRevisions)
    || !Array.isArray(value.sourceRevisions.inputs)
    || value.sourceRevisions.inputs.length === 0
    || value.sourceRevisions.inputs.length > 4096
    || !Array.isArray(value.samples)
    || value.samples.length === 0
    || value.samples.length > 64
  ) {
    throw new Error('Spatial review packet is malformed or exceeds shell limits.');
  }
  const sampleKeys = new Set<string>();
  for (const sample of value.samples) {
    const captures = isRecord(sample) ? sample.captures : null;
    const clean = isRecord(captures) ? captures.clean : null;
    if (
      !isRecord(sample)
      || typeof sample.posePhase !== 'string'
      || !reviewResourceIdPattern.test(sample.posePhase)
      || typeof sample.clip !== 'string'
      || !reviewResourceIdPattern.test(sample.clip)
      || typeof sample.normalizedTime !== 'number'
      || !Number.isFinite(sample.normalizedTime)
      || Object.is(sample.normalizedTime, -0)
      || sample.normalizedTime < 0
      || sample.normalizedTime > 1
      || !isRecord(clean)
    ) {
      throw new Error('Spatial review packet contains an invalid sample.');
    }
    const sampleKey = `${sample.posePhase}\n${sample.normalizedTime}`;
    if (sampleKeys.has(sampleKey)) throw new Error('Spatial review packet contains duplicate samples.');
    sampleKeys.add(sampleKey);
    const cameraIds = Object.keys(clean);
    if (
      cameraIds.length < closeReviewCameras.length
      || cameraIds.length > closeReviewCameras.length + 1
      || closeReviewCameras.some((cameraId) => !cameraIds.includes(cameraId))
      || cameraIds.some((cameraId) => ![...closeReviewCameras, 'player_camera'].includes(cameraId))
      || cameraIds.some((cameraId) => !safeReviewCapturePath(clean[cameraId]))
    ) {
      throw new Error('Spatial review packet contains an invalid clean capture set.');
    }
  }
  return value as SpatialReviewPacket;
}

export function updateSpatialAttachmentTransform(
  source: string,
  translation: SpatialVector3,
  rotationDegrees: SpatialVector3,
) {
  const lines = sourceLines(source);
  requireOne(lines.filter((line) => /^\s*\[primary_grip\]\s*(?:#.*)?$/.test(line.text)), '[primary_grip] section');
  const translationField = arrayField(lines, 'primary_grip', 'translation', 3);
  const rotationField = arrayField(lines, 'primary_grip', 'rotation', 4);
  const replacements = [
    {
      ...translationField.line,
      value: `${translationField.prefix}[${translation.map(formatNumber).join(', ')}]${translationField.suffix}`,
    },
    {
      ...rotationField.line,
      value: `${rotationField.prefix}[${degreesToQuaternion(rotationDegrees).map(formatNumber).join(', ')}]${rotationField.suffix}`,
    },
  ].sort((left, right) => right.start - left.start);
  let candidate = source;
  for (const replacement of replacements) {
    candidate = `${candidate.slice(0, replacement.start)}${replacement.value}${candidate.slice(replacement.end)}`;
  }
  parseSpatialAttachment(candidate);
  return candidate;
}
