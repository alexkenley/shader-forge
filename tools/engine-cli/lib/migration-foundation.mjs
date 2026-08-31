import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

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
    const featureMatch = projectContent.match(/^config\/features\s*=.*?"([^"\r\n]+)"/m);
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
      asset_conversion: 'Manual',
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
      engine === 'godot'
        ? `Review mapped Godot text-scene hierarchy and explicit position, rotation, and scale fields under ${targetRoots.content_scenes}; transform matrices, instanced resources, and component payloads remain manual.`
        : engine === 'unity'
          ? `Review mapped Unity text-YAML GameObject hierarchy and local transforms under ${targetRoots.content_scenes}; prefab instances, component payloads, assets, and coordinate-system remediation remain manual.`
        : `Review generated scenes under ${targetRoots.content_scenes} and expand the first-pass hierarchy, transforms, plus component payloads beyond the current skeleton output.`,
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
      warnings.push('Unity conversion maps text-YAML GameObject and Transform/RectTransform hierarchy plus local position, quaternion rotation, and scale; prefab instances, component payloads, assets, and coordinate-system remediation are still manual.');
    } else if (detection.engine === 'godot') {
      warnings.push('Godot conversion maps text-scene node hierarchy plus explicit Vector3 position, rotation, and scale fields; transform matrices, resource instances, and component payload translation are still ahead.');
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

function unquoteSourceValue(value) {
  const normalized = trim(value);
  if (normalized.length >= 2 && normalized.startsWith('"') && normalized.endsWith('"')) {
    return normalized.slice(1, -1);
  }
  return normalized;
}

function sourceProjectPath(projectRoot, filePath) {
  return path.relative(projectRoot, filePath).split(path.sep).join('/');
}

function formatSceneNumber(value) {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function parseGodotVector(line, key, fallback, scale = 1) {
  const match = line.match(new RegExp(`^${key}\\s*=\\s*Vector3\\(([^)]+)\\)$`));
  if (!match) {
    return fallback;
  }
  const values = match[1].split(',').map((value) => Number(value.trim()) * scale);
  return values.length === 3 && values.every(Number.isFinite)
    ? values.map(formatSceneNumber).join(', ')
    : fallback;
}

function parseGodotSceneNodes(source) {
  const nodes = [];
  let current = null;
  for (const rawLine of source.split(/\r?\n/)) {
    const line = trim(rawLine);
    if (line.startsWith('[node ') && line.endsWith(']')) {
      const attributes = Object.fromEntries(
        [...line.matchAll(/([A-Za-z_][A-Za-z0-9_]*)="([^"]*)"/g)]
          .map((match) => [match[1], match[2]]),
      );
      if (!attributes.name) {
        current = null;
        continue;
      }
      current = {
        name: attributes.name,
        type: attributes.type || 'Node',
        parent: attributes.parent || '',
        position: '0, 0, 0',
        rotation: '0, 0, 0',
        scale: '1, 1, 1',
      };
      nodes.push(current);
      continue;
    }
    if (!current || line.startsWith('[')) {
      current = null;
      continue;
    }
    current.position = parseGodotVector(line, 'position', current.position);
    current.rotation = parseGodotVector(line, 'rotation', current.rotation, 180 / Math.PI);
    current.scale = parseGodotVector(line, 'scale', current.scale);
  }

  const rootName = nodes.find((node) => !node.parent)?.name || nodes[0]?.name || 'Root';
  return nodes.map((node) => ({
    ...node,
    sourceNodePath: !node.parent
      ? node.name
      : node.parent === '.'
        ? `${rootName}/${node.name}`
        : `${rootName}/${node.parent}/${node.name}`,
    sourceParentPath: !node.parent
      ? ''
      : node.parent === '.'
        ? rootName
        : `${rootName}/${node.parent}`,
  }));
}

function parseUnityYamlDocuments(source) {
  const documents = [];
  let current = null;
  for (const rawLine of source.split(/\r?\n/)) {
    const header = rawLine.match(/^---\s+!u!(\d+)\s+&(-?\d+)/);
    if (header) {
      current = { classId: Number(header[1]), fileId: header[2], lines: [] };
      documents.push(current);
    } else if (current) {
      current.lines.push(trim(rawLine));
    }
  }
  return documents;
}

function parseUnityInlineNumbers(lines, key, fields, fallback) {
  const line = lines.find((candidate) => candidate.startsWith(`${key}:`));
  const body = line?.match(/\{([^}]*)\}/)?.[1] || '';
  const values = Object.fromEntries(
    [...body.matchAll(/([A-Za-z_][A-Za-z0-9_]*):\s*([^,}]+)/g)]
      .map((match) => [match[1], Number(match[2].trim())]),
  );
  return fields.every((field) => Number.isFinite(values[field]))
    ? fields.map((field) => values[field])
    : fallback;
}

