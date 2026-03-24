import process from 'node:process';
import { spawnSync } from 'node:child_process';

export const cmakeEnvVarName = 'SHADER_FORGE_CMAKE';

export function normalizeConfiguredCommand(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return '';
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function mergedEnv(env = process.env) {
  return {
    ...process.env,
    ...(env || {}),
  };
}

export function commandExists(command, env = process.env) {
  const normalized = normalizeConfiguredCommand(command);
  if (!normalized) {
    return false;
  }

  const result = spawnSync(normalized, ['--version'], {
    encoding: 'utf8',
    env: mergedEnv(env),
  });
  return result.status === 0;
}

export function resolveCMakeCommand(env = process.env) {
  const configured = normalizeConfiguredCommand(env[cmakeEnvVarName]);
  if (configured && commandExists(configured, env)) {
    return configured;
  }

  if (commandExists('cmake', env)) {
    return 'cmake';
  }

  return '';
}

export function cmakeGuidanceMessage(laneDescription = 'runtime build') {
  return `cmake is required for ${laneDescription}. Install CMake, ensure it is on PATH, or set ${cmakeEnvVarName} to a usable executable path.`;
}

export function requireCMakeCommand(laneDescription = 'runtime build', env = process.env) {
  const cmakeCommand = resolveCMakeCommand(env);
  if (cmakeCommand) {
    return cmakeCommand;
  }

  throw new Error(cmakeGuidanceMessage(laneDescription));
}
