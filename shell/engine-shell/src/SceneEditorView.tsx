import { useEffect, useMemo, useState } from 'react';
import {
  listFiles,
  readFile,
  writeFile,
  type EngineSession,
  type RuntimeStatus,
} from './lib/sessiond';
import {
  buildSceneAssetPath,
  cloneSceneForDuplicate,
  createSceneAssetDocument,
  formatPrefabAssetDocument,
  formatSceneAssetDocument,
  parsePrefabAssetDocument,
  parseSceneAssetDocument,
  sanitizeAssetName,
  type PrefabAssetDocument,
  type SceneAssetDocument,
} from './scene-authoring';

type BackendState = 'connected' | 'offline';
type EditorMode = 'edit' | 'play';
type SelectionNode = 'scene' | 'prefab';
type EditorSnapshot = {
  scene: SceneAssetDocument | null;
  prefab: PrefabAssetDocument | null;
};

type SceneEditorViewProps = {
  activeSession: EngineSession | null;
  launchScene: string;
  runtimeStatus: RuntimeStatus;
  onLaunchSceneChange: (value: string) => void;
  onBackendStatus: (state: BackendState, message: string) => void;
};

const emptySnapshot: EditorSnapshot = {
  scene: null,
  prefab: null,
};

function cloneSceneDocument(document: SceneAssetDocument | null) {
  return document ? { ...document } : null;
}

function clonePrefabDocument(document: PrefabAssetDocument | null) {
  return document ? { ...document } : null;
}

function cloneSnapshot(snapshot: EditorSnapshot) {
  return {
    scene: cloneSceneDocument(snapshot.scene),
    prefab: clonePrefabDocument(snapshot.prefab),
  };
}

function isMissingDirectoryError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /ENOENT|no such file|not a directory/i.test(message);
}

function sortScenes(documents: SceneAssetDocument[]) {
  return [...documents].sort((left, right) =>
    `${left.title}\0${left.name}`.localeCompare(`${right.title}\0${right.name}`),
  );
}

function sortPrefabs(documents: PrefabAssetDocument[]) {
  return [...documents].sort((left, right) =>
    `${left.category}\0${left.name}`.localeCompare(`${right.category}\0${right.name}`),
  );
}

function toSceneStatusLabel(mode: EditorMode) {
  return mode === 'edit' ? 'Edit Mode' : 'Play Mode';
}

async function loadSceneDocuments(sessionId: string) {
  try {
    const listing = await listFiles(sessionId, 'content/scenes');
    const files = listing.entries.filter(
      (entry) => entry.kind === 'file' && entry.path.endsWith('.scene.toml'),
    );
    const payloads = await Promise.all(files.map((entry) => readFile(sessionId, entry.path)));
    return sortScenes(payloads.map((payload) => parseSceneAssetDocument(payload)));
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      return [];
    }
    throw error;
  }
}

async function loadPrefabDocuments(sessionId: string) {
  try {
    const listing = await listFiles(sessionId, 'content/prefabs');
    const files = listing.entries.filter(
      (entry) => entry.kind === 'file' && entry.path.endsWith('.prefab.toml'),
    );
    const payloads = await Promise.all(files.map((entry) => readFile(sessionId, entry.path)));
    return sortPrefabs(payloads.map((payload) => parsePrefabAssetDocument(payload)));
  } catch (error) {
    if (isMissingDirectoryError(error)) {
      return [];
    }
    throw error;
  }
}

