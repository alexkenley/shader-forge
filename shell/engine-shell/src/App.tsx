import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import { useEffect, useEffectEvent, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ReferenceGuideView } from './ReferenceGuideView';
import { SceneEditorView } from './SceneEditorView';
import { SpatialAttachmentEditorView } from './SpatialAttachmentEditorView';
import { ActivityDockView } from './ActivityDockView';
import { CodeWorkspaceView } from './CodeWorkspaceView';
import {
  captureProfile,
  closeTerminal,
  createSession,
  decideCodeTrustApproval,
  deleteSession,
  fetchBuildStatus,
  fetchCodeTrustApprovals,
  fetchCodeTrustSummary,
  fetchGitStatus,
  fetchOperation,
  fetchPackageInspect,
  fetchPlatformInfo,
  fetchProfileCaptures,
  fetchProfileLive,
  fetchSessiondHealth,
  fetchRuntimeStatus,
  getSessiondBaseUrl,
  initGitRepository,
  listHostDirectories,
  listOperations,
  listFiles,
  listSessions,
  openTerminal,
  pauseRuntime,
  readFile,
  restartRuntime,
  resumeRuntime,
  runPackageRelease,
  resizeTerminal,
  startRuntimeBuild,
  startRuntime,
  stopBuild,
  stopRuntime,
  subscribeSessiondEvents,
  transitionOperation,
  transitionCodeTrustArtifact,
  updateSession,
  type CodeTrustApproval,
  type BuildStatus,
  type CodeTrustSummary,
  type PackageInspectSummary,
  type PlatformInfo,
  type ProfilingCaptureList,
  type ProfilingLiveSummary,
  type SessionFileEntry,
  type SessionTerminalOpen,
  type SessiondTerminalEvent,
  type EngineSession,
  type EngineOperation,
  type GitStatus,
  type HostDirectoryList,
  type RuntimeStatus,
  SessiondRequestError,
  engineShellActor,
  writeTerminalInput,
} from './lib/sessiond';
import { engineReferenceGuide } from './reference-guide';
import {
  clampShellLayoutPreferredHeight,
  deriveShellLayoutBottomHeight,
  loadShellLayout,
  maxShellLayoutBottomHeightForViewport,
  resetShellLayout,
  saveShellLayout,
  SHELL_BOTTOM_TABS,
  SHELL_LAYOUT_BOTTOM_HEIGHT_MIN,
  SHELL_LAYOUT_LEFT_WIDTH_MAX,
  SHELL_LAYOUT_LEFT_WIDTH_MIN,
  SHELL_LAYOUT_RIGHT_WIDTH_MAX,
  SHELL_LAYOUT_RIGHT_WIDTH_MIN,
  SHELL_LEFT_TABS,
  SHELL_RIGHT_TABS,
  SHELL_WORKSPACES,
  type ShellBottomTab,
  type ShellLayout,
  type ShellLayoutPane,
  type ShellLayoutStorage,
  type ShellLeftTab,
  type ShellRightTab,
  type ShellWorkspace,
} from './shell-layout';

const leftTabs = SHELL_LEFT_TABS;
const centerTabs = SHELL_WORKSPACES;
const rightTabs = SHELL_RIGHT_TABS;
const bottomTabs = SHELL_BOTTOM_TABS;
const unixShells = ['bash', 'zsh', 'sh'] as const;
const windowsShells = ['powershell.exe', 'cmd.exe'] as const;
const terminalShells = [...unixShells, ...windowsShells] as const;
const buildConfigs = ['Debug', 'Release'] as const;
const legacyWorkspaceSrc = 'web/index.html#/code';
const stoppedRuntimeStatus: RuntimeStatus = {
  state: 'stopped',
  scene: null,
  sessionId: null,
  workspaceRoot: null,
  pid: null,
  startedAt: null,
  pausedAt: null,
  executablePath: null,
  supportsPause: false,
};
const idleBuildStatus: BuildStatus = {
  state: 'idle',
  target: null,
  config: null,
  buildDir: null,
  startedAt: null,
  finishedAt: null,
  command: null,
  exitCode: null,
  error: null,
};
const emptyGitStatus: GitStatus = {
  rootPath: '',
  branch: '',
  staged: [],
  unstaged: [],
  untracked: [],
  notARepo: true,
};
const COLLAPSED_BOTTOM_PANE_HEIGHT = 38;
const SHELL_RAIL_RESIZE_STEP = 16;
const SHELL_LAYOUT_CENTER_WIDTH_MIN = 360;
const SHELL_LAYOUT_NARROW_WIDTH_MAX = 800;
const SHELL_LAYOUT_SEPARATOR_WIDTH = 5;

type LeftTab = ShellLeftTab;
type CenterTab = ShellWorkspace;
type RightTab = ShellRightTab;
type BottomTab = ShellBottomTab;
type ShellResizeTarget = 'left' | 'right' | 'bottom';
type TerminalShell = (typeof terminalShells)[number];
type BuildConfig = (typeof buildConfigs)[number];

interface ShellPaneRange {
  min: number;
  max: number;
  width: number;
}

interface ShellPaneGeometry {
  left: ShellPaneRange;
  right: ShellPaneRange;
  narrow: boolean;
}

type TerminalTabState = {
  id: string;
  title: string;
  shell: TerminalShell;
  cwd: string;
  runtimeTerminalId: string | null;
  status: 'connecting' | 'connected' | 'error';
  openError: string;
  output: string;
  cols: number;
  rows: number;
};

type ViewerBridgeEvent = {
  id: string;
  title: string;
  detail: string;
  at: string;
  tone: 'active' | 'paused' | 'error' | 'idle';
};

type TerminalDockProps = {
  tabs: TerminalTabState[];
  activeTabId: string;
  activeSession: EngineSession | null;
  availableShells: TerminalShell[];
  onActivateTab: (tabId: string) => void;
  onAddTab: () => void;
  onCloseTab: (tabId: string) => void;
  onChangeShell: (tabId: string, shell: TerminalShell) => void;
  onClearTab: (tabId: string) => void;
  onTerminalInput: (tabId: string, input: string) => void;
  onTerminalResize: (tabId: string, cols: number, rows: number) => void;
};

function TabButton({
  active,
  children,
  controls,
  id,
  onClick,
  tabId,
}: {
  active: boolean;
  children: string;
  controls?: string;
  id?: string;
  onClick: () => void;
  tabId?: string;
}) {
  return (
    <button
      aria-controls={controls}
      aria-selected={active}
      className={`pill-button${active ? ' is-active' : ''}`}
      data-tab-id={tabId ?? children}
      id={id}
      onClick={onClick}
      role="tab"
      tabIndex={active ? 0 : -1}
      type="button"
    >
      {children}
    </button>
  );
}

function handleTabListKeyDown<T extends string>(
  event: ReactKeyboardEvent<HTMLElement>,
  tabs: readonly T[],
  active: T,
  onChange: (tab: T) => void,
) {
  const currentIndex = tabs.indexOf(active);
  if (currentIndex < 0) {
    return;
  }

  let nextIndex = currentIndex;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    nextIndex = (currentIndex + 1) % tabs.length;
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  } else if (event.key === 'Home') {
    nextIndex = 0;
  } else if (event.key === 'End') {
    nextIndex = tabs.length - 1;
  } else {
    return;
  }

  event.preventDefault();
  const next = tabs[nextIndex];
  onChange(next);
  const button = event.currentTarget.querySelector<HTMLElement>(`[data-tab-id="${next}"]`);
  button?.focus();
}

function formatSessionTimestamp(value: string) {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return value;
  }
  return timestamp.toLocaleString();
}

