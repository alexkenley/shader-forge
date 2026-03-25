import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bakeAssetPipeline } from './lib/asset-pipeline.mjs';
import { createMigrationRun, summarizeMigrationReport } from './lib/migration-foundation.mjs';
import { startEngineSessiond } from '../engine-sessiond/server.mjs';
import {
  codeTrustDefaultTargetPath,
  evaluateCodeTrustAction,
  inspectCodeTrustState,
} from '../shared/code-trust-policy.mjs';
import { requireCMakeCommand } from '../shared/cmake-command.mjs';

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
  engine policy inspect [--root <path>]
  engine policy check <action> [path] [--root <path>] [--actor human|assistant|automation] [--origin <tier>]
  engine policy approvals [--session <id>] [--state pending|all] [--base-url <url>]
  engine policy approve <approval-id> [--base-url <url>] [--decision-by <name>]
  engine policy deny <approval-id> [--base-url <url>] [--decision-by <name>]
  engine build [runtime] [--config Debug] [--build-dir build/runtime]
  engine run [scene] [--config Debug] [--build-dir build/runtime] [--input-root input] [--content-root content] [--audio-root audio] [--animation-root animation] [--physics-root physics] [--data-foundation data/foundation/engine-data-layout.toml] [--save-root saved/runtime] [--tooling-layout tooling/layouts/default.tooling-layout.toml] [--tooling-layout-save tooling/layouts/runtime-session.tooling-layout.toml]
  engine bake [--content-root content] [--audio-root audio] [--animation-root animation] [--physics-root physics] [--data-foundation data/foundation/engine-data-layout.toml] [--output-root build/cooked] [--report build/cooked/asset-pipeline-report.json]
  engine migrate detect <path> [--output-root migration] [--run-id detect-unity]
  engine migrate unity <path> [--output-root migration] [--run-id unity-project]
  engine migrate unreal <path> [--output-root migration] [--run-id unreal-project]
  engine migrate godot <path> [--output-root migration] [--run-id godot-project]
  engine migrate report <path>

Reserved commands:
  engine test
  engine import
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
  const target = new URL(pathname, baseUrl);
  const requestBody = options.body ? JSON.stringify(options.body) : '';
  const transport = target.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request({
      method: options.method || 'GET',
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      headers: requestBody
        ? {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(requestBody),
          }
        : undefined,
    }, (response) => {
      let rawBody = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        rawBody += chunk;
      });
      response.on('end', () => {
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

    req.on('error', reject);
    if (requestBody) {
      req.write(requestBody);
    }
    req.end();
  });
}

function resolvedBaseUrl(flags) {
  return String(flags['base-url'] || DEFAULT_BASE_URL);
}

function resolvePolicyRoot(flags) {
  const requestedRoot = flags.root ? String(flags.root) : process.cwd();
  return path.isAbsolute(requestedRoot) ? requestedRoot : path.resolve(process.cwd(), requestedRoot);
}

async function runReservedPlaceholder(commandName) {
  console.log(`engine ${commandName} is not implemented yet in this slice.`);
  console.log('Current implemented surfaces: sessiond, files, runtime build, runtime run, asset bake, and migration detection/report foundations.');
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
  const cmakeCommand = requireCMakeCommand('runtime build');
  const buildDir = resolveBuildDirectory(flags);
  const config = normalizeBuildConfig(flags);
  const generator = process.env.CMAKE_GENERATOR?.trim() || '';
  const toolchainFile = process.env.CMAKE_TOOLCHAIN_FILE?.trim() || '';
  const configureArgs = ['-S', repoRoot, '-B', buildDir, `-DCMAKE_BUILD_TYPE=${config}`, '-DSHADER_FORGE_BUILD_RUNTIME=ON'];

  if (generator) {
    configureArgs.push('-G', generator);
  }

  if (toolchainFile) {
    configureArgs.push(`-DCMAKE_TOOLCHAIN_FILE=${toolchainFile}`);
  }

  await runCommand(cmakeCommand, configureArgs);
  await runCommand(cmakeCommand, ['--build', buildDir, '--config', config, '--target', 'shader_forge_runtime']);

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
  if (flags['input-root']) {
    args.push('--input-root', String(flags['input-root']));
  }
  if (flags['content-root']) {
    args.push('--content-root', String(flags['content-root']));
  }
  if (flags['audio-root']) {
    args.push('--audio-root', String(flags['audio-root']));
  }
  if (flags['animation-root']) {
    args.push('--animation-root', String(flags['animation-root']));
  }
  if (flags['physics-root']) {
    args.push('--physics-root', String(flags['physics-root']));
  }
  if (flags['data-foundation']) {
    args.push('--data-foundation', String(flags['data-foundation']));
  }
  if (flags['save-root']) {
    args.push('--save-root', String(flags['save-root']));
  }
  if (flags['tooling-layout']) {
    args.push('--tooling-layout', String(flags['tooling-layout']));
  }
  if (flags['tooling-layout-save']) {
    args.push('--tooling-layout-save', String(flags['tooling-layout-save']));
  }
  await runCommand(buildResult.binaryPath, args, { cwd: repoRoot });
}

