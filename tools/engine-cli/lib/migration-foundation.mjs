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
  return {
    engine: 'unreal',
    score: reasons.length,
    reasons,
    version,
    projectMarker: projectFile,
    sourceRoots: ['Content', 'Config', 'Source'].filter((entry) => fs.existsSync(path.join(projectRoot, entry))),
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
    return {
      total_files: relativeFiles.length,
      level_files: countFiles(relativeFiles, (filePath) => filePath.endsWith('.umap')),
      asset_package_files: countFiles(relativeFiles, (filePath) => filePath.endsWith('.uasset')),
      source_files: countFiles(relativeFiles, (filePath) => filePath.endsWith('.cpp') || filePath.endsWith('.h')),
      config_files: countFiles(relativeFiles, (filePath) => filePath.endsWith('.ini')),
      project_files: countFiles(relativeFiles, (filePath) => filePath.endsWith('.uproject')),
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

function buildSupportLevels() {
  return {
    detection: 'Supported',
    asset_conversion: 'Manual',
    scene_conversion: 'Manual',
    script_porting: 'Manual',
    project_settings: 'BestEffort',
  };
}

function buildManualTasks(engine, targetRoots) {
  return [
    `Map source scenes or levels into ${targetRoots.content_scenes} once conversion lanes are implemented.`,
    `Map source prefabs or reusable actors into ${targetRoots.content_prefabs} using Shader Forge text-backed assets.`,
    `Review material, shader, and rendering differences before claiming runtime parity for ${engine} content.`,
    'Populate script-porting manifests and manual gameplay translation notes before attempting feature parity.',
  ];
}

function buildWarnings(detection, requestedEngine) {
  const warnings = [];
  if (!detection.version) {
    warnings.push('Source-engine version could not be read from the detected project markers.');
  }
  if (requestedEngine && detection.engine !== requestedEngine) {
    warnings.push(`Requested lane ${requestedEngine} does not match detected engine ${detection.engine}.`);
  }
  if (detection.engine === 'unreal') {
    warnings.push('Unreal conversion remains exporter-manifest first; raw .uasset conversion is not implemented in this slice.');
  }
  return warnings;
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
  const targetRoots = buildTargetRoots(detection.engine);
  const support = buildSupportLevels();
  const counts = collectSourceCounts(projectRoot, detection.engine);
  const warnings = buildWarnings(detection, requestedEngine);
  const manualTasks = buildManualTasks(detection.engine, targetRoots);

  ensureDirectory(reportRoot);
  ensureDirectory(path.join(reportRoot, 'script-porting'));

  const manifestPath = path.join(reportRoot, 'migration-manifest.toml');
  const reportPath = path.join(reportRoot, 'report.toml');
  const warningsPath = path.join(reportRoot, 'warnings.toml');
  const scriptPortingReadmePath = path.join(reportRoot, 'script-porting', 'README.md');

  const manifestDocument = {
    schema: 'shader_forge.migration_manifest',
    schema_version: 1,
    phase: '5_6_foundation',
    command: commandName,
    requested_engine: requestedEngine,
    detected_engine: detection.engine,
    detected_version: detection.version,
    confidence: detection.confidence,
    conversion_mode: 'detect_and_manifest_only',
    source_root: relativePathFromRepo(repoRoot, projectRoot),
    output_root: relativePathFromRepo(repoRoot, reportRoot),
    created_at: new Date().toISOString(),
    detection: {
      reason_count: detection.reasons.length,
      reasons: detection.reasons,
      project_marker: relativePathFromRepo(repoRoot, detection.projectMarker || projectRoot),
      source_roots: detection.sourceRoots,
    },
    source_counts: counts,
    target_roots: targetRoots,
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
    detected_engine: detection.engine,
    detected_version: detection.version,
    current_slice: 'foundation_detect_only',
    source_root: relativePathFromRepo(repoRoot, projectRoot),
    report_root: relativePathFromRepo(repoRoot, reportRoot),
    converted_items: 0,
    approximated_items: 0,
    skipped_items: 0,
    manual_items: manualTasks.length,
    warning_count: warnings.length,
    notes: [
      'No content conversion is performed in this slice.',
      'This run only normalizes source-project detection, target layout intent, provenance, and manual follow-up.',
    ],
    support,
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
    [
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
    requestedEngine,
    detection,
    support,
    counts,
    warnings,
    manualTasks,
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
  return {
    reportPath,
    lines: [
      'Migration report summary:',
      `- Report: ${reportPath}`,
      `- Run id: ${trim(report.run_id) || 'unknown'}`,
      `- Engine: ${trim(report.detected_engine) || 'unknown'}`,
      `- Slice: ${trim(report.current_slice) || 'unknown'}`,
      `- Detection support: ${trim(support.detection) || 'unknown'}`,
      `- Asset conversion support: ${trim(support.asset_conversion) || 'unknown'}`,
      `- Scene conversion support: ${trim(support.scene_conversion) || 'unknown'}`,
      `- Script porting support: ${trim(support.script_porting) || 'unknown'}`,
      `- Manual tasks: ${Number(report.manual_items || 0)}`,
      `- Warnings: ${Number(report.warning_count || 0)}`,
    ],
  };
}
