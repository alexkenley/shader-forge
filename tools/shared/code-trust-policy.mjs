import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const codeTrustActions = ['apply', 'compile', 'load', 'hot_reload', 'install'];
export const codeTrustActors = ['human', 'assistant', 'automation'];
export const codeTrustTiers = [
  'engine_trusted',
  'project_authored',
  'assistant_generated',
  'external_plugin',
  'unsafe_dev_override',
];

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const bundledPolicyPath = path.join(repoRoot, 'tooling', 'policy', 'code-access-policy.json');
const artifactStorePathRelative = path.join('.shader-forge', 'code-trust-artifacts.json');
const artifactStoreVersion = 1;
const decisionRank = {
  allow: 0,
  review_required: 1,
  deny: 2,
};

function normalizeSlashes(value) {
  return String(value || '').replace(/\\/g, '/');
}

function escapeRegExp(value) {
  return String(value).replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function globToRegExp(pattern) {
  let expression = '^';
  const source = normalizeSlashes(pattern);
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const nextCharacter = source[index + 1];
    if (character === '*' && nextCharacter === '*') {
      expression += '.*';
      index += 1;
      continue;
    }
    if (character === '*') {
      expression += '[^/]*';
      continue;
    }
    expression += escapeRegExp(character);
  }
  expression += '$';
  return new RegExp(expression);
}

function normalizePatterns(patterns) {
  if (!Array.isArray(patterns)) {
    return [];
  }
  return patterns
    .map((value) => normalizeSlashes(String(value || '').trim()))
    .filter(Boolean);
}

function normalizeAssistantActions(actions) {
  if (!actions || typeof actions !== 'object') {
    return {};
  }
  const normalized = {};
  for (const action of codeTrustActions) {
    const value = typeof actions[action] === 'string' ? String(actions[action]).trim() : '';
    if (value === 'allow' || value === 'review' || value === 'deny') {
      normalized[action] = value;
    }
  }
  return normalized;
}

function normalizePathRule(rule, index) {
  if (!rule || typeof rule !== 'object') {
    return null;
  }

  const patterns = normalizePatterns(rule.patterns);
  if (!patterns.length) {
    return null;
  }

  const trustTier = codeTrustTiers.includes(rule.trustTier)
    ? rule.trustTier
    : 'project_authored';

  return {
    id: typeof rule.id === 'string' && rule.id.trim() ? rule.id.trim() : `rule_${index + 1}`,
    description: typeof rule.description === 'string' ? rule.description.trim() : '',
    trustTier,
    kind: typeof rule.kind === 'string' && rule.kind.trim() ? rule.kind.trim() : 'code',
    patterns,
    patternRegexes: patterns.map((pattern) => globToRegExp(pattern)),
    assistantActions: normalizeAssistantActions(rule.assistantActions),
  };
}

function normalizeUnsafeDevOverrides(value) {
  const source = value && typeof value === 'object' ? value : {};
  return {
    allowAssistantEngineWrites: !!source.allowAssistantEngineWrites,
    allowAssistantCompile: !!source.allowAssistantCompile,
    allowAssistantLoad: !!source.allowAssistantLoad,
    allowAssistantHotReload: !!source.allowAssistantHotReload,
    allowExternalPluginLoad: !!source.allowExternalPluginLoad,
  };
}

function normalizePolicy(policy) {
  const source = policy && typeof policy === 'object' ? policy : {};
  const defaultAssistantActions = normalizeAssistantActions(source.defaultAssistantActions);
  const pathRules = Array.isArray(source.pathRules)
    ? source.pathRules.map((rule, index) => normalizePathRule(rule, index)).filter(Boolean)
    : [];

  return {
    version: Number(source.version) || 1,
    summary: typeof source.summary === 'string' ? source.summary.trim() : '',
    defaultTrustTier: codeTrustTiers.includes(source.defaultTrustTier)
      ? source.defaultTrustTier
      : 'project_authored',
    defaultKind: typeof source.defaultKind === 'string' && source.defaultKind.trim()
      ? source.defaultKind.trim()
      : 'code',
    defaultAssistantActions,
    unsafeDevOverrides: normalizeUnsafeDevOverrides(source.unsafeDevOverrides),
    pathRules,
  };
}