async function bakeAssets(flags) {
  const report = await bakeAssetPipeline({
    repoRoot,
    contentRoot: String(flags['content-root'] || 'content'),
    audioRoot: String(flags['audio-root'] || 'audio'),
    animationRoot: String(flags['animation-root'] || 'animation'),
    physicsRoot: String(flags['physics-root'] || 'physics'),
    foundationPath: String(flags['data-foundation'] || 'data/foundation/engine-data-layout.toml'),
    outputRoot: String(flags['output-root'] || 'build/cooked'),
    reportPath: String(flags.report || path.join(String(flags['output-root'] || 'build/cooked'), 'asset-pipeline-report.json')),
  });

  console.log('Asset pipeline bake complete.');
  console.log(`- Content root: ${report.contentRoot}`);
  console.log(`- Audio root: ${report.audioRoot}`);
  console.log(`- Animation root: ${report.animationRoot}`);
  console.log(`- Physics root: ${report.physicsRoot}`);
  console.log(`- Output root: ${report.outputRoot}`);
  console.log(`- Baked assets: ${report.bakedAssets.length}`);
  console.log(`- Baked audio sounds: ${report.audio.bakedSounds.length}`);
  console.log(`- Baked audio events: ${report.audio.bakedEvents.length}`);
  console.log(`- Baked animation clips: ${report.animation.bakedClips.length}`);
  console.log(`- Baked animation graphs: ${report.animation.bakedGraphs.length}`);
  console.log(`- Baked physics bodies: ${report.physics.bakedBodies.length}`);
  console.log(`- Generated meshes: ${report.generatedMeshes.length}`);
  console.log(`- Report: ${path.isAbsolute(String(flags.report || '')) ? String(flags.report) : String(flags.report || path.join(report.outputRoot, 'asset-pipeline-report.json'))}`);
}

async function runMigration(commandName, positionals, flags) {
  if (commandName === 'report') {
    const targetPath = positionals[0];
    if (!targetPath) {
      throw new Error('engine migrate report requires a report.toml path or migration run directory.');
    }
    const summary = summarizeMigrationReport(path.isAbsolute(targetPath) ? targetPath : path.join(repoRoot, targetPath));
    for (const line of summary.lines) {
      console.log(line);
    }
    return;
  }

  const projectPath = positionals[0];
  if (!projectPath) {
    throw new Error(`engine migrate ${commandName} requires a source project path.`);
  }

  const requestedEngine = ['unity', 'unreal', 'godot'].includes(commandName) ? commandName : '';
  const result = await createMigrationRun({
    repoRoot,
    commandName,
    requestedEngine,
    projectPath,
    outputRoot: String(flags['output-root'] || 'migration'),
    runId: flags['run-id'] ? String(flags['run-id']) : '',
  });

  console.log(result.generatedProjectSkeleton
    ? 'Migration conversion run complete.'
    : 'Migration foundation run complete.');
  console.log(`- Source engine: ${result.detection.engine}`);
  console.log(`- Requested lane: ${result.requestedEngine || 'auto-detect'}`);
  console.log(`- Active lane: ${result.migrationLane.active}`);
  console.log(`- Conversion confidence: ${result.migrationLane.conversionConfidence}`);
  if (result.migrationLane.preferred && result.migrationLane.preferred !== result.migrationLane.active) {
    console.log(`- Preferred lane: ${result.migrationLane.preferred}`);
  }
  if (result.migrationLane.exporterManifest) {
    console.log(`- Exporter manifest: ${result.migrationLane.exporterManifest}`);
  }
  console.log(`- Source root: ${path.isAbsolute(projectPath) ? projectPath : String(projectPath)}`);
  console.log(`- Report root: ${result.reportRoot}`);
  if (result.targetProjectRoot) {
    console.log(`- Target project root: ${result.targetProjectRoot}`);
    console.log(`- Converted items: ${result.convertedItems}`);
    console.log(`- Approximated items: ${result.approximatedItems}`);
    console.log(`- Script manifests: ${result.conversionOutputs.scriptManifestFiles.length}`);
  }
  console.log(`- Manifest: ${result.manifestPath}`);
  console.log(`- Report: ${result.reportPath}`);
  console.log(`- Warnings file: ${result.warningsPath}`);
  console.log(`- Script porting placeholder: ${result.scriptPortingReadmePath}`);
  console.log(`- Manual tasks: ${result.manualTasks.length}`);
  if (result.migrationLane.fallbackReason) {
    console.log(`- Fallback: ${result.migrationLane.fallbackReason}`);
  }
  console.log(result.generatedProjectSkeleton
    ? '- A first-pass Shader Forge project skeleton was generated in this slice.'
    : '- No content conversion was performed in this slice.');
}

