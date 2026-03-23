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

function normalizeRunId(value) {
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
    if (character === '_' || character === '-' || character === '.') {
      if (!normalized || normalized.endsWith('-')) {
        continue;
      }
      normalized += '-';
    }
  }
  return normalized.endsWith('-') ? normalized.slice(0, -1) : normalized;
}

function relativePathFromRepo(repoRoot, targetPath) {
  const relative = path.relative(repoRoot, targetPath);
  return relative && !relative.startsWith('..') ? relative.split(path.sep).join('/') : targetPath.split(path.sep).join('/');
}

function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function writeTextFile(filePath, content) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, content, 'utf8');
}

function quoteTomlString(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function formatTomlValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => formatTomlValue(item)).join(', ')}]`;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : '0';
  }
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  return quoteTomlString(value);
}

function stringifyToml(document) {
  const lines = [];
  const sectionEntries = [];

  for (const [key, value] of Object.entries(document)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      sectionEntries.push([key, value]);
      continue;
    }
    lines.push(`${key} = ${formatTomlValue(value)}`);
  }

  for (const [sectionName, sectionValue] of sectionEntries) {
    if (lines.length > 0) {
      lines.push('');
    }
    lines.push(`[${sectionName}]`);
    for (const [key, value] of Object.entries(sectionValue)) {
      lines.push(`${key} = ${formatTomlValue(value)}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function parseTomlValue(rawValue) {
  const value = trim(rawValue);
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = trim(value.slice(1, -1));
    if (!inner) {
      return [];
    }
    const items = [];
    let current = '';
    let inString = false;
    for (const character of inner) {
      if (character === '"') {
        inString = !inString;
        current += character;
        continue;
      }
      if (character === ',' && !inString) {
        items.push(parseTomlValue(current));
        current = '';
        continue;
      }
      current += character;
    }
    if (current) {
      items.push(parseTomlValue(current));
    }
    return items;
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  const numberValue = Number(value);
  if (Number.isFinite(numberValue)) {
    return numberValue;
  }
  return value;
}

function parseSimpleTomlDocument(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const result = {};
  let currentSection = result;

  for (const rawLine of content.split(/\r?\n/)) {
    const line = trim(rawLine);
    if (!line || line.startsWith('#')) {
      continue;
    }
    if (line.startsWith('[') && line.endsWith(']')) {
      const sectionName = line.slice(1, -1);
      result[sectionName] = {};
      currentSection = result[sectionName];
      continue;
    }
    const separator = line.indexOf('=');
    if (separator === -1) {
      continue;
    }
    const key = trim(line.slice(0, separator));
    const value = line.slice(separator + 1);
    currentSection[key] = parseTomlValue(value);
  }

  return result;
}

function readFileIfPresent(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function firstExistingFile(filePaths) {
  for (const filePath of filePaths) {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return filePath;
    }
  }
  return '';
}

function hasDirectory(rootPath, relativeDirectory) {
  const directoryPath = path.join(rootPath, relativeDirectory);
  return fs.existsSync(directoryPath) && fs.statSync(directoryPath).isDirectory();
}

function firstMatchingFile(rootPath, matcher) {
  if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
    return '';
  }
  for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
    if (entry.isFile() && matcher(entry.name)) {
      return path.join(rootPath, entry.name);
    }
  }
  return '';
}

function detectUnityProject(projectRoot) {
  const reasons = [];
  if (hasDirectory(projectRoot, 'Assets')) {
    reasons.push('Found Unity-style Assets directory.');
  }
  if (hasDirectory(projectRoot, 'ProjectSettings')) {
    reasons.push('Found Unity ProjectSettings directory.');
  }
  const versionPath = path.join(projectRoot, 'ProjectSettings', 'ProjectVersion.txt');
  const versionContent = readFileIfPresent(versionPath);
  let version = '';
  if (versionContent) {
    reasons.push('Found ProjectSettings/ProjectVersion.txt.');
    const versionMatch = versionContent.match(/m_EditorVersion:\s*(.+)/);
    version = versionMatch?.[1]?.trim() || '';
  }
  return {
    engine: 'unity',
    score: reasons.length,
    reasons,
    version,
    projectMarker: versionPath,
    sourceRoots: ['Assets', 'ProjectSettings', 'Packages'].filter((entry) => fs.existsSync(path.join(projectRoot, entry))),
  };
}

function detectUnrealProject(projectRoot) {
  const reasons = [];
  const projectFile = firstMatchingFile(projectRoot, (name) => name.endsWith('.uproject'));
  let version = '';
  if (projectFile) {
    reasons.push(`Found Unreal project file ${path.basename(projectFile)}.`);
    try {
      const parsed = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
      version = trim(parsed.EngineAssociation || parsed.EngineVersion || '');
    } catch {
      // Keep version empty when the fixture is intentionally minimal.
    }
  }
  if (hasDirectory(projectRoot, 'Content')) {
    reasons.push('Found Unreal-style Content directory.');
  }
  if (hasDirectory(projectRoot, 'Config')) {
    reasons.push('Found Unreal Config directory.');
  }
  const exporterManifestPath = firstExistingFile([
    path.join(projectRoot, 'Saved', 'ShaderForgeMigration', 'export-manifest.json'),
    path.join(projectRoot, 'Saved', 'ShaderForgeMigration', 'export-manifest.toml'),
    path.join(projectRoot, 'Saved', 'ShaderForgeMigration', 'shader-forge-export.json'),
    path.join(projectRoot, 'ShaderForgeMigration', 'export-manifest.json'),
  ]);
  if (exporterManifestPath) {
    reasons.push(`Found Shader Forge Unreal exporter manifest ${path.relative(projectRoot, exporterManifestPath).split(path.sep).join('/')}.`);
  }
  return {
    engine: 'unreal',
    score: reasons.length,
    reasons,
    version,
    projectMarker: projectFile,
    sourceRoots: ['Content', 'Config', 'Source'].filter((entry) => fs.existsSync(path.join(projectRoot, entry))),
    exporterManifestPath,
  };
}

function detectGodotProject(projectRoot) {
  const reasons = [];
  const projectFile = path.join(projectRoot, 'project.godot');
  const projectContent = readFileIfPresent(projectFile);
  let version = '';
  if (projectContent) {
    reasons.push('Found project.godot.');
    const featureMatch = projectContent.match(/config\/features=.*"([^"]+)"/);
    version = featureMatch?.[1]?.trim() || '';
  }
  if (hasDirectory(projectRoot, 'scenes')) {
    reasons.push('Found Godot-style scenes directory.');
  }
  if (hasDirectory(projectRoot, 'scripts')) {
    reasons.push('Found Godot-style scripts directory.');
  }
  return {
    engine: 'godot',
    score: reasons.length,
    reasons,
    version,
    projectMarker: projectFile,
    sourceRoots: ['scenes', 'scripts', 'addons'].filter((entry) => fs.existsSync(path.join(projectRoot, entry))),
  };
}

