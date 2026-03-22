import assert from 'node:assert/strict';
import path from 'node:path';
import { repoRootFromScript, requestJsonNoAuth } from './lib/harness-utils.mjs';
import { startEngineSessiond } from '../tools/engine-sessiond/server.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const service = await startEngineSessiond({ host: '127.0.0.1', port: 0 });

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

  console.log('Engine sessiond smoke passed.');
  console.log(`- Started engine_sessiond at ${service.baseUrl}`);
  console.log(`- Created session for ${path.basename(repoRoot)}`);
  console.log('- Verified session list/get plus safe file list/read APIs');
} finally {
  await service.close();
}
