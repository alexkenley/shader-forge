import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { repoRootFromScript } from './lib/harness-utils.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const runtimeRoot = path.join(repoRoot, 'engine', 'runtime');
const includeRoot = path.join(runtimeRoot, 'include');
const toolingHeaderPath = path.join(includeRoot, 'shader_forge', 'runtime', 'tooling_ui.hpp');
const runtimeHeaderPath = path.join(includeRoot, 'shader_forge', 'runtime', 'runtime_app.hpp');
const toolingSourcePath = path.join(runtimeRoot, 'src', 'tooling_ui.cpp');
const inputSourcePath = path.join(runtimeRoot, 'src', 'input_system.cpp');
const runtimeMainPath = path.join(runtimeRoot, 'src', 'main.cpp');
const runtimeAppPath = path.join(runtimeRoot, 'src', 'runtime_app.cpp');
const layoutPath = path.join(repoRoot, 'tooling', 'layouts', 'default.tooling-layout.toml');
const cliSourcePath = path.join(repoRoot, 'tools', 'engine-cli', 'shaderforge.mjs');

const toolingHeader = fs.readFileSync(toolingHeaderPath, 'utf8');
const runtimeHeader = fs.readFileSync(runtimeHeaderPath, 'utf8');
const toolingSource = fs.readFileSync(toolingSourcePath, 'utf8');
const runtimeApp = fs.readFileSync(runtimeAppPath, 'utf8');
const runtimeMain = fs.readFileSync(runtimeMainPath, 'utf8');
const layoutToml = fs.readFileSync(layoutPath, 'utf8');
const cliSource = fs.readFileSync(cliSourcePath, 'utf8');

assert.match(toolingHeader, /class ToolingUiSystem/);
assert.match(toolingHeader, /enum class ToolDockArea/);
assert.match(toolingHeader, /struct ToolingRuntimeStateSnapshot/);
assert.match(toolingHeader, /loadLayout/);
assert.match(toolingHeader, /saveSessionLayout/);
assert.match(toolingHeader, /toggleOverlay/);
assert.match(toolingHeader, /recordRuntimeState/);
assert.match(toolingHeader, /panelRegistrySummary/);
assert.match(toolingSource, /runtime_stats/);
assert.match(toolingSource, /input_debug/);
assert.match(toolingSource, /log_view/);
assert.match(toolingSource, /debug_state/);
assert.match(toolingSource, /move-speed=/);
assert.match(toolingSource, /target-fx=/);
assert.match(runtimeHeader, /runtime-session\.tooling-layout\.toml/);
assert.match(toolingSource, /overlay_visible/);
assert.match(toolingSource, /recentLogSummary/);
assert.match(runtimeApp, /ToolingUiSystem toolingUi_/);
assert.match(runtimeApp, /initializeToolingUi/);
assert.match(runtimeApp, /recordRuntimeState/);
assert.match(runtimeApp, /toggle_tooling_overlay/);
assert.match(runtimeApp, /toggle_runtime_stats_panel/);
assert.match(runtimeApp, /toggle_input_panel/);
assert.match(runtimeApp, /toggle_log_panel/);
assert.match(runtimeApp, /toggle_debug_state_panel/);
assert.match(runtimeApp, /saveSessionLayout/);
assert.match(runtimeMain, /--tooling-layout/);
assert.match(runtimeMain, /--tooling-layout-save/);
assert.match(cliSource, /--tooling-layout/);
assert.match(cliSource, /--tooling-layout-save/);
assert.match(layoutToml, /layout_name = "default"/);
assert.match(layoutToml, /overlay_visible = true/);
assert.match(layoutToml, /name = "runtime_stats"/);
assert.match(layoutToml, /name = "log_view"/);

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
    `Tooling UI scaffold syntax check failed.\n${syntaxCheck.stderr || syntaxCheck.stdout}`,
  );
  syntaxChecked = true;
}

console.log('Engine tooling UI scaffold passed.');
console.log(`- Verified tooling layout assets under ${path.join(repoRoot, 'tooling')}`);
console.log(`- Verified native tooling UI sources under ${runtimeRoot}`);
console.log('- Verified tool registry, layout persistence, and runtime overlay wiring are present');
console.log(syntaxChecked
  ? '- Verified native tooling UI C++ sources pass fallback syntax-only compilation'
  : '- Skipped g++ syntax check (not available on Windows — use WSL or CI for native compilation)');
