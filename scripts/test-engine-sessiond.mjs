import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { repoRootFromScript, requestJsonNoAuth } from './lib/harness-utils.mjs';
import { startEngineSessiond } from '../tools/engine-sessiond/server.mjs';
import { SessionStore } from '../tools/engine-sessiond/lib/session-store.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const sessionStateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-sessiond-state-'));
const sessionStorePath = path.join(sessionStateDir, 'sessions.json');
const coordinationClock = { nowMs: Date.parse('2026-08-30T12:00:00.000Z') };
const coordinationHeartbeatTimeoutMs = 10_000;

function runtimeLaunchFactory({ scene, sessionId, workspaceRoot }) {
  return {
    command: process.execPath,
    args: ['-e', `console.log("runtime:${scene}:boot:" + process.cwd()); setInterval(() => {}, 1000);`],
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
        args: [
          '-e',
          'console.log("build:runtime:boot"); setTimeout(() => process.exit(0), 50);',
        ],
        cwd: repoRoot,
      },
    ],
  };
}

async function startService() {
  return startEngineSessiond({
    host: '127.0.0.1',
    port: 0,
    sessionStore: new SessionStore({ storageFilePath: sessionStorePath }),
    runtimeLaunchFactory,
    buildLaunchFactory,
    now: () => coordinationClock.nowMs,
    heartbeatTimeoutMs: coordinationHeartbeatTimeoutMs,
  });
}

let service = await startService();

