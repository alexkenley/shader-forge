import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repoRootFromScript } from './lib/harness-utils.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const runtimeRoot = path.join(repoRoot, 'engine', 'runtime');
const includeRoot = path.join(runtimeRoot, 'include');
const foundationHeaderPath = path.join(includeRoot, 'shader_forge', 'runtime', 'data_foundation.hpp');
const foundationSourcePath = path.join(runtimeRoot, 'src', 'data_foundation.cpp');
const runtimeHeaderPath = path.join(includeRoot, 'shader_forge', 'runtime', 'runtime_app.hpp');
const runtimeMainPath = path.join(runtimeRoot, 'src', 'main.cpp');
const runtimeAppPath = path.join(runtimeRoot, 'src', 'runtime_app.cpp');
const inputSourcePath = path.join(runtimeRoot, 'src', 'input_system.cpp');
const toolingSourcePath = path.join(runtimeRoot, 'src', 'tooling_ui.cpp');
const cliSourcePath = path.join(repoRoot, 'tools', 'engine-cli', 'shaderforge.mjs');
const foundationManifestPath = path.join(repoRoot, 'data', 'foundation', 'engine-data-layout.toml');
const scenePath = path.join(repoRoot, 'content', 'scenes', 'sandbox.scene.toml');
const prefabPath = path.join(repoRoot, 'content', 'prefabs', 'debug_camera.prefab.toml');
const prefabCratePath = path.join(repoRoot, 'content', 'prefabs', 'debug_crate.prefab.toml');
const dataPath = path.join(repoRoot, 'content', 'data', 'runtime_bootstrap.data.toml');
const effectPath = path.join(repoRoot, 'content', 'effects', 'impact_spark.effect.toml');
const procgeoFloorPath = path.join(repoRoot, 'content', 'procgeo', 'sandbox_floor.procgeo.toml');
const procgeoCratePath = path.join(repoRoot, 'content', 'procgeo', 'debug_crate.procgeo.toml');
const spatialFixtureRoot = path.join(repoRoot, 'animation', 'fixtures', 'spatial');
const spatialRiflePrefabPath = path.join(spatialFixtureRoot, 'content', 'prefabs', 'weapon_rifle_mk1.prefab.toml');
const spatialFoundationPath = path.join(spatialFixtureRoot, 'data', 'foundation', 'engine-data-layout.toml');

const foundationHeader = fs.readFileSync(foundationHeaderPath, 'utf8');
const foundationSource = fs.readFileSync(foundationSourcePath, 'utf8');
const runtimeHeader = fs.readFileSync(runtimeHeaderPath, 'utf8');
const runtimeMain = fs.readFileSync(runtimeMainPath, 'utf8');
const runtimeApp = fs.readFileSync(runtimeAppPath, 'utf8');
const cliSource = fs.readFileSync(cliSourcePath, 'utf8');
const foundationManifest = fs.readFileSync(foundationManifestPath, 'utf8');
const sceneAsset = fs.readFileSync(scenePath, 'utf8');
const prefabAsset = fs.readFileSync(prefabPath, 'utf8');
const prefabCrateAsset = fs.readFileSync(prefabCratePath, 'utf8');
const dataAsset = fs.readFileSync(dataPath, 'utf8');
const effectAsset = fs.readFileSync(effectPath, 'utf8');
const procgeoFloorAsset = fs.readFileSync(procgeoFloorPath, 'utf8');
const procgeoCrateAsset = fs.readFileSync(procgeoCratePath, 'utf8');
const spatialRiflePrefab = fs.readFileSync(spatialRiflePrefabPath, 'utf8');

