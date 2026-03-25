import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { inspectCodeTrustState } from './code-trust-policy.mjs';
import { inspectAiProviders } from './engine-ai-service.mjs';
import { inspectPackagingPreset } from './engine-packaging-service.mjs';

const profileLiveSchema = 'shader_forge.profile_live';
const profileCaptureSchema = 'shader_forge.profile_capture';

function trim(value) {
  return String(value || '').trim();
}

function normalizeSlashes(value) {
  return String(value || '').replace(/\\/g, '/');
}

function relativePathFromRoot(rootPath, targetPath) {
  const relativePath = normalizeSlashes(path.relative(rootPath, targetPath));
  return relativePath || '.';
}

function trimLogTail(content, maxLength = 12000) {
  const text = String(content || '');
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(text.length - maxLength);
}

function countLogLines(content) {
  const normalized = String(content || '');
  if (!normalized) {
    return 0;
  }
  return normalized.split(/\r?\n/).filter(Boolean).length;
}

function summarizeGitStatus(gitStatus) {
  if (!gitStatus || typeof gitStatus !== 'object') {
    return {
      branch: '',
      stagedCount: 0,
      unstagedCount: 0,
      untrackedCount: 0,
      notARepo: true,
    };
  }

  return {
    branch: typeof gitStatus.branch === 'string' ? gitStatus.branch : '',
    stagedCount: Array.isArray(gitStatus.staged) ? gitStatus.staged.length : 0,
    unstagedCount: Array.isArray(gitStatus.unstaged) ? gitStatus.unstaged.length : 0,
    untrackedCount: Array.isArray(gitStatus.untracked) ? gitStatus.untracked.length : 0,
    notARepo: !!gitStatus.notARepo,
  };
}

function buildRecommendations({ runtimeStatus, buildStatus, packaging, git }) {
  const recommendations = [];
  if (!packaging.ready) {
    recommendations.push('Build the runtime, keep the authored runtime roots present, and rerun `engine bake` before attempting release-layout manual tests.');
  } else {
    recommendations.push(`Run the packaged launch scripts under ${packaging.packageRootPath} to validate release-layout handoff before widening renderer/runtime depth further.`);
  }
  if ((runtimeStatus?.state || 'stopped') !== 'running') {
    recommendations.push('Launch the runtime and capture again during an active run if you want live runtime state and recent runtime logs in the profile report.');
  }
  if ((buildStatus?.state || 'idle') === 'failed') {
    recommendations.push('Address the current build failure before relying on profiling captures for regression triage.');
  }
  if (git.stagedCount || git.unstagedCount || git.untrackedCount) {
    recommendations.push('Keep the working tree state with the capture so later regressions can be correlated with the exact edited files.');
  }
  return recommendations;
}

export async function inspectProfilingState(options = {}) {
  const rootPath = path.resolve(options.rootPath || process.cwd());
  const runtimeStatus = options.runtimeStatus || {
    state: 'stopped',
    scene: null,
    sessionId: null,
    workspaceRoot: null,
    pid: null,
    startedAt: null,
    pausedAt: null,
    executablePath: null,
    supportsPause: false,
  };
  const buildStatus = options.buildStatus || {
    state: 'idle',
    target: null,
    config: null,
    buildDir: null,
    startedAt: null,
    finishedAt: null,
    command: null,
    exitCode: null,
    error: null,
  };
  const runtimeLog = trimLogTail(options.runtimeLog || '');
  const buildLog = trimLogTail(options.buildLog || '');
  const git = summarizeGitStatus(options.gitStatus);
  const codeTrust = await inspectCodeTrustState(rootPath);
  const ai = await inspectAiProviders(rootPath);
  const packaging = await inspectPackagingPreset(rootPath, {
    presetId: options.presetId || 'default',
  });

  return {
    schema: profileLiveSchema,
    version: 1,
    capturedAt: new Date().toISOString(),
    rootPath,
    sessionId: trim(options.sessionId) || null,
    runtime: {
      state: runtimeStatus.state,
      scene: runtimeStatus.scene,
      sessionId: runtimeStatus.sessionId,
      workspaceRoot: runtimeStatus.workspaceRoot,
      pid: runtimeStatus.pid,
      startedAt: runtimeStatus.startedAt,
      pausedAt: runtimeStatus.pausedAt,
      executablePath: runtimeStatus.executablePath,
      supportsPause: runtimeStatus.supportsPause,
      logTail: runtimeLog,
      logLineCount: countLogLines(runtimeLog),
    },
    build: {
      state: buildStatus.state,
      target: buildStatus.target,
      config: buildStatus.config,
      buildDir: buildStatus.buildDir,
      startedAt: buildStatus.startedAt,
      finishedAt: buildStatus.finishedAt,
      command: buildStatus.command,
      exitCode: buildStatus.exitCode,
      error: buildStatus.error,
      logTail: buildLog,
      logLineCount: countLogLines(buildLog),
    },
    workspace: {
      git,
      codeTrust: {
        policyPath: codeTrust.policyPath,
        trackedArtifactCount: codeTrust.trackedArtifactCount,
        promotedArtifactCount: codeTrust.promotedArtifactCount,
        quarantinedArtifactCount: codeTrust.quarantinedArtifactCount,
        verificationIssueCount: codeTrust.verificationIssueCount,
      },
      ai: {
        configPath: ai.configPath,
        configSource: ai.configSource,
        defaultProviderId: ai.defaultProviderId,
        providerCount: ai.providerCount,
        readyProviderCount: ai.readyProviderCount,
      },
      packaging: {
        presetId: packaging.presetId,
        presetPath: packaging.presetPath,
        presetSource: packaging.presetSource,
        packageRootPath: packaging.packageRootPath,
        runtimeBinaryPath: packaging.runtimeBinaryPath,
        cookedRootPath: packaging.cookedRootPath,
        ready: packaging.ready,
        warnings: packaging.warnings,
        cookedAssetCount: packaging.cookedAssetCount,
        lastPackageAt: packaging.lastPackageAt,
      },
    },
    recommendations: buildRecommendations({
      runtimeStatus,
      buildStatus,
      packaging,
      git,
    }),
  };
}

export async function captureProfilingSnapshot(options = {}) {
  const rootPath = path.resolve(options.rootPath || process.cwd());
  const liveSummary = await inspectProfilingState(options);
  const label = trim(options.label) || 'diagnostics';
  const timestamp = liveSummary.capturedAt.replace(/[:.]/g, '-');
  const relativeOutputPath = trim(options.outputPath)
    || normalizeSlashes(path.join('build', 'profiling', 'captures', `${timestamp}-${label}.json`));
  const absoluteOutputPath = path.isAbsolute(relativeOutputPath)
    ? relativeOutputPath
    : path.join(rootPath, relativeOutputPath);

  const relativeOutputFromRoot = path.relative(rootPath, absoluteOutputPath);
  if (!relativeOutputFromRoot || relativeOutputFromRoot === '.' || relativeOutputFromRoot.startsWith('..') || path.isAbsolute(relativeOutputFromRoot)) {
    throw new Error('Profile capture output must be a child path inside the workspace root.');
  }

  await fs.mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  const capture = {
    ...liveSummary,
    schema: profileCaptureSchema,
    label,
    outputPath: relativePathFromRoot(rootPath, absoluteOutputPath),
  };
  await fs.writeFile(absoluteOutputPath, JSON.stringify(capture, null, 2), 'utf8');
  return capture;
}
