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
const sessionStateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-profile-state-'));
const sessionStorePath = path.join(sessionStateDir, 'sessions.json');
const tempProjectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-profile-project-'));

await preparePackagingFixture(tempProjectRoot);
await fs.writeFile(path.join(tempProjectRoot, 'notes.txt'), 'diagnostic fixture\n', 'utf8');

function runtimeLaunchFactory({ scene, sessionId, workspaceRoot }) {
  return {
    command: process.execPath,
    args: ['-e', `console.log("runtime:${scene}:boot"); setInterval(() => {}, 1000);`],
    cwd: workspaceRoot || repoRoot,
    displayPath: 'profile-runtime',
    sessionId: sessionId || null,
    workspaceRoot: workspaceRoot || repoRoot,
  };
}

function buildLaunchFactory({ target, config, buildDir }) {
  return {
    target,
    config,
    buildDir: buildDir || path.join(repoRoot, 'build', 'runtime'),
    steps: [
      {
        label: 'FakeBuild',
        command: process.execPath,
        args: ['-e', 'console.log("build:runtime:boot"); setTimeout(() => process.exit(0), 50);'],
        cwd: repoRoot,
      },
    ],
  };
}

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

async function waitForBuildState(baseUrl, expectedState) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const status = await requestJsonNoAuth(`${baseUrl}/api/build/status`);
    if (status.state === expectedState) {
      return status;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for build state ${expectedState}.`);
}

const service = await startEngineSessiond({
  host: '127.0.0.1',
  port: 0,
  sessionStore: new SessionStore({ storageFilePath: sessionStorePath }),
  runtimeLaunchFactory,
  buildLaunchFactory,
});

try {
  const health = await requestJsonNoAuth(`${service.baseUrl}/health`);
  assert.equal(health.ok, true);
  assert.ok(health.capabilities.includes('profile:live'));
  assert.ok(health.capabilities.includes('profile:capture'));
  assert.ok(health.capabilities.includes('profile:list'));

  const createSessionPayload = await requestJsonNoAuth(`${service.baseUrl}/api/sessions`, 'POST', {
    name: 'profile-project',
    rootPath: tempProjectRoot,
  });
  const sessionId = createSessionPayload.session.id;

  await requestJsonNoAuth(`${service.baseUrl}/api/runtime/start`, 'POST', {
    sessionId,
    scene: 'sandbox',
  });
  await requestJsonNoAuth(`${service.baseUrl}/api/build/runtime`, 'POST', {});
  await waitForBuildState(service.baseUrl, 'succeeded');
  await new Promise((resolve) => setTimeout(resolve, 100));

  const livePayload = await requestJsonNoAuth(
    `${service.baseUrl}/api/profile/live?sessionId=${encodeURIComponent(sessionId)}`,
  );
  assert.equal(livePayload.runtime.state, 'running');
  assert.equal(livePayload.workspace.packaging.ready, true);
  assert.ok(livePayload.runtime.logLineCount >= 1);
  assert.ok(livePayload.build.logLineCount >= 1);
  assert.ok(livePayload.recommendations.some((entry) => entry.includes('build/package/default')));

  const capturePayload = await requestJsonNoAuth(`${service.baseUrl}/api/profile/capture`, 'POST', {
    sessionId,
    label: 'sessiond-live',
  });
  assert.equal(capturePayload.label, 'sessiond-live');
  await fs.access(path.join(tempProjectRoot, capturePayload.outputPath));

  const cliLivePayload = await runCli([
    'profile',
    'live',
    '--session',
    sessionId,
    '--base-url',
    service.baseUrl,
  ]);
  assert.equal(cliLivePayload.runtime.state, 'running');
  assert.ok(cliLivePayload.runtime.logLineCount >= 1);

  const cliCapturePayload = await runCli([
    'profile',
    'capture',
    '--session',
    sessionId,
    '--base-url',
    service.baseUrl,
    '--label',
    'cli-live',
  ]);
  assert.equal(cliCapturePayload.label, 'cli-live');
  await fs.access(path.join(tempProjectRoot, cliCapturePayload.outputPath));

  const offlineCapturePayload = await runCli([
    'profile',
    'capture',
    '--root',
    tempProjectRoot,
    '--label',
    'offline',
  ]);
  assert.equal(offlineCapturePayload.label, 'offline');
  assert.equal(offlineCapturePayload.runtime.state, 'stopped');
  await fs.access(path.join(tempProjectRoot, offlineCapturePayload.outputPath));

  const sessiondCaptureList = await requestJsonNoAuth(
    `${service.baseUrl}/api/profile/captures?sessionId=${encodeURIComponent(sessionId)}&limit=5`,
  );
  assert.ok(sessiondCaptureList.captureCount >= 3);
  assert.ok(sessiondCaptureList.captures.some((capture) => capture.label === 'sessiond-live'));
  assert.ok(sessiondCaptureList.captures.some((capture) => capture.label === 'cli-live'));
  assert.ok(sessiondCaptureList.captures.some((capture) => capture.label === 'offline'));

  const cliCaptureList = await runCli([
    'profile',
    'list',
    '--session',
    sessionId,
    '--base-url',
    service.baseUrl,
    '--limit',
    '5',
  ]);
  assert.ok(cliCaptureList.captureCount >= 3);
  assert.ok(cliCaptureList.captures.some((capture) => capture.label === 'sessiond-live'));
  assert.ok(cliCaptureList.captures.some((capture) => capture.label === 'cli-live'));

  const offlineCaptureList = await runCli([
    'profile',
    'list',
    '--root',
    tempProjectRoot,
    '--limit',
    '5',
  ]);
  assert.ok(offlineCaptureList.captureCount >= 3);
  assert.ok(offlineCaptureList.captures.some((capture) => capture.label === 'offline'));

  const refreshedLivePayload = await requestJsonNoAuth(
    `${service.baseUrl}/api/profile/live?sessionId=${encodeURIComponent(sessionId)}`,
  );
  assert.ok(refreshedLivePayload.workspace.profiling.captureCount >= 3);
  assert.ok(refreshedLivePayload.workspace.profiling.recentCaptures.some((capture) => capture.label === 'offline'));

  console.log('Engine profiling scaffold passed.');
  console.log('- Verified live diagnostic inspection through engine_sessiond and the engine CLI');
  console.log('- Verified profiling captures persist runtime/build status, recent logs, package readiness, and workspace diagnostics into shareable JSON reports');
  console.log('- Verified stored capture history is queryable through engine_sessiond, the engine CLI, and live profiling summaries');
} finally {
  await service.close();
}
