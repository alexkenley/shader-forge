import fs from 'node:fs/promises';
import path from 'node:path';

export async function preparePackagingFixture(rootPath) {
  const runtimeDir = path.join(rootPath, 'build', 'runtime', 'bin');
  const cookedDir = path.join(rootPath, 'build', 'cooked');

  await fs.mkdir(path.join(rootPath, 'input'), { recursive: true });
  await fs.mkdir(path.join(rootPath, 'content', 'scenes'), { recursive: true });
  await fs.mkdir(path.join(rootPath, 'content', 'prefabs'), { recursive: true });
  await fs.mkdir(path.join(rootPath, 'content', 'data'), { recursive: true });
  await fs.mkdir(path.join(rootPath, 'content', 'effects'), { recursive: true });
  await fs.mkdir(path.join(rootPath, 'content', 'procgeo'), { recursive: true });
  await fs.mkdir(path.join(rootPath, 'audio'), { recursive: true });
  await fs.mkdir(path.join(rootPath, 'audio', 'sounds'), { recursive: true });
  await fs.mkdir(path.join(rootPath, 'audio', 'events'), { recursive: true });
  await fs.mkdir(path.join(rootPath, 'animation', 'skeletons'), { recursive: true });
  await fs.mkdir(path.join(rootPath, 'animation', 'clips'), { recursive: true });
  await fs.mkdir(path.join(rootPath, 'animation', 'graphs'), { recursive: true });
  await fs.mkdir(path.join(rootPath, 'physics'), { recursive: true });
  await fs.mkdir(path.join(rootPath, 'physics', 'materials'), { recursive: true });
  await fs.mkdir(path.join(rootPath, 'physics', 'bodies'), { recursive: true });
  await fs.mkdir(path.join(rootPath, 'data', 'foundation'), { recursive: true });
  await fs.mkdir(path.join(rootPath, 'tooling', 'layouts'), { recursive: true });
  await fs.mkdir(path.join(cookedDir, 'content', 'scenes'), { recursive: true });
  await fs.mkdir(path.join(cookedDir, 'audio', 'sounds'), { recursive: true });
  await fs.mkdir(runtimeDir, { recursive: true });

  await fs.writeFile(path.join(rootPath, 'input', 'actions.toml'), '[[action]]\nname = "runtime_exit"\n', 'utf8');
  await fs.writeFile(
    path.join(rootPath, 'content', 'scenes', 'sandbox.scene.toml'),
    [
      'schema = "shader_forge.scene"',
      'schema_version = 1',
      'name = "sandbox"',
      'owner_system = "scene_system"',
      'runtime_format = "flatbuffer"',
      'title = "Sandbox"',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(
    path.join(rootPath, 'audio', 'buses.toml'),
    [
      'schema = "shader_forge.audio_buses"',
      'schema_version = 1',
      '',
      '[bus.Master]',
      'display_name = "Master"',
      'parent = ""',
      'default_volume_db = 0.0',
      'default_muted = false',
      '',
      '[bus.Music]',
      'display_name = "Music"',
      'parent = "Master"',
      'default_volume_db = 0.0',
      'default_muted = false',
      '',
      '[bus.SFX]',
      'display_name = "SFX"',
      'parent = "Master"',
      'default_volume_db = 0.0',
      'default_muted = false',
      '',
      '[bus.Voice]',
      'display_name = "Voice"',
      'parent = "Master"',
      'default_volume_db = 0.0',
      'default_muted = false',
      '',
      '[bus.Ambience]',
      'display_name = "Ambience"',
      'parent = "Master"',
      'default_volume_db = 0.0',
      'default_muted = false',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(
    path.join(rootPath, 'animation', 'skeletons', 'debug_actor.skeleton.toml'),
    [
      'schema = "shader_forge.skeleton"',
      'schema_version = 1',
      'name = "debug_actor"',
      'owner_system = "animation_system"',
      'root_bone = "root"',
      'bone_count = 1',
      'bones = "root"',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(
    path.join(rootPath, 'physics', 'layers.toml'),
    [
      'schema = "shader_forge.physics_layers"',
      'schema_version = 1',
      '',
      '[layer.World_Static]',
      'display_name = "World Static"',
      'collides_with = "World_Dynamic, Query_Only"',
      'queryable = true',
      'static_only = true',
      '',
      '[layer.World_Dynamic]',
      'display_name = "World Dynamic"',
      'collides_with = "World_Static, World_Dynamic, Query_Only"',
      'queryable = true',
      'static_only = false',
      '',
      '[layer.Query_Only]',
      'display_name = "Query Only"',
      'collides_with = "World_Static, World_Dynamic"',
      'queryable = true',
      'static_only = false',
      '',
    ].join('\n'),
    'utf8',
  );
  await fs.writeFile(
    path.join(rootPath, 'data', 'foundation', 'engine-data-layout.toml'),
    'source_format = "toml"\nruntime_format = "flatbuffer"\ntooling_db_backend = "sqlite"\n',
    'utf8',
  );
  await fs.writeFile(
    path.join(rootPath, 'tooling', 'layouts', 'default.tooling-layout.toml'),
    'layout_name = "default"\noverlay_visible = true\n',
    'utf8',
  );
  await fs.writeFile(path.join(cookedDir, 'content', 'scenes', 'sandbox.bin'), 'cooked-scene', 'utf8');
  await fs.writeFile(path.join(cookedDir, 'audio', 'sounds', 'ui_confirm.bin'), 'cooked-sound', 'utf8');
  await fs.writeFile(
    path.join(cookedDir, 'asset-pipeline-report.json'),
    JSON.stringify(
      {
        bakedAssets: [
          {
            kind: 'scene',
            name: 'sandbox',
            cookedPath: 'build/cooked/content/scenes/sandbox.bin',
          },
        ],
        generatedMeshes: [],
        audio: {
          bakedSounds: [{ name: 'ui_confirm' }],
          bakedEvents: [],
        },
        animation: {
          bakedClips: [],
          bakedGraphs: [],
        },
        physics: {
          bakedBodies: [],
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  const unixRuntimePath = path.join(runtimeDir, 'shader_forge_runtime');
  await fs.writeFile(unixRuntimePath, '#!/usr/bin/env bash\necho packaged-runtime\n', 'utf8');
  await fs.chmod(unixRuntimePath, 0o755);
  await fs.writeFile(path.join(runtimeDir, 'shader_forge_runtime.exe'), 'packaged-runtime-exe\n', 'utf8');
}
