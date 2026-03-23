export type SceneAssetDocument = {
  path: string;
  schema: string;
  schemaVersion: number;
  name: string;
  ownerSystem: string;
  runtimeFormat: string;
  title: string;
  primaryPrefab: string;
  modifiedAt: string;
  content: string;
};

export type PrefabAssetDocument = {
  path: string;
  schema: string;
  schemaVersion: number;
  name: string;
  ownerSystem: string;
  runtimeFormat: string;
  category: string;
  spawnTag: string;
  modifiedAt: string;
  content: string;
};

type ParsedFieldValue = number | string;

function parseTomlString(rawValue: string) {
  const trimmed = rawValue.trim();
  if (!trimmed.length) {
    return '';
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  if (/^-?\d+$/.test(trimmed)) {
    return Number.parseInt(trimmed, 10);
  }
  return trimmed;
}

function parseTopLevelFields(content: string) {
  const fields = new Map<string, ParsedFieldValue>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith('[')) {
      continue;
    }
    const match = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!match) {
      continue;
    }
    fields.set(match[1], parseTomlString(match[2]));
  }
  return fields;
}

function quoteTomlString(value: string) {
  return JSON.stringify(value);
}

function basenameWithoutSuffix(filePath: string, suffix: string) {
  const normalized = filePath.split('/').filter(Boolean).pop() || filePath;
  return normalized.endsWith(suffix) ? normalized.slice(0, -suffix.length) : normalized;
}

function readStringField(fields: Map<string, ParsedFieldValue>, key: string, fallback = '') {
  const value = fields.get(key);
  return typeof value === 'string' ? value : fallback;
}

function readNumberField(fields: Map<string, ParsedFieldValue>, key: string, fallback = 1) {
  const value = fields.get(key);
  return typeof value === 'number' ? value : fallback;
}

export function sanitizeAssetName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function buildSceneAssetPath(sceneName: string) {
  return `content/scenes/${sanitizeAssetName(sceneName)}.scene.toml`;
}

export function parseSceneAssetDocument(payload: {
  path: string;
  content: string;
  modifiedAt: string;
}): SceneAssetDocument {
  const fields = parseTopLevelFields(payload.content);
  return {
    path: payload.path,
    schema: readStringField(fields, 'schema', 'shader_forge.scene'),
    schemaVersion: readNumberField(fields, 'schema_version', 1),
    name: readStringField(fields, 'name', basenameWithoutSuffix(payload.path, '.scene.toml')),
    ownerSystem: readStringField(fields, 'owner_system', 'scene_system'),
    runtimeFormat: readStringField(fields, 'runtime_format', 'flatbuffer'),
    title: readStringField(fields, 'title', basenameWithoutSuffix(payload.path, '.scene.toml')),
    primaryPrefab: readStringField(fields, 'primary_prefab', ''),
    modifiedAt: payload.modifiedAt,
    content: payload.content,
  };
}

export function parsePrefabAssetDocument(payload: {
  path: string;
  content: string;
  modifiedAt: string;
}): PrefabAssetDocument {
  const fields = parseTopLevelFields(payload.content);
  return {
    path: payload.path,
    schema: readStringField(fields, 'schema', 'shader_forge.prefab'),
    schemaVersion: readNumberField(fields, 'schema_version', 1),
    name: readStringField(fields, 'name', basenameWithoutSuffix(payload.path, '.prefab.toml')),
    ownerSystem: readStringField(fields, 'owner_system', 'scene_system'),
    runtimeFormat: readStringField(fields, 'runtime_format', 'flatbuffer'),
    category: readStringField(fields, 'category', 'gameplay'),
    spawnTag: readStringField(fields, 'spawn_tag', ''),
    modifiedAt: payload.modifiedAt,
    content: payload.content,
  };
}

export function formatSceneAssetDocument(document: Pick<
  SceneAssetDocument,
  'schema' | 'schemaVersion' | 'name' | 'ownerSystem' | 'runtimeFormat' | 'title' | 'primaryPrefab'
>) {
  return [
    `schema = ${quoteTomlString(document.schema)}`,
    `schema_version = ${document.schemaVersion}`,
    `name = ${quoteTomlString(document.name)}`,
    `owner_system = ${quoteTomlString(document.ownerSystem)}`,
    `runtime_format = ${quoteTomlString(document.runtimeFormat)}`,
    '',
    `title = ${quoteTomlString(document.title)}`,
    `primary_prefab = ${quoteTomlString(document.primaryPrefab)}`,
    '',
  ].join('\n');
}

export function formatPrefabAssetDocument(document: Pick<
  PrefabAssetDocument,
  'schema' | 'schemaVersion' | 'name' | 'ownerSystem' | 'runtimeFormat' | 'category' | 'spawnTag'
>) {
  return [
    `schema = ${quoteTomlString(document.schema)}`,
    `schema_version = ${document.schemaVersion}`,
    `name = ${quoteTomlString(document.name)}`,
    `owner_system = ${quoteTomlString(document.ownerSystem)}`,
    `runtime_format = ${quoteTomlString(document.runtimeFormat)}`,
    '',
    `category = ${quoteTomlString(document.category)}`,
    `spawn_tag = ${quoteTomlString(document.spawnTag)}`,
    '',
  ].join('\n');
}

export function createSceneAssetDocument(sceneName: string, primaryPrefab: string): SceneAssetDocument {
  const sanitizedName = sanitizeAssetName(sceneName);
  const title = sceneName.trim() || sanitizedName || 'new_scene';
  return {
    path: buildSceneAssetPath(sanitizedName || 'new_scene'),
    schema: 'shader_forge.scene',
    schemaVersion: 1,
    name: sanitizedName || 'new_scene',
    ownerSystem: 'scene_system',
    runtimeFormat: 'flatbuffer',
    title,
    primaryPrefab,
    modifiedAt: '',
    content: '',
  };
}

export function cloneSceneForDuplicate(source: SceneAssetDocument, nextName: string): SceneAssetDocument {
  const sanitizedName = sanitizeAssetName(nextName) || `${source.name}_copy`;
  return {
    ...source,
    path: buildSceneAssetPath(sanitizedName),
    name: sanitizedName,
    title: nextName.trim() || `${source.title} Copy`,
    modifiedAt: '',
    content: '',
  };
}
