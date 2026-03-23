import http from 'node:http';
import path from 'node:path';
import { URL, pathToFileURL } from 'node:url';
import { BuildStore } from './lib/build-store.mjs';
import { initGitRepository, readGitStatus } from './lib/git-service.mjs';
import { getPlatformInfo, listHostDirectory } from './lib/host-fs-service.mjs';
import { SessionStore } from './lib/session-store.mjs';
import { RuntimeStore } from './lib/runtime-store.mjs';
import { TerminalStore } from './lib/terminal-store.mjs';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  };
}

function jsonHeaders(statusCode = 200) {
  return {
    statusCode,
    headers: {
      ...corsHeaders(),
      'Content-Type': 'application/json; charset=utf-8',
    },
  };
}

function sseHeaders() {
  return {
    ...corsHeaders(),
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
}

function writeJson(response, statusCode, payload) {
  const { headers } = jsonHeaders(statusCode);
  response.writeHead(statusCode, headers);
  response.end(JSON.stringify(payload, null, 2));
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  if (!chunks.length) {
    return {};
  }
  const rawBody = Buffer.concat(chunks).toString('utf8');
  return rawBody ? JSON.parse(rawBody) : {};
}

function createEventHub() {
  const listeners = new Set();

  function emit(type, data) {
    const chunk = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const response of listeners) {
      response.write(chunk);
    }
  }

  function subscribe(request, response) {
    response.writeHead(200, sseHeaders());
    response.write(': connected\n\n');
    listeners.add(response);

    const heartbeat = setInterval(() => {
      response.write(': ping\n\n');
    }, 15000);

    request.on('close', () => {
      clearInterval(heartbeat);
      listeners.delete(response);
    });
  }

  function closeAll() {
    for (const response of listeners) {
      response.end();
    }
    listeners.clear();
  }

  return {
    emit,
    subscribe,
    closeAll,
  };
}

function resolveTerminalCwd({ sessionStore, sessionId, cwd }) {
  if (sessionId) {
    return sessionStore.resolveSessionPath(sessionId, cwd || '.');
  }
  return path.resolve(cwd || process.cwd());
}

