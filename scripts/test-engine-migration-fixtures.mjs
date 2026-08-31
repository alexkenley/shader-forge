import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { bakeAssetPipeline } from '../tools/engine-cli/lib/asset-pipeline.mjs';
import { repoRootFromScript } from './lib/harness-utils.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const cliPath = path.join(repoRoot, 'tools', 'engine-cli', 'shaderforge.mjs');
const migrationModulePath = path.join(repoRoot, 'tools', 'engine-cli', 'lib', 'migration-foundation.mjs');
const unityFixtureRoot = path.join(repoRoot, 'fixtures', 'migration', 'unity-minimal');
const unrealFixtureRoot = path.join(repoRoot, 'fixtures', 'migration', 'unreal-minimal');
const unrealOfflineFixtureRoot = path.join(repoRoot, 'fixtures', 'migration', 'unreal-offline-minimal');
const godotFixtureRoot = path.join(repoRoot, 'fixtures', 'migration', 'godot-minimal');
const tempRoot = path.join(repoRoot, 'tmp', 'migration-harness');

const cliSource = fs.readFileSync(cliPath, 'utf8');
const migrationSource = fs.readFileSync(migrationModulePath, 'utf8');
const unityVersionFile = fs.readFileSync(path.join(unityFixtureRoot, 'ProjectSettings', 'ProjectVersion.txt'), 'utf8');
const unityBuildSettingsFile = fs.readFileSync(path.join(unityFixtureRoot, 'ProjectSettings', 'EditorBuildSettings.asset'), 'utf8');
const unrealProjectFile = fs.readFileSync(path.join(unrealFixtureRoot, 'ExampleProject.uproject'), 'utf8');
const unrealOfflineProjectFile = fs.readFileSync(path.join(unrealOfflineFixtureRoot, 'ExampleOfflineProject.uproject'), 'utf8');
const godotProjectFile = fs.readFileSync(path.join(godotFixtureRoot, 'project.godot'), 'utf8');

assert.match(cliSource, /engine migrate detect/);
assert.match(cliSource, /engine migrate unity/);
assert.match(cliSource, /engine migrate report/);
assert.match(migrationSource, /shader_forge\.migration_manifest/);
assert.match(migrationSource, /shader_forge\.migration_report/);
assert.match(migrationSource, /detect_and_manifest_only/);
assert.match(migrationSource, /project_skeleton_conversion/);
assert.match(unityVersionFile, /m_EditorVersion:/);
assert.match(unityBuildSettingsFile, /enabled: 0[\s\S]*path: Assets\/Scenes\/Disabled\.unity/);
assert.match(unityBuildSettingsFile, /path: Assets\/Scenes\/Sandbox\.unity/);
assert.match(unrealProjectFile, /EngineAssociation/);
assert.match(unrealOfflineProjectFile, /EngineAssociation/);
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

async function assertMigratedProjectBakes(projectRoot, engine, label, expectedData = true) {
  const contentRoot = path.join(tempRoot, 'bake-input', label);
  for (const kind of ['scenes', 'prefabs', 'data', 'effects', 'procgeo']) {
    const targetDirectory = path.join(contentRoot, kind);
    fs.mkdirSync(targetDirectory, { recursive: true });
    const sourceDirectory = path.join(projectRoot, 'content', kind, 'migrated', engine);
    if (!fs.existsSync(sourceDirectory)) {
      continue;
    }
    for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
      if (entry.isFile()) {
        fs.copyFileSync(path.join(sourceDirectory, entry.name), path.join(targetDirectory, entry.name));
      }
    }
  }

  const outputRoot = path.join(tempRoot, 'bake-output', label);
  const report = await bakeAssetPipeline({
    repoRoot,
    contentRoot,
    audioRoot: path.join(repoRoot, 'audio'),
    animationRoot: path.join(repoRoot, 'animation'),
    physicsRoot: path.join(repoRoot, 'physics'),
    foundationPath: path.join(repoRoot, 'data', 'foundation', 'engine-data-layout.toml'),
    outputRoot,
    reportPath: path.join(outputRoot, 'asset-pipeline-report.json'),
  });
  assert.equal(report.invalidAssets.length, 0, `${label} migration outputs must pass the production asset bake.`);
  assert.ok(report.bakedAssets.some((asset) => asset.kind === 'scene'), `${label} bake must include a scene.`);
  assert.ok(report.bakedAssets.some((asset) => asset.kind === 'prefab'), `${label} bake must include a prefab.`);
  assert.equal(report.bakedAssets.some((asset) => asset.kind === 'data'), expectedData, `${label} bootstrap bake mismatch.`);
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

