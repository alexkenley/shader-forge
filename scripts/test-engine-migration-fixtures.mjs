import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { repoRootFromScript } from './lib/harness-utils.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const cliPath = path.join(repoRoot, 'tools', 'engine-cli', 'shaderforge.mjs');
const migrationModulePath = path.join(repoRoot, 'tools', 'engine-cli', 'lib', 'migration-foundation.mjs');
const unityFixtureRoot = path.join(repoRoot, 'fixtures', 'migration', 'unity-minimal');
const unrealFixtureRoot = path.join(repoRoot, 'fixtures', 'migration', 'unreal-minimal');
const godotFixtureRoot = path.join(repoRoot, 'fixtures', 'migration', 'godot-minimal');
const tempRoot = path.join(repoRoot, 'tmp', 'migration-harness');

const cliSource = fs.readFileSync(cliPath, 'utf8');
const migrationSource = fs.readFileSync(migrationModulePath, 'utf8');
const unityVersionFile = fs.readFileSync(path.join(unityFixtureRoot, 'ProjectSettings', 'ProjectVersion.txt'), 'utf8');
const unrealProjectFile = fs.readFileSync(path.join(unrealFixtureRoot, 'ExampleProject.uproject'), 'utf8');
const godotProjectFile = fs.readFileSync(path.join(godotFixtureRoot, 'project.godot'), 'utf8');

assert.match(cliSource, /engine migrate detect/);
assert.match(cliSource, /engine migrate unity/);
assert.match(cliSource, /engine migrate report/);
assert.match(migrationSource, /shader_forge\.migration_manifest/);
assert.match(migrationSource, /shader_forge\.migration_report/);
assert.match(migrationSource, /detect_and_manifest_only/);
assert.match(unityVersionFile, /m_EditorVersion:/);
assert.match(unrealProjectFile, /EngineAssociation/);
assert.match(godotProjectFile, /config\/name/);

fs.rmSync(tempRoot, { recursive: true, force: true });
fs.mkdirSync(tempRoot, { recursive: true });

function runCli(args) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.error) {
    throw result.error;
  }
  assert.equal(result.status, 0, `Migration CLI failed.\nCommand: ${args.join(' ')}\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  return result;
}

const unityRun = runCli([
  'migrate',
  'detect',
  'fixtures/migration/unity-minimal',
  '--output-root',
  'tmp/migration-harness',
  '--run-id',
  'unity-detect',
]);
assert.match(unityRun.stdout, /Migration foundation run complete\./);
assert.match(unityRun.stdout, /Source engine: unity/);
assert.match(unityRun.stdout, /No content conversion was performed in this slice\./);

const unityReportRoot = path.join(tempRoot, 'unity-detect');
const unityManifestPath = path.join(unityReportRoot, 'migration-manifest.toml');
const unityReportPath = path.join(unityReportRoot, 'report.toml');
const unityWarningsPath = path.join(unityReportRoot, 'warnings.toml');
const unityScriptPortingReadmePath = path.join(unityReportRoot, 'script-porting', 'README.md');

assert.ok(fs.existsSync(unityManifestPath), 'Expected Unity migration manifest.');
assert.ok(fs.existsSync(unityReportPath), 'Expected Unity migration report.');
assert.ok(fs.existsSync(unityWarningsPath), 'Expected Unity warnings file.');
assert.ok(fs.existsSync(unityScriptPortingReadmePath), 'Expected script-porting placeholder.');

const unityManifest = fs.readFileSync(unityManifestPath, 'utf8');
const unityReport = fs.readFileSync(unityReportPath, 'utf8');
assert.match(unityManifest, /schema = "shader_forge\.migration_manifest"/);
assert.match(unityManifest, /detected_engine = "unity"/);
assert.match(unityManifest, /conversion_mode = "detect_and_manifest_only"/);
assert.match(unityManifest, /content_scenes = "content\/scenes\/migrated\/unity"/);
assert.match(unityReport, /schema = "shader_forge\.migration_report"/);
assert.match(unityReport, /current_slice = "foundation_detect_only"/);
assert.match(unityReport, /detection = "Supported"/);
assert.match(unityReport, /asset_conversion = "Manual"/);

const unrealRun = runCli([
  'migrate',
  'unreal',
  'fixtures/migration/unreal-minimal',
  '--output-root',
  'tmp/migration-harness',
  '--run-id',
  'unreal-lane',
]);
assert.match(unrealRun.stdout, /Source engine: unreal/);
const unrealManifest = fs.readFileSync(path.join(tempRoot, 'unreal-lane', 'migration-manifest.toml'), 'utf8');
assert.match(unrealManifest, /requested_engine = "unreal"/);
assert.match(unrealManifest, /detected_version = "5\.4"/);

const godotRun = runCli([
  'migrate',
  'godot',
  'fixtures/migration/godot-minimal',
  '--output-root',
  'tmp/migration-harness',
  '--run-id',
  'godot-lane',
]);
assert.match(godotRun.stdout, /Source engine: godot/);
const godotManifest = fs.readFileSync(path.join(tempRoot, 'godot-lane', 'migration-manifest.toml'), 'utf8');
assert.match(godotManifest, /requested_engine = "godot"/);
assert.match(godotManifest, /detected_version = "4\.2"/);

const reportRun = runCli([
  'migrate',
  'report',
  'tmp/migration-harness/unity-detect',
]);
assert.match(reportRun.stdout, /Migration report summary:/);
assert.match(reportRun.stdout, /Engine: unity/);
assert.match(reportRun.stdout, /Detection support: Supported/);

fs.rmSync(tempRoot, { recursive: true, force: true });

console.log('Engine migration fixtures harness passed.');
console.log(`- Verified migration fixtures under ${path.join(repoRoot, 'fixtures', 'migration')}`);
console.log(`- Verified CLI migration detect/report surfaces through ${cliPath}`);
console.log('- Verified normalized migration manifest, report, warnings, and script-porting placeholder outputs');
