import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startEngineSessiond } from '../engine-sessiond/server.mjs';

const DEFAULT_BASE_URL = process.env.SHADER_FORGE_SESSIOND_URL?.trim() || 'http://127.0.0.1:41741';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const defaultRuntimeBuildDir = path.join(repoRoot, 'build', 'runtime');
const runtimeBinaryName = process.platform === 'win32' ? 'shader_forge_runtime.exe' : 'shader_forge_runtime';

function printHelp() {
  console.log(`Shader Forge CLI

Usage:
  engine sessiond start [--host 127.0.0.1] [--port 41741]
  engine session create [--root <path>] [--name <name>] [--base-url <url>]
  engine session list [--base-url <url>]
  engine file list <path> --session <id> [--base-url <url>]
  engine file read <path> --session <id> [--base-url <url>]
  engine build [runtime] [--config Debug] [--build-dir build/runtime]
  engine run [scene] [--config Debug] [--build-dir build/runtime]

Reserved commands:
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
  console.log(`engine ${commandName} is not implemented yet in this slice.`);
  console.log('Current implemented surfaces: sessiond, files, runtime build, and runtime run.');
}

function commandExists(command) {
  const result = spawnSync(command, ['--version'], { encoding: 'utf8' });
  return result.status === 0;
}

function requireCommand(command, guidance) {
  if (commandExists(command)) {
    return;
  }
  throw new Error(guidance);
}

function normalizeBuildConfig(flags) {
  return String(flags.config || 'Debug');
}

function resolveBuildDirectory(flags) {
  const requested = String(flags['build-dir'] || defaultRuntimeBuildDir);
  return path.isAbsolute(requested) ? requested : path.join(repoRoot, requested);
}

function runtimeBinaryPath(buildDir) {
  return path.join(buildDir, 'bin', runtimeBinaryName);
}

async function runCommand(command, args, options = {}) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || repoRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        ...(options.env || {}),
      },
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }
      reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? 'unknown'}.`));
    });
    child.on('error', reject);
  });
}

async function buildRuntime(flags) {
  requireCommand('cmake', 'cmake is required for runtime build. Install cmake to use `engine build` or `engine run`.');

  const buildDir = resolveBuildDirectory(flags);
  const config = normalizeBuildConfig(flags);
  const generator = process.env.CMAKE_GENERATOR?.trim() || '';
  const configureArgs = ['-S', repoRoot, '-B', buildDir, `-DCMAKE_BUILD_TYPE=${config}`, '-DSHADER_FORGE_BUILD_RUNTIME=ON'];

  if (generator) {
    configureArgs.push('-G', generator);
  }

  await runCommand('cmake', configureArgs);
  await runCommand('cmake', ['--build', buildDir, '--config', config, '--target', 'shader_forge_runtime']);

  return {
    buildDir,
    config,
    binaryPath: runtimeBinaryPath(buildDir),
  };
}

async function runRuntime(sceneName, flags) {
  const buildResult = await buildRuntime(flags);
  if (!fs.existsSync(buildResult.binaryPath)) {
    throw new Error(`Runtime binary was not produced at ${buildResult.binaryPath}`);
  }

  const args = ['--scene', sceneName || 'sandbox'];
  await runCommand(buildResult.binaryPath, args, { cwd: repoRoot });
}

async function run() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return;
  }

  const command = argv[0];

  if (['test', 'import', 'bake'].includes(command)) {
    await runReservedPlaceholder(command);
    return;
  }

  if (command === 'build') {
    const { positionals, flags } = parseFlags(argv.slice(1));
    const buildTarget = positionals[0] || 'runtime';
    if (buildTarget !== 'runtime') {
      throw new Error(`Unknown build target: ${buildTarget}`);
    }
    await buildRuntime(flags);
    return;
  }

  if (command === 'run') {
    const { positionals, flags } = parseFlags(argv.slice(1));
    const sceneName = positionals[0] || 'sandbox';
    await runRuntime(sceneName, flags);
    return;
  }

  const subcommand = argv[1];
  const { positionals, flags } = parseFlags(argv.slice(2));

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