function formatFileSize(bytes: number) {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (bytes >= 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${bytes} B`;
}

const harnessSessionNamePatterns = [/^viewer-bridge(?:-|$)/i, /^scene-authoring(?:-|$)/i];

function getPathLeaf(value: string) {
  const parts = String(value || '')
    .split(/[\\/]+/)
    .filter(Boolean);
  return parts[parts.length - 1] || value;
}

function isHarnessSessionRoot(rootPath: string) {
  return /(?:^|[\\/])(?:tmp|temp)(?:[\\/]|$)/i.test(rootPath) && /shader-forge-/i.test(rootPath);
}

function isHarnessSession(session: EngineSession) {
  return (
    harnessSessionNamePatterns.some((pattern) => pattern.test(session.name))
    || isHarnessSessionRoot(session.rootPath)
  );
}

function pickPreferredSessionId(sessions: EngineSession[], currentSessionId = '') {
  const activeWorkspace = sessions.find(
    (session) => session.id === currentSessionId && !isHarnessSession(session),
  );
  if (activeWorkspace) {
    return activeWorkspace.id;
  }

  const firstWorkspace = sessions.find((session) => !isHarnessSession(session));
  if (firstWorkspace) {
    return firstWorkspace.id;
  }

  return sessions[0]?.id || '';
}

function findSuggestedWorkspaceSession(sessions: EngineSession[]) {
  return (
    sessions.find(
      (session) =>
        isHarnessSession(session)
        && !isHarnessSessionRoot(session.rootPath),
    ) || null
  );
}

function getParentExplorerPath(value: string) {
  if (!value || value === '.') {
    return '.';
  }
  const parts = value.split('/').filter(Boolean);
  if (parts.length <= 1) {
    return '.';
  }
  return parts.slice(0, -1).join('/');
}

function getParentHostPath(value: string) {
  const normalized = String(value || '').trim() || '/';
  if (normalized === '/' || !normalized.includes('/')) {
    return '/';
  }
  const trimmed = normalized.endsWith('/') && normalized !== '/' ? normalized.slice(0, -1) : normalized;
  const lastSlashIndex = trimmed.lastIndexOf('/');
  if (lastSlashIndex <= 0) {
    return '/';
  }
  return trimmed.slice(0, lastSlashIndex);
}

function trimTerminalOutput(value: string) {
  const maxLength = 120000;
  if (value.length <= maxLength) {
    return value;
  }
  return value.slice(-maxLength);
}

function getBrowserShellLayoutStorage(): ShellLayoutStorage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function getBrowserViewportHeight(): number {
  if (typeof window === 'undefined') {
    return 0;
  }
  try {
    return window.innerHeight;
  } catch {
    return 0;
  }
}

function getBrowserViewportWidth(): number {
  if (typeof window === 'undefined') {
    return 0;
  }
  try {
    return window.innerWidth;
  } catch {
    return 0;
  }
}

function loadBrowserShellLayout(): ShellLayout {
  if (typeof window === 'undefined') {
    return loadShellLayout(null);
  }
  try {
    return loadShellLayout(window.localStorage);
  } catch {
    return loadShellLayout(null);
  }
}

function withActiveWorkspacePane(
  layout: ShellLayout,
  patch: {
    left?: Partial<ShellLayoutPane<ShellLeftTab>>;
    right?: Partial<ShellLayoutPane<ShellRightTab>>;
  },
): ShellLayout {
  const workspace = layout.activeWorkspace;
  const current = layout.workspaces[workspace];
  return {
    ...layout,
    workspaces: {
      ...layout.workspaces,
      [workspace]: {
        left: patch.left ? { ...current.left, ...patch.left } : current.left,
        right: patch.right ? { ...current.right, ...patch.right } : current.right,
      },
    },
  };
}

function withBottomLayout(
  layout: ShellLayout,
  patch: Partial<ShellLayout['bottom']>,
): ShellLayout {
  return {
    ...layout,
    bottom: {
      ...layout.bottom,
      ...patch,
    },
  };
}

function shellGridClass(leftVisible: boolean, rightVisible: boolean): string {
  if (leftVisible && rightVisible) {
    return 'shell-grid--both';
  }
  if (leftVisible) {
    return 'shell-grid--left';
  }
  if (rightVisible) {
    return 'shell-grid--right';
  }
  return 'shell-grid--center';
}

function clampShellPaneWidth(width: number, min: number, max: number): number {
  const safeMax = Math.max(min, Math.floor(max));
  const rounded = typeof width === 'number' && Number.isFinite(width)
    ? Math.round(width)
    : min;
  return Math.max(min, Math.min(safeMax, rounded));
}

function deriveShellPaneGeometry(
  gridWidth: number,
  leftVisible: boolean,
  rightVisible: boolean,
  leftPreferredWidth: number,
  rightPreferredWidth: number,
): ShellPaneGeometry {
  const normalizedGridWidth = typeof gridWidth === 'number' && Number.isFinite(gridWidth)
    ? Math.max(0, Math.floor(gridWidth))
    : 0;
  const leftPreferred = clampShellPaneWidth(
    leftPreferredWidth,
    SHELL_LAYOUT_LEFT_WIDTH_MIN,
    SHELL_LAYOUT_LEFT_WIDTH_MAX,
  );
  const rightPreferred = clampShellPaneWidth(
    rightPreferredWidth,
    SHELL_LAYOUT_RIGHT_WIDTH_MIN,
    SHELL_LAYOUT_RIGHT_WIDTH_MAX,
  );
  const narrow = normalizedGridWidth <= SHELL_LAYOUT_NARROW_WIDTH_MAX;

  if (narrow) {
    return {
      left: {
        min: SHELL_LAYOUT_LEFT_WIDTH_MIN,
        max: SHELL_LAYOUT_LEFT_WIDTH_MAX,
        width: leftPreferred,
      },
      right: {
        min: SHELL_LAYOUT_RIGHT_WIDTH_MIN,
        max: SHELL_LAYOUT_RIGHT_WIDTH_MAX,
        width: rightPreferred,
      },
      narrow,
    };
  }

  const separatorCount = Number(leftVisible) + Number(rightVisible);
  const railBudget = Math.max(
    0,
    normalizedGridWidth
      - SHELL_LAYOUT_CENTER_WIDTH_MIN
      - separatorCount * SHELL_LAYOUT_SEPARATOR_WIDTH,
  );
  const provisionalLeftMax = leftVisible
    ? Math.max(
        SHELL_LAYOUT_LEFT_WIDTH_MIN,
        Math.min(
          SHELL_LAYOUT_LEFT_WIDTH_MAX,
          railBudget - (rightVisible ? SHELL_LAYOUT_RIGHT_WIDTH_MIN : 0),
        ),
      )
    : SHELL_LAYOUT_LEFT_WIDTH_MAX;
  const leftWidth = leftVisible
    ? clampShellPaneWidth(leftPreferred, SHELL_LAYOUT_LEFT_WIDTH_MIN, provisionalLeftMax)
    : leftPreferred;
  const rightMax = rightVisible
    ? Math.max(
        SHELL_LAYOUT_RIGHT_WIDTH_MIN,
        Math.min(
          SHELL_LAYOUT_RIGHT_WIDTH_MAX,
          railBudget - (leftVisible ? leftWidth : 0),
        ),
      )
    : SHELL_LAYOUT_RIGHT_WIDTH_MAX;
  const rightWidth = rightVisible
    ? clampShellPaneWidth(rightPreferred, SHELL_LAYOUT_RIGHT_WIDTH_MIN, rightMax)
    : rightPreferred;
  const leftMax = leftVisible
    ? Math.max(
        SHELL_LAYOUT_LEFT_WIDTH_MIN,
        Math.min(
          SHELL_LAYOUT_LEFT_WIDTH_MAX,
          railBudget - (rightVisible ? rightWidth : 0),
        ),
      )
    : SHELL_LAYOUT_LEFT_WIDTH_MAX;

  return {
    left: {
      min: SHELL_LAYOUT_LEFT_WIDTH_MIN,
      max: leftMax,
      width: clampShellPaneWidth(leftWidth, SHELL_LAYOUT_LEFT_WIDTH_MIN, leftMax),
    },
    right: {
      min: SHELL_LAYOUT_RIGHT_WIDTH_MIN,
      max: rightMax,
      width: rightWidth,
    },
    narrow,
  };
}

function effectiveShellBottomMinHeight(maxHeight: number): number {
  const normalizedMax = typeof maxHeight === 'number' && Number.isFinite(maxHeight)
    ? Math.max(0, Math.floor(maxHeight))
    : 0;
  return Math.min(SHELL_LAYOUT_BOTTOM_HEIGHT_MIN, normalizedMax);
}

function preferredShellBottomHeightForRenderedHeight(
  renderedHeight: number,
  maxHeight: number,
  currentPreferredHeight: number,
): number {
  const normalizedMax = typeof maxHeight === 'number' && Number.isFinite(maxHeight)
    ? Math.max(0, Math.floor(maxHeight))
    : 0;
  const normalizedCurrent = clampShellLayoutPreferredHeight(currentPreferredHeight);
  if (normalizedMax < SHELL_LAYOUT_BOTTOM_HEIGHT_MIN) {
    return normalizedCurrent;
  }
  const nextPreferred = clampShellLayoutPreferredHeight(
    Math.max(
      SHELL_LAYOUT_BOTTOM_HEIGHT_MIN,
      Math.min(normalizedMax, renderedHeight),
    ),
  );
  const currentRendered = Math.min(normalizedCurrent, normalizedMax);
  return nextPreferred === currentRendered ? normalizedCurrent : nextPreferred;
}

function takeLastLogLines(value: string, count = 6) {
  const lines = value
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line, index, all) => line.length > 0 || index < all.length - 1)
    .filter((line) => line.length > 0);
  if (!lines.length) {
    return '[no log output yet]';
  }
  return lines.slice(-count).join('\n');
}

function appendViewerBridgeEvent(
  current: ViewerBridgeEvent[],
  event: Omit<ViewerBridgeEvent, 'id'>,
) {
  return [
    {
      ...event,
      id: `${event.at}-${current.length}-${Math.random().toString(16).slice(2, 8)}`,
    },
    ...current,
  ].slice(0, 12);
}

function buildStatusTone(state: BuildStatus['state']): ViewerBridgeEvent['tone'] {
  if (state === 'running' || state === 'succeeded') {
    return 'active';
  }
  if (state === 'failed') {
    return 'error';
  }
  return 'idle';
}

function runtimeStateTone(state: RuntimeStatus['state']) {
  if (state === 'running') {
    return 'active';
  }
  if (state === 'paused') {
    return 'paused';
  }
  return 'idle';
}

function runtimeStateLabel(state: RuntimeStatus['state']) {
  if (state === 'running') {
    return 'Running';
  }
  if (state === 'paused') {
    return 'Paused';
  }
  return 'Stopped';
}

function buildStateLabel(state: BuildStatus['state']) {
  if (state === 'running') {
    return 'Running';
  }
  if (state === 'succeeded') {
    return 'Succeeded';
  }
  if (state === 'failed') {
    return 'Failed';
  }
  if (state === 'stopped') {
    return 'Stopped';
  }
  return 'Idle';
}

function buildSetupHint(errorMessage: string | null) {
  const message = String(errorMessage || '');
  if (/cmake is required/i.test(message)) {
    return 'Play needs CMake. The clean-start scripts auto-detect common installs and export SHADER_FORGE_CMAKE when possible. If it still fails, install CMake or add it to PATH. If the runtime binary already exists under build/runtime/bin, use Run existing build in Diagnostics.';
  }
  return '';
}

function nativeRuntimeSetupHint(buildLog: string, runtimeLog: string) {
  const combined = `${buildLog}\n${runtimeLog}`;
  if (
    /Vulkan support is either not configured in SDL/i.test(combined)
    || /No dynamic Vulkan support/i.test(combined)
  ) {
    return 'The native runtime found SDL3, but that SDL3 build does not include Vulkan window support. On Windows, rerun .\\scripts\\install-windows-native-runtime-deps.ps1 so vcpkg installs or rebuilds sdl3[vulkan]:x64-windows with --recurse, then rebuild.';
  }
  if (
    /SDL3 was not found/i.test(combined)
    || /Vulkan was not found/i.test(combined)
    || /built in stub mode/i.test(combined)
  ) {
    return 'The native runtime is still building in stub mode. Visual Studio CMake is working, but SDL3 development files and the Vulkan SDK/loader were not found. Install those native dependencies and rebuild.';
  }
  return '';
}

async function copyTextToClipboard(text: string) {
  if (!text) {
    return;
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

async function readClipboardTextFromEvent(event?: ClipboardEvent | InputEvent | KeyboardEvent) {
  const directText = event && 'clipboardData' in event ? event.clipboardData?.getData?.('text/plain') : '';
  if (typeof directText === 'string' && directText.length > 0) {
    return directText;
  }
  if (navigator.clipboard?.readText) {
    try {
      return await navigator.clipboard.readText();
    } catch {
      return '';
    }
  }
  return '';
}

function isClipboardPasteSentinel(text: string) {
  return text === '^V' || text === '\u0016';
}

function shouldBridgeTerminalTextInput(event?: InputEvent, text = '') {
  const inputType = String(event?.inputType || '');
  if (inputType === 'insertFromPaste' || inputType === 'insertFromDrop' || inputType === 'insertReplacementText') {
    return true;
  }

  const candidate = typeof text === 'string' && text
    ? text
    : typeof event?.data === 'string'
      ? event.data
      : '';

  if (!candidate) {
    return false;
  }
  if (isClipboardPasteSentinel(candidate)) {
    return true;
  }
  if (/[\r\n\t]/.test(candidate)) {
    return true;
  }
  return candidate.length >= 4;
}

async function forwardTerminalPaste(
  event: ClipboardEvent | InputEvent | KeyboardEvent,
  writeInput: (text: string) => void,
) {
  const text = await readClipboardTextFromEvent(event);
  if (!text) {
    return;
  }
  writeInput(text);
}

async function forwardTerminalInsertedText(
  event: ClipboardEvent | InputEvent | KeyboardEvent,
  writeInput: (text: string) => void,
  text = '',
) {
  if (!text || isClipboardPasteSentinel(text)) {
    await forwardTerminalPaste(event, writeInput);
    return;
  }
  writeInput(text);
}

function createTerminalTab(index: number, defaultShell: TerminalShell = 'bash'): TerminalTabState {
  return {
    id: crypto.randomUUID(),
    title: `Terminal ${index}`,
    shell: defaultShell,
    cwd: '.',
    runtimeTerminalId: null,
    status: 'connecting',
    openError: '',
    output: '',
    cols: 120,
    rows: 30,
  };
}

function renderRightPanel(
  activeTab: RightTab,
  activeSession: EngineSession | null,
  packageSummary: PackageInspectSummary | null,
  packageBusy: boolean,
  profileSummary: ProfilingLiveSummary | null,
  profileCaptureList: ProfilingCaptureList | null,
  profileBusy: boolean,
  codeTrustSummary: CodeTrustSummary | null,
  codeTrustApprovals: CodeTrustApproval[],
  approvalsBusy: boolean,
  approvalActionId: string,
  artifactActionPath: string,
  runtimeStatus: RuntimeStatus,
  buildStatus: BuildStatus,
  buildLog: string,
  runtimeLog: string,
  launchScene: string,
  buildConfig: BuildConfig,
  buildDir: string,
  pendingRunAfterBuild: boolean,
  onLaunchSceneChange: (value: string) => void,
  onBuildConfigChange: (value: BuildConfig) => void,
  onBuildDirChange: (value: string) => void,
  onStartRuntimeBuild: () => void,
  onBuildAndPlay: () => void,
  onStopBuild: () => void,
  onStartRuntime: () => void,
  onStopRuntime: () => void,
  onRestartRuntime: () => void,
  onPauseRuntime: () => void,
  onResumeRuntime: () => void,
  onRefreshPackaging: () => void,
  onRunPackaging: () => void,
  onRefreshProfile: () => void,
  onCaptureProfile: () => void,
  onRefreshApprovals: () => void,
  onDecideApproval: (approvalId: string, decision: 'approved' | 'denied') => void,
  onTransitionArtifact: (path: string, transition: 'promote' | 'quarantine') => void,
) {
  const buildHint = buildSetupHint(buildStatus.error);
  const runtimeHint = nativeRuntimeSetupHint(buildLog, runtimeLog);
  const unsafeOverrideCount = codeTrustSummary
    ? Object.values(codeTrustSummary.unsafeDevOverrides).filter(Boolean).length
    : 0;

  if (activeTab === 'Workspace') {
    return (
      <div className="stack">
        <section className="card compact-card">
          <div className="section-titlebar">
            <h3>Workspace</h3>
            <span>{activeSession ? 'Workspace-backed' : 'No workspace'}</span>
          </div>
          <dl className="fact-list">
            <div>
              <dt>Workspace</dt>
              <dd>{activeSession?.name || 'none selected'}</dd>
            </div>
            <div>
              <dt>Root</dt>
              <dd>{activeSession?.rootPath || 'Select a workspace from the left rail'}</dd>
            </div>
            <div>
              <dt>Run scene</dt>
              <dd>{launchScene}</dd>
            </div>
            <div>
              <dt>Runtime scene</dt>
              <dd>{runtimeStatus.scene || launchScene}</dd>
            </div>
            <div>
              <dt>Runtime root</dt>
              <dd>{runtimeStatus.workspaceRoot || activeSession?.rootPath || 'repo default'}</dd>
            </div>
            <div>
              <dt>Runtime state</dt>
              <dd>{runtimeStateLabel(runtimeStatus.state)}</dd>
            </div>
            <div>
              <dt>Build state</dt>
              <dd>{buildStateLabel(buildStatus.state)}</dd>
            </div>
            <div>
              <dt>Build dir</dt>
              <dd>{buildStatus.buildDir || buildDir}</dd>
            </div>
            <div>
              <dt>Config</dt>
              <dd>{buildStatus.config || buildConfig}</dd>
            </div>
          </dl>
        </section>
        <section className="card compact-card">
          <div className="section-titlebar">
            <h3>Release Packaging</h3>
            <span>
              {packageSummary
                ? packageSummary.ready
                  ? 'Ready'
                  : 'Needs prep'
                : 'No workspace preset'}
            </span>
          </div>
          <p className="panel-copy">
            {packageSummary
              ? 'Phase 6.2 now exposes a text-backed export preset, release-layout inspection, deterministic package generation, and safe auto-bake preparation when cooked outputs are missing. The current launchers bundle cooked outputs, but still run against packaged authored roots until cooked-runtime loading lands.'
              : 'Select a workspace to inspect the default export preset and generate the first reproducible release layout.'}
          </p>
          {packageSummary ? (
            <>
              <dl className="fact-list">
                <div>
                  <dt>Preset</dt>
                  <dd>{`${packageSummary.label} (${packageSummary.presetId})`}</dd>
                </div>
                <div>
                  <dt>Preset source</dt>
                  <dd>{packageSummary.presetSource}</dd>
                </div>
                <div>
                  <dt>Scene</dt>
                  <dd>{packageSummary.launchScene}</dd>
                </div>
                <div>
                  <dt>Config</dt>
                  <dd>{packageSummary.runtimeConfig}</dd>
                </div>
                <div>
                  <dt>Runtime</dt>
                  <dd>{packageSummary.runtimeBinaryExists ? packageSummary.runtimeBinaryPath : `missing · ${packageSummary.runtimeBinaryPath}`}</dd>
                </div>
                <div>
                  <dt>Cooked</dt>
                  <dd>{packageSummary.cookedRootExists ? `${packageSummary.cookedAssetCount} assets` : `missing · ${packageSummary.cookedRootPath}`}</dd>
                </div>
                <div>
                  <dt>Package root</dt>
                  <dd>{packageSummary.packageRootPath}</dd>
                </div>
                <div>
                  <dt>Hooks</dt>
                  <dd>{packageSummary.platformHooks.join(', ') || 'none declared'}</dd>
                </div>
                <div>
                  <dt>Prep</dt>
                  <dd>
                    {packageSummary.needsRuntimeBuild && packageSummary.needsAssetBake
                      ? 'runtime build + asset bake required'
                      : packageSummary.needsRuntimeBuild
                        ? 'runtime build required'
                        : packageSummary.needsAssetBake
                          ? 'asset bake required'
                          : 'none'}
                  </dd>
                </div>
                <div>
                  <dt>Last package</dt>
                  <dd>{packageSummary.lastPackageAt ? `${formatSessionTimestamp(packageSummary.lastPackageAt)} · ${packageSummary.lastPackageFileCount} files` : 'not packaged yet'}</dd>
                </div>
              </dl>
              <div className="inline-actions">
                <button className="ghost-button ghost-button--sm" disabled={!activeSession || packageBusy} onClick={onRefreshPackaging} type="button">
                  {packageBusy ? 'Working...' : 'Inspect export'}
                </button>
                <button className="ghost-button ghost-button--sm" disabled={!activeSession || packageBusy} onClick={onRunPackaging} type="button">
                  {packageBusy ? 'Working...' : 'Package release'}
                </button>
              </div>
              {packageSummary.needsAssetBake || packageSummary.needsRuntimeBuild || packageSummary.warnings.length ? (
                <div className="metric-stack">
                  {packageSummary.needsAssetBake ? (
                    <article className="mini-card">
                      <span>Auto prep</span>
                      <strong>{`Package release will bake missing cooked outputs into ${packageSummary.cookedRootPath}.`}</strong>
                    </article>
                  ) : null}
                  {packageSummary.needsRuntimeBuild ? (
                    <article className="mini-card">
                      <span>Manual prep</span>
                      <strong>{`Build the runtime binary at ${packageSummary.runtimeBinaryPath} before packaging can succeed.`}</strong>
                    </article>
                  ) : null}
                  {packageSummary.warnings.slice(0, 2).map((warning) => (
                    <article className="mini-card" key={warning}>
                      <span>Packaging warning</span>
                      <strong>{warning}</strong>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="panel-copy">
                  Runtime binary, authored runtime roots, and cooked outputs are all present for the current default package preset.
                </p>
              )}
            </>
          ) : null}
        </section>
        <section className="card compact-card">
          <div className="section-titlebar">
            <h3>Profiling</h3>
            <span aria-label={profileSummary ? `Runtime ${profileSummary.runtime.state}` : 'No live snapshot'}>
              {profileSummary ? `${profileSummary.runtime.state} runtime` : 'No live snapshot'}
            </span>
          </div>
          <p className="panel-copy">
            {profileSummary
              ? 'Phase 6.3 now exposes a live diagnostic snapshot plus capture-report workflow from sessiond. This slice records runtime/build state, recent logs, git state, AI/code-trust summary, and package readiness; Tracy, RenderDoc, and native panels are still ahead.'
              : 'Select a workspace to inspect live diagnostics and capture a first profiling report.'}
          </p>
          {profileSummary ? (
            <>
              <dl className="fact-list">
                <div>
                  <dt>Runtime</dt>
                  <dd>{profileSummary.runtime.state}</dd>
                </div>
                <div>
                  <dt>Scene</dt>
                  <dd>{profileSummary.runtime.scene || launchScene}</dd>
                </div>
                <div>
                  <dt>Build</dt>
                  <dd>{profileSummary.build.state}</dd>
                </div>
                <div>
                  <dt>Git</dt>
                  <dd>{profileSummary.workspace.git.notARepo ? 'not a repo' : `${profileSummary.workspace.git.branch || 'detached'} · ${profileSummary.workspace.git.stagedCount}/${profileSummary.workspace.git.unstagedCount}/${profileSummary.workspace.git.untrackedCount}`}</dd>
                </div>
                <div>
                  <dt>Package</dt>
                  <dd>{profileSummary.workspace.packaging.ready ? 'ready' : 'needs prep'}</dd>
                </div>
                <div>
                  <dt>Trust</dt>
                  <dd>{`${profileSummary.workspace.codeTrust.trackedArtifactCount} tracked · ${profileSummary.workspace.codeTrust.verificationIssueCount} verify issues`}</dd>
                </div>
                <div>
                  <dt>Snapshot</dt>
                  <dd>{formatSessionTimestamp(profileSummary.capturedAt)}</dd>
                </div>
              </dl>
              <div className="inline-actions">
                <button className="ghost-button ghost-button--sm" disabled={!activeSession || profileBusy} onClick={onRefreshProfile} type="button">
                  {profileBusy ? 'Working...' : 'Refresh live'}
                </button>
                <button className="ghost-button ghost-button--sm" disabled={!activeSession || profileBusy} onClick={onCaptureProfile} type="button">
                  {profileBusy ? 'Working...' : 'Capture report'}
                </button>
              </div>
              <div className="metric-stack">
                <article className="mini-card">
                  <span>Recent logs</span>
                  <strong>{`${profileSummary.runtime.logLineCount} runtime lines · ${profileSummary.build.logLineCount} build lines`}</strong>
                  <p>{profileSummary.workspace.packaging.ready ? `Release layout ready at ${profileSummary.workspace.packaging.packageRootPath}` : 'Complete build, bake, and package prerequisites before release-flow manual testing.'}</p>
                </article>
                {profileCaptureList?.captures.length ? (
                  <article className="mini-card">
                    <span>Recent captures</span>
                    <strong>{`${profileCaptureList.captureCount} stored under ${profileCaptureList.captureRootPath}`}</strong>
                    <p>{profileCaptureList.captures.slice(0, 2).map((capture) => `${capture.label} · ${formatSessionTimestamp(capture.capturedAt)}`).join(' | ')}</p>
                  </article>
                ) : null}
                {profileSummary.recommendations.slice(0, 2).map((recommendation) => (
                  <article className="mini-card" key={recommendation}>
                    <span>Recommendation</span>
                    <strong>{recommendation}</strong>
                  </article>
                ))}
              </div>
            </>
          ) : null}
        </section>
        <section className="card compact-card">
          <div className="section-titlebar">
            <h3>Code Trust</h3>
            <span>{codeTrustSummary ? 'Policy active' : 'No workspace policy'}</span>
          </div>
          <p className="panel-copy">
            {codeTrustSummary
              ? codeTrustSummary.summary
              : 'Select a workspace to inspect the current code-trust policy, supported hot-reload roots, and tracked artifact origins.'}
          </p>
          {codeTrustSummary ? (
            <>
              <dl className="fact-list">
                <div>
                  <dt>Policy</dt>
                  <dd>{codeTrustSummary.policyPath}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd>{codeTrustSummary.policySource}</dd>
                </div>
                <div>
                  <dt>Overrides</dt>
                  <dd>{unsafeOverrideCount > 0 ? `${unsafeOverrideCount} active` : 'none active'}</dd>
                </div>
                <div>
                  <dt>Tracked</dt>
                  <dd>{codeTrustSummary.trackedArtifactCount} artifacts</dd>
                </div>
                <div>
                  <dt>Promoted</dt>
                  <dd>{codeTrustSummary.promotedArtifactCount}</dd>
                </div>
                <div>
                  <dt>Quarantined</dt>
                  <dd>{codeTrustSummary.quarantinedArtifactCount}</dd>
                </div>
                <div>
                  <dt>Verify</dt>
                  <dd>{codeTrustSummary.verificationIssueCount ? `${codeTrustSummary.verificationIssueCount} issues` : 'clean'}</dd>
                </div>
                <div>
                  <dt>Hot reload</dt>
                  <dd>{codeTrustSummary.supportedHotReloadRoots.join(', ') || 'none'}</dd>
                </div>
              </dl>
              {codeTrustSummary.trackedArtifacts.length ? (
                <div className="metric-stack">
                  {codeTrustSummary.trackedArtifacts.slice(0, 3).map((artifact) => (
                    <article className="mini-card" key={artifact.path}>
                      <span>{`${artifact.origin} -> ${artifact.targetTier} · ${artifact.promotionStatus}`}</span>
                      <strong>{artifact.path}</strong>
                      <p>{`${artifact.verificationStatus}${artifact.contentHash ? ` · ${artifact.contentHash.slice(0, 12)}` : ''}`}</p>
                      <p>{artifact.lastAction} · {formatSessionTimestamp(artifact.updatedAt)}</p>
                      {artifact.promotionNote ? <p>{artifact.promotionNote}</p> : null}
                      {artifact.quarantineNote ? <p>{artifact.quarantineNote}</p> : null}
                      <div className="inline-actions">
                        <button
                          className="ghost-button ghost-button--sm"
                          disabled={
                            !activeSession
                            || artifactActionPath === artifact.path
                            || (artifact.promotionStatus === 'promoted' && artifact.verificationStatus === 'verified')
                          }
                          onClick={() => onTransitionArtifact(artifact.path, 'promote')}
                          type="button"
                        >
                          Promote
                        </button>
                        <button
                          className="ghost-button ghost-button--sm"
                          disabled={!activeSession || artifactActionPath === artifact.path || artifact.promotionStatus === 'quarantined'}
                          onClick={() => onTransitionArtifact(artifact.path, 'quarantine')}
                          type="button"
                        >
                          Quarantine
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="panel-copy">
                  No tracked assistant or code-path artifacts have been recorded for this workspace yet.
                </p>
              )}
              <div className="section-titlebar">
                <h3>Pending Reviews</h3>
                <span>{approvalsBusy ? 'Refreshing' : `${codeTrustApprovals.length} pending`}</span>
              </div>
              <div className="inline-actions">
                <button className="ghost-button ghost-button--sm" disabled={!activeSession || approvalsBusy} onClick={onRefreshApprovals} type="button">
                  Refresh approvals
                </button>
              </div>
              {codeTrustApprovals.length ? (
                <div className="metric-stack">
                  {codeTrustApprovals.map((approval) => (
                    <article className="mini-card" key={approval.id}>
                      <span>{approval.operationType.replace(/_/g, ' ')} · {approval.codeTrust?.decision || approval.status}</span>
                      <strong>{approval.summary}</strong>
                      <p>{approval.codeTrust?.path || approval.codeTrust?.action || 'engine scope'}</p>
                      <p>{approval.codeTrust?.diagnostics?.[0]?.message || 'Review required before the action can execute.'}</p>
                      <p>{formatSessionTimestamp(approval.createdAt)}</p>
                      <div className="inline-actions">
                        <button
                          className="ghost-button ghost-button--sm"
                          disabled={approvalActionId === approval.id}
                          onClick={() => onDecideApproval(approval.id, 'approved')}
                          type="button"
                        >
                          Approve
                        </button>
                        <button
                          className="ghost-button ghost-button--sm"
                          disabled={approvalActionId === approval.id}
                          onClick={() => onDecideApproval(approval.id, 'denied')}
                          type="button"
                        >
                          Deny
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="panel-copy">
                  No pending code-trust approvals for this workspace or the shared engine lane.
                </p>
              )}
            </>
          ) : null}
        </section>
        <section className="card compact-card">
          <div className="section-titlebar">
            <h3>Layout Rules</h3>
            <span>Current shell</span>
          </div>
          <p className="panel-copy">
            `World` is for level authoring. `Playtest` shows and controls the external native runtime.
            The bottom dock is for terminals, logs, and utility output.
          </p>
        </section>
      </div>
    );
  }

  if (activeTab === 'Build') {
    return (
      <div className="stack">
        <section className="card compact-card">
          <div className="section-titlebar">
            <h3>Build</h3>
            <span
              aria-label={`Build ${buildStateLabel(buildStatus.state)}`}
              className={`status-dot status-dot--${buildStatus.state === 'running' ? 'active' : buildStatus.state === 'failed' ? 'error' : 'idle'}`}
              role="img"
            />
          </div>
          <div className="form-grid">
            <label className="form-field">
              <span>Config</span>
              <select onChange={(event) => onBuildConfigChange(event.target.value as BuildConfig)} value={buildConfig}>
                {buildConfigs.map((config) => (
                  <option key={config} value={config}>
                    {config}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              <span>Build dir</span>
              <input onChange={(event) => onBuildDirChange(event.target.value)} type="text" value={buildDir} />
            </label>
          </div>
          <div className="inline-actions">
            <button className="ghost-button ghost-button--sm" disabled={buildStatus.state === 'running'} onClick={onStartRuntimeBuild} type="button">
              Build
            </button>
            <button className="ghost-button ghost-button--sm" disabled={buildStatus.state === 'running'} onClick={onBuildAndPlay} type="button">
              Build + Run
            </button>
            <button className="ghost-button ghost-button--sm" disabled={buildStatus.state !== 'running'} onClick={onStopBuild} type="button">
              Stop
            </button>
          </div>
          {buildHint ? (
            <div className="setup-hint">
              <strong>Build Setup Required</strong>
              <span>{buildHint}</span>
            </div>
          ) : null}
          {!buildHint && runtimeHint ? (
            <div className="setup-hint">
              <strong>Native Runtime Setup Required</strong>
              <span>{runtimeHint}</span>
            </div>
          ) : null}
        </section>
        <section className="card compact-card">
          <dl className="fact-list">
            <div>
              <dt>State</dt>
              <dd>{buildStatus.state}</dd>
            </div>
            <div>
              <dt>Target</dt>
              <dd>{buildStatus.target || 'runtime'}</dd>
            </div>
            <div>
              <dt>Command</dt>
              <dd>{buildStatus.command || 'waiting'}</dd>
            </div>
            {pendingRunAfterBuild ? (
              <div>
                <dt>Queue</dt>
                <dd>armed for {launchScene}</dd>
              </div>
            ) : null}
            {buildStatus.error ? (
              <div>
                <dt>Error</dt>
                <dd>{buildStatus.error}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      </div>
    );
  }

  return (
    <div className="stack">
      <section className="card compact-card">
        <div className="section-titlebar">
          <h3>Runtime</h3>
          <span
            aria-label={`Runtime ${runtimeStateLabel(runtimeStatus.state)}`}
            className={`status-dot status-dot--${runtimeStateTone(runtimeStatus.state)}`}
            role="img"
          />
        </div>
        <div className="form-grid">
          <label className="form-field">
            <span>Run scene</span>
            <input onChange={(event) => onLaunchSceneChange(event.target.value)} type="text" value={launchScene} />
          </label>
        </div>
        <div className="inline-actions">
          <button className="ghost-button ghost-button--sm" disabled={buildStatus.state === 'running' || runtimeStatus.state !== 'stopped'} onClick={onStartRuntime} type="button">
            Run
          </button>
          <button className="ghost-button ghost-button--sm" disabled={buildStatus.state === 'running' || runtimeStatus.state === 'stopped'} onClick={onStopRuntime} type="button">
            Stop
          </button>
          <button
            className="ghost-button ghost-button--sm"
            disabled={buildStatus.state === 'running' || !runtimeStatus.supportsPause || runtimeStatus.state === 'stopped'}
            onClick={runtimeStatus.state === 'paused' ? onResumeRuntime : onPauseRuntime}
            type="button"
          >
            {runtimeStatus.state === 'paused' ? 'Resume' : 'Pause'}
          </button>
          <button className="ghost-button ghost-button--sm" disabled={buildStatus.state === 'running' || runtimeStatus.state === 'stopped'} onClick={onRestartRuntime} type="button">
            Restart
          </button>
        </div>
        {runtimeHint ? (
          <div className="setup-hint">
            <strong>Native Runtime Setup Required</strong>
            <span>{runtimeHint}</span>
          </div>
        ) : null}
      </section>
      <section className="card compact-card">
        <dl className="fact-list">
          <div>
            <dt>State</dt>
            <dd>{runtimeStateLabel(runtimeStatus.state)}</dd>
          </div>
          <div>
            <dt>Scene</dt>
            <dd>{runtimeStatus.scene || launchScene}</dd>
          </div>
          <div>
            <dt>Workspace</dt>
            <dd>{runtimeStatus.workspaceRoot || activeSession?.rootPath || 'repo default'}</dd>
          </div>
          <div>
            <dt>Process</dt>
            <dd>{runtimeStatus.pid ? `pid ${runtimeStatus.pid}` : 'not running'}</dd>
          </div>
          <div>
            <dt>Pause</dt>
            <dd>
              {!runtimeStatus.supportsPause
                ? 'unsupported on this host'
                : runtimeStatus.pausedAt
                  ? `paused ${formatSessionTimestamp(runtimeStatus.pausedAt)}`
                  : 'available'}
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}

function TerminalDock({
  tabs,
  activeTabId,
  activeSession,
  availableShells,
  onActivateTab,
  onAddTab,
  onCloseTab,
  onChangeShell,
  onClearTab,
  onTerminalInput,
  onTerminalResize,
}: TerminalDockProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalInstanceRef = useRef<{
    tabId: string;
    terminal: XTerm;
    fitAddon: FitAddon;
    resizeObserver: ResizeObserver;
    writtenOutput: string;
    disposeDomListeners: () => void;
  } | null>(null);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) || tabs[0] || null;
  const writeTerminalInputEvent = useEffectEvent((tabId: string, input: string) => {
    onTerminalInput(tabId, input);
  });
  const resizeTerminalEvent = useEffectEvent((tabId: string, cols: number, rows: number) => {
    onTerminalResize(tabId, cols, rows);
  });

  useEffect(() => {
    if (!activeTab || !hostRef.current) {
      return;
    }

    const disposeTerminal = () => {
      const instance = terminalInstanceRef.current;
      if (!instance) {
        return;
      }
      instance.resizeObserver.disconnect();
      instance.disposeDomListeners();
      instance.terminal.dispose();
      terminalInstanceRef.current = null;
    };

    let instance = terminalInstanceRef.current;
    let createdTerminal = false;
    if (!instance || instance.tabId !== activeTab.id) {
      disposeTerminal();
      hostRef.current.innerHTML = '';
      const terminalHost = hostRef.current;

      const terminal = new XTerm({
        cursorBlink: true,
        fontFamily: '"JetBrains Mono", "Cascadia Mono", monospace',
        fontSize: 13,
        theme: {
          background: '#11161b',
          foreground: '#d9dee5',
          cursor: '#f0a341',
          selectionBackground: 'rgba(240, 163, 65, 0.24)',
        },
      });
      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.open(terminalHost);
      const helperTextarea = terminalHost.querySelector('textarea');
      fitAddon.fit();
      if (activeTab.output) {
        terminal.write(activeTab.output);
      }

      const writeInput = (text: string) => {
        if (!text) {
          return;
        }
        writeTerminalInputEvent(activeTab.id, text);
      };

      terminal.attachCustomKeyEventHandler((event) => {
        const isCopy =
          event.type === 'keydown' &&
          event.key.toLowerCase() === 'c' &&
          (event.ctrlKey || event.metaKey);
        if (isCopy && terminal.hasSelection()) {
          void copyTextToClipboard(terminal.getSelection());
          terminal.clearSelection();
          event.preventDefault();
          return false;
        }

        const isPaste =
          event.type === 'keydown' &&
          ((event.key.toLowerCase() === 'v' && (event.ctrlKey || event.metaKey)) ||
            (event.key === 'Insert' && event.shiftKey));
        if (isPaste) {
          event.preventDefault();
          void forwardTerminalPaste(event, writeInput);
          return false;
        }

        return true;
      });

      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
        const cols = terminal.cols;
        const rows = terminal.rows;
        resizeTerminalEvent(activeTab.id, cols, rows);
      });

      resizeObserver.observe(terminalHost);
      terminal.onData((input) => {
        if (isClipboardPasteSentinel(input)) {
          return;
        }
        onTerminalInput(activeTab.id, input);
      });

      const handlePaste = (event: ClipboardEvent) => {
        event.preventDefault();
        void forwardTerminalPaste(event, writeInput);
      };
      const handleBeforeInput = (event: InputEvent) => {
        if (!shouldBridgeTerminalTextInput(event)) {
          return;
        }
        event.preventDefault();
        const text = typeof event.data === 'string' ? event.data : '';
        void forwardTerminalInsertedText(event, writeInput, text);
      };
      const handleInput = (event: Event) => {
        const inputEvent = event as InputEvent;
        const text = helperTextarea instanceof HTMLTextAreaElement ? helperTextarea.value : '';
        if (!shouldBridgeTerminalTextInput(inputEvent, text)) {
          return;
        }
        if (helperTextarea instanceof HTMLTextAreaElement) {
          helperTextarea.value = '';
        }
        inputEvent.preventDefault?.();
        void forwardTerminalInsertedText(inputEvent, writeInput, text);
      };

      const handleHostClick = () => terminal.focus();
      terminalHost.addEventListener('click', handleHostClick);
      terminalHost.addEventListener('paste', handlePaste, true);
      terminalHost.addEventListener('beforeinput', handleBeforeInput, true);
      helperTextarea?.addEventListener('paste', handlePaste, true);
      helperTextarea?.addEventListener('beforeinput', handleBeforeInput, true);
      helperTextarea?.addEventListener('input', handleInput, true);

      const disposeDomListeners = () => {
        terminalHost.removeEventListener('click', handleHostClick);
        terminalHost.removeEventListener('paste', handlePaste, true);
        terminalHost.removeEventListener('beforeinput', handleBeforeInput, true);
        helperTextarea?.removeEventListener('paste', handlePaste, true);
        helperTextarea?.removeEventListener('beforeinput', handleBeforeInput, true);
        helperTextarea?.removeEventListener('input', handleInput, true);
      };

      terminalInstanceRef.current = {
        tabId: activeTab.id,
        terminal,
        fitAddon,
        resizeObserver,
        writtenOutput: activeTab.output,
        disposeDomListeners,
      };
      instance = terminalInstanceRef.current;
      createdTerminal = true;
    }

    if (instance && instance.writtenOutput !== activeTab.output) {
      if (activeTab.output.startsWith(instance.writtenOutput)) {
        const delta = activeTab.output.slice(instance.writtenOutput.length);
        if (delta) {
          instance.terminal.write(delta);
        }
      } else {
        instance.terminal.reset();
        if (activeTab.output) {
          instance.terminal.write(activeTab.output);
        }
      }
      instance.writtenOutput = activeTab.output;
    }

    instance?.fitAddon.fit();
    if (createdTerminal) {
      instance?.terminal.focus();
    }

    return () => {
      if (!tabs.length) {
        disposeTerminal();
      }
    };
  }, [activeTab, tabs.length]);

  useEffect(() => {
    return () => {
      const instance = terminalInstanceRef.current;
      if (!instance) {
        return;
      }
      instance.resizeObserver.disconnect();
      instance.disposeDomListeners();
      instance.terminal.dispose();
      terminalInstanceRef.current = null;
    };
  }, []);

  if (!tabs.length || !activeTab) {
    return (
      <section className="terminal-dock">
        <div className="terminal-toolbar">
          <div className="terminal-toolbar__group">
            <button className="ghost-button" onClick={onAddTab} type="button">
              + Terminal
            </button>
          </div>
        </div>
        <div className="terminal-empty">Open a terminal to start driving the engine directly from the shell.</div>
      </section>
    );
  }

  return (
    <section className="terminal-dock">
      <div className="terminal-tabs">
        <div className="terminal-tabs__strip">
          {tabs.map((tab) => (
            <button
              className={`terminal-tab${tab.id === activeTab.id ? ' is-active' : ''}`}
              key={tab.id}
              onClick={() => onActivateTab(tab.id)}
              type="button"
            >
              <span className={`terminal-tab__dot terminal-tab__dot--${tab.status}`} />
              <strong>{tab.title}</strong>
              <span className="terminal-tab__shell">{tab.shell}</span>
              {tabs.length > 1 ? (
                <button
                  aria-label={`Close ${tab.title}`}
                  className="terminal-tab__close"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  type="button"
                >
                  ×
                </button>
              ) : null}
            </button>
          ))}
        </div>
        <button className="ghost-button" onClick={onAddTab} type="button">
          + Terminal
        </button>
      </div>
      <div className="terminal-toolbar">
        <div className="terminal-toolbar__group">
          <select
            className="terminal-shell-select"
            onChange={(event) => onChangeShell(activeTab.id, event.target.value as TerminalShell)}
            value={activeTab.shell}
          >
            {availableShells.map((shell) => (
              <option key={shell} value={shell}>
                {shell}
              </option>
            ))}
          </select>
          <span className="terminal-toolbar__meta">cwd: {activeSession?.rootPath || activeTab.cwd}</span>
        </div>
        <div className="terminal-toolbar__group">
          <span className={`terminal-status terminal-status--${activeTab.status}`}>{activeTab.status}</span>
          <button className="ghost-button" onClick={() => onClearTab(activeTab.id)} type="button">
            Clear
          </button>
        </div>
      </div>
      {activeTab.openError ? <div className="terminal-error">{activeTab.openError}</div> : null}
      <div className="terminal-viewport" ref={hostRef} />
    </section>
  );
}

function renderBottomPanel(
  activeTab: BottomTab,
  terminalDock: ReactNode,
  runtimeLog: string,
  buildLog: string,
  activityDock: ReactNode,
) {
  if (activeTab === 'Terminal') {
    return terminalDock;
  }

  if (activeTab === 'Logs') {
    return (
      <pre className="dock-output">{runtimeLog}</pre>
    );
  }

  if (activeTab === 'Activity') {
    return activityDock;
  }

  return (
    <pre className="dock-output">{buildLog}</pre>
  );
}

function gitStatusClassName(status: string) {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === '?') {
    return 'unknown';
  }
  return normalized || 'default';
}

function renderGitGroup(title: string, entries: GitStatus['staged']) {
  if (!entries.length) {
    return null;
  }

  return (
    <section className="git-group">
      <div className="git-group__header">
        <strong>{title}</strong>
        <span>{entries.length}</span>
      </div>
      <ul className="git-file-list">
        {entries.map((entry) => (
          <li className="git-file-row" key={`${title}-${entry.status}-${entry.path}`}>
            <span className={`git-status-chip git-status-chip--${gitStatusClassName(entry.status)}`}>{entry.status}</span>
            <span className="git-file-path">{entry.path}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function renderLegacyCodeBridge() {
  return (
    <div className="workspace-layout workspace-layout--code-focus">
      <section className="surface legacy-surface">
        <iframe
          className="legacy-frame"
          loading="lazy"
          src={legacyWorkspaceSrc}
          title="Shader Forge preserved code workspace"
        />
      </section>
    </div>
  );
}

function renderCenterContent(
  activeTab: CenterTab,
  activeSession: EngineSession | null,
  operationEventEpoch: number,
  runtimeStatus: RuntimeStatus,
  buildStatus: BuildStatus,
  launchScene: string,
  onLaunchSceneChange: (value: string) => void,
  buildConfig: BuildConfig,
  onBuildConfigChange: (value: BuildConfig) => void,
  buildDir: string,
  onBuildDirChange: (value: string) => void,
  runtimeLog: string,
  buildLog: string,
  viewerBridgeEvents: ViewerBridgeEvent[],
  pendingRunAfterBuild: boolean,
  onBuildAndPlay: () => void,
  onStartRuntime: () => void,
  onStopRuntime: () => void,
  onRestartRuntime: () => void,
  onPauseRuntime: () => void,
  onResumeRuntime: () => void,
  onStartRuntimeBuild: () => void,
  onStopBuild: () => void,
) {
  if (activeTab === 'Assets') {
    return (
      <SpatialAttachmentEditorView
        activeSession={activeSession}
        operationEventEpoch={operationEventEpoch}
      />
    );
  }

  const runtimeLogTail = takeLastLogLines(runtimeLog, 8);
  const buildLogTail = takeLastLogLines(buildLog, 8);
  const currentWorld = runtimeStatus.scene || launchScene;
  const runtimeLabel = runtimeStateLabel(runtimeStatus.state);
  const buildBusy = buildStatus.state === 'running';
  const runtimeStopped = runtimeStatus.state === 'stopped';
  const runtimePaused = runtimeStatus.state === 'paused';
  const canPlay = !buildBusy && runtimeStopped;
  const canStopOrRestart = !buildBusy && !runtimeStopped;
  const canResume = !buildBusy && runtimePaused && runtimeStatus.supportsPause;
  const canPause = !buildBusy && runtimeStatus.supportsPause && runtimeStatus.state === 'running';
  const playtestStatus = buildBusy ? 'Building' : buildStatus.state === 'failed' ? 'Play failed' : runtimeLabel;
  const buildHint = buildSetupHint(buildStatus.error);
  const runtimeHint = nativeRuntimeSetupHint(buildLog, runtimeLog);
  const playtestFailureMessage = buildStatus.state === 'failed'
    ? buildHint || buildStatus.error || 'The build failed. Open Diagnostics for details.'
    : runtimeStopped && runtimeHint
      ? runtimeHint
      : '';

  return (
    <div className="workspace-layout workspace-layout--playtest">
      <section className="surface">
        <div className="surface-header">
          <div>
            <div className="surface-eyebrow">Playtest</div>
            <div className="bridge-card__title">
              <span
                aria-label={runtimeLabel}
                className={`status-dot status-dot--${runtimeStateTone(runtimeStatus.state)}`}
                role="img"
              />
              <h2>{currentWorld}</h2>
            </div>
            <p aria-live="polite" role="status">
              {playtestStatus}. The game opens in a separate window.
            </p>
          </div>
          <div className="inline-actions">
            {buildBusy ? (
              <button className="ghost-button ghost-button--sm" onClick={onStopBuild} type="button">
                Stop build
              </button>
            ) : runtimeStopped ? (
              <button
                className="ghost-button ghost-button--sm ghost-button--primary"
                disabled={!canPlay}
                onClick={onBuildAndPlay}
                type="button"
              >
                Play
              </button>
            ) : (
              <>
                {runtimePaused ? (
                  <button
                    className="ghost-button ghost-button--sm ghost-button--primary"
                    disabled={!canResume}
                    onClick={onResumeRuntime}
                    type="button"
                  >
                    Resume
                  </button>
                ) : null}
                {canPause ? (
                  <button className="ghost-button ghost-button--sm" onClick={onPauseRuntime} type="button">
                    Pause
                  </button>
                ) : null}
                <button className="ghost-button ghost-button--sm" onClick={onStopRuntime} type="button">
                  Stop
                </button>
                <button className="ghost-button ghost-button--sm" onClick={onRestartRuntime} type="button">
                  Restart
                </button>
              </>
            )}
          </div>
        </div>
        {playtestFailureMessage ? (
          <div className="setup-hint playtest-alert" role="alert">
            <strong>Play needs attention</strong>
            <span>{playtestFailureMessage}</span>
          </div>
        ) : null}
        <details className="scene-disclosure">
          <summary>Diagnostics</summary>
          <div className="scene-disclosure__body">
            <div className="form-grid">
              <label className="form-field">
                <span>World</span>
                <input onChange={(event) => onLaunchSceneChange(event.target.value)} type="text" value={launchScene} />
              </label>
              <label className="form-field">
                <span>Config</span>
                <select onChange={(event) => onBuildConfigChange(event.target.value as BuildConfig)} value={buildConfig}>
                  {buildConfigs.map((config) => (
                    <option key={config} value={config}>
                      {config}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>Build dir</span>
                <input onChange={(event) => onBuildDirChange(event.target.value)} type="text" value={buildDir} />
              </label>
            </div>
            <div className="inline-actions">
              <button className="ghost-button ghost-button--sm" disabled={buildBusy} onClick={onStartRuntimeBuild} type="button">
                Build
              </button>
              <button className="ghost-button ghost-button--sm" disabled={buildBusy} onClick={onBuildAndPlay} type="button">
                Build + Run
              </button>
              <button
                className="ghost-button ghost-button--sm"
                disabled={buildBusy || !runtimeStopped}
                onClick={onStartRuntime}
                type="button"
              >
                Run existing build
              </button>
              <button className="ghost-button ghost-button--sm" disabled={!buildBusy} onClick={onStopBuild} type="button">
                Stop build
              </button>
              <button
                className="ghost-button ghost-button--sm"
                disabled={!canPause}
                onClick={onPauseRuntime}
                type="button"
              >
                Pause
              </button>
            </div>
            {buildHint ? (
              <div className="setup-hint">
                <strong>Build Setup Required</strong>
                <span>{buildHint}</span>
              </div>
            ) : null}
            {!buildHint && runtimeHint ? (
              <div className="setup-hint">
                <strong>Native Runtime Setup Required</strong>
                <span>{runtimeHint}</span>
              </div>
            ) : null}
            <dl className="fact-list">
              <div>
                <dt>State</dt>
                <dd>{runtimeLabel}</dd>
              </div>
              <div>
                <dt>World</dt>
                <dd>{currentWorld}</dd>
              </div>
              <div>
                <dt>Workspace</dt>
                <dd>{runtimeStatus.workspaceRoot || activeSession?.rootPath || 'repo default'}</dd>
              </div>
              <div>
                <dt>Session</dt>
                <dd>{runtimeStatus.sessionId || 'repo-default launch context'}</dd>
              </div>
              <div>
                <dt>Executable</dt>
                <dd>{runtimeStatus.executablePath || 'not built yet'}</dd>
              </div>
              <div>
                <dt>Process</dt>
                <dd>{runtimeStatus.pid ? `pid ${runtimeStatus.pid}` : 'not running'}</dd>
              </div>
              <div>
                <dt>Started</dt>
                <dd>{runtimeStatus.startedAt ? formatSessionTimestamp(runtimeStatus.startedAt) : 'not running'}</dd>
              </div>
              <div>
                <dt>Pause support</dt>
                <dd>{runtimeStatus.supportsPause ? 'available on this host' : 'unsupported on this host'}</dd>
              </div>
              <div>
                <dt>Paused at</dt>
                <dd>{runtimeStatus.pausedAt ? formatSessionTimestamp(runtimeStatus.pausedAt) : 'not paused'}</dd>
              </div>
              <div>
                <dt>Build</dt>
                <dd>{buildStateLabel(buildStatus.state)}</dd>
              </div>
              <div>
                <dt>Build target</dt>
                <dd>{buildStatus.target || 'runtime'}</dd>
              </div>
              <div>
                <dt>Build config</dt>
                <dd>{buildStatus.config || buildConfig}</dd>
              </div>
              <div>
                <dt>Build dir</dt>
                <dd>{buildStatus.buildDir || buildDir}</dd>
              </div>
              <div>
                <dt>Command</dt>
                <dd>{buildStatus.command || 'waiting'}</dd>
              </div>
              <div>
                <dt>Queue</dt>
                <dd>{pendingRunAfterBuild ? `Build + Run armed for ${launchScene}` : 'Idle'}</dd>
              </div>
              {buildStatus.error ? (
                <div>
                  <dt>Error</dt>
                  <dd>{buildStatus.error}</dd>
                </div>
              ) : null}
            </dl>
            <div className="bridge-log-grid">
              <article className="bridge-log-card">
                <span>Runtime log</span>
                <pre>{runtimeLogTail}</pre>
              </article>
              <article className="bridge-log-card">
                <span>Build log</span>
                <pre>{buildLogTail}</pre>
              </article>
            </div>
            <article className="bridge-card">
              <div className="bridge-card__header">
                <div className="bridge-card__title">
                  <span aria-hidden="true" className="status-dot status-dot--active" />
                  <strong>Recent activity</strong>
                </div>
                <span>{viewerBridgeEvents.length ? `${viewerBridgeEvents.length} entries` : 'waiting'}</span>
              </div>
              {viewerBridgeEvents.length ? (
                <ul className="bridge-event-list">
                  {viewerBridgeEvents.map((event) => (
                    <li className="bridge-event" key={event.id}>
                      <div className="bridge-event__header">
                        <div className="bridge-card__title">
                          <span
                            aria-label={event.tone}
                            className={`status-dot status-dot--${event.tone}`}
                            role="img"
                          />
                          <strong>{event.title}</strong>
                        </div>
                        <span>{formatSessionTimestamp(event.at)}</span>
                      </div>
                      <p>{event.detail}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="bridge-empty">
                  Runtime and build transitions will accumulate here as the shell drives the native window.
                </div>
              )}
            </article>
          </div>
        </details>
      </section>
    </div>
  );
}

export default function App() {
  const [layout, setLayout] = useState<ShellLayout>(() => loadBrowserShellLayout());
  const [layoutPersistenceMessage, setLayoutPersistenceMessage] = useState('');
  const [viewportHeight, setViewportHeight] = useState(() => getBrowserViewportHeight());
  const [shellGridWidth, setShellGridWidth] = useState(() => getBrowserViewportWidth());
  const [resizeTarget, setResizeTarget] = useState<ShellResizeTarget | null>(null);
  const layoutRef = useRef(layout);
  const shellGridRef = useRef<HTMLElement | null>(null);
  layoutRef.current = layout;
  const [showGuide, setShowGuide] = useState(false);
  const [showLegacyBridge, setShowLegacyBridge] = useState(false);
  const [sessiondState, setSessiondState] = useState<'connecting' | 'connected' | 'offline'>('connecting');
  const [sessiondMessage, setSessiondMessage] = useState('Checking engine_sessiond...');
  const [platformInfo, setPlatformInfo] = useState<PlatformInfo | null>(null);
  const [sessions, setSessions] = useState<EngineSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [sessionActionBusy, setSessionActionBusy] = useState(false);
  const [editingSessionId, setEditingSessionId] = useState('');
  const [newSessionName, setNewSessionName] = useState('');
  const [newSessionRoot, setNewSessionRoot] = useState('');
  const [dirPickerOpen, setDirPickerOpen] = useState(false);
  const [dirPickerPath, setDirPickerPath] = useState('/');
  const [dirPickerEntries, setDirPickerEntries] = useState<HostDirectoryList['entries']>([]);
  const [dirPickerBusy, setDirPickerBusy] = useState(false);
  const [dirPickerError, setDirPickerError] = useState('');
  const [explorerEntries, setExplorerEntries] = useState<SessionFileEntry[]>([]);
  const [explorerPath, setExplorerPath] = useState('.');
  const [selectedExplorerPath, setSelectedExplorerPath] = useState('');
  const [selectedFilePreview, setSelectedFilePreview] = useState('');
  const [explorerBusy, setExplorerBusy] = useState(false);
  const [gitStatus, setGitStatus] = useState<GitStatus>(emptyGitStatus);
  const [gitBusy, setGitBusy] = useState(false);
  const [terminalTabs, setTerminalTabs] = useState<TerminalTabState[]>([]);
  const [activeTerminalTabId, setActiveTerminalTabId] = useState('');
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>(stoppedRuntimeStatus);
  const [runtimeLog, setRuntimeLog] = useState('[runtime] idle\n');
  const [buildStatus, setBuildStatus] = useState<BuildStatus>(idleBuildStatus);
  const [buildLog, setBuildLog] = useState('[build] idle\n');
  const [packageSummary, setPackageSummary] = useState<PackageInspectSummary | null>(null);
  const [packageBusy, setPackageBusy] = useState(false);
  const [profileSummary, setProfileSummary] = useState<ProfilingLiveSummary | null>(null);
  const [profileCaptureList, setProfileCaptureList] = useState<ProfilingCaptureList | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [codeTrustSummary, setCodeTrustSummary] = useState<CodeTrustSummary | null>(null);
  const [codeTrustApprovals, setCodeTrustApprovals] = useState<CodeTrustApproval[]>([]);
  const [approvalsBusy, setApprovalsBusy] = useState(false);
  const [approvalActionId, setApprovalActionId] = useState('');
  const [artifactActionPath, setArtifactActionPath] = useState('');
  const [launchScene, setLaunchScene] = useState('sandbox');
  const [buildConfig, setBuildConfig] = useState<BuildConfig>('Debug');
  const [buildDir, setBuildDir] = useState('build/runtime');
  const [pendingRunAfterBuild, setPendingRunAfterBuild] = useState(false);
  const [viewerBridgeEvents, setViewerBridgeEvents] = useState<ViewerBridgeEvent[]>([]);
  const [operations, setOperations] = useState<EngineOperation[]>([]);
  const [operationEventEpoch, setOperationEventEpoch] = useState(0);
  const [selectedOperationId, setSelectedOperationId] = useState('');
  const [selectedOperation, setSelectedOperation] = useState<EngineOperation | null>(null);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState('');
  const [activityStatus, setActivityStatus] = useState('Select a workspace to review activity.');
  const [activityPendingAction, setActivityPendingAction] = useState<'' | 'approve' | 'reject'>('');
  const terminalTabsRef = useRef<TerminalTabState[]>([]);
  const terminalOpeningRef = useRef(new Set<string>());
  const activeSessionIdRef = useRef('');
  const workspaceSelectionGenerationRef = useRef(0);
  const sessionListRequestRef = useRef(0);
  const dirPickerRequestRef = useRef(0);
  const runtimeLifecycleRequestRef = useRef(0);
  const buildLifecycleRequestRef = useRef(0);
  const explorerRequestRef = useRef(0);
  const gitRequestRef = useRef(0);
  const codeTrustRequestRef = useRef(0);
  const codeTrustApprovalsRequestRef = useRef(0);
  const packageSummaryRequestRef = useRef(0);
  const profilingRequestRef = useRef(0);
  const pendingRunRequestRef = useRef<{ id: number; sessionId: string; scene: string } | null>(null);
  const runRequestCounterRef = useRef(0);
  const selectedOperationIdRef = useRef('');
  const activityListRequestRef = useRef(0);
  const activityDetailRequestRef = useRef(0);
  activeSessionIdRef.current = activeSessionId;
  selectedOperationIdRef.current = selectedOperationId;
  const defaultShell: TerminalShell = platformInfo?.platform === 'win32' ? 'powershell.exe' : 'bash';
  const availableShells: TerminalShell[] = platformInfo?.platform === 'win32'
    ? [...windowsShells, ...unixShells]
    : [...unixShells];
  const refreshApprovalPanelForActiveSession = useEffectEvent(() => {
    if (!activeSessionId) {
      setCodeTrustApprovals([]);
      return;
    }

    void Promise.all([
      refreshCodeTrust(activeSessionId),
      refreshCodeTrustApprovals(activeSessionId),
      refreshPackageSummary(activeSessionId),
      refreshProfiling(activeSessionId),
    ]).catch((error) => {
      setSessiondState('offline');
      setSessiondMessage(error instanceof Error ? error.message : String(error));
    });
  });

  function commitLayout(next: ShellLayout, persist = true) {
    if (!persist) {
      layoutRef.current = next;
      setLayout(next);
      return;
    }
    const result = saveShellLayout(getBrowserShellLayoutStorage(), next);
    layoutRef.current = result.layout;
    setLayout(result.layout);
    setLayoutPersistenceMessage(result.persisted ? '' : 'Layout not saved');
  }

  function selectBottomTab(tab: BottomTab) {
    commitLayout(withBottomLayout(layoutRef.current, { tab }));
  }

  function selectRightTab(tab: RightTab) {
    commitLayout(withActiveWorkspacePane(layoutRef.current, { right: { tab } }));
  }

  function activeShellPaneGeometry(
    current: ShellLayout,
    gridWidth = shellGridWidth,
  ): ShellPaneGeometry {
    const workspace = current.workspaces[current.activeWorkspace];
    return deriveShellPaneGeometry(
      gridWidth,
      workspace.left.visible,
      workspace.right.visible,
      workspace.left.width,
      workspace.right.width,
    );
  }

  useEffect(() => {
    if (!resizeTarget) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      event.preventDefault();
      const current = layoutRef.current;
      if (resizeTarget === 'bottom') {
        const maxHeight = maxShellLayoutBottomHeightForViewport(window.innerHeight);
        const preferredHeight = preferredShellBottomHeightForRenderedHeight(
          window.innerHeight - event.clientY,
          maxHeight,
          current.bottom.preferredHeight,
        );
        commitLayout(withBottomLayout(current, { collapsed: false, preferredHeight }), false);
        return;
      }

      const bounds = shellGridRef.current?.getBoundingClientRect();
      const paneGeometry = activeShellPaneGeometry(current, bounds?.width ?? shellGridWidth);
      if (resizeTarget === 'left') {
        commitLayout(
          withActiveWorkspacePane(current, {
            left: {
              width: clampShellPaneWidth(
                event.clientX - (bounds?.left ?? 0),
                paneGeometry.left.min,
                paneGeometry.left.max,
              ),
            },
          }),
          false,
        );
        return;
      }

      commitLayout(
        withActiveWorkspacePane(current, {
          right: {
            width: clampShellPaneWidth(
              (bounds?.right ?? window.innerWidth) - event.clientX,
              paneGeometry.right.min,
              paneGeometry.right.max,
            ),
          },
        }),
        false,
      );
    };

    const stopResize = () => {
      commitLayout(layoutRef.current);
      setResizeTarget(null);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    document.body.style.userSelect = 'none';
    document.body.style.cursor = resizeTarget === 'bottom' ? 'row-resize' : 'col-resize';
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [resizeTarget]);

  useEffect(() => {
    const handleResize = () => {
      setViewportHeight(window.innerHeight);
      const bounds = shellGridRef.current?.getBoundingClientRect();
      setShellGridWidth(Math.max(0, Math.floor(bounds?.width ?? window.innerWidth)));
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(handleResize)
      : null;
    if (observer && shellGridRef.current) {
      observer.observe(shellGridRef.current);
    }
    return () => {
      window.removeEventListener('resize', handleResize);
      observer?.disconnect();
    };
  }, []);

  function recordViewerBridgeEvent(event: Omit<ViewerBridgeEvent, 'id'>) {
    setViewerBridgeEvents((current) => appendViewerBridgeEvent(current, event));
  }

  function handleBottomTabSelect(tab: BottomTab) {
    commitLayout(withBottomLayout(layoutRef.current, { tab, collapsed: false }));
  }

  function handlePaneResizeStart(target: ShellResizeTarget, event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    if (target === 'bottom') {
      commitLayout(withBottomLayout(layoutRef.current, { collapsed: false }), false);
    }
    setResizeTarget(target);
  }

  function handleBottomPaneResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    handlePaneResizeStart('bottom', event);
  }

  function handleBottomPaneResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const maxHeight = maxShellLayoutBottomHeightForViewport(viewportHeight);
    const minHeight = effectiveShellBottomMinHeight(maxHeight);
    const current = layoutRef.current;
    let nextHeight = deriveShellLayoutBottomHeight(current.bottom.preferredHeight, viewportHeight);
    if (event.key === 'ArrowUp') nextHeight += SHELL_RAIL_RESIZE_STEP;
    else if (event.key === 'ArrowDown') nextHeight -= SHELL_RAIL_RESIZE_STEP;
    else if (event.key === 'Home') nextHeight = minHeight;
    else if (event.key === 'End') nextHeight = maxHeight;
    else return;
    event.preventDefault();
    commitLayout(withBottomLayout(current, {
      collapsed: false,
      preferredHeight: preferredShellBottomHeightForRenderedHeight(
        Math.max(minHeight, Math.min(nextHeight, maxHeight)),
        maxHeight,
        current.bottom.preferredHeight,
      ),
    }));
  }

  function handleLeftPaneResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const current = layoutRef.current;
    const bounds = shellGridRef.current?.getBoundingClientRect();
    const paneGeometry = activeShellPaneGeometry(current, bounds?.width ?? shellGridWidth);
    let nextWidth = paneGeometry.left.width;
    if (event.key === 'ArrowRight') nextWidth += SHELL_RAIL_RESIZE_STEP;
    else if (event.key === 'ArrowLeft') nextWidth -= SHELL_RAIL_RESIZE_STEP;
    else if (event.key === 'Home') nextWidth = paneGeometry.left.min;
    else if (event.key === 'End') nextWidth = paneGeometry.left.max;
    else return;
    event.preventDefault();
    commitLayout(withActiveWorkspacePane(current, {
      left: {
        width: clampShellPaneWidth(nextWidth, paneGeometry.left.min, paneGeometry.left.max),
      },
    }));
  }

  function handleRightPaneResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const current = layoutRef.current;
    const bounds = shellGridRef.current?.getBoundingClientRect();
    const paneGeometry = activeShellPaneGeometry(current, bounds?.width ?? shellGridWidth);
    let nextWidth = paneGeometry.right.width;
    if (event.key === 'ArrowLeft') nextWidth += SHELL_RAIL_RESIZE_STEP;
    else if (event.key === 'ArrowRight') nextWidth -= SHELL_RAIL_RESIZE_STEP;
    else if (event.key === 'Home') nextWidth = paneGeometry.right.min;
    else if (event.key === 'End') nextWidth = paneGeometry.right.max;
    else return;
    event.preventDefault();
    commitLayout(withActiveWorkspacePane(current, {
      right: {
        width: clampShellPaneWidth(nextWidth, paneGeometry.right.min, paneGeometry.right.max),
      },
    }));
  }

  function handleExpandBottomPane() {
    const current = layoutRef.current;
    const maxHeight = maxShellLayoutBottomHeightForViewport(viewportHeight);
    commitLayout(withBottomLayout(current, {
      collapsed: false,
      preferredHeight: preferredShellBottomHeightForRenderedHeight(
        maxHeight,
        maxHeight,
        current.bottom.preferredHeight,
      ),
    }));
  }

  function handleToggleBottomPane() {
    commitLayout(withBottomLayout(layoutRef.current, {
      collapsed: !layoutRef.current.bottom.collapsed,
    }));
  }

  function handleToggleLeftPane() {
    const current = layoutRef.current.workspaces[layoutRef.current.activeWorkspace].left;
    commitLayout(withActiveWorkspacePane(layoutRef.current, {
      left: { visible: !current.visible },
    }));
  }

  function handleToggleRightPane() {
    const current = layoutRef.current.workspaces[layoutRef.current.activeWorkspace].right;
    commitLayout(withActiveWorkspacePane(layoutRef.current, {
      right: { visible: !current.visible },
    }));
  }

  function handleResetLayout() {
    const result = resetShellLayout(getBrowserShellLayoutStorage());
    layoutRef.current = result.layout;
    setLayout(result.layout);
    setLayoutPersistenceMessage(result.persisted ? '' : 'Layout not saved');
  }

  async function refreshOperations(sessionId = activeSessionIdRef.current, announce = true) {
    const requestId = ++activityListRequestRef.current;
    if (!sessionId) {
      setActivityLoading(false);
      setOperations([]);
      setSelectedOperationId('');
      selectedOperationIdRef.current = '';
      setSelectedOperation(null);
      setActivityStatus('Select a workspace to review activity.');
      setActivityError('');
      return;
    }

    setActivityLoading(true);
    setActivityError('');
    if (announce) setActivityStatus('Refreshing operation history...');
    try {
      const nextOperations = await listOperations(sessionId);
      if (requestId !== activityListRequestRef.current || activeSessionIdRef.current !== sessionId) return;
      setOperations(nextOperations);
      const currentSelection = selectedOperationIdRef.current;
      const nextSelection = nextOperations.some((operation) => operation.id === currentSelection)
        ? currentSelection
        : nextOperations[0]?.id || '';
      setSelectedOperationId(nextSelection);
      selectedOperationIdRef.current = nextSelection;
      if (nextSelection) {
        const detailRequestId = ++activityDetailRequestRef.current;
        const detail = await fetchOperation(nextSelection);
        if (
          detailRequestId === activityDetailRequestRef.current
          && selectedOperationIdRef.current === nextSelection
          && activeSessionIdRef.current === sessionId
        ) setSelectedOperation(detail);
      } else {
        setSelectedOperation(null);
      }
      if (announce) setActivityStatus(`Loaded ${nextOperations.length} operation${nextOperations.length === 1 ? '' : 's'}.`);
    } catch (error) {
      if (requestId !== activityListRequestRef.current || activeSessionIdRef.current !== sessionId) return;
      setActivityError(error instanceof Error ? error.message : String(error));
      setActivityStatus('Operation history could not be refreshed.');
    } finally {
      if (requestId === activityListRequestRef.current) setActivityLoading(false);
    }
  }

  async function handleSelectOperation(operationId: string) {
    setSelectedOperationId(operationId);
    selectedOperationIdRef.current = operationId;
    setSelectedOperation(operations.find((operation) => operation.id === operationId) || null);
    setActivityError('');
    const requestId = ++activityDetailRequestRef.current;
    try {
      const detail = await fetchOperation(operationId);
      if (requestId === activityDetailRequestRef.current && selectedOperationIdRef.current === operationId) {
        setSelectedOperation(detail);
      }
    } catch (error) {
      if (requestId === activityDetailRequestRef.current) {
        setActivityError(error instanceof Error ? error.message : String(error));
      }
    }
  }

  async function handleOperationReview(action: 'approve' | 'reject') {
    const operation = selectedOperation;
    if (!operation || activityPendingAction) return;
    const workspaceGeneration = workspaceSelectionGenerationRef.current;
    setActivityPendingAction(action);
    setActivityError('');
    setActivityStatus(`${action === 'approve' ? 'Approving' : 'Rejecting'} ${operation.context?.label || operation.id}...`);
    try {
      const result = await transitionOperation(operation.id, action, { actor: engineShellActor });
      if (!activeWorkspaceIsCurrent(operation.sessionId, workspaceGeneration)) return;
      if (selectedOperationIdRef.current === operation.id) setSelectedOperation(result.operation);
      await refreshOperations(operation.sessionId, false);
      if (!activeWorkspaceIsCurrent(operation.sessionId, workspaceGeneration)) return;
      setActivityStatus(`Operation ${action === 'approve' ? 'approved' : 'rejected'}.`);
    } catch (error) {
      if (!activeWorkspaceIsCurrent(operation.sessionId, workspaceGeneration)) return;
      const stateChanged = error instanceof SessiondRequestError && error.status === 409;
      if (stateChanged) {
        const authoritative = await fetchOperation(operation.id).catch(() => null);
        if (!activeWorkspaceIsCurrent(operation.sessionId, workspaceGeneration)) return;
        if (authoritative && selectedOperationIdRef.current === operation.id) setSelectedOperation(authoritative);
        await refreshOperations(operation.sessionId, false);
        if (!activeWorkspaceIsCurrent(operation.sessionId, workspaceGeneration)) return;
      }
      setActivityError(error instanceof Error ? error.message : String(error));
      setActivityStatus(
        stateChanged
          ? 'The review action did not complete. Activity was refreshed from sessiond.'
          : 'The review action did not complete.',
      );
    } finally {
      if (activeWorkspaceIsCurrent(operation.sessionId, workspaceGeneration)) setActivityPendingAction('');
    }
  }

  async function refreshSessions() {
    const requestId = ++sessionListRequestRef.current;
    try {
      const nextSessions = await listSessions();
      if (requestId !== sessionListRequestRef.current) return null;
      setSessions(nextSessions);
      selectActiveSession(pickPreferredSessionId(nextSessions, activeSessionIdRef.current));
      return nextSessions;
    } catch (error) {
      if (requestId === sessionListRequestRef.current) throw error;
      return null;
    }
  }

  function selectActiveSession(sessionId: string) {
    if (activeSessionIdRef.current !== sessionId) {
      workspaceSelectionGenerationRef.current += 1;
      explorerRequestRef.current += 1;
      gitRequestRef.current += 1;
      codeTrustRequestRef.current += 1;
      codeTrustApprovalsRequestRef.current += 1;
      packageSummaryRequestRef.current += 1;
      profilingRequestRef.current += 1;
      activityListRequestRef.current += 1;
      activityDetailRequestRef.current += 1;
      pendingRunRequestRef.current = null;
      setExplorerBusy(false);
      setGitBusy(false);
      setApprovalsBusy(false);
      setPackageBusy(false);
      setProfileBusy(false);
      setApprovalActionId('');
      setArtifactActionPath('');
      setActivityLoading(false);
      setActivityPendingAction('');
      setPendingRunAfterBuild(false);
    }
    activeSessionIdRef.current = sessionId;
    setActiveSessionId(sessionId);
  }

  function activeWorkspaceIsCurrent(sessionId: string, generation: number) {
    return activeSessionIdRef.current === sessionId
      && workspaceSelectionGenerationRef.current === generation;
  }

  async function refreshExplorer(sessionId: string, relativePath = '.') {
    const requestId = ++explorerRequestRef.current;
    if (!sessionId) {
      setExplorerEntries([]);
      setExplorerPath('.');
      setSelectedExplorerPath('');
      setSelectedFilePreview('');
      setExplorerBusy(false);
      return;
    }

    setExplorerBusy(true);
    try {
      const listing = await listFiles(sessionId, relativePath);
      if (requestId !== explorerRequestRef.current || activeSessionIdRef.current !== sessionId) return;
      setExplorerPath(listing.path);
      setExplorerEntries(listing.entries);
      const firstFile = listing.entries.find((entry) => entry.kind === 'file');
      if (firstFile) {
        setSelectedExplorerPath(firstFile.path);
        const preview = await readFile(sessionId, firstFile.path);
        if (requestId !== explorerRequestRef.current || activeSessionIdRef.current !== sessionId) return;
        setSelectedFilePreview(preview.content.slice(0, 1200));
      } else {
        setSelectedExplorerPath('');
        setSelectedFilePreview('');
      }
    } catch (error) {
      if (requestId === explorerRequestRef.current && activeSessionIdRef.current === sessionId) throw error;
    } finally {
      if (requestId === explorerRequestRef.current) setExplorerBusy(false);
    }
  }

  async function refreshGit(sessionId: string) {
    const requestId = ++gitRequestRef.current;
    if (!sessionId) {
      setGitStatus(emptyGitStatus);
      setGitBusy(false);
      return;
    }

    setGitBusy(true);
    try {
      const nextStatus = await fetchGitStatus(sessionId);
      if (requestId === gitRequestRef.current && activeSessionIdRef.current === sessionId) {
        setGitStatus(nextStatus);
      }
    } catch (error) {
      if (requestId === gitRequestRef.current && activeSessionIdRef.current === sessionId) throw error;
    } finally {
      if (requestId === gitRequestRef.current) setGitBusy(false);
    }
  }

  async function refreshCodeTrust(sessionId: string) {
    const requestId = ++codeTrustRequestRef.current;
    if (!sessionId) {
      setCodeTrustSummary(null);
      return;
    }

    try {
      const nextSummary = await fetchCodeTrustSummary(sessionId);
      if (requestId === codeTrustRequestRef.current && activeSessionIdRef.current === sessionId) {
        setCodeTrustSummary(nextSummary);
      }
    } catch (error) {
      if (requestId === codeTrustRequestRef.current && activeSessionIdRef.current === sessionId) throw error;
    }
  }

  async function refreshCodeTrustApprovals(sessionId: string) {
    const requestId = ++codeTrustApprovalsRequestRef.current;
    if (!sessionId) {
      setCodeTrustApprovals([]);
      setApprovalsBusy(false);
      return;
    }

    setApprovalsBusy(true);
    try {
      const nextApprovals = await fetchCodeTrustApprovals(sessionId);
      if (requestId === codeTrustApprovalsRequestRef.current && activeSessionIdRef.current === sessionId) {
        setCodeTrustApprovals(nextApprovals);
      }
    } catch (error) {
      if (requestId === codeTrustApprovalsRequestRef.current && activeSessionIdRef.current === sessionId) throw error;
    } finally {
      if (requestId === codeTrustApprovalsRequestRef.current) setApprovalsBusy(false);
    }
  }

  async function refreshPackageSummary(sessionId: string) {
    const requestId = ++packageSummaryRequestRef.current;
    if (!sessionId) {
      setPackageSummary(null);
      return;
    }

    try {
      const nextSummary = await fetchPackageInspect(sessionId);
      if (requestId === packageSummaryRequestRef.current && activeSessionIdRef.current === sessionId) {
        setPackageSummary(nextSummary);
      }
    } catch (error) {
      if (requestId === packageSummaryRequestRef.current && activeSessionIdRef.current === sessionId) throw error;
    }
  }

  async function refreshProfiling(sessionId: string) {
    const requestId = ++profilingRequestRef.current;
    if (!sessionId) {
      setProfileSummary(null);
      setProfileCaptureList(null);
      return;
    }

    try {
      const [nextSummary, nextCaptures] = await Promise.all([
        fetchProfileLive(sessionId),
        fetchProfileCaptures(sessionId, 6),
      ]);
      if (requestId === profilingRequestRef.current && activeSessionIdRef.current === sessionId) {
        setProfileSummary(nextSummary);
        setProfileCaptureList(nextCaptures);
      }
    } catch (error) {
      if (requestId === profilingRequestRef.current && activeSessionIdRef.current === sessionId) throw error;
    }
  }

  async function navigateDirPicker(nextPath: string) {
    const requestId = ++dirPickerRequestRef.current;
    setDirPickerBusy(true);
    setDirPickerError('');
    setDirPickerPath(nextPath);
    try {
      const listing = await listHostDirectories(nextPath);
      if (requestId !== dirPickerRequestRef.current) return;
      setDirPickerPath(listing.path);
      setDirPickerEntries(listing.entries);
    } catch (error) {
      if (requestId !== dirPickerRequestRef.current) return;
      setDirPickerError(error instanceof Error ? error.message : String(error));
      setDirPickerEntries([]);
    } finally {
      if (requestId === dirPickerRequestRef.current) setDirPickerBusy(false);
    }
  }

  function openDirPicker(startPath: string) {
    const fallback = platformInfo?.defaultBrowsePath || '/';
    const nextPath = startPath.trim() || fallback;
    setDirPickerOpen(true);
    setDirPickerPath(nextPath);
    setDirPickerEntries([]);
    setDirPickerError('');
    void navigateDirPicker(nextPath);
  }

  function closeDirPicker() {
    dirPickerRequestRef.current += 1;
    setDirPickerOpen(false);
    setDirPickerPath('/');
    setDirPickerEntries([]);
    setDirPickerError('');
    setDirPickerBusy(false);
  }

  async function activateSession(sessionId: string) {
    selectActiveSession(sessionId);
    await Promise.all([
      refreshExplorer(sessionId, '.'),
      refreshGit(sessionId),
      refreshPackageSummary(sessionId),
      refreshProfiling(sessionId),
      refreshCodeTrust(sessionId),
      refreshCodeTrustApprovals(sessionId),
    ]);
  }

  function loadSessionIntoForm(session: EngineSession) {
    setEditingSessionId(session.id);
    setNewSessionName(session.name);
    setNewSessionRoot(session.rootPath);
    closeDirPicker();
  }

  function resetSessionForm() {
    setEditingSessionId('');
    setNewSessionName('');
    setNewSessionRoot(platformInfo?.defaultBrowsePath || '');
    closeDirPicker();
  }

  useEffect(() => {
    let cancelled = false;

    async function loadBackendState() {
      try {
        const health = await fetchSessiondHealth();
        if (cancelled) {
          return;
        }
        setSessiondState('connected');
        setSessiondMessage(`${health.service} online`);
        const nextPlatformInfo = await fetchPlatformInfo().catch(() => null);
        if (!cancelled && nextPlatformInfo) {
          setPlatformInfo(nextPlatformInfo);
          if (nextPlatformInfo.defaultBrowsePath) {
            setNewSessionRoot(nextPlatformInfo.defaultBrowsePath);
            setDirPickerPath(nextPlatformInfo.defaultBrowsePath);
          }
        }
        const runtimeRequestId = runtimeLifecycleRequestRef.current;
        const buildRequestId = buildLifecycleRequestRef.current;
        const [nextRuntimeStatus, nextBuildStatus] = await Promise.all([
          fetchRuntimeStatus().catch(() => stoppedRuntimeStatus),
          fetchBuildStatus().catch(() => idleBuildStatus),
        ]);
        if (!cancelled) {
          if (runtimeLifecycleRequestRef.current === runtimeRequestId) setRuntimeStatus(nextRuntimeStatus);
          if (buildLifecycleRequestRef.current === buildRequestId) setBuildStatus(nextBuildStatus);
        }
        const sessionListRequestId = ++sessionListRequestRef.current;
        const nextSessions = await listSessions();
        if (cancelled || sessionListRequestId !== sessionListRequestRef.current) {
          return;
        }
        setSessions(nextSessions);
        if (nextSessions.length) {
          const nextActiveSessionId = pickPreferredSessionId(nextSessions);
          selectActiveSession(nextActiveSessionId);
          await refreshExplorer(nextActiveSessionId, '.');
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        setSessiondState('offline');
        setSessiondMessage(error instanceof Error ? error.message : String(error));
      }
    }

    loadBackendState();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    terminalTabsRef.current = terminalTabs;
  }, [terminalTabs]);

  useEffect(() => {
    if (!activeSessionId) {
      setGitStatus(emptyGitStatus);
      setPackageSummary(null);
      setProfileSummary(null);
      setProfileCaptureList(null);
      setCodeTrustSummary(null);
      setCodeTrustApprovals([]);
      void refreshOperations('');
      return;
    }

    setOperations([]);
    setSelectedOperationId('');
    selectedOperationIdRef.current = '';
    activityDetailRequestRef.current += 1;
    setSelectedOperation(null);
    void refreshOperations(activeSessionId);

    void Promise.all([
      refreshGit(activeSessionId),
      refreshPackageSummary(activeSessionId),
      refreshProfiling(activeSessionId),
      refreshCodeTrust(activeSessionId),
      refreshCodeTrustApprovals(activeSessionId),
    ]).catch((error) => {
      setSessiondState('offline');
      setSessiondMessage(error instanceof Error ? error.message : String(error));
    });
  }, [activeSessionId]);

  useEffect(() => {
    if (terminalTabs.length) {
      return;
    }
    const nextTab = createTerminalTab(1, defaultShell);
    setTerminalTabs([nextTab]);
    setActiveTerminalTabId(nextTab.id);
  }, [defaultShell, terminalTabs.length]);

  useEffect(() => {
    if (!terminalTabs.length) {
      return;
    }
    if (terminalTabs.some((tab) => tab.id === activeTerminalTabId)) {
      return;
    }
    setActiveTerminalTabId(terminalTabs[0].id);
  }, [activeTerminalTabId, terminalTabs]);

  useEffect(() => {
    const unsubscribe = subscribeSessiondEvents((event: SessiondTerminalEvent) => {
      if (event.type === 'terminal.output') {
        setTerminalTabs((current) =>
          current.map((tab) =>
            tab.runtimeTerminalId === event.data.terminalId
              ? { ...tab, output: trimTerminalOutput(`${tab.output}${event.data.data}`) }
              : tab,
          ),
        );
        return;
      }

      if (event.type === 'terminal.exit') {
        setTerminalTabs((current) =>
          current.map((tab) =>
            tab.runtimeTerminalId === event.data.terminalId
              ? { ...tab, runtimeTerminalId: null, status: 'error', openError: `Exited (${event.data.exitCode})` }
              : tab,
          ),
        );
        return;
      }

      if (event.type === 'runtime.log') {
        setRuntimeLog((current) => trimTerminalOutput(`${current}${event.data.data}`));
        return;
      }

      if (event.type === 'runtime.status' || event.type === 'runtime.started') {
        runtimeLifecycleRequestRef.current += 1;
        setRuntimeStatus(event.data);
        return;
      }

      if (event.type === 'runtime.exit') {
        runtimeLifecycleRequestRef.current += 1;
        setRuntimeStatus({
          ...stoppedRuntimeStatus,
          executablePath: event.data.executablePath,
        });
        if ((event.data.exitCode ?? 0) !== 0 || event.data.signal != null) {
          recordViewerBridgeEvent({
            title: 'Runtime exited unexpectedly',
            detail: `${event.data.scene} · code ${event.data.exitCode ?? 'null'} · signal ${event.data.signal ?? 'none'}`,
            at: new Date().toISOString(),
            tone: 'error',
          });
        }
        setRuntimeLog((current) =>
          trimTerminalOutput(`${current}[runtime] exited with code ${event.data.exitCode ?? 'null'}\n`),
        );
        return;
      }

      if (event.type === 'build.log') {
        setBuildLog((current) => trimTerminalOutput(`${current}${event.data.data}`));
        return;
      }

      if (
        event.type === 'build.status' ||
        event.type === 'build.started' ||
        event.type === 'build.completed'
      ) {
        buildLifecycleRequestRef.current += 1;
        setBuildStatus(event.data);
        if (event.data.buildDir) {
          setBuildDir(event.data.buildDir);
        }
        if (event.data.config === 'Debug' || event.data.config === 'Release') {
          setBuildConfig(event.data.config);
        }
        if (event.type === 'build.completed') {
          recordViewerBridgeEvent({
            title: `Build ${buildStateLabel(event.data.state).toLowerCase()}`,
            detail: [event.data.target || 'runtime', event.data.config || buildConfig, event.data.buildDir || buildDir]
              .filter(Boolean)
              .join(' · '),
            at: event.data.finishedAt || event.data.startedAt || new Date().toISOString(),
            tone: buildStatusTone(event.data.state),
          });
        }
        return;
      }

      if (
        event.type === 'code-trust.approval.created'
        || event.type === 'code-trust.approval.resolved'
      ) {
        if (!event.data.sessionId || event.data.sessionId === activeSessionId) {
          refreshApprovalPanelForActiveSession();
        }
        return;
      }

      if (event.type === 'code-trust.artifact.transitioned') {
        if (!event.data.sessionId || event.data.sessionId === activeSessionId) {
          void refreshCodeTrust(activeSessionId);
        }
        return;
      }

      if (
        event.type === 'operation.previewed'
        || event.type === 'operation.approved'
        || event.type === 'operation.rejected'
        || event.type === 'operation.applied'
        || event.type === 'operation.undone'
        || event.type === 'operation.conflicted'
      ) {
        if (event.data.sessionId === activeSessionId) {
          setOperationEventEpoch((current) => current + 1);
          void refreshOperations(activeSessionId, false);
        }
      }
    });

    return unsubscribe;
  }, [activeSessionId, refreshApprovalPanelForActiveSession]);

  useEffect(() => {
    if (!pendingRunAfterBuild) {
      return;
    }

    if (buildStatus.state === 'succeeded') {
      const runRequest = pendingRunRequestRef.current;
      setPendingRunAfterBuild(false);
      pendingRunRequestRef.current = null;
      if (!runRequest) {
        return;
      }
      if (activeSessionId !== runRequest.sessionId || launchScene !== runRequest.scene) {
        recordViewerBridgeEvent({
          title: 'Play skipped after build',
          detail: 'The selected workspace or world changed while the build was running.',
          at: new Date().toISOString(),
          tone: 'idle',
        });
        setBuildLog((current) => trimTerminalOutput(`${current}[build] play skipped because the selected world changed\n`));
        return;
      }

      const requestedScene = runRequest.scene;
      const requestedSessionId = runRequest.sessionId || undefined;
      if (runtimeStatus.state === 'running' || runtimeStatus.state === 'paused') {
        const requestId = ++runtimeLifecycleRequestRef.current;
        void restartRuntime(requestedScene, requestedSessionId)
          .then((nextStatus) => {
            if (runtimeLifecycleRequestRef.current !== requestId) return;
            setRuntimeStatus(nextStatus);
            recordViewerBridgeEvent({
              title: 'Runtime restarted after build',
              detail: `${nextStatus.scene || requestedScene} · ${nextStatus.pid ? `pid ${nextStatus.pid}` : 'pending pid'}`,
              at: new Date().toISOString(),
              tone: runtimeStateTone(nextStatus.state),
            });
            setRuntimeLog((current) => trimTerminalOutput(`${current}[runtime] restart requested after build\n`));
            selectBottomTab('Logs');
          })
          .catch((error) => {
            if (runtimeLifecycleRequestRef.current !== requestId) return;
            recordViewerBridgeEvent({
              title: 'Restart after build failed',
              detail: error instanceof Error ? error.message : String(error),
              at: new Date().toISOString(),
              tone: 'error',
            });
            setRuntimeLog((current) =>
              trimTerminalOutput(`${current}[runtime] ${error instanceof Error ? error.message : String(error)}\n`),
            );
          });
        return;
      }

      const requestId = ++runtimeLifecycleRequestRef.current;
      void startRuntime(requestedScene, requestedSessionId)
        .then((nextStatus) => {
          if (runtimeLifecycleRequestRef.current !== requestId) return;
          setRuntimeStatus(nextStatus);
          recordViewerBridgeEvent({
            title: 'Runtime started after build',
            detail: `${nextStatus.scene || requestedScene} · ${nextStatus.pid ? `pid ${nextStatus.pid}` : 'pending pid'}`,
            at: new Date().toISOString(),
            tone: runtimeStateTone(nextStatus.state),
          });
          setRuntimeLog((current) => trimTerminalOutput(`${current}[runtime] start requested after build\n`));
          selectBottomTab('Logs');
        })
        .catch((error) => {
          if (runtimeLifecycleRequestRef.current !== requestId) return;
          recordViewerBridgeEvent({
            title: 'Start after build failed',
            detail: error instanceof Error ? error.message : String(error),
            at: new Date().toISOString(),
            tone: 'error',
          });
          setRuntimeLog((current) =>
            trimTerminalOutput(`${current}[runtime] ${error instanceof Error ? error.message : String(error)}\n`),
          );
        });
      return;
    }

    if (buildStatus.state === 'failed' || buildStatus.state === 'stopped') {
      setPendingRunAfterBuild(false);
      pendingRunRequestRef.current = null;
    }
  }, [activeSessionId, buildStatus.state, launchScene, pendingRunAfterBuild, runtimeStatus.state]);

  useEffect(() => {
    for (const tab of terminalTabs) {
      if (tab.status !== 'connecting' || tab.runtimeTerminalId || terminalOpeningRef.current.has(tab.id)) {
        continue;
      }

      terminalOpeningRef.current.add(tab.id);
      void openTerminal({
        sessionId: activeSessionId || undefined,
        cwd: tab.cwd,
        shell: tab.shell,
        cols: tab.cols,
        rows: tab.rows,
      })
        .then((result: SessionTerminalOpen) => {
          setTerminalTabs((current) =>
            current.map((candidate) =>
              candidate.id === tab.id
                ? {
                    ...candidate,
                    runtimeTerminalId: result.terminalId,
                    cwd: result.cwd,
                    cols: result.cols,
                    rows: result.rows,
                    status: 'connected',
                    openError: '',
                  }
                : candidate,
            ),
          );
          setSessiondState('connected');
        })
        .catch((error) => {
          setTerminalTabs((current) =>
            current.map((candidate) =>
              candidate.id === tab.id
                ? {
                    ...candidate,
                    runtimeTerminalId: null,
                    status: 'error',
                    openError: error instanceof Error ? error.message : String(error),
                  }
                : candidate,
            ),
          );
          setSessiondState('offline');
          setSessiondMessage(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          terminalOpeningRef.current.delete(tab.id);
        });
    }
  }, [activeSessionId, terminalTabs]);

  async function handleCreateSession() {
    try {
      setSessionActionBusy(true);
      const session = await createSession({
        name: newSessionName.trim() || undefined,
        rootPath: newSessionRoot.trim() || undefined,
      });
      if (!(await refreshSessions())) return;
      await activateSession(session.id);
      resetSessionForm();
      setSessiondState('connected');
      setSessiondMessage(`Created session ${session.name}`);
    } catch (error) {
      setSessiondState('offline');
      setSessiondMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSessionActionBusy(false);
    }
  }

  async function handleSaveSession() {
    if (!editingSessionId) {
      return;
    }

    try {
      setSessionActionBusy(true);
      const session = await updateSession(editingSessionId, {
        name: newSessionName.trim() || undefined,
        rootPath: newSessionRoot.trim() || undefined,
      });
      if (!(await refreshSessions())) return;
      await activateSession(session.id);
      resetSessionForm();
      setSessiondState('connected');
      setSessiondMessage(`Updated session ${session.name}`);
    } catch (error) {
      setSessiondState('offline');
      setSessiondMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSessionActionBusy(false);
    }
  }

  async function handleDeleteSession(sessionId: string) {
    const session = sessions.find((candidate) => candidate.id === sessionId);
    if (!session) {
      return;
    }
    if (!window.confirm(`Delete session "${session.name}"?`)) {
      return;
    }

    try {
      setSessionActionBusy(true);
      await deleteSession(sessionId);
      const nextSessions = await refreshSessions();
      if (!nextSessions) return;
      const nextActiveSessionId = pickPreferredSessionId(
        nextSessions,
        activeSessionId === sessionId ? '' : activeSessionId,
      );
      selectActiveSession(nextActiveSessionId);
      if (nextActiveSessionId) {
        await activateSession(nextActiveSessionId);
      } else {
        setExplorerEntries([]);
        setExplorerPath('.');
        setSelectedExplorerPath('');
        setSelectedFilePreview('');
        setGitStatus(emptyGitStatus);
        setPackageSummary(null);
        setProfileSummary(null);
        setProfileCaptureList(null);
        setCodeTrustSummary(null);
        setCodeTrustApprovals([]);
      }
      if (editingSessionId === sessionId) {
        resetSessionForm();
      }
      setSessiondState('connected');
      setSessiondMessage(`Deleted session ${session.name}`);
    } catch (error) {
      setSessiondState('offline');
      setSessiondMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSessionActionBusy(false);
    }
  }

  async function handleRefreshSessions() {
    try {
      setSessionActionBusy(true);
      const nextSessions = await refreshSessions();
      if (!nextSessions) return;
      setSessiondState('connected');
      setSessiondMessage(`Synced sessions from ${getSessiondBaseUrl()}`);
      const explorerSessionId = pickPreferredSessionId(nextSessions, activeSessionId);
      if (explorerSessionId) {
        await refreshExplorer(explorerSessionId, explorerPath);
        await Promise.all([
          refreshGit(explorerSessionId),
          refreshPackageSummary(explorerSessionId),
          refreshProfiling(explorerSessionId),
          refreshCodeTrust(explorerSessionId),
          refreshCodeTrustApprovals(explorerSessionId),
        ]);
      }
    } catch (error) {
      setSessiondState('offline');
      setSessiondMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSessionActionBusy(false);
    }
  }

  async function handleDeleteHarnessSessions() {
    const disposableSessions = sessions.filter((session) => isHarnessSession(session));
    if (!disposableSessions.length) {
      return;
    }
    if (!window.confirm(`Delete ${disposableSessions.length} temporary harness workspace record(s)?`)) {
      return;
    }

    try {
      setSessionActionBusy(true);
      for (const session of disposableSessions) {
        await deleteSession(session.id);
      }
      const nextSessions = await refreshSessions();
      if (!nextSessions) return;
      const nextActiveSessionId = pickPreferredSessionId(nextSessions, activeSessionId);
      selectActiveSession(nextActiveSessionId);
      if (nextActiveSessionId) {
        await activateSession(nextActiveSessionId);
      } else {
        setExplorerEntries([]);
        setExplorerPath('.');
        setSelectedExplorerPath('');
        setSelectedFilePreview('');
        setGitStatus(emptyGitStatus);
        setPackageSummary(null);
        setProfileSummary(null);
        setProfileCaptureList(null);
        setCodeTrustSummary(null);
        setCodeTrustApprovals([]);
      }
      setSessiondState('connected');
      setSessiondMessage(`Deleted ${disposableSessions.length} temporary harness workspace record(s)`);
    } catch (error) {
      setSessiondState('offline');
      setSessiondMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSessionActionBusy(false);
    }
  }

  async function handleCreateSuggestedWorkspace() {
    const suggestedSession = findSuggestedWorkspaceSession(sessions);
    if (!suggestedSession) {
      return;
    }

    const existingWorkspace = sessions.find(
      (session) =>
        !isHarnessSession(session)
        && session.rootPath.toLowerCase() === suggestedSession.rootPath.toLowerCase(),
    );
    if (existingWorkspace) {
      await activateSession(existingWorkspace.id);
      setSessiondState('connected');
      setSessiondMessage(`Using existing workspace ${existingWorkspace.name}`);
      return;
    }

    try {
      setSessionActionBusy(true);
      const session = await createSession({
        name: getPathLeaf(suggestedSession.rootPath) || 'workspace',
        rootPath: suggestedSession.rootPath,
      });
      if (!(await refreshSessions())) return;
      await activateSession(session.id);
      resetSessionForm();
      setSessiondState('connected');
      setSessiondMessage(`Created workspace ${session.name}`);
    } catch (error) {
      setSessiondState('offline');
      setSessiondMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSessionActionBusy(false);
    }
  }

  async function handleExplorerEntryClick(entry: SessionFileEntry) {
    if (!activeSessionId) {
      return;
    }

    if (entry.kind === 'directory') {
      try {
        await refreshExplorer(activeSessionId, entry.path);
      } catch (error) {
        setSessiondState('offline');
        setSessiondMessage(error instanceof Error ? error.message : String(error));
      }
      return;
    }

    const targetSessionId = activeSessionId;
    const requestId = ++explorerRequestRef.current;
    try {
      setExplorerBusy(true);
      const preview = await readFile(targetSessionId, entry.path);
      if (requestId !== explorerRequestRef.current || activeSessionIdRef.current !== targetSessionId) return;
      setSelectedExplorerPath(entry.path);
      setSelectedFilePreview(preview.content.slice(0, 1200));
    } catch (error) {
      if (requestId !== explorerRequestRef.current || activeSessionIdRef.current !== targetSessionId) return;
      setSessiondState('offline');
      setSessiondMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestId === explorerRequestRef.current) setExplorerBusy(false);
    }
  }

  async function handleExplorerUp() {
    if (!activeSessionId) {
      return;
    }
    try {
      await refreshExplorer(activeSessionId, getParentExplorerPath(explorerPath));
    } catch (error) {
      setSessiondState('offline');
      setSessiondMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleInitGitRepository() {
    if (!activeSessionId) {
      return;
    }

    const targetSessionId = activeSessionId;
    const targetSessionName = activeSession?.name || 'session';
    const requestId = ++gitRequestRef.current;
    try {
      setGitBusy(true);
      const nextStatus = await initGitRepository(targetSessionId);
      if (requestId !== gitRequestRef.current || activeSessionIdRef.current !== targetSessionId) return;
      setGitStatus(nextStatus);
      setSessiondState('connected');
      setSessiondMessage(`Initialized git repository for ${targetSessionName}`);
    } catch (error) {
      if (requestId !== gitRequestRef.current || activeSessionIdRef.current !== targetSessionId) return;
      setSessiondState('offline');
      setSessiondMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestId === gitRequestRef.current) setGitBusy(false);
    }
  }

  const activeSession = sessions.find((session) => session.id === activeSessionId) || null;

  function reportBackendStatus(state: 'connected' | 'offline', message: string) {
    setSessiondState(state);
    setSessiondMessage(message);
  }

  async function handleRefreshApprovals() {
    if (!activeSessionId) {
      return;
    }

    const targetSessionId = activeSessionId;
    const targetSessionName = activeSession?.name || 'workspace';
    const workspaceGeneration = workspaceSelectionGenerationRef.current;
    try {
      await refreshCodeTrustApprovals(targetSessionId);
      if (!activeWorkspaceIsCurrent(targetSessionId, workspaceGeneration)) return;
      setSessiondState('connected');
      setSessiondMessage(`Refreshed code-trust approvals for ${targetSessionName}`);
    } catch (error) {
      if (!activeWorkspaceIsCurrent(targetSessionId, workspaceGeneration)) return;
      setSessiondState('offline');
      setSessiondMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function handleRefreshPackaging() {
    if (!activeSessionId) {
      return;
    }

    const targetSessionId = activeSessionId;
    const targetSessionName = activeSession?.name || 'workspace';
    const workspaceGeneration = workspaceSelectionGenerationRef.current;
    try {
      setPackageBusy(true);
      await refreshPackageSummary(targetSessionId);
      if (!activeWorkspaceIsCurrent(targetSessionId, workspaceGeneration)) return;
      setSessiondState('connected');
      setSessiondMessage(`Refreshed export preset for ${targetSessionName}`);
    } catch (error) {
      if (!activeWorkspaceIsCurrent(targetSessionId, workspaceGeneration)) return;
      setSessiondState('offline');
      setSessiondMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (activeWorkspaceIsCurrent(targetSessionId, workspaceGeneration)) setPackageBusy(false);
    }
  }

  async function handleRunPackaging() {
    if (!activeSessionId) {
      return;
    }

    const targetSessionId = activeSessionId;
    const workspaceGeneration = workspaceSelectionGenerationRef.current;
    try {
      setPackageBusy(true);
      const result = await runPackageRelease(targetSessionId);
      if (!activeWorkspaceIsCurrent(targetSessionId, workspaceGeneration)) return;
      await Promise.all([
        refreshPackageSummary(targetSessionId),
        refreshProfiling(targetSessionId),
      ]);
      if (!activeWorkspaceIsCurrent(targetSessionId, workspaceGeneration)) return;
      setSessiondState('connected');
      setSessiondMessage(
        result.prerequisiteActions.length
          ? `Packaged release layout at ${result.packageRootPath} after ${result.prerequisiteActions.length} prerequisite action${result.prerequisiteActions.length === 1 ? '' : 's'}`
          : `Packaged release layout at ${result.packageRootPath}`,
      );
    } catch (error) {
      if (!activeWorkspaceIsCurrent(targetSessionId, workspaceGeneration)) return;
      setSessiondState('offline');
      setSessiondMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (activeWorkspaceIsCurrent(targetSessionId, workspaceGeneration)) setPackageBusy(false);
    }
  }

  async function handleRefreshProfile() {
    if (!activeSessionId) {
      return;
    }

    const targetSessionId = activeSessionId;
    const targetSessionName = activeSession?.name || 'workspace';
    const workspaceGeneration = workspaceSelectionGenerationRef.current;
    try {
      setProfileBusy(true);
      await refreshProfiling(targetSessionId);
      if (!activeWorkspaceIsCurrent(targetSessionId, workspaceGeneration)) return;
      setSessiondState('connected');
      setSessiondMessage(`Refreshed diagnostics snapshot for ${targetSessionName}`);
    } catch (error) {
      if (!activeWorkspaceIsCurrent(targetSessionId, workspaceGeneration)) return;
      setSessiondState('offline');
      setSessiondMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (activeWorkspaceIsCurrent(targetSessionId, workspaceGeneration)) setProfileBusy(false);
    }
  }

  async function handleCaptureProfile() {
    if (!activeSessionId) {
      return;
    }

    const targetSessionId = activeSessionId;
    const workspaceGeneration = workspaceSelectionGenerationRef.current;
    try {
      setProfileBusy(true);
      const result = await captureProfile(targetSessionId);
      if (!activeWorkspaceIsCurrent(targetSessionId, workspaceGeneration)) return;
      await refreshProfiling(targetSessionId);
      if (!activeWorkspaceIsCurrent(targetSessionId, workspaceGeneration)) return;
      setSessiondState('connected');
      setSessiondMessage(`Captured diagnostics report at ${result.outputPath}`);
    } catch (error) {
      if (!activeWorkspaceIsCurrent(targetSessionId, workspaceGeneration)) return;
      setSessiondState('offline');
      setSessiondMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (activeWorkspaceIsCurrent(targetSessionId, workspaceGeneration)) setProfileBusy(false);
    }
  }

  async function handleDecideApproval(approvalId: string, decision: 'approved' | 'denied') {
    if (!activeSessionId) {
      return;
    }

    const targetSessionId = activeSessionId;
    const workspaceGeneration = workspaceSelectionGenerationRef.current;
    try {
      setApprovalActionId(approvalId);
      const result = await decideCodeTrustApproval(approvalId, decision);
      if (!activeWorkspaceIsCurrent(targetSessionId, workspaceGeneration)) return;
      await Promise.all([
        refreshCodeTrust(targetSessionId),
        refreshCodeTrustApprovals(targetSessionId),
      ]);
      if (!activeWorkspaceIsCurrent(targetSessionId, workspaceGeneration)) return;
      if (decision === 'approved' && result.approval.operationType === 'file_write') {
        await refreshExplorer(targetSessionId, explorerPath);
        if (!activeWorkspaceIsCurrent(targetSessionId, workspaceGeneration)) return;
      }
      setSessiondState('connected');
      setSessiondMessage(`${decision === 'approved' ? 'Approved' : 'Denied'} ${result.approval.summary}`);
    } catch (error) {
      if (!activeWorkspaceIsCurrent(targetSessionId, workspaceGeneration)) return;
      setSessiondState('offline');
      setSessiondMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (activeWorkspaceIsCurrent(targetSessionId, workspaceGeneration)) setApprovalActionId('');
    }
  }

  async function handleTransitionArtifact(path: string, transition: 'promote' | 'quarantine') {
    if (!activeSessionId) {
      return;
    }

    const targetSessionId = activeSessionId;
    const workspaceGeneration = workspaceSelectionGenerationRef.current;
    try {
      setArtifactActionPath(path);
      const result = await transitionCodeTrustArtifact(targetSessionId, path, transition);
      if (!activeWorkspaceIsCurrent(targetSessionId, workspaceGeneration)) return;
      await refreshCodeTrust(targetSessionId);
      if (!activeWorkspaceIsCurrent(targetSessionId, workspaceGeneration)) return;
      setSessiondState('connected');
      setSessiondMessage(
        `${transition === 'promote' ? 'Promoted' : 'Quarantined'} ${result.artifact.path}`,
      );
    } catch (error) {
      if (!activeWorkspaceIsCurrent(targetSessionId, workspaceGeneration)) return;
      setSessiondState('offline');
      setSessiondMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (activeWorkspaceIsCurrent(targetSessionId, workspaceGeneration)) setArtifactActionPath('');
    }
  }

  function handleAddTerminal() {
    setTerminalTabs((current) => {
      const nextTab = createTerminalTab(current.length + 1, defaultShell);
      setActiveTerminalTabId(nextTab.id);
      return [...current, nextTab];
    });
    selectBottomTab('Terminal');
  }

  async function handleCloseTerminalTab(tabId: string) {
    const tab = terminalTabsRef.current.find((candidate) => candidate.id === tabId);
    if (tab?.runtimeTerminalId) {
      try {
        await closeTerminal(tab.runtimeTerminalId);
      } catch {
        // Best effort close.
      }
    }

    setTerminalTabs((current) => current.filter((candidate) => candidate.id !== tabId));
    if (activeTerminalTabId === tabId) {
      const remaining = terminalTabsRef.current.filter((candidate) => candidate.id !== tabId);
      setActiveTerminalTabId(remaining[0]?.id || '');
    }
  }

  async function handleChangeTerminalShell(tabId: string, shell: TerminalShell) {
    const tab = terminalTabsRef.current.find((candidate) => candidate.id === tabId);
    if (tab?.runtimeTerminalId) {
      try {
        await closeTerminal(tab.runtimeTerminalId);
      } catch {
        // Best effort close.
      }
    }

    setTerminalTabs((current) =>
      current.map((candidate) =>
        candidate.id === tabId
          ? {
              ...candidate,
              shell,
              runtimeTerminalId: null,
              status: 'connecting',
              openError: '',
              output: '',
            }
          : candidate,
      ),
    );
  }

  function handleClearTerminal(tabId: string) {
    setTerminalTabs((current) =>
      current.map((candidate) => (candidate.id === tabId ? { ...candidate, output: '' } : candidate)),
    );
  }

  function handleTerminalInput(tabId: string, input: string) {
    const tab = terminalTabsRef.current.find((candidate) => candidate.id === tabId);
    if (!tab?.runtimeTerminalId) {
      return;
    }
    void writeTerminalInput(tab.runtimeTerminalId, input).catch((error) => {
      setTerminalTabs((current) =>
        current.map((candidate) =>
          candidate.id === tabId
            ? {
                ...candidate,
                status: 'error',
                openError: error instanceof Error ? error.message : String(error),
              }
            : candidate,
        ),
      );
    });
  }

  function handleTerminalResize(tabId: string, cols: number, rows: number) {
    const tab = terminalTabsRef.current.find((candidate) => candidate.id === tabId);
    if (!tab?.runtimeTerminalId) {
      return;
    }
    if (tab.cols === cols && tab.rows === rows) {
      return;
    }
    void resizeTerminal(tab.runtimeTerminalId, cols, rows)
      .then((result) => {
        setTerminalTabs((current) =>
          current.map((candidate) =>
            candidate.id === tabId
              ? { ...candidate, cols: result.cols, rows: result.rows }
              : candidate,
          ),
        );
      })
      .catch(() => {});
  }

  async function handleStartRuntime() {
    const requestId = ++runtimeLifecycleRequestRef.current;
    try {
      const nextStatus = await startRuntime(launchScene, activeSessionId || undefined);
      if (runtimeLifecycleRequestRef.current !== requestId) return;
      setRuntimeStatus(nextStatus);
      recordViewerBridgeEvent({
        title: 'Runtime started',
        detail: `${nextStatus.scene || launchScene} · ${nextStatus.pid ? `pid ${nextStatus.pid}` : 'pending pid'}`,
        at: new Date().toISOString(),
        tone: runtimeStateTone(nextStatus.state),
      });
      setRuntimeLog((current) => trimTerminalOutput(`${current}[runtime] start requested\n`));
      selectBottomTab('Logs');
    } catch (error) {
      if (runtimeLifecycleRequestRef.current !== requestId) return;
      recordViewerBridgeEvent({
        title: 'Runtime start failed',
        detail: error instanceof Error ? error.message : String(error),
        at: new Date().toISOString(),
        tone: 'error',
      });
      setRuntimeLog((current) =>
        trimTerminalOutput(`${current}[runtime] ${error instanceof Error ? error.message : String(error)}\n`),
      );
    }
  }

  async function handleStopRuntime() {
    const requestId = ++runtimeLifecycleRequestRef.current;
    try {
      const nextStatus = await stopRuntime();
      if (runtimeLifecycleRequestRef.current !== requestId) return;
      setRuntimeStatus(nextStatus);
      recordViewerBridgeEvent({
        title: 'Runtime stopped',
        detail: launchScene,
        at: new Date().toISOString(),
        tone: 'idle',
      });
      setRuntimeLog((current) => trimTerminalOutput(`${current}[runtime] stop requested\n`));
      selectBottomTab('Logs');
    } catch (error) {
      if (runtimeLifecycleRequestRef.current !== requestId) return;
      recordViewerBridgeEvent({
        title: 'Runtime stop failed',
        detail: error instanceof Error ? error.message : String(error),
        at: new Date().toISOString(),
        tone: 'error',
      });
      setRuntimeLog((current) =>
        trimTerminalOutput(`${current}[runtime] ${error instanceof Error ? error.message : String(error)}\n`),
      );
    }
  }

  async function handlePauseRuntime() {
    const requestId = ++runtimeLifecycleRequestRef.current;
    try {
      const nextStatus = await pauseRuntime();
      if (runtimeLifecycleRequestRef.current !== requestId) return;
      setRuntimeStatus(nextStatus);
      recordViewerBridgeEvent({
        title: 'Runtime paused',
        detail: `${nextStatus.scene || launchScene} · ${nextStatus.pid ? `pid ${nextStatus.pid}` : 'pending pid'}`,
        at: nextStatus.pausedAt || new Date().toISOString(),
        tone: 'paused',
      });
      setRuntimeLog((current) => trimTerminalOutput(`${current}[runtime] pause requested\n`));
      selectBottomTab('Logs');
    } catch (error) {
      if (runtimeLifecycleRequestRef.current !== requestId) return;
      recordViewerBridgeEvent({
        title: 'Runtime pause failed',
        detail: error instanceof Error ? error.message : String(error),
        at: new Date().toISOString(),
        tone: 'error',
      });
      setRuntimeLog((current) =>
        trimTerminalOutput(`${current}[runtime] ${error instanceof Error ? error.message : String(error)}\n`),
      );
    }
  }

  async function handleResumeRuntime() {
    const requestId = ++runtimeLifecycleRequestRef.current;
    try {
      const nextStatus = await resumeRuntime();
      if (runtimeLifecycleRequestRef.current !== requestId) return;
      setRuntimeStatus(nextStatus);
      recordViewerBridgeEvent({
        title: 'Runtime resumed',
        detail: `${nextStatus.scene || launchScene} · ${nextStatus.pid ? `pid ${nextStatus.pid}` : 'pending pid'}`,
        at: new Date().toISOString(),
        tone: runtimeStateTone(nextStatus.state),
      });
      setRuntimeLog((current) => trimTerminalOutput(`${current}[runtime] resume requested\n`));
      selectBottomTab('Logs');
    } catch (error) {
      if (runtimeLifecycleRequestRef.current !== requestId) return;
      recordViewerBridgeEvent({
        title: 'Runtime resume failed',
        detail: error instanceof Error ? error.message : String(error),
        at: new Date().toISOString(),
        tone: 'error',
      });
      setRuntimeLog((current) =>
        trimTerminalOutput(`${current}[runtime] ${error instanceof Error ? error.message : String(error)}\n`),
      );
    }
  }

  async function handleRestartRuntime() {
    const requestId = ++runtimeLifecycleRequestRef.current;
    try {
      const nextStatus = await restartRuntime(launchScene, activeSessionId || undefined);
      if (runtimeLifecycleRequestRef.current !== requestId) return;
      setRuntimeStatus(nextStatus);
      recordViewerBridgeEvent({
        title: 'Runtime restarted',
        detail: `${nextStatus.scene || launchScene} · ${nextStatus.pid ? `pid ${nextStatus.pid}` : 'pending pid'}`,
        at: new Date().toISOString(),
        tone: runtimeStateTone(nextStatus.state),
      });
      setRuntimeLog((current) => trimTerminalOutput(`${current}[runtime] restart requested\n`));
      selectBottomTab('Logs');
    } catch (error) {
      if (runtimeLifecycleRequestRef.current !== requestId) return;
      recordViewerBridgeEvent({
        title: 'Runtime restart failed',
        detail: error instanceof Error ? error.message : String(error),
        at: new Date().toISOString(),
        tone: 'error',
      });
      setRuntimeLog((current) =>
        trimTerminalOutput(`${current}[runtime] ${error instanceof Error ? error.message : String(error)}\n`),
      );
    }
  }

  async function requestRuntimeBuild(runAfterBuild = false) {
    const requestId = ++buildLifecycleRequestRef.current;
    const runRequest = runAfterBuild
      ? {
          id: runRequestCounterRef.current + 1,
          sessionId: activeSessionId,
          scene: launchScene,
        }
      : null;
    if (runRequest) {
      runRequestCounterRef.current = runRequest.id;
    }
    pendingRunRequestRef.current = runRequest;
    setPendingRunAfterBuild(runAfterBuild);
    try {
      const nextStatus = await startRuntimeBuild(buildConfig, buildDir.trim() || undefined);
      if (buildLifecycleRequestRef.current !== requestId) return;
      setBuildStatus(nextStatus);
      recordViewerBridgeEvent({
        title: runAfterBuild ? 'Build + Run queued' : 'Build requested',
        detail: [nextStatus.target || 'runtime', nextStatus.config || buildConfig, nextStatus.buildDir || buildDir]
          .filter(Boolean)
          .join(' · '),
        at: nextStatus.startedAt || new Date().toISOString(),
        tone: buildStatusTone(nextStatus.state),
      });
      setBuildLog((current) => trimTerminalOutput(`${current}[build] runtime build requested\n`));
      selectBottomTab('Output');
      selectRightTab('Build');
    } catch (error) {
      if (buildLifecycleRequestRef.current !== requestId) return;
      if (!runRequest || pendingRunRequestRef.current?.id === runRequest.id) {
        pendingRunRequestRef.current = null;
        setPendingRunAfterBuild(false);
      }
      const message = error instanceof Error ? error.message : String(error);
      recordViewerBridgeEvent({
        title: 'Build request failed',
        detail: message,
        at: new Date().toISOString(),
        tone: 'error',
      });
      setBuildStatus({
        ...idleBuildStatus,
        state: 'failed',
        target: 'runtime',
        config: buildConfig,
        buildDir,
        finishedAt: new Date().toISOString(),
        error: message,
      });
      setBuildLog((current) =>
        trimTerminalOutput(`${current}[build] ${message}\n`),
      );
      selectBottomTab('Output');
    }
  }

  function handleStartRuntimeBuild() {
    void requestRuntimeBuild(false);
  }

  function handleBuildAndPlay() {
    void requestRuntimeBuild(true);
  }

  async function handleStopBuild() {
    const requestId = ++buildLifecycleRequestRef.current;
    pendingRunRequestRef.current = null;
    setPendingRunAfterBuild(false);
    try {
      const nextStatus = await stopBuild();
      if (buildLifecycleRequestRef.current !== requestId) return;
      setBuildStatus(nextStatus);
      recordViewerBridgeEvent({
        title: 'Build stopped',
        detail: [nextStatus.target || 'runtime', nextStatus.config || buildConfig, nextStatus.buildDir || buildDir]
          .filter(Boolean)
          .join(' · '),
        at: nextStatus.finishedAt || new Date().toISOString(),
        tone: 'idle',
      });
      setBuildLog((current) => trimTerminalOutput(`${current}[build] stop requested\n`));
      selectBottomTab('Output');
    } catch (error) {
      if (buildLifecycleRequestRef.current !== requestId) return;
      recordViewerBridgeEvent({
        title: 'Build stop failed',
        detail: error instanceof Error ? error.message : String(error),
        at: new Date().toISOString(),
        tone: 'error',
      });
      setBuildLog((current) =>
        trimTerminalOutput(`${current}[build] ${error instanceof Error ? error.message : String(error)}\n`),
      );
      selectBottomTab('Output');
    }
  }

  const terminalDock = (
    <TerminalDock
      activeSession={activeSession}
      activeTabId={activeTerminalTabId}
      availableShells={availableShells}
      onActivateTab={setActiveTerminalTabId}
      onAddTab={handleAddTerminal}
      onChangeShell={handleChangeTerminalShell}
      onClearTab={handleClearTerminal}
      onCloseTab={handleCloseTerminalTab}
      onTerminalInput={handleTerminalInput}
      onTerminalResize={handleTerminalResize}
      tabs={terminalTabs}
    />
  );

  const activityDock = (
    <ActivityDockView
      activeSession={activeSession}
      error={activityError}
      loading={activityLoading}
      onApprove={() => void handleOperationReview('approve')}
      onRefresh={() => void refreshOperations()}
      onReject={() => void handleOperationReview('reject')}
      onSelect={(operationId) => void handleSelectOperation(operationId)}
      operations={operations}
      pendingAction={activityPendingAction}
      selectedOperation={selectedOperation}
      selectedOperationId={selectedOperationId}
      status={activityStatus}
    />
  );

  const defaultBrowsePath = platformInfo?.defaultBrowsePath || '/';
  const workspaceRootPlaceholder = platformInfo?.isWSL
    ? platformInfo.defaultBrowsePath || '/mnt/c/Users'
    : '/home/user/projects/my-game';
  const activeWorkspace = layout.activeWorkspace;
  const activeCenterTab = activeWorkspace;
  const activeWorkspaceLayout = layout.workspaces[activeWorkspace];
  const activeLeftTab = activeWorkspaceLayout.left.tab;
  const activeRightTab = activeWorkspaceLayout.right.tab;
  const activeBottomTab = layout.bottom.tab;
  const leftPaneVisible = activeWorkspaceLayout.left.visible;
  const rightPaneVisible = activeWorkspaceLayout.right.visible;
  const shellPaneGeometry = activeShellPaneGeometry(layout);
  const leftPaneWidth = shellPaneGeometry.left.width;
  const rightPaneWidth = shellPaneGeometry.right.width;
  const bottomPaneCollapsed = layout.bottom.collapsed;
  const bottomPaneMaxHeight = maxShellLayoutBottomHeightForViewport(viewportHeight);
  const bottomPaneMinHeight = effectiveShellBottomMinHeight(bottomPaneMaxHeight);
  const bottomPaneHeight = deriveShellLayoutBottomHeight(layout.bottom.preferredHeight, viewportHeight);
  const bottomPaneVisibleHeight = bottomPaneCollapsed ? COLLAPSED_BOTTOM_PANE_HEIGHT : bottomPaneHeight;
  const bottomPaneResizing = resizeTarget === 'bottom';
  const workspaceSessions = sessions.filter((session) => !isHarnessSession(session));
  const harnessSessions = sessions.filter((session) => isHarnessSession(session));
  const suggestedWorkspaceSession = findSuggestedWorkspaceSession(sessions);
  const activeSessionIsHarness = activeSession ? isHarnessSession(activeSession) : false;

  function handleSelectCenterTab(tab: CenterTab) {
    setShowGuide(false);
    commitLayout({
      ...layoutRef.current,
      activeWorkspace: tab,
    });
  }

  function handleSelectLeftTab(tab: LeftTab) {
    commitLayout(withActiveWorkspacePane(layoutRef.current, { left: { tab } }));
  }

  function handleSelectRightTab(tab: RightTab) {
    selectRightTab(tab);
  }

  return (
    <div className="shell-app">
      <header className="chrome-bar chrome-bar--menu">
        <div className="menu-strip">
          <button
            aria-pressed={showGuide}
            className="menu-button"
            onClick={() => setShowGuide(true)}
            type="button"
          >
            Help
          </button>
        </div>
        <div className="chrome-title">Shader Forge</div>
        <span className="chrome-meta-chip">{activeWorkspace}</span>
        <div className="chrome-strip-meta">
          <div aria-label="Layout controls" className="layout-controls" role="group">
            <button
              aria-controls="workspace-tools-panel"
              aria-pressed={leftPaneVisible}
              className="ghost-button ghost-button--sm"
              onClick={handleToggleLeftPane}
              title="Toggle left sidebar"
              type="button"
            >
              Left
            </button>
            <button
              aria-controls="bottom-dock-panel"
              aria-expanded={!bottomPaneCollapsed}
              className="ghost-button ghost-button--sm"
              onClick={handleToggleBottomPane}
              title="Toggle bottom dock"
              type="button"
            >
              Bottom
            </button>
            <button
              aria-controls="runtime-tools-panel"
              aria-pressed={rightPaneVisible}
              className="ghost-button ghost-button--sm layout-control--right"
              onClick={handleToggleRightPane}
              title="Toggle right sidebar"
              type="button"
            >
              Right
            </button>
            <button
              className="ghost-button ghost-button--sm"
              onClick={handleResetLayout}
              title="Reset all workspace layouts"
              type="button"
            >
              Reset
            </button>
          </div>
          {layoutPersistenceMessage ? (
            <span className="layout-persistence-status" role="status">
              {layoutPersistenceMessage}
            </span>
          ) : null}
          <span
            aria-label={`engine_sessiond ${sessiondState}: ${sessiondMessage}`}
            className={`status-indicator${sessiondState === 'connected' ? ' status-indicator--ok' : sessiondState === 'offline' ? ' status-indicator--err' : ''}`}
            role="status"
            title={sessiondMessage}
          />
          <span className="chrome-meta-chip">{buildConfig}</span>
          {buildStatus.state === 'running' ? <span className="chrome-meta-chip chrome-meta-chip--accent">Building</span> : null}
          {runtimeStatus.state === 'running' ? <span className="chrome-meta-chip chrome-meta-chip--accent">Running</span> : null}
          {runtimeStatus.state === 'paused' ? <span className="chrome-meta-chip chrome-meta-chip--warning">Paused</span> : null}
        </div>
      </header>

      <main
        className={`shell-grid ${shellGridClass(leftPaneVisible, rightPaneVisible)}${shellPaneGeometry.narrow ? ' shell-grid--narrow' : ''}`}
        ref={shellGridRef}
        style={{
          '--shell-left-width': `${leftPaneWidth}px`,
          '--shell-right-width': `${rightPaneWidth}px`,
          '--shell-center-min-width': `${SHELL_LAYOUT_CENTER_WIDTH_MIN}px`,
          '--shell-separator-width': `${SHELL_LAYOUT_SEPARATOR_WIDTH}px`,
        } as CSSProperties}
      >
        <aside className="pane rail-pane" hidden={!leftPaneVisible} id="workspace-tools-pane">
          <nav
            aria-label="Workspace tools"
            className="rail-tabs"
            onKeyDown={(event) => handleTabListKeyDown(event, leftTabs, activeLeftTab, handleSelectLeftTab)}
            role="tablist"
          >
            {leftTabs.map((tab) => (
              <button
                aria-controls="workspace-tools-panel"
                aria-selected={activeLeftTab === tab}
                className={`rail-tab${activeLeftTab === tab ? ' is-active' : ''}`}
                data-tab-id={tab}
                id={`workspace-tool-tab-${tab}`}
                key={tab}
                onClick={() => handleSelectLeftTab(tab)}
                role="tab"
                tabIndex={activeLeftTab === tab ? 0 : -1}
                type="button"
              >
                {tab}
              </button>
            ))}
          </nav>
          {activeLeftTab === 'Workspaces' ? (
            <div
              aria-labelledby="workspace-tool-tab-Workspaces"
              className="rail-content"
              id="workspace-tools-panel"
              role="tabpanel"
            >
              <section className="rail-section">
                <div className="section-titlebar">
                  <h3>{editingSessionId ? 'Edit Workspace' : 'New Workspace'}</h3>
                </div>
                <div className={`session-callout${activeSessionIsHarness ? ' session-callout--warning' : ''}`}>
                  <div>
                    <strong>
                      {activeSession
                        ? activeSessionIsHarness
                          ? 'Temporary harness session selected'
                          : `Current workspace: ${activeSession.name}`
                        : 'Choose one workspace for the shell'}
                    </strong>
                    <span>
                      {activeSession
                        ? activeSession.rootPath
                        : 'Use one repo-root workspace so World, Explorer, terminals, and runtime all point at the same project files.'}
                    </span>
                  </div>
                  <div className="inline-actions">
                    {suggestedWorkspaceSession ? (
                      <button
                        className="ghost-button ghost-button--sm ghost-button--primary"
                        disabled={sessionActionBusy}
                        onClick={() => void handleCreateSuggestedWorkspace()}
                        type="button"
                      >
                        Create Repo Workspace
                      </button>
                    ) : null}
                    {harnessSessions.length ? (
                      <button
                        className="ghost-button ghost-button--sm"
                        disabled={sessionActionBusy}
                        onClick={() => void handleDeleteHarnessSessions()}
                        type="button"
                      >
                        Delete Harness Workspaces
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="form-grid">
                  <label className="form-field">
                    <span>Name</span>
                    <input
                      onChange={(event) => setNewSessionName(event.target.value)}
                      placeholder="my-game"
                      type="text"
                      value={newSessionName}
                    />
                  </label>
                  <label className="form-field">
                    <span>Workspace root</span>
                    <div className="form-field__row">
                      <input
                        onChange={(event) => setNewSessionRoot(event.target.value)}
                        placeholder={workspaceRootPlaceholder}
                        type="text"
                        value={newSessionRoot}
                      />
                      <button
                        aria-label="Browse for workspace root"
                        className="ghost-button ghost-button--sm"
                        onClick={() => openDirPicker(newSessionRoot || activeSession?.rootPath || defaultBrowsePath)}
                        type="button"
                      >
                        ...
                      </button>
                    </div>
                  </label>
                </div>
                {dirPickerOpen ? (
                  <div className="dir-picker">
                    <div className="dir-picker__path">{dirPickerPath}</div>
                    {platformInfo?.isWSL && platformInfo.windowsMounts.length > 0 ? (
                      <div className="dir-picker__drives">
                        {platformInfo.windowsMounts.map((mount) => (
                          <button
                            className={`dir-picker__drive${dirPickerPath.startsWith(mount) ? ' is-active' : ''}`}
                            key={mount}
                            onClick={() => void navigateDirPicker(mount)}
                            type="button"
                          >
                            {mount.split('/').pop()?.toUpperCase()}:
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {dirPickerError ? <div className="terminal-error">{dirPickerError}</div> : null}
                    <div className="dir-picker__list">
                      {dirPickerPath !== '/' ? (
                        <button
                          className="dir-picker__entry"
                          onClick={() => void navigateDirPicker(getParentHostPath(dirPickerPath))}
                          type="button"
                        >
                          ..
                        </button>
                      ) : null}
                      {dirPickerBusy ? (
                        <div className="empty-hint">Loading...</div>
                      ) : dirPickerEntries.filter((entry) => entry.kind === 'directory').length ? (
                        dirPickerEntries
                          .filter((entry) => entry.kind === 'directory')
                          .map((entry) => (
                            <button
                              className="dir-picker__entry"
                              key={entry.path}
                              onClick={() => void navigateDirPicker(entry.path)}
                              type="button"
                            >
                              {entry.name}
                            </button>
                          ))
                      ) : (
                        <div className="empty-hint">No subdirectories.</div>
                      )}
                    </div>
                    <div className="inline-actions">
                      <button
                        className="ghost-button ghost-button--sm"
                        onClick={() => {
                          setNewSessionRoot(dirPickerPath);
                          closeDirPicker();
                        }}
                        type="button"
                      >
                        Select
                      </button>
                      <button className="ghost-button ghost-button--sm" onClick={closeDirPicker} type="button">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : null}
                <div className="inline-actions">
                  <button
                    className="ghost-button ghost-button--sm ghost-button--primary"
                    disabled={sessionActionBusy}
                    onClick={editingSessionId ? handleSaveSession : handleCreateSession}
                    type="button"
                  >
                    {sessionActionBusy ? 'Working...' : editingSessionId ? 'Save' : 'Create'}
                  </button>
                  {editingSessionId ? (
                    <button className="ghost-button ghost-button--sm" disabled={sessionActionBusy} onClick={resetSessionForm} type="button">
                      Cancel
                    </button>
                  ) : null}
                  <button className="ghost-button ghost-button--sm" disabled={sessionActionBusy} onClick={handleRefreshSessions} type="button">
                    Refresh
                  </button>
                </div>
              </section>
              <ul className="session-list">
                {workspaceSessions.length ? (
                  workspaceSessions.map((session) => (
                    <li key={session.id}>
                      <button
                        className={`session-item${activeSessionId === session.id ? ' is-active' : ''}`}
                        disabled={sessionActionBusy}
                        onClick={() => {
                          void activateSession(session.id).catch((error) => {
                            setSessiondState('offline');
                            setSessiondMessage(error instanceof Error ? error.message : String(error));
                          });
                        }}
                        type="button"
                      >
                        <div className="session-item__row">
                          <strong>{session.name}</strong>
                          <span className="session-badge">Workspace</span>
                        </div>
                        <span>{session.rootPath}</span>
                      </button>
                      <div className="session-item__actions">
                        <button
                          className="session-action"
                          disabled={sessionActionBusy}
                          onClick={() => loadSessionIntoForm(session)}
                          title="Edit"
                          type="button"
                        >
                          Edit
                        </button>
                        <button
                          className="session-action session-action--danger"
                          disabled={sessionActionBusy}
                          onClick={() => void handleDeleteSession(session.id)}
                          title="Delete"
                          type="button"
                        >
                          Del
                        </button>
                      </div>
                    </li>
                  ))
                ) : (
                  <li className="empty-hint">
                    {sessiondState === 'offline'
                      ? 'Start engine_sessiond to begin.'
                      : harnessSessions.length
                        ? 'Only temporary harness sessions exist right now. Create a repo workspace above.'
                        : 'No workspaces yet.'}
                  </li>
                )}
              </ul>
              {harnessSessions.length ? (
                <>
                  <div className="section-titlebar section-titlebar--subtle">
                    <h3>Temporary Harness Workspaces</h3>
                    <span>Safe to delete</span>
                  </div>
                  <ul className="session-list session-list--secondary">
                    {harnessSessions.map((session) => (
                      <li key={session.id}>
                        <button
                          className={`session-item session-item--secondary${activeSessionId === session.id ? ' is-active' : ''}`}
                          disabled={sessionActionBusy}
                          onClick={() => {
                            void activateSession(session.id).catch((error) => {
                              setSessiondState('offline');
                              setSessiondMessage(error instanceof Error ? error.message : String(error));
                            });
                          }}
                          type="button"
                        >
                          <div className="session-item__row">
                            <strong>{session.name}</strong>
                            <span className="session-badge session-badge--warning">Harness</span>
                          </div>
                          <span>{session.rootPath}</span>
                        </button>
                        <div className="session-item__actions">
                          <button
                            className="session-action session-action--danger"
                            disabled={sessionActionBusy}
                            onClick={() => void handleDeleteSession(session.id)}
                            title="Delete"
                            type="button"
                          >
                            Del
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          ) : null}
          {activeLeftTab === 'Explorer' ? (
            <div
              aria-labelledby="workspace-tool-tab-Explorer"
              className="rail-content"
              id="workspace-tools-panel"
              role="tabpanel"
            >
              {activeSession ? (
                <>
                  <div className="inline-actions">
                    <button className="ghost-button ghost-button--sm" disabled={!activeSessionId || explorerPath === '.'} onClick={handleExplorerUp} type="button">
                      Up
                    </button>
                    <button className="ghost-button ghost-button--sm" disabled={!activeSessionId || explorerBusy} onClick={() => void refreshExplorer(activeSessionId, explorerPath)} type="button">
                      Refresh
                    </button>
                    <span className="path-chip">{explorerPath}</span>
                  </div>
                  <ul className="explorer-list">
                    {explorerEntries.length ? (
                      explorerEntries.map((entry) => (
                        <li key={entry.path}>
                          <button
                            className={`explorer-entry${selectedExplorerPath === entry.path ? ' is-active' : ''}`}
                            disabled={explorerBusy}
                            onClick={() => handleExplorerEntryClick(entry)}
                            type="button"
                          >
                            <strong>{entry.name}</strong>
                            <span>{entry.kind === 'directory' ? 'dir' : formatFileSize(entry.size)}</span>
                          </button>
                        </li>
                      ))
                    ) : (
                      <li className="empty-hint">No file data yet.</li>
                    )}
                  </ul>
                  {selectedExplorerPath ? (
                    <div className="file-preview">
                      <div className="file-preview__path">{selectedExplorerPath}</div>
                      <pre>{selectedFilePreview || '[empty file]'}</pre>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="empty-hint">Select a workspace to browse files.</div>
              )}
            </div>
          ) : null}
          {activeLeftTab === 'Source Control' ? (
            <div
              aria-labelledby="workspace-tool-tab-Source Control"
              className="rail-content"
              id="workspace-tools-panel"
              role="tabpanel"
            >
              {activeSession ? (
                <>
                  <div className="inline-actions">
                    <button className="ghost-button ghost-button--sm" disabled={gitBusy} onClick={() => void refreshGit(activeSessionId)} type="button">
                      Refresh
                    </button>
                    {gitStatus.notARepo ? (
                      <button className="ghost-button ghost-button--sm" disabled={gitBusy} onClick={handleInitGitRepository} type="button">
                        Init repo
                      </button>
                    ) : null}
                  </div>
                  {gitBusy ? (
                    <div className="empty-hint">Loading git status...</div>
                  ) : gitStatus.notARepo ? (
                    <div className="empty-hint">Not a git repository.</div>
                  ) : (
                    <div className="git-panel">
                      <div className="git-branch">{gitStatus.branch || 'detached'}</div>
                      {renderGitGroup('Staged Changes', gitStatus.staged)}
                      {renderGitGroup('Changes', gitStatus.unstaged)}
                      {renderGitGroup('Untracked Files', gitStatus.untracked)}
                      {!gitStatus.staged.length && !gitStatus.unstaged.length && !gitStatus.untracked.length ? (
                        <div className="empty-hint">Working tree clean.</div>
                      ) : null}
                    </div>
                  )}
                </>
              ) : (
                <div className="empty-hint">Select a workspace first.</div>
              )}
            </div>
          ) : null}
        </aside>

        {leftPaneVisible ? (
          <div
            aria-label="Resize left sidebar"
            aria-orientation="vertical"
            aria-valuemax={shellPaneGeometry.left.max}
            aria-valuemin={shellPaneGeometry.left.min}
            aria-valuenow={leftPaneWidth}
            className="shell-pane-resize-handle shell-pane-resize-handle--left"
            onKeyDown={handleLeftPaneResizeKeyDown}
            onPointerDown={(event) => handlePaneResizeStart('left', event)}
            role="separator"
            tabIndex={0}
          />
        ) : null}

        <section className="center-column">
          <div className="center-toolbar">
            <div
              aria-label="Primary workspaces"
              className="tab-row"
              onKeyDown={(event) => handleTabListKeyDown(event, centerTabs, activeCenterTab, handleSelectCenterTab)}
              role="tablist"
            >
              {centerTabs.map((tab) => (
                <TabButton
                  active={activeCenterTab === tab}
                  controls="workspace-panel"
                  id={`workspace-tab-${tab}`}
                  key={tab}
                  onClick={() => handleSelectCenterTab(tab)}
                  tabId={tab}
                >
                  {tab}
                </TabButton>
              ))}
            </div>
            <div className="toolbar-rack__spacer" />
            {showGuide ? (
              <>
                <div className="guide-toolbar-meta">Searchable in-app wiki backed by repo-native markdown and structured assistant guide files.</div>
                <button className="ghost-button ghost-button--sm" onClick={() => setShowGuide(false)} type="button">
                  Close Guide
                </button>
              </>
            ) : activeCenterTab === 'Code' ? (
              <>
                <div className="guide-toolbar-meta">Native Code workspace for open, edit, preview, review, apply, and undo. Search the current file beside Inspect.</div>
                <button className="ghost-button ghost-button--sm" onClick={() => setShowLegacyBridge((current) => !current)} type="button">
                  {showLegacyBridge ? 'Hide legacy bridge' : 'Load legacy bridge'}
                </button>
                <a className="surface-link" href={legacyWorkspaceSrc} rel="noreferrer" target="_blank">
                  Open standalone
                </a>
              </>
            ) : activeCenterTab === 'World' ? (
              <div className="guide-toolbar-meta">Arrange and tune the world, then press Play to test it.</div>
            ) : activeCenterTab === 'Assets' ? (
              <div className="guide-toolbar-meta">Tune source-owned attachment profiles through lock, preview, approval, apply, and undo operations.</div>
            ) : (
              <div className="guide-toolbar-meta">Play, stop, and restart the game in its own window.</div>
            )}
          </div>

          <div
            aria-label={showGuide ? 'Reference guide' : undefined}
            aria-labelledby={showGuide ? undefined : `workspace-tab-${activeCenterTab}`}
            className="workspace-panel"
            id="workspace-panel"
            role={showGuide ? 'region' : 'tabpanel'}
          >
            {showGuide ? (
              <ReferenceGuideView guide={engineReferenceGuide} />
            ) : activeCenterTab === 'Code' ? (
              showLegacyBridge ? renderLegacyCodeBridge() : null
            ) : activeCenterTab === 'World' ? null : (
              renderCenterContent(
                activeCenterTab,
                activeSession,
                operationEventEpoch,
                runtimeStatus,
                buildStatus,
                launchScene,
                setLaunchScene,
                buildConfig,
                setBuildConfig,
                buildDir,
                setBuildDir,
                runtimeLog,
                buildLog,
                viewerBridgeEvents,
                pendingRunAfterBuild,
                handleBuildAndPlay,
                handleStartRuntime,
                handleStopRuntime,
                handleRestartRuntime,
                handlePauseRuntime,
                handleResumeRuntime,
                handleStartRuntimeBuild,
                handleStopBuild,
              )
            )}
            <div className="code-workspace-host" hidden={showGuide || activeCenterTab !== 'Code' || showLegacyBridge}>
              <CodeWorkspaceView
                activeSession={activeSession}
                operationEventEpoch={operationEventEpoch}
              />
            </div>
            <div className="scene-editor-host" hidden={showGuide || activeCenterTab !== 'World'}>
              <SceneEditorView
                activeSession={activeSession}
                buildStatus={buildStatus}
                launchScene={launchScene}
                nativeRuntimeHint={nativeRuntimeSetupHint(buildLog, runtimeLog)}
                onBackendStatus={reportBackendStatus}
                onBuildAndRun={handleBuildAndPlay}
                onLaunchSceneChange={setLaunchScene}
                onRestartRuntime={handleRestartRuntime}
                onRunScene={handleStartRuntime}
                onStopRuntime={handleStopRuntime}
                preferredSidebarTab="outliner"
                runtimeStatus={runtimeStatus}
              />
            </div>
          </div>
        </section>

        {rightPaneVisible ? (
          <>
            <div
              aria-label="Resize right sidebar"
              aria-orientation="vertical"
              aria-valuemax={shellPaneGeometry.right.max}
              aria-valuemin={shellPaneGeometry.right.min}
              aria-valuenow={rightPaneWidth}
              className="shell-pane-resize-handle shell-pane-resize-handle--right"
              onKeyDown={handleRightPaneResizeKeyDown}
              onPointerDown={(event) => handlePaneResizeStart('right', event)}
              role="separator"
              tabIndex={0}
            />
            <aside className="pane side-pane">
            <div
              aria-label="Runtime tools"
              className="tab-row tab-row--side"
              onKeyDown={(event) => handleTabListKeyDown(event, rightTabs, activeRightTab, handleSelectRightTab)}
              role="tablist"
            >
              {rightTabs.map((tab) => (
                <TabButton
                  active={activeRightTab === tab}
                  controls="runtime-tools-panel"
                  id={`runtime-tool-tab-${tab}`}
                  key={tab}
                  onClick={() => handleSelectRightTab(tab)}
                  tabId={tab}
                >
                  {tab}
                </TabButton>
              ))}
            </div>
            {activeSession ? (
              <div className="active-session-bar">
                <strong>{activeSession.name}</strong>
                <span>{activeSession.rootPath}</span>
              </div>
            ) : null}
            <div
              aria-labelledby={`runtime-tool-tab-${activeRightTab}`}
              className="runtime-tools-panel"
              id="runtime-tools-panel"
              role="tabpanel"
            >
            {renderRightPanel(
              activeRightTab,
              activeSession,
              packageSummary,
              packageBusy,
              profileSummary,
              profileCaptureList,
              profileBusy,
              codeTrustSummary,
              codeTrustApprovals,
              approvalsBusy,
              approvalActionId,
              artifactActionPath,
              runtimeStatus,
              buildStatus,
              buildLog,
              runtimeLog,
              launchScene,
              buildConfig,
              buildDir,
              pendingRunAfterBuild,
              setLaunchScene,
              setBuildConfig,
              setBuildDir,
              handleStartRuntimeBuild,
              handleBuildAndPlay,
              handleStopBuild,
              handleStartRuntime,
              handleStopRuntime,
              handleRestartRuntime,
              handlePauseRuntime,
              handleResumeRuntime,
              handleRefreshPackaging,
              handleRunPackaging,
              handleRefreshProfile,
              handleCaptureProfile,
              handleRefreshApprovals,
              handleDecideApproval,
              handleTransitionArtifact,
            )}
            </div>
            </aside>
          </>
        ) : null}
      </main>

      <section
        className={`pane bottom-pane${bottomPaneCollapsed ? ' is-collapsed' : ''}${bottomPaneResizing ? ' is-resizing' : ''}`}
        style={{ height: `${bottomPaneVisibleHeight}px` }}
      >
        <div
          aria-orientation="horizontal"
          aria-valuemax={bottomPaneMaxHeight}
          aria-valuemin={bottomPaneMinHeight}
          aria-valuenow={bottomPaneHeight}
          aria-label="Resize bottom dock"
          className="bottom-pane__resize-handle"
          onKeyDown={handleBottomPaneResizeKeyDown}
          onPointerDown={handleBottomPaneResizeStart}
          role="separator"
          tabIndex={0}
        />
        <div className="bottom-pane__chrome">
          <div
            aria-label="Bottom dock"
            className="tab-row"
            onKeyDown={(event) => handleTabListKeyDown(event, bottomTabs, activeBottomTab, handleBottomTabSelect)}
            role="tablist"
          >
            {bottomTabs.map((tab) => (
              <TabButton
                active={activeBottomTab === tab}
                controls="bottom-dock-panel"
                id={`bottom-tab-${tab}`}
                key={tab}
                onClick={() => handleBottomTabSelect(tab)}
                tabId={tab}
              >
                {tab}
              </TabButton>
            ))}
          </div>
          <div className="bottom-pane__actions">
            <span className="bottom-pane__meta">
              {bottomPaneCollapsed ? 'collapsed' : `${bottomPaneHeight}px`}
            </span>
            <button
              className="ghost-button ghost-button--sm"
              disabled={!bottomPaneCollapsed && bottomPaneHeight >= bottomPaneMaxHeight}
              onClick={handleExpandBottomPane}
              type="button"
            >
              Maximize
            </button>
            <button className="ghost-button ghost-button--sm" onClick={handleToggleBottomPane} type="button">
              {bottomPaneCollapsed ? 'Restore' : 'Collapse'}
            </button>
          </div>
        </div>
        {!bottomPaneCollapsed ? (
          <div
            aria-labelledby={`bottom-tab-${activeBottomTab}`}
            className="bottom-pane__body"
            id="bottom-dock-panel"
            role="tabpanel"
          >
            {renderBottomPanel(activeBottomTab, terminalDock, runtimeLog, buildLog, activityDock)}
          </div>
        ) : null}
      </section>
    </div>
  );
}
