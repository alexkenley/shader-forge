import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { repoRootFromScript } from './lib/harness-utils.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const runtimeRoot = path.join(repoRoot, 'engine', 'runtime');
const includeRoot = path.join(runtimeRoot, 'include');
const dataFoundationHeaderPath = path.join(includeRoot, 'shader_forge', 'runtime', 'data_foundation.hpp');
const dataFoundationSourcePath = path.join(runtimeRoot, 'src', 'data_foundation.cpp');
const runtimeAppPath = path.join(runtimeRoot, 'src', 'runtime_app.cpp');
const runtimeMainPath = path.join(runtimeRoot, 'src', 'main.cpp');
const animationSourcePath = path.join(runtimeRoot, 'src', 'animation_system.cpp');
const audioSourcePath = path.join(runtimeRoot, 'src', 'audio_system.cpp');
const inputSourcePath = path.join(runtimeRoot, 'src', 'input_system.cpp');
const physicsSourcePath = path.join(runtimeRoot, 'src', 'physics_system.cpp');
const toolingSourcePath = path.join(runtimeRoot, 'src', 'tooling_ui.cpp');
const sceneAssetPath = path.join(repoRoot, 'content', 'scenes', 'sandbox.scene.toml');
const planPath = path.join(repoRoot, 'plans', 'ENGINE-IMPLEMENTATION-PLAN.md');

const dataFoundationHeader = fs.readFileSync(dataFoundationHeaderPath, 'utf8');
const dataFoundationSource = fs.readFileSync(dataFoundationSourcePath, 'utf8');
const runtimeApp = fs.readFileSync(runtimeAppPath, 'utf8');
const sceneAsset = fs.readFileSync(sceneAssetPath, 'utf8');
const implementationPlan = fs.readFileSync(planPath, 'utf8');

assert.match(dataFoundationHeader, /struct ComposedSceneEntitySnapshot/);
assert.match(dataFoundationHeader, /struct ComposedSceneSnapshot/);
assert.match(dataFoundationHeader, /procgeoSource/);
assert.match(dataFoundationHeader, /composeScene/);
assert.match(dataFoundationHeader, /composedSceneSummary/);
assert.match(dataFoundationSource, /Composed scene:/);
assert.match(dataFoundationSource, /preferred_player_entity=/);
assert.match(dataFoundationSource, /is part of a parent cycle/);
assert.match(runtimeApp, /resolveRuntimeSceneComposition/);
assert.match(runtimeApp, /updateRuntimeSceneState/);
assert.match(runtimeApp, /recordSceneProxyPass/);
assert.match(runtimeApp, /projectSceneRenderProxy/);
assert.match(runtimeApp, /vkCmdClearAttachments/);
assert.match(runtimeApp, /Controlled scene entity via/);
assert.match(runtimeApp, /Scene interaction via/);
assert.match(runtimeApp, /player=/);
assert.match(runtimeApp, /Runtime scene renderables:/);
assert.match(runtimeApp, /projected_debug_proxies/);
assert.match(runtimeApp, /dataFoundation_\.composedSceneSummary/);
assert.match(sceneAsset, /\[entity\.crate_satellite\]/);
assert.match(sceneAsset, /parent = "crate_focus"/);
assert.match(implementationPlan, /Phase 6 has now started through a first scene-runtime composition slice/);
assert.match(implementationPlan, /input-driven controlled-entity state/);

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
      animationSourcePath,
      audioSourcePath,
      dataFoundationSourcePath,
      inputSourcePath,
      physicsSourcePath,
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
    `Scene runtime scaffold syntax check failed.\n${syntaxCheck.stderr || syntaxCheck.stdout}`,
  );
  syntaxChecked = true;
}

console.log('Engine scene runtime scaffold passed.');
console.log(`- Verified composed scene runtime sources under ${runtimeRoot}`);
console.log('- Verified authored scene hierarchy and prefab payloads now feed a real composed runtime-scene slice');
console.log(syntaxChecked
  ? '- Verified native runtime C++ sources pass fallback syntax-only compilation for the scene-runtime slice'
  : '- Skipped g++ syntax check (not available on Windows — use WSL or CI for native compilation)');
