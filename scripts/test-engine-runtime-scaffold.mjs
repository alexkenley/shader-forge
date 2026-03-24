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
const physicsHeader = fs.readFileSync(path.join(includeRoot, 'shader_forge', 'runtime', 'physics_system.hpp'), 'utf8');
const saveHeader = fs.readFileSync(path.join(includeRoot, 'shader_forge', 'runtime', 'save_system.hpp'), 'utf8');
const toolingHeader = fs.readFileSync(path.join(includeRoot, 'shader_forge', 'runtime', 'tooling_ui.hpp'), 'utf8');
const runtimeMain = path.join(runtimeRoot, 'src', 'main.cpp');
const runtimeApp = path.join(runtimeRoot, 'src', 'runtime_app.cpp');
const animationSourcePath = path.join(runtimeRoot, 'src', 'animation_system.cpp');
const audioSourcePath = path.join(runtimeRoot, 'src', 'audio_system.cpp');
const dataFoundationSourcePath = path.join(runtimeRoot, 'src', 'data_foundation.cpp');
const inputSourcePath = path.join(runtimeRoot, 'src', 'input_system.cpp');
const physicsSourcePath = path.join(runtimeRoot, 'src', 'physics_system.cpp');
const saveSourcePath = path.join(runtimeRoot, 'src', 'save_system.cpp');
const toolingSourcePath = path.join(runtimeRoot, 'src', 'tooling_ui.cpp');
const runtimeSource = fs.readFileSync(runtimeApp, 'utf8');
const animationSource = fs.readFileSync(animationSourcePath, 'utf8');
const audioSource = fs.readFileSync(audioSourcePath, 'utf8');
const dataFoundationSource = fs.readFileSync(dataFoundationSourcePath, 'utf8');
const inputSource = fs.readFileSync(inputSourcePath, 'utf8');
const physicsSource = fs.readFileSync(physicsSourcePath, 'utf8');
const saveSource = fs.readFileSync(saveSourcePath, 'utf8');
const toolingSource = fs.readFileSync(toolingSourcePath, 'utf8');

