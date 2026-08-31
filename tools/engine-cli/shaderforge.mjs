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
  listCodeTrustArtifacts,
} from '../shared/code-trust-policy.mjs';
import {
  inspectAiProviders,
  testAiProvider,
} from '../shared/engine-ai-service.mjs';
import {
  inspectPackagingPreset,
  packageProjectRelease,
} from '../shared/engine-packaging-service.mjs';
import {
  captureProfilingSnapshot,
  inspectProfilingState,
  listProfilingCaptures,
} from '../shared/engine-profiling-service.mjs';
import { requireCMakeCommand } from '../shared/cmake-command.mjs';
import { readGitStatus } from '../engine-sessiond/lib/git-service.mjs';

const DEFAULT_BASE_URL = process.env.SHADER_FORGE_SESSIOND_URL?.trim() || 'http://127.0.0.1:41741';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const defaultRuntimeBuildDir = path.join(repoRoot, 'build', 'runtime');
const runtimeBinaryName = process.platform === 'win32' ? 'shader_forge_runtime.exe' : 'shader_forge_runtime';
const spatialBinaryName = process.platform === 'win32' ? 'shader_forge_spatial.exe' : 'shader_forge_spatial';
const dataBinaryName = process.platform === 'win32' ? 'shader_forge_data.exe' : 'shader_forge_data';

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
  engine policy artifacts [--root <path>]
  engine policy approvals [--session <id>] [--state pending|all] [--base-url <url>]
  engine policy approve <approval-id> [--base-url <url>] [--decision-by <name>]
  engine policy deny <approval-id> [--base-url <url>] [--decision-by <name>]
  engine policy promote <path> [--session <id>] [--root <path>] [--base-url <url>] [--decision-by <name>] [--note <text>]
  engine policy quarantine <path> [--session <id>] [--root <path>] [--base-url <url>] [--decision-by <name>] [--note <text>]
  engine ai providers [--root <path>]
  engine ai test [--root <path>] [--provider <id>] [--prompt <text>] [--system <text>]
  engine ai request <prompt> [--root <path>] [--provider <id>] [--system <text>]
  engine ai submit <prompt> [--session <id>] [--provider <id>] [--system <text>] [--base-url <url>]
  engine ai jobs [--session <id>] [--status queued|running|completed|failed|cancelled|all] [--base-url <url>]
  engine ai usage [--session <id>] [--base-url <url>]
  engine ai status <job-id> [--base-url <url>]
  engine ai cancel <job-id> [--base-url <url>]
  engine export inspect [--root <path>] [--preset <id>] [--package-root <path>]
  engine package [--root <path>] [--preset <id>] [--package-root <path>] [--skip-bake] [--force-bake]
  engine profile list [--root <path>] [--session <id>] [--base-url <url>] [--limit <count>]
  engine profile live [--root <path>] [--preset <id>] [--session <id>] [--base-url <url>]
  engine profile capture [--root <path>] [--preset <id>] [--session <id>] [--base-url <url>] [--label <name>] [--output <path>]
  engine build [runtime|spatial|data] [--config Debug] [--build-dir build/runtime]
  engine run [scene] [--config Debug] [--build-dir build/runtime] [--input-root input] [--content-root content] [--audio-root audio] [--animation-root animation] [--physics-root physics] [--data-foundation data/foundation/engine-data-layout.toml] [--save-root saved/runtime] [--tooling-layout tooling/layouts/default.tooling-layout.toml] [--tooling-layout-save tooling/layouts/runtime-session.tooling-layout.toml]
  engine spatial validate [--animation-root animation] [--build-dir build/runtime] [--config Debug]
  engine spatial cook [--animation-root animation] [--output-root build/cooked] [--build-dir build/runtime] [--config Debug]
  engine spatial evaluate-rest --attachment <id> [--animation-root animation] [--content-root content] [--data-foundation data/foundation/engine-data-layout.toml] [--build-dir build/runtime] [--config Debug]
  engine spatial evaluate-sample --attachment <id> --phase <phase> --normalized-time <value> [--animation-root animation] [--content-root content] [--data-foundation data/foundation/engine-data-layout.toml] [--build-dir build/runtime] [--config Debug]
  engine spatial preview --session <id> --path animation/attachments/<file>.attachment.toml --content-file <path> --base-revision <sha256:...|missing> --label <text> --agent <id> --lease <id> [--base-url <url>]
  engine spatial approve <operation-id> [--base-url <url>]
  engine spatial reject <operation-id> [--base-url <url>]
  engine spatial validate-operation <operation-id> --samples-file <path> [--base-url <url>]
  engine spatial review reserve <operation-id> --session <id> --agent <id> [--base-url <url>]
  engine spatial review read <review-id> --session <id> [--base-url <url>]
  engine spatial recapture <operation-id> --review-id <id> --agent <id> --source-lease <id> --capture-lease <id> --review-lease <id> --phases <a,b> --cameras <a,b> --width <px> --height <px> [--player-camera-scene <id> --player-camera-prefab <id>] [--base-url <url>]
  engine spatial apply <operation-id> --agent <id> --lease <id> [--base-url <url>]
  engine spatial undo <operation-id> --agent <id> --lease <id> [--base-url <url>]
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
  const duplicateFlags = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const key = token.slice(2);
    if (Object.hasOwn(flags, key)) {
      duplicateFlags.push(key);
    }
    const nextValue = tokens[index + 1];
    if (!nextValue || nextValue.startsWith('--')) {
      flags[key] = true;
      continue;
    }

    flags[key] = nextValue;
    index += 1;
  }

  return { positionals, flags, duplicateFlags };
}

