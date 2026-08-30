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
const animationSourceText = fs.readFileSync(animationSource, 'utf8');
const cmakeSource = fs.readFileSync(path.join(repoRoot, 'engine', 'runtime', 'CMakeLists.txt'), 'utf8');

assert.match(cmakeSource, /add_executable\(\s*shader_forge_spatial/);
assert.match(cmakeSource, /src\/spatial_authoring_tool\.cpp/);
assert.match(cliSource, /engine build \[runtime\|spatial\]/);
assert.match(cliSource, /engine spatial validate/);
assert.match(cliSource, /engine spatial cook/);
assert.match(cliSource, /Build it first with/);
assert.match(animationSourceText, /return utf8Path\(left\) < utf8Path\(right\)/);

const help = spawnSync(process.execPath, [cliPath, '--help'], { cwd: repoRoot, encoding: 'utf8' });
assert.equal(help.status, 0, help.stderr || help.stdout);
assert.match(help.stdout, /engine build \[runtime\|spatial\]/);
assert.match(help.stdout, /engine spatial validate \[--animation-root animation\]/);
assert.match(help.stdout, /engine spatial cook \[--animation-root animation\] \[--output-root build\/cooked\]/);

for (const [argumentsList, expectedError] of [
  [['spatial', 'validate', 'other-animation'], /does not accept positional arguments/],
  [['spatial', 'validate', '--animaton-root', 'other-animation'], /Unknown engine spatial validate flag: --animaton-root/],
  [['spatial', 'validate', '--animation-root'], /requires a value for --animation-root/],
  [['spatial', 'cook', 'unexpected'], /does not accept positional arguments/],
  [['spatial', 'cook', '--ouput-root', 'cooked'], /Unknown engine spatial cook flag: --ouput-root/],
  [['spatial', 'cook', '--output-root'], /requires a value for --output-root/],
  [['spatial', 'cook', '--output-root', 'first', '--output-root', 'second'], /Duplicate engine spatial cook flag: --output-root/],
  [['spatial', 'validate', '--animation-root', 'first', '--animation-root', 'second'], /Duplicate engine spatial validate flag: --animation-root/],
  [['spatial', 'validate', '--output-root', 'cooked'], /Unknown engine spatial validate flag: --output-root/],
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
  assert.match(missing.stderr, /Spatial tool was not found/);
  assert.match(missing.stderr, /engine build spatial/);
  const missingCook = spawnSync(
    process.execPath,
    [cliPath, 'spatial', 'cook', '--build-dir', missingBuildRoot],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  assert.notEqual(missingCook.status, 0, 'engine spatial cook must fail when the native binary is absent');
  assert.match(missingCook.stderr, /Spatial tool was not found/);
  assert.match(missingCook.stderr, /engine build spatial/);
} finally {
  fs.rmSync(missingBuildRoot, { recursive: true, force: true });
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shader-forge-spatial-tool-'));
const fixtureRoot = path.join(tempRoot, 'animation fixture');
const invalidRoot = path.join(tempRoot, 'invalid animation');
const invalidUtf8Root = path.join(tempRoot, 'invalid utf8 animation');
const cookedRoot = path.join(tempRoot, 'cooked output');
const executablePath = path.join(tempRoot, 'shader_forge_spatial');
const spatialFixtures = path.join(animationRoot, 'fixtures', 'spatial');

for (const directory of ['skeletons', 'clips', 'graphs']) {
  fs.cpSync(path.join(animationRoot, directory), path.join(fixtureRoot, directory), { recursive: true });
}
for (const directory of ['skeletons', 'clips', 'attachments']) {
  fs.cpSync(path.join(spatialFixtures, directory), path.join(fixtureRoot, directory), { recursive: true });
}
fs.cpSync(fixtureRoot, invalidRoot, { recursive: true });
fs.cpSync(fixtureRoot, invalidUtf8Root, { recursive: true });
const invalidAttachment = path.join(invalidRoot, 'attachments', 'rifle_mk1_humanoid.attachment.toml');
fs.writeFileSync(
  invalidAttachment,
  fs.readFileSync(invalidAttachment, 'utf8').replace('mode = "two_hand"', 'mode = "three_hand"'),
);
fs.appendFileSync(
  path.join(invalidUtf8Root, 'attachments', 'rifle_mk1_humanoid.attachment.toml'),
  Buffer.from([0x0a, 0x23, 0x20, 0xc3, 0x28, 0x0a]),
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

try {
  let compile;
  let invoke;
  if (process.platform === 'win32') {
    const compiler = run('wsl.exe', ['sh', '-lc', 'command -v g++']);
    if (compiler.status !== 0) {
      assert.fail(`Native spatial tool harness requires WSL g++ on Windows.\n${compiler.stderr || compiler.stdout}`);
    }
    if (compiler.status === 0) {
      compile = run('wsl.exe', [
        'g++', '-std=c++20', '-I', toWslPath(includeRoot),
        toWslPath(toolSource), toWslPath(animationSource), '-o', toWslPath(executablePath),
      ]);
      invoke = (args) => run('wsl.exe', [
        toWslPath(executablePath),
        ...args.map((argument) => path.isAbsolute(argument) ? toWslPath(argument) : argument),
      ]);
    }
  } else {
    const compiler = run('g++', ['--version']);
    if (compiler.status !== 0) {
      assert.fail(`Native spatial tool harness requires g++.\n${compiler.stderr || compiler.stdout}`);
    }
    if (compiler.status === 0) {
      compile = run('g++', [
        '-std=c++20', '-I', includeRoot, toolSource, animationSource, '-o', executablePath,
      ]);
      invoke = (args) => run(executablePath, args);
    }
  }

  if (compile) {
    assert.equal(compile.status, 0, compile.stderr || compile.stdout);
    const first = invoke(['validate', '--animation-root', fixtureRoot]);
    const second = invoke(['validate', '--animation-root', fixtureRoot]);
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
    assert.deepEqual(
      report.attachmentProfiles.map((entry) => entry.source),
      [
        'attachments/pistol_mk1_humanoid.attachment.toml',
        'attachments/rifle_mk1_humanoid.attachment.toml',
      ],
    );
    assert.equal(report.attachmentProfiles[1].schemaVersion, 1);
    assert.equal(report.attachmentProfiles[1].skeleton, 'humanoid.standard.v2');
    assert.equal(report.attachmentProfiles[1].itemPrefab, 'weapon.rifle.mk1');
    assert.equal(report.attachmentProfiles[1].mode, 'two_hand');
    assert.equal(report.attachmentProfiles[1].perspective, 'both');
    assert.equal(report.attachmentProfiles[1].motionEnvelopePhaseCount, 2);
    assert.equal(report.attachmentProfiles[1].motionEnvelopeSampleCount, 6);

    const cookedPath = path.join(cookedRoot, 'animation', 'spatial-authoring.bin');
    const firstCook = invoke(['cook', '--animation-root', fixtureRoot, '--output-root', cookedRoot]);
    assert.equal(firstCook.status, 0, firstCook.stderr || firstCook.stdout);
    const firstCookBytes = fs.readFileSync(cookedPath);
    const firstCookResult = JSON.parse(firstCook.stdout);
    assert.equal(firstCookResult.schema, 'shader_forge.spatial_cook_result');
    assert.equal(firstCookResult.schemaVersion, 1);
    assert.equal(firstCookResult.counts.skeletons, 2);
    assert.equal(firstCookResult.counts.attachmentProfiles, 2);
    assert.equal(firstCookResult.cookedPath, 'animation/spatial-authoring.bin');

    const secondCook = invoke(['cook', '--output-root', cookedRoot, '--animation-root', fixtureRoot]);
    assert.equal(secondCook.status, 0, secondCook.stderr || secondCook.stdout);
    const secondCookBytes = fs.readFileSync(cookedPath);
    assert.deepEqual(secondCookBytes, firstCookBytes, 'spatial cooked payload must be byte-stable across repeated runs');

    const cooked = JSON.parse(firstCookBytes.toString('utf8'));
    assert.equal(cooked.schema, 'shader_forge.spatial_authoring_cooked');
    assert.equal(cooked.schemaVersion, 1);
    assert.deepEqual(cooked.skeletons.map((entry) => entry.id), ['debug_humanoid', 'humanoid.standard.v2']);
    assert.equal(cooked.skeletons[0].source, 'skeletons/debug_humanoid.skeleton.toml');
    assert.deepEqual(cooked.skeletons[0].boneIds, ['hips', 'spine', 'head']);
    assert.deepEqual(cooked.skeletons[0].bones, []);
    assert.equal(cooked.skeletons[1].source, 'skeletons/spatial_humanoid.skeleton.toml');
    assert.equal(cooked.skeletons[1].bones.length, 17);
    const hips = cooked.skeletons[1].bones.find((entry) => entry.id === 'hips');
    assert.deepEqual(hips.translation, [0, 0.95, 0]);
    assert.deepEqual(hips.rotation, [0, 0, 0, 1]);
    assert.equal(cooked.skeletons[1].sockets.length, 3);
    const primarySocket = cooked.skeletons[1].sockets.find((entry) => entry.id === 'socket.hand_r.primary');
    assert.equal(primarySocket.bone, 'hand_r');
    assert.equal(primarySocket.role, 'primary_grip');
    assert.deepEqual(cooked.attachmentProfiles.map((entry) => entry.id), [
      'weapon.pistol.mk1.humanoid',
      'weapon.rifle.mk1.humanoid',
    ]);
    const rifle = cooked.attachmentProfiles[1];
    assert.equal(rifle.source, 'attachments/rifle_mk1_humanoid.attachment.toml');
    assert.equal(rifle.primaryGrip.socket, 'socket.hand_r.primary');
    assert.deepEqual(rifle.primaryGrip.translation, [0, -0.015, 0.02]);
    assert.deepEqual(rifle.primaryContact.rotation, [0, 0, 0, 1]);
    assert.deepEqual(rifle.handleAxis.direction, [0, 0, 1]);
    assert.equal(rifle.secondaryHand.enabled, true);
    assert.deepEqual(rifle.secondaryHand.targetTranslation, [0, 0, 0.42]);
    assert.equal(rifle.secondaryHand.jointLimitPolicy, 'clamp_and_diagnose');
    assert.deepEqual(rifle.motionEnvelopes.map((entry) => entry.phase), ['aim', 'idle']);
    assert.deepEqual(rifle.motionEnvelopes[0].normalizedTimes, [0, 0.5, 1]);
    assert.deepEqual(rifle.motionEnvelopes[0].proceduralLayers, ['primary_attachment', 'secondary_hand_ik']);
    if (process.platform === 'win32') {
      assert.equal(firstCookBytes.includes(Buffer.from(toWslPath(fixtureRoot))), false, 'cooked payload must not contain the WSL absolute animation root');
    }
    assert.equal(firstCookBytes.includes(Buffer.from(fixtureRoot)), false, 'cooked payload must not contain the host absolute animation root');
    assert.equal(firstCookBytes.includes(Buffer.from('generation')), false, 'cooked payload must not serialize typed handles');

    fs.writeFileSync(cookedPath, 'sentinel');
    const invalidCook = invoke(['cook', '--animation-root', invalidRoot, '--output-root', cookedRoot]);
    assert.notEqual(invalidCook.status, 0, 'invalid attachment data must fail cooking');
    assert.equal(invalidCook.stdout, '');
    assert.equal(fs.readFileSync(cookedPath, 'utf8'), 'sentinel', 'invalid cooking must preserve an existing cooked payload');
    assert.deepEqual(
      fs.readdirSync(path.dirname(cookedPath)).filter((entry) => entry.includes('.tmp.')),
      [],
      'failed cooking must not leave a temporary payload',
    );

    fs.writeFileSync(cookedPath, 'utf8-sentinel');
    const invalidUtf8Cook = invoke(['cook', '--animation-root', invalidUtf8Root, '--output-root', cookedRoot]);
    assert.notEqual(invalidUtf8Cook.status, 0, 'non-UTF-8 authored data must fail cooking');
    assert.equal(invalidUtf8Cook.stdout, '');
    assert.match(invalidUtf8Cook.stderr, /Animation source file is not valid UTF-8/);
    assert.equal(fs.readFileSync(cookedPath, 'utf8'), 'utf8-sentinel', 'non-UTF-8 input must preserve an existing cooked payload');

    const invalid = invoke(['validate', '--animation-root', invalidRoot]);
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
console.log('- Verified deterministic validation JSON and precise invalid-input diagnostics');
console.log('- Verified byte-stable complete cooking and invalid-input output preservation');
console.log('- Verified CLI strict flags, help, and build-first behavior');
assert.equal(nativeChecked, true, 'native spatial execution is required');
console.log('- Compiled and ran shader_forge_spatial against isolated fixtures');
