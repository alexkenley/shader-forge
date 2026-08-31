import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRootFromScript } from './lib/harness-utils.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const helperPath = path.join(repoRoot, 'shell', 'engine-shell', 'src', 'spatial-attachment-authoring.ts');
const viewPath = path.join(repoRoot, 'shell', 'engine-shell', 'src', 'SpatialAttachmentEditorView.tsx');
const schematicPath = path.join(repoRoot, 'shell', 'engine-shell', 'src', 'SpatialRestSchematic.tsx');
const appPath = path.join(repoRoot, 'shell', 'engine-shell', 'src', 'App.tsx');
const clientPath = path.join(repoRoot, 'shell', 'engine-shell', 'src', 'lib', 'sessiond.ts');
const stylesPath = path.join(repoRoot, 'shell', 'engine-shell', 'src', 'styles.css');
const typescriptPath = path.join(repoRoot, 'shell', 'engine-shell', 'node_modules', 'typescript', 'lib', 'typescript.js');

const [helperSource, viewSource, schematicSource, appSource, clientSource, stylesSource] = await Promise.all([
  fs.readFile(helperPath, 'utf8'),
  fs.readFile(viewPath, 'utf8'),
  fs.readFile(schematicPath, 'utf8'),
  fs.readFile(appPath, 'utf8'),
  fs.readFile(clientPath, 'utf8'),
  fs.readFile(stylesPath, 'utf8'),
]);
const ts = await import(pathToFileURL(typescriptPath).href);
const compiled = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const helper = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const schematicCompiled = ts.transpileModule(schematicSource, {
  compilerOptions: {
    jsx: ts.JsxEmit.React,
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText.replace(
  /import\s*\{[^}]+\}\s*from\s*['"]react['"];?/,
  'const React={createElement(){ return null; }}; const useId=()=>"test"; const useMemo=(factory)=>factory(); const useState=(value)=>[value,()=>{}];',
);
const schematic = await import(`data:text/javascript;base64,${Buffer.from(schematicCompiled).toString('base64')}`);
const evaluateClientSource = /export async function evaluateSpatialAttachment\([\s\S]*?(?=export async function evaluateSpatialAttachmentSample)/.exec(clientSource)?.[0] || '';
const evaluateSampleClientSource = /export async function evaluateSpatialAttachmentSample[\s\S]*?(?=export async function previewSpatialAttachment)/.exec(clientSource)?.[0] || '';
const rereadSource = /async function reread[\s\S]*?(?=\n  async function closeConnection)/.exec(viewSource)?.[0] || '';
const sampledFetchSource = /async function refreshSampledEvaluation[\s\S]*?(?=\n  async function reread)/.exec(viewSource)?.[0] || '';
const evaluationPointsSource = /function evaluationPoints[\s\S]*?(?=\nfunction CoordinateMarker)/.exec(schematicSource)?.[0] || '';
const drawingSource = /function Drawing[\s\S]*?(?=\nfunction OptionalMarker)/.exec(schematicSource)?.[0] || '';

const source = [
  'schema = "shader_forge.attachment_profile"',
  'schema_version = 1',
  'id = "weapon.rifle" # identity stays',
  'name = "Rifle"',
  'skeleton = "humanoid.standard"',
  'item_prefab = "weapon.rifle.prefab"',
  '',
  '[primary_grip]',
  'socket = "socket.hand_r.primary"',
  'space = "socket"',
  'translation = [0.0, -0.015, 0.02] # preserve comment',
  'rotation = [0.0, 0.0, 0.0, 1.0]',
  '',
  '[secondary_hand.target]',
  'translation = [8, 9, 10]',
  'rotation = [0, 0, 0, 1]',
  '',
  '[motion_envelope.idle]',
  'clip = "rifle_idle"',
  'normalized_times = [0.0, 0.5, 1e0]',
  '',
  '[motion_envelope.aim]',
  'clip = "rifle_aim"',
  'normalized_times = [0.25, 0.75]',
  '',
].join('\r\n');

const evaluationTransform = {
  translation: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  axes: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
};
const validRestEvaluation = {
  schema: 'shader_forge.spatial_attachment_evaluation',
  schemaVersion: 1,
  pose: { kind: 'rest', sampled: false },
  coordinateSystem: { units: 'meters', handedness: 'right', up: '+Y', forward: '+Z', quaternionOrder: 'xyzw' },
  skeleton: { id: 'skeleton.test', name: 'Test', rootBone: 'root' },
  attachment: {
    id: 'attachment.test',
    name: 'Test',
    itemPrefabId: 'item.test',
    dominantHand: 'right',
    mode: 'one_hand',
    perspective: 'both',
    primaryGripSocket: 'socket.hand_r.primary',
  },
  bones: [],
  segments: [],
  sockets: [],
  item: {
    prefabId: 'item.test',
    world: evaluationTransform,
    geometry: { status: 'unavailable', reason: 'item_prefab_not_found' },
    primaryContactWorld: null,
    handleAxisWorld: null,
  },
  hands: {
    dominant: {
      boneId: 'hand_r',
      role: 'dominant',
      world: structuredClone(evaluationTransform),
      palmWorld: structuredClone(evaluationTransform),
    },
    secondary: null,
  },
  diagnostics: {
    secondaryIk: { status: 'not_applicable', reason: 'one_hand_attachment' },
    jointLimits: {
      status: 'unavailable',
      reason: 'no_joint_limits_authored',
      policy: 'diagnose',
      evaluatedBoneCount: 0,
      violationCount: 0,
      maxViolationDegrees: 0,
      withinLimits: null,
      bones: [],
    },
    clipping: { status: 'unavailable', reason: 'item_and_capsule_geometry_not_integrated' },
  },
  limitations: ['rest_pose_only', 'not_review_evidence', 'item_mesh_unavailable'],
};
const populatedRestEvaluation = structuredClone(validRestEvaluation);
populatedRestEvaluation.bones = [{
  id: 'root',
  parent: '',
  role: 'root',
  local: structuredClone(evaluationTransform),
  world: structuredClone(evaluationTransform),
}];
populatedRestEvaluation.segments = [{ parentBoneId: 'root', boneId: 'hand_r', from: [0, 0, 0], to: [0.4, 0.2, 0] }];
populatedRestEvaluation.sockets = [{
  id: 'socket.hand_r.primary',
  boneId: 'hand_r',
  role: 'primary_grip',
  local: structuredClone(evaluationTransform),
  world: structuredClone(evaluationTransform),
}];
populatedRestEvaluation.item.primaryContactWorld = structuredClone(evaluationTransform);
populatedRestEvaluation.item.handleAxisWorld = { origin: [0, 0, 0], direction: [1, 0, 0] };

function twoHandRestEvaluation(schemaVersion) {
  const evaluation = structuredClone(populatedRestEvaluation);
  evaluation.schemaVersion = schemaVersion;
  evaluation.attachment.mode = 'two_hand';
  evaluation.hands.secondary = {
    enabled: true,
    boneId: 'hand_l',
    role: 'secondary',
    world: structuredClone(evaluationTransform),
    palmWorld: structuredClone(evaluationTransform),
    targetWorld: structuredClone(evaluationTransform),
    pole: schemaVersion === 1
      ? { translation: [0, 1, 0], space: 'unresolved', world: null, reason: 'pole_space_not_authored' }
      : { translation: [0, 1, 0], space: 'item', world: [0.25, 0.5, 0.75], reason: null },
    preSolveDistanceMeters: 0.5,
  };
  evaluation.diagnostics.secondaryIk = {
    status: 'unavailable',
    reason: schemaVersion === 1 ? 'secondary_hand_ik_not_implemented' : 'rest_pose_unsolved',
  };
  evaluation.limitations = [
    'rest_pose_only',
    'not_review_evidence',
    'item_mesh_unavailable',
    'secondary_hand_ik_unavailable',
  ];
  return evaluation;
}

function sampledEvaluation({ schemaVersion = 1, mode = 'one_hand', reachable = true } = {}) {
  const evaluation = mode === 'two_hand'
    ? twoHandRestEvaluation(schemaVersion)
    : structuredClone(populatedRestEvaluation);
  evaluation.schemaVersion = schemaVersion;
  evaluation.pose = {
    kind: 'clip_sample',
    sampled: true,
    phase: 'idle',
    clip: 'rifle_idle',
    normalizedTime: 0.5,
    proceduralLayersRequested: ['primary_attachment'],
    proceduralLayersApplied: ['primary_attachment'],
    proceduralLayersUnavailable: [],
  };
  evaluation.limitations = [
    'sampled_attachment_schematic_only',
    'not_review_evidence',
    'item_mesh_unavailable',
  ];
  if (mode === 'one_hand') return evaluation;

  evaluation.pose.proceduralLayersRequested.push('secondary_hand_ik');
  if (schemaVersion === 1) {
    evaluation.pose.proceduralLayersUnavailable.push('secondary_hand_ik');
    evaluation.diagnostics.secondaryIk = {
      status: 'unavailable',
      reason: 'secondary_hand_ik_not_implemented',
    };
    evaluation.limitations = [
      'pre_ik_only',
      'not_review_evidence',
      'item_mesh_unavailable',
      'secondary_hand_ik_unavailable',
    ];
    return evaluation;
  }

  evaluation.pose.proceduralLayersApplied.push('secondary_hand_ik');
  if (!reachable) evaluation.hands.secondary.targetWorld.translation = [0.2, 0, 0];
  evaluation.diagnostics.secondaryIk = {
    status: 'applied',
    solved: true,
    reachable,
    preSolveDistanceMeters: 0.5,
    targetDistanceMeters: reachable ? 0.5 : 0.8,
    minReachMeters: 0.1,
    maxReachMeters: 0.6,
    reachResidualMeters: reachable ? 0 : 0.2,
    reachToleranceMeters: 0.04,
    reachWithinTolerance: reachable,
    postSolveDistanceMeters: reachable ? 0 : 0.2,
    contactToleranceMeters: 0.015,
    contactWithinTolerance: reachable,
    postSolveAngleDegrees: 0,
    angleToleranceDegrees: 8,
    angleWithinTolerance: true,
    withinTolerance: reachable,
  };
  return evaluation;
}

function jointLimitBone(boneId, overrides = {}) {
  return {
    boneId,
    role: boneId,
    swingDegrees: 0,
    swingLimitDegrees: 70,
    twistDegrees: 0,
    twistMinDegrees: -80,
    twistMaxDegrees: 80,
    swingViolationDegrees: 0,
    twistViolationDegrees: 0,
    withinLimits: true,
    ...overrides,
  };
}

function availableJointLimits(bones) {
  const violationCount = bones.filter((bone) => bone.withinLimits === false).length;
  const maxViolationDegrees = bones.reduce(
    (current, bone) => Math.max(current, bone.swingViolationDegrees, bone.twistViolationDegrees),
    0,
  );
  return {
    status: 'available',
    reason: null,
    policy: 'diagnose',
    evaluatedBoneCount: bones.length,
    violationCount,
    maxViolationDegrees,
    withinLimits: violationCount === 0,
    bones,
  };
}

function unavailableJointLimits(reason = 'no_joint_limits_authored') {
  return {
    status: 'unavailable',
    reason,
    policy: 'diagnose',
    evaluatedBoneCount: 0,
    violationCount: 0,
    maxViolationDegrees: 0,
    withinLimits: null,
    bones: [],
  };
}

function withJointLimits(evaluation, jointLimits) {
  evaluation.diagnostics.jointLimits = jointLimits;
  return evaluation;
}

function twoBoneRestEvaluation() {
  const evaluation = structuredClone(populatedRestEvaluation);
  evaluation.bones.push({
    id: 'hand_r',
    parent: 'root',
    role: 'hand_r',
    local: structuredClone(evaluationTransform),
    world: structuredClone(evaluationTransform),
  });
  return evaluation;
}

const parsed = helper.parseSpatialAttachment(source);
assert.equal(parsed.id, 'weapon.rifle');
assert.equal(parsed.skeleton, 'humanoid.standard');
assert.equal(parsed.socket, 'socket.hand_r.primary');
assert.deepEqual(parsed.translation, [0, -0.015, 0.02]);
assert.deepEqual(parsed.rotationDegrees, [0, 0, 0]);

assert.deepEqual(helper.parseSpatialAttachmentMotionEnvelope(source), [
  { phase: 'idle', clip: 'rifle_idle', normalizedTimes: [0, 0.5, 1] },
  { phase: 'aim', clip: 'rifle_aim', normalizedTimes: [0.25, 0.75] },
]);
assert.deepEqual(helper.parseSpatialAttachmentMotionEnvelope(source.replace(/\[motion_envelope\.idle\][\s\S]*$/, '')), []);
assert.deepEqual(
  helper.parseSpatialAttachmentMotionEnvelope(source.replace('socket = "socket.hand_r.primary"', 'socket = get_socket()')),
  helper.parseSpatialAttachmentMotionEnvelope(source),
  'motion-envelope discovery must stay independent of the constrained primary-grip parser',
);
assert.doesNotThrow(
  () => helper.parseSpatialAttachment(source.replace('normalized_times = [0.0, 0.5, 1e0]', 'normalized_times = [0.0, ]')),
  'an unsupported motion-envelope layout must not disable otherwise safe primary-grip editing',
);
for (const [label, malformedSource] of [
  ['duplicate phase', source.replace('[motion_envelope.aim]', '[motion_envelope.idle]')],
  ['duplicate time', source.replace('[0.0, 0.5, 1e0]', '[0.0, 0.5, 0.5]')],
  ['negative zero', source.replace('[0.0, 0.5, 1e0]', '[-0, 0.5, 1.0]')],
  ['out of range', source.replace('[0.0, 0.5, 1e0]', '[0.0, 1.1]')],
  ['non-number', source.replace('[0.0, 0.5, 1e0]', '[0.0, nope]')],
  ['missing clip', source.replace('clip = "rifle_idle"', 'other = "rifle_idle"')],
]) {
  assert.throws(
    () => helper.parseSpatialAttachmentMotionEnvelope(malformedSource),
    /motion envelope|normalized_times|exactly one supported/i,
    `${label} motion-envelope source must fail closed`,
  );
}

const attachmentRevision = `sha256:${'a'.repeat(64)}`;
const sourceRevisions = [
  { path: 'animation/attachments/rifle.attachment.toml', revision: attachmentRevision },
  { path: 'animation/clips/rifle_idle.anim.toml', revision: `sha256:${'b'.repeat(64)}` },
  { path: 'animation/graphs/rifle.animgraph.toml', revision: `sha256:${'c'.repeat(64)}` },
  { path: 'animation/skeletons/humanoid.skeleton.toml', revision: `sha256:${'d'.repeat(64)}` },
];
assert.equal(
  helper.spatialSourceRevisionsCoverAttachment(
    sourceRevisions,
    'animation/attachments/rifle.attachment.toml',
    attachmentRevision,
  ),
  true,
);
for (const [label, manifest] of [
  ['unsorted', [sourceRevisions[1], sourceRevisions[0], ...sourceRevisions.slice(2)]],
  ['duplicate path', [sourceRevisions[0], sourceRevisions[0]]],
  ['missing attachment', sourceRevisions.slice(1)],
  ['wrong attachment revision', [{ ...sourceRevisions[0], revision: `sha256:${'e'.repeat(64)}` }, ...sourceRevisions.slice(1)]],
  ['unsafe relative path', [{ ...sourceRevisions[0], path: '../rifle.attachment.toml' }, ...sourceRevisions.slice(1)]],
  ['backslash path', [{ ...sourceRevisions[0], path: 'animation\\attachments\\rifle.attachment.toml' }, ...sourceRevisions.slice(1)]],
  ['drive-prefixed path', [{ ...sourceRevisions[0], path: 'C:/animation/attachments/rifle.attachment.toml' }, ...sourceRevisions.slice(1)]],
  ['drive-relative path', [{ ...sourceRevisions[0], path: 'C:animation/attachments/rifle.attachment.toml' }, ...sourceRevisions.slice(1)]],
  ['control-character path', [{ ...sourceRevisions[0], path: 'animation/attachments/rifle\n.attachment.toml' }, ...sourceRevisions.slice(1)]],
  ['oversized path', [{ ...sourceRevisions[0], path: `animation/attachments/${'x'.repeat(2048)}.toml` }, ...sourceRevisions.slice(1)]],
  ['invalid revision', [{ ...sourceRevisions[0], revision: 'sha256:not-a-hash' }, ...sourceRevisions.slice(1)]],
  ['extra field', [{ ...sourceRevisions[0], hidden: true }, ...sourceRevisions.slice(1)]],
]) {
  assert.equal(
    helper.spatialSourceRevisionsCoverAttachment(
      manifest,
      'animation/attachments/rifle.attachment.toml',
      attachmentRevision,
    ),
    false,
    `${label} source manifest must fail closed`,
  );
}
const oversizedManifest = [
  sourceRevisions[0],
  ...Array.from({ length: 34 }, (_, index) => ({
    path: `animation/clips/${String(index).padStart(2, '0')}-${'x'.repeat(1950)}.anim.toml`,
    revision: `sha256:${'b'.repeat(64)}`,
  })),
];
assert.equal(
  helper.spatialSourceRevisionsCoverAttachment(
    oversizedManifest,
    'animation/attachments/rifle.attachment.toml',
    attachmentRevision,
  ),
  false,
  'aggregate manifest text must be bounded',
);
assert.equal(
  helper.spatialSourceRevisionsCoverAttachment(sourceRevisions, 'C:/animation/attachments/rifle.attachment.toml', attachmentRevision),
  false,
  'selected attachment paths must also be safe relative paths',
);
assert.equal(
  helper.spatialSourceRevisionsCoverAttachment(sourceRevisions, 'C:animation/attachments/rifle.attachment.toml', attachmentRevision),
  false,
  'selected attachment paths must reject drive-relative prefixes',
);

const candidate = helper.updateSpatialAttachmentTransform(source, [0.01, -0.02, 0.03], [10, 20, 30]);
assert.match(candidate, /translation = \[0\.01, -0\.02, 0\.03\] # preserve comment/);
assert.match(candidate, /rotation = \[-?0\.038135, 0\.189308, 0\.239298, 0\.951549\]/);
const quaternion = /\[primary_grip\][\s\S]*?rotation = \[([^\]]+)\]/.exec(candidate)[1]
  .split(',')
  .map((value) => Number(value.trim()));
assert.ok(Math.abs(Math.hypot(...quaternion) - 1) < 0.000001, 'written quaternion must stay unit length');
assert.ok(quaternion[3] >= 0, 'written quaternion must use canonical non-negative w');
assert.match(candidate, /\[secondary_hand\.target\]\r\ntranslation = \[8, 9, 10\]/);
assert.equal(candidate.replaceAll('\r\n', '').includes('\n'), false, 'CRLF layout must be preserved');
const unchanged = source.split('\r\n').filter((line) => !/^translation = \[0\.0, -0\.015|^rotation = \[0\.0, 0\.0, 0\.0, 1\.0\]$/.test(line));
for (const line of unchanged) assert.equal(candidate.includes(line), true, `unrelated source line changed: ${line}`);

assert.throws(() => helper.parseSpatialAttachment(source.replace('[primary_grip]', '[primary_grip]\r\n[primary_grip]')), /exactly one supported/);
assert.throws(() => helper.parseSpatialAttachment(source.replace('socket = "socket.hand_r.primary"', 'socket = get_socket()')), /unsupported layout/);
assert.throws(() => helper.updateSpatialAttachmentTransform(source, [Number.NaN, 0, 0], [0, 0, 0]), /finite/);

assert.equal(schematic.isSpatialEvaluationVec3([1, 2, 3]), true);
assert.equal(schematic.isSpatialEvaluationVec3([1, 2, Number.NaN]), false);
assert.equal(schematic.isSpatialEvaluationVec3({ 0: 1, 1: 2, 2: 3, length: 3, every: () => true }), false);
const bounds = schematic.spatialProjectionBounds([[0, 0, 0], [2, 4, 0]], 'xy');
assert.deepEqual(bounds, { minU: -1, minV: 0, span: 4 });
assert.deepEqual(schematic.projectSpatialPoint([1, 2, 0], 'xy', bounds), { x: 50, y: 50 });
assert.equal(
  schematic.spatialProjectionBounds([[-Number.MAX_VALUE, 0, 0], [Number.MAX_VALUE, 0, 0]], 'xy'),
  null,
  'overflowing world bounds must fail closed',
);
assert.equal(schematic.spatialProjectionBounds([], 'xy'), null);
assert.equal(schematic.isSpatialAttachmentEvaluation(validRestEvaluation), true);
assert.equal(schematic.isSpatialAttachmentEvaluation(populatedRestEvaluation), true);
assert.deepEqual(validRestEvaluation.diagnostics.jointLimits, unavailableJointLimits());
const visualBoxEvaluation = structuredClone(populatedRestEvaluation);
visualBoxEvaluation.item.geometry = {
  status: 'available',
  kind: 'authored_visual_box',
  procgeoId: 'item.test.visual',
  dimensionsMeters: [2, 4, 6],
  worldCorners: [
    [-1, -2, -3], [1, -2, -3], [1, 2, -3], [-1, 2, -3],
    [-1, -2, 3], [1, -2, 3], [1, 2, 3], [-1, 2, 3],
  ],
};
assert.equal(schematic.isSpatialAttachmentEvaluation(visualBoxEvaluation), true);
for (const mutate of [
  (report) => { report.item.geometry.dimensionsMeters[0] = 0; },
  (report) => { report.item.geometry.worldCorners.pop(); },
  (report) => { [report.item.geometry.worldCorners[0], report.item.geometry.worldCorners[1]] = [report.item.geometry.worldCorners[1], report.item.geometry.worldCorners[0]]; },
  (report) => { report.item.geometry.procgeoId = ''; },
  (report) => { report.item.geometry.collisionShape = 'box'; },
]) {
  const malformed = structuredClone(visualBoxEvaluation);
  mutate(malformed);
  assert.equal(schematic.isSpatialAttachmentEvaluation(malformed), false, 'malformed visual-box evidence must fail closed');
}
const unknownGeometryReason = structuredClone(populatedRestEvaluation);
unknownGeometryReason.item.geometry.reason = 'future_untrusted_reason';
assert.equal(schematic.isSpatialAttachmentEvaluation(unknownGeometryReason), false);
const restV2OneHand = structuredClone(populatedRestEvaluation);
restV2OneHand.schemaVersion = 2;
const restV1TwoHand = twoHandRestEvaluation(1);
const restV2TwoHand = twoHandRestEvaluation(2);
assert.equal(schematic.isSpatialAttachmentEvaluation(restV2OneHand), true);
assert.equal(schematic.isSpatialAttachmentEvaluation(restV1TwoHand), true);
assert.equal(schematic.isSpatialAttachmentEvaluation(restV2TwoHand), true);
for (const mutate of [
  (report) => { report.hands.secondary.pole.world = null; },
  (report) => { report.hands.secondary.pole.reason = 'not actually resolved'; },
  (report) => { report.hands.secondary.pole.space = 'unresolved'; },
]) {
  const malformed = structuredClone(restV2TwoHand);
  mutate(malformed);
  assert.equal(schematic.isSpatialAttachmentEvaluation(malformed), false, 'malformed schema-v2 pole must fail closed');
}
const sampledOneHand = sampledEvaluation();
const sampledV1TwoHand = sampledEvaluation({ schemaVersion: 1, mode: 'two_hand' });
const sampledV2Reachable = sampledEvaluation({ schemaVersion: 2, mode: 'two_hand' });
const sampledV2Unreachable = sampledEvaluation({ schemaVersion: 2, mode: 'two_hand', reachable: false });
assert.equal(schematic.isSpatialAttachmentEvaluation(sampledOneHand), true);
assert.equal(schematic.isSpatialAttachmentEvaluation(sampledV1TwoHand), true);
assert.equal(schematic.isSpatialAttachmentEvaluation(sampledV2Reachable), true);
assert.equal(schematic.isSpatialAttachmentEvaluation(sampledV2Unreachable), true);
for (const [label, mutate] of [
  ['unexpected pose key', (report) => { report.pose.hidden = true; }],
  ['wrong applied layers', (report) => { report.pose.proceduralLayersApplied = ['primary_attachment']; }],
  ['duplicate requested layer', (report) => { report.pose.proceduralLayersRequested.push('secondary_hand_ik'); }],
  ['unknown requested layer', (report) => { report.pose.proceduralLayersRequested = ['primary_attachment', 'invented_layer']; }],
  ['non-finite sample time', (report) => { report.pose.normalizedTime = Number.NaN; }],
  ['missing applied diagnostic field', (report) => { delete report.diagnostics.secondaryIk.postSolveDistanceMeters; }],
  ['contradictory reach flag', (report) => { report.diagnostics.secondaryIk.reachWithinTolerance = false; }],
  ['contradictory overall flag', (report) => { report.diagnostics.secondaryIk.withinTolerance = false; }],
  ['contradictory reachability', (report) => { report.diagnostics.secondaryIk.reachable = false; }],
  ['wrong reach residual', (report) => { report.diagnostics.secondaryIk.reachResidualMeters = 0.01; }],
  ['palm-target distance mismatch', (report) => { report.diagnostics.secondaryIk.postSolveDistanceMeters = 0.01; }],
  ['palm-target angle mismatch', (report) => { report.diagnostics.secondaryIk.postSolveAngleDegrees = 1; }],
  ['wrong pre-solve distance', (report) => { report.diagnostics.secondaryIk.preSolveDistanceMeters = 0.4; }],
  ['wrong limitations', (report) => { report.limitations[0] = 'review_evidence'; }],
]) {
  const malformed = structuredClone(sampledV2Reachable);
  mutate(malformed);
  assert.equal(schematic.isSpatialAttachmentEvaluation(malformed), false, `${label} sampled report must fail closed`);
}
for (const [label, mutate] of [
  ['v1 falsely applies IK', (report) => { report.pose.proceduralLayersApplied.push('secondary_hand_ik'); }],
  ['v1 omits unavailable IK', (report) => { report.pose.proceduralLayersUnavailable = []; }],
  ['v1 uses resolved pole', (report) => { report.hands.secondary.pole = structuredClone(restV2TwoHand.hands.secondary.pole); }],
  ['v1 loses pre-IK truth', (report) => { report.limitations[0] = 'sampled_attachment_schematic_only'; }],
]) {
  const malformed = structuredClone(sampledV1TwoHand);
  mutate(malformed);
  assert.equal(schematic.isSpatialAttachmentEvaluation(malformed), false, `${label} report must fail closed`);
}
const wrongCoordinate = structuredClone(validRestEvaluation);
wrongCoordinate.coordinateSystem.forward = '-Z';
assert.equal(schematic.isSpatialAttachmentEvaluation(wrongCoordinate), false);
const malformedAxis = structuredClone(validRestEvaluation);
malformedAxis.item.world.axes.z[2] = Number.NaN;
assert.equal(schematic.isSpatialAttachmentEvaluation(malformedAxis), false);
const malformedQuaternion = structuredClone(validRestEvaluation);
malformedQuaternion.item.world.rotation = [0, 0, 1];
assert.equal(schematic.isSpatialAttachmentEvaluation(malformedQuaternion), false);
const semanticTransformCases = [
  ['zero quaternion', (report) => { report.item.world.rotation = [0, 0, 0, 0]; }],
  ['non-canonical quaternion', (report) => { report.item.world.rotation = [0, 0, 0, -1]; }],
  ['non-unit quaternion', (report) => { report.item.world.rotation = [0, 0, 0, 0.5]; }],
  ['zero axes', (report) => { report.item.world.axes = { x: [0, 0, 0], y: [0, 0, 0], z: [0, 0, 0] }; }],
  ['non-orthogonal axes', (report) => { report.item.world.axes.y = [1, 0, 0]; }],
  ['axes inconsistent with quaternion', (report) => { report.item.world.axes = { x: [0, 1, 0], y: [-1, 0, 0], z: [0, 0, 1] }; }],
];
for (const [label, mutate] of semanticTransformCases) {
  const malformed = structuredClone(validRestEvaluation);
  mutate(malformed);
  assert.equal(schematic.isSpatialAttachmentEvaluation(malformed), false, `${label} must fail closed`);
}
const malformedDiagnostic = structuredClone(validRestEvaluation);
malformedDiagnostic.diagnostics.clipping.status = 'passed';
assert.equal(schematic.isSpatialAttachmentEvaluation(malformedDiagnostic), false);
const extraNestedField = structuredClone(validRestEvaluation);
extraNestedField.item.world.hidden = true;
assert.equal(schematic.isSpatialAttachmentEvaluation(extraNestedField), false);
const malformedNestedCases = [
  ['bone transform', (report) => { report.bones[0].local.axes.x = [1, 0]; }],
  ['segment endpoint', (report) => { report.segments[0].to = 'not-a-vector'; }],
  ['socket transform', (report) => { report.sockets[0].world.translation[1] = Number.POSITIVE_INFINITY; }],
  ['item contact', (report) => { report.item.primaryContactWorld.rotation = [0, 0, 1]; }],
  ['handle direction', (report) => { report.item.handleAxisWorld.direction = null; }],
  ['dominant palm', (report) => { report.hands.dominant.palmWorld.axes.y[0] = Number.NaN; }],
  ['secondary target', (report) => { report.hands.secondary.targetWorld.translation = [0, 0]; }],
  ['secondary pole', (report) => { report.hands.secondary.pole.space = 'world'; }],
  ['secondary distance', (report) => { report.hands.secondary.preSolveDistanceMeters = -1; }],
  ['limitation entry', (report) => { report.limitations[0] = { invalid: true }; }],
];
for (const [label, mutate] of malformedNestedCases) {
  const malformed = structuredClone(restV1TwoHand);
  mutate(malformed);
  assert.equal(schematic.isSpatialAttachmentEvaluation(malformed), false, `${label} must fail closed`);
}
for (const direction of [[0, 0, 0], [2, 0, 0], [Number.MAX_VALUE, 0, 0]]) {
  const malformed = structuredClone(populatedRestEvaluation);
  malformed.item.handleAxisWorld.direction = direction;
  assert.equal(schematic.isSpatialAttachmentEvaluation(malformed), false, 'handle direction must be finite and normalized');
}
const oversizedString = structuredClone(validRestEvaluation);
oversizedString.attachment.name = 'x'.repeat(schematic.SPATIAL_EVALUATION_LIMITS.maxStringLength + 1);
assert.equal(schematic.isSpatialAttachmentEvaluation(oversizedString), false);
const oversizedTotalText = structuredClone(validRestEvaluation);
oversizedTotalText.limitations = Array.from({ length: 33 }, () => 'x'.repeat(2_000));
assert.equal(schematic.isSpatialAttachmentEvaluation(oversizedTotalText), false);
const oversizedBones = structuredClone(validRestEvaluation);
oversizedBones.bones = Array.from(
  { length: schematic.SPATIAL_EVALUATION_LIMITS.maxBones + 1 },
  () => ({ id: 'a', parent: '', role: 'bone', local: evaluationTransform, world: evaluationTransform }),
);
assert.equal(schematic.isSpatialAttachmentEvaluation(oversizedBones), false);
const oversizedSockets = structuredClone(validRestEvaluation);
oversizedSockets.sockets = Array.from(
  { length: schematic.SPATIAL_EVALUATION_LIMITS.maxSockets + 1 },
  () => ({ id: 'a', boneId: 'b', role: 'socket', local: evaluationTransform, world: evaluationTransform }),
);
assert.equal(schematic.isSpatialAttachmentEvaluation(oversizedSockets), false);
const oversizedLimitations = structuredClone(validRestEvaluation);
oversizedLimitations.limitations = Array.from(
  { length: schematic.SPATIAL_EVALUATION_LIMITS.maxLimitations + 1 },
  (_, index) => `limit_${index}`,
);
assert.equal(schematic.isSpatialAttachmentEvaluation(oversizedLimitations), false);
const excessiveCoordinateRows = structuredClone(validRestEvaluation);
excessiveCoordinateRows.segments = Array.from(
  { length: schematic.SPATIAL_EVALUATION_LIMITS.maxSegments },
  () => ({ parentBoneId: 'a', boneId: 'b', from: [0, 0, 0], to: [1, 1, 1] }),
);
assert.equal(schematic.isSpatialAttachmentEvaluation(excessiveCoordinateRows), false);

const availablePass = withJointLimits(
  structuredClone(populatedRestEvaluation),
  availableJointLimits([jointLimitBone('root')]),
);
assert.equal(schematic.isSpatialAttachmentEvaluation(availablePass), true, 'available in-limit joint diagnostics must pass');
const availableViolation = withJointLimits(
  structuredClone(populatedRestEvaluation),
  availableJointLimits([jointLimitBone('root', {
    swingDegrees: 90,
    swingViolationDegrees: 20,
    withinLimits: false,
  })]),
);
assert.equal(schematic.isSpatialAttachmentEvaluation(availableViolation), true, 'available joint-limit violations must pass');
const availableTwistViolation = withJointLimits(
  structuredClone(populatedRestEvaluation),
  availableJointLimits([jointLimitBone('root', {
    twistDegrees: 100,
    twistViolationDegrees: 20,
    withinLimits: false,
  })]),
);
assert.equal(schematic.isSpatialAttachmentEvaluation(availableTwistViolation), true, 'available twist violations must pass');
const twoBoneAvailable = withJointLimits(
  twoBoneRestEvaluation(),
  availableJointLimits([jointLimitBone('root'), jointLimitBone('hand_r')]),
);
assert.equal(schematic.isSpatialAttachmentEvaluation(twoBoneAvailable), true, 'stable-order subsequence joint diagnostics must pass');
const sampledAvailable = withJointLimits(
  sampledEvaluation(),
  availableJointLimits([jointLimitBone('root')]),
);
assert.equal(schematic.isSpatialAttachmentEvaluation(sampledAvailable), true, 'sampled available joint diagnostics must pass');

for (const [label, mutate] of [
  ['legacy two-key jointLimits', (report) => {
    report.diagnostics.jointLimits = {
      status: 'unavailable',
      reason: 'joint_limit_evaluation_not_integrated',
    };
  }],
  ['jointLimits extra key', (report) => {
    report.diagnostics.jointLimits.clampApplied = false;
  }],
  ['jointLimits missing key', (report) => {
    delete report.diagnostics.jointLimits.policy;
  }],
  ['jointLimits non-diagnose policy', (report) => {
    report.diagnostics.jointLimits.policy = 'clamp_and_diagnose';
  }],
  ['jointLimits unknown status', (report) => {
    report.diagnostics.jointLimits.status = 'pending';
  }],
  ['jointLimits empty unavailable reason', (report) => {
    report.diagnostics.jointLimits.reason = '';
  }],
  ['jointLimits wrong unavailable reason', (report) => {
    report.diagnostics.jointLimits.reason = 'joint_limit_evaluation_not_integrated';
  }],
  ['jointLimits unavailable with withinLimits', (report) => {
    report.diagnostics.jointLimits.withinLimits = true;
  }],
  ['jointLimits unavailable with bones', (report) => {
    report.diagnostics.jointLimits.evaluatedBoneCount = 1;
    report.diagnostics.jointLimits.bones = [jointLimitBone('root')];
  }],
  ['jointLimits non-integer count', (report) => {
    report.diagnostics.jointLimits.evaluatedBoneCount = 0.5;
  }],
  ['jointLimits negative count', (report) => {
    report.diagnostics.jointLimits.violationCount = -1;
  }],
  ['jointLimits nonfinite maxViolationDegrees', (report) => {
    report.diagnostics.jointLimits.maxViolationDegrees = Number.POSITIVE_INFINITY;
  }],
  ['jointLimits negative-zero maxViolationDegrees', (report) => {
    report.diagnostics.jointLimits.maxViolationDegrees = -0;
  }],
]) {
  const malformed = structuredClone(populatedRestEvaluation);
  mutate(malformed);
  assert.equal(schematic.isSpatialAttachmentEvaluation(malformed), false, `${label} must fail closed`);
}

for (const [label, mutate] of [
  ['jointLimits available with reason', (report) => {
    report.diagnostics.jointLimits.reason = 'no_joint_limits_authored';
  }],
  ['jointLimits available with null withinLimits', (report) => {
    report.diagnostics.jointLimits.withinLimits = null;
  }],
  ['jointLimits available empty bones', (report) => {
    report.diagnostics.jointLimits = availableJointLimits([]);
  }],
  ['jointLimits extra bone key', (report) => {
    report.diagnostics.jointLimits.bones[0].hingeDegrees = 0;
  }],
  ['jointLimits missing bone key', (report) => {
    delete report.diagnostics.jointLimits.bones[0].role;
  }],
  ['jointLimits unknown bone id', (report) => {
    report.diagnostics.jointLimits.bones[0].boneId = 'missing';
  }],
  ['jointLimits role mismatch', (report) => {
    report.diagnostics.jointLimits.bones[0].role = 'not_root';
  }],
  ['jointLimits evaluatedBoneCount mismatch', (report) => {
    report.diagnostics.jointLimits.evaluatedBoneCount = 2;
  }],
  ['jointLimits contradictory violationCount', (report) => {
    report.diagnostics.jointLimits.violationCount = 1;
    report.diagnostics.jointLimits.withinLimits = false;
  }],
  ['jointLimits contradictory aggregate withinLimits', (report) => {
    report.diagnostics.jointLimits.withinLimits = false;
  }],
  ['jointLimits contradictory maxViolationDegrees', (report) => {
    report.diagnostics.jointLimits.maxViolationDegrees = 12;
  }],
  ['jointLimits bone contradictory withinLimits', (report) => {
    report.diagnostics.jointLimits.bones[0].swingViolationDegrees = 8;
    report.diagnostics.jointLimits.bones[0].withinLimits = true;
    report.diagnostics.jointLimits.violationCount = 0;
    report.diagnostics.jointLimits.withinLimits = true;
    report.diagnostics.jointLimits.maxViolationDegrees = 8;
  }],
  ['jointLimits swing violation mismatch', (report) => {
    report.diagnostics.jointLimits.bones[0].swingDegrees = 90;
    report.diagnostics.jointLimits.bones[0].swingViolationDegrees = 0;
    report.diagnostics.jointLimits.bones[0].withinLimits = true;
  }],
  ['jointLimits twist violation mismatch', (report) => {
    report.diagnostics.jointLimits.bones[0].twistDegrees = 100;
    report.diagnostics.jointLimits.bones[0].twistViolationDegrees = 0;
    report.diagnostics.jointLimits.bones[0].withinLimits = true;
  }],
  ['jointLimits nonfinite swingDegrees', (report) => {
    report.diagnostics.jointLimits.bones[0].swingDegrees = Number.NaN;
  }],
  ['jointLimits negative-zero swingDegrees', (report) => {
    report.diagnostics.jointLimits.bones[0].swingDegrees = -0;
  }],
  ['jointLimits negative-zero twistDegrees', (report) => {
    report.diagnostics.jointLimits.bones[0].twistDegrees = -0;
  }],
  ['jointLimits swingDegrees out of bounds', (report) => {
    report.diagnostics.jointLimits.bones[0].swingDegrees = 181;
  }],
  ['jointLimits twistDegrees out of bounds', (report) => {
    report.diagnostics.jointLimits.bones[0].twistDegrees = 181;
  }],
  ['jointLimits twistMin out of bounds', (report) => {
    report.diagnostics.jointLimits.bones[0].twistMinDegrees = -181;
  }],
  ['jointLimits oversized bones', (report) => {
    report.diagnostics.jointLimits = availableJointLimits([
      jointLimitBone('root'),
      jointLimitBone('hand_r'),
    ]);
  }],
]) {
  const malformed = withJointLimits(
    structuredClone(populatedRestEvaluation),
    availableJointLimits([jointLimitBone('root')]),
  );
  mutate(malformed);
  assert.equal(schematic.isSpatialAttachmentEvaluation(malformed), false, `${label} must fail closed`);
}

const outOfOrderJointLimits = withJointLimits(
  twoBoneRestEvaluation(),
  availableJointLimits([jointLimitBone('hand_r'), jointLimitBone('root')]),
);
assert.equal(
  schematic.isSpatialAttachmentEvaluation(outOfOrderJointLimits),
  false,
  'joint-limit bone order must follow evaluation.bones',
);
const skippedOrderJointLimits = withJointLimits(
  twoBoneRestEvaluation(),
  availableJointLimits([jointLimitBone('hand_r'), jointLimitBone('hand_r')]),
);
assert.equal(
  schematic.isSpatialAttachmentEvaluation(skippedOrderJointLimits),
  false,
  'joint-limit ids must consume evaluation.bones in stable order',
);

assert.match(appSource, /activeTab === 'Assets'[\s\S]*SpatialAttachmentEditorView/);
assert.match(appSource, /activeTab === 'World'[\s\S]*SceneEditorView/);
assert.equal((appSource.match(/subscribeSessiondEvents\(/g) || []).length, 1, 'App must retain one shared SSE subscription');
assert.match(appSource, /const \[operationEventEpoch, setOperationEventEpoch\] = useState\(0\)/);
assert.match(appSource, /setOperationEventEpoch\(\(current\) => current \+ 1\)/);
assert.match(appSource, /operationEventEpoch=\{operationEventEpoch\}/);
assert.match(viewSource, /Begin tuning/);
assert.match(viewSource, /NOT APPLIED/);
assert.match(viewSource, /previewSpatialAttachment/);
assert.match(viewSource, /evaluateSpatialAttachment/);
assert.match(rereadSource, /readFile/);
assert.match(rereadSource, /parseSpatialAttachment[\s\S]*refreshAuthoredEvaluation/);
assert.match(rereadSource, /parseSpatialAttachmentMotionEnvelope|applyMotionEnvelope/, 'source rereads must refresh exact authored motion-envelope choices');
assert.match(rereadSource, /sampledEvaluationRequestRef\.current \+= 1|clearSampledEvidence/, 'source rereads must invalidate earlier sampled work');
assert.match(rereadSource, /const readGeneration = \+\+sourceReadRequestRef\.current[\s\S]*readFile[\s\S]*sourceReadRequestRef\.current !== readGeneration[\s\S]*setSource\(next\.content\)/, 'a superseded same-selection reread must stop before source state mutation');
assert.doesNotMatch(evaluateClientSource, /credential|requestCoordinationLease|method:\s*'POST'|body:/);
assert.match(evaluateSampleClientSource, /\/api\/spatial\/attachment\/evaluate-sample/);
assert.match(evaluateSampleClientSource, /searchParams\.set\('baseRevision', baseRevision\)/);
assert.match(evaluateSampleClientSource, /searchParams\.set\('phase', phase\)/);
assert.match(evaluateSampleClientSource, /searchParams\.set\('normalizedTime'/);
assert.doesNotMatch(evaluateSampleClientSource, /credential|requestCoordinationLease|registerCoordinationAgent|method:\s*'POST'|body:/);
assert.match(viewSource, /evaluateSpatialAttachmentSample/);
assert.match(sampledFetchSource, /const requestId = \+\+sampledEvaluationRequestRef\.current/);
assert.match(sampledFetchSource, /baseRevision: string/);
assert.match(sampledFetchSource, /phase: string/);
assert.match(sampledFetchSource, /normalizedTime: number/);
assert.match(sampledFetchSource, /evaluateSpatialAttachmentSample\([\s\S]*baseRevision[\s\S]*phase[\s\S]*normalizedTime/);
assert.match(sampledFetchSource, /sampledEvaluationRequestRef\.current === requestId/);
assert.match(sampledFetchSource, /selectionKeyRef\.current === expectedSelection/);
assert.match(sampledFetchSource, /revisionRef\.current === baseRevision/);
assert.match(sampledFetchSource, /selectedSampleRef\.current\.phase === phase/);
assert.match(sampledFetchSource, /selectedSampleRef\.current\.time === normalizedTime/);
assert.match(sampledFetchSource, /result\.path !== path/);
assert.match(sampledFetchSource, /result\.revision !== baseRevision/);
assert.match(sampledFetchSource, /result\.evaluation\.pose\.phase !== phase/);
assert.match(sampledFetchSource, /result\.evaluation\.pose\.normalizedTime !== normalizedTime/);
assert.match(sampledFetchSource, /spatialSourceRevisionsCoverAttachment\(/);
assert.doesNotMatch(sampledFetchSource, /requestCoordinationLease|registerCoordinationAgent|credential/);
assert.match(viewSource, /result\.path !== path \|\| result\.revision !== baseRevision/);
assert.match(viewSource, /operation\?\.state === 'conflicted'/);
assert.match(viewSource, /candidateEvidence\.baseRevision !== revision/);
assert.match(viewSource, /operationEventEpoch/);
assert.match(viewSource, /fetchOperation\(expectedOperationId\)/);
assert.match(viewSource, /operationEventRequestRef\.current === requestId[\s\S]*selectionKeyRef\.current === expectedSelection/);
assert.match(viewSource, /operationRef\.current\?\.id === expectedOperationId/);
assert.match(viewSource, /authoritative\.state === 'approved'/);
assert.deepEqual(helper.spatialOperationReconciliation('conflicted'), {
  refreshAuthored: true, clearCandidate: false, clearOperation: false, closeConnection: false,
});
assert.deepEqual(helper.spatialOperationReconciliation('rejected'), {
  refreshAuthored: true, clearCandidate: true, clearOperation: true, closeConnection: true,
});
assert.deepEqual(helper.spatialOperationReconciliation('applied'), {
  refreshAuthored: true, clearCandidate: true, clearOperation: false, closeConnection: true,
});
assert.deepEqual(helper.spatialOperationReconciliation('undone'), {
  refreshAuthored: true, clearCandidate: true, clearOperation: true, closeConnection: true,
});
assert.equal(helper.spatialOperationReconciliation('approved').refreshAuthored, false);
const connectionA = { id: 'a' };
const connectionB = { id: 'b' };
assert.equal(helper.sameSpatialConnection(connectionA, connectionA), true);
assert.equal(helper.sameSpatialConnection(connectionB, connectionA), false, 'a stale A task must not close B');
assert.equal(helper.sameSpatialConnection(null, connectionA), false);
assert.equal(helper.shouldCloseSpatialConnection(connectionB, connectionA, true), false);
assert.equal(helper.shouldCloseSpatialConnection(connectionB, null, true), false, 'captured null must not clear a later B connection');
assert.equal(helper.shouldCloseSpatialConnection(null, null, true), true);
assert.equal(helper.shouldCloseSpatialConnection(connectionB, null, false), true, 'an omitted capture closes the current connection');
assert.equal(helper.spatialActionStillCurrent(4, 4, 'session:a', 'session:a'), true);
assert.equal(helper.spatialActionStillCurrent(5, 4, 'session:a', 'session:a'), false, 'a newer same-selection action must cancel the old continuation');
assert.equal(helper.spatialActionStillCurrent(4, 4, 'session:b', 'session:a'), false);
assert.equal(helper.spatialLeaseCoversAttachment(['spatial/attachment/weapon.rifle'], 'WEAPON.RIFLE'), true);
assert.equal(helper.spatialLeaseCoversAttachment(['spatial/attachment/weapon.rifle'], 'weapon.pistol'), false);
assert.match(viewSource, /spatialOperationReconciliation\(authoritative\.state\)/);
assert.match(viewSource, /const eventConnection = connectionRef\.current/);
assert.match(viewSource, /reread\(selectedPath, expectedSelection\)[\s\S]*closeConnection\(eventConnection\)/);
assert.match(viewSource, /authoritative\.state === 'conflicted'\) await closeConnection\(eventConnection\)/);
assert.match(viewSource, /conflicted\. Authored bytes were refreshed; its candidate remains visible as stale evidence/);
assert.match(viewSource, /const actionConnection = connectionRef\.current/);
assert.equal((viewSource.match(/closeConnection\(actionConnection\)/g) || []).length, 3, 'local terminal actions must close only their captured connection');
assert.match(viewSource, /const actionConnection = connectionRef\.current;\s*const result = await transitionOperation\(/, 'local actions must capture their connection before the transition can emit SSE');
assert.match(viewSource, /transitionOperation\([\s\S]*shouldCloseSpatialConnection\(connectionRef\.current, actionConnection, true\)[\s\S]*operationRef\.current\.id !== operation\.id/, 'a late local response must not overwrite newer same-selection work');
assert.match(viewSource, /actionRequestRef\.current \+= 1;\s*setBusy\(true\)/, 'authoritative terminal SSE must cancel the matching local action generation');
assert.match(viewSource, /await reread\(selectedPath, expectedSelection\);[\s\S]*if \(!stillCurrent\(\)\) return;[\s\S]*setStatus\('Candidate rejected/, 'terminal actions must recheck ownership after reread');
assert.match(viewSource, /setAuthoredEvidence\(null\)[\s\S]*readFile/);
assert.match(viewSource, /catch \(caught\)[\s\S]*setSourceLayoutError[\s\S]*refreshAuthoredEvaluation/);
assert.match(viewSource, /PREVIEW CANDIDATE - NOT APPLIED/);
assert.match(schematicSource, /REST-POSE RIG SCHEMATIC/);
assert.match(schematicSource, /UNSAMPLED/);
assert.match(schematicSource, /SAMPLED RIG SCHEMATIC/);
assert.match(schematicSource, /PRE-IK/);
assert.match(schematicSource, /NOT REVIEW EVIDENCE/);
assert.match(schematicSource, /Exact source revisions/);
assert.match(schematicSource, /Source revisions/);
assert.match(schematicSource, /No item mesh, clipping result, camera, capture, or immutable review packet/);
assert.doesNotMatch(schematicSource, /joint-limit result/);
assert.match(schematicSource, /diagnose-only/);
assert.match(schematicSource, /pose not mutated/);
assert.match(schematicSource, /function validJointLimits/);
assert.match(schematicSource, /no_joint_limits_authored/);
assert.match(schematicSource, /Joint-limit bone diagnostics/);
assert.match(schematicSource, /Swing violation/);
assert.match(schematicSource, /Twist violation/);
assert.doesNotMatch(schematicSource, /joint_limit_evaluation_not_integrated/);
assert.match(clientSource, /type SpatialBoneJointLimitDiagnostic/);
assert.match(clientSource, /type SpatialUnavailableJointLimitsDiagnostic/);
assert.match(clientSource, /type SpatialAvailableJointLimitsDiagnostic/);
assert.match(clientSource, /type SpatialJointLimitsDiagnostic/);
assert.match(clientSource, /jointLimits: SpatialJointLimitsDiagnostic/);
assert.doesNotMatch(clientSource, /jointLimits: SpatialEvaluationDiagnostic/);
assert.match(schematicSource, /ITEM_BOX_EDGES/);
assert.match(schematicSource, /exact authored render-procgeo evidence, not collision truth/);
assert.match(schematicSource, /not collision geometry or a rendered mesh/);
assert.match(schematicSource, /Secondary IK reach/);
assert.match(schematicSource, /Secondary IK contact/);
assert.match(schematicSource, /Secondary IK angle/);
assert.match(schematicSource, /'PASS'\s*:\s*'FAIL'/);
assert.match(schematicSource, /handleAxisWorld/);
assert.match(schematicSource, /palmWorld/);
assert.match(schematicSource, /[Aa] resolved authored pole is shown as a green ring/);
assert.match(schematicSource, /An unresolved pole is never projected/);
assert.match(schematicSource, /Exact evaluator coordinates/);
assert.match(schematicSource, /Evaluator diagnostics/);
assert.match(schematicSource, /isSpatialAttachmentEvaluation\(evaluation\)/);
assert.match(schematicSource, /sampleIdentityMatches/);
assert.match(schematicSource, /candidateEvaluation\.pose\.phase === sampleIdentity\.phase/);
assert.match(schematicSource, /candidateEvaluation\.pose\.normalizedTime === sampleIdentity\.normalizedTime/);
assert.match(schematicSource, /function validSampledBranch/);
assert.match(schematicSource, /function validAppliedSecondaryIk/);
assert.match(schematicSource, /<figure/);
assert.match(schematicSource, /role="img"/);
assert.match(schematicSource, /function validPole/, 'the fail-closed validator must inspect versioned pole coordinates');
assert.match(evaluationPointsSource, /secondary\.pole/, 'resolved poles must influence projection bounds');
assert.match(drawingSource, /secondaryPole/, 'resolved poles must be drawn');
assert.ok((viewSource.match(/<select/g) || []).length >= 2, 'phase and normalized time must use native select controls');
assert.match(viewSource, /<select[\s\S]*selectedPhase/);
assert.match(viewSource, /<select[\s\S]*selectedNormalizedTime/);
assert.match(viewSource, /Evaluate (?:authored )?sample/);
assert.match(viewSource, /Authored motion sample|Motion envelope/);
assert.ok(
  viewSource.indexOf('aria-label="Authored motion sample"') < viewSource.indexOf('{draft ? ('),
  'authored sample controls must remain available when only the constrained grip parser fails',
);
assert.match(viewSource, /transitionOperation/);
assert.doesNotMatch(viewSource, /\bwriteFile\b/);
assert.match(clientSource, /X-Shader-Forge-Agent-Credential/);
assert.match(clientSource, /id: 'engine-shell'/);
assert.match(clientSource, /kind: 'shell'/);
assert.match(clientSource, /revision: string/);
assert.match(clientSource, /type SpatialSourceRevision/);
assert.match(clientSource, /sourceRevisions: SpatialSourceRevision\[\]/);
assert.match(clientSource, /SpatialAttachmentEvaluationResult/);
assert.match(clientSource, /\/api\/spatial\/attachment\/evaluate/);
assert.match(clientSource, /\/api\/spatial\/attachment\/evaluate-sample/);
assert.match(clientSource, /SpatialAttachmentPreviewResult/);
assert.match(clientSource, /replaceAll\(credential, '\[redacted\]'\)/);
assert.match(stylesSource, /\.workspace-panel\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
assert.match(stylesSource, /\.spatial-actions\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*0;/s);
assert.match(stylesSource, /\.spatial-editor__body\s*\{[^}]*grid-template-columns:\s*minmax\(210px, 250px\)[^;}]*minmax\(300px, 0\.85fr\)[^;}]*minmax\(380px, 1\.2fr\)/s);
assert.match(stylesSource, /\.spatial-rest-schematic__frame\s*\{[^}]*min-height:\s*300px;/s);
assert.match(stylesSource, /\.spatial-sample-controls__fields > button\s*\{[^}]*grid-column:\s*1 \/ -1;/s);
assert.match(stylesSource, /@media \(max-width: 1100px\)[\s\S]*?\.spatial-editor__body\s*\{[^}]*grid-template-columns:\s*1fr;/s);
assert.match(stylesSource, /@media \(max-width: 1100px\)[\s\S]*?\.spatial-editor__body\s*\{[^}]*flex:\s*none;[^}]*min-height:\s*auto;/s);
assert.match(stylesSource, /@media \(max-width: 1100px\)[\s\S]*?\.spatial-actions\s*\{[^}]*position:\s*static;/s);
const schematicStyles = stylesSource.slice(
  stylesSource.indexOf('.spatial-rest-schematic {'),
  stylesSource.indexOf('/* Activity */'),
);
assert.doesNotMatch(schematicStyles, /font-size:\s*(?:9|10)px/, 'schematic user-facing text must be at least 11px');

console.log('Engine spatial shell passed.');
console.log('- Verified exact primary-grip edits plus independent authored motion-envelope parsing');
console.log('- Verified the Assets-only operation route, explicit lock workflow, and credential redaction markers');
console.log('- Verified manifest-bound rest/sample evidence, strict v1/v2 IK truth, guarded requests, and truthful non-review labels');
