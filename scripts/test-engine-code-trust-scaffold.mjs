import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
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

async function runCliAsync(args, cwd = repoRoot) {
  const child = spawn(process.execPath, [engineCliPath, ...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => {
    stdout += chunk.toString('utf8');
  });
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', resolve);
  });
  assert.equal(exitCode, 0, stderr || stdout);
  return JSON.parse(stdout);
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
  assert.ok(health.capabilities.includes('code-trust:approvals'));

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

  const reviewedWrite = await postJson(`${service.baseUrl}/api/files/write`, {
    sessionId,
    path: 'engine/runtime/src/injected.cpp',
    content: 'int injected = 1;\n',
    policy: {
      actor: 'assistant',
      origin: 'assistant_generated',
    },
  });
  assert.equal(reviewedWrite.status, 409);
  assert.equal(reviewedWrite.payload.codeTrust.decision, 'review_required');
  assert.equal(reviewedWrite.payload.approval.operationType, 'file_write');
  assert.match(reviewedWrite.payload.error, /requires explicit review/i);

  const reviewedBuild = await postJson(`${service.baseUrl}/api/build/runtime`, {
    policy: {
      actor: 'assistant',
    },
  });
  assert.equal(reviewedBuild.status, 409);
  assert.equal(reviewedBuild.payload.codeTrust.action, 'compile');
  assert.equal(reviewedBuild.payload.codeTrust.decision, 'review_required');
  assert.equal(reviewedBuild.payload.approval.operationType, 'build_runtime');

  const pendingApprovals = await requestJsonNoAuth(
    `${service.baseUrl}/api/code-trust/approvals?sessionId=${encodeURIComponent(sessionId)}`,
  );
  assert.equal(pendingApprovals.approvals.length, 2);
  assert.deepEqual(
    pendingApprovals.approvals.map((approval) => approval.id).sort(),
    [
      reviewedBuild.payload.approval.id,
      reviewedWrite.payload.approval.id,
    ].sort(),
  );

  const cliPendingApprovals = await runCliAsync([
    'policy',
    'approvals',
    '--session',
    sessionId,
    '--base-url',
    service.baseUrl,
  ]);
  assert.equal(cliPendingApprovals.length, 2);

  const approvedWrite = await postJson(
    `${service.baseUrl}/api/code-trust/approvals/${encodeURIComponent(reviewedWrite.payload.approval.id)}/decision`,
    {
      decision: 'approved',
      decisionBy: 'human',
    },
  );
  assert.equal(approvedWrite.status, 200);
  assert.equal(approvedWrite.payload.approval.status, 'approved');
  assert.equal(approvedWrite.payload.outcome.path, 'engine/runtime/src/injected.cpp');
  const approvedWriteContent = await fs.readFile(
    path.join(tempProjectRoot, 'engine', 'runtime', 'src', 'injected.cpp'),
    'utf8',
  );
  assert.equal(approvedWriteContent, 'int injected = 1;\n');

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

  const summaryAfterApprovedWrite = await requestJsonNoAuth(
    `${service.baseUrl}/api/code-trust/summary?sessionId=${encodeURIComponent(sessionId)}`,
  );
  assert.equal(summaryAfterApprovedWrite.trackedArtifactCount, 2);
  assert.equal(summaryAfterApprovedWrite.trackedArtifacts[0].path, 'engine/runtime/src/injected.cpp');

  const approvedBuild = await runCliAsync([
    'policy',
    'approve',
    reviewedBuild.payload.approval.id,
    '--base-url',
    service.baseUrl,
  ]);
  assert.equal(approvedBuild.approval.status, 'approved');
  const completedBuild = await waitForBuildState(service.baseUrl, 'succeeded');
  assert.equal(completedBuild.target, 'runtime');

  const deniedBuildApproval = await postJson(`${service.baseUrl}/api/build/runtime`, {
    config: 'Release',
    policy: {
      actor: 'assistant',
    },
  });
  assert.equal(deniedBuildApproval.status, 409);
  assert.equal(deniedBuildApproval.payload.approval.operationType, 'build_runtime');

  const deniedBuildDecision = await runCliAsync([
    'policy',
    'deny',
    deniedBuildApproval.payload.approval.id,
    '--base-url',
    service.baseUrl,
  ]);
  assert.equal(deniedBuildDecision.approval.status, 'denied');

  const cliSummary = runCli(['policy', 'inspect', '--root', tempProjectRoot]);
  assert.equal(cliSummary.trackedArtifactCount, 2);
  assert.equal(cliSummary.trackedArtifacts[0].path, 'engine/runtime/src/injected.cpp');

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

  const allApprovals = await requestJsonNoAuth(
    `${service.baseUrl}/api/code-trust/approvals?sessionId=${encodeURIComponent(sessionId)}&state=all`,
  );
  assert.equal(allApprovals.approvals.length, 3);
  assert.equal(
    allApprovals.approvals.find((approval) => approval.id === reviewedWrite.payload.approval.id)?.status,
    'approved',
  );
  assert.equal(
    allApprovals.approvals.find((approval) => approval.id === reviewedBuild.payload.approval.id)?.status,
    'approved',
  );
  assert.equal(
    allApprovals.approvals.find((approval) => approval.id === deniedBuildApproval.payload.approval.id)?.status,
    'denied',
  );

  console.log('Engine code-trust scaffold passed.');
  console.log(`- Verified shared code-trust policy inspection through ${engineCliPath}`);
  console.log('- Verified assistant-generated artifacts are tracked and inspectable through engine_sessiond');
  console.log('- Verified assistant-triggered engine apply and compile requests queue explicit approvals that can be listed, approved, or denied');
  console.log('- Verified approved review-required operations execute their deferred file-write and runtime-build side effects');
  console.log('- Verified assistant-triggered engine load remains denied when the artifact origin is still assistant-generated');
  console.log('- Verified the current hot-reload lane stays limited to authored content roots while code hot reload remains blocked');
} finally {
  await service.close();
}
