import { useEffect, useState } from 'react';
import {
  createSession,
  fetchSessiondHealth,
  getSessiondBaseUrl,
  listFiles,
  listSessions,
  readFile,
  type SessionFileEntry,
  type EngineSession,
} from './lib/sessiond';

const leftTabs = ['Sessions', 'Explorer', 'Source Control', 'World', 'Search'] as const;
const centerTabs = ['Code', 'Game', 'Scene', 'Preview'] as const;
const rightTabs = ['Details', 'Assets', 'Inspector', 'Build', 'Run', 'Profiler'] as const;
const bottomTabs = ['Terminal', 'Logs', 'Output', 'Console'] as const;
const layoutModes = ['Code Focus', 'Code + Game', 'Triptych'] as const;
const runtimeActions = ['Play', 'Pause', 'Restart', 'Capture'] as const;
const menuItems = ['File', 'Edit', 'View', 'Build', 'Tools', 'Window', 'Help'] as const;
const viewportModes = ['Perspective', 'Lit', 'Realtime'] as const;
const transformModes = ['Select', 'Move', 'Rotate', 'Scale'] as const;
const legacyWorkspaceSrc = 'web/index.html#/code';

type LeftTab = (typeof leftTabs)[number];
type CenterTab = (typeof centerTabs)[number];
type RightTab = (typeof rightTabs)[number];
type BottomTab = (typeof bottomTabs)[number];
type LayoutMode = (typeof layoutModes)[number];

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

function renderRightPanel(activeTab: RightTab) {
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
      <section className="card compact-card">
        <h3>Build Profiles</h3>
        <ul className="detail-list">
          <li>`debug-shell` for UI iteration</li>
          <li>`runtime-sandbox` for native Vulkan bring-up</li>
          <li>`migration-fixtures` for cross-engine conversion tests</li>
        </ul>
      </section>
    );
  }

  if (activeTab === 'Run') {
    return (
      <section className="card compact-card">
        <h3>Runtime Targets</h3>
        <ul className="detail-list">
          <li>Windows native runtime window first</li>
          <li>WSL-backed shell and terminal workflow</li>
          <li>Streamed `Game` tab later, not before the runtime is stable</li>
        </ul>
      </section>
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

function renderBottomPanel(activeTab: BottomTab) {
  if (activeTab === 'Terminal') {
    return (
      <pre className="dock-output">$ powershell.exe -ExecutionPolicy Bypass -File .\scripts\start-dev-clean.ps1
$ engine run sandbox
$ engine migrate unreal D:\Project\SourceGame
[phase-1] clean shell frame ready
[phase-1] preserved code workspace retained
</pre>
    );
  }

  if (activeTab === 'Logs') {
    return (
      <pre className="dock-output">[shell] mounted React frame
[bridge] loading preserved code workspace
[runtime] native viewer remains external in Phase 1
[migration] Unity, Unreal, and Godot lanes planned
</pre>
    );
  }

  if (activeTab === 'Output') {
    return (
      <pre className="dock-output">shell smoke: PASS
legacy editor contract: PASS
migration specs: indexed
AI subsystem spec: indexed
</pre>
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
              {runtimeActions.map((action) => (
                <button className="ghost-button" key={action} type="button">
                  {action}
                </button>
              ))}
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
              <strong>Idle</strong>
            </article>
            <article className="mini-card">
              <span>Latest capture</span>
              <strong>pending</strong>
            </article>
            <article className="mini-card">
              <span>Hot reload</span>
              <strong>Shaders + assets</strong>
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
  const [activeBottomTab, setActiveBottomTab] = useState<BottomTab>('Output');
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
                {runtimeActions.map((action) => (
                  <button className="ghost-button" key={action} type="button">
                    {action}
                  </button>
                ))}
              </div>
              <div className="viewport-commandbar__group">
                <span className="toolbar-chip">Scene: CastleEntrance</span>
                <span className="toolbar-chip">Mode: Edit</span>
              </div>
            </div>
          </section>

          {renderCenterContent(activeCenterTab, layoutMode, showLegacyBridge, () =>
            setShowLegacyBridge((current) => !current),
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
          {renderRightPanel(activeRightTab)}
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
        {renderBottomPanel(activeBottomTab)}
      </section>
    </div>
  );
}
