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
const evaluateClientSource = /export async function evaluateSpatialAttachment[\s\S]*?(?=export async function previewSpatialAttachment)/.exec(clientSource)?.[0] || '';
const rereadSource = /async function reread[\s\S]*?(?=\n  async function closeConnection)/.exec(viewSource)?.[0] || '';
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
    geometry: { status: 'unavailable', reason: 'item_prefab_geometry_not_integrated' },
    primaryContactWorld: null,
    handleAxisWorld: null,
  },
  hands: { dominant: null, secondary: null },
  diagnostics: {
    secondaryIk: { status: 'not_applicable', reason: 'one_hand_attachment' },
    jointLimits: { status: 'unavailable', reason: 'joint_limits_not_authored' },
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
populatedRestEvaluation.hands.dominant = {
  boneId: 'hand_r',
  role: 'dominant',
  world: structuredClone(evaluationTransform),
  palmWorld: structuredClone(evaluationTransform),
};
populatedRestEvaluation.hands.secondary = {
  enabled: true,
  boneId: 'hand_l',
  role: 'secondary',
  world: structuredClone(evaluationTransform),
  palmWorld: structuredClone(evaluationTransform),
  targetWorld: structuredClone(evaluationTransform),
  pole: { translation: [0, 1, 0], space: 'unresolved', world: null, reason: 'not_resolved_in_rest_evaluation' },
  preSolveDistanceMeters: 0.1,
};

const parsed = helper.parseSpatialAttachment(source);
assert.equal(parsed.id, 'weapon.rifle');
assert.equal(parsed.skeleton, 'humanoid.standard');
assert.equal(parsed.socket, 'socket.hand_r.primary');
assert.deepEqual(parsed.translation, [0, -0.015, 0.02]);
assert.deepEqual(parsed.rotationDegrees, [0, 0, 0]);

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
const resolvedPoleEvaluation = structuredClone(populatedRestEvaluation);
resolvedPoleEvaluation.schemaVersion = 2;
resolvedPoleEvaluation.attachment.mode = 'two_hand';
resolvedPoleEvaluation.hands.secondary.pole = {
  translation: [0, 1, 0], space: 'item', world: [0.25, 0.5, 0.75], reason: null,
};
resolvedPoleEvaluation.diagnostics.secondaryIk = { status: 'unavailable', reason: 'rest_pose_unsolved' };
resolvedPoleEvaluation.limitations.push('secondary_hand_ik_unavailable');
assert.equal(schematic.isSpatialAttachmentEvaluation(resolvedPoleEvaluation), true);
for (const mutate of [
  (report) => { report.hands.secondary.pole.world = null; },
  (report) => { report.hands.secondary.pole.reason = 'not actually resolved'; },
  (report) => { report.hands.secondary.pole.space = 'unresolved'; },
]) {
  const malformed = structuredClone(resolvedPoleEvaluation);
  mutate(malformed);
  assert.equal(schematic.isSpatialAttachmentEvaluation(malformed), false, 'malformed schema-v2 pole must fail closed');
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
  const malformed = structuredClone(populatedRestEvaluation);
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
assert.match(rereadSource, /const readGeneration = \+\+sourceReadRequestRef\.current[\s\S]*readFile[\s\S]*sourceReadRequestRef\.current !== readGeneration[\s\S]*setSource\(next\.content\)/, 'a superseded same-selection reread must stop before source state mutation');
assert.doesNotMatch(evaluateClientSource, /credential|requestCoordinationLease|method:\s*'POST'|body:/);
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
assert.match(schematicSource, /NOT REVIEW EVIDENCE/);
assert.match(schematicSource, /handleAxisWorld/);
assert.match(schematicSource, /palmWorld/);
assert.match(schematicSource, /a resolved authored pole is shown as a green ring/);
assert.match(schematicSource, /An unresolved pole is never projected/);
assert.match(schematicSource, /Exact evaluator coordinates/);
assert.match(schematicSource, /Evaluator diagnostics/);
assert.match(schematicSource, /isSpatialAttachmentEvaluation\(evaluation\)/);
assert.match(schematicSource, /safeEvaluation \? `\$\{evidenceLabel\} loaded\.` : 'Rest evaluation unavailable\.'/);
assert.match(schematicSource, /<figure/);
assert.match(schematicSource, /role="img"/);
assert.match(schematicSource, /function validPole/, 'the fail-closed validator must inspect versioned pole coordinates');
assert.match(evaluationPointsSource, /secondary\.pole/, 'resolved poles must influence projection bounds');
assert.match(drawingSource, /secondaryPole/, 'resolved poles must be drawn');
assert.match(viewSource, /transitionOperation/);
assert.doesNotMatch(viewSource, /\bwriteFile\b/);
assert.match(clientSource, /X-Shader-Forge-Agent-Credential/);
assert.match(clientSource, /id: 'engine-shell'/);
assert.match(clientSource, /kind: 'shell'/);
assert.match(clientSource, /revision: string/);
assert.match(clientSource, /SpatialAttachmentEvaluationResult/);
assert.match(clientSource, /\/api\/spatial\/attachment\/evaluate/);
assert.match(clientSource, /SpatialAttachmentPreviewResult/);
assert.match(clientSource, /replaceAll\(credential, '\[redacted\]'\)/);
assert.match(stylesSource, /\.workspace-panel\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
assert.match(stylesSource, /\.spatial-actions\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*0;/s);
assert.match(stylesSource, /\.spatial-editor__body\s*\{[^}]*grid-template-columns:\s*minmax\(210px, 250px\)[^;}]*minmax\(300px, 0\.85fr\)[^;}]*minmax\(380px, 1\.2fr\)/s);
assert.match(stylesSource, /\.spatial-rest-schematic__frame\s*\{[^}]*min-height:\s*300px;/s);
assert.match(stylesSource, /@media \(max-width: 1100px\)[\s\S]*?\.spatial-editor__body\s*\{[^}]*grid-template-columns:\s*1fr;/s);
assert.match(stylesSource, /@media \(max-width: 1100px\)[\s\S]*?\.spatial-editor__body\s*\{[^}]*flex:\s*none;[^}]*min-height:\s*auto;/s);
assert.match(stylesSource, /@media \(max-width: 1100px\)[\s\S]*?\.spatial-actions\s*\{[^}]*position:\s*static;/s);
const schematicStyles = stylesSource.slice(
  stylesSource.indexOf('.spatial-rest-schematic {'),
  stylesSource.indexOf('/* Activity */'),
);
assert.doesNotMatch(schematicStyles, /font-size:\s*(?:9|10)px/, 'schematic user-facing text must be at least 11px');

console.log('Engine spatial shell passed.');
console.log('- Verified exact primary-grip-only source edits and unsupported-layout rejection');
console.log('- Verified the Assets-only operation route, explicit lock workflow, and credential redaction markers');
console.log('- Verified revision-bound rest evidence, fail-closed projection guards, truthful labels, and responsive workbench markers');
