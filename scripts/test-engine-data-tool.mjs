import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repoRootFromScript } from './lib/harness-utils.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shader-forge-data-tool-'));
const executable = path.join(tempRoot, 'shader_forge_data');
const contentRoot = path.join(tempRoot, 'content');
const foundation = path.join(tempRoot, 'engine-data-layout.toml');

function run(command, args) {
  return spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8' });
}
function wslPath(value) {
  const match = /^([A-Za-z]):[\\/](.*)$/.exec(value);
  assert.ok(match, `Cannot map Windows path to WSL: ${value}`);
  return `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll('\\', '/')}`;
}

try {
  fs.cpSync(path.join(repoRoot, 'content'), contentRoot, { recursive: true });
  fs.copyFileSync(path.join(repoRoot, 'data', 'foundation', 'engine-data-layout.toml'), foundation);
  const sources = [
    path.join(repoRoot, 'engine', 'runtime', 'src', 'data_foundation_tool.cpp'),
    path.join(repoRoot, 'engine', 'runtime', 'src', 'data_foundation.cpp'),
  ];
  const include = path.join(repoRoot, 'engine', 'runtime', 'include');
  let invoke;
  let compile;
  if (process.platform === 'win32') {
    assert.equal(run('wsl.exe', ['sh', '-lc', 'command -v g++']).status, 0, 'data tool harness requires WSL g++');
    compile = run('wsl.exe', ['g++', '-std=c++20', '-I', wslPath(include), ...sources.map(wslPath), '-o', wslPath(executable)]);
    invoke = (args) => run('wsl.exe', [wslPath(executable), ...args.map((arg) => path.isAbsolute(arg) ? wslPath(arg) : arg)]);
  } else {
    compile = run('g++', ['-std=c++20', '-I', include, ...sources, '-o', executable]);
    invoke = (args) => run(executable, args);
  }
  assert.equal(compile.status, 0, compile.stderr || compile.stdout);
  const validate = (kind, id, expectedPath, extra = []) => invoke([
    'validate-asset', '--content-root', contentRoot, '--data-foundation', foundation,
    '--kind', kind, '--id', id, '--expected-path', expectedPath, ...extra,
  ]);
  const sceneResult = validate('scene', 'sandbox', 'scenes/sandbox.scene.toml');
  assert.equal(sceneResult.status, 0, sceneResult.stderr);
  assert.equal(JSON.parse(sceneResult.stdout).valid, true);
  const prefabResult = validate('prefab', 'debug_camera', 'prefabs/debug_camera.prefab.toml');
  assert.equal(JSON.parse(prefabResult.stdout).valid, true);
  const absent = validate('scene', 'does_not_exist', 'scenes/does_not_exist.scene.toml', ['--expect-absent']);
  assert.equal(JSON.parse(absent.stdout).valid, true);
  const invalidPath = path.join(contentRoot, 'scenes', 'sandbox.scene.toml');
  fs.writeFileSync(invalidPath, fs.readFileSync(invalidPath, 'utf8').replace('primary_prefab = "debug_camera"', 'primary_prefab = "missing"'));
  const invalid = validate('scene', 'sandbox', 'scenes/sandbox.scene.toml');
  assert.equal(invalid.status, 0);
  assert.equal(JSON.parse(invalid.stdout).valid, false);
  const unsafe = validate('scene', 'sandbox', '../sandbox.scene.toml');
  assert.equal(unsafe.status, 2);
  const cmake = fs.readFileSync(path.join(repoRoot, 'engine', 'runtime', 'CMakeLists.txt'), 'utf8');
  assert.match(cmake, /add_executable\(\s*shader_forge_data/);
  console.log('engine data foundation tool harness passed');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