function detectSourceProject(projectRoot, requestedEngine = '') {
  const detectors = {
    unity: detectUnityProject,
    unreal: detectUnrealProject,
    godot: detectGodotProject,
  };

  if (requestedEngine) {
    const detector = detectors[requestedEngine];
    if (!detector) {
      throw new Error(`Unsupported migration engine lane: ${requestedEngine}`);
    }
    const detection = detector(projectRoot);
    if (detection.score <= 0) {
      throw new Error(`Could not confirm a ${requestedEngine} project at ${projectRoot}`);
    }
    return {
      ...detection,
      confidence: detection.score >= 3 ? 'high' : 'medium',
      requestedEngine,
    };
  }

  const candidates = Object.values(detectors).map((detect) => detect(projectRoot)).sort((left, right) => right.score - left.score);
  const winner = candidates[0];
  const runnerUp = candidates[1];
  if (!winner || winner.score <= 0) {
    throw new Error(`Could not detect a supported source-engine project at ${projectRoot}`);
  }
  if (runnerUp && runnerUp.score === winner.score && runnerUp.score > 0) {
    throw new Error(`Migration detection is ambiguous at ${projectRoot}; multiple supported source engines matched.`);
  }
  return {
    ...winner,
    confidence: winner.score >= 3 ? 'high' : 'medium',
    requestedEngine: '',
  };
}

function walkFiles(rootPath) {
  const results = [];
  if (!fs.existsSync(rootPath)) {
    return results;
  }
  const stack = [rootPath];
  while (stack.length > 0) {
    const currentPath = stack.pop();
    if (!currentPath || !fs.existsSync(currentPath)) {
      continue;
    }
    for (const entry of fs.readdirSync(currentPath, { withFileTypes: true })) {
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (entry.isFile()) {
        results.push(entryPath);
      }
    }
  }
  return results.sort();
}

function countFiles(filePaths, predicate) {
  return filePaths.reduce((count, filePath) => count + (predicate(filePath) ? 1 : 0), 0);
}

