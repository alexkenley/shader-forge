import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const bundledAiProvidersPath = path.join(repoRoot, 'ai', 'providers.toml');
const openRouterApiBaseUrl = 'https://openrouter.ai/api/v1/';
const openRouterApiKeyEnv = 'OPENROUTER_API_KEY';
const maxAiResponseBytes = 1024 * 1024;
const defaultMaxOutputTokens = 256;
const retryableHttpStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
const retryableNetworkCodes = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN']);

export const aiProviderTypes = [
  'fake',
  'ollama',
  'openrouter',
  'openai',
  'anthropic',
  'gemini',
  'openai_compatible',
];

export const aiDeploymentModes = [
  'LocalOnly',
  'DeveloperHosted',
  'BringYourOwnKey',
];

export const aiDefaultSmokeSystemPrompt = 'You are a terse engine AI smoke-test provider.';
export const aiDefaultSmokePrompt = 'Reply with the single word ready.';

function trim(value) {
  return String(value || '').trim();
}

function parseTomlValue(rawValue) {
  const value = trim(rawValue);
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = trim(value.slice(1, -1));
    if (!inner) {
      return [];
    }
    const items = [];
    let current = '';
    let inString = false;
    for (const character of inner) {
      if (character === '"') {
        inString = !inString;
        current += character;
        continue;
      }
      if (character === ',' && !inString) {
        items.push(parseTomlValue(current));
        current = '';
        continue;
      }
      current += character;
    }
    if (current) {
      items.push(parseTomlValue(current));
    }
    return items;
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  const numberValue = Number(value);
  if (Number.isFinite(numberValue)) {
    return numberValue;
  }
  return value;
}

function parseSimpleTomlDocument(content) {
  const result = {};
  let currentSection = result;

  for (const rawLine of String(content || '').split(/\r?\n/)) {
    const line = trim(rawLine);
    if (!line || line.startsWith('#')) {
      continue;
    }
    if (line.startsWith('[') && line.endsWith(']')) {
      const sectionPath = line.slice(1, -1).split('.').map(trim).filter(Boolean);
      if (!sectionPath.length) {
        currentSection = result;
        continue;
      }
      currentSection = result;
      for (const sectionName of sectionPath) {
        if (!currentSection[sectionName] || typeof currentSection[sectionName] !== 'object') {
          currentSection[sectionName] = {};
        }
        currentSection = currentSection[sectionName];
      }
      continue;
    }
    const separator = line.indexOf('=');
    if (separator === -1) {
      continue;
    }
    const key = trim(line.slice(0, separator));
    const value = line.slice(separator + 1);
    currentSection[key] = parseTomlValue(value);
  }

  return result;
}

function normalizeProvider(id, source) {
  if (!id) {
    return null;
  }

  const provider = source && typeof source === 'object' ? source : {};
  const type = aiProviderTypes.includes(provider.type) ? provider.type : 'unsupported';
  const mode = aiDeploymentModes.includes(provider.mode) ? provider.mode : 'LocalOnly';
  const label = trim(provider.label) || id;
  const model = trim(provider.model) || '';
  const baseUrl = trim(provider.base_url || provider.baseUrl) || '';
  const apiKeyEnv = trim(provider.api_key_env || provider.apiKeyEnv) || '';
  const configuredMaxOutputTokens = provider.max_output_tokens ?? provider.maxOutputTokens;
  const maxOutputTokens = configuredMaxOutputTokens === undefined
    ? defaultMaxOutputTokens
    : Number(configuredMaxOutputTokens);

  return {
    id,
    type,
    label,
    enabled: provider.enabled !== false,
    mode,
    model,
    baseUrl,
    apiKeyEnv,
    maxOutputTokens,
  };
}

