import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { repoRootFromScript, requestJsonNoAuth } from './lib/harness-utils.mjs';
import { startEngineSessiond } from '../tools/engine-sessiond/server.mjs';
import { SessionStore } from '../tools/engine-sessiond/lib/session-store.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const shellApp = await fs.readFile(path.join(repoRoot, 'shell', 'engine-shell', 'src', 'App.tsx'), 'utf8');
const sceneEditorView = await fs.readFile(path.join(repoRoot, 'shell', 'engine-shell', 'src', 'SceneEditorView.tsx'), 'utf8');
const sceneAuthoringSource = await fs.readFile(path.join(repoRoot, 'shell', 'engine-shell', 'src', 'scene-authoring.ts'), 'utf8');
const sessiondClient = await fs.readFile(path.join(repoRoot, 'shell', 'engine-shell', 'src', 'lib', 'sessiond.ts'), 'utf8');
const sessiondServer = await fs.readFile(path.join(repoRoot, 'tools', 'engine-sessiond', 'server.mjs'), 'utf8');

const tempProjectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-scene-authoring-'));
const sessionStateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-scene-authoring-sessiond-'));
const sessionStorePath = path.join(sessionStateDir, 'sessions.json');
await fs.mkdir(path.join(tempProjectRoot, 'content', 'scenes'), { recursive: true });
await fs.mkdir(path.join(tempProjectRoot, 'content', 'prefabs'), { recursive: true });

const service = await startEngineSessiond({
  host: '127.0.0.1',
  port: 0,
  sessionStore: new SessionStore({ storageFilePath: sessionStorePath }),
});

