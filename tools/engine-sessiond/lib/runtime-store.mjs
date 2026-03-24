import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const defaultBinaryPath = path.join(
  repoRoot,
  'build',
  'runtime',
  'bin',
  process.platform === 'win32' ? 'shader_forge_runtime.exe' : 'shader_forge_runtime',
);
const pauseSupported = process.platform !== 'win32';

function resolveWorkspaceRoot(workspaceRoot) {
  if (typeof workspaceRoot === 'string' && workspaceRoot.trim()) {
    return path.resolve(workspaceRoot);
  }
  return repoRoot;
}

function defaultLaunchFactory({ scene, sessionId = '', workspaceRoot }) {
  if (!fs.existsSync(defaultBinaryPath)) {
    throw new Error(`Runtime binary was not found at ${defaultBinaryPath}. Build it first with \`engine build\`.`);
  }

  const resolvedWorkspaceRoot = resolveWorkspaceRoot(workspaceRoot);
  const inputRoot = path.join(resolvedWorkspaceRoot, 'input');
  const contentRoot = path.join(resolvedWorkspaceRoot, 'content');
  const audioRoot = path.join(resolvedWorkspaceRoot, 'audio');
  const animationRoot = path.join(resolvedWorkspaceRoot, 'animation');
  const physicsRoot = path.join(resolvedWorkspaceRoot, 'physics');
  const dataFoundationPath = path.join(
    resolvedWorkspaceRoot,
    'data',
    'foundation',
    'engine-data-layout.toml',
  );
  const toolingLayoutPath = path.join(
    resolvedWorkspaceRoot,
    'tooling',
    'layouts',
    'default.tooling-layout.toml',
  );
  const toolingSessionLayoutPath = path.join(
    resolvedWorkspaceRoot,
    'tooling',
    'layouts',
    'runtime-session.tooling-layout.toml',
  );

  return {
    command: defaultBinaryPath,
    args: [
      '--scene',
      scene,
      '--input-root',
      inputRoot,
      '--content-root',
      contentRoot,
      '--audio-root',
      audioRoot,
      '--animation-root',
      animationRoot,
      '--physics-root',
      physicsRoot,
      '--data-foundation',
      dataFoundationPath,
      '--tooling-layout',
      toolingLayoutPath,
      '--tooling-layout-save',
      toolingSessionLayoutPath,
    ],
    cwd: resolvedWorkspaceRoot,
    displayPath: defaultBinaryPath,
    sessionId: sessionId || null,
    workspaceRoot: resolvedWorkspaceRoot,
  };
}

export class RuntimeStore {
  #emitEvent;
  #launchFactory;
  #record = null;

  constructor({ emitEvent, launchFactory } = {}) {
    this.#emitEvent = typeof emitEvent === 'function' ? emitEvent : () => {};
    this.#launchFactory = typeof launchFactory === 'function' ? launchFactory : defaultLaunchFactory;
  }

  supportsPause() {
    return pauseSupported;
  }

  status() {
    if (!this.#record) {
      return {
        state: 'stopped',
        scene: null,
        sessionId: null,
        workspaceRoot: null,
        pid: null,
        startedAt: null,
        pausedAt: null,
        executablePath: defaultBinaryPath,
        supportsPause: pauseSupported,
      };
    }

    return {
      state: this.#record.paused ? 'paused' : 'running',
      scene: this.#record.scene,
      sessionId: this.#record.sessionId,
      workspaceRoot: this.#record.workspaceRoot,
      pid: this.#record.child.pid ?? null,
      startedAt: this.#record.startedAt,
      pausedAt: this.#record.pausedAt,
      executablePath: this.#record.displayPath,
      supportsPause: pauseSupported,
    };
  }

  startRuntime({ scene = 'sandbox', sessionId = '', workspaceRoot = '' } = {}) {
    if (this.#record) {
      throw new Error('Runtime is already running. Stop or restart it first.');
    }

    const resolvedWorkspaceRoot = typeof workspaceRoot === 'string' && workspaceRoot.trim()
      ? path.resolve(workspaceRoot)
      : null;
    const launch = this.#launchFactory({
      scene,
      sessionId,
      workspaceRoot: resolvedWorkspaceRoot || undefined,
    });
    const child = spawn(launch.command, launch.args || [], {
      cwd: launch.cwd || repoRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...(launch.env || {}),
      },
    });

    const record = {
      child,
      scene,
      sessionId: launch.sessionId ?? (sessionId || null),
      workspaceRoot: launch.workspaceRoot || resolvedWorkspaceRoot,
      startedAt: new Date().toISOString(),
      paused: false,
      pausedAt: null,
      displayPath: launch.displayPath || launch.command,
      exitPromise: null,
    };

    record.exitPromise = new Promise((resolve) => {
      child.on('exit', (exitCode, signal) => {
        const previous = this.#record;
        this.#record = null;
        this.#emitEvent('runtime.exit', {
          scene,
          sessionId: previous?.sessionId || record.sessionId,
          workspaceRoot: previous?.workspaceRoot || record.workspaceRoot,
          exitCode,
          signal,
          executablePath: previous?.displayPath || record.displayPath,
        });
        this.#emitEvent('runtime.status', this.status());
        resolve({ exitCode, signal });
      });
    });

    child.stdout?.on('data', (chunk) => {
      this.#emitEvent('runtime.log', {
        stream: 'stdout',
        data: chunk.toString('utf8'),
      });
    });

    child.stderr?.on('data', (chunk) => {
      this.#emitEvent('runtime.log', {
        stream: 'stderr',
        data: chunk.toString('utf8'),
      });
    });

    this.#record = record;
    this.#emitEvent('runtime.started', this.status());
    this.#emitEvent('runtime.status', this.status());

    return this.status();
  }

  async stopRuntime() {
    if (!this.#record) {
      return this.status();
    }

    const { child, exitPromise } = this.#record;
    if (this.#record.paused) {
      child.kill('SIGCONT');
      this.#record.paused = false;
      this.#record.pausedAt = null;
    }
    child.kill('SIGTERM');
    await exitPromise;
    return this.status();
  }

  pauseRuntime() {
    if (!this.#record) {
      throw new Error('Runtime is not running.');
    }
    if (!pauseSupported) {
      throw new Error('Runtime pause/resume is not supported on this host yet.');
    }
    if (this.#record.paused) {
      return this.status();
    }

    const paused = this.#record.child.kill('SIGSTOP');
    if (!paused) {
      throw new Error('Failed to pause the runtime process.');
    }

    this.#record.paused = true;
    this.#record.pausedAt = new Date().toISOString();
    this.#emitEvent('runtime.status', this.status());
    return this.status();
  }

  resumeRuntime() {
    if (!this.#record) {
      throw new Error('Runtime is not running.');
    }
    if (!pauseSupported) {
      throw new Error('Runtime pause/resume is not supported on this host yet.');
    }
    if (!this.#record.paused) {
      return this.status();
    }

    const resumed = this.#record.child.kill('SIGCONT');
    if (!resumed) {
      throw new Error('Failed to resume the runtime process.');
    }

    this.#record.paused = false;
    this.#record.pausedAt = null;
    this.#emitEvent('runtime.status', this.status());
    return this.status();
  }

  async restartRuntime({ scene = 'sandbox', sessionId = '', workspaceRoot = '' } = {}) {
    if (this.#record) {
      await this.stopRuntime();
    }
    return this.startRuntime({ scene, sessionId, workspaceRoot });
  }

  async close() {
    if (this.#record) {
      await this.stopRuntime();
    }
  }
}
