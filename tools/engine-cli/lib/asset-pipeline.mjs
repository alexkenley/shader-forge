import fs from 'node:fs';
import path from 'node:path';

function trim(value) {
  return String(value || '').trim();
}

function normalizeToken(value) {
  const input = trim(value);
  let normalized = '';
  for (const character of input) {
    const code = character.charCodeAt(0);
    const isAlphaNumeric =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122);
    if (isAlphaNumeric) {
      normalized += character.toLowerCase();
      continue;
    }
    if (character === '_' || character === '-' || character === '.' || character === ' ') {
      if (!normalized || normalized.endsWith('_')) {
        continue;
      }
      normalized += '_';
    }
  }
  return normalized.endsWith('_') ? normalized.slice(0, -1) : normalized;
}

function stripComment(line) {
  let inString = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (!inString && character === '#') {
      return trim(line.slice(0, index));
    }
  }
  return trim(line);
}

function parseKeyValue(line) {
  const separator = line.indexOf('=');
  if (separator === -1) {
    return null;
  }

  const key = normalizeToken(line.slice(0, separator));
  const value = trim(line.slice(separator + 1));
  if (!key) {
    return null;
  }
  return { key, value };
}

function parseStringValue(rawValue) {
  const value = trim(rawValue);
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

function parseNumberValue(rawValue) {
  const value = Number.parseFloat(parseStringValue(rawValue));
  return Number.isFinite(value) ? value : null;
}

function parseIntegerValue(rawValue) {
  const value = Number.parseInt(parseStringValue(rawValue), 10);
  return Number.isInteger(value) ? value : null;
}

function parseBooleanValue(rawValue) {
  const normalized = normalizeToken(parseStringValue(rawValue));
  if (normalized === 'true') {
    return true;
  }
  if (normalized === 'false') {
    return false;
  }
  return null;
}

function relativePathFromRepo(repoRoot, targetPath) {
  const relative = path.relative(repoRoot, targetPath);
  return relative && !relative.startsWith('..') ? relative.split(path.sep).join('/') : targetPath.split(path.sep).join('/');
}

function writeJsonFile(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function writeStageBinary(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function hasSupportedAudioExtension(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return extension === '.wav' || extension === '.ogg' || extension === '.flac' || extension === '.mp3';
}

function parseTomlDocument(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const fields = {};
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const cleaned = stripComment(line);
    if (!cleaned || cleaned.startsWith('[')) {
      continue;
    }
    const pair = parseKeyValue(cleaned);
    if (!pair) {
      continue;
    }
    fields[pair.key] = pair.value;
  }
  return fields;
}

function parseTomlStructuredDocument(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const fields = {};
  const sections = [];
  const lines = content.split(/\r?\n/);
  let currentSection = null;

  for (const line of lines) {
    const cleaned = stripComment(line);
    if (!cleaned) {
      continue;
    }
    if (cleaned.startsWith('[') && cleaned.endsWith(']')) {
      currentSection = {
        name: trim(cleaned.slice(1, -1)),
        fields: {},
      };
      sections.push(currentSection);
      continue;
    }

    const pair = parseKeyValue(cleaned);
    if (!pair) {
      continue;
    }
    if (currentSection) {
      currentSection.fields[pair.key] = pair.value;
    } else {
      fields[pair.key] = pair.value;
    }
  }

  return { fields, sections };
}

function parseListValue(rawValue) {
  return parseStringValue(rawValue)
    .split(',')
    .map((item) => normalizeToken(item))
    .filter(Boolean);
}

function parseVector3Value(rawValue) {
  const parts = parseStringValue(rawValue)
    .split(',')
    .map((item) => trim(item))
    .filter((item) => item.length > 0);
  if (parts.length !== 3) {
    return null;
  }
  const values = parts.map((part) => Number.parseFloat(part));
  return values.every((value) => Number.isFinite(value)) ? values : null;
}

function defaultFoundationManifest() {
  return {
    foundation_name: 'Shader Forge Data Foundation',
    source_format: 'toml',
    runtime_format: 'flatbuffer',
    tooling_db_backend: 'sqlite',
    tooling_db_path: 'tooling/shader_forge.sqlite',
    scene_subdir: 'scenes',
    prefab_subdir: 'prefabs',
    data_subdir: 'data',
    effect_subdir: 'effects',
    procgeo_subdir: 'procgeo',
    cooked_root: 'build/cooked',
    scene_owner: 'scene_system',
    prefab_owner: 'scene_system',
    data_owner: 'data_system',
    effect_owner: 'vfx_system',
    procgeo_owner: 'procgeo_system',
    vfx_authoring_primary: 'effekseer',
    vfx_authoring_fallback: 'simple_descriptor',
  };
}

function loadFoundationManifest(foundationPath) {
  const manifest = defaultFoundationManifest();
  const fields = parseTomlDocument(foundationPath);
  for (const [key, rawValue] of Object.entries(fields)) {
    manifest[key] = parseStringValue(rawValue);
  }
  manifest.source_format = normalizeToken(manifest.source_format);
  manifest.runtime_format = normalizeToken(manifest.runtime_format);
  manifest.tooling_db_backend = normalizeToken(manifest.tooling_db_backend);
  manifest.scene_owner = normalizeToken(manifest.scene_owner);
  manifest.prefab_owner = normalizeToken(manifest.prefab_owner);
  manifest.data_owner = normalizeToken(manifest.data_owner);
  manifest.effect_owner = normalizeToken(manifest.effect_owner);
  manifest.procgeo_owner = normalizeToken(manifest.procgeo_owner);
  manifest.vfx_authoring_primary = normalizeToken(manifest.vfx_authoring_primary);
  manifest.vfx_authoring_fallback = normalizeToken(manifest.vfx_authoring_fallback);
  return manifest;
}

function kindConfig(manifest) {
  return [
    {
      kind: 'scene',
      subdir: manifest.scene_subdir,
      owner: manifest.scene_owner,
      schema: 'shader_forge.scene',
      outputFolder: 'scenes',
    },
    {
      kind: 'prefab',
      subdir: manifest.prefab_subdir,
      owner: manifest.prefab_owner,
      schema: 'shader_forge.prefab',
      outputFolder: 'prefabs',
    },
    {
      kind: 'data',
      subdir: manifest.data_subdir,
      owner: manifest.data_owner,
      schema: 'shader_forge.data',
      outputFolder: 'data',
    },
    {
      kind: 'effect',
      subdir: manifest.effect_subdir,
      owner: manifest.effect_owner,
      schema: 'shader_forge.effect',
      outputFolder: 'effects',
    },
    {
      kind: 'procgeo',
      subdir: manifest.procgeo_subdir,
      owner: manifest.procgeo_owner,
      schema: 'shader_forge.procgeo',
      outputFolder: 'procgeo',
    },
  ];
}

function buildCommonAssetSnapshot(repoRoot, outputRoot, filePath, fields, config) {
  const name = normalizeToken(parseStringValue(fields.name || ''));
  const cookedPath = path.join(outputRoot, config.outputFolder, `${name}.bin`);
  return {
    kind: config.kind,
    name,
    schema: parseStringValue(fields.schema || ''),
    schemaVersion: parseIntegerValue(fields.schema_version || '') || 0,
    ownerSystem: normalizeToken(parseStringValue(fields.owner_system || '')),
    runtimeFormat: normalizeToken(parseStringValue(fields.runtime_format || '')),
    sourcePath: relativePathFromRepo(repoRoot, filePath),
    cookedPath: relativePathFromRepo(repoRoot, cookedPath),
  };
}

function validateCommonAsset(asset, config, manifest) {
  const problems = [];
  if (!asset.name) {
    problems.push('missing name');
  }
  if (asset.schema !== config.schema) {
    problems.push(`schema must be "${config.schema}"`);
  }
  if (asset.schemaVersion <= 0) {
    problems.push('schema_version must be a positive integer');
  }
  if (asset.ownerSystem !== config.owner) {
    problems.push(`owner_system must be "${config.owner}"`);
  }
  if (asset.runtimeFormat !== manifest.runtime_format) {
    problems.push(`runtime_format must be "${manifest.runtime_format}"`);
  }
  return problems;
}

function loadSceneAsset(repoRoot, outputRoot, filePath, fields, config, manifest) {
  const asset = buildCommonAssetSnapshot(repoRoot, outputRoot, filePath, fields, config);
  const title = parseStringValue(fields.title || '');
  const primaryPrefab = normalizeToken(parseStringValue(fields.primary_prefab || ''));
  const problems = validateCommonAsset(asset, config, manifest);
  return {
    ...asset,
    title,
    primaryPrefab,
    entities: [],
    valid: problems.length === 0,
    problems,
  };
}

function loadSceneEntitySections(sections, problems) {
  const entities = [];

  for (const section of sections) {
    if (!section.name.startsWith('entity.')) {
      continue;
    }

    const id = normalizeToken(section.name.slice('entity.'.length));
    const sourcePrefab = normalizeToken(parseStringValue(section.fields.source_prefab || ''));
    const parent = normalizeToken(parseStringValue(section.fields.parent || ''));
    const position = parseVector3Value(section.fields.position || '');
    const rotation = parseVector3Value(section.fields.rotation || '');
    const scale = parseVector3Value(section.fields.scale || '');

    if (!id) {
      problems.push('scene entity section is missing an id');
      continue;
    }
    if (!sourcePrefab) {
      problems.push(`entity "${id}" must declare source_prefab`);
    }
    if (!position) {
      problems.push(`entity "${id}" position must be a quoted "x, y, z" vector`);
    }
    if (!rotation) {
      problems.push(`entity "${id}" rotation must be a quoted "x, y, z" vector`);
    }
    if (!scale) {
      problems.push(`entity "${id}" scale must be a quoted "x, y, z" vector`);
    }

    entities.push({
      id,
      displayName: parseStringValue(section.fields.display_name || '') || id,
      sourcePrefab,
      parent,
      position: position || [0, 0, 0],
      rotation: rotation || [0, 0, 0],
      scale: scale || [1, 1, 1],
    });
  }

  return entities;
}

function loadPrefabComponentSections(sections, problems) {
  const renderSection = sections.find((section) => section.name === 'component.render');
  const effectSection = sections.find((section) => section.name === 'component.effect');

  const renderComponent = {
    procgeo: normalizeToken(parseStringValue(renderSection?.fields.procgeo || '')),
    materialHint: normalizeToken(parseStringValue(renderSection?.fields.material_hint || '')),
  };
  const effectComponent = {
    effect: normalizeToken(parseStringValue(effectSection?.fields.effect || '')),
    trigger: normalizeToken(parseStringValue(effectSection?.fields.trigger || '')),
  };

  if (renderComponent.materialHint && !renderComponent.procgeo) {
    problems.push('render component material_hint requires procgeo');
  }
  if (effectComponent.trigger && !effectComponent.effect) {
    problems.push('effect component trigger requires effect');
  }

  return { renderComponent, effectComponent };
}

function loadPrefabAsset(repoRoot, outputRoot, filePath, fields, sections, config, manifest) {
  const asset = buildCommonAssetSnapshot(repoRoot, outputRoot, filePath, fields, config);
  const category = normalizeToken(parseStringValue(fields.category || ''));
  const spawnTag = normalizeToken(parseStringValue(fields.spawn_tag || ''));
  const problems = validateCommonAsset(asset, config, manifest);
  const { renderComponent, effectComponent } = loadPrefabComponentSections(sections, problems);
  return {
    ...asset,
    category,
    spawnTag,
    renderComponent,
    effectComponent,
    valid: problems.length === 0,
    problems,
  };
}

function loadDataAsset(repoRoot, outputRoot, filePath, fields, config, manifest) {
  const asset = buildCommonAssetSnapshot(repoRoot, outputRoot, filePath, fields, config);
  const defaultScene = normalizeToken(parseStringValue(fields.default_scene || ''));
  const toolingOverlay = normalizeToken(parseStringValue(fields.tooling_overlay || ''));
  const problems = validateCommonAsset(asset, config, manifest);
  if (asset.name === 'runtime_bootstrap') {
    if (!defaultScene) {
      problems.push('runtime_bootstrap must declare default_scene');
    }
    if (toolingOverlay && toolingOverlay !== 'enabled' && toolingOverlay !== 'disabled') {
      problems.push('tooling_overlay must be "enabled" or "disabled"');
    }
  }
  return {
    ...asset,
    defaultScene,
    toolingOverlay,
    valid: problems.length === 0,
    problems,
  };
}

function loadEffectAsset(repoRoot, outputRoot, filePath, fields, config, manifest) {
  const asset = buildCommonAssetSnapshot(repoRoot, outputRoot, filePath, fields, config);
  const authoringMode = normalizeToken(parseStringValue(fields.authoring_mode || ''));
  const runtimeModel = normalizeToken(parseStringValue(fields.runtime_model || ''));
  const trigger = normalizeToken(parseStringValue(fields.trigger || ''));
  const category = normalizeToken(parseStringValue(fields.category || ''));
  const problems = validateCommonAsset(asset, config, manifest);
  if (authoringMode !== manifest.vfx_authoring_primary && authoringMode !== manifest.vfx_authoring_fallback) {
    problems.push(`authoring_mode must be "${manifest.vfx_authoring_primary}" or "${manifest.vfx_authoring_fallback}"`);
  }
  if (!runtimeModel) {
    problems.push('runtime_model is required');
  }
  return {
    ...asset,
    authoringMode,
    runtimeModel,
    trigger,
    category,
    valid: problems.length === 0,
    problems,
  };
}

function loadProcgeoAsset(repoRoot, outputRoot, filePath, fields, config, manifest) {
  const asset = buildCommonAssetSnapshot(repoRoot, outputRoot, filePath, fields, config);
  const generator = normalizeToken(parseStringValue(fields.generator || ''));
  const bakeOutput = normalizeToken(parseStringValue(fields.bake_output || ''));
  const materialHint = normalizeToken(parseStringValue(fields.material_hint || ''));
  const width = parseNumberValue(fields.width || '') ?? 1;
  const height = parseNumberValue(fields.height || '') ?? 1;
  const depth = parseNumberValue(fields.depth || '') ?? 1;
  const rows = parseIntegerValue(fields.rows || '') ?? 1;
  const columns = parseIntegerValue(fields.columns || '') ?? 1;
  const problems = validateCommonAsset(asset, config, manifest);

  if (!['box', 'plane_grid'].includes(generator)) {
    problems.push('generator must be "box" or "plane_grid"');
  }
  if (bakeOutput !== 'generated_mesh') {
    problems.push('bake_output must be "generated_mesh"');
  }
  if (width <= 0 || height <= 0 || depth <= 0) {
    problems.push('width, height, and depth must be positive numbers');
  }
  if (generator === 'plane_grid' && (!Number.isInteger(rows) || rows < 1 || !Number.isInteger(columns) || columns < 1)) {
    problems.push('plane_grid requires rows and columns >= 1');
  }

  return {
    ...asset,
    generator,
    bakeOutput,
    materialHint,
    width,
    height,
    depth,
    rows,
    columns,
    generatedMeshPreviewPath: relativePathFromRepo(repoRoot, path.join(outputRoot, 'generated-meshes', `${asset.name}.mesh.json`)),
    valid: problems.length === 0,
    problems,
  };
}

function buildBoxMesh(asset) {
  const halfWidth = asset.width / 2;
  const halfHeight = asset.height / 2;
  const halfDepth = asset.depth / 2;
  const vertices = [
    [-halfWidth, -halfHeight, -halfDepth],
    [halfWidth, -halfHeight, -halfDepth],
    [halfWidth, halfHeight, -halfDepth],
    [-halfWidth, halfHeight, -halfDepth],
    [-halfWidth, -halfHeight, halfDepth],
    [halfWidth, -halfHeight, halfDepth],
    [halfWidth, halfHeight, halfDepth],
    [-halfWidth, halfHeight, halfDepth],
  ].map((position) => ({ position }));
  const triangleIndices = [
    0, 1, 2, 2, 3, 0,
    4, 6, 5, 6, 4, 7,
    0, 4, 5, 5, 1, 0,
    3, 2, 6, 6, 7, 3,
    1, 5, 6, 6, 2, 1,
    0, 3, 7, 7, 4, 0,
  ];
  return {
    topology: 'triangle_list',
    vertexCount: vertices.length,
    triangleCount: triangleIndices.length / 3,
    vertices,
    triangleIndices,
    bounds: {
      min: [-halfWidth, -halfHeight, -halfDepth],
      max: [halfWidth, halfHeight, halfDepth],
    },
  };
}

function buildPlaneGridMesh(asset) {
  const vertices = [];
  const triangleIndices = [];
  for (let row = 0; row <= asset.rows; row += 1) {
    const z = ((row / asset.rows) - 0.5) * asset.depth;
    for (let column = 0; column <= asset.columns; column += 1) {
      const x = ((column / asset.columns) - 0.5) * asset.width;
      vertices.push({
        position: [x, 0, z],
        normal: [0, 1, 0],
        uv: [column / asset.columns, row / asset.rows],
      });
    }
  }

  const stride = asset.columns + 1;
  for (let row = 0; row < asset.rows; row += 1) {
    for (let column = 0; column < asset.columns; column += 1) {
      const topLeft = row * stride + column;
      const topRight = topLeft + 1;
      const bottomLeft = (row + 1) * stride + column;
      const bottomRight = bottomLeft + 1;
      triangleIndices.push(topLeft, bottomLeft, topRight);
      triangleIndices.push(topRight, bottomLeft, bottomRight);
    }
  }

  return {
    topology: 'triangle_list',
    vertexCount: vertices.length,
    triangleCount: triangleIndices.length / 3,
    vertices,
    triangleIndices,
    bounds: {
      min: [-(asset.width / 2), 0, -(asset.depth / 2)],
      max: [asset.width / 2, 0, asset.depth / 2],
    },
  };
}

function buildGeneratedMeshPreview(asset) {
  if (asset.generator === 'box') {
    return buildBoxMesh(asset);
  }
  return buildPlaneGridMesh(asset);
}

function encodeStagedCookPayload(asset, extra = {}) {
  return {
    format: 'shader_forge.cooked_asset.stage',
    stagedEncoding: 'json_utf8_placeholder',
    runtimeFormat: asset.runtimeFormat,
    kind: asset.kind,
    name: asset.name,
    schema: asset.schema,
    schemaVersion: asset.schemaVersion,
    ownerSystem: asset.ownerSystem,
    sourcePath: asset.sourcePath,
    ...extra,
  };
}

function parseAudioBusDocument(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const document = {
    schema: '',
    schema_version: 0,
    buses: [],
  };
  let currentBus = null;

  for (const rawLine of lines) {
    const cleaned = stripComment(rawLine);
    if (!cleaned) {
      continue;
    }

    if (cleaned.startsWith('[') && cleaned.endsWith(']')) {
      const section = trim(cleaned.slice(1, -1));
      if (!section.startsWith('bus.')) {
        throw new Error(`Invalid audio bus section "${section}" in ${filePath}`);
      }
      const rawName = trim(section.slice(4));
      currentBus = {
        name: normalizeToken(rawName),
        displayName: rawName,
        parent: '',
        defaultVolumeDb: 0,
        defaultMuted: false,
      };
      document.buses.push(currentBus);
      continue;
    }

    const pair = parseKeyValue(cleaned);
    if (!pair) {
      continue;
    }

    if (!currentBus) {
      if (pair.key === 'schema') {
        document.schema = parseStringValue(pair.value).toLowerCase();
      } else if (pair.key === 'schema_version') {
        document.schema_version = parseIntegerValue(pair.value) ?? 0;
      }
      continue;
    }

    if (pair.key === 'display_name') {
      currentBus.displayName = parseStringValue(pair.value);
    } else if (pair.key === 'parent') {
      currentBus.parent = normalizeToken(parseStringValue(pair.value));
    } else if (pair.key === 'default_volume_db') {
      currentBus.defaultVolumeDb = parseNumberValue(pair.value) ?? 0;
    } else if (pair.key === 'default_muted') {
      currentBus.defaultMuted = parseBooleanValue(pair.value) ?? false;
    }
  }

  return document;
}

function scanAudioAssets(repoRoot, audioRoot, outputRoot) {
  const busesPath = path.join(audioRoot, 'buses.toml');
  const soundsRoot = path.join(audioRoot, 'sounds');
  const eventsRoot = path.join(audioRoot, 'events');
  const warnings = [];
  const relationships = [];

  if (!fs.existsSync(busesPath)) {
    throw new Error(`Expected audio bus file is missing: ${relativePathFromRepo(repoRoot, busesPath)}`);
  }
  if (!fs.existsSync(soundsRoot)) {
    throw new Error(`Expected audio sounds directory is missing: ${relativePathFromRepo(repoRoot, soundsRoot)}`);
  }
  if (!fs.existsSync(eventsRoot)) {
    throw new Error(`Expected audio events directory is missing: ${relativePathFromRepo(repoRoot, eventsRoot)}`);
  }

  const busDocument = parseAudioBusDocument(busesPath);
  if (busDocument.schema !== 'shader_forge.audio_buses') {
    throw new Error(`Audio bus file schema must be "shader_forge.audio_buses": ${relativePathFromRepo(repoRoot, busesPath)}`);
  }
  if (busDocument.schema_version <= 0) {
    throw new Error(`Audio bus file schema_version must be a positive integer: ${relativePathFromRepo(repoRoot, busesPath)}`);
  }

  const requiredBuses = ['master', 'music', 'sfx', 'voice', 'ambience'];
  const busNames = new Set(busDocument.buses.map((bus) => bus.name));
  for (const requiredBus of requiredBuses) {
    if (!busNames.has(requiredBus)) {
      throw new Error(`Audio bus file is missing required bus "${requiredBus}": ${relativePathFromRepo(repoRoot, busesPath)}`);
    }
  }
  for (const bus of busDocument.buses) {
    if (bus.parent && !busNames.has(bus.parent)) {
      throw new Error(`Audio bus "${bus.name}" references missing parent "${bus.parent}".`);
    }
  }

  const bakedBusesPath = path.join(outputRoot, 'audio', 'audio-buses.bin');
  writeStageBinary(bakedBusesPath, {
    format: 'shader_forge.cooked_audio_buses.stage',
    stagedEncoding: 'json_utf8_placeholder',
    sourcePath: relativePathFromRepo(repoRoot, busesPath),
    buses: busDocument.buses,
  });

  const sounds = [];
  for (const entry of fs.readdirSync(soundsRoot, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    const sourcePath = path.join(soundsRoot, entry.name);
    const fields = parseTomlDocument(sourcePath);
    const name = normalizeToken(parseStringValue(fields.name || ''));
    const schema = parseStringValue(fields.schema || '').toLowerCase();
    const ownerSystem = normalizeToken(parseStringValue(fields.owner_system || ''));
    const bus = normalizeToken(parseStringValue(fields.bus || ''));
    const sourceMedia = parseStringValue(fields.source_media || '');
    const sourceMediaPath = path.join(audioRoot, sourceMedia);
    const playbackMode = normalizeToken(parseStringValue(fields.playback_mode || ''));
    const spatialization = normalizeToken(parseStringValue(fields.spatialization || ''));
    const stream = parseBooleanValue(fields.stream || '') ?? false;
    const loop = parseBooleanValue(fields.loop || '') ?? false;
    const defaultVolumeDb = parseNumberValue(fields.default_volume_db || '') ?? 0;
    const schemaVersion = parseIntegerValue(fields.schema_version || '') ?? 0;
    const cookedPath = path.join(outputRoot, 'audio', 'sounds', `${name}.bin`);
    const problems = [];

    if (schema !== 'shader_forge.sound') {
      problems.push('schema must be "shader_forge.sound"');
    }
    if (schemaVersion <= 0) {
      problems.push('schema_version must be a positive integer');
    }
    if (ownerSystem !== 'audio_system') {
      problems.push('owner_system must be "audio_system"');
    }
    if (!name) {
      problems.push('missing name');
    }
    if (!busNames.has(bus)) {
      problems.push(`bus must reference a declared audio bus, received "${bus}"`);
    }
    if (!sourceMedia || !hasSupportedAudioExtension(sourceMediaPath)) {
      problems.push('source_media must reference .wav, .ogg, .flac, or .mp3');
    } else if (!fs.existsSync(sourceMediaPath)) {
      problems.push(`source_media is missing: ${relativePathFromRepo(repoRoot, sourceMediaPath)}`);
    }
    if (!['oneshot', 'looped'].includes(playbackMode)) {
      problems.push('playback_mode must be "oneshot" or "looped"');
    }
    if (!['2d', '3d'].includes(spatialization)) {
      problems.push('spatialization must be "2d" or "3d"');
    }

    const sound = {
      name,
      schema,
      schemaVersion,
      ownerSystem,
      bus,
      sourcePath: relativePathFromRepo(repoRoot, sourcePath),
      sourceMedia,
      sourceMediaPath: relativePathFromRepo(repoRoot, sourceMediaPath),
      playbackMode,
      spatialization,
      stream,
      loop,
      defaultVolumeDb,
      cookedPath: relativePathFromRepo(repoRoot, cookedPath),
      valid: problems.length === 0,
      problems,
    };
    sounds.push(sound);

    if (sound.valid) {
      writeStageBinary(cookedPath, {
        format: 'shader_forge.cooked_audio.stage',
        stagedEncoding: 'json_utf8_placeholder',
        kind: 'sound',
        name: sound.name,
        bus: sound.bus,
        sourceMedia: sound.sourceMediaPath,
        playbackMode: sound.playbackMode,
        spatialization: sound.spatialization,
        stream: sound.stream,
        loop: sound.loop,
        defaultVolumeDb: sound.defaultVolumeDb,
      });
      relationships.push(`audio-sound ${sound.name} -> bus ${sound.bus}`);
    } else {
      warnings.push(`${sound.sourcePath}: ${sound.problems.join('; ')}`);
    }
  }

  const soundNames = new Set(sounds.filter((sound) => sound.valid).map((sound) => sound.name));
  const events = [];
  for (const entry of fs.readdirSync(eventsRoot, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    const sourcePath = path.join(eventsRoot, entry.name);
    const fields = parseTomlDocument(sourcePath);
    const name = normalizeToken(parseStringValue(fields.name || ''));
    const schema = parseStringValue(fields.schema || '').toLowerCase();
    const ownerSystem = normalizeToken(parseStringValue(fields.owner_system || ''));
    const action = normalizeToken(parseStringValue(fields.action || ''));
    const sound = normalizeToken(parseStringValue(fields.sound || ''));
    const busOverride = normalizeToken(parseStringValue(fields.bus_override || ''));
    const fadeMs = parseIntegerValue(fields.fade_ms || '') ?? 0;
    const schemaVersion = parseIntegerValue(fields.schema_version || '') ?? 0;
    const cookedPath = path.join(outputRoot, 'audio', 'events', `${name}.bin`);
    const problems = [];

    if (schema !== 'shader_forge.audio_event') {
      problems.push('schema must be "shader_forge.audio_event"');
    }
    if (schemaVersion <= 0) {
      problems.push('schema_version must be a positive integer');
    }
    if (ownerSystem !== 'audio_system') {
      problems.push('owner_system must be "audio_system"');
    }
    if (!name) {
      problems.push('missing name');
    }
    if (action !== 'play_sound') {
      problems.push('action must be "play_sound"');
    }
    if (!soundNames.has(sound)) {
      problems.push(`sound must reference a declared audio sound, received "${sound}"`);
    }
    if (busOverride && !busNames.has(busOverride)) {
      problems.push(`bus_override must reference a declared audio bus, received "${busOverride}"`);
    }
    if (fadeMs < 0) {
      problems.push('fade_ms must be >= 0');
    }

    const event = {
      name,
      schema,
      schemaVersion,
      ownerSystem,
      action,
      sound,
      busOverride,
      fadeMs,
      sourcePath: relativePathFromRepo(repoRoot, sourcePath),
      cookedPath: relativePathFromRepo(repoRoot, cookedPath),
      valid: problems.length === 0,
      problems,
    };
    events.push(event);

    if (event.valid) {
      writeStageBinary(cookedPath, {
        format: 'shader_forge.cooked_audio.stage',
        stagedEncoding: 'json_utf8_placeholder',
        kind: 'event',
        name: event.name,
        action: event.action,
        sound: event.sound,
        busOverride: event.busOverride,
        fadeMs: event.fadeMs,
      });
      relationships.push(`audio-event ${event.name} -> sound ${event.sound}`);
    } else {
      warnings.push(`${event.sourcePath}: ${event.problems.join('; ')}`);
    }
  }

  return {
    audioRoot: relativePathFromRepo(repoRoot, audioRoot),
    busesPath: relativePathFromRepo(repoRoot, busesPath),
    bakedBusesPath: relativePathFromRepo(repoRoot, bakedBusesPath),
    counts: {
      buses: busDocument.buses.length,
      sounds: sounds.length,
      events: events.length,
    },
    buses: busDocument.buses,
    sounds,
    events,
    relationships,
    warnings,
  };
}

function scanAnimationAssets(repoRoot, animationRoot, outputRoot, audioScan) {
  const skeletonsRoot = path.join(animationRoot, 'skeletons');
  const clipsRoot = path.join(animationRoot, 'clips');
  const graphsRoot = path.join(animationRoot, 'graphs');
  const warnings = [];
  const relationships = [];

  if (!fs.existsSync(skeletonsRoot)) {
    throw new Error(`Expected animation skeletons directory is missing: ${relativePathFromRepo(repoRoot, skeletonsRoot)}`);
  }
  if (!fs.existsSync(clipsRoot)) {
    throw new Error(`Expected animation clips directory is missing: ${relativePathFromRepo(repoRoot, clipsRoot)}`);
  }
  if (!fs.existsSync(graphsRoot)) {
    throw new Error(`Expected animation graphs directory is missing: ${relativePathFromRepo(repoRoot, graphsRoot)}`);
  }

  const skeletons = [];
  for (const entry of fs.readdirSync(skeletonsRoot, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    const sourcePath = path.join(skeletonsRoot, entry.name);
    const fields = parseTomlDocument(sourcePath);
    const name = normalizeToken(parseStringValue(fields.name || ''));
    const schema = parseStringValue(fields.schema || '').toLowerCase();
    const ownerSystem = normalizeToken(parseStringValue(fields.owner_system || ''));
    const rootBone = normalizeToken(parseStringValue(fields.root_bone || ''));
    const boneCount = parseIntegerValue(fields.bone_count || '') ?? 0;
    const bones = parseListValue(fields.bones || '');
    const schemaVersion = parseIntegerValue(fields.schema_version || '') ?? 0;
    const cookedPath = path.join(outputRoot, 'animation', 'skeletons', `${name}.bin`);
    const problems = [];

    if (schema !== 'shader_forge.skeleton') {
      problems.push('schema must be "shader_forge.skeleton"');
    }
    if (schemaVersion <= 0) {
      problems.push('schema_version must be a positive integer');
    }
    if (ownerSystem !== 'animation_system') {
      problems.push('owner_system must be "animation_system"');
    }
    if (!name) {
      problems.push('missing name');
    }
    if (!rootBone) {
      problems.push('root_bone must be set');
    }
    if (boneCount <= 0) {
      problems.push('bone_count must be > 0');
    }
    if (bones.length !== boneCount) {
      problems.push('bone_count must match the listed bones');
    }
    if (rootBone && !bones.includes(rootBone)) {
      problems.push('root_bone must be present in bones');
    }

    const skeleton = {
      name,
      schema,
      schemaVersion,
      ownerSystem,
      rootBone,
      boneCount,
      bones,
      sourcePath: relativePathFromRepo(repoRoot, sourcePath),
      cookedPath: relativePathFromRepo(repoRoot, cookedPath),
      valid: problems.length === 0,
      problems,
    };
    skeletons.push(skeleton);

    if (skeleton.valid) {
      writeStageBinary(cookedPath, {
        format: 'shader_forge.cooked_animation.stage',
        stagedEncoding: 'json_utf8_placeholder',
        kind: 'skeleton',
        name: skeleton.name,
        rootBone: skeleton.rootBone,
        boneCount: skeleton.boneCount,
        bones: skeleton.bones,
      });
    } else {
      warnings.push(`${skeleton.sourcePath}: ${skeleton.problems.join('; ')}`);
    }
  }

  const skeletonNames = new Set(skeletons.filter((asset) => asset.valid).map((asset) => asset.name));
  const validAudioEventNames = new Set(audioScan.events.filter((asset) => asset.valid).map((asset) => asset.name));
  const clips = [];
  for (const entry of fs.readdirSync(clipsRoot, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    const sourcePath = path.join(clipsRoot, entry.name);
    const document = parseTomlStructuredDocument(sourcePath);
    const fields = document.fields;
    const name = normalizeToken(parseStringValue(fields.name || ''));
    const schema = parseStringValue(fields.schema || '').toLowerCase();
    const ownerSystem = normalizeToken(parseStringValue(fields.owner_system || ''));
    const skeleton = normalizeToken(parseStringValue(fields.skeleton || ''));
    const durationSeconds = parseNumberValue(fields.duration_seconds || '') ?? 0;
    const loop = parseBooleanValue(fields.loop || '') ?? false;
    const rootMotionMeters = parseNumberValue(fields.root_motion_meters || '') ?? 0;
    const schemaVersion = parseIntegerValue(fields.schema_version || '') ?? 0;
    const cookedPath = path.join(outputRoot, 'animation', 'clips', `${name}.bin`);
    const problems = [];
    const events = [];

    if (schema !== 'shader_forge.animation_clip') {
      problems.push('schema must be "shader_forge.animation_clip"');
    }
    if (schemaVersion <= 0) {
      problems.push('schema_version must be a positive integer');
    }
    if (ownerSystem !== 'animation_system') {
      problems.push('owner_system must be "animation_system"');
    }
    if (!name) {
      problems.push('missing name');
    }
    if (!skeletonNames.has(skeleton)) {
      problems.push(`skeleton must reference a declared animation skeleton, received "${skeleton}"`);
    }
    if (durationSeconds <= 0) {
      problems.push('duration_seconds must be > 0');
    }

    for (const section of document.sections) {
      if (!section.name.startsWith('event.')) {
        problems.push(`unsupported clip section "${section.name}"`);
        continue;
      }
      const eventName = normalizeToken(section.name.slice('event.'.length));
      const eventType = normalizeToken(parseStringValue(section.fields.type || ''));
      const target = normalizeToken(parseStringValue(section.fields.target || ''));
      const timeSeconds = parseNumberValue(section.fields.time_seconds || '') ?? -1;
      const eventProblems = [];

      if (!eventName) {
        eventProblems.push('event section must have a name');
      }
      if (!['marker', 'audio_event', 'vfx_event'].includes(eventType)) {
        eventProblems.push('event type must be "marker", "audio_event", or "vfx_event"');
      }
      if (timeSeconds < 0 || timeSeconds > durationSeconds) {
        eventProblems.push('event time_seconds must be within the clip duration');
      }
      if (!target) {
        eventProblems.push('event target must be set');
      }
      if (eventType === 'audio_event' && !validAudioEventNames.has(target)) {
        eventProblems.push(`audio_event target must reference a declared audio event, received "${target}"`);
      }

      events.push({
        name: eventName,
        type: eventType,
        target,
        timeSeconds,
        valid: eventProblems.length === 0,
        problems: eventProblems,
      });

      for (const problem of eventProblems) {
        problems.push(`event ${eventName}: ${problem}`);
      }
    }

    const clip = {
      name,
      schema,
      schemaVersion,
      ownerSystem,
      skeleton,
      durationSeconds,
      loop,
      rootMotionMeters,
      events,
      sourcePath: relativePathFromRepo(repoRoot, sourcePath),
      cookedPath: relativePathFromRepo(repoRoot, cookedPath),
      valid: problems.length === 0,
      problems,
    };
    clips.push(clip);

    if (clip.valid) {
      writeStageBinary(cookedPath, {
        format: 'shader_forge.cooked_animation.stage',
        stagedEncoding: 'json_utf8_placeholder',
        kind: 'clip',
        name: clip.name,
        skeleton: clip.skeleton,
        durationSeconds: clip.durationSeconds,
        loop: clip.loop,
        rootMotionMeters: clip.rootMotionMeters,
        events: clip.events.map((event) => ({
          name: event.name,
          type: event.type,
          target: event.target,
          timeSeconds: event.timeSeconds,
        })),
      });
      relationships.push(`animation-clip ${clip.name} -> skeleton ${clip.skeleton}`);
      for (const event of clip.events) {
        if (event.type === 'audio_event') {
          relationships.push(`animation-event ${clip.name}.${event.name} -> audio-event ${event.target}`);
        }
      }
    } else {
      warnings.push(`${clip.sourcePath}: ${clip.problems.join('; ')}`);
    }
  }

  const clipMap = new Map(clips.filter((asset) => asset.valid).map((asset) => [asset.name, asset]));
  const graphs = [];
  for (const entry of fs.readdirSync(graphsRoot, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    const sourcePath = path.join(graphsRoot, entry.name);
    const document = parseTomlStructuredDocument(sourcePath);
    const fields = document.fields;
    const name = normalizeToken(parseStringValue(fields.name || ''));
    const schema = parseStringValue(fields.schema || '').toLowerCase();
    const ownerSystem = normalizeToken(parseStringValue(fields.owner_system || ''));
    const skeleton = normalizeToken(parseStringValue(fields.skeleton || ''));
    const entryState = normalizeToken(parseStringValue(fields.entry_state || ''));
    const schemaVersion = parseIntegerValue(fields.schema_version || '') ?? 0;
    const cookedPath = path.join(outputRoot, 'animation', 'graphs', `${name}.bin`);
    const problems = [];
    const parameters = [];
    const states = [];

    if (schema !== 'shader_forge.animation_graph') {
      problems.push('schema must be "shader_forge.animation_graph"');
    }
    if (schemaVersion <= 0) {
      problems.push('schema_version must be a positive integer');
    }
    if (ownerSystem !== 'animation_system') {
      problems.push('owner_system must be "animation_system"');
    }
    if (!name) {
      problems.push('missing name');
    }
    if (!skeletonNames.has(skeleton)) {
      problems.push(`skeleton must reference a declared animation skeleton, received "${skeleton}"`);
    }

    for (const section of document.sections) {
      if (section.name.startsWith('parameter.')) {
        const parameterName = normalizeToken(section.name.slice('parameter.'.length));
        const type = normalizeToken(parseStringValue(section.fields.type || ''));
        const defaultValue = parseNumberValue(section.fields.default_value || '') ?? 0;
        if (type !== 'float') {
          problems.push(`parameter ${parameterName} must use type "float" in this slice`);
        }
        parameters.push({
          name: parameterName,
          type,
          defaultValue,
        });
        continue;
      }

      if (section.name.startsWith('state.')) {
        const stateName = normalizeToken(section.name.slice('state.'.length));
        const clip = normalizeToken(parseStringValue(section.fields.clip || ''));
        const speed = parseNumberValue(section.fields.speed || '') ?? 0;
        const loopState = parseBooleanValue(section.fields.loop || '') ?? false;
        const clipAsset = clipMap.get(clip);
        if (!clipAsset) {
          problems.push(`state ${stateName} must reference a declared animation clip, received "${clip}"`);
        } else if (clipAsset.skeleton !== skeleton) {
          problems.push(`state ${stateName} clip "${clip}" must use skeleton "${skeleton}"`);
        }
        if (speed <= 0) {
          problems.push(`state ${stateName} speed must be > 0`);
        }
        states.push({
          name: stateName,
          clip,
          speed,
          loop: loopState,
        });
        continue;
      }

      problems.push(`unsupported graph section "${section.name}"`);
    }

    if (!states.length) {
      problems.push('graph must define at least one state');
    }
    if (entryState && !states.some((state) => state.name === entryState)) {
      problems.push(`entry_state must reference a declared graph state, received "${entryState}"`);
    }
    if (!entryState) {
      problems.push('entry_state must be set');
    }

    const graph = {
      name,
      schema,
      schemaVersion,
      ownerSystem,
      skeleton,
      entryState,
      parameters,
      states,
      sourcePath: relativePathFromRepo(repoRoot, sourcePath),
      cookedPath: relativePathFromRepo(repoRoot, cookedPath),
      valid: problems.length === 0,
      problems,
    };
    graphs.push(graph);

    if (graph.valid) {
      writeStageBinary(cookedPath, {
        format: 'shader_forge.cooked_animation.stage',
        stagedEncoding: 'json_utf8_placeholder',
        kind: 'graph',
        name: graph.name,
        skeleton: graph.skeleton,
        entryState: graph.entryState,
        parameters: graph.parameters,
        states: graph.states,
      });
      relationships.push(`animation-graph ${graph.name} -> skeleton ${graph.skeleton}`);
      relationships.push(`animation-graph ${graph.name} -> entry_state ${graph.entryState}`);
      for (const state of graph.states) {
        relationships.push(`animation-state ${graph.name}.${state.name} -> clip ${state.clip}`);
      }
    } else {
      warnings.push(`${graph.sourcePath}: ${graph.problems.join('; ')}`);
    }
  }

  return {
    animationRoot: relativePathFromRepo(repoRoot, animationRoot),
    counts: {
      skeletons: skeletons.length,
      clips: clips.length,
      graphs: graphs.length,
    },
    skeletons,
    clips,
    graphs,
    relationships,
    warnings,
  };
}

function parsePhysicsLayersDocument(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split(/\r?\n/);
  const document = {
    schema: '',
    schema_version: 0,
    layers: [],
  };
  let currentLayer = null;

  for (const rawLine of lines) {
    const cleaned = stripComment(rawLine);
    if (!cleaned) {
      continue;
    }

    if (cleaned.startsWith('[') && cleaned.endsWith(']')) {
      const section = trim(cleaned.slice(1, -1));
      if (!section.startsWith('layer.')) {
        throw new Error(`Invalid physics layer section "${section}" in ${filePath}`);
      }
      const rawName = trim(section.slice(6));
      currentLayer = {
        name: normalizeToken(rawName),
        displayName: rawName,
        collidesWith: [],
        queryable: false,
        staticOnly: false,
      };
      document.layers.push(currentLayer);
      continue;
    }

    const pair = parseKeyValue(cleaned);
    if (!pair) {
      continue;
    }

    if (!currentLayer) {
      if (pair.key === 'schema') {
        document.schema = parseStringValue(pair.value).toLowerCase();
      } else if (pair.key === 'schema_version') {
        document.schema_version = parseIntegerValue(pair.value) ?? 0;
      }
      continue;
    }

    if (pair.key === 'display_name') {
      currentLayer.displayName = parseStringValue(pair.value);
    } else if (pair.key === 'collides_with') {
      currentLayer.collidesWith = parseListValue(pair.value);
    } else if (pair.key === 'queryable') {
      currentLayer.queryable = parseBooleanValue(pair.value) ?? false;
    } else if (pair.key === 'static_only') {
      currentLayer.staticOnly = parseBooleanValue(pair.value) ?? false;
    }
  }

  return document;
}

function scanPhysicsAssets(repoRoot, physicsRoot, outputRoot) {
  const layersPath = path.join(physicsRoot, 'layers.toml');
  const materialsRoot = path.join(physicsRoot, 'materials');
  const bodiesRoot = path.join(physicsRoot, 'bodies');
  const warnings = [];
  const relationships = [];

  if (!fs.existsSync(layersPath)) {
    throw new Error(`Expected physics layers file is missing: ${relativePathFromRepo(repoRoot, layersPath)}`);
  }
  if (!fs.existsSync(materialsRoot)) {
    throw new Error(`Expected physics materials directory is missing: ${relativePathFromRepo(repoRoot, materialsRoot)}`);
  }
  if (!fs.existsSync(bodiesRoot)) {
    throw new Error(`Expected physics bodies directory is missing: ${relativePathFromRepo(repoRoot, bodiesRoot)}`);
  }

  const layerDocument = parsePhysicsLayersDocument(layersPath);
  if (layerDocument.schema !== 'shader_forge.physics_layers') {
    throw new Error(`Physics layers file schema must be "shader_forge.physics_layers": ${relativePathFromRepo(repoRoot, layersPath)}`);
  }
  if (layerDocument.schema_version <= 0) {
    throw new Error(`Physics layers file schema_version must be a positive integer: ${relativePathFromRepo(repoRoot, layersPath)}`);
  }

  const requiredLayers = ['world_static', 'world_dynamic', 'query_only'];
  const layerNames = new Set(layerDocument.layers.map((layer) => layer.name));
  for (const requiredLayer of requiredLayers) {
    if (!layerNames.has(requiredLayer)) {
      throw new Error(`Physics layers file is missing required layer "${requiredLayer}": ${relativePathFromRepo(repoRoot, layersPath)}`);
    }
  }
  for (const layer of layerDocument.layers) {
    for (const collisionLayer of layer.collidesWith) {
      if (!layerNames.has(collisionLayer)) {
        throw new Error(`Physics layer "${layer.name}" references missing collides_with layer "${collisionLayer}".`);
      }
    }
  }

  const bakedLayersPath = path.join(outputRoot, 'physics', 'layers.bin');
  writeStageBinary(bakedLayersPath, {
    format: 'shader_forge.cooked_physics.stage',
    stagedEncoding: 'json_utf8_placeholder',
    kind: 'layers',
    sourcePath: relativePathFromRepo(repoRoot, layersPath),
    layers: layerDocument.layers,
  });

  const materials = [];
  for (const entry of fs.readdirSync(materialsRoot, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    const sourcePath = path.join(materialsRoot, entry.name);
    const fields = parseTomlDocument(sourcePath);
    const name = normalizeToken(parseStringValue(fields.name || ''));
    const schema = parseStringValue(fields.schema || '').toLowerCase();
    const ownerSystem = normalizeToken(parseStringValue(fields.owner_system || ''));
    const friction = parseNumberValue(fields.friction || '') ?? -1;
    const restitution = parseNumberValue(fields.restitution || '') ?? -1;
    const density = parseNumberValue(fields.density || '') ?? -1;
    const schemaVersion = parseIntegerValue(fields.schema_version || '') ?? 0;
    const cookedPath = path.join(outputRoot, 'physics', 'materials', `${name}.bin`);
    const problems = [];

    if (schema !== 'shader_forge.physics_material') {
      problems.push('schema must be "shader_forge.physics_material"');
    }
    if (schemaVersion <= 0) {
      problems.push('schema_version must be a positive integer');
    }
    if (ownerSystem !== 'physics_system') {
      problems.push('owner_system must be "physics_system"');
    }
    if (!name) {
      problems.push('missing name');
    }
    if (friction < 0 || friction > 1) {
      problems.push('friction must be between 0 and 1');
    }
    if (restitution < 0 || restitution > 1) {
      problems.push('restitution must be between 0 and 1');
    }
    if (density <= 0) {
      problems.push('density must be > 0');
    }

    const material = {
      name,
      schema,
      schemaVersion,
      ownerSystem,
      friction,
      restitution,
      density,
      sourcePath: relativePathFromRepo(repoRoot, sourcePath),
      cookedPath: relativePathFromRepo(repoRoot, cookedPath),
      valid: problems.length === 0,
      problems,
    };
    materials.push(material);

    if (material.valid) {
      writeStageBinary(cookedPath, {
        format: 'shader_forge.cooked_physics.stage',
        stagedEncoding: 'json_utf8_placeholder',
        kind: 'material',
        name: material.name,
        friction: material.friction,
        restitution: material.restitution,
        density: material.density,
      });
    } else {
      warnings.push(`${material.sourcePath}: ${material.problems.join('; ')}`);
    }
  }

  const materialNames = new Set(materials.filter((asset) => asset.valid).map((asset) => asset.name));
  const bodies = [];
  for (const entry of fs.readdirSync(bodiesRoot, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }
    const sourcePath = path.join(bodiesRoot, entry.name);
    const fields = parseTomlDocument(sourcePath);
    const name = normalizeToken(parseStringValue(fields.name || ''));
    const schema = parseStringValue(fields.schema || '').toLowerCase();
    const ownerSystem = normalizeToken(parseStringValue(fields.owner_system || ''));
    const scene = normalizeToken(parseStringValue(fields.scene || ''));
    const sourcePrefab = normalizeToken(parseStringValue(fields.source_prefab || ''));
    const layer = normalizeToken(parseStringValue(fields.layer || ''));
    const material = normalizeToken(parseStringValue(fields.material || ''));
    const motionType = normalizeToken(parseStringValue(fields.motion_type || ''));
    const shapeType = normalizeToken(parseStringValue(fields.shape_type || ''));
    const position = parseVector3Value(fields.position || '');
    const halfExtents = parseVector3Value(fields.half_extents || '');
    const radius = parseNumberValue(fields.radius || '') ?? 0;
    const schemaVersion = parseIntegerValue(fields.schema_version || '') ?? 0;
    const cookedPath = path.join(outputRoot, 'physics', 'bodies', `${name}.bin`);
    const problems = [];

    if (schema !== 'shader_forge.physics_body') {
      problems.push('schema must be "shader_forge.physics_body"');
    }
    if (schemaVersion <= 0) {
      problems.push('schema_version must be a positive integer');
    }
    if (ownerSystem !== 'physics_system') {
      problems.push('owner_system must be "physics_system"');
    }
    if (!name) {
      problems.push('missing name');
    }
    if (!scene) {
      problems.push('scene must be set');
    }
    if (!layerNames.has(layer)) {
      problems.push(`layer must reference a declared physics layer, received "${layer}"`);
    }
    if (!materialNames.has(material)) {
      problems.push(`material must reference a declared physics material, received "${material}"`);
    }
    if (!['static', 'kinematic', 'dynamic'].includes(motionType)) {
      problems.push('motion_type must be "static", "kinematic", or "dynamic"');
    }
    if (!['box', 'sphere'].includes(shapeType)) {
      problems.push('shape_type must be "box" or "sphere"');
    }
    if (!position) {
      problems.push('position must be a three-component vector');
    }
    if (shapeType === 'box') {
      if (!halfExtents) {
        problems.push('box bodies must declare half_extents');
      } else if (halfExtents.some((value) => value <= 0)) {
        problems.push('box half_extents must all be > 0');
      }
    }
    if (shapeType === 'sphere' && radius <= 0) {
      problems.push('sphere radius must be > 0');
    }

    const body = {
      name,
      schema,
      schemaVersion,
      ownerSystem,
      scene,
      sourcePrefab,
      layer,
      material,
      motionType,
      shapeType,
      position,
      halfExtents,
      radius,
      sourcePath: relativePathFromRepo(repoRoot, sourcePath),
      cookedPath: relativePathFromRepo(repoRoot, cookedPath),
      valid: problems.length === 0,
      problems,
    };
    bodies.push(body);

    if (body.valid) {
      writeStageBinary(cookedPath, {
        format: 'shader_forge.cooked_physics.stage',
        stagedEncoding: 'json_utf8_placeholder',
        kind: 'body',
        name: body.name,
        scene: body.scene,
        sourcePrefab: body.sourcePrefab,
        layer: body.layer,
        material: body.material,
        motionType: body.motionType,
        shapeType: body.shapeType,
        position: body.position,
        halfExtents: body.halfExtents,
        radius: body.radius,
      });
      relationships.push(`physics-body ${body.name} -> layer ${body.layer}`);
      relationships.push(`physics-body ${body.name} -> material ${body.material}`);
    } else {
      warnings.push(`${body.sourcePath}: ${body.problems.join('; ')}`);
    }
  }

  return {
    physicsRoot: relativePathFromRepo(repoRoot, physicsRoot),
    layersPath: relativePathFromRepo(repoRoot, layersPath),
    bakedLayersPath: relativePathFromRepo(repoRoot, bakedLayersPath),
    counts: {
      layers: layerDocument.layers.length,
      materials: materials.length,
      bodies: bodies.length,
    },
    layers: layerDocument.layers,
    materials,
    bodies,
    relationships,
    warnings,
  };
}

function scanSourceAssets(repoRoot, contentRoot, outputRoot, manifest) {
  const assets = [];
  const warnings = [];
  const relationships = [];
  const scenes = new Map();
  const prefabs = new Map();
  const generatedMeshes = [];

  for (const config of kindConfig(manifest)) {
    const directory = path.join(contentRoot, config.subdir);
    if (!fs.existsSync(directory)) {
      throw new Error(`Expected content directory is missing: ${relativePathFromRepo(repoRoot, directory)}`);
    }

    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile()) {
        continue;
      }
      const filePath = path.join(directory, entry.name);
      const structuredDocument = parseTomlStructuredDocument(filePath);
      const fields = structuredDocument.fields;
      let asset;
      if (config.kind === 'scene') {
        asset = loadSceneAsset(repoRoot, outputRoot, filePath, fields, config, manifest);
        asset.entities = loadSceneEntitySections(structuredDocument.sections, asset.problems);
        asset.valid = asset.problems.length === 0;
        scenes.set(asset.name, asset);
      } else if (config.kind === 'prefab') {
        asset = loadPrefabAsset(repoRoot, outputRoot, filePath, fields, structuredDocument.sections, config, manifest);
        prefabs.set(asset.name, asset);
      } else if (config.kind === 'data') {
        asset = loadDataAsset(repoRoot, outputRoot, filePath, fields, config, manifest);
      } else if (config.kind === 'effect') {
        asset = loadEffectAsset(repoRoot, outputRoot, filePath, fields, config, manifest);
      } else {
        asset = loadProcgeoAsset(repoRoot, outputRoot, filePath, fields, config, manifest);
      }
      assets.push(asset);
    }
  }

  for (const asset of assets) {
    if (asset.kind !== 'prefab') {
      continue;
    }

    if (asset.renderComponent?.procgeo) {
      const procgeoAsset = assets.find((candidate) =>
        candidate.valid && candidate.kind === 'procgeo' && candidate.name === asset.renderComponent.procgeo);
      if (!procgeoAsset) {
        asset.valid = false;
        asset.problems.push(`render component references missing procgeo "${asset.renderComponent.procgeo}"`);
      } else {
        relationships.push(`prefab ${asset.name} render -> procgeo ${asset.renderComponent.procgeo}`);
      }
    }

    if (asset.effectComponent?.effect) {
      const effectAsset = assets.find((candidate) =>
        candidate.valid && candidate.kind === 'effect' && candidate.name === asset.effectComponent.effect);
      if (!effectAsset) {
        asset.valid = false;
        asset.problems.push(`effect component references missing effect "${asset.effectComponent.effect}"`);
      } else {
        relationships.push(`prefab ${asset.name} effect -> asset ${asset.effectComponent.effect}`);
      }
    }
  }

  for (const asset of assets) {
    if (asset.kind === 'scene' && asset.primaryPrefab) {
      const primaryPrefab = prefabs.get(asset.primaryPrefab);
      if (!primaryPrefab || !primaryPrefab.valid) {
        asset.valid = false;
        asset.problems.push(`primary_prefab references missing prefab "${asset.primaryPrefab}"`);
      } else {
        relationships.push(`scene ${asset.name} -> prefab ${asset.primaryPrefab}`);
      }
    }
    if (asset.kind === 'scene' && Array.isArray(asset.entities)) {
      const entityIds = new Set(asset.entities.map((entity) => entity.id));
      for (const entity of asset.entities) {
        const prefab = prefabs.get(entity.sourcePrefab);
        if (!prefab || !prefab.valid) {
          asset.valid = false;
          asset.problems.push(`entity "${entity.id}" source_prefab references missing prefab "${entity.sourcePrefab}"`);
        } else {
          relationships.push(`scene ${asset.name} entity ${entity.id} -> prefab ${entity.sourcePrefab}`);
        }
        if (entity.parent) {
          if (entity.parent === entity.id) {
            asset.valid = false;
            asset.problems.push(`entity "${entity.id}" cannot parent itself`);
          } else if (!entityIds.has(entity.parent)) {
            asset.valid = false;
            asset.problems.push(`entity "${entity.id}" parent references missing entity "${entity.parent}"`);
          }
        }
      }
    }
    if (asset.kind === 'data' && asset.name === 'runtime_bootstrap' && asset.defaultScene) {
      if (!scenes.has(asset.defaultScene)) {
        asset.valid = false;
        asset.problems.push(`default_scene references missing scene "${asset.defaultScene}"`);
      } else {
        relationships.push(`runtime_bootstrap -> default_scene=${asset.defaultScene}`);
      }
    }
    if (!asset.valid) {
      for (const problem of asset.problems) {
        warnings.push(`${asset.sourcePath}: ${problem}`);
      }
      continue;
    }

    const cookedPayload = encodeStagedCookPayload(asset, asset.kind === 'scene'
      ? {
          title: asset.title,
          primaryPrefab: asset.primaryPrefab,
          entityCount: asset.entities.length,
          entities: asset.entities,
        }
      : asset.kind === 'prefab'
        ? {
            category: asset.category,
            spawnTag: asset.spawnTag,
            renderComponent: asset.renderComponent,
            effectComponent: asset.effectComponent,
          }
        : asset.kind === 'data'
          ? { defaultScene: asset.defaultScene, toolingOverlay: asset.toolingOverlay }
          : asset.kind === 'effect'
            ? {
                authoringMode: asset.authoringMode,
                runtimeModel: asset.runtimeModel,
                trigger: asset.trigger,
                category: asset.category,
              }
            : {
                generator: asset.generator,
                bakeOutput: asset.bakeOutput,
                materialHint: asset.materialHint,
                dimensions: {
                  width: asset.width,
                  height: asset.height,
                  depth: asset.depth,
                },
                grid: {
                  rows: asset.rows,
                  columns: asset.columns,
                },
                generatedMeshPreviewPath: asset.generatedMeshPreviewPath,
              });

    writeStageBinary(path.join(repoRoot, asset.cookedPath), cookedPayload);

    if (asset.kind === 'procgeo') {
      const previewPayload = {
        format: 'shader_forge.generated_mesh.preview',
        sourceAsset: asset.sourcePath,
        name: asset.name,
        generator: asset.generator,
        bakeOutput: asset.bakeOutput,
        materialHint: asset.materialHint,
        mesh: buildGeneratedMeshPreview(asset),
      };
      writeJsonFile(path.join(repoRoot, asset.generatedMeshPreviewPath), previewPayload);
      generatedMeshes.push({
        name: asset.name,
        generator: asset.generator,
        cookedPath: asset.cookedPath,
        previewPath: asset.generatedMeshPreviewPath,
      });
      relationships.push(`procgeo ${asset.name} -> generated_mesh ${asset.generatedMeshPreviewPath}`);
    }
  }

  return {
    assets,
    warnings,
    relationships,
    generatedMeshes,
  };
}

export async function bakeAssetPipeline(options) {
  const repoRoot = options.repoRoot;
  const contentRoot = path.isAbsolute(options.contentRoot)
    ? options.contentRoot
    : path.join(repoRoot, options.contentRoot);
  const audioRoot = path.isAbsolute(options.audioRoot || '')
    ? options.audioRoot
    : path.join(repoRoot, options.audioRoot || 'audio');
  const animationRoot = path.isAbsolute(options.animationRoot || '')
    ? options.animationRoot
    : path.join(repoRoot, options.animationRoot || 'animation');
  const physicsRoot = path.isAbsolute(options.physicsRoot || '')
    ? options.physicsRoot
    : path.join(repoRoot, options.physicsRoot || 'physics');
  const foundationPath = path.isAbsolute(options.foundationPath)
    ? options.foundationPath
    : path.join(repoRoot, options.foundationPath);
  const manifest = loadFoundationManifest(foundationPath);
  const outputRoot = path.isAbsolute(options.outputRoot)
    ? options.outputRoot
    : path.join(repoRoot, options.outputRoot || manifest.cooked_root);
  const reportPath = path.isAbsolute(options.reportPath)
    ? options.reportPath
    : path.join(repoRoot, options.reportPath || path.join(relativePathFromRepo(repoRoot, outputRoot), 'asset-pipeline-report.json'));

  if (manifest.source_format !== 'toml') {
    throw new Error(`Data foundation source_format must be toml, received "${manifest.source_format}".`);
  }
  if (manifest.runtime_format !== 'flatbuffer') {
    throw new Error(`Data foundation runtime_format must be flatbuffer, received "${manifest.runtime_format}".`);
  }
  if (manifest.tooling_db_backend !== 'sqlite') {
    throw new Error(`Data foundation tooling_db_backend must be sqlite, received "${manifest.tooling_db_backend}".`);
  }

  const audioScan = scanAudioAssets(repoRoot, audioRoot, outputRoot);
  const animationScan = scanAnimationAssets(repoRoot, animationRoot, outputRoot, audioScan);
  const physicsScan = scanPhysicsAssets(repoRoot, physicsRoot, outputRoot);
  const scanResult = scanSourceAssets(repoRoot, contentRoot, outputRoot, manifest);
  const counts = {
    scene: 0,
    prefab: 0,
    data: 0,
    effect: 0,
    procgeo: 0,
    audioBuses: audioScan.counts.buses,
    audioSounds: audioScan.counts.sounds,
    audioEvents: audioScan.counts.events,
    animationSkeletons: animationScan.counts.skeletons,
    animationClips: animationScan.counts.clips,
    animationGraphs: animationScan.counts.graphs,
    physicsLayers: physicsScan.counts.layers,
    physicsMaterials: physicsScan.counts.materials,
    physicsBodies: physicsScan.counts.bodies,
  };

  for (const asset of scanResult.assets) {
    counts[asset.kind] += 1;
  }

  const invalidAssets = scanResult.assets
    .filter((asset) => !asset.valid)
    .map((asset) => ({
      kind: asset.kind,
      name: asset.name,
      sourcePath: asset.sourcePath,
      problems: asset.problems,
    }));

  const invalidAudioAssets = [
    ...audioScan.sounds
      .filter((asset) => !asset.valid)
      .map((asset) => ({
        kind: 'audio_sound',
        name: asset.name,
        sourcePath: asset.sourcePath,
        problems: asset.problems,
      })),
    ...audioScan.events
      .filter((asset) => !asset.valid)
      .map((asset) => ({
        kind: 'audio_event',
        name: asset.name,
        sourcePath: asset.sourcePath,
        problems: asset.problems,
      })),
  ];
  const invalidAnimationAssets = [
    ...animationScan.skeletons
      .filter((asset) => !asset.valid)
      .map((asset) => ({
        kind: 'animation_skeleton',
        name: asset.name,
        sourcePath: asset.sourcePath,
        problems: asset.problems,
      })),
    ...animationScan.clips
      .filter((asset) => !asset.valid)
      .map((asset) => ({
        kind: 'animation_clip',
        name: asset.name,
        sourcePath: asset.sourcePath,
        problems: asset.problems,
      })),
    ...animationScan.graphs
      .filter((asset) => !asset.valid)
      .map((asset) => ({
        kind: 'animation_graph',
        name: asset.name,
        sourcePath: asset.sourcePath,
        problems: asset.problems,
      })),
  ];
  const invalidPhysicsAssets = [
    ...physicsScan.materials
      .filter((asset) => !asset.valid)
      .map((asset) => ({
        kind: 'physics_material',
        name: asset.name,
        sourcePath: asset.sourcePath,
        problems: asset.problems,
      })),
    ...physicsScan.bodies
      .filter((asset) => !asset.valid)
      .map((asset) => ({
        kind: 'physics_body',
        name: asset.name,
        sourcePath: asset.sourcePath,
        problems: asset.problems,
      })),
  ];

  const bakedAssets = scanResult.assets
    .filter((asset) => asset.valid)
    .map((asset) => ({
      kind: asset.kind,
      name: asset.name,
      cookedPath: asset.cookedPath,
      sourcePath: asset.sourcePath,
      ...(asset.kind === 'scene'
        ? {
            entityCount: asset.entities.length,
          }
        : asset.kind === 'prefab'
          ? {
              hasRenderComponent: Boolean(asset.renderComponent?.procgeo || asset.renderComponent?.materialHint),
              hasEffectComponent: Boolean(asset.effectComponent?.effect || asset.effectComponent?.trigger),
            }
        : {}),
    }));

  const report = {
    format: 'shader_forge.asset_pipeline.report',
    version: 1,
    foundation: {
      manifestPath: relativePathFromRepo(repoRoot, foundationPath),
      sourceFormat: manifest.source_format,
      runtimeFormat: manifest.runtime_format,
      toolingDbBackend: manifest.tooling_db_backend,
      toolingDbPath: manifest.tooling_db_path,
    },
    contentRoot: relativePathFromRepo(repoRoot, contentRoot),
    audioRoot: relativePathFromRepo(repoRoot, audioRoot),
    animationRoot: relativePathFromRepo(repoRoot, animationRoot),
    physicsRoot: relativePathFromRepo(repoRoot, physicsRoot),
    outputRoot: relativePathFromRepo(repoRoot, outputRoot),
    counts,
    bakedAssets,
    invalidAssets,
    invalidAudioAssets,
    invalidAnimationAssets,
    invalidPhysicsAssets,
    generatedMeshes: scanResult.generatedMeshes,
    audio: {
      busesPath: audioScan.busesPath,
      bakedBusesPath: audioScan.bakedBusesPath,
      counts: audioScan.counts,
      bakedSounds: audioScan.sounds.filter((asset) => asset.valid).map((asset) => ({
        name: asset.name,
        bus: asset.bus,
        cookedPath: asset.cookedPath,
        sourcePath: asset.sourcePath,
      })),
      bakedEvents: audioScan.events.filter((asset) => asset.valid).map((asset) => ({
        name: asset.name,
        sound: asset.sound,
        cookedPath: asset.cookedPath,
        sourcePath: asset.sourcePath,
      })),
      relationships: audioScan.relationships,
      warnings: audioScan.warnings,
    },
    animation: {
      counts: animationScan.counts,
      bakedSkeletons: animationScan.skeletons.filter((asset) => asset.valid).map((asset) => ({
        name: asset.name,
        cookedPath: asset.cookedPath,
        sourcePath: asset.sourcePath,
      })),
      bakedClips: animationScan.clips.filter((asset) => asset.valid).map((asset) => ({
        name: asset.name,
        skeleton: asset.skeleton,
        cookedPath: asset.cookedPath,
        sourcePath: asset.sourcePath,
      })),
      bakedGraphs: animationScan.graphs.filter((asset) => asset.valid).map((asset) => ({
        name: asset.name,
        skeleton: asset.skeleton,
        entryState: asset.entryState,
        cookedPath: asset.cookedPath,
        sourcePath: asset.sourcePath,
      })),
      relationships: animationScan.relationships,
      warnings: animationScan.warnings,
    },
    physics: {
      layersPath: physicsScan.layersPath,
      bakedLayersPath: physicsScan.bakedLayersPath,
      counts: physicsScan.counts,
      bakedMaterials: physicsScan.materials.filter((asset) => asset.valid).map((asset) => ({
        name: asset.name,
        cookedPath: asset.cookedPath,
        sourcePath: asset.sourcePath,
      })),
      bakedBodies: physicsScan.bodies.filter((asset) => asset.valid).map((asset) => ({
        name: asset.name,
        scene: asset.scene,
        layer: asset.layer,
        material: asset.material,
        cookedPath: asset.cookedPath,
        sourcePath: asset.sourcePath,
      })),
      relationships: physicsScan.relationships,
      warnings: physicsScan.warnings,
    },
    relationships: [...scanResult.relationships, ...animationScan.relationships, ...physicsScan.relationships],
    warnings: [...scanResult.warnings, ...audioScan.warnings, ...animationScan.warnings, ...physicsScan.warnings],
    notes: [
      'Cooked outputs are staged placeholder payloads in the stable build/cooked layout until the FlatBuffers writer lands.',
      'Procedural geometry currently bakes deterministic generated-mesh preview payloads plus staged cooked metadata.',
      'Audio currently bakes staged bus, sound, and event metadata registries until the playback backend lands.',
      'Animation currently bakes staged skeleton, clip, and graph metadata registries plus validated audio-event links until the runtime sampling backend lands.',
      'Physics currently bakes staged layer, material, and body metadata registries plus deterministic query-friendly primitive definitions until the runtime backend lands.',
    ],
  };

  writeJsonFile(reportPath, report);

  if (invalidAssets.length > 0 || invalidAudioAssets.length > 0 || invalidAnimationAssets.length > 0 || invalidPhysicsAssets.length > 0) {
    throw new Error([
      `Asset pipeline bake found ${invalidAssets.length + invalidAudioAssets.length + invalidAnimationAssets.length + invalidPhysicsAssets.length} invalid asset(s).`,
      `Report: ${relativePathFromRepo(repoRoot, reportPath)}`,
      ...[...scanResult.warnings, ...audioScan.warnings, ...animationScan.warnings, ...physicsScan.warnings].map((warning) => `- ${warning}`),
    ].join('\n'));
  }

  return report;
}