const unityConvertRun = runCli([
  'migrate',
  'unity',
  'fixtures/migration/unity-minimal',
  '--output-root',
  'tmp/migration-harness',
  '--run-id',
  'unity-convert',
]);
assert.match(unityConvertRun.stdout, /Migration conversion run complete\./);
assert.match(unityConvertRun.stdout, /Source engine: unity/);
assert.match(unityConvertRun.stdout, /Target project root:/);
assert.match(unityConvertRun.stdout, /first-pass Shader Forge project skeleton was generated/i);
assert.match(unityConvertRun.stdout, /Mapped scene entities: 3/);
assert.match(unityConvertRun.stdout, /Mapped prefab components: 2/);
assert.match(unityConvertRun.stdout, /Mapped script bindings: 1/);

const unityConvertRoot = path.join(tempRoot, 'unity-convert');
const unityProjectRoot = path.join(unityConvertRoot, 'shader-forge-project');
const unityScenePath = path.join(unityProjectRoot, 'content', 'scenes', 'migrated', 'unity', 'sandbox.scene.toml');
const unityPrefabPath = path.join(unityProjectRoot, 'content', 'prefabs', 'migrated', 'unity', 'player.prefab.toml');
const unityRootPrefabPath = path.join(unityProjectRoot, 'content', 'prefabs', 'migrated', 'unity', 'sandbox_root.prefab.toml');
const unityPlayerPrefabPath = path.join(unityProjectRoot, 'content', 'prefabs', 'migrated', 'unity', 'sandbox_sandbox_root_player.prefab.toml');
const unityCameraPrefabPath = path.join(unityProjectRoot, 'content', 'prefabs', 'migrated', 'unity', 'sandbox_sandbox_root_player_camera.prefab.toml');
const unityDataPath = path.join(unityProjectRoot, 'content', 'data', 'migrated', 'unity', 'runtime_bootstrap.data.toml');
assert.ok(fs.existsSync(unityScenePath), 'Expected Unity migrated scene output.');
assert.ok(fs.existsSync(unityPrefabPath), 'Expected Unity migrated prefab output.');
assert.ok(fs.existsSync(unityRootPrefabPath), 'Expected Unity scene-root prefab output.');
assert.ok(fs.existsSync(unityPlayerPrefabPath), 'Expected Unity child GameObject prefab output.');
assert.ok(fs.existsSync(unityCameraPrefabPath), 'Expected Unity Camera prefab output.');
assert.ok(fs.existsSync(unityDataPath), 'Expected Unity migrated bootstrap data output.');
const unityScene = fs.readFileSync(unityScenePath, 'utf8');
assert.match(unityScene, /primary_prefab = "sandbox_root"/);
assert.match(unityScene, /# migration_source_object_id = "2"[\s\S]*\[entity\.sandbox_sandbox_root_player_instance\]/);
assert.match(unityScene, /\[entity\.sandbox_sandbox_root_player_instance\][\s\S]*parent = "sandbox_root_instance"[\s\S]*position = "1, 0\.5, -2"[\s\S]*rotation = "0, 90, 0"/);
assert.match(unityScene, /\[entity\.sandbox_sandbox_root_player_camera_instance\][\s\S]*parent = "sandbox_sandbox_root_player_instance"[\s\S]*position = "0, 1\.6, 3"/);
assert.match(fs.readFileSync(unityPrefabPath, 'utf8'), /category = "migrated_unity"/);
assert.match(
  fs.readFileSync(unityPlayerPrefabPath, 'utf8'),
  /# migration_source_node = "SandboxRoot\/Player"[\s\S]*# migration_source_object_id = "2"[\s\S]*# migration_source_box_collider_component_id = "8"[\s\S]*\[component\.collision\][\s\S]*shape = "box"[\s\S]*center = \[0, 0\.9, 0\][\s\S]*rotation = \[0, 0, 0, 1\][\s\S]*dimensions = \[0\.8, 1\.8, 0\.6\]/,
);
assert.match(
  fs.readFileSync(unityCameraPrefabPath, 'utf8'),
  /# migration_source_camera_component_id = "7"[\s\S]*spawn_tag = "unity_camera"[\s\S]*\[component\.camera\][\s\S]*vertical_fov_degrees = 60[\s\S]*near_meters = 0\.3[\s\S]*far_meters = 500/,
);
assert.match(fs.readFileSync(unityDataPath, 'utf8'), /default_scene = "sandbox"/);
assert.ok(
  fs.readdirSync(path.join(unityConvertRoot, 'script-porting')).some((name) => name.endsWith('.port.toml')),
  'Expected Unity script-porting manifest.',
);
const unityScriptBindingPath = path.join(unityConvertRoot, 'script-porting', 'playercontroller_sandbox_2_9.port.toml');
assert.ok(fs.existsSync(unityScriptBindingPath), 'Expected Unity MonoBehaviour scene-binding manifest.');
const unityScriptBinding = fs.readFileSync(unityScriptBindingPath, 'utf8');
assert.match(unityScriptBinding, /source_path = "fixtures\/migration\/unity-minimal\/Assets\/Scripts\/PlayerController\.cs"/);
assert.match(unityScriptBinding, /source_kind = "scene_mono_behaviour_binding"/);
assert.match(unityScriptBinding, /source_guid = "0123456789abcdef0123456789abcdef"/);
assert.match(unityScriptBinding, /source_scene = "Assets\/Scenes\/Sandbox\.unity"/);
assert.match(unityScriptBinding, /source_node = "SandboxRoot\/Player"/);
assert.match(unityScriptBinding, /source_object_id = "2"/);
assert.match(unityScriptBinding, /source_component_id = "9"/);
assert.match(unityScriptBinding, /extraction_confidence = "high"/);
const unityConvertReport = fs.readFileSync(path.join(unityConvertRoot, 'report.toml'), 'utf8');
const unityConvertManifest = fs.readFileSync(path.join(unityConvertRoot, 'migration-manifest.toml'), 'utf8');
assert.match(unityConvertReport, /current_slice = "project_skeleton_conversion"/);
assert.match(unityConvertReport, /asset_conversion = "Manual"/);
assert.match(unityConvertReport, /scene_conversion = "BestEffort"/);
assert.match(unityConvertReport, /converted_items = 6/);
assert.match(unityConvertReport, /mapped_scene_entities = 3/);
assert.match(unityConvertReport, /mapped_prefab_components = 2/);
assert.match(unityConvertReport, /mapped_script_bindings = 1/);
assert.match(unityConvertReport, /converted_project_settings = 1/);
assert.match(unityConvertReport, /\[startup_scene\][\s\S]*source_file = "ProjectSettings\/EditorBuildSettings\.asset"/);
assert.match(unityConvertReport, /\[startup_scene\][\s\S]*resolved_source_path = "Assets\/Scenes\/Sandbox\.unity"/);
assert.match(unityConvertReport, /\[startup_scene\][\s\S]*status = "converted"/);
assert.match(unityConvertManifest, /\[startup_scene\][\s\S]*target_value = "sandbox"/);
assert.match(unityConvertManifest, /mapped_scene_entities = 3/);
assert.match(unityConvertManifest, /mapped_prefab_components = 2/);
assert.match(unityConvertManifest, /mapped_script_bindings = 1/);
await assertMigratedProjectBakes(unityProjectRoot, 'unity', 'unity-convert');

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
assert.match(unrealRun.stdout, /Migration conversion run complete\./);
assert.match(unrealRun.stdout, /Active lane: unreal_offline_fallback/);
assert.match(unrealRun.stdout, /Conversion confidence: low/);
const unrealRoot = path.join(tempRoot, 'unreal-lane');
const unrealManifest = fs.readFileSync(path.join(unrealRoot, 'migration-manifest.toml'), 'utf8');
assert.match(unrealManifest, /requested_engine = "unreal"/);
assert.match(unrealManifest, /detected_version = "5\.4"/);
assert.match(unrealManifest, /conversion_mode = "unreal_offline_fallback_conversion"/);
assert.match(unrealManifest, /\[migration_lane\]/);
assert.match(unrealManifest, /active = "unreal_offline_fallback"/);
assert.match(unrealManifest, /preferred = "unreal_exporter_assisted"/);
assert.match(fs.readFileSync(path.join(unrealRoot, 'report.toml'), 'utf8'), /current_slice = "unreal_offline_fallback"/);
assert.match(unrealManifest, /\[startup_scene\][\s\S]*source_value = "\/Game\/Maps\/TestMap"/);
assert.match(unrealManifest, /\[startup_scene\][\s\S]*resolved_source_path = "Content\/Maps\/TestMap\.umap"/);
assert.match(unrealManifest, /\[startup_scene\][\s\S]*status = "converted"/);
assert.ok(
  fs.readdirSync(path.join(unrealRoot, 'shader-forge-project', 'content', 'scenes', 'migrated', 'unreal')).some((name) => name.endsWith('.scene.toml')),
  'Expected Unreal migrated scene output.',
);
assert.ok(
  fs.readdirSync(path.join(unrealRoot, 'shader-forge-project', 'content', 'prefabs', 'migrated', 'unreal')).some((name) => name.endsWith('.prefab.toml')),
  'Expected Unreal migrated prefab output.',
);
assert.match(
  fs.readFileSync(path.join(unrealRoot, 'shader-forge-project', 'content', 'data', 'migrated', 'unreal', 'runtime_bootstrap.data.toml'), 'utf8'),
  /default_scene = "testmap"/,
);
await assertMigratedProjectBakes(path.join(unrealRoot, 'shader-forge-project'), 'unreal', 'unreal-lane');

const unrealOfflineRun = runCli([
  'migrate',
  'unreal',
  'fixtures/migration/unreal-offline-minimal',
  '--output-root',
  'tmp/migration-harness',
  '--run-id',
  'unreal-offline-lane',
]);
assert.match(unrealOfflineRun.stdout, /Source engine: unreal/);
assert.match(unrealOfflineRun.stdout, /Active lane: unreal_offline_fallback/);
const unrealOfflineRoot = path.join(tempRoot, 'unreal-offline-lane');
const unrealOfflineManifest = fs.readFileSync(path.join(unrealOfflineRoot, 'migration-manifest.toml'), 'utf8');
const unrealOfflineReport = fs.readFileSync(path.join(unrealOfflineRoot, 'report.toml'), 'utf8');
const unrealOfflineBlueprintPortPath = path.join(unrealOfflineRoot, 'script-porting', 'bp_playerpawn.port.toml');
assert.match(unrealOfflineManifest, /detected_version = "5\.3"/);
assert.match(unrealOfflineManifest, /conversion_mode = "unreal_offline_fallback_conversion"/);
assert.match(unrealOfflineManifest, /blueprint_package_files = 3/);
assert.match(unrealOfflineReport, /current_slice = "unreal_offline_fallback"/);
assert.match(unrealOfflineReport, /converted_items = 4/);
assert.match(unrealOfflineReport, /approximated_items = 3/);
assert.match(unrealOfflineManifest, /\[startup_scene\][\s\S]*source_value = "\/Game\/Maps\/offline_fallback"/);
assert.match(unrealOfflineManifest, /\[startup_scene\][\s\S]*status = "converted"/);
assert.ok(
  fs.existsSync(path.join(unrealOfflineRoot, 'shader-forge-project', 'content', 'prefabs', 'migrated', 'unreal', 'bp_playerpawn.prefab.toml')),
  'Expected Unreal offline fallback prefab output for BP_PlayerPawn.',
);
assert.ok(
  fs.existsSync(path.join(unrealOfflineRoot, 'shader-forge-project', 'content', 'prefabs', 'migrated', 'unreal', 'bp_door.prefab.toml')),
  'Expected Unreal offline fallback prefab output for BP_Door.',
);
assert.ok(fs.existsSync(unrealOfflineBlueprintPortPath), 'Expected offline Blueprint script-porting manifest.');
assert.match(fs.readFileSync(unrealOfflineBlueprintPortPath, 'utf8'), /strategy = "offline_low_confidence_blueprint_manifest"/);
assert.match(fs.readFileSync(unrealOfflineBlueprintPortPath, 'utf8'), /extraction_confidence = "low"/);
assert.match(
  fs.readFileSync(path.join(unrealOfflineRoot, 'shader-forge-project', 'content', 'data', 'migrated', 'unreal', 'runtime_bootstrap.data.toml'), 'utf8'),
  /default_scene = "offline_fallback"/,
);
await assertMigratedProjectBakes(path.join(unrealOfflineRoot, 'shader-forge-project'), 'unreal', 'unreal-offline-lane');

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
assert.match(godotRun.stdout, /Migration conversion run complete\./);
assert.match(godotRun.stdout, /Mapped scene entities: 4/);
assert.match(godotRun.stdout, /Mapped prefab components: 2/);
assert.match(godotRun.stdout, /Mapped script bindings: 1/);
const godotRoot = path.join(tempRoot, 'godot-lane');
const godotManifest = fs.readFileSync(path.join(godotRoot, 'migration-manifest.toml'), 'utf8');
const godotReport = fs.readFileSync(path.join(godotRoot, 'report.toml'), 'utf8');
const godotScene = fs.readFileSync(
  path.join(godotRoot, 'shader-forge-project', 'content', 'scenes', 'migrated', 'godot', 'main.scene.toml'),
  'utf8',
);
assert.match(godotManifest, /requested_engine = "godot"/);
assert.match(godotManifest, /detected_version = "4\.2"/);
assert.match(godotManifest, /conversion_mode = "project_skeleton_conversion"/);
assert.match(godotManifest, /\[startup_scene\][\s\S]*source_value = "res:\/\/scenes\/main\.tscn"/);
assert.match(godotManifest, /\[startup_scene\][\s\S]*resolved_source_path = "scenes\/main\.tscn"/);
assert.match(godotManifest, /\[startup_scene\][\s\S]*status = "converted"/);
assert.match(godotManifest, /mapped_scene_entities = 4/);
assert.match(godotReport, /mapped_scene_entities = 4/);
assert.match(godotManifest, /mapped_prefab_components = 2/);
assert.match(godotReport, /mapped_prefab_components = 2/);
assert.match(godotManifest, /mapped_script_bindings = 1/);
assert.match(godotReport, /mapped_script_bindings = 1/);
assert.match(godotScene, /# migration_source_node = "Main\/Player"[\s\S]*\[entity\.main_main_player_instance\]/);
assert.match(godotScene, /\[entity\.main_main_player_instance\][\s\S]*parent = "main_root_instance"/);
assert.match(godotScene, /\[entity\.main_main_player_instance\][\s\S]*position = "1, 0\.5, -2"/);
assert.match(godotScene, /\[entity\.main_main_player_instance\][\s\S]*rotation = "0, 90, 0"/);
assert.match(godotScene, /\[entity\.main_main_player_camera_instance\][\s\S]*parent = "main_main_player_instance"/);
assert.match(godotScene, /\[entity\.main_main_player_camera_instance\][\s\S]*position = "0, 1\.6, 3"/);
assert.match(godotScene, /\[entity\.main_main_player_collider_instance\][\s\S]*parent = "main_main_player_instance"[\s\S]*position = "0, 0\.9, 0"/);
assert.ok(
  fs.readdirSync(path.join(godotRoot, 'shader-forge-project', 'content', 'scenes', 'migrated', 'godot')).some((name) => name.endsWith('.scene.toml')),
  'Expected Godot migrated scene output.',
);
assert.ok(
  fs.readdirSync(path.join(godotRoot, 'shader-forge-project', 'content', 'prefabs', 'migrated', 'godot')).some((name) => name.endsWith('.prefab.toml')),
  'Expected Godot migrated prefab output.',
);
assert.match(
  fs.readFileSync(path.join(godotRoot, 'shader-forge-project', 'content', 'prefabs', 'migrated', 'godot', 'main_main_player.prefab.toml'), 'utf8'),
  /# migration_source_type = "CharacterBody3D"[\s\S]*spawn_tag = "characterbody3d"/,
);
assert.match(
  fs.readFileSync(path.join(godotRoot, 'shader-forge-project', 'content', 'prefabs', 'migrated', 'godot', 'main_main_player_camera.prefab.toml'), 'utf8'),
  /# migration_source_type = "Camera3D"[\s\S]*spawn_tag = "camera3d"[\s\S]*\[component\.camera\][\s\S]*vertical_fov_degrees = 75[\s\S]*near_meters = 0\.05[\s\S]*far_meters = 4000/,
);
assert.match(
  fs.readFileSync(path.join(godotRoot, 'shader-forge-project', 'content', 'prefabs', 'migrated', 'godot', 'main_main_player_collider.prefab.toml'), 'utf8'),
  /# migration_source_type = "CollisionShape3D"[\s\S]*# migration_source_collision_resource_id = "BoxShape3D_player"[\s\S]*spawn_tag = "collisionshape3d"[\s\S]*\[component\.collision\][\s\S]*center = \[0, 0, 0\][\s\S]*dimensions = \[0\.8, 1\.8, 0\.6\]/,
);
assert.match(
  fs.readFileSync(path.join(godotRoot, 'shader-forge-project', 'content', 'data', 'migrated', 'godot', 'runtime_bootstrap.data.toml'), 'utf8'),
  /default_scene = "main"/,
);
const godotScriptBindingPath = path.join(godotRoot, 'script-porting', 'player_main_main_player.port.toml');
assert.ok(fs.existsSync(godotScriptBindingPath), 'Expected Godot node script-binding manifest.');
const godotScriptBinding = fs.readFileSync(godotScriptBindingPath, 'utf8');
assert.match(godotScriptBinding, /source_path = "fixtures\/migration\/godot-minimal\/scripts\/player\.gd"/);
assert.match(godotScriptBinding, /source_kind = "scene_script_binding"/);
assert.match(godotScriptBinding, /source_scene = "scenes\/main\.tscn"/);
assert.match(godotScriptBinding, /source_node = "Main\/Player"/);
assert.match(godotScriptBinding, /source_resource_id = "1_player"/);
assert.match(godotScriptBinding, /source_resource_path = "scripts\/player\.gd"/);
assert.match(godotScriptBinding, /extraction_confidence = "high"/);
await assertMigratedProjectBakes(path.join(godotRoot, 'shader-forge-project'), 'godot', 'godot-lane');

const unsafeGodotScriptFixtureRoot = path.join(tempRoot, 'source-fixtures', 'godot-unsafe-script-path');
fs.cpSync(godotFixtureRoot, unsafeGodotScriptFixtureRoot, { recursive: true });
const unsafeGodotScenePath = path.join(unsafeGodotScriptFixtureRoot, 'scenes', 'main.tscn');
fs.writeFileSync(
  unsafeGodotScenePath,
  fs.readFileSync(unsafeGodotScenePath, 'utf8').replace('res://scripts/player.gd', 'res://../outside.gd'),
  'utf8',
);
const unsafeGodotScriptRun = runCli([
  'migrate',
  'godot',
  unsafeGodotScriptFixtureRoot,
  '--output-root',
  tempRoot,
  '--run-id',
  'godot-unsafe-script-path',
]);
assert.match(unsafeGodotScriptRun.stdout, /Mapped script bindings: 0/);
assert.equal(
  fs.existsSync(path.join(tempRoot, 'godot-unsafe-script-path', 'script-porting', 'outside_main_main_player.port.toml')),
  false,
  'Unsafe Godot script paths must not emit node binding manifests.',
);

const collidingGodotFixtureRoot = path.join(tempRoot, 'source-fixtures', 'godot-colliding-node-names');
fs.cpSync(godotFixtureRoot, collidingGodotFixtureRoot, { recursive: true });
fs.writeFileSync(path.join(collidingGodotFixtureRoot, 'scenes', 'binary.scn'), Buffer.from([0x47, 0x44, 0x53, 0x43, 0x00]));
const collidingGodotScenePath = path.join(collidingGodotFixtureRoot, 'scenes', 'main.tscn');
fs.appendFileSync(
  collidingGodotScenePath,
  [
    '',
    '[node name="Marker-A" type="Marker3D" parent="."]',
    '',
    '[node name="Marker_A" type="Marker3D" parent="."]',
    '',
  ].join('\n'),
  'utf8',
);
runCli([
  'migrate',
  'godot',
  collidingGodotFixtureRoot,
  '--output-root',
  tempRoot,
  '--run-id',
  'godot-colliding-node-names',
]);
const collidingGodotRoot = path.join(tempRoot, 'godot-colliding-node-names');
const collidingGodotProjectRoot = path.join(collidingGodotRoot, 'shader-forge-project');
const collidingGodotPrefabNames = fs.readdirSync(
  path.join(collidingGodotProjectRoot, 'content', 'prefabs', 'migrated', 'godot'),
).filter((name) => name.startsWith('main_main_marker_a'));
const collidingGodotScene = fs.readFileSync(
  path.join(collidingGodotProjectRoot, 'content', 'scenes', 'migrated', 'godot', 'main.scene.toml'),
  'utf8',
);
const collidingGodotEntityIds = [...collidingGodotScene.matchAll(/^\[entity\.(main_main_marker_a[^\]]*_instance)\]$/gm)]
  .map((match) => match[1]);
assert.equal(collidingGodotPrefabNames.length, 2, 'Normalized Godot node-name collisions must retain both prefabs.');
assert.equal(collidingGodotEntityIds.length, 2, 'Normalized Godot node-name collisions must retain both entities.');
assert.equal(new Set(collidingGodotEntityIds).size, 2, 'Colliding Godot node names must receive distinct deterministic entity ids.');
assert.match(fs.readFileSync(path.join(collidingGodotRoot, 'migration-manifest.toml'), 'utf8'), /mapped_scene_entities = 6/);
assert.ok(
  fs.existsSync(path.join(collidingGodotProjectRoot, 'content', 'scenes', 'migrated', 'godot', 'binary.scene.toml')),
  'Binary Godot scenes must retain the existing reviewable placeholder without inflating mapped entity coverage.',
);
await assertMigratedProjectBakes(collidingGodotProjectRoot, 'godot', 'godot-colliding-node-names');

const duplicateUnityFixtureRoot = path.join(tempRoot, 'source-fixtures', 'unity-duplicate-scenes');
fs.cpSync(unityFixtureRoot, duplicateUnityFixtureRoot, { recursive: true });
const duplicateUnityScenePath = path.join(duplicateUnityFixtureRoot, 'Assets', 'Bonus', 'Sandbox.unity');
fs.mkdirSync(path.dirname(duplicateUnityScenePath), { recursive: true });
fs.writeFileSync(duplicateUnityScenePath, '%YAML 1.1\n--- !u!1 &1\nGameObject:\n  m_Name: BonusSandbox\n', 'utf8');
fs.writeFileSync(
  path.join(duplicateUnityFixtureRoot, 'ProjectSettings', 'EditorBuildSettings.asset'),
  [
    '%YAML 1.1',
    '--- !u!1045 &1',
    'EditorBuildSettings:',
    '  m_Scenes:',
    '  - enabled: 1',
    '    path: Assets/Bonus/Sandbox.unity',
    '    guid: 22222222222222222222222222222222',
    '  - enabled: 1',
    '    path: Assets/Scenes/Sandbox.unity',
    '    guid: 11111111111111111111111111111111',
    '',
  ].join('\n'),
  'utf8',
);
runCli([
  'migrate',
  'unity',
  duplicateUnityFixtureRoot,
  '--output-root',
  tempRoot,
  '--run-id',
  'unity-duplicate-scenes',
]);
const duplicateUnityRoot = path.join(tempRoot, 'unity-duplicate-scenes');
const duplicateUnityProjectRoot = path.join(duplicateUnityRoot, 'shader-forge-project');
const duplicateUnitySceneDirectory = path.join(duplicateUnityProjectRoot, 'content', 'scenes', 'migrated', 'unity');
const duplicateUnitySceneFiles = fs.readdirSync(duplicateUnitySceneDirectory).filter((name) => name.endsWith('.scene.toml'));
assert.equal(duplicateUnitySceneFiles.length, 2, 'Duplicate Unity scene basenames must both be retained.');
assert.equal(new Set(duplicateUnitySceneFiles).size, 2, 'Duplicate Unity scene basenames must receive distinct deterministic target names.');
const selectedDuplicateScene = duplicateUnitySceneFiles
  .map((name) => ({ name, content: fs.readFileSync(path.join(duplicateUnitySceneDirectory, name), 'utf8') }))
  .find((scene) => /title = "BonusSandbox"/.test(scene.content));
assert.ok(selectedDuplicateScene, 'Expected the explicitly selected duplicate Unity scene output.');
const selectedDuplicateSceneName = selectedDuplicateScene.content.match(/^name = "([^"]+)"/m)?.[1];
assert.ok(selectedDuplicateSceneName, 'Expected a stable target name for the selected duplicate scene.');
assert.match(
  fs.readFileSync(path.join(duplicateUnityProjectRoot, 'content', 'data', 'migrated', 'unity', 'runtime_bootstrap.data.toml'), 'utf8'),
  new RegExp(`default_scene = "${selectedDuplicateSceneName}"`),
);
const duplicateUnityManifest = fs.readFileSync(path.join(duplicateUnityRoot, 'migration-manifest.toml'), 'utf8');
assert.match(duplicateUnityManifest, /\[startup_scene\][\s\S]*resolved_source_path = "Assets\/Bonus\/Sandbox\.unity"/);
assert.match(duplicateUnityManifest, /\[startup_scene\][\s\S]*status = "converted"/);
await assertMigratedProjectBakes(duplicateUnityProjectRoot, 'unity', 'unity-duplicate-scenes');