function createRouter({ sessionStore, terminalStore, runtimeStore, buildStore, eventHub }) {
  return async function route(request, response) {
    if (!request.url) {
      writeJson(response, 400, { error: 'Request URL is required.' });
      return;
    }

    if (request.method === 'OPTIONS') {
      response.writeHead(204, corsHeaders());
      response.end();
      return;
    }

    const requestUrl = new URL(request.url, 'http://127.0.0.1');
    const { pathname, searchParams } = requestUrl;

    try {
      if (request.method === 'GET' && pathname === '/health') {
        const capabilities = [
          'sessions',
          'sessions:update',
          'sessions:delete',
          'files:list',
          'files:read',
          'files:write',
          'hostfs:list',
          'git:status',
          'git:init',
          'terminals',
          'runtime:lifecycle',
          'build:lifecycle',
          'events',
        ];
        if (runtimeStore.supportsPause()) {
          capabilities.push('runtime:lifecycle:pause', 'runtime:lifecycle:resume');
        }
        writeJson(response, 200, {
          ok: true,
          service: 'engine_sessiond',
          now: new Date().toISOString(),
          capabilities,
        });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/platform') {
        writeJson(response, 200, getPlatformInfo());
        return;
      }

      if (request.method === 'GET' && pathname === '/api/events') {
        eventHub.subscribe(request, response);
        return;
      }

      if (request.method === 'GET' && pathname === '/api/sessions') {
        writeJson(response, 200, { sessions: sessionStore.listSessions() });
        return;
      }

      if (request.method === 'POST' && pathname === '/api/sessions') {
        const body = await readJsonBody(request);
        const session = await sessionStore.createSession({
          name: body.name,
          rootPath: body.rootPath,
        });
        writeJson(response, 201, { session });
        return;
      }

      if (request.method === 'GET' && pathname.startsWith('/api/sessions/')) {
        const sessionId = pathname.slice('/api/sessions/'.length);
        const session = sessionStore.getSession(sessionId);
        if (!session) {
          writeJson(response, 404, { error: `Unknown session: ${sessionId}` });
          return;
        }
        writeJson(response, 200, { session });
        return;
      }

      if (request.method === 'PATCH' && pathname.startsWith('/api/sessions/')) {
        const sessionId = pathname.slice('/api/sessions/'.length);
        const body = await readJsonBody(request);
        const session = await sessionStore.updateSession(sessionId, {
          name: body.name,
          rootPath: body.rootPath,
        });
        writeJson(response, 200, { session });
        return;
      }

      if (request.method === 'DELETE' && pathname.startsWith('/api/sessions/')) {
        const sessionId = pathname.slice('/api/sessions/'.length);
        const result = sessionStore.deleteSession(sessionId);
        writeJson(response, 200, result);
        return;
      }

      if (request.method === 'GET' && pathname === '/api/files/list') {
        const sessionId = searchParams.get('sessionId') || '';
        const relativePath = searchParams.get('path') || '.';
        const result = await sessionStore.listFiles(sessionId, relativePath);
        writeJson(response, 200, result);
        return;
      }

      if (request.method === 'GET' && pathname === '/api/files/read') {
        const sessionId = searchParams.get('sessionId') || '';
        const relativePath = searchParams.get('path') || '';
        const result = await sessionStore.readFile(sessionId, relativePath);
        writeJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && pathname === '/api/files/write') {
        const body = await readJsonBody(request);
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
        const relativePath = typeof body.path === 'string' ? body.path : '';
        const content = typeof body.content === 'string' ? body.content : '';
        const result = await sessionStore.writeFile(sessionId, relativePath, content);
        writeJson(response, 200, result);
        return;
      }

      if (request.method === 'GET' && pathname === '/api/hostfs/list') {
        const targetPath = searchParams.get('path') || '/';
        const result = await listHostDirectory(targetPath);
        writeJson(response, 200, result);
        return;
      }

      if (request.method === 'GET' && pathname === '/api/git/status') {
        const sessionId = searchParams.get('sessionId') || '';
        const sessionRoot = sessionStore.resolveSessionPath(sessionId, '.');
        writeJson(response, 200, readGitStatus(sessionRoot));
        return;
      }

      if (request.method === 'GET' && pathname === '/api/runtime/status') {
        writeJson(response, 200, runtimeStore.status());
        return;
      }

      if (request.method === 'GET' && pathname === '/api/build/status') {
        writeJson(response, 200, buildStore.status());
        return;
      }

      if (request.method === 'POST' && pathname === '/api/runtime/start') {
        const body = await readJsonBody(request);
        const status = runtimeStore.startRuntime({
          scene: typeof body.scene === 'string' && body.scene.trim() ? body.scene.trim() : 'sandbox',
        });
        writeJson(response, 200, status);
        return;
      }

      if (request.method === 'POST' && pathname === '/api/build/runtime') {
        const body = await readJsonBody(request);
        const status = buildStore.startBuild({
          target: 'runtime',
          config: typeof body.config === 'string' && body.config.trim() ? body.config.trim() : 'Debug',
          buildDir: typeof body.buildDir === 'string' && body.buildDir.trim() ? body.buildDir.trim() : undefined,
        });
        writeJson(response, 200, status);
        return;
      }

      if (request.method === 'POST' && pathname === '/api/git/init') {
        const body = await readJsonBody(request);
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
        const sessionRoot = sessionStore.resolveSessionPath(sessionId, '.');
        writeJson(response, 200, initGitRepository(sessionRoot));
        return;
      }

      if (request.method === 'POST' && pathname === '/api/runtime/stop') {
        const status = await runtimeStore.stopRuntime();
        writeJson(response, 200, status);
        return;
      }

      if (request.method === 'POST' && pathname === '/api/runtime/pause') {
        const status = runtimeStore.pauseRuntime();
        writeJson(response, 200, status);
        return;
      }

      if (request.method === 'POST' && pathname === '/api/runtime/resume') {
        const status = runtimeStore.resumeRuntime();
        writeJson(response, 200, status);
        return;
      }

      if (request.method === 'POST' && pathname === '/api/build/stop') {
        const status = await buildStore.stopBuild();
        writeJson(response, 200, status);
        return;
      }

      if (request.method === 'POST' && pathname === '/api/runtime/restart') {
        const body = await readJsonBody(request);
        const status = await runtimeStore.restartRuntime({
          scene: typeof body.scene === 'string' && body.scene.trim() ? body.scene.trim() : 'sandbox',
        });
        writeJson(response, 200, status);
        return;
      }

      if (request.method === 'POST' && pathname === '/api/terminals') {
        const body = await readJsonBody(request);
        const cwd = resolveTerminalCwd({
          sessionStore,
          sessionId: typeof body.sessionId === 'string' ? body.sessionId : '',
          cwd: typeof body.cwd === 'string' ? body.cwd : '.',
        });
        const result = terminalStore.openTerminal({
          cwd,
          shell: body.shell,
          cols: body.cols,
          rows: body.rows,
        });
        writeJson(response, 201, result);
        return;
      }

      const inputMatch = request.method === 'POST' ? pathname.match(/^\/api\/terminals\/([^/]+)\/input$/) : null;
      if (inputMatch) {
        const terminalId = decodeURIComponent(inputMatch[1]);
        const body = await readJsonBody(request);
        terminalStore.writeInput(terminalId, body.input);
        writeJson(response, 200, { ok: true });
        return;
      }

      const resizeMatch = request.method === 'POST' ? pathname.match(/^\/api\/terminals\/([^/]+)\/resize$/) : null;
      if (resizeMatch) {
        const terminalId = decodeURIComponent(resizeMatch[1]);
        const body = await readJsonBody(request);
        const result = terminalStore.resizeTerminal(terminalId, {
          cols: body.cols,
          rows: body.rows,
        });
        writeJson(response, 200, result);
        return;
      }

      const deleteMatch = request.method === 'DELETE' ? pathname.match(/^\/api\/terminals\/([^/]+)$/) : null;
      if (deleteMatch) {
        const terminalId = decodeURIComponent(deleteMatch[1]);
        terminalStore.closeTerminal(terminalId);
        writeJson(response, 200, { ok: true });
        return;
      }

      writeJson(response, 404, {
        error: `No route for ${request.method} ${pathname}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeJson(response, 400, { error: message });
    }
  };
}

export async function startEngineSessiond({
  host = '127.0.0.1',
  port = 41741,
  sessionStore = new SessionStore(),
  runtimeLaunchFactory,
  buildLaunchFactory,
} = {}) {
  const eventHub = createEventHub();
  const terminalStore = new TerminalStore({
    emitEvent: (type, data) => {
      eventHub.emit(type, data);
    },
  });
  const runtimeStore = new RuntimeStore({
    emitEvent: (type, data) => {
      eventHub.emit(type, data);
    },
    launchFactory: runtimeLaunchFactory,
  });
  const buildStore = new BuildStore({
    emitEvent: (type, data) => {
      eventHub.emit(type, data);
    },
    launchFactory: buildLaunchFactory,
  });
  const server = http.createServer(createRouter({ sessionStore, terminalStore, runtimeStore, buildStore, eventHub }));

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve engine_sessiond address.');
  }

  return {
    host: address.address,
    port: address.port,
    baseUrl: `http://${address.address}:${address.port}`,
    sessionStore,
    terminalStore,
    runtimeStore,
    buildStore,
    close: async () => {
      await buildStore.close();
      await runtimeStore.close();
      terminalStore.closeAll();
      eventHub.closeAll();
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

async function runStandalone() {
  const host = process.env.SHADER_FORGE_SESSIOND_HOST?.trim() || '127.0.0.1';
  const port = Number.parseInt(process.env.SHADER_FORGE_SESSIOND_PORT?.trim() || '41741', 10);
  const service = await startEngineSessiond({ host, port });
  console.log(`engine_sessiond listening on ${service.baseUrl}`);

  const shutdown = async () => {
    await service.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStandalone().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
