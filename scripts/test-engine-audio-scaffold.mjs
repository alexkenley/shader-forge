import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { repoRootFromScript } from './lib/harness-utils.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const runtimeRoot = path.join(repoRoot, 'engine', 'runtime');
const includeRoot = path.join(runtimeRoot, 'include');
const cliSource = fs.readFileSync(path.join(repoRoot, 'tools', 'engine-cli', 'shaderforge.mjs'), 'utf8');
const audioHeader = fs.readFileSync(path.join(includeRoot, 'shader_forge', 'runtime', 'audio_system.hpp'), 'utf8');
const audioSourcePath = path.join(runtimeRoot, 'src', 'audio_system.cpp');
const audioSource = fs.readFileSync(audioSourcePath, 'utf8');
const runtimeApp = fs.readFileSync(path.join(runtimeRoot, 'src', 'runtime_app.cpp'), 'utf8');
const busesToml = fs.readFileSync(path.join(repoRoot, 'audio', 'buses.toml'), 'utf8');
const uiConfirmSound = fs.readFileSync(path.join(repoRoot, 'audio', 'sounds', 'ui_confirm.sound.toml'), 'utf8');
const runtimeBootEvent = fs.readFileSync(path.join(repoRoot, 'audio', 'events', 'runtime_boot.audio-event.toml'), 'utf8');

assert.match(cliSource, /--audio-root/);
assert.match(cliSource, /engine bake/);
assert.match(cliSource, /engine run/);
assert.match(audioHeader, /class AudioSystem/);
assert.match(audioHeader, /ResolvedAudioEventSnapshot/);
assert.match(audioSource, /shader_forge\.audio_buses/);
assert.match(audioSource, /shader_forge\.sound/);
assert.match(audioSource, /shader_forge\.audio_event/);
assert.match(audioSource, /master/);
assert.match(audioSource, /ambience/);
assert.match(runtimeApp, /initializeAudioSystem/);
assert.match(runtimeApp, /triggerAudioEvent\("runtime_boot", "startup"\)/);
assert.match(runtimeApp, /triggerAudioEvent\("ui_accept", "ui_accept"\)/);
assert.match(busesToml, /\[bus\.Master\]/);
assert.match(busesToml, /\[bus\.Ambience\]/);
assert.match(uiConfirmSound, /source_media = "media\/ui_confirm\.ogg"/);
assert.match(uiConfirmSound, /bus = "SFX"/);
assert.match(runtimeBootEvent, /sound = "ambient_wind"/);

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
      audioSourcePath,
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
    `Audio scaffold syntax check failed.\n${syntaxCheck.stderr || syntaxCheck.stdout}`,
  );
  syntaxChecked = true;
}

console.log('Engine audio scaffold passed.');
console.log(`- Verified audio assets under ${path.join(repoRoot, 'audio')}`);
console.log(`- Verified native audio sources under ${runtimeRoot}`);
console.log('- Verified authored buses, sounds, and audio events are wired through engine-owned runtime APIs');
console.log(syntaxChecked
  ? '- Verified native audio C++ sources pass fallback syntax-only compilation'
  : '- Skipped g++ syntax check (not available on Windows — use WSL or CI for native compilation)');
