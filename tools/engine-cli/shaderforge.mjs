import process from 'node:process';
import { startEngineSessiond } from '../engine-sessiond/server.mjs';

const DEFAULT_BASE_URL = process.env.SHADER_FORGE_SESSIOND_URL?.trim() || 'http://127.0.0.1:41741';

function printHelp() {
  console.log(`Shader Forge CLI

Usage:
  engine sessiond start [--host 127.0.0.1] [--port 41741]
  engine session create [--root <path>] [--name <name>] [--base-url <url>]
  engine session list [--base-url <url>]
  engine file list <path> --session <id> [--base-url <url>]
  engine file read <path> --session <id> [--base-url <url>]

Reserved commands:
  engine run
  engine build
  engine test
  engine import
  engine bake
`);
}

function parseFlags(tokens) {
  const positionals = [];
  const flags = {};

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2);
    const nextValue = tokens[index + 1];
    if (!nextValue || nextValue.startsWith('--')) {
      flags[key] = true;
      continue;
    }

    flags[key] = nextValue;
    index += 1;
  }

  return { positionals, flags };
}

async function requestJson(baseUrl, pathname, options = {}) {
  const response = await fetch(new URL(pathname, baseUrl), {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with status ${response.status}`);
  }
  return payload;
}

function resolvedBaseUrl(flags) {
  return String(flags['base-url'] || DEFAULT_BASE_URL);
}

async function runReservedPlaceholder(commandName) {
  console.log(`engine ${commandName} is not implemented yet in this Phase 2 slice.`);
  console.log('Current implemented surfaces: sessiond start, session create/list, file list/read.');
}

async function run() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return;
  }

  const command = argv[0];
  const subcommand = argv[1];
  const { positionals, flags } = parseFlags(argv.slice(2));

  if (['run', 'build', 'test', 'import', 'bake'].includes(command)) {
    await runReservedPlaceholder(command);
    return;
  }

  if (command === 'sessiond' && subcommand === 'start') {
    const host = String(flags.host || '127.0.0.1');
    const port = Number.parseInt(String(flags.port || '41741'), 10);
    const service = await startEngineSessiond({ host, port });
    console.log(`engine_sessiond listening on ${service.baseUrl}`);
    process.on('SIGINT', async () => {
      await service.close();
      process.exit(0);
    });
    process.on('SIGTERM', async () => {
      await service.close();
      process.exit(0);
    });
    await new Promise(() => {});
    return;
  }

  if (command === 'session' && subcommand === 'create') {
    const baseUrl = resolvedBaseUrl(flags);
    const payload = await requestJson(baseUrl, '/api/sessions', {
      method: 'POST',
      body: {
        name: flags.name ? String(flags.name) : '',
        rootPath: flags.root ? String(flags.root) : process.cwd(),
      },
    });
    console.log(JSON.stringify(payload.session, null, 2));
    return;
  }

  if (command === 'session' && subcommand === 'list') {
    const baseUrl = resolvedBaseUrl(flags);
    const payload = await requestJson(baseUrl, '/api/sessions');
    console.log(JSON.stringify(payload.sessions, null, 2));
    return;
  }

  if (command === 'file' && subcommand === 'list') {
    const targetPath = positionals[0] || '.';
    const sessionId = String(flags.session || '');
    if (!sessionId) {
      throw new Error('file list requires --session <id>.');
    }
    const baseUrl = resolvedBaseUrl(flags);
    const query = new URL('/api/files/list', baseUrl);
    query.searchParams.set('sessionId', sessionId);
    query.searchParams.set('path', targetPath);
    const payload = await requestJson(baseUrl, query.pathname + query.search);
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (command === 'file' && subcommand === 'read') {
    const targetPath = positionals[0];
    const sessionId = String(flags.session || '');
    if (!targetPath) {
      throw new Error('file read requires a target path.');
    }
    if (!sessionId) {
      throw new Error('file read requires --session <id>.');
    }
    const baseUrl = resolvedBaseUrl(flags);
    const query = new URL('/api/files/read', baseUrl);
    query.searchParams.set('sessionId', sessionId);
    query.searchParams.set('path', targetPath);
    const payload = await requestJson(baseUrl, query.pathname + query.search);
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  throw new Error(`Unknown command: ${argv.join(' ')}`);
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
