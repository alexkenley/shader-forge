export type Vector3Value = [number, number, number];

export type SceneEntityDocument = {
  id: string;
  displayName: string;
  sourcePrefab: string;
  parent: string;
  position: Vector3Value;
  rotation: Vector3Value;
  scale: Vector3Value;
};

export type SceneAssetDocument = {
  path: string;
  schema: string;
  schemaVersion: number;
  name: string;
  ownerSystem: string;
  runtimeFormat: string;
  title: string;
  primaryPrefab: string;
  entities: SceneEntityDocument[];
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
  renderComponent: PrefabRenderComponentDocument;
  effectComponent: PrefabEffectComponentDocument;
  modifiedAt: string;
  content: string;
};

export type PrefabRenderComponentDocument = {
  procgeo: string;
  materialHint: string;
};

export type PrefabEffectComponentDocument = {
  effect: string;
  trigger: string;
};

type ParsedFieldValue = number | string;
type ParsedSection = {
  name: string;
  fields: Map<string, ParsedFieldValue>;
};

const defaultPosition: Vector3Value = [0, 0, 0];
const defaultScale: Vector3Value = [1, 1, 1];

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

function parseStructuredTomlDocument(content: string) {
  const fields = new Map<string, ParsedFieldValue>();
  const sections: ParsedSection[] = [];
  let currentSection: ParsedSection | null = null;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const sectionMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (sectionMatch) {
      currentSection = {
        name: sectionMatch[1],
        fields: new Map<string, ParsedFieldValue>(),
      };
      sections.push(currentSection);
      continue;
    }

    const pairMatch = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!pairMatch) {
      continue;
    }

    const target = currentSection ? currentSection.fields : fields;
    target.set(pairMatch[1], parseTomlString(pairMatch[2]));
  }

  return { fields, sections };
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

function parseVector3Value(value: string, fallback: Vector3Value): Vector3Value {
  const parts = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number.parseFloat(item));
  if (parts.length !== 3 || parts.some((item) => !Number.isFinite(item))) {
    return [...fallback] as Vector3Value;
  }
  return [parts[0], parts[1], parts[2]];
}