function normalizeAiManifest(parsed) {
  const source = parsed && typeof parsed === 'object' ? parsed : {};
  const providersSource = source.provider && typeof source.provider === 'object' ? source.provider : {};
  const providers = Object.entries(providersSource)
    .map(([id, value]) => normalizeProvider(id, value))
    .filter(Boolean);
  const defaultProviderId = trim(source.default_provider)
    || providers.find((provider) => provider.enabled)?.id
    || providers[0]?.id
    || null;
  const requestSource = source.request && typeof source.request === 'object' ? source.request : {};
  const configuredRetryCount = requestSource.retry_count ?? 0;
  const retryCount = Number(configuredRetryCount);
  const configuredFallbacks = requestSource.fallback_providers ?? [];
  const fallbackProviderIds = Array.isArray(configuredFallbacks)
    ? configuredFallbacks.map(trim).filter(Boolean)
    : [];
  const policyDiagnostics = [];
  if (!Number.isInteger(retryCount) || retryCount < 0 || retryCount > 2) {
    policyDiagnostics.push('request.retry_count must be an integer from 0 through 2.');
  }
  if (!Array.isArray(configuredFallbacks)
      || configuredFallbacks.some((value) => typeof value !== 'string')
      || fallbackProviderIds.length !== configuredFallbacks.length
      || fallbackProviderIds.length > 2
      || new Set(fallbackProviderIds).size !== fallbackProviderIds.length) {
    policyDiagnostics.push('request.fallback_providers must contain at most two unique non-empty provider IDs.');
  }

  return {
    defaultProviderId,
    providers,
    requestPolicy: {
      retryCount: Number.isInteger(retryCount) ? retryCount : 0,
      fallbackProviderIds,
      diagnostics: policyDiagnostics,
    },
  };
}

async function readTomlFile(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return parseSimpleTomlDocument(content);
}

async function loadAiProviders(rootPath) {
  const resolvedRoot = path.resolve(rootPath || repoRoot);
  const workspaceConfigPath = path.join(resolvedRoot, 'ai', 'providers.toml');
  const candidatePaths = [
    { filePath: workspaceConfigPath, source: 'workspace' },
    { filePath: bundledAiProvidersPath, source: 'bundled' },
  ];

  for (const candidate of candidatePaths) {
    try {
      const parsed = await readTomlFile(candidate.filePath);
      return {
        rootPath: resolvedRoot,
        configPath: candidate.filePath,
        configSource: candidate.source,
        manifest: normalizeAiManifest(parsed),
      };
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return {
    rootPath: resolvedRoot,
    configPath: bundledAiProvidersPath,
    configSource: 'bundled',
    manifest: normalizeAiManifest({}),
  };
}

function baseProviderStatus(provider) {
  return {
    id: provider.id,
    type: provider.type,
    label: provider.label,
    enabled: provider.enabled,
    mode: provider.mode,
    model: provider.model || null,
    endpoint: provider.baseUrl || null,
    apiKeyEnv: provider.apiKeyEnv || null,
    maxOutputTokens: Number.isInteger(provider.maxOutputTokens) ? provider.maxOutputTokens : null,
    supportedInSlice: provider.type === 'fake' || provider.type === 'ollama' || provider.type === 'openrouter',
    available: false,
    status: provider.enabled ? 'configured' : 'disabled',
    diagnostics: [],
    installedModels: [],
    selectedModel: provider.model || null,
  };
}

function abortError() {
  const error = new Error('AI provider request was cancelled.');
  error.name = 'AbortError';
  return error;
}

function providerRequestError(message, { statusCode = null, retryable = false } = {}) {
  const error = new Error(message);
  error.providerStatusCode = statusCode;
  error.retryable = retryable;
  return error;
}

function requestJson(baseUrl, pathname, {
  method = 'GET', body, headers = {}, timeoutMs = 2_500, signal,
} = {}) {
  if (signal?.aborted) {
    throw abortError();
  }
  const target = new URL(String(pathname || '').replace(/^\/+/, ''), `${String(baseUrl || '').replace(/\/+$/, '')}/`);
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    throw new Error('AI provider endpoint must use HTTP or HTTPS.');
  }
  const requestBody = body ? JSON.stringify(body) : '';
  const transport = target.protocol === 'https:' ? https : http;
  const requestHeaders = { ...headers };
  if (requestBody) {
    requestHeaders['Content-Type'] = 'application/json';
    requestHeaders['Content-Length'] = Buffer.byteLength(requestBody);
  }

  return new Promise((resolve, reject) => {
    const req = transport.request({
      method,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      timeout: timeoutMs,
      headers: requestHeaders,
    }, (response) => {
      let rawBody = '';
      let responseBytes = 0;
      let responseTooLarge = false;
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        if (responseTooLarge) {
          return;
        }
        responseBytes += Buffer.byteLength(chunk);
        if (responseBytes > maxAiResponseBytes) {
          responseTooLarge = true;
          response.destroy();
          reject(new Error(`AI provider response exceeded ${maxAiResponseBytes} bytes.`));
          return;
        }
        rawBody += chunk;
      });
      response.on('end', () => {
        if (responseTooLarge) {
          return;
        }
        let payload = {};
        try {
          payload = rawBody ? JSON.parse(rawBody) : {};
        } catch {
          reject(new Error(`Invalid JSON response from ${target.toString()}`));
          return;
        }
        if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
          const statusCode = response.statusCode || 0;
          reject(providerRequestError(
            payload.error || `Request failed with status ${statusCode}`,
            { statusCode, retryable: retryableHttpStatuses.has(statusCode) },
          ));
          return;
        }
        resolve(payload);
      });
    });

    req.on('timeout', () => {
      req.destroy(providerRequestError(`Timed out connecting to ${target.toString()}`, { retryable: true }));
    });
    req.on('error', (error) => {
      if (error?.name !== 'AbortError' && retryableNetworkCodes.has(error?.code)) {
        error.retryable = true;
      }
      reject(error);
    });
    if (signal) {
      const cancelRequest = () => req.destroy(abortError());
      signal.addEventListener('abort', cancelRequest, { once: true });
      req.once('close', () => signal.removeEventListener('abort', cancelRequest));
      if (signal.aborted) {
        cancelRequest();
      }
    }
    if (requestBody) {
      req.write(requestBody);
    }
    req.end();
  });
}

