import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { repoRootFromScript, requestTextNoAuth, startStaticFileServer } from './lib/harness-utils.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const shellRoot = path.join(repoRoot, 'shell', 'engine-shell', 'web');
const shellPackageJson = fs.readFileSync(path.join(repoRoot, 'shell', 'engine-shell', 'package.json'), 'utf8');
const shellApp = fs.readFileSync(path.join(repoRoot, 'shell', 'engine-shell', 'src', 'App.tsx'), 'utf8');

const server = await startStaticFileServer({
  rootDir: shellRoot,
  host: '127.0.0.1',
  port: 0,
});

try {
  const [html, styleCss, codeJs] = await Promise.all([
    requestTextNoAuth(`${server.baseUrl}/`),
    requestTextNoAuth(`${server.baseUrl}/css/style.css`),
    requestTextNoAuth(`${server.baseUrl}/js/pages/code.js`),
  ]);

  assert.match(html, /<script type="module" src="\.\/js\/code-bridge\.js"><\/script>/);
  assert.match(styleCss, /\.code-editor-search-match\s*\{/);
  assert.match(styleCss, /\.code-editor__toolbar-search\s*\{/);
  assert.match(codeJs, /data-code-editor-search-input/);
  assert.match(codeJs, /data-code-editor-search-prev/);
  assert.match(codeJs, /data-code-editor-search-next/);
  assert.match(codeJs, /findMatches\(/);
  assert.match(codeJs, /setEditorSearchQuery\(/);
  assert.match(shellPackageJson, /"react"/);
  assert.match(shellPackageJson, /"vite"/);
  assert.match(shellApp, /Code/);
  assert.match(shellApp, /Game/);
  assert.match(shellApp, /Scene/);
  assert.match(shellApp, /Preview/);
  assert.match(shellApp, /web\/index\.html#\/code/);
  assert.match(shellApp, /Code Focus/);
  assert.match(shellApp, /Code \+ Game/);
  assert.match(shellApp, /Triptych/);
  assert.match(shellApp, /engine_sessiond/);
  assert.match(shellApp, /Edit Session/);
  assert.match(shellApp, /Explorer/);
  assert.match(shellApp, /Source Control/);
  assert.match(shellApp, /Workspace root/);
  assert.match(shellApp, /Init repo/);
  assert.match(shellApp, /fetchGitStatus/);
  assert.match(shellApp, /initGitRepository/);
  assert.match(shellApp, /updateSession/);
  assert.match(shellApp, /deleteSession/);
  assert.match(shellApp, /listHostDirectories/);
  assert.match(shellApp, /dir-picker/);
  assert.match(shellApp, /fetchPlatformInfo/);
  assert.match(shellApp, /readFile/);
  assert.match(shellApp, /listFiles/);
  assert.match(shellApp, /startRuntimeBuild/);
  assert.match(shellApp, /fetchBuildStatus/);

  console.log('Engine shell smoke passed.');
  console.log(`- Served shell from ${server.rootDir}`);
  console.log('- Verified index, style sheet, and preserved code workspace module');
  console.log('- Verified inline editor search UI and Monaco match-finding hooks are present');
  console.log('- Verified the React/Vite shell frame bridges to the preserved editor assets');
  console.log('- Verified the React shell references the session backend bridge contract');
  console.log('- Verified the Explorer tab references backend file list/read flows');
  console.log('- Verified the shell references runtime build and runtime lifecycle controls');
} finally {
  await server.close();
}