const unresolvedGodotFixtureRoot = path.join(tempRoot, 'source-fixtures', 'godot-unresolved-startup');
fs.cpSync(godotFixtureRoot, unresolvedGodotFixtureRoot, { recursive: true });
const unresolvedGodotProjectPath = path.join(unresolvedGodotFixtureRoot, 'project.godot');
fs.writeFileSync(
  unresolvedGodotProjectPath,
  fs.readFileSync(unresolvedGodotProjectPath, 'utf8').replace('res://scenes/main.tscn', 'res://scenes/missing.tscn'),
  'utf8',
);
runCli([
  'migrate',
  'godot',
  unresolvedGodotFixtureRoot,
  '--output-root',
  tempRoot,
  '--run-id',
  'godot-unresolved-startup',
]);
const unresolvedGodotRoot = path.join(tempRoot, 'godot-unresolved-startup');
const unresolvedGodotProjectRoot = path.join(unresolvedGodotRoot, 'shader-forge-project');
assert.ok(
  !fs.existsSync(path.join(unresolvedGodotProjectRoot, 'content', 'data', 'migrated', 'godot', 'runtime_bootstrap.data.toml')),
  'An explicit unresolved startup scene must not produce an incorrect bootstrap.',
);
const unresolvedGodotManifest = fs.readFileSync(path.join(unresolvedGodotRoot, 'migration-manifest.toml'), 'utf8');
const unresolvedGodotReport = fs.readFileSync(path.join(unresolvedGodotRoot, 'report.toml'), 'utf8');
const unresolvedGodotWarnings = fs.readFileSync(path.join(unresolvedGodotRoot, 'warnings.toml'), 'utf8');
assert.match(unresolvedGodotManifest, /skipped_project_settings = 1/);
assert.match(unresolvedGodotManifest, /\[startup_scene\][\s\S]*source_value = "res:\/\/scenes\/missing\.tscn"/);
assert.match(unresolvedGodotManifest, /\[startup_scene\][\s\S]*target_value = ""/);
assert.match(unresolvedGodotManifest, /\[startup_scene\][\s\S]*status = "skipped"/);
assert.match(unresolvedGodotReport, /Resolve the declared startup scene res:\/\/scenes\/missing\.tscn/);
assert.match(unresolvedGodotWarnings, /No runtime bootstrap was generated/);
await assertMigratedProjectBakes(unresolvedGodotProjectRoot, 'godot', 'godot-unresolved-startup', false);