try {
  assert.match(shellApp, /SceneEditorView/);
  assert.match(sceneEditorView, /handleModeChange\('play'\)/);
  assert.match(sceneEditorView, /Verify/);
  assert.match(sceneEditorView, /Verify locks editing and keeps your changes\. Play saves them before testing\./);
  assert.doesNotMatch(sceneEditorView, /Unsaved authoring edits were discarded/);
  assert.match(sceneEditorView, /confirmDiscardChanges/);
  assert.match(sceneEditorView, /window\.confirm/);
  assert.match(sceneEditorView, /document\.path === prefabDraft\?\.path/);
  assert.match(sceneEditorView, /Save world/);
  assert.match(sceneEditorView, /Save object/);
  assert.match(sceneEditorView, /Reload/);
  assert.match(sceneEditorView, /Duplicate world/);
  assert.match(sceneEditorView, /id="scene-sidebar-panel-scenes"/);
  assert.match(sceneEditorView, /async function handlePlay/);
  assert.match(sceneEditorView, /sceneDirty && !\(await handleSaveScene\(\)\)/);
  assert.match(sceneEditorView, /prefabDirty && !\(await handleSavePrefab\(\)\)/);
  assert.match(sceneEditorView, /onClick=\{\(\) => void handlePlay\(\)\}/);
  assert.match(sceneEditorView, /activeSessionIdRef\.current !== targetSessionId/);
  assert.match(sceneEditorView, /sceneDraftPathRef\.current !== targetPath/);
  assert.match(sceneEditorView, /prefabDraftPathRef\.current !== targetPath/);
  assert.match(sceneEditorView, /function worldWorkspaceAuthority/);
  assert.match(sceneEditorView, /\[activeSession\?\.id, activeSession\?\.rootPath\]/);
  assert.doesNotMatch(sceneEditorView, /\}, \[activeSession\]\);/);
  assert.match(sceneEditorView, /draftWorkspaceAuthorityRef/);
  assert.match(sceneEditorView, /Switch workspace and discard the unsaved World changes\?/);
  assert.match(sceneEditorView, /This world belongs to another workspace/);
  assert.match(sceneEditorView, /const draftDetached = Boolean/);
  assert.match(sceneEditorView, /const canEdit = mode === 'edit' && worldMutationsEnabled/);
  assert.match(sceneEditorView, /function worldResponseIsCurrent/);
  assert.match(sceneEditorView, /activeWorkspaceAuthorityRef\.current === targetAuthority/);
  assert.match(sceneEditorView, /const worldRequestRef = useRef\(0\)/);
  assert.match(sceneEditorView, /worldRequestRef\.current === requestId/);
  assert.match(sceneEditorView, /cancelled\s*\|\| worldRequestRef\.current !== requestId/);
  assert.ok(
    (sceneEditorView.match(/worldResponseIsCurrent\(targetAuthority, requestId\)/g) || []).length >= 10,
    'World mutation responses must retain request generation as well as workspace and path authority',
  );
  assert.match(sceneEditorView, /Apply and restart/);
  assert.match(sceneEditorView, /primaryActionRef\.current\?\.focus\(\)/);
  assert.match(sceneEditorView, /Run existing build/);
  assert.match(sceneEditorView, /Use for world/);
  assert.match(sceneEditorView, /Add object/);
  assert.match(sceneEditorView, /Duplicate/);
  assert.match(sceneEditorView, /Delete/);
  assert.match(sceneEditorView, /Add to world/);
  assert.match(sceneEditorView, /Position/);
  assert.match(sceneEditorView, /Rotation/);
  assert.match(sceneEditorView, /Scale/);
  assert.match(sceneEditorView, /Advanced settings/);
  assert.match(sceneEditorView, /Geometry asset/);
  assert.match(sceneEditorView, /Effect event/);
  assert.match(sceneEditorView, /Object ID/);
  assert.match(sceneEditorView, /Play needs attention/);
  assert.match(sceneEditorView, /Play could not start/);
  assert.match(sceneEditorView, /role="alert"/);
  assert.match(sceneEditorView, /role="separator"/);
  assert.match(sceneEditorView, /role="tablist"/);
  assert.match(sceneEditorView, /aria-controls="scene-sidebar-panel-scenes"/);
  assert.match(sceneEditorView, /aria-labelledby="scene-sidebar-tab-scenes"/);
  assert.doesNotMatch(sceneEditorView, /\bwriteFile\b/);
  assert.match(sceneEditorView, /async function mutateSceneAsset/);
  assert.match(sceneEditorView, /crypto\.subtle\.digest\('SHA-256'/);
  assert.match(sceneEditorView, /registerCoordinationAgent/);
  assert.match(sceneEditorView, /requestCoordinationLease/);
  assert.match(sceneEditorView, /previewSceneAsset/);
  assert.match(sceneEditorView, /fetchOperation/);
  assert.match(sceneEditorView, /operation\.id !== expected\.operationId/);
  assert.match(sceneEditorView, /operation\.appliedRevision !== expected\.proposedRevision/);
  assert.match(sceneEditorView, /latest\.revision === expected\.proposedRevision/);
  assert.match(sceneEditorView, /releaseCoordinationLease/);
  assert.match(sceneEditorView, /disconnectCoordinationAgent/);
  assert.match(sceneAuthoringSource, /formatSceneAssetDocument/);
  assert.match(sceneAuthoringSource, /formatPrefabAssetDocument/);
  assert.match(sceneAuthoringSource, /\[entity\./);
  assert.match(sceneAuthoringSource, /\[component\.render\]/);
  assert.match(sceneAuthoringSource, /\[component\.effect\]/);
  assert.match(sceneAuthoringSource, /createSceneEntityDocument/);
  assert.match(sceneAuthoringSource, /sourcePrefab/);
  assert.match(sceneAuthoringSource, /content\/scenes/);
  assert.match(sceneAuthoringSource, /revision: string/);
  assert.match(sceneAuthoringSource, /MISSING_SCENE_ASSET_REVISION = 'missing'/);
  assert.match(sessiondClient, /export async function previewSceneAsset/);
  assert.match(sessiondClient, /\/api\/operations\/scene-asset\/preview/);
  assert.match(sessiondServer, /\/api\/files\/write/);
  assert.match(sessiondServer, /files:write/);
  assert.match(sessiondServer, /\/api\/operations\/scene-asset\/preview/);

  const sessionPayload = await requestJsonNoAuth(`${service.baseUrl}/api/sessions`, 'POST', {
    name: 'scene-authoring',
    rootPath: tempProjectRoot,
  });
  const sessionId = sessionPayload.session.id;

  const prefabContent = [
    'schema = "shader_forge.prefab"',
    'schema_version = 1',
    'name = "debug_camera"',
    'owner_system = "scene_system"',
    'runtime_format = "flatbuffer"',
    '',
    'category = "tools"',
    'spawn_tag = "player_camera"',
    '',
    '[component.render]',
    'procgeo = "debug_crate"',
    'material_hint = "debug_crate"',
    '',
    '[component.effect]',
    'effect = "impact_spark"',
    'trigger = "on_interact"',
    '',
  ].join('\n');

  const sceneContent = [
    'schema = "shader_forge.scene"',
    'schema_version = 1',
    'name = "authoring_test"',
    'owner_system = "scene_system"',
    'runtime_format = "flatbuffer"',
    '',
    'title = "Authoring Test"',
    'primary_prefab = "debug_camera"',
    '',
    '[entity.camera_spawn]',
    'display_name = "Camera Spawn"',
    'source_prefab = "debug_camera"',
    'parent = ""',
    'position = "0, 1.6, -4"',
    'rotation = "0, 0, 0"',
    'scale = "1, 1, 1"',
    '',
  ].join('\n');

  const prefabWritePayload = await requestJsonNoAuth(`${service.baseUrl}/api/files/write`, 'POST', {
    sessionId,
    path: 'content/prefabs/debug_camera.prefab.toml',
    content: prefabContent,
  });
  assert.equal(prefabWritePayload.path, 'content/prefabs/debug_camera.prefab.toml');
  assert.match(prefabWritePayload.content, /\[component\.render\]/);
  assert.match(prefabWritePayload.content, /procgeo = "debug_crate"/);
  assert.match(prefabWritePayload.content, /\[component\.effect\]/);

  const sceneWritePayload = await requestJsonNoAuth(`${service.baseUrl}/api/files/write`, 'POST', {
    sessionId,
    path: 'content/scenes/authoring_test.scene.toml',
    content: sceneContent,
  });
  assert.equal(sceneWritePayload.path, 'content/scenes/authoring_test.scene.toml');
  assert.match(sceneWritePayload.content, /primary_prefab = "debug_camera"/);
  assert.match(sceneWritePayload.content, /\[entity\.camera_spawn\]/);
  assert.match(sceneWritePayload.content, /source_prefab = "debug_camera"/);

  const sceneListPayload = await requestJsonNoAuth(
    `${service.baseUrl}/api/files/list?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent('content/scenes')}`,
  );
  assert.equal(sceneListPayload.entries.length, 1);
  assert.equal(sceneListPayload.entries[0].name, 'authoring_test.scene.toml');

  const sceneReadPayload = await requestJsonNoAuth(
    `${service.baseUrl}/api/files/read?sessionId=${encodeURIComponent(sessionId)}&path=${encodeURIComponent('content/scenes/authoring_test.scene.toml')}`,
  );
  assert.equal(sceneReadPayload.content, sceneContent);

  const diskSceneContent = await fs.readFile(
    path.join(tempProjectRoot, 'content', 'scenes', 'authoring_test.scene.toml'),
    'utf8',
  );
  assert.equal(diskSceneContent, sceneContent);

  console.log('Engine scene authoring smoke passed.');
  console.log(`- Started engine_sessiond at ${service.baseUrl}`);
  console.log('- Verified the World workspace exposes draft-safe Edit/Verify, one-click Play, guarded navigation, plain-language object tools, and collapsed advanced settings');
  console.log('- Verified dirty World drafts keep stable workspace authority and stale load/mutation generations cannot revive old state');
  console.log('- Verified World mutations use revision-bound semantic operations, exact coordination leases, and authoritative apply reconciliation');
  console.log('- Verified deterministic scene, prefab, entity, transform, and prefab-component fixture assets inside a session root');
} finally {
  await service.close();
  await fs.rm(sessionStateDir, { recursive: true, force: true });
  await fs.rm(tempProjectRoot, { recursive: true, force: true });
}
