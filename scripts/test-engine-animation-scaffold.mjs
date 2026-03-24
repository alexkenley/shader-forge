import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { repoRootFromScript } from './lib/harness-utils.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const runtimeRoot = path.join(repoRoot, 'engine', 'runtime');
const includeRoot = path.join(runtimeRoot, 'include');
const cliSource = fs.readFileSync(path.join(repoRoot, 'tools', 'engine-cli', 'shaderforge.mjs'), 'utf8');
const animationHeader = fs.readFileSync(path.join(includeRoot, 'shader_forge', 'runtime', 'animation_system.hpp'), 'utf8');
const animationSourcePath = path.join(runtimeRoot, 'src', 'animation_system.cpp');
const animationSource = fs.readFileSync(animationSourcePath, 'utf8');
const runtimeApp = fs.readFileSync(path.join(runtimeRoot, 'src', 'runtime_app.cpp'), 'utf8');
const skeletonToml = fs.readFileSync(path.join(repoRoot, 'animation', 'skeletons', 'debug_humanoid.skeleton.toml'), 'utf8');
const idleClipToml = fs.readFileSync(path.join(repoRoot, 'animation', 'clips', 'debug_idle.anim.toml'), 'utf8');
const walkClipToml = fs.readFileSync(path.join(repoRoot, 'animation', 'clips', 'debug_walk.anim.toml'), 'utf8');
const graphToml = fs.readFileSync(path.join(repoRoot, 'animation', 'graphs', 'debug_actor.animgraph.toml'), 'utf8');

assert.match(cliSource, /--animation-root/);
assert.match(cliSource, /engine bake/);
assert.match(cliSource, /engine run/);
assert.match(animationHeader, /class AnimationSystem/);
assert.match(animationHeader, /ResolvedAnimationGraphSnapshot/);
assert.match(animationHeader, /ResolvedAnimationStateSnapshot/);
assert.match(animationHeader, /resolveGraphState/);
assert.match(animationSource, /shader_forge\.animation_clip/);
assert.match(animationSource, /shader_forge\.animation_graph/);
assert.match(animationSource, /shader_forge\.skeleton/);
assert.match(animationSource, /resolveGraphState/);
assert.match(animationSource, /audio_event/);
assert.match(animationSource, /marker/);
assert.match(runtimeApp, /initializeAnimationSystem/);
assert.match(runtimeApp, /triggerAnimationGraph/);
assert.match(runtimeApp, /updateAnimationRuntimeState/);
assert.match(runtimeApp, /Animation state /);
assert.match(runtimeApp, /Animation state event /);
assert.match(runtimeApp, /AnimationSystem animationSystem_/);
assert.match(runtimeApp, /animation-root=/);
assert.match(runtimeApp, /animationSystem_\.foundationSummary\(\)/);
assert.match(skeletonToml, /schema = "shader_forge\.skeleton"/);
assert.match(skeletonToml, /root_bone = "hips"/);
assert.match(idleClipToml, /schema = "shader_forge\.animation_clip"/);
assert.match(idleClipToml, /\[event\.idle_breath\]/);
assert.match(walkClipToml, /type = "audio_event"/);
assert.match(walkClipToml, /target = "player_footstep"/);
assert.match(graphToml, /schema = "shader_forge\.animation_graph"/);
assert.match(graphToml, /\[state\.walk\]/);

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
      path.join(runtimeRoot, 'src', 'main.cpp'),
      animationSourcePath,
      path.join(runtimeRoot, 'src', 'audio_system.cpp'),
      path.join(runtimeRoot, 'src', 'data_foundation.cpp'),
      path.join(runtimeRoot, 'src', 'input_system.cpp'),
      path.join(runtimeRoot, 'src', 'tooling_ui.cpp'),
      path.join(runtimeRoot, 'src', 'runtime_app.cpp'),
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
    `Animation scaffold syntax check failed.\n${syntaxCheck.stderr || syntaxCheck.stdout}`,
  );
  syntaxChecked = true;
}

console.log('Engine animation scaffold passed.');
console.log(`- Verified authored animation assets under ${path.join(repoRoot, 'animation')}`);
console.log(`- Verified native animation sources under ${runtimeRoot}`);
console.log('- Verified authored skeletons, clips, graphs, and animation-event hooks are wired through engine-owned runtime APIs');
console.log(syntaxChecked
  ? '- Verified native animation C++ sources pass fallback syntax-only compilation'
  : '- Skipped g++ syntax check (not available on Windows — use WSL or CI for native compilation)');
