import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { repoRootFromScript, requestJsonNoAuth } from './lib/harness-utils.mjs';
import { preparePackagingFixture } from './lib/package-profile-fixture.mjs';
import { startEngineSessiond } from '../tools/engine-sessiond/server.mjs';
import { SessionStore } from '../tools/engine-sessiond/lib/session-store.mjs';
import { runCli as runEngineCli } from '../tools/engine-cli/shaderforge.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const sessionStateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-package-state-'));
const sessionStorePath = path.join(sessionStateDir, 'sessions.json');
const tempProjectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-package-project-'));

await preparePackagingFixture(tempProjectRoot);

async function runCli(args) {
  const originalCwd = process.cwd();
  const originalLog = console.log;
  const messages = [];
  console.log = (...values) => {
    messages.push(values.join(' '));
  };
  try {
    process.chdir(repoRoot);
    await runEngineCli(args);
  } finally {
    process.chdir(originalCwd);
    console.log = originalLog;
  }
  return JSON.parse(messages.join('\n'));
}

function readLocalZipEntries(archive) {
  const entries = new Map();
  let offset = 0;
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const method = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const contentSize = archive.readUInt32LE(offset + 22);
    const nameSize = archive.readUInt16LE(offset + 26);
    const extraSize = archive.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const contentStart = nameStart + nameSize + extraSize;
    const name = archive.subarray(nameStart, nameStart + nameSize).toString('utf8');
    const compressed = archive.subarray(contentStart, contentStart + compressedSize);
    const content = method === 8 ? inflateRawSync(compressed) : compressed;
    assert.equal(content.length, contentSize);
    entries.set(name, content);
    offset = contentStart + compressedSize;
  }
  return entries;
}

const exportInspect = await runCli(['export', 'inspect', '--root', tempProjectRoot]);
assert.equal(exportInspect.ready, true);
assert.equal(exportInspect.presetId, 'default');
assert.equal(exportInspect.cookedAssetCount, 1);
assert.equal(exportInspect.needsAssetBake, false);

await fs.rm(path.join(tempProjectRoot, 'build', 'cooked'), { recursive: true, force: true });

const inspectBeforeBake = await runCli(['export', 'inspect', '--root', tempProjectRoot]);
assert.equal(inspectBeforeBake.ready, false);
assert.equal(inspectBeforeBake.needsAssetBake, true);
assert.equal(inspectBeforeBake.cookedAssetCount, 0);

const packageReport = await runCli(['package', '--root', tempProjectRoot]);
assert.equal(packageReport.presetId, 'default');
assert.ok(packageReport.fileCount >= 10);
assert.match(packageReport.unixLauncherPath, /run-package\.sh$/);
assert.match(packageReport.windowsLauncherPath, /run-package\.cmd$/);
assert.equal(packageReport.prerequisiteActions.length, 1);
assert.equal(packageReport.prerequisiteActions[0].id, 'asset_bake');
assert.equal(packageReport.prerequisiteActions[0].outputRoot, 'build/cooked');
assert.equal(packageReport.prerequisiteActions[0].reportPath, 'build/cooked/asset-pipeline-report.json');
const archiveHook = packageReport.hookResults.find((hook) => hook.id === 'archive_zip');
assert.equal(archiveHook.status, 'completed');
assert.equal(archiveHook.outputPath, 'build/package/default.zip');
assert.equal(packageReport.hookResults.find((hook) => hook.id === 'installer_placeholder').status, 'declared_only');

const archiveEntries = readLocalZipEntries(await fs.readFile(path.join(tempProjectRoot, archiveHook.outputPath)));
assert.ok(archiveEntries.has('default/run-package.sh'));
assert.ok(archiveEntries.has('default/config/runtime-launch.json'));
assert.ok(archiveEntries.has('default/reports/package-report.json'));

const writtenPackageReport = JSON.parse(
  await fs.readFile(path.join(tempProjectRoot, packageReport.reportPath), 'utf8'),
);
assert.equal(writtenPackageReport.fileCount, packageReport.fileCount);
assert.equal(writtenPackageReport.prerequisiteActions.length, 1);

