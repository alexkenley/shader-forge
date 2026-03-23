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
    valid: problems.length === 0,
    problems,
  };
}

function loadPrefabAsset(repoRoot, outputRoot, filePath, fields, config, manifest) {
  const asset = buildCommonAssetSnapshot(repoRoot, outputRoot, filePath, fields, config);
  const category = normalizeToken(parseStringValue(fields.category || ''));
  const spawnTag = normalizeToken(parseStringValue(fields.spawn_tag || ''));
  const problems = validateCommonAsset(asset, config, manifest);
  return {
    ...asset,
    category,
    spawnTag,
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
      const fields = parseTomlDocument(filePath);
      let asset;
      if (config.kind === 'scene') {
        asset = loadSceneAsset(repoRoot, outputRoot, filePath, fields, config, manifest);
        scenes.set(asset.name, asset);
      } else if (config.kind === 'prefab') {
        asset = loadPrefabAsset(repoRoot, outputRoot, filePath, fields, config, manifest);
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
    if (asset.kind === 'scene' && asset.primaryPrefab) {
      if (!prefabs.has(asset.primaryPrefab)) {
        asset.valid = false;
        asset.problems.push(`primary_prefab references missing prefab "${asset.primaryPrefab}"`);
      } else {
        relationships.push(`scene ${asset.name} -> prefab ${asset.primaryPrefab}`);
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
      ? { title: asset.title, primaryPrefab: asset.primaryPrefab }
      : asset.kind === 'prefab'
        ? { category: asset.category, spawnTag: asset.spawnTag }
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

  const scanResult = scanSourceAssets(repoRoot, contentRoot, outputRoot, manifest);
  const counts = {
    scene: 0,
    prefab: 0,
    data: 0,
    effect: 0,
    procgeo: 0,
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

  const bakedAssets = scanResult.assets
    .filter((asset) => asset.valid)
    .map((asset) => ({
      kind: asset.kind,
      name: asset.name,
      cookedPath: asset.cookedPath,
      sourcePath: asset.sourcePath,
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
    outputRoot: relativePathFromRepo(repoRoot, outputRoot),
    counts,
    bakedAssets,
    invalidAssets,
    generatedMeshes: scanResult.generatedMeshes,
    relationships: scanResult.relationships,
    warnings: scanResult.warnings,
    notes: [
      'Cooked outputs are staged placeholder payloads in the stable build/cooked layout until the FlatBuffers writer lands.',
      'Procedural geometry currently bakes deterministic generated-mesh preview payloads plus staged cooked metadata.',
    ],
  };

  writeJsonFile(reportPath, report);

  if (invalidAssets.length > 0) {
    throw new Error([
      `Asset pipeline bake found ${invalidAssets.length} invalid asset(s).`,
      `Report: ${relativePathFromRepo(repoRoot, reportPath)}`,
      ...scanResult.warnings.map((warning) => `- ${warning}`),
    ].join('\n'));
  }

  return report;
}
