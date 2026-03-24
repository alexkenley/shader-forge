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
  });
}

let service = await startService();

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

try {
  const health = await requestJsonNoAuth(`${service.baseUrl}/health`);
  assert.equal(health.ok, true);
  assert.equal(health.service, 'engine_sessiond');

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

  console.log('Engine sessiond smoke passed.');
  console.log(`- Started engine_sessiond at ${service.baseUrl}`);
  console.log(`- Created session for ${path.basename(repoRoot)} and restored it after restarting engine_sessiond`);
  console.log('- Verified CORS preflight plus persistent session create/update/delete and safe file/host-fs listing APIs');
  console.log('- Verified git status and git-init APIs against real session roots');
  console.log('- Verified PTY terminal open/input/stream/close flow');
  console.log(`- Verified runtime start/status/log/${isWindows ? 'stop' : 'pause/resume/stop'} lifecycle`);
  console.log('- Verified runtime build start/log/completion lifecycle');
} finally {
  await service.close();
  await fs.rm(sessionStateDir, { recursive: true, force: true });
}
