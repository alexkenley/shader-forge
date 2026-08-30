import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CoordinationStore } from '../tools/engine-sessiond/lib/coordination-store.mjs';
import { SessionStore, textContentRevision } from '../tools/engine-sessiond/lib/session-store.mjs';
import { startEngineSessiond } from '../tools/engine-sessiond/server.mjs';

const actor = { kind: 'human', id: 'spatial-test', name: 'Spatial Test' };
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-spatial-operations-'));
const projectRoot = path.join(temporaryRoot, 'project');
const secondProjectRoot = path.join(temporaryRoot, 'other-project');
const statePath = path.join(temporaryRoot, 'state', 'sessions.json');
const attachmentPath = 'animation/attachments/rifle.attachment.toml';
const originalContent = 'schema_version = 1\nid = "weapon.rifle.old"\n';
const candidateContent = 'schema_version = 1\nid = "weapon.rifle.new"\n';

for (const root of [projectRoot, secondProjectRoot]) {
  for (const directory of ['skeletons', 'clips', 'graphs', 'attachments']) {
    await fs.mkdir(path.join(root, 'animation', directory), { recursive: true });
  }
}
await fs.writeFile(path.join(projectRoot, attachmentPath), originalContent, 'utf8');
await fs.writeFile(path.join(projectRoot, 'animation', 'skeletons', 'test.skeleton.toml'), 'name = "test"\n', 'utf8');
await fs.writeFile(path.join(projectRoot, 'animation', 'clips', 'test.anim.toml'), 'name = "test"\n', 'utf8');
await fs.writeFile(path.join(projectRoot, 'animation', 'graphs', 'test.animgraph.toml'), 'name = "test"\n', 'utf8');

function profileId(content) {
  return /^id\s*=\s*"([^"]+)"/m.exec(content)?.[1] || '';
}

function identityTransform() {
  return {
    translation: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    axes: {
      x: [1, 0, 0],
      y: [0, 1, 0],
      z: [0, 0, 1],
    },
  };
}

function restEvaluation(attachmentId) {
  return {
    schema: 'shader_forge.spatial_attachment_evaluation',
    schemaVersion: 1,
    pose: { kind: 'rest', sampled: false },
    coordinateSystem: {
      units: 'meters',
      handedness: 'right',
      up: '+Y',
      forward: '+Z',
      quaternionOrder: 'xyzw',
    },
    skeleton: {
      id: 'test.skeleton',
      name: 'test',
      rootBone: 'hand_r',
    },
    attachment: {
      id: attachmentId,
      name: 'Test Attachment',
      itemPrefabId: 'test.item',
      dominantHand: 'right',
      mode: 'one_hand',
      perspective: 'third_person',
      primaryGripSocket: 'socket.hand_r.primary',
    },
    bones: [{
      id: 'hand_r',
      parent: '',
      role: 'hand_r',
      local: identityTransform(),
      world: identityTransform(),
    }],
    segments: [],
    sockets: [{
      id: 'socket.hand_r.primary',
      boneId: 'hand_r',
      role: 'primary_grip',
      local: identityTransform(),
      world: identityTransform(),
    }],
    item: {
      prefabId: 'test.item',
      world: identityTransform(),
      geometry: {
        status: 'unavailable',
        reason: 'item_prefab_geometry_not_integrated',
      },
      primaryContactWorld: null,
      handleAxisWorld: {
        origin: [0, 0, 0],
        direction: [0, 0, 1],
      },
    },
    hands: {
      dominant: {
        boneId: 'hand_r',
        role: 'hand_r',
        world: identityTransform(),
        palmWorld: null,
      },
      secondary: null,
    },
    diagnostics: {
      secondaryIk: { status: 'not_applicable', reason: 'one_hand_attachment' },
      jointLimits: { status: 'unavailable', reason: 'joint_limits_not_authored' },
      clipping: { status: 'unavailable', reason: 'item_and_capsule_geometry_not_integrated' },
    },
    limitations: ['rest_pose_only', 'not_review_evidence', 'item_mesh_unavailable'],
  };
}

function mutateRestEvaluation(attachmentId, mutate) {
  const evaluation = restEvaluation(attachmentId);
  mutate(evaluation);
  return evaluation;
}

function attachmentEvaluatePath(query) {
  return `/api/spatial/attachment/evaluate?${new URLSearchParams(query).toString()}`;
}

const stagedRoots = [];
const evaluatedCalls = [];
let evaluateImpl = async (animationRoot, attachmentId) => {
  const contents = {};
  for (const name of (await fs.readdir(path.join(animationRoot, 'attachments'))).sort()) {
    if (!name.endsWith('.attachment.toml')) continue;
    contents[name] = await fs.readFile(path.join(animationRoot, 'attachments', name), 'utf8');
  }
  evaluatedCalls.push({ animationRoot, attachmentId, contents });
  return restEvaluation(attachmentId);
};

