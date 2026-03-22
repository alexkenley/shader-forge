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
const runtimeMain = path.join(runtimeRoot, 'src', 'main.cpp');
const runtimeApp = path.join(runtimeRoot, 'src', 'runtime_app.cpp');
const runtimeSource = fs.readFileSync(runtimeApp, 'utf8');

assert.match(cliSource, /engine build/);
assert.match(cliSource, /engine run/);
assert.match(runtimeHeader, /RuntimeConfig/);
assert.match(runtimeHeader, /class RuntimeApp/);
assert.match(runtimeSource, /vkAcquireNextImageKHR/);
assert.match(runtimeSource, /vkQueuePresentKHR/);
assert.match(runtimeSource, /vkCreateRenderPass/);
assert.match(runtimeSource, /SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED/);

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
console.log('- Verified the runtime source contains swapchain, present, and resize-aware render-loop plumbing');
console.log(syntaxChecked
  ? '- Verified native runtime C++ sources pass fallback syntax-only compilation'
  : '- Skipped g++ syntax check (not available on Windows — use WSL or CI for native compilation)');
