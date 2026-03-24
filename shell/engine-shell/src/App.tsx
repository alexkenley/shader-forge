import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from 'react';
import { ReferenceGuideView } from './ReferenceGuideView';
import { SceneEditorView } from './SceneEditorView';
import {
  closeTerminal,
  createSession,
  deleteSession,
  fetchBuildStatus,
  fetchGitStatus,
  fetchPlatformInfo,
  fetchSessiondHealth,
  fetchRuntimeStatus,
  getSessiondBaseUrl,
  initGitRepository,
  listHostDirectories,
  listFiles,
  listSessions,
  openTerminal,
  pauseRuntime,
  readFile,
  restartRuntime,
  resumeRuntime,
  resizeTerminal,
  startRuntimeBuild,
  startRuntime,
  stopBuild,
  stopRuntime,
  subscribeSessiondEvents,
  updateSession,
  type BuildStatus,
  type PlatformInfo,
  type SessionFileEntry,
  type SessionTerminalOpen,
  type SessiondTerminalEvent,
  type EngineSession,
  type GitStatus,
  type HostDirectoryList,
  type RuntimeStatus,
  writeTerminalInput,
} from './lib/sessiond';
import { engineReferenceGuide } from './reference-guide';

const leftTabs = ['Sessions', 'Explorer', 'Source Control'] as const;
const centerTabs = ['Code', 'Game', 'Scene', 'Preview', 'Guide'] as const;
const rightTabs = ['Details', 'Build', 'Run'] as const;
const bottomTabs = ['Terminal', 'Logs', 'Output'] as const;
const layoutModes = ['Code Focus', 'Code + Game', 'Triptych'] as const;
const menuItems = ['File', 'Edit', 'View', 'Build', 'Tools', 'Window', 'Help'] as const;
const viewportModes = ['Perspective', 'Lit', 'Realtime'] as const;
const transformModes = ['Select', 'Move', 'Rotate', 'Scale'] as const;
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

type LeftTab = (typeof leftTabs)[number];
type CenterTab = (typeof centerTabs)[number];
type RightTab = (typeof rightTabs)[number];
type BottomTab = (typeof bottomTabs)[number];
type LayoutMode = (typeof layoutModes)[number];
type TerminalShell = (typeof terminalShells)[number];
type BuildConfig = (typeof buildConfigs)[number];

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

function layoutModeClassName(layoutMode: LayoutMode) {
  return layoutMode.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button className={`pill-button${active ? ' is-active' : ''}`} onClick={onClick} type="button">
      {children}
    </button>
  );
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

function ViewportShell({
  title,
  subtitle,
  footer,
}: {
  title: string;
  subtitle: string;
  footer: string;
}) {
  return (
    <div className="viewport-shell">
      <div className="viewport-toolbar">
        <div className="viewport-toolbar__group">
          {viewportModes.map((mode) => (
            <span className="viewport-token" key={mode}>
              {mode}
            </span>
          ))}
        </div>
        <div className="viewport-toolbar__group">
          {transformModes.map((mode) => (
            <span className="viewport-token viewport-token--dim" key={mode}>
              {mode}
            </span>
          ))}
        </div>
      </div>
      <div className="viewport-canvas">
        <div className="viewport-canvas__label">
          <strong>{title}</strong>
          <span>{subtitle}</span>
        </div>
        <div className="viewport-canvas__guide viewport-canvas__guide--horizontal" />
        <div className="viewport-canvas__guide viewport-canvas__guide--vertical" />
      </div>
      <div className="viewport-statusbar">{footer}</div>
    </div>
  );
}