function parseUnityFileId(lines, key) {
  const line = lines.find((candidate) => candidate.startsWith(`${key}:`));
  return line?.match(/\{\s*fileID:\s*(-?\d+)\s*\}/)?.[1] || '';
}

function unityQuaternionToEuler(rotation) {
  const [x, y, z, w] = rotation;
  const length = Math.hypot(x, y, z, w);
  if (!Number.isFinite(length) || length === 0) {
    return '0, 0, 0';
  }
  const qx = x / length;
  const qy = y / length;
  const qz = z / length;
  const qw = w / length;
  const ySin = Math.max(-1, Math.min(1, 2 * ((qw * qy) - (qz * qx))));
  let xAngle;
  let yAngle;
  let zAngle;
  if (Math.abs(Math.abs(ySin) - 1) < 0.000001) {
    xAngle = 2 * Math.atan2(qx, qw);
    yAngle = Math.sign(ySin) * Math.PI / 2;
    zAngle = 0;
  } else {
    xAngle = Math.atan2(2 * ((qw * qx) + (qy * qz)), 1 - (2 * ((qx * qx) + (qy * qy))));
    yAngle = Math.asin(ySin);
    zAngle = Math.atan2(2 * ((qw * qz) + (qx * qy)), 1 - (2 * ((qy * qy) + (qz * qz))));
  }
  return [xAngle, yAngle, zAngle]
    .map((value) => formatSceneNumber(value * 180 / Math.PI))
    .join(', ');
}

function parseUnitySceneNodes(source) {
  const documents = parseUnityYamlDocuments(source);
  const transforms = documents
    .filter((document) => document.classId === 4 || document.classId === 224)
    .map((document) => ({
      fileId: document.fileId,
      gameObjectId: parseUnityFileId(document.lines, 'm_GameObject'),
      parentTransformId: parseUnityFileId(document.lines, 'm_Father'),
      position: parseUnityInlineNumbers(document.lines, 'm_LocalPosition', ['x', 'y', 'z'], [0, 0, 0]),
      rotation: parseUnityInlineNumbers(document.lines, 'm_LocalRotation', ['x', 'y', 'z', 'w'], [0, 0, 0, 1]),
      scale: parseUnityInlineNumbers(document.lines, 'm_LocalScale', ['x', 'y', 'z'], [1, 1, 1]),
    }));
  const transformByGameObject = new Map(transforms.map((transform) => [transform.gameObjectId, transform]));
  const gameObjectByTransform = new Map(transforms.map((transform) => [transform.fileId, transform.gameObjectId]));
  const nodes = documents
    .filter((document) => document.classId === 1)
    .map((document) => {
      const nameLine = document.lines.find((line) => line.startsWith('m_Name:')) || '';
      const name = trim(nameLine.slice('m_Name:'.length)).replace(/^"|"$/g, '') || `GameObject ${document.fileId}`;
      const transform = transformByGameObject.get(document.fileId);
      const parentFileId = transform ? gameObjectByTransform.get(transform.parentTransformId) || '' : '';
      return {
        fileId: document.fileId,
        name,
        parentFileId,
        position: (transform?.position || [0, 0, 0]).map(formatSceneNumber).join(', '),
        rotation: unityQuaternionToEuler(transform?.rotation || [0, 0, 0, 1]),
        scale: (transform?.scale || [1, 1, 1]).map(formatSceneNumber).join(', '),
      };
    });
  const nodeByFileId = new Map(nodes.map((node) => [node.fileId, node]));
  const pathCache = new Map();
  function resolvePath(node, visited = new Set()) {
    if (pathCache.has(node.fileId)) return pathCache.get(node.fileId);
    if (visited.has(node.fileId)) return node.name;
    const parent = nodeByFileId.get(node.parentFileId);
    const sourceNodePath = parent
      ? `${resolvePath(parent, new Set([...visited, node.fileId]))}/${node.name}`
      : node.name;
    pathCache.set(node.fileId, sourceNodePath);
    return sourceNodePath;
  }
  return nodes.map((node) => ({
    ...node,
    sourceNodePath: resolvePath(node),
    sourceNodeType: 'GameObject',
  }));
}

