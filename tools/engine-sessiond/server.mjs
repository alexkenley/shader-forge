import http from 'node:http';
import { URL, pathToFileURL } from 'node:url';
import { SessionStore } from './lib/session-store.mjs';

function jsonHeaders(statusCode = 200) {
  return {
    statusCode,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Content-Type': 'application/json; charset=utf-8',
    },
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

function createRouter({ sessionStore }) {
  return async function route(request, response) {
    if (!request.url) {
      writeJson(response, 400, { error: 'Request URL is required.' });
      return;
    }

    if (request.method === 'OPTIONS') {
      const { headers } = jsonHeaders(204);
      response.writeHead(204, headers);
      response.end();
      return;
    }

    const requestUrl = new URL(request.url, 'http://127.0.0.1');
    const { pathname, searchParams } = requestUrl;

    try {
      if (request.method === 'GET' && pathname === '/health') {
        writeJson(response, 200, {
          ok: true,
          service: 'engine_sessiond',
          now: new Date().toISOString(),
          capabilities: ['sessions', 'files:list', 'files:read'],
        });
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
} = {}) {
  const server = http.createServer(createRouter({ sessionStore }));

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
    close: async () => {
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