function formatScalarNumber(value: number) {
  if (!Number.isFinite(value)) {
    return '0';
  }
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function formatVector3Value(value: Vector3Value) {
  return quoteTomlString(value.map((item) => formatScalarNumber(item)).join(', '));
}

function cloneVector3Value(value: Vector3Value): Vector3Value {
  return [value[0], value[1], value[2]];
}

function cloneSceneEntity(entity: SceneEntityDocument): SceneEntityDocument {
  return {
    ...entity,
    position: cloneVector3Value(entity.position),
    rotation: cloneVector3Value(entity.rotation),
    scale: cloneVector3Value(entity.scale),
  };
}

export function sanitizeAssetName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function sanitizeSceneEntityId(value: string) {
  return sanitizeAssetName(value);
}

export function buildSceneAssetPath(sceneName: string) {
  return `content/scenes/${sanitizeAssetName(sceneName)}.scene.toml`;
}

function hasPrefabRenderComponent(document: PrefabRenderComponentDocument) {
  return Boolean(document.procgeo || document.materialHint);
}

function hasPrefabEffectComponent(document: PrefabEffectComponentDocument) {
  return Boolean(document.effect || document.trigger);
}

function parseSceneEntitySections(sections: ParsedSection[]) {
  return sections
    .filter((section) => section.name.startsWith('entity.'))
    .map((section) => {
      const id = sanitizeSceneEntityId(section.name.slice('entity.'.length));
      return {
        id,
        displayName: readStringField(section.fields, 'display_name', id),
        sourcePrefab: sanitizeAssetName(readStringField(section.fields, 'source_prefab', '')),
        parent: sanitizeSceneEntityId(readStringField(section.fields, 'parent', '')),
        position: parseVector3Value(
          readStringField(section.fields, 'position', '0, 0, 0'),
          defaultPosition,
        ),
        rotation: parseVector3Value(
          readStringField(section.fields, 'rotation', '0, 0, 0'),
          defaultPosition,
        ),
        scale: parseVector3Value(
          readStringField(section.fields, 'scale', '1, 1, 1'),
          defaultScale,
        ),
      } satisfies SceneEntityDocument;
    });
}

export function parseSceneAssetDocument(payload: {
  path: string;
  content: string;
  modifiedAt: string;
}): SceneAssetDocument {
  const document = parseStructuredTomlDocument(payload.content);
  return {
    path: payload.path,
    schema: readStringField(document.fields, 'schema', 'shader_forge.scene'),
    schemaVersion: readNumberField(document.fields, 'schema_version', 1),
    name: readStringField(document.fields, 'name', basenameWithoutSuffix(payload.path, '.scene.toml')),
    ownerSystem: readStringField(document.fields, 'owner_system', 'scene_system'),
    runtimeFormat: readStringField(document.fields, 'runtime_format', 'flatbuffer'),
    title: readStringField(document.fields, 'title', basenameWithoutSuffix(payload.path, '.scene.toml')),
    primaryPrefab: readStringField(document.fields, 'primary_prefab', ''),
    entities: parseSceneEntitySections(document.sections),
    modifiedAt: payload.modifiedAt,
    content: payload.content,
  };
}

export function parsePrefabAssetDocument(payload: {
  path: string;
  content: string;
  modifiedAt: string;
}): PrefabAssetDocument {
  const document = parseStructuredTomlDocument(payload.content);
  const renderSection = document.sections.find((section) => section.name === 'component.render');
  const effectSection = document.sections.find((section) => section.name === 'component.effect');
  return {
    path: payload.path,
    schema: readStringField(document.fields, 'schema', 'shader_forge.prefab'),
    schemaVersion: readNumberField(document.fields, 'schema_version', 1),
    name: readStringField(document.fields, 'name', basenameWithoutSuffix(payload.path, '.prefab.toml')),
    ownerSystem: readStringField(document.fields, 'owner_system', 'scene_system'),
    runtimeFormat: readStringField(document.fields, 'runtime_format', 'flatbuffer'),
    category: readStringField(document.fields, 'category', 'gameplay'),
    spawnTag: readStringField(document.fields, 'spawn_tag', ''),
    renderComponent: {
      procgeo: sanitizeAssetName(readStringField(renderSection?.fields ?? new Map(), 'procgeo', '')),
      materialHint: sanitizeAssetName(readStringField(renderSection?.fields ?? new Map(), 'material_hint', '')),
    },
    effectComponent: {
      effect: sanitizeAssetName(readStringField(effectSection?.fields ?? new Map(), 'effect', '')),
      trigger: sanitizeAssetName(readStringField(effectSection?.fields ?? new Map(), 'trigger', '')),
    },
    modifiedAt: payload.modifiedAt,
    content: payload.content,
  };
}

export function formatSceneAssetDocument(document: Pick<
  SceneAssetDocument,
  'schema' | 'schemaVersion' | 'name' | 'ownerSystem' | 'runtimeFormat' | 'title' | 'primaryPrefab' | 'entities'
>) {
  const lines = [
    `schema = ${quoteTomlString(document.schema)}`,
    `schema_version = ${document.schemaVersion}`,
    `name = ${quoteTomlString(document.name)}`,
    `owner_system = ${quoteTomlString(document.ownerSystem)}`,
    `runtime_format = ${quoteTomlString(document.runtimeFormat)}`,
    '',
    `title = ${quoteTomlString(document.title)}`,
    `primary_prefab = ${quoteTomlString(document.primaryPrefab)}`,
  ];

  for (const entity of document.entities) {
    lines.push(
      '',
      `[entity.${entity.id}]`,
      `display_name = ${quoteTomlString(entity.displayName)}`,
      `source_prefab = ${quoteTomlString(entity.sourcePrefab)}`,
      `parent = ${quoteTomlString(entity.parent)}`,
      `position = ${formatVector3Value(entity.position)}`,
      `rotation = ${formatVector3Value(entity.rotation)}`,
      `scale = ${formatVector3Value(entity.scale)}`,
    );
  }

  lines.push('');
  return lines.join('\n');
}

export function formatPrefabAssetDocument(document: Pick<
  PrefabAssetDocument,
  'schema' | 'schemaVersion' | 'name' | 'ownerSystem' | 'runtimeFormat' | 'category' | 'spawnTag' | 'renderComponent' | 'effectComponent'
>) {
  const lines = [
    `schema = ${quoteTomlString(document.schema)}`,
    `schema_version = ${document.schemaVersion}`,
    `name = ${quoteTomlString(document.name)}`,
    `owner_system = ${quoteTomlString(document.ownerSystem)}`,
    `runtime_format = ${quoteTomlString(document.runtimeFormat)}`,
    '',
    `category = ${quoteTomlString(document.category)}`,
    `spawn_tag = ${quoteTomlString(document.spawnTag)}`,
  ];

  if (hasPrefabRenderComponent(document.renderComponent)) {
    lines.push(
      '',
      '[component.render]',
      `procgeo = ${quoteTomlString(document.renderComponent.procgeo)}`,
      `material_hint = ${quoteTomlString(document.renderComponent.materialHint)}`,
    );
  }

  if (hasPrefabEffectComponent(document.effectComponent)) {
    lines.push(
      '',
      '[component.effect]',
      `effect = ${quoteTomlString(document.effectComponent.effect)}`,
      `trigger = ${quoteTomlString(document.effectComponent.trigger)}`,
    );
  }

  lines.push('');
  return lines.join('\n');
}

export function createSceneEntityDocument(
  displayName: string,
  sourcePrefab: string,
  preferredId = '',
): SceneEntityDocument {
  const sanitizedSourcePrefab = sanitizeAssetName(sourcePrefab);
  const entityId = sanitizeSceneEntityId(preferredId || displayName || sanitizedSourcePrefab || 'entity');
  return {
    id: entityId || 'entity',
    displayName: displayName.trim() || entityId || 'Entity',
    sourcePrefab: sanitizedSourcePrefab,
    parent: '',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  };
}

export function cloneSceneEntityForDuplicate(entity: SceneEntityDocument, preferredName: string) {
  const duplicate = createSceneEntityDocument(
    preferredName.trim() || `${entity.displayName} Copy`,
    entity.sourcePrefab,
    preferredName || `${entity.id}_copy`,
  );
  return {
    ...duplicate,
    parent: entity.parent,
    position: cloneVector3Value(entity.position),
    rotation: cloneVector3Value(entity.rotation),
    scale: cloneVector3Value(entity.scale),
  };
}

export function createSceneAssetDocument(sceneName: string, primaryPrefab: string): SceneAssetDocument {
  const sanitizedName = sanitizeAssetName(sceneName);
  const title = sceneName.trim() || sanitizedName || 'new_scene';
  const initialEntities = primaryPrefab
    ? [createSceneEntityDocument('Primary Instance', primaryPrefab, 'primary_instance')]
    : [];
  return {
    path: buildSceneAssetPath(sanitizedName || 'new_scene'),
    schema: 'shader_forge.scene',
    schemaVersion: 1,
    name: sanitizedName || 'new_scene',
    ownerSystem: 'scene_system',
    runtimeFormat: 'flatbuffer',
    title,
    primaryPrefab,
    entities: initialEntities,
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
    entities: source.entities.map(cloneSceneEntity),
    modifiedAt: '',
    content: '',
  };
}
