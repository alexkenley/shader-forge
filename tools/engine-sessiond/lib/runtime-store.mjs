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

function defaultLaunchFactory({ scene }) {
  if (!fs.existsSync(defaultBinaryPath)) {
    throw new Error(`Runtime binary was not found at ${defaultBinaryPath}. Build it first with \`engine build\`.`);
  }

  return {
    command: defaultBinaryPath,
    args: ['--scene', scene],
    cwd: repoRoot,
    displayPath: defaultBinaryPath,
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
      pid: this.#record.child.pid ?? null,
      startedAt: this.#record.startedAt,
      pausedAt: this.#record.pausedAt,
      executablePath: this.#record.displayPath,
      supportsPause: pauseSupported,
    };
  }

  startRuntime({ scene = 'sandbox' } = {}) {
    if (this.#record) {
      throw new Error('Runtime is already running. Stop or restart it first.');
    }

    const launch = this.#launchFactory({ scene });
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

  async restartRuntime({ scene = 'sandbox' } = {}) {
    if (this.#record) {
      await this.stopRuntime();
    }
    return this.startRuntime({ scene });
  }

  async close() {
    if (this.#record) {
      await this.stopRuntime();
    }
  }
}
