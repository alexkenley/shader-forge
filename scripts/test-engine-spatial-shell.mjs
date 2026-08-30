import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRootFromScript } from './lib/harness-utils.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const helperPath = path.join(repoRoot, 'shell', 'engine-shell', 'src', 'spatial-attachment-authoring.ts');
const viewPath = path.join(repoRoot, 'shell', 'engine-shell', 'src', 'SpatialAttachmentEditorView.tsx');
const appPath = path.join(repoRoot, 'shell', 'engine-shell', 'src', 'App.tsx');
const clientPath = path.join(repoRoot, 'shell', 'engine-shell', 'src', 'lib', 'sessiond.ts');
const stylesPath = path.join(repoRoot, 'shell', 'engine-shell', 'src', 'styles.css');
const typescriptPath = path.join(repoRoot, 'shell', 'engine-shell', 'node_modules', 'typescript', 'lib', 'typescript.js');

const [helperSource, viewSource, appSource, clientSource, stylesSource] = await Promise.all([
  fs.readFile(helperPath, 'utf8'),
  fs.readFile(viewPath, 'utf8'),
  fs.readFile(appPath, 'utf8'),
  fs.readFile(clientPath, 'utf8'),
  fs.readFile(stylesPath, 'utf8'),
]);
const ts = await import(pathToFileURL(typescriptPath).href);
const compiled = ts.transpileModule(helperSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const helper = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const source = [
  'schema = "shader_forge.attachment_profile"',
  'schema_version = 1',
  'id = "weapon.rifle" # identity stays',
  'name = "Rifle"',
  'skeleton = "humanoid.standard"',
  'item_prefab = "weapon.rifle.prefab"',
  '',
  '[primary_grip]',
  'socket = "socket.hand_r.primary"',
  'space = "socket"',
  'translation = [0.0, -0.015, 0.02] # preserve comment',
  'rotation = [0.0, 0.0, 0.0, 1.0]',
  '',
  '[secondary_hand.target]',
  'translation = [8, 9, 10]',
  'rotation = [0, 0, 0, 1]',
  '',
].join('\r\n');

const parsed = helper.parseSpatialAttachment(source);
assert.equal(parsed.id, 'weapon.rifle');
assert.equal(parsed.skeleton, 'humanoid.standard');
assert.equal(parsed.socket, 'socket.hand_r.primary');
assert.deepEqual(parsed.translation, [0, -0.015, 0.02]);
assert.deepEqual(parsed.rotationDegrees, [0, 0, 0]);

const candidate = helper.updateSpatialAttachmentTransform(source, [0.01, -0.02, 0.03], [10, 20, 30]);
assert.match(candidate, /translation = \[0\.01, -0\.02, 0\.03\] # preserve comment/);
assert.match(candidate, /rotation = \[-?0\.038135, 0\.189308, 0\.239298, 0\.951549\]/);
const quaternion = /\[primary_grip\][\s\S]*?rotation = \[([^\]]+)\]/.exec(candidate)[1]
  .split(',')
  .map((value) => Number(value.trim()));
assert.ok(Math.abs(Math.hypot(...quaternion) - 1) < 0.000001, 'written quaternion must stay unit length');
assert.ok(quaternion[3] >= 0, 'written quaternion must use canonical non-negative w');
assert.match(candidate, /\[secondary_hand\.target\]\r\ntranslation = \[8, 9, 10\]/);
assert.equal(candidate.replaceAll('\r\n', '').includes('\n'), false, 'CRLF layout must be preserved');
const unchanged = source.split('\r\n').filter((line) => !/^translation = \[0\.0, -0\.015|^rotation = \[0\.0, 0\.0, 0\.0, 1\.0\]$/.test(line));
for (const line of unchanged) assert.equal(candidate.includes(line), true, `unrelated source line changed: ${line}`);

assert.throws(() => helper.parseSpatialAttachment(source.replace('[primary_grip]', '[primary_grip]\r\n[primary_grip]')), /exactly one supported/);
assert.throws(() => helper.parseSpatialAttachment(source.replace('socket = "socket.hand_r.primary"', 'socket = get_socket()')), /unsupported layout/);
assert.throws(() => helper.updateSpatialAttachmentTransform(source, [Number.NaN, 0, 0], [0, 0, 0]), /finite/);

assert.match(appSource, /activeTab === 'Assets'[\s\S]*SpatialAttachmentEditorView/);
assert.match(appSource, /activeTab === 'World'[\s\S]*SceneEditorView/);
assert.match(viewSource, /Begin tuning/);
assert.match(viewSource, /NOT APPLIED/);
assert.match(viewSource, /previewSpatialAttachment/);
assert.match(viewSource, /transitionOperation/);
assert.doesNotMatch(viewSource, /\bwriteFile\b/);
assert.match(clientSource, /X-Shader-Forge-Agent-Credential/);
assert.match(clientSource, /id: 'engine-shell'/);
assert.match(clientSource, /kind: 'shell'/);
assert.match(clientSource, /revision: string/);
assert.match(clientSource, /replaceAll\(credential, '\[redacted\]'\)/);
assert.match(stylesSource, /\.workspace-panel\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/s);
assert.match(stylesSource, /\.spatial-actions\s*\{[^}]*position:\s*sticky;[^}]*bottom:\s*0;/s);

console.log('Engine spatial shell passed.');
console.log('- Verified exact primary-grip-only source edits and unsupported-layout rejection');
console.log('- Verified the Assets-only operation route, explicit lock workflow, and credential redaction markers');
