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

const stagedRoots = [];
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
  const invalidPath = await request(service.baseUrl, '/api/operations/spatial-attachment/preview', {
    method: 'POST', credential, body: { ...previewBody, path: 'animation/rifle.attachment.toml' },
  });
  assert.equal(invalidPath.status, 400);
  assert.equal(invalidPath.payload.code, 'spatial_attachment_path_invalid');
  assert.equal(stagedRoots.length, callsBeforePathGate);

  const stale = await request(service.baseUrl, '/api/operations/spatial-attachment/preview', {
    method: 'POST', credential, body: { ...previewBody, baseRevision: textContentRevision('stale') },
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.payload.code, 'revision_conflict');
  assert.equal(stagedRoots.length, callsBeforePathGate);

  const renameWithoutBothKeys = await request(service.baseUrl, '/api/operations/spatial-attachment/preview', {
    method: 'POST', credential, body: previewBody,
  });
  assert.equal(renameWithoutBothKeys.status, 409);
  assert.equal(renameWithoutBothKeys.payload.code, 'lease_resource_mismatch');
  assert.deepEqual(service.operationStore.listOperations(), []);
  assert.equal(await fs.readFile(path.join(projectRoot, attachmentPath), 'utf8'), originalContent);

  const invalid = await request(service.baseUrl, '/api/operations/spatial-attachment/preview', {
    method: 'POST', credential,
    body: { ...previewBody, content: `${originalContent}INVALID\n` },
  });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.payload.code, 'spatial_candidate_invalid');
  assert.match(invalid.payload.diagnostic, /native diagnostic/);
  assert.deepEqual(service.operationStore.listOperations(), []);

  await request(service.baseUrl, `/api/coordination/leases/${oldOnly.payload.lease.id}/release`, {
    method: 'POST', credential, body: { agentId: agent.id },
  });
  const bothKeys = await request(service.baseUrl, '/api/coordination/leases', {
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
  assert.equal(await fs.readFile(path.join(projectRoot, attachmentPath), 'utf8'), originalContent);
  const journal = JSON.parse(await fs.readFile(path.join(path.dirname(statePath), 'operations.json'), 'utf8'));
  assert.deepEqual(Object.keys(journal.operations[0].context).sort(), [
    'label', 'leaseId', 'resourceKeys', 'subjectId', 'type',
  ]);
  assert.equal(JSON.stringify(journal).includes(credential), false, 'agent credentials must never persist');
  for (const stagedRoot of stagedRoots) {
    await assert.rejects(fs.stat(path.dirname(stagedRoot)), { code: 'ENOENT' });
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
  service = await startEngineSessiond({ port: 0, sessionStore: restartedStore, validateAnimationRoot });
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
