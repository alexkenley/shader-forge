import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { repoRootFromScript } from './lib/harness-utils.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const cliPath = path.join(repoRoot, 'tools', 'engine-cli', 'shaderforge.mjs');
const assetPipelinePath = path.join(repoRoot, 'tools', 'engine-cli', 'lib', 'asset-pipeline.mjs');
const foundationManifestPath = path.join(repoRoot, 'data', 'foundation', 'engine-data-layout.toml');
const audioBusesPath = path.join(repoRoot, 'audio', 'buses.toml');
const audioSoundPath = path.join(repoRoot, 'audio', 'sounds', 'ui_confirm.sound.toml');
const audioEventPath = path.join(repoRoot, 'audio', 'events', 'ui_accept.audio-event.toml');
const animationSkeletonPath = path.join(repoRoot, 'animation', 'skeletons', 'debug_humanoid.skeleton.toml');
const animationClipPath = path.join(repoRoot, 'animation', 'clips', 'debug_walk.anim.toml');
const animationGraphPath = path.join(repoRoot, 'animation', 'graphs', 'debug_actor.animgraph.toml');
const physicsLayersPath = path.join(repoRoot, 'physics', 'layers.toml');
const physicsMaterialPath = path.join(repoRoot, 'physics', 'materials', 'default_surface.physics-material.toml');
const physicsBodyPath = path.join(repoRoot, 'physics', 'bodies', 'debug_crate.physics-body.toml');
const procgeoFloorPath = path.join(repoRoot, 'content', 'procgeo', 'sandbox_floor.procgeo.toml');
const procgeoCratePath = path.join(repoRoot, 'content', 'procgeo', 'debug_crate.procgeo.toml');
const tempRoot = path.join(repoRoot, 'tmp', 'asset-pipeline-harness');
const reportPath = path.join(tempRoot, 'asset-pipeline-report.json');

const cliSource = fs.readFileSync(cliPath, 'utf8');
const assetPipelineSource = fs.readFileSync(assetPipelinePath, 'utf8');
const foundationManifest = fs.readFileSync(foundationManifestPath, 'utf8');
const audioBuses = fs.readFileSync(audioBusesPath, 'utf8');
const audioSound = fs.readFileSync(audioSoundPath, 'utf8');
const audioEvent = fs.readFileSync(audioEventPath, 'utf8');
const animationSkeleton = fs.readFileSync(animationSkeletonPath, 'utf8');
const animationClip = fs.readFileSync(animationClipPath, 'utf8');
const animationGraph = fs.readFileSync(animationGraphPath, 'utf8');
const physicsLayers = fs.readFileSync(physicsLayersPath, 'utf8');
const physicsMaterial = fs.readFileSync(physicsMaterialPath, 'utf8');
const physicsBody = fs.readFileSync(physicsBodyPath, 'utf8');
const procgeoFloor = fs.readFileSync(procgeoFloorPath, 'utf8');
const procgeoCrate = fs.readFileSync(procgeoCratePath, 'utf8');