async function requestCoordination(pathname, method = 'GET', body, credential = '') {
  const headers = {};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (credential) {
    headers['x-shader-forge-agent-credential'] = credential;
  }
  const response = await fetch(`${service.baseUrl}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload = {};
  if (text) {
    payload = JSON.parse(text);
  }
  return { status: response.status, payload };
}

function coordinationIso(epochMs = coordinationClock.nowMs) {
  return new Date(epochMs).toISOString();
}

async function waitForSseEvent(streamUrl, predicate, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('Timed out waiting for SSE event.')), timeoutMs);
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

async function subscribeSessiondEvents() {
  const controller = new AbortController();
  const events = [];
  const waiters = new Set();
  const response = await fetch(`${service.baseUrl}/api/events`, {
    headers: { Accept: 'text/event-stream' },
    signal: controller.signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Failed to open SSE stream: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let seenStreamBytes = false;
  let resolveConnected;
  const connectedPromise = new Promise((resolve) => {
    resolveConnected = resolve;
  });

  function dispatch(event) {
    events.push(event);
    for (const waiter of [...waiters]) {
      if (waiter.predicate(event)) {
        waiters.delete(waiter);
        waiter.resolve(event);
      }
    }
  }

  const pump = (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (!seenStreamBytes) {
          seenStreamBytes = true;
          resolveConnected();
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

          dispatch({
            type: eventType,
            data: JSON.parse(dataLine),
          });
        }
      }
    } catch {
      // Stream shutdown is best-effort in the harness.
    }
  })();

  await connectedPromise;

  return {
    events,
    waitFor(predicate, timeoutMs = 8000) {
      const existing = events.find((event) => predicate(event));
      if (existing) {
        return Promise.resolve(existing);
      }
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          waiters.delete(waiter);
          reject(new Error('Timed out waiting for SSE event.'));
        }, timeoutMs);
        const waiter = {
          predicate,
          resolve: (event) => {
            clearTimeout(timeout);
            resolve(event);
          },
        };
        waiters.add(waiter);
      });
    },
    async close() {
      controller.abort();
      try {
        await pump;
      } catch {
        // Stream shutdown is best-effort in the harness.
      }
    },
  };
}

try {
  const health = await requestJsonNoAuth(`${service.baseUrl}/health`);
  assert.equal(health.ok, true);
  assert.equal(health.service, 'engine_sessiond');
  assert.equal(Array.isArray(health.capabilities), true);
  assert.ok(health.capabilities.includes('coordination'));

  const corsPreflight = await fetch(`${service.baseUrl}/api/sessions/example`, {
    method: 'OPTIONS',
  });
  assert.equal(corsPreflight.status, 204);
  assert.match(corsPreflight.headers.get('access-control-allow-methods') || '', /PATCH/);

  const createPayload = await requestJsonNoAuth(`${service.baseUrl}/api/sessions`, 'POST', {
    name: 'repo-root',
    rootPath: repoRoot,
  });

  assert.match(createPayload.session.id, /^session_/);
  assert.equal(createPayload.session.name, 'repo-root');
  assert.equal(createPayload.session.rootPath, repoRoot);

  const listPayload = await requestJsonNoAuth(`${service.baseUrl}/api/sessions`);
  assert.equal(listPayload.sessions.length, 1);
  assert.equal(listPayload.sessions[0].id, createPayload.session.id);

  const sessionPayload = await requestJsonNoAuth(
    `${service.baseUrl}/api/sessions/${createPayload.session.id}`,
  );
  assert.equal(sessionPayload.session.rootPath, repoRoot);

  const updatedSessionPayload = await requestJsonNoAuth(
    `${service.baseUrl}/api/sessions/${createPayload.session.id}`,
    'PATCH',
    { name: 'repo-root-renamed' },
  );
  assert.equal(updatedSessionPayload.session.name, 'repo-root-renamed');

  const persistedSessionStore = JSON.parse(await fs.readFile(sessionStorePath, 'utf8'));
  assert.equal(persistedSessionStore.version, 1);
  assert.equal(Array.isArray(persistedSessionStore.sessions), true);
  assert.equal(persistedSessionStore.sessions[0].id, createPayload.session.id);

  await service.close();
  service = await startService();

  const persistedListPayload = await requestJsonNoAuth(`${service.baseUrl}/api/sessions`);
  assert.equal(persistedListPayload.sessions.length, 1);
  assert.equal(persistedListPayload.sessions[0].id, createPayload.session.id);
  assert.equal(persistedListPayload.sessions[0].name, 'repo-root-renamed');

  const fileListPayload = await requestJsonNoAuth(
    `${service.baseUrl}/api/files/list?sessionId=${encodeURIComponent(createPayload.session.id)}&path=${encodeURIComponent('.')}`,
  );
  assert.equal(fileListPayload.path, '.');
  assert.ok(fileListPayload.entries.some((entry) => entry.name === 'README.md'));
  assert.ok(fileListPayload.entries.some((entry) => entry.name === 'docs'));

  const fileReadPayload = await requestJsonNoAuth(
    `${service.baseUrl}/api/files/read?sessionId=${encodeURIComponent(createPayload.session.id)}&path=${encodeURIComponent('README.md')}`,
  );
  assert.equal(fileReadPayload.path, 'README.md');
  assert.match(fileReadPayload.content, /Shader Forge/);
  assert.ok(fileReadPayload.size > 0);

  const fileWritePayload = await requestJsonNoAuth(`${service.baseUrl}/api/files/write`, 'POST', {
    sessionId: createPayload.session.id,
    path: 'tmp/sessiond-write-check.txt',
    content: 'sessiond write ok\n',
  });
  assert.equal(fileWritePayload.path, 'tmp/sessiond-write-check.txt');
  assert.equal(fileWritePayload.content, 'sessiond write ok\n');
  assert.ok(fileWritePayload.size > 0);

  const writtenFileReadPayload = await requestJsonNoAuth(
    `${service.baseUrl}/api/files/read?sessionId=${encodeURIComponent(createPayload.session.id)}&path=${encodeURIComponent('tmp/sessiond-write-check.txt')}`,
  );
  assert.equal(writtenFileReadPayload.content, 'sessiond write ok\n');

  const hostFsPayload = await requestJsonNoAuth(
    `${service.baseUrl}/api/hostfs/list?path=${encodeURIComponent(path.dirname(repoRoot))}`,
  );
  assert.equal(hostFsPayload.path, path.dirname(repoRoot));
  assert.equal(Array.isArray(hostFsPayload.entries), true);
  assert.ok(hostFsPayload.entries.some((entry) => entry.name === path.basename(repoRoot)));

  const gitStatusPayload = await requestJsonNoAuth(
    `${service.baseUrl}/api/git/status?sessionId=${encodeURIComponent(createPayload.session.id)}`,
  );
  assert.equal(gitStatusPayload.notARepo, false);
  assert.equal(gitStatusPayload.rootPath, repoRoot);
  assert.equal(Array.isArray(gitStatusPayload.staged), true);
  assert.equal(Array.isArray(gitStatusPayload.unstaged), true);
  assert.equal(Array.isArray(gitStatusPayload.untracked), true);

  const tempProjectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-git-'));
  const tempSessionPayload = await requestJsonNoAuth(`${service.baseUrl}/api/sessions`, 'POST', {
    name: 'temp-project',
    rootPath: tempProjectRoot,
  });

  const tempGitStatusPayload = await requestJsonNoAuth(
    `${service.baseUrl}/api/git/status?sessionId=${encodeURIComponent(tempSessionPayload.session.id)}`,
  );
  assert.equal(tempGitStatusPayload.notARepo, true);

  const tempGitInitPayload = await requestJsonNoAuth(`${service.baseUrl}/api/git/init`, 'POST', {
    sessionId: tempSessionPayload.session.id,
  });
  assert.equal(tempGitInitPayload.notARepo, false);
  assert.equal(Array.isArray(tempGitInitPayload.untracked), true);

  const tempDeletePayload = await requestJsonNoAuth(
    `${service.baseUrl}/api/sessions/${tempSessionPayload.session.id}`,
    'DELETE',
  );
  assert.equal(tempDeletePayload.ok, true);

  const runtimeProjectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-runtime-'));
  const runtimeSessionPayload = await requestJsonNoAuth(`${service.baseUrl}/api/sessions`, 'POST', {
    name: 'runtime-project',
    rootPath: runtimeProjectRoot,
  });

  const outputEventPromise = waitForSseEvent(
    `${service.baseUrl}/api/events`,
    (event) => event.type === 'terminal.output' && String(event.data?.data || '').includes('__SF_TERM_OK__'),
  );

  const isWindows = process.platform === 'win32';
  const terminalShell = isWindows ? 'powershell.exe' : 'bash';
  const terminalInput = isWindows
    ? 'Write-Host "__SF_TERM_OK__"\r\n'
    : 'printf "__SF_TERM_OK__\\n"\n';

  const terminalPayload = await requestJsonNoAuth(`${service.baseUrl}/api/terminals`, 'POST', {
    sessionId: createPayload.session.id,
    shell: terminalShell,
    cols: 120,
    rows: 24,
  });

  assert.match(terminalPayload.terminalId, /^terminal_/);

  await requestJsonNoAuth(
    `${service.baseUrl}/api/terminals/${encodeURIComponent(terminalPayload.terminalId)}/input`,
    'POST',
    { input: terminalInput },
  );

  const outputEvent = await outputEventPromise;
  assert.equal(outputEvent.type, 'terminal.output');
  assert.equal(outputEvent.data.terminalId, terminalPayload.terminalId);
  assert.match(outputEvent.data.data, /__SF_TERM_OK__/);

  await requestJsonNoAuth(
    `${service.baseUrl}/api/terminals/${encodeURIComponent(terminalPayload.terminalId)}`,
    'DELETE',
  );

  const runtimeLogPromise = waitForSseEvent(
    `${service.baseUrl}/api/events`,
    (event) => event.type === 'runtime.log' && String(event.data?.data || '').includes('runtime:sandbox:boot'),
  );

  const runtimeStartPayload = await requestJsonNoAuth(`${service.baseUrl}/api/runtime/start`, 'POST', {
    scene: 'sandbox',
    sessionId: runtimeSessionPayload.session.id,
  });
  assert.equal(runtimeStartPayload.state, 'running');
  assert.equal(runtimeStartPayload.scene, 'sandbox');
  assert.equal(runtimeStartPayload.sessionId, runtimeSessionPayload.session.id);
  assert.equal(runtimeStartPayload.workspaceRoot, runtimeProjectRoot);
  assert.equal(runtimeStartPayload.executablePath, 'test-runtime');
  assert.equal(runtimeStartPayload.pausedAt, null);
  assert.equal(runtimeStartPayload.supportsPause, !isWindows);

  const runtimeStatusPayload = await requestJsonNoAuth(`${service.baseUrl}/api/runtime/status`);
  assert.equal(runtimeStatusPayload.state, 'running');
  assert.equal(runtimeStatusPayload.scene, 'sandbox');
  assert.equal(runtimeStatusPayload.sessionId, runtimeSessionPayload.session.id);
  assert.equal(runtimeStatusPayload.workspaceRoot, runtimeProjectRoot);
  assert.equal(runtimeStatusPayload.supportsPause, !isWindows);

  const runtimeLogEvent = await runtimeLogPromise;
  assert.equal(runtimeLogEvent.type, 'runtime.log');
  assert.match(runtimeLogEvent.data.data, /runtime:sandbox:boot/);
  assert.ok(runtimeLogEvent.data.data.includes(runtimeProjectRoot));

  if (!isWindows) {
    const runtimePausePayload = await requestJsonNoAuth(`${service.baseUrl}/api/runtime/pause`, 'POST', {});
    assert.equal(runtimePausePayload.state, 'paused');
    assert.equal(runtimePausePayload.scene, 'sandbox');
    assert.ok(typeof runtimePausePayload.pausedAt === 'string' && runtimePausePayload.pausedAt.length > 0);

    const pausedRuntimeStatusPayload = await requestJsonNoAuth(`${service.baseUrl}/api/runtime/status`);
    assert.equal(pausedRuntimeStatusPayload.state, 'paused');

    const runtimeResumePayload = await requestJsonNoAuth(`${service.baseUrl}/api/runtime/resume`, 'POST', {});
    assert.equal(runtimeResumePayload.state, 'running');
    assert.equal(runtimeResumePayload.pausedAt, null);
  }

  const runtimeStopPayload = await requestJsonNoAuth(`${service.baseUrl}/api/runtime/stop`, 'POST', {});
  assert.equal(runtimeStopPayload.state, 'stopped');

  const buildLogPromise = waitForSseEvent(
    `${service.baseUrl}/api/events`,
    (event) => event.type === 'build.log' && String(event.data?.data || '').includes('build:runtime:boot'),
  );
  const buildCompletedPromise = waitForSseEvent(
    `${service.baseUrl}/api/events`,
    (event) => event.type === 'build.completed' && event.data?.target === 'runtime',
  );

  const buildStartPayload = await requestJsonNoAuth(`${service.baseUrl}/api/build/runtime`, 'POST', {
    config: 'Debug',
  });
  assert.equal(buildStartPayload.state, 'running');
  assert.equal(buildStartPayload.target, 'runtime');

  const buildLogEvent = await buildLogPromise;
  assert.equal(buildLogEvent.type, 'build.log');
  assert.match(buildLogEvent.data.data, /build:runtime:boot/);

  const buildCompletedEvent = await buildCompletedPromise;
  assert.equal(buildCompletedEvent.type, 'build.completed');
  assert.equal(buildCompletedEvent.data.state, 'succeeded');

  const buildStatusPayload = await requestJsonNoAuth(`${service.baseUrl}/api/build/status`);
  assert.equal(buildStatusPayload.state, 'succeeded');
  assert.equal(buildStatusPayload.target, 'runtime');

  const deletePayload = await requestJsonNoAuth(
    `${service.baseUrl}/api/sessions/${createPayload.session.id}`,
    'DELETE',
  );
  assert.equal(deletePayload.ok, true);

  await service.close();
  service = await startService();

  const emptyListPayload = await requestJsonNoAuth(`${service.baseUrl}/api/sessions`);
  assert.equal(emptyListPayload.sessions.some((session) => session.id === createPayload.session.id), false);

  const workspaceARoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-coord-a-'));
  const workspaceBRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-coord-b-'));
  const workspaceAPayload = await requestJsonNoAuth(`${service.baseUrl}/api/sessions`, 'POST', {
    name: 'coord-a',
    rootPath: workspaceARoot,
  });
  const workspaceBPayload = await requestJsonNoAuth(`${service.baseUrl}/api/sessions`, 'POST', {
    name: 'coord-b',
    rootPath: workspaceBRoot,
  });
  const workspaceAId = workspaceAPayload.session.id;
  const workspaceBId = workspaceBPayload.session.id;

  async function registerAgent(sessionId, name) {
    const result = await requestCoordination('/api/coordination/agents', 'POST', { sessionId, name });
    assert.equal(result.status, 201, result.payload.error || 'agent registration should succeed');
    assert.match(result.payload.agent.id, /^agent_/);
    assert.equal(result.payload.agent.sessionId, sessionId);
    assert.equal(result.payload.agent.status, 'connected');
    assert.match(result.payload.credential, /^[A-Za-z0-9_-]{40,}$/);
    return { ...result.payload.agent, credential: result.payload.credential };
  }

  async function requestLease(agent, resources, mode) {
    const result = await requestCoordination('/api/coordination/leases', 'POST', {
      agentId: agent.id,
      resources,
      mode,
    }, agent.credential);
    assert.equal(result.status, 200, result.payload.error || 'lease request should return structured JSON');
    return result.payload;
  }

  async function inspectCoordination(sessionId) {
    const suffix = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
    const result = await requestCoordination(`/api/coordination/state${suffix}`);
    assert.equal(result.status, 200, result.payload.error || 'coordination state should load');
    return result.payload;
  }

  async function releaseLease(agent, leaseId) {
    const result = await requestCoordination(
      `/api/coordination/leases/${encodeURIComponent(leaseId)}/release`,
      'POST',
      { agentId: agent.id },
      agent.credential,
    );
    assert.equal(result.status, 200, result.payload.error || 'lease release should succeed');
    return result.payload;
  }

  async function disconnectAgent(agent) {
    const result = await requestCoordination(
      `/api/coordination/agents/${encodeURIComponent(agent.id)}/disconnect`,
      'POST',
      {},
      agent.credential,
    );
    assert.equal(result.status, 200, result.payload.error || 'agent disconnect should succeed');
    return result.payload;
  }

  const coordinationEvents = await subscribeSessiondEvents();
  const sceneWriter = await registerAgent(workspaceAId, 'scene-writer');
  const assetWriter = await registerAgent(workspaceAId, 'asset-writer');
  const connectedEvent = await coordinationEvents.waitFor(
    (event) => event.type === 'coordination.agent.connected' && event.data?.id === sceneWriter.id,
  );
  assert.equal(connectedEvent.data.sessionId, workspaceAId);
  assert.equal(JSON.stringify(connectedEvent.data).includes(sceneWriter.credential), false);
  assert.equal(sceneWriter.expiresAt, coordinationIso(coordinationClock.nowMs + coordinationHeartbeatTimeoutMs));

  const heartbeatAdvanceMs = 4_000;
  coordinationClock.nowMs += heartbeatAdvanceMs;
  const heartbeatPayload = await requestCoordination(
    `/api/coordination/agents/${encodeURIComponent(sceneWriter.id)}/heartbeat`,
    'POST',
    {},
    sceneWriter.credential,
  );
  assert.equal(heartbeatPayload.status, 200);
  assert.equal(heartbeatPayload.payload.agent.lastHeartbeatAt, coordinationIso());
  assert.equal(
    heartbeatPayload.payload.agent.expiresAt,
    coordinationIso(coordinationClock.nowMs + coordinationHeartbeatTimeoutMs),
  );
  const missingCredential = await requestCoordination(
    `/api/coordination/agents/${encodeURIComponent(sceneWriter.id)}/heartbeat`,
    'POST',
    {},
  );
  assert.equal(missingCredential.status, 401);
  assert.match(missingCredential.payload.error, /credential is required/i);
  const wrongCredential = await requestCoordination(
    `/api/coordination/agents/${encodeURIComponent(sceneWriter.id)}/heartbeat`,
    'POST',
    {},
    'not-the-agent-credential',
  );
  assert.equal(wrongCredential.status, 401);
  assert.match(wrongCredential.payload.error, /invalid agent credential/i);

  const parallelSceneWrite = await requestLease(sceneWriter, ['file/scenes/town.scene'], 'write');
  const parallelAssetWrite = await requestLease(assetWriter, ['asset/textures/hero.png'], 'write');
  const parallelRuntimeWrite = await requestLease(sceneWriter, ['runtime'], 'write');
  const parallelBuildWrite = await requestLease(assetWriter, ['build'], 'write');
  assert.equal(parallelSceneWrite.status, 'granted');
  assert.equal(parallelSceneWrite.lease.status, 'granted');
  assert.deepEqual(parallelSceneWrite.lease.resources, ['file/scenes/town.scene']);
  assert.equal(parallelAssetWrite.status, 'granted');
  assert.equal(parallelRuntimeWrite.status, 'granted');
  assert.equal(parallelBuildWrite.status, 'granted');
  await releaseLease(sceneWriter, parallelRuntimeWrite.lease.id);
  await releaseLease(assetWriter, parallelBuildWrite.lease.id);

  const overlappingWriter = await registerAgent(workspaceAId, 'overlapping-writer');
  const overlappingWrite = await requestLease(
    overlappingWriter,
    ['File/Scenes/town.scene/npc-shop'],
    'write',
  );
  assert.equal(overlappingWrite.status, 'queued');
  assert.equal(overlappingWrite.lease.status, 'queued');
  assert.deepEqual(overlappingWrite.lease.resources, ['file/scenes/town.scene/npc-shop']);
  assert.equal(overlappingWrite.lease.queuePosition, 1);
  assert.ok(overlappingWrite.lease.blockedBy.some((blocker) => (
    blocker.id === parallelSceneWrite.lease.id && blocker.mode === 'write'
  )));
  const queuedOverlapEvent = await coordinationEvents.waitFor(
    (event) => event.type === 'coordination.lease.queued' && event.data?.id === overlappingWrite.lease.id,
  );
  assert.equal(queuedOverlapEvent.data.agentId, overlappingWriter.id);

  const concurrentOther = await registerAgent(workspaceAId, 'concurrent-other');
  const concurrentOtherWrite = await requestLease(concurrentOther, ['file/other.txt'], 'write');
  assert.equal(concurrentOtherWrite.status, 'granted');

  const overlapStatus = await requestCoordination(
    `/api/coordination/leases/${encodeURIComponent(overlappingWrite.lease.id)}`,
  );
  assert.equal(overlapStatus.status, 200);
  assert.equal(overlapStatus.payload.status, 'queued');
  assert.equal(overlapStatus.payload.lease.id, overlappingWrite.lease.id);

  const readerA = await registerAgent(workspaceAId, 'reader-a');
  const readerB = await registerAgent(workspaceAId, 'reader-b');
  const sharedReadA = await requestLease(readerA, ['scene/overworld'], 'read');
  const sharedReadB = await requestLease(readerB, ['scene/overworld'], 'read');
  assert.equal(sharedReadA.status, 'granted');
  assert.equal(sharedReadB.status, 'granted');

  const fairReader = await registerAgent(workspaceAId, 'fair-reader');
  const fairWriter = await registerAgent(workspaceAId, 'fair-writer');
  const lateReader = await registerAgent(workspaceAId, 'late-reader');
  const heldRead = await requestLease(fairReader, ['file/hero'], 'read');
  assert.equal(heldRead.status, 'granted');
  const queuedWriter = await requestLease(fairWriter, ['file/hero'], 'write');
  assert.equal(queuedWriter.status, 'queued');
  const starvedRead = await requestLease(lateReader, ['file/hero'], 'read');
  assert.equal(starvedRead.status, 'queued');
  assert.ok(starvedRead.lease.queuePosition > queuedWriter.lease.queuePosition);
  assert.ok(starvedRead.lease.blockedBy.some((blocker) => blocker.id === queuedWriter.lease.id));

  const isolatedA = await registerAgent(workspaceAId, 'isolated-a');
  const isolatedB = await registerAgent(workspaceBId, 'isolated-b');
  const isolatedWriteA = await requestLease(isolatedA, ['runtime'], 'write');
  const isolatedWriteB = await requestLease(isolatedB, ['runtime'], 'write');
  const isolatedFileA = await requestLease(isolatedA, ['file/shared.txt'], 'write');
  const isolatedFileB = await requestLease(isolatedB, ['file/shared.txt'], 'write');
  assert.equal(isolatedWriteA.status, 'granted');
  assert.equal(isolatedWriteB.status, 'granted');
  assert.equal(isolatedFileA.status, 'granted');
  assert.equal(isolatedFileB.status, 'granted');

  const workspaceAState = await inspectCoordination(workspaceAId);
  const workspaceBState = await inspectCoordination(workspaceBId);
  const globalState = await inspectCoordination();
  assert.equal(workspaceAState.sessionId, workspaceAId);
  assert.deepEqual(workspaceAState.exclusiveResources, ['build', 'runtime']);
  assert.ok(workspaceAState.agents.some((agent) => agent.id === sceneWriter.id));
  assert.equal(workspaceAState.agents.some((agent) => agent.id === isolatedB.id), false);
  assert.ok(workspaceAState.granted.some((lease) => lease.id === parallelSceneWrite.lease.id));
  assert.ok(workspaceAState.pending.some((lease) => lease.id === overlappingWrite.lease.id));
  assert.ok(workspaceAState.pending.some((lease) => lease.id === queuedWriter.lease.id));
  assert.ok(workspaceAState.pending.some((lease) => lease.id === starvedRead.lease.id));
  assert.equal(JSON.stringify(workspaceAState).includes(sceneWriter.credential), false);
  assert.equal(JSON.stringify(parallelSceneWrite.lease).includes(sceneWriter.credential), false);
  assert.equal(workspaceBState.sessionId, workspaceBId);
  assert.ok(workspaceBState.agents.some((agent) => agent.id === isolatedB.id));
  assert.ok(workspaceBState.granted.some((lease) => lease.id === isolatedWriteB.lease.id));
  assert.equal(workspaceBState.pending.length, 0);
  assert.equal(globalState.sessionId, null);
  assert.ok(globalState.agents.some((agent) => agent.id === isolatedA.id));
  assert.ok(globalState.agents.some((agent) => agent.id === isolatedB.id));

  const deletedWorkspaceB = await requestJsonNoAuth(
    `${service.baseUrl}/api/sessions/${encodeURIComponent(workspaceBId)}`,
    'DELETE',
  );
  assert.equal(deletedWorkspaceB.ok, true);
  const afterWorkspaceDelete = await inspectCoordination();
  assert.equal(afterWorkspaceDelete.agents.some((agent) => agent.id === isolatedB.id), false);
  assert.equal(afterWorkspaceDelete.granted.some((lease) => lease.sessionId === workspaceBId), false);
  assert.equal(afterWorkspaceDelete.pending.some((lease) => lease.sessionId === workspaceBId), false);

  const foreignRelease = await requestCoordination(
    `/api/coordination/leases/${encodeURIComponent(parallelSceneWrite.lease.id)}/release`,
    'POST',
    { agentId: assetWriter.id },
    assetWriter.credential,
  );
  assert.equal(foreignRelease.status, 403);
  assert.match(foreignRelease.payload.error, /owning agent/i);

  const releasedSceneWrite = await releaseLease(sceneWriter, parallelSceneWrite.lease.id);
  assert.equal(releasedSceneWrite.status, 'released');
  assert.equal(releasedSceneWrite.lease.status, 'released');
  const promotedOverlapEvent = await coordinationEvents.waitFor(
    (event) => event.type === 'coordination.lease.granted' && event.data?.id === overlappingWrite.lease.id,
  );
  assert.equal(promotedOverlapEvent.data.status, 'granted');
  const promotedOverlapStatus = await requestCoordination(
    `/api/coordination/leases/${encodeURIComponent(overlappingWrite.lease.id)}`,
  );
  assert.equal(promotedOverlapStatus.payload.status, 'granted');
  assert.equal(promotedOverlapStatus.payload.lease.grantedAt, coordinationIso());

  await releaseLease(fairReader, heldRead.lease.id);
  await coordinationEvents.waitFor(
    (event) => event.type === 'coordination.lease.granted' && event.data?.id === queuedWriter.lease.id,
  );
  const afterWriterPromotion = await inspectCoordination(workspaceAId);
  assert.ok(afterWriterPromotion.granted.some((lease) => lease.id === queuedWriter.lease.id));
  assert.ok(afterWriterPromotion.pending.some((lease) => lease.id === starvedRead.lease.id));
  assert.equal(afterWriterPromotion.granted.some((lease) => lease.id === starvedRead.lease.id), false);

  await releaseLease(fairWriter, queuedWriter.lease.id);
  const afterWriterRelease = await inspectCoordination(workspaceAId);
  assert.ok(afterWriterRelease.granted.some((lease) => lease.id === starvedRead.lease.id));
  assert.equal(afterWriterRelease.pending.some((lease) => lease.id === starvedRead.lease.id), false);

  const disconnectHolder = await registerAgent(workspaceAId, 'disconnect-holder');
  const disconnectWaiter = await registerAgent(workspaceAId, 'disconnect-waiter');
  const disconnectHeld = await requestLease(disconnectHolder, ['file/disconnect-lock'], 'write');
  assert.equal(disconnectHeld.status, 'granted');
  const disconnectQueued = await requestLease(disconnectWaiter, ['file/disconnect-lock'], 'write');
  assert.equal(disconnectQueued.status, 'queued');
  const disconnectPayload = await disconnectAgent(disconnectHolder);
  assert.equal(disconnectPayload.ok, true);
  assert.equal(disconnectPayload.agent.status, 'disconnected');
  assert.equal(disconnectPayload.agent.disconnectReason, 'disconnect');
  const disconnectEvent = await coordinationEvents.waitFor(
    (event) => event.type === 'coordination.agent.disconnected' && event.data?.id === disconnectHolder.id,
  );
  assert.equal(disconnectEvent.data.disconnectReason, 'disconnect');
  await coordinationEvents.waitFor(
    (event) => event.type === 'coordination.lease.granted' && event.data?.id === disconnectQueued.lease.id,
  );
  const afterDisconnect = await inspectCoordination(workspaceAId);
  assert.equal(afterDisconnect.agents.some((agent) => agent.id === disconnectHolder.id), false);
  assert.ok(afterDisconnect.granted.some((lease) => lease.id === disconnectQueued.lease.id));
  const releasedHeldStatus = await requestCoordination(
    `/api/coordination/leases/${encodeURIComponent(disconnectHeld.lease.id)}`,
  );
  assert.equal(releasedHeldStatus.payload.status, 'released');

  const invalidMode = await requestCoordination('/api/coordination/leases', 'POST', {
    agentId: sceneWriter.id,
    resources: ['file/valid.txt'],
    mode: 'exclusive',
  }, sceneWriter.credential);
  assert.equal(invalidMode.status, 400);
  assert.match(invalidMode.payload.error, /mode must be read or write/i);
  assert.equal(invalidMode.payload.error.includes('500'), false);

  const invalidEmptyResources = await requestCoordination('/api/coordination/leases', 'POST', {
    agentId: sceneWriter.id,
    resources: [],
    mode: 'write',
  }, sceneWriter.credential);
  assert.equal(invalidEmptyResources.status, 400);
  assert.match(invalidEmptyResources.payload.error, /resources must be a non-empty array/i);

  const invalidAncestorEscape = await requestCoordination('/api/coordination/leases', 'POST', {
    agentId: sceneWriter.id,
    resources: ['file/../secret'],
    mode: 'write',
  }, sceneWriter.credential);
  assert.equal(invalidAncestorEscape.status, 400);
  assert.match(invalidAncestorEscape.payload.error, /Invalid resource key segment/i);

  const invalidWildcard = await requestCoordination('/api/coordination/leases', 'POST', {
    agentId: sceneWriter.id,
    resources: ['file/hero*'],
    mode: 'read',
  }, sceneWriter.credential);
  assert.equal(invalidWildcard.status, 400);
  assert.match(invalidWildcard.payload.error, /Invalid resource key segment/i);

  const unknownSession = await requestCoordination('/api/coordination/agents', 'POST', {
    sessionId: 'session_missing',
    name: 'ghost',
  });
  assert.equal(unknownSession.status, 404);
  assert.match(unknownSession.payload.error, /Unknown session/);

  const unknownState = await requestCoordination(
    `/api/coordination/state?sessionId=${encodeURIComponent('session_missing')}`,
  );
  assert.equal(unknownState.status, 404);

  const expiryHolder = await registerAgent(workspaceAId, 'expiry-holder');
  const expiryHeld = await requestLease(expiryHolder, ['file/expiry-lock'], 'write');
  assert.equal(expiryHeld.status, 'granted');
  coordinationClock.nowMs += 1;
  const expiryWaiter = await registerAgent(workspaceAId, 'expiry-waiter');
  const expiryQueued = await requestLease(expiryWaiter, ['file/expiry-lock'], 'write');
  assert.equal(expiryQueued.status, 'queued');
  coordinationClock.nowMs = Date.parse(expiryHolder.expiresAt);
  const afterExpiry = await inspectCoordination(workspaceAId);
  const expiredEvent = await coordinationEvents.waitFor(
    (event) => event.type === 'coordination.lease.expired' && event.data?.id === expiryHeld.lease.id,
  );
  await coordinationEvents.waitFor(
    (event) => event.type === 'coordination.lease.granted' && event.data?.id === expiryQueued.lease.id,
  );
  assert.equal(expiredEvent.data.status, 'expired');
  assert.equal(afterExpiry.agents.some((agent) => agent.id === expiryHolder.id), false);
  assert.ok(afterExpiry.agents.some((agent) => agent.id === expiryWaiter.id));
  assert.ok(afterExpiry.granted.some((lease) => lease.id === expiryQueued.lease.id));
  const expiredLeaseStatus = await requestCoordination(
    `/api/coordination/leases/${encodeURIComponent(expiryHeld.lease.id)}`,
  );
  assert.equal(expiredLeaseStatus.payload.status, 'expired');

  await coordinationEvents.close();
  await fs.rm(workspaceARoot, { recursive: true, force: true });
  await fs.rm(workspaceBRoot, { recursive: true, force: true });

  console.log('Engine sessiond smoke passed.');
  console.log(`- Started engine_sessiond at ${service.baseUrl}`);
  console.log(`- Created session for ${path.basename(repoRoot)} and restored it after restarting engine_sessiond`);
  console.log('- Verified CORS preflight plus persistent session create/update/delete and safe file/host-fs listing APIs');
  console.log('- Verified git status and git-init APIs against real session roots');
  console.log('- Verified PTY terminal open/input/stream/close flow');
  console.log(`- Verified runtime start/status/log/${isWindows ? 'stop' : 'pause/resume/stop'} lifecycle`);
  console.log('- Verified runtime build start/log/completion lifecycle');
  console.log('- Verified in-process multi-agent coordination leases, queue promotion, expiry, and isolation');
} finally {
  await service.close();
  await fs.rm(sessionStateDir, { recursive: true, force: true });
}