async function inspectPolicy(flags) {
  const summary = await inspectCodeTrustState(resolvePolicyRoot(flags));
  console.log(JSON.stringify(summary, null, 2));
}

async function checkPolicy(positionals, flags) {
  const action = positionals[0];
  if (!action) {
    throw new Error('engine policy check requires an action.');
  }

  const relativePath = positionals[1] || codeTrustDefaultTargetPath(action);
  const evaluation = await evaluateCodeTrustAction({
    rootPath: resolvePolicyRoot(flags),
    action,
    relativePath,
    actor: flags.actor ? String(flags.actor) : 'human',
    origin: flags.origin ? String(flags.origin) : '',
  });
  console.log(JSON.stringify(evaluation, null, 2));
}

async function listPolicyApprovals(flags) {
  const baseUrl = resolvedBaseUrl(flags);
  const query = new URL('/api/code-trust/approvals', baseUrl);
  if (flags.session) {
    query.searchParams.set('sessionId', String(flags.session));
  }
  query.searchParams.set('state', String(flags.state || 'pending'));
  const payload = await requestJson(baseUrl, query.pathname + query.search);
  console.log(JSON.stringify(payload.approvals, null, 2));
}

async function decidePolicyApproval(positionals, flags, decision) {
  const approvalId = positionals[0];
  if (!approvalId) {
    throw new Error(`engine policy ${decision === 'approved' ? 'approve' : 'deny'} requires an approval id.`);
  }
  const baseUrl = resolvedBaseUrl(flags);
  const payload = await requestJson(
    baseUrl,
    `/api/code-trust/approvals/${encodeURIComponent(approvalId)}/decision`,
    {
      method: 'POST',
      body: {
        decision,
        decisionBy: flags['decision-by'] ? String(flags['decision-by']) : 'human',
      },
    },
  );
  console.log(JSON.stringify(payload, null, 2));
}

async function run() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return;
  }

  const command = argv[0];

  if (['test', 'import'].includes(command)) {
    await runReservedPlaceholder(command);
    return;
  }

  if (command === 'bake') {
    const { flags } = parseFlags(argv.slice(1));
    await bakeAssets(flags);
    return;
  }

  if (command === 'migrate') {
    const migrationCommand = argv[1];
    const { positionals, flags } = parseFlags(argv.slice(2));
    if (!migrationCommand) {
      throw new Error('engine migrate requires a subcommand.');
    }
    if (!['detect', 'unity', 'unreal', 'godot', 'report'].includes(migrationCommand)) {
      throw new Error(`Unknown migrate subcommand: ${migrationCommand}`);
    }
    await runMigration(migrationCommand, positionals, flags);
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

  if (command === 'policy') {
    if (!subcommand) {
      throw new Error('engine policy requires a subcommand.');
    }
    if (subcommand === 'inspect') {
      await inspectPolicy(flags);
      return;
    }
    if (subcommand === 'check') {
      await checkPolicy(positionals, flags);
      return;
    }
    if (subcommand === 'approvals') {
      await listPolicyApprovals(flags);
      return;
    }
    if (subcommand === 'approve') {
      await decidePolicyApproval(positionals, flags, 'approved');
      return;
    }
    if (subcommand === 'deny') {
      await decidePolicyApproval(positionals, flags, 'denied');
      return;
    }
    throw new Error(`Unknown policy subcommand: ${subcommand}`);
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

function exitAfterFlush(code) {
  const streams = [process.stdout, process.stderr];
  let remaining = streams.length;

  const finish = () => {
    remaining -= 1;
    if (remaining === 0) {
      process.exit(code);
    }
  };

  for (const stream of streams) {
    stream.write('', finish);
  }
}

run()
  .then(() => {
    exitAfterFlush(0);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    exitAfterFlush(1);
  });
