import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { repoRootFromScript, requestJsonNoAuth } from './lib/harness-utils.mjs';
import { startEngineSessiond } from '../tools/engine-sessiond/server.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const shellApp = fs.readFileSync(path.join(repoRoot, 'shell', 'engine-shell', 'src', 'App.tsx'), 'utf8');
const sessiondClient = fs.readFileSync(path.join(repoRoot, 'shell', 'engine-shell', 'src', 'lib', 'sessiond.ts'), 'utf8');
const sessiondServer = fs.readFileSync(path.join(repoRoot, 'tools', 'engine-sessiond', 'server.mjs'), 'utf8');
const isWindows = process.platform === 'win32';

const service = await startEngineSessiond({
  host: '127.0.0.1',
  port: 0,
  runtimeLaunchFactory: ({ scene, sessionId, workspaceRoot }) => ({
    command: process.execPath,
    args: ['-e', `console.log("viewer-bridge:${scene}:boot:" + process.cwd()); setInterval(() => {}, 1000);`],
    cwd: workspaceRoot || repoRoot,
    displayPath: 'test-runtime',
    sessionId: sessionId || null,
    workspaceRoot: workspaceRoot || repoRoot,
  }),
  buildLaunchFactory: ({ target, config, buildDir }) => ({
    target,
    config,
    buildDir: buildDir || path.join(repoRoot, 'build', 'runtime'),
    steps: [
      {
        label: 'FakeViewerBridgeBuild',
        command: process.execPath,
        args: ['-e', 'console.log("viewer-bridge-build:ok"); setTimeout(() => process.exit(0), 50);'],
        cwd: repoRoot,
      },
    ],
  }),
});