const fallbackGodotFixtureRoot = path.join(tempRoot, 'source-fixtures', 'godot-no-startup');
fs.cpSync(godotFixtureRoot, fallbackGodotFixtureRoot, { recursive: true });
const fallbackGodotProjectPath = path.join(fallbackGodotFixtureRoot, 'project.godot');
fs.writeFileSync(
  fallbackGodotProjectPath,
  fs.readFileSync(fallbackGodotProjectPath, 'utf8').replace(/^run\/main_scene=.*\r?\n/m, ''),
  'utf8',
);
runCli([
  'migrate',
  'godot',
  fallbackGodotFixtureRoot,
  '--output-root',
  tempRoot,
  '--run-id',
  'godot-no-startup',
]);
const fallbackGodotRoot = path.join(tempRoot, 'godot-no-startup');
const fallbackGodotProjectRoot = path.join(fallbackGodotRoot, 'shader-forge-project');
const fallbackGodotManifest = fs.readFileSync(path.join(fallbackGodotRoot, 'migration-manifest.toml'), 'utf8');
assert.match(fallbackGodotManifest, /approximated_project_settings = 1/);
assert.match(fallbackGodotManifest, /\[startup_scene\][\s\S]*source_value = ""/);
assert.match(fallbackGodotManifest, /\[startup_scene\][\s\S]*target_value = "main"/);
assert.match(fallbackGodotManifest, /\[startup_scene\][\s\S]*status = "approximated"/);
assert.match(
  fs.readFileSync(path.join(fallbackGodotProjectRoot, 'content', 'data', 'migrated', 'godot', 'runtime_bootstrap.data.toml'), 'utf8'),
  /default_scene = "main"/,
);
await assertMigratedProjectBakes(fallbackGodotProjectRoot, 'godot', 'godot-no-startup');

const reportRun = runCli([
  'migrate',
  'report',
  'tmp/migration-harness/unity-convert',
]);
assert.match(reportRun.stdout, /Migration report summary:/);
assert.match(reportRun.stdout, /Engine: unity/);
assert.match(reportRun.stdout, /Detection support: Supported/);
assert.match(reportRun.stdout, /Active lane: unity_project_skeleton/);
assert.match(reportRun.stdout, /Target project root:/);
assert.match(reportRun.stdout, /Converted items: 6/);
assert.match(reportRun.stdout, /Mapped scene entities: 3/);
assert.match(reportRun.stdout, /Mapped prefab components: 2/);
assert.match(reportRun.stdout, /Mapped script bindings: 1/);

fs.rmSync(tempRoot, { recursive: true, force: true });

console.log('Engine migration fixtures harness passed.');
console.log(`- Verified migration fixtures under ${path.join(repoRoot, 'fixtures', 'migration')}`);
console.log(`- Verified CLI migration detect/report surfaces through ${cliPath}`);
console.log('- Verified normalized migration outputs, Unity/Godot hierarchy, transforms, component/script provenance, and both Unreal conversion lanes');
