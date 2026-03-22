import path from 'node:path';
import process from 'node:process';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const defaultBuildDir = path.join(repoRoot, 'build', 'runtime');

function commandExists(command) {
  const result = spawnSync(command, ['--version'], {
    encoding: 'utf8',
  });
  return result.status === 0;
}

function resolveBuildDirectory(buildDir) {
  if (!buildDir) {
    return defaultBuildDir;
  }
  return path.isAbsolute(buildDir) ? buildDir : path.join(repoRoot, buildDir);
}

function defaultLaunchFactory({ target = 'runtime', config = 'Debug', buildDir } = {}) {
  if (target !== 'runtime') {
    throw new Error(`Unsupported build target: ${target}`);
  }

  if (!commandExists('cmake')) {
    throw new Error('cmake is required for runtime build. Install cmake to use the build lane.');
  }

  const resolvedBuildDir = resolveBuildDirectory(buildDir);

  return {
    target,
    config,
    buildDir: resolvedBuildDir,
    steps: [
      {
        label: 'Configure',
        command: 'cmake',
        args: [
          '-S',
          repoRoot,
          '-B',
          resolvedBuildDir,
          `-DCMAKE_BUILD_TYPE=${config}`,
          '-DSHADER_FORGE_BUILD_RUNTIME=ON',
        ],
        cwd: repoRoot,
      },
      {
        label: 'Build',
        command: 'cmake',
        args: ['--build', resolvedBuildDir, '--config', config, '--target', 'shader_forge_runtime'],
        cwd: repoRoot,
      },
    ],
  };
}

function createIdleStatus() {
  return {
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
}

export class BuildStore {
  #emitEvent;
  #launchFactory;
  #record = null;
  #status = createIdleStatus();

  constructor({ emitEvent, launchFactory } = {}) {
    this.#emitEvent = typeof emitEvent === 'function' ? emitEvent : () => {};
    this.#launchFactory = typeof launchFactory === 'function' ? launchFactory : defaultLaunchFactory;
  }

  status() {
    return { ...this.#status };
  }

  startBuild({ target = 'runtime', config = 'Debug', buildDir } = {}) {
    if (this.#record) {
      throw new Error('A build is already running. Stop it or wait for it to finish.');
    }

    const launch = this.#launchFactory({ target, config, buildDir });
    const startedAt = new Date().toISOString();
    this.#status = {
      state: 'running',
      target: launch.target || target,
      config: launch.config || config,
      buildDir: launch.buildDir || resolveBuildDirectory(buildDir),
      startedAt,
      finishedAt: null,
      command: null,
      exitCode: null,
      error: null,
    };

    const record = {
      child: null,
      stopRequested: false,
      promise: null,
    };

    record.promise = this.#runBuildPipeline(launch, record);
    this.#record = record;
    this.#emitEvent('build.started', this.status());
    this.#emitEvent('build.status', this.status());

    return this.status();
  }

  async stopBuild() {
    if (!this.#record) {
      return this.status();
    }

    this.#record.stopRequested = true;
    this.#record.child?.kill('SIGTERM');
    await this.#record.promise;
    return this.status();
  }

  async close() {
    if (this.#record) {
      await this.stopBuild();
    }
  }

  async #runBuildPipeline(launch, record) {
    try {
      for (const step of launch.steps || []) {
        await this.#runStep(step, record);
      }

      this.#status = {
        ...this.#status,
        state: 'succeeded',
        finishedAt: new Date().toISOString(),
        exitCode: 0,
        error: null,
      };
      this.#emitEvent('build.completed', this.status());
      this.#emitEvent('build.status', this.status());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const exitCode =
        typeof error === 'object' && error && 'exitCode' in error && typeof error.exitCode === 'number'
          ? error.exitCode
          : null;

      this.#status = {
        ...this.#status,
        state: record.stopRequested ? 'stopped' : 'failed',
        finishedAt: new Date().toISOString(),
        exitCode,
        error: message,
      };
      this.#emitEvent('build.completed', this.status());
      this.#emitEvent('build.status', this.status());
    } finally {
      this.#record = null;
    }
  }

  async #runStep(step, record) {
    this.#status = {
      ...this.#status,
      command: [step.command, ...(step.args || [])].join(' '),
    };
    this.#emitEvent('build.status', this.status());
    this.#emitEvent('build.log', {
      stream: 'stdout',
      data: `\n[build] ${step.label}: ${this.#status.command}\n`,
    });

    await new Promise((resolve, reject) => {
      const child = spawn(step.command, step.args || [], {
        cwd: step.cwd || repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ...(step.env || {}),
        },
      });

      record.child = child;

      child.stdout?.on('data', (chunk) => {
        this.#emitEvent('build.log', {
          stream: 'stdout',
          data: chunk.toString('utf8'),
        });
      });

      child.stderr?.on('data', (chunk) => {
        this.#emitEvent('build.log', {
          stream: 'stderr',
          data: chunk.toString('utf8'),
        });
      });

      child.once('error', reject);
      child.once('exit', (exitCode, signal) => {
        record.child = null;
        if (record.stopRequested) {
          reject(new Error('Build stopped.'));
          return;
        }
        if (exitCode === 0) {
          resolve(undefined);
          return;
        }
        const stepError = new Error(
          `${step.label} exited with code ${exitCode ?? 'unknown'}${signal ? ` (signal ${signal})` : ''}.`,
        );
        stepError.exitCode = typeof exitCode === 'number' ? exitCode : null;
        reject(stepError);
      });
    });
  }
}
