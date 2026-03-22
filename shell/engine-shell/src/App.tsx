import { useState } from 'react';

const leftTabs = ['Sessions', 'Explorer', 'Source Control', 'World', 'Search'] as const;
const centerTabs = ['Code', 'Game', 'Scene', 'Preview'] as const;
const rightTabs = ['Details', 'Assets', 'Inspector', 'Build', 'Run', 'Profiler'] as const;
const bottomTabs = ['Terminal', 'Logs', 'Output', 'Console'] as const;
const layoutModes = ['Code Focus', 'Code + Game', 'Triptych'] as const;
const runtimeActions = ['Play', 'Pause', 'Restart', 'Capture'] as const;
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

function ShellStatusStrip() {
  return (
    <div className="status-strip">
      <span className="status-chip status-chip--accent">Phase 1 shell frame</span>
      <span className="status-chip">React + TS + Vite</span>
      <span className="status-chip">Dear ImGui tooling</span>
      <span className="status-chip">RmlUi game UI</span>
      <span className="status-chip">Effekseer VFX</span>
      <span className="status-chip">TOML + FlatBuffers + SQLite</span>
    </div>
  );
}

function renderRightPanel(activeTab: RightTab) {
  if (activeTab === 'Details') {
    return (
      <div className="stack">
        <section className="card compact-card">
          <h3>Selection</h3>
          <dl className="fact-list">
            <div>
              <dt>Actor</dt>
              <dd>BP_CitadelGate</dd>
            </div>
            <div>
              <dt>Transform</dt>
              <dd>1240, -330, 64</dd>
            </div>
            <div>
              <dt>Mode</dt>
              <dd>Edit</dd>
            </div>
          </dl>
        </section>
        <section className="card compact-card">
          <h3>Component Fields</h3>
          <ul className="detail-list">
            <li>StaticMesh: `SM_Gate_A`</li>
            <li>Collision: `BlockAll`</li>
            <li>Gameplay Tag: `Encounter.Entry`</li>
            <li>Mobility: `Static`</li>
          </ul>
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
engine migrate detect <path>
engine ai providers
</pre>
  );
}

function renderCodeBridge(layoutMode: LayoutMode) {
  return (
    <div className={`workspace-layout workspace-layout--${layoutModeClassName(layoutMode)}`}>
      <section className="surface legacy-surface">
        <div className="surface-header">
          <div>
            <div className="surface-eyebrow">Preserved Workspace Bridge</div>
            <h2>Code</h2>
            <p>
              The Monaco workspace and inline file-search toolbar remain inside the preserved layer while the
              React shell takes over the outer dock layout.
            </p>
          </div>
          <a className="surface-link" href={legacyWorkspaceSrc} rel="noreferrer" target="_blank">
            Open standalone
          </a>
        </div>
        <iframe
          className="legacy-frame"
          loading="lazy"
          src={legacyWorkspaceSrc}
          title="Shader Forge preserved code workspace"
        />
      </section>

      <section className="surface">
        <div className="surface-header">
          <div>
            <div className="surface-eyebrow">Companion Viewer</div>
            <h2>Game / Scene Partner</h2>
          </div>
        </div>
        <div className="placeholder-view placeholder-view--viewer">
          <span>Native runtime first</span>
          <p>Use split layouts now. Stream the runtime here after the viewer bridge exists.</p>
        </div>
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

function renderCenterContent(activeTab: CenterTab, layoutMode: LayoutMode) {
  if (activeTab === 'Code') {
    return renderCodeBridge(layoutMode);
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
          <div className="placeholder-view placeholder-view--runtime">
            <span>Runtime window launches natively</span>
            <p>The embedded viewer becomes a stream bridge later. The shell still owns run controls now.</p>
          </div>
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
          <div className="placeholder-view placeholder-view--scene">
            <span>Edit Mode</span>
            <p>Gizmos, selection, placement, and bake-from-procedural all land in persistent scene assets.</p>
          </div>
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
  const [activeLeftTab, setActiveLeftTab] = useState<LeftTab>('Sessions');
  const [activeCenterTab, setActiveCenterTab] = useState<CenterTab>('Code');
  const [activeRightTab, setActiveRightTab] = useState<RightTab>('Details');
  const [activeBottomTab, setActiveBottomTab] = useState<BottomTab>('Terminal');
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('Code + Game');

  return (
    <div className="shell-app">
      <header className="shell-header">
        <div className="shell-header-copy">
          <div className="shell-eyebrow">Shader Forge</div>
          <h1>Engine Shell</h1>
          <p>
            React owns the shell frame, dock layout, and future runtime adapters. The preserved Monaco editor,
            tabs, terminals, and inline find beside <code>Inspect</code> stay under <code>web/</code> until
            the bridge layer is replaced deliberately.
          </p>
        </div>
        <div className="shell-header-meta">
          <div className="status-panel">
            <span className="status-dot" />
            <strong>WSL shell primary</strong>
            <small>Windows native runtime window</small>
          </div>
          <div className="status-panel">
            <span className="status-dot status-dot--idle" />
            <strong>Viewer bridge pending</strong>
            <small>Native runtime first</small>
          </div>
        </div>
      </header>

      <ShellStatusStrip />

      <main className="shell-grid">
        <aside className="pane rail-pane">
          <div className="pane-header">
            <h2>Workspace</h2>
            <span className="pane-caption">Project shell</span>
          </div>
          <div className="stack">
            {leftTabs.map((tab) => (
              <TabButton active={activeLeftTab === tab} key={tab} onClick={() => setActiveLeftTab(tab)}>
                {tab}
              </TabButton>
            ))}
          </div>
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
        </aside>

        <section className="center-column">
          <section className="pane dock-toolbar">
            <div className="tab-row">
              {centerTabs.map((tab) => (
                <TabButton active={activeCenterTab === tab} key={tab} onClick={() => setActiveCenterTab(tab)}>
                  {tab}
                </TabButton>
              ))}
            </div>
            <div className="tab-row tab-row--tight">
              {layoutModes.map((mode) => (
                <TabButton active={layoutMode === mode} key={mode} onClick={() => setLayoutMode(mode)}>
                  {mode}
                </TabButton>
              ))}
            </div>
          </section>

          {renderCenterContent(activeCenterTab, layoutMode)}
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