async function readJsonFile(filePath) {
  const payload = await fs.readFile(filePath, 'utf8');
  return payload.trim() ? JSON.parse(payload) : {};
}

function normalizeRelativePath(rootPath, targetPath = '.') {
  const resolvedRoot = path.resolve(rootPath);
  const normalizedTarget = typeof targetPath === 'string' && targetPath.trim() ? targetPath.trim() : '.';
  const resolvedTarget = path.resolve(resolvedRoot, normalizedTarget);
  const relativePath = path.relative(resolvedRoot, resolvedTarget);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error(`Path escapes trust root: ${targetPath}`);
  }
  return normalizeSlashes(relativePath || '.');
}

function inferOrigin({ actor, targetTier, targetKind, relativePath }) {
  if (relativePath.startsWith('generated/assistant/') || relativePath.startsWith('.shader-forge/assistant/')) {
    return 'assistant_generated';
  }
  if (targetTier === 'assistant_generated') {
    return 'assistant_generated';
  }
  if (targetTier === 'external_plugin' || targetKind === 'plugin') {
    return 'external_plugin';
  }
  if (actor === 'assistant') {
    return targetKind === 'content' ? 'project_authored' : 'assistant_generated';
  }
  return targetTier === 'engine_trusted' ? 'engine_trusted' : 'project_authored';
}

function rankDecision(decision) {
  return decisionRank[decision] ?? decisionRank.allow;
}

function strongerDecision(current, candidate) {
  return rankDecision(candidate) > rankDecision(current) ? candidate : current;
}

function buildBlockedMessage(evaluation) {
  if (!Array.isArray(evaluation.diagnostics) || !evaluation.diagnostics.length) {
    return `Code-trust policy blocked ${evaluation.action} for ${evaluation.path}.`;
  }
  return evaluation.diagnostics[0].message;
}

function createDiagnostic(severity, code, message, suggestion = '') {
  return {
    severity,
    code,
    message,
    suggestion,
  };
}

function normalizeActor(actor) {
  return codeTrustActors.includes(actor) ? actor : 'human';
}

function normalizeOrigin(origin) {
  return codeTrustTiers.includes(origin) ? origin : '';
}

function matchPathRule(pathRules, relativePath) {
  return pathRules.find((rule) => rule.patternRegexes.some((pattern) => pattern.test(relativePath))) || null;
}

async function readArtifactStore(rootPath) {
  const storePath = path.join(rootPath, artifactStorePathRelative);
  try {
    const parsed = await readJsonFile(storePath);
    const records = Array.isArray(parsed.artifacts)
      ? parsed.artifacts
        .map((record) => normalizeArtifactRecord(record))
        .filter(Boolean)
      : [];
    return {
      storePath,
      records,
    };
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return {
        storePath,
        records: [],
      };
    }
    throw error;
  }
}

function normalizeArtifactRecord(record) {
  if (!record || typeof record !== 'object' || !record.path) {
    return null;
  }
  return {
    path: normalizeSlashes(String(record.path || '')),
    origin: normalizeOrigin(record.origin) || 'project_authored',
    targetTier: codeTrustTiers.includes(record.targetTier) ? record.targetTier : 'project_authored',
    targetKind: typeof record.targetKind === 'string' && record.targetKind.trim() ? record.targetKind.trim() : 'code',
    lastAction: codeTrustActions.includes(record.lastAction) ? record.lastAction : 'apply',
    updatedAt: typeof record.updatedAt === 'string' && record.updatedAt.trim()
      ? record.updatedAt
      : new Date(0).toISOString(),
  };
}

function shouldTrackArtifact({ evaluation, actor, requestOrigin }) {
  return (
    evaluation.targetKind !== 'content'
    || actor === 'assistant'
    || Boolean(requestOrigin)
  );
}