async function waitForSseEvent(streamUrl, predicate, timeoutMs = 8000, label = 'event') {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Timed out waiting for SSE event: ${label}`)), timeoutMs);
  const response = await fetch(streamUrl, {
    headers: { Accept: 'text/event-stream' },
    signal: controller.signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Failed to open SSE stream: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      let boundaryIndex = buffer.indexOf('\n\n');
      while (boundaryIndex >= 0) {
        const rawEvent = buffer.slice(0, boundaryIndex);
        buffer = buffer.slice(boundaryIndex + 2);
        boundaryIndex = buffer.indexOf('\n\n');

        const eventType = rawEvent
          .split('\n')
          .find((line) => line.startsWith('event:'))
          ?.slice('event:'.length)
          .trim();
        const dataLine = rawEvent
          .split('\n')
          .find((line) => line.startsWith('data:'))
          ?.slice('data:'.length)
          .trim();

        if (!eventType || !dataLine) {
          continue;
        }

        const event = {
          type: eventType,
          data: JSON.parse(dataLine),
        };

        if (predicate(event)) {
          return event;
        }
      }
    }
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }

  throw new Error('SSE stream ended before predicate matched.');
}

try {
  const health = await requestJsonNoAuth(`${service.baseUrl}/health`);
  assert.equal(health.ok, true);
  assert.ok(Array.isArray(health.capabilities));
  assert.ok(health.capabilities.includes('runtime:lifecycle'));
  assert.ok(health.capabilities.includes('build:lifecycle'));
  assert.ok(health.capabilities.includes('events'));
  assert.equal(health.capabilities.includes('runtime:lifecycle:pause'), !isWindows);
  assert.equal(health.capabilities.includes('runtime:lifecycle:resume'), !isWindows);

  assert.match(shellApp, /Viewer Workflow/);
  assert.match(shellApp, /External Runtime Window/);
  assert.match(shellApp, /Recent Bridge Activity/);
  assert.match(shellApp, /Build \+ Play/);
  assert.match(shellApp, /Pause/);
  assert.match(shellApp, /Bridge Diagnostics/);
  assert.match(sessiondClient, /EventSource/);
  assert.match(sessiondClient, /pauseRuntime/);
  assert.match(sessiondClient, /resumeRuntime/);
  assert.match(sessiondClient, /runtime\.status/);
  assert.match(sessiondClient, /build\.completed/);
  assert.match(sessiondClient, /sessionId/);
  assert.match(sessiondServer, /\/api\/runtime\/pause/);
  assert.match(sessiondServer, /\/api\/runtime\/resume/);
  assert.match(sessiondServer, /\/api\/events/);

  const sessionPayload = await requestJsonNoAuth(`${service.baseUrl}/api/sessions`, 'POST', {
    name: 'viewer-bridge-repo',
    rootPath: repoRoot,
  });

  const runtimeLogPromise = waitForSseEvent(
    `${service.baseUrl}/api/events`,
    (event) => event.type === 'runtime.log' && String(event.data?.data || '').includes('viewer-bridge:viewer-bridge:boot'),
    8000,
    'runtime.log boot',
  );
  const runtimeStartPayload = await requestJsonNoAuth(`${service.baseUrl}/api/runtime/start`, 'POST', {
    scene: 'viewer-bridge',
    sessionId: sessionPayload.session.id,
  });
  assert.equal(runtimeStartPayload.state, 'running');
  assert.equal(runtimeStartPayload.scene, 'viewer-bridge');
  assert.equal(runtimeStartPayload.sessionId, sessionPayload.session.id);
  assert.equal(runtimeStartPayload.workspaceRoot, repoRoot);
  const runtimeLogEvent = await runtimeLogPromise;
  assert.equal(runtimeLogEvent.type, 'runtime.log');
  assert.match(runtimeLogEvent.data.data, /viewer-bridge:viewer-bridge:boot/);
  assert.ok(runtimeLogEvent.data.data.includes(repoRoot));

  if (!isWindows) {
    const runtimePausePayload = await requestJsonNoAuth(`${service.baseUrl}/api/runtime/pause`, 'POST', {});
    assert.equal(runtimePausePayload.state, 'paused');
    const pausedRuntimeStatus = await requestJsonNoAuth(`${service.baseUrl}/api/runtime/status`);
    assert.equal(pausedRuntimeStatus.state, 'paused');

    const runtimeResumePayload = await requestJsonNoAuth(`${service.baseUrl}/api/runtime/resume`, 'POST', {});
    assert.equal(runtimeResumePayload.state, 'running');
    const resumedRuntimeStatus = await requestJsonNoAuth(`${service.baseUrl}/api/runtime/status`);
    assert.equal(resumedRuntimeStatus.state, 'running');
  }

  const buildCompletedPromise = waitForSseEvent(
    `${service.baseUrl}/api/events`,
    (event) => event.type === 'build.completed' && event.data?.target === 'runtime',
    8000,
    'build.completed runtime',
  );
  const buildStartPayload = await requestJsonNoAuth(`${service.baseUrl}/api/build/runtime`, 'POST', {
    config: 'Debug',
  });
  assert.equal(buildStartPayload.state, 'running');
  assert.equal(buildStartPayload.target, 'runtime');
  const buildCompletedEvent = await buildCompletedPromise;
  assert.equal(buildCompletedEvent.type, 'build.completed');
  assert.equal(buildCompletedEvent.data.state, 'succeeded');

  const runtimeStopPayload = await requestJsonNoAuth(`${service.baseUrl}/api/runtime/stop`, 'POST', {});
  assert.equal(runtimeStopPayload.state, 'stopped');

  console.log('Engine viewer bridge smoke passed.');
  console.log(`- Started engine_sessiond at ${service.baseUrl}`);
  console.log('- Verified shell viewer workflow surfaces and sessiond bridge contracts are present');
  console.log(`- Verified runtime start/${isWindows ? 'stop' : 'pause/resume/stop'} bridge flow across API, status, and event surfaces`);
  console.log('- Verified build completion events reach the viewer bridge lane');
} finally {
  await service.close();
}