assert.match(foundationHeader, /class DataFoundation/);
assert.match(foundationHeader, /enum class DataAssetKind/);
assert.match(foundationHeader, /DataFoundationConfig/);
assert.match(foundationHeader, /struct SceneSourceSnapshot/);
assert.match(foundationHeader, /struct SceneEntitySnapshot/);
assert.match(foundationHeader, /struct PrefabRenderComponentSnapshot/);
assert.match(foundationHeader, /struct PrefabEffectComponentSnapshot/);
assert.match(foundationHeader, /struct PrefabCollisionComponentSnapshot/);
assert.match(foundationHeader, /std::optional<PrefabCollisionComponentSnapshot> collisionComponent/);
assert.match(foundationHeader, /struct PrefabCameraComponentSnapshot/);
assert.match(foundationHeader, /std::optional<PrefabCameraComponentSnapshot> cameraComponent/);
assert.match(foundationHeader, /struct ComposedSceneEntitySnapshot/);
assert.match(foundationHeader, /struct ComposedSceneSnapshot/);
assert.match(foundationHeader, /struct RuntimeBootstrapSnapshot/);
assert.match(foundationHeader, /struct ProcgeoSourceSnapshot/);
assert.match(foundationHeader, /loadFromDisk/);
assert.match(foundationHeader, /sceneLookupSummary/);
assert.match(foundationHeader, /sceneEntitySummary/);
assert.match(foundationHeader, /scenePrefabComponentSummary/);
assert.match(foundationHeader, /composeScene/);
assert.match(foundationHeader, /composedSceneSummary/);
assert.match(foundationHeader, /relationshipSummary/);
assert.match(foundationHeader, /runtimeBootstrap/);
assert.match(foundationHeader, /snapshotProcgeoSources/);
assert.match(foundationHeader, /effectDescriptor/);
assert.match(foundationHeader, /procgeoSource/);
assert.match(foundationSource, /Data foundation: source=/);
assert.match(foundationSource, /", cooked="/);
assert.match(foundationSource, /", tooling-db="/);
assert.match(foundationSource, /shader_forge\.scene/);
assert.match(foundationSource, /shader_forge\.prefab/);
assert.match(foundationSource, /shader_forge\.effect/);
assert.match(foundationSource, /shader_forge\.procgeo/);
assert.match(foundationSource, /build\/cooked/);
assert.match(foundationSource, /primary_prefab/);
assert.match(foundationSource, /source_prefab/);
assert.match(foundationSource, /component\.render/);
assert.match(foundationSource, /component\.effect/);
assert.match(foundationSource, /component\.collision/);
assert.match(foundationSource, /component\.camera/);
assert.match(foundationSource, /at most one prefab with spawn_tag 'player_camera'/);
assert.match(foundationSource, /rotationMatrixFromEulerDegrees/);
assert.match(foundationSource, /multiplyRotationMatrices/);
assert.match(foundationSource, /camera -> projection=/);
assert.match(foundationSource, /Scene entity layout:/);
assert.match(foundationSource, /Scene prefab components:/);
assert.match(foundationSource, /Composed scene:/);
assert.match(foundationSource, /preferred_player_entity=/);
assert.match(foundationSource, /default_scene/);
assert.match(foundationSource, /tooling_overlay/);
assert.match(foundationSource, /generator must be 'box' or 'plane_grid'/);
assert.match(foundationSource, /bake_output must be 'generated_mesh'/);
assert.match(foundationSource, /width, height, and depth must be finite positive numbers/);
assert.match(foundationSource, /plane_grid requires rows and columns >= 1/);
assert.match(foundationSource, /Content relationships:/);
assert.match(runtimeHeader, /contentRoot/);
assert.match(runtimeHeader, /dataFoundationPath/);
assert.match(runtimeMain, /--content-root/);
assert.match(runtimeMain, /--data-foundation/);
assert.match(runtimeApp, /DataFoundation dataFoundation_/);
assert.match(runtimeApp, /initializeDataFoundation/);
assert.match(runtimeApp, /resolveDataDrivenRuntimeState/);
assert.match(runtimeApp, /applyBootstrapPreferences/);
assert.match(runtimeApp, /sceneLookupSummary/);
assert.match(runtimeApp, /relationshipSummary/);
assert.match(runtimeApp, /active-scene=/);
assert.match(runtimeApp, /content-root=/);
assert.match(runtimeApp, /data-foundation=/);
assert.match(cliSource, /--content-root/);
assert.match(cliSource, /--data-foundation/);
assert.match(foundationManifest, /source_format = "toml"/);
assert.match(foundationManifest, /runtime_format = "flatbuffer"/);
assert.match(foundationManifest, /tooling_db_backend = "sqlite"/);
assert.match(foundationManifest, /vfx_authoring_primary = "effekseer"/);
assert.match(foundationManifest, /procgeo_subdir = "procgeo"/);
assert.match(foundationManifest, /procgeo_owner = "procgeo_system"/);
assert.match(sceneAsset, /schema = "shader_forge\.scene"/);
assert.match(sceneAsset, /name = "sandbox"/);
assert.match(sceneAsset, /primary_prefab = "debug_camera"/);
assert.match(sceneAsset, /\[entity\.camera_spawn\]/);
assert.match(sceneAsset, /source_prefab = "debug_camera"/);
assert.match(sceneAsset, /\[entity\.crate_focus\]/);
assert.match(sceneAsset, /\[entity\.crate_satellite\]/);
assert.match(sceneAsset, /parent = "crate_focus"/);
assert.match(prefabAsset, /schema = "shader_forge\.prefab"/);
assert.match(prefabAsset, /spawn_tag = "player_camera"/);
assert.match(prefabAsset, /\[component\.camera\]/);
assert.match(prefabAsset, /projection = "perspective"/);
assert.match(prefabAsset, /vertical_fov_degrees = 70\.0/);
assert.match(prefabAsset, /near_meters = 0\.15/);
assert.match(prefabAsset, /far_meters = 1000\.0/);
assert.match(prefabCrateAsset, /\[component\.render\]/);
assert.match(prefabCrateAsset, /procgeo = "debug_crate"/);
assert.match(prefabCrateAsset, /\[component\.effect\]/);
assert.match(dataAsset, /schema = "shader_forge\.data"/);
assert.match(dataAsset, /default_scene = "sandbox"/);
assert.match(dataAsset, /tooling_overlay = "enabled"/);
assert.match(effectAsset, /schema = "shader_forge\.effect"/);
assert.match(effectAsset, /authoring_mode = "simple_descriptor"/);
assert.match(effectAsset, /runtime_model = "engine_descriptor"/);
assert.match(procgeoFloorAsset, /schema = "shader_forge\.procgeo"/);
assert.match(procgeoFloorAsset, /generator = "plane_grid"/);
assert.match(procgeoFloorAsset, /bake_output = "generated_mesh"/);
assert.match(procgeoFloorAsset, /rows = 12/);
assert.match(procgeoFloorAsset, /columns = 12/);
assert.match(procgeoCrateAsset, /generator = "box"/);
assert.match(procgeoCrateAsset, /width = 1\.5/);
assert.match(procgeoCrateAsset, /height = 1\.5/);
assert.match(procgeoCrateAsset, /depth = 1\.5/);
assert.match(spatialRiflePrefab, /\[component\.collision\]/);
assert.match(spatialRiflePrefab, /shape = "box"/);
assert.match(spatialRiflePrefab, /dimensions = \[0\.08, 0\.12, 0\.9\]/);

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8' });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} failed.\n${result.stderr || result.stdout}`);
}

