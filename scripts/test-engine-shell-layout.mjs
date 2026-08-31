import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRootFromScript } from './lib/harness-utils.mjs';

const repoRoot = repoRootFromScript(import.meta.url);
const sourcePath = path.join(repoRoot, 'shell', 'engine-shell', 'src', 'shell-layout.ts');
const appSourcePath = path.join(repoRoot, 'shell', 'engine-shell', 'src', 'App.tsx');
const stylesSourcePath = path.join(repoRoot, 'shell', 'engine-shell', 'src', 'styles.css');
const requireFromShell = createRequire(path.join(
  repoRoot,
  'shell',
  'engine-shell',
  'package.json',
));
let typescriptPath;
try {
  typescriptPath = requireFromShell.resolve('typescript');
} catch {
  throw new Error('Install shell/engine-shell dependencies before running the shell layout harness.');
}
const [source, appSource, stylesSource] = await Promise.all([
  fs.readFile(sourcePath, 'utf8'),
  fs.readFile(appSourcePath, 'utf8'),
  fs.readFile(stylesSourcePath, 'utf8'),
]);
const typescriptModule = await import(pathToFileURL(typescriptPath).href);
const ts = typescriptModule.default || typescriptModule;

assert.doesNotMatch(source, /@ts-nocheck/);
assert.doesNotMatch(source, /@typedef/);
assert.doesNotMatch(source, /\bfrom\s+['"]react['"]/);

const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourcePath,
  reportDiagnostics: true,
});
const transpileErrors = (transpiled.diagnostics || []).filter(
  (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
);
assert.deepEqual(transpileErrors, [], 'shell layout source transpiles');

const layoutModule = await import(
  `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString('base64')}`
);
const {
  DEFAULT_SHELL_LAYOUT,
  SHELL_LAYOUT_STORAGE_KEY,
  SHELL_LAYOUT_VERSION,
  SHELL_WORKSPACES,
  SHELL_LEFT_TABS,
  SHELL_RIGHT_TABS,
  SHELL_BOTTOM_TABS,
  SHELL_LAYOUT_LEFT_WIDTH_MIN,
  SHELL_LAYOUT_LEFT_WIDTH_MAX,
  SHELL_LAYOUT_RIGHT_WIDTH_MIN,
  SHELL_LAYOUT_RIGHT_WIDTH_MAX,
  SHELL_LAYOUT_BOTTOM_HEIGHT_MIN,
  SHELL_LAYOUT_BOTTOM_HEIGHT_MAX,
  SHELL_LAYOUT_BOTTOM_VIEWPORT_RATIO,
  SHELL_LAYOUT_BOTTOM_PREFERRED_HEIGHT_DEFAULT,
  clampShellLayoutLeftWidth,
  clampShellLayoutRightWidth,
  clampShellLayoutPreferredHeight,
  loadShellLayout,
  saveShellLayout,
  resetShellLayout,
  maxShellLayoutBottomHeightForViewport,
  deriveShellLayoutBottomHeight,
} = layoutModule;

assert.equal(clampShellLayoutLeftWidth(10), SHELL_LAYOUT_LEFT_WIDTH_MIN);
assert.equal(clampShellLayoutLeftWidth(999), SHELL_LAYOUT_LEFT_WIDTH_MAX);
assert.equal(clampShellLayoutLeftWidth(240.6), 241);
assert.equal(clampShellLayoutRightWidth(10), SHELL_LAYOUT_RIGHT_WIDTH_MIN);
assert.equal(clampShellLayoutRightWidth(999), SHELL_LAYOUT_RIGHT_WIDTH_MAX);
assert.equal(clampShellLayoutPreferredHeight(10), SHELL_LAYOUT_BOTTOM_HEIGHT_MIN);
assert.equal(clampShellLayoutPreferredHeight(9999), SHELL_LAYOUT_BOTTOM_HEIGHT_MAX);
assert.equal(clampShellLayoutPreferredHeight(Number.NaN), SHELL_LAYOUT_BOTTOM_PREFERRED_HEIGHT_DEFAULT);

const appSourceFile = ts.createSourceFile(
  appSourcePath,
  appSource,
  ts.ScriptTarget.ES2022,
  true,
  ts.ScriptKind.TSX,
);

function appFunctionSource(name) {
  const declaration = appSourceFile.statements.find(
    (statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name,
  );
  assert.ok(declaration, `App.tsx declares ${name}`);
  return declaration.getText(appSourceFile).replace(/^function\s+/, 'export function ');
}

const behaviorSource = `
  const SHELL_LAYOUT_LEFT_WIDTH_MIN = ${SHELL_LAYOUT_LEFT_WIDTH_MIN};
  const SHELL_LAYOUT_LEFT_WIDTH_MAX = ${SHELL_LAYOUT_LEFT_WIDTH_MAX};
  const SHELL_LAYOUT_RIGHT_WIDTH_MIN = ${SHELL_LAYOUT_RIGHT_WIDTH_MIN};
  const SHELL_LAYOUT_RIGHT_WIDTH_MAX = ${SHELL_LAYOUT_RIGHT_WIDTH_MAX};
  const SHELL_LAYOUT_BOTTOM_HEIGHT_MIN = ${SHELL_LAYOUT_BOTTOM_HEIGHT_MIN};
  const SHELL_LAYOUT_BOTTOM_HEIGHT_MAX = ${SHELL_LAYOUT_BOTTOM_HEIGHT_MAX};
  const SHELL_LAYOUT_BOTTOM_PREFERRED_HEIGHT_DEFAULT = ${SHELL_LAYOUT_BOTTOM_PREFERRED_HEIGHT_DEFAULT};
  const SHELL_LAYOUT_CENTER_WIDTH_MIN = 360;
  const SHELL_LAYOUT_NARROW_WIDTH_MAX = 800;
  const SHELL_LAYOUT_SEPARATOR_WIDTH = 5;
  function clampShellLayoutPreferredHeight(height) {
    if (typeof height !== 'number' || !Number.isFinite(height)) {
      return SHELL_LAYOUT_BOTTOM_PREFERRED_HEIGHT_DEFAULT;
    }
    return Math.max(
      SHELL_LAYOUT_BOTTOM_HEIGHT_MIN,
      Math.min(SHELL_LAYOUT_BOTTOM_HEIGHT_MAX, Math.round(height)),
    );
  }
  ${appFunctionSource('clampShellPaneWidth')}
  ${appFunctionSource('deriveShellPaneGeometry')}
  ${appFunctionSource('effectiveShellBottomMinHeight')}
  ${appFunctionSource('preferredShellBottomHeightForRenderedHeight')}
`;
const behaviorTranspiled = ts.transpileModule(behaviorSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  reportDiagnostics: true,
});
const behaviorErrors = (behaviorTranspiled.diagnostics || []).filter(
  (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
);
assert.deepEqual(behaviorErrors, [], 'App layout behavior helpers transpile');
const {
  deriveShellPaneGeometry,
  effectiveShellBottomMinHeight,
  preferredShellBottomHeightForRenderedHeight,
} = await import(
  `data:text/javascript;base64,${Buffer.from(behaviorTranspiled.outputText).toString('base64')}`
);

const exactDesktopFit = deriveShellPaneGeometry(1370, true, true, 480, 520);
assert.deepEqual(exactDesktopFit, {
  left: { min: 180, max: 480, width: 480 },
  right: { min: 220, max: 520, width: 520 },
  narrow: false,
});
const constrainedDesktop = deriveShellPaneGeometry(1100, true, true, 480, 520);
assert.equal(constrainedDesktop.left.width + constrainedDesktop.right.width + 10 + 360, 1100);
assert.deepEqual(constrainedDesktop.left, { min: 180, max: 480, width: 480 });
assert.deepEqual(constrainedDesktop.right, { min: 220, max: 250, width: 250 });
const tighterDesktop = deriveShellPaneGeometry(1000, true, true, 480, 520);
assert.equal(tighterDesktop.left.width + tighterDesktop.right.width + 10 + 360, 1000);
assert.deepEqual(tighterDesktop.left, { min: 180, max: 410, width: 410 });
assert.deepEqual(tighterDesktop.right, { min: 220, max: 220, width: 220 });
const desktopBoundary = deriveShellPaneGeometry(801, true, true, 480, 520);
assert.equal(desktopBoundary.left.width + desktopBoundary.right.width + 10 + 360, 801);
assert.equal(desktopBoundary.left.max >= desktopBoundary.left.min, true);
assert.equal(desktopBoundary.right.max >= desktopBoundary.right.min, true);
const rightUsesRenderedLeft = deriveShellPaneGeometry(1000, true, true, 180, 520);
assert.deepEqual(rightUsesRenderedLeft.right, { min: 220, max: 450, width: 450 });
assert.equal(deriveShellPaneGeometry(800, true, true, 480, 520).narrow, true);
assert.equal(deriveShellPaneGeometry(801, true, true, 480, 520).narrow, false);

for (const gridWidth of [Number.NaN, Number.NEGATIVE_INFINITY, -1, 0, 800.9, 801, 900, 1100]) {
  const geometry = deriveShellPaneGeometry(gridWidth, true, true, 999, 999);
  for (const pane of [geometry.left, geometry.right]) {
    assert.equal(Number.isFinite(pane.width), true, `finite width at ${gridWidth}`);
    assert.equal(Number.isFinite(pane.max), true, `finite maximum at ${gridWidth}`);
    assert.equal(pane.max >= pane.min, true, `non-inverted range at ${gridWidth}`);
    assert.equal(pane.width >= pane.min && pane.width <= pane.max, true, `width in range at ${gridWidth}`);
  }
  if (!geometry.narrow) {
    assert.equal(
      geometry.left.width + geometry.right.width + 10 + 360 <= Math.floor(gridWidth),
      true,
      `center reserve at ${gridWidth}`,
    );
  }
}

assert.equal(effectiveShellBottomMinHeight(400), 180);
assert.equal(effectiveShellBottomMinHeight(180), 180);
assert.equal(effectiveShellBottomMinHeight(80), 80);
assert.equal(effectiveShellBottomMinHeight(0), 0);
assert.equal(effectiveShellBottomMinHeight(Number.NaN), 0);
assert.equal(preferredShellBottomHeightForRenderedHeight(80, 80, 480), 480);
assert.equal(preferredShellBottomHeightForRenderedHeight(180, 180, 1200), 1200);
assert.equal(preferredShellBottomHeightForRenderedHeight(400, 400, 1200), 1200);
assert.equal(preferredShellBottomHeightForRenderedHeight(384, 400, 1200), 384);
assert.equal(preferredShellBottomHeightForRenderedHeight(999, 400, 260), 400);
assert.equal(preferredShellBottomHeightForRenderedHeight(0, 0, Number.NaN), 260);

assert.match(appSource, /new ResizeObserver\(handleResize\)/);
assert.match(appSource, /aria-valuemax=\{shellPaneGeometry\.left\.max\}/);
assert.match(appSource, /aria-valuemax=\{shellPaneGeometry\.right\.max\}/);
assert.match(appSource, /aria-valuemin=\{bottomPaneMinHeight\}/);
assert.match(appSource, /aria-pressed=\{rightPaneVisible\}/);
assert.match(stylesSource, /minmax\(var\(--shell-center-min-width\), 1fr\)/);
assert.match(stylesSource, /\.shell-grid--narrow \.side-pane\s*\{[\s\S]*?justify-self: end;/);
assert.doesNotMatch(stylesSource, /\.layout-control--right\s*\{[^}]*display:\s*none/);

function assertTypedConsumerCompiles() {
  const consumerPath = path.join(
    repoRoot,
    'shell',
    'engine-shell',
    'src',
    '__shell-layout-contract-test.ts',
  );
  const consumerSource = `
    import {
      DEFAULT_SHELL_LAYOUT,
      SHELL_LEFT_TABS,
      loadShellLayout,
      saveShellLayout,
      resetShellLayout,
      type ShellLayout,
      type ShellLayoutStorage,
      type ShellLeftTab,
      type ShellWorkspace,
    } from './shell-layout';

    const browserStorage: Storage = window.localStorage;
    const storage: ShellLayoutStorage = browserStorage;
    const loaded: ShellLayout = loadShellLayout(storage);
    const workspace: ShellWorkspace = loaded.activeWorkspace;
    const leftTab: ShellLeftTab = loaded.workspaces[workspace].left.tab;
    const saved = saveShellLayout(storage, loaded);
    const reset = resetShellLayout(storage);
    const persisted: boolean = saved.persisted && reset.persisted;
    const version: 1 = DEFAULT_SHELL_LAYOUT.version;
    // @ts-expect-error The canonical default is deeply readonly.
    DEFAULT_SHELL_LAYOUT.bottom.collapsed = false;
    // @ts-expect-error Schema allowlists are readonly.
    SHELL_LEFT_TABS.push('Unsupported');
    void leftTab;
    void persisted;
    void version;
  `;
  const compilerOptions = {
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    noEmit: true,
    skipLibCheck: true,
    strict: true,
    target: ts.ScriptTarget.ES2022,
  };
  const host = ts.createCompilerHost(compilerOptions);
  const normalizedConsumerPath = path.normalize(consumerPath).toLowerCase();
  const originalFileExists = host.fileExists.bind(host);
  const originalReadFile = host.readFile.bind(host);
  host.fileExists = (fileName) => (
    path.normalize(fileName).toLowerCase() === normalizedConsumerPath || originalFileExists(fileName)
  );
  host.readFile = (fileName) => (
    path.normalize(fileName).toLowerCase() === normalizedConsumerPath
      ? consumerSource
      : originalReadFile(fileName)
  );
  host.getSourceFile = (fileName, languageVersion) => {
    const text = host.readFile(fileName);
    return text === undefined
      ? undefined
      : ts.createSourceFile(fileName, text, languageVersion, true);
  };
  const program = ts.createProgram([sourcePath, consumerPath], compilerOptions, host);
  const errors = ts.getPreEmitDiagnostics(program).filter(
    (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
  );
  assert.equal(
    errors.length,
    0,
    errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')).join('\n'),
  );
}

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key = '') {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key = '', value = '') {
      data.set(key, String(value));
    },
    removeItem(key = '') {
      data.delete(key);
    },
    snapshot() {
      return Object.fromEntries(data.entries());
    },
  };
}

function throwingStorage() {
  return {
    getItem() {
      throw new Error('getItem failed');
    },
    setItem() {
      throw new Error('setItem failed');
    },
    removeItem() {
      throw new Error('removeItem failed');
    },
  };
}

function failingMutationStorage(initial = {}) {
  const storage = memoryStorage(initial);
  return {
    getItem: storage.getItem,
    setItem() {
      throw new Error('setItem failed');
    },
    removeItem() {
      throw new Error('removeItem failed');
    },
    snapshot: storage.snapshot,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function persistRaw(storage, value) {
  storage.setItem(SHELL_LAYOUT_STORAGE_KEY, typeof value === 'string' ? value : JSON.stringify(value));
}

function assertCanonicalDefaults(layout, message = 'canonical defaults') {
  assert.deepEqual(layout, {
    version: 1,
    activeWorkspace: 'World',
    workspaces: {
      World: {
        left: { visible: false, tab: 'Workspaces', width: 180 },
        right: { visible: false, tab: 'Runtime', width: 220 },
      },
      Code: {
        left: { visible: true, tab: 'Workspaces', width: 180 },
        right: { visible: false, tab: 'Runtime', width: 220 },
      },
      Playtest: {
        left: { visible: false, tab: 'Workspaces', width: 180 },
        right: { visible: false, tab: 'Runtime', width: 220 },
      },
      Assets: {
        left: { visible: false, tab: 'Workspaces', width: 180 },
        right: { visible: false, tab: 'Runtime', width: 220 },
      },
    },
    bottom: {
      collapsed: true,
      tab: 'Terminal',
      preferredHeight: 260,
    },
  }, message);
}

assertTypedConsumerCompiles();

assert.equal(SHELL_LAYOUT_STORAGE_KEY, 'shader-forge.shell-layout.v1');
assert.equal(SHELL_LAYOUT_VERSION, 1);
assert.deepEqual([...SHELL_WORKSPACES], ['World', 'Code', 'Playtest', 'Assets']);
assert.deepEqual([...SHELL_LEFT_TABS], ['Workspaces', 'Explorer', 'Source Control']);
assert.deepEqual([...SHELL_RIGHT_TABS], ['Runtime', 'Build', 'Workspace']);
assert.deepEqual([...SHELL_BOTTOM_TABS], ['Terminal', 'Logs', 'Output', 'Activity']);
assert.equal(SHELL_LAYOUT_LEFT_WIDTH_MIN, 180);
assert.equal(SHELL_LAYOUT_LEFT_WIDTH_MAX, 480);
assert.equal(SHELL_LAYOUT_RIGHT_WIDTH_MIN, 220);
assert.equal(SHELL_LAYOUT_RIGHT_WIDTH_MAX, 520);
assert.equal(SHELL_LAYOUT_BOTTOM_HEIGHT_MIN, 180);
assert.equal(SHELL_LAYOUT_BOTTOM_HEIGHT_MAX, 1200);
assert.equal(SHELL_LAYOUT_BOTTOM_VIEWPORT_RATIO, 0.8);
assert.equal(SHELL_LAYOUT_BOTTOM_PREFERRED_HEIGHT_DEFAULT, 260);

assertCanonicalDefaults(DEFAULT_SHELL_LAYOUT);
assert.equal(Object.isFrozen(SHELL_WORKSPACES), true);
assert.equal(Object.isFrozen(SHELL_LEFT_TABS), true);
assert.equal(Object.isFrozen(SHELL_RIGHT_TABS), true);
assert.equal(Object.isFrozen(SHELL_BOTTOM_TABS), true);
assert.equal(Object.isFrozen(DEFAULT_SHELL_LAYOUT), true);
assert.equal(Object.isFrozen(DEFAULT_SHELL_LAYOUT.workspaces.Code.left), true);
assert.throws(() => SHELL_LEFT_TABS.push('Unsupported'), TypeError);
assertCanonicalDefaults(loadShellLayout());
assertCanonicalDefaults(loadShellLayout(null));
assertCanonicalDefaults(loadShellLayout(memoryStorage()));
assert.notEqual(loadShellLayout(), DEFAULT_SHELL_LAYOUT);

const roundTripStorage = memoryStorage();
const authored = clone(DEFAULT_SHELL_LAYOUT);
authored.activeWorkspace = 'Code';
authored.workspaces.Code.left.tab = 'Source Control';
authored.workspaces.Code.left.width = 240;
authored.workspaces.Code.right.visible = true;
authored.workspaces.Code.right.tab = 'Build';
authored.workspaces.Code.right.width = 320;
authored.workspaces.Playtest.right.tab = 'Workspace';
authored.workspaces.Playtest.right.width = 400;
authored.bottom.collapsed = false;
authored.bottom.tab = 'Activity';
authored.bottom.preferredHeight = 480;
const saved = saveShellLayout(roundTripStorage, authored);
assert.equal(saved.persisted, true);
assert.deepEqual(saved.layout, authored);
assert.deepEqual(loadShellLayout(roundTripStorage), authored);
assert.equal(roundTripStorage.getItem(SHELL_LAYOUT_STORAGE_KEY), JSON.stringify(authored));

assertCanonicalDefaults(loadShellLayout(), 'load without storage');
assertCanonicalDefaults(loadShellLayout(null), 'load null storage');
assertCanonicalDefaults(loadShellLayout(undefined), 'load undefined storage');
assertCanonicalDefaults(loadShellLayout({}), 'load storage without methods');
assertCanonicalDefaults(loadShellLayout(throwingStorage()), 'load throwing storage');

const noStorageSave = saveShellLayout(null, authored);
assert.equal(noStorageSave.persisted, false);
assert.deepEqual(noStorageSave.layout, authored);
const throwingSave = saveShellLayout(throwingStorage(), authored);
assert.equal(throwingSave.persisted, false);
assert.deepEqual(throwingSave.layout, authored);
const throwingReset = resetShellLayout(throwingStorage());
assert.equal(throwingReset.persisted, false);
assertCanonicalDefaults(throwingReset.layout, 'reset throwing storage');
const nullReset = resetShellLayout(null);
assert.equal(nullReset.persisted, false);
assertCanonicalDefaults(nullReset.layout, 'reset null storage');

const oldLayout = clone(DEFAULT_SHELL_LAYOUT);
oldLayout.activeWorkspace = 'Assets';
const failedMutationStorage = failingMutationStorage({
  [SHELL_LAYOUT_STORAGE_KEY]: JSON.stringify(oldLayout),
});
const failedWrite = saveShellLayout(failedMutationStorage, authored);
assert.equal(failedWrite.persisted, false);
assert.deepEqual(failedWrite.layout, authored);
assert.deepEqual(loadShellLayout(failedMutationStorage), oldLayout);
const failedReset = resetShellLayout(failedMutationStorage);
assert.equal(failedReset.persisted, false);
assertCanonicalDefaults(failedReset.layout);
assert.deepEqual(loadShellLayout(failedMutationStorage), oldLayout);

const malformedCases = [
  ['malformed json', '{'],
  ['truncated json', '{"version":1'],
  ['non-json text', 'not-json'],
  ['json null', 'null'],
  ['json array', '[]'],
  ['json string', '"World"'],
  ['json number', '1'],
  ['json boolean', 'true'],
  ['empty object', '{}'],
  ['wrong version 2', { ...clone(DEFAULT_SHELL_LAYOUT), version: 2 }],
  ['wrong version 0', { ...clone(DEFAULT_SHELL_LAYOUT), version: 0 }],
  ['string version', { ...clone(DEFAULT_SHELL_LAYOUT), version: '1' }],
  ['fractional version', { ...clone(DEFAULT_SHELL_LAYOUT), version: 1.5 }],
  ['missing version', (() => { const value = clone(DEFAULT_SHELL_LAYOUT); delete value.version; return value; })()],
  ['missing activeWorkspace', (() => { const value = clone(DEFAULT_SHELL_LAYOUT); delete value.activeWorkspace; return value; })()],
  ['missing workspaces', (() => { const value = clone(DEFAULT_SHELL_LAYOUT); delete value.workspaces; return value; })()],
  ['missing bottom', (() => { const value = clone(DEFAULT_SHELL_LAYOUT); delete value.bottom; return value; })()],
  ['missing workspace Code', (() => { const value = clone(DEFAULT_SHELL_LAYOUT); delete value.workspaces.Code; return value; })()],
  ['missing left pane', (() => { const value = clone(DEFAULT_SHELL_LAYOUT); delete value.workspaces.World.left; return value; })()],
  ['missing width', (() => { const value = clone(DEFAULT_SHELL_LAYOUT); delete value.workspaces.World.left.width; return value; })()],
  ['missing preferredHeight', (() => { const value = clone(DEFAULT_SHELL_LAYOUT); delete value.bottom.preferredHeight; return value; })()],
  ['extra root key', { ...clone(DEFAULT_SHELL_LAYOUT), sessionId: 'sess-1' }],
  ['extra workspace key', (() => { const value = clone(DEFAULT_SHELL_LAYOUT); value.workspaces.Guide = clone(value.workspaces.World); return value; })()],
  ['extra workspace layout key', (() => { const value = clone(DEFAULT_SHELL_LAYOUT); value.workspaces.World.center = {}; return value; })()],
  ['extra pane key', (() => { const value = clone(DEFAULT_SHELL_LAYOUT); value.workspaces.Code.left.path = 'src/main.ts'; return value; })()],
  ['extra bottom key', (() => { const value = clone(DEFAULT_SHELL_LAYOUT); value.bottom.cwd = '/tmp'; return value; })()],
  ['unknown active workspace', { ...clone(DEFAULT_SHELL_LAYOUT), activeWorkspace: 'Guide' }],
  ['unknown left tab', (() => { const value = clone(DEFAULT_SHELL_LAYOUT); value.workspaces.Code.left.tab = 'Unsupported'; return value; })()],
  ['unknown right tab', (() => { const value = clone(DEFAULT_SHELL_LAYOUT); value.workspaces.Playtest.right.tab = 'Inspector'; return value; })()],
  ['unknown bottom tab', (() => { const value = clone(DEFAULT_SHELL_LAYOUT); value.bottom.tab = 'Problems'; return value; })()],
  ['non-boolean left visible', (() => { const value = clone(DEFAULT_SHELL_LAYOUT); value.workspaces.Code.left.visible = 1; return value; })()],
  ['non-boolean right visible', (() => { const value = clone(DEFAULT_SHELL_LAYOUT); value.workspaces.Playtest.right.visible = 'true'; return value; })()],
  ['non-boolean collapsed', (() => { const value = clone(DEFAULT_SHELL_LAYOUT); value.bottom.collapsed = 0; return value; })()],
  ['null collapsed', (() => { const value = clone(DEFAULT_SHELL_LAYOUT); value.bottom.collapsed = null; return value; })()],
  ['fractional left width', (() => { const value = clone(DEFAULT_SHELL_LAYOUT); value.workspaces.Code.left.width = 180.5; return value; })()],
  ['fractional right width', (() => { const value = clone(DEFAULT_SHELL_LAYOUT); value.workspaces.Playtest.right.width = 220.1; return value; })()],
  ['fractional preferred height', (() => { const value = clone(DEFAULT_SHELL_LAYOUT); value.bottom.preferredHeight = 260.2; return value; })()],
  ['left width below range', (() => { const value = clone(DEFAULT_SHELL_LAYOUT); value.workspaces.World.left.width = 179; return value; })()],
  ['left width above range', (() => { const value = clone(DEFAULT_SHELL_LAYOUT); value.workspaces.World.left.width = 481; return value; })()],
  ['right width below range', (() => { const value = clone(DEFAULT_SHELL_LAYOUT); value.workspaces.World.right.width = 219; return value; })()],
  ['right width above range', (() => { const value = clone(DEFAULT_SHELL_LAYOUT); value.workspaces.World.right.width = 521; return value; })()],
  ['height below range', (() => { const value = clone(DEFAULT_SHELL_LAYOUT); value.bottom.preferredHeight = 179; return value; })()],
  ['height above range', (() => { const value = clone(DEFAULT_SHELL_LAYOUT); value.bottom.preferredHeight = 1201; return value; })()],
];

for (const [label, payload] of malformedCases) {
  const storage = memoryStorage();
  persistRaw(storage, payload);
  assertCanonicalDefaults(loadShellLayout(storage), `malformed: ${label}`);
}

const proxyFailure = new Proxy({}, {
  ownKeys() {
    throw new Error('ownKeys failed');
  },
});
const proxySave = saveShellLayout(roundTripStorage, proxyFailure);
assert.equal(proxySave.persisted, false);
assertCanonicalDefaults(proxySave.layout, 'throwing proxy validation');
assert.deepEqual(loadShellLayout(roundTripStorage), authored, 'throwing proxy preserves durable layout');

const accessorFailure = clone(DEFAULT_SHELL_LAYOUT);
Object.defineProperty(accessorFailure, 'activeWorkspace', {
  enumerable: true,
  get() {
    throw new Error('activeWorkspace failed');
  },
});
const accessorSave = saveShellLayout(roundTripStorage, accessorFailure);
assert.equal(accessorSave.persisted, false);
assertCanonicalDefaults(accessorSave.layout, 'throwing accessor validation');
assert.deepEqual(loadShellLayout(roundTripStorage), authored, 'throwing accessor preserves durable layout');

const independentStorage = memoryStorage();
const independent = clone(DEFAULT_SHELL_LAYOUT);
independent.workspaces.Code.left.visible = true;
independent.workspaces.Code.left.tab = 'Source Control';
independent.workspaces.Code.left.width = 300;
independent.workspaces.Playtest.right.visible = true;
independent.workspaces.Playtest.right.tab = 'Build';
independent.workspaces.Playtest.right.width = 500;
independent.activeWorkspace = 'Playtest';
assert.equal(saveShellLayout(independentStorage, independent).persisted, true);
const reloadedIndependent = loadShellLayout(independentStorage);
assert.equal(reloadedIndependent.workspaces.World.left.visible, false);
assert.equal(reloadedIndependent.workspaces.World.left.width, 180);
assert.equal(reloadedIndependent.workspaces.World.right.visible, false);
assert.equal(reloadedIndependent.workspaces.Assets.left.visible, false);
assert.equal(reloadedIndependent.workspaces.Assets.right.visible, false);
assert.equal(reloadedIndependent.workspaces.Code.left.tab, 'Source Control');
assert.equal(reloadedIndependent.workspaces.Code.left.width, 300);
assert.equal(reloadedIndependent.workspaces.Playtest.right.tab, 'Build');
assert.equal(reloadedIndependent.workspaces.Playtest.right.width, 500);
assert.equal(reloadedIndependent.activeWorkspace, 'Playtest');

const heightStorage = memoryStorage();
const tallLayout = clone(DEFAULT_SHELL_LAYOUT);
tallLayout.bottom.preferredHeight = 1200;
tallLayout.bottom.collapsed = true;
const savedTall = saveShellLayout(heightStorage, tallLayout);
assert.equal(savedTall.persisted, true);
assert.equal(savedTall.layout.bottom.preferredHeight, 1200);
const derivedSmallViewport = deriveShellLayoutBottomHeight(savedTall.layout.bottom.preferredHeight, 500);
assert.equal(maxShellLayoutBottomHeightForViewport(500), 400);
assert.equal(derivedSmallViewport, 400);
assert.equal(maxShellLayoutBottomHeightForViewport(100), 80);
assert.equal(deriveShellLayoutBottomHeight(1200, 100), 80);
assert.equal(maxShellLayoutBottomHeightForViewport(2160), 1200);
assert.equal(deriveShellLayoutBottomHeight(1200, 2160), 1200);
assert.equal(maxShellLayoutBottomHeightForViewport(0), 0);
assert.equal(maxShellLayoutBottomHeightForViewport(-100), 0);
assert.equal(maxShellLayoutBottomHeightForViewport(Number.NaN), 0);
assert.equal(maxShellLayoutBottomHeightForViewport(Number.POSITIVE_INFINITY), 0);
assert.equal(deriveShellLayoutBottomHeight(179, 2000), 260);
assert.equal(savedTall.layout.bottom.preferredHeight, 1200);
assert.equal(loadShellLayout(heightStorage).bottom.preferredHeight, 1200);
assert.notEqual(derivedSmallViewport, loadShellLayout(heightStorage).bottom.preferredHeight);

const preservedStorage = memoryStorage({
  'shader-forge.unrelated': '{"keep":true}',
  'engine-session-record': 'session-should-remain',
});
assert.equal(saveShellLayout(preservedStorage, authored).persisted, true);
assert.equal(preservedStorage.getItem('shader-forge.unrelated'), '{"keep":true}');
const resetResult = resetShellLayout(preservedStorage);
assert.equal(resetResult.persisted, true);
assertCanonicalDefaults(resetResult.layout);
assert.equal(preservedStorage.getItem(SHELL_LAYOUT_STORAGE_KEY), null);
assert.equal(preservedStorage.getItem('shader-forge.unrelated'), '{"keep":true}');
assert.equal(preservedStorage.getItem('engine-session-record'), 'session-should-remain');
assert.deepEqual(preservedStorage.snapshot(), {
  'shader-forge.unrelated': '{"keep":true}',
  'engine-session-record': 'session-should-remain',
});

const serialized = roundTripStorage.getItem(SHELL_LAYOUT_STORAGE_KEY);
assert.equal(typeof serialized, 'string');
const parsedSerialized = JSON.parse(serialized);
assert.deepEqual(Object.keys(parsedSerialized), ['version', 'activeWorkspace', 'workspaces', 'bottom']);
assert.deepEqual(Object.keys(parsedSerialized.workspaces), ['World', 'Code', 'Playtest', 'Assets']);
assert.deepEqual(Object.keys(parsedSerialized.bottom), ['collapsed', 'tab', 'preferredHeight']);
assert.doesNotMatch(serialized, /sessionId|session-id|credential|password|token|draft|operationId|operation-id|terminalTabs|cwd|workspaceRoot|rootPath|leaseId|agentId/i);
assert.equal(Object.prototype.hasOwnProperty.call(parsedSerialized, 'path'), false);
assert.equal(Object.prototype.hasOwnProperty.call(parsedSerialized.bottom, 'cwd'), false);

console.log('Engine shell layout persistence passed.');
console.log('- Verified typed browser-storage integration and strict v1 layout-only serialization');
console.log('- Verified truthful persistence results across success, absence, and storage failures');
console.log('- Verified proxy-safe validation, per-workspace independence, and bounded viewport derivation');
