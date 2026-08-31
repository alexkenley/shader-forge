import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { repoRootFromScript, requestJsonNoAuth } from './lib/harness-utils.mjs';
import { startEngineSessiond } from '../tools/engine-sessiond/server.mjs';
import { SessionStore } from '../tools/engine-sessiond/lib/session-store.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const sessionStateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-ai-state-'));
const sessionStorePath = path.join(sessionStateDir, 'sessions.json');
const tempProjectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-ai-project-'));
const engineCliPath = path.join(repoRoot, 'tools', 'engine-cli', 'shaderforge.mjs');
const providerRequests = [];
const openRouterServer = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/api/tags') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ models: [{ name: 'test-local' }] }));
    return;
  }
  let rawBody = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => {
    rawBody += chunk;
  });
  request.on('end', () => {
    const body = rawBody ? JSON.parse(rawBody) : {};
    providerRequests.push({
      authorization: request.headers.authorization || '',
      body,
      path: request.url,
    });
    const content = body.messages?.at(-1)?.content === 'Return an oversized response.'
      ? 'x'.repeat(1024 * 1024 + 1)
      : 'ready';
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      id: 'openrouter-test-request',
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }],
      usage: request.url === '/v1/chat/completions'
        ? { prompt_tokens: 10, completion_tokens: 2 }
        : { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    }));
  });
});
await new Promise((resolve, reject) => {
  openRouterServer.once('error', reject);
  openRouterServer.listen(0, '127.0.0.1', resolve);
});
const openRouterAddress = openRouterServer.address();
assert.ok(openRouterAddress && typeof openRouterAddress === 'object');
const openRouterBaseUrl = `http://127.0.0.1:${openRouterAddress.port}/api/v1`;
const previousOpenRouterKey = process.env.OPENROUTER_API_KEY;
const previousOpenRouterTestOverride = process.env.SHADER_FORGE_AI_TEST_ALLOW_OPENROUTER_BASE_URL;
process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
process.env.SHADER_FORGE_AI_TEST_ALLOW_OPENROUTER_BASE_URL = '1';

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
    'enabled = true',
    'mode = "LocalOnly"',
    `base_url = "http://127.0.0.1:${openRouterAddress.port}"`,
    'model = "test-local"',
    '',
    '[provider.openrouter_kimi]',
    'type = "openrouter"',
    'label = "OpenRouter / Kimi K3"',
    'enabled = true',
    'mode = "BringYourOwnKey"',
    `base_url = "${openRouterBaseUrl}"`,
    'model = "moonshotai/kimi-k3"',
    'api_key_env = "OPENROUTER_API_KEY"',
    'max_output_tokens = 128',
    '',
    '[provider.openrouter_glm]',
    'type = "openrouter"',
    'label = "OpenRouter / GLM 5.2"',
    'enabled = true',
    'mode = "BringYourOwnKey"',
    `base_url = "${openRouterBaseUrl}"`,
    'model = "z-ai/glm-5.2"',
    'api_key_env = "OPENROUTER_API_KEY"',
    'max_output_tokens = 96',
    '',
    '[provider.openrouter_redirect]',
    'type = "openrouter"',
    'label = "Invalid OpenRouter Redirect"',
    'enabled = true',
    'mode = "BringYourOwnKey"',
    'base_url = "https://example.invalid/api/v1"',
    'model = "moonshotai/kimi-k3"',
    'api_key_env = "OPENROUTER_API_KEY"',
    '',
    '[provider.openrouter_bad_limit]',
    'type = "openrouter"',
    'label = "Invalid OpenRouter Output Limit"',
    'enabled = true',
    'mode = "BringYourOwnKey"',
    `base_url = "${openRouterBaseUrl}"`,
    'model = "moonshotai/kimi-k3"',
    'api_key_env = "OPENROUTER_API_KEY"',
    'max_output_tokens = 0',
    '',
    '[provider.provider_type_typo]',
    'type = "opnrouter"',
    'label = "Provider Type Typo"',
    'enabled = true',
    'mode = "BringYourOwnKey"',
    'model = "moonshotai/kimi-k3"',
    '',
  ].join('\n'),
  'utf8',
);

function runCli(args, cwd = repoRoot) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [engineCliPath, ...args], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (status) => {
      try {
        assert.equal(status, 0, stderr || stdout);
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(error);
      }
    });
  });
}

const service = await startEngineSessiond({
  host: '127.0.0.1',
  port: 0,
  sessionStore: new SessionStore({ storageFilePath: sessionStorePath }),
});

