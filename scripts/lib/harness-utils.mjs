import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { URL, fileURLToPath } from 'node:url';

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getFreePort() {
  const server = http.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    await new Promise((resolve) => server.close(resolve));
    throw new Error('Failed to allocate a free port.');
  }
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}

function requestRaw(url, method = 'GET', body, timeoutMs = 2_500) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request({
      method,
      hostname: parsed.hostname,
      port: parsed.port || 80,
      path: parsed.pathname + parsed.search,
      timeout: timeoutMs,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          headers: res.headers,
          body: data,
        });
      });
    });

    req.on('timeout', () => req.destroy(new Error(`Timed out connecting to ${url}`)));
    req.on('error', reject);

    if (body !== undefined) {
      req.write(typeof body === 'string' ? body : JSON.stringify(body));
    }
    req.end();
  });
}

export async function requestTextNoAuth(url, timeoutMs = 2_500) {
  const response = await requestRaw(url, 'GET', undefined, timeoutMs);
  return response.body;
}

export async function requestJsonNoAuth(url, method = 'GET', body, timeoutMs = 2_500) {
  const response = await requestRaw(url, method, body, timeoutMs);
  try {
    return response.body ? JSON.parse(response.body) : {};
  } catch {
    return response.body;
  }
}

export function parseOllamaHarnessOptions(args = process.argv.slice(2)) {
  const argv = new Set(args);
  return {
    listCandidates: argv.has('--list-candidates'),
    ollamaBaseUrl: process.env.HARNESS_OLLAMA_BASE_URL?.trim() || '',
    ollamaModel: process.env.HARNESS_OLLAMA_MODEL?.trim() || '',
    wslHostIp: process.env.HARNESS_WSL_HOST_IP?.trim() || '',
    ollamaBin: process.env.HARNESS_OLLAMA_BIN?.trim() || '',
    autostartLocalOllama: process.env.HARNESS_AUTOSTART_LOCAL_OLLAMA !== '0',
  };
}

export function collectOllamaBaseUrlCandidates(options = {}) {
  const candidates = [];
  const push = (value) => {
    const trimmed = value?.trim();
    if (!trimmed || candidates.includes(trimmed)) return;
    candidates.push(trimmed.replace(/\/$/, ''));
  };

  push(options.ollamaBaseUrl);
  push('http://127.0.0.1:11434');
  push('http://localhost:11434');
  push(options.wslHostIp ? `http://${options.wslHostIp}:11434` : '');

  try {
    const resolv = fs.readFileSync('/etc/resolv.conf', 'utf-8');
    const match = resolv.match(/^nameserver\s+([0-9.]+)\s*$/m);
    if (match?.[1]) {
      push(`http://${match[1]}:11434`);
    }
  } catch {
    // WSL-specific discovery is best-effort only.
  }

  return candidates;
}

export function isLoopbackOllamaUrl(candidate) {
  try {
    const parsed = new URL(candidate);
    return parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  } catch {
    return false;
  }
}

export async function canReachOllama(candidate) {
  const result = await requestJsonNoAuth(`${candidate}/api/tags`, 'GET', undefined);
  const models = Array.isArray(result?.models) ? result.models : [];
  return models;
}

