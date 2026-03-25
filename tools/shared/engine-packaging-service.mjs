import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const bundledPresetRoot = path.join(repoRoot, 'tooling', 'export-presets');
const defaultPresetId = 'default';
const packageReportSchema = 'shader_forge.package_report';
const exportInspectSchema = 'shader_forge.export_inspect';
const hashAlgorithm = 'sha256';
const runtimeBinaryName = process.platform === 'win32' ? 'shader_forge_runtime.exe' : 'shader_forge_runtime';

function trim(value) {
  return String(value || '').trim();
}

function normalizeSlashes(value) {
  return String(value || '').replace(/\\/g, '/');
}

function relativePathFromRoot(rootPath, targetPath) {
  const relativePath = normalizeSlashes(path.relative(rootPath, targetPath));
  return relativePath || '.';
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

function parseSimpleTomlDocument(content) {
  const result = {};
  let currentSection = result;

  for (const rawLine of String(content || '').split(/\r?\n/)) {
    const line = trim(rawLine);
    if (!line || line.startsWith('#')) {
      continue;
    }
    if (line.startsWith('[') && line.endsWith(']')) {
      const sectionPath = line.slice(1, -1).split('.').map(trim).filter(Boolean);
      if (!sectionPath.length) {
        currentSection = result;
        continue;
      }
      currentSection = result;
      for (const sectionName of sectionPath) {
        if (!currentSection[sectionName] || typeof currentSection[sectionName] !== 'object') {
          currentSection[sectionName] = {};
        }
        currentSection = currentSection[sectionName];
      }
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

async function readTomlFile(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return parseSimpleTomlDocument(content);
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function statIfExists(targetPath) {
  try {
    return await fs.stat(targetPath);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function ensureDirectory(targetPath) {
  await fs.mkdir(targetPath, { recursive: true });
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((entry) => trim(entry)).filter(Boolean);
}

function normalizePreset(presetId, parsed) {
  const source = parsed && typeof parsed === 'object' ? parsed : {};
  return {
    schema: trim(source.schema) || 'shader_forge.export_preset',
    name: trim(source.name) || presetId || defaultPresetId,
    label: trim(source.label) || trim(source.name) || presetId || defaultPresetId,
    platform: trim(source.platform) || 'desktop',
    runtimeConfig: trim(source.runtime_config) || 'Debug',
    launchScene: trim(source.launch_scene) || 'sandbox',
    runtimeBinary: trim(source.runtime_binary) || normalizeSlashes(path.join('build', 'runtime', 'bin', runtimeBinaryName)),
    inputRoot: trim(source.input_root) || 'input',
    contentRoot: trim(source.content_root) || 'content',
    audioRoot: trim(source.audio_root) || 'audio',
    animationRoot: trim(source.animation_root) || 'animation',
    physicsRoot: trim(source.physics_root) || 'physics',
    dataFoundation: trim(source.data_foundation) || normalizeSlashes(path.join('data', 'foundation', 'engine-data-layout.toml')),
    toolingLayout: trim(source.tooling_layout) || normalizeSlashes(path.join('tooling', 'layouts', 'default.tooling-layout.toml')),
    cookedRoot: trim(source.cooked_root) || normalizeSlashes(path.join('build', 'cooked')),
    packageRoot: trim(source.package_root) || normalizeSlashes(path.join('build', 'package', presetId || defaultPresetId)),
    platformHooks: normalizeStringArray(source.platform_hooks),
  };
}

async function loadPackagingPreset(rootPath, presetId = defaultPresetId) {
  const resolvedRoot = path.resolve(rootPath || repoRoot);
  const requestedPresetId = trim(presetId) || defaultPresetId;
  const candidatePaths = [
    {
      filePath: path.join(resolvedRoot, 'tooling', 'export-presets', `${requestedPresetId}.export-preset.toml`),
      source: 'workspace',
    },
    {
      filePath: path.join(bundledPresetRoot, `${requestedPresetId}.export-preset.toml`),
      source: 'bundled',
    },
  ];

  for (const candidate of candidatePaths) {
    try {
      const parsed = await readTomlFile(candidate.filePath);
      return {
        rootPath: resolvedRoot,
        presetId: requestedPresetId,
        presetPath: candidate.filePath,
        presetSource: candidate.source,
        preset: normalizePreset(requestedPresetId, parsed),
      };
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  throw new Error(`No export preset found for "${requestedPresetId}" under tooling/export-presets/.`);
}

function resolveWorkspacePath(rootPath, relativeOrAbsolutePath) {
  if (path.isAbsolute(relativeOrAbsolutePath)) {
    return relativeOrAbsolutePath;
  }
  return path.join(rootPath, relativeOrAbsolutePath);
}

async function resolveRuntimeBinaryPath(rootPath, configuredBinaryPath) {
  const primaryPath = resolveWorkspacePath(rootPath, configuredBinaryPath);
  if (await pathExists(primaryPath)) {
    return primaryPath;
  }
  if (!primaryPath.endsWith('.exe')) {
    const windowsCandidate = `${primaryPath}.exe`;
    if (await pathExists(windowsCandidate)) {
      return windowsCandidate;
    }
  }
  if (primaryPath.endsWith('.exe')) {
    const unixCandidate = primaryPath.slice(0, -4);
    if (await pathExists(unixCandidate)) {
      return unixCandidate;
    }
  }
  return primaryPath;
}

async function readJsonIfExists(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') {
      throw error;
    }
    return null;
  }
}

function summarizeCookedAssetReport(report) {
  if (!report || typeof report !== 'object') {
    return {
      assetCount: 0,
      generatedMeshCount: 0,
      audioSoundCount: 0,
      audioEventCount: 0,
      animationClipCount: 0,
      animationGraphCount: 0,
      physicsBodyCount: 0,
    };
  }
  return {
    assetCount: Array.isArray(report.bakedAssets) ? report.bakedAssets.length : 0,
    generatedMeshCount: Array.isArray(report.generatedMeshes) ? report.generatedMeshes.length : 0,
    audioSoundCount: Array.isArray(report.audio?.bakedSounds) ? report.audio.bakedSounds.length : 0,
    audioEventCount: Array.isArray(report.audio?.bakedEvents) ? report.audio.bakedEvents.length : 0,
    animationClipCount: Array.isArray(report.animation?.bakedClips) ? report.animation.bakedClips.length : 0,
    animationGraphCount: Array.isArray(report.animation?.bakedGraphs) ? report.animation.bakedGraphs.length : 0,
    physicsBodyCount: Array.isArray(report.physics?.bakedBodies) ? report.physics.bakedBodies.length : 0,
  };
}

function childPath(rootPath, relativePath) {
  return {
    relativePath: normalizeSlashes(relativePath),
    absolutePath: resolveWorkspacePath(rootPath, relativePath),
  };
}

function normalizePackageRoot(rootPath, overridePath, fallbackPath) {
  const absolutePath = resolveWorkspacePath(rootPath, overridePath || fallbackPath);
  const relativePath = path.relative(rootPath, absolutePath);
  if (!relativePath || relativePath === '' || relativePath === '.') {
    throw new Error('Package root must be a child directory inside the workspace root.');
  }
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Package root must stay inside the workspace root.');
  }
  return {
    absolutePath,
    relativePath: normalizeSlashes(relativePath),
  };
}

async function hashFile(filePath) {
  const content = await fs.readFile(filePath);
  return createHash(hashAlgorithm).update(content).digest('hex');
}

async function collectFileManifest(rootPath, directoryPath) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true });
  const sortedEntries = [...entries].sort((left, right) => left.name.localeCompare(right.name));
  const files = [];
  for (const entry of sortedEntries) {
    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFileManifest(rootPath, absolutePath)));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const stats = await fs.stat(absolutePath);
    files.push({
      path: relativePathFromRoot(rootPath, absolutePath),
      size: stats.size,
      sha256: await hashFile(absolutePath),
    });
  }
  return files;
}

async function copyPath(sourcePath, targetPath) {
  const stats = await fs.stat(sourcePath);
  if (stats.isDirectory()) {
    await fs.cp(sourcePath, targetPath, { recursive: true });
    return;
  }
  await ensureDirectory(path.dirname(targetPath));
  await fs.copyFile(sourcePath, targetPath);
}

function unixLauncherScript({ binaryName, scene, manifestPath }) {
  return [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"',
    `"${'$'}{SCRIPT_DIR}/bin/${binaryName}" \\`,
    `  --scene "${scene}" \\`,
    `  --input-root "${'$'}{SCRIPT_DIR}/input" \\`,
    `  --content-root "${'$'}{SCRIPT_DIR}/content" \\`,
    `  --audio-root "${'$'}{SCRIPT_DIR}/audio" \\`,
    `  --animation-root "${'$'}{SCRIPT_DIR}/animation" \\`,
    `  --physics-root "${'$'}{SCRIPT_DIR}/physics" \\`,
    `  --data-foundation "${'$'}{SCRIPT_DIR}/data/foundation/engine-data-layout.toml" \\`,
    `  --tooling-layout "${'$'}{SCRIPT_DIR}/tooling/layouts/default.tooling-layout.toml"`,
    '',
    `# Runtime launch manifest: ${manifestPath}`,
  ].join('\n');
}

function windowsLauncherScript({ binaryName, scene, manifestPath }) {
  return [
    '@echo off',
    'setlocal',
    'set "SCRIPT_DIR=%~dp0"',
    `"${'%SCRIPT_DIR%'}bin\\${binaryName}" ^`,
    `  --scene ${scene} ^`,
    '  --input-root "%SCRIPT_DIR%input" ^',
    '  --content-root "%SCRIPT_DIR%content" ^',
    '  --audio-root "%SCRIPT_DIR%audio" ^',
    '  --animation-root "%SCRIPT_DIR%animation" ^',
    '  --physics-root "%SCRIPT_DIR%physics" ^',
    '  --data-foundation "%SCRIPT_DIR%data\\foundation\\engine-data-layout.toml" ^',
    '  --tooling-layout "%SCRIPT_DIR%tooling\\layouts\\default.tooling-layout.toml"',
    '',
    `REM Runtime launch manifest: ${manifestPath}`,
  ].join('\r\n');
}

function buildLaunchManifest(summary, packagedBinaryRelativePath) {
  return {
    schema: 'shader_forge.package_launch_manifest',
    version: 1,
    generatedAt: new Date().toISOString(),
    presetId: summary.presetId,
    label: summary.label,
    runtimeConfig: summary.runtimeConfig,
    scene: summary.launchScene,
    executablePath: normalizeSlashes(packagedBinaryRelativePath),
    inputRoot: 'input',
    contentRoot: 'content',
    audioRoot: 'audio',
    animationRoot: 'animation',
    physicsRoot: 'physics',
    dataFoundation: 'data/foundation/engine-data-layout.toml',
    toolingLayout: 'tooling/layouts/default.tooling-layout.toml',
    cookedRoot: 'cooked',
    note: 'Cooked outputs are bundled in the release layout, but the current runtime launch scripts still point at packaged authored roots until cooked-runtime loading exists.',
  };
}

function buildWarnings(summary) {
  const warnings = [...summary.warnings];
  warnings.push('Current package launchers still target packaged authored asset roots; cooked outputs are bundled alongside the layout for later runtime integration.');
  if (summary.platformHooks.length) {
    warnings.push('Declared platform hooks are recorded in the package report, but hook execution is still a later slice.');
  }
  return warnings;
}

export async function inspectPackagingPreset(rootPath, options = {}) {
  const { rootPath: resolvedRoot, presetId, presetPath, presetSource, preset } = await loadPackagingPreset(
    rootPath,
    options.presetId || defaultPresetId,
  );
  const runtimeBinaryPath = await resolveRuntimeBinaryPath(resolvedRoot, preset.runtimeBinary);
  const inputRoot = childPath(resolvedRoot, preset.inputRoot);
  const contentRoot = childPath(resolvedRoot, preset.contentRoot);
  const audioRoot = childPath(resolvedRoot, preset.audioRoot);
  const animationRoot = childPath(resolvedRoot, preset.animationRoot);
  const physicsRoot = childPath(resolvedRoot, preset.physicsRoot);
  const dataFoundation = childPath(resolvedRoot, preset.dataFoundation);
  const toolingLayout = childPath(resolvedRoot, preset.toolingLayout);
  const cookedRoot = childPath(resolvedRoot, preset.cookedRoot);
  const packageRoot = normalizePackageRoot(resolvedRoot, options.packageRoot ? String(options.packageRoot) : '', preset.packageRoot);
  const assetReportPath = path.join(cookedRoot.absolutePath, 'asset-pipeline-report.json');
  const packageReportPath = path.join(packageRoot.absolutePath, 'reports', 'package-report.json');
  const assetReport = await readJsonIfExists(assetReportPath);
  const lastPackageReport = await readJsonIfExists(packageReportPath);
  const assetSummary = summarizeCookedAssetReport(assetReport);

  const checks = [
    { key: 'runtimeBinaryExists', label: 'runtime binary', path: runtimeBinaryPath },
    { key: 'inputRootExists', label: 'input root', path: inputRoot.absolutePath },
    { key: 'contentRootExists', label: 'content root', path: contentRoot.absolutePath },
    { key: 'audioRootExists', label: 'audio root', path: audioRoot.absolutePath },
    { key: 'animationRootExists', label: 'animation root', path: animationRoot.absolutePath },
    { key: 'physicsRootExists', label: 'physics root', path: physicsRoot.absolutePath },
    { key: 'dataFoundationExists', label: 'data foundation', path: dataFoundation.absolutePath },
    { key: 'toolingLayoutExists', label: 'tooling layout', path: toolingLayout.absolutePath },
    { key: 'cookedRootExists', label: 'cooked root', path: cookedRoot.absolutePath },
  ];

  const existence = {};
  const warnings = [];
  for (const check of checks) {
    const exists = await pathExists(check.path);
    existence[check.key] = exists;
    if (!exists) {
      warnings.push(`Missing ${check.label} at ${relativePathFromRoot(resolvedRoot, check.path)}.`);
    }
  }

  if (!assetReport) {
    warnings.push(`Missing cooked asset report at ${relativePathFromRoot(resolvedRoot, assetReportPath)}.`);
  }

  return {
    schema: exportInspectSchema,
    version: 1,
    rootPath: resolvedRoot,
    presetId,
    label: preset.label,
    platform: preset.platform,
    runtimeConfig: preset.runtimeConfig,
    launchScene: preset.launchScene,
    presetPath,
    presetSource,
    runtimeBinaryPath: relativePathFromRoot(resolvedRoot, runtimeBinaryPath),
    inputRootPath: inputRoot.relativePath,
    contentRootPath: contentRoot.relativePath,
    audioRootPath: audioRoot.relativePath,
    animationRootPath: animationRoot.relativePath,
    physicsRootPath: physicsRoot.relativePath,
    dataFoundationPath: dataFoundation.relativePath,
    toolingLayoutPath: toolingLayout.relativePath,
    cookedRootPath: cookedRoot.relativePath,
    assetReportPath: relativePathFromRoot(resolvedRoot, assetReportPath),
    packageRootPath: packageRoot.relativePath,
    packageReportPath: relativePathFromRoot(resolvedRoot, packageReportPath),
    platformHooks: preset.platformHooks,
    cookedAssetCount: assetSummary.assetCount,
    generatedMeshCount: assetSummary.generatedMeshCount,
    audioSoundCount: assetSummary.audioSoundCount,
    audioEventCount: assetSummary.audioEventCount,
    animationClipCount: assetSummary.animationClipCount,
    animationGraphCount: assetSummary.animationGraphCount,
    physicsBodyCount: assetSummary.physicsBodyCount,
    lastPackageAt: typeof lastPackageReport?.packagedAt === 'string' ? lastPackageReport.packagedAt : null,
    lastPackageFileCount: Number.isFinite(lastPackageReport?.fileCount) ? Number(lastPackageReport.fileCount) : 0,
    ready: warnings.length === 0,
    warnings,
    ...existence,
  };
}

export async function packageProjectRelease(rootPath, options = {}) {
  const summary = await inspectPackagingPreset(rootPath, options);
  if (!summary.ready) {
    throw new Error(`Packaging prerequisites are missing:\n- ${summary.warnings.join('\n- ')}`);
  }

  const resolvedRoot = path.resolve(summary.rootPath);
  const packageRoot = path.join(resolvedRoot, summary.packageRootPath);
  const runtimeBinary = path.join(resolvedRoot, summary.runtimeBinaryPath);
  const packagedBinaryPath = path.join(packageRoot, 'bin', path.basename(runtimeBinary));
  const launchManifestPath = path.join(packageRoot, 'config', 'runtime-launch.json');
  const copiedPaths = [
    { from: runtimeBinary, to: packagedBinaryPath },
    { from: path.join(resolvedRoot, summary.inputRootPath), to: path.join(packageRoot, 'input') },
    { from: path.join(resolvedRoot, summary.contentRootPath), to: path.join(packageRoot, 'content') },
    { from: path.join(resolvedRoot, summary.audioRootPath), to: path.join(packageRoot, 'audio') },
    { from: path.join(resolvedRoot, summary.animationRootPath), to: path.join(packageRoot, 'animation') },
    { from: path.join(resolvedRoot, summary.physicsRootPath), to: path.join(packageRoot, 'physics') },
    { from: path.join(resolvedRoot, 'data'), to: path.join(packageRoot, 'data') },
    { from: path.join(resolvedRoot, 'tooling'), to: path.join(packageRoot, 'tooling') },
    { from: path.join(resolvedRoot, summary.cookedRootPath), to: path.join(packageRoot, 'cooked') },
  ];

  await fs.rm(packageRoot, { recursive: true, force: true });
  await ensureDirectory(path.join(packageRoot, 'config'));
  await ensureDirectory(path.join(packageRoot, 'reports'));

  for (const copy of copiedPaths) {
    await copyPath(copy.from, copy.to);
  }

  await fs.copyFile(summary.presetPath, path.join(packageRoot, 'config', 'export-preset.toml'));

  const launchManifest = buildLaunchManifest(summary, relativePathFromRoot(packageRoot, packagedBinaryPath));
  await fs.writeFile(launchManifestPath, JSON.stringify(launchManifest, null, 2), 'utf8');

  const unixLauncherPath = path.join(packageRoot, 'run-package.sh');
  const windowsLauncherPath = path.join(packageRoot, 'run-package.cmd');
  const manifestRelativePath = relativePathFromRoot(packageRoot, launchManifestPath);
  await fs.writeFile(
    unixLauncherPath,
    unixLauncherScript({
      binaryName: path.basename(runtimeBinary),
      scene: summary.launchScene,
      manifestPath: manifestRelativePath,
    }),
    'utf8',
  );
  await fs.chmod(unixLauncherPath, 0o755);
  await fs.writeFile(
    windowsLauncherPath,
    windowsLauncherScript({
      binaryName: path.basename(runtimeBinary),
      scene: summary.launchScene,
      manifestPath: manifestRelativePath,
    }),
    'utf8',
  );

  const files = await collectFileManifest(packageRoot, packageRoot);
  const fileCount = files.length;
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const hookResults = summary.platformHooks.map((hookId) => ({
    id: hookId,
    status: 'declared_only',
    message: 'Hook declaration captured in the package report; execution is not implemented in this slice.',
  }));
  const packagedAt = new Date().toISOString();
  const report = {
    schema: packageReportSchema,
    version: 1,
    packagedAt,
    rootPath: resolvedRoot,
    presetId: summary.presetId,
    label: summary.label,
    platform: summary.platform,
    runtimeConfig: summary.runtimeConfig,
    launchScene: summary.launchScene,
    presetPath: summary.presetPath,
    presetSource: summary.presetSource,
    packageRootPath: summary.packageRootPath,
    runtimeBinaryPath: summary.runtimeBinaryPath,
    cookedRootPath: summary.cookedRootPath,
    assetReportPath: summary.assetReportPath,
    launchManifestPath: relativePathFromRoot(resolvedRoot, launchManifestPath),
    unixLauncherPath: relativePathFromRoot(resolvedRoot, unixLauncherPath),
    windowsLauncherPath: relativePathFromRoot(resolvedRoot, windowsLauncherPath),
    fileCount,
    totalBytes,
    cookedAssetCount: summary.cookedAssetCount,
    generatedMeshCount: summary.generatedMeshCount,
    audioSoundCount: summary.audioSoundCount,
    audioEventCount: summary.audioEventCount,
    animationClipCount: summary.animationClipCount,
    animationGraphCount: summary.animationGraphCount,
    physicsBodyCount: summary.physicsBodyCount,
    warnings: buildWarnings(summary),
    hookResults,
    files,
  };

  const reportPath = path.join(packageRoot, 'reports', 'package-report.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

  return {
    ...report,
    reportPath: relativePathFromRoot(resolvedRoot, reportPath),
  };
}