function toWslPath(windowsPath) {
  const normalized = windowsPath.replaceAll('\\', '/');
  const match = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  assert.ok(match, `Cannot map path to WSL: ${windowsPath}`);
  return `/mnt/${match[1].toLowerCase()}/${match[2]}`;
}

const collisionTempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shader-forge-prefab-collision-'));
const collisionContentRoot = path.join(collisionTempRoot, 'content');
const collisionDriverPath = path.join(collisionTempRoot, 'collision_driver.cpp');
const collisionExecutablePath = path.join(collisionTempRoot, 'collision_driver');
for (const directory of ['scenes', 'prefabs', 'data', 'effects', 'procgeo']) {
  fs.mkdirSync(path.join(collisionContentRoot, directory), { recursive: true });
}
fs.cpSync(path.join(spatialFixtureRoot, 'content', 'prefabs'), path.join(collisionContentRoot, 'prefabs'), { recursive: true });
fs.cpSync(path.join(spatialFixtureRoot, 'content', 'procgeo'), path.join(collisionContentRoot, 'procgeo'), { recursive: true });
fs.writeFileSync(
  path.join(collisionContentRoot, 'prefabs', 'debug_camera.prefab.toml'),
  fs.readFileSync(prefabPath, 'utf8').replaceAll('\r\n', '\n'),
  'utf8',
);
fs.writeFileSync(path.join(collisionContentRoot, 'scenes', 'camera.scene.toml'), `schema = "shader_forge.scene"\nschema_version = 1\nruntime_format = "flatbuffer"\nowner_system = "scene_system"\nname = "camera_scene"\ntitle = "Camera"\n\n[entity.camera]\ndisplay_name = "Camera"\nsource_prefab = "debug_camera"\nposition = "1, 2, 3"\nrotation = "4, 5, 6"\nscale = "1, 1, 1"\n`);
fs.writeFileSync(collisionDriverPath, String.raw`
#include "shader_forge/runtime/data_foundation.hpp"

#include <cmath>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

using shader_forge::runtime::DataFoundation;
using shader_forge::runtime::DataFoundationConfig;

std::string readFile(const std::filesystem::path& path) {
  std::ifstream stream(path);
  std::ostringstream contents;
  contents << stream.rdbuf();
  return contents.str();
}

void writeFile(const std::filesystem::path& path, const std::string& contents) {
  std::ofstream stream(path, std::ios::trunc);
  stream << contents;
}

bool replaceOnce(std::string* value, const std::string& from, const std::string& to) {
  const auto position = value->find(from);
  if (position == std::string::npos) return false;
  value->replace(position, from.size(), to);
  return true;
}

bool near(float actual, float expected) {
  return std::abs(actual - expected) <= 1e-5F;
}

bool nearVector3(const std::array<float, 3>& actual, const std::array<float, 3>& expected) {
  return near(actual[0], expected[0]) && near(actual[1], expected[1]) && near(actual[2], expected[2]);
}

int main(int argc, char** argv) {
  if (argc != 3) return 2;
  const DataFoundationConfig config{
    .contentRoot = argv[1],
    .foundationPath = argv[2],
  };
  DataFoundation foundation;
  std::string error;
  if (!foundation.loadFromDisk(config, &error)) {
    std::cerr << error << '\n';
    return 3;
  }
  const auto rifle = foundation.prefabSource("weapon.rifle.mk1");
  if (!rifle || !rifle->valid || !rifle->collisionComponent) return 4;
  const auto& collision = *rifle->collisionComponent;
  if (collision.shape != "box"
      || collision.center != std::array<float, 3>{0.0F, 0.0F, 0.0F}
      || collision.rotation != std::array<float, 4>{0.0F, 0.0F, 0.0F, 1.0F}
      || collision.dimensions != std::array<float, 3>{0.08F, 0.12F, 0.9F}) return 5;
  const auto pistol = foundation.prefabSource("weapon.pistol.mk1");
  if (!pistol || !pistol->valid || pistol->collisionComponent) return 6;
  const auto camera = foundation.prefabSource("debug_camera");
  if (!camera || !camera->valid || !camera->cameraComponent) return 12;
  if (camera->cameraComponent->projection != "perspective"
      || camera->cameraComponent->verticalFovDegrees != 70.0F
      || camera->cameraComponent->nearMeters != 0.15F
      || camera->cameraComponent->farMeters != 1000.0F) return 13;
  const auto composed = foundation.composeScene("camera_scene");
  if (!composed || !composed->valid || composed->preferredPlayerEntity != "camera" || composed->entities.size() != 1) return 14;
  if (!composed->entities[0].cameraComponent
      || composed->entities[0].worldPosition != std::array<float, 3>{1.0F, 2.0F, 3.0F}
      || composed->entities[0].worldRotation != std::array<float, 3>{4.0F, 5.0F, 6.0F}) return 15;

  const std::filesystem::path cameraPath = std::filesystem::path(argv[1]) / "prefabs/debug_camera.prefab.toml";
  const std::string originalCamera = readFile(cameraPath);
  const std::vector<std::pair<std::string, std::string>> cameraMutations{
    {"projection = \"perspective\"", "projection = \"orthographic\""},
    {"projection = \"perspective\"", "projection = perspective"},
    {"vertical_fov_degrees = 70.0", "vertical_fov_degrees = 180.0"},
    {"vertical_fov_degrees = 70.0", "vertical_fov_degrees = 179.999999"},
    {"vertical_fov_degrees = 70.0", "vertical_fov_degrees = nan"},
    {"near_meters = 0.15", "near_meters = 0.0"},
    {"near_meters = 0.15", "near_meters = 1e-40"},
    {"near_meters = 0.15", "near_meters = 1000.0"},
    {"near_meters = 0.15\nfar_meters = 1000.0", "near_meters = 1.00000001\nfar_meters = 1.00000002"},
    {"far_meters = 1000.0", "far_meters = 1e100"},
    {"far_meters = 1000.0", "far_meters = 1000.0junk"},
    {"far_meters = 1000.0", "far_meters = 0b10"},
    {"far_meters = 1000.0", ""},
    {"far_meters = 1000.0", "far_meters = 1000.0\nunknown = true"},
    {"far_meters = 1000.0", "far_meters = 1000.0\ngarbage"},
    {"[component.camera]", "[component.camer]"},
    {"far_meters = 1000.0", "far_meters = 1000.0\nfar_meters = 1000.0"},
    {"far_meters = 1000.0", "far_meters = 1000.0\n\n[component.camera]"},
  };
  for (const auto& [from, to] : cameraMutations) {
    std::string candidate = originalCamera;
    if (!replaceOnce(&candidate, from, to)) return 16;
    writeFile(cameraPath, candidate);
    DataFoundation rejectedCamera;
    error.clear();
    if (rejectedCamera.loadFromDisk(config, &error) || error.empty()) return 17;
  }
  writeFile(cameraPath, originalCamera);
  const std::filesystem::path cameraScenePath = std::filesystem::path(argv[1]) / "scenes/camera.scene.toml";
  const std::string originalCameraScene = readFile(cameraScenePath);
  const std::vector<std::pair<std::string, std::string>> sceneVectorMutations{
    {"position = \"1, 2, 3\"", "position = 1, 2, 3"},
    {"position = \"1, 2, 3\"", "position = \"1junk, 2, 3\""},
    {"rotation = \"4, 5, 6\"", "rotation = \"0x10, 5, 6\""},
    {"scale = \"1, 1, 1\"", "scale = \"1e100, 1, 1\""},
    {"scale = \"1, 1, 1\"", "scale = \"1e-40, 1, 1\""},
  };
  for (const auto& [from, to] : sceneVectorMutations) {
    std::string candidate = originalCameraScene;
    if (!replaceOnce(&candidate, from, to)) return 18;
    writeFile(cameraScenePath, candidate);
    DataFoundation rejectedVector;
    error.clear();
    if (rejectedVector.loadFromDisk(config, &error) || error.empty()) return 19;
  }
  writeFile(cameraScenePath, originalCameraScene);
  writeFile(cameraScenePath, originalCameraScene + "\n[entity.camera_two]\ndisplay_name = \"Camera Two\"\nsource_prefab = \"debug_camera\"\nposition = \"0, 0, 0\"\nrotation = \"0, 0, 0\"\nscale = \"1, 1, 1\"\n");
  DataFoundation duplicateCameraScene;
  error.clear();
  if (!duplicateCameraScene.loadFromDisk(config, &error) || duplicateCameraScene.hasScene("camera_scene")) return 19;
  writeFile(cameraScenePath, originalCameraScene);
  std::string parentedCameraScene = originalCameraScene;
  if (!replaceOnce(&parentedCameraScene, "source_prefab = \"debug_camera\"", "source_prefab = \"debug_camera\"\nparent = \"anchor\"")) return 20;
  if (!replaceOnce(&parentedCameraScene, "rotation = \"4, 5, 6\"", "rotation = \"90, 0, 0\"")) return 21;
  parentedCameraScene += "\n[entity.anchor]\ndisplay_name = \"Anchor\"\nsource_prefab = \"weapon.pistol.mk1\"\nparent = \"\"\nposition = \"10, 20, 30\"\nrotation = \"0, 0, 90\"\nscale = \"2, 2, 2\"\n";
  writeFile(cameraScenePath, parentedCameraScene);
  DataFoundation parentedCamera;
  error.clear();
  if (!parentedCamera.loadFromDisk(config, &error) || !parentedCamera.hasScene("camera_scene")) return 22;
  const auto parentedComposition = parentedCamera.composeScene("camera_scene");
  if (!parentedComposition || !parentedComposition->valid
      || parentedComposition->preferredPlayerEntity != "camera"
      || parentedComposition->entities.size() != 2) return 23;
  const auto& parentedCameraEntity = parentedComposition->entities[0];
  if (!nearVector3(parentedCameraEntity.worldPosition, {6.0F, 22.0F, 36.0F})
      || !nearVector3(parentedCameraEntity.worldRotation, {0.0F, 90.0F, 90.0F})
      || !nearVector3(parentedCameraEntity.worldScale, {2.0F, 2.0F, 2.0F})) return 24;
  writeFile(cameraScenePath, originalCameraScene);

  const std::filesystem::path riflePath = std::filesystem::path(argv[1]) / "prefabs/weapon_rifle_mk1.prefab.toml";
  const std::string original = readFile(riflePath);
  const std::vector<std::pair<std::string, std::string>> mutations{
    {"shape = \"box\"", "shape = \"sphere\""},
    {"center = [0.0, 0.0, 0.0]", "center = [nan, 0.0, 0.0]"},
    {"rotation = [0.0, 0.0, 0.0, 1.0]", "rotation = [0.0, 0.0, 0.0, 2.0]"},
    {"rotation = [0.0, 0.0, 0.0, 1.0]", "rotation = [0.0, 0.0, 0.0, -1.0]"},
    {"dimensions = [0.08, 0.12, 0.9]", "dimensions = [0.08, 0.0, 0.9]"},
    {"dimensions = [0.08, 0.12, 0.9]", "dimensions = [0.08, 0.12, 0.9junk]"},
    {"dimensions = [0.08, 0.12, 0.9]", "dimensions = [0.08, 0.12, 0.9]\nunknown = true"},
    {"dimensions = [0.08, 0.12, 0.9]", "dimensions = [0.08, 0.12, 0.9]\ndimensions = [0.08, 0.12, 0.9]"},
    {"center = [0.0, 0.0, 0.0]", ""},
    {"dimensions = [0.08, 0.12, 0.9]", "dimensions = [0.08, 0.12, 0.9]\n\n[component.collision]"},
  };
  for (const auto& [from, to] : mutations) {
    std::string candidate = original;
    if (!replaceOnce(&candidate, from, to)) return 7;
    writeFile(riflePath, candidate);
    DataFoundation rejected;
    error.clear();
    if (rejected.loadFromDisk(config, &error) || error.empty()) return 8;
  }
  std::string missing = original;
  if (!replaceOnce(&missing, "shape = \"box\"", "")) return 9;
  writeFile(riflePath, missing);
  DataFoundation rejected;
  error.clear();
  if (rejected.loadFromDisk(config, &error) || error.empty()) return 10;
  writeFile(riflePath, original);
  const std::filesystem::path nonPrefabPath = std::filesystem::path(argv[1]) / "effects/invalid.effect.toml";
  writeFile(nonPrefabPath, original);
  DataFoundation wrongKind;
  error.clear();
  if (wrongKind.loadFromDisk(config, &error) || error.find("only valid on prefab assets") == std::string::npos) return 11;
  std::filesystem::remove(nonPrefabPath);
  writeFile(nonPrefabPath, originalCamera);
  DataFoundation wrongCameraKind;
  error.clear();
  if (wrongCameraKind.loadFromDisk(config, &error) || error.find("only valid on prefab assets") == std::string::npos) return 18;
  std::filesystem::remove(nonPrefabPath);
  return 0;
}
`);