async function inspectFakeProvider(provider) {
  return {
    ...baseProviderStatus(provider),
    available: provider.enabled,
    status: provider.enabled ? 'ready' : 'disabled',
    diagnostics: provider.enabled ? ['Deterministic fake provider is available for harness and offline slice coverage.'] : [],
    selectedModel: provider.model || 'deterministic-fake',
  };
}

async function inspectOllamaProvider(provider, timeoutMs, signal) {
  const status = baseProviderStatus(provider);
  if (!provider.enabled) {
    return status;
  }

  try {
    const response = await requestJson(provider.baseUrl || 'http://127.0.0.1:11434', '/api/tags', { timeoutMs, signal });
    const installedModels = Array.isArray(response.models)
      ? response.models.map((model) => trim(model.name || model.model)).filter(Boolean)
      : [];
    const selectedModel = provider.model || installedModels[0] || null;
    return {
      ...status,
      available: Boolean(selectedModel),
      status: selectedModel ? 'ready' : 'needs_model',
      diagnostics: selectedModel
        ? ['Ollama endpoint is reachable for the current slice.']
        : ['Ollama is reachable, but no installed model could be selected.'],
      endpoint: provider.baseUrl || 'http://127.0.0.1:11434',
      installedModels,
      selectedModel,
    };
  } catch (error) {
    return {
      ...status,
      status: 'offline',
      diagnostics: [error instanceof Error ? error.message : String(error)],
      endpoint: provider.baseUrl || 'http://127.0.0.1:11434',
      retryable: error?.retryable === true,
    };
  }
}

function resolveOpenRouterEndpoint(provider) {
  const configuredUrl = provider.baseUrl || openRouterApiBaseUrl;
  let endpoint;
  try {
    endpoint = new URL(configuredUrl);
  } catch {
    throw new Error('OpenRouter base_url must be a valid URL.');
  }
  if (endpoint.username || endpoint.password) {
    throw new Error('OpenRouter base_url must not contain credentials.');
  }

  const normalizedEndpoint = `${endpoint.toString().replace(/\/+$/, '')}/`;
  if (normalizedEndpoint === openRouterApiBaseUrl) {
    return normalizedEndpoint;
  }

  const hostname = endpoint.hostname.replace(/^\[|\]$/g, '');
  const loopback = hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1';
  if (process.env.SHADER_FORGE_AI_TEST_ALLOW_OPENROUTER_BASE_URL === '1' && loopback) {
    return normalizedEndpoint;
  }
  throw new Error(`OpenRouter base_url must be ${openRouterApiBaseUrl}`);
}

