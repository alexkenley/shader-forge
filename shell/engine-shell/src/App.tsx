import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  closeTerminal,
  createSession,
  fetchBuildStatus,
  fetchSessiondHealth,
  fetchRuntimeStatus,
  getSessiondBaseUrl,
  listFiles,
  listSessions,
  openTerminal,
  readFile,
  restartRuntime,
  resizeTerminal,
  startRuntimeBuild,
  startRuntime,
  stopBuild,
  stopRuntime,
  subscribeSessiondEvents,
  type BuildStatus,
  type SessionFileEntry,
  type SessionTerminalOpen,
  type SessiondTerminalEvent,
  type EngineSession,
  type RuntimeStatus,
  writeTerminalInput,
} from './lib/sessiond';

const leftTabs = ['Sessions', 'Explorer', 'Source Control', 'World', 'Search'] as const;
const centerTabs = ['Code', 'Game', 'Scene', 'Preview'] as const;
const rightTabs = ['Details', 'Assets', 'Inspector', 'Build', 'Run', 'Profiler'] as const;
const bottomTabs = ['Terminal', 'Logs', 'Output', 'Console'] as const;
const layoutModes = ['Code Focus', 'Code + Game', 'Triptych'] as const;
const menuItems = ['File', 'Edit', 'View', 'Build', 'Tools', 'Window', 'Help'] as const;
const viewportModes = ['Perspective', 'Lit', 'Realtime'] as const;
const transformModes = ['Select', 'Move', 'Rotate', 'Scale'] as const;
const terminalShells = ['bash', 'zsh', 'sh'] as const;
const legacyWorkspaceSrc = 'web/index.html#/code';
const stoppedRuntimeStatus: RuntimeStatus = {
  state: 'stopped',
  scene: null,
  pid: null,
  startedAt: null,
  executablePath: null,
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

type LeftTab = (typeof leftTabs)[number];
type CenterTab = (typeof centerTabs)[number];
type RightTab = (typeof rightTabs)[number];
type BottomTab = (typeof bottomTabs)[number];
type LayoutMode = (typeof layoutModes)[number];
type TerminalShell = (typeof terminalShells)[number];

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

type TerminalDockProps = {
  tabs: TerminalTabState[];
  activeTabId: string;
  activeSession: EngineSession | null;
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

function trimTerminalOutput(value: string) {
  const maxLength = 120000;
  if (value.length <= maxLength) {
    return value;
  }
  return value.slice(-maxLength);
}

function createTerminalTab(index: number): TerminalTabState {
  return {
    id: crypto.randomUUID(),
    title: `Terminal ${index}`,
    shell: 'bash',
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
  runtimeStatus: RuntimeStatus,
  buildStatus: BuildStatus,
  onStartRuntimeBuild: () => void,
  onStopBuild: () => void,
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

  if (activeTab === 'Assets') {
    return (
      <div className="stack">
        <section className="card compact-card">
          <h3>Import Queue</h3>
          <ul className="detail-list">
            <li>`robot.glb` ready for cook</li>
            <li>`castle.scene.toml` validated</li>
            <li>`fx_sparks.efk` waiting for runtime binding</li>
          </ul>
        </section>
        <section className="card compact-card">
          <h3>Migration Watch</h3>
          <ul className="detail-list">
            <li>Unity scene fixtures planned</li>
            <li>Unreal exporter manifest lane planned</li>
            <li>Godot text scene lane planned</li>
          </ul>
        </section>
      </div>
    );
  }

  if (activeTab === 'Inspector') {
    return (
      <section className="card compact-card">
        <h3>Bridge Contract</h3>
        <ul className="detail-list">
          <li>The preserved code workspace stays under `web/`.</li>
          <li>React owns the dock layout, runtime tabs, and future adapters.</li>
          <li>Inline find beside `Inspect` remains a protected baseline behavior.</li>
        </ul>
      </section>
    );
  }

  if (activeTab === 'Build') {
    return (
      <div className="stack">
        <section className="card compact-card">
          <div className="section-titlebar">
            <h3>Build Profiles</h3>
            <span>{buildStatus.state}</span>
          </div>
          <ul className="detail-list">
            <li>`debug-shell` for UI iteration</li>
            <li>`runtime-sandbox` for native Vulkan bring-up</li>
            <li>`migration-fixtures` for cross-engine conversion tests</li>
          </ul>
          <div className="inline-actions">
            <button className="ghost-button" disabled={buildStatus.state === 'running'} onClick={onStartRuntimeBuild} type="button">
              Build runtime
            </button>
            <button className="ghost-button" disabled={buildStatus.state !== 'running'} onClick={onStopBuild} type="button">
              Stop build
            </button>
          </div>
        </section>
        <section className="card compact-card">
          <h3>Build Status</h3>
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
              <dt>Config</dt>
              <dd>{buildStatus.config || 'Debug'}</dd>
            </div>
            <div>
              <dt>Build dir</dt>
              <dd>{buildStatus.buildDir || 'build/runtime'}</dd>
            </div>
            <div>
              <dt>Command</dt>
              <dd>{buildStatus.command || 'waiting'}</dd>
            </div>
          </dl>
        </section>
      </div>
    );
  }

  if (activeTab === 'Run') {
    return (
      <div className="stack">
        <section className="card compact-card">
          <h3>Runtime Targets</h3>
          <ul className="detail-list">
            <li>Windows native runtime window first</li>
            <li>WSL-backed shell and terminal workflow</li>
            <li>Streamed `Game` tab later, not before the runtime is stable</li>
          </ul>
        </section>
        <section className="card compact-card">
          <h3>Runtime Status</h3>
          <dl className="fact-list">
            <div>
              <dt>State</dt>
              <dd>{runtimeStatus.state}</dd>
            </div>
            <div>
              <dt>Scene</dt>
              <dd>{runtimeStatus.scene || 'sandbox'}</dd>
            </div>
            <div>
              <dt>Process</dt>
              <dd>{runtimeStatus.pid ? `pid ${runtimeStatus.pid}` : 'not running'}</dd>
            </div>
            <div>
              <dt>Binary</dt>
              <dd>{runtimeStatus.executablePath || 'build/runtime/bin/shader_forge_runtime'}</dd>
            </div>
          </dl>
        </section>
      </div>
    );
  }

  return (
    <section className="card compact-card">
      <h3>Profiler</h3>
      <dl className="fact-list">
        <div>
          <dt>Frame budget</dt>
          <dd>16.6 ms target</dd>
        </div>
        <div>
          <dt>Shell budget</dt>
          <dd>layout + bridge only</dd>
        </div>
        <div>
          <dt>Next step</dt>
          <dd>runtime telemetry adapter</dd>
        </div>
      </dl>
    </section>
  );
}

function TerminalDock({
  tabs,
  activeTabId,
  activeSession,
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
  } | null>(null);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) || tabs[0] || null;

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
      instance.terminal.dispose();
      terminalInstanceRef.current = null;
    };

    let instance = terminalInstanceRef.current;
    if (!instance || instance.tabId !== activeTab.id) {
      disposeTerminal();
      hostRef.current.innerHTML = '';

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
      terminal.open(hostRef.current);
      fitAddon.fit();
      if (activeTab.output) {
        terminal.write(activeTab.output);
      }

      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
        const cols = terminal.cols;
        const rows = terminal.rows;
        onTerminalResize(activeTab.id, cols, rows);
      });

      resizeObserver.observe(hostRef.current);
      terminal.onData((input) => {
        onTerminalInput(activeTab.id, input);
      });

      terminalInstanceRef.current = {
        tabId: activeTab.id,
        terminal,
        fitAddon,
        resizeObserver,
        writtenOutput: activeTab.output,
      };
      instance = terminalInstanceRef.current;
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
    instance?.terminal.focus();

    return () => {
      if (!tabs.length) {
        disposeTerminal();
      }
    };
  }, [activeTab, onTerminalInput, onTerminalResize, tabs.length]);

  useEffect(() => {
    return () => {
      const instance = terminalInstanceRef.current;
      if (!instance) {
        return;
      }
      instance.resizeObserver.disconnect();
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
            {terminalShells.map((shell) => (
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

  if (activeTab === 'Output') {
    return (
      <pre className="dock-output">{buildLog}</pre>
    );
  }

  return (
    <pre className="dock-output">help
engine run sandbox
engine bake proc gate_arch
engine migrate detect {'<path>'}
engine ai providers
</pre>
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
  runtimeStatus: RuntimeStatus,
  buildStatus: BuildStatus,
  onStartRuntime: () => void,
  onStopRuntime: () => void,
  onRestartRuntime: () => void,
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
                onClick={onStartRuntime}
                type="button"
              >
                Play
              </button>
              <button
                className="ghost-button"
                disabled={runtimeStatus.state !== 'running' || buildStatus.state === 'running'}
                onClick={onStopRuntime}
                type="button"
              >
                Stop
              </button>
              <button
                className="ghost-button"
                disabled={buildStatus.state === 'running'}
                onClick={onRestartRuntime}
                type="button"
              >
                Restart
              </button>
            </div>
          </div>
          <ViewportShell
            footer="Windows native runtime window first. Embedded streaming viewer comes after runtime stabilization."
            subtitle="Run target: sandbox"
            title="Game viewport"
          />
        </section>
        <section className="surface">
          <div className="metric-stack">
            <article className="mini-card">
              <span>Status</span>
              <strong>{runtimeStatus.state === 'running' ? 'Running' : 'Stopped'}</strong>
            </article>
            <article className="mini-card">
              <span>Scene</span>
              <strong>{runtimeStatus.scene || 'sandbox'}</strong>
            </article>
            <article className="mini-card">
              <span>Process</span>
              <strong>{runtimeStatus.pid ? `pid ${runtimeStatus.pid}` : 'not running'}</strong>
            </article>
          </div>
        </section>
      </div>
    );
  }

  if (activeTab === 'Scene') {
    return (
      <div className="workspace-layout workspace-layout--scene">
        <section className="surface">
          <div className="surface-header">
            <div>
              <div className="surface-eyebrow">Authoring</div>
              <h2>Scene Editor</h2>
              <p>Levels stay text-backed. Viewport edits save deterministic `.scene.toml` and `.prefab.toml` assets.</p>
            </div>
          </div>
          <ViewportShell
            footer="Edit mode persists to text-backed scene assets. Play mode remains discard-by-default."
            subtitle="Authoring viewport"
            title="Scene viewport"
          />
        </section>
        <section className="surface">
          <div className="stack">
            <article className="mini-card">
              <span>World outliner</span>
              <strong>planned</strong>
            </article>
            <article className="mini-card">
              <span>Undo / redo</span>
              <strong>required</strong>
            </article>
            <article className="mini-card">
              <span>Play separation</span>
              <strong>discard by default</strong>
            </article>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="workspace-layout workspace-layout--preview">
      <section className="surface">
        <div className="surface-header">
          <div>
            <div className="surface-eyebrow">Preview</div>
            <h2>Asset Review</h2>
          </div>
        </div>
        <div className="preview-grid">
          <article className="preview-card">
            <span>Model</span>
            <strong>robot.glb</strong>
            <p>glTF-first import lane</p>
          </article>
          <article className="preview-card">
            <span>Effect</span>
            <strong>fx_sparks.efk</strong>
            <p>Effekseer integration target</p>
          </article>
          <article className="preview-card">
            <span>Scene</span>
            <strong>castle.scene.toml</strong>
            <p>text-backed authoring asset</p>
          </article>
        </div>
      </section>
    </div>
  );
}

export default function App() {
  const [activeLeftTab, setActiveLeftTab] = useState<LeftTab>('World');
  const [activeCenterTab, setActiveCenterTab] = useState<CenterTab>('Scene');
  const [activeRightTab, setActiveRightTab] = useState<RightTab>('Details');
  const [activeBottomTab, setActiveBottomTab] = useState<BottomTab>('Terminal');
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('Triptych');
  const [showLegacyBridge, setShowLegacyBridge] = useState(false);
  const [sessiondState, setSessiondState] = useState<'connecting' | 'connected' | 'offline'>('connecting');
  const [sessiondMessage, setSessiondMessage] = useState('Checking engine_sessiond...');
  const [sessions, setSessions] = useState<EngineSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [sessionActionBusy, setSessionActionBusy] = useState(false);
  const [explorerEntries, setExplorerEntries] = useState<SessionFileEntry[]>([]);
  const [explorerPath, setExplorerPath] = useState('.');
  const [selectedExplorerPath, setSelectedExplorerPath] = useState('');
  const [selectedFilePreview, setSelectedFilePreview] = useState('');
  const [explorerBusy, setExplorerBusy] = useState(false);
  const [terminalTabs, setTerminalTabs] = useState<TerminalTabState[]>([]);
  const [activeTerminalTabId, setActiveTerminalTabId] = useState('');
  const [runtimeStatus, setRuntimeStatus] = useState<RuntimeStatus>(stoppedRuntimeStatus);
  const [runtimeLog, setRuntimeLog] = useState('[runtime] idle\n');
  const [buildStatus, setBuildStatus] = useState<BuildStatus>(idleBuildStatus);
  const [buildLog, setBuildLog] = useState('[build] idle\n');
  const terminalTabsRef = useRef<TerminalTabState[]>([]);
  const terminalOpeningRef = useRef(new Set<string>());

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

  useEffect(() => {
    let cancelled = false;

    async function loadBackendState() {
      try {
        const health = await fetchSessiondHealth();
        if (cancelled) {
          return;
        }
        setSessiondState('connected');
        setSessiondMessage(`${health.service} online at ${getSessiondBaseUrl()}`);
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
    if (terminalTabs.length) {
      return;
    }
    const nextTab = createTerminalTab(1);
    setTerminalTabs([nextTab]);
    setActiveTerminalTabId(nextTab.id);
  }, [terminalTabs.length]);

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
        return;
      }

      if (event.type === 'runtime.exit') {
        setRuntimeStatus({
          ...stoppedRuntimeStatus,
          executablePath: event.data.executablePath,
        });
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
      }
    });

    return unsubscribe;
  }, []);

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
      const session = await createSession();
      setSessiondState('connected');
      setSessiondMessage(`Created session ${session.name}`);
      await refreshSessions();
      setActiveSessionId(session.id);
      await refreshExplorer(session.id, '.');
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

  const activeSession = sessions.find((session) => session.id === activeSessionId) || null;

  function handleAddTerminal() {
    setTerminalTabs((current) => {
      const nextTab = createTerminalTab(current.length + 1);
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
      const nextStatus = await startRuntime(runtimeStatus.scene || 'sandbox');
      setRuntimeStatus(nextStatus);
      setRuntimeLog((current) => trimTerminalOutput(`${current}[runtime] start requested\n`));
      setActiveBottomTab('Logs');
    } catch (error) {
      setRuntimeLog((current) =>
        trimTerminalOutput(`${current}[runtime] ${error instanceof Error ? error.message : String(error)}\n`),
      );
    }
  }

  async function handleStopRuntime() {
    try {
      const nextStatus = await stopRuntime();
      setRuntimeStatus(nextStatus);
      setRuntimeLog((current) => trimTerminalOutput(`${current}[runtime] stop requested\n`));
      setActiveBottomTab('Logs');
    } catch (error) {
      setRuntimeLog((current) =>
        trimTerminalOutput(`${current}[runtime] ${error instanceof Error ? error.message : String(error)}\n`),
      );
    }
  }

  async function handleRestartRuntime() {
    try {
      const nextStatus = await restartRuntime(runtimeStatus.scene || 'sandbox');
      setRuntimeStatus(nextStatus);
      setRuntimeLog((current) => trimTerminalOutput(`${current}[runtime] restart requested\n`));
      setActiveBottomTab('Logs');
    } catch (error) {
      setRuntimeLog((current) =>
        trimTerminalOutput(`${current}[runtime] ${error instanceof Error ? error.message : String(error)}\n`),
      );
    }
  }

  async function handleStartRuntimeBuild() {
    try {
      const nextStatus = await startRuntimeBuild();
      setBuildStatus(nextStatus);
      setBuildLog((current) => trimTerminalOutput(`${current}[build] runtime build requested\n`));
      setActiveBottomTab('Output');
      setActiveRightTab('Build');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setBuildStatus({
        ...idleBuildStatus,
        state: 'failed',
        target: 'runtime',
        config: 'Debug',
        buildDir: 'build/runtime',
        finishedAt: new Date().toISOString(),
        error: message,
      });
      setBuildLog((current) =>
        trimTerminalOutput(`${current}[build] ${message}\n`),
      );
      setActiveBottomTab('Output');
    }
  }

  async function handleStopBuild() {
    try {
      const nextStatus = await stopBuild();
      setBuildStatus(nextStatus);
      setBuildLog((current) => trimTerminalOutput(`${current}[build] stop requested\n`));
      setActiveBottomTab('Output');
    } catch (error) {
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

  return (
    <div className="shell-app">
      <div className="chrome-bar chrome-bar--menu">
        <div className="menu-strip">
          {menuItems.map((item) => (
            <button className="menu-button" key={item} type="button">
              {item}
            </button>
          ))}
        </div>
        <div className="chrome-title">Shader Forge Editor</div>
        <div className="chrome-strip-meta">
          <span className="chrome-meta-chip">Open source</span>
          <span className="chrome-meta-chip">Windows + WSL2</span>
        </div>
      </div>
      <div className="chrome-bar chrome-bar--tools">
        <div className="toolbar-cluster">
          <span className="toolbar-chip toolbar-chip--accent">Project: shader-forge</span>
          <span className="toolbar-chip">Branch: main</span>
          <span className="toolbar-chip">Target: sandbox</span>
          <span className="toolbar-chip">Renderer: Vulkan-first</span>
        </div>
          <div className="toolbar-cluster toolbar-cluster--right">
            <span className="toolbar-chip">WSL shell primary</span>
            <span className={`toolbar-chip${sessiondState === 'offline' ? ' toolbar-chip--warning' : ''}`}>
              {sessiondState === 'connected' ? 'engine_sessiond online' : 'engine_sessiond pending'}
            </span>
            <span className={`toolbar-chip${buildStatus.state === 'running' ? ' toolbar-chip--accent' : ''}`}>
              Build: {buildStatus.state}
            </span>
            <span className={`toolbar-chip${runtimeStatus.state === 'running' ? ' toolbar-chip--accent' : ''}`}>
              Runtime: {runtimeStatus.state}
            </span>
            <span className="toolbar-chip toolbar-chip--muted">{sessiondMessage}</span>
          </div>
        </div>

      <main className="shell-grid">
        <aside className="pane rail-pane">
          <div className="pane-header">
            <h2>Left Dock</h2>
            <span className="pane-caption">World, content, sessions</span>
          </div>
          <div className="stack">
            {leftTabs.map((tab) => (
              <TabButton active={activeLeftTab === tab} key={tab} onClick={() => setActiveLeftTab(tab)}>
                {tab}
              </TabButton>
            ))}
          </div>
          <section className="card compact-card rail-card">
            <div className="pane-header pane-header--compact">
              <h3>Sessiond Bridge</h3>
              <span className="pane-caption">{sessiondState}</span>
            </div>
            <p className="sessiond-copy">
              Base URL: <code>{getSessiondBaseUrl()}</code>
            </p>
            <div className="inline-actions">
              <button className="ghost-button" disabled={sessionActionBusy} onClick={handleCreateSession} type="button">
                {sessionActionBusy ? 'Working...' : 'Create session'}
              </button>
              <button className="ghost-button" disabled={sessionActionBusy} onClick={handleRefreshSessions} type="button">
                Refresh
              </button>
            </div>
            <ul className="session-list">
              {sessions.length ? (
                sessions.map((session) => (
                  <li key={session.id}>
                    <button
                      className={`session-button${activeSessionId === session.id ? ' is-active' : ''}`}
                      onClick={() => {
                        setActiveSessionId(session.id);
                        void refreshExplorer(session.id, '.').catch((error) => {
                          setSessiondState('offline');
                          setSessiondMessage(error instanceof Error ? error.message : String(error));
                        });
                      }}
                      type="button"
                    >
                      <strong>{session.name}</strong>
                      <span>{session.rootPath}</span>
                      <em>{formatSessionTimestamp(session.createdAt)}</em>
                    </button>
                  </li>
                ))
              ) : (
                <li className="session-list-empty">
                  {sessiondState === 'offline'
                    ? 'Start engine_sessiond to populate shell sessions.'
                    : 'No sessions yet. Create one from the shell.'}
                </li>
              )}
            </ul>
          </section>
          <section className="card compact-card rail-card">
            <h3>{activeLeftTab}</h3>
            <p>
              {activeLeftTab === 'Sessions'
                ? 'Project sessions, WSL terminals, and future engine_sessiond ownership live here.'
                : activeLeftTab === 'Explorer'
                  ? 'Repo navigation stays text-first so AI and humans are editing the same sources.'
                    : activeLeftTab === 'Source Control'
                      ? 'Git status, diffs, and migration reports remain visible inside the shell.'
                    : activeLeftTab === 'World'
                      ? 'Outliner and scene hierarchy will graduate here as level authoring lands.'
                      : 'Search spans repo, assets, logs, and later scene data in one shell surface.'}
            </p>
          </section>
          {activeLeftTab === 'Explorer' ? (
            <section className="card compact-card rail-card">
              <div className="pane-header pane-header--compact">
                <h3>Root Explorer</h3>
                <span className="pane-caption">{activeSession ? activeSession.name : 'no session'}</span>
              </div>
              <div className="inline-actions">
                <button className="ghost-button" disabled={!activeSessionId || explorerPath === '.'} onClick={handleExplorerUp} type="button">
                  Up
                </button>
                <span className="toolbar-chip toolbar-chip--muted">{explorerPath}</span>
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
                        <span>{entry.kind === 'directory' ? 'directory' : formatFileSize(entry.size)}</span>
                      </button>
                    </li>
                  ))
                ) : (
                  <li className="session-list-empty">No file data yet. Start sessiond and create a session.</li>
                )}
              </ul>
              {selectedExplorerPath ? (
                <div className="file-preview">
                  <div className="file-preview__path">{selectedExplorerPath}</div>
                  <pre>{selectedFilePreview || '[empty file]'}</pre>
                </div>
              ) : null}
            </section>
          ) : null}
        </aside>

        <section className="center-column">
          <section className="pane dock-toolbar">
            <div className="toolbar-rack">
              <div className="tab-row">
                {centerTabs.map((tab) => (
                  <TabButton active={activeCenterTab === tab} key={tab} onClick={() => setActiveCenterTab(tab)}>
                    {tab}
                  </TabButton>
                ))}
              </div>
              <div className="toolbar-rack__spacer" />
              <div className="tab-row tab-row--tight">
                {layoutModes.map((mode) => (
                  <TabButton active={layoutMode === mode} key={mode} onClick={() => setLayoutMode(mode)}>
                    {mode}
                  </TabButton>
                ))}
              </div>
            </div>
            <div className="viewport-commandbar">
              <div className="viewport-commandbar__group">
                <button className="ghost-button" disabled={buildStatus.state === 'running'} onClick={handleStartRuntimeBuild} type="button">
                  Build
                </button>
                <button
                  className="ghost-button"
                  disabled={buildStatus.state === 'running'}
                  onClick={handleStartRuntime}
                  type="button"
                >
                  Play
                </button>
                <button
                  className="ghost-button"
                  disabled={runtimeStatus.state !== 'running' || buildStatus.state === 'running'}
                  onClick={handleStopRuntime}
                  type="button"
                >
                  Stop
                </button>
                <button
                  className="ghost-button"
                  disabled={buildStatus.state === 'running'}
                  onClick={handleRestartRuntime}
                  type="button"
                >
                  Restart
                </button>
                <button className="ghost-button" disabled type="button">
                  Capture
                </button>
              </div>
              <div className="viewport-commandbar__group">
                <span className="toolbar-chip">Scene: CastleEntrance</span>
                <span className="toolbar-chip">Mode: Edit</span>
                <span className={`toolbar-chip${buildStatus.state === 'running' ? ' toolbar-chip--accent' : ''}`}>
                  Build: {buildStatus.state}
                </span>
                <span className={`toolbar-chip${runtimeStatus.state === 'running' ? ' toolbar-chip--accent' : ''}`}>
                  Runtime: {runtimeStatus.state}
                </span>
              </div>
            </div>
          </section>

          {renderCenterContent(
            activeCenterTab,
            layoutMode,
            showLegacyBridge,
            () => setShowLegacyBridge((current) => !current),
            runtimeStatus,
            buildStatus,
            handleStartRuntime,
            handleStopRuntime,
            handleRestartRuntime,
          )}
        </section>

        <aside className="pane side-pane">
          <div className="pane-header">
            <h2>Inspector Dock</h2>
            <span className="pane-caption">Details and runtime control</span>
          </div>
          <div className="stack stack--tabs">
            {rightTabs.map((tab) => (
              <TabButton active={activeRightTab === tab} key={tab} onClick={() => setActiveRightTab(tab)}>
                {tab}
              </TabButton>
            ))}
          </div>
          {activeSession ? (
            <section className="card compact-card selected-session-card">
              <h3>Active Session</h3>
              <dl className="fact-list">
                <div>
                  <dt>Name</dt>
                  <dd>{activeSession.name}</dd>
                </div>
                <div>
                  <dt>Root</dt>
                  <dd>{activeSession.rootPath}</dd>
                </div>
                <div>
                  <dt>Created</dt>
                  <dd>{formatSessionTimestamp(activeSession.createdAt)}</dd>
                </div>
              </dl>
            </section>
          ) : null}
          {renderRightPanel(
            activeRightTab,
            runtimeStatus,
            buildStatus,
            handleStartRuntimeBuild,
            handleStopBuild,
          )}
        </aside>
      </main>

      <section className="pane bottom-pane">
        <div className="pane-header">
          <h2>Bottom Dock</h2>
          <span className="pane-caption">Terminal and log surfaces</span>
        </div>
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
