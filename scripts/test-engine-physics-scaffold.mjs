import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { repoRootFromScript } from './lib/harness-utils.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const runtimeRoot = path.join(repoRoot, 'engine', 'runtime');
const includeRoot = path.join(runtimeRoot, 'include');
const cliSource = fs.readFileSync(path.join(repoRoot, 'tools', 'engine-cli', 'shaderforge.mjs'), 'utf8');
const physicsHeader = fs.readFileSync(path.join(includeRoot, 'shader_forge', 'runtime', 'physics_system.hpp'), 'utf8');
const physicsSourcePath = path.join(runtimeRoot, 'src', 'physics_system.cpp');
const physicsSource = fs.readFileSync(physicsSourcePath, 'utf8');
const runtimeApp = fs.readFileSync(path.join(runtimeRoot, 'src', 'runtime_app.cpp'), 'utf8');
const layersToml = fs.readFileSync(path.join(repoRoot, 'physics', 'layers.toml'), 'utf8');
const defaultMaterialToml = fs.readFileSync(path.join(repoRoot, 'physics', 'materials', 'default_surface.physics-material.toml'), 'utf8');
const crateBodyToml = fs.readFileSync(path.join(repoRoot, 'physics', 'bodies', 'debug_crate.physics-body.toml'), 'utf8');

assert.match(cliSource, /--physics-root/);
assert.match(cliSource, /engine bake/);
assert.match(cliSource, /engine run/);
assert.match(physicsHeader, /class PhysicsSystem/);
assert.match(physicsHeader, /PhysicsRaycastHitSnapshot/);
assert.match(physicsHeader, /overlapSphereScene/);
assert.match(physicsSource, /shader_forge\.physics_layers/);
assert.match(physicsSource, /shader_forge\.physics_material/);
assert.match(physicsSource, /shader_forge\.physics_body/);
assert.match(physicsSource, /intersectsRayAabb/);
assert.match(physicsSource, /intersectsRaySphere/);
assert.match(runtimeApp, /initializePhysicsSystem/);
assert.match(runtimeApp, /logPhysicsQueries/);
assert.match(runtimeApp, /projectPhysicsDebugBody/);
assert.match(runtimeApp, /PhysicsSystem physicsSystem_/);
assert.match(runtimeApp, /physics-root=/);
assert.match(runtimeApp, /physicsSystem_\.foundationSummary\(\)/);
assert.match(runtimeApp, /projected_debug_bodies/);
assert.match(runtimeApp, /Physics debug visualization via/);
assert.match(layersToml, /schema = "shader_forge\.physics_layers"/);
assert.match(layersToml, /\[layer\.World_Static\]/);
assert.match(defaultMaterialToml, /schema = "shader_forge\.physics_material"/);
assert.match(defaultMaterialToml, /friction = 0\.8/);
assert.match(crateBodyToml, /schema = "shader_forge\.physics_body"/);
assert.match(crateBodyToml, /layer = "World_Dynamic"/);
assert.match(crateBodyToml, /motion_type = "dynamic"/);
assert.match(crateBodyToml, /shape_type = "box"/);

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
      path.join(runtimeRoot, 'src', 'animation_system.cpp'),
      path.join(runtimeRoot, 'src', 'audio_system.cpp'),
      path.join(runtimeRoot, 'src', 'data_foundation.cpp'),
      path.join(runtimeRoot, 'src', 'input_system.cpp'),
      physicsSourcePath,
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
    `Physics scaffold syntax check failed.\n${syntaxCheck.stderr || syntaxCheck.stdout}`,
  );
  syntaxChecked = true;
}

console.log('Engine physics scaffold passed.');
console.log(`- Verified authored physics assets under ${path.join(repoRoot, 'physics')}`);
console.log(`- Verified native physics sources under ${runtimeRoot}`);
console.log('- Verified authored layers, materials, bodies, and deterministic query hooks are wired through engine-owned runtime APIs');
console.log(syntaxChecked
  ? '- Verified native physics C++ sources pass fallback syntax-only compilation'
  : '- Skipped g++ syntax check (not available on Windows — use WSL or CI for native compilation)');