async function evaluateRestAttachment(animationRoot, attachmentId) {
  return evaluateImpl(animationRoot, attachmentId);
}

async function validateAnimationRoot(animationRoot) {
  stagedRoots.push(animationRoot);
  for (const directory of ['skeletons', 'clips', 'graphs', 'attachments']) {
    assert.equal((await fs.stat(path.join(animationRoot, directory))).isDirectory(), true);
  }
  assert.deepEqual(await fs.readdir(path.join(animationRoot, 'skeletons')), ['test.skeleton.toml']);
  assert.deepEqual(await fs.readdir(path.join(animationRoot, 'clips')), ['test.anim.toml']);
  assert.deepEqual(await fs.readdir(path.join(animationRoot, 'graphs')), ['test.animgraph.toml']);
  const profiles = [];
  for (const name of (await fs.readdir(path.join(animationRoot, 'attachments'))).sort()) {
    if (!name.endsWith('.attachment.toml')) continue;
    const content = await fs.readFile(path.join(animationRoot, 'attachments', name), 'utf8');
    if (content.includes('INVALID')) {
      const error = new Error('Attachment mode must be one_hand or two_hand.');
      error.stderr = 'native diagnostic: Attachment mode must be one_hand or two_hand.';
      throw error;
    }
    const id = profileId(content);
    if (!id) throw new Error('Attachment id is required.');
    profiles.push({ id, source: `attachments/${name}`, schemaVersion: 1 });
  }
  return {
    schema: 'shader_forge.spatial_validation',
    schemaVersion: 1,
    animationRoot,
    counts: { skeletons: 0, clips: 0, graphs: 0, attachmentProfiles: profiles.length },
    skeletons: [],
    attachmentProfiles: profiles,
  };
}

