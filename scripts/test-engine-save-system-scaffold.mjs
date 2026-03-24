import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { repoRootFromScript } from './lib/harness-utils.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const runtimeRoot = path.join(repoRoot, 'engine', 'runtime');
const includeRoot = path.join(runtimeRoot, 'include');
const saveHeaderPath = path.join(includeRoot, 'shader_forge', 'runtime', 'save_system.hpp');
const saveSourcePath = path.join(runtimeRoot, 'src', 'save_system.cpp');
const runtimeHeaderPath = path.join(includeRoot, 'shader_forge', 'runtime', 'runtime_app.hpp');
const runtimeAppPath = path.join(runtimeRoot, 'src', 'runtime_app.cpp');
const runtimeMainPath = path.join(runtimeRoot, 'src', 'main.cpp');
const animationSourcePath = path.join(runtimeRoot, 'src', 'animation_system.cpp');
const audioSourcePath = path.join(runtimeRoot, 'src', 'audio_system.cpp');
const dataFoundationSourcePath = path.join(runtimeRoot, 'src', 'data_foundation.cpp');
const inputSourcePath = path.join(runtimeRoot, 'src', 'input_system.cpp');
const physicsSourcePath = path.join(runtimeRoot, 'src', 'physics_system.cpp');
const toolingSourcePath = path.join(runtimeRoot, 'src', 'tooling_ui.cpp');
const cliSourcePath = path.join(repoRoot, 'tools', 'engine-cli', 'shaderforge.mjs');
const runtimeStorePath = path.join(repoRoot, 'tools', 'engine-sessiond', 'lib', 'runtime-store.mjs');
const saveSpecPath = path.join(repoRoot, 'docs', 'specs', 'ENGINE-SAVE-SYSTEM-SPEC.md');
const planPath = path.join(repoRoot, 'plans', 'ENGINE-IMPLEMENTATION-PLAN.md');

const saveHeader = fs.readFileSync(saveHeaderPath, 'utf8');
const saveSource = fs.readFileSync(saveSourcePath, 'utf8');
const runtimeHeader = fs.readFileSync(runtimeHeaderPath, 'utf8');
const runtimeApp = fs.readFileSync(runtimeAppPath, 'utf8');
const runtimeMain = fs.readFileSync(runtimeMainPath, 'utf8');
const cliSource = fs.readFileSync(cliSourcePath, 'utf8');
const runtimeStore = fs.readFileSync(runtimeStorePath, 'utf8');
const saveSpec = fs.readFileSync(saveSpecPath, 'utf8');
const implementationPlan = fs.readFileSync(planPath, 'utf8');

assert.match(saveHeader, /struct SaveSystemConfig/);
assert.match(saveHeader, /struct RuntimeSaveSnapshot/);
assert.match(saveHeader, /class SaveSystem/);
assert.match(saveHeader, /saveSlot/);
assert.match(saveHeader, /loadSlot/);
assert.match(saveHeader, /saved\/runtime/);
assert.match(saveSource, /shader_forge\.runtime_save/);
assert.match(saveSource, /quickslot_01/);
assert.match(saveSource, /triggered_overlap_bodies/);
assert.match(runtimeHeader, /saveRoot/);
assert.match(runtimeApp, /SaveSystem saveSystem_/);
assert.match(runtimeApp, /initializeSaveSystem/);
assert.match(runtimeApp, /saveRuntimeState/);
assert.match(runtimeApp, /loadRuntimeState/);
assert.match(runtimeApp, /Saved runtime state via/);
assert.match(runtimeApp, /Loaded runtime state via/);
assert.match(runtimeApp, /F8 to quicksave runtime state/);
assert.match(runtimeMain, /--save-root/);
assert.match(cliSource, /--save-root/);
assert.match(runtimeStore, /--save-root/);
assert.match(saveSpec, /runtime persistence/i);
assert.match(implementationPlan, /Phase 6\.1/);

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
      saveSourcePath,
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
    `Save-system scaffold syntax check failed.\n${syntaxCheck.stderr || syntaxCheck.stdout}`,
  );
  syntaxChecked = true;
}

console.log('Engine save-system scaffold passed.');
console.log(`- Verified runtime save-system sources under ${runtimeRoot}`);
console.log('- Verified quick-save and quick-load runtime wiring plus session-root save-path forwarding');
console.log(syntaxChecked
  ? '- Verified native save-system C++ sources pass fallback syntax-only compilation'
  : '- Skipped g++ syntax check (not available on Windows — use WSL or CI for native compilation)');