async function inspectOpenRouterProvider(provider) {
  const status = baseProviderStatus(provider);
  if (!provider.enabled) {
    return {
      ...status,
      endpoint: openRouterApiBaseUrl,
      apiKeyEnv: openRouterApiKeyEnv,
    };
  }

  try {
    const endpoint = resolveOpenRouterEndpoint(provider);
    if (provider.apiKeyEnv && provider.apiKeyEnv !== openRouterApiKeyEnv) {
      throw new Error(`OpenRouter api_key_env must be ${openRouterApiKeyEnv}.`);
    }
    if (!Number.isInteger(provider.maxOutputTokens) || provider.maxOutputTokens < 1 || provider.maxOutputTokens > 4096) {
      throw new Error('OpenRouter max_output_tokens must be an integer from 1 to 4096.');
    }
    if (!provider.model) {
      return {
        ...status,
        endpoint,
        apiKeyEnv: openRouterApiKeyEnv,
        status: 'needs_model',
        diagnostics: ['Configure an OpenRouter model slug before enabling requests.'],
      };
    }
    if (!trim(process.env[openRouterApiKeyEnv])) {
      return {
        ...status,
        endpoint,
        apiKeyEnv: openRouterApiKeyEnv,
        status: 'needs_auth',
        diagnostics: [`Set ${openRouterApiKeyEnv} to enable OpenRouter requests.`],
      };
    }
    return {
      ...status,
      endpoint,
      apiKeyEnv: openRouterApiKeyEnv,
      available: true,
      status: 'ready',
      diagnostics: ['OpenRouter model and credential are configured; connectivity is checked on request.'],
    };
  } catch (error) {
    return {
      ...status,
      endpoint: provider.baseUrl || openRouterApiBaseUrl,
      apiKeyEnv: openRouterApiKeyEnv,
      status: 'invalid',
      diagnostics: [error instanceof Error ? error.message : String(error)],
    };
  }
}

async function inspectHostedProvider(provider) {
  const status = baseProviderStatus(provider);
  if (!provider.enabled) {
    return status;
  }

  const diagnostics = [];
  if (provider.apiKeyEnv && !process.env[provider.apiKeyEnv]) {
    diagnostics.push(`Set ${provider.apiKeyEnv} to enable future hosted-provider use.`);
  } else if (!provider.apiKeyEnv) {
    diagnostics.push('Configure an api_key_env entry before enabling this hosted provider.');
  }
  diagnostics.push('Hosted-provider request execution is not implemented in this first Phase 5.9 slice.');

  return {
    ...status,
    status: provider.apiKeyEnv && process.env[provider.apiKeyEnv] ? 'unimplemented' : 'needs_auth',
    diagnostics,
  };
}

async function inspectProvider(provider, timeoutMs, signal) {
  if (provider.type === 'unsupported') {
    return {
      ...baseProviderStatus(provider),
      status: 'invalid',
      diagnostics: [`AI provider ${provider.id} has an unsupported type.`],
    };
  }
  if (provider.type === 'fake') {
    return inspectFakeProvider(provider);
  }
  if (provider.type === 'ollama') {
    return inspectOllamaProvider(provider, timeoutMs, signal);
  }
  if (provider.type === 'openrouter') {
    return inspectOpenRouterProvider(provider);
  }
  return inspectHostedProvider(provider);
}

function deterministicFakeResponse(providerId, prompt) {
  const normalizedPrompt = trim(prompt).replace(/\s+/g, ' ');
  if (/single word ready/i.test(normalizedPrompt)) {
    return 'ready';
  }
  return `fake:${providerId}:${normalizedPrompt.slice(0, 160)}`;
}

