import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { repoRootFromScript, requestJsonNoAuth } from './lib/harness-utils.mjs';
import { startEngineSessiond } from '../tools/engine-sessiond/server.mjs';
import { SessionStore } from '../tools/engine-sessiond/lib/session-store.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const sessionStateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-ai-state-'));
const sessionStorePath = path.join(sessionStateDir, 'sessions.json');
const tempProjectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-ai-project-'));
const engineCliPath = path.join(repoRoot, 'tools', 'engine-cli', 'shaderforge.mjs');

await fs.mkdir(path.join(tempProjectRoot, 'ai'), { recursive: true });
await fs.writeFile(
  path.join(tempProjectRoot, 'ai', 'providers.toml'),
  [
    'default_provider = "local_fake"',
    '',
    '[provider.local_fake]',
    'type = "fake"',
    'label = "Deterministic Fake"',
    'enabled = true',
    'mode = "LocalOnly"',
    'model = "deterministic-fake"',
    '',
    '[provider.local_ollama]',
    'type = "ollama"',
    'label = "Local Ollama"',
    'enabled = false',
    'mode = "LocalOnly"',
    'base_url = "http://127.0.0.1:11434"',
    'model = ""',
    '',
  ].join('\n'),
  'utf8',
);

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
});

try {
  const health = await requestJsonNoAuth(`${service.baseUrl}/health`);
  assert.equal(health.ok, true);
  assert.ok(health.capabilities.includes('ai:providers'));
  assert.ok(health.capabilities.includes('ai:test'));

  const createSessionPayload = await requestJsonNoAuth(`${service.baseUrl}/api/sessions`, 'POST', {
    name: 'ai-project',
    rootPath: tempProjectRoot,
  });
  const sessionId = createSessionPayload.session.id;

  const providerSummary = await requestJsonNoAuth(
    `${service.baseUrl}/api/ai/providers?sessionId=${encodeURIComponent(sessionId)}`,
  );
  assert.equal(providerSummary.defaultProviderId, 'local_fake');
  assert.equal(providerSummary.providerCount, 2);
  assert.equal(providerSummary.readyProviderCount, 1);
  assert.equal(providerSummary.providers[0].id, 'local_fake');
  assert.equal(providerSummary.providers[0].status, 'ready');

  const aiSmoke = await requestJsonNoAuth(`${service.baseUrl}/api/ai/test`, 'POST', {
    sessionId,
  });
  assert.equal(aiSmoke.providerId, 'local_fake');
  assert.equal(aiSmoke.content, 'ready');

  const cliProviders = runCli(['ai', 'providers', '--root', tempProjectRoot]);
  assert.equal(cliProviders.defaultProviderId, 'local_fake');
  assert.equal(cliProviders.providerCount, 2);

  const cliSmoke = runCli([
    'ai',
    'test',
    '--root',
    tempProjectRoot,
    '--provider',
    'local_fake',
  ]);
  assert.equal(cliSmoke.content, 'ready');

  const cliRequest = runCli([
    'ai',
    'request',
    'Summarize the gameplay lane briefly.',
    '--root',
    tempProjectRoot,
    '--provider',
    'local_fake',
  ]);
  assert.match(cliRequest.content, /^fake:local_fake:/);

  console.log('Engine AI scaffold passed.');
  console.log('- Verified AI provider inspection through engine_sessiond and the engine CLI');
  console.log('- Verified the deterministic fake provider can satisfy smoke-test and freeform request paths');
  console.log('- Verified the first Phase 5.9 slice can load text-backed ai/providers.toml manifests from a workspace');
} finally {
  await service.close();
}
