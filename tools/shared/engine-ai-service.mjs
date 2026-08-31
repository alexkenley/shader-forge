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

  return {
    id,
    type,
    label,
    enabled: provider.enabled !== false,
    mode,
    model,
    baseUrl,
    apiKeyEnv,
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

  return {
    defaultProviderId,
    providers,
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
    supportedInSlice: provider.type === 'fake' || provider.type === 'ollama' || provider.type === 'openrouter',
    available: false,
    status: provider.enabled ? 'configured' : 'disabled',
    diagnostics: [],
    installedModels: [],
    selectedModel: provider.model || null,
  };
}

function requestJson(baseUrl, pathname, { method = 'GET', body, headers = {}, timeoutMs = 2_500 } = {}) {
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
          reject(new Error(payload.error || `Request failed with status ${response.statusCode || 0}`));
          return;
        }
        resolve(payload);
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error(`Timed out connecting to ${target.toString()}`));
    });
    req.on('error', reject);
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

async function inspectOllamaProvider(provider, timeoutMs) {
  const status = baseProviderStatus(provider);
  if (!provider.enabled) {
    return status;
  }

  try {
    const response = await requestJson(provider.baseUrl || 'http://127.0.0.1:11434', '/api/tags', { timeoutMs });
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

async function inspectProvider(provider, timeoutMs) {
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
    return inspectOllamaProvider(provider, timeoutMs);
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

export async function inspectAiProviders(rootPath, { timeoutMs = 2_500 } = {}) {
  const loaded = await loadAiProviders(rootPath);
  const providers = await Promise.all(
    loaded.manifest.providers.map((provider) => inspectProvider(provider, timeoutMs)),
  );

  return {
    rootPath: loaded.rootPath,
    configPath: loaded.configPath,
    configSource: loaded.configSource,
    defaultProviderId: loaded.manifest.defaultProviderId,
    providerCount: providers.length,
    readyProviderCount: providers.filter((provider) => provider.available).length,
    providers,
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

export async function testAiProvider(
  rootPath,
  {
    providerId = '',
    prompt = aiDefaultSmokePrompt,
    systemPrompt = aiDefaultSmokeSystemPrompt,
    timeoutMs = 30_000,
  } = {},
) {
  const summary = await inspectAiProviders(rootPath, { timeoutMs: Math.min(timeoutMs, 2_500) });
  const provider = resolveProvider(summary, providerId);
  if (!provider.enabled) {
    throw new Error(`AI provider ${provider.id} is disabled.`);
  }
  if (!provider.supportedInSlice) {
    throw new Error(provider.diagnostics[0] || `AI provider ${provider.id} is not implemented in this slice.`);
  }
  if (!provider.available && provider.type !== 'fake') {
    throw new Error(provider.diagnostics[0] || `AI provider ${provider.id} is not available.`);
  }

  const startedAt = Date.now();
  if (provider.type === 'fake') {
    return {
      rootPath: summary.rootPath,
      configPath: summary.configPath,
      providerId: provider.id,
      providerType: provider.type,
      model: provider.selectedModel || provider.model || 'deterministic-fake',
      content: deterministicFakeResponse(provider.id, prompt),
      finishReason: 'stop',
      durationMs: Date.now() - startedAt,
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
    headers: isOpenRouter ? { Authorization: `Bearer ${apiKey}` } : {},
    body: {
      model: provider.selectedModel,
      temperature: 0,
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
    durationMs: Date.now() - startedAt,
    requestId: trim(response?.id) || `ai_request_${Date.now()}`,
    diagnostics: [isOpenRouter ? 'Served by the configured OpenRouter provider.' : 'Served by the configured Ollama provider.'],
    prompt,
    systemPrompt,
  };
}
