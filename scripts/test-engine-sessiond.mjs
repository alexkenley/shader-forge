import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { repoRootFromScript, requestJsonNoAuth } from './lib/harness-utils.mjs';
import { startEngineSessiond } from '../tools/engine-sessiond/server.mjs';
import { OperationStore } from '../tools/engine-sessiond/lib/operation-store.mjs';
import { SessionStore, textContentRevision } from '../tools/engine-sessiond/lib/session-store.mjs';
import {
  recordCodeTrustArtifact,
  restoreCodeTrustArtifact,
  transitionCodeTrustArtifact,
} from '../tools/shared/code-trust-policy.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const sessionStateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-sessiond-state-'));
const sessionStorePath = path.join(sessionStateDir, 'sessions.json');
const coordinationClock = { nowMs: Date.parse('2026-08-30T12:00:00.000Z') };
const coordinationHeartbeatTimeoutMs = 10_000;

async function tryCreateDirectoryLink(targetPath, linkPath) {
  try {
    await fs.symlink(targetPath, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    return true;
  } catch (error) {
    if (
      error
      && typeof error === 'object'
      && 'code' in error
      && ['EACCES', 'ENOSYS', 'ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'UNKNOWN'].includes(error.code)
    ) {
      return false;
    }
    throw error;
  }
}

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

function postAccumulatedJsonBody(url, chunks) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const request = http.request({
      method: 'POST',
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname + parsed.search,
      headers: {
        'Content-Type': 'application/json',
        Connection: 'close',
      },
    }, (response) => {
      const parts = [];
      response.on('data', (chunk) => {
        parts.push(chunk);
      });
      response.on('end', () => {
        const text = Buffer.concat(parts).toString('utf8');
        let payload = {};
        if (text) {
          try {
            payload = JSON.parse(text);
          } catch {
            payload = { error: text };
          }
        }
        resolve({ status: response.statusCode, payload, text });
      });
    });
    request.setTimeout(10_000, () => {
      request.destroy(new Error('Timed out posting accumulated JSON body.'));
    });
    request.on('error', reject);
    for (const chunk of chunks) {
      request.write(chunk);
    }
    request.end();
  });
}

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
  assert.ok(health.capabilities.includes('operations'));
  assert.ok(health.capabilities.includes('operations:file-write'));
  assert.ok(health.capabilities.includes('operations:scene-asset'));

  const jsonLimitBytes = 1024 * 1024;
  const oversizedPrefix = Buffer.from('{"content":"');
  const oversizedSuffix = Buffer.from('"}');
  const oversizedBody = await postAccumulatedJsonBody(`${service.baseUrl}/api/sessions`, [
    oversizedPrefix,
    Buffer.alloc(jsonLimitBytes, 0x61),
    Buffer.from('a'),
    oversizedSuffix,
  ]);
  assert.equal(oversizedBody.status, 413);
  assert.equal(typeof oversizedBody.payload.error, 'string');
  assert.match(oversizedBody.payload.error, /1 MiB/i);
  assert.equal(oversizedBody.text.includes('a'.repeat(64)), false);
  assert.ok(oversizedBody.payload.error.length < 256);

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
  assert.equal(updatedSessionPayload.session.rootPath, repoRoot);

  const immutableRootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-session-root-'));
  const blockedRootUpdate = await fetch(
    `${service.baseUrl}/api/sessions/${encodeURIComponent(createPayload.session.id)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rootPath: immutableRootDir }),
    },
  );
  const blockedRootPayload = await blockedRootUpdate.json();
  assert.equal(blockedRootUpdate.status, 409);
  assert.match(blockedRootPayload.error, /rootPath is immutable after creation/i);
  const unchangedSession = await requestJsonNoAuth(
    `${service.baseUrl}/api/sessions/${createPayload.session.id}`,
  );
  assert.equal(unchangedSession.session.rootPath, repoRoot);
  await fs.rm(immutableRootDir, { recursive: true, force: true });

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

  const dedupeContainer = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-session-root-'));
  const dedupeRoot = path.join(dedupeContainer, 'WorkspaceRoot');
  const dedupeAlias = path.join(dedupeContainer, 'WorkspaceAlias');
  await fs.mkdir(dedupeRoot);
  const dedupeAliasCreated = await tryCreateDirectoryLink(dedupeRoot, dedupeAlias);
  const rootSpellings = [
    dedupeRoot,
    path.join(dedupeRoot, '.'),
    ...(process.platform === 'win32' ? [dedupeRoot.toUpperCase(), dedupeRoot.toLowerCase()] : []),
    ...(dedupeAliasCreated ? [dedupeAlias] : []),
  ];
  const concurrentSessions = await Promise.all(
    Array.from({ length: 12 }, (_, index) => requestJsonNoAuth(
      `${service.baseUrl}/api/sessions`,
      'POST',
      {
        name: `concurrent-root-${index}`,
        rootPath: rootSpellings[index % rootSpellings.length],
      },
    )),
  );
  const concurrentSessionIds = new Set(concurrentSessions.map((payload) => payload.session.id));
  assert.equal(concurrentSessionIds.size, 1);
  assert.equal(concurrentSessions[0].session.rootPath, await fs.realpath(dedupeRoot));
  const concurrentRootId = concurrentSessions[0].session.id;
  const afterConcurrentCreate = await requestJsonNoAuth(`${service.baseUrl}/api/sessions`);
  assert.equal(
    afterConcurrentCreate.sessions.filter((session) => session.id === concurrentRootId).length,
    1,
  );
  await requestJsonNoAuth(
    `${service.baseUrl}/api/sessions/${encodeURIComponent(concurrentRootId)}`,
    'DELETE',
  );
  if (dedupeAliasCreated) {
    await fs.unlink(dedupeAlias);
  }
  await fs.rm(dedupeContainer, { recursive: true, force: true });

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
  assert.equal(fileReadPayload.revision, textContentRevision(fileReadPayload.content));
  await assert.rejects(
    service.sessionStore.listFilesBounded(createPayload.session.id, '.', { maxEntries: 1 }),
    (error) => error.statusCode === 413 && error.code === 'directory_entry_limit_exceeded',
  );
  await assert.rejects(
    service.sessionStore.readFileBounded(createPayload.session.id, 'README.md', { maxBytes: 1 }),
    (error) => error.statusCode === 413 && error.code === 'file_size_limit_exceeded',
  );
  const boundedRouteRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-bounded-files-'));
  await fs.writeFile(path.join(boundedRouteRoot, 'oversized.txt'), 'x'.repeat(1024 * 1024 + 1));
  const crowdedDirectory = path.join(boundedRouteRoot, 'crowded');
  await fs.mkdir(crowdedDirectory);
  for (let start = 0; start < 4097; start += 128) {
    await Promise.all(Array.from({ length: Math.min(128, 4097 - start) }, (_, offset) => (
      fs.writeFile(path.join(crowdedDirectory, `${start + offset}.txt`), '')
    )));
  }
  const boundedRouteSession = await requestJsonNoAuth(`${service.baseUrl}/api/sessions`, 'POST', {
    name: 'bounded-files', rootPath: boundedRouteRoot,
  });
  const oversizedResponse = await fetch(
    `${service.baseUrl}/api/files/read?sessionId=${encodeURIComponent(boundedRouteSession.session.id)}&path=oversized.txt`,
  );
  assert.equal(oversizedResponse.status, 413);
  assert.equal((await oversizedResponse.json()).code, 'file_size_limit_exceeded');
  const crowdedResponse = await fetch(
    `${service.baseUrl}/api/files/list?sessionId=${encodeURIComponent(boundedRouteSession.session.id)}&path=crowded`,
  );
  assert.equal(crowdedResponse.status, 413);
  assert.equal((await crowdedResponse.json()).code, 'directory_entry_limit_exceeded');
  await requestJsonNoAuth(
    `${service.baseUrl}/api/sessions/${encodeURIComponent(boundedRouteSession.session.id)}`,
    'DELETE',
  );
  await fs.rm(boundedRouteRoot, { recursive: true, force: true });

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

  const boundaryContainer = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-session-boundary-'));
  const boundaryWorkspace = path.join(boundaryContainer, 'workspace');
  const boundaryOutside = path.join(boundaryContainer, 'outside');
  const boundaryLink = path.join(boundaryWorkspace, 'outside-link');
  const boundarySafeTarget = path.join(boundaryWorkspace, 'safe-target');
  const boundarySafeLink = path.join(boundaryWorkspace, 'safe-link');
  await fs.mkdir(boundaryWorkspace);
  await fs.mkdir(boundaryOutside);
  await fs.mkdir(boundarySafeTarget);
  await fs.writeFile(path.join(boundaryOutside, 'secret.txt'), 'outside\n', 'utf8');
  await fs.writeFile(path.join(boundarySafeTarget, 'inside.txt'), 'inside\n', 'utf8');
  const boundaryLinkCreated = await tryCreateDirectoryLink(boundaryOutside, boundaryLink);
  const boundarySafeLinkCreated = boundaryLinkCreated
    ? await tryCreateDirectoryLink(boundarySafeTarget, boundarySafeLink)
    : false;
  const boundarySession = await requestJsonNoAuth(`${service.baseUrl}/api/sessions`, 'POST', {
    name: 'physical-boundary',
    rootPath: boundaryWorkspace,
  });
  if (boundaryLinkCreated) {
    const escapedList = await requestJsonNoAuth(
      `${service.baseUrl}/api/files/list?sessionId=${encodeURIComponent(boundarySession.session.id)}&path=${encodeURIComponent('outside-link')}`,
    );
    assert.match(escapedList.error, /escapes physical session root/i);

    const escapedRead = await requestJsonNoAuth(
      `${service.baseUrl}/api/files/read?sessionId=${encodeURIComponent(boundarySession.session.id)}&path=${encodeURIComponent('outside-link/secret.txt')}`,
    );
    assert.match(escapedRead.error, /escapes physical session root/i);

    const escapedWrite = await requestJsonNoAuth(`${service.baseUrl}/api/files/write`, 'POST', {
      sessionId: boundarySession.session.id,
      path: 'outside-link/created.txt',
      content: 'must not escape\n',
    });
    assert.match(escapedWrite.error, /escapes physical session root/i);
    await assert.rejects(fs.stat(path.join(boundaryOutside, 'created.txt')), { code: 'ENOENT' });

    if (boundarySafeLinkCreated) {
      const safeLinkedRead = await requestJsonNoAuth(
        `${service.baseUrl}/api/files/read?sessionId=${encodeURIComponent(boundarySession.session.id)}&path=${encodeURIComponent('safe-link/inside.txt')}`,
      );
      assert.equal(safeLinkedRead.content, 'inside\n');
      const safeLinkedWrite = await requestJsonNoAuth(`${service.baseUrl}/api/files/write`, 'POST', {
        sessionId: boundarySession.session.id,
        path: 'safe-link/created.txt',
        content: 'inside write\n',
      });
      assert.equal(safeLinkedWrite.content, 'inside write\n');
      assert.equal(
        await fs.readFile(path.join(boundarySafeTarget, 'created.txt'), 'utf8'),
        'inside write\n',
      );
    }
  }
  await requestJsonNoAuth(
    `${service.baseUrl}/api/sessions/${encodeURIComponent(boundarySession.session.id)}`,
    'DELETE',
  );
  if (boundaryLinkCreated) {
    await fs.unlink(boundaryLink);
  }
  if (boundarySafeLinkCreated) {
    await fs.unlink(boundarySafeLink);
  }
  await fs.rm(boundaryContainer, { recursive: true, force: true });

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
  const sharedReadA = await requestLease(readerA, ['scene/world/overworld'], 'read');
  const sharedReadB = await requestLease(readerB, ['scene/world/overworld'], 'read');
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

  function sha256Revision(content) {
    return `sha256:${createHash('sha256').update(String(content), 'utf8').digest('hex')}`;
  }

  async function requestOperation(pathname, method = 'GET', body) {
    const headers = {};
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
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

  const operationRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-operations-'));
  const existingFilePath = 'notes/existing.txt';
  const createdFilePath = 'notes/created.txt';
  const existingContent = 'alpha\nbeta\n';
  const proposedContent = 'alpha\nbeta\ngamma\n';
  await fs.mkdir(path.join(operationRoot, 'notes'));
  await fs.writeFile(path.join(operationRoot, existingFilePath), existingContent, 'utf8');
  const operationSession = await requestJsonNoAuth(`${service.baseUrl}/api/sessions`, 'POST', {
    name: 'operations-workspace',
    rootPath: operationRoot,
  });
  const operationSessionId = operationSession.session.id;
  const shellActor = {
    kind: 'shell',
    id: 'engine-shell',
    name: 'Engine Shell',
    credential: 'must-never-persist',
  };
  const humanActor = {
    kind: 'human',
    id: 'operator',
    name: 'Operator',
  };
  const existingRevision = sha256Revision(existingContent);
  const proposedRevision = sha256Revision(proposedContent);
  const operationEvents = await subscribeSessiondEvents();

  const previewResult = await requestOperation('/api/operations/file-write/preview', 'POST', {
    sessionId: operationSessionId,
    path: existingFilePath,
    content: proposedContent,
    baseRevision: existingRevision,
    actor: shellActor,
  });
  assert.equal(previewResult.status, 201, previewResult.payload.error || 'preview should succeed');
  const previewed = previewResult.payload.operation;
  assert.match(previewed.id, /^op_/);
  assert.equal(previewed.kind, 'file_write');
  assert.equal(previewed.sessionId, operationSessionId);
  assert.equal(previewed.path, existingFilePath);
  assert.equal(previewed.workspaceRoot, await fs.realpath(operationRoot));
  assert.equal(previewed.workspaceIdentity.canonicalPath, previewed.workspaceRoot);
  assert.equal(typeof previewed.workspaceIdentity.dev, 'string');
  assert.equal(typeof previewed.workspaceIdentity.ino, 'string');
  assert.ok(previewed.workspaceIdentity.dev);
  assert.ok(previewed.workspaceIdentity.ino);
  assert.equal(previewed.state, 'previewed');
  assert.equal(previewed.codeTrustEffect.status, 'idle');
  assert.equal(previewed.validation, null);
  assert.equal('proposedContent' in previewed, false);
  assert.equal(previewed.baseRevision, existingRevision);
  assert.equal(previewed.proposedRevision, proposedRevision);
  assert.equal(previewed.appliedRevision, null);
  assert.equal(previewed.actor.kind, 'shell');
  assert.equal(previewed.actor.id, 'engine-shell');
  assert.equal(previewed.actor.name, 'Engine Shell');
  assert.equal('credential' in previewed.actor, false);
  assert.equal(previewed.preview.addedLines > 0, true);
  assert.equal(typeof previewed.preview.summary, 'string');
  assert.ok(previewed.events.some((event) => event.type === 'previewed'));
  assert.equal(
    await fs.readFile(path.join(operationRoot, existingFilePath), 'utf8'),
    existingContent,
  );
  const previewedEvent = await operationEvents.waitFor(
    (event) => event.type === 'operation.previewed' && event.data?.id === previewed.id,
  );
  assert.equal(previewedEvent.data.state, 'previewed');
  assert.equal(JSON.stringify(previewedEvent.data).includes('must-never-persist'), false);

  const exactDiff = await requestOperation(
    `/api/operations/${encodeURIComponent(previewed.id)}/diff`,
  );
  assert.equal(exactDiff.status, 200, exactDiff.payload.error || 'operation diff should succeed');
  assert.equal(exactDiff.payload.diff.operationId, previewed.id);
  assert.equal(exactDiff.payload.diff.path, existingFilePath);
  assert.equal(exactDiff.payload.diff.beforeRevision, existingRevision);
  assert.equal(exactDiff.payload.diff.afterRevision, proposedRevision);
  assert.equal(exactDiff.payload.diff.status, 'available');
  assert.equal(exactDiff.payload.diff.reason, null);
  assert.equal(exactDiff.payload.diff.truncated, false);
  assert.equal(exactDiff.payload.diff.summary.summary, previewed.preview.summary);
  assert.deepEqual(
    exactDiff.payload.diff.hunks.flatMap((hunk) => hunk.lines).map((line) => ({
      type: line.type,
      oldLine: line.oldLine,
      newLine: line.newLine,
      text: line.text,
      ending: line.ending,
    })),
    [
      { type: 'context', oldLine: 1, newLine: 1, text: 'alpha', ending: 'lf' },
      { type: 'context', oldLine: 2, newLine: 2, text: 'beta', ending: 'lf' },
      { type: 'added', oldLine: null, newLine: 3, text: 'gamma', ending: 'lf' },
    ],
  );
  assert.equal(JSON.stringify(exactDiff.payload).includes('beforeContent'), false);
  assert.equal(JSON.stringify(exactDiff.payload).includes('proposedContent'), false);
  assert.equal(JSON.stringify(exactDiff.payload).includes('must-never-persist'), false);

  const binaryPreview = await requestOperation('/api/operations/file-write/preview', 'POST', {
    sessionId: operationSessionId,
    path: 'notes/binary-like.txt',
    content: 'not-text\u0001payload',
    baseRevision: 'missing',
    actor: humanActor,
  });
  assert.equal(binaryPreview.status, 201);
  const binaryDiff = await requestOperation(
    `/api/operations/${encodeURIComponent(binaryPreview.payload.operation.id)}/diff`,
  );
  assert.equal(binaryDiff.status, 200);
  assert.equal(binaryDiff.payload.diff.status, 'summary_only');
  assert.equal(binaryDiff.payload.diff.reason, 'binary');
  assert.equal(binaryDiff.payload.diff.truncated, false);
  assert.deepEqual(binaryDiff.payload.diff.hunks, []);

  const largePreview = await requestOperation('/api/operations/file-write/preview', 'POST', {
    sessionId: operationSessionId,
    path: 'notes/too-large.txt',
    content: 'x'.repeat(270 * 1024),
    baseRevision: 'missing',
    actor: humanActor,
  });
  assert.equal(largePreview.status, 201);
  const largeDiff = await requestOperation(
    `/api/operations/${encodeURIComponent(largePreview.payload.operation.id)}/diff`,
  );
  assert.equal(largeDiff.status, 200);
  assert.equal(largeDiff.payload.diff.status, 'summary_only');
  assert.equal(largeDiff.payload.diff.reason, 'too_large');
  assert.equal(largeDiff.payload.diff.truncated, true);
  assert.deepEqual(largeDiff.payload.diff.hunks, []);

  const truncatedPreview = await requestOperation('/api/operations/file-write/preview', 'POST', {
    sessionId: operationSessionId,
    path: 'notes/truncated.txt',
    content: `${Array.from({ length: 450 }, (_, index) => `line-${index + 1}`).join('\n')}\n`,
    baseRevision: 'missing',
    actor: humanActor,
  });
  assert.equal(truncatedPreview.status, 201);
  const truncatedDiff = await requestOperation(
    `/api/operations/${encodeURIComponent(truncatedPreview.payload.operation.id)}/diff`,
  );
  assert.equal(truncatedDiff.status, 200);
  assert.equal(truncatedDiff.payload.diff.status, 'available');
  assert.equal(truncatedDiff.payload.diff.truncated, true);
  assert.equal(
    truncatedDiff.payload.diff.hunks.reduce((count, hunk) => count + hunk.lines.length, 0),
    400,
  );
  assert.equal(truncatedDiff.payload.diff.hunks[0].oldStart, 0);
  assert.equal(truncatedDiff.payload.diff.hunks[0].oldLines, 0);
  assert.equal(truncatedDiff.payload.diff.hunks[0].newStart, 1);
  assert.equal(truncatedDiff.payload.diff.hunks[0].newLines, 400);

  const missingDiff = await requestOperation('/api/operations/op_missing/diff');
  assert.equal(missingDiff.status, 404);
  assert.match(missingDiff.payload.error, /unknown operation/i);

  const stalePreview = await requestOperation('/api/operations/file-write/preview', 'POST', {
    sessionId: operationSessionId,
    path: existingFilePath,
    content: 'stale\n',
    baseRevision: sha256Revision('not-the-current-bytes'),
    actor: humanActor,
  });
  assert.equal(stalePreview.status, 409);
  assert.equal(stalePreview.payload.conflict.code, 'revision_conflict');
  assert.equal(stalePreview.payload.conflict.path, existingFilePath);
  assert.equal(stalePreview.payload.conflict.actualRevision, existingRevision);
  assert.equal(
    await fs.readFile(path.join(operationRoot, existingFilePath), 'utf8'),
    existingContent,
  );

  const invalidActor = await requestOperation('/api/operations/file-write/preview', 'POST', {
    sessionId: operationSessionId,
    path: existingFilePath,
    content: proposedContent,
    baseRevision: existingRevision,
    actor: { kind: 'assistant', id: 'gpt', name: 'GPT' },
  });
  assert.equal(invalidActor.status, 400);
  assert.match(invalidActor.payload.error, /actor\.kind must be human, shell, cli, or mcp/i);

  const applyBeforeApprove = await requestOperation(
    `/api/operations/${encodeURIComponent(previewed.id)}/apply`,
    'POST',
    { actor: humanActor },
  );
  assert.equal(applyBeforeApprove.status, 409);
  assert.match(applyBeforeApprove.payload.error, /cannot be applied from state previewed/i);
  assert.equal(applyBeforeApprove.payload.code, 'operation_state_conflict');
  assert.equal(applyBeforeApprove.payload.operation.id, previewed.id);
  assert.equal(applyBeforeApprove.payload.operation.state, 'previewed');
  assert.equal('proposedContent' in applyBeforeApprove.payload.operation, false);

  const undoBeforeApply = await requestOperation(
    `/api/operations/${encodeURIComponent(previewed.id)}/undo`,
    'POST',
    { actor: humanActor },
  );
  assert.equal(undoBeforeApply.status, 409);
  assert.match(undoBeforeApply.payload.error, /cannot be undone from state previewed/i);
  assert.equal(undoBeforeApply.payload.code, 'operation_state_conflict');
  assert.equal(undoBeforeApply.payload.operation.id, previewed.id);
  assert.equal(undoBeforeApply.payload.operation.state, 'previewed');

  const approvedResult = await requestOperation(
    `/api/operations/${encodeURIComponent(previewed.id)}/approve`,
    'POST',
    { actor: humanActor },
  );
  assert.equal(approvedResult.status, 200, approvedResult.payload.error || 'approve should succeed');
  assert.equal(approvedResult.payload.operation.state, 'approved');
  await operationEvents.waitFor(
    (event) => event.type === 'operation.approved' && event.data?.id === previewed.id,
  );

  const approveAgain = await requestOperation(
    `/api/operations/${encodeURIComponent(previewed.id)}/approve`,
    'POST',
    { actor: humanActor },
  );
  assert.equal(approveAgain.status, 409);
  assert.match(approveAgain.payload.error, /cannot be approved from state approved/i);
  assert.equal(approveAgain.payload.code, 'operation_state_conflict');
  assert.equal(approveAgain.payload.operation.id, previewed.id);
  assert.equal(approveAgain.payload.operation.state, 'approved');

  const conflictWorkspaceFile = path.join(operationRoot, existingFilePath);
  await fs.writeFile(conflictWorkspaceFile, 'external change\n', 'utf8');
  const externalConflict = await requestOperation(
    `/api/operations/${encodeURIComponent(previewed.id)}/apply`,
    'POST',
    { actor: humanActor },
  );
  assert.equal(externalConflict.status, 409);
  assert.equal(externalConflict.payload.conflict.code, 'revision_conflict');
  assert.equal(externalConflict.payload.conflict.expectedRevision, existingRevision);
  assert.equal(externalConflict.payload.conflict.actualRevision, sha256Revision('external change\n'));
  assert.equal(externalConflict.payload.operation.state, 'conflicted');
  assert.equal(await fs.readFile(conflictWorkspaceFile, 'utf8'), 'external change\n');
  await operationEvents.waitFor(
    (event) => event.type === 'operation.conflicted' && event.data?.id === previewed.id,
  );
  await fs.writeFile(conflictWorkspaceFile, existingContent, 'utf8');

  const applyAfterConflict = await requestOperation(
    `/api/operations/${encodeURIComponent(previewed.id)}/apply`,
    'POST',
    { actor: humanActor },
  );
  assert.equal(applyAfterConflict.status, 409);

  const applyPreview = await requestOperation('/api/operations/file-write/preview', 'POST', {
    sessionId: operationSessionId,
    path: existingFilePath,
    content: proposedContent,
    baseRevision: existingRevision,
    actor: shellActor,
  });
  assert.equal(applyPreview.status, 201, applyPreview.payload.error || 'second preview should succeed');
  const applyOperationId = applyPreview.payload.operation.id;
  const approveApply = await requestOperation(
    `/api/operations/${encodeURIComponent(applyOperationId)}/approve`,
    'POST',
    { actor: humanActor },
  );
  assert.equal(approveApply.status, 200);
  const appliedResult = await requestOperation(
    `/api/operations/${encodeURIComponent(applyOperationId)}/apply`,
    'POST',
    { actor: humanActor },
  );
  assert.equal(appliedResult.status, 200, appliedResult.payload.error || 'apply should succeed');
  assert.equal(appliedResult.payload.operation.state, 'applied');
  assert.equal(appliedResult.payload.operation.appliedRevision, proposedRevision);
  assert.equal(appliedResult.payload.operation.codeTrustEffect.status, 'recorded');
  assert.equal(appliedResult.payload.operation.codeTrustEffect.phase, 'apply');
  assert.equal(await fs.readFile(conflictWorkspaceFile, 'utf8'), proposedContent);
  const artifactsAfterApply = JSON.parse(
    await fs.readFile(path.join(operationRoot, '.shader-forge', 'code-trust-artifacts.json'), 'utf8'),
  );
  const appliedArtifact = artifactsAfterApply.artifacts.find((artifact) => artifact.path === existingFilePath);
  assert.ok(appliedArtifact);
  assert.equal(appliedArtifact.contentHash, proposedRevision.slice('sha256:'.length));
  await operationEvents.waitFor(
    (event) => event.type === 'operation.applied' && event.data?.id === applyOperationId,
  );

  const rejectAfterApply = await requestOperation(
    `/api/operations/${encodeURIComponent(applyOperationId)}/reject`,
    'POST',
    { actor: humanActor },
  );
  assert.equal(rejectAfterApply.status, 409);

  const undoneResult = await requestOperation(
    `/api/operations/${encodeURIComponent(applyOperationId)}/undo`,
    'POST',
    { actor: humanActor },
  );
  assert.equal(undoneResult.status, 200, undoneResult.payload.error || 'undo should succeed');
  assert.equal(undoneResult.payload.operation.state, 'undone');
  assert.equal(undoneResult.payload.operation.resultingRevision, existingRevision);
  assert.equal(undoneResult.payload.operation.codeTrustEffect.status, 'reverted');
  assert.equal(undoneResult.payload.operation.codeTrustEffect.phase, 'undo');
  assert.equal(await fs.readFile(conflictWorkspaceFile, 'utf8'), existingContent);
  const artifactsAfterUndo = JSON.parse(
    await fs.readFile(path.join(operationRoot, '.shader-forge', 'code-trust-artifacts.json'), 'utf8'),
  );
  const undoneArtifact = artifactsAfterUndo.artifacts.find((artifact) => artifact.path === existingFilePath);
  assert.equal(undoneArtifact, undefined);
  await operationEvents.waitFor(
    (event) => event.type === 'operation.undone' && event.data?.id === applyOperationId,
  );

  const undoAgain = await requestOperation(
    `/api/operations/${encodeURIComponent(applyOperationId)}/undo`,
    'POST',
    { actor: humanActor },
  );
  assert.equal(undoAgain.status, 409);

  const createdPreview = await requestOperation('/api/operations/file-write/preview', 'POST', {
    sessionId: operationSessionId,
    path: createdFilePath,
    content: 'brand new file\n',
    baseRevision: 'missing',
    actor: { kind: 'cli', id: 'engine-cli', name: 'Engine CLI' },
  });
  assert.equal(createdPreview.status, 201, createdPreview.payload.error || 'created-file preview should succeed');
  assert.equal(createdPreview.payload.operation.baseRevision, 'missing');
  assert.equal(createdPreview.payload.operation.preview.created, true);
  await assert.rejects(fs.stat(path.join(operationRoot, createdFilePath)), { code: 'ENOENT' });
  await requestOperation(
    `/api/operations/${encodeURIComponent(createdPreview.payload.operation.id)}/approve`,
    'POST',
    { actor: humanActor },
  );
  const createdApply = await requestOperation(
    `/api/operations/${encodeURIComponent(createdPreview.payload.operation.id)}/apply`,
    'POST',
    { actor: humanActor },
  );
  assert.equal(createdApply.status, 200, createdApply.payload.error || 'created-file apply should succeed');
  assert.equal(
    await fs.readFile(path.join(operationRoot, createdFilePath), 'utf8'),
    'brand new file\n',
  );
  const createdUndo = await requestOperation(
    `/api/operations/${encodeURIComponent(createdPreview.payload.operation.id)}/undo`,
    'POST',
    { actor: humanActor },
  );
  assert.equal(createdUndo.status, 200, createdUndo.payload.error || 'created-file undo should succeed');
  assert.equal(createdUndo.payload.operation.state, 'undone');
  assert.equal(createdUndo.payload.operation.resultingRevision, 'missing');
  assert.equal(createdUndo.payload.operation.codeTrustEffect.status, 'reverted');
  await assert.rejects(fs.stat(path.join(operationRoot, createdFilePath)), { code: 'ENOENT' });
  const artifactsAfterCreatedUndo = JSON.parse(
    await fs.readFile(path.join(operationRoot, '.shader-forge', 'code-trust-artifacts.json'), 'utf8'),
  );
  const createdArtifact = artifactsAfterCreatedUndo.artifacts.find((artifact) => artifact.path === createdFilePath);
  assert.equal(createdArtifact, undefined);

  const promotedPath = 'notes/promoted.txt';
  const promotedOriginal = 'owned-by-project\n';
  const promotedUpdated = 'operation-changed\n';
  await fs.writeFile(path.join(operationRoot, promotedPath), promotedOriginal, 'utf8');
  await requestJsonNoAuth(`${service.baseUrl}/api/files/write`, 'POST', {
    sessionId: operationSessionId,
    path: promotedPath,
    content: promotedOriginal,
    actor: 'human',
  });
  const promoteSeed = await requestJsonNoAuth(`${service.baseUrl}/api/code-trust/artifacts/transition`, 'POST', {
    sessionId: operationSessionId,
    path: promotedPath,
    transition: 'promote',
    decisionBy: 'reviewer',
    note: 'keep-this-promotion',
  });
  assert.equal(promoteSeed.artifact.promotionStatus, 'promoted');
  const priorPromotedRecord = JSON.parse(
    await fs.readFile(path.join(operationRoot, '.shader-forge', 'code-trust-artifacts.json'), 'utf8'),
  ).artifacts.find((artifact) => artifact.path === promotedPath);
  const promotedPreview = await requestOperation('/api/operations/file-write/preview', 'POST', {
    sessionId: operationSessionId,
    path: promotedPath,
    content: promotedUpdated,
    baseRevision: sha256Revision(promotedOriginal),
    actor: humanActor,
  });
  assert.equal(promotedPreview.status, 201, promotedPreview.payload.error || 'promoted preview should succeed');
  await requestOperation(
    `/api/operations/${encodeURIComponent(promotedPreview.payload.operation.id)}/approve`,
    'POST',
    { actor: humanActor },
  );
  const promotedApply = await requestOperation(
    `/api/operations/${encodeURIComponent(promotedPreview.payload.operation.id)}/apply`,
    'POST',
    { actor: humanActor },
  );
  assert.equal(promotedApply.status, 200, promotedApply.payload.error || 'promoted apply should succeed');
  const promotedUndo = await requestOperation(
    `/api/operations/${encodeURIComponent(promotedPreview.payload.operation.id)}/undo`,
    'POST',
    { actor: humanActor },
  );
  assert.equal(promotedUndo.status, 200, promotedUndo.payload.error || 'promoted undo should restore prior artifact');
  assert.equal(await fs.readFile(path.join(operationRoot, promotedPath), 'utf8'), promotedOriginal);
  const restoredPromotedRecord = JSON.parse(
    await fs.readFile(path.join(operationRoot, '.shader-forge', 'code-trust-artifacts.json'), 'utf8'),
  ).artifacts.find((artifact) => artifact.path === promotedPath);
  assert.ok(restoredPromotedRecord);
  assert.equal(restoredPromotedRecord.promotionStatus, 'promoted');
  assert.equal(restoredPromotedRecord.contentHash, priorPromotedRecord.contentHash);
  assert.equal(restoredPromotedRecord.promotedBy, 'reviewer');
  assert.equal(restoredPromotedRecord.promotionNote, 'keep-this-promotion');
  assert.equal(restoredPromotedRecord.updatedAt, priorPromotedRecord.updatedAt);

  const laterPromotePath = 'notes/later-promote.txt';
  const laterOriginal = 'before-later-promote\n';
  const laterUpdated = 'after-later-promote\n';
  await fs.writeFile(path.join(operationRoot, laterPromotePath), laterOriginal, 'utf8');
  const laterPreview = await requestOperation('/api/operations/file-write/preview', 'POST', {
    sessionId: operationSessionId,
    path: laterPromotePath,
    content: laterUpdated,
    baseRevision: sha256Revision(laterOriginal),
    actor: humanActor,
  });
  await requestOperation(
    `/api/operations/${encodeURIComponent(laterPreview.payload.operation.id)}/approve`,
    'POST',
    { actor: humanActor },
  );
  const laterApply = await requestOperation(
    `/api/operations/${encodeURIComponent(laterPreview.payload.operation.id)}/apply`,
    'POST',
    { actor: humanActor },
  );
  assert.equal(laterApply.status, 200, laterApply.payload.error || 'later-promote apply should succeed');
  const laterPromote = await requestJsonNoAuth(`${service.baseUrl}/api/code-trust/artifacts/transition`, 'POST', {
    sessionId: operationSessionId,
    path: laterPromotePath,
    transition: 'promote',
    decisionBy: 'human',
    note: 'do-not-clobber',
  });
  assert.equal(laterPromote.artifact.promotionStatus, 'promoted');
  const laterUndo = await requestOperation(
    `/api/operations/${encodeURIComponent(laterPreview.payload.operation.id)}/undo`,
    'POST',
    { actor: humanActor },
  );
  assert.equal(laterUndo.status, 409);
  assert.equal(laterUndo.payload.conflict.code, 'code_trust_artifact_conflict');
  assert.equal(laterUndo.payload.operation.state, 'conflicted');
  assert.equal(await fs.readFile(path.join(operationRoot, laterPromotePath), 'utf8'), laterUpdated);
  const laterStillPromoted = JSON.parse(
    await fs.readFile(path.join(operationRoot, '.shader-forge', 'code-trust-artifacts.json'), 'utf8'),
  ).artifacts.find((artifact) => artifact.path === laterPromotePath);
  assert.equal(laterStillPromoted.promotionStatus, 'promoted');
  assert.equal(laterStillPromoted.promotionNote, 'do-not-clobber');

  const rejectedPreview = await requestOperation('/api/operations/file-write/preview', 'POST', {
    sessionId: operationSessionId,
    path: existingFilePath,
    content: 'rejected\n',
    baseRevision: existingRevision,
    actor: humanActor,
  });
  const rejected = await requestOperation(
    `/api/operations/${encodeURIComponent(rejectedPreview.payload.operation.id)}/reject`,
    'POST',
    { actor: humanActor },
  );
  assert.equal(rejected.status, 200);
  assert.equal(rejected.payload.operation.state, 'rejected');
  const approveRejected = await requestOperation(
    `/api/operations/${encodeURIComponent(rejectedPreview.payload.operation.id)}/approve`,
    'POST',
    { actor: humanActor },
  );
  assert.equal(approveRejected.status, 409);
  const applyRejected = await requestOperation(
    `/api/operations/${encodeURIComponent(rejectedPreview.payload.operation.id)}/apply`,
    'POST',
    { actor: humanActor },
  );
  assert.equal(applyRejected.status, 409);

  const listed = await requestOperation(
    `/api/operations?sessionId=${encodeURIComponent(operationSessionId)}`,
  );
  assert.equal(listed.status, 200);
  assert.ok(listed.payload.operations.some((operation) => operation.id === applyOperationId));
  const fetched = await requestOperation(`/api/operations/${encodeURIComponent(applyOperationId)}`);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.payload.operation.state, 'undone');
  assert.equal(fetched.payload.operation.validation, null);
  assert.equal('beforeContent' in fetched.payload.operation, false);
  assert.equal('proposedContent' in fetched.payload.operation, false);
  const persistedOperations = JSON.parse(
    await fs.readFile(path.join(sessionStateDir, 'operations.json'), 'utf8'),
  );
  assert.equal(persistedOperations.version, 1);
  assert.ok(persistedOperations.operations.some((operation) => operation.id === applyOperationId));
  assert.equal(JSON.stringify(persistedOperations).includes('must-never-persist'), false);

  await operationEvents.close();
  await service.close();
  service = await startService();

  const restoredOperations = await requestOperation(
    `/api/operations?sessionId=${encodeURIComponent(operationSessionId)}`,
  );
  assert.equal(restoredOperations.status, 200);
  const restoredApplied = restoredOperations.payload.operations.find(
    (operation) => operation.id === applyOperationId,
  );
  assert.equal(restoredApplied.state, 'undone');
  assert.equal(restoredApplied.path, existingFilePath);
  assert.equal(restoredApplied.actor.kind, 'shell');
  const restoredCreated = restoredOperations.payload.operations.find(
    (operation) => operation.id === createdPreview.payload.operation.id,
  );
  assert.equal(restoredCreated.state, 'undone');
  assert.equal(restoredCreated.baseRevision, 'missing');
  const restoredReadableDiff = await requestOperation(
    `/api/operations/${encodeURIComponent(applyOperationId)}/diff`,
  );
  assert.equal(restoredReadableDiff.status, 200);
  assert.equal(restoredReadableDiff.payload.diff.status, 'available');
  assert.equal(restoredReadableDiff.payload.diff.beforeRevision, existingRevision);
  assert.equal(restoredReadableDiff.payload.diff.afterRevision, proposedRevision);

  const blockedOrigin = await fetch(`${service.baseUrl}/health`, {
    headers: { Origin: 'https://example.com' },
  });
  assert.equal(blockedOrigin.status, 403);
  assert.match((await blockedOrigin.json()).error, /non-loopback origin is not allowed/i);
  assert.equal(blockedOrigin.headers.get('access-control-allow-origin'), null);

  const blockedPreflight = await fetch(`${service.baseUrl}/api/sessions/example`, {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' },
  });
  assert.equal(blockedPreflight.status, 403);

  const loopbackOrigin = await fetch(`${service.baseUrl}/health`, {
    headers: { Origin: 'http://127.0.0.1:5173' },
  });
  assert.equal(loopbackOrigin.status, 200);
  assert.equal(loopbackOrigin.headers.get('access-control-allow-origin'), 'http://127.0.0.1:5173');

  const localhostOrigin = await fetch(`${service.baseUrl}/health`, {
    headers: { Origin: 'http://localhost:4173' },
  });
  assert.equal(localhostOrigin.status, 200);
  assert.equal(localhostOrigin.headers.get('access-control-allow-origin'), 'http://localhost:4173');

  const ipv6LoopbackOrigin = await fetch(`${service.baseUrl}/health`, {
    headers: { Origin: 'http://[::1]:5173' },
  });
  assert.equal(ipv6LoopbackOrigin.status, 200);

  const nativeNoOrigin = await fetch(`${service.baseUrl}/health`);
  assert.equal(nativeNoOrigin.status, 200);

  await assert.rejects(
    startEngineSessiond({ host: '0.0.0.0', port: 0 }),
    /refuses to bind non-loopback host '0\.0\.0\.0'/i,
  );
  await assert.rejects(
    startEngineSessiond({ host: '::', port: 0 }),
    /refuses to bind non-loopback host '::'/i,
  );
  await assert.rejects(
    startEngineSessiond({ host: '192.168.1.10', port: 0 }),
    /authenticated remote mode is not implemented/i,
  );

  let ipv6Service = null;
  try {
    ipv6Service = await startEngineSessiond({
      host: '::1',
      port: 0,
      sessionStore: new SessionStore({
        storageFilePath: path.join(sessionStateDir, 'ipv6-sessions.json'),
      }),
      runtimeLaunchFactory,
      buildLaunchFactory,
    });
  } catch (error) {
    const code = error && typeof error === 'object' ? error.code : '';
    const message = error instanceof Error ? error.message : String(error);
    if (!['EADDRNOTAVAIL', 'EAFNOSUPPORT', 'EINVAL', 'EPERM'].includes(code)
      && !/eaddrnotavail|eafnosupport|ipv6|listen/i.test(message)) {
      throw error;
    }
  }
  if (ipv6Service) {
    try {
      assert.match(ipv6Service.baseUrl, /^http:\/\/\[::1\]:\d+$/);
      const ipv6Health = await fetch(`${ipv6Service.baseUrl}/health`);
      assert.equal(ipv6Health.status, 200);
      const ipv6Payload = await ipv6Health.json();
      assert.equal(ipv6Payload.ok, true);
      assert.equal(ipv6Payload.service, 'engine_sessiond');
    } finally {
      await ipv6Service.close();
    }
  }

  const missingPreviewActor = await requestOperation('/api/operations/file-write/preview', 'POST', {
    sessionId: operationSessionId,
    path: existingFilePath,
    content: proposedContent,
    baseRevision: existingRevision,
  });
  assert.equal(missingPreviewActor.status, 400);
  assert.match(missingPreviewActor.payload.error, /actor is required/i);

  const actorRequiredPreview = await requestOperation('/api/operations/file-write/preview', 'POST', {
    sessionId: operationSessionId,
    path: existingFilePath,
    content: 'actor-required\n',
    baseRevision: existingRevision,
    actor: humanActor,
  });
  assert.equal(actorRequiredPreview.status, 201);
  const missingApproveActor = await requestOperation(
    `/api/operations/${encodeURIComponent(actorRequiredPreview.payload.operation.id)}/approve`,
    'POST',
    {},
  );
  assert.equal(missingApproveActor.status, 400);
  assert.match(missingApproveActor.payload.error, /actor is required/i);
  const nullApproveActor = await requestOperation(
    `/api/operations/${encodeURIComponent(actorRequiredPreview.payload.operation.id)}/approve`,
    'POST',
    { actor: null },
  );
  assert.equal(nullApproveActor.status, 400);
  await requestOperation(
    `/api/operations/${encodeURIComponent(actorRequiredPreview.payload.operation.id)}/approve`,
    'POST',
    { actor: humanActor },
  );
  const missingApplyActor = await requestOperation(
    `/api/operations/${encodeURIComponent(actorRequiredPreview.payload.operation.id)}/apply`,
    'POST',
    {},
  );
  assert.equal(missingApplyActor.status, 400);
  assert.match(missingApplyActor.payload.error, /actor is required/i);
  await requestOperation(
    `/api/operations/${encodeURIComponent(actorRequiredPreview.payload.operation.id)}/reject`,
    'POST',
    { actor: humanActor },
  );

  const mcpPreview = await requestOperation('/api/operations/file-write/preview', 'POST', {
    sessionId: operationSessionId,
    path: existingFilePath,
    content: 'mcp-should-not-apply\n',
    baseRevision: existingRevision,
    actor: { kind: 'mcp', id: 'agent-1', name: 'MCP Agent' },
  });
  assert.equal(mcpPreview.status, 201);
  await requestOperation(
    `/api/operations/${encodeURIComponent(mcpPreview.payload.operation.id)}/approve`,
    'POST',
    { actor: humanActor },
  );
  const mcpApply = await requestOperation(
    `/api/operations/${encodeURIComponent(mcpPreview.payload.operation.id)}/apply`,
    'POST',
    { actor: { kind: 'mcp', id: 'agent-1', name: 'MCP Agent' } },
  );
  assert.equal(mcpApply.status, 409);
  assert.equal(mcpApply.payload.codeTrust?.decision, 'review_required');
  assert.equal(mcpApply.payload.approval?.operationType, 'operation_apply');
  assert.equal(await fs.readFile(path.join(operationRoot, existingFilePath), 'utf8'), existingContent);
  await requestOperation(
    `/api/operations/${encodeURIComponent(mcpPreview.payload.operation.id)}/reject`,
    'POST',
    { actor: humanActor },
  );

  const invalidUtf8Path = 'notes/invalid-utf8.txt';
  await fs.writeFile(path.join(operationRoot, invalidUtf8Path), Buffer.from([0xff, 0xfe, 0x00, 0x80]));
  const invalidUtf8Read = await requestJsonNoAuth(
    `${service.baseUrl}/api/files/read?sessionId=${encodeURIComponent(operationSessionId)}&path=${encodeURIComponent(invalidUtf8Path)}`,
  );
  assert.match(invalidUtf8Read.error, /not valid UTF-8/i);
  const invalidUtf8Preview = await requestOperation('/api/operations/file-write/preview', 'POST', {
    sessionId: operationSessionId,
    path: invalidUtf8Path,
    content: 'replacement-should-not-decode\n',
    baseRevision: existingRevision,
    actor: humanActor,
  });
  assert.match(invalidUtf8Preview.payload.error, /not valid UTF-8/i);

  const scriptRelPath = 'tools/run.sh';
  const scriptAbsPath = path.join(operationRoot, scriptRelPath);
  await fs.mkdir(path.dirname(scriptAbsPath), { recursive: true });
  await fs.writeFile(scriptAbsPath, '#!/bin/sh\necho old\n', { mode: 0o755 });
  await fs.chmod(scriptAbsPath, 0o755);
  const scriptModeBefore = (await fs.stat(scriptAbsPath)).mode;
  if ((scriptModeBefore & 0o111) !== 0) {
    const scriptRevision = sha256Revision('#!/bin/sh\necho old\n');
    const scriptPreview = await requestOperation('/api/operations/file-write/preview', 'POST', {
      sessionId: operationSessionId,
      path: scriptRelPath,
      content: '#!/bin/sh\necho new\n',
      baseRevision: scriptRevision,
      actor: humanActor,
    });
    assert.equal(scriptPreview.status, 201);
    await requestOperation(
      `/api/operations/${encodeURIComponent(scriptPreview.payload.operation.id)}/approve`,
      'POST',
      { actor: humanActor },
    );
    const scriptApply = await requestOperation(
      `/api/operations/${encodeURIComponent(scriptPreview.payload.operation.id)}/apply`,
      'POST',
      { actor: humanActor },
    );
    assert.equal(scriptApply.status, 200, scriptApply.payload.error || 'executable apply should succeed');
    const scriptModeAfter = (await fs.stat(scriptAbsPath)).mode;
    assert.equal(scriptModeAfter & 0o111, scriptModeBefore & 0o111);
    assert.equal(await fs.readFile(scriptAbsPath, 'utf8'), '#!/bin/sh\necho new\n');
  }

  const mismatchPreview = await requestOperation('/api/operations/file-write/preview', 'POST', {
    sessionId: operationSessionId,
    path: existingFilePath,
    content: 'identity-mismatch\n',
    baseRevision: existingRevision,
    actor: humanActor,
  });
  assert.equal(mismatchPreview.status, 201);
  await requestOperation(
    `/api/operations/${encodeURIComponent(mismatchPreview.payload.operation.id)}/approve`,
    'POST',
    { actor: humanActor },
  );
  const operationsPath = path.join(sessionStateDir, 'operations.json');
  const persistedForIdentity = JSON.parse(await fs.readFile(operationsPath, 'utf8'));
  const mismatchRecord = persistedForIdentity.operations.find(
    (operation) => operation.id === mismatchPreview.payload.operation.id,
  );
  assert.ok(mismatchRecord);
  mismatchRecord.workspaceRoot = path.join(operationRoot, 'not-the-session-root');
  await fs.writeFile(operationsPath, `${JSON.stringify(persistedForIdentity, null, 2)}\n`, 'utf8');
  await service.close();
  service = await startService();
  const mismatchedApply = await requestOperation(
    `/api/operations/${encodeURIComponent(mismatchPreview.payload.operation.id)}/apply`,
    'POST',
    { actor: humanActor },
  );
  assert.equal(mismatchedApply.status, 409);
  assert.match(mismatchedApply.payload.error, /workspace identity does not match the session root/i);
  assert.equal(await fs.readFile(path.join(operationRoot, existingFilePath), 'utf8'), existingContent);

  const persistedForValidation = JSON.parse(await fs.readFile(operationsPath, 'utf8'));
  const validTemplate = persistedForValidation.operations.find((operation) => operation.id === applyOperationId);
  assert.ok(validTemplate);
  persistedForValidation.operations.push(
    {
      ...validTemplate,
      id: 'op_bad_state',
      state: 'nope',
    },
    {
      ...validTemplate,
      id: 'op_hash_mismatch',
      proposedContent: 'tampered-without-hash-update\n',
    },
    {
      ...validTemplate,
      id: 'op_bad_actor',
      actor: { kind: 'wizard', id: 'x', name: 'nope' },
    },
    {
      ...validTemplate,
      id: 'op_bad_timestamp',
      createdAt: 'yesterday',
      updatedAt: 'tomorrow',
    },
    {
      ...validTemplate,
      id: 'op_bad_event',
      events: [{ type: 'exploded', at: validTemplate.createdAt, state: 'previewed', actor: validTemplate.actor }],
    },
    {
      ...validTemplate,
      id: 'op_bad_preview',
      preview: { addedLines: 1 },
    },
    {
      ...validTemplate,
      id: 'op_fabricated_preview',
      preview: {
        ...validTemplate.preview,
        addedLines: validTemplate.preview.addedLines + 1,
      },
    },
    {
      ...validTemplate,
      id: 'op_impossible_effect',
      codeTrustEffect: {
        ...validTemplate.codeTrustEffect,
        status: 'pending',
        phase: 'apply',
      },
    },
    {
      ...validTemplate,
      id: 'op_missing_effect_timestamp',
      codeTrustEffect: {
        ...validTemplate.codeTrustEffect,
        updatedAt: null,
      },
    },
    {
      ...validTemplate,
      id: 'op_future_effect_timestamp',
      codeTrustEffect: {
        ...validTemplate.codeTrustEffect,
        updatedAt: '2999-01-01T00:00:00.000Z',
      },
    },
    {
      ...validTemplate,
      id: 'op_fabricated_recorded',
      state: 'applying',
      appliedRevision: null,
      resultingRevision: null,
      codeTrustEffect: {
        status: 'recorded',
        phase: 'apply',
        actor: 'human',
        origin: 'project_authored',
        evaluation: null,
        artifact: null,
        error: null,
        updatedAt: validTemplate.updatedAt,
      },
      events: [
        { type: 'previewed', at: validTemplate.createdAt, state: 'previewed', actor: validTemplate.actor },
        { type: 'approved', at: validTemplate.createdAt, state: 'approved', actor: validTemplate.actor },
        { type: 'applying', at: validTemplate.updatedAt, state: 'applying', actor: validTemplate.actor },
      ],
    },
    {
      ...validTemplate,
      id: 'op_malformed_effect_artifact',
      state: 'applying',
      appliedRevision: null,
      resultingRevision: null,
      codeTrustEffect: {
        status: 'recorded',
        phase: 'apply',
        actor: 'human',
        origin: 'project_authored',
        evaluation: { path: validTemplate.path, action: 'apply', allowed: true },
        artifact: {},
        priorArtifact: null,
        error: null,
        updatedAt: validTemplate.updatedAt,
      },
      events: [
        { type: 'previewed', at: validTemplate.createdAt, state: 'previewed', actor: validTemplate.actor },
        { type: 'approved', at: validTemplate.createdAt, state: 'approved', actor: validTemplate.actor },
        { type: 'applying', at: validTemplate.updatedAt, state: 'applying', actor: validTemplate.actor },
      ],
    },
    {
      ...validTemplate,
      id: 'op_wrong_operation_artifact',
      state: 'applying',
      appliedRevision: null,
      resultingRevision: null,
      codeTrustEffect: {
        status: 'recorded',
        phase: 'apply',
        actor: 'human',
        origin: 'project_authored',
        evaluation: {
          path: 'other.txt',
          action: 'apply',
          targetTier: 'project_authored',
          targetKind: 'code',
          effectiveOrigin: 'project_authored',
        },
        artifact: {
          path: 'other.txt',
          origin: 'project_authored',
          targetTier: 'project_authored',
          targetKind: 'code',
          lastAction: 'apply',
          updatedAt: validTemplate.updatedAt,
          hashAlgorithm: 'sha256',
          contentHash: '0'.repeat(64),
          promotionStatus: 'tracked',
        },
        priorArtifact: null,
        error: null,
        updatedAt: validTemplate.updatedAt,
      },
      events: [
        { type: 'previewed', at: validTemplate.createdAt, state: 'previewed', actor: validTemplate.actor },
        { type: 'approved', at: validTemplate.createdAt, state: 'approved', actor: validTemplate.actor },
        { type: 'applying', at: validTemplate.updatedAt, state: 'applying', actor: validTemplate.actor },
      ],
    },
    {
      ...validTemplate,
      id: 'op_mismatched_artifact_provenance',
      state: 'applying',
      appliedRevision: null,
      resultingRevision: null,
      codeTrustEffect: {
        status: 'recorded',
        phase: 'apply',
        actor: 'assistant',
        origin: 'assistant_generated',
        evaluation: {
          path: validTemplate.path,
          action: 'apply',
          targetTier: 'engine_trusted',
          targetKind: 'code',
          effectiveOrigin: 'assistant_generated',
        },
        artifact: {
          path: validTemplate.path,
          origin: 'engine_trusted',
          targetTier: 'engine_trusted',
          targetKind: 'code',
          lastAction: 'apply',
          updatedAt: validTemplate.updatedAt,
          hashAlgorithm: 'sha256',
          contentHash: validTemplate.proposedRevision.slice('sha256:'.length),
          promotionStatus: 'tracked',
        },
        priorArtifact: null,
        error: null,
        updatedAt: validTemplate.updatedAt,
      },
      events: [
        { type: 'previewed', at: validTemplate.createdAt, state: 'previewed', actor: validTemplate.actor },
        { type: 'approved', at: validTemplate.createdAt, state: 'approved', actor: validTemplate.actor },
        { type: 'applying', at: validTemplate.updatedAt, state: 'applying', actor: validTemplate.actor },
      ],
    },
    {
      ...validTemplate,
      id: 'op_bad_sequence',
      events: [
        { type: 'previewed', at: validTemplate.createdAt, state: 'previewed', actor: validTemplate.actor },
        { type: 'applied', at: validTemplate.updatedAt, state: 'applied', actor: validTemplate.actor },
      ],
    },
    {
      ...validTemplate,
      id: 'op_state_event_mismatch',
      state: 'approved',
    },
    {
      ...validTemplate,
      id: 'op_missing_workspace_root',
      workspaceRoot: '',
    },
    {
      ...validTemplate,
      id: 'op_legacy_missing_validation',
      validation: undefined,
    },
    {
      ...validTemplate,
      id: 'op_malformed_validation',
      validation: {
        schemaVersion: 1,
        status: 'completed',
        proposedRevision: validTemplate.proposedRevision,
        sampleCount: 0,
        findings: {
          jointLimitViolationCount: 0,
          overlapCount: 0,
          toleranceFailureCount: 0,
        },
        samples: [],
        diagnostic: 'raw-evaluator-output',
      },
    },
  );
  await fs.writeFile(operationsPath, `${JSON.stringify(persistedForValidation, null, 2)}\n`, 'utf8');
  await service.close();
  service = await startService();
  const afterMalformed = await requestOperation(
    `/api/operations?sessionId=${encodeURIComponent(operationSessionId)}`,
  );
  const loadedIds = new Set(afterMalformed.payload.operations.map((operation) => operation.id));
  assert.equal(loadedIds.has('op_bad_state'), false);
  assert.equal(loadedIds.has('op_hash_mismatch'), false);
  assert.equal(loadedIds.has('op_bad_actor'), false);
  assert.equal(loadedIds.has('op_bad_timestamp'), false);
  assert.equal(loadedIds.has('op_bad_event'), false);
  assert.equal(loadedIds.has('op_bad_preview'), false);
  assert.equal(loadedIds.has('op_fabricated_preview'), false);
  assert.equal(loadedIds.has('op_impossible_effect'), false);
  assert.equal(loadedIds.has('op_missing_effect_timestamp'), false);
  assert.equal(loadedIds.has('op_future_effect_timestamp'), false);
  assert.equal(loadedIds.has('op_fabricated_recorded'), false);
  assert.equal(loadedIds.has('op_malformed_effect_artifact'), false);
  assert.equal(loadedIds.has('op_wrong_operation_artifact'), false);
  assert.equal(loadedIds.has('op_mismatched_artifact_provenance'), false);
  assert.equal(loadedIds.has('op_bad_sequence'), false);
  assert.equal(loadedIds.has('op_state_event_mismatch'), false);
  assert.equal(loadedIds.has('op_missing_workspace_root'), false);
  assert.equal(loadedIds.has('op_malformed_validation'), false);
  assert.equal(loadedIds.has(applyOperationId), true);
  const legacyMissingValidation = afterMalformed.payload.operations.find(
    (operation) => operation.id === 'op_legacy_missing_validation',
  );
  assert.ok(legacyMissingValidation);
  assert.equal(legacyMissingValidation.validation, null);

  const journalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-op-journal-'));
  const journalWorkspace = path.join(journalDir, 'workspace');
  await fs.mkdir(journalWorkspace);
  const journalFile = path.join(journalWorkspace, 'note.txt');
  await fs.writeFile(journalFile, 'before\n', 'utf8');
  const journalSessions = new SessionStore({ storageFilePath: path.join(journalDir, 'sessions.json') });
  await journalSessions.loadSessions();
  const journalSession = await journalSessions.createSession({
    name: 'journal',
    rootPath: journalWorkspace,
  });
  let failTerminalPersist = false;
  const journalOperationsPath = path.join(journalDir, 'operations.json');
  const journalBeforePersist = async (payload) => {
    if (
      failTerminalPersist
      && payload.operations.some((operation) => operation.state === 'applied' || operation.state === 'undone')
    ) {
      throw new Error('simulated persistence failure');
    }
  };
  const journalOps = new OperationStore({
    sessionStore: journalSessions,
    storageFilePath: journalOperationsPath,
    beforePersist: journalBeforePersist,
  });
  await journalOps.loadOperations();
  const applyActor = { kind: 'cli', id: 'recover-cli', name: 'Recover CLI' };
  const undoActor = { kind: 'shell', id: 'recover-shell', name: 'Recover Shell' };
  const journalPreview = await journalOps.previewFileWrite({
    sessionId: journalSession.id,
    path: 'note.txt',
    content: 'after\n',
    baseRevision: sha256Revision('before\n'),
    actor: humanActor,
  });
  await journalOps.approve(journalPreview.id, { actor: humanActor });
  failTerminalPersist = true;
  await assert.rejects(
    journalOps.apply(journalPreview.id, { actor: applyActor }),
    /simulated persistence failure/,
  );
  assert.equal(await fs.readFile(journalFile, 'utf8'), 'after\n');
  const applyingDisk = JSON.parse(await fs.readFile(journalOperationsPath, 'utf8'));
  assert.equal(applyingDisk.operations[0].state, 'applying');
  assert.ok(applyingDisk.operations[0].events.some((event) => event.type === 'applying'));
  failTerminalPersist = false;
  const journalOpsReloaded = new OperationStore({
    sessionStore: journalSessions,
    storageFilePath: journalOperationsPath,
    beforePersist: journalBeforePersist,
  });
  await journalOpsReloaded.loadOperations();
  const recoveredApplied = journalOpsReloaded.getOperation(journalPreview.id);
  assert.equal(recoveredApplied.state, 'applied');
  const recoveredAppliedEvent = [...recoveredApplied.events].reverse().find((event) => event.type === 'applied');
  assert.equal(recoveredAppliedEvent.actor.kind, 'cli');
  assert.equal(recoveredAppliedEvent.actor.id, 'recover-cli');
  assert.equal(recoveredApplied.actor.kind, 'human');
  failTerminalPersist = true;
  await assert.rejects(
    journalOpsReloaded.undo(journalPreview.id, { actor: undoActor }),
    /simulated persistence failure/,
  );
  assert.equal(await fs.readFile(journalFile, 'utf8'), 'before\n');
  const undoingDisk = JSON.parse(await fs.readFile(journalOperationsPath, 'utf8'));
  assert.equal(undoingDisk.operations[0].state, 'undoing');
  assert.ok(undoingDisk.operations[0].events.some((event) => event.type === 'undoing'));
  failTerminalPersist = false;
  const journalOpsUndoReloaded = new OperationStore({
    sessionStore: journalSessions,
    storageFilePath: journalOperationsPath,
  });
  await journalOpsUndoReloaded.loadOperations();
  const recoveredUndone = journalOpsUndoReloaded.getOperation(journalPreview.id);
  assert.equal(recoveredUndone.state, 'undone');
  const recoveredUndoneEvent = [...recoveredUndone.events].reverse().find((event) => event.type === 'undone');
  assert.equal(recoveredUndoneEvent.actor.kind, 'shell');
  assert.equal(recoveredUndoneEvent.actor.id, 'recover-shell');
  await fs.rm(journalDir, { recursive: true, force: true });

  const replaceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-op-replace-'));
  const replaceWorkspace = path.join(replaceDir, 'workspace');
  await fs.mkdir(replaceWorkspace);
  const replaceFile = path.join(replaceWorkspace, 'keep.txt');
  await fs.writeFile(replaceFile, 'original\n', 'utf8');
  const replaceSessions = new SessionStore({
    storageFilePath: path.join(replaceDir, 'sessions.json'),
    beforeAtomicRename: async () => {
      throw Object.assign(new Error('simulated replace failure'), { code: 'EPERM' });
    },
  });
  await replaceSessions.loadSessions();
  const replaceSession = await replaceSessions.createSession({
    name: 'replace',
    rootPath: replaceWorkspace,
  });
  await assert.rejects(
    replaceSessions.writeTextFileAtomic(replaceSession.id, 'keep.txt', 'replacement\n'),
    /simulated replace failure/,
  );
  assert.equal(await fs.readFile(replaceFile, 'utf8'), 'original\n');
  const leftoverTemps = (await fs.readdir(replaceWorkspace))
    .filter((name) => name.endsWith('.tmp'));
  assert.equal(leftoverTemps.length, 0);
  const replaceOps = new OperationStore({
    sessionStore: replaceSessions,
    storageFilePath: path.join(replaceDir, 'operations.json'),
  });
  await replaceOps.loadOperations();
  const replacePreview = await replaceOps.previewFileWrite({
    sessionId: replaceSession.id,
    path: 'keep.txt',
    content: 'replacement\n',
    baseRevision: sha256Revision('original\n'),
    actor: humanActor,
  });
  await replaceOps.approve(replacePreview.id, { actor: humanActor });
  await assert.rejects(
    replaceOps.apply(replacePreview.id, { actor: humanActor }),
    /simulated replace failure/,
  );
  assert.equal(await fs.readFile(replaceFile, 'utf8'), 'original\n');
  const replaceOperation = replaceOps.getOperation(replacePreview.id);
  assert.equal(replaceOperation.state, 'approved');
  assert.ok(replaceOperation.events.some((event) => event.type === 'applying'));
  assert.equal(replaceOperation.events.at(-1).type, 'apply_failed');
  assert.equal(replaceOperation.events.at(-1).state, 'approved');
  await fs.rm(replaceDir, { recursive: true, force: true });

  const recoveredRollbackDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-op-recovered-'));
  const recoveredWorkspace = path.join(recoveredRollbackDir, 'workspace');
  await fs.mkdir(recoveredWorkspace);
  await fs.writeFile(path.join(recoveredWorkspace, 'note.txt'), 'stable\n', 'utf8');
  const recoveredSessions = new SessionStore({
    storageFilePath: path.join(recoveredRollbackDir, 'sessions.json'),
  });
  await recoveredSessions.loadSessions();
  const recoveredSession = await recoveredSessions.createSession({
    name: 'recovered',
    rootPath: recoveredWorkspace,
  });
  const recoveredOpsPath = path.join(recoveredRollbackDir, 'operations.json');
  const recoveredOps = new OperationStore({
    sessionStore: recoveredSessions,
    storageFilePath: recoveredOpsPath,
  });
  await recoveredOps.loadOperations();
  const recoveredPreview = await recoveredOps.previewFileWrite({
    sessionId: recoveredSession.id,
    path: 'note.txt',
    content: 'changed\n',
    baseRevision: sha256Revision('stable\n'),
    actor: humanActor,
  });
  await recoveredOps.approve(recoveredPreview.id, { actor: humanActor });
  const recoveredPayload = JSON.parse(await fs.readFile(recoveredOpsPath, 'utf8'));
  recoveredPayload.operations[0].state = 'applying';
  const recoveredCrashTimestamp = new Date(
    Date.parse(recoveredPayload.operations[0].updatedAt) + 1,
  ).toISOString();
  recoveredPayload.operations[0].updatedAt = recoveredCrashTimestamp;
  recoveredPayload.operations[0].codeTrustEffect = {
    status: 'skipped',
    phase: 'apply',
    actor: '',
    origin: '',
    evaluation: null,
    artifact: null,
    error: null,
    updatedAt: recoveredCrashTimestamp,
  };
  recoveredPayload.operations[0].events.push({
    type: 'applying',
    at: recoveredCrashTimestamp,
    state: 'applying',
    actor: { kind: 'cli', id: 'crash-apply', name: 'Crash Apply' },
  });
  await fs.writeFile(recoveredOpsPath, `${JSON.stringify(recoveredPayload, null, 2)}\n`, 'utf8');
  const recoveredReloaded = new OperationStore({
    sessionStore: recoveredSessions,
    storageFilePath: recoveredOpsPath,
  });
  await recoveredReloaded.loadOperations();
  const recoveredRecord = recoveredReloaded.getOperation(recoveredPreview.id);
  assert.equal(recoveredRecord.state, 'approved');
  assert.equal(await fs.readFile(path.join(recoveredWorkspace, 'note.txt'), 'utf8'), 'stable\n');
  assert.ok(recoveredRecord.events.some((event) => event.type === 'applying'));
  assert.equal(recoveredRecord.events.at(-1).type, 'recovered');
  assert.equal(recoveredRecord.events.at(-1).actor.id, 'crash-apply');
  assert.equal(recoveredRecord.actor.kind, 'human');
  await fs.rm(recoveredRollbackDir, { recursive: true, force: true });

  const replacedRootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-op-root-replaced-'));
  const replacedWorkspace = path.join(replacedRootDir, 'workspace');
  const originalWorkspace = path.join(replacedRootDir, 'workspace-original');
  await fs.mkdir(replacedWorkspace);
  await fs.writeFile(path.join(replacedWorkspace, 'x.txt'), 'same-base\n', 'utf8');
  const replacedSessions = new SessionStore({
    storageFilePath: path.join(replacedRootDir, 'sessions.json'),
  });
  await replacedSessions.loadSessions();
  const replacedSession = await replacedSessions.createSession({
    name: 'root-replacement',
    rootPath: replacedWorkspace,
  });
  const replacedOps = new OperationStore({
    sessionStore: replacedSessions,
    storageFilePath: path.join(replacedRootDir, 'operations.json'),
  });
  await replacedOps.loadOperations();
  const replacedPreview = await replacedOps.previewFileWrite({
    sessionId: replacedSession.id,
    path: 'x.txt',
    content: 'must-not-land\n',
    baseRevision: sha256Revision('same-base\n'),
    actor: humanActor,
  });
  await replacedOps.approve(replacedPreview.id, { actor: humanActor });
  await fs.rename(replacedWorkspace, originalWorkspace);
  await fs.mkdir(replacedWorkspace);
  await fs.writeFile(path.join(replacedWorkspace, 'x.txt'), 'same-base\n', 'utf8');
  await assert.rejects(
    replacedOps.apply(replacedPreview.id, { actor: humanActor }),
    /workspace identity does not match the session root/i,
  );
  assert.equal(replacedOps.getOperation(replacedPreview.id).state, 'approved');
  assert.equal(await fs.readFile(path.join(originalWorkspace, 'x.txt'), 'utf8'), 'same-base\n');
  assert.equal(await fs.readFile(path.join(replacedWorkspace, 'x.txt'), 'utf8'), 'same-base\n');
  await fs.rm(replacedRootDir, { recursive: true, force: true });

  const legacyIdentityDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-op-legacy-identity-'));
  const legacyWorkspace = path.join(legacyIdentityDir, 'workspace');
  await fs.mkdir(legacyWorkspace);
  await fs.writeFile(path.join(legacyWorkspace, 'x.txt'), 'legacy-base\n', 'utf8');
  const legacySessionsPath = path.join(legacyIdentityDir, 'sessions.json');
  const legacyTimestamp = '2026-08-30T12:00:00.000Z';
  await fs.writeFile(
    legacySessionsPath,
    `${JSON.stringify({
      version: 1,
      sessions: [
        {
          id: 'session_legacy_identity',
          name: 'legacy-identity',
          rootPath: legacyWorkspace,
          createdAt: legacyTimestamp,
          updatedAt: legacyTimestamp,
        },
      ],
    }, null, 2)}\n`,
    'utf8',
  );
  const legacySessions = new SessionStore({ storageFilePath: legacySessionsPath });
  await legacySessions.loadSessions();
  const migratedSession = legacySessions.getSession('session_legacy_identity');
  assert.ok(migratedSession.rootIdentity);
  assert.equal(typeof migratedSession.rootIdentity.dev, 'string');
  assert.equal(typeof migratedSession.rootIdentity.ino, 'string');
  assert.ok(migratedSession.rootIdentity.dev);
  assert.ok(migratedSession.rootIdentity.ino);
  const migratedDisk = JSON.parse(await fs.readFile(legacySessionsPath, 'utf8'));
  assert.equal(migratedDisk.sessions[0].id, 'session_legacy_identity');
  assert.equal(migratedDisk.sessions[0].rootIdentity.dev, migratedSession.rootIdentity.dev);
  assert.equal(migratedDisk.sessions[0].rootIdentity.ino, migratedSession.rootIdentity.ino);
  const legacyReloaded = new SessionStore({ storageFilePath: legacySessionsPath });
  await legacyReloaded.loadSessions();
  const reloadedLegacy = legacyReloaded.getSession('session_legacy_identity');
  assert.equal(reloadedLegacy.rootIdentity.dev, migratedSession.rootIdentity.dev);
  assert.equal(reloadedLegacy.rootIdentity.ino, migratedSession.rootIdentity.ino);
  const legacyOriginal = path.join(legacyIdentityDir, 'workspace-original');
  await fs.rename(legacyWorkspace, legacyOriginal);
  await fs.mkdir(legacyWorkspace);
  await fs.writeFile(path.join(legacyWorkspace, 'x.txt'), 'legacy-base\n', 'utf8');
  await assert.rejects(
    legacyReloaded.writeTextFileAtomic('session_legacy_identity', 'x.txt', 'must-not-land\n'),
    /workspace identity does not match the session root/i,
  );
  assert.equal(await fs.readFile(path.join(legacyOriginal, 'x.txt'), 'utf8'), 'legacy-base\n');
  assert.equal(await fs.readFile(path.join(legacyWorkspace, 'x.txt'), 'utf8'), 'legacy-base\n');
  await fs.rm(legacyIdentityDir, { recursive: true, force: true });

  const effectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-op-effect-'));
  const effectWorkspace = path.join(effectDir, 'workspace');
  await fs.mkdir(effectWorkspace);
  await fs.writeFile(path.join(effectWorkspace, 'note.txt'), 'before-effect\n', 'utf8');
  const effectSessions = new SessionStore({
    storageFilePath: path.join(effectDir, 'sessions.json'),
  });
  await effectSessions.loadSessions();
  const effectSession = await effectSessions.createSession({
    name: 'effect',
    rootPath: effectWorkspace,
  });
  let failEffect = true;
  let effectCalls = 0;
  const effectArtifact = (record, phase) => ({
    path: record.path,
    origin: 'project_authored',
    targetTier: 'project_authored',
    targetKind: 'code',
    lastAction: 'apply',
    updatedAt: new Date().toISOString(),
    hashAlgorithm: 'sha256',
    contentHash: sha256Revision(phase === 'undo' ? 'before-effect\n' : 'after-effect\n').slice('sha256:'.length),
    promotionStatus: 'tracked',
    promotedAt: null,
    promotedBy: null,
    promotionNote: '',
    quarantinedAt: null,
    quarantinedBy: null,
    quarantineNote: '',
  });
  const effectOps = new OperationStore({
    sessionStore: effectSessions,
    storageFilePath: path.join(effectDir, 'operations.json'),
    finalizeEffect: async (record, { phase }) => {
      effectCalls += 1;
      if (failEffect) {
        throw new Error('simulated code-trust effect failure');
      }
      return {
        status: phase === 'undo' ? 'reverted' : 'recorded',
        artifact: effectArtifact(record, phase),
      };
    },
  });
  await effectOps.loadOperations();
  const effectPreview = await effectOps.previewFileWrite({
    sessionId: effectSession.id,
    path: 'note.txt',
    content: 'after-effect\n',
    baseRevision: sha256Revision('before-effect\n'),
    actor: humanActor,
  });
  await effectOps.approve(effectPreview.id, { actor: humanActor });
  await assert.rejects(
    effectOps.apply(effectPreview.id, {
      actor: humanActor,
      codeTrust: {
        actor: 'human',
        origin: 'project_authored',
        evaluation: {
          path: 'note.txt',
          action: 'apply',
          allowed: true,
          targetTier: 'project_authored',
          targetKind: 'code',
          effectiveOrigin: 'project_authored',
        },
      },
    }),
    /simulated code-trust effect failure/,
  );
  assert.equal(await fs.readFile(path.join(effectWorkspace, 'note.txt'), 'utf8'), 'after-effect\n');
  assert.equal(effectOps.getOperation(effectPreview.id).state, 'applying');
  assert.equal(effectOps.getOperation(effectPreview.id).codeTrustEffect.status, 'failed');
  failEffect = false;
  const effectReloaded = new OperationStore({
    sessionStore: effectSessions,
    storageFilePath: path.join(effectDir, 'operations.json'),
    finalizeEffect: async (record, { phase }) => {
      effectCalls += 1;
      return {
        status: phase === 'undo' ? 'reverted' : 'recorded',
        artifact: effectArtifact(record, phase),
      };
    },
  });
  await effectReloaded.loadOperations();
  const finalized = effectReloaded.getOperation(effectPreview.id);
  assert.equal(finalized.state, 'applied');
  assert.equal(finalized.codeTrustEffect.status, 'recorded');
  assert.ok(effectCalls >= 2);
  await fs.rm(effectDir, { recursive: true, force: true });

  const recordedCrashDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-op-recorded-crash-'));
  const recordedWorkspace = path.join(recordedCrashDir, 'workspace');
  await fs.mkdir(recordedWorkspace);
  await fs.writeFile(path.join(recordedWorkspace, 'note.txt'), 'before-recorded\n', 'utf8');
  const recordedSessions = new SessionStore({
    storageFilePath: path.join(recordedCrashDir, 'sessions.json'),
  });
  await recordedSessions.loadSessions();
  const recordedSession = await recordedSessions.createSession({
    name: 'recorded-crash',
    rootPath: recordedWorkspace,
  });
  const recordedOpsPath = path.join(recordedCrashDir, 'operations.json');
  let recordedEffectCalls = 0;
  let failRecordedTerminal = false;
  const recordedEvaluation = {
    path: 'note.txt',
    action: 'apply',
    allowed: true,
    targetKind: 'code',
    targetTier: 'project_authored',
    effectiveOrigin: 'project_authored',
  };
  const recordedFinalize = async (record, { phase }) => {
    recordedEffectCalls += 1;
    if (phase === 'undo') {
      return {
        status: 'reverted',
        artifact: Object.prototype.hasOwnProperty.call(record.codeTrustEffect, 'priorArtifact')
          ? record.codeTrustEffect.priorArtifact
          : null,
      };
    }
    return {
      status: 'recorded',
      artifact: {
        path: record.path,
        origin: 'project_authored',
        targetTier: 'project_authored',
        targetKind: 'code',
        lastAction: 'apply',
        updatedAt: new Date().toISOString(),
        hashAlgorithm: 'sha256',
        contentHash: sha256Revision('after-recorded\n').slice('sha256:'.length),
        promotionStatus: 'tracked',
      },
    };
  };
  const recordedOps = new OperationStore({
    sessionStore: recordedSessions,
    storageFilePath: recordedOpsPath,
    beforePersist: async (payload) => {
      if (
        failRecordedTerminal
        && payload.operations.some((operation) => operation.state === 'applied' || operation.state === 'undone')
      ) {
        throw new Error('simulated persistence failure');
      }
    },
    finalizeEffect: recordedFinalize,
  });
  await recordedOps.loadOperations();
  const recordedPreview = await recordedOps.previewFileWrite({
    sessionId: recordedSession.id,
    path: 'note.txt',
    content: 'after-recorded\n',
    baseRevision: sha256Revision('before-recorded\n'),
    actor: humanActor,
  });
  await recordedOps.approve(recordedPreview.id, { actor: humanActor });
  failRecordedTerminal = true;
  await assert.rejects(
    recordedOps.apply(recordedPreview.id, {
      actor: humanActor,
      codeTrust: {
        actor: 'human',
        origin: 'project_authored',
        evaluation: recordedEvaluation,
      },
    }),
    /simulated persistence failure/,
  );
  assert.equal(await fs.readFile(path.join(recordedWorkspace, 'note.txt'), 'utf8'), 'after-recorded\n');
  const recordedDisk = JSON.parse(await fs.readFile(recordedOpsPath, 'utf8'));
  assert.equal(recordedDisk.operations[0].state, 'applying');
  assert.equal(recordedDisk.operations[0].codeTrustEffect.status, 'recorded');
  assert.ok(recordedDisk.operations[0].codeTrustEffect.evaluation);
  assert.ok(recordedDisk.operations[0].codeTrustEffect.artifact);
  assert.equal(recordedEffectCalls, 1);
  failRecordedTerminal = false;
  const recordedReloaded = new OperationStore({
    sessionStore: recordedSessions,
    storageFilePath: recordedOpsPath,
    beforePersist: async (payload) => {
      if (
        failRecordedTerminal
        && payload.operations.some((operation) => operation.state === 'applied' || operation.state === 'undone')
      ) {
        throw new Error('simulated persistence failure');
      }
    },
    finalizeEffect: recordedFinalize,
  });
  await recordedReloaded.loadOperations();
  const recoveredRecorded = recordedReloaded.getOperation(recordedPreview.id);
  assert.equal(recoveredRecorded.state, 'applied');
  assert.equal(recoveredRecorded.codeTrustEffect.status, 'recorded');
  assert.equal(recordedEffectCalls, 1);
  failRecordedTerminal = true;
  await assert.rejects(
    recordedReloaded.undo(recordedPreview.id, { actor: humanActor }),
    /simulated persistence failure/,
  );
  assert.equal(await fs.readFile(path.join(recordedWorkspace, 'note.txt'), 'utf8'), 'before-recorded\n');
  const revertedDisk = JSON.parse(await fs.readFile(recordedOpsPath, 'utf8'));
  assert.equal(revertedDisk.operations[0].state, 'undoing');
  assert.equal(revertedDisk.operations[0].codeTrustEffect.status, 'reverted');
  assert.equal(recordedEffectCalls, 2);
  failRecordedTerminal = false;
  const revertedReloaded = new OperationStore({
    sessionStore: recordedSessions,
    storageFilePath: recordedOpsPath,
    finalizeEffect: recordedFinalize,
  });
  await revertedReloaded.loadOperations();
  const recoveredReverted = revertedReloaded.getOperation(recordedPreview.id);
  assert.equal(recoveredReverted.state, 'undone');
  assert.equal(recoveredReverted.codeTrustEffect.status, 'reverted');
  assert.equal(recordedEffectCalls, 2);
  await fs.rm(recordedCrashDir, { recursive: true, force: true });

  const barrierDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-op-barrier-'));
  const barrierWorkspace = path.join(barrierDir, 'workspace');
  await fs.mkdir(barrierWorkspace);
  const barrierFile = path.join(barrierWorkspace, 'race.txt');
  await fs.writeFile(barrierFile, 'base\n', 'utf8');
  let releaseRename;
  const heldRename = new Promise((resolve) => {
    releaseRename = resolve;
  });
  let renameHoldStartedResolve;
  const renameHoldStarted = new Promise((resolve) => {
    renameHoldStartedResolve = resolve;
  });
  const barrierSessions = new SessionStore({
    storageFilePath: path.join(barrierDir, 'sessions.json'),
    beforeAtomicRename: async () => {
      renameHoldStartedResolve();
      await heldRename;
    },
  });
  await barrierSessions.loadSessions();
  const barrierSession = await barrierSessions.createSession({
    name: 'barrier',
    rootPath: barrierWorkspace,
  });
  const barrierOps = new OperationStore({
    sessionStore: barrierSessions,
    storageFilePath: path.join(barrierDir, 'operations.json'),
  });
  await barrierOps.loadOperations();
  const barrierPreview = await barrierOps.previewFileWrite({
    sessionId: barrierSession.id,
    path: 'race.txt',
    content: 'from-apply\n',
    baseRevision: sha256Revision('base\n'),
    actor: humanActor,
  });
  await barrierOps.approve(barrierPreview.id, { actor: humanActor });
  const applyPromise = barrierOps.apply(barrierPreview.id, { actor: humanActor });
  await renameHoldStarted;
  let directWriteSettled = false;
  const directWritePromise = barrierSessions.writeTextFileAtomic(
    barrierSession.id,
    'race.txt',
    'from-direct\n',
  ).then((result) => {
    directWriteSettled = true;
    return result;
  });
  const blockedState = await Promise.race([
    directWritePromise.then(() => 'completed'),
    Promise.resolve('blocked'),
  ]);
  assert.equal(blockedState, 'blocked');
  assert.equal(directWriteSettled, false);
  releaseRename();
  const [barrierApplied, barrierWritten] = await Promise.all([applyPromise, directWritePromise]);
  assert.equal(directWriteSettled, true);
  assert.equal(barrierApplied.state, 'applied');
  assert.equal(barrierApplied.appliedRevision, sha256Revision('from-apply\n'));
  assert.equal(barrierWritten.content, 'from-direct\n');
  assert.equal(await fs.readFile(barrierFile, 'utf8'), 'from-direct\n');
  await fs.rm(barrierDir, { recursive: true, force: true });

  const trustEvaluation = {
    path: 'race.txt',
    action: 'apply',
    allowed: true,
    targetKind: 'code',
    targetTier: 'project_authored',
    effectiveOrigin: 'project_authored',
  };
  async function operationTrustFinalize(record, { phase }) {
    if (phase === 'undo') {
      const restored = await restoreCodeTrustArtifact({
        rootPath: record.workspaceRoot,
        relativePath: record.path,
        priorRecord: Object.prototype.hasOwnProperty.call(record.codeTrustEffect, 'priorArtifact')
          ? record.codeTrustEffect.priorArtifact
          : null,
        expectedCurrent: record.codeTrustEffect.artifact || null,
      });
      return {
        status: 'reverted',
        artifact: restored.artifact,
      };
    }
    const artifact = await recordCodeTrustArtifact({
      rootPath: record.workspaceRoot,
      relativePath: record.path,
      actor: 'human',
      origin: 'project_authored',
      evaluation: record.codeTrustEffect.evaluation,
    });
    return {
      status: artifact ? 'recorded' : 'skipped',
      artifact,
    };
  }

  const snapshotDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-op-snapshot-'));
  const snapshotWorkspace = path.join(snapshotDir, 'workspace');
  await fs.mkdir(snapshotWorkspace);
  const snapshotFile = path.join(snapshotWorkspace, 'race.txt');
  await fs.writeFile(snapshotFile, 'snapshot-base\n', 'utf8');
  let releaseSnapshotRename;
  const heldSnapshotRename = new Promise((resolve) => {
    releaseSnapshotRename = resolve;
  });
  let snapshotHoldStartedResolve;
  const snapshotHoldStarted = new Promise((resolve) => {
    snapshotHoldStartedResolve = resolve;
  });
  const snapshotSessions = new SessionStore({
    storageFilePath: path.join(snapshotDir, 'sessions.json'),
    beforeAtomicRename: async () => {
      snapshotHoldStartedResolve();
      await heldSnapshotRename;
    },
  });
  await snapshotSessions.loadSessions();
  const snapshotSession = await snapshotSessions.createSession({
    name: 'snapshot',
    rootPath: snapshotWorkspace,
  });
  const snapshotOpsPath = path.join(snapshotDir, 'operations.json');
  const snapshotOps = new OperationStore({
    sessionStore: snapshotSessions,
    storageFilePath: snapshotOpsPath,
    finalizeEffect: operationTrustFinalize,
  });
  await snapshotOps.loadOperations();
  const snapshotPreview = await snapshotOps.previewFileWrite({
    sessionId: snapshotSession.id,
    path: 'race.txt',
    content: 'snapshot-after\n',
    baseRevision: sha256Revision('snapshot-base\n'),
    actor: humanActor,
  });
  await snapshotOps.approve(snapshotPreview.id, { actor: humanActor });
  const snapshotApplyPromise = snapshotOps.apply(snapshotPreview.id, {
    actor: humanActor,
    codeTrust: {
      actor: 'human',
      origin: 'project_authored',
      evaluation: { ...trustEvaluation, path: 'race.txt' },
    },
  });
  await snapshotHoldStarted;
  assert.equal(await fs.readFile(snapshotFile, 'utf8'), 'snapshot-base\n');
  const snapshotDisk = JSON.parse(await fs.readFile(snapshotOpsPath, 'utf8'));
  assert.equal(snapshotDisk.operations[0].state, 'applying');
  assert.equal(snapshotDisk.operations[0].codeTrustEffect.status, 'pending');
  assert.ok(Object.prototype.hasOwnProperty.call(snapshotDisk.operations[0].codeTrustEffect, 'priorArtifact'));
  releaseSnapshotRename();
  const snapshotApplied = await snapshotApplyPromise;
  assert.equal(snapshotApplied.state, 'applied');
  assert.equal(snapshotApplied.codeTrustEffect.status, 'recorded');
  assert.equal(await fs.readFile(snapshotFile, 'utf8'), 'snapshot-after\n');
  await fs.rm(snapshotDir, { recursive: true, force: true });

  const provenanceDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-op-provenance-'));
  const provenanceWorkspace = path.join(provenanceDir, 'workspace');
  await fs.mkdir(provenanceWorkspace);
  const provenanceFile = path.join(provenanceWorkspace, 'race.txt');
  await fs.writeFile(provenanceFile, 'base\n', 'utf8');
  let releaseProvenanceRename;
  const heldProvenanceRename = new Promise((resolve) => {
    releaseProvenanceRename = resolve;
  });
  let provenanceHoldStartedResolve;
  const provenanceHoldStarted = new Promise((resolve) => {
    provenanceHoldStartedResolve = resolve;
  });
  let holdProvenanceRename = false;
  const provenanceSessions = new SessionStore({
    storageFilePath: path.join(provenanceDir, 'sessions.json'),
    beforeAtomicRename: async () => {
      if (!holdProvenanceRename) {
        return;
      }
      provenanceHoldStartedResolve();
      await heldProvenanceRename;
    },
  });
  await provenanceSessions.loadSessions();
  const provenanceSession = await provenanceSessions.createSession({
    name: 'provenance',
    rootPath: provenanceWorkspace,
  });
  const provenanceOps = new OperationStore({
    sessionStore: provenanceSessions,
    storageFilePath: path.join(provenanceDir, 'operations.json'),
    finalizeEffect: operationTrustFinalize,
  });
  await provenanceOps.loadOperations();
  await recordCodeTrustArtifact({
    rootPath: provenanceWorkspace,
    relativePath: 'race.txt',
    actor: 'human',
    origin: 'project_authored',
    evaluation: trustEvaluation,
  });
  const provenancePreview = await provenanceOps.previewFileWrite({
    sessionId: provenanceSession.id,
    path: 'race.txt',
    content: 'from-apply\n',
    baseRevision: sha256Revision('base\n'),
    actor: humanActor,
  });
  await provenanceOps.approve(provenancePreview.id, { actor: humanActor });
  const provenanceApplied = await provenanceOps.apply(provenancePreview.id, {
    actor: humanActor,
    codeTrust: {
      actor: 'human',
      origin: 'project_authored',
      evaluation: trustEvaluation,
    },
  });
  assert.equal(provenanceApplied.state, 'applied');
  holdProvenanceRename = true;
  const undoPromise = provenanceOps.undo(provenancePreview.id, { actor: humanActor });
  await provenanceHoldStarted;
  let promoteSettled = false;
  const promotePromise = provenanceSessions.runSerializedFileMutation(async () => (
    transitionCodeTrustArtifact({
      rootPath: provenanceWorkspace,
      relativePath: 'race.txt',
      transition: 'promote',
      decidedBy: 'human',
      note: 'during-undo',
    })
  )).then((artifact) => {
    promoteSettled = true;
    return artifact;
  });
  const promoteBlockedState = await Promise.race([
    promotePromise.then(() => 'completed'),
    Promise.resolve('blocked'),
  ]);
  assert.equal(promoteBlockedState, 'blocked');
  assert.equal(promoteSettled, false);
  assert.equal(await fs.readFile(provenanceFile, 'utf8'), 'from-apply\n');
  releaseProvenanceRename();
  const [provenanceUndone, provenancePromoted] = await Promise.all([undoPromise, promotePromise]);
  assert.equal(promoteSettled, true);
  assert.notEqual(provenanceUndone.state, 'conflicted');
  assert.equal(provenanceUndone.state, 'undone');
  assert.equal(await fs.readFile(provenanceFile, 'utf8'), 'base\n');
  assert.equal(provenancePromoted.promotionStatus, 'promoted');
  assert.equal(provenancePromoted.promotionNote, 'during-undo');
  await fs.rm(provenanceDir, { recursive: true, force: true });

  const recoveryConflictDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-op-recovery-conflict-'));
  const recoveryWorkspace = path.join(recoveryConflictDir, 'workspace');
  await fs.mkdir(recoveryWorkspace);
  await fs.writeFile(path.join(recoveryWorkspace, 'race.txt'), 'base\n', 'utf8');
  const recoverySessions = new SessionStore({
    storageFilePath: path.join(recoveryConflictDir, 'sessions.json'),
  });
  await recoverySessions.loadSessions();
  const recoverySession = await recoverySessions.createSession({
    name: 'recovery-conflict',
    rootPath: recoveryWorkspace,
  });
  const recoveryOpsPath = path.join(recoveryConflictDir, 'operations.json');
  const recoveryOps = new OperationStore({
    sessionStore: recoverySessions,
    storageFilePath: recoveryOpsPath,
    finalizeEffect: operationTrustFinalize,
  });
  await recoveryOps.loadOperations();
  const recoveryPreview = await recoveryOps.previewFileWrite({
    sessionId: recoverySession.id,
    path: 'race.txt',
    content: 'from-apply\n',
    baseRevision: sha256Revision('base\n'),
    actor: humanActor,
  });
  await recoveryOps.approve(recoveryPreview.id, { actor: humanActor });
  const recoveryApplied = await recoveryOps.apply(recoveryPreview.id, {
    actor: humanActor,
    codeTrust: {
      actor: 'human',
      origin: 'project_authored',
      evaluation: trustEvaluation,
    },
  });
  assert.equal(recoveryApplied.state, 'applied');
  await fs.writeFile(path.join(recoveryWorkspace, 'race.txt'), 'base\n', 'utf8');
  await transitionCodeTrustArtifact({
    rootPath: recoveryWorkspace,
    relativePath: 'race.txt',
    transition: 'promote',
    decidedBy: 'human',
    note: 'startup-conflict',
  });
  const recoveryPayload = JSON.parse(await fs.readFile(recoveryOpsPath, 'utf8'));
  recoveryPayload.operations[0].state = 'undoing';
  const recoveryCrashTimestamp = new Date(
    Date.parse(recoveryPayload.operations[0].updatedAt) + 1,
  ).toISOString();
  recoveryPayload.operations[0].updatedAt = recoveryCrashTimestamp;
  recoveryPayload.operations[0].codeTrustEffect = {
    ...recoveryPayload.operations[0].codeTrustEffect,
    status: 'pending',
    phase: 'undo',
    error: null,
    updatedAt: recoveryCrashTimestamp,
  };
  recoveryPayload.operations[0].events.push({
    type: 'undoing',
    at: recoveryCrashTimestamp,
    state: 'undoing',
    actor: humanActor,
  });
  await fs.writeFile(recoveryOpsPath, `${JSON.stringify(recoveryPayload, null, 2)}\n`, 'utf8');
  const recoveryReloaded = new OperationStore({
    sessionStore: recoverySessions,
    storageFilePath: recoveryOpsPath,
    finalizeEffect: operationTrustFinalize,
  });
  await recoveryReloaded.loadOperations();
  const recoveryConflicted = recoveryReloaded.getOperation(recoveryPreview.id);
  assert.equal(recoveryConflicted.state, 'conflicted');
  assert.equal(recoveryConflicted.events.at(-1).type, 'conflicted');
  assert.equal(recoveryConflicted.events.at(-1).conflict.code, 'code_trust_artifact_conflict');
  assert.equal(await fs.readFile(path.join(recoveryWorkspace, 'race.txt'), 'utf8'), 'base\n');
  const recoveryStillPromoted = JSON.parse(
    await fs.readFile(path.join(recoveryWorkspace, '.shader-forge', 'code-trust-artifacts.json'), 'utf8'),
  ).artifacts.find((artifact) => artifact.path === 'race.txt');
  assert.equal(recoveryStillPromoted.promotionStatus, 'promoted');
  await fs.rm(recoveryConflictDir, { recursive: true, force: true });

  const validationDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-op-validation-'));
  const validationWorkspace = path.join(validationDir, 'workspace');
  await fs.mkdir(path.join(validationWorkspace, 'animation', 'attachments'), { recursive: true });
  const validationAttachmentPath = 'animation/attachments/rifle.attachment.toml';
  const validationBefore = 'id = "weapon.rifle"\n';
  const validationProposed = 'id = "weapon.rifle.tuned"\n';
  await fs.writeFile(path.join(validationWorkspace, validationAttachmentPath), validationBefore, 'utf8');
  const validationSessions = new SessionStore({
    storageFilePath: path.join(validationDir, 'sessions.json'),
  });
  await validationSessions.loadSessions();
  const validationSession = await validationSessions.createSession({
    name: 'validation-journal',
    rootPath: validationWorkspace,
  });
  const validationOpsPath = path.join(validationDir, 'operations.json');
  const validationEvents = [];
  const validationOps = new OperationStore({
    sessionStore: validationSessions,
    storageFilePath: validationOpsPath,
    emitEvent: (type, data) => {
      validationEvents.push({ type, data: structuredClone(data) });
    },
  });
  await validationOps.loadOperations();
  const spatialContext = {
    type: 'spatial_attachment',
    label: 'Rifle tune',
    subjectId: 'weapon.rifle',
    resourceKeys: [validationAttachmentPath],
    leaseId: 'lease_validation',
  };
  const spatialPreview = await validationOps.previewFileWrite({
    sessionId: validationSession.id,
    path: validationAttachmentPath,
    content: validationProposed,
    baseRevision: sha256Revision(validationBefore),
    actor: humanActor,
    context: spatialContext,
  });
  assert.equal(spatialPreview.state, 'previewed');
  assert.equal(spatialPreview.validation, null);
  assert.equal('proposedContent' in spatialPreview, false);
  const genericPreview = await validationOps.previewFileWrite({
    sessionId: validationSession.id,
    path: 'notes/generic.txt',
    content: 'generic\n',
    baseRevision: 'missing',
    actor: humanActor,
  });
  assert.equal(genericPreview.validation, null);

  const candidate = await validationOps.getSpatialValidationCandidate(spatialPreview.id);
  assert.deepEqual(Object.keys(candidate).sort(), [
    'baseRevision',
    'beforeContent',
    'context',
    'id',
    'path',
    'proposedContent',
    'proposedRevision',
    'sessionId',
    'state',
    'updatedAt',
    'validation',
  ]);
  assert.equal(candidate.id, spatialPreview.id);
  assert.equal(candidate.sessionId, validationSession.id);
  assert.equal(candidate.path, validationAttachmentPath);
  assert.equal(candidate.beforeContent, validationBefore);
  assert.equal(candidate.validation, null);
  assert.equal(candidate.state, 'previewed');
  assert.equal(candidate.baseRevision, spatialPreview.baseRevision);
  assert.equal(candidate.proposedRevision, spatialPreview.proposedRevision);
  assert.equal(candidate.proposedContent, validationProposed);
  assert.equal(candidate.updatedAt, spatialPreview.updatedAt);
  assert.equal(candidate.context.type, 'spatial_attachment');
  const publicSpatialView = validationOps.getOperation(spatialPreview.id);
  assert.equal(publicSpatialView.validation, null);
  assert.equal('proposedContent' in publicSpatialView, false);
  assert.equal(JSON.stringify(publicSpatialView).includes('proposedContent'), false);

  function completedValidationSummary(proposedRevision, samples) {
    return {
      schemaVersion: 1,
      status: 'completed',
      proposedRevision,
      sampleCount: samples.length,
      findings: {
        jointLimitViolationCount: 1,
        overlapCount: 2,
        toleranceFailureCount: 3,
      },
      samples,
    };
  }

  const completedSamples = [
    {
      phase: 'walk',
      normalizedTime: 0.25,
      jointLimitViolationCount: 1,
      overlapCount: 0,
      toleranceFailureCount: 1,
    },
    {
      phase: 'aim',
      normalizedTime: 1,
      jointLimitViolationCount: 0,
      overlapCount: 2,
      toleranceFailureCount: 2,
    },
  ];
  const completedSummary = completedValidationSummary(spatialPreview.proposedRevision, completedSamples);

  const originalValidationWorkspace = `${validationWorkspace}-original`;
  await fs.rename(validationWorkspace, originalValidationWorkspace);
  await fs.mkdir(path.join(validationWorkspace, 'animation', 'attachments'), { recursive: true });
  await fs.writeFile(path.join(validationWorkspace, validationAttachmentPath), validationBefore, 'utf8');
  try {
    await assert.rejects(
      () => validationOps.getSpatialValidationCandidate(spatialPreview.id),
      (error) => error.statusCode === 409 && error.code === 'workspace_identity_mismatch',
    );
    await assert.rejects(
      () => validationOps.recordSpatialValidation(spatialPreview.id, {
        actor: humanActor,
        expectedProposedRevision: spatialPreview.proposedRevision,
        expectedUpdatedAt: spatialPreview.updatedAt,
        validation: completedSummary,
      }),
      (error) => error.statusCode === 409 && error.code === 'workspace_identity_mismatch',
    );
  } finally {
    await fs.rm(validationWorkspace, { recursive: true, force: true });
    await fs.rename(originalValidationWorkspace, validationWorkspace);
  }

  const concurrentPreview = await validationOps.previewFileWrite({
    sessionId: validationSession.id,
    path: validationAttachmentPath,
    content: 'id = "weapon.rifle.concurrent"\n',
    baseRevision: sha256Revision(validationBefore),
    actor: humanActor,
    context: { ...spatialContext, subjectId: 'weapon.rifle.concurrent' },
  });
  const concurrentSummary = completedValidationSummary(
    concurrentPreview.proposedRevision,
    completedSamples,
  );
  const realDateNow = Date.now;
  Date.now = () => Date.parse(concurrentPreview.updatedAt);
  let concurrentResults;
  try {
    concurrentResults = await Promise.allSettled([
      validationOps.recordSpatialValidation(concurrentPreview.id, {
        actor: humanActor,
        expectedProposedRevision: concurrentPreview.proposedRevision,
        expectedUpdatedAt: concurrentPreview.updatedAt,
        validation: concurrentSummary,
      }),
      validationOps.recordSpatialValidation(concurrentPreview.id, {
        actor: humanActor,
        expectedProposedRevision: concurrentPreview.proposedRevision,
        expectedUpdatedAt: concurrentPreview.updatedAt,
        validation: concurrentSummary,
      }),
    ]);
    const fulfilled = concurrentResults.find((result) => result.status === 'fulfilled');
    const approvedAfterValidation = await validationOps.approve(concurrentPreview.id, {
      actor: humanActor,
    });
    assert.ok(fulfilled);
    assert.ok(approvedAfterValidation.updatedAt > fulfilled.value.updatedAt);
    await assert.rejects(
      () => validationOps.recordSpatialValidation(concurrentPreview.id, {
        actor: humanActor,
        expectedProposedRevision: concurrentPreview.proposedRevision,
        expectedUpdatedAt: concurrentPreview.updatedAt,
        validation: concurrentSummary,
      }),
      (error) => error.statusCode === 409 && error.code === 'operation_validation_stale',
    );
  } finally {
    Date.now = realDateNow;
  }
  assert.equal(concurrentResults.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(concurrentResults.filter(
    (result) => result.status === 'rejected'
      && result.reason?.code === 'operation_validation_stale',
  ).length, 1);

  const firstValidated = await validationOps.recordSpatialValidation(spatialPreview.id, {
    actor: humanActor,
    expectedProposedRevision: spatialPreview.proposedRevision,
    expectedUpdatedAt: spatialPreview.updatedAt,
    validation: completedSummary,
  });
  assert.equal(firstValidated.state, 'previewed');
  assert.notEqual(firstValidated.updatedAt, spatialPreview.updatedAt);
  assert.deepEqual(firstValidated.validation, completedSummary);
  assert.equal('error' in firstValidated.validation, false);
  assert.equal('proposedContent' in firstValidated, false);
  assert.equal(firstValidated.events.filter((event) => event.type === 'validated').length, 1);
  assert.equal(firstValidated.events.at(-1).type, 'validated');
  assert.equal(firstValidated.events.at(-1).state, 'previewed');
  assert.equal('validation' in firstValidated.events.at(-1), false);
  const emittedValidated = validationEvents.filter(
    (event) => event.type === 'operation.validated' && event.data.id === spatialPreview.id,
  );
  assert.equal(emittedValidated.length, 1);
  assert.equal(emittedValidated[0].data.id, spatialPreview.id);
  assert.deepEqual(emittedValidated[0].data.validation, completedSummary);
  assert.equal(emittedValidated[0].data.state, 'previewed');
  assert.equal('proposedContent' in emittedValidated[0].data, false);

  const persistedCompleted = JSON.parse(await fs.readFile(validationOpsPath, 'utf8'));
  const persistedCompletedRecord = persistedCompleted.operations.find(
    (operation) => operation.id === spatialPreview.id,
  );
  assert.deepEqual(persistedCompletedRecord.validation, completedSummary);
  assert.equal(persistedCompletedRecord.events.some((event) => 'validation' in event), false);
  const validationOpsReloaded = new OperationStore({
    sessionStore: validationSessions,
    storageFilePath: validationOpsPath,
  });
  await validationOpsReloaded.loadOperations();
  const reloadedCompleted = validationOpsReloaded.getOperation(spatialPreview.id);
  assert.deepEqual(reloadedCompleted.validation, completedSummary);
  assert.equal(reloadedCompleted.state, 'previewed');
  assert.equal('proposedContent' in reloadedCompleted, false);

  const failedSummary = {
    schemaVersion: 1,
    status: 'failed',
    proposedRevision: spatialPreview.proposedRevision,
    sampleCount: 1,
    findings: {
      jointLimitViolationCount: 0,
      overlapCount: 0,
      toleranceFailureCount: 0,
    },
    samples: [
      {
        phase: 'idle',
        normalizedTime: 0,
        jointLimitViolationCount: 0,
        overlapCount: 0,
        toleranceFailureCount: 0,
      },
    ],
    error: {
      code: 'evaluator_failed',
      message: 'Native evaluator failed.',
    },
  };
  const secondValidated = await validationOps.recordSpatialValidation(spatialPreview.id, {
    actor: humanActor,
    expectedProposedRevision: firstValidated.proposedRevision,
    expectedUpdatedAt: firstValidated.updatedAt,
    validation: failedSummary,
  });
  assert.equal(secondValidated.state, 'previewed');
  assert.notEqual(secondValidated.updatedAt, firstValidated.updatedAt);
  assert.deepEqual(secondValidated.validation, failedSummary);
  assert.equal(secondValidated.events.filter((event) => event.type === 'validated').length, 2);
  assert.equal(secondValidated.events.at(-1).type, 'validated');
  assert.equal(secondValidated.events.at(-1).state, 'previewed');
  assert.equal(emittedValidated.length + 1, validationEvents.filter(
    (event) => event.type === 'operation.validated' && event.data.id === spatialPreview.id,
  ).length);

  const failedReloadStore = new OperationStore({
    sessionStore: validationSessions,
    storageFilePath: validationOpsPath,
  });
  await failedReloadStore.loadOperations();
  const reloadedFailed = failedReloadStore.getOperation(spatialPreview.id);
  assert.deepEqual(reloadedFailed.validation, failedSummary);
  assert.equal(reloadedFailed.state, 'previewed');
  assert.equal(reloadedFailed.events.filter((event) => event.type === 'validated').length, 2);

  const approvedSpatial = await validationOps.approve(spatialPreview.id, { actor: humanActor });
  assert.equal(approvedSpatial.state, 'approved');
  assert.deepEqual(approvedSpatial.validation, failedSummary);
  const approvedValidated = await validationOps.recordSpatialValidation(spatialPreview.id, {
    actor: humanActor,
    expectedProposedRevision: approvedSpatial.proposedRevision,
    expectedUpdatedAt: approvedSpatial.updatedAt,
    validation: completedSummary,
  });
  assert.equal(approvedValidated.state, 'approved');
  assert.deepEqual(approvedValidated.validation, completedSummary);
  assert.equal(approvedValidated.events.filter((event) => event.type === 'validated').length, 3);
  assert.equal(approvedValidated.events.at(-1).type, 'validated');
  assert.equal(approvedValidated.events.at(-1).state, 'approved');

  async function assertJournalUnchanged(operationId, mutate) {
    const beforeDisk = await fs.readFile(validationOpsPath, 'utf8');
    const beforeView = validationOps.getOperation(operationId);
    await mutate();
    assert.equal(await fs.readFile(validationOpsPath, 'utf8'), beforeDisk);
    assert.deepEqual(validationOps.getOperation(operationId), beforeView);
  }

  await assertJournalUnchanged(spatialPreview.id, async () => {
    await assert.rejects(
      () => validationOps.recordSpatialValidation(spatialPreview.id, {
        actor: humanActor,
        expectedProposedRevision: approvedValidated.proposedRevision,
        expectedUpdatedAt: '2000-01-01T00:00:00.000Z',
        validation: completedSummary,
      }),
      (error) => error.statusCode === 409 && error.code === 'operation_validation_stale',
    );
  });
  await assertJournalUnchanged(spatialPreview.id, async () => {
    await assert.rejects(
      () => validationOps.recordSpatialValidation(spatialPreview.id, {
        actor: humanActor,
        expectedProposedRevision: sha256Revision('not-the-proposed-bytes\n'),
        expectedUpdatedAt: approvedValidated.updatedAt,
        validation: completedSummary,
      }),
      (error) => error.statusCode === 409 && error.code === 'operation_validation_stale',
    );
  });
  await assertJournalUnchanged(genericPreview.id, async () => {
    await assert.rejects(
      () => Promise.resolve().then(() => validationOps.getSpatialValidationCandidate(genericPreview.id)),
      (error) => error.statusCode === 409 && error.code === 'operation_validation_unavailable',
    );
  });
  await assertJournalUnchanged(genericPreview.id, async () => {
    await assert.rejects(
      () => validationOps.recordSpatialValidation(genericPreview.id, {
        actor: humanActor,
        expectedProposedRevision: genericPreview.proposedRevision,
        expectedUpdatedAt: genericPreview.updatedAt,
        validation: completedValidationSummary(genericPreview.proposedRevision, []),
      }),
      (error) => error.statusCode === 409 && error.code === 'operation_validation_unavailable',
    );
  });

  const rejectedSpatialPreview = await validationOps.previewFileWrite({
    sessionId: validationSession.id,
    path: validationAttachmentPath,
    content: 'id = "weapon.rifle.rejected"\n',
    baseRevision: sha256Revision(validationBefore),
    actor: humanActor,
    context: {
      ...spatialContext,
      subjectId: 'weapon.rifle.rejected',
      resourceKeys: [validationAttachmentPath],
    },
  });
  const rejectedSpatial = await validationOps.reject(rejectedSpatialPreview.id, { actor: humanActor });
  assert.equal(rejectedSpatial.state, 'rejected');
  await assertJournalUnchanged(rejectedSpatialPreview.id, async () => {
    await assert.rejects(
      () => Promise.resolve().then(() => validationOps.getSpatialValidationCandidate(rejectedSpatialPreview.id)),
      (error) => error.statusCode === 409 && error.code === 'operation_validation_unavailable',
    );
  });
  await assertJournalUnchanged(rejectedSpatialPreview.id, async () => {
    await assert.rejects(
      () => validationOps.recordSpatialValidation(rejectedSpatialPreview.id, {
        actor: humanActor,
        expectedProposedRevision: rejectedSpatial.proposedRevision,
        expectedUpdatedAt: rejectedSpatial.updatedAt,
        validation: completedValidationSummary(rejectedSpatial.proposedRevision, []),
      }),
      (error) => error.statusCode === 409 && error.code === 'operation_validation_unavailable',
    );
  });

  await assert.rejects(
    () => Promise.resolve().then(() => validationOps.getSpatialValidationCandidate('op_missing')),
    (error) => error.statusCode === 404,
  );

  const rawDiagnostic = {
    ...completedSummary,
    diagnostic: 'raw-evaluator-output',
    bones: [{ id: 'arm', violation: 12 }],
  };
  await assertJournalUnchanged(spatialPreview.id, async () => {
    await assert.rejects(
      () => validationOps.recordSpatialValidation(spatialPreview.id, {
        actor: humanActor,
        expectedProposedRevision: approvedValidated.proposedRevision,
        expectedUpdatedAt: approvedValidated.updatedAt,
        validation: rawDiagnostic,
      }),
      (error) => error.statusCode === 400,
    );
  });
  await assertJournalUnchanged(spatialPreview.id, async () => {
    await assert.rejects(
      () => validationOps.recordSpatialValidation(spatialPreview.id, {
        actor: humanActor,
        expectedProposedRevision: approvedValidated.proposedRevision,
        expectedUpdatedAt: approvedValidated.updatedAt,
        validation: {
          ...completedSummary,
          proposedRevision: sha256Revision('different-proposed-bytes\n'),
        },
      }),
      (error) => error.statusCode === 400,
    );
  });
  await assertJournalUnchanged(spatialPreview.id, async () => {
    await assert.rejects(
      () => validationOps.recordSpatialValidation(spatialPreview.id, {
        actor: humanActor,
        expectedProposedRevision: approvedValidated.proposedRevision,
        expectedUpdatedAt: approvedValidated.updatedAt,
        validation: {
          ...completedSummary,
          error: { code: 'unexpected', message: 'completed summaries cannot carry error' },
        },
      }),
      (error) => error.statusCode === 400,
    );
  });
  await assertJournalUnchanged(spatialPreview.id, async () => {
    await assert.rejects(
      () => validationOps.recordSpatialValidation(spatialPreview.id, {
        actor: humanActor,
        expectedProposedRevision: approvedValidated.proposedRevision,
        expectedUpdatedAt: approvedValidated.updatedAt,
        validation: {
          schemaVersion: 1,
          status: 'failed',
          proposedRevision: spatialPreview.proposedRevision,
          sampleCount: 0,
          findings: {
            jointLimitViolationCount: 0,
            overlapCount: 0,
            toleranceFailureCount: 0,
          },
          samples: [],
        },
      }),
      (error) => error.statusCode === 400,
    );
  });
  await assertJournalUnchanged(spatialPreview.id, async () => {
    await assert.rejects(
      () => validationOps.recordSpatialValidation(spatialPreview.id, {
        actor: humanActor,
        expectedProposedRevision: approvedValidated.proposedRevision,
        expectedUpdatedAt: approvedValidated.updatedAt,
        validation: {
          ...completedSummary,
          samples: [
            {
              ...completedSamples[0],
              normalizedTime: -0,
            },
          ],
          sampleCount: 1,
        },
      }),
      (error) => error.statusCode === 400,
    );
  });
  await assertJournalUnchanged(spatialPreview.id, async () => {
    await assert.rejects(
      () => validationOps.recordSpatialValidation(spatialPreview.id, {
        actor: humanActor,
        expectedProposedRevision: approvedValidated.proposedRevision,
        expectedUpdatedAt: approvedValidated.updatedAt,
        validation: {
          ...completedSummary,
          findings: { ...completedSummary.findings, overlapCount: 1 },
        },
      }),
      (error) => error.statusCode === 400,
    );
  });

  let latestValidated = approvedValidated;
  while (latestValidated.events.filter((event) => event.type === 'validated').length < 8) {
    latestValidated = await validationOps.recordSpatialValidation(spatialPreview.id, {
      actor: humanActor,
      expectedProposedRevision: latestValidated.proposedRevision,
      expectedUpdatedAt: latestValidated.updatedAt,
      validation: completedSummary,
    });
  }
  await assertJournalUnchanged(spatialPreview.id, async () => {
    await assert.rejects(
      () => validationOps.recordSpatialValidation(spatialPreview.id, {
        actor: humanActor,
        expectedProposedRevision: latestValidated.proposedRevision,
        expectedUpdatedAt: latestValidated.updatedAt,
        validation: completedSummary,
      }),
      (error) => error.statusCode === 409
        && error.code === 'operation_validation_limit_reached',
    );
  });

  const publicHttpService = await startEngineSessiond({
    host: '127.0.0.1',
    port: 0,
    sessionStore: validationSessions,
    operationStore: validationOps,
    runtimeLaunchFactory,
    buildLaunchFactory,
    now: () => coordinationClock.nowMs,
    heartbeatTimeoutMs: coordinationHeartbeatTimeoutMs,
  });
  try {
    const publicHttpView = await requestJsonNoAuth(
      `${publicHttpService.baseUrl}/api/operations/${encodeURIComponent(spatialPreview.id)}`,
    );
    assert.equal(publicHttpView.operation.id, spatialPreview.id);
    assert.deepEqual(publicHttpView.operation.validation, completedSummary);
    assert.equal('proposedContent' in publicHttpView.operation, false);
    assert.equal('beforeContent' in publicHttpView.operation, false);
    assert.equal(JSON.stringify(publicHttpView).includes('proposedContent'), false);
    const listedHttpView = await requestJsonNoAuth(
      `${publicHttpService.baseUrl}/api/operations?sessionId=${encodeURIComponent(validationSession.id)}`,
    );
    const listedSpatial = listedHttpView.operations.find((operation) => operation.id === spatialPreview.id);
    assert.ok(listedSpatial);
    assert.equal('proposedContent' in listedSpatial, false);
    assert.deepEqual(listedSpatial.validation, completedSummary);
  } finally {
    await publicHttpService.close();
  }

  const diskAfterHttp = JSON.parse(await fs.readFile(validationOpsPath, 'utf8'));
  const diskSpatial = diskAfterHttp.operations.find((operation) => operation.id === spatialPreview.id);
  const { validation: _ignoredValidation, ...legacyDiskRecord } = diskSpatial;
  diskAfterHttp.operations.push({
    ...legacyDiskRecord,
    id: 'op_validation_missing_summary',
  }, {
    ...diskSpatial,
    id: 'op_validation_missing_event',
    events: diskSpatial.events.filter((event) => event.type !== 'validated'),
  }, {
    ...diskSpatial,
    id: 'op_validation_wrong_revision',
    validation: {
      ...diskSpatial.validation,
      proposedRevision: sha256Revision('different-persisted-candidate\n'),
    },
  }, {
    ...diskSpatial,
    id: 'op_validation_backward_event',
    events: diskSpatial.events.map((event, index) => (
      index === diskSpatial.events.length - 1
        ? { ...event, at: '2000-01-01T00:00:00.000Z' }
        : event
    )),
  }, {
    ...diskSpatial,
    id: 'op_validation_generic_context',
    context: null,
  }, {
    ...diskSpatial,
    id: 'op_validation_actorless_event',
    events: diskSpatial.events.map((event, index) => (
      index === diskSpatial.events.length - 1
        ? { ...event, actor: null }
        : event
    )),
  }, {
    ...diskSpatial,
    id: 'op_validation_invalid_timestamp_envelope',
    createdAt: '2999-01-01T00:00:00.000Z',
  });
  await fs.writeFile(validationOpsPath, `${JSON.stringify(diskAfterHttp, null, 2)}\n`, 'utf8');
  const legacyReloadStore = new OperationStore({
    sessionStore: validationSessions,
    storageFilePath: validationOpsPath,
  });
  await legacyReloadStore.loadOperations();
  for (const id of [
    'op_validation_missing_summary',
    'op_validation_missing_event',
    'op_validation_wrong_revision',
    'op_validation_backward_event',
    'op_validation_generic_context',
    'op_validation_actorless_event',
    'op_validation_invalid_timestamp_envelope',
  ]) {
    assert.throws(
      () => legacyReloadStore.getOperation(id),
      (error) => error.statusCode === 404,
    );
  }
  await fs.rm(validationDir, { recursive: true, force: true });

  const cliSource = await fs.readFile(path.join(repoRoot, 'tools', 'engine-cli', 'shaderforge.mjs'), 'utf8');
  assert.match(cliSource, /\/api\/code-trust\/artifacts\/transition/);
  assert.equal(cliSource.includes('transitionCodeTrustArtifact('), false);

  const operationBoundaryContainer = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-op-boundary-'));
  const operationBoundaryWorkspace = path.join(operationBoundaryContainer, 'workspace');
  const operationBoundaryOutside = path.join(operationBoundaryContainer, 'outside');
  const operationBoundaryLink = path.join(operationBoundaryWorkspace, 'outside-link');
  await fs.mkdir(operationBoundaryWorkspace);
  await fs.mkdir(operationBoundaryOutside);
  await fs.writeFile(path.join(operationBoundaryOutside, 'secret.txt'), 'outside\n', 'utf8');
  const operationBoundaryLinkCreated = await tryCreateDirectoryLink(
    operationBoundaryOutside,
    operationBoundaryLink,
  );
  const operationBoundarySession = await requestJsonNoAuth(`${service.baseUrl}/api/sessions`, 'POST', {
    name: 'operation-boundary',
    rootPath: operationBoundaryWorkspace,
  });
  if (operationBoundaryLinkCreated) {
    const escapedPreview = await requestOperation('/api/operations/file-write/preview', 'POST', {
      sessionId: operationBoundarySession.session.id,
      path: 'outside-link/created.txt',
      content: 'must not escape\n',
      baseRevision: 'missing',
      actor: humanActor,
    });
    assert.match(escapedPreview.payload.error, /escapes physical session root/i);
    await assert.rejects(fs.stat(path.join(operationBoundaryOutside, 'created.txt')), { code: 'ENOENT' });

    const escapedExisting = await requestOperation('/api/operations/file-write/preview', 'POST', {
      sessionId: operationBoundarySession.session.id,
      path: 'outside-link/secret.txt',
      content: 'overwrite outside\n',
      baseRevision: sha256Revision('outside\n'),
      actor: humanActor,
    });
    assert.match(escapedExisting.payload.error, /escapes physical session root/i);
    assert.equal(
      await fs.readFile(path.join(operationBoundaryOutside, 'secret.txt'), 'utf8'),
      'outside\n',
    );
  }
  await requestJsonNoAuth(
    `${service.baseUrl}/api/sessions/${encodeURIComponent(operationBoundarySession.session.id)}`,
    'DELETE',
  );
  if (operationBoundaryLinkCreated) {
    await fs.unlink(operationBoundaryLink);
  }
  await fs.rm(operationBoundaryContainer, { recursive: true, force: true });
  await fs.rm(operationRoot, { recursive: true, force: true });

  console.log('Engine sessiond smoke passed.');
  console.log(`- Started engine_sessiond at ${service.baseUrl}`);
  console.log(`- Created session for ${path.basename(repoRoot)} and restored it after restarting engine_sessiond`);
  console.log('- Verified CORS preflight plus persistent session create/update/delete and safe file/host-fs listing APIs');
  console.log('- Verified git status and git-init APIs against real session roots');
  console.log('- Verified PTY terminal open/input/stream/close flow');
  console.log(`- Verified runtime start/status/log/${isWindows ? 'stop' : 'pause/resume/stop'} lifecycle`);
  console.log('- Verified runtime build start/log/completion lifecycle');
  console.log('- Verified in-process multi-agent coordination leases, queue promotion, expiry, and isolation');
  console.log('- Verified revision-safe file-write preview, approval, apply, undo, conflict, persistence, and path-boundary enforcement');
  console.log('- Verified bounded selected-operation exact diffs, line coordinates/endings, restart readability, degradation, truncation, and 404s');
  console.log('- Verified serialized writers, journal recovery, UTF-8/mode replacement, Origin/actor gates, code-trust apply, and invalid operation records');
  console.log('- Verified loopback-only bind, immutable session roots, journaled code-trust effects, append-only recovery provenance, and deterministic rename-barrier serialization');
  console.log('- Verified SessionStore beforeMutation snapshot/provenance, CLI/sessiond one mutation authority, applying/undoing effect-state validation, and persisted legacy rootIdentity migration');
  console.log('- Verified undo-vs-promote barrier never 409s after source restoration, and applying+recorded / undoing+reverted crash windows finalize without repeating the effect');
  console.log('- Verified durable operation-validation journal summaries, repeated validated events, stale snapshot rejection, and public-view exclusion of proposedContent');
} finally {
  await service.close();
  await fs.rm(sessionStateDir, { recursive: true, force: true });
}
