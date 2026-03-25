import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { repoRootFromScript, requestJsonNoAuth } from './lib/harness-utils.mjs';
import { startEngineSessiond } from '../tools/engine-sessiond/server.mjs';
import { SessionStore } from '../tools/engine-sessiond/lib/session-store.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const sessionStateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-code-trust-state-'));
const sessionStorePath = path.join(sessionStateDir, 'sessions.json');
const tempProjectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-code-trust-project-'));
const engineCliPath = path.join(repoRoot, 'tools', 'engine-cli', 'shaderforge.mjs');

await fs.mkdir(path.join(tempProjectRoot, 'content', 'scenes'), { recursive: true });
await fs.writeFile(
  path.join(tempProjectRoot, 'content', 'scenes', 'debug.scene.toml'),
  'name = "debug"\n',
  'utf8',
);

function runtimeLaunchFactory({ scene, sessionId, workspaceRoot }) {
  return {
    command: process.execPath,
    args: ['-e', `console.log("runtime:${scene}:boot"); setInterval(() => {}, 1000);`],
    cwd: workspaceRoot || repoRoot,
    displayPath: 'test-runtime',
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
        args: ['-e', 'console.log("build:runtime:boot"); process.exit(0);'],
        cwd: repoRoot,
      },
    ],
  };
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    payload: await response.json(),
  };
}

function runCli(args, cwd = repoRoot) {
  const result = spawnSync(process.execPath, [engineCliPath, ...args], {
    cwd,
    encoding: 'utf8',
  });
  if (result.error) {
    throw result.error;
  }
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
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
  assert.ok(Array.isArray(health.capabilities));
  assert.ok(health.capabilities.includes('code-trust:summary'));
  assert.ok(health.capabilities.includes('code-trust:evaluate'));

  const createSessionPayload = await requestJsonNoAuth(`${service.baseUrl}/api/sessions`, 'POST', {
    name: 'code-trust-project',
    rootPath: tempProjectRoot,
  });
  const sessionId = createSessionPayload.session.id;

  const summary = await requestJsonNoAuth(
    `${service.baseUrl}/api/code-trust/summary?sessionId=${encodeURIComponent(sessionId)}`,
  );
  assert.equal(summary.policySource, 'bundled');
  assert.ok(Array.isArray(summary.supportedHotReloadRoots));
  assert.ok(summary.supportedHotReloadRoots.includes('content/**'));
  assert.equal(summary.trackedArtifactCount, 0);

  const allowedHotReload = await requestJsonNoAuth(`${service.baseUrl}/api/code-trust/evaluate`, 'POST', {
    sessionId,
    action: 'hot_reload',
    path: 'content/scenes/debug.scene.toml',
    actor: 'assistant',
  });
  assert.equal(allowedHotReload.allowed, true);
  assert.equal(allowedHotReload.targetKind, 'content');

  const allowedWrite = await requestJsonNoAuth(`${service.baseUrl}/api/files/write`, 'POST', {
    sessionId,
    path: 'generated/assistant/new_feature.ts',
    content: 'export const generated = true;\n',
    policy: {
      actor: 'assistant',
      origin: 'assistant_generated',
    },
  });
  assert.equal(allowedWrite.path, 'generated/assistant/new_feature.ts');
  assert.equal(allowedWrite.codeTrust.allowed, true);
  assert.equal(allowedWrite.codeTrust.effectiveOrigin, 'assistant_generated');

  const summaryAfterWrite = await requestJsonNoAuth(
    `${service.baseUrl}/api/code-trust/summary?sessionId=${encodeURIComponent(sessionId)}`,
  );
  assert.equal(summaryAfterWrite.trackedArtifactCount, 1);
  assert.equal(summaryAfterWrite.trackedArtifacts[0].path, 'generated/assistant/new_feature.ts');
  assert.equal(summaryAfterWrite.trackedArtifacts[0].origin, 'assistant_generated');

  const deniedWrite = await postJson(`${service.baseUrl}/api/files/write`, {
    sessionId,
    path: 'engine/runtime/src/injected.cpp',
    content: 'int injected = 1;\n',
    policy: {
      actor: 'assistant',
      origin: 'assistant_generated',
    },
  });
  assert.equal(deniedWrite.status, 409);
  assert.equal(deniedWrite.payload.codeTrust.decision, 'review_required');
  assert.match(deniedWrite.payload.error, /requires explicit review/i);

  const deniedBuild = await postJson(`${service.baseUrl}/api/build/runtime`, {
    policy: {
      actor: 'assistant',
    },
  });
  assert.equal(deniedBuild.status, 409);
  assert.equal(deniedBuild.payload.codeTrust.action, 'compile');
  assert.equal(deniedBuild.payload.codeTrust.decision, 'review_required');

  const deniedRuntimeStart = await postJson(`${service.baseUrl}/api/runtime/start`, {
    scene: 'sandbox',
    policy: {
      actor: 'assistant',
      origin: 'assistant_generated',
    },
  });
  assert.equal(deniedRuntimeStart.status, 403);
  assert.equal(deniedRuntimeStart.payload.codeTrust.action, 'load');
  assert.equal(deniedRuntimeStart.payload.codeTrust.decision, 'deny');

  const cliSummary = runCli(['policy', 'inspect', '--root', tempProjectRoot]);
  assert.equal(cliSummary.trackedArtifactCount, 1);
  assert.equal(cliSummary.trackedArtifacts[0].path, 'generated/assistant/new_feature.ts');

  const cliAllowedHotReload = runCli([
    'policy',
    'check',
    'hot_reload',
    'content/scenes/debug.scene.toml',
    '--root',
    tempProjectRoot,
    '--actor',
    'assistant',
  ]);
  assert.equal(cliAllowedHotReload.allowed, true);

  const cliDeniedHotReload = runCli([
    'policy',
    'check',
    'hot_reload',
    'engine/runtime/src/runtime_app.cpp',
    '--root',
    repoRoot,
    '--actor',
    'assistant',
  ]);
  assert.equal(cliDeniedHotReload.allowed, false);
  assert.equal(cliDeniedHotReload.decision, 'deny');

  console.log('Engine code-trust scaffold passed.');
  console.log(`- Verified shared code-trust policy inspection through ${engineCliPath}`);
  console.log('- Verified assistant-generated artifacts are tracked and inspectable through engine_sessiond');
  console.log('- Verified assistant-triggered engine apply, compile, and load transitions are gated with actionable diagnostics');
  console.log('- Verified the current hot-reload lane stays limited to authored content roots while code hot reload remains blocked');
} finally {
  await service.close();
}
