import assert from 'node:assert/strict';
import path from 'node:path';
import { repoRootFromScript, requestJsonNoAuth } from './lib/harness-utils.mjs';
import { startEngineSessiond } from '../tools/engine-sessiond/server.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const service = await startEngineSessiond({ host: '127.0.0.1', port: 0 });

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

  const outputEventPromise = waitForSseEvent(
    `${service.baseUrl}/api/events`,
    (event) => event.type === 'terminal.output' && String(event.data?.data || '').includes('__SF_TERM_OK__'),
  );

  const terminalPayload = await requestJsonNoAuth(`${service.baseUrl}/api/terminals`, 'POST', {
    sessionId: createPayload.session.id,
    shell: 'bash',
    cols: 120,
    rows: 24,
  });

  assert.match(terminalPayload.terminalId, /^terminal_/);

  await requestJsonNoAuth(
    `${service.baseUrl}/api/terminals/${encodeURIComponent(terminalPayload.terminalId)}/input`,
    'POST',
    { input: 'printf "__SF_TERM_OK__\\n"\n' },
  );

  const outputEvent = await outputEventPromise;
  assert.equal(outputEvent.type, 'terminal.output');
  assert.equal(outputEvent.data.terminalId, terminalPayload.terminalId);
  assert.match(outputEvent.data.data, /__SF_TERM_OK__/);

  await requestJsonNoAuth(
    `${service.baseUrl}/api/terminals/${encodeURIComponent(terminalPayload.terminalId)}`,
    'DELETE',
  );

  console.log('Engine sessiond smoke passed.');
  console.log(`- Started engine_sessiond at ${service.baseUrl}`);
  console.log(`- Created session for ${path.basename(repoRoot)}`);
  console.log('- Verified session list/get plus safe file list/read APIs');
  console.log('- Verified PTY terminal open/input/stream/close flow');
} finally {
  await service.close();
}