function renderRightPanel(
  activeTab: RightTab,
  activeSession: EngineSession | null,
  runtimeStatus: RuntimeStatus,
  buildStatus: BuildStatus,
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
) {
  if (activeTab === 'Details') {
    return (
      <div className="stack">
        <section className="card compact-card">
          <div className="section-titlebar">
            <h3>Details</h3>
            <span>Actor</span>
          </div>
          <dl className="property-grid">
            <div>
              <dt>Name</dt>
              <dd>BP_CitadelGate</dd>
            </div>
            <div>
              <dt>Label</dt>
              <dd>Castle Gate A</dd>
            </div>
            <div>
              <dt>Transform</dt>
              <dd>1240, -330, 64</dd>
            </div>
            <div>
              <dt>Mobility</dt>
              <dd>Static</dd>
            </div>
            <div>
              <dt>Layer</dt>
              <dd>Gameplay.Blockout</dd>
            </div>
          </dl>
        </section>
        <section className="card compact-card">
          <div className="section-titlebar">
            <h3>Components</h3>
            <span>4 items</span>
          </div>
          <dl className="property-grid">
            <div>
              <dt>StaticMesh</dt>
              <dd>SM_Gate_A</dd>
            </div>
            <div>
              <dt>Collision</dt>
              <dd>BlockAll</dd>
            </div>
            <div>
              <dt>Gameplay Tag</dt>
              <dd>Encounter.Entry</dd>
            </div>
            <div>
              <dt>Blueprint</dt>
              <dd>BP_CitadelGate</dd>
            </div>
          </dl>
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
            <span className={`status-dot status-dot--${buildStatus.state === 'running' ? 'active' : buildStatus.state === 'failed' ? 'error' : 'idle'}`} />
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
              Build + Play
            </button>
            <button className="ghost-button ghost-button--sm" disabled={buildStatus.state !== 'running'} onClick={onStopBuild} type="button">
              Stop
            </button>
          </div>
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
          <span className={`status-dot status-dot--${runtimeStateTone(runtimeStatus.state)}`} />
        </div>
        <div className="form-grid">
          <label className="form-field">
            <span>Launch scene</span>
            <input onChange={(event) => onLaunchSceneChange(event.target.value)} type="text" value={launchScene} />
          </label>
        </div>
        <div className="inline-actions">
          <button className="ghost-button ghost-button--sm" disabled={buildStatus.state === 'running' || runtimeStatus.state !== 'stopped'} onClick={onStartRuntime} type="button">
            Play
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
                <span
                  className="terminal-tab__close"
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  role="button"
                  tabIndex={0}
                >
                  ×
                </span>
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
) {
  if (activeTab === 'Terminal') {
    return terminalDock;
  }

  if (activeTab === 'Logs') {
    return (
      <pre className="dock-output">{runtimeLog}</pre>
    );
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

function renderCodeBridge(
  layoutMode: LayoutMode,
  showLegacyBridge: boolean,
  onToggleLegacyBridge: () => void,
) {
  return (
    <div className={`workspace-layout workspace-layout--${layoutModeClassName(layoutMode)}`}>
      <section className="surface legacy-surface">
        <div className="surface-header">
          <div>
            <div className="surface-eyebrow">Code Workspace</div>
            <h2>Code</h2>
            <p>The preserved Monaco/search work stays intact, but the old app chrome is no longer the default shell.</p>
          </div>
          <div className="inline-actions">
            <button className="ghost-button" onClick={onToggleLegacyBridge} type="button">
              {showLegacyBridge ? 'Hide legacy bridge' : 'Load legacy bridge'}
            </button>
            <a className="surface-link" href={legacyWorkspaceSrc} rel="noreferrer" target="_blank">
              Open standalone
            </a>
          </div>
        </div>
        {showLegacyBridge ? (
          <iframe
            className="legacy-frame"
            loading="lazy"
            src={legacyWorkspaceSrc}
            title="Shader Forge preserved code workspace"
          />
        ) : (
          <div className="bridge-placeholder">
            <div className="bridge-placeholder__summary">
              <strong>Legacy bridge quarantined</strong>
              <p>
                The preserved code surface is kept as a compatibility baseline while the real Shader Forge code
                dock is extracted around it.
              </p>
            </div>
            <div className="bridge-placeholder__grid">
              <article className="mini-card">
                <span>Preserved</span>
                <strong>Monaco editor</strong>
                <p>Inline find, diffing, and file semantics remain in `web/`.</p>
              </article>
              <article className="mini-card">
                <span>Replacing</span>
                <strong>Legacy chrome</strong>
                <p>Guardian-shaped nav, panels, and terminal chrome are being removed.</p>
              </article>
              <article className="mini-card">
                <span>Next</span>
                <strong>Native code dock</strong>
                <p>Shader Forge will own the tabs, split panes, and terminal host directly.</p>
              </article>
            </div>
          </div>
        )}
      </section>

      <section className="surface">
        <div className="surface-header">
          <div>
            <div className="surface-eyebrow">Viewport Companion</div>
            <h2>Game / Scene Pair</h2>
          </div>
        </div>
        <ViewportShell
          footer="Viewport dock placeholder. Native runtime stream lands here after the viewer bridge."
          subtitle="Split layout partner"
          title="Companion viewport"
        />
      </section>

      {layoutMode === 'Triptych' ? (
        <section className="surface">
          <div className="surface-header">
            <div>
              <div className="surface-eyebrow">Preview Dock</div>
              <h2>Asset / Inspector Partner</h2>
            </div>
          </div>
          <div className="metric-stack">
            <article className="mini-card">
              <span>Selection</span>
              <strong>CastleGate_A</strong>
            </article>
            <article className="mini-card">
              <span>Asset preview</span>
              <strong>SM_Gate_A</strong>
            </article>
            <article className="mini-card">
              <span>Search preservation</span>
              <strong>Match count + Prev/Next</strong>
            </article>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function renderCenterContent(
  activeTab: CenterTab,
  layoutMode: LayoutMode,
  showLegacyBridge: boolean,
  onToggleLegacyBridge: () => void,
  activeSession: EngineSession | null,
  runtimeStatus: RuntimeStatus,
  buildStatus: BuildStatus,
  launchScene: string,
  onLaunchSceneChange: (value: string) => void,
  buildConfig: BuildConfig,
  buildDir: string,
  runtimeLog: string,
  buildLog: string,
  viewerBridgeEvents: ViewerBridgeEvent[],
  pendingRunAfterBuild: boolean,
  onBackendStatus: (state: 'connected' | 'offline', message: string) => void,
  onBuildAndPlay: () => void,
  onStartRuntime: () => void,
  onStopRuntime: () => void,
  onRestartRuntime: () => void,
  onPauseRuntime: () => void,
  onResumeRuntime: () => void,
) {
  if (activeTab === 'Code') {
    return renderCodeBridge(layoutMode, showLegacyBridge, onToggleLegacyBridge);
  }

  if (activeTab === 'Game') {
    return (
      <div className="workspace-layout workspace-layout--game">
        <section className="surface">
          <div className="surface-header">
            <div>
              <div className="surface-eyebrow">Runtime Control</div>
              <h2>Game Viewer</h2>
            </div>
            <div className="inline-actions">
              <button
                className="ghost-button"
                disabled={buildStatus.state === 'running'}
                onClick={onBuildAndPlay}
                type="button"
              >
                Build + Play
              </button>
              <button
                className="ghost-button"
                disabled={buildStatus.state === 'running' || runtimeStatus.state !== 'stopped'}
                onClick={onStartRuntime}
                type="button"
              >
                Play
              </button>
              <button
                className="ghost-button"
                disabled={runtimeStatus.state === 'stopped' || buildStatus.state === 'running'}
                onClick={onStopRuntime}
                type="button"
              >
                Stop
              </button>
              <button
                className="ghost-button"
                disabled={!runtimeStatus.supportsPause || runtimeStatus.state === 'stopped' || buildStatus.state === 'running'}
                onClick={runtimeStatus.state === 'paused' ? onResumeRuntime : onPauseRuntime}
                type="button"
              >
                {runtimeStatus.state === 'paused' ? 'Resume' : 'Pause'}
              </button>
              <button
                className="ghost-button"
                disabled={runtimeStatus.state === 'stopped' || buildStatus.state === 'running'}
                onClick={onRestartRuntime}
                type="button"
              >
                Restart
              </button>
            </div>
          </div>
          <ViewportShell
            footer="Windows native runtime window first. Aim at effect-capable proxies and press Enter or click to trigger them; F7 reloads authored content."
            subtitle={`Run target: ${launchScene}`}
            title="Game viewport"
          />
        </section>
        <section className="surface">
          <div className="metric-stack">
            <article className="mini-card">
              <span>Status</span>
              <strong>{runtimeStateLabel(runtimeStatus.state)}</strong>
            </article>
            <article className="mini-card">
              <span>Scene</span>
              <strong>{runtimeStatus.scene || launchScene}</strong>
            </article>
            <article className="mini-card">
              <span>Workspace</span>
              <strong>{runtimeStatus.workspaceRoot || activeSession?.rootPath || 'repo default'}</strong>
            </article>
            <article className="mini-card">
              <span>Process</span>
              <strong>{runtimeStatus.pid ? `pid ${runtimeStatus.pid}` : 'not running'}</strong>
            </article>
            <article className="mini-card">
              <span>Build config</span>
              <strong>{buildConfig}</strong>
            </article>
            <article className="mini-card">
              <span>Pause</span>
              <strong>{runtimeStatus.supportsPause ? (runtimeStatus.state === 'paused' ? 'Paused' : 'Available') : 'Unsupported'}</strong>
            </article>
          </div>
        </section>
      </div>
    );
  }

  if (activeTab === 'Scene') {
    return (
      <SceneEditorView
        activeSession={activeSession}
        launchScene={launchScene}
        onBackendStatus={onBackendStatus}
        onLaunchSceneChange={onLaunchSceneChange}
        runtimeStatus={runtimeStatus}
      />
    );
  }

  if (activeTab === 'Guide') {
    return <ReferenceGuideView guide={engineReferenceGuide} />;
  }

  const runtimeLogTail = takeLastLogLines(runtimeLog, 8);
  const buildLogTail = takeLastLogLines(buildLog, 8);

  return (
    <div className="workspace-layout workspace-layout--preview">
      <section className="surface">
        <div className="surface-header">
          <div>
            <div className="surface-eyebrow">Preview</div>
            <h2>Viewer Workflow</h2>
            <p>Keep the browser shell paired with the native runtime window until embedded streaming is worth the added complexity.</p>
          </div>
          <div className="inline-actions">
            <button
              className="ghost-button"
              disabled={buildStatus.state === 'running'}
              onClick={onBuildAndPlay}
              type="button"
            >
              Build + Play
            </button>
            <button
              className="ghost-button"
              disabled={buildStatus.state === 'running' || runtimeStatus.state !== 'stopped'}
              onClick={onStartRuntime}
              type="button"
            >
              Play
            </button>
            <button
              className="ghost-button"
              disabled={runtimeStatus.state === 'stopped' || buildStatus.state === 'running'}
              onClick={onStopRuntime}
              type="button"
            >
              Stop
            </button>
            <button
              className="ghost-button"
              disabled={!runtimeStatus.supportsPause || runtimeStatus.state === 'stopped' || buildStatus.state === 'running'}
              onClick={runtimeStatus.state === 'paused' ? onResumeRuntime : onPauseRuntime}
              type="button"
            >
              {runtimeStatus.state === 'paused' ? 'Resume' : 'Pause'}
            </button>
            <button
              className="ghost-button"
              disabled={runtimeStatus.state === 'stopped' || buildStatus.state === 'running'}
              onClick={onRestartRuntime}
              type="button"
            >
              Restart
            </button>
          </div>
        </div>
        <div className="preview-grid preview-grid--bridge">
          <article className="preview-card">
            <span>Runtime</span>
            <strong>{runtimeStateLabel(runtimeStatus.state)}</strong>
            <p>{runtimeStatus.scene || launchScene}</p>
          </article>
          <article className="preview-card">
            <span>Workspace</span>
            <strong>{runtimeStatus.workspaceRoot || activeSession?.rootPath || 'repo default'}</strong>
            <p>{runtimeStatus.sessionId || 'repo-default launch context'}</p>
          </article>
          <article className="preview-card">
            <span>Build</span>
            <strong>{buildStateLabel(buildStatus.state)}</strong>
            <p>{buildStatus.config || buildConfig}</p>
          </article>
          <article className="preview-card">
            <span>Window</span>
            <strong>External native runtime</strong>
            <p>Browser shell stays the primary workspace</p>
          </article>
          <article className="preview-card">
            <span>Queue</span>
            <strong>{pendingRunAfterBuild ? 'Build + Play armed' : 'Idle'}</strong>
            <p>{pendingRunAfterBuild ? `scene ${launchScene}` : 'No pending launch chain'}</p>
          </article>
        </div>
      </section>
      <section className="surface">
        <div className="surface-header">
          <div>
            <div className="surface-eyebrow">Runtime Bridge</div>
            <h2>External Runtime Window</h2>
            <p>The shell owns orchestration while the SDL3/Vulkan process remains the real renderer.</p>
          </div>
        </div>
        <div className="bridge-panel-grid">
          <article className="bridge-card">
            <div className="bridge-card__header">
              <div className="bridge-card__title">
                <span className={`status-dot status-dot--${runtimeStateTone(runtimeStatus.state)}`} />
                <strong>Bridge State</strong>
              </div>
              <span>{runtimeStateLabel(runtimeStatus.state)}</span>
            </div>
            <dl className="fact-list">
              <div>
                <dt>Scene</dt>
                <dd>{runtimeStatus.scene || launchScene}</dd>
              </div>
              <div>
                <dt>Workspace</dt>
                <dd>{runtimeStatus.workspaceRoot || activeSession?.rootPath || 'repo default'}</dd>
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
            </dl>
          </article>
          <article className="bridge-card">
            <div className="bridge-card__header">
              <div className="bridge-card__title">
                <span className="status-dot status-dot--active" />
                <strong>Recent Bridge Activity</strong>
              </div>
              <span>{viewerBridgeEvents.length ? `${viewerBridgeEvents.length} entries` : 'waiting'}</span>
            </div>
            {viewerBridgeEvents.length ? (
              <ul className="bridge-event-list">
                {viewerBridgeEvents.map((event) => (
                  <li className="bridge-event" key={event.id}>
                    <div className="bridge-event__header">
                      <div className="bridge-card__title">
                        <span className={`status-dot status-dot--${event.tone}`} />
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
      </section>
      <section className="surface">
        <div className="surface-header">
          <div>
            <div className="surface-eyebrow">Log Tail</div>
            <h2>Bridge Diagnostics</h2>
            <p>Keep the viewer workflow inspectable from the shell even before there is an embedded frame stream.</p>
          </div>
        </div>
        <div className="bridge-log-grid">
          <article className="bridge-log-card">
            <span>Runtime log</span>
            <pre>{runtimeLogTail}</pre>
          </article>
          <article className="bridge-log-card">
            <span>Build log</span>
            <pre>{buildLogTail}</pre>
          </article>
          <article className="bridge-log-card">
            <span>Build target</span>
            <strong>{buildStatus.target || 'runtime'}</strong>
            <p>{buildStatus.buildDir || buildDir}</p>
          </article>
          <article className="bridge-log-card">
            <span>Bridge mode</span>
            <strong>External window pairing</strong>
            <p>Screenshot capture and embedded viewer transport stay deferred until the runtime side is ready.</p>
          </article>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const [activeLeftTab, setActiveLeftTab] = useState<LeftTab>('Sessions');
  const [activeCenterTab, setActiveCenterTab] = useState<CenterTab>('Scene');
  const [activeRightTab, setActiveRightTab] = useState<RightTab>('Details');
  const [activeBottomTab, setActiveBottomTab] = useState<BottomTab>('Terminal');
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('Triptych');
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
  const [launchScene, setLaunchScene] = useState('sandbox');
  const [buildConfig, setBuildConfig] = useState<BuildConfig>('Debug');
  const [buildDir, setBuildDir] = useState('build/runtime');
  const [pendingRunAfterBuild, setPendingRunAfterBuild] = useState(false);
  const [viewerBridgeEvents, setViewerBridgeEvents] = useState<ViewerBridgeEvent[]>([]);
  const terminalTabsRef = useRef<TerminalTabState[]>([]);
  const terminalOpeningRef = useRef(new Set<string>());
  const defaultShell: TerminalShell = platformInfo?.platform === 'win32' ? 'powershell.exe' : 'bash';
  const availableShells: TerminalShell[] = platformInfo?.platform === 'win32'
    ? [...windowsShells, ...unixShells]
    : [...unixShells];

  function recordViewerBridgeEvent(event: Omit<ViewerBridgeEvent, 'id'>) {
    setViewerBridgeEvents((current) => appendViewerBridgeEvent(current, event));
  }

  async function refreshSessions() {
    const nextSessions = await listSessions();
    setSessions(nextSessions);
    if (nextSessions.length && !nextSessions.some((session) => session.id === activeSessionId)) {
      setActiveSessionId(nextSessions[0].id);
    }
    return nextSessions;
  }

  async function refreshExplorer(sessionId: string, relativePath = '.') {
    if (!sessionId) {
      setExplorerEntries([]);
      setExplorerPath('.');
      setSelectedExplorerPath('');
      setSelectedFilePreview('');
      return;
    }

    setExplorerBusy(true);
    try {
      const listing = await listFiles(sessionId, relativePath);
      setExplorerPath(listing.path);
      setExplorerEntries(listing.entries);
      const firstFile = listing.entries.find((entry) => entry.kind === 'file');
      if (firstFile) {
        setSelectedExplorerPath(firstFile.path);
        const preview = await readFile(sessionId, firstFile.path);
        setSelectedFilePreview(preview.content.slice(0, 1200));
      } else {
        setSelectedExplorerPath('');
        setSelectedFilePreview('');
      }
    } finally {
      setExplorerBusy(false);
    }
  }

  async function refreshGit(sessionId: string) {
    if (!sessionId) {
      setGitStatus(emptyGitStatus);
      return;
    }

    setGitBusy(true);
    try {
      const nextStatus = await fetchGitStatus(sessionId);
      setGitStatus(nextStatus);
    } finally {
      setGitBusy(false);
    }
  }

  async function navigateDirPicker(nextPath: string) {
    setDirPickerBusy(true);
    setDirPickerError('');
    setDirPickerPath(nextPath);
    try {
      const listing = await listHostDirectories(nextPath);
      setDirPickerPath(listing.path);
      setDirPickerEntries(listing.entries);
    } catch (error) {
      setDirPickerError(error instanceof Error ? error.message : String(error));
      setDirPickerEntries([]);
    } finally {
      setDirPickerBusy(false);
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
    setDirPickerOpen(false);
    setDirPickerPath('/');
    setDirPickerEntries([]);
    setDirPickerError('');
    setDirPickerBusy(false);
  }

  async function activateSession(sessionId: string) {
    setActiveSessionId(sessionId);
    await Promise.all([refreshExplorer(sessionId, '.'), refreshGit(sessionId)]);
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
        const nextRuntimeStatus = await fetchRuntimeStatus().catch(() => stoppedRuntimeStatus);
        const nextBuildStatus = await fetchBuildStatus().catch(() => idleBuildStatus);
        if (!cancelled) {
          setRuntimeStatus(nextRuntimeStatus);
          setBuildStatus(nextBuildStatus);
        }
        const nextSessions = await listSessions();
        if (cancelled) {
          return;
        }
        setSessions(nextSessions);
        if (nextSessions.length) {
          const nextActiveSessionId = nextSessions[0].id;
          setActiveSessionId((current) => current || nextActiveSessionId);
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
      return;
    }

    void refreshGit(activeSessionId).catch((error) => {
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
        setRuntimeStatus(event.data);
        if (event.data.scene) {
          setLaunchScene(event.data.scene);
        }
        return;
      }

      if (event.type === 'runtime.exit') {
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
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!pendingRunAfterBuild) {
      return;
    }

    if (buildStatus.state === 'succeeded') {
      setPendingRunAfterBuild(false);
      if (runtimeStatus.state === 'running' || runtimeStatus.state === 'paused') {
        void restartRuntime(launchScene, activeSessionId || undefined)
          .then((nextStatus) => {
            setRuntimeStatus(nextStatus);
            recordViewerBridgeEvent({
              title: 'Runtime restarted after build',
              detail: `${nextStatus.scene || launchScene} · ${nextStatus.pid ? `pid ${nextStatus.pid}` : 'pending pid'}`,
              at: new Date().toISOString(),
              tone: runtimeStateTone(nextStatus.state),
            });
            setRuntimeLog((current) => trimTerminalOutput(`${current}[runtime] restart requested after build\n`));
            setActiveBottomTab('Logs');
          })
          .catch((error) => {
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

      void startRuntime(launchScene, activeSessionId || undefined)
        .then((nextStatus) => {
          setRuntimeStatus(nextStatus);
          recordViewerBridgeEvent({
            title: 'Runtime started after build',
            detail: `${nextStatus.scene || launchScene} · ${nextStatus.pid ? `pid ${nextStatus.pid}` : 'pending pid'}`,
            at: new Date().toISOString(),
            tone: runtimeStateTone(nextStatus.state),
          });
          setRuntimeLog((current) => trimTerminalOutput(`${current}[runtime] start requested after build\n`));
          setActiveBottomTab('Logs');
        })
        .catch((error) => {
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
      setSessiondState('connected');
      setSessiondMessage(`Created session ${session.name}`);
      await refreshSessions();
      await activateSession(session.id);
      resetSessionForm();
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
      setSessiondState('connected');
      setSessiondMessage(`Updated session ${session.name}`);
      await refreshSessions();
      await activateSession(session.id);
      resetSessionForm();
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
      const nextActiveSessionId =
        activeSessionId === sessionId ? nextSessions[0]?.id || '' : activeSessionId;
      setActiveSessionId(nextActiveSessionId);
      if (nextActiveSessionId) {
        await activateSession(nextActiveSessionId);
      } else {
        setExplorerEntries([]);
        setExplorerPath('.');
        setSelectedExplorerPath('');
        setSelectedFilePreview('');
        setGitStatus(emptyGitStatus);
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
      setSessiondState('connected');
      setSessiondMessage(`Synced sessions from ${getSessiondBaseUrl()}`);
      const explorerSessionId = activeSessionId || nextSessions[0]?.id || '';
      if (explorerSessionId) {
        await refreshExplorer(explorerSessionId, explorerPath);
        await refreshGit(explorerSessionId);
      }
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

    try {
      setExplorerBusy(true);
      if (entry.kind === 'directory') {
        await refreshExplorer(activeSessionId, entry.path);
        return;
      }
      const preview = await readFile(activeSessionId, entry.path);
      setSelectedExplorerPath(entry.path);
      setSelectedFilePreview(preview.content.slice(0, 1200));
    } catch (error) {
      setSessiondState('offline');
      setSessiondMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setExplorerBusy(false);
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

    try {
      setGitBusy(true);
      const nextStatus = await initGitRepository(activeSessionId);
      setGitStatus(nextStatus);
      setSessiondState('connected');
      setSessiondMessage(`Initialized git repository for ${activeSession?.name || 'session'}`);
    } catch (error) {
      setSessiondState('offline');
      setSessiondMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setGitBusy(false);
    }
  }

  const activeSession = sessions.find((session) => session.id === activeSessionId) || null;

  function reportBackendStatus(state: 'connected' | 'offline', message: string) {
    setSessiondState(state);
    setSessiondMessage(message);
  }

  function handleAddTerminal() {
    setTerminalTabs((current) => {
      const nextTab = createTerminalTab(current.length + 1, defaultShell);
      setActiveTerminalTabId(nextTab.id);
      return [...current, nextTab];
    });
    setActiveBottomTab('Terminal');
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
    try {
      const nextStatus = await startRuntime(launchScene, activeSessionId || undefined);
      setRuntimeStatus(nextStatus);
      recordViewerBridgeEvent({
        title: 'Runtime started',
        detail: `${nextStatus.scene || launchScene} · ${nextStatus.pid ? `pid ${nextStatus.pid}` : 'pending pid'}`,
        at: new Date().toISOString(),
        tone: runtimeStateTone(nextStatus.state),
      });
      setRuntimeLog((current) => trimTerminalOutput(`${current}[runtime] start requested\n`));
      setActiveBottomTab('Logs');
    } catch (error) {
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
    try {
      const nextStatus = await stopRuntime();
      setRuntimeStatus(nextStatus);
      recordViewerBridgeEvent({
        title: 'Runtime stopped',
        detail: launchScene,
        at: new Date().toISOString(),
        tone: 'idle',
      });
      setRuntimeLog((current) => trimTerminalOutput(`${current}[runtime] stop requested\n`));
      setActiveBottomTab('Logs');
    } catch (error) {
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
    try {
      const nextStatus = await pauseRuntime();
      setRuntimeStatus(nextStatus);
      recordViewerBridgeEvent({
        title: 'Runtime paused',
        detail: `${nextStatus.scene || launchScene} · ${nextStatus.pid ? `pid ${nextStatus.pid}` : 'pending pid'}`,
        at: nextStatus.pausedAt || new Date().toISOString(),
        tone: 'paused',
      });
      setRuntimeLog((current) => trimTerminalOutput(`${current}[runtime] pause requested\n`));
      setActiveBottomTab('Logs');
    } catch (error) {
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
    try {
      const nextStatus = await resumeRuntime();
      setRuntimeStatus(nextStatus);
      recordViewerBridgeEvent({
        title: 'Runtime resumed',
        detail: `${nextStatus.scene || launchScene} · ${nextStatus.pid ? `pid ${nextStatus.pid}` : 'pending pid'}`,
        at: new Date().toISOString(),
        tone: runtimeStateTone(nextStatus.state),
      });
      setRuntimeLog((current) => trimTerminalOutput(`${current}[runtime] resume requested\n`));
      setActiveBottomTab('Logs');
    } catch (error) {
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
    try {
      const nextStatus = await restartRuntime(launchScene, activeSessionId || undefined);
      setRuntimeStatus(nextStatus);
      recordViewerBridgeEvent({
        title: 'Runtime restarted',
        detail: `${nextStatus.scene || launchScene} · ${nextStatus.pid ? `pid ${nextStatus.pid}` : 'pending pid'}`,
        at: new Date().toISOString(),
        tone: runtimeStateTone(nextStatus.state),
      });
      setRuntimeLog((current) => trimTerminalOutput(`${current}[runtime] restart requested\n`));
      setActiveBottomTab('Logs');
    } catch (error) {
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
    try {
      const nextStatus = await startRuntimeBuild(buildConfig, buildDir.trim() || undefined);
      setPendingRunAfterBuild(runAfterBuild);
      setBuildStatus(nextStatus);
      recordViewerBridgeEvent({
        title: runAfterBuild ? 'Build + Play queued' : 'Build requested',
        detail: [nextStatus.target || 'runtime', nextStatus.config || buildConfig, nextStatus.buildDir || buildDir]
          .filter(Boolean)
          .join(' · '),
        at: nextStatus.startedAt || new Date().toISOString(),
        tone: buildStatusTone(nextStatus.state),
      });
      setBuildLog((current) => trimTerminalOutput(`${current}[build] runtime build requested\n`));
      setActiveBottomTab('Output');
      setActiveRightTab('Build');
    } catch (error) {
      setPendingRunAfterBuild(false);
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
      setActiveBottomTab('Output');
    }
  }

  function handleStartRuntimeBuild() {
    void requestRuntimeBuild(false);
  }

  function handleBuildAndPlay() {
    void requestRuntimeBuild(true);
  }

  async function handleStopBuild() {
    try {
      const nextStatus = await stopBuild();
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
      setActiveBottomTab('Output');
    } catch (error) {
      recordViewerBridgeEvent({
        title: 'Build stop failed',
        detail: error instanceof Error ? error.message : String(error),
        at: new Date().toISOString(),
        tone: 'error',
      });
      setBuildLog((current) =>
        trimTerminalOutput(`${current}[build] ${error instanceof Error ? error.message : String(error)}\n`),
      );
      setActiveBottomTab('Output');
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

  const defaultBrowsePath = platformInfo?.defaultBrowsePath || '/';
  const workspaceRootPlaceholder = platformInfo?.isWSL
    ? platformInfo.defaultBrowsePath || '/mnt/c/Users'
    : '/home/user/projects/my-game';

  return (
    <div className="shell-app">
      <header className="chrome-bar chrome-bar--menu">
        <div className="menu-strip">
          {menuItems.map((item) => (
            <button
              className="menu-button"
              key={item}
              onClick={() => {
                if (item === 'Help') {
                  setActiveCenterTab('Guide');
                }
              }}
              type="button"
            >
              {item}
            </button>
          ))}
        </div>
        <div className="chrome-title">Shader Forge</div>
        <div className="toolbar-cluster toolbar-cluster--center">
          <button className="ghost-button ghost-button--sm" disabled={buildStatus.state === 'running'} onClick={handleStartRuntimeBuild} type="button">
            Build
          </button>
          <button className="ghost-button ghost-button--sm" disabled={buildStatus.state === 'running'} onClick={handleBuildAndPlay} type="button">
            Build + Play
          </button>
          <button className="ghost-button ghost-button--sm" disabled={buildStatus.state === 'running' || runtimeStatus.state !== 'stopped'} onClick={handleStartRuntime} type="button">
            Play
          </button>
          <button className="ghost-button ghost-button--sm" disabled={runtimeStatus.state === 'stopped' || buildStatus.state === 'running'} onClick={handleStopRuntime} type="button">
            Stop
          </button>
          <button
            className="ghost-button ghost-button--sm"
            disabled={!runtimeStatus.supportsPause || runtimeStatus.state === 'stopped' || buildStatus.state === 'running'}
            onClick={runtimeStatus.state === 'paused' ? handleResumeRuntime : handlePauseRuntime}
            type="button"
          >
            {runtimeStatus.state === 'paused' ? 'Resume' : 'Pause'}
          </button>
        </div>
        <div className="chrome-strip-meta">
          <span className={`status-indicator${sessiondState === 'connected' ? ' status-indicator--ok' : sessiondState === 'offline' ? ' status-indicator--err' : ''}`} />
          <span className="chrome-meta-chip">{buildConfig}</span>
          {buildStatus.state === 'running' ? <span className="chrome-meta-chip chrome-meta-chip--accent">Building</span> : null}
          {runtimeStatus.state === 'running' ? <span className="chrome-meta-chip chrome-meta-chip--accent">Running</span> : null}
          {runtimeStatus.state === 'paused' ? <span className="chrome-meta-chip chrome-meta-chip--warning">Paused</span> : null}
        </div>
      </header>

      <main className="shell-grid">
        <aside className="pane rail-pane">
          <nav className="rail-tabs">
            {leftTabs.map((tab) => (
              <button
                className={`rail-tab${activeLeftTab === tab ? ' is-active' : ''}`}
                key={tab}
                onClick={() => setActiveLeftTab(tab)}
                type="button"
              >
                {tab}
              </button>
            ))}
          </nav>
          {activeLeftTab === 'Sessions' ? (
            <div className="rail-content">
              <section className="rail-section">
                <div className="section-titlebar">
                  <h3>{editingSessionId ? 'Edit Session' : 'New Session'}</h3>
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
                {sessions.length ? (
                  sessions.map((session) => (
                    <li key={session.id}>
                      <button
                        className={`session-item${activeSessionId === session.id ? ' is-active' : ''}`}
                        onClick={() => {
                          void activateSession(session.id).catch((error) => {
                            setSessiondState('offline');
                            setSessiondMessage(error instanceof Error ? error.message : String(error));
                          });
                        }}
                        type="button"
                      >
                        <strong>{session.name}</strong>
                        <span>{session.rootPath}</span>
                      </button>
                      <div className="session-item__actions">
                        <button
                          className="session-action"
                          onClick={() => loadSessionIntoForm(session)}
                          title="Edit"
                          type="button"
                        >
                          Edit
                        </button>
                        <button
                          className="session-action session-action--danger"
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
                      : 'No sessions yet.'}
                  </li>
                )}
              </ul>
            </div>
          ) : null}
          {activeLeftTab === 'Explorer' ? (
            <div className="rail-content">
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
                <div className="empty-hint">Select a session to browse files.</div>
              )}
            </div>
          ) : null}
          {activeLeftTab === 'Source Control' ? (
            <div className="rail-content">
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
                <div className="empty-hint">Select a session first.</div>
              )}
            </div>
          ) : null}
        </aside>

        <section className="center-column">
          <div className="center-toolbar">
            <div className="tab-row">
              {centerTabs.map((tab) => (
                <TabButton active={activeCenterTab === tab} key={tab} onClick={() => setActiveCenterTab(tab)}>
                  {tab}
                </TabButton>
              ))}
            </div>
            <div className="toolbar-rack__spacer" />
            {activeCenterTab === 'Guide' ? (
              <div className="guide-toolbar-meta">Searchable in-app wiki backed by repo-native markdown and structured assistant guide files.</div>
            ) : (
              <div className="tab-row tab-row--tight">
                {layoutModes.map((mode) => (
                  <TabButton active={layoutMode === mode} key={mode} onClick={() => setLayoutMode(mode)}>
                    {mode}
                  </TabButton>
                ))}
              </div>
            )}
          </div>

          {renderCenterContent(
            activeCenterTab,
            layoutMode,
            showLegacyBridge,
            () => setShowLegacyBridge((current) => !current),
            activeSession,
            runtimeStatus,
            buildStatus,
            launchScene,
            setLaunchScene,
            buildConfig,
            buildDir,
            runtimeLog,
            buildLog,
            viewerBridgeEvents,
            pendingRunAfterBuild,
            reportBackendStatus,
            handleBuildAndPlay,
            handleStartRuntime,
            handleStopRuntime,
            handleRestartRuntime,
            handlePauseRuntime,
            handleResumeRuntime,
          )}
        </section>

        <aside className="pane side-pane">
          <div className="tab-row tab-row--side">
            {rightTabs.map((tab) => (
              <TabButton active={activeRightTab === tab} key={tab} onClick={() => setActiveRightTab(tab)}>
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
          {renderRightPanel(
            activeRightTab,
            activeSession,
            runtimeStatus,
            buildStatus,
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
          )}
        </aside>
      </main>

      <section className="pane bottom-pane">
        <div className="tab-row">
          {bottomTabs.map((tab) => (
            <TabButton active={activeBottomTab === tab} key={tab} onClick={() => setActiveBottomTab(tab)}>
              {tab}
            </TabButton>
          ))}
        </div>
        {renderBottomPanel(activeBottomTab, terminalDock, runtimeLog, buildLog)}
      </section>
    </div>
  );
}
