import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { repoRootFromScript } from './lib/harness-utils.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const runtimeRoot = path.join(repoRoot, 'engine', 'runtime');
const includeRoot = path.join(runtimeRoot, 'include');
const cliSource = fs.readFileSync(path.join(repoRoot, 'tools', 'engine-cli', 'shaderforge.mjs'), 'utf8');
const runtimeHeader = fs.readFileSync(path.join(includeRoot, 'shader_forge', 'runtime', 'runtime_app.hpp'), 'utf8');
const animationHeader = fs.readFileSync(path.join(includeRoot, 'shader_forge', 'runtime', 'animation_system.hpp'), 'utf8');
const audioHeader = fs.readFileSync(path.join(includeRoot, 'shader_forge', 'runtime', 'audio_system.hpp'), 'utf8');
const dataFoundationHeader = fs.readFileSync(path.join(includeRoot, 'shader_forge', 'runtime', 'data_foundation.hpp'), 'utf8');
const inputHeader = fs.readFileSync(path.join(includeRoot, 'shader_forge', 'runtime', 'input_system.hpp'), 'utf8');
const toolingHeader = fs.readFileSync(path.join(includeRoot, 'shader_forge', 'runtime', 'tooling_ui.hpp'), 'utf8');
const runtimeMain = path.join(runtimeRoot, 'src', 'main.cpp');
const runtimeApp = path.join(runtimeRoot, 'src', 'runtime_app.cpp');
const animationSourcePath = path.join(runtimeRoot, 'src', 'animation_system.cpp');
const audioSourcePath = path.join(runtimeRoot, 'src', 'audio_system.cpp');
const dataFoundationSourcePath = path.join(runtimeRoot, 'src', 'data_foundation.cpp');
const inputSourcePath = path.join(runtimeRoot, 'src', 'input_system.cpp');
const toolingSourcePath = path.join(runtimeRoot, 'src', 'tooling_ui.cpp');
const runtimeSource = fs.readFileSync(runtimeApp, 'utf8');
const animationSource = fs.readFileSync(animationSourcePath, 'utf8');
const audioSource = fs.readFileSync(audioSourcePath, 'utf8');
const dataFoundationSource = fs.readFileSync(dataFoundationSourcePath, 'utf8');
const inputSource = fs.readFileSync(inputSourcePath, 'utf8');
const toolingSource = fs.readFileSync(toolingSourcePath, 'utf8');

assert.match(cliSource, /engine build/);
assert.match(cliSource, /engine run/);
assert.match(runtimeHeader, /RuntimeConfig/);
assert.match(runtimeHeader, /inputRoot/);
assert.match(runtimeHeader, /contentRoot/);
assert.match(runtimeHeader, /audioRoot/);
assert.match(runtimeHeader, /animationRoot/);
assert.match(runtimeHeader, /dataFoundationPath/);
assert.match(runtimeHeader, /toolingLayoutPath/);
assert.match(runtimeHeader, /class RuntimeApp/);
assert.match(animationHeader, /class AnimationSystem/);
assert.match(animationHeader, /struct AnimationConfig/);
assert.match(audioHeader, /class AudioSystem/);
assert.match(audioHeader, /struct AudioConfig/);
assert.match(dataFoundationHeader, /class DataFoundation/);
assert.match(inputHeader, /class InputSystem/);
assert.match(toolingHeader, /class ToolingUiSystem/);
assert.match(runtimeSource, /vkAcquireNextImageKHR/);
assert.match(runtimeSource, /vkQueuePresentKHR/);
assert.match(runtimeSource, /vkCreateRenderPass/);
assert.match(runtimeSource, /SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED/);
assert.match(runtimeSource, /actionValue\("move_x"\)/);
assert.match(runtimeSource, /toggle_tooling_overlay/);
assert.match(runtimeSource, /AnimationSystem animationSystem_/);
assert.match(runtimeSource, /initializeAnimationSystem/);
assert.match(runtimeSource, /triggerAnimationGraph\(/);
assert.match(runtimeSource, /animation-root=/);
assert.match(runtimeSource, /anim=/);
assert.match(runtimeSource, /AudioSystem audioSystem_/);
assert.match(runtimeSource, /initializeAudioSystem/);
assert.match(runtimeSource, /triggerAudioEvent\("runtime_boot"/);
assert.match(runtimeSource, /triggerAudioEvent\("ui_accept"/);
assert.match(runtimeSource, /DataFoundation dataFoundation_/);
assert.match(runtimeSource, /active-scene=/);
assert.match(runtimeSource, /audio-root=/);
assert.match(runtimeSource, /relationshipSummary/);
assert.match(runtimeSource, /resolveDataDrivenRuntimeState/);
assert.match(animationSource, /shader_forge\.animation_clip/);
assert.match(animationSource, /shader_forge\.animation_graph/);
assert.match(animationSource, /shader_forge\.skeleton/);
assert.match(animationSource, /audio_event/);
assert.match(animationSource, /Animation foundation:/);
assert.match(audioSource, /shader_forge\.audio_buses/);
assert.match(audioSource, /shader_forge\.sound/);
assert.match(audioSource, /shader_forge\.audio_event/);
assert.match(audioSource, /Audio foundation:/);
assert.match(dataFoundationSource, /flatbuffer/);
assert.match(dataFoundationSource, /sqlite/);
assert.match(dataFoundationSource, /primary_prefab/);
assert.match(inputSource, /SDL_EVENT_GAMEPAD_AXIS_MOTION/);
assert.match(inputSource, /bindingSummary/);
assert.match(toolingSource, /overlay_visible/);
assert.match(toolingSource, /runtime_stats/);
assert.match(cliSource, /--tooling-layout/);
assert.match(cliSource, /--data-foundation/);
assert.match(cliSource, /--audio-root/);
assert.match(cliSource, /--animation-root/);

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
      runtimeMain,
      animationSourcePath,
      audioSourcePath,
      dataFoundationSourcePath,
      inputSourcePath,
      toolingSourcePath,
      runtimeApp,
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
    `Runtime scaffold syntax check failed.\n${syntaxCheck.stderr || syntaxCheck.stdout}`,
  );
  syntaxChecked = true;
}

console.log('Engine runtime scaffold passed.');
console.log(`- Verified runtime sources under ${runtimeRoot}`);
console.log('- Verified CLI runtime build/run command surfaces are present');
console.log('- Verified the runtime source contains swapchain, present, resize-aware render-loop, engine-owned input plumbing, native tooling UI substrate hooks, audio/animation loading, and data foundation loading');
console.log(syntaxChecked
  ? '- Verified native runtime C++ sources pass fallback syntax-only compilation'
  : '- Skipped g++ syntax check (not available on Windows — use WSL or CI for native compilation)');