export async function maybeStartLocalOllama(options, candidate, logPrefix = 'engine-ollama-') {
  if (!options.autostartLocalOllama || !isLoopbackOllamaUrl(candidate)) {
    return null;
  }

  const homeDir = os.homedir();
  const binCandidates = [
    options.ollamaBin,
    path.join(homeDir, '.local', 'bin', 'ollama'),
    'ollama',
  ].filter(Boolean);

  let ollamaBin = '';
  for (const candidateBin of binCandidates) {
    try {
      const processHandle = spawn(candidateBin, ['--version'], { stdio: 'ignore' });
      const exitCode = await new Promise((resolve) => {
        processHandle.on('exit', resolve);
        processHandle.on('error', () => resolve(-1));
      });
      if (exitCode === 0) {
        ollamaBin = candidateBin;
        break;
      }
    } catch {
      // Try the next candidate.
    }
  }

  if (!ollamaBin) {
    return null;
  }

  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), logPrefix));
  const logPath = path.join(logDir, 'ollama.log');
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  const processHandle = spawn(ollamaBin, ['serve'], {
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      NO_COLOR: '1',
    },
  });
  processHandle.stdout.pipe(logStream);
  processHandle.stderr.pipe(logStream);

  const shutdown = async () => {
    if (processHandle.exitCode === null) {
      try {
        if (process.platform === 'win32') {
          processHandle.kill('SIGTERM');
        } else if (typeof processHandle.pid === 'number') {
          process.kill(-processHandle.pid, 'SIGTERM');
        }
      } catch {
        // Best-effort cleanup only.
      }
    }
    await new Promise((resolve) => logStream.end(resolve));
  };

  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await canReachOllama(candidate);
      return { close: shutdown, logPath };
    } catch {
      if (processHandle.exitCode !== null) {
        break;
      }
      await delay(500);
    }
  }

  await shutdown();
  throw new Error(`Failed to autostart local Ollama at ${candidate}. See ${logPath}`);
}

export async function resolveOllamaHarness(options = {}) {
  const candidates = collectOllamaBaseUrlCandidates(options);
  const errors = [];
  let localOllama = null;

  for (const candidate of candidates) {
    try {
      let models = await canReachOllama(candidate);
      if (!models.length) {
        localOllama = await maybeStartLocalOllama(options, candidate);
        if (localOllama) {
          models = await canReachOllama(candidate);
        }
      }
      if (!models.length) {
        throw new Error(`No models available at ${candidate}. Set HARNESS_OLLAMA_MODEL or pull a model first.`);
      }
      const selectedModel = options.ollamaModel || models[0]?.name || models[0]?.model || '';
      if (!selectedModel) {
        throw new Error(`Ollama is reachable at ${candidate}, but no usable model name was returned.`);
      }
      return {
        baseUrl: candidate,
        model: selectedModel,
        models,
        close: async () => {
          if (localOllama) {
            await localOllama.close();
          }
        },
      };
    } catch (error) {
      errors.push(`${candidate} -> ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error([
    'Could not reach a usable Ollama endpoint for the harness.',
    ...errors.map((entry) => `- ${entry}`),
    'Set HARNESS_OLLAMA_BASE_URL to a reachable endpoint or install Ollama in WSL so the harness can autostart it on 127.0.0.1:11434.',
  ].join('\n'));
}

function safeJoin(rootDir, requestPath) {
  const normalizedPath = decodeURIComponent(requestPath.split('?')[0]);
  const resolvedPath = path.resolve(rootDir, `.${normalizedPath}`);
  const normalizedRoot = path.resolve(rootDir);
  if (resolvedPath !== normalizedRoot && !resolvedPath.startsWith(`${normalizedRoot}${path.sep}`)) {
    return null;
  }
  return resolvedPath;
}

function contentTypeFor(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

export async function startStaticFileServer({ rootDir, host = '127.0.0.1', port = 0 }) {
  const absoluteRoot = path.resolve(rootDir);
  const server = http.createServer((req, res) => {
    const requestPath = req.url || '/';
    let resolvedPath = safeJoin(absoluteRoot, requestPath);
    if (!resolvedPath) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('forbidden');
      return;
    }

    if (requestPath === '/' || requestPath === '') {
      resolvedPath = path.join(absoluteRoot, 'index.html');
    } else if (fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory()) {
      resolvedPath = path.join(resolvedPath, 'index.html');
    } else if (!fs.existsSync(resolvedPath) && !path.extname(resolvedPath)) {
      resolvedPath = path.join(absoluteRoot, 'index.html');
    }

    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }

    res.writeHead(200, { 'Content-Type': contentTypeFor(resolvedPath) });
    fs.createReadStream(resolvedPath).pipe(res);
  });

  await new Promise((resolve) => server.listen(port, host, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start static file server.');
  }

  return {
    host,
    port: address.port,
    baseUrl: `http://${host}:${address.port}`,
    rootDir: absoluteRoot,
    async close() {
      await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

export function repoRootFromScript(importMetaUrl) {
  return path.resolve(path.dirname(fileURLToPath(importMetaUrl)), '..');
}
