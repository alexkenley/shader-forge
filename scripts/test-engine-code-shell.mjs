import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRootFromScript } from './lib/harness-utils.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const viewPath = path.join(repoRoot, 'shell', 'engine-shell', 'src', 'CodeWorkspaceView.tsx');
const statePath = path.join(repoRoot, 'shell', 'engine-shell', 'src', 'code-workspace-state.ts');
const editorPath = path.join(repoRoot, 'shell', 'engine-shell', 'src', 'MonacoCodeEditor.tsx');
const appPath = path.join(repoRoot, 'shell', 'engine-shell', 'src', 'App.tsx');
const clientPath = path.join(repoRoot, 'shell', 'engine-shell', 'src', 'lib', 'sessiond.ts');
const stylesPath = path.join(repoRoot, 'shell', 'engine-shell', 'src', 'styles.css');
const rootPackagePath = path.join(repoRoot, 'package.json');
const shellPackagePath = path.join(repoRoot, 'shell', 'engine-shell', 'package.json');
const typescriptPath = path.join(repoRoot, 'shell', 'engine-shell', 'node_modules', 'typescript', 'lib', 'typescript.js');
const monacoLoaderPath = path.join(repoRoot, 'shell', 'engine-shell', 'web', 'vendor', 'monaco', 'vs', 'loader.js');

const [viewSource, stateSource, editorSource, appSource, clientSource, stylesSource, rootPackage, shellPackage] = await Promise.all([
  fs.readFile(viewPath, 'utf8'),
  fs.readFile(statePath, 'utf8'),
  fs.readFile(editorPath, 'utf8'),
  fs.readFile(appPath, 'utf8'),
  fs.readFile(clientPath, 'utf8'),
  fs.readFile(stylesPath, 'utf8'),
  fs.readFile(rootPackagePath, 'utf8'),
  fs.readFile(shellPackagePath, 'utf8'),
]);

await fs.access(monacoLoaderPath);

