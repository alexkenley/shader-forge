import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { CoordinationStore } from '../tools/engine-sessiond/lib/coordination-store.mjs';
import { OperationStore } from '../tools/engine-sessiond/lib/operation-store.mjs';
import { SceneAssetService } from '../tools/engine-sessiond/lib/scene-asset-service.mjs';
import { MISSING_FILE_REVISION, SessionStore } from '../tools/engine-sessiond/lib/session-store.mjs';
import { startEngineSessiond } from '../tools/engine-sessiond/server.mjs';
import { repoRootFromScript } from './lib/harness-utils.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-scene-operations-'));
const project = path.join(root, 'project');
const state = path.join(root, 'state');
const repoRoot = repoRootFromScript(import.meta.url);
const actor = { kind: 'human', id: 'scene-test', name: 'Scene Test' };

function scene(name, title = name) {
  return `schema = "shader_forge.scene"\nschema_version = 1\nname = "${name}"\nowner_system = "scene_system"\nruntime_format = "flatbuffer"\ntitle = "${title}"\nprimary_prefab = "debug_camera"\n`;
}

for (const directory of ['scenes', 'prefabs', 'data', 'effects', 'procgeo']) {
  await fs.mkdir(path.join(project, 'content', directory), { recursive: true });
  await fs.cp(path.join(repoRoot, 'content', directory), path.join(project, 'content', directory), { recursive: true });
}
await fs.mkdir(path.join(project, 'data', 'foundation'), { recursive: true });
await fs.copyFile(path.join(repoRoot, 'data', 'foundation', 'engine-data-layout.toml'), path.join(project, 'data', 'foundation', 'engine-data-layout.toml'));

const sessionStore = new SessionStore({ storageFilePath: path.join(state, 'sessions.json') });
const session = await sessionStore.createSession({ rootPath: project });
const coordinationStore = new CoordinationStore();
const operationStore = new OperationStore({ sessionStore, storageFilePath: path.join(state, 'operations.json') });
let rejectValidation = false;
let validationCalls = 0;
const validateDataFoundation = async ({ root: stagedRoot, target, expectAbsent }) => {
  validationCalls += 1;
  const stagedPath = path.join(stagedRoot, 'content', ...target.stagedPath.split('/'));
  let content = '';
  try { content = await fs.readFile(stagedPath, 'utf8'); } catch {}
  const valid = !rejectValidation && (expectAbsent || content.includes(`name = "${target.subjectId}"`));
  return {
    schema: 'shader_forge.data_foundation_validation', schemaVersion: 1, valid,
    assetKind: target.assetKind, assetId: target.subjectId, expectedPath: target.stagedPath,
    assetCount: 1, invalidAssetCount: valid ? 0 : 1,
    diagnostic: valid ? 'passed' : 'fixture rejected candidate',
  };
};
const service = new SceneAssetService({ sessionStore, coordinationStore, operationStore, validateDataFoundation });
const registration = coordinationStore.registerAgent({ sessionId: session.id, name: 'scene-agent' });

function lease(resources) {
  return coordinationStore.requestLease({
    agentId: registration.agent.id, credential: registration.credential, resources, mode: 'write',
  });
}
function auth(granted) {
  return { agentId: registration.agent.id, credential: registration.credential, leaseId: granted.id };
}