assert.match(cliSource, /engine bake/);
assert.match(cliSource, /--audio-root/);
assert.match(cliSource, /--animation-root/);
assert.match(cliSource, /--physics-root/);
assert.match(cliSource, /asset bake/i);
assert.match(assetPipelineSource, /shader_forge\.procgeo/);
assert.match(assetPipelineSource, /shader_forge\.audio_buses/);
assert.match(assetPipelineSource, /shader_forge\.sound/);
assert.match(assetPipelineSource, /shader_forge\.audio_event/);
assert.match(assetPipelineSource, /shader_forge\.skeleton/);
assert.match(assetPipelineSource, /shader_forge\.animation_clip/);
assert.match(assetPipelineSource, /shader_forge\.animation_graph/);
assert.match(assetPipelineSource, /shader_forge\.physics_layers/);
assert.match(assetPipelineSource, /shader_forge\.physics_material/);
assert.match(assetPipelineSource, /shader_forge\.physics_body/);
assert.match(assetPipelineSource, /generated_mesh/);
assert.match(assetPipelineSource, /generated-meshes/);
assert.match(assetPipelineSource, /plane_grid/);
assert.match(assetPipelineSource, /shader_forge\.cooked_asset\.stage/);
assert.match(assetPipelineSource, /shader_forge\.cooked_audio\.stage/);
assert.match(assetPipelineSource, /source_prefab/);
assert.match(assetPipelineSource, /entity \"/);
assert.match(assetPipelineSource, /component\.render/);
assert.match(assetPipelineSource, /component\.effect/);
assert.match(assetPipelineSource, /hasRenderComponent/);
assert.match(foundationManifest, /procgeo_subdir = "procgeo"/);
assert.match(foundationManifest, /procgeo_owner = "procgeo_system"/);
assert.match(audioBuses, /schema = "shader_forge\.audio_buses"/);
assert.match(audioBuses, /\[bus\.Master\]/);
assert.match(audioSound, /schema = "shader_forge\.sound"/);
assert.match(audioSound, /source_media = "media\/ui_confirm\.ogg"/);
assert.match(audioEvent, /schema = "shader_forge\.audio_event"/);
assert.match(audioEvent, /sound = "ui_confirm"/);
assert.match(animationSkeleton, /schema = "shader_forge\.skeleton"/);
assert.match(animationSkeleton, /bone_count = 3/);
assert.match(animationClip, /schema = "shader_forge\.animation_clip"/);
assert.match(animationClip, /target = "player_footstep"/);
assert.match(animationGraph, /schema = "shader_forge\.animation_graph"/);
assert.match(animationGraph, /\[state\.walk\]/);
assert.match(physicsLayers, /schema = "shader_forge\.physics_layers"/);
assert.match(physicsLayers, /\[layer\.World_Dynamic\]/);
assert.match(physicsMaterial, /schema = "shader_forge\.physics_material"/);
assert.match(physicsBody, /schema = "shader_forge\.physics_body"/);
assert.match(physicsBody, /layer = "World_Dynamic"/);
assert.match(procgeoFloor, /schema = "shader_forge\.procgeo"/);
assert.match(procgeoFloor, /generator = "plane_grid"/);
assert.match(procgeoFloor, /bake_output = "generated_mesh"/);
assert.match(procgeoCrate, /generator = "box"/);
assert.match(fs.readFileSync(path.join(repoRoot, 'content', 'prefabs', 'debug_crate.prefab.toml'), 'utf8'), /\[component\.render\]/);

fs.rmSync(tempRoot, { recursive: true, force: true });
fs.mkdirSync(tempRoot, { recursive: true });

const bakeRun = spawnSync(
  process.execPath,
  [
    cliPath,
    'bake',
    '--content-root',
    'content',
    '--audio-root',
    'audio',
    '--animation-root',
    'animation',
    '--physics-root',
    'physics',
    '--data-foundation',
    'data/foundation/engine-data-layout.toml',
    '--output-root',
    'tmp/asset-pipeline-harness',
    '--report',
    'tmp/asset-pipeline-harness/asset-pipeline-report.json',
  ],
  {
    cwd: repoRoot,
    encoding: 'utf8',
  },
);

if (bakeRun.error) {
  throw bakeRun.error;
}

assert.equal(
  bakeRun.status,
  0,
  `Asset pipeline bake failed.\nSTDOUT:\n${bakeRun.stdout}\nSTDERR:\n${bakeRun.stderr}`,
);

assert.ok(fs.existsSync(reportPath), 'Expected asset pipeline report to be written.');

const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
assert.equal(report.foundation.runtimeFormat, 'flatbuffer');
assert.equal(report.counts.scene, 1);
assert.equal(report.counts.prefab, 2);
assert.equal(report.counts.data, 1);
assert.equal(report.counts.effect, 1);
assert.equal(report.counts.procgeo, 2);
assert.equal(report.counts.audioBuses, 5);
assert.equal(report.counts.audioSounds, 3);
assert.equal(report.counts.audioEvents, 3);
assert.equal(report.counts.animationSkeletons, 1);
assert.equal(report.counts.animationClips, 2);
assert.equal(report.counts.animationGraphs, 1);
assert.equal(report.counts.physicsLayers, 3);
assert.equal(report.counts.physicsMaterials, 2);
assert.equal(report.counts.physicsBodies, 3);
assert.equal(report.invalidAssets.length, 0);
assert.equal(report.invalidAudioAssets.length, 0);
assert.equal(report.invalidAnimationAssets.length, 0);
assert.equal(report.invalidPhysicsAssets.length, 0);
assert.equal(report.generatedMeshes.length, 2);
assert.equal(report.audio.bakedSounds.length, 3);
assert.equal(report.audio.bakedEvents.length, 3);
assert.equal(report.animation.bakedSkeletons.length, 1);
assert.equal(report.animation.bakedClips.length, 2);
assert.equal(report.animation.bakedGraphs.length, 1);
assert.equal(report.physics.bakedMaterials.length, 2);
assert.equal(report.physics.bakedBodies.length, 3);
assert.match(report.notes.join('\n'), /FlatBuffers writer lands/);
assert.match(report.notes.join('\n'), /Audio currently bakes staged bus, sound, and event metadata registries/);
assert.match(report.notes.join('\n'), /Animation currently bakes staged skeleton, clip, and graph metadata registries/);
assert.match(report.notes.join('\n'), /Physics currently bakes staged layer, material, and body metadata registries/);
assert.match(JSON.stringify(report.assets || report, null, 2), /entityCount/);
assert.match(JSON.stringify(report.assets || report, null, 2), /hasRenderComponent/);
assert.match(JSON.stringify(report.assets || report, null, 2), /hasEffectComponent/);

const cookedScenePath = path.join(tempRoot, 'scenes', 'sandbox.bin');
const cookedPrefabPath = path.join(tempRoot, 'prefabs', 'debug_crate.bin');
const cookedProcgeoPath = path.join(tempRoot, 'procgeo', 'sandbox_floor.bin');
const cookedAudioBusesPath = path.join(tempRoot, 'audio', 'audio-buses.bin');
const cookedAudioSoundPath = path.join(tempRoot, 'audio', 'sounds', 'ui_confirm.bin');
const cookedAudioEventPath = path.join(tempRoot, 'audio', 'events', 'ui_accept.bin');
const cookedAnimationSkeletonPath = path.join(tempRoot, 'animation', 'skeletons', 'debug_humanoid.bin');
const cookedAnimationClipPath = path.join(tempRoot, 'animation', 'clips', 'debug_walk.bin');
const cookedAnimationGraphPath = path.join(tempRoot, 'animation', 'graphs', 'debug_actor.bin');
const cookedPhysicsLayersPath = path.join(tempRoot, 'physics', 'layers.bin');
const cookedPhysicsMaterialPath = path.join(tempRoot, 'physics', 'materials', 'default_surface.bin');
const cookedPhysicsBodyPath = path.join(tempRoot, 'physics', 'bodies', 'debug_crate.bin');
const floorPreviewPath = path.join(tempRoot, 'generated-meshes', 'sandbox_floor.mesh.json');
const cratePreviewPath = path.join(tempRoot, 'generated-meshes', 'debug_crate.mesh.json');

assert.ok(fs.existsSync(cookedScenePath), 'Expected staged cooked scene payload.');
assert.ok(fs.existsSync(cookedPrefabPath), 'Expected staged cooked prefab payload.');
assert.ok(fs.existsSync(cookedProcgeoPath), 'Expected staged cooked procgeo payload.');
assert.ok(fs.existsSync(cookedAudioBusesPath), 'Expected staged cooked audio buses payload.');
assert.ok(fs.existsSync(cookedAudioSoundPath), 'Expected staged cooked audio sound payload.');
assert.ok(fs.existsSync(cookedAudioEventPath), 'Expected staged cooked audio event payload.');
assert.ok(fs.existsSync(cookedAnimationSkeletonPath), 'Expected staged cooked animation skeleton payload.');
assert.ok(fs.existsSync(cookedAnimationClipPath), 'Expected staged cooked animation clip payload.');
assert.ok(fs.existsSync(cookedAnimationGraphPath), 'Expected staged cooked animation graph payload.');
assert.ok(fs.existsSync(cookedPhysicsLayersPath), 'Expected staged cooked physics layers payload.');
assert.ok(fs.existsSync(cookedPhysicsMaterialPath), 'Expected staged cooked physics material payload.');
assert.ok(fs.existsSync(cookedPhysicsBodyPath), 'Expected staged cooked physics body payload.');
assert.ok(fs.existsSync(floorPreviewPath), 'Expected generated plane-grid preview output.');
assert.ok(fs.existsSync(cratePreviewPath), 'Expected generated box preview output.');

const floorPreview = JSON.parse(fs.readFileSync(floorPreviewPath, 'utf8'));
const cratePreview = JSON.parse(fs.readFileSync(cratePreviewPath, 'utf8'));
const cookedPrefab = JSON.parse(fs.readFileSync(cookedPrefabPath, 'utf8'));
assert.equal(floorPreview.generator, 'plane_grid');
assert.equal(floorPreview.mesh.vertexCount, 169);
assert.equal(floorPreview.mesh.triangleCount, 288);
assert.equal(cratePreview.generator, 'box');
assert.equal(cratePreview.mesh.vertexCount, 8);
assert.equal(cratePreview.mesh.triangleCount, 12);
assert.equal(cookedPrefab.renderComponent.procgeo, 'debug_crate');
assert.equal(cookedPrefab.effectComponent.effect, 'impact_spark');

fs.rmSync(tempRoot, { recursive: true, force: true });

console.log('Engine asset pipeline harness passed.');
console.log(`- Verified CLI bake lane through ${cliPath}`);
console.log(`- Verified procgeo source assets under ${path.join(repoRoot, 'content', 'procgeo')}`);
console.log(`- Verified authored audio assets under ${path.join(repoRoot, 'audio')}`);
console.log(`- Verified authored animation assets under ${path.join(repoRoot, 'animation')}`);
console.log(`- Verified authored physics assets under ${path.join(repoRoot, 'physics')}`);
console.log('- Verified staged cooked outputs, staged cooked audio/animation/physics metadata, and generated mesh previews are emitted under the configured cook root');