function normalizeTokenUsage(usage) {
  const promptTokens = Number(usage?.prompt_tokens);
  const completionTokens = Number(usage?.completion_tokens);
  const totalTokens = Number(usage?.total_tokens);
  if (!Number.isSafeInteger(promptTokens) || promptTokens < 0
    || !Number.isSafeInteger(completionTokens) || completionTokens < 0) {
    return null;
  }
  return {
    promptTokens,
    completionTokens,
    totalTokens: Number.isSafeInteger(totalTokens) && totalTokens >= 0
      ? totalTokens
      : promptTokens + completionTokens,
  };
}

export async function inspectAiProviders(rootPath, { timeoutMs = 2_500, signal } = {}) {
  const loaded = await loadAiProviders(rootPath);
  const providers = await Promise.all(
    loaded.manifest.providers.map((provider) => inspectProvider(provider, timeoutMs, signal)),
  );
  const requestPolicyDiagnostics = [...loaded.manifest.requestPolicy.diagnostics];
  for (const providerId of loaded.manifest.requestPolicy.fallbackProviderIds) {
    const provider = providers.find((candidate) => candidate.id === providerId);
    if (!provider) {
      requestPolicyDiagnostics.push(`Fallback AI provider ${providerId} is not configured for this workspace.`);
    } else if (!provider.enabled) {
      requestPolicyDiagnostics.push(`Fallback AI provider ${providerId} is disabled.`);
    } else if (!provider.supportedInSlice) {
      requestPolicyDiagnostics.push(`Fallback AI provider ${providerId} is not implemented in this slice.`);
    }
  }

  return {
    rootPath: loaded.rootPath,
    configPath: loaded.configPath,
    configSource: loaded.configSource,
    defaultProviderId: loaded.manifest.defaultProviderId,
    providerCount: providers.length,
    readyProviderCount: providers.filter((provider) => provider.available).length,
    providers,
    requestPolicy: {
      retryCount: loaded.manifest.requestPolicy.retryCount,
      fallbackProviderIds: loaded.manifest.requestPolicy.fallbackProviderIds,
      valid: requestPolicyDiagnostics.length === 0,
      diagnostics: requestPolicyDiagnostics,
    },
  };
}

function resolveProvider(summary, providerId = '') {
  const explicitProviderId = trim(providerId);
  if (explicitProviderId) {
    const explicitProvider = summary.providers.find((candidate) => candidate.id === explicitProviderId);
    if (!explicitProvider) {
      throw new Error(`AI provider ${explicitProviderId} is not configured for this workspace.`);
    }
    return explicitProvider;
  }
  const provider = summary.providers.find((candidate) => candidate.id === summary.defaultProviderId)
    || summary.providers.find((candidate) => candidate.available)
    || summary.providers[0]
    || null;
  if (!provider) {
    throw new Error('No AI providers are configured for this workspace.');
  }
  return provider;
}