async function request(baseUrl, pathname, { method = 'GET', body, credential } = {}) {
  const response = await fetch(new URL(pathname, baseUrl), {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(credential ? { 'X-Shader-Forge-Agent-Credential': credential } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json();
  return { status: response.status, payload, headers: response.headers };
}

function assertStoreError(action, { statusCode, code }) {
  assert.throws(action, (error) => {
    assert.equal(error.statusCode, statusCode);
    if (code) assert.equal(error.code, code);
    return true;
  });
}

function exerciseCoordinationAssertions(sessionId, otherSessionId) {
  let nowMs = Date.now();
  const store = new CoordinationStore({ now: () => nowMs, heartbeatTimeoutMs: 1000 });
  const first = store.registerAgent({ sessionId, name: 'first' });
  const second = store.registerAgent({ sessionId, name: 'second' });
  const foreign = store.registerAgent({ sessionId: otherSessionId, name: 'foreign' });
  const rifleKey = 'spatial/attachment/weapon.rifle.old';

  assertStoreError(() => store.assertGrantedWriteLease({
    sessionId, agentId: first.agent.id, credential: first.credential,
    leaseId: 'lease_missing', resources: [rifleKey],
  }), { statusCode: 404, code: 'lease_not_found' });

  const readLease = store.requestLease({
    agentId: first.agent.id, credential: first.credential, resources: [rifleKey], mode: 'read',
  });
  assertStoreError(() => store.assertGrantedWriteLease({
    sessionId, agentId: first.agent.id, credential: first.credential,
    leaseId: readLease.id, resources: [rifleKey],
  }), { statusCode: 409, code: 'lease_write_required' });
  store.releaseLease(readLease.id, { agentId: first.agent.id, credential: first.credential });

  const held = store.requestLease({
    agentId: first.agent.id, credential: first.credential, resources: [rifleKey], mode: 'write',
  });
  const queued = store.requestLease({
    agentId: second.agent.id, credential: second.credential, resources: [rifleKey], mode: 'write',
  });
  assert.equal(queued.status, 'queued', 'same-profile writes must contend');
  assertStoreError(() => store.assertGrantedWriteLease({
    sessionId, agentId: second.agent.id, credential: second.credential,
    leaseId: queued.id, resources: [rifleKey],
  }), { statusCode: 409, code: 'lease_not_granted' });
  assertStoreError(() => store.assertGrantedWriteLease({
    sessionId, agentId: second.agent.id, credential: second.credential,
    leaseId: held.id, resources: [rifleKey],
  }), { statusCode: 403, code: 'lease_owner_mismatch' });
  assertStoreError(() => store.assertGrantedWriteLease({
    sessionId, agentId: foreign.agent.id, credential: foreign.credential,
    leaseId: held.id, resources: [rifleKey],
  }), { statusCode: 403, code: 'lease_agent_session_mismatch' });
  assertStoreError(() => store.assertGrantedWriteLease({
    sessionId, agentId: first.agent.id, credential: first.credential,
    leaseId: held.id, resources: ['spatial/attachment/weapon.pistol'],
  }), { statusCode: 409, code: 'lease_resource_mismatch' });

  const childOnly = store.requestLease({
    agentId: first.agent.id,
    credential: first.credential,
    resources: ['spatial/attachment/weapon.child/left'],
    mode: 'write',
  });
  assertStoreError(() => store.assertGrantedWriteLease({
    sessionId, agentId: first.agent.id, credential: first.credential,
    leaseId: childOnly.id, resources: ['spatial/attachment/weapon.child'],
  }), { statusCode: 409, code: 'lease_resource_mismatch' });
  const siblingChild = store.requestLease({
    agentId: second.agent.id,
    credential: second.credential,
    resources: ['spatial/attachment/weapon.child/right'],
    mode: 'write',
  });
  assert.equal(siblingChild.status, 'granted');
  assertStoreError(() => store.assertGrantedWriteLease({
    sessionId, agentId: second.agent.id, credential: second.credential,
    leaseId: siblingChild.id, resources: ['spatial/attachment/weapon.child'],
  }), { statusCode: 409, code: 'lease_resource_mismatch' });
  store.releaseLease(siblingChild.id, { agentId: second.agent.id, credential: second.credential });
  store.releaseLease(childOnly.id, { agentId: first.agent.id, credential: first.credential });

  const unrelated = store.requestLease({
    agentId: second.agent.id,
    credential: second.credential,
    resources: ['spatial/attachment/weapon.pistol'],
    mode: 'write',
  });
  assert.equal(unrelated.status, 'granted', 'unrelated profiles should allow concurrent writes');
  store.releaseLease(unrelated.id, { agentId: second.agent.id, credential: second.credential });
  store.releaseLease(held.id, { agentId: first.agent.id, credential: first.credential });
  assert.equal(store.getLease(queued.id).status, 'granted');

  nowMs += 1001;
  assertStoreError(() => store.assertGrantedWriteLease({
    sessionId, agentId: second.agent.id, credential: second.credential,
    leaseId: queued.id, resources: [rifleKey],
  }), { statusCode: 404 });
}

let service;
try {
  const sessionStore = new SessionStore({ storageFilePath: statePath });
  service = await startEngineSessiond({
    port: 0,
    sessionStore,
    validateAnimationRoot,
    evaluateRestAttachment,
  });
  const firstSession = await sessionStore.createSession({ name: 'spatial', rootPath: projectRoot });
  const secondSession = await sessionStore.createSession({ name: 'other', rootPath: secondProjectRoot });
  exerciseCoordinationAssertions(firstSession.id, secondSession.id);
  await fs.rm(path.join(secondProjectRoot, 'animation', 'clips'), { recursive: true });
  await fs.symlink(
    path.join(projectRoot, 'animation', 'clips'),
    path.join(secondProjectRoot, 'animation', 'clips'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(
    sessionStore.listFiles(secondSession.id, 'animation/clips', { rejectSymbolicPath: true }),
    (error) => error.code === 'symbolic_path_rejected',
  );

  const registration = await request(service.baseUrl, '/api/coordination/agents', {
    method: 'POST', body: { sessionId: firstSession.id, name: 'author' },
  });
  assert.equal(registration.status, 201);
  const { agent, credential } = registration.payload;

  const operationsPath = path.join(path.dirname(statePath), 'operations.json');
  const originalRevision = textContentRevision(originalContent);
  const evaluateQuery = {
    sessionId: firstSession.id,
    path: attachmentPath,
    baseRevision: originalRevision,
  };
  const callsBeforeEvaluateGates = evaluatedCalls.length;

  const invalidEvaluatePath = await request(service.baseUrl, attachmentEvaluatePath({
    ...evaluateQuery,
    path: 'animation/rifle.attachment.toml',
  }));
  assert.equal(invalidEvaluatePath.status, 400);
  assert.equal(invalidEvaluatePath.payload.code, 'spatial_attachment_path_invalid');

  const missingRevision = await request(service.baseUrl, attachmentEvaluatePath({
    ...evaluateQuery,
    baseRevision: 'missing',
  }));
  assert.equal(missingRevision.status, 400);
  assert.equal(missingRevision.payload.code, 'spatial_request_invalid');

  const staleEvaluate = await request(service.baseUrl, attachmentEvaluatePath({
    ...evaluateQuery,
    baseRevision: textContentRevision('stale'),
  }));
  assert.equal(staleEvaluate.status, 409);
  assert.equal(staleEvaluate.payload.code, 'revision_conflict');

  const missingEvaluate = await request(service.baseUrl, attachmentEvaluatePath({
    ...evaluateQuery,
    path: 'animation/attachments/missing.attachment.toml',
  }));
  assert.equal(missingEvaluate.status, 404);
  assert.equal(missingEvaluate.payload.code, 'spatial_attachment_missing');

  const crossSessionEvaluate = await request(service.baseUrl, attachmentEvaluatePath({
    ...evaluateQuery,
    sessionId: secondSession.id,
  }));
  assert.equal(crossSessionEvaluate.status, 404);
  assert.equal(crossSessionEvaluate.payload.code, 'spatial_attachment_missing');
  assert.equal(evaluatedCalls.length, callsBeforeEvaluateGates);
  await assert.rejects(fs.stat(operationsPath), { code: 'ENOENT' });

  await fs.writeFile(path.join(secondProjectRoot, attachmentPath), originalContent, 'utf8');
  const sourceSymlinkEvaluate = await request(service.baseUrl, attachmentEvaluatePath({
    ...evaluateQuery,
    sessionId: secondSession.id,
  }));
  assert.equal(sourceSymlinkEvaluate.status, 400);
  assert.equal(sourceSymlinkEvaluate.payload.code, 'symbolic_path_rejected');
  assert.equal(evaluatedCalls.length, callsBeforeEvaluateGates);
  await fs.rm(path.join(secondProjectRoot, attachmentPath));

  const baselineEvaluate = await request(service.baseUrl, attachmentEvaluatePath(evaluateQuery));
  assert.equal(baselineEvaluate.status, 200);
  assert.equal(baselineEvaluate.payload.path, attachmentPath);
  assert.equal(baselineEvaluate.payload.revision, originalRevision);
  assert.equal(baselineEvaluate.payload.evaluation.schema, 'shader_forge.spatial_attachment_evaluation');
  assert.deepEqual(baselineEvaluate.payload.evaluation.pose, { kind: 'rest', sampled: false });
  assert.deepEqual(baselineEvaluate.payload.evaluation.coordinateSystem, {
    units: 'meters', handedness: 'right', up: '+Y', forward: '+Z', quaternionOrder: 'xyzw',
  });
  assert.equal(baselineEvaluate.payload.evaluation.attachment.id, 'weapon.rifle.old');
  assert.equal(baselineEvaluate.payload.evaluation.item.geometry.status, 'unavailable');
  assert.deepEqual(baselineEvaluate.payload.evaluation.item.handleAxisWorld.direction, [0, 0, 1]);
  assert.deepEqual(baselineEvaluate.payload.evaluation.limitations, [
    'rest_pose_only', 'not_review_evidence', 'item_mesh_unavailable',
  ]);
  assert.equal('operation' in baselineEvaluate.payload, false);
  assert.equal('capture' in baselineEvaluate.payload, false);
  assert.equal(evaluatedCalls.at(-1).attachmentId, 'weapon.rifle.old');
  assert.equal(evaluatedCalls.at(-1).contents['rifle.attachment.toml'], originalContent);
  assert.deepEqual(service.operationStore.listOperations(), []);
  await assert.rejects(fs.stat(operationsPath), { code: 'ENOENT' });

  const normalEvaluate = evaluateImpl;
  evaluateImpl = async () => restEvaluation('weapon.wrong');
  const wrongIdEvaluate = await request(service.baseUrl, attachmentEvaluatePath(evaluateQuery));
  assert.equal(wrongIdEvaluate.status, 500);
  assert.equal(wrongIdEvaluate.payload.code, 'spatial_evaluator_protocol_error');

  const malformedSemanticCases = [
    ['legacy empty nested objects', (id) => ({
      schema: 'shader_forge.spatial_attachment_evaluation',
      schemaVersion: 1,
      pose: { kind: 'rest', sampled: false },
      attachment: { id },
      bones: [],
      segments: [],
      sockets: [],
      item: {},
      hands: {},
      diagnostics: {},
    })],
    ['unexpected nested key', (id) => mutateRestEvaluation(id, (evaluation) => {
      evaluation.item.world.axes.extra = [0, 0, 0];
    })],
    ['non-unit quaternion', (id) => mutateRestEvaluation(id, (evaluation) => {
      evaluation.item.world.rotation = [0, 0, 0, 0.5];
    })],
    ['negative-w quaternion', (id) => mutateRestEvaluation(id, (evaluation) => {
      evaluation.item.world.rotation = [0, 0, 0, -1];
    })],
    ['left-handed axes', (id) => mutateRestEvaluation(id, (evaluation) => {
      evaluation.item.world.axes.z = [0, 0, -1];
    })],
    ['axes inconsistent with quaternion', (id) => mutateRestEvaluation(id, (evaluation) => {
      evaluation.item.world.axes = { x: [0, 0, -1], y: [0, 1, 0], z: [1, 0, 0] };
    })],
    ['non-normalized handle direction', (id) => mutateRestEvaluation(id, (evaluation) => {
      evaluation.item.handleAxisWorld.direction = [0, 0, 2];
    })],
    ['non-finite geometry', (id) => mutateRestEvaluation(id, (evaluation) => {
      evaluation.item.world.translation = [Number.POSITIVE_INFINITY, 0, 0];
    })],
    ['wrong diagnostic contract', (id) => mutateRestEvaluation(id, (evaluation) => {
      evaluation.diagnostics.secondaryIk = { status: 'unavailable', reason: 'unknown' };
    })],
    ['oversized report', (id) => mutateRestEvaluation(id, (evaluation) => {
      evaluation.attachment.name = 'n'.repeat(8 * 1024 * 1024);
    })],
  ];
  for (const [label, factory] of malformedSemanticCases) {
    evaluateImpl = async (_animationRoot, attachmentId) => factory(attachmentId);
    const malformedEvaluate = await request(service.baseUrl, attachmentEvaluatePath(evaluateQuery));
    assert.equal(malformedEvaluate.status, 500, label);
    assert.equal(malformedEvaluate.payload.code, 'spatial_evaluator_protocol_error', label);
    assert.equal(malformedEvaluate.payload.error.length < 200, true, label);
    assert.equal('evaluation' in malformedEvaluate.payload, false, label);
  }
  assert.deepEqual(service.operationStore.listOperations(), []);
  evaluateImpl = normalEvaluate;

  evaluateImpl = async () => {
    const error = new Error('unavailable');
    error.code = 'spatial_evaluator_unavailable';
    error.statusCode = 503;
    error.diagnostic = 'u'.repeat(9000);
    throw error;
  };
  const boundedUnavailable = await request(service.baseUrl, attachmentEvaluatePath(evaluateQuery));
  assert.equal(boundedUnavailable.status, 503);
  assert.equal(boundedUnavailable.payload.code, 'spatial_evaluator_unavailable');
  assert.equal(boundedUnavailable.payload.error.length, 8000);

  evaluateImpl = async () => {
    const error = new Error('spawn failed');
    error.code = 'EACCES';
    error.stderr = 'i'.repeat(9000);
    throw error;
  };
  const infrastructureFailure = await request(service.baseUrl, attachmentEvaluatePath(evaluateQuery));
  assert.equal(infrastructureFailure.status, 500);
  assert.equal(infrastructureFailure.payload.code, 'spatial_evaluator_infrastructure_error');
  assert.equal(infrastructureFailure.payload.diagnostic.length, 8000);

  evaluateImpl = async (animationRoot, attachmentId) => {
    const evaluation = await normalEvaluate(animationRoot, attachmentId);
    await fs.writeFile(path.join(projectRoot, attachmentPath), candidateContent, 'utf8');
    return evaluation;
  };
  const revisionDrift = await request(service.baseUrl, attachmentEvaluatePath(evaluateQuery));
  assert.equal(revisionDrift.status, 409);
  assert.equal(revisionDrift.payload.code, 'revision_conflict');
  assert.equal(revisionDrift.payload.conflict.actualRevision, textContentRevision(candidateContent));
  await fs.writeFile(path.join(projectRoot, attachmentPath), originalContent, 'utf8');
  evaluateImpl = normalEvaluate;

  const previousBinary = process.env.SHADER_FORGE_SPATIAL_BINARY;
  const previousCwd = process.cwd();
  let malformedService;
  try {
    await fs.writeFile(
      path.join(temporaryRoot, 'evaluate-rest'),
      "process.stdout.write('{not-json');\n",
      'utf8',
    );
    process.chdir(temporaryRoot);
    process.env.SHADER_FORGE_SPATIAL_BINARY = process.execPath;
    malformedService = await startEngineSessiond({
      port: 0,
      sessionStore,
      validateAnimationRoot,
    });
    const malformedJson = await request(malformedService.baseUrl, attachmentEvaluatePath(evaluateQuery));
    assert.equal(malformedJson.status, 500);
    assert.equal(malformedJson.payload.code, 'spatial_evaluator_protocol_error');
  } finally {
    if (malformedService) await malformedService.close();
    process.chdir(previousCwd);
    if (previousBinary === undefined) delete process.env.SHADER_FORGE_SPATIAL_BINARY;
    else process.env.SHADER_FORGE_SPATIAL_BINARY = previousBinary;
  }
  assert.deepEqual(service.operationStore.listOperations(), []);
  await assert.rejects(fs.stat(operationsPath), { code: 'ENOENT' });

  const oldOnly = await request(service.baseUrl, '/api/coordination/leases', {
    method: 'POST', credential,
    body: {
      agentId: agent.id, mode: 'write', resources: ['spatial/attachment/weapon.rifle.old'],
    },
  });
  assert.equal(oldOnly.payload.lease.status, 'granted');

  const previewBody = {
    sessionId: firstSession.id,
    path: attachmentPath,
    content: candidateContent,
    baseRevision: textContentRevision(originalContent),
    label: 'Tune rifle grip',
    actor,
    agentId: agent.id,
    leaseId: oldOnly.payload.lease.id,
  };

  const callsBeforePathGate = stagedRoots.length;
  const evalsBeforePathGate = evaluatedCalls.length;
  const invalidPath = await request(service.baseUrl, '/api/operations/spatial-attachment/preview', {
    method: 'POST', credential, body: { ...previewBody, path: 'animation/rifle.attachment.toml' },
  });
  assert.equal(invalidPath.status, 400);
  assert.equal(invalidPath.payload.code, 'spatial_attachment_path_invalid');
  assert.equal(stagedRoots.length, callsBeforePathGate);
  assert.equal(evaluatedCalls.length, evalsBeforePathGate);

  const stale = await request(service.baseUrl, '/api/operations/spatial-attachment/preview', {
    method: 'POST', credential, body: { ...previewBody, baseRevision: textContentRevision('stale') },
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.payload.code, 'revision_conflict');
  assert.equal(stagedRoots.length, callsBeforePathGate);
  assert.equal(evaluatedCalls.length, evalsBeforePathGate);

  const evalsBeforeLeaseGate = evaluatedCalls.length;
  const renameWithoutBothKeys = await request(service.baseUrl, '/api/operations/spatial-attachment/preview', {
    method: 'POST', credential, body: previewBody,
  });
  assert.equal(renameWithoutBothKeys.status, 409);
  assert.equal(renameWithoutBothKeys.payload.code, 'lease_resource_mismatch');
  assert.deepEqual(service.operationStore.listOperations(), []);
  assert.equal(await fs.readFile(path.join(projectRoot, attachmentPath), 'utf8'), originalContent);
  assert.equal(evaluatedCalls.length, evalsBeforeLeaseGate);

  const evalsBeforeInvalidCandidate = evaluatedCalls.length;
  const invalid = await request(service.baseUrl, '/api/operations/spatial-attachment/preview', {
    method: 'POST', credential,
    body: { ...previewBody, content: `${originalContent}INVALID\n` },
  });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.payload.code, 'spatial_candidate_invalid');
  assert.match(invalid.payload.diagnostic, /native diagnostic/);
  assert.deepEqual(service.operationStore.listOperations(), []);
  assert.equal(evaluatedCalls.length, evalsBeforeInvalidCandidate);

  await request(service.baseUrl, `/api/coordination/leases/${oldOnly.payload.lease.id}/release`, {
    method: 'POST', credential, body: { agentId: agent.id },
  });
  let bothKeys = await request(service.baseUrl, '/api/coordination/leases', {
    method: 'POST', credential,
    body: {
      agentId: agent.id,
      mode: 'write',
      resources: [
        'spatial/attachment/weapon.rifle.old',
        'spatial/attachment/weapon.rifle.new',
      ],
    },
  });
  assert.equal(bothKeys.payload.lease.status, 'granted');

  evaluateImpl = async (animationRoot, attachmentId) => {
    const evaluation = await normalEvaluate(animationRoot, attachmentId);
    if (attachmentId === 'weapon.rifle.old') evaluation.item.world.rotation = [0, 0, 0, 0.5];
    return evaluation;
  };
  const malformedBaselinePreview = await request(
    service.baseUrl,
    '/api/operations/spatial-attachment/preview',
    { method: 'POST', credential, body: { ...previewBody, leaseId: bothKeys.payload.lease.id } },
  );
  assert.equal(malformedBaselinePreview.status, 500);
  assert.equal(malformedBaselinePreview.payload.code, 'spatial_evaluator_protocol_error');
  assert.deepEqual(service.operationStore.listOperations(), []);

  evaluateImpl = async (animationRoot, attachmentId) => {
    const evaluation = await normalEvaluate(animationRoot, attachmentId);
    if (attachmentId === 'weapon.rifle.new') evaluation.item.handleAxisWorld.direction = [0, 0, 2];
    return evaluation;
  };
  const malformedCandidatePreview = await request(
    service.baseUrl,
    '/api/operations/spatial-attachment/preview',
    { method: 'POST', credential, body: { ...previewBody, leaseId: bothKeys.payload.lease.id } },
  );
  assert.equal(malformedCandidatePreview.status, 500);
  assert.equal(malformedCandidatePreview.payload.code, 'spatial_evaluator_protocol_error');
  assert.deepEqual(service.operationStore.listOperations(), []);

  evaluateImpl = async (animationRoot, attachmentId) => {
    const evaluation = await normalEvaluate(animationRoot, attachmentId);
    if (attachmentId === 'weapon.rifle.new') {
      service.coordinationStore.releaseLease(bothKeys.payload.lease.id, { agentId: agent.id, credential });
    }
    return evaluation;
  };
  const lostDuringEvaluation = await request(service.baseUrl, '/api/operations/spatial-attachment/preview', {
    method: 'POST', credential,
    body: { ...previewBody, leaseId: bothKeys.payload.lease.id },
  });
  assert.equal(lostDuringEvaluation.status, 409);
  assert.equal(lostDuringEvaluation.payload.code, 'lease_not_granted');
  assert.deepEqual(service.operationStore.listOperations(), []);
  evaluateImpl = normalEvaluate;
  bothKeys = await request(service.baseUrl, '/api/coordination/leases', {
    method: 'POST', credential,
    body: {
      agentId: agent.id,
      mode: 'write',
      resources: [
        'spatial/attachment/weapon.rifle.old',
        'spatial/attachment/weapon.rifle.new',
      ],
    },
  });
  assert.equal(bothKeys.payload.lease.status, 'granted');

  const evalsBeforePreview = evaluatedCalls.length;
  const preview = await request(service.baseUrl, '/api/operations/spatial-attachment/preview', {
    method: 'POST', credential,
    body: { ...previewBody, leaseId: bothKeys.payload.lease.id },
  });
  assert.equal(preview.status, 201);
  assert.equal(preview.payload.operation.kind, 'file_write');
  assert.deepEqual(preview.payload.operation.context, {
    type: 'spatial_attachment',
    label: 'Tune rifle grip',
    subjectId: 'weapon.rifle.new',
    resourceKeys: [
      'spatial/attachment/weapon.rifle.new',
      'spatial/attachment/weapon.rifle.old',
    ],
    leaseId: bothKeys.payload.lease.id,
  });
  assert.equal(preview.payload.validation.previousSubjectId, 'weapon.rifle.old');
  assert.equal(preview.payload.validation.subjectId, 'weapon.rifle.new');
  assert.equal('animationRoot' in preview.payload.validation.baseline, false);
  assert.equal(preview.payload.evaluation.baseline.attachment.id, 'weapon.rifle.old');
  assert.equal(preview.payload.evaluation.candidate.attachment.id, 'weapon.rifle.new');
  assert.deepEqual(preview.payload.evaluation.baseline.pose, { kind: 'rest', sampled: false });
  assert.deepEqual(preview.payload.evaluation.candidate.pose, { kind: 'rest', sampled: false });
  assert.equal('evaluation' in preview.payload.operation, false);
  assert.equal('evaluation' in preview.payload.operation.context, false);
  assert.equal(await fs.readFile(path.join(projectRoot, attachmentPath), 'utf8'), originalContent);
  const previewEvaluations = evaluatedCalls.slice(evalsBeforePreview);
  assert.equal(previewEvaluations.length, 2);
  const previewById = Object.fromEntries(
    previewEvaluations.map((entry) => [entry.attachmentId, entry]),
  );
  assert.equal(previewById['weapon.rifle.old'].contents['rifle.attachment.toml'], originalContent);
  assert.equal(previewById['weapon.rifle.new'].contents['rifle.attachment.toml'], candidateContent);
  const journal = JSON.parse(await fs.readFile(path.join(path.dirname(statePath), 'operations.json'), 'utf8'));
  assert.deepEqual(Object.keys(journal.operations[0].context).sort(), [
    'label', 'leaseId', 'resourceKeys', 'subjectId', 'type',
  ]);
  assert.equal(JSON.stringify(journal).includes(credential), false, 'agent credentials must never persist');
  assert.equal(JSON.stringify(journal).includes('shader_forge.spatial_attachment_evaluation'), false);
  assert.equal('evaluation' in journal.operations[0], false);
  assert.equal('evaluation' in journal.operations[0].context, false);

  const pistolPath = 'animation/attachments/pistol.attachment.toml';
  const pistolContent = 'schema_version = 1\nid = "weapon.pistol"\n';
  const pistolLease = await request(service.baseUrl, '/api/coordination/leases', {
    method: 'POST', credential,
    body: { agentId: agent.id, mode: 'write', resources: ['spatial/attachment/weapon.pistol'] },
  });
  assert.equal(pistolLease.payload.lease.status, 'granted');
  const evalsBeforeNewFile = evaluatedCalls.length;
  const newFilePreview = await request(service.baseUrl, '/api/operations/spatial-attachment/preview', {
    method: 'POST', credential,
    body: {
      sessionId: firstSession.id,
      path: pistolPath,
      content: pistolContent,
      baseRevision: 'missing',
      label: 'Add pistol',
      actor,
      agentId: agent.id,
      leaseId: pistolLease.payload.lease.id,
    },
  });
  assert.equal(newFilePreview.status, 201);
  assert.equal(newFilePreview.payload.evaluation.baseline, null);
  assert.equal(newFilePreview.payload.evaluation.candidate.attachment.id, 'weapon.pistol');
  assert.equal(evaluatedCalls.length, evalsBeforeNewFile + 1);
  assert.equal(evaluatedCalls.at(-1).contents['pistol.attachment.toml'], pistolContent);
  await assert.rejects(fs.stat(path.join(projectRoot, pistolPath)), { code: 'ENOENT' });
  await request(service.baseUrl, `/api/coordination/leases/${pistolLease.payload.lease.id}/release`, {
    method: 'POST', credential, body: { agentId: agent.id },
  });
  const journalAfterNewFile = JSON.parse(await fs.readFile(operationsPath, 'utf8'));
  assert.equal(
    journalAfterNewFile.operations.some((operation) => 'evaluation' in operation),
    false,
  );

  for (const stagedRoot of stagedRoots) {
    await assert.rejects(fs.stat(path.dirname(stagedRoot)), { code: 'ENOENT' });
  }
  for (const evaluated of evaluatedCalls) {
    await assert.rejects(fs.stat(path.dirname(evaluated.animationRoot)), { code: 'ENOENT' });
  }

  const operationId = preview.payload.operation.id;
  const approved = await request(service.baseUrl, `/api/operations/${operationId}/approve`, {
    method: 'POST', body: { actor },
  });
  assert.equal(approved.status, 200);
  await request(service.baseUrl, `/api/coordination/leases/${bothKeys.payload.lease.id}/release`, {
    method: 'POST', credential, body: { agentId: agent.id },
  });

  const applyWithoutLease = await request(service.baseUrl, `/api/operations/${operationId}/apply`, {
    method: 'POST', body: { actor },
  });
  assert.equal(applyWithoutLease.status, 400);
  assert.equal(await fs.readFile(path.join(projectRoot, attachmentPath), 'utf8'), originalContent);

  const wrongResource = await request(service.baseUrl, '/api/coordination/leases', {
    method: 'POST', credential,
    body: { agentId: agent.id, mode: 'write', resources: ['spatial/attachment/weapon.pistol'] },
  });
  const wrongApply = await request(service.baseUrl, `/api/operations/${operationId}/apply`, {
    method: 'POST', credential,
    body: { actor, agentId: agent.id, leaseId: wrongResource.payload.lease.id },
  });
  assert.equal(wrongApply.status, 409);
  assert.equal(wrongApply.payload.code, 'lease_resource_mismatch');

  const renewed = await request(service.baseUrl, '/api/coordination/leases', {
    method: 'POST', credential,
    body: {
      agentId: agent.id,
      mode: 'write',
      resources: ['spatial/attachment/weapon.rifle.old', 'spatial/attachment/weapon.rifle.new'],
    },
  });
  assert.equal(renewed.payload.lease.status, 'granted');
  const applied = await request(service.baseUrl, `/api/operations/${operationId}/apply`, {
    method: 'POST', credential,
    body: { actor, agentId: agent.id, leaseId: renewed.payload.lease.id },
  });
  assert.equal(applied.status, 200);
  assert.equal(applied.payload.operation.state, 'applied');
  assert.equal(await fs.readFile(path.join(projectRoot, attachmentPath), 'utf8'), candidateContent);

  await request(service.baseUrl, `/api/coordination/leases/${renewed.payload.lease.id}/release`, {
    method: 'POST', credential, body: { agentId: agent.id },
  });
  const undoWithoutLease = await request(service.baseUrl, `/api/operations/${operationId}/undo`, {
    method: 'POST', body: { actor },
  });
  assert.equal(undoWithoutLease.status, 400);
  assert.equal(await fs.readFile(path.join(projectRoot, attachmentPath), 'utf8'), candidateContent);

  const undoLease = await request(service.baseUrl, '/api/coordination/leases', {
    method: 'POST', credential,
    body: {
      agentId: agent.id,
      mode: 'write',
      resources: ['spatial/attachment/weapon.rifle.old', 'spatial/attachment/weapon.rifle.new'],
    },
  });
  const undone = await request(service.baseUrl, `/api/operations/${operationId}/undo`, {
    method: 'POST', credential,
    body: { actor, agentId: agent.id, leaseId: undoLease.payload.lease.id },
  });
  assert.equal(undone.status, 200);
  assert.equal(undone.payload.operation.state, 'undone');
  assert.equal(undone.payload.operation.resultingRevision, textContentRevision(originalContent));
  assert.equal(await fs.readFile(path.join(projectRoot, attachmentPath), 'utf8'), originalContent);

  const preflight = await fetch(new URL('/api/operations/spatial-attachment/preview', service.baseUrl), {
    method: 'OPTIONS',
    headers: { Origin: 'http://127.0.0.1:41742' },
  });
  assert.match(preflight.headers.get('access-control-allow-headers') || '', /X-Shader-Forge-Agent-Credential/);

  await service.close();
  service = null;
  const restartedStore = new SessionStore({ storageFilePath: statePath });
  service = await startEngineSessiond({
    port: 0,
    sessionStore: restartedStore,
    validateAnimationRoot,
    evaluateRestAttachment,
  });
  const restored = await request(service.baseUrl, `/api/operations/${operationId}`);
  assert.equal(restored.status, 200);
  assert.deepEqual(restored.payload.operation.context, preview.payload.operation.context);
} finally {
  if (service) await service.close();
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}

console.log('Engine spatial attachment operations passed.');
console.log('- Verified native-backed no-write preview, durable context, revision safety, and temp cleanup');
console.log('- Verified exact profile leases, rename coverage, contention, renewal, apply, and undo gates');
console.log('- Verified read-only rest evaluation, exact staged IDs/bytes, and journal exclusion');