function collectSourceCounts(projectRoot, engine) {
  const files = walkFiles(projectRoot);
  const relativeFiles = files.map((filePath) => path.relative(projectRoot, filePath).split(path.sep).join('/'));

  if (engine === 'unity') {
    return {
      total_files: relativeFiles.length,
      scene_files: countFiles(relativeFiles, (filePath) => filePath.endsWith('.unity')),
      prefab_files: countFiles(relativeFiles, (filePath) => filePath.endsWith('.prefab')),
      script_files: countFiles(relativeFiles, (filePath) => filePath.endsWith('.cs')),
      material_files: countFiles(relativeFiles, (filePath) => filePath.endsWith('.mat')),
      asset_metadata_files: countFiles(relativeFiles, (filePath) => filePath.endsWith('.asset') || filePath.endsWith('.meta')),
      project_files: countFiles(relativeFiles, (filePath) => filePath.includes('ProjectSettings/')),
    };
  }

  if (engine === 'unreal') {
    const blueprintKinds = relativeFiles.map((filePath) => classifyUnrealAssetKind(filePath));
    return {
      total_files: relativeFiles.length,
      level_files: countFiles(relativeFiles, (filePath) => filePath.endsWith('.umap')),
      asset_package_files: countFiles(relativeFiles, (filePath) => filePath.endsWith('.uasset')),
      blueprint_package_files: blueprintKinds.filter((kind) => kind === 'actor_blueprint' || kind === 'widget_blueprint' || kind === 'animation_blueprint').length,
      actor_blueprint_files: blueprintKinds.filter((kind) => kind === 'actor_blueprint').length,
      widget_blueprint_files: blueprintKinds.filter((kind) => kind === 'widget_blueprint').length,
      animation_blueprint_files: blueprintKinds.filter((kind) => kind === 'animation_blueprint').length,
      source_files: countFiles(relativeFiles, (filePath) => filePath.endsWith('.cpp') || filePath.endsWith('.h')),
      config_files: countFiles(relativeFiles, (filePath) => filePath.endsWith('.ini')),
      project_files: countFiles(relativeFiles, (filePath) => filePath.endsWith('.uproject')),
      exporter_manifest_files: countFiles(relativeFiles, (filePath) => /(^|\/)(Saved\/ShaderForgeMigration|ShaderForgeMigration)\//.test(filePath) && (filePath.endsWith('export-manifest.json') || filePath.endsWith('export-manifest.toml') || filePath.endsWith('shader-forge-export.json'))),
    };
  }

  return {
    total_files: relativeFiles.length,
    scene_files: countFiles(relativeFiles, (filePath) => filePath.endsWith('.tscn') || filePath.endsWith('.scn')),
    script_files: countFiles(relativeFiles, (filePath) => filePath.endsWith('.gd') || filePath.endsWith('.cs')),
    resource_files: countFiles(relativeFiles, (filePath) => filePath.endsWith('.tres') || filePath.endsWith('.res')),
    import_files: countFiles(relativeFiles, (filePath) => filePath.endsWith('.import')),
    project_files: countFiles(relativeFiles, (filePath) => filePath === 'project.godot'),
  };
}

function buildTargetRoots(engine) {
  return {
    assets_src: `assets-src/migrated/${engine}`,
    assets_cooked: `assets/migrated/${engine}`,
    content_scenes: `content/scenes/migrated/${engine}`,
    content_prefabs: `content/prefabs/migrated/${engine}`,
    content_data: `content/data/migrated/${engine}`,
  };
}

function classifyUnrealAssetKind(filePath) {
  const normalized = String(filePath || '').split(path.sep).join('/').toLowerCase();
  if (!normalized.endsWith('.uasset')) {
    return '';
  }
  const baseName = path.basename(normalized, '.uasset').toLowerCase();
  if (baseName.startsWith('wbp_') || normalized.includes('/ui/') || normalized.includes('/widgets/')) {
    return 'widget_blueprint';
  }
  if (baseName.startsWith('abp_') || baseName.startsWith('animbp_')) {
    return 'animation_blueprint';
  }
  if (baseName.startsWith('bp_') || normalized.includes('/blueprints/')) {
    return 'actor_blueprint';
  }
  return 'asset_package';
}

function determineMigrationSlice(commandName, detection) {
  if (commandName === 'detect') {
    return {
      phase: '5_6_foundation',
      conversionMode: 'detect_and_manifest_only',
      currentSlice: 'foundation_detect_only',
      generatedProjectSkeleton: false,
      activeLane: 'detect_and_manifest_only',
      preferredLane: 'detect_and_manifest_only',
      conversionConfidence: 'high',
      fallbackReason: '',
    };
  }

  if (detection.engine === 'unreal') {
    return {
      phase: '5_85_offline_unreal_fallback',
      conversionMode: 'unreal_offline_fallback_conversion',
      currentSlice: 'unreal_offline_fallback',
      generatedProjectSkeleton: true,
      activeLane: 'unreal_offline_fallback',
      preferredLane: 'unreal_exporter_assisted',
      conversionConfidence: 'low',
      fallbackReason: detection.exporterManifestPath
        ? 'A Shader Forge Unreal exporter manifest was detected, but exporter-assisted manifest parsing is not implemented in this slice, so the offline fallback stayed active.'
        : 'No Shader Forge Unreal exporter manifest was detected, so the CLI used the explicit offline raw-project fallback.',
    };
  }

  return {
    phase: '5_8_conversion',
    conversionMode: 'project_skeleton_conversion',
    currentSlice: 'project_skeleton_conversion',
    generatedProjectSkeleton: true,
    activeLane: `${detection.engine}_project_skeleton`,
    preferredLane: `${detection.engine}_project_skeleton`,
    conversionConfidence: 'medium',
    fallbackReason: '',
  };
}

function buildSupportLevels(slice) {
  if (slice.conversionMode === 'unreal_offline_fallback_conversion') {
    return {
      detection: 'Supported',
      asset_conversion: 'Manual',
      scene_conversion: 'BestEffort',
      script_porting: 'BestEffort',
      project_settings: 'BestEffort',
      blueprint_extraction: 'BestEffort',
      exporter_assisted_unreal: 'Manual',
    };
  }
  if (slice.conversionMode === 'project_skeleton_conversion') {
    return {
      detection: 'Supported',
      asset_conversion: 'BestEffort',
      scene_conversion: 'BestEffort',
      script_porting: 'BestEffort',
      project_settings: 'BestEffort',
      blueprint_extraction: 'Manual',
      exporter_assisted_unreal: 'Manual',
    };
  }
  return {
    detection: 'Supported',
    asset_conversion: 'Manual',
    scene_conversion: 'Manual',
    script_porting: 'Manual',
    project_settings: 'BestEffort',
    blueprint_extraction: 'Manual',
    exporter_assisted_unreal: 'Manual',
  };
}

function buildManualTasks(engine, targetRoots, slice, counts) {
  if (slice.conversionMode === 'unreal_offline_fallback_conversion') {
    return [
      'Prefer an exporter-assisted Unreal migration run once that lane exists; the current output is intentionally marked as an offline fallback rather than a parity conversion.',
      `Review generated scenes under ${targetRoots.content_scenes} and repair actor placement, transforms, hierarchy, and component coverage because the fallback only inspects project structure, map names, package names, and source-class symbols.`,
      Number(counts.blueprint_package_files || 0) > 0
        ? `Review the low-confidence Blueprint script-porting manifests under migration/<run-id>/script-porting; ${Number(counts.blueprint_package_files || 0)} Blueprint-like package(s) were inferred from offline .uasset names only.`
        : 'Review any emitted Unreal script-porting manifests manually; the offline fallback cannot inspect Blueprint graphs or serialized node data in this slice.',
      `Populate real imported assets under ${targetRoots.assets_src} and ${targetRoots.assets_cooked}; the fallback does not convert materials, textures, animation, or audio payloads.`,
    ];
  }
  if (slice.conversionMode === 'project_skeleton_conversion') {
    return [
      `Review generated scenes under ${targetRoots.content_scenes} and expand the first-pass hierarchy, transforms, plus component payloads beyond the current skeleton output.`,
      `Review generated prefabs under ${targetRoots.content_prefabs} and map real render, collision, audio, animation, and gameplay payloads before claiming parity.`,
      `Populate real imported art and cooked assets under ${targetRoots.assets_src} and ${targetRoots.assets_cooked}; this slice only emits structure placeholders.`,
      'Review script-porting manifests and implement gameplay behavior manually or with later AI-assisted porting passes.',
    ];
  }
  return [
    `Map source scenes or levels into ${targetRoots.content_scenes} once conversion lanes are implemented.`,
    `Map source prefabs or reusable actors into ${targetRoots.content_prefabs} using Shader Forge text-backed assets.`,
    `Review material, shader, and rendering differences before claiming runtime parity for ${engine} content.`,
    'Populate script-porting manifests and manual gameplay translation notes before attempting feature parity.',
  ];
}

function buildWarnings(detection, requestedEngine, slice, counts, repoRoot) {
  const warnings = [];
  if (!detection.version) {
    warnings.push('Source-engine version could not be read from the detected project markers.');
  }
  if (requestedEngine && detection.engine !== requestedEngine) {
    warnings.push(`Requested lane ${requestedEngine} does not match detected engine ${detection.engine}.`);
  }
  if (slice.conversionMode === 'unreal_offline_fallback_conversion') {
    warnings.push('Unreal exporter-assisted migration is still the preferred path, but this run used the explicit offline fallback lane.');
    if (detection.exporterManifestPath) {
      warnings.push(`A Shader Forge Unreal exporter manifest was detected at ${relativePathFromRepo(repoRoot, detection.exporterManifestPath)}, but parser integration is not implemented yet; offline fallback stayed active.`);
    } else {
      warnings.push('No Shader Forge Unreal exporter manifest was detected under the project root, so actor and Blueprint extraction fell back to project-structure heuristics.');
    }
    warnings.push('Offline fallback currently derives scenes and prefabs from .uproject, .umap, .uasset package names, and source-class inspection rather than Unreal editor export data.');
    if (Number(counts.blueprint_package_files || 0) > 0) {
      warnings.push(`Detected ${Number(counts.blueprint_package_files || 0)} Blueprint-like .uasset package(s). These only emit low-confidence script-porting manifests in the offline fallback lane.`);
    }
    return warnings;
  }
  if (slice.conversionMode === 'project_skeleton_conversion') {
    warnings.push('Converted outputs are first-pass Shader Forge project skeletons, not runtime-parity imports.');
    if (detection.engine === 'unity') {
      warnings.push('Unity conversion currently extracts scene, prefab, and script identifiers from minimal text assets rather than full serialized component graphs.');
    } else if (detection.engine === 'godot') {
      warnings.push('Godot conversion currently maps root scene nodes and script placeholders only; full node/component translation is still ahead.');
    }
  }
  return warnings;
}

function basenameWithoutExtension(filePath) {
  return path.basename(filePath, path.extname(filePath));
}

function displayNameFromToken(value) {
  const tokens = trim(value).split(/[_\s-]+/).filter(Boolean);
  if (tokens.length === 0) {
    return 'Untitled';
  }
  return tokens.map((token) => token.charAt(0).toUpperCase() + token.slice(1)).join(' ');
}

function firstRegexGroup(content, regex, fallback = '') {
  const match = content.match(regex);
  return trim(match?.[1] || fallback);
}

function uniqueBy(items, keySelector) {
  const results = [];
  const seen = new Set();
  for (const item of items) {
    const key = keySelector(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    results.push(item);
  }
  return results;
}

function buildSceneToml(scene) {
  return [
    'schema = "shader_forge.scene"',
    'schema_version = 1',
    `name = ${quoteTomlString(scene.name)}`,
    'owner_system = "scene_system"',
    'runtime_format = "flatbuffer"',
    '',
    `title = ${quoteTomlString(scene.title)}`,
    `primary_prefab = ${quoteTomlString(scene.primaryPrefab)}`,
    '',
    `[entity.${scene.entityId}]`,
    `display_name = ${quoteTomlString(scene.entityDisplayName)}`,
    `source_prefab = ${quoteTomlString(scene.primaryPrefab)}`,
    'parent = ""',
    'position = "0, 0, 0"',
    'rotation = "0, 0, 0"',
    'scale = "1, 1, 1"',
    '',
  ].join('\n');
}

function buildPrefabToml(prefab) {
  return [
    'schema = "shader_forge.prefab"',
    'schema_version = 1',
    `name = ${quoteTomlString(prefab.name)}`,
    'owner_system = "scene_system"',
    'runtime_format = "flatbuffer"',
    '',
    `category = ${quoteTomlString(prefab.category)}`,
    `spawn_tag = ${quoteTomlString(prefab.spawnTag)}`,
    '',
  ].join('\n');
}

function buildDataToml(defaultScene) {
  return [
    'schema = "shader_forge.data"',
    'schema_version = 1',
    'name = "runtime_bootstrap"',
    'owner_system = "data_system"',
    'runtime_format = "flatbuffer"',
    '',
    `default_scene = ${quoteTomlString(defaultScene)}`,
    'tooling_overlay = "enabled"',
    '',
  ].join('\n');
}

function buildTargetProjectReadme(engine, detection, conversionOutputs, migrationLane) {
  const lines = [
    '# Shader Forge Migrated Project Skeleton',
    '',
    `Source engine: ${engine}`,
    `Detected version: ${detection.version || 'unknown'}`,
    `Active migration lane: ${migrationLane.activeLane}`,
    `Conversion confidence: ${migrationLane.conversionConfidence}`,
  ];

  if (migrationLane.preferredLane && migrationLane.preferredLane !== migrationLane.activeLane) {
    lines.push(`Preferred migration lane: ${migrationLane.preferredLane}`);
  }
  if (migrationLane.fallbackReason) {
    lines.push(`Fallback note: ${migrationLane.fallbackReason}`);
  }

  lines.push(
    '',
    migrationLane.activeLane === 'unreal_offline_fallback'
      ? 'This is a first-pass migrated project skeleton emitted by the Phase 5.85 Unreal offline fallback slice.'
      : 'This is a first-pass migrated project skeleton emitted by the Phase 5.8 conversion slice.',
    'It contains text-backed scene, prefab, and bootstrap outputs plus script-porting manifests.',
    '',
    `Scenes: ${conversionOutputs.sceneFiles.length}`,
    `Prefabs: ${conversionOutputs.prefabFiles.length}`,
    `Data files: ${conversionOutputs.dataFiles.length}`,
    '',
  );

  return lines.join('\n');
}

function extractScriptSymbols(filePath, engine) {
  const source = fs.readFileSync(filePath, 'utf8');
  let symbols = [];
  if (engine === 'unity' || path.extname(filePath).toLowerCase() === '.cs') {
    symbols = [...source.matchAll(/\bclass\s+([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => trim(match[1]));
  } else if (engine === 'unreal') {
    symbols = [...source.matchAll(/\bclass\s+([A-Za-z_][A-Za-z0-9_]*)/g)].map((match) => trim(match[1]));
  } else {
    const className = firstRegexGroup(source, /\bclass_name\s+([A-Za-z_][A-Za-z0-9_]*)/, '');
    if (className) {
      symbols = [className];
    }
  }

  if (symbols.length === 0) {
    if (engine === 'unreal') {
      return [];
    }
    return [basenameWithoutExtension(filePath)];
  }
  return uniqueBy(symbols.filter(Boolean), (symbol) => normalizeToken(symbol));
}

function ensureFallbackPrefabsForScenes(scenes, prefabs, engine) {
  if (prefabs.length > 0 || scenes.length === 0) {
    return prefabs;
  }
  return scenes.map((scene) => ({
    name: normalizeToken(`${scene.name}_root`) || `${engine}_root`,
    displayName: `${scene.title} Root`,
    category: `migrated_${engine}`,
    spawnTag: `${engine}_root`,
    sourcePath: scene.sourcePath,
  }));
}

function ensureFallbackScenesForPrefabs(scenes, prefabs, engine) {
  if (scenes.length > 0 || prefabs.length === 0) {
    return scenes;
  }
  return [{
    name: normalizeToken(`${engine}_migration`) || `${engine}_migration`,
    title: `${displayNameFromToken(engine)} Migration`,
    primaryPrefab: prefabs[0].name,
    entityId: normalizeToken(`${prefabs[0].name}_instance`) || 'primary_instance',
    entityDisplayName: prefabs[0].displayName || displayNameFromToken(prefabs[0].name),
    sourcePath: prefabs[0].sourcePath,
  }];
}

function buildScriptPortManifestDocument(manifest) {
  return {
    schema: 'shader_forge.script_port_manifest',
    schema_version: 1,
    name: manifest.name,
    source_engine: manifest.sourceEngine,
    source_path: manifest.sourcePath,
    source_symbol: manifest.sourceSymbol,
    source_kind: manifest.sourceKind || 'source_symbol',
    extraction_confidence: manifest.extractionConfidence || 'medium',
    strategy: manifest.strategy || 'best_effort_manifest_only',
    status: manifest.status || 'manual_review_required',
    notes: Array.isArray(manifest.notes) && manifest.notes.length > 0
      ? manifest.notes
      : [
          'Generated from migration fixture or minimal source inspection.',
          'Review gameplay behavior manually before claiming parity.',
        ],
  };
}

function collectUnityConversionPlan(repoRoot, projectRoot) {
  const files = walkFiles(projectRoot);
  const prefabFiles = files.filter((filePath) => filePath.endsWith('.prefab'));
  const sceneFiles = files.filter((filePath) => filePath.endsWith('.unity'));
  const scriptFiles = files.filter((filePath) => filePath.endsWith('.cs'));

  let prefabs = uniqueBy(prefabFiles.map((filePath) => {
    const source = fs.readFileSync(filePath, 'utf8');
    const displayName = firstRegexGroup(source, /m_Name:\s*(.+)/, basenameWithoutExtension(filePath));
    return {
      name: normalizeToken(basenameWithoutExtension(filePath)) || normalizeToken(displayName) || 'unity_prefab',
      displayName: displayName || displayNameFromToken(basenameWithoutExtension(filePath)),
      category: 'migrated_unity',
      spawnTag: 'unity_prefab',
      sourcePath: relativePathFromRepo(repoRoot, filePath),
    };
  }), (item) => item.name);

  let scenes = sceneFiles.map((filePath, index) => {
    const source = fs.readFileSync(filePath, 'utf8');
    const rootName = firstRegexGroup(source, /m_Name:\s*(.+)/, basenameWithoutExtension(filePath));
    const sceneName = normalizeToken(basenameWithoutExtension(filePath)) || `unity_scene_${index + 1}`;
    const chosenPrefab = prefabs[Math.min(index, Math.max(prefabs.length - 1, 0))];
    return {
      name: sceneName,
      title: rootName || displayNameFromToken(sceneName),
      primaryPrefab: chosenPrefab?.name || '',
      entityId: normalizeToken(`${chosenPrefab?.name || sceneName}_instance`) || 'primary_instance',
      entityDisplayName: chosenPrefab?.displayName || rootName || displayNameFromToken(sceneName),
      sourcePath: relativePathFromRepo(repoRoot, filePath),
    };
  });

  prefabs = ensureFallbackPrefabsForScenes(scenes, prefabs, 'unity');
  scenes = ensureFallbackScenesForPrefabs(scenes, prefabs, 'unity').map((scene) => ({
    ...scene,
    primaryPrefab: scene.primaryPrefab || prefabs[0]?.name || '',
    entityId: scene.entityId || normalizeToken(`${prefabs[0]?.name || scene.name}_instance`) || 'primary_instance',
    entityDisplayName: scene.entityDisplayName || prefabs[0]?.displayName || displayNameFromToken(scene.name),
  }));

  const scriptManifests = uniqueBy(scriptFiles.flatMap((filePath) =>
    extractScriptSymbols(filePath, 'unity').map((symbol) => ({
      name: normalizeToken(symbol) || 'unity_script',
      sourcePath: relativePathFromRepo(repoRoot, filePath),
      sourceSymbol: symbol,
      sourceEngine: 'unity',
      sourceKind: 'source_class',
    }))), (item) => item.name);

  return { scenes, prefabs, scriptManifests };
}

function collectGodotConversionPlan(repoRoot, projectRoot) {
  const files = walkFiles(projectRoot);
  const sceneFiles = files.filter((filePath) => filePath.endsWith('.tscn') || filePath.endsWith('.scn'));
  const scriptFiles = files.filter((filePath) => filePath.endsWith('.gd') || filePath.endsWith('.cs'));

  const scenes = sceneFiles.map((filePath, index) => {
    const source = fs.readFileSync(filePath, 'utf8');
    const rootName = firstRegexGroup(source, /\[node\s+name="([^"]+)"/, basenameWithoutExtension(filePath));
    const sceneName = normalizeToken(basenameWithoutExtension(filePath)) || `godot_scene_${index + 1}`;
    const prefabName = normalizeToken(`${sceneName}_root`) || `${sceneName}_root`;
    return {
      name: sceneName,
      title: rootName || displayNameFromToken(sceneName),
      primaryPrefab: prefabName,
      entityId: normalizeToken(`${prefabName}_instance`) || 'primary_instance',
      entityDisplayName: rootName || displayNameFromToken(prefabName),
      sourcePath: relativePathFromRepo(repoRoot, filePath),
      sourceNodeType: firstRegexGroup(source, /type="([^"]+)"/, 'Node'),
    };
  });

  const prefabs = uniqueBy(scenes.map((scene) => ({
    name: scene.primaryPrefab,
    displayName: `${scene.title} Root`,
    category: 'migrated_godot',
    spawnTag: normalizeToken(scene.sourceNodeType || 'godot_node') || 'godot_node',
    sourcePath: scene.sourcePath,
  })), (item) => item.name);

  const scriptManifests = uniqueBy(scriptFiles.flatMap((filePath) =>
    extractScriptSymbols(filePath, 'godot').map((symbol) => ({
      name: normalizeToken(symbol) || 'godot_script',
      sourcePath: relativePathFromRepo(repoRoot, filePath),
      sourceSymbol: symbol,
      sourceEngine: 'godot',
      sourceKind: 'source_script',
    }))), (item) => item.name);

  return {
    scenes: ensureFallbackScenesForPrefabs(scenes, prefabs, 'godot'),
    prefabs: ensureFallbackPrefabsForScenes(scenes, prefabs, 'godot'),
    scriptManifests,
  };
}

function collectUnrealOfflineFallbackPlan(repoRoot, projectRoot) {
  const files = walkFiles(projectRoot);
  const mapFiles = files.filter((filePath) => filePath.endsWith('.umap'));
  const sourceFiles = files.filter((filePath) => filePath.endsWith('.h') || filePath.endsWith('.cpp'));
  const blueprintPackages = files
    .filter((filePath) => filePath.endsWith('.uasset'))
    .map((filePath) => ({
      filePath,
      kind: classifyUnrealAssetKind(path.relative(projectRoot, filePath).split(path.sep).join('/')),
    }))
    .filter((entry) => entry.kind === 'actor_blueprint' || entry.kind === 'widget_blueprint' || entry.kind === 'animation_blueprint');

  let prefabs = uniqueBy(sourceFiles.flatMap((filePath) =>
    extractScriptSymbols(filePath, 'unreal').map((symbol) => ({
      name: normalizeToken(symbol) || 'unreal_actor',
      displayName: symbol,
      category: 'migrated_unreal',
      spawnTag: 'unreal_actor',
      sourcePath: relativePathFromRepo(repoRoot, filePath),
    }))), (item) => item.name);

  prefabs = uniqueBy([
    ...prefabs,
    ...blueprintPackages
      .filter((entry) => entry.kind === 'actor_blueprint')
      .map((entry) => {
        const baseName = basenameWithoutExtension(entry.filePath);
        return {
          name: normalizeToken(baseName) || 'unreal_blueprint_actor',
          displayName: displayNameFromToken(baseName),
          category: 'migrated_unreal_blueprint',
          spawnTag: 'unreal_blueprint_actor',
          sourcePath: relativePathFromRepo(repoRoot, entry.filePath),
        };
      }),
  ], (item) => item.name);

  let scenes = mapFiles.map((filePath, index) => {
    const source = fs.readFileSync(filePath, 'utf8');
    const sceneName = normalizeToken(basenameWithoutExtension(filePath)) || `unreal_level_${index + 1}`;
    const chosenPrefab = prefabs[Math.min(index, Math.max(prefabs.length - 1, 0))];
    const mapTitle = trim(source) || displayNameFromToken(sceneName);
    return {
      name: sceneName,
      title: displayNameFromToken(sceneName),
      primaryPrefab: chosenPrefab?.name || '',
      entityId: normalizeToken(`${chosenPrefab?.name || sceneName}_instance`) || 'primary_instance',
      entityDisplayName: chosenPrefab?.displayName || mapTitle,
      sourcePath: relativePathFromRepo(repoRoot, filePath),
    };
  });

  prefabs = ensureFallbackPrefabsForScenes(scenes, prefabs, 'unreal');
  scenes = ensureFallbackScenesForPrefabs(scenes, prefabs, 'unreal').map((scene) => ({
    ...scene,
    primaryPrefab: scene.primaryPrefab || prefabs[0]?.name || '',
    entityId: scene.entityId || normalizeToken(`${prefabs[0]?.name || scene.name}_instance`) || 'primary_instance',
    entityDisplayName: scene.entityDisplayName || prefabs[0]?.displayName || displayNameFromToken(scene.name),
  }));

  const scriptManifests = uniqueBy(sourceFiles.flatMap((filePath) =>
    extractScriptSymbols(filePath, 'unreal').map((symbol) => ({
      name: normalizeToken(symbol) || 'unreal_symbol',
      sourcePath: relativePathFromRepo(repoRoot, filePath),
      sourceSymbol: symbol,
      sourceEngine: 'unreal',
      sourceKind: 'source_class',
      strategy: 'offline_source_class_manifest',
      notes: [
        'Generated from offline Unreal C++ source inspection.',
        'Actor placement, reflected properties, and Blueprint links still require manual review.',
      ],
    }))), (item) => item.name);

  const blueprintScriptManifests = blueprintPackages.map((entry) => {
    const baseName = basenameWithoutExtension(entry.filePath);
    return {
      name: normalizeToken(baseName) || 'unreal_blueprint',
      sourcePath: relativePathFromRepo(repoRoot, entry.filePath),
      sourceSymbol: displayNameFromToken(baseName),
      sourceEngine: 'unreal',
      sourceKind: entry.kind,
      extractionConfidence: 'low',
      strategy: 'offline_low_confidence_blueprint_manifest',
      notes: [
        'Generated from offline Unreal .uasset package-name inspection only.',
        'Blueprint graphs, components, pins, and engine-specific behavior were not parsed in this slice.',
      ],
    };
  });

  return {
    scenes,
    prefabs,
    scriptManifests: uniqueBy([...scriptManifests, ...blueprintScriptManifests], (item) => item.name),
  };
}

function collectConversionPlan(repoRoot, projectRoot, detection) {
  if (detection.engine === 'unity') {
    return collectUnityConversionPlan(repoRoot, projectRoot);
  }
  if (detection.engine === 'unreal') {
    return collectUnrealOfflineFallbackPlan(repoRoot, projectRoot);
  }
  return collectGodotConversionPlan(repoRoot, projectRoot);
}

function estimateSkippedItems(counts, engine, slice) {
  if (engine === 'unity') {
    return Number(counts.material_files || 0);
  }
  if (engine === 'unreal') {
    if (slice.conversionMode === 'unreal_offline_fallback_conversion') {
      return Math.max(Number(counts.asset_package_files || 0) - Number(counts.blueprint_package_files || 0), 0);
    }
    return Number(counts.asset_package_files || 0);
  }
  return Number(counts.resource_files || 0) + Number(counts.import_files || 0);
}

function writeProjectSkeleton(repoRoot, reportRoot, detection, targetRoots, plan, migrationLane) {
  const targetProjectRoot = path.join(reportRoot, 'shader-forge-project');
  const conversionOutputs = {
    targetProjectRoot: relativePathFromRepo(repoRoot, targetProjectRoot),
    sceneFiles: [],
    prefabFiles: [],
    dataFiles: [],
    scriptManifestFiles: [],
    assetPlaceholderFiles: [],
  };

  const firstSceneName = plan.scenes[0]?.name || `${detection.engine}_migration`;

  for (const scene of plan.scenes) {
    const outputPath = path.join(targetProjectRoot, targetRoots.content_scenes, `${scene.name}.scene.toml`);
    writeTextFile(outputPath, buildSceneToml(scene));
    conversionOutputs.sceneFiles.push(relativePathFromRepo(repoRoot, outputPath));
  }

  for (const prefab of plan.prefabs) {
    const outputPath = path.join(targetProjectRoot, targetRoots.content_prefabs, `${prefab.name}.prefab.toml`);
    writeTextFile(outputPath, buildPrefabToml(prefab));
    conversionOutputs.prefabFiles.push(relativePathFromRepo(repoRoot, outputPath));
  }

  const bootstrapPath = path.join(targetProjectRoot, targetRoots.content_data, 'runtime_bootstrap.data.toml');
  writeTextFile(bootstrapPath, buildDataToml(firstSceneName));
  conversionOutputs.dataFiles.push(relativePathFromRepo(repoRoot, bootstrapPath));

  const assetsSrcReadme = path.join(targetProjectRoot, targetRoots.assets_src, 'README.md');
  const assetsCookedReadme = path.join(targetProjectRoot, targetRoots.assets_cooked, 'README.md');
  writeTextFile(
    assetsSrcReadme,
    [
      '# Migrated Source Assets Placeholder',
      '',
      `Source engine: ${detection.engine}`,
      'This directory is reserved for later imported source assets.',
      '',
    ].join('\n'),
  );
  writeTextFile(
    assetsCookedReadme,
    [
      '# Migrated Cooked Assets Placeholder',
      '',
      `Source engine: ${detection.engine}`,
      'This directory is reserved for later cooked migrated assets.',
      '',
    ].join('\n'),
  );
  conversionOutputs.assetPlaceholderFiles.push(
    relativePathFromRepo(repoRoot, assetsSrcReadme),
    relativePathFromRepo(repoRoot, assetsCookedReadme),
  );

  for (const manifest of plan.scriptManifests) {
    const outputPath = path.join(reportRoot, 'script-porting', `${manifest.name}.port.toml`);
    writeTextFile(outputPath, stringifyToml(buildScriptPortManifestDocument(manifest)));
    conversionOutputs.scriptManifestFiles.push(relativePathFromRepo(repoRoot, outputPath));
  }

  writeTextFile(
    path.join(targetProjectRoot, 'README.md'),
    buildTargetProjectReadme(detection.engine, detection, conversionOutputs, migrationLane),
  );

  return {
    targetProjectRoot: conversionOutputs.targetProjectRoot,
    outputs: conversionOutputs,
    convertedItems: conversionOutputs.sceneFiles.length + conversionOutputs.prefabFiles.length + conversionOutputs.dataFiles.length,
    approximatedItems: conversionOutputs.scriptManifestFiles.length,
  };
}

function defaultRunId(engine, commandName) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-');
  return `${stamp}-${normalizeRunId(commandName)}-${engine}`;
}

function resolveProjectPath(repoRoot, projectPath) {
  if (!projectPath) {
    throw new Error('Migration commands require a source project path.');
  }
  return path.isAbsolute(projectPath) ? projectPath : path.join(repoRoot, projectPath);
}

function resolveOutputRoot(repoRoot, outputRoot) {
  const resolved = trim(outputRoot) || 'migration';
  return path.isAbsolute(resolved) ? resolved : path.join(repoRoot, resolved);
}

export async function createMigrationRun(options) {
  const repoRoot = path.resolve(options.repoRoot);
  const projectRoot = path.resolve(resolveProjectPath(repoRoot, options.projectPath));
  const commandName = normalizeToken(options.commandName || 'detect') || 'detect';
  const requestedEngine = normalizeToken(options.requestedEngine || '');
  const outputRoot = resolveOutputRoot(repoRoot, options.outputRoot);

  if (!fs.existsSync(projectRoot) || !fs.statSync(projectRoot).isDirectory()) {
    throw new Error(`Migration source path is not a directory: ${projectRoot}`);
  }

  const detection = detectSourceProject(projectRoot, requestedEngine);
  const runId = normalizeRunId(options.runId || '') || defaultRunId(detection.engine, commandName);
  const reportRoot = path.join(outputRoot, runId);
  const slice = determineMigrationSlice(commandName, detection);
  const targetRoots = buildTargetRoots(detection.engine);
  const support = buildSupportLevels(slice);
  const counts = collectSourceCounts(projectRoot, detection.engine);
  const warnings = buildWarnings(detection, requestedEngine, slice, counts, repoRoot);
  const manualTasks = buildManualTasks(detection.engine, targetRoots, slice, counts);

  ensureDirectory(reportRoot);
  ensureDirectory(path.join(reportRoot, 'script-porting'));

  const conversion = slice.generatedProjectSkeleton
    ? writeProjectSkeleton(repoRoot, reportRoot, detection, targetRoots, collectConversionPlan(repoRoot, projectRoot, detection), slice)
    : {
        targetProjectRoot: '',
        outputs: {
          targetProjectRoot: '',
          sceneFiles: [],
          prefabFiles: [],
          dataFiles: [],
          scriptManifestFiles: [],
          assetPlaceholderFiles: [],
        },
        convertedItems: 0,
        approximatedItems: 0,
      };

  const manifestPath = path.join(reportRoot, 'migration-manifest.toml');
  const reportPath = path.join(reportRoot, 'report.toml');
  const warningsPath = path.join(reportRoot, 'warnings.toml');
  const scriptPortingReadmePath = path.join(reportRoot, 'script-porting', 'README.md');

  const manifestDocument = {
    schema: 'shader_forge.migration_manifest',
    schema_version: 1,
    phase: slice.phase,
    command: commandName,
    requested_engine: requestedEngine,
    detected_engine: detection.engine,
    detected_version: detection.version,
    confidence: detection.confidence,
    conversion_mode: slice.conversionMode,
    source_root: relativePathFromRepo(repoRoot, projectRoot),
    output_root: relativePathFromRepo(repoRoot, reportRoot),
    target_project_root: conversion.targetProjectRoot,
    created_at: new Date().toISOString(),
    detection: {
      reason_count: detection.reasons.length,
      reasons: detection.reasons,
      project_marker: relativePathFromRepo(repoRoot, detection.projectMarker || projectRoot),
      source_roots: detection.sourceRoots,
    },
    source_counts: counts,
    conversion_counts: {
      converted_items: conversion.convertedItems,
      approximated_items: conversion.approximatedItems,
      skipped_items: estimateSkippedItems(counts, detection.engine, slice),
      scene_files: conversion.outputs.sceneFiles.length,
      prefab_files: conversion.outputs.prefabFiles.length,
      data_files: conversion.outputs.dataFiles.length,
      script_manifests: conversion.outputs.scriptManifestFiles.length,
    },
    conversion_outputs: {
      scene_files: conversion.outputs.sceneFiles,
      prefab_files: conversion.outputs.prefabFiles,
      data_files: conversion.outputs.dataFiles,
      script_manifest_files: conversion.outputs.scriptManifestFiles,
      asset_placeholder_files: conversion.outputs.assetPlaceholderFiles,
    },
    target_roots: targetRoots,
    migration_lane: {
      active: slice.activeLane,
      preferred: slice.preferredLane,
      conversion_confidence: slice.conversionConfidence,
      fallback_reason: slice.fallbackReason,
      exporter_manifest: detection.exporterManifestPath ? relativePathFromRepo(repoRoot, detection.exporterManifestPath) : '',
    },
    support,
    provenance: {
      source_project_root: relativePathFromRepo(repoRoot, projectRoot),
      project_marker: relativePathFromRepo(repoRoot, detection.projectMarker || projectRoot),
      source_roots: detection.sourceRoots.map((entry) => `${relativePathFromRepo(repoRoot, projectRoot)}/${entry}`),
      command: commandName,
    },
  };

  const reportDocument = {
    schema: 'shader_forge.migration_report',
    schema_version: 1,
    run_id: runId,
    phase: slice.phase,
    detected_engine: detection.engine,
    detected_version: detection.version,
    current_slice: slice.currentSlice,
    source_root: relativePathFromRepo(repoRoot, projectRoot),
    report_root: relativePathFromRepo(repoRoot, reportRoot),
    target_project_root: conversion.targetProjectRoot,
    converted_items: conversion.convertedItems,
    approximated_items: conversion.approximatedItems,
    skipped_items: estimateSkippedItems(counts, detection.engine, slice),
    manual_items: manualTasks.length,
    warning_count: warnings.length,
    migration_lane: {
      active: slice.activeLane,
      preferred: slice.preferredLane,
      conversion_confidence: slice.conversionConfidence,
      fallback_reason: slice.fallbackReason,
      exporter_manifest: detection.exporterManifestPath ? relativePathFromRepo(repoRoot, detection.exporterManifestPath) : '',
    },
    notes: slice.conversionMode === 'unreal_offline_fallback_conversion'
      ? [
          'An explicit Unreal offline-fallback project skeleton was generated for this migration run.',
          'Scenes and prefabs were derived from .uproject, .umap, .uasset package names, and source-class inspection rather than Unreal editor export data.',
          Number(counts.blueprint_package_files || 0) > 0
            ? 'Blueprint-like .uasset packages emitted low-confidence script-porting manifests and still require manual review.'
            : 'No Blueprint-like .uasset packages were detected in this fallback run.',
        ]
      : slice.conversionMode === 'project_skeleton_conversion'
        ? [
            'A first-pass Shader Forge project skeleton was generated for this migration run.',
            'Scenes and prefabs were converted into text-backed Shader Forge outputs using minimal fixture-aware extraction.',
            'Art, materials, runtime parity, and full gameplay translation still require follow-up.',
          ]
        : [
            'No content conversion is performed in this slice.',
            'This run only normalizes source-project detection, target layout intent, provenance, and manual follow-up.',
          ],
    support,
    conversion_outputs: {
      scene_files: conversion.outputs.sceneFiles,
      prefab_files: conversion.outputs.prefabFiles,
      data_files: conversion.outputs.dataFiles,
      script_manifest_files: conversion.outputs.scriptManifestFiles,
    },
    manual_tasks: {
      items: manualTasks,
    },
  };

  const warningsDocument = {
    schema: 'shader_forge.migration_warnings',
    schema_version: 1,
    run_id: runId,
    items: warnings,
  };

  writeTextFile(manifestPath, stringifyToml(manifestDocument));
  writeTextFile(reportPath, stringifyToml(reportDocument));
  writeTextFile(warningsPath, stringifyToml(warningsDocument));
  writeTextFile(
    scriptPortingReadmePath,
    slice.generatedProjectSkeleton
      ? [
          '# Script Porting Manifests',
          '',
          slice.conversionMode === 'unreal_offline_fallback_conversion'
            ? 'This directory now contains first-pass script porting manifests generated during the Unreal offline fallback lane.'
            : 'This directory now contains first-pass script porting manifests generated during migration.',
          'They are review inputs, not parity guarantees.',
          '',
        ].join('\n')
      : [
          '# Script Porting Placeholder',
          '',
          'This directory is reserved for future gameplay/code translation manifests.',
          'The current Phase 5.6 slice only establishes migration detection, normalized manifest/report output, and manual follow-up scaffolding.',
          '',
        ].join('\n'),
  );

  return {
    runId,
    commandName,
    conversionMode: slice.conversionMode,
    currentSlice: slice.currentSlice,
    phase: slice.phase,
    generatedProjectSkeleton: slice.generatedProjectSkeleton,
    migrationLane: {
      active: slice.activeLane,
      preferred: slice.preferredLane,
      conversionConfidence: slice.conversionConfidence,
      fallbackReason: slice.fallbackReason,
      exporterManifest: detection.exporterManifestPath ? relativePathFromRepo(repoRoot, detection.exporterManifestPath) : '',
    },
    requestedEngine,
    detection,
    support,
    counts,
    warnings,
    manualTasks,
    targetProjectRoot: conversion.targetProjectRoot,
    convertedItems: conversion.convertedItems,
    approximatedItems: conversion.approximatedItems,
    skippedItems: estimateSkippedItems(counts, detection.engine, slice),
    conversionOutputs: conversion.outputs,
    reportRoot: relativePathFromRepo(repoRoot, reportRoot),
    manifestPath: relativePathFromRepo(repoRoot, manifestPath),
    reportPath: relativePathFromRepo(repoRoot, reportPath),
    warningsPath: relativePathFromRepo(repoRoot, warningsPath),
    scriptPortingReadmePath: relativePathFromRepo(repoRoot, scriptPortingReadmePath),
  };
}

export function readMigrationReport(reportInputPath) {
  const targetPath = path.resolve(reportInputPath);
  const reportPath = fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()
    ? path.join(targetPath, 'report.toml')
    : targetPath;
  if (!fs.existsSync(reportPath) || !fs.statSync(reportPath).isFile()) {
    throw new Error(`Migration report was not found at ${reportPath}`);
  }
  return {
    reportPath,
    report: parseSimpleTomlDocument(reportPath),
  };
}

export function summarizeMigrationReport(reportInputPath) {
  const { reportPath, report } = readMigrationReport(reportInputPath);
  const support = report.support || {};
  const migrationLane = report.migration_lane || {};
  return {
    reportPath,
    lines: [
      'Migration report summary:',
      `- Report: ${reportPath}`,
      `- Run id: ${trim(report.run_id) || 'unknown'}`,
      `- Engine: ${trim(report.detected_engine) || 'unknown'}`,
      `- Slice: ${trim(report.current_slice) || 'unknown'}`,
      `- Active lane: ${trim(migrationLane.active) || 'unknown'}`,
      `- Conversion confidence: ${trim(migrationLane.conversion_confidence) || 'unknown'}`,
      `- Target project root: ${trim(report.target_project_root) || 'none'}`,
      `- Detection support: ${trim(support.detection) || 'unknown'}`,
      `- Asset conversion support: ${trim(support.asset_conversion) || 'unknown'}`,
      `- Scene conversion support: ${trim(support.scene_conversion) || 'unknown'}`,
      `- Script porting support: ${trim(support.script_porting) || 'unknown'}`,
      `- Converted items: ${Number(report.converted_items || 0)}`,
      `- Approximated items: ${Number(report.approximated_items || 0)}`,
      `- Manual tasks: ${Number(report.manual_items || 0)}`,
      `- Warnings: ${Number(report.warning_count || 0)}`,
    ],
  };
}
