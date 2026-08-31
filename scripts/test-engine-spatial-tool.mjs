import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repoRootFromScript } from './lib/harness-utils.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const includeRoot = path.join(repoRoot, 'engine', 'runtime', 'include');
const animationSource = path.join(repoRoot, 'engine', 'runtime', 'src', 'animation_system.cpp');
const dataFoundationSource = path.join(repoRoot, 'engine', 'runtime', 'src', 'data_foundation.cpp');
const toolSource = path.join(repoRoot, 'engine', 'runtime', 'src', 'spatial_authoring_tool.cpp');
const cliPath = path.join(repoRoot, 'tools', 'engine-cli', 'shaderforge.mjs');
const animationRoot = path.join(repoRoot, 'animation');
const cliSource = fs.readFileSync(cliPath, 'utf8');
const animationSourceText = fs.readFileSync(animationSource, 'utf8');
const cmakeSource = fs.readFileSync(path.join(repoRoot, 'engine', 'runtime', 'CMakeLists.txt'), 'utf8');

assert.match(cmakeSource, /add_executable\(\s*shader_forge_spatial/);
assert.match(cmakeSource, /src\/spatial_authoring_tool\.cpp/);
assert.match(cmakeSource, /add_executable\(\s*shader_forge_spatial[\s\S]*src\/data_foundation\.cpp/);
assert.match(cliSource, /engine build \[runtime\|spatial\]/);
assert.match(cliSource, /engine spatial validate/);
assert.match(cliSource, /engine spatial cook/);
assert.match(cliSource, /engine spatial evaluate-rest --attachment/);
assert.match(cliSource, /engine spatial evaluate-sample --attachment/);
assert.match(cliSource, /args\.push\('--phase', String\(flags\.phase\), '--normalized-time', String\(flags\['normalized-time'\]\)\)/);
assert.match(cliSource, /Build it first with/);
assert.match(animationSourceText, /return utf8Path\(left\) < utf8Path\(right\)/);
assert.match(animationSourceText, /evaluateSampledAttachment/);
const toolSourceText = fs.readFileSync(toolSource, 'utf8');
assert.match(toolSourceText, /evaluate-sample/);
assert.match(toolSourceText, /clip_sample/);
assert.match(toolSourceText, /pre_ik_only/);
assert.match(toolSourceText, /DataFoundation/);
assert.match(toolSourceText, /authored_visual_box/);
assert.match(toolSourceText, /--content-root/);
assert.match(toolSourceText, /--data-foundation/);
assert.match(toolSourceText, /prefabSource/);
assert.match(toolSourceText, /procgeoSource/);

const help = spawnSync(process.execPath, [cliPath, '--help'], { cwd: repoRoot, encoding: 'utf8' });
assert.equal(help.status, 0, help.stderr || help.stdout);
assert.match(help.stdout, /engine build \[runtime\|spatial\]/);
assert.match(help.stdout, /engine spatial validate \[--animation-root animation\]/);
assert.match(help.stdout, /engine spatial cook \[--animation-root animation\] \[--output-root build\/cooked\]/);
assert.match(help.stdout, /engine spatial evaluate-rest --attachment <id>/);
assert.match(help.stdout, /engine spatial evaluate-sample --attachment <id> --phase <phase> --normalized-time <value>/);

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
  [['spatial', 'evaluate-rest'], /requires --attachment/],
  [['spatial', 'evaluate-rest', 'weapon.rifle.mk1.humanoid'], /does not accept positional arguments/],
  [['spatial', 'evaluate-rest', '--attachment'], /requires a value for --attachment/],
  [['spatial', 'evaluate-rest', '--attachement', 'weapon.rifle'], /Unknown engine spatial evaluate-rest flag: --attachement/],
  [['spatial', 'evaluate-rest', '--attachment', 'first', '--attachment', 'second'], /Duplicate engine spatial evaluate-rest flag: --attachment/],
  [['spatial', 'evaluate-rest', '--attachment', 'weapon.rifle', '--output-root', 'cooked'], /Unknown engine spatial evaluate-rest flag: --output-root/],
  [['spatial', 'evaluate-sample'], /requires --attachment/],
  [['spatial', 'evaluate-sample', '--attachment', 'weapon.rifle'], /requires --phase/],
  [['spatial', 'evaluate-sample', '--attachment', 'weapon.rifle', '--phase', 'idle'], /requires --normalized-time/],
  [['spatial', 'evaluate-sample', '--attachment', 'weapon.rifle', '--phase', 'idle', '--normalized-time'], /requires a value for --normalized-time/],
  [['spatial', 'evaluate-sample', '--attachment', 'weapon.rifle', '--phase', 'idle', '--normalized-time', '0.5', '--phase', 'aim'], /Duplicate engine spatial evaluate-sample flag: --phase/],
  [['spatial', 'evaluate-sample', '--attachment', 'weapon.rifle', '--phase', 'idle', '--normalized-time', '0.5', '--output-root', 'cooked'], /Unknown engine spatial evaluate-sample flag: --output-root/],
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
  const missingEvaluate = spawnSync(
    process.execPath,
    [cliPath, 'spatial', 'evaluate-rest', '--attachment', 'weapon.rifle.mk1.humanoid', '--build-dir', missingBuildRoot],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  assert.notEqual(missingEvaluate.status, 0, 'engine spatial evaluate-rest must fail when the native binary is absent');
  assert.match(missingEvaluate.stderr, /Spatial tool was not found/);
  const missingSample = spawnSync(
    process.execPath,
    [cliPath, 'spatial', 'evaluate-sample', '--attachment', 'weapon.rifle.mk1.humanoid', '--phase', 'idle', '--normalized-time', '0.5', '--build-dir', missingBuildRoot],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  assert.notEqual(missingSample.status, 0, 'engine spatial evaluate-sample must fail when the native binary is absent');
  assert.match(missingSample.stderr, /Spatial tool was not found/);
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
const foundationPath = path.join(spatialFixtures, 'data', 'foundation', 'engine-data-layout.toml');
const contentRoot = path.join(tempRoot, 'spatial content');
const rifleBox = {
  procgeoId: 'weapon_rifle_mk1',
  width: 0.125,
  height: 0.25,
  depth: 1,
};
const rifleLocalCorners = [
  [-rifleBox.width / 2, -rifleBox.height / 2, -rifleBox.depth / 2],
  [rifleBox.width / 2, -rifleBox.height / 2, -rifleBox.depth / 2],
  [rifleBox.width / 2, rifleBox.height / 2, -rifleBox.depth / 2],
  [-rifleBox.width / 2, rifleBox.height / 2, -rifleBox.depth / 2],
  [-rifleBox.width / 2, -rifleBox.height / 2, rifleBox.depth / 2],
  [rifleBox.width / 2, -rifleBox.height / 2, rifleBox.depth / 2],
  [rifleBox.width / 2, rifleBox.height / 2, rifleBox.depth / 2],
  [-rifleBox.width / 2, rifleBox.height / 2, rifleBox.depth / 2],
];

for (const directory of ['skeletons', 'clips', 'graphs']) {
  fs.cpSync(path.join(animationRoot, directory), path.join(fixtureRoot, directory), { recursive: true });
}
for (const directory of ['skeletons', 'clips', 'attachments']) {
  fs.cpSync(path.join(spatialFixtures, directory), path.join(fixtureRoot, directory), { recursive: true });
}
for (const directory of ['scenes', 'prefabs', 'data', 'effects', 'procgeo']) {
  fs.mkdirSync(path.join(contentRoot, directory), { recursive: true });
}
fs.cpSync(
  path.join(spatialFixtures, 'content', 'prefabs'),
  path.join(contentRoot, 'prefabs'),
  { recursive: true },
);
fs.cpSync(
  path.join(spatialFixtures, 'content', 'procgeo'),
  path.join(contentRoot, 'procgeo'),
  { recursive: true },
);
fs.writeFileSync(path.join(contentRoot, 'prefabs', 'README.txt'), 'this is not authored TOML');
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
        toWslPath(toolSource), toWslPath(animationSource), toWslPath(dataFoundationSource),
        '-o', toWslPath(executablePath),
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
        '-std=c++20', '-I', includeRoot, toolSource, animationSource, dataFoundationSource, '-o', executablePath,
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
    assert.equal(report.attachmentProfiles[1].schemaVersion, 2);
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
    assert.equal(cooked.schemaVersion, 2);
    assert.deepEqual(cooked.skeletons.map((entry) => entry.id), ['debug_humanoid', 'humanoid.standard.v2']);
    assert.equal(cooked.skeletons[0].source, 'skeletons/debug_humanoid.skeleton.toml');
    assert.deepEqual(cooked.skeletons[0].boneIds, ['hips', 'spine', 'head']);
    assert.deepEqual(cooked.skeletons[0].bones, []);
    assert.equal(cooked.skeletons[1].source, 'skeletons/spatial_humanoid.skeleton.toml');
    assert.equal(cooked.skeletons[1].bones.length, 17);
    const hips = cooked.skeletons[1].bones.find((entry) => entry.id === 'hips');
    assert.deepEqual(hips.translation, [0, 0.95, 0]);
    assert.deepEqual(hips.rotation, [0, 0, 0, 1]);
    assert.equal(hips.jointLimit, null);
    assert.equal(hips.diagnosticCapsule, null);
    const cookedUpperArmL = cooked.skeletons[1].bones.find((entry) => entry.id === 'upper_arm_l');
    assert.deepEqual(cookedUpperArmL.jointLimit, {
      kind: 'cone_twist',
      twistAxis: [1, 0, 0],
      swingDegrees: 120,
      twistMinDegrees: -90,
      twistMaxDegrees: 90,
    });
    assert.deepEqual(cookedUpperArmL.diagnosticCapsule, {
      center: [0.14, 0, 0],
      axis: [1, 0, 0],
      radius: 0.055,
      halfLength: 0.14,
    });
    assert.equal(cooked.skeletons[1].bones.filter((entry) => entry.jointLimit).length, 6);
    assert.equal(cooked.skeletons[1].bones.filter((entry) => entry.diagnosticCapsule).length, 7);
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
    assert.equal(rifle.secondaryHand.poleSpace, 'item');
    assert.equal(rifle.secondaryHand.jointLimitPolicy, 'diagnose');
    assert.deepEqual(rifle.motionEnvelopes.map((entry) => entry.phase), ['aim', 'idle']);
    assert.deepEqual(rifle.motionEnvelopes[0].normalizedTimes, [0, 0.5, 1]);
    assert.deepEqual(rifle.motionEnvelopes[0].proceduralLayers, ['primary_attachment', 'secondary_hand_ik']);
    if (process.platform === 'win32') {
      assert.equal(firstCookBytes.includes(Buffer.from(toWslPath(fixtureRoot))), false, 'cooked payload must not contain the WSL absolute animation root');
    }
    assert.equal(firstCookBytes.includes(Buffer.from(fixtureRoot)), false, 'cooked payload must not contain the host absolute animation root');
    assert.equal(firstCookBytes.includes(Buffer.from('generation')), false, 'cooked payload must not serialize typed handles');

    const withContent = (args) => [
      ...args,
      '--content-root', contentRoot,
      '--data-foundation', foundationPath,
    ];
    const evaluate = (...args) => {
      const result = invoke(withContent(['evaluate-rest', ...args]));
      assert.equal(result.status, 0, result.stderr || result.stdout);
      return result;
    };
    for (const [name, unsafePrefabSubdir] of [
      ['traversal', '../prefabs'],
      ['absolute', process.platform === 'win32' ? toWslPath(contentRoot) : contentRoot],
    ]) {
      const unsafeFoundationPath = path.join(tempRoot, `${name} foundation.toml`);
      fs.writeFileSync(
        unsafeFoundationPath,
        fs.readFileSync(foundationPath, 'utf8')
          .replace('prefab_subdir = "prefabs"', `prefab_subdir = "${unsafePrefabSubdir}"`),
      );
      const unsafeFoundationResult = invoke([
        'evaluate-rest', '--animation-root', fixtureRoot,
        '--attachment', 'weapon.rifle.mk1.humanoid',
        '--content-root', contentRoot,
        '--data-foundation', unsafeFoundationPath,
      ]);
      assert.notEqual(unsafeFoundationResult.status, 0, `${name} content subdirectory must be rejected`);
      assert.equal(unsafeFoundationResult.stdout, '');
      assert.match(unsafeFoundationResult.stderr, /Content subdirectory must stay under content root/);
    }
    const findById = (entries, id) => entries.find((entry) => entry.id === id);
    const jointLimitObjectKeys = [
      'status', 'reason', 'policy', 'evaluatedBoneCount', 'violationCount',
      'maxViolationDegrees', 'withinLimits', 'bones',
    ];
    const jointLimitBoneKeys = [
      'boneId', 'role', 'swingDegrees', 'swingLimitDegrees', 'twistDegrees',
      'twistMinDegrees', 'twistMaxDegrees', 'swingViolationDegrees', 'twistViolationDegrees', 'withinLimits',
    ];
    const restJointLimitBone = (boneId, swingLimitDegrees, twistMinDegrees, twistMaxDegrees) => ({
      boneId,
      role: boneId,
      swingDegrees: 0,
      swingLimitDegrees,
      twistDegrees: 0,
      twistMinDegrees,
      twistMaxDegrees,
      swingViolationDegrees: 0,
      twistViolationDegrees: 0,
      withinLimits: true,
    });
    const expectedRestJointLimits = {
      status: 'available',
      reason: null,
      policy: 'diagnose',
      evaluatedBoneCount: 6,
      violationCount: 0,
      maxViolationDegrees: 0,
      withinLimits: true,
      bones: [
        restJointLimitBone('hand_l', 70, -80, 80),
        restJointLimitBone('hand_r', 70, -80, 80),
        restJointLimitBone('lower_arm_l', 145, -15, 15),
        restJointLimitBone('lower_arm_r', 145, -15, 15),
        restJointLimitBone('upper_arm_l', 120, -90, 90),
        restJointLimitBone('upper_arm_r', 120, -90, 90),
      ],
    };
    const assertJointLimitObjectShape = (jointLimits, message) => {
      assert.deepEqual(Object.keys(jointLimits), jointLimitObjectKeys, message);
      assert.equal(typeof jointLimits.status, 'string', message);
      assert.ok(jointLimits.reason === null || typeof jointLimits.reason === 'string', message);
      assert.equal(typeof jointLimits.policy, 'string', message);
      assert.equal(jointLimits.evaluatedBoneCount, jointLimits.bones.length, message);
      jointLimits.bones.forEach((bone, index) => {
        assert.deepEqual(Object.keys(bone), jointLimitBoneKeys, `${message} bone ${index}`);
      });
    };
    const assertJointLimitNumericConsistency = (jointLimits, message) => {
      assert.equal(typeof jointLimits.evaluatedBoneCount, 'number', message);
      assert.equal(typeof jointLimits.violationCount, 'number', message);
      assert.ok(Number.isFinite(jointLimits.maxViolationDegrees), message);
      const numbers = jointLimits.bones.flatMap((bone) => [
        bone.swingDegrees, bone.swingLimitDegrees, bone.twistDegrees,
        bone.twistMinDegrees, bone.twistMaxDegrees, bone.swingViolationDegrees, bone.twistViolationDegrees,
      ]);
      numbers.forEach((value) => {
        assert.equal(typeof value, 'number', message);
        assert.ok(Number.isFinite(value), message);
      });
      const violationCount = jointLimits.bones.filter((bone) => bone.withinLimits === false).length;
      assert.equal(jointLimits.violationCount, violationCount, message);
      const maxViolation = jointLimits.bones.reduce(
        (current, bone) => Math.max(current, bone.swingViolationDegrees, bone.twistViolationDegrees),
        0,
      );
      assert.ok(Math.abs(jointLimits.maxViolationDegrees - maxViolation) <= 1e-12, message);
      if (jointLimits.status === 'available') {
        assert.equal(jointLimits.reason, null, message);
        assert.equal(typeof jointLimits.withinLimits, 'boolean', message);
        assert.equal(jointLimits.withinLimits, jointLimits.violationCount === 0, message);
      } else {
        assert.equal(jointLimits.withinLimits, null, message);
      }
      jointLimits.bones.forEach((bone, index) => {
        assert.equal(
          bone.withinLimits,
          bone.swingViolationDegrees === 0 && bone.twistViolationDegrees === 0,
          `${message} bone ${index} withinLimits`,
        );
      });
    };
    const assertVectorClose = (actual, expected, message = 'vector mismatch') => {
      assert.equal(actual.length, expected.length, message);
      actual.forEach((value, index) => {
        assert.ok(Math.abs(value - expected[index]) <= 1e-12, `${message} at ${index}: ${value}`);
      });
    };
    const transformBoxCorner = (local, world) => [
      world.translation[0] + local[0] * world.axes.x[0] + local[1] * world.axes.y[0] + local[2] * world.axes.z[0],
      world.translation[1] + local[0] * world.axes.x[1] + local[1] * world.axes.y[1] + local[2] * world.axes.z[1],
      world.translation[2] + local[0] * world.axes.x[2] + local[1] * world.axes.y[2] + local[2] * world.axes.z[2],
    ];
    const assertAuthoredVisualBox = (evaluation, message) => {
      const geometry = evaluation.item.geometry;
      assert.equal(geometry.status, 'available', message);
      assert.equal(geometry.kind, 'authored_visual_box', message);
      assert.equal(geometry.procgeoId, rifleBox.procgeoId, message);
      assert.deepEqual(Object.keys(geometry), [
        'status', 'kind', 'procgeoId', 'dimensionsMeters', 'worldCorners',
      ]);
      assertVectorClose(geometry.dimensionsMeters, [rifleBox.width, rifleBox.height, rifleBox.depth], `${message} dimensions`);
      assert.equal(geometry.worldCorners.length, 8, `${message} corner count`);
      const expectedCorners = rifleLocalCorners.map((local) => transformBoxCorner(local, evaluation.item.world));
      expectedCorners.forEach((expected, index) => {
        assertVectorClose(geometry.worldCorners[index], expected, `${message} corner ${index}`);
      });
      assert.equal(JSON.stringify(geometry).includes('collision'), false, `${message} must not call the box collision geometry`);
    };
    const firstRest = evaluate('--animation-root', fixtureRoot, '--attachment', 'weapon.rifle.mk1.humanoid');
    const secondRest = evaluate('--attachment', 'weapon.rifle.mk1.humanoid', '--animation-root', fixtureRoot);
    assert.equal(secondRest.stdout, firstRest.stdout, 'rest evaluation must be byte-stable');
    const rest = JSON.parse(firstRest.stdout);
    assert.equal(rest.schema, 'shader_forge.spatial_attachment_evaluation');
    assert.equal(rest.schemaVersion, 2);
    assert.deepEqual(rest.pose, { kind: 'rest', sampled: false });
    assert.deepEqual(rest.coordinateSystem, {
      units: 'meters', handedness: 'right', up: '+Y', forward: '+Z', quaternionOrder: 'xyzw',
    });
    assert.equal(rest.attachment.id, 'weapon.rifle.mk1.humanoid');
    assertAuthoredVisualBox(rest, 'rifle rest visual box');
    assert.deepEqual(rest.diagnostics.clipping, {
      status: 'unavailable',
      reason: 'item_and_capsule_geometry_not_integrated',
    });
    assertJointLimitObjectShape(rest.diagnostics.jointLimits, 'rifle rest jointLimits shape');
    assert.deepEqual(rest.diagnostics.jointLimits, expectedRestJointLimits);
    assert.deepEqual(
      JSON.parse(secondRest.stdout).diagnostics.jointLimits,
      rest.diagnostics.jointLimits,
      'rest jointLimits must be byte-stable',
    );
    assertVectorClose(findById(rest.bones, 'hand_r').world.translation, [-0.78, 1.47, 0], 'hand_r world');
    assertVectorClose(findById(rest.sockets, 'socket.hand_r.primary').world.translation, [-0.78, 1.47, 0.08], 'primary socket world');
    assertVectorClose(rest.item.world.translation, [-0.78, 1.455, 0.1], 'item world');
    assertVectorClose(rest.item.primaryContactWorld.translation, [-0.78, 1.455, 0.1], 'primary contact world');
    assertVectorClose(rest.item.handleAxisWorld.origin, [-0.78, 1.455, 0.1], 'handle origin world');
    assertVectorClose(rest.hands.secondary.targetWorld.translation, [-0.78, 1.455, 0.52], 'secondary target world');
    assertVectorClose(rest.hands.secondary.palmWorld.translation, [0.78, 1.47, 0.04], 'secondary palm world');
    assert.ok(Math.abs(rest.hands.secondary.preSolveDistanceMeters - 1.6322453859637651) <= 1e-12);
    assertVectorClose(rest.hands.secondary.pole.translation, [0, -0.2, 0.25], 'authored pole');
    assert.equal(rest.hands.secondary.pole.space, 'item');
    assertVectorClose(rest.hands.secondary.pole.world, [-0.78, 1.255, 0.35], 'resolved item-space pole');
    assert.equal(rest.hands.secondary.pole.reason, null);
    assert.equal(rest.diagnostics.secondaryIk.status, 'unavailable');
    assert.equal(rest.diagnostics.secondaryIk.reason, 'rest_pose_unsolved');
    assert.ok(rest.limitations.includes('not_review_evidence'));
    const handSegment = rest.segments.find((segment) => segment.boneId === 'hand_r');
    assertVectorClose(handSegment.from, [-0.54, 1.47, 0], 'hand segment start');
    assertVectorClose(handSegment.to, [-0.78, 1.47, 0], 'hand segment end');
    assert.deepEqual(Object.keys(rest.pose), ['kind', 'sampled']);
    assert.equal(rest.limitations.includes('rest_pose_only'), true);
    assert.equal(rest.limitations.includes('pre_ik_only'), false);

    const pistolRest = JSON.parse(evaluate(
      '--animation-root', fixtureRoot, '--attachment', 'weapon.pistol.mk1.humanoid',
    ).stdout);
    assert.deepEqual(pistolRest.item.geometry, {
      status: 'unavailable',
      reason: 'item_prefab_visual_geometry_not_box',
    });
    assert.ok(pistolRest.bones.length > 0, 'pistol rest must keep compatible skeletal evidence');
    assert.ok(pistolRest.limitations.includes('item_mesh_unavailable'));
    assert.ok(pistolRest.limitations.includes('not_review_evidence'));
    assert.deepEqual(pistolRest.diagnostics.clipping, {
      status: 'unavailable',
      reason: 'item_and_capsule_geometry_not_integrated',
    });
    assert.deepEqual(pistolRest.diagnostics.jointLimits, expectedRestJointLimits);
    const missingItemRoot = path.join(tempRoot, 'missing item animation');
    fs.cpSync(fixtureRoot, missingItemRoot, { recursive: true });
    const missingItemAttachment = path.join(
      missingItemRoot, 'attachments', 'pistol_mk1_humanoid.attachment.toml',
    );
    fs.writeFileSync(
      missingItemAttachment,
      fs.readFileSync(missingItemAttachment, 'utf8')
        .replace('item_prefab = "weapon.pistol.mk1"', 'item_prefab = "weapon.missing"'),
    );
    const missingItemRest = JSON.parse(evaluate(
      '--animation-root', missingItemRoot, '--attachment', 'weapon.pistol.mk1.humanoid',
    ).stdout);
    assert.deepEqual(missingItemRest.item.geometry, {
      status: 'unavailable',
      reason: 'item_prefab_not_found',
    });
    const duplicateContentRoot = path.join(tempRoot, 'duplicate prefab content');
    fs.cpSync(contentRoot, duplicateContentRoot, { recursive: true });
    fs.copyFileSync(
      path.join(duplicateContentRoot, 'prefabs', 'weapon_rifle_mk1.prefab.toml'),
      path.join(duplicateContentRoot, 'prefabs', 'weapon_rifle_duplicate.prefab.toml'),
    );
    const duplicatePrefabResult = invoke([
      'evaluate-rest', '--animation-root', fixtureRoot,
      '--attachment', 'weapon.rifle.mk1.humanoid',
      '--content-root', duplicateContentRoot,
      '--data-foundation', foundationPath,
    ]);
    assert.equal(duplicatePrefabResult.status, 0, duplicatePrefabResult.stderr || duplicatePrefabResult.stdout);
    assert.deepEqual(JSON.parse(duplicatePrefabResult.stdout).item.geometry, {
      status: 'unavailable',
      reason: 'item_prefab_ambiguous',
    });
    const nonFiniteContentRoot = path.join(tempRoot, 'non-finite procgeo content');
    fs.cpSync(contentRoot, nonFiniteContentRoot, { recursive: true });
    const nonFiniteProcgeo = path.join(
      nonFiniteContentRoot, 'procgeo', 'weapon_rifle_mk1.procgeo.toml',
    );
    fs.writeFileSync(
      nonFiniteProcgeo,
      fs.readFileSync(nonFiniteProcgeo, 'utf8').replace('width = 0.125', 'width = nan'),
    );
    const nonFiniteResult = invoke([
      'evaluate-rest', '--animation-root', fixtureRoot,
      '--attachment', 'weapon.rifle.mk1.humanoid',
      '--content-root', nonFiniteContentRoot,
      '--data-foundation', foundationPath,
    ]);
    assert.equal(nonFiniteResult.status, 0, nonFiniteResult.stderr || nonFiniteResult.stdout);
    assert.deepEqual(JSON.parse(nonFiniteResult.stdout).item.geometry, {
      status: 'unavailable',
      reason: 'item_prefab_visual_geometry_unavailable',
    });

    const sample = (...args) => {
      const result = invoke(withContent(['evaluate-sample', ...args]));
      assert.equal(result.status, 0, result.stderr || result.stdout);
      return result;
    };
    const firstSample = sample(
      '--animation-root', fixtureRoot, '--attachment', 'weapon.rifle.mk1.humanoid',
      '--phase', 'idle', '--normalized-time', '0.5',
    );
    const secondSample = sample(
      '--normalized-time', '0.5', '--phase', 'idle',
      '--attachment', 'weapon.rifle.mk1.humanoid', '--animation-root', fixtureRoot,
    );
    assert.equal(secondSample.stdout, firstSample.stdout, 'sampled evaluation must be byte-stable');
    const sampled = JSON.parse(firstSample.stdout);
    assert.equal(sampled.schema, 'shader_forge.spatial_attachment_evaluation');
    assert.equal(sampled.schemaVersion, 2);
    assert.deepEqual(sampled.pose, {
      kind: 'clip_sample',
      sampled: true,
      phase: 'idle',
      clip: 'rifle_ready',
      normalizedTime: 0.5,
      proceduralLayersRequested: ['primary_attachment', 'secondary_hand_ik'],
      proceduralLayersApplied: ['primary_attachment', 'secondary_hand_ik'],
      proceduralLayersUnavailable: [],
    });
    assert.deepEqual(sampled.coordinateSystem, rest.coordinateSystem);
    assert.deepEqual(sampled.attachment, rest.attachment);
    assertAuthoredVisualBox(sampled, 'rifle sampled visual box');
    assert.deepEqual(sampled.item.geometry.dimensionsMeters, rest.item.geometry.dimensionsMeters);
    assert.notDeepEqual(sampled.item.geometry.worldCorners, rest.item.geometry.worldCorners);
    assert.notDeepEqual(sampled.item.world.translation, rest.item.world.translation, 'sampled item must move at idle 0.5');
    assert.notDeepEqual(
      findById(sampled.sockets, 'socket.hand_r.primary').world.translation,
      findById(rest.sockets, 'socket.hand_r.primary').world.translation,
      'sampled primary socket must move at idle 0.5',
    );
    assertJointLimitObjectShape(sampled.diagnostics.jointLimits, 'rifle sampled jointLimits shape');
    assert.equal(sampled.diagnostics.jointLimits.status, 'available');
    assert.equal(sampled.diagnostics.jointLimits.policy, rest.diagnostics.jointLimits.policy);
    assert.deepEqual(
      sampled.diagnostics.jointLimits.bones.map((bone) => bone.boneId),
      rest.diagnostics.jointLimits.bones.map((bone) => bone.boneId),
      'sampled jointLimits must keep native bone order',
    );
    assertJointLimitNumericConsistency(sampled.diagnostics.jointLimits, 'rifle sampled jointLimits');
    assert.deepEqual(
      JSON.parse(secondSample.stdout).diagnostics.jointLimits,
      sampled.diagnostics.jointLimits,
      'sampled jointLimits must be byte-stable',
    );
    assert.equal(sampled.diagnostics.secondaryIk.status, 'applied');
    assert.equal(sampled.diagnostics.secondaryIk.solved, true);
    assert.equal(sampled.diagnostics.secondaryIk.reachable, false);
    assert.equal('reason' in sampled.diagnostics.secondaryIk, false);
    assert.ok(Math.abs(
      sampled.diagnostics.secondaryIk.targetDistanceMeters
      - sampled.diagnostics.secondaryIk.maxReachMeters
      - sampled.diagnostics.secondaryIk.reachResidualMeters
    ) <= 1e-12);
    assert.ok(Math.abs(sampled.diagnostics.secondaryIk.minReachMeters - 0.04) <= 1e-12);
    assert.ok(Math.abs(sampled.diagnostics.secondaryIk.maxReachMeters - 0.52) <= 1e-12);
    assert.equal(sampled.diagnostics.secondaryIk.reachToleranceMeters, 0.04);
    assert.equal(sampled.diagnostics.secondaryIk.reachWithinTolerance, false);
    assert.equal(sampled.diagnostics.secondaryIk.contactToleranceMeters, 0.015);
    assert.equal(sampled.diagnostics.secondaryIk.contactWithinTolerance, false);
    assert.ok(sampled.diagnostics.secondaryIk.postSolveDistanceMeters > 0.015);
    assert.equal(sampled.diagnostics.secondaryIk.postSolveAngleDegrees, 0);
    assert.equal(sampled.diagnostics.secondaryIk.angleToleranceDegrees, 8);
    assert.equal(sampled.diagnostics.secondaryIk.angleWithinTolerance, true);
    assert.equal(sampled.diagnostics.secondaryIk.withinTolerance, false);
    assert.deepEqual(sampled.limitations, [
      'sampled_attachment_schematic_only',
      'not_review_evidence',
      'item_mesh_unavailable',
    ]);
    assert.equal(JSON.stringify(sampled).includes('review packet'), false);
    assert.equal(JSON.stringify(sampled).includes('capture'), false);
    assert.deepEqual(Object.keys(sampled).sort(), Object.keys(rest).sort());
    assert.deepEqual(rest.pose, { kind: 'rest', sampled: false });
    assert.deepEqual(rest.limitations, [
      'rest_pose_only',
      'not_review_evidence',
      'item_mesh_unavailable',
      'secondary_hand_ik_unavailable',
    ]);

    const reachableRoot = path.join(tempRoot, 'reachable IK animation');
    fs.cpSync(fixtureRoot, reachableRoot, { recursive: true });
    const reachableAttachmentPath = path.join(
      reachableRoot, 'attachments', 'rifle_mk1_humanoid.attachment.toml',
    );
    fs.writeFileSync(
      reachableAttachmentPath,
      fs.readFileSync(reachableAttachmentPath, 'utf8')
        .replace('translation = [0.0, 0.0, 0.42]', 'translation = [1.0, 0.0, 0.15]')
        .replace('translation = [0.0, -0.2, 0.25]', 'translation = [0.8, -0.2, 0.15]'),
    );
    const reachableResult = sample(
      '--animation-root', reachableRoot, '--attachment', 'weapon.rifle.mk1.humanoid',
      '--phase', 'idle', '--normalized-time', '0.5',
    );
    const reachable = JSON.parse(reachableResult.stdout);
    const reachableIk = reachable.diagnostics.secondaryIk;
    assert.equal(reachableIk.status, 'applied');
    assert.equal(reachableIk.solved, true);
    assert.equal(reachableIk.reachable, true);
    assert.ok(reachableIk.preSolveDistanceMeters > reachableIk.postSolveDistanceMeters);
    assert.ok(reachableIk.reachResidualMeters <= 1e-12);
    assert.equal(reachableIk.reachWithinTolerance, true);
    assert.ok(reachableIk.postSolveDistanceMeters <= 1e-12);
    assert.equal(reachableIk.contactWithinTolerance, true);
    assert.ok(reachableIk.postSolveAngleDegrees <= 1e-10);
    assert.equal(reachableIk.angleWithinTolerance, true);
    assert.equal(reachableIk.withinTolerance, true);
    assert.deepEqual(reachable.pose.proceduralLayersApplied, ['primary_attachment', 'secondary_hand_ik']);
    assert.deepEqual(reachable.pose.proceduralLayersUnavailable, []);
    assert.equal(reachable.limitations.includes('pre_ik_only'), false);
    assert.equal(reachable.limitations.includes('secondary_hand_ik_unavailable'), false);
    assertVectorClose(
      reachable.hands.secondary.palmWorld.translation,
      reachable.hands.secondary.targetWorld.translation,
      'reachable palm contact',
    );
    assertVectorClose(
      reachable.hands.secondary.palmWorld.rotation,
      reachable.hands.secondary.targetWorld.rotation,
      'reachable palm orientation',
    );
    const reachableUpper = findById(reachable.bones, 'upper_arm_l');
    const reachableLower = findById(reachable.bones, 'lower_arm_l');
    const reachableHand = findById(reachable.bones, 'hand_l');
    const distance = (left, right) => Math.hypot(
      right[0] - left[0], right[1] - left[1], right[2] - left[2],
    );
    assert.ok(Math.abs(distance(reachableUpper.world.translation, reachableLower.world.translation) - 0.28) <= 1e-12);
    assert.ok(Math.abs(distance(reachableLower.world.translation, reachableHand.world.translation) - 0.24) <= 1e-12);
    const subtract = (left, right) => left.map((value, index) => value - right[index]);
    const dot = (left, right) => left.reduce((sum, value, index) => sum + value * right[index], 0);
    const scale = (value, amount) => value.map((entry) => entry * amount);
    const shoulderToHand = subtract(reachableHand.world.translation, reachableUpper.world.translation);
    const axisLength = Math.hypot(...shoulderToHand);
    const axis = scale(shoulderToHand, 1 / axisLength);
    const poleFromShoulder = subtract(reachable.hands.secondary.pole.world, reachableUpper.world.translation);
    const elbowFromShoulder = subtract(reachableLower.world.translation, reachableUpper.world.translation);
    const poleOffAxis = subtract(poleFromShoulder, scale(axis, dot(poleFromShoulder, axis)));
    const elbowOffAxis = subtract(elbowFromShoulder, scale(axis, dot(elbowFromShoulder, axis)));
    assert.ok(dot(poleOffAxis, elbowOffAxis) > 0, 'elbow must bend toward the authored item-space pole');

    const v1Root = path.join(tempRoot, 'schema v1 compatibility animation');
    fs.cpSync(fixtureRoot, v1Root, { recursive: true });
    const v1AttachmentPath = path.join(v1Root, 'attachments', 'rifle_mk1_humanoid.attachment.toml');
    fs.writeFileSync(
      v1AttachmentPath,
      fs.readFileSync(v1AttachmentPath, 'utf8')
        .replace('schema_version = 2', 'schema_version = 1')
        .replace(/\r?\nspace = "item"/, ''),
    );
    const v1Sample = JSON.parse(sample(
      '--animation-root', v1Root, '--attachment', 'weapon.rifle.mk1.humanoid',
      '--phase', 'idle', '--normalized-time', '0.5',
    ).stdout);
    assert.equal(v1Sample.schemaVersion, 1);
    assert.deepEqual(v1Sample.pose.proceduralLayersApplied, ['primary_attachment']);
    assert.deepEqual(v1Sample.pose.proceduralLayersUnavailable, ['secondary_hand_ik']);
    assert.deepEqual(v1Sample.hands.secondary.pole, {
      translation: [0, -0.2, 0.25],
      space: 'unresolved',
      world: null,
      reason: 'pole_space_not_authored',
    });
    assert.deepEqual(v1Sample.diagnostics.secondaryIk, {
      status: 'unavailable', reason: 'secondary_hand_ik_not_implemented',
    });
    assert.deepEqual(v1Sample.limitations, [
      'pre_ik_only', 'not_review_evidence', 'item_mesh_unavailable',
      'secondary_hand_ik_unavailable',
    ]);
    const v1CookRoot = path.join(tempRoot, 'schema v1 cooked output');
    const v1Cook = invoke(['cook', '--animation-root', v1Root, '--output-root', v1CookRoot]);
    assert.equal(v1Cook.status, 0, v1Cook.stderr || v1Cook.stdout);
    const v1Cooked = JSON.parse(fs.readFileSync(path.join(v1CookRoot, 'animation', 'spatial-authoring.bin')));
    assert.equal(v1Cooked.schemaVersion, 1);
    assert.equal('poleSpace' in v1Cooked.attachmentProfiles[1].secondaryHand, false);

    const collinearRoot = path.join(tempRoot, 'collinear pole animation');
    fs.cpSync(reachableRoot, collinearRoot, { recursive: true });
    const collinearAttachmentPath = path.join(
      collinearRoot, 'attachments', 'rifle_mk1_humanoid.attachment.toml',
    );
    fs.writeFileSync(
      collinearAttachmentPath,
      fs.readFileSync(collinearAttachmentPath, 'utf8')
        .replace('translation = [0.8, -0.2, 0.15]', 'translation = [1.0, 0.0, 0.11]'),
    );
    const collinear = invoke(withContent([
      'evaluate-sample', '--animation-root', collinearRoot,
      '--attachment', 'weapon.rifle.mk1.humanoid', '--phase', 'idle', '--normalized-time', '0.5',
    ]));
    assert.notEqual(collinear.status, 0);
    assert.equal(collinear.stdout, '');
    assert.match(collinear.stderr, /pole is collinear with the shoulder-target line/);

    const zeroLengthRoot = path.join(tempRoot, 'zero length IK animation');
    fs.cpSync(reachableRoot, zeroLengthRoot, { recursive: true });
    const zeroLengthSkeletonPath = path.join(zeroLengthRoot, 'skeletons', 'spatial_humanoid.skeleton.toml');
    fs.writeFileSync(
      zeroLengthSkeletonPath,
      fs.readFileSync(zeroLengthSkeletonPath, 'utf8')
        .replace('translation = [0.28, 0.0, 0.0]', 'translation = [0.0, 0.0, 0.0]'),
    );
    const zeroLength = invoke(withContent([
      'evaluate-sample', '--animation-root', zeroLengthRoot,
      '--attachment', 'weapon.rifle.mk1.humanoid', '--phase', 'idle', '--normalized-time', '0.5',
    ]));
    assert.notEqual(zeroLength.status, 0);
    assert.equal(zeroLength.stdout, '');
    assert.match(zeroLength.stderr, /segment length is zero or non-finite/);

    const oneHandRoot = path.join(tempRoot, 'one hand animation');
    fs.cpSync(fixtureRoot, oneHandRoot, { recursive: true });
    fs.appendFileSync(
      path.join(oneHandRoot, 'attachments', 'pistol_mk1_humanoid.attachment.toml'),
      '\n[motion_envelope.idle]\nclip = "rifle_ready"\nnormalized_times = [0.5]\n',
    );
    const oneHandSample = invoke(withContent([
      'evaluate-sample', '--animation-root', oneHandRoot, '--attachment', 'weapon.pistol.mk1.humanoid',
      '--phase', 'idle', '--normalized-time', '0.5',
    ]));
    assert.equal(oneHandSample.status, 0, oneHandSample.stderr || oneHandSample.stdout);
    const oneHandSampled = JSON.parse(oneHandSample.stdout);
    assert.deepEqual(oneHandSampled.pose.proceduralLayersRequested, ['primary_attachment']);
    assert.deepEqual(oneHandSampled.pose.proceduralLayersApplied, ['primary_attachment']);
    assert.deepEqual(oneHandSampled.pose.proceduralLayersUnavailable, []);
    assert.equal(oneHandSampled.diagnostics.secondaryIk.status, 'not_applicable');
    assert.deepEqual(oneHandSampled.item.geometry, {
      status: 'unavailable',
      reason: 'item_prefab_visual_geometry_not_box',
    });
    assert.ok(oneHandSampled.bones.length > 0, 'pistol sample must keep compatible skeletal evidence');
    assert.deepEqual(oneHandSampled.limitations, [
      'sampled_attachment_schematic_only',
      'not_review_evidence',
      'item_mesh_unavailable',
    ]);

    for (const [argumentsList, expectedError] of [
      [['evaluate-sample'], /evaluate-sample/],
      [['evaluate-sample', '--animation-root', fixtureRoot, '--attachment', 'weapon.rifle.mk1.humanoid', '--phase', 'idle'], /evaluate-sample/],
      [['evaluate-sample', '--animation-root', fixtureRoot, '--attachment', 'weapon.rifle.mk1.humanoid', '--phase', 'idle', '--normalized-time'], /evaluate-sample/],
      [['evaluate-sample', '--animation-root', fixtureRoot, '--attachment', 'weapon.rifle.mk1.humanoid', '--phase', 'idle', '--normalized-time', '0.5'], /evaluate-sample/],
      [['evaluate-rest', '--animation-root', fixtureRoot, '--attachment', 'weapon.rifle.mk1.humanoid'], /evaluate-rest/],
      [['evaluate-rest', '--animation-root', fixtureRoot, '--attachment', 'weapon.rifle.mk1.humanoid', '--content-root', contentRoot], /evaluate-rest/],
      [withContent(['evaluate-sample', '--animation-root', fixtureRoot, '--attachment', 'weapon.rifle.mk1.humanoid', '--phase', 'idle', '--normalised-time', '0.5']), /unknown or duplicate evaluate-sample flag/],
      [withContent(['evaluate-sample', '--animation-root', fixtureRoot, '--attachment', 'weapon.rifle.mk1.humanoid', '--phase', 'idle', '--normalized-time', '0,5']), /locale-independent finite number/],
      [withContent(['evaluate-sample', '--animation-root', fixtureRoot, '--attachment', 'weapon.rifle.mk1.humanoid', '--phase', 'idle', '--normalized-time', 'nan']), /locale-independent finite number/],
      [withContent(['evaluate-sample', '--animation-root', fixtureRoot, '--attachment', 'weapon.rifle.mk1.humanoid', '--phase', 'idle', '--normalized-time', 'inf']), /locale-independent finite number/],
      [['evaluate-rest', '--animation-root', fixtureRoot, '--attachment', 'weapon.rifle.mk1.humanoid', '--content-root', contentRoot, '--content-root', contentRoot], /unknown or duplicate evaluate-rest flag/],
      [['evaluate-sample', '--animation-root', fixtureRoot, '--attachment', 'weapon.rifle.mk1.humanoid', '--phase', 'idle', '--normalized-time', '0.5', '--content-root', contentRoot, '--content-root', contentRoot], /unknown or duplicate evaluate-sample flag/],
    ]) {
      const invalidSample = invoke(argumentsList);
      assert.notEqual(invalidSample.status, 0, `evaluate-sample flags should be rejected: ${argumentsList.join(' ')}`);
      assert.equal(invalidSample.stdout, '');
      assert.match(invalidSample.stderr, expectedError);
    }
    const unknownPhase = invoke(withContent([
      'evaluate-sample', '--animation-root', fixtureRoot, '--attachment', 'weapon.rifle.mk1.humanoid',
      '--phase', 'sprint', '--normalized-time', '0.5',
    ]));
    assert.notEqual(unknownPhase.status, 0);
    assert.equal(unknownPhase.stdout, '');
    assert.match(unknownPhase.stderr, /Unknown motion-envelope phase "sprint"|Unknown motion-envelope phase 'sprint'/);
    const unlistedTime = invoke(withContent([
      'evaluate-sample', '--animation-root', fixtureRoot, '--attachment', 'weapon.rifle.mk1.humanoid',
      '--phase', 'idle', '--normalized-time', '0.25',
    ]));
    assert.notEqual(unlistedTime.status, 0);
    assert.equal(unlistedTime.stdout, '');
    assert.match(unlistedTime.stderr, /not an authored sample/);

    fs.writeFileSync(path.join(fixtureRoot, 'skeletons', 'rotation_compose.skeleton.toml'), [
      'schema = "shader_forge.skeleton"',
      'schema_version = 2',
      'id = "rotation.compose.v2"',
      'name = "rotation_compose"',
      'owner_system = "animation_system"',
      'root_bone = "root"',
      'units = "meters"',
      'up = "y"',
      'forward = "z"',
      'handedness = "right"',
      '',
      '[bone.child]',
      'id = "child"',
      'parent = "root"',
      'role = "hand_r"',
      'translation = [1.0, 0.0, 0.0]',
      'rotation = [0.7071067811865475, 0.0, 0.0, 0.7071067811865476]',
      '',
      '[bone.root]',
      'id = "root"',
      'parent = ""',
      'role = "other"',
      'translation = [0.5, 1.25, 0.25]',
      'rotation = [0.0, 0.7071067811865475, 0.0, 0.7071067811865476]',
      '',
      '[socket.primary_grip]',
      'id = "socket.child.primary"',
      'bone = "child"',
      'role = "primary_grip"',
      'translation = [0.0, 0.2, 0.0]',
      'rotation = [0.0, 0.0, 0.7071067811865475, 0.7071067811865476]',
      '',
    ].join('\n'));
    fs.writeFileSync(path.join(fixtureRoot, 'attachments', 'rotation_compose.attachment.toml'), [
      'schema = "shader_forge.attachment_profile"',
      'schema_version = 1',
      'id = "rotation.compose.one_hand"',
      'name = "Rotation Compose"',
      'owner_system = "animation_system"',
      'skeleton = "rotation.compose.v2"',
      'item_prefab = "weapon.rifle.mk1"',
      'dominant_hand = "right"',
      'mode = "one_hand"',
      'perspective = "third_person"',
      '',
      '[primary_grip]',
      'socket = "socket.child.primary"',
      'space = "socket"',
      'translation = [0.1, 0.0, 0.0]',
      'rotation = [0.0, -0.7071067811865475, 0.0, -0.7071067811865476]',
      '',
    ].join('\n'));
    const rotated = JSON.parse(evaluate(
      '--animation-root', fixtureRoot, '--attachment', 'rotation.compose.one_hand',
    ).stdout);
    assertVectorClose(findById(rotated.bones, 'child').world.translation, [0.5, 1.25, -0.75], 'rotated child world');
    const rotatedChild = findById(rotated.bones, 'child');
    assertVectorClose(rotatedChild.world.axes.x, [0, 0, -1], 'child x axis');
    assertVectorClose(rotatedChild.world.axes.y, [1, 0, 0], 'child y axis');
    assertVectorClose(rotatedChild.world.axes.z, [0, -1, 0], 'child z axis');
    assertVectorClose(rotatedChild.world.rotation, [0.5, 0.5, -0.5, 0.5], 'child quaternion order');
    assertVectorClose(findById(rotated.sockets, 'socket.child.primary').world.translation, [0.7, 1.25, -0.75], 'rotated socket world');
    assertVectorClose(findById(rotated.sockets, 'socket.child.primary').world.rotation, [0.7071067811865476, 0, 0, 0.7071067811865476], 'socket quaternion order');
    assertVectorClose(rotated.item.world.translation, [0.8, 1.25, -0.75], 'rotated item world');
    assertVectorClose(rotated.item.world.rotation, [0.5, 0.5, 0.5, 0.5], 'item quaternion order and sign');
    assertAuthoredVisualBox(rotated, 'rotated visual box');
    assertVectorClose(rotated.item.geometry.worldCorners[0], [0.3, 1.1875, -0.875], 'rotated visual box corner 0');
    assertVectorClose(rotated.item.geometry.worldCorners[6], [1.3, 1.3125, -0.625], 'rotated visual box corner 6');
    assert.equal(rotated.hands.secondary, null);
    assert.equal(rotated.diagnostics.secondaryIk.status, 'not_applicable');
    assertJointLimitObjectShape(rotated.diagnostics.jointLimits, 'rotated rest jointLimits shape');
    assert.deepEqual(rotated.diagnostics.jointLimits, {
      status: 'unavailable',
      reason: 'no_joint_limits_authored',
      policy: 'diagnose',
      evaluatedBoneCount: 0,
      violationCount: 0,
      maxViolationDegrees: 0,
      withinLimits: null,
      bones: [],
    });
    assert.equal(rotated.limitations.includes('secondary_hand_ik_unavailable'), false);

    fs.writeFileSync(path.join(fixtureRoot, 'skeletons', 'large_coordinates.skeleton.toml'), [
      'schema = "shader_forge.skeleton"', 'schema_version = 2', 'id = "large.coordinates.v2"',
      'name = "large_coordinates"', 'owner_system = "animation_system"', 'root_bone = "root"',
      'units = "meters"', 'up = "y"', 'forward = "z"', 'handedness = "right"', '',
      '[bone.root]', 'id = "root"', 'parent = ""', 'role = "other"',
      'translation = [0.0, 0.0, 0.0]', 'rotation = [0.0, 0.0, 0.0, 1.0]', '',
      '[bone.hand_r]', 'id = "hand_r"', 'parent = "root"', 'role = "hand_r"',
      'translation = [-1e308, 0.0, 0.0]', 'rotation = [0.0, 0.0, 0.0, 1.0]', '',
      '[bone.hand_l]', 'id = "hand_l"', 'parent = "root"', 'role = "hand_l"',
      'translation = [1e308, 0.0, 0.0]', 'rotation = [0.0, 0.0, 0.0, 1.0]', '',
      '[socket.primary]', 'id = "socket.hand_r.primary"', 'bone = "hand_r"', 'role = "primary_grip"',
      'translation = [0.0, 0.0, 0.0]', 'rotation = [0.0, 0.0, 0.0, 1.0]', '',
      '[socket.palm_l]', 'id = "socket.hand_l.palm"', 'bone = "hand_l"', 'role = "palm_contact"',
      'translation = [0.0, 0.0, 0.0]', 'rotation = [0.0, 0.0, 0.0, 1.0]', '',
    ].join('\n'));
    fs.writeFileSync(path.join(fixtureRoot, 'attachments', 'large_coordinates.attachment.toml'), [
      'schema = "shader_forge.attachment_profile"', 'schema_version = 1',
      'id = "large.coordinates.two_hand"', 'name = "Large Coordinates"',
      'owner_system = "animation_system"', 'skeleton = "large.coordinates.v2"',
      'item_prefab = "large.coordinates.item"', 'dominant_hand = "right"',
      'mode = "two_hand"', 'perspective = "third_person"', '',
      '[primary_grip]', 'socket = "socket.hand_r.primary"', 'space = "socket"',
      'translation = [0.0, 0.0, 0.0]', 'rotation = [0.0, 0.0, 0.0, 1.0]', '',
      '[secondary_hand]', 'enabled = true', 'joint_limit_policy = "diagnose"', '',
      '[secondary_hand.target]', 'translation = [0.0, 0.0, 0.0]',
      'rotation = [0.0, 0.0, 0.0, 1.0]', '',
      '[secondary_hand.pole]', 'translation = [0.0, 0.0, 0.0]', '',
      '[secondary_hand.tolerances]', 'reach_meters = 0.0', 'angle_degrees = 0.0',
      'contact_meters = 0.0', '',
    ].join('\n'));
    const overflowRest = invoke(withContent([
      'evaluate-rest', '--animation-root', fixtureRoot, '--attachment', 'large.coordinates.two_hand',
    ]));
    assert.notEqual(overflowRest.status, 0, 'non-finite evaluated diagnostics must fail closed');
    assert.equal(overflowRest.stdout, '');
    assert.match(overflowRest.stderr, /non-finite secondary-hand distance/);

    const unknownRest = invoke(withContent([
      'evaluate-rest', '--animation-root', fixtureRoot, '--attachment', 'weapon.missing',
    ]));
    assert.notEqual(unknownRest.status, 0);
    assert.equal(unknownRest.stdout, '');
    assert.match(unknownRest.stderr, /unknown attachment "weapon\.missing"/);

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
console.log('- Verified rest-pose geometry, fixture invariants, and parent-rotated composition');
console.log('- Verified authored visual-box evidence from DataFoundation procgeo in rest and sample');
console.log('- Verified v1 pre-IK compatibility and v2 sampled two-bone IK truth');
console.log('- Verified CLI strict flags, help, and build-first behavior');
assert.equal(nativeChecked, true, 'native spatial execution is required');
console.log('- Compiled and ran shader_forge_spatial against isolated fixtures');