function stableSceneNames(scenes) {
  const counts = new Map();
  for (const scene of scenes) {
    counts.set(scene.name, (counts.get(scene.name) || 0) + 1);
  }
  return scenes.map((scene) => {
    if (counts.get(scene.name) === 1) {
      return scene;
    }
    const suffix = createHash('sha256').update(scene.sourceProjectPath).digest('hex').slice(0, 8);
    return { ...scene, name: `${scene.name}_${suffix}` };
  });
}

function readUnityStartupScene(projectRoot) {
  const sourceFile = 'ProjectSettings/EditorBuildSettings.asset';
  const content = readFileIfPresent(path.join(projectRoot, ...sourceFile.split('/')));
  let enabled = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = trim(rawLine);
    const enabledMatch = line.match(/^-\s+enabled:\s*(\d+)$/);
    if (enabledMatch) {
      enabled = enabledMatch[1] === '1';
      continue;
    }
    const pathMatch = line.match(/^path:\s*(.+)$/);
    if (enabled && pathMatch) {
      const sourceValue = unquoteSourceValue(pathMatch[1]).split('\\').join('/');
      return {
        declared: true,
        sourceFile,
        sourceKey: 'm_Scenes[first_enabled].path',
        sourceValue,
        resolvedSourcePath: sourceValue,
        reason: '',
      };
    }
  }
  return { declared: false, sourceFile, sourceKey: 'm_Scenes[first_enabled].path', sourceValue: '', resolvedSourcePath: '', reason: '' };
}

function readUnrealStartupScene(projectRoot) {
  const sourceFile = 'Config/DefaultEngine.ini';
  const content = readFileIfPresent(path.join(projectRoot, ...sourceFile.split('/')));
  let inGameMapsSettings = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = trim(rawLine);
    if (!line || line.startsWith(';') || line.startsWith('#')) {
      continue;
    }
    if (line.startsWith('[') && line.endsWith(']')) {
      inGameMapsSettings = line.slice(1, -1).toLowerCase() === '/script/enginesettings.gamemapssettings';
      continue;
    }
    if (!inGameMapsSettings) {
      continue;
    }
    const match = line.match(/^GameDefaultMap\s*=\s*(.+)$/i);
    if (!match) {
      continue;
    }
    const sourceValue = unquoteSourceValue(match[1]);
    const packagePath = sourceValue.split('.')[0];
    const resolvedSourcePath = packagePath.startsWith('/Game/')
      ? `Content/${packagePath.slice('/Game/'.length)}.umap`
      : '';
    return {
      declared: true,
      sourceFile,
      sourceKey: '[/Script/EngineSettings.GameMapsSettings].GameDefaultMap',
      sourceValue,
      resolvedSourcePath,
      reason: resolvedSourcePath ? '' : 'Only /Game/ Unreal startup maps are supported by the offline migration lane.',
    };
  }
  return { declared: false, sourceFile, sourceKey: '[/Script/EngineSettings.GameMapsSettings].GameDefaultMap', sourceValue: '', resolvedSourcePath: '', reason: '' };
}

function readGodotStartupScene(projectRoot) {
  const sourceFile = 'project.godot';
  const content = readFileIfPresent(path.join(projectRoot, sourceFile));
  let inApplication = false;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = trim(rawLine);
    if (!line || line.startsWith(';') || line.startsWith('#')) {
      continue;
    }
    if (line.startsWith('[') && line.endsWith(']')) {
      inApplication = line.slice(1, -1).toLowerCase() === 'application';
      continue;
    }
    if (!inApplication) {
      continue;
    }
    const match = line.match(/^run\/main_scene\s*=\s*(.+)$/);
    if (!match) {
      continue;
    }
    const sourceValue = unquoteSourceValue(match[1]);
    const resolvedSourcePath = sourceValue.startsWith('res://') ? sourceValue.slice('res://'.length) : '';
    return {
      declared: true,
      sourceFile,
      sourceKey: '[application].run/main_scene',
      sourceValue,
      resolvedSourcePath,
      reason: resolvedSourcePath ? '' : 'Godot uid:// startup scenes require UID resolution and are not converted in this slice.',
    };
  }
  return { declared: false, sourceFile, sourceKey: '[application].run/main_scene', sourceValue: '', resolvedSourcePath: '', reason: '' };
}

