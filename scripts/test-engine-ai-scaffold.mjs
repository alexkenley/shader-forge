import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { delay, repoRootFromScript, requestJsonNoAuth } from './lib/harness-utils.mjs';
import { startEngineSessiond } from '../tools/engine-sessiond/server.mjs';
import { SessionStore } from '../tools/engine-sessiond/lib/session-store.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const sessionStateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-ai-state-'));
const sessionStorePath = path.join(sessionStateDir, 'sessions.json');
const tempProjectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-ai-project-'));
const engineCliPath = path.join(repoRoot, 'tools', 'engine-cli', 'shaderforge.mjs');
const providerConfigPath = path.join(tempProjectRoot, 'ai', 'providers.toml');
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
    const prompt = body.messages?.at(-1)?.content;
    const matchingAttemptCount = providerRequests.filter(
      (candidate) => candidate.body?.model === body.model
        && candidate.body?.messages?.at(-1)?.content === prompt,
    ).length;
    const respond = () => {
      if (response.destroyed) return;
      if (body.model === 'moonshotai/kimi-k3'
          && (prompt === 'Fallback after retries.'
            || (prompt === 'Retry then succeed.' && matchingAttemptCount === 1))) {
        response.writeHead(503, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'temporary provider failure' }));
        return;
      }
      if (body.model === 'moonshotai/kimi-k3' && prompt === 'Do not fallback.') {
        response.writeHead(400, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'invalid request' }));
        return;
      }
      const content = prompt === 'Return an oversized response.'
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
    };
    if (prompt === 'Wait for cancellation.') {
      setTimeout(respond, 1_000);
    } else {
      respond();
    }
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
  providerConfigPath,
  [
    'default_provider = "local_fake"',
    '',
    '[request]',
    'retry_count = 1',
    'fallback_providers = ["openrouter_glm"]',
    'monthly_request_limit = 3',
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

async function waitForAiJob(baseUrl, jobId, expectedStatuses, predicate = () => true) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const payload = await requestJsonNoAuth(`${baseUrl}/api/ai/jobs/${encodeURIComponent(jobId)}`);
    if (expectedStatuses.includes(payload.job?.status) && predicate(payload.job)) {
      return payload.job;
    }
    await delay(10);
  }
  assert.fail(`AI job ${jobId} did not reach ${expectedStatuses.join(' or ')}.`);
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
  assert.deepEqual(bundledProviders.requestPolicy, {
    retryCount: 0,
    fallbackProviderIds: [],
    monthlyRequestLimit: 0,
    valid: true,
    diagnostics: [],
  });

  const health = await requestJsonNoAuth(`${service.baseUrl}/health`);
  assert.equal(health.ok, true);
  assert.ok(health.capabilities.includes('ai:providers'));
  assert.ok(health.capabilities.includes('ai:test'));
  assert.ok(health.capabilities.includes('ai:jobs'));
  assert.ok(health.capabilities.includes('ai:history'));
  assert.ok(health.capabilities.includes('ai:budget'));
  assert.ok(health.capabilities.includes('ai:tools'));
  assert.ok(health.capabilities.includes('ai:tools:invoke'));
  assert.ok(health.capabilities.includes('ai:skills'));
  assert.ok(health.capabilities.includes('ai:skills:run'));
  assert.ok(health.capabilities.includes('ai:usage'));

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
  assert.deepEqual(providerSummary.requestPolicy, {
    retryCount: 1,
    fallbackProviderIds: ['openrouter_glm'],
    monthlyRequestLimit: 3,
    valid: true,
    diagnostics: [],
  });
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

  const initialBudget = await requestJsonNoAuth(
    `${service.baseUrl}/api/ai/budget?sessionId=${encodeURIComponent(sessionId)}`,
  );
  assert.equal(initialBudget.enabled, true);
  assert.equal(initialBudget.configuredLimit, 3);
  assert.equal(initialBudget.admittedRequestCount, 0);
  assert.equal(initialBudget.remainingRequestCount, 3);
  const cliInitialBudget = await runCli(['ai', 'budgets', '--session', sessionId, '--base-url', service.baseUrl]);
  assert.equal(cliInitialBudget.remainingRequestCount, 3);

  const toolSummary = await requestJsonNoAuth(
    `${service.baseUrl}/api/ai/tools?sessionId=${encodeURIComponent(sessionId)}`,
  );
  assert.equal(toolSummary.configSource, 'bundled');
  assert.equal(toolSummary.toolCount, 2);
  assert.equal(toolSummary.tools[0].permission, 'read_only');
  assert.equal(toolSummary.tools[0].inputSchema.additionalProperties, false);
  const skillSummary = await requestJsonNoAuth(
    `${service.baseUrl}/api/ai/skills?sessionId=${encodeURIComponent(sessionId)}`,
  );
  assert.equal(skillSummary.skillCount, 1);
  assert.deepEqual(skillSummary.skills[0].toolIds, [
    'engine.ai.providers.inspect',
    'engine.ai.usage.inspect',
  ]);
  const cliTools = await runCli(['ai', 'tools', '--root', tempProjectRoot]);
  assert.equal(cliTools.toolCount, 2);
  const cliSkills = await runCli(['ai', 'skills', '--root', tempProjectRoot]);
  assert.equal(cliSkills.skillCount, 1);
  const providerToolInvocation = await requestJsonNoAuth(
    `${service.baseUrl}/api/ai/tools/engine.ai.providers.inspect/invoke`,
    'POST',
    { sessionId, client: 'cli', input: {} },
  );
  assert.equal(providerToolInvocation.toolId, 'engine.ai.providers.inspect');
  assert.equal(providerToolInvocation.result.providerCount, 7);
  const skillRun = await requestJsonNoAuth(
    `${service.baseUrl}/api/ai/skills/engine.ai.health.inspect/run`,
    'POST',
    { sessionId, client: 'shell', inputs: {} },
  );
  assert.equal(skillRun.steps.length, 2);
  assert.deepEqual(skillRun.steps.map((step) => step.toolId), [
    'engine.ai.providers.inspect',
    'engine.ai.usage.inspect',
  ]);
  const cliToolInvocation = await runCli([
    'ai', 'invoke', 'engine.ai.usage.inspect', '--session', sessionId, '--base-url', service.baseUrl,
  ]);
  assert.equal(cliToolInvocation.result.requestCount, 0);
  const cliSkillRun = await runCli([
    'ai', 'run-skill', 'engine.ai.health.inspect', '--session', sessionId, '--base-url', service.baseUrl,
  ]);
  assert.equal(cliSkillRun.steps.length, 2);
  const invalidToolInput = await requestJsonNoAuth(
    `${service.baseUrl}/api/ai/tools/engine.ai.usage.inspect/invoke`,
    'POST',
    { sessionId, client: 'cli', input: { unexpected: true } },
  );
  assert.match(invalidToolInput.error || '', /contains unknown field unexpected/);
  const disallowedToolClient = await requestJsonNoAuth(
    `${service.baseUrl}/api/ai/tools/engine.ai.usage.inspect/invoke`,
    'POST',
    { sessionId, client: 'game_runtime', input: {} },
  );
  assert.match(disallowedToolClient.error || '', /is not allowed/);

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

  const retriedSmoke = await requestJsonNoAuth(`${service.baseUrl}/api/ai/test`, 'POST', {
    sessionId,
    providerId: 'openrouter_kimi',
    prompt: 'Retry then succeed.',
  });
  assert.equal(retriedSmoke.providerId, 'openrouter_kimi');
  assert.equal(retriedSmoke.attemptCount, 2);
  assert.equal(retriedSmoke.fallbackUsed, false);
  assert.deepEqual(retriedSmoke.attemptedProviderIds, ['openrouter_kimi', 'openrouter_kimi']);

  const fallbackSmoke = await requestJsonNoAuth(`${service.baseUrl}/api/ai/test`, 'POST', {
    sessionId,
    providerId: 'openrouter_kimi',
    prompt: 'Fallback after retries.',
  });
  assert.equal(fallbackSmoke.providerId, 'openrouter_glm');
  assert.equal(fallbackSmoke.attemptCount, 3);
  assert.equal(fallbackSmoke.fallbackUsed, true);
  assert.deepEqual(fallbackSmoke.attemptedProviderIds, [
    'openrouter_kimi',
    'openrouter_kimi',
    'openrouter_glm',
  ]);

  const nonRetryableAttemptStart = providerRequests.length;
  const nonRetryableSmoke = await requestJsonNoAuth(`${service.baseUrl}/api/ai/test`, 'POST', {
    sessionId,
    providerId: 'openrouter_kimi',
    prompt: 'Do not fallback.',
  });
  assert.match(nonRetryableSmoke.error || '', /invalid request/);
  assert.deepEqual(
    providerRequests.slice(nonRetryableAttemptStart).map((request) => request.body?.model),
    ['moonshotai/kimi-k3'],
  );

  const runningJobPayload = await requestJsonNoAuth(`${service.baseUrl}/api/ai/jobs`, 'POST', {
    sessionId,
    providerId: 'openrouter_kimi',
    prompt: 'Wait for cancellation.',
  });
  assert.match(runningJobPayload.job?.id || '', /^ai_job_/);
  const runningJob = await waitForAiJob(service.baseUrl, runningJobPayload.job.id, ['running']);
  assert.equal(runningJob.providerId, 'openrouter_kimi');

  const queuedJobPayload = await requestJsonNoAuth(`${service.baseUrl}/api/ai/jobs`, 'POST', {
    sessionId,
    providerId: 'local_fake',
  });
  assert.equal(queuedJobPayload.job?.status, 'queued');
  const cancelledQueuedJob = await requestJsonNoAuth(
    `${service.baseUrl}/api/ai/jobs/${encodeURIComponent(queuedJobPayload.job.id)}`,
    'DELETE',
  );
  assert.equal(cancelledQueuedJob.job?.status, 'cancelled');

  const cancelledRunningJob = await requestJsonNoAuth(
    `${service.baseUrl}/api/ai/jobs/${encodeURIComponent(runningJob.id)}`,
    'DELETE',
  );
  assert.equal(cancelledRunningJob.job?.status, 'cancelled');
  await waitForAiJob(service.baseUrl, runningJob.id, ['cancelled']);

  const completedJobPayload = await requestJsonNoAuth(`${service.baseUrl}/api/ai/jobs`, 'POST', {
    sessionId,
    providerId: 'local_fake',
  });
  const completedJob = await waitForAiJob(service.baseUrl, completedJobPayload.job.id, ['completed']);
  assert.equal(completedJob.result?.content, 'ready');
  assert.equal(completedJob.error, null);
  assert.equal(completedJob.usageRecorded, null);
  assert.equal(completedJob.budgetAdmission, 'not_required');

  const usageJobPayload = await requestJsonNoAuth(`${service.baseUrl}/api/ai/jobs`, 'POST', {
    sessionId,
    providerId: 'openrouter_kimi',
    prompt: 'Record usage.',
  });
  const usageJob = await waitForAiJob(
    service.baseUrl,
    usageJobPayload.job.id,
    ['completed'],
    (job) => job.usageRecorded === true && job.historyRecorded === true,
  );
  assert.equal(usageJob.usageRecorded, true);
  assert.equal(usageJob.usageError, null);

  const cumulativeUsageJobPayload = await requestJsonNoAuth(`${service.baseUrl}/api/ai/jobs`, 'POST', {
    sessionId,
    providerId: 'openrouter_kimi',
    prompt: 'Record cumulative usage.',
  });
  const cumulativeUsageJob = await waitForAiJob(
    service.baseUrl,
    cumulativeUsageJobPayload.job.id,
    ['completed'],
    (job) => job.usageRecorded === true && job.historyRecorded === true,
  );
  assert.equal(cumulativeUsageJob.usageRecorded, true);

  const usageSummary = await requestJsonNoAuth(
    `${service.baseUrl}/api/ai/usage?sessionId=${encodeURIComponent(sessionId)}`,
  );
  assert.equal(usageSummary.requestCount, 2);
  assert.equal(usageSummary.promptTokens, 20);
  assert.equal(usageSummary.completionTokens, 4);
  assert.equal(usageSummary.totalTokens, 24);
  assert.deepEqual(usageSummary.providers.map((provider) => provider.providerId), ['openrouter_kimi']);
  const durableUsage = JSON.parse(await fs.readFile(
    path.join(tempProjectRoot, '.shader-forge', 'ai-usage.json'),
    'utf8',
  ));
  assert.equal(durableUsage.providers[0].requestCount, 2);
  assert.equal(durableUsage.providers[0].totalTokens, 24);

  const unknownJob = await requestJsonNoAuth(`${service.baseUrl}/api/ai/jobs/missing-job`);
  assert.match(unknownJob.error || '', /Unknown AI job/);

  const cliQueuedJob = await runCli([
    'ai',
    'submit',
    'Queue this deterministic request.',
    '--session', sessionId,
    '--provider', 'local_fake',
    '--base-url', service.baseUrl,
  ]);
  const cliCompletedJob = await waitForAiJob(
    service.baseUrl,
    cliQueuedJob.id,
    ['completed'],
    (job) => job.historyRecorded === true,
  );
  const cliJobStatus = await runCli(['ai', 'status', cliQueuedJob.id, '--base-url', service.baseUrl]);
  assert.equal(cliJobStatus.status, 'completed');
  assert.equal(cliJobStatus.result?.content, cliCompletedJob.result.content);
  const cliCompletedJobs = await runCli([
    'ai', 'jobs', '--session', sessionId, '--status', 'completed', '--base-url', service.baseUrl,
  ]);
  assert.ok(cliCompletedJobs.some((job) => job.id === cliQueuedJob.id));
  assert.equal(Object.hasOwn(cliCompletedJobs[0], 'result'), false);
  const cliUsage = await runCli(['ai', 'usage', '--session', sessionId, '--base-url', service.baseUrl]);
  assert.equal(cliUsage.requestCount, 2);
  assert.equal(cliUsage.totalTokens, 24);
  const historySummary = await requestJsonNoAuth(
    `${service.baseUrl}/api/ai/history?sessionId=${encodeURIComponent(sessionId)}&limit=20`,
  );
  assert.equal(historySummary.jobs.length, 6);
  assert.equal(historySummary.jobs.find((job) => job.id === usageJob.id)?.usage?.totalTokens, 12);
  assert.ok(historySummary.jobs.some((job) => job.id === cancelledQueuedJob.job.id && job.status === 'cancelled'));
  assert.ok(historySummary.jobs.some((job) => job.id === cancelledRunningJob.job.id && job.status === 'cancelled'));
  for (const job of historySummary.jobs) {
    assert.equal(Object.hasOwn(job, 'prompt'), false);
    assert.equal(Object.hasOwn(job, 'systemPrompt'), false);
    assert.equal(Object.hasOwn(job, 'result'), false);
    assert.equal(Object.hasOwn(job, 'error'), false);
  }
  assert.doesNotMatch(JSON.stringify(historySummary), /Record usage|ready|test-openrouter-key/);
  const durableHistory = JSON.parse(await fs.readFile(
    path.join(tempProjectRoot, '.shader-forge', 'ai-history.json'),
    'utf8',
  ));
  assert.equal(durableHistory.jobs.length, 6);
  const cliCancelledHistory = await runCli([
    'ai', 'history', '--session', sessionId, '--status', 'cancelled', '--limit', '2', '--base-url', service.baseUrl,
  ]);
  assert.equal(cliCancelledHistory.jobs.length, 2);
  assert.ok(cliCancelledHistory.jobs.every((job) => job.status === 'cancelled'));
  const invalidHistoryLimit = await requestJsonNoAuth(
    `${service.baseUrl}/api/ai/history?sessionId=${encodeURIComponent(sessionId)}&limit=129`,
  );
  assert.match(invalidHistoryLimit.error || '', /limit must be from 1 through 128/);
  const cliCancelCompleted = await runCli(['ai', 'cancel', cliQueuedJob.id, '--base-url', service.baseUrl]);
  assert.equal(cliCancelCompleted.status, 'completed');

  const budgetedProviderRequestCount = providerRequests.length;
  const deniedBudgetJobPayload = await requestJsonNoAuth(`${service.baseUrl}/api/ai/jobs`, 'POST', {
    sessionId,
    providerId: 'openrouter_kimi',
    prompt: 'Do not run after the monthly budget is exhausted.',
  });
  const deniedBudgetJob = await waitForAiJob(
    service.baseUrl,
    deniedBudgetJobPayload.job.id,
    ['failed'],
    (job) => job.historyRecorded === true,
  );
  assert.equal(deniedBudgetJob.budgetAdmission, 'denied');
  assert.match(deniedBudgetJob.error || '', /monthly queued-request budget is exhausted/);
  assert.equal(providerRequests.length, budgetedProviderRequestCount);
  const exhaustedBudget = await runCli(['ai', 'budgets', '--session', sessionId, '--base-url', service.baseUrl]);
  assert.equal(exhaustedBudget.admittedRequestCount, 3);
  assert.equal(exhaustedBudget.remainingRequestCount, 0);
  const durableBudget = JSON.parse(await fs.readFile(
    path.join(tempProjectRoot, '.shader-forge', 'ai-budget.json'),
    'utf8',
  ));
  assert.equal(durableBudget.months.at(-1).admittedRequestCount, 3);

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

  const validProviderConfig = await fs.readFile(providerConfigPath, 'utf8');
  await fs.writeFile(providerConfigPath, validProviderConfig.replace('retry_count = 1', 'retry_count = 3'), 'utf8');
  const invalidRetryPolicy = await requestJsonNoAuth(`${service.baseUrl}/api/ai/test`, 'POST', {
    sessionId,
    providerId: 'local_fake',
  });
  assert.match(invalidRetryPolicy.error || '', /request\.retry_count must be an integer from 0 through 2/);
  await fs.writeFile(
    providerConfigPath,
    validProviderConfig.replace('monthly_request_limit = 3', 'monthly_request_limit = 100001'),
    'utf8',
  );
  const invalidBudgetPolicy = await requestJsonNoAuth(
    `${service.baseUrl}/api/ai/budget?sessionId=${encodeURIComponent(sessionId)}`,
  );
  assert.match(
    invalidBudgetPolicy.error || '',
    /request\.monthly_request_limit must be an integer from 0 through 100000/,
  );

  await fs.writeFile(path.join(tempProjectRoot, 'ai', 'registry.json'), JSON.stringify({
    schemaVersion: 1,
    tools: [],
    skills: [{
      id: 'invalid.skill',
      label: 'Invalid skill',
      toolIds: ['missing.tool'],
      allowedClients: ['cli'],
      permission: 'read_only',
    }],
  }), 'utf8');
  const invalidRegistry = await requestJsonNoAuth(
    `${service.baseUrl}/api/ai/skills?sessionId=${encodeURIComponent(sessionId)}`,
  );
  assert.match(invalidRegistry.error || '', /references unknown tool missing\.tool/);

  console.log('Engine AI scaffold passed.');
  console.log('- Verified AI provider inspection through engine_sessiond and the engine CLI');
  console.log('- Verified deterministic fake, Ollama-compatible, and authenticated OpenRouter Kimi/GLM request paths without exposing credentials');
  console.log('- Verified manifest-bounded retry and explicit Kimi-to-GLM fallback for transient errors without fallback on invalid requests');
  console.log('- Verified bounded queued AI jobs, list/status/cancel APIs and CLI adapters, pending/running cancellation, and queue recovery');
  console.log('- Verified bounded durable metadata-only AI history through the API and CLI without prompt, response, error, or credential content');
  console.log('- Verified atomic per-workspace provider token usage persistence and API/CLI summaries for successful queued calls');
  console.log('- Verified durable monthly queued real-model admission budgets, fake-provider exemption, and pre-provider rejection');
  console.log('- Verified bounded read-only tool/skill registry discovery, schemas, client narrowing, and reference validation');
  console.log('- Verified exact read-only tool invocation and ordered skill execution through schema-validated server and CLI adapters');
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