const inspectAfterBake = await runCli(['export', 'inspect', '--root', tempProjectRoot]);
assert.equal(inspectAfterBake.ready, true);
assert.equal(inspectAfterBake.needsAssetBake, false);
assert.equal(inspectAfterBake.lastPackageArchivePath, 'build/package/default.zip');
assert.equal(inspectAfterBake.lastPackageArchiveExists, true);

await fs.rm(path.join(tempProjectRoot, inspectAfterBake.lastPackageArchivePath));
const inspectAfterArchiveRemoval = await runCli(['export', 'inspect', '--root', tempProjectRoot]);
assert.equal(inspectAfterArchiveRemoval.lastPackageArchivePath, 'build/package/default.zip');
assert.equal(inspectAfterArchiveRemoval.lastPackageArchiveExists, false);
writtenPackageReport.hookResults.find((hook) => hook.id === 'archive_zip').outputPath = '../../outside.zip';
await fs.writeFile(path.join(tempProjectRoot, packageReport.reportPath), JSON.stringify(writtenPackageReport, null, 2), 'utf8');
const inspectAfterUnsafeArchivePath = await runCli(['export', 'inspect', '--root', tempProjectRoot]);
assert.equal(inspectAfterUnsafeArchivePath.lastPackageArchivePath, null);
assert.equal(inspectAfterUnsafeArchivePath.lastPackageArchiveExists, false);

const releaseInspect = await runCli(['export', 'inspect', '--root', tempProjectRoot, '--preset', 'release']);
assert.equal(releaseInspect.ready, true);
assert.equal(releaseInspect.presetId, 'release');
assert.equal(releaseInspect.runtimeConfig, 'Release');
assert.equal(releaseInspect.packageRootPath, 'build/package/release');
const releaseReport = await runCli(['package', '--root', tempProjectRoot, '--preset', 'release']);
assert.equal(releaseReport.runtimeConfig, 'Release');
assert.equal(releaseReport.hookResults.find((hook) => hook.id === 'archive_zip').outputPath, 'build/package/release.zip');
await fs.access(path.join(tempProjectRoot, 'build', 'package', 'release.zip'));

const service = await startEngineSessiond({
  host: '127.0.0.1',
  port: 0,
  sessionStore: new SessionStore({ storageFilePath: sessionStorePath }),
});

try {
  const health = await requestJsonNoAuth(`${service.baseUrl}/health`);
  assert.equal(health.ok, true);
  assert.ok(health.capabilities.includes('package:inspect'));
  assert.ok(health.capabilities.includes('package:run'));

  const createSessionPayload = await requestJsonNoAuth(`${service.baseUrl}/api/sessions`, 'POST', {
    name: 'package-project',
    rootPath: tempProjectRoot,
  });
  const sessionId = createSessionPayload.session.id;

  const inspectPayload = await requestJsonNoAuth(
    `${service.baseUrl}/api/package/inspect?sessionId=${encodeURIComponent(sessionId)}`,
  );
  assert.equal(inspectPayload.ready, true);
  assert.equal(inspectPayload.packageRootPath, 'build/package/default');
  assert.equal(inspectPayload.needsAssetBake, false);

  const runPayload = await requestJsonNoAuth(`${service.baseUrl}/api/package/run`, 'POST', {
    sessionId,
    forceBake: true,
  });
  assert.equal(runPayload.presetId, 'default');
  assert.equal(runPayload.packageRootPath, 'build/package/default');
  assert.ok(runPayload.fileCount >= 10);
  assert.equal(runPayload.prerequisiteActions.length, 1);
  assert.equal(runPayload.prerequisiteActions[0].id, 'asset_bake');
  assert.equal(runPayload.hookResults.find((hook) => hook.id === 'archive_zip').status, 'completed');

  await fs.access(path.join(tempProjectRoot, 'build', 'package', 'default', 'run-package.sh'));
  await fs.access(path.join(tempProjectRoot, 'build', 'package', 'default', 'config', 'runtime-launch.json'));
  await fs.access(path.join(tempProjectRoot, 'build', 'package', 'default.zip'));

  console.log('Engine packaging scaffold passed.');
  console.log('- Verified default and release export presets plus missing cooked-output prep state through the engine CLI and engine_sessiond');
  console.log('- Verified packaging auto-bakes cooked outputs, executes ZIP hooks, and safely reports present, missing, or malformed historical archives');
} finally {
  await service.close();
}
