/**
 * Pure Shader Forge shell layout persistence.
 * Version 1 stores only chrome layout. It does not store paths, sessions, credentials, drafts, operations, or terminal state.
 */

export const SHELL_LAYOUT_STORAGE_KEY = 'shader-forge.shell-layout.v1';
export const SHELL_LAYOUT_VERSION = 1;
export const SHELL_WORKSPACES = Object.freeze(['World', 'Code', 'Playtest', 'Assets'] as const);
export const SHELL_LEFT_TABS = Object.freeze(['Workspaces', 'Explorer', 'Source Control'] as const);
export const SHELL_RIGHT_TABS = Object.freeze(['Runtime', 'Build', 'Workspace'] as const);
export const SHELL_BOTTOM_TABS = Object.freeze(['Terminal', 'Logs', 'Output', 'Activity'] as const);
export const SHELL_LAYOUT_LEFT_WIDTH_MIN = 180;
export const SHELL_LAYOUT_LEFT_WIDTH_MAX = 480;
export const SHELL_LAYOUT_RIGHT_WIDTH_MIN = 220;
export const SHELL_LAYOUT_RIGHT_WIDTH_MAX = 520;
export const SHELL_LAYOUT_BOTTOM_HEIGHT_MIN = 180;
export const SHELL_LAYOUT_BOTTOM_HEIGHT_MAX = 1200;
export const SHELL_LAYOUT_BOTTOM_VIEWPORT_RATIO = 0.8;
export const SHELL_LAYOUT_BOTTOM_PREFERRED_HEIGHT_DEFAULT = 260;

export type ShellWorkspace = (typeof SHELL_WORKSPACES)[number];
export type ShellLeftTab = (typeof SHELL_LEFT_TABS)[number];
export type ShellRightTab = (typeof SHELL_RIGHT_TABS)[number];
export type ShellBottomTab = (typeof SHELL_BOTTOM_TABS)[number];

export interface ShellLayoutPane<Tab extends string> {
  visible: boolean;
  tab: Tab;
  width: number;
}

export interface ShellWorkspaceLayout {
  left: ShellLayoutPane<ShellLeftTab>;
  right: ShellLayoutPane<ShellRightTab>;
}

export interface ShellLayoutBottom {
  collapsed: boolean;
  tab: ShellBottomTab;
  preferredHeight: number;
}

export interface ShellLayout {
  version: typeof SHELL_LAYOUT_VERSION;
  activeWorkspace: ShellWorkspace;
  workspaces: Record<ShellWorkspace, ShellWorkspaceLayout>;
  bottom: ShellLayoutBottom;
}

export interface ShellLayoutStorage {
  getItem?: (key: string) => unknown;
  setItem?: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
}

export interface ShellLayoutPersistenceResult {
  layout: ShellLayout;
  persisted: boolean;
}

export type ReadonlyShellLayout = DeepReadonly<ShellLayout>;

type DeepReadonly<Value> = Value extends object
  ? { readonly [Key in keyof Value]: DeepReadonly<Value[Key]> }
  : Value;

const ROOT_KEYS = ['version', 'activeWorkspace', 'workspaces', 'bottom'] as const;
const WORKSPACE_KEYS = ['left', 'right'] as const;
const PANE_KEYS = ['visible', 'tab', 'width'] as const;
const BOTTOM_KEYS = ['collapsed', 'tab', 'preferredHeight'] as const;

function deepFreeze<Value>(value: Value): DeepReadonly<Value> {
  if (value === null || typeof value !== 'object') {
    return value as DeepReadonly<Value>;
  }
  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }
  return value as DeepReadonly<Value>;
}

function createDefaultWorkspace(leftVisible = false, rightVisible = false): ShellWorkspaceLayout {
  return {
    left: {
      visible: leftVisible,
      tab: 'Workspaces',
      width: SHELL_LAYOUT_LEFT_WIDTH_MIN,
    },
    right: {
      visible: rightVisible,
      tab: 'Runtime',
      width: SHELL_LAYOUT_RIGHT_WIDTH_MIN,
    },
  };
}

export const DEFAULT_SHELL_LAYOUT: ReadonlyShellLayout = deepFreeze({
  version: SHELL_LAYOUT_VERSION,
  activeWorkspace: 'World',
  workspaces: {
    World: createDefaultWorkspace(false, false),
    Code: createDefaultWorkspace(true, false),
    Playtest: createDefaultWorkspace(false, true),
    Assets: createDefaultWorkspace(false, false),
  },
  bottom: {
    collapsed: true,
    tab: 'Terminal',
    preferredHeight: SHELL_LAYOUT_BOTTOM_PREFERRED_HEIGHT_DEFAULT,
  },
} satisfies ShellLayout);

function cloneShellLayout(value: ShellLayout | ReadonlyShellLayout): ShellLayout {
  return JSON.parse(JSON.stringify(value)) as ShellLayout;
}

function cloneDefaultShellLayout(): ShellLayout {
  return cloneShellLayout(DEFAULT_SHELL_LAYOUT);
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const actual = Object.keys(value);
  return actual.length === keys.length
    && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isAllowedValue<Value extends string>(list: readonly Value[], value: unknown): value is Value {
  return typeof value === 'string' && list.includes(value as Value);
}

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= min
    && value <= max;
}

function toCanonicalPane<Tab extends string>(
  value: unknown,
  tabs: readonly Tab[],
  minWidth: number,
  maxWidth: number,
): ShellLayoutPane<Tab> | null {
  if (!hasExactKeys(value, PANE_KEYS)
    || typeof value.visible !== 'boolean'
    || !isAllowedValue(tabs, value.tab)
    || !isIntegerInRange(value.width, minWidth, maxWidth)) {
    return null;
  }
  return {
    visible: value.visible,
    tab: value.tab,
    width: value.width,
  };
}