try {
  const bundledProviders = await runCli(['ai', 'providers', '--root', repoRoot]);
  const bundledGlmProvider = bundledProviders.providers.find((provider) => provider.id === 'openrouter_glm');
  assert.equal(bundledGlmProvider?.enabled, false);
  assert.equal(bundledGlmProvider?.selectedModel, 'z-ai/glm-5.2');

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
  assert.equal(providerSummary.providerCount, 7);
  assert.equal(providerSummary.readyProviderCount, 4);
  assert.equal(providerSummary.providers[0].id, 'local_fake');
  assert.equal(providerSummary.providers[0].status, 'ready');
  const openRouterProvider = providerSummary.providers.find((provider) => provider.id === 'openrouter_kimi');
  assert.equal(openRouterProvider?.supportedInSlice, true);
  assert.equal(openRouterProvider?.status, 'ready');
  assert.equal(openRouterProvider?.selectedModel, 'moonshotai/kimi-k3');
  assert.equal(openRouterProvider?.maxOutputTokens, 128);
  const openRouterGlmProvider = providerSummary.providers.find((provider) => provider.id === 'openrouter_glm');
  assert.equal(openRouterGlmProvider?.supportedInSlice, true);
  assert.equal(openRouterGlmProvider?.status, 'ready');
  assert.equal(openRouterGlmProvider?.selectedModel, 'z-ai/glm-5.2');
  assert.equal(openRouterGlmProvider?.maxOutputTokens, 96);
  assert.equal(providerSummary.providers.find((provider) => provider.id === 'openrouter_redirect')?.status, 'invalid');
  assert.equal(providerSummary.providers.find((provider) => provider.id === 'openrouter_bad_limit')?.status, 'invalid');
  assert.equal(providerSummary.providers.find((provider) => provider.id === 'provider_type_typo')?.status, 'invalid');
  assert.doesNotMatch(JSON.stringify(providerSummary), /test-openrouter-key/);

  const aiSmoke = await requestJsonNoAuth(`${service.baseUrl}/api/ai/test`, 'POST', {
    sessionId,
  });
  assert.equal(aiSmoke.providerId, 'local_fake');
  assert.equal(aiSmoke.content, 'ready');
  assert.equal(aiSmoke.usage, null);

  const ollamaSmoke = await requestJsonNoAuth(`${service.baseUrl}/api/ai/test`, 'POST', {
    sessionId,
    providerId: 'local_ollama',
  });
  assert.equal(ollamaSmoke.providerId, 'local_ollama');
  assert.equal(ollamaSmoke.model, 'test-local');
  assert.equal(ollamaSmoke.content, 'ready');
  assert.deepEqual(ollamaSmoke.usage, { promptTokens: 10, completionTokens: 2, totalTokens: 12 });
  const ollamaRequest = providerRequests.find((request) => request.path === '/v1/chat/completions');
  assert.equal(ollamaRequest?.authorization, '');
  assert.equal(ollamaRequest?.body?.max_tokens, 256);

  const openRouterSmoke = await requestJsonNoAuth(`${service.baseUrl}/api/ai/test`, 'POST', {
    sessionId,
    providerId: 'openrouter_kimi',
  });
  assert.equal(openRouterSmoke.providerId, 'openrouter_kimi');
  assert.equal(openRouterSmoke.providerType, 'openrouter');
  assert.equal(openRouterSmoke.model, 'moonshotai/kimi-k3');
  assert.equal(openRouterSmoke.content, 'ready');
  assert.deepEqual(openRouterSmoke.usage, { promptTokens: 10, completionTokens: 2, totalTokens: 12 });
  const openRouterRequest = providerRequests.find((request) => request.path === '/api/v1/chat/completions');
  assert.equal(openRouterRequest?.authorization, 'Bearer test-openrouter-key');
  assert.equal(openRouterRequest?.body?.model, 'moonshotai/kimi-k3');
  assert.equal(openRouterRequest?.body?.max_tokens, 128);
  assert.doesNotMatch(JSON.stringify(openRouterSmoke), /test-openrouter-key/);

  const openRouterGlmSmoke = await requestJsonNoAuth(`${service.baseUrl}/api/ai/test`, 'POST', {
    sessionId,
    providerId: 'openrouter_glm',
  });
  assert.equal(openRouterGlmSmoke.providerId, 'openrouter_glm');
  assert.equal(openRouterGlmSmoke.model, 'z-ai/glm-5.2');
  assert.equal(openRouterGlmSmoke.content, 'ready');
  const openRouterGlmRequest = providerRequests.find((request) => request.body?.model === 'z-ai/glm-5.2');
  assert.equal(openRouterGlmRequest?.authorization, 'Bearer test-openrouter-key');
  assert.equal(openRouterGlmRequest?.body?.max_tokens, 96);

  const oversizedResponse = await requestJsonNoAuth(`${service.baseUrl}/api/ai/test`, 'POST', {
    sessionId,
    providerId: 'openrouter_kimi',
    prompt: 'Return an oversized response.',
  });
  assert.match(oversizedResponse.error, /AI provider response exceeded 1048576 bytes/);

  const unknownProviderResponse = await requestJsonNoAuth(`${service.baseUrl}/api/ai/test`, 'POST', {
    sessionId,
    providerId: 'missing_provider',
  });
  assert.match(unknownProviderResponse.error, /AI provider missing_provider is not configured/);

  const cliProviders = await runCli(['ai', 'providers', '--root', tempProjectRoot]);
  assert.equal(cliProviders.defaultProviderId, 'local_fake');
  assert.equal(cliProviders.providerCount, 7);
  assert.equal(cliProviders.readyProviderCount, 4);

  const cliSmoke = await runCli([
    'ai',
    'test',
    '--root',
    tempProjectRoot,
    '--provider',
    'local_fake',
  ]);
  assert.equal(cliSmoke.content, 'ready');

  const cliRequest = await runCli([
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
  console.log('- Verified deterministic fake, Ollama-compatible, and authenticated OpenRouter Kimi/GLM request paths without exposing credentials');
  console.log('- Verified OpenRouter endpoint pinning and bounded response handling');
  console.log('- Verified the first Phase 5.9 slice can load text-backed ai/providers.toml manifests from a workspace');
} finally {
  await service.close();
  openRouterServer.closeAllConnections();
  await new Promise((resolve) => openRouterServer.close(resolve));
  if (previousOpenRouterKey === undefined) {
    delete process.env.OPENROUTER_API_KEY;
  } else {
    process.env.OPENROUTER_API_KEY = previousOpenRouterKey;
  }
  if (previousOpenRouterTestOverride === undefined) {
    delete process.env.SHADER_FORGE_AI_TEST_ALLOW_OPENROUTER_BASE_URL;
  } else {
    process.env.SHADER_FORGE_AI_TEST_ALLOW_OPENROUTER_BASE_URL = previousOpenRouterTestOverride;
  }
}
