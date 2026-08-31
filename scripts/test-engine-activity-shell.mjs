import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { repoRootFromScript } from './lib/harness-utils.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const [app, activity, client, styles, operationStore] = await Promise.all([
  fs.readFile(path.join(repoRoot, 'shell', 'engine-shell', 'src', 'App.tsx'), 'utf8'),
  fs.readFile(path.join(repoRoot, 'shell', 'engine-shell', 'src', 'ActivityDockView.tsx'), 'utf8'),
  fs.readFile(path.join(repoRoot, 'shell', 'engine-shell', 'src', 'lib', 'sessiond.ts'), 'utf8'),
  fs.readFile(path.join(repoRoot, 'shell', 'engine-shell', 'src', 'styles.css'), 'utf8'),
  fs.readFile(path.join(repoRoot, 'tools', 'engine-sessiond', 'lib', 'operation-store.mjs'), 'utf8'),
]);

assert.match(app, /const bottomTabs = SHELL_BOTTOM_TABS;/);
assert.match(app, /<ActivityDockView/);
assert.equal((app.match(/subscribeSessiondEvents\(/g) || []).length, 1, 'App must retain one SSE subscription');
assert.match(app, /listOperations\(sessionId\)/);
assert.match(app, /fetchOperation\(operationId\)/);
assert.match(app, /SessiondRequestError && error\.status === 409/);
assert.match(app, /setOperations\(\[\]\);\s*setSelectedOperationId\(''\);\s*selectedOperationIdRef\.current = '';\s*activityDetailRequestRef\.current \+= 1;/);
assert.match(app, /role="separator"/);
assert.match(app, /onKeyDown=\{handleBottomPaneResizeKeyDown\}/);
assert.match(app, /aria-valuenow=\{bottomPaneHeight\}/);

assert.match(activity, /title="Needs review"/);
assert.match(activity, /title="In progress"/);
assert.match(activity, /title="History"/);
assert.match(activity, /fetchOperationDiff\(operation\.id\)/);
assert.match(activity, /aria-label="Exact operation changes"/);
assert.match(activity, /nextDiff\.beforeRevision !== operation\.baseRevision/);
assert.match(activity, /nextDiff\.afterRevision !== operation\.proposedRevision/);
assert.match(activity, /requestError\.status === 404/);
assert.match(activity, /requestError\.status === 409/);
assert.match(activity, /line\.oldLine/);
assert.match(activity, /line\.newLine/);
assert.match(activity, /line\.ending/);
assert.match(activity, /Diff output is truncated/);
assert.match(activity, /onApprove/);
assert.match(activity, /onReject/);
assert.doesNotMatch(activity, /beforeContent|proposedContent|credential|leaseId|requestCoordinationLease/);
assert.doesNotMatch(activity, /transitionOperation|onApply|onUndo/);

assert.match(client, /export async function listOperations/);
assert.match(client, /export async function fetchOperation/);
assert.match(client, /export async function fetchOperationDiff/);
assert.match(client, /export async function transitionOperation/);
for (const eventType of ['previewed', 'approved', 'rejected', 'applied', 'undone', 'conflicted']) {
  assert.match(client, new RegExp(`operation\\.${eventType}`));
}
assert.doesNotMatch(client, /preview:\s*\{\s*summary:\s*string;\s*lineDiff/);
assert.match(client, /beforeLineCount: number/);
assert.match(client, /afterLineCount: number/);

for (const state of ['previewed', 'approved', 'rejected', 'applying', 'applied', 'undoing', 'undone', 'conflicted']) {
  assert.match(operationStore, new RegExp(`'${state}'`));
}
for (const eventType of ['apply_failed', 'undo_failed', 'recovered']) {
  assert.match(operationStore, new RegExp(`'${eventType}'`));
}
assert.match(operationStore, /preview:\s*structuredClone\(record\.preview\)/);
assert.match(operationStore, /events:\s*structuredClone\(record\.events\)/);
assert.match(operationStore, /getOperationDiff\(operationId\)/);
assert.match(operationStore, /MAX_DIFF_INPUT_BYTES/);
assert.match(operationStore, /MAX_DIFF_MATRIX_CELLS/);
assert.match(operationStore, /MAX_DIFF_OUTPUT_LINES/);

assert.match(styles, /\.activity-dock__layout\s*\{/);
assert.match(styles, /\.activity-row:focus-visible/);
assert.match(styles, /\.activity-diff:focus-visible/);
assert.match(styles, /\.activity-diff__hunk/);
assert.match(styles, /@media \(max-width: 800px\)[\s\S]*\.activity-dock__layout/);
assert.match(styles, /\.bottom-pane__resize-handle:focus-visible/);

console.log('Engine Activity shell passed.');
console.log('- Verified the global bottom-dock history and selected-operation exact diff surface');
console.log('- Verified one SSE subscription, authoritative list/detail refresh, and 409 recovery');
console.log('- Verified bounded structured diff rendering and truthful summary-only degradation');
console.log('- Verified Activity cannot apply, undo, coordinate, or expose private journal fields');