function toCanonicalWorkspace(value: unknown): ShellWorkspaceLayout | null {
  if (!hasExactKeys(value, WORKSPACE_KEYS)) {
    return null;
  }
  const left = toCanonicalPane(
    value.left,
    SHELL_LEFT_TABS,
    SHELL_LAYOUT_LEFT_WIDTH_MIN,
    SHELL_LAYOUT_LEFT_WIDTH_MAX,
  );
  const right = toCanonicalPane(
    value.right,
    SHELL_RIGHT_TABS,
    SHELL_LAYOUT_RIGHT_WIDTH_MIN,
    SHELL_LAYOUT_RIGHT_WIDTH_MAX,
  );
  return left && right ? { left, right } : null;
}

function toCanonicalBottom(value: unknown): ShellLayoutBottom | null {
  if (!hasExactKeys(value, BOTTOM_KEYS)
    || typeof value.collapsed !== 'boolean'
    || !isAllowedValue(SHELL_BOTTOM_TABS, value.tab)
    || !isIntegerInRange(
      value.preferredHeight,
      SHELL_LAYOUT_BOTTOM_HEIGHT_MIN,
      SHELL_LAYOUT_BOTTOM_HEIGHT_MAX,
    )) {
    return null;
  }
  return {
    collapsed: value.collapsed,
    tab: value.tab,
    preferredHeight: value.preferredHeight,
  };
}

function toCanonicalShellLayoutUnsafe(value: unknown): ShellLayout | null {
  if (!hasExactKeys(value, ROOT_KEYS)
    || value.version !== SHELL_LAYOUT_VERSION
    || !isAllowedValue(SHELL_WORKSPACES, value.activeWorkspace)
    || !hasExactKeys(value.workspaces, SHELL_WORKSPACES)) {
    return null;
  }
  const world = toCanonicalWorkspace(value.workspaces.World);
  const code = toCanonicalWorkspace(value.workspaces.Code);
  const playtest = toCanonicalWorkspace(value.workspaces.Playtest);
  const assets = toCanonicalWorkspace(value.workspaces.Assets);
  const bottom = toCanonicalBottom(value.bottom);
  if (!world || !code || !playtest || !assets || !bottom) {
    return null;
  }
  return {
    version: SHELL_LAYOUT_VERSION,
    activeWorkspace: value.activeWorkspace,
    workspaces: {
      World: world,
      Code: code,
      Playtest: playtest,
      Assets: assets,
    },
    bottom,
  };
}

function toCanonicalShellLayout(value: unknown): ShellLayout | null {
  try {
    return toCanonicalShellLayoutUnsafe(value);
  } catch {
    return null;
  }
}

function readStorageItem(storage: ShellLayoutStorage | null): unknown {
  try {
    if (!storage || typeof storage.getItem !== 'function') {
      return null;
    }
    return storage.getItem(SHELL_LAYOUT_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function loadShellLayout(storage: ShellLayoutStorage | null = null): ShellLayout {
  const raw = readStorageItem(storage);
  if (typeof raw !== 'string' || raw.length === 0) {
    return cloneDefaultShellLayout();
  }
  try {
    return toCanonicalShellLayout(JSON.parse(raw)) ?? cloneDefaultShellLayout();
  } catch {
    return cloneDefaultShellLayout();
  }
}

export function saveShellLayout(
  storage: ShellLayoutStorage | null,
  layout: unknown,
): ShellLayoutPersistenceResult {
  const canonical = toCanonicalShellLayout(layout);
  if (!canonical) {
    return { layout: cloneDefaultShellLayout(), persisted: false };
  }
  const desired = cloneShellLayout(canonical);
  try {
    if (!storage || typeof storage.setItem !== 'function') {
      return { layout: desired, persisted: false };
    }
    storage.setItem(SHELL_LAYOUT_STORAGE_KEY, JSON.stringify(canonical));
    return { layout: desired, persisted: true };
  } catch {
    return { layout: desired, persisted: false };
  }
}

export function resetShellLayout(storage: ShellLayoutStorage | null = null): ShellLayoutPersistenceResult {
  const layout = cloneDefaultShellLayout();
  try {
    if (!storage || typeof storage.removeItem !== 'function') {
      return { layout, persisted: false };
    }
    storage.removeItem(SHELL_LAYOUT_STORAGE_KEY);
    return { layout, persisted: true };
  } catch {
    return { layout, persisted: false };
  }
}

export function maxShellLayoutBottomHeightForViewport(viewportHeight: number): number {
  const viewport = typeof viewportHeight === 'number' && Number.isFinite(viewportHeight)
    ? Math.max(0, viewportHeight)
    : 0;
  return Math.min(
    SHELL_LAYOUT_BOTTOM_HEIGHT_MAX,
    Math.max(0, Math.floor(viewport * SHELL_LAYOUT_BOTTOM_VIEWPORT_RATIO)),
  );
}

export function deriveShellLayoutBottomHeight(preferredHeight: number, viewportHeight: number): number {
  const preferred = isIntegerInRange(
    preferredHeight,
    SHELL_LAYOUT_BOTTOM_HEIGHT_MIN,
    SHELL_LAYOUT_BOTTOM_HEIGHT_MAX,
  )
    ? preferredHeight
    : SHELL_LAYOUT_BOTTOM_PREFERRED_HEIGHT_DEFAULT;
  return Math.min(preferred, maxShellLayoutBottomHeightForViewport(viewportHeight));
}
