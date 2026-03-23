import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
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
const dataPath = path.join(repoRoot, 'content', 'data', 'runtime_bootstrap.data.toml');
const effectPath = path.join(repoRoot, 'content', 'effects', 'impact_spark.effect.toml');

const foundationHeader = fs.readFileSync(foundationHeaderPath, 'utf8');
const foundationSource = fs.readFileSync(foundationSourcePath, 'utf8');
const runtimeHeader = fs.readFileSync(runtimeHeaderPath, 'utf8');
const runtimeMain = fs.readFileSync(runtimeMainPath, 'utf8');
const runtimeApp = fs.readFileSync(runtimeAppPath, 'utf8');
const cliSource = fs.readFileSync(cliSourcePath, 'utf8');
const foundationManifest = fs.readFileSync(foundationManifestPath, 'utf8');
const sceneAsset = fs.readFileSync(scenePath, 'utf8');
const prefabAsset = fs.readFileSync(prefabPath, 'utf8');
const dataAsset = fs.readFileSync(dataPath, 'utf8');
const effectAsset = fs.readFileSync(effectPath, 'utf8');

assert.match(foundationHeader, /class DataFoundation/);
assert.match(foundationHeader, /enum class DataAssetKind/);
assert.match(foundationHeader, /DataFoundationConfig/);
assert.match(foundationHeader, /struct SceneSourceSnapshot/);
assert.match(foundationHeader, /struct RuntimeBootstrapSnapshot/);
assert.match(foundationHeader, /loadFromDisk/);
assert.match(foundationHeader, /sceneLookupSummary/);
assert.match(foundationHeader, /relationshipSummary/);
assert.match(foundationHeader, /runtimeBootstrap/);
assert.match(foundationSource, /Data foundation: source=/);
assert.match(foundationSource, /", cooked="/);
assert.match(foundationSource, /", tooling-db="/);
assert.match(foundationSource, /shader_forge\.scene/);
assert.match(foundationSource, /shader_forge\.prefab/);
assert.match(foundationSource, /shader_forge\.effect/);
assert.match(foundationSource, /build\/cooked/);
assert.match(foundationSource, /primary_prefab/);
assert.match(foundationSource, /default_scene/);
assert.match(foundationSource, /tooling_overlay/);
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
assert.match(sceneAsset, /schema = "shader_forge\.scene"/);
assert.match(sceneAsset, /name = "sandbox"/);
assert.match(sceneAsset, /primary_prefab = "debug_camera"/);
assert.match(prefabAsset, /schema = "shader_forge\.prefab"/);
assert.match(prefabAsset, /spawn_tag = "player_camera"/);
assert.match(dataAsset, /schema = "shader_forge\.data"/);
assert.match(dataAsset, /default_scene = "sandbox"/);
assert.match(dataAsset, /tooling_overlay = "enabled"/);
assert.match(effectAsset, /schema = "shader_forge\.effect"/);
assert.match(effectAsset, /authoring_mode = "simple_descriptor"/);
assert.match(effectAsset, /runtime_model = "engine_descriptor"/);

const isWindows = process.platform === 'win32';
let syntaxChecked = false;

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
}

console.log('Engine data foundation scaffold passed.');
console.log(`- Verified data foundation assets under ${path.join(repoRoot, 'content')}`);
console.log(`- Verified format manifest under ${path.join(repoRoot, 'data', 'foundation')}`);
console.log(`- Verified native data foundation sources under ${runtimeRoot}`);
console.log('- Verified TOML source, FlatBuffers cooked-output planning, SQLite tooling-db decisions, and effect descriptor metadata are represented in code and assets');
console.log(syntaxChecked
  ? '- Verified native data foundation C++ sources pass fallback syntax-only compilation'
  : '- Skipped g++ syntax check (not available on Windows — use WSL or CI for native compilation)');