function bindStartupScene(setting, scenes) {
  const sortedScenes = [...scenes].sort((left, right) => {
    if (left.sourceProjectPath === right.sourceProjectPath) {
      return 0;
    }
    return left.sourceProjectPath < right.sourceProjectPath ? -1 : 1;
  });
  if (!setting.declared) {
    const fallback = sortedScenes[0];
    return {
      ...setting,
      status: fallback ? 'approximated' : 'skipped',
      targetScene: fallback?.name || '',
      reason: fallback
        ? 'The source project did not declare a startup scene; the first source-relative scene was selected deterministically.'
        : 'The source project did not declare a startup scene and no converted scene was available.',
    };
  }

  const expected = setting.resolvedSourcePath;
  const match = expected
    ? scenes.find((scene) => scene.sourceProjectPath === expected)
    : null;
  return {
    ...setting,
    status: match ? 'converted' : 'skipped',
    targetScene: match?.name || '',
    reason: match
      ? ''
      : setting.reason || `The declared startup scene ${setting.sourceValue} was not found among converted source scenes.`,
  };
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
  const entities = scene.entities?.length ? scene.entities : [{
    id: scene.entityId,
    displayName: scene.entityDisplayName,
    sourcePrefab: scene.primaryPrefab,
    parent: '',
    position: '0, 0, 0',
    rotation: '0, 0, 0',
    scale: '1, 1, 1',
    sourceNodePath: '',
    sourceNodeType: '',
  }];
  const lines = [
    'schema = "shader_forge.scene"',
    'schema_version = 1',
    `name = ${quoteTomlString(scene.name)}`,
    'owner_system = "scene_system"',
    'runtime_format = "flatbuffer"',
    ...(scene.sourcePath ? [`# migration_source_path = ${quoteTomlString(scene.sourcePath)}`] : []),
    '',
    `title = ${quoteTomlString(scene.title)}`,
    `primary_prefab = ${quoteTomlString(scene.primaryPrefab)}`,
  ];

  for (const entity of entities) {
    lines.push('');
    if (entity.sourceNodePath) lines.push(`# migration_source_node = ${quoteTomlString(entity.sourceNodePath)}`);
    if (entity.sourceNodeType) lines.push(`# migration_source_type = ${quoteTomlString(entity.sourceNodeType)}`);
    if (entity.sourceObjectId) lines.push(`# migration_source_object_id = ${quoteTomlString(entity.sourceObjectId)}`);
    lines.push(
      `[entity.${entity.id}]`,
      `display_name = ${quoteTomlString(entity.displayName)}`,
      `source_prefab = ${quoteTomlString(entity.sourcePrefab)}`,
      `parent = ${quoteTomlString(entity.parent)}`,
      `position = ${quoteTomlString(entity.position)}`,
      `rotation = ${quoteTomlString(entity.rotation)}`,
      `scale = ${quoteTomlString(entity.scale)}`,
    );
  }
  lines.push('');
  return lines.join('\n');
}

