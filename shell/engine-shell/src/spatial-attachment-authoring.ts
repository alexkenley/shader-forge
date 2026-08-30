export type SpatialVector3 = [number, number, number];

export type SpatialAttachmentDraft = {
  id: string;
  skeleton: string;
  itemPrefab: string;
  socket: string;
  translation: SpatialVector3;
  rotationDegrees: SpatialVector3;
};

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
    socket: stringField(lines, 'primary_grip', 'socket'),
    translation: translation.values as SpatialVector3,
    rotationDegrees: quaternionToDegrees(rotation.values),
  };
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
