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
const procgeoFloor = fs.readFileSync(procgeoFloorPath, 'utf8');
const procgeoCrate = fs.readFileSync(procgeoCratePath, 'utf8');

assert.match(cliSource, /engine bake/);
assert.match(cliSource, /--audio-root/);
assert.match(cliSource, /asset bake/i);
assert.match(assetPipelineSource, /shader_forge\.procgeo/);
assert.match(assetPipelineSource, /shader_forge\.audio_buses/);
assert.match(assetPipelineSource, /shader_forge\.sound/);
assert.match(assetPipelineSource, /shader_forge\.audio_event/);
assert.match(assetPipelineSource, /generated_mesh/);
assert.match(assetPipelineSource, /generated-meshes/);
assert.match(assetPipelineSource, /plane_grid/);
assert.match(assetPipelineSource, /shader_forge\.cooked_asset\.stage/);
assert.match(assetPipelineSource, /shader_forge\.cooked_audio\.stage/);
assert.match(foundationManifest, /procgeo_subdir = "procgeo"/);
assert.match(foundationManifest, /procgeo_owner = "procgeo_system"/);
assert.match(audioBuses, /schema = "shader_forge\.audio_buses"/);
assert.match(audioBuses, /\[bus\.Master\]/);
assert.match(audioSound, /schema = "shader_forge\.sound"/);
assert.match(audioSound, /source_media = "media\/ui_confirm\.ogg"/);
assert.match(audioEvent, /schema = "shader_forge\.audio_event"/);
assert.match(audioEvent, /sound = "ui_confirm"/);
assert.match(procgeoFloor, /schema = "shader_forge\.procgeo"/);
assert.match(procgeoFloor, /generator = "plane_grid"/);
assert.match(procgeoFloor, /bake_output = "generated_mesh"/);
assert.match(procgeoCrate, /generator = "box"/);

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
assert.equal(report.counts.prefab, 1);
assert.equal(report.counts.data, 1);
assert.equal(report.counts.effect, 1);
assert.equal(report.counts.procgeo, 2);
assert.equal(report.counts.audioBuses, 5);
assert.equal(report.counts.audioSounds, 3);
assert.equal(report.counts.audioEvents, 3);
assert.equal(report.invalidAssets.length, 0);
assert.equal(report.invalidAudioAssets.length, 0);
assert.equal(report.generatedMeshes.length, 2);
assert.equal(report.audio.bakedSounds.length, 3);
assert.equal(report.audio.bakedEvents.length, 3);
assert.match(report.notes.join('\n'), /FlatBuffers writer lands/);
assert.match(report.notes.join('\n'), /Audio currently bakes staged bus, sound, and event metadata registries/);

const cookedScenePath = path.join(tempRoot, 'scenes', 'sandbox.bin');
const cookedProcgeoPath = path.join(tempRoot, 'procgeo', 'sandbox_floor.bin');
const cookedAudioBusesPath = path.join(tempRoot, 'audio', 'audio-buses.bin');
const cookedAudioSoundPath = path.join(tempRoot, 'audio', 'sounds', 'ui_confirm.bin');
const cookedAudioEventPath = path.join(tempRoot, 'audio', 'events', 'ui_accept.bin');
const floorPreviewPath = path.join(tempRoot, 'generated-meshes', 'sandbox_floor.mesh.json');
const cratePreviewPath = path.join(tempRoot, 'generated-meshes', 'debug_crate.mesh.json');

assert.ok(fs.existsSync(cookedScenePath), 'Expected staged cooked scene payload.');
assert.ok(fs.existsSync(cookedProcgeoPath), 'Expected staged cooked procgeo payload.');
assert.ok(fs.existsSync(cookedAudioBusesPath), 'Expected staged cooked audio buses payload.');
assert.ok(fs.existsSync(cookedAudioSoundPath), 'Expected staged cooked audio sound payload.');
assert.ok(fs.existsSync(cookedAudioEventPath), 'Expected staged cooked audio event payload.');
assert.ok(fs.existsSync(floorPreviewPath), 'Expected generated plane-grid preview output.');
assert.ok(fs.existsSync(cratePreviewPath), 'Expected generated box preview output.');

const floorPreview = JSON.parse(fs.readFileSync(floorPreviewPath, 'utf8'));
const cratePreview = JSON.parse(fs.readFileSync(cratePreviewPath, 'utf8'));
assert.equal(floorPreview.generator, 'plane_grid');
assert.equal(floorPreview.mesh.vertexCount, 169);
assert.equal(floorPreview.mesh.triangleCount, 288);
assert.equal(cratePreview.generator, 'box');
assert.equal(cratePreview.mesh.vertexCount, 8);
assert.equal(cratePreview.mesh.triangleCount, 12);

fs.rmSync(tempRoot, { recursive: true, force: true });

console.log('Engine asset pipeline harness passed.');
console.log(`- Verified CLI bake lane through ${cliPath}`);
console.log(`- Verified procgeo source assets under ${path.join(repoRoot, 'content', 'procgeo')}`);
console.log(`- Verified authored audio assets under ${path.join(repoRoot, 'audio')}`);
console.log('- Verified staged cooked outputs, staged cooked audio metadata, and generated mesh previews are emitted under the configured cook root');