function buildPrefabToml(prefab) {
  return [
    'schema = "shader_forge.prefab"',
    'schema_version = 1',
    `name = ${quoteTomlString(prefab.name)}`,
    'owner_system = "scene_system"',
    'runtime_format = "flatbuffer"',
    ...(prefab.sourcePath ? [`# migration_source_path = ${quoteTomlString(prefab.sourcePath)}`] : []),
    ...(prefab.sourceNodePath ? [`# migration_source_node = ${quoteTomlString(prefab.sourceNodePath)}`] : []),
    ...(prefab.sourceNodeType ? [`# migration_source_type = ${quoteTomlString(prefab.sourceNodeType)}`] : []),
    ...(prefab.sourceObjectId ? [`# migration_source_object_id = ${quoteTomlString(prefab.sourceObjectId)}`] : []),
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

  const sourceScenes = stableSceneNames(sceneFiles.map((filePath, index) => {
    const source = fs.readFileSync(filePath, 'utf8');
    const nodes = parseUnitySceneNodes(source);
    const rootNode = nodes.find((node) => !node.parentFileId) || nodes[0];
    const rootName = rootNode?.name || firstRegexGroup(source, /m_Name:\s*(.+)/, basenameWithoutExtension(filePath));
    const sceneName = normalizeToken(basenameWithoutExtension(filePath)) || `unity_scene_${index + 1}`;
    const chosenPrefab = prefabs[Math.min(index, Math.max(prefabs.length - 1, 0))];
    return {
      name: sceneName,
      title: rootName || displayNameFromToken(sceneName),
      primaryPrefab: chosenPrefab?.name || '',
      entityId: normalizeToken(`${chosenPrefab?.name || sceneName}_instance`) || 'primary_instance',
      entityDisplayName: chosenPrefab?.displayName || rootName || displayNameFromToken(sceneName),
      sourcePath: relativePathFromRepo(repoRoot, filePath),
      sourceProjectPath: sourceProjectPath(projectRoot, filePath),
      mappedNodeCount: nodes.length,
      nodes,
    };
  }));

  const allocatedPrefabNames = new Set(prefabs.map((prefab) => prefab.name));
  const sceneNodePrefabs = [];
  let scenes = sourceScenes.map((scene) => {
    if (scene.nodes.length === 0) {
      return scene;
    }
    const entityIdByFileId = new Map();
    const prefabNameByFileId = new Map();
    const primaryRootFileId = scene.nodes.find((node) => !node.parentFileId)?.fileId || scene.nodes[0].fileId;
    for (const [index, node] of scene.nodes.entries()) {
      const baseName = node.fileId === primaryRootFileId
        ? `${scene.name}_root`
        : `${scene.name}_${node.sourceNodePath
          .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
          .split('/')
          .join('_')}`;
      const normalizedBaseName = normalizeToken(baseName) || `${scene.name}_object_${index + 1}`;
      let prefabName = normalizedBaseName;
      if (allocatedPrefabNames.has(prefabName)) {
        const suffix = createHash('sha256').update(`${node.sourceNodePath}:${node.fileId}`).digest('hex').slice(0, 8);
        prefabName = `${normalizedBaseName}_${suffix}`;
      }
      if (allocatedPrefabNames.has(prefabName)) {
        prefabName = `${prefabName}_${index + 1}`;
      }
      allocatedPrefabNames.add(prefabName);
      prefabNameByFileId.set(node.fileId, prefabName);
      entityIdByFileId.set(node.fileId, `${prefabName}_instance`);
      sceneNodePrefabs.push({
        name: prefabName,
        displayName: node.name,
        category: 'migrated_unity',
        spawnTag: 'unity_game_object',
        sourcePath: scene.sourcePath,
        sourceNodePath: node.sourceNodePath,
        sourceNodeType: node.sourceNodeType,
        sourceObjectId: node.fileId,
      });
    }
    const entities = scene.nodes.map((node) => ({
      id: entityIdByFileId.get(node.fileId),
      displayName: node.name,
      sourcePrefab: prefabNameByFileId.get(node.fileId),
      parent: entityIdByFileId.get(node.parentFileId) || '',
      position: node.position,
      rotation: node.rotation,
      scale: node.scale,
      sourceNodePath: node.sourceNodePath,
      sourceNodeType: node.sourceNodeType,
      sourceObjectId: node.fileId,
    }));
    const rootEntity = entities.find((entity) => !entity.parent) || entities[0];
    return {
      ...scene,
      title: rootEntity?.displayName || scene.title,
      primaryPrefab: rootEntity?.sourcePrefab || scene.primaryPrefab,
      entityId: rootEntity?.id || scene.entityId,
      entityDisplayName: rootEntity?.displayName || scene.entityDisplayName,
      entities,
    };
  });
  prefabs = uniqueBy([...prefabs, ...sceneNodePrefabs], (item) => item.name);

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

  return {
    scenes,
    prefabs,
    scriptManifests,
    startupScene: bindStartupScene(readUnityStartupScene(projectRoot), scenes),
  };
}

function collectGodotConversionPlan(repoRoot, projectRoot) {
  const files = walkFiles(projectRoot);
  const sceneFiles = files.filter((filePath) => filePath.endsWith('.tscn') || filePath.endsWith('.scn'));
  const scriptFiles = files.filter((filePath) => filePath.endsWith('.gd') || filePath.endsWith('.cs'));

  const sourceScenes = stableSceneNames(sceneFiles.map((filePath, index) => {
    const source = fs.readFileSync(filePath, 'utf8');
    const parsedNodes = parseGodotSceneNodes(source);
    const rootName = parsedNodes[0]?.name || basenameWithoutExtension(filePath);
    const nodes = parsedNodes.length ? parsedNodes : [{
      name: rootName,
      type: 'Node',
      parent: '',
      position: '0, 0, 0',
      rotation: '0, 0, 0',
      scale: '1, 1, 1',
      sourceNodePath: rootName,
      sourceParentPath: '',
    }];
    const sceneName = normalizeToken(basenameWithoutExtension(filePath)) || `godot_scene_${index + 1}`;
    return {
      name: sceneName,
      title: rootName || displayNameFromToken(sceneName),
      sourcePath: relativePathFromRepo(repoRoot, filePath),
      sourceProjectPath: sourceProjectPath(projectRoot, filePath),
      mappedNodeCount: parsedNodes.length,
      nodes,
    };
  }));

  const scenes = sourceScenes.map((scene) => {
    const sourceNodeIds = new Map();
    const sourcePrefabNames = new Map();
    const allocatedPrefabNames = new Map();
    for (const [index, node] of scene.nodes.entries()) {
      const baseName = index === 0
        ? `${scene.name}_root`
        : `${scene.name}_${node.sourceNodePath.split('/').join('_')}`;
      let prefabName = normalizeToken(baseName) || `${scene.name}_node_${index + 1}`;
      if (allocatedPrefabNames.has(prefabName)) {
        const suffix = createHash('sha256').update(node.sourceNodePath).digest('hex').slice(0, 8);
        prefabName = `${prefabName}_${suffix}`;
      }
      allocatedPrefabNames.set(prefabName, node.sourceNodePath);
      sourceNodeIds.set(node.sourceNodePath, `${prefabName}_instance`);
      sourcePrefabNames.set(node.sourceNodePath, prefabName);
    }
    const entities = scene.nodes.map((node) => ({
      id: sourceNodeIds.get(node.sourceNodePath),
      displayName: node.name,
      sourcePrefab: sourcePrefabNames.get(node.sourceNodePath),
      parent: sourceNodeIds.get(node.sourceParentPath) || '',
      position: node.position,
      rotation: node.rotation,
      scale: node.scale,
      sourceNodePath: node.sourceNodePath,
      sourceNodeType: node.type,
    }));
    const rootEntity = entities[0];
    return {
      ...scene,
      primaryPrefab: rootEntity?.sourcePrefab || `${scene.name}_root`,
      entityId: rootEntity?.id || `${scene.name}_root_instance`,
      entityDisplayName: rootEntity?.displayName || scene.title,
      entities,
    };
  });

  const prefabs = uniqueBy(scenes.flatMap((scene) => scene.entities.map((entity) => ({
    name: entity.sourcePrefab,
    displayName: entity.displayName,
    category: 'migrated_godot',
    spawnTag: normalizeToken(entity.sourceNodeType || 'godot_node') || 'godot_node',
    sourcePath: scene.sourcePath,
    sourceNodePath: entity.sourceNodePath,
    sourceNodeType: entity.sourceNodeType,
  }))), (item) => item.name);

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
    startupScene: bindStartupScene(readGodotStartupScene(projectRoot), scenes),
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

  let scenes = stableSceneNames(mapFiles.map((filePath, index) => {
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
      sourceProjectPath: sourceProjectPath(projectRoot, filePath),
    };
  }));

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
    startupScene: bindStartupScene(readUnrealStartupScene(projectRoot), scenes),
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

  const bootstrapRelativePath = `${targetRoots.content_data}/runtime_bootstrap.data.toml`;
  if (plan.startupScene.targetScene) {
    const bootstrapPath = path.join(targetProjectRoot, ...bootstrapRelativePath.split('/'));
    writeTextFile(bootstrapPath, buildDataToml(plan.startupScene.targetScene));
    conversionOutputs.dataFiles.push(relativePathFromRepo(repoRoot, bootstrapPath));
  }

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
    approximatedItems: conversionOutputs.scriptManifestFiles.length + (plan.startupScene.status === 'approximated' ? 1 : 0),
    mappedSceneEntities: plan.scenes.reduce(
      (count, scene) => count + (scene.mappedNodeCount ?? scene.entities?.length ?? (scene.entityId ? 1 : 0)),
      0,
    ),
    startupScene: {
      source_file: plan.startupScene.sourceFile,
      source_key: plan.startupScene.sourceKey,
      source_value: plan.startupScene.sourceValue,
      resolved_source_path: plan.startupScene.resolvedSourcePath,
      target_file: plan.startupScene.targetScene ? bootstrapRelativePath : '',
      target_key: plan.startupScene.targetScene ? 'default_scene' : '',
      target_value: plan.startupScene.targetScene,
      status: plan.startupScene.status,
      reason: plan.startupScene.reason,
    },
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
  const conversionPlan = slice.generatedProjectSkeleton
    ? collectConversionPlan(repoRoot, projectRoot, detection)
    : null;
  const warnings = buildWarnings(detection, requestedEngine, slice, counts, repoRoot);
  const manualTasks = buildManualTasks(detection.engine, targetRoots, slice, counts);

  if (conversionPlan?.startupScene.status === 'approximated') {
    warnings.push(`${conversionPlan.startupScene.reason} Review the generated runtime bootstrap before treating it as source-authoritative.`);
  }
  if (conversionPlan?.startupScene.declared && conversionPlan.startupScene.status === 'skipped') {
    warnings.push(`${conversionPlan.startupScene.reason} No runtime bootstrap was generated.`);
    manualTasks.push(`Resolve the declared startup scene ${conversionPlan.startupScene.sourceValue} from ${conversionPlan.startupScene.sourceFile}, then author ${targetRoots.content_data}/runtime_bootstrap.data.toml.`);
  }

  ensureDirectory(reportRoot);
  ensureDirectory(path.join(reportRoot, 'script-porting'));

  const conversion = slice.generatedProjectSkeleton
    ? writeProjectSkeleton(repoRoot, reportRoot, detection, targetRoots, conversionPlan, slice)
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
        mappedSceneEntities: 0,
        startupScene: {
          source_file: '',
          source_key: '',
          source_value: '',
          resolved_source_path: '',
          target_file: '',
          target_key: '',
          target_value: '',
          status: 'not_applicable',
          reason: 'Detection-only migration runs do not convert project startup settings.',
        },
      };

  const convertedProjectSettings = conversion.startupScene.status === 'converted' ? 1 : 0;
  const approximatedProjectSettings = conversion.startupScene.status === 'approximated' ? 1 : 0;
  const skippedProjectSettings = conversion.startupScene.status === 'skipped' ? 1 : 0;
  const skippedItems = estimateSkippedItems(counts, detection.engine, slice) + skippedProjectSettings;

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
      skipped_items: skippedItems,
      converted_project_settings: convertedProjectSettings,
      approximated_project_settings: approximatedProjectSettings,
      skipped_project_settings: skippedProjectSettings,
      scene_files: conversion.outputs.sceneFiles.length,
      prefab_files: conversion.outputs.prefabFiles.length,
      data_files: conversion.outputs.dataFiles.length,
      script_manifests: conversion.outputs.scriptManifestFiles.length,
      mapped_scene_entities: conversion.mappedSceneEntities,
    },
    conversion_outputs: {
      scene_files: conversion.outputs.sceneFiles,
      prefab_files: conversion.outputs.prefabFiles,
      data_files: conversion.outputs.dataFiles,
      script_manifest_files: conversion.outputs.scriptManifestFiles,
      asset_placeholder_files: conversion.outputs.assetPlaceholderFiles,
    },
    startup_scene: conversion.startupScene,
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
    skipped_items: skippedItems,
    converted_project_settings: convertedProjectSettings,
    approximated_project_settings: approximatedProjectSettings,
    skipped_project_settings: skippedProjectSettings,
    mapped_scene_entities: conversion.mappedSceneEntities,
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
    startup_scene: conversion.startupScene,
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
    mappedSceneEntities: conversion.mappedSceneEntities,
    skippedItems,
    startupScene: conversion.startupScene,
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
