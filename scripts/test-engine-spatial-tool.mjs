import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repoRootFromScript } from './lib/harness-utils.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const includeRoot = path.join(repoRoot, 'engine', 'runtime', 'include');
const animationSource = path.join(repoRoot, 'engine', 'runtime', 'src', 'animation_system.cpp');
const toolSource = path.join(repoRoot, 'engine', 'runtime', 'src', 'spatial_authoring_tool.cpp');
const cliPath = path.join(repoRoot, 'tools', 'engine-cli', 'shaderforge.mjs');
const animationRoot = path.join(repoRoot, 'animation');
const cliSource = fs.readFileSync(cliPath, 'utf8');
const cmakeSource = fs.readFileSync(path.join(repoRoot, 'engine', 'runtime', 'CMakeLists.txt'), 'utf8');

assert.match(cmakeSource, /add_executable\(\s*shader_forge_spatial/);
assert.match(cmakeSource, /src\/spatial_authoring_tool\.cpp/);
assert.match(cliSource, /engine build \[runtime\|spatial\]/);
assert.match(cliSource, /engine spatial validate/);
assert.match(cliSource, /Build it first with/);

const help = spawnSync(process.execPath, [cliPath, '--help'], { cwd: repoRoot, encoding: 'utf8' });
assert.equal(help.status, 0, help.stderr || help.stdout);
assert.match(help.stdout, /engine build \[runtime\|spatial\]/);
assert.match(help.stdout, /engine spatial validate \[--animation-root animation\]/);

for (const [argumentsList, expectedError] of [
  [['spatial', 'validate', 'other-animation'], /does not accept positional arguments/],
  [['spatial', 'validate', '--animaton-root', 'other-animation'], /Unknown engine spatial validate flag: --animaton-root/],
  [['spatial', 'validate', '--animation-root'], /requires a value for --animation-root/],
]) {
  const invalidCli = spawnSync(process.execPath, [cliPath, ...argumentsList], { cwd: repoRoot, encoding: 'utf8' });
  assert.notEqual(invalidCli.status, 0, `CLI arguments should be rejected: ${argumentsList.join(' ')}`);
  assert.match(invalidCli.stderr, expectedError);
}

const missingBuildRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shader-forge-spatial-missing-'));
try {
  const missing = spawnSync(
    process.execPath,
    [cliPath, 'spatial', 'validate', '--build-dir', missingBuildRoot],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  assert.notEqual(missing.status, 0, 'engine spatial validate must fail when the native binary is absent');
  assert.match(missing.stderr, /Spatial validator was not found/);
  assert.match(missing.stderr, /engine build spatial/);
} finally {
  fs.rmSync(missingBuildRoot, { recursive: true, force: true });
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shader-forge-spatial-tool-'));
const fixtureRoot = path.join(tempRoot, 'animation fixture');
const invalidRoot = path.join(tempRoot, 'invalid animation');
const executablePath = path.join(tempRoot, 'shader_forge_spatial');
const spatialFixtures = path.join(animationRoot, 'fixtures', 'spatial');

for (const directory of ['skeletons', 'clips', 'graphs']) {
  fs.cpSync(path.join(animationRoot, directory), path.join(fixtureRoot, directory), { recursive: true });
}
for (const directory of ['skeletons', 'clips', 'attachments']) {
  fs.cpSync(path.join(spatialFixtures, directory), path.join(fixtureRoot, directory), { recursive: true });
}
fs.cpSync(fixtureRoot, invalidRoot, { recursive: true });
const invalidAttachment = path.join(invalidRoot, 'attachments', 'rifle_mk1_humanoid.attachment.toml');
fs.writeFileSync(
  invalidAttachment,
  fs.readFileSync(invalidAttachment, 'utf8').replace('mode = "two_hand"', 'mode = "three_hand"'),
);

function toWslPath(windowsPath) {
  const normalized = windowsPath.replaceAll('\\', '/');
  const match = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  assert.ok(match, `Cannot map path to WSL: ${windowsPath}`);
  return `/mnt/${match[1].toLowerCase()}/${match[2]}`;
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.error) throw result.error;
  return result;
}

let nativeChecked = false;
const nativeRequired = process.platform === 'win32'
  || process.env.SHADER_FORGE_REQUIRE_NATIVE_SPATIAL === '1';

try {
  let compile;
  let invoke;
  if (process.platform === 'win32') {
    const compiler = run('wsl.exe', ['sh', '-lc', 'command -v g++']);
    if (compiler.status !== 0 && nativeRequired) {
      assert.fail(`Native spatial tool harness requires WSL g++ on Windows.\n${compiler.stderr || compiler.stdout}`);
    }
    if (compiler.status === 0) {
      compile = run('wsl.exe', [
        'g++', '-std=c++20', '-I', toWslPath(includeRoot),
        toWslPath(toolSource), toWslPath(animationSource), '-o', toWslPath(executablePath),
      ]);
      invoke = (root) => run('wsl.exe', [
        toWslPath(executablePath), 'validate', '--animation-root', toWslPath(root),
      ]);
    }
  } else {
    const compiler = run('g++', ['--version']);
    if (compiler.status !== 0 && nativeRequired) {
      assert.fail(`Native spatial tool harness requires g++.\n${compiler.stderr || compiler.stdout}`);
    }
    if (compiler.status === 0) {
      compile = run('g++', [
        '-std=c++20', '-I', includeRoot, toolSource, animationSource, '-o', executablePath,
      ]);
      invoke = (root) => run(executablePath, ['validate', '--animation-root', root]);
    }
  }

  if (compile) {
    assert.equal(compile.status, 0, compile.stderr || compile.stdout);
    const first = invoke(fixtureRoot);
    const second = invoke(fixtureRoot);
    assert.equal(first.status, 0, first.stderr || first.stdout);
    assert.equal(second.status, 0, second.stderr || second.stdout);
    assert.equal(second.stdout, first.stdout, 'spatial validation JSON must be byte-stable across repeated runs');

    const report = JSON.parse(first.stdout);
    assert.equal(report.schema, 'shader_forge.spatial_validation');
    assert.equal(report.schemaVersion, 1);
    assert.match(report.animationRoot, /\/animation fixture$/);
    assert.equal(report.counts.skeletons, 2);
    assert.equal(report.counts.clips, 4);
    assert.equal(report.counts.graphs, 1);
    assert.equal(report.counts.attachmentProfiles, 2);
    assert.deepEqual(report.skeletons.map((entry) => entry.id), ['debug_humanoid', 'humanoid.standard.v2']);
    assert.equal(report.skeletons[0].schemaVersion, 1);
    assert.equal(report.skeletons[0].boneCount, 3);
    assert.equal(report.skeletons[0].socketCount, 0);
    assert.equal(report.skeletons[1].schemaVersion, 2);
    assert.equal(report.skeletons[1].boneCount, 17);
    assert.equal(report.skeletons[1].socketCount, 3);
    assert.deepEqual(
      report.attachmentProfiles.map((entry) => entry.id),
      ['weapon.pistol.mk1.humanoid', 'weapon.rifle.mk1.humanoid'],
    );
    assert.equal(report.attachmentProfiles[1].schemaVersion, 1);
    assert.equal(report.attachmentProfiles[1].skeleton, 'humanoid.standard.v2');
    assert.equal(report.attachmentProfiles[1].itemPrefab, 'weapon.rifle.mk1');
    assert.equal(report.attachmentProfiles[1].mode, 'two_hand');
    assert.equal(report.attachmentProfiles[1].perspective, 'both');
    assert.equal(report.attachmentProfiles[1].motionEnvelopePhaseCount, 2);
    assert.equal(report.attachmentProfiles[1].motionEnvelopeSampleCount, 6);

    const invalid = invoke(invalidRoot);
    assert.notEqual(invalid.status, 0, 'invalid attachment data must fail validation');
    assert.equal(invalid.stdout, '');
    assert.match(invalid.stderr, /shader_forge_spatial: validation failed for/);
    assert.match(invalid.stderr, /Attachment mode must be one_hand or two_hand/);
    nativeChecked = true;
  }
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('Engine spatial validation tool passed.');
console.log('- Verified deterministic JSON and precise invalid-input diagnostics');
console.log('- Verified CLI help and build-first behavior');
console.log(nativeChecked
  ? '- Compiled and ran shader_forge_spatial against isolated fixtures'
  : '- SKIPPED native execution: no supported g++ compiler was available');
