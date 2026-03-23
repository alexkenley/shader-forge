import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { repoRootFromScript, requestJsonNoAuth } from './lib/harness-utils.mjs';
import { startEngineSessiond } from '../tools/engine-sessiond/server.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const shellApp = await fs.readFile(path.join(repoRoot, 'shell', 'engine-shell', 'src', 'App.tsx'), 'utf8');
const sceneEditorView = await fs.readFile(path.join(repoRoot, 'shell', 'engine-shell', 'src', 'SceneEditorView.tsx'), 'utf8');
const sceneAuthoringSource = await fs.readFile(path.join(repoRoot, 'shell', 'engine-shell', 'src', 'scene-authoring.ts'), 'utf8');
const sessiondClient = await fs.readFile(path.join(repoRoot, 'shell', 'engine-shell', 'src', 'lib', 'sessiond.ts'), 'utf8');
const sessiondServer = await fs.readFile(path.join(repoRoot, 'tools', 'engine-sessiond', 'server.mjs'), 'utf8');

const tempProjectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-scene-authoring-'));
await fs.mkdir(path.join(tempProjectRoot, 'content', 'scenes'), { recursive: true });
await fs.mkdir(path.join(tempProjectRoot, 'content', 'prefabs'), { recursive: true });

const service = await startEngineSessiond({
  host: '127.0.0.1',
  port: 0,
});

try {
  assert.match(shellApp, /SceneEditorView/);
  assert.match(sceneEditorView, /Edit Mode/);
  assert.match(sceneEditorView, /Play Mode/);
  assert.match(sceneEditorView, /Save Scene/);
  assert.match(sceneEditorView, /Save Prefab/);
  assert.match(sceneEditorView, /Reload From Disk/);
  assert.match(sceneEditorView, /Duplicate Scene/);
  assert.match(sceneEditorView, /World outliner/);
  assert.match(sceneEditorView, /Use As Primary/);
  assert.match(sceneEditorView, /Add Entity/);
  assert.match(sceneEditorView, /Duplicate Entity/);
  assert.match(sceneEditorView, /Delete Entity/);
  assert.match(sceneEditorView, /Add To Scene/);
  assert.match(sceneEditorView, /Position/);
  assert.match(sceneEditorView, /Rotation/);
  assert.match(sceneEditorView, /Scale/);
  assert.match(sceneAuthoringSource, /formatSceneAssetDocument/);
  assert.match(sceneAuthoringSource, /formatPrefabAssetDocument/);
  assert.match(sceneAuthoringSource, /\[entity\./);
  assert.match(sceneAuthoringSource, /createSceneEntityDocument/);
  assert.match(sceneAuthoringSource, /sourcePrefab/);
  assert.match(sceneAuthoringSource, /content\/scenes/);
  assert.match(sessiondClient, /writeFile/);
  assert.match(sessiondServer, /\/api\/files\/write/);
  assert.match(sessiondServer, /files:write/);

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
  console.log('- Verified the shell Scene workspace exposes edit/play, save/reload, outliner, details, and prefab assignment surfaces');
  console.log('- Verified deterministic scene and prefab authoring assets can be written through engine_sessiond inside a session root');
} finally {
  await service.close();
  await fs.rm(tempProjectRoot, { recursive: true, force: true });
}