export function SceneEditorView({
  activeSession,
  launchScene,
  runtimeStatus,
  onLaunchSceneChange,
  onBackendStatus,
}: SceneEditorViewProps) {
  const [mode, setMode] = useState<EditorMode>('edit');
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Select a session to load scene authoring assets.');
  const [sceneDocuments, setSceneDocuments] = useState<SceneAssetDocument[]>([]);
  const [prefabDocuments, setPrefabDocuments] = useState<PrefabAssetDocument[]>([]);
  const [selectedScenePath, setSelectedScenePath] = useState('');
  const [selectedNode, setSelectedNode] = useState<SelectionNode>('scene');
  const [sceneSaved, setSceneSaved] = useState<SceneAssetDocument | null>(null);
  const [prefabSaved, setPrefabSaved] = useState<PrefabAssetDocument | null>(null);
  const [history, setHistory] = useState<EditorSnapshot[]>([cloneSnapshot(emptySnapshot)]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [newSceneName, setNewSceneName] = useState('');
  const [duplicateSceneName, setDuplicateSceneName] = useState('');

  const currentSnapshot = history[historyIndex] || emptySnapshot;
  const sceneDraft = currentSnapshot.scene;
  const prefabDraft = currentSnapshot.prefab;
  const sceneDirty = useMemo(() => {
    if (!sceneSaved || !sceneDraft) {
      return false;
    }
    return formatSceneAssetDocument(sceneSaved) !== formatSceneAssetDocument(sceneDraft);
  }, [sceneSaved, sceneDraft]);
  const prefabDirty = useMemo(() => {
    if (!prefabSaved || !prefabDraft || prefabSaved.path !== prefabDraft.path) {
      return false;
    }
    return formatPrefabAssetDocument(prefabSaved) !== formatPrefabAssetDocument(prefabDraft);
  }, [prefabSaved, prefabDraft]);
  const canEdit = mode === 'edit';
  const canUndo = historyIndex > 0;
  const canRedo = historyIndex + 1 < history.length;
  const scenePrimaryPrefab =
    prefabDocuments.find((document) => document.name === sceneDraft?.primaryPrefab) || null;

  function resetDrafts(nextScene: SceneAssetDocument | null, nextPrefab: PrefabAssetDocument | null) {
    setHistory([
      {
        scene: cloneSceneDocument(nextScene),
        prefab: clonePrefabDocument(nextPrefab),
      },
    ]);
    setHistoryIndex(0);
  }

  function overwriteCurrentSnapshot(nextSnapshot: EditorSnapshot) {
    setHistory((current) => {
      const seeded = current.length ? current.map(cloneSnapshot) : [cloneSnapshot(emptySnapshot)];
      const boundedIndex = Math.min(historyIndex, seeded.length - 1);
      seeded[boundedIndex] = cloneSnapshot(nextSnapshot);
      return seeded;
    });
  }

  function commitDraft(nextSnapshot: EditorSnapshot) {
    const baseHistory = history.slice(0, historyIndex + 1).map(cloneSnapshot);
    const nextHistory = [...baseHistory, cloneSnapshot(nextSnapshot)].slice(-40);
    setHistory(nextHistory);
    setHistoryIndex(nextHistory.length - 1);
  }

  function findPrefabByName(name: string, documents = prefabDocuments) {
    return documents.find((document) => document.name === name) || null;
  }

  function openSceneDocument(
    nextScene: SceneAssetDocument,
    nextPrefabs = prefabDocuments,
    nextMode: EditorMode = 'edit',
  ) {
    const matchedPrefab = findPrefabByName(nextScene.primaryPrefab, nextPrefabs);
    setSelectedScenePath(nextScene.path);
    setSceneSaved(nextScene);
    setPrefabSaved(matchedPrefab);
    setSelectedNode('scene');
    setMode(nextMode);
    resetDrafts(nextScene, matchedPrefab);
    setDuplicateSceneName(nextScene.name ? `${nextScene.name}_copy` : '');
    setStatusMessage(`Opened scene ${nextScene.name}.`);
    onLaunchSceneChange(nextScene.name);
    onBackendStatus('connected', `Opened scene ${nextScene.name} for authoring.`);
  }

  useEffect(() => {
    let cancelled = false;

    async function loadAuthoringAssets() {
      if (!activeSession) {
        setSceneDocuments([]);
        setPrefabDocuments([]);
        setSelectedScenePath('');
        setSceneSaved(null);
        setPrefabSaved(null);
        setSelectedNode('scene');
        setMode('edit');
        resetDrafts(null, null);
        setStatusMessage('Select a session to load scene authoring assets.');
        return;
      }

      setBusy(true);
      try {
        const [nextScenes, nextPrefabs] = await Promise.all([
          loadSceneDocuments(activeSession.id),
          loadPrefabDocuments(activeSession.id),
        ]);

        if (cancelled) {
          return;
        }

        setSceneDocuments(nextScenes);
        setPrefabDocuments(nextPrefabs);

        if (!nextScenes.length) {
          setSelectedScenePath('');
          setSceneSaved(null);
          setPrefabSaved(null);
          setSelectedNode('scene');
          resetDrafts(null, null);
          setStatusMessage('No `.scene.toml` files found under `content/scenes` for this session.');
          onBackendStatus('connected', `Loaded authoring session ${activeSession.name}, but no scene assets were found.`);
          return;
        }

        const preferredScene =
          nextScenes.find((document) => document.path === selectedScenePath) ||
          nextScenes.find((document) => document.name === launchScene) ||
          nextScenes[0];
        openSceneDocument(preferredScene, nextPrefabs);
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setStatusMessage(message);
        onBackendStatus('offline', message);
      } finally {
        if (!cancelled) {
          setBusy(false);
        }
      }
    }

    void loadAuthoringAssets();
    return () => {
      cancelled = true;
    };
  }, [activeSession]);

  async function reloadFromDisk() {
    if (!activeSession) {
      return;
    }

    setBusy(true);
    try {
      const [nextScenes, nextPrefabs] = await Promise.all([
        loadSceneDocuments(activeSession.id),
        loadPrefabDocuments(activeSession.id),
      ]);
      setSceneDocuments(nextScenes);
      setPrefabDocuments(nextPrefabs);

      if (!nextScenes.length) {
        setSelectedScenePath('');
        setSceneSaved(null);
        setPrefabSaved(null);
        resetDrafts(null, null);
        setStatusMessage('Reloaded from disk. No scene assets remain in `content/scenes`.');
        onBackendStatus('connected', 'Reloaded scene authoring data from disk.');
        return;
      }

      const preferredScene =
        nextScenes.find((document) => document.path === selectedScenePath) ||
        nextScenes.find((document) => document.name === launchScene) ||
        nextScenes[0];
      const nextMode = mode;
      const matchedPrefab = findPrefabByName(preferredScene.primaryPrefab, nextPrefabs);
      setSelectedScenePath(preferredScene.path);
      setSceneSaved(preferredScene);
      setPrefabSaved(matchedPrefab);
      resetDrafts(preferredScene, matchedPrefab);
      setSelectedNode('scene');
      setStatusMessage(`Reloaded scene ${preferredScene.name} from disk.`);
      onLaunchSceneChange(preferredScene.name);
      onBackendStatus('connected', `Reloaded scene ${preferredScene.name} from disk.`);
      setMode(nextMode);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusMessage(message);
      onBackendStatus('offline', message);
    } finally {
      setBusy(false);
    }
  }

  function handleModeChange(nextMode: EditorMode) {
    if (nextMode === mode) {
      return;
    }

    if (nextMode === 'play') {
      if (sceneSaved || prefabSaved) {
        resetDrafts(sceneSaved, prefabSaved);
      }
      setMode('play');
      setSelectedNode('scene');
      const message =
        sceneDirty || prefabDirty
          ? 'Entered Play Mode. Unsaved authoring edits were discarded.'
          : 'Entered Play Mode. Scene saves are disabled until Edit Mode is restored.';
      setStatusMessage(message);
      onBackendStatus('connected', message);
      return;
    }

    setMode('edit');
    const message = sceneSaved
      ? `Returned to Edit Mode for scene ${sceneSaved.name}.`
      : 'Returned to Edit Mode.';
    setStatusMessage(message);
    onBackendStatus('connected', message);
  }

  function updateSceneDraft(nextScene: SceneAssetDocument) {
    commitDraft({
      scene: cloneSceneDocument(nextScene),
      prefab:
        selectedNode === 'scene'
          ? clonePrefabDocument(findPrefabByName(nextScene.primaryPrefab) || prefabDraft)
          : clonePrefabDocument(prefabDraft),
    });
  }

  function updatePrefabDraft(nextPrefab: PrefabAssetDocument) {
    commitDraft({
      scene: cloneSceneDocument(sceneDraft),
      prefab: clonePrefabDocument(nextPrefab),
    });
  }

  function inspectPrefab(document: PrefabAssetDocument) {
    overwriteCurrentSnapshot({
      scene: cloneSceneDocument(sceneDraft),
      prefab: clonePrefabDocument(document),
    });
    setPrefabSaved(document);
    setSelectedNode('prefab');
    setStatusMessage(`Inspecting prefab ${document.name}.`);
  }

  function selectPrimaryPrefab(document: PrefabAssetDocument) {
    if (!sceneDraft || !canEdit) {
      return;
    }
    updateSceneDraft({
      ...sceneDraft,
      primaryPrefab: document.name,
    });
    setSelectedNode('scene');
    setStatusMessage(`Primary prefab for ${sceneDraft.name} set to ${document.name}.`);
  }

  async function handleSaveScene() {
    if (!activeSession || !sceneDraft || !canEdit) {
      return;
    }

    setBusy(true);
    try {
      const savedPayload = await writeFile(
        activeSession.id,
        sceneDraft.path,
        formatSceneAssetDocument(sceneDraft),
      );
      const nextScene = parseSceneAssetDocument(savedPayload);
      setSceneSaved(nextScene);
      setSceneDocuments((current) =>
        sortScenes([...current.filter((document) => document.path !== nextScene.path), nextScene]),
      );
      setSelectedScenePath(nextScene.path);
      overwriteCurrentSnapshot({
        scene: cloneSceneDocument(nextScene),
        prefab: clonePrefabDocument(prefabDraft),
      });
      setStatusMessage(`Saved scene ${nextScene.name} to ${nextScene.path}.`);
      onLaunchSceneChange(nextScene.name);
      onBackendStatus('connected', `Saved scene ${nextScene.name}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusMessage(message);
      onBackendStatus('offline', message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSavePrefab() {
    if (!activeSession || !prefabDraft || !canEdit) {
      return;
    }

    setBusy(true);
    try {
      const savedPayload = await writeFile(
        activeSession.id,
        prefabDraft.path,
        formatPrefabAssetDocument(prefabDraft),
      );
      const nextPrefab = parsePrefabAssetDocument(savedPayload);
      setPrefabSaved(nextPrefab);
      setPrefabDocuments((current) =>
        sortPrefabs([...current.filter((document) => document.path !== nextPrefab.path), nextPrefab]),
      );
      overwriteCurrentSnapshot({
        scene: cloneSceneDocument(sceneDraft),
        prefab: clonePrefabDocument(nextPrefab),
      });
      setStatusMessage(`Saved prefab ${nextPrefab.name} to ${nextPrefab.path}.`);
      onBackendStatus('connected', `Saved prefab ${nextPrefab.name}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusMessage(message);
      onBackendStatus('offline', message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateScene() {
    if (!activeSession || !canEdit) {
      return;
    }

    const sanitizedName = sanitizeAssetName(newSceneName);
    if (!sanitizedName) {
      setStatusMessage('Enter a scene name before creating a new scene.');
      return;
    }

    const nextPath = buildSceneAssetPath(sanitizedName);
    if (sceneDocuments.some((document) => document.path === nextPath)) {
      setStatusMessage(`A scene already exists at ${nextPath}.`);
      return;
    }

    const primaryPrefab = scenePrimaryPrefab?.name || prefabDocuments[0]?.name || '';
    const nextScene = createSceneAssetDocument(newSceneName, primaryPrefab);

    setBusy(true);
    try {
      const savedPayload = await writeFile(
        activeSession.id,
        nextScene.path,
        formatSceneAssetDocument(nextScene),
      );
      const createdScene = parseSceneAssetDocument(savedPayload);
      const nextScenes = sortScenes([...sceneDocuments, createdScene]);
      setSceneDocuments(nextScenes);
      setNewSceneName('');
      openSceneDocument(createdScene);
      setStatusMessage(`Created scene ${createdScene.name}.`);
      onBackendStatus('connected', `Created scene ${createdScene.name}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusMessage(message);
      onBackendStatus('offline', message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDuplicateScene() {
    if (!activeSession || !sceneDraft || !canEdit) {
      return;
    }

    const sanitizedName = sanitizeAssetName(duplicateSceneName);
    if (!sanitizedName) {
      setStatusMessage('Enter a duplicate scene name before duplicating the active scene.');
      return;
    }

    const duplicateDocument = cloneSceneForDuplicate(sceneDraft, duplicateSceneName);
    if (sceneDocuments.some((document) => document.path === duplicateDocument.path)) {
      setStatusMessage(`A scene already exists at ${duplicateDocument.path}.`);
      return;
    }

    setBusy(true);
    try {
      const savedPayload = await writeFile(
        activeSession.id,
        duplicateDocument.path,
        formatSceneAssetDocument(duplicateDocument),
      );
      const nextScene = parseSceneAssetDocument(savedPayload);
      setSceneDocuments((current) => sortScenes([...current, nextScene]));
      openSceneDocument(nextScene);
      setStatusMessage(`Duplicated scene ${sceneDraft.name} into ${nextScene.name}.`);
      onBackendStatus('connected', `Duplicated scene ${sceneDraft.name} into ${nextScene.name}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatusMessage(message);
      onBackendStatus('offline', message);
    } finally {
      setBusy(false);
    }
  }

  function handleRevertDrafts() {
    resetDrafts(sceneSaved, prefabSaved);
    setSelectedNode('scene');
    const message = sceneSaved
      ? `Reverted unsaved edits for ${sceneSaved.name}.`
      : 'Reverted unsaved edits.';
    setStatusMessage(message);
    onBackendStatus('connected', message);
  }

  function handleUndo() {
    if (!canUndo) {
      return;
    }
    setHistoryIndex((current) => Math.max(0, current - 1));
    setStatusMessage('Undid the last scene authoring change.');
  }

  function handleRedo() {
    if (!canRedo) {
      return;
    }
    setHistoryIndex((current) => Math.min(history.length - 1, current + 1));
    setStatusMessage('Redid the last scene authoring change.');
  }

  if (!activeSession) {
    return (
      <div className="workspace-layout workspace-layout--scene">
        <section className="surface">
          <div className="surface-header">
            <div>
              <div className="surface-eyebrow">Authoring</div>
              <h2>Scene Editor</h2>
              <p>Select a session to load text-backed scene and prefab assets.</p>
            </div>
          </div>
          <div className="scene-empty-state">
            `Scene` authoring is session-backed. Create or select a session in the left rail first.
          </div>
        </section>
        <section className="surface">
          <div className="scene-empty-state">
            World outliner, details, and asset panels appear once a workspace session is active.
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="workspace-layout workspace-layout--scene">
      <section className="surface">
        <div className="surface-header">
          <div>
            <div className="surface-eyebrow">Authoring</div>
            <h2>Scene Editor</h2>
            <p>
              Repo-backed `content/scenes/*.scene.toml` and `content/prefabs/*.prefab.toml`
              authoring with deterministic save, duplicate, and reload flows.
            </p>
          </div>
          <div className="inline-actions">
            <button
              className={`ghost-button ghost-button--sm${mode === 'edit' ? ' ghost-button--primary' : ''}`}
              onClick={() => handleModeChange('edit')}
              type="button"
            >
              Edit Mode
            </button>
            <button
              className={`ghost-button ghost-button--sm${mode === 'play' ? ' ghost-button--primary' : ''}`}
              onClick={() => handleModeChange('play')}
              type="button"
            >
              Play Mode
            </button>
          </div>
        </div>

        <div className="scene-toolbar">
          <div className="scene-toolbar__group">
            <button
              className="ghost-button ghost-button--sm ghost-button--primary"
              disabled={!sceneDraft || !sceneDirty || busy || !canEdit}
              onClick={() => void handleSaveScene()}
              type="button"
            >
              Save Scene
            </button>
            <button
              className="ghost-button ghost-button--sm"
              disabled={!prefabDraft || !prefabDirty || busy || !canEdit}
              onClick={() => void handleSavePrefab()}
              type="button"
            >
              Save Prefab
            </button>
            <button
              className="ghost-button ghost-button--sm"
              disabled={busy || (!sceneDirty && !prefabDirty)}
              onClick={handleRevertDrafts}
              type="button"
            >
              Revert Drafts
            </button>
            <button
              className="ghost-button ghost-button--sm"
              disabled={busy}
              onClick={() => void reloadFromDisk()}
              type="button"
            >
              Reload From Disk
            </button>
          </div>
          <div className="scene-toolbar__group">
            <button
              className="ghost-button ghost-button--sm"
              disabled={!canUndo || busy || !canEdit}
              onClick={handleUndo}
              type="button"
            >
              Undo
            </button>
            <button
              className="ghost-button ghost-button--sm"
              disabled={!canRedo || busy || !canEdit}
              onClick={handleRedo}
              type="button"
            >
              Redo
            </button>
          </div>
        </div>

        <div className="scene-authoring-grid">
          <article className="scene-card scene-card--viewport">
            <div className="scene-card__header">
              <div>
                <span>Scene viewport</span>
                <strong>{sceneDraft?.title || sceneDraft?.name || 'No scene selected'}</strong>
              </div>
              <div className="scene-status-pills">
                <span className={`scene-status-pill scene-status-pill--${mode}`}>
                  {toSceneStatusLabel(mode)}
                </span>
                <span className="scene-status-pill">{busy ? 'Syncing' : 'Ready'}</span>
              </div>
            </div>
            <div className="scene-viewport">
              <div className="scene-viewport__label">
                <strong>{sceneDraft?.name || 'no-scene'}</strong>
                <span>{sceneDraft?.path || 'content/scenes/*.scene.toml'}</span>
              </div>
              <div className="scene-viewport__axes scene-viewport__axes--horizontal" />
              <div className="scene-viewport__axes scene-viewport__axes--vertical" />
              <div className="scene-viewport__summary">
                <div>
                  <span>Launch target</span>
                  <strong>{launchScene}</strong>
                </div>
                <div>
                  <span>Runtime</span>
                  <strong>{runtimeStatus.state}</strong>
                </div>
                <div>
                  <span>Primary prefab</span>
                  <strong>{sceneDraft?.primaryPrefab || 'unassigned'}</strong>
                </div>
              </div>
            </div>
            <div className="scene-note">
              Transform gizmos and in-viewport manipulation are still ahead. This slice makes the
              `Scene` workspace a real text-asset authoring lane now.
            </div>
          </article>

          <article className="scene-card">
            <div className="scene-card__header">
              <div>
                <span>Scene assets</span>
                <strong>{sceneDocuments.length ? `${sceneDocuments.length} scene files` : 'No scenes yet'}</strong>
              </div>
              <span>{activeSession.rootPath}</span>
            </div>
            <div className="scene-list">
              {sceneDocuments.length ? (
                sceneDocuments.map((document) => (
                  <button
                    className={`scene-list__item${selectedScenePath === document.path ? ' is-active' : ''}`}
                    key={document.path}
                    onClick={() => openSceneDocument(document, prefabDocuments, mode)}
                    type="button"
                  >
                    <strong>{document.title}</strong>
                    <span>{document.name}</span>
                    <em>{document.path}</em>
                  </button>
                ))
              ) : (
                <div className="scene-empty-state scene-empty-state--compact">
                  Create the first scene asset below.
                </div>
              )}
            </div>

            <div className="scene-form-block">
              <label className="form-field">
                <span>New scene name</span>
                <input
                  disabled={!canEdit || busy}
                  onChange={(event) => setNewSceneName(event.target.value)}
                  placeholder="prototype_arena"
                  type="text"
                  value={newSceneName}
                />
              </label>
              <button
                className="ghost-button ghost-button--sm ghost-button--primary"
                disabled={!canEdit || busy}
                onClick={() => void handleCreateScene()}
                type="button"
              >
                Create Scene
              </button>
            </div>

            <div className="scene-form-block">
              <label className="form-field">
                <span>Duplicate active scene as</span>
                <input
                  disabled={!sceneDraft || !canEdit || busy}
                  onChange={(event) => setDuplicateSceneName(event.target.value)}
                  placeholder="sandbox_copy"
                  type="text"
                  value={duplicateSceneName}
                />
              </label>
              <button
                className="ghost-button ghost-button--sm"
                disabled={!sceneDraft || !canEdit || busy}
                onClick={() => void handleDuplicateScene()}
                type="button"
              >
                Duplicate Scene
              </button>
            </div>
          </article>
        </div>

        <div className="scene-metric-grid">
          <article className="mini-card">
            <span>Mode</span>
            <strong>{toSceneStatusLabel(mode)}</strong>
            <p>{mode === 'edit' ? 'Persistent authoring writes are enabled.' : 'Discard-only runtime preview stance.'}</p>
          </article>
          <article className="mini-card">
            <span>Dirty state</span>
            <strong>{sceneDirty || prefabDirty ? 'Unsaved changes' : 'Clean'}</strong>
            <p>{sceneDirty ? 'Scene draft differs from disk.' : prefabDirty ? 'Prefab draft differs from disk.' : 'Draft matches the last disk load or save.'}</p>
          </article>
          <article className="mini-card">
            <span>Scene files</span>
            <strong>{sceneDocuments.length}</strong>
            <p>`content/scenes/*.scene.toml` is the current authoring root.</p>
          </article>
          <article className="mini-card">
            <span>Prefab files</span>
            <strong>{prefabDocuments.length}</strong>
            <p>`content/prefabs/*.prefab.toml` is the current prefab authoring root.</p>
          </article>
        </div>
      </section>

      <section className="surface">
        <div className="surface-header">
          <div>
            <div className="surface-eyebrow">Level Tools</div>
            <h2>Outliner, Details, And Assets</h2>
            <p>Shell-side level authoring now round-trips to the same text assets used by the runtime and future native tools.</p>
          </div>
        </div>

        <div className="scene-side-grid">
          <article className="scene-card">
            <div className="scene-card__header">
              <div>
                <span>World outliner</span>
                <strong>{sceneDraft?.name || 'No scene selected'}</strong>
              </div>
              <span>{selectedNode === 'scene' ? 'scene' : 'prefab'}</span>
            </div>
            {sceneDraft ? (
              <div className="scene-tree">
                <button
                  className={`scene-tree__node${selectedNode === 'scene' ? ' is-active' : ''}`}
                  onClick={() => setSelectedNode('scene')}
                  type="button"
                >
                  <strong>{sceneDraft.title}</strong>
                  <span>{sceneDraft.path}</span>
                </button>
                <button
                  className={`scene-tree__node${selectedNode === 'prefab' ? ' is-active' : ''}`}
                  disabled={!scenePrimaryPrefab}
                  onClick={() => {
                    if (scenePrimaryPrefab) {
                      inspectPrefab(scenePrimaryPrefab);
                    }
                  }}
                  type="button"
                >
                  <strong>{sceneDraft.primaryPrefab || 'No primary prefab'}</strong>
                  <span>{scenePrimaryPrefab?.path || 'Assign a prefab from Assets.'}</span>
                </button>
              </div>
            ) : (
              <div className="scene-empty-state scene-empty-state--compact">
                Open a scene to inspect its authoring nodes.
              </div>
            )}
          </article>

          <article className="scene-card">
            <div className="scene-card__header">
              <div>
                <span>Details</span>
                <strong>{selectedNode === 'scene' ? 'Scene asset' : 'Prefab asset'}</strong>
              </div>
              <span>{selectedNode === 'scene' ? sceneDraft?.path || 'none' : prefabDraft?.path || 'none'}</span>
            </div>

            {selectedNode === 'scene' && sceneDraft ? (
              <div className="scene-details">
                <label className="form-field">
                  <span>Scene name</span>
                  <input disabled type="text" value={sceneDraft.name} />
                </label>
                <label className="form-field">
                  <span>Scene title</span>
                  <input
                    disabled={!canEdit || busy}
                    onChange={(event) =>
                      updateSceneDraft({
                        ...sceneDraft,
                        title: event.target.value,
                      })
                    }
                    type="text"
                    value={sceneDraft.title}
                  />
                </label>
                <label className="form-field">
                  <span>Primary prefab</span>
                  <select
                    disabled={!canEdit || busy || !prefabDocuments.length}
                    onChange={(event) => {
                      const nextPrefabName = event.target.value;
                      updateSceneDraft({
                        ...sceneDraft,
                        primaryPrefab: nextPrefabName,
                      });
                    }}
                    value={sceneDraft.primaryPrefab}
                  >
                    {prefabDocuments.length ? null : <option value="">No prefabs available</option>}
                    {prefabDocuments.map((document) => (
                      <option key={document.path} value={document.name}>
                        {document.name}
                      </option>
                    ))}
                  </select>
                </label>
                <dl className="fact-list">
                  <div>
                    <dt>Schema</dt>
                    <dd>{sceneDraft.schema}</dd>
                  </div>
                  <div>
                    <dt>Runtime</dt>
                    <dd>{sceneDraft.runtimeFormat}</dd>
                  </div>
                  <div>
                    <dt>Modified</dt>
                    <dd>{sceneSaved?.modifiedAt || 'not saved yet'}</dd>
                  </div>
                </dl>
              </div>
            ) : null}

            {selectedNode === 'prefab' && prefabDraft ? (
              <div className="scene-details">
                <label className="form-field">
                  <span>Prefab name</span>
                  <input disabled type="text" value={prefabDraft.name} />
                </label>
                <label className="form-field">
                  <span>Category</span>
                  <input
                    disabled={!canEdit || busy}
                    onChange={(event) =>
                      updatePrefabDraft({
                        ...prefabDraft,
                        category: event.target.value,
                      })
                    }
                    type="text"
                    value={prefabDraft.category}
                  />
                </label>
                <label className="form-field">
                  <span>Spawn tag</span>
                  <input
                    disabled={!canEdit || busy}
                    onChange={(event) =>
                      updatePrefabDraft({
                        ...prefabDraft,
                        spawnTag: event.target.value,
                      })
                    }
                    type="text"
                    value={prefabDraft.spawnTag}
                  />
                </label>
                <dl className="fact-list">
                  <div>
                    <dt>Schema</dt>
                    <dd>{prefabDraft.schema}</dd>
                  </div>
                  <div>
                    <dt>Runtime</dt>
                    <dd>{prefabDraft.runtimeFormat}</dd>
                  </div>
                  <div>
                    <dt>Modified</dt>
                    <dd>{prefabSaved?.modifiedAt || 'not saved yet'}</dd>
                  </div>
                </dl>
              </div>
            ) : null}

            {selectedNode === 'prefab' && !prefabDraft ? (
              <div className="scene-empty-state scene-empty-state--compact">
                Select a prefab from the outliner or asset browser to inspect it.
              </div>
            ) : null}
          </article>

          <article className="scene-card">
            <div className="scene-card__header">
              <div>
                <span>Assets</span>
                <strong>{prefabDocuments.length ? `${prefabDocuments.length} prefabs` : 'No prefabs yet'}</strong>
              </div>
              <span>{sceneDraft?.primaryPrefab || 'unassigned'}</span>
            </div>
            <div className="scene-asset-list">
              {prefabDocuments.length ? (
                prefabDocuments.map((document) => (
                  <div className="scene-asset" key={document.path}>
                    <button
                      className={`scene-asset__main${prefabDraft?.path === document.path ? ' is-active' : ''}`}
                      onClick={() => inspectPrefab(document)}
                      type="button"
                    >
                      <strong>{document.name}</strong>
                      <span>{document.category}</span>
                    </button>
                    <button
                      className="ghost-button ghost-button--sm"
                      disabled={!sceneDraft || !canEdit || busy}
                      onClick={() => selectPrimaryPrefab(document)}
                      type="button"
                    >
                      {sceneDraft?.primaryPrefab === document.name ? 'Primary' : 'Use As Primary'}
                    </button>
                  </div>
                ))
              ) : (
                <div className="scene-empty-state scene-empty-state--compact">
                  Add prefab assets under `content/prefabs` to widen the scene authoring lane.
                </div>
              )}
            </div>
          </article>

          <article className="scene-card">
            <div className="scene-card__header">
              <div>
                <span>Authoring status</span>
                <strong>{busy ? 'Working' : 'Idle'}</strong>
              </div>
              <span>{activeSession.name}</span>
            </div>
            <div className="scene-status-block">
              <strong>{statusMessage}</strong>
              <p>
                Current authoring roots: `content/scenes`, `content/prefabs`. Play Mode is
                intentionally discard-only in this slice so runtime actions cannot overwrite source
                assets silently.
              </p>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}