const isWindows = process.platform === 'win32';
let syntaxChecked = false;
let collisionChecked = false;

try {
if (!isWindows) {
  const syntaxCheck = spawnSync(
    'g++',
    [
      '-std=c++20',
      '-I',
      includeRoot,
      '-DSHADER_FORGE_HAS_SDL3=0',
      '-DSHADER_FORGE_HAS_VULKAN=0',
      '-fsyntax-only',
      runtimeMainPath,
      foundationSourcePath,
      inputSourcePath,
      toolingSourcePath,
      runtimeAppPath,
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  );

  if (syntaxCheck.error) {
    throw syntaxCheck.error;
  }

  assert.equal(
    syntaxCheck.status,
    0,
    `Data foundation scaffold syntax check failed.\n${syntaxCheck.stderr || syntaxCheck.stdout}`,
  );
  syntaxChecked = true;
  run('g++', ['-std=c++20', '-I', includeRoot, collisionDriverPath, foundationSourcePath, '-o', collisionExecutablePath]);
  run(collisionExecutablePath, [collisionContentRoot, spatialFoundationPath]);
  collisionChecked = true;
} else {
  const compiler = spawnSync('wsl.exe', ['sh', '-lc', 'command -v g++'], { encoding: 'utf8' });
  if (!compiler.error && compiler.status === 0) {
    run('wsl.exe', [
      'g++', '-std=c++20', '-I', toWslPath(includeRoot),
      toWslPath(collisionDriverPath), toWslPath(foundationSourcePath), '-o', toWslPath(collisionExecutablePath),
    ]);
    run('wsl.exe', [toWslPath(collisionExecutablePath), toWslPath(collisionContentRoot), toWslPath(spatialFoundationPath)]);
    collisionChecked = true;
  }
}
} finally {
  fs.rmSync(collisionTempRoot, { recursive: true, force: true });
}

console.log('Engine data foundation scaffold passed.');
console.log(`- Verified data foundation assets under ${path.join(repoRoot, 'content')}`);
console.log(`- Verified format manifest under ${path.join(repoRoot, 'data', 'foundation')}`);
console.log(`- Verified native data foundation sources under ${runtimeRoot}`);
console.log('- Verified TOML source, FlatBuffers cooked-output planning, SQLite tooling-db decisions, and effect descriptor metadata are represented in code and assets');
console.log(collisionChecked
  ? '- Compiled and ran strict optional prefab collision and camera parsing, composition, and rejection coverage'
  : '- SKIPPED native prefab collision/camera probe: no supported g++ compiler was available');
console.log(syntaxChecked
  ? '- Verified native data foundation C++ sources pass fallback syntax-only compilation'
  : '- Skipped g++ syntax check (not available on Windows — use WSL or CI for native compilation)');