try {
  const sandbox = await sessionStore.inspectTextFile(session.id, 'content/scenes/sandbox.scene.toml');
  const saveLease = lease(['scene/world/sandbox']);
  const saved = await service.previewAsset({
    sessionId: session.id, assetKind: 'scene', intent: 'save', subjectId: 'sandbox',
    content: scene('sandbox', 'Changed'), baseRevision: sandbox.revision, actor,
    agentId: registration.agent.id, credential: registration.credential, leaseId: saveLease.id,
  });
  assert.equal(saved.operation.context.type, 'scene_asset');
  assert.deepEqual(saved.operation.context.resourceKeys, ['scene/world/sandbox']);
  assert.equal((await sessionStore.readFile(session.id, 'content/scenes/sandbox.scene.toml')).content, sandbox.content);
  await operationStore.approve(saved.operation.id, { actor });
  rejectValidation = true;
  await assert.rejects(operationStore.apply(saved.operation.id, {
    actor, validateMutation: (mutation) => service.validateOperationMutation(mutation, auth(saveLease)),
  }), (error) => error.statusCode === 422);
  assert.equal(operationStore.getOperation(saved.operation.id).state, 'approved');
  assert.equal((await sessionStore.readFile(session.id, 'content/scenes/sandbox.scene.toml')).content, sandbox.content);
  rejectValidation = false;
  const applied = await operationStore.apply(saved.operation.id, {
    actor, validateMutation: (mutation) => service.validateOperationMutation(mutation, auth(saveLease)),
  });
  assert.equal(applied.state, 'applied');
  const undone = await operationStore.undo(saved.operation.id, {
    actor, validateMutation: (mutation) => service.validateOperationMutation(mutation, auth(saveLease)),
  });
  assert.equal(undone.state, 'undone');
  assert.equal((await sessionStore.readFile(session.id, 'content/scenes/sandbox.scene.toml')).content, sandbox.content);
  coordinationStore.releaseLease(saveLease.id, auth(saveLease));

  const createLease = lease(['scene/world/fresh']);
  const created = await service.previewAsset({
    sessionId: session.id, assetKind: 'scene', intent: 'create', subjectId: 'fresh',
    content: scene('fresh'), baseRevision: MISSING_FILE_REVISION, actor,
    agentId: registration.agent.id, credential: registration.credential, leaseId: createLease.id,
  });
  await operationStore.approve(created.operation.id, { actor });
  await operationStore.apply(created.operation.id, {
    actor, validateMutation: (mutation) => service.validateOperationMutation(mutation, auth(createLease)),
  });
  await operationStore.undo(created.operation.id, {
    actor, validateMutation: (mutation) => service.validateOperationMutation(mutation, auth(createLease)),
  });
  assert.equal((await sessionStore.inspectTextFile(session.id, 'content/scenes/fresh.scene.toml')).revision, MISSING_FILE_REVISION);
  coordinationStore.releaseLease(createLease.id, auth(createLease));

  const duplicateLease = lease(['scene/world/sandbox', 'scene/world/sandbox_copy']);
  const duplicated = await service.previewAsset({
    sessionId: session.id, assetKind: 'scene', intent: 'duplicate', subjectId: 'sandbox_copy',
    sourceSubjectId: 'sandbox', sourceRevision: sandbox.revision,
    content: scene('sandbox_copy'), baseRevision: MISSING_FILE_REVISION, actor,
    agentId: registration.agent.id, credential: registration.credential, leaseId: duplicateLease.id,
  });
  assert.deepEqual(duplicated.operation.context.resourceKeys, ['scene/world/sandbox', 'scene/world/sandbox_copy']);
  assert.equal(duplicated.operation.context.sourceRevision, sandbox.revision);
  await operationStore.approve(duplicated.operation.id, { actor });
  await sessionStore.writeTextFileAtomic(session.id, 'content/scenes/sandbox.scene.toml', scene('sandbox', 'Source drift'));
  await assert.rejects(operationStore.apply(duplicated.operation.id, {
    actor, validateMutation: (mutation) => service.validateOperationMutation(mutation, auth(duplicateLease)),
  }), (error) => error.statusCode === 409 && error.conflict?.expectedRevision === sandbox.revision);
  assert.equal(operationStore.getOperation(duplicated.operation.id).state, 'approved');
  await sessionStore.writeTextFileAtomic(session.id, 'content/scenes/sandbox.scene.toml', sandbox.content);
  await assert.rejects(service.previewAsset({
    sessionId: session.id, assetKind: 'scene', intent: 'duplicate', subjectId: 'sandbox_copy',
    sourceSubjectId: 'sandbox', sourceRevision: sandbox.revision,
    content: scene('not_sandbox_copy'), baseRevision: MISSING_FILE_REVISION, actor,
    agentId: registration.agent.id, credential: registration.credential, leaseId: duplicateLease.id,
  }));
  await assert.rejects(service.previewAsset({ intent: 'rename' }), (error) => error.code === 'multi_file_operation_required');

  const httpLease = lease(['scene/world/http_fresh']);
  const server = await startEngineSessiond({
    port: 0, sessionStore, coordinationStore, operationStore,
    sceneAssetService: service,
  });
  try {
    const call = async (pathname, body, credential = registration.credential) => {
      const response = await fetch(new URL(pathname, server.baseUrl), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shader-Forge-Agent-Credential': credential },
        body: JSON.stringify(body),
      });
      return { status: response.status, payload: await response.json() };
    };
    const preview = await call('/api/operations/scene-asset/preview', {
      sessionId: session.id, assetKind: 'scene', intent: 'create', subjectId: 'http_fresh',
      content: scene('http_fresh'), baseRevision: MISSING_FILE_REVISION, actor,
      agentId: registration.agent.id, leaseId: httpLease.id,
    });
    assert.equal(preview.status, 201, JSON.stringify(preview.payload));
    const approved = await call(`/api/operations/${preview.payload.operation.id}/approve`, { actor }, '');
    assert.equal(approved.status, 200, JSON.stringify(approved.payload));
    const appliedHttp = await call(`/api/operations/${preview.payload.operation.id}/apply`, {
      actor, agentId: registration.agent.id, leaseId: httpLease.id,
    });
    assert.equal(appliedHttp.status, 200, JSON.stringify(appliedHttp.payload));
    assert.match((await sessionStore.readFile(session.id, 'content/scenes/http_fresh.scene.toml')).content, /name = "http_fresh"/);
  } finally {
    await server.close();
  }

  const mismatched = await operationStore.previewFileWrite({
    sessionId: session.id, path: 'content/scenes/wrong_target.scene.toml',
    content: scene('sandbox'), baseRevision: MISSING_FILE_REVISION, actor,
    context: {
      type: 'scene_asset', assetKind: 'scene', intent: 'create', label: 'mismatch fixture',
      subjectId: 'sandbox', resourceKeys: ['scene/world/sandbox'], leaseId: duplicateLease.id,
    },
  });
  await operationStore.approve(mismatched.id, { actor });
  await assert.rejects(operationStore.apply(mismatched.id, {
    actor, validateMutation: (mutation) => service.validateOperationMutation(mutation, auth(duplicateLease)),
  }), (error) => error.code === 'scene_asset_context_mismatch');
  assert.equal(operationStore.getOperation(mismatched.id).state, 'approved');

  const foundationPath = 'data/foundation/engine-data-layout.toml';
  const originalFoundation = await sessionStore.readFile(session.id, foundationPath);
  await sessionStore.writeTextFileAtomic(session.id, foundationPath, 'x'.repeat(32 * 1024 * 1024 + 1));
  const boundedLease = lease(['scene/world/bounded']);
  await assert.rejects(service.previewAsset({
    sessionId: session.id, assetKind: 'scene', intent: 'create', subjectId: 'bounded',
    content: scene('bounded'), baseRevision: MISSING_FILE_REVISION, actor,
    agentId: registration.agent.id, credential: registration.credential, leaseId: boundedLease.id,
  }), (error) => error.statusCode === 413);
  await sessionStore.writeTextFileAtomic(session.id, foundationPath, originalFoundation.content);

  const persisted = await fs.readFile(path.join(state, 'operations.json'), 'utf8');
  assert.doesNotMatch(persisted, new RegExp(registration.credential));
  const reloaded = new OperationStore({ sessionStore, storageFilePath: path.join(state, 'operations.json') });
  await reloaded.loadOperations();
  assert.equal(reloaded.getOperation(duplicated.operation.id).context.sourceRevision, sandbox.revision);
  assert.ok(validationCalls >= 7, 'preview/apply/undo must all validate staged full truth');
  console.log('engine scene operations harness passed');
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
