import assert from 'node:assert/strict';
import path from 'node:path';
import { repoRootFromScript, requestTextNoAuth, startStaticFileServer } from './lib/harness-utils.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const shellRoot = path.join(repoRoot, 'shell', 'engine-shell', 'web');

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

  assert.match(html, /<script type="module" src="\/js\/app\.js"><\/script>/);
  assert.match(styleCss, /\.code-editor-search-match\s*\{/);
  assert.match(styleCss, /\.code-editor__toolbar-search\s*\{/);
  assert.match(codeJs, /data-code-editor-search-input/);
  assert.match(codeJs, /data-code-editor-search-prev/);
  assert.match(codeJs, /data-code-editor-search-next/);
  assert.match(codeJs, /findMatches\(/);
  assert.match(codeJs, /setEditorSearchQuery\(/);

  console.log('Engine shell smoke passed.');
  console.log(`- Served shell from ${server.rootDir}`);
  console.log('- Verified index, style sheet, and code workspace module');
  console.log('- Verified inline editor search UI and Monaco match-finding hooks are present');
} finally {
  await server.close();
}