assert.match(cliSource, /engine build/);
assert.match(cliSource, /engine run/);
assert.match(runtimeHeader, /RuntimeConfig/);
assert.match(runtimeHeader, /inputRoot/);
assert.match(runtimeHeader, /contentRoot/);
assert.match(runtimeHeader, /audioRoot/);
assert.match(runtimeHeader, /animationRoot/);
assert.match(runtimeHeader, /physicsRoot/);
assert.match(runtimeHeader, /dataFoundationPath/);
assert.match(runtimeHeader, /saveRoot/);
assert.match(runtimeHeader, /toolingLayoutPath/);
assert.match(runtimeHeader, /class RuntimeApp/);
assert.match(animationHeader, /class AnimationSystem/);
assert.match(animationHeader, /struct AnimationConfig/);
assert.match(audioHeader, /class AudioSystem/);
assert.match(audioHeader, /struct AudioConfig/);
assert.match(dataFoundationHeader, /class DataFoundation/);
assert.match(dataFoundationHeader, /effectDescriptor/);
assert.match(dataFoundationHeader, /procgeoSource/);
assert.match(inputHeader, /class InputSystem/);
assert.match(physicsHeader, /class PhysicsSystem/);
assert.match(saveHeader, /class SaveSystem/);
assert.match(saveHeader, /struct RuntimeSaveSnapshot/);
assert.match(toolingHeader, /class ToolingUiSystem/);
assert.match(toolingHeader, /ToolingRuntimeStateSnapshot/);
assert.match(toolingHeader, /physicsDebugEnabled/);
assert.match(toolingHeader, /physicsBodyCount/);
assert.match(runtimeSource, /vkAcquireNextImageKHR/);
assert.match(runtimeSource, /vkQueuePresentKHR/);
assert.match(runtimeSource, /vkCreateRenderPass/);
assert.match(runtimeSource, /vkCmdClearAttachments/);
assert.match(runtimeSource, /SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED/);
assert.match(runtimeSource, /actionValue\("move_x"\)/);
assert.match(runtimeSource, /toggle_tooling_overlay/);
assert.match(runtimeSource, /AnimationSystem animationSystem_/);
assert.match(runtimeSource, /initializeAnimationSystem/);
assert.match(runtimeSource, /triggerAnimationGraph\(/);
assert.match(runtimeSource, /animation-root=/);
assert.match(runtimeSource, /PhysicsSystem physicsSystem_/);
assert.match(runtimeSource, /SaveSystem saveSystem_/);
assert.match(runtimeSource, /initializePhysicsSystem/);
assert.match(runtimeSource, /initializeSaveSystem/);
assert.match(runtimeSource, /logPhysicsQueries/);
assert.match(runtimeSource, /physics-root=/);
assert.match(runtimeSource, /save-root=/);
assert.match(runtimeSource, /saveRuntimeState/);
assert.match(runtimeSource, /loadRuntimeState/);
assert.match(runtimeSource, /save_runtime_state/);
assert.match(runtimeSource, /load_runtime_state/);
assert.match(runtimeSource, /Physics raycast via/);
assert.match(runtimeSource, /anim=/);
assert.match(runtimeSource, /clip=/);
assert.match(runtimeSource, /AudioSystem audioSystem_/);
assert.match(runtimeSource, /initializeAudioSystem/);
assert.match(runtimeSource, /triggerAudioEvent\("runtime_boot"/);
assert.match(runtimeSource, /triggerAudioEvent\("ui_accept"/);
assert.match(runtimeSource, /DataFoundation dataFoundation_/);
assert.match(runtimeSource, /active-scene=/);
assert.match(runtimeSource, /audio-root=/);
assert.match(runtimeSource, /relationshipSummary/);
assert.match(runtimeSource, /sceneEntitySummary/);
assert.match(runtimeSource, /scenePrefabComponentSummary/);
assert.match(runtimeSource, /composedSceneSummary/);
assert.match(runtimeSource, /resolveDataDrivenRuntimeState/);
assert.match(runtimeSource, /resolveRuntimeSceneComposition/);
assert.match(runtimeSource, /updateInteractionTargetFromView/);
assert.match(runtimeSource, /triggerSceneInteraction/);
assert.match(runtimeSource, /reloadRuntimeContent/);
assert.match(runtimeSource, /toggle_physics_debug/);
assert.match(runtimeSource, /pollAuthoredContentReload/);
assert.match(runtimeSource, /updateRuntimeSceneState/);
assert.match(runtimeSource, /updateAnimationRuntimeState/);
assert.match(runtimeSource, /recordRuntimeState/);
assert.match(runtimeSource, /recordSceneProxyPass/);
assert.match(runtimeSource, /projectWorldBounds/);
assert.match(runtimeSource, /projectSceneRenderProxy/);
assert.match(runtimeSource, /projectPhysicsDebugBody/);
assert.match(runtimeSource, /projectPhysicsDebugBodies/);
assert.match(runtimeSource, /Runtime scene renderables:/);
assert.match(runtimeSource, /renderables=/);
assert.match(runtimeSource, /reloads=/);
assert.match(runtimeSource, /projected_debug_proxies/);
assert.match(runtimeSource, /projected_debug_bodies/);
assert.match(runtimeSource, /Controlled scene entity via/);
assert.match(runtimeSource, /Scene interaction via/);
assert.match(runtimeSource, /Scene effect /);
assert.match(runtimeSource, /Scene overlap effect /);
assert.match(runtimeSource, /Animation state /);
assert.match(runtimeSource, /Animation state event /);
assert.match(runtimeSource, /Controlled entity movement blocked by physics body/);
assert.match(runtimeSource, /blocked=/);
assert.match(runtimeSource, /blocked_by=/);
assert.match(runtimeSource, /move_speed=/);
assert.match(runtimeSource, /on_overlap/);
assert.match(runtimeSource, /target=/);
assert.match(runtimeSource, /fx=/);
assert.match(runtimeSource, /reload_runtime_content/);
assert.match(runtimeSource, /Physics debug visualization via/);
assert.match(runtimeSource, /Detected authored runtime content change on disk/);
assert.match(runtimeSource, /player=/);
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
assert.match(dataFoundationSource, /source_prefab/);
assert.match(dataFoundationSource, /Scene entity layout:/);
assert.match(dataFoundationSource, /Scene prefab components:/);
assert.match(inputSource, /SDL_EVENT_GAMEPAD_AXIS_MOTION/);
assert.match(inputSource, /bindingSummary/);
assert.match(inputSource, /SDL_SCANCODE_F10/);
assert.match(physicsSource, /shader_forge\.physics_layers/);
assert.match(physicsSource, /shader_forge\.physics_material/);
assert.match(physicsSource, /shader_forge\.physics_body/);
assert.match(physicsSource, /raycastScene/);
assert.match(physicsSource, /overlapSphereScene/);
assert.match(saveSource, /shader_forge\.runtime_save/);
assert.match(saveSource, /quickslot_01/);
assert.match(toolingSource, /overlay_visible/);
assert.match(toolingSource, /runtime_stats/);
assert.match(toolingSource, /move-speed=/);
assert.match(toolingSource, /physics-debug=/);
assert.match(toolingSource, /physics-bodies=/);
assert.match(toolingSource, /physics-focus=/);
assert.match(toolingSource, /target-fx=/);
assert.match(cliSource, /--tooling-layout/);
assert.match(cliSource, /--data-foundation/);
assert.match(cliSource, /--audio-root/);
assert.match(cliSource, /--animation-root/);
assert.match(cliSource, /--physics-root/);
assert.match(cliSource, /--save-root/);

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
      physicsSourcePath,
      saveSourcePath,
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
console.log('- Verified the runtime source contains swapchain, present, resize-aware render-loop, engine-owned input plumbing, native tooling UI substrate hooks, audio/animation/physics/save-system loading, and data foundation loading');
console.log(syntaxChecked
  ? '- Verified native runtime C++ sources pass fallback syntax-only compilation'
  : '- Skipped g++ syntax check (not available on Windows — use WSL or CI for native compilation)');
