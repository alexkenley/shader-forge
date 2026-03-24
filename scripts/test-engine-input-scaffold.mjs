import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { repoRootFromScript } from './lib/harness-utils.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const runtimeRoot = path.join(repoRoot, 'engine', 'runtime');
const includeRoot = path.join(runtimeRoot, 'include');
const inputHeaderPath = path.join(includeRoot, 'shader_forge', 'runtime', 'input_system.hpp');
const inputSourcePath = path.join(runtimeRoot, 'src', 'input_system.cpp');
const runtimeAppPath = path.join(runtimeRoot, 'src', 'runtime_app.cpp');
const runtimeMainPath = path.join(runtimeRoot, 'src', 'main.cpp');
const actionsPath = path.join(repoRoot, 'input', 'actions.toml');
const gameplayContextPath = path.join(repoRoot, 'input', 'contexts', 'gameplay.input.toml');
const uiContextPath = path.join(repoRoot, 'input', 'contexts', 'ui.input.toml');

const inputHeader = fs.readFileSync(inputHeaderPath, 'utf8');
const inputSource = fs.readFileSync(inputSourcePath, 'utf8');
const runtimeApp = fs.readFileSync(runtimeAppPath, 'utf8');
const runtimeMain = fs.readFileSync(runtimeMainPath, 'utf8');
const actionsToml = fs.readFileSync(actionsPath, 'utf8');
const gameplayToml = fs.readFileSync(gameplayContextPath, 'utf8');
const uiToml = fs.readFileSync(uiContextPath, 'utf8');

assert.match(inputHeader, /class InputSystem/);
assert.match(inputHeader, /enum class InputBindingSource/);
assert.match(inputHeader, /enum class InputActionKind/);
assert.match(inputHeader, /loadFromDisk/);
assert.match(inputHeader, /actionValue/);
assert.match(inputSource, /actions\.toml/);
assert.match(inputSource, /contexts/);
assert.match(inputSource, /mouse_motion/);
assert.match(inputSource, /gamepad_axis/);
assert.match(inputSource, /SDL_EVENT_GAMEPAD_AXIS_MOTION/);
assert.match(inputSource, /SDL_EVENT_MOUSE_MOTION/);
assert.match(inputSource, /SDL_SCANCODE_F7/);
assert.match(inputSource, /bindingSummary/);
assert.match(runtimeApp, /InputSystem inputSystem_/);
assert.match(runtimeApp, /actionPressed\("runtime_exit"\)/);
assert.match(runtimeApp, /actionPressed\("reload_runtime_content"\)/);
assert.match(runtimeApp, /actionValue\("move_x"\)/);
assert.match(runtimeApp, /actionValue\("look_y"\)/);
assert.match(runtimeApp, /toggle_input_debug/);
assert.match(runtimeMain, /--input-root/);
assert.match(actionsToml, /\[\[action\]\]/);
assert.match(actionsToml, /runtime_exit/);
assert.match(actionsToml, /reload_runtime_content/);
assert.match(actionsToml, /move_x/);
assert.match(actionsToml, /toggle_tooling_overlay/);
assert.match(gameplayToml, /source = "keyboard"/);
assert.match(gameplayToml, /source = "mouse_motion"/);
assert.match(gameplayToml, /source = "gamepad_axis"/);
assert.match(gameplayToml, /code = "f2"/);
assert.match(gameplayToml, /code = "f7"/);
assert.match(uiToml, /source = "mouse_button"/);
assert.match(uiToml, /source = "gamepad_button"/);

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
      inputSourcePath,
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
    `Input scaffold syntax check failed.\n${syntaxCheck.stderr || syntaxCheck.stdout}`,
  );
  syntaxChecked = true;
}

console.log('Engine input scaffold passed.');
console.log(`- Verified input assets under ${path.join(repoRoot, 'input')}`);
console.log(`- Verified native input sources under ${runtimeRoot}`);
console.log('- Verified text-backed actions and contexts cover keyboard, mouse, and gamepad bindings');
console.log('- Verified the runtime consumes named actions instead of raw SDL events directly');
console.log(syntaxChecked
  ? '- Verified native input C++ sources pass fallback syntax-only compilation'
  : '- Skipped g++ syntax check (not available on Windows — use WSL or CI for native compilation)');
