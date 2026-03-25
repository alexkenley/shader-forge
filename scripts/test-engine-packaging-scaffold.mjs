import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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

const exportInspect = await runCli(['export', 'inspect', '--root', tempProjectRoot]);
assert.equal(exportInspect.ready, true);
assert.equal(exportInspect.presetId, 'default');
assert.equal(exportInspect.cookedAssetCount, 1);

const packageReport = await runCli(['package', '--root', tempProjectRoot]);
assert.equal(packageReport.presetId, 'default');
assert.ok(packageReport.fileCount >= 10);
assert.match(packageReport.unixLauncherPath, /run-package\.sh$/);
assert.match(packageReport.windowsLauncherPath, /run-package\.cmd$/);

const writtenPackageReport = JSON.parse(
  await fs.readFile(path.join(tempProjectRoot, packageReport.reportPath), 'utf8'),
);
assert.equal(writtenPackageReport.fileCount, packageReport.fileCount);

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

  const runPayload = await requestJsonNoAuth(`${service.baseUrl}/api/package/run`, 'POST', {
    sessionId,
  });
  assert.equal(runPayload.presetId, 'default');
  assert.equal(runPayload.packageRootPath, 'build/package/default');
  assert.ok(runPayload.fileCount >= 10);

  await fs.access(path.join(tempProjectRoot, 'build', 'package', 'default', 'run-package.sh'));
  await fs.access(path.join(tempProjectRoot, 'build', 'package', 'default', 'config', 'runtime-launch.json'));

  console.log('Engine packaging scaffold passed.');
  console.log('- Verified default export-preset inspection through the engine CLI and engine_sessiond');
  console.log('- Verified packaging emits a reproducible release layout with launch scripts, packaged authored roots, bundled cooked outputs, and a package report');
} finally {
  await service.close();
}