function retryDelay(signal) {
  if (signal?.aborted) {
    throw abortError();
  }
  return new Promise((resolve, reject) => {
    const cancel = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', cancel);
      resolve();
    }, 100);
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

function attachAttempts(error, attempts) {
  if (error && typeof error === 'object') {
    error.attempts = attempts;
  }
  return error;
}

async function requestAiProviderOnce(summary, provider, {
  prompt,
  systemPrompt,
  timeoutMs,
  signal,
}) {
  if (signal?.aborted) {
    throw abortError();
  }
  if (!provider.enabled) {
    throw new Error(`AI provider ${provider.id} is disabled.`);
  }
  if (!provider.supportedInSlice) {
    throw new Error(provider.diagnostics[0] || `AI provider ${provider.id} is not implemented in this slice.`);
  }
  if (!provider.available && provider.type !== 'fake'
      && !(provider.type === 'ollama' && provider.selectedModel)) {
    throw providerRequestError(
      provider.diagnostics[0] || `AI provider ${provider.id} is not available.`,
      { retryable: provider.retryable === true },
    );
  }

  if (provider.type === 'fake') {
    if (signal?.aborted) {
      throw abortError();
    }
    return {
      rootPath: summary.rootPath,
      configPath: summary.configPath,
      providerId: provider.id,
      providerType: provider.type,
      model: provider.selectedModel || provider.model || 'deterministic-fake',
      content: deterministicFakeResponse(provider.id, prompt),
      finishReason: 'stop',
      usage: null,
      requestId: `ai_request_${Date.now()}`,
      diagnostics: ['Served by the deterministic fake provider.'],
      prompt,
      systemPrompt,
    };
  }

  const isOpenRouter = provider.type === 'openrouter';
  const apiKey = isOpenRouter ? trim(process.env[provider.apiKeyEnv]) : '';
  if (isOpenRouter && !apiKey) {
    throw new Error(`Set ${provider.apiKeyEnv} to enable OpenRouter requests.`);
  }
  const response = await requestJson(provider.endpoint, isOpenRouter ? 'chat/completions' : 'v1/chat/completions', {
    method: 'POST',
    timeoutMs,
    signal,
    headers: isOpenRouter ? { Authorization: `Bearer ${apiKey}` } : {},
    body: {
      model: provider.selectedModel,
      temperature: 0,
      max_tokens: provider.maxOutputTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ],
    },
  });
  const content = trim(response?.choices?.[0]?.message?.content);
  if (!content) {
    throw new Error(`AI provider ${provider.id} returned an empty response.`);
  }

  return {
    rootPath: summary.rootPath,
    configPath: summary.configPath,
    providerId: provider.id,
    providerType: provider.type,
    model: provider.selectedModel || provider.model || null,
    content,
    finishReason: trim(response?.choices?.[0]?.finish_reason) || 'stop',
    usage: normalizeTokenUsage(response?.usage),
    requestId: trim(response?.id) || `ai_request_${Date.now()}`,
    diagnostics: [isOpenRouter ? 'Served by the configured OpenRouter provider.' : 'Served by the configured Ollama provider.'],
    prompt,
    systemPrompt,
  };
}

export async function testAiProvider(
  rootPath,
  {
    providerId = '',
    prompt = aiDefaultSmokePrompt,
    systemPrompt = aiDefaultSmokeSystemPrompt,
    timeoutMs = 30_000,
    signal,
  } = {},
) {
  const startedAt = Date.now();
  const summary = await inspectAiProviders(rootPath, { timeoutMs: Math.min(timeoutMs, 2_500), signal });
  if (signal?.aborted) {
    throw abortError();
  }
  const primaryProvider = resolveProvider(summary, providerId);
  if (!summary.requestPolicy.valid) {
    throw new Error(summary.requestPolicy.diagnostics[0]);
  }
  const providers = [
    primaryProvider,
    ...summary.requestPolicy.fallbackProviderIds
      .map((fallbackId) => summary.providers.find((provider) => provider.id === fallbackId))
      .filter((provider) => provider && provider.id !== primaryProvider.id),
  ];
  const attempts = [];
  let lastError = new Error(`AI provider ${primaryProvider.id} did not complete a request.`);

  for (const provider of providers) {
    for (let retryIndex = 0; retryIndex <= summary.requestPolicy.retryCount; retryIndex += 1) {
      try {
        const result = await requestAiProviderOnce(summary, provider, {
          prompt,
          systemPrompt,
          timeoutMs,
          signal,
        });
        attempts.push({ providerId: provider.id, status: 'completed' });
        return {
          ...result,
          durationMs: Date.now() - startedAt,
          attemptCount: attempts.length,
          fallbackUsed: provider.id !== primaryProvider.id,
          attemptedProviderIds: attempts.map((attempt) => attempt.providerId),
        };
      } catch (error) {
        if (error?.name === 'AbortError') {
          throw attachAttempts(error, attempts);
        }
        lastError = error instanceof Error ? error : new Error(String(error));
        attempts.push({
          providerId: provider.id,
          status: 'failed',
          retryable: lastError.retryable === true,
        });
        if (lastError.retryable !== true) {
          throw attachAttempts(lastError, attempts);
        }
        if (retryIndex < summary.requestPolicy.retryCount) {
          await retryDelay(signal);
        }
      }
    }
  }

  throw attachAttempts(lastError, attempts);
}