async function writeArtifactStore(rootPath, storePath, records) {
  const payload = {
    version: artifactStoreVersion,
    artifacts: records,
  };
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, JSON.stringify(payload, null, 2), 'utf8');
}

export class CodeTrustPolicyError extends Error {
  constructor(evaluation) {
    super(buildBlockedMessage(evaluation));
    this.name = 'CodeTrustPolicyError';
    this.statusCode = evaluation.decision === 'review_required' ? 409 : 403;
    this.codeTrust = evaluation;
  }
}

export function codeTrustDefaultTargetPath(action) {
  if (action === 'compile') {
    return 'engine/runtime';
  }
  if (action === 'load') {
    const runtimeBinaryName = process.platform === 'win32' ? 'shader_forge_runtime.exe' : 'shader_forge_runtime';
    return normalizeSlashes(path.join('build', 'runtime', 'bin', runtimeBinaryName));
  }
  return '.';
}

export async function loadCodeTrustPolicy(rootPath) {
  const resolvedRoot = path.resolve(rootPath);
  const sessionPolicyPath = path.join(resolvedRoot, 'tooling', 'policy', 'code-access-policy.json');
  const candidatePaths = [
    { filePath: sessionPolicyPath, source: 'workspace' },
    { filePath: bundledPolicyPath, source: 'bundled' },
  ];

  for (const candidate of candidatePaths) {
    try {
      const parsed = await readJsonFile(candidate.filePath);
      return {
        rootPath: resolvedRoot,
        policyPath: candidate.filePath,
        policySource: candidate.source,
        policy: normalizePolicy(parsed),
      };
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  return {
    rootPath: resolvedRoot,
    policyPath: bundledPolicyPath,
    policySource: 'bundled',
    policy: normalizePolicy({}),
  };
}

export async function evaluateCodeTrustAction({
  rootPath,
  action,
  relativePath = '',
  actor = 'human',
  origin = '',
} = {}) {
  const normalizedAction = codeTrustActions.includes(action) ? action : '';
  if (!normalizedAction) {
    throw new Error(`Unsupported code-trust action: ${action}`);
  }

  const resolvedRoot = path.resolve(rootPath);
  const targetPath = relativePath || codeTrustDefaultTargetPath(normalizedAction);
  const normalizedPath = normalizeRelativePath(resolvedRoot, targetPath);
  const normalizedActor = normalizeActor(actor);
  const requestedOrigin = normalizeOrigin(origin);
  const loadedPolicy = await loadCodeTrustPolicy(resolvedRoot);
  const matchedRule = matchPathRule(loadedPolicy.policy.pathRules, normalizedPath);
  const { records } = await readArtifactStore(resolvedRoot);
  const existingRecord = records.find((record) => record.path === normalizedPath) || null;
  const targetTier = matchedRule?.trustTier || loadedPolicy.policy.defaultTrustTier;
  const targetKind = matchedRule?.kind || loadedPolicy.policy.defaultKind;
  const effectiveOrigin = requestedOrigin || existingRecord?.origin || inferOrigin({
    actor: normalizedActor,
    targetTier,
    targetKind,
    relativePath: normalizedPath,
  });

  let decision = 'allow';
  const diagnostics = [];

  if (normalizedAction === 'hot_reload' && targetKind !== 'content') {
    decision = strongerDecision(decision, 'deny');
    diagnostics.push(
      createDiagnostic(
        'error',
        'unsupported_code_hot_reload',
        `Hot reload is currently limited to authored content roots. '${normalizedPath}' is treated as ${targetKind}, so ${normalizedAction} is blocked.`,
        'Use the current F7/manual authored-content reload lane for content/, audio/, animation/, physics/, input/, data/, or tooling/layouts/, and keep code reload as a restart workflow for now.',
      ),
    );
  }

  if (
    effectiveOrigin === 'external_plugin'
    && ['load', 'install', 'hot_reload'].includes(normalizedAction)
    && !loadedPolicy.policy.unsafeDevOverrides.allowExternalPluginLoad
  ) {
    decision = strongerDecision(decision, 'deny');
    diagnostics.push(
      createDiagnostic(
        'error',
        'external_plugin_blocked',
        `External plugin artifacts are blocked for ${normalizedAction} in the first code-trust slice.`,
        'Promote the plugin through a reviewed project-owned integration path or opt into the visible unsafe-dev override for local experiments.',
      ),
    );
  }

  if (normalizedActor === 'assistant' || normalizedActor === 'automation') {
    const assistantAction = matchedRule?.assistantActions?.[normalizedAction]
      || loadedPolicy.policy.defaultAssistantActions[normalizedAction]
      || 'review';

    if (
      normalizedAction === 'apply'
      && targetTier === 'engine_trusted'
      && !loadedPolicy.policy.unsafeDevOverrides.allowAssistantEngineWrites
    ) {
      decision = strongerDecision(decision, 'review_required');
      diagnostics.push(
        createDiagnostic(
          'warn',
          'assistant_engine_write_review',
          `Assistant-triggered apply into engine-trusted paths requires explicit review. '${normalizedPath}' is inside an engine-owned zone.`,
          'Write generated code into generated/assistant/ first, or enable the visible unsafe-dev override when you intentionally want assistant edits to land in engine-owned code.',
        ),
      );
    }

    if (
      normalizedAction === 'compile'
      && targetTier === 'engine_trusted'
      && !loadedPolicy.policy.unsafeDevOverrides.allowAssistantCompile
    ) {
      decision = strongerDecision(decision, 'review_required');
      diagnostics.push(
        createDiagnostic(
          'warn',
          'assistant_compile_review',
          `Assistant-triggered compile for engine-trusted code is gated by policy. '${normalizedPath}' still requires explicit review in this slice.`,
          'Run the compile as a human-driven workflow, or opt into the unsafe-dev override for local experimentation.',
        ),
      );
    }

    if (
      normalizedAction === 'load'
      && (effectiveOrigin === 'assistant_generated' || effectiveOrigin === 'external_plugin')
      && !loadedPolicy.policy.unsafeDevOverrides.allowAssistantLoad
    ) {
      decision = strongerDecision(decision, 'deny');
      diagnostics.push(
        createDiagnostic(
          'error',
          'assistant_load_blocked',
          `Assistant-triggered load is blocked for ${effectiveOrigin} artifacts in this slice.`,
          'Convert the artifact into a reviewed project-owned output first, or use an explicit unsafe-dev override for isolated local testing.',
        ),
      );
    }

    if (
      normalizedAction === 'hot_reload'
      && !loadedPolicy.policy.unsafeDevOverrides.allowAssistantHotReload
      && targetKind !== 'content'
    ) {
      decision = strongerDecision(decision, 'deny');
      diagnostics.push(
        createDiagnostic(
          'error',
          'assistant_hot_reload_blocked',
          `Assistant-triggered hot reload is blocked for '${normalizedPath}' because only authored content hot reload is supported right now.`,
          'Use restart-based iteration for code, plugins, or generated binaries until a later hotload-safe slice lands.',
        ),
      );
    }

    if (assistantAction === 'review') {
      decision = strongerDecision(decision, 'review_required');
      diagnostics.push(
        createDiagnostic(
          'warn',
          'assistant_action_review',
          `Assistant-triggered ${normalizedAction} for '${normalizedPath}' requires review under the current path rule.`,
          'Inspect the target path, then either rerun it as a human-driven workflow or adjust the workspace policy intentionally.',
        ),
      );
    } else if (assistantAction === 'deny') {
      decision = strongerDecision(decision, 'deny');
      diagnostics.push(
        createDiagnostic(
          'error',
          'assistant_action_denied',
          `Assistant-triggered ${normalizedAction} for '${normalizedPath}' is denied by the current path rule.`,
          'Move the operation to an allowed path or update the workspace policy deliberately before retrying.',
        ),
      );
    }
  }

  if (decision === 'allow') {
    diagnostics.push(
      createDiagnostic(
        'info',
        'policy_allowed',
        `Code-trust policy allows ${normalizedAction} for '${normalizedPath}'.`,
      ),
    );
  }

  return {
    action: normalizedAction,
    actor: normalizedActor,
    path: normalizedPath,
    decision,
    allowed: decision === 'allow',
    targetTier,
    targetKind,
    effectiveOrigin,
    requestedOrigin: requestedOrigin || null,
    matchedRuleId: matchedRule?.id || null,
    matchedRulePatterns: matchedRule?.patterns || [],
    policyPath: loadedPolicy.policyPath,
    policySource: loadedPolicy.policySource,
    supportedHotReloadRoots: loadedPolicy.policy.pathRules
      .filter((rule) => rule.kind === 'content' && rule.assistantActions.hot_reload === 'allow')
      .flatMap((rule) => rule.patterns),
    diagnostics,
  };
}

export async function enforceCodeTrustAction(options = {}) {
  const evaluation = await evaluateCodeTrustAction(options);
  if (!evaluation.allowed) {
    throw new CodeTrustPolicyError(evaluation);
  }
  return evaluation;
}

export async function recordCodeTrustArtifact({
  rootPath,
  relativePath,
  actor = 'human',
  origin = '',
  evaluation,
} = {}) {
  if (!evaluation || !evaluation.path) {
    throw new Error('A code-trust evaluation is required before recording an artifact.');
  }

  const normalizedActor = normalizeActor(actor);
  const requestedOrigin = normalizeOrigin(origin);
  if (!shouldTrackArtifact({ evaluation, actor: normalizedActor, requestOrigin: requestedOrigin })) {
    return null;
  }

  const resolvedRoot = path.resolve(rootPath);
  const normalizedPath = normalizeRelativePath(resolvedRoot, relativePath || evaluation.path);
  const { storePath, records } = await readArtifactStore(resolvedRoot);
  const timestamp = new Date().toISOString();
  const nextRecord = {
    path: normalizedPath,
    origin: evaluation.effectiveOrigin,
    targetTier: evaluation.targetTier,
    targetKind: evaluation.targetKind,
    lastAction: evaluation.action,
    updatedAt: timestamp,
  };

  const existingIndex = records.findIndex((record) => record.path === normalizedPath);
  const nextRecords = existingIndex >= 0
    ? records.map((record, index) => (index === existingIndex ? nextRecord : record))
    : [nextRecord, ...records];

  nextRecords.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  await writeArtifactStore(resolvedRoot, storePath, nextRecords.slice(0, 64));
  return nextRecord;
}

export async function inspectCodeTrustState(rootPath) {
  const resolvedRoot = path.resolve(rootPath);
  const loadedPolicy = await loadCodeTrustPolicy(resolvedRoot);
  const { records } = await readArtifactStore(resolvedRoot);

  return {
    rootPath: resolvedRoot,
    policyPath: loadedPolicy.policyPath,
    policySource: loadedPolicy.policySource,
    summary: loadedPolicy.policy.summary,
    unsafeDevOverrides: loadedPolicy.policy.unsafeDevOverrides,
    supportedHotReloadRoots: loadedPolicy.policy.pathRules
      .filter((rule) => rule.kind === 'content' && rule.assistantActions.hot_reload === 'allow')
      .flatMap((rule) => rule.patterns),
    pathRules: loadedPolicy.policy.pathRules.map((rule) => ({
      id: rule.id,
      description: rule.description,
      trustTier: rule.trustTier,
      kind: rule.kind,
      patterns: rule.patterns,
      assistantActions: rule.assistantActions,
    })),
    trackedArtifactCount: records.length,
    trackedArtifacts: records
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, 8),
  };
}

export { repoRoot as codeTrustRepoRoot };