async function requestJson(baseUrl, pathname, options = {}) {
  const target = new URL(pathname, baseUrl);
  const requestBody = options.body !== undefined ? JSON.stringify(options.body) : '';
  const transport = target.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = transport.request({
      method: options.method || 'GET',
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      headers: {
        ...(requestBody
          ? {
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(requestBody),
            }
          : {}),
        ...(options.headers || {}),
      },
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
          const details = [payload.code, payload.error, payload.diagnostic]
            .filter((value, index, values) => typeof value === 'string' && value.trim() && values.indexOf(value) === index)
            .join(': ') || `Request failed with status ${response.statusCode || 0}`;
          const redacted = (options.redact || []).reduce(
            (message, secret) => secret ? message.replaceAll(secret, '[redacted]') : message,
            details,
          );
          reject(new Error(redacted));
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
  console.log('Current implemented surfaces: sessiond, files, AI inspection, code trust, export/package inspection, profiling snapshots, runtime build/run, asset bake, and migration detection/report foundations.');
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

function spatialBinaryPath(buildDir) {
  return path.join(buildDir, 'bin', spatialBinaryName);
}

function dataBinaryPath(buildDir) {
  return path.join(buildDir, 'bin', dataBinaryName);
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

async function buildNativeTarget(target, flags) {
  const cmakeCommand = requireCMakeCommand(`${target} build`);
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
  const binaryPath = target === 'runtime'
    ? runtimeBinaryPath(buildDir)
    : target === 'spatial'
      ? spatialBinaryPath(buildDir)
      : dataBinaryPath(buildDir);
  await runCommand(cmakeCommand, ['--build', buildDir, '--config', config, '--target', `shader_forge_${target}`]);
  if (target === 'runtime') {
    await runCommand(cmakeCommand, ['--build', buildDir, '--config', config, '--target', 'shader_forge_data']);
  }

  return {
    buildDir,
    config,
    binaryPath,
  };
}

async function runRuntime(sceneName, flags) {
  const buildResult = await buildNativeTarget('runtime', flags);
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

async function runSpatialCommand(subcommand, flags) {
  const buildDir = resolveBuildDirectory(flags);
  const binaryPath = spatialBinaryPath(buildDir);
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Spatial tool was not found at ${binaryPath}. Build it first with \`engine build spatial --build-dir ${buildDir}\`.`);
  }

  const requestedRoot = String(flags['animation-root'] || 'animation');
  const animationRoot = path.isAbsolute(requestedRoot)
    ? path.normalize(requestedRoot)
    : path.resolve(process.cwd(), requestedRoot);
  const args = [subcommand, '--animation-root', animationRoot];
  if (subcommand === 'cook') {
    const requestedOutputRoot = String(flags['output-root'] || path.join('build', 'cooked'));
    const outputRoot = path.isAbsolute(requestedOutputRoot)
      ? path.normalize(requestedOutputRoot)
      : path.resolve(process.cwd(), requestedOutputRoot);
    args.push('--output-root', outputRoot);
  }
  if (subcommand === 'evaluate-rest' || subcommand === 'evaluate-sample') {
    args.push('--attachment', String(flags.attachment));
    const requestedContentRoot = String(flags['content-root'] || 'content');
    const contentRoot = path.isAbsolute(requestedContentRoot)
      ? path.normalize(requestedContentRoot)
      : path.resolve(process.cwd(), requestedContentRoot);
    const requestedFoundationPath = String(
      flags['data-foundation'] || path.join('data', 'foundation', 'engine-data-layout.toml'),
    );
    const foundationPath = path.isAbsolute(requestedFoundationPath)
      ? path.normalize(requestedFoundationPath)
      : path.resolve(process.cwd(), requestedFoundationPath);
    args.push('--content-root', contentRoot, '--data-foundation', foundationPath);
  }
  if (subcommand === 'evaluate-sample') {
    args.push('--phase', String(flags.phase), '--normalized-time', String(flags['normalized-time']));
  }
  await runCommand(binaryPath, args, { cwd: repoRoot });
}

const spatialOperationActor = Object.freeze({
  kind: 'cli',
  id: 'engine-cli',
  name: 'Shader Forge CLI',
});

function requireSpatialAgentCredential(subcommand) {
  const credential = process.env.SHADER_FORGE_AGENT_CREDENTIAL?.trim() || '';
  if (!credential) {
    throw new Error(`engine spatial ${subcommand} requires SHADER_FORGE_AGENT_CREDENTIAL.`);
  }
  return credential;
}

function readStrictUtf8File(filePath, label = 'Spatial preview content file') {
  const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  try {
    const bytes = fs.readFileSync(resolvedPath);
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      throw new Error(`${label} must not begin with a UTF-8 BOM: ${resolvedPath}`);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(`${label} is not valid UTF-8: ${resolvedPath}`);
    }
    throw error;
  }
}

function readSpatialSamplesFile(filePath) {
  const resolvedPath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  const text = readStrictUtf8File(filePath, 'Spatial samples file');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Spatial samples file is not valid JSON: ${resolvedPath}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Spatial samples file must be a JSON array: ${resolvedPath}`);
  }
  return parsed;
}

function readCommaSeparatedFlag(value, flagName) {
  const values = String(value).split(',').map((entry) => entry.trim());
  if (values.some((entry) => !entry)) {
    throw new Error(`engine spatial recapture --${flagName} must be a comma-separated list without empty entries.`);
  }
  return values;
}

function readSpatialCaptureSize(value, flagName) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 64 || parsed > 1024) {
    throw new Error(`engine spatial recapture --${flagName} must be an integer in [64, 1024].`);
  }
  return parsed;
}

async function runSpatialOperation(subcommand, positionals, flags) {
  const baseUrl = resolvedBaseUrl(flags);
  if (subcommand === 'preview') {
    const credential = requireSpatialAgentCredential(subcommand);
    const payload = await requestJson(baseUrl, '/api/operations/spatial-attachment/preview', {
      method: 'POST',
      headers: { 'X-Shader-Forge-Agent-Credential': credential },
      redact: [credential],
      body: {
        sessionId: flags.session,
        path: flags.path,
        content: readStrictUtf8File(flags['content-file']),
        baseRevision: flags['base-revision'],
        label: flags.label,
        actor: spatialOperationActor,
        agentId: flags.agent,
        leaseId: flags.lease,
      },
    });
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const operationId = positionals[0].trim();
  if (subcommand === 'review-read') {
    const payload = await requestJson(
      baseUrl,
      `/api/spatial/reviews/${encodeURIComponent(operationId)}?sessionId=${encodeURIComponent(flags.session)}`,
    );
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  if (subcommand === 'review-reserve') {
    const credential = requireSpatialAgentCredential('review reserve');
    const payload = await requestJson(
      baseUrl,
      `/api/operations/${encodeURIComponent(operationId)}/review-reservations`,
      {
        method: 'POST',
        headers: { 'X-Shader-Forge-Agent-Credential': credential },
        redact: [credential],
        body: { sessionId: flags.session, agentId: flags.agent },
      },
    );
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  if (subcommand === 'validate-operation') {
    const payload = await requestJson(
      baseUrl,
      `/api/operations/${encodeURIComponent(operationId)}/validate`,
      {
        method: 'POST',
        body: {
          actor: spatialOperationActor,
          samples: readSpatialSamplesFile(flags['samples-file']),
        },
      },
    );
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  if (subcommand === 'recapture') {
    const credential = requireSpatialAgentCredential(subcommand);
    const payload = await requestJson(
      baseUrl,
      `/api/operations/${encodeURIComponent(operationId)}/recapture`,
      {
        method: 'POST',
        headers: { 'X-Shader-Forge-Agent-Credential': credential },
        redact: [credential],
        body: {
          actor: spatialOperationActor,
          agentId: flags.agent,
          reviewId: flags['review-id'],
          sourceLeaseId: flags['source-lease'],
          captureLeaseId: flags['capture-lease'],
          reviewLeaseId: flags['review-lease'],
          phases: readCommaSeparatedFlag(flags.phases, 'phases'),
          cameras: readCommaSeparatedFlag(flags.cameras, 'cameras'),
          widthPx: readSpatialCaptureSize(flags.width, 'width'),
          heightPx: readSpatialCaptureSize(flags.height, 'height'),
          ...(flags['player-camera-scene']
            ? { playerCameraScene: flags['player-camera-scene'] }
            : {}),
          ...(flags['player-camera-prefab']
            ? { playerCameraPrefab: flags['player-camera-prefab'] }
            : {}),
        },
      },
    );
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const credential = ['apply', 'undo'].includes(subcommand)
    ? requireSpatialAgentCredential(subcommand)
    : '';
  const payload = await requestJson(
    baseUrl,
    `/api/operations/${encodeURIComponent(operationId)}/${subcommand}`,
    {
      method: 'POST',
      ...(credential
        ? {
            headers: { 'X-Shader-Forge-Agent-Credential': credential },
            redact: [credential],
          }
        : {}),
      body: {
        actor: spatialOperationActor,
        ...(['apply', 'undo'].includes(subcommand)
          ? { agentId: flags.agent, leaseId: flags.lease }
          : {}),
      },
    },
  );
  console.log(JSON.stringify(payload, null, 2));
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
    console.log(`- Mapped scene entities: ${result.mappedSceneEntities}`);
    console.log(`- Mapped prefab components: ${result.mappedPrefabComponents}`);
    console.log(`- Mapped script bindings: ${result.mappedScriptBindings}`);
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

async function listPolicyArtifacts(flags) {
  const artifacts = await listCodeTrustArtifacts(resolvePolicyRoot(flags), {
    limit: 64,
  });
  console.log(JSON.stringify(artifacts, null, 2));
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

async function resolvePolicyMutationSessionId(flags) {
  if (flags.session) {
    return String(flags.session);
  }

  const payload = await requestJson(resolvedBaseUrl(flags), '/api/sessions', {
    method: 'POST',
    body: {
      name: path.basename(resolvePolicyRoot(flags)) || 'workspace',
      rootPath: resolvePolicyRoot(flags),
    },
  });
  const sessionId = payload.session?.id;
  if (!sessionId) {
    throw new Error('engine_sessiond did not return a session for the policy mutation.');
  }
  return sessionId;
}

async function transitionPolicyArtifact(positionals, flags, transition) {
  const relativePath = positionals.join(' ').trim();
  if (!relativePath) {
    throw new Error(`engine policy ${transition} requires an artifact path.`);
  }

  const baseUrl = resolvedBaseUrl(flags);
  const sessionId = await resolvePolicyMutationSessionId(flags);
  const payload = await requestJson(baseUrl, '/api/code-trust/artifacts/transition', {
    method: 'POST',
    body: {
      sessionId,
      path: relativePath,
      transition,
      decisionBy: flags['decision-by'] ? String(flags['decision-by']) : 'human',
      note: flags.note ? String(flags.note) : '',
    },
  });
  console.log(JSON.stringify(payload.artifact, null, 2));
}

async function inspectAiProviderState(flags) {
  const summary = await inspectAiProviders(resolvePolicyRoot(flags));
  console.log(JSON.stringify(summary, null, 2));
}

async function testAiProviderCommand(positionals, flags, mode = 'test') {
  const prompt = mode === 'request'
    ? positionals.join(' ').trim()
    : flags.prompt
      ? String(flags.prompt)
      : undefined;
  if (mode === 'request' && !prompt) {
    throw new Error('engine ai request requires a prompt.');
  }

  const result = await testAiProvider(resolvePolicyRoot(flags), {
    providerId: flags.provider ? String(flags.provider) : '',
    prompt,
    systemPrompt: flags.system ? String(flags.system) : undefined,
  });
  console.log(JSON.stringify(result, null, 2));
}

async function submitAiJob(positionals, flags) {
  const prompt = positionals.join(' ').trim();
  if (!prompt) {
    throw new Error('engine ai submit requires a prompt.');
  }
  const payload = await requestJson(resolvedBaseUrl(flags), '/api/ai/jobs', {
    method: 'POST',
    body: {
      sessionId: flags.session ? String(flags.session) : '',
      providerId: flags.provider ? String(flags.provider) : '',
      prompt,
      systemPrompt: flags.system ? String(flags.system) : undefined,
    },
  });
  console.log(JSON.stringify(payload.job, null, 2));
}

async function listAiJobs(flags) {
  const baseUrl = resolvedBaseUrl(flags);
  const query = new URL('/api/ai/jobs', baseUrl);
  if (flags.session) query.searchParams.set('sessionId', String(flags.session));
  if (flags.status) query.searchParams.set('status', String(flags.status));
  const payload = await requestJson(baseUrl, query.pathname + query.search);
  console.log(JSON.stringify(payload.jobs, null, 2));
}

async function readAiUsage(flags) {
  const baseUrl = resolvedBaseUrl(flags);
  const query = new URL('/api/ai/usage', baseUrl);
  if (flags.session) query.searchParams.set('sessionId', String(flags.session));
  const payload = await requestJson(baseUrl, query.pathname + query.search);
  console.log(JSON.stringify(payload, null, 2));
}

async function readOrCancelAiJob(positionals, flags, cancel = false) {
  const jobId = positionals[0]?.trim();
  if (!jobId || positionals.length !== 1) {
    throw new Error(`engine ai ${cancel ? 'cancel' : 'status'} requires exactly one job id.`);
  }
  const payload = await requestJson(
    resolvedBaseUrl(flags),
    `/api/ai/jobs/${encodeURIComponent(jobId)}`,
    cancel ? { method: 'DELETE' } : {},
  );
  console.log(JSON.stringify(payload.job, null, 2));
}

async function inspectExportPreset(flags) {
  const result = await inspectPackagingPreset(resolvePolicyRoot(flags), {
    presetId: flags.preset ? String(flags.preset) : 'default',
    ...(flags['package-root'] ? { packageRoot: String(flags['package-root']) } : {}),
  });
  console.log(JSON.stringify(result, null, 2));
}

async function runPackageCommand(flags) {
  const result = await packageProjectRelease(resolvePolicyRoot(flags), {
    presetId: flags.preset ? String(flags.preset) : 'default',
    ...(flags['package-root'] ? { packageRoot: String(flags['package-root']) } : {}),
    ...(flags['skip-bake'] ? { prepareCookedAssets: false } : {}),
    ...(flags['force-bake'] ? { forceBake: true } : {}),
  });
  console.log(JSON.stringify(result, null, 2));
}

function shouldUseProfileSessiond(flags) {
  return Boolean(flags.session || flags['base-url']);
}

function localProfileOptions(flags) {
  const rootPath = resolvePolicyRoot(flags);
  return {
    rootPath,
    sessionId: flags.session ? String(flags.session) : '',
    presetId: flags.preset ? String(flags.preset) : 'default',
    label: flags.label ? String(flags.label) : 'diagnostics',
    outputPath: flags.output ? String(flags.output) : '',
    gitStatus: readGitStatus(rootPath),
  };
}

async function runProfileLive(flags) {
  if (shouldUseProfileSessiond(flags)) {
    const baseUrl = resolvedBaseUrl(flags);
    const query = new URL('/api/profile/live', baseUrl);
    if (flags.session) {
      query.searchParams.set('sessionId', String(flags.session));
    }
    if (flags.preset) {
      query.searchParams.set('preset', String(flags.preset));
    }
    const result = await requestJson(baseUrl, query.pathname + query.search);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const result = await inspectProfilingState(localProfileOptions(flags));
  console.log(JSON.stringify(result, null, 2));
}

async function runProfileList(flags) {
  if (shouldUseProfileSessiond(flags)) {
    const baseUrl = resolvedBaseUrl(flags);
    const query = new URL('/api/profile/captures', baseUrl);
    if (flags.session) {
      query.searchParams.set('sessionId', String(flags.session));
    }
    if (flags.limit) {
      query.searchParams.set('limit', String(flags.limit));
    }
    const result = await requestJson(baseUrl, query.pathname + query.search);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const result = await listProfilingCaptures(resolvePolicyRoot(flags), {
    limit: flags.limit ? String(flags.limit) : '10',
  });
  console.log(JSON.stringify(result, null, 2));
}

async function runProfileCapture(flags) {
  if (shouldUseProfileSessiond(flags)) {
    const baseUrl = resolvedBaseUrl(flags);
    const result = await requestJson(baseUrl, '/api/profile/capture', {
      method: 'POST',
      body: {
        ...(flags.session ? { sessionId: String(flags.session) } : {}),
        ...(flags.preset ? { presetId: String(flags.preset) } : {}),
        ...(flags.label ? { label: String(flags.label) } : {}),
        ...(flags.output ? { outputPath: String(flags.output) } : {}),
      },
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const localOptions = localProfileOptions(flags);
  const result = await captureProfilingSnapshot({
    ...localOptions,
    ...(localOptions.outputPath ? { outputPath: localOptions.outputPath } : {}),
  });
  console.log(JSON.stringify(result, null, 2));
}

export async function runCli(argv = process.argv.slice(2)) {
  if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
    printHelp();
    return;
  }

  const command = argv[0];

  if (['test', 'import'].includes(command)) {
    await runReservedPlaceholder(command);
    return;
  }

  if (command === 'package') {
    const { flags } = parseFlags(argv.slice(1));
    await runPackageCommand(flags);
    return;
  }

  if (command === 'export') {
    const exportSubcommand = !argv[1] || argv[1].startsWith('--') ? 'inspect' : argv[1];
    const { flags } = parseFlags(argv.slice(exportSubcommand === argv[1] ? 2 : 1));
    if (exportSubcommand !== 'inspect') {
      throw new Error(`Unknown export subcommand: ${exportSubcommand}`);
    }
    await inspectExportPreset(flags);
    return;
  }

  if (command === 'profile') {
    const profileSubcommand = argv[1];
    const { flags } = parseFlags(argv.slice(2));
    if (!profileSubcommand) {
      throw new Error('engine profile requires a subcommand.');
    }
    if (profileSubcommand === 'list') {
      await runProfileList(flags);
      return;
    }
    if (profileSubcommand === 'live') {
      await runProfileLive(flags);
      return;
    }
    if (profileSubcommand === 'capture') {
      await runProfileCapture(flags);
      return;
    }
    throw new Error(`Unknown profile subcommand: ${profileSubcommand}`);
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
    if (!['runtime', 'spatial', 'data'].includes(buildTarget)) {
      throw new Error(`Unknown build target: ${buildTarget}`);
    }
    await buildNativeTarget(buildTarget, flags);
    return;
  }

  if (command === 'run') {
    const { positionals, flags } = parseFlags(argv.slice(1));
    const sceneName = positionals[0] || 'sandbox';
    await runRuntime(sceneName, flags);
    return;
  }

  if (command === 'spatial') {
    const requestedSpatialSubcommand = argv[1];
    const reviewAction = requestedSpatialSubcommand === 'review' ? argv[2] : '';
    const spatialSubcommand = reviewAction ? `review-${reviewAction}` : requestedSpatialSubcommand;
    const { positionals, flags, duplicateFlags } = parseFlags(argv.slice(reviewAction ? 3 : 2));
    const nativeSubcommands = ['validate', 'cook', 'evaluate-rest', 'evaluate-sample'];
    const operationSubcommands = [
      'preview', 'approve', 'reject', 'validate-operation', 'review-reserve', 'review-read',
      'recapture', 'apply', 'undo',
    ];
    if (![...nativeSubcommands, ...operationSubcommands].includes(spatialSubcommand)) {
      throw new Error(spatialSubcommand
        ? `Unknown spatial subcommand: ${spatialSubcommand}`
        : 'engine spatial requires a subcommand.');
    }
    if (duplicateFlags.length) {
      throw new Error(`Duplicate engine spatial ${spatialSubcommand} flag: --${duplicateFlags[0]}`);
    }
    const positionalCount = [
      'approve', 'reject', 'validate-operation', 'review-reserve', 'review-read',
      'recapture', 'apply', 'undo',
    ].includes(spatialSubcommand) ? 1 : 0;
    if (positionals.length !== positionalCount) {
      throw new Error(positionalCount === 0
        ? `engine spatial ${spatialSubcommand} does not accept positional arguments.`
        : `engine spatial ${spatialSubcommand} requires exactly one operation id.`);
    }
    if (positionalCount === 1 && !positionals[0].trim()) {
      throw new Error(`engine spatial ${spatialSubcommand} requires a non-empty operation id.`);
    }
    const flagsBySubcommand = {
      validate: ['animation-root', 'build-dir', 'config'],
      cook: ['animation-root', 'output-root', 'build-dir', 'config'],
      'evaluate-rest': ['attachment', 'animation-root', 'content-root', 'data-foundation', 'build-dir', 'config'],
      'evaluate-sample': ['attachment', 'phase', 'normalized-time', 'animation-root', 'content-root', 'data-foundation', 'build-dir', 'config'],
      preview: ['session', 'path', 'content-file', 'base-revision', 'label', 'agent', 'lease', 'base-url'],
      approve: ['base-url'],
      reject: ['base-url'],
      'validate-operation': ['samples-file', 'base-url'],
      'review-reserve': ['session', 'agent', 'base-url'],
      'review-read': ['session', 'base-url'],
      recapture: [
        'review-id', 'agent', 'source-lease', 'capture-lease', 'review-lease', 'phases',
        'cameras', 'width', 'height', 'player-camera-scene', 'player-camera-prefab', 'base-url',
      ],
      apply: ['agent', 'lease', 'base-url'],
      undo: ['agent', 'lease', 'base-url'],
    };
    const requiredFlagsBySubcommand = {
      'evaluate-rest': ['attachment'],
      'evaluate-sample': ['attachment', 'phase', 'normalized-time'],
      preview: ['session', 'path', 'content-file', 'base-revision', 'label', 'agent', 'lease'],
      'validate-operation': ['samples-file'],
      'review-reserve': ['session', 'agent'],
      'review-read': ['session'],
      recapture: [
        'review-id', 'agent', 'source-lease', 'capture-lease', 'review-lease', 'phases',
        'cameras', 'width', 'height',
      ],
      apply: ['agent', 'lease'],
      undo: ['agent', 'lease'],
    };
    const supportedFlags = new Set(flagsBySubcommand[spatialSubcommand]);
    const unknownFlags = Object.keys(flags).filter((flag) => !supportedFlags.has(flag));
    if (unknownFlags.length) {
      throw new Error(`Unknown engine spatial ${spatialSubcommand} flag: --${unknownFlags[0]}`);
    }
    for (const flag of supportedFlags) {
      if (Object.hasOwn(flags, flag) && typeof flags[flag] !== 'string') {
        throw new Error(`engine spatial ${spatialSubcommand} requires a value for --${flag}.`);
      }
    }
    for (const flag of requiredFlagsBySubcommand[spatialSubcommand] || []) {
      if (!Object.hasOwn(flags, flag) || !String(flags[flag]).trim()) {
        throw new Error(`engine spatial ${spatialSubcommand} requires --${flag} <value>.`);
      }
    }
    if (spatialSubcommand === 'preview') {
      const requestedPath = String(flags.path).replaceAll('\\', '/');
      if (!/^animation\/attachments\/[^/]+\.attachment\.toml$/.test(requestedPath)) {
        throw new Error('engine spatial preview --path must match animation/attachments/*.attachment.toml.');
      }
      flags.path = requestedPath;
      const baseRevision = String(flags['base-revision']);
      if (baseRevision !== 'missing' && !/^sha256:[a-f0-9]{64}$/.test(baseRevision)) {
        throw new Error('engine spatial preview --base-revision must be missing or a lowercase SHA-256 revision.');
      }
    }
    if (nativeSubcommands.includes(spatialSubcommand)) {
      await runSpatialCommand(spatialSubcommand, flags);
    } else {
      await runSpatialOperation(spatialSubcommand, positionals, flags);
    }
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
    if (subcommand === 'artifacts') {
      await listPolicyArtifacts(flags);
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
    if (subcommand === 'promote') {
      await transitionPolicyArtifact(positionals, flags, 'promote');
      return;
    }
    if (subcommand === 'quarantine') {
      await transitionPolicyArtifact(positionals, flags, 'quarantine');
      return;
    }
    throw new Error(`Unknown policy subcommand: ${subcommand}`);
  }

  if (command === 'ai') {
    if (!subcommand) {
      throw new Error('engine ai requires a subcommand.');
    }
    if (subcommand === 'providers') {
      await inspectAiProviderState(flags);
      return;
    }
    if (subcommand === 'test') {
      await testAiProviderCommand(positionals, flags, 'test');
      return;
    }
    if (subcommand === 'request') {
      await testAiProviderCommand(positionals, flags, 'request');
      return;
    }
    if (subcommand === 'submit') {
      await submitAiJob(positionals, flags);
      return;
    }
    if (subcommand === 'jobs') {
      await listAiJobs(flags);
      return;
    }
    if (subcommand === 'usage') {
      await readAiUsage(flags);
      return;
    }
    if (subcommand === 'status') {
      await readOrCancelAiJob(positionals, flags);
      return;
    }
    if (subcommand === 'cancel') {
      await readOrCancelAiJob(positionals, flags, true);
      return;
    }
    throw new Error(`Unknown ai subcommand: ${subcommand}`);
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli()
    .then(() => {
      exitAfterFlush(0);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      exitAfterFlush(1);
    });
}