const ts = await import(pathToFileURL(typescriptPath).href);
const compiled = ts.transpileModule(stateSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const helper = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const bound = helper.bindCodeTab('sess-a', 'notes/readme.md', 'hello\n', 'sha256:aaa');
assert.equal(bound.id, 'sess-a:notes/readme.md');
assert.equal(bound.sessionId, 'sess-a');
assert.equal(bound.path, 'notes/readme.md');
assert.equal(bound.revision, 'sha256:aaa');
assert.equal(bound.dirty, false);
assert.equal(bound.detached, false);

const dirty = { ...bound, draft: 'hello world\n', dirty: true };
const cleanOther = helper.bindCodeTab('sess-a', 'clean.txt', 'ok', 'sha256:bbb');
const retained = helper.retainTabsForSessionChange([dirty, cleanOther], 'sess-b');
assert.equal(retained.length, 1, 'session change must clear clean tabs');
assert.equal(retained[0].id, dirty.id);
assert.equal(retained[0].detached, true, 'dirty tabs stay explicitly detached');
assert.equal(helper.retainTabsForSessionChange(retained, 'sess-a')[0].detached, false, 'returning to the bound session reattaches the dirty tab');
assert.equal(helper.canMutateCodeTab(retained[0], 'sess-b'), false);
assert.throws(
  () => helper.previewAuthority(retained[0], 'sess-b'),
  /current workspace authority/,
);
assert.deepEqual(helper.previewAuthority(dirty, 'sess-a'), {
  sessionId: 'sess-a',
  path: 'notes/readme.md',
  content: 'hello world\n',
  baseRevision: 'sha256:aaa',
});

assert.equal(helper.shouldAcceptCodeRead({
  requestId: 2,
  latestRequestId: 2,
  tabId: 'sess-a:notes/readme.md',
  openTabIds: ['sess-a:notes/readme.md'],
  resultSessionId: 'sess-a',
  expectedSessionId: 'sess-a',
  resultPath: 'notes/readme.md',
  expectedPath: 'notes/readme.md',
  activeTabId: 'sess-a:notes/readme.md',
}), true);
assert.equal(helper.shouldAcceptCodeRead({
  requestId: 1,
  latestRequestId: 2,
  tabId: 'sess-a:notes/readme.md',
  openTabIds: ['sess-a:notes/readme.md'],
  resultSessionId: 'sess-a',
  expectedSessionId: 'sess-a',
  resultPath: 'notes/readme.md',
  expectedPath: 'notes/readme.md',
  activeTabId: 'sess-a:notes/readme.md',
}), false, 'superseded reads must not apply');
assert.equal(helper.shouldAcceptCodeRead({
  requestId: 2,
  latestRequestId: 2,
  tabId: 'sess-a:old.md',
  openTabIds: ['sess-b:new.md'],
  resultSessionId: 'sess-a',
  expectedSessionId: 'sess-b',
  resultPath: 'old.md',
  expectedPath: 'new.md',
  activeTabId: 'sess-b:new.md',
}), false, 'late reads from another file/session must not replace the active tab');

const edited = { ...dirty, draft: 'newer unsaved' };
assert.equal(helper.shouldRefreshCodeBaseline(edited, 'hello world\n'), false);
assert.equal(helper.shouldRefreshCodeBaseline(dirty, 'hello world\n'), true);
const preserved = helper.applyFileReadToTabs([edited], edited.id, { content: 'disk\n', revision: 'sha256:ccc' }, true, 'hello world\n');
assert.equal(preserved[0].draft, 'newer unsaved', 'unsafe baseline refresh must keep the unsaved draft');
assert.equal(preserved[0].baseline, 'disk\n');
assert.equal(preserved[0].revision, 'sha256:ccc');
const safe = helper.applyFileReadToTabs([dirty], dirty.id, { content: 'disk\n', revision: 'sha256:ccc' }, true, 'hello world\n');
assert.equal(safe[0].draft, 'disk\n');
assert.equal(safe[0].dirty, false);
const postPreviewEdit = { ...dirty, draft: 'edited after preview', dirty: true };
const appliedPreview = helper.applyFileReadToTabs(
  [postPreviewEdit],
  postPreviewEdit.id,
  { content: 'hello world\n', revision: 'sha256:ddd' },
  true,
  'hello world\n',
);
assert.equal(appliedPreview[0].baseline, 'hello world\n');
assert.equal(appliedPreview[0].draft, 'edited after preview', 'apply refresh must preserve edits made after preview');
assert.equal(appliedPreview[0].dirty, true);

assert.match(appSource, /hidden=\{showGuide \|\| activeCenterTab !== 'Code' \|\| showLegacyBridge\}[\s\S]*CodeWorkspaceView/);
assert.equal((appSource.match(/<CodeWorkspaceView/g) || []).length, 1, 'Code workspace must stay mounted so shell navigation cannot discard drafts');
assert.match(appSource, /operationEventEpoch=\{operationEventEpoch\}/);
assert.match(appSource, /Load legacy bridge/);
assert.match(appSource, /web\/index\.html#\/code/);
assert.doesNotMatch(appSource, /bridge-placeholder/);
assert.equal((appSource.match(/subscribeSessiondEvents\(/g) || []).length, 1, 'App must retain one SSE subscription');
assert.match(appSource, /const \[operationEventEpoch, setOperationEventEpoch\] = useState\(0\)/);
assert.doesNotMatch(viewSource, /EventSource|subscribeSessiondEvents/);
assert.doesNotMatch(editorSource, /EventSource|subscribeSessiondEvents/);

assert.match(editorSource, /web\/vendor\/monaco\/vs\/loader\.js/);
assert.match(editorSource, /vs\/editor\/editor\.main/);
assert.match(editorSource, /inferMonacoLanguage/);
assert.match(editorSource, /createModel/);
assert.match(editorSource, /dispose\(\)/);
assert.match(editorSource, /saveViewState/);
assert.match(editorSource, /restoreViewState/);
assert.match(editorSource, /createDiffEditor/);
assert.doesNotMatch(editorSource, /code\.js|pages\/code/);
assert.doesNotMatch(editorSource, /from ['"]monaco-editor['"]/);
assert.doesNotMatch(viewSource, /from '\.\/lib\/sessiond'[\s\S]*writeFile|writeFile\(/);
assert.doesNotMatch(viewSource, /\/api\/files\/write/);
assert.doesNotMatch(editorSource, /\/api\/files\/write|writeFile/);
assert.doesNotMatch(viewSource, /language server|Problems|command palette|useReducer|zustand|redux/i);
assert.doesNotMatch(editorSource, /language server|Problems|command palette/i);

assert.match(clientSource, /export async function previewFileWrite/);
assert.match(clientSource, /\/api\/operations\/file-write\/preview/);
assert.match(clientSource, /sessionId: options\.sessionId/);
assert.match(clientSource, /path: options\.path/);
assert.match(clientSource, /content: options\.content/);
assert.match(clientSource, /baseRevision: options\.baseRevision/);
assert.match(clientSource, /actor: engineShellActor/);
assert.match(viewSource, /previewFileWrite\(\{/);
assert.match(viewSource, /sessionId: body\.sessionId/);
assert.match(viewSource, /path: body\.path/);
assert.match(viewSource, /content: body\.content/);
assert.match(viewSource, /baseRevision: body\.baseRevision/);
assert.match(viewSource, /transitionOperation\(current\.id, action, \{ actor: engineShellActor \}\)/);
assert.match(viewSource, /Approve/);
assert.match(viewSource, /Reject/);
assert.match(viewSource, /Apply/);
assert.match(viewSource, /Undo/);
assert.match(viewSource, /NOT APPLIED/);
assert.match(viewSource, /codeTrustEffect/);
assert.match(viewSource, /error\.diagnostic/);
assert.match(viewSource, /fetchOperation\(expectedOperationId\)/);
assert.match(viewSource, /operationEventEpoch/);
assert.match(viewSource, /listFiles\(sessionId, '\.'\)/);
assert.match(viewSource, /expandDirectory/);
assert.match(viewSource, /listFiles\(sessionId, path\)/);
assert.match(viewSource, /readFile\(sessionId, path\)/);
assert.match(viewSource, /status === 409/);
assert.match(viewSource, /!error\.conflict \|\| typeof error\.conflict !== 'object'/);
assert.match(viewSource, /conflictCode !== 'revision_conflict'/);
assert.match(viewSource, /Reload/);
assert.match(viewSource, /Re-preview/);
assert.match(viewSource, /The unsaved draft was preserved/);
assert.match(viewSource, /editor was not overwritten|never replace the active tab/);
assert.doesNotMatch(viewSource, /Late reads from another file\/session never replace the active tab/);
assert.match(stateSource, /shouldRefreshCodeBaseline/);
assert.match(viewSource, /retainTabsForSessionChange/);
assert.match(viewSource, /operationBindingRef\.current\.previewDraft !== tab\.draft/);
assert.match(viewSource, /Draft changed after preview/);
assert.match(viewSource, /readRequestRef\.current\.clear\(\)/);
assert.match(viewSource, /activeSessionIdRef\.current !== sessionId/);
assert.match(viewSource, /<dialog/);
assert.match(viewSource, /showModal\(\)/);
assert.match(viewSource, /onCancel=/);
assert.match(viewSource, /beforeunload/);
assert.match(viewSource, /Close and discard/);
assert.match(viewSource, /Keep editing/);
assert.match(viewSource, /requestAnimationFrame[\s\S]*?data-code-tab-id[\s\S]*?code-workspace__tree-row/);
assert.match(viewSource, /role="tablist"/);
assert.match(viewSource, /aria-label=\{label\}/);
assert.match(viewSource, /aria-label=\{`Close \$\{label\}`\}/);
assert.match(viewSource, /aria-label="Search in current file"/);
assert.match(viewSource, /data-code-editor-search-input/);
assert.match(viewSource, /data-code-editor-search-prev/);
assert.match(viewSource, /data-code-editor-search-next/);
assert.match(viewSource, /data-code-editor-search-clear/);
assert.match(viewSource, /aria-label="Previous match"/);
assert.match(viewSource, /aria-label="Next match"/);
assert.match(viewSource, /aria-label="Clear search"/);
assert.match(viewSource, /event\.key === 'Enter'/);
assert.match(viewSource, /event\.key === 'Escape'/);
assert.match(viewSource, /aria-label="File inspect"/);
assert.match(viewSource, /<dt>Session<\/dt>/);
assert.match(viewSource, /<dt>Path<\/dt>/);
assert.match(viewSource, /<dt>Revision<\/dt>/);
assert.match(viewSource, /<dt>Dirty<\/dt>/);
assert.match(viewSource, /<dt>Lines<\/dt>/);
const toolbarSource = /className="code-workspace__toolbar"[\s\S]*?code-workspace__editor-shell/.exec(viewSource)?.[0] || '';
assert.match(toolbarSource, /data-code-editor-search-input/);
assert.match(toolbarSource, /Inspect/);
assert.ok(
  toolbarSource.indexOf('data-code-editor-search-input') < toolbarSource.indexOf('Inspect'),
  'current-file search must sit immediately beside Inspect',
);
assert.match(stylesSource, /\.code-workspace\s*\{/);
assert.match(stylesSource, /\.code-workspace-host\s*\{[\s\S]*?display:\s*flex;[\s\S]*?min-height:\s*0;[\s\S]*?overflow:\s*hidden;/);
assert.match(stylesSource, /\.guide-toolbar-meta\s*\{[\s\S]*?overflow:\s*hidden;[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap;/);
assert.match(stylesSource, /\.code-editor-search-match\s*\{/);
assert.match(stylesSource, /\.code-editor-search-match\.is-current/);
assert.match(stylesSource, /@media \(max-width: 1100px\)[\s\S]*?\.code-workspace\s*\{[^}]*grid-template-columns:\s*1fr;/s);
assert.match(rootPackage, /"test:code-shell": "node scripts\/test-engine-code-shell\.mjs"/);
assert.doesNotMatch(shellPackage, /monaco-editor/);
assert.doesNotMatch(rootPackage, /monaco-editor/);
assert.doesNotMatch(viewSource, /xterm|Terminal/);
assert.match(appSource, /const bottomTabs = \['Terminal', 'Logs', 'Output', 'Activity'\] as const;/);

console.log('Engine Code shell passed.');
console.log('- Verified native Code workspace mount, Monaco AMD loader, and no extra editor dependency');
console.log('- Verified revision-bound file-write preview, no direct write, and truthful conflict preservation');
console.log('- Verified stale read/session guards, one App SSE, search beside Inspect, and accessible dirty-close');
console.log('- Verified approve/reject/apply/undo transitions and optional legacy bridge without placeholder cards');
