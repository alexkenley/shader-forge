import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import {
  type BuildStatus,
  listFiles,
  readFile,
  writeFile,
  type EngineSession,
  type RuntimeStatus,
} from './lib/sessiond';
import {
  buildSceneAssetPath,
  cloneSceneEntityForDuplicate,
  cloneSceneForDuplicate,
  createSceneAssetDocument,
  createSceneEntityDocument,
  formatPrefabAssetDocument,
  formatSceneAssetDocument,
  parsePrefabAssetDocument,
  parseSceneAssetDocument,
  sanitizeAssetName,
  sanitizeSceneEntityId,
  type PrefabAssetDocument,
  type SceneAssetDocument,
  type SceneEntityDocument,
  type Vector3Value,
} from './scene-authoring';

type BackendState = 'connected' | 'offline';
type EditorMode = 'edit' | 'play';
type SelectionNode = 'scene' | 'prefab' | 'entity';
type SceneSidebarTab = 'scenes' | 'outliner' | 'inspector' | 'assets';
type EditorSnapshot = {
  scene: SceneAssetDocument | null;
  prefab: PrefabAssetDocument | null;
};
type SceneTreeRow = {
  entity: SceneEntityDocument;
  depth: number;
};

type SceneEditorViewProps = {
  activeSession: EngineSession | null;
  buildStatus: BuildStatus;
  launchScene: string;
  nativeRuntimeHint: string;
  onBuildAndRun: () => void;
  runtimeStatus: RuntimeStatus;
  onLaunchSceneChange: (value: string) => void;
  onBackendStatus: (state: BackendState, message: string) => void;
  onRestartRuntime: () => void;
  onRunScene: () => void;
  onStopRuntime: () => void;
};

const emptySnapshot: EditorSnapshot = {
  scene: null,
  prefab: null,
};
const DEFAULT_SCENE_SIDEBAR_WIDTH = 380;
const MIN_SCENE_SIDEBAR_WIDTH = 300;
const MAX_SCENE_SIDEBAR_WIDTH = 540;

function clampSceneSidebarWidth(value: number) {
  return Math.max(MIN_SCENE_SIDEBAR_WIDTH, Math.min(MAX_SCENE_SIDEBAR_WIDTH, Math.round(value)));
}

function cloneSceneEntity(entity: SceneEntityDocument): SceneEntityDocument {
  return {
    ...entity,
    position: [...entity.position] as Vector3Value,
    rotation: [...entity.rotation] as Vector3Value,
    scale: [...entity.scale] as Vector3Value,
  };
}

function cloneSceneDocument(document: SceneAssetDocument | null) {
  return document
    ? {
        ...document,
        entities: document.entities.map(cloneSceneEntity),
      }
    : null;
}

function clonePrefabDocument(document: PrefabAssetDocument | null) {
  return document
    ? {
        ...document,
        renderComponent: { ...document.renderComponent },
        effectComponent: { ...document.effectComponent },
      }
    : null;
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
  return mode === 'edit' ? 'Authoring' : 'Review';
}

function formatDisplayNameFromToken(value: string) {
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ');
}

function ensureUniqueEntityId(entities: SceneEntityDocument[], preferredId: string) {
  const normalized = sanitizeSceneEntityId(preferredId) || 'entity';
  const existing = new Set(entities.map((entity) => entity.id));
  if (!existing.has(normalized)) {
    return normalized;
  }
  let suffix = 2;
  while (existing.has(`${normalized}_${suffix}`)) {
    suffix += 1;
  }
  return `${normalized}_${suffix}`;
}

function buildSceneTreeRows(scene: SceneAssetDocument): SceneTreeRow[] {
  const rows: SceneTreeRow[] = [];
  const visited = new Set<string>();
  const childrenByParent = new Map<string, SceneEntityDocument[]>();

  for (const entity of scene.entities) {
    const parentKey = entity.parent || '';
    const current = childrenByParent.get(parentKey) || [];
    current.push(entity);
    childrenByParent.set(parentKey, current);
  }

  for (const list of childrenByParent.values()) {
    list.sort((left, right) =>
      `${left.displayName}\0${left.id}`.localeCompare(`${right.displayName}\0${right.id}`),
    );
  }

  function visit(parentId: string, depth: number) {
    for (const entity of childrenByParent.get(parentId) || []) {
      if (visited.has(entity.id)) {
        continue;
      }
      visited.add(entity.id);
      rows.push({ entity, depth });
      visit(entity.id, depth + 1);
    }
  }

  visit('', 0);

  for (const entity of scene.entities) {
    if (visited.has(entity.id)) {
      continue;
    }
    visited.add(entity.id);
    rows.push({ entity, depth: 0 });
    visit(entity.id, 1);
  }

  return rows;
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

function Vector3Editor({
  disabled,
  label,
  value,
  onChange,
}: {
  disabled: boolean;
  label: string;
  value: Vector3Value;
  onChange: (value: Vector3Value) => void;
}) {
  function updateIndex(index: number, rawValue: string) {
    const parsed = Number.parseFloat(rawValue);
    onChange([
      index === 0 ? (Number.isFinite(parsed) ? parsed : 0) : value[0],
      index === 1 ? (Number.isFinite(parsed) ? parsed : 0) : value[1],
      index === 2 ? (Number.isFinite(parsed) ? parsed : 0) : value[2],
    ]);
  }

  return (
    <div className="scene-vector-field">
      <span>{label}</span>
      <div className="scene-vector-grid">
        {(['X', 'Y', 'Z'] as const).map((axis, index) => (
          <label className="scene-vector-grid__axis" key={axis}>
            <span>{axis}</span>
            <input
              disabled={disabled}
              onChange={(event) => updateIndex(index, event.target.value)}
              step="0.1"
              type="number"
              value={value[index]}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

export function SceneEditorView({
  activeSession,
  buildStatus,
  launchScene,
  nativeRuntimeHint,
  onBuildAndRun,
  runtimeStatus,
  onLaunchSceneChange,
  onBackendStatus,
  onRestartRuntime,
  onRunScene,
  onStopRuntime,
}: SceneEditorViewProps) {
  const sceneShellRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<EditorMode>('edit');
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Select a session to load scene authoring assets.');
  const [sceneDocuments, setSceneDocuments] = useState<SceneAssetDocument[]>([]);
  const [prefabDocuments, setPrefabDocuments] = useState<PrefabAssetDocument[]>([]);
  const [selectedScenePath, setSelectedScenePath] = useState('');
  const [selectedNode, setSelectedNode] = useState<SelectionNode>('scene');
  const [selectedEntityId, setSelectedEntityId] = useState('');
  const [sceneSaved, setSceneSaved] = useState<SceneAssetDocument | null>(null);
  const [prefabSaved, setPrefabSaved] = useState<PrefabAssetDocument | null>(null);
  const [history, setHistory] = useState<EditorSnapshot[]>([cloneSnapshot(emptySnapshot)]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [newSceneName, setNewSceneName] = useState('');
  const [duplicateSceneName, setDuplicateSceneName] = useState('');
  const [activeSidebarTab, setActiveSidebarTab] = useState<SceneSidebarTab>('outliner');
  const [sceneSidebarWidth, setSceneSidebarWidth] = useState(DEFAULT_SCENE_SIDEBAR_WIDTH);
  const [sceneSidebarResizing, setSceneSidebarResizing] = useState(false);

  const currentSnapshot = history[historyIndex] || emptySnapshot;
  const sceneDraft = currentSnapshot.scene;
  const prefabDraft = currentSnapshot.prefab;
  const selectedEntity =
    sceneDraft?.entities.find((entity) => entity.id === selectedEntityId) || null;
  const sceneTreeRows = useMemo(
    () => (sceneDraft ? buildSceneTreeRows(sceneDraft) : []),
    [sceneDraft],
  );
  const rootEntityCount = useMemo(
    () => (sceneDraft ? sceneDraft.entities.filter((entity) => !entity.parent).length : 0),
    [sceneDraft],
  );
  const scenePrimaryPrefab =
    prefabDocuments.find((document) => document.name === sceneDraft?.primaryPrefab) || null;

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

  useEffect(() => {
    if (!sceneSidebarResizing) {
      return;
    }

    const handlePointerMove = (event: PointerEvent) => {
      event.preventDefault();
      const shellBounds = sceneShellRef.current?.getBoundingClientRect();
      const nextWidth = shellBounds ? shellBounds.right - event.clientX : window.innerWidth - event.clientX;
      setSceneSidebarWidth(clampSceneSidebarWidth(nextWidth));
    };

    const stopResize = () => {
      setSceneSidebarResizing(false);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
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
  }, [sceneSidebarResizing]);

  useEffect(() => {
    if (!sceneDraft) {
      setActiveSidebarTab('scenes');
    }
  }, [sceneDraft]);

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

  function setSceneSelection() {
    setSelectedNode('scene');
    setSelectedEntityId('');
    setActiveSidebarTab('inspector');
  }

  function setEntitySelection(entityId: string) {
    setSelectedNode('entity');
    setSelectedEntityId(entityId);
    setActiveSidebarTab('inspector');
  }

  function handleSceneSidebarResizeStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    setSceneSidebarResizing(true);
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
    setMode(nextMode);
    resetDrafts(nextScene, matchedPrefab);
    setSceneSelection();
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
        setSceneSelection();
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
          setSceneSelection();
          resetDrafts(null, null);
          setStatusMessage('No `.scene.toml` files found under `content/scenes` for this session.');
          onBackendStatus(
            'connected',
            `Loaded authoring session ${activeSession.name}, but no scene assets were found.`,
          );
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
        setSceneSelection();
        resetDrafts(null, null);
        setStatusMessage('Reloaded from disk. No scene assets remain in `content/scenes`.');
        onBackendStatus('connected', 'Reloaded scene authoring data from disk.');
        return;
      }

      const preferredScene =
        nextScenes.find((document) => document.path === selectedScenePath) ||
        nextScenes.find((document) => document.name === launchScene) ||
        nextScenes[0];
      const matchedPrefab = findPrefabByName(preferredScene.primaryPrefab, nextPrefabs);
      setSelectedScenePath(preferredScene.path);
      setSceneSaved(preferredScene);
      setPrefabSaved(matchedPrefab);
      resetDrafts(preferredScene, matchedPrefab);
      setSceneSelection();
      setStatusMessage(`Reloaded scene ${preferredScene.name} from disk.`);
      onLaunchSceneChange(preferredScene.name);
      onBackendStatus('connected', `Reloaded scene ${preferredScene.name} from disk.`);
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
      setSceneSelection();
      const message =
        sceneDirty || prefabDirty
          ? 'Entered Review. Unsaved authoring edits were discarded.'
          : 'Entered Review. Scene saves are disabled until Authoring is restored.';
      setStatusMessage(message);
      onBackendStatus('connected', message);
      return;
    }

    setMode('edit');
    const message = sceneSaved
      ? `Returned to Authoring for scene ${sceneSaved.name}.`
      : 'Returned to Authoring.';
    setStatusMessage(message);
    onBackendStatus('connected', message);
  }

  function updateSceneDraft(nextScene: SceneAssetDocument) {
    commitDraft({
      scene: cloneSceneDocument(nextScene),
      prefab: clonePrefabDocument(prefabDraft),
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
    setActiveSidebarTab('inspector');
    setStatusMessage(`Inspecting prefab ${document.name}.`);
  }

  function updateSelectedEntity(updater: (entity: SceneEntityDocument) => SceneEntityDocument) {
    if (!sceneDraft || !selectedEntity || !canEdit) {
      return;
    }
    const nextEntities = sceneDraft.entities.map((entity) =>
      entity.id === selectedEntity.id ? updater(entity) : entity,
    );
    updateSceneDraft({
      ...sceneDraft,
      entities: nextEntities,
    });
  }

  function selectPrimaryPrefab(document: PrefabAssetDocument) {
    if (!sceneDraft || !canEdit) {
      return;
    }
    updateSceneDraft({
      ...sceneDraft,
      primaryPrefab: document.name,
    });
    setSceneSelection();
    setStatusMessage(`Primary prefab for ${sceneDraft.name} set to ${document.name}.`);
  }

  function instantiatePrefab(document: PrefabAssetDocument, preferredName = '') {
    if (!sceneDraft || !canEdit) {
      return;
    }

    const baseName = preferredName.trim() || `${formatDisplayNameFromToken(document.name)} Instance`;
    const nextId = ensureUniqueEntityId(sceneDraft.entities, preferredName || `${document.name}_instance`);
    const nextEntity = createSceneEntityDocument(baseName, document.name, nextId);
    const nextScene = {
      ...sceneDraft,
      entities: [...sceneDraft.entities, nextEntity],
    };
    updateSceneDraft(nextScene);
    setEntitySelection(nextEntity.id);
    setStatusMessage(`Added entity ${nextEntity.id} from prefab ${document.name}.`);
  }

  function duplicateSelectedEntity() {
    if (!sceneDraft || !selectedEntity || !canEdit) {
      return;
    }

    const duplicate = cloneSceneEntityForDuplicate(selectedEntity, `${selectedEntity.id}_copy`);
    duplicate.id = ensureUniqueEntityId(sceneDraft.entities, duplicate.id);
    duplicate.displayName = `${selectedEntity.displayName} Copy`;
    const nextScene = {
      ...sceneDraft,
      entities: [...sceneDraft.entities, duplicate],
    };
    updateSceneDraft(nextScene);
    setEntitySelection(duplicate.id);
    setStatusMessage(`Duplicated entity ${selectedEntity.id} into ${duplicate.id}.`);
  }

  function deleteSelectedEntity() {
    if (!sceneDraft || !selectedEntity || !canEdit) {
      return;
    }

    const nextEntities = sceneDraft.entities
      .filter((entity) => entity.id !== selectedEntity.id)
      .map((entity) =>
        entity.parent === selectedEntity.id
          ? {
              ...entity,
              parent: selectedEntity.parent,
            }
          : entity,
      );
    updateSceneDraft({
      ...sceneDraft,
      entities: nextEntities,
    });
    setSceneSelection();
    setStatusMessage(`Deleted entity ${selectedEntity.id}.`);
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
      if (selectedEntityId && !nextScene.entities.some((entity) => entity.id === selectedEntityId)) {
        setSceneSelection();
      }
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
    setSceneSelection();
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

  const dirtyStateLabel = sceneDirty || prefabDirty ? 'Unsaved' : 'Clean';
  const dirtyStateDetail = sceneDirty
    ? 'Scene draft differs from disk.'
    : prefabDirty
      ? 'Prefab draft differs from disk.'
      : 'Draft matches the last disk load or save.';
  const selectionInspectorLabel =
    selectedNode === 'scene'
      ? 'Scene asset'
      : selectedNode === 'entity'
        ? 'Placed entity'
        : 'Prefab asset';
  const runSceneName = sceneDraft?.name || launchScene;
  const runSceneTitle = sceneDraft?.title || sceneDraft?.name || 'No scene selected';
  const canRunScene = Boolean(sceneDraft) && buildStatus.state !== 'running' && runtimeStatus.state === 'stopped';
  const canRestartRuntime = buildStatus.state !== 'running' && runtimeStatus.state !== 'stopped';
  const canStopRuntime = buildStatus.state !== 'running' && runtimeStatus.state !== 'stopped';
  const buildRequiresCmake = /cmake is required/i.test(buildStatus.error || '');

  if (!activeSession) {
    return (
      <div className="workspace-layout workspace-layout--scene">
        <section className="surface">
          <div className="surface-header">
            <div>
              <div className="surface-eyebrow">Authoring</div>
              <h2>Scene / Level Editor</h2>
              <p>Select a workspace to load text-backed scene and prefab assets.</p>
            </div>
          </div>
          <div className="scene-empty-state">
            `Scene` authoring is workspace-backed. Create or select a workspace in the left rail first.
          </div>
        </section>
        <section className="surface">
          <div className="scene-empty-state">
            World outliner, details, asset placement, and transform panels appear once a workspace
            session is active.
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="workspace-layout workspace-layout--scene-editor">
      <section className="surface scene-workspace">
        <div className="scene-editor__topbar">
          <div className="scene-editor__identity">
            <div className="surface-eyebrow">Level Editor</div>
            <h2>{sceneDraft?.title || sceneDraft?.name || 'Scene Editor'}</h2>
            <p>
              Viewport-first scene authoring with a world outliner, selection inspector, and prefab
              asset browser beside it.
            </p>
          </div>
          <div className="scene-editor__toolbar-groups">
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
                Revert
              </button>
              <button
                className="ghost-button ghost-button--sm"
                disabled={busy}
                onClick={() => void reloadFromDisk()}
                type="button"
              >
                Reload
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
              <button
                className={`ghost-button ghost-button--sm${mode === 'edit' ? ' ghost-button--primary' : ''}`}
                onClick={() => handleModeChange('edit')}
                type="button"
              >
                Author
              </button>
              <button
                className={`ghost-button ghost-button--sm${mode === 'play' ? ' ghost-button--primary' : ''}`}
                onClick={() => handleModeChange('play')}
                type="button"
              >
                Review
              </button>
            </div>
          </div>
        </div>

        <div className="scene-run-strip">
          <div className="scene-run-strip__identity">
            <span className="surface-eyebrow">Test This Scene</span>
            <strong>{runSceneTitle}</strong>
            <p>Run the open level in the native runtime against the current workspace root.</p>
          </div>
          <div className="scene-run-strip__facts">
            <div>
              <span>Workspace</span>
              <strong>{activeSession.name}</strong>
            </div>
            <div>
              <span>Run scene</span>
              <strong>{runSceneName}</strong>
            </div>
            <div>
              <span>Runtime</span>
              <strong>{runtimeStatus.state}</strong>
            </div>
          </div>
          <div className="scene-run-strip__actions">
            <button
              className="ghost-button ghost-button--sm ghost-button--primary"
              disabled={!sceneDraft || buildStatus.state === 'running'}
              onClick={onBuildAndRun}
              type="button"
            >
              Build + Run
            </button>
            <button
              className="ghost-button ghost-button--sm"
              disabled={!canRunScene}
              onClick={onRunScene}
              type="button"
            >
              Run Scene
            </button>
            <button
              className="ghost-button ghost-button--sm"
              disabled={!canRestartRuntime}
              onClick={onRestartRuntime}
              type="button"
            >
              Restart Runtime
            </button>
            <button
              className="ghost-button ghost-button--sm"
              disabled={!canStopRuntime}
              onClick={onStopRuntime}
              type="button"
            >
              Stop Runtime
            </button>
          </div>
          {buildRequiresCmake ? (
            <div className="setup-hint setup-hint--scene">
              <strong>Build + Run needs CMake</strong>
              <span>
                The clean-start scripts now auto-detect common installs and export
                `SHADER_FORGE_CMAKE` when possible. If this still fails, install CMake or add it
                to PATH. If the runtime binary already exists under `build/runtime/bin`, use `Run
                Scene` instead.
              </span>
            </div>
          ) : null}
          {!buildRequiresCmake && nativeRuntimeHint ? (
            <div className="setup-hint setup-hint--scene">
              <strong>Native runtime dependencies missing</strong>
              <span>{nativeRuntimeHint}</span>
            </div>
          ) : null}
        </div>

        <div className="scene-editor__body" ref={sceneShellRef}>
          <div className="scene-editor__canvas-column">
            <article className="scene-card scene-card--viewport scene-card--viewport-expanded">
              <div className="scene-card__header">
                <div>
                  <span>Viewport</span>
                  <strong>{sceneDraft?.title || sceneDraft?.name || 'No scene selected'}</strong>
                </div>
                <div className="scene-status-pills">
                  <span className={`scene-status-pill scene-status-pill--${mode}`}>
                    {toSceneStatusLabel(mode)}
                  </span>
                  <span className="scene-status-pill">{busy ? 'Syncing' : dirtyStateLabel}</span>
                </div>
              </div>
              <div className="scene-viewport">
                <div className="scene-viewport__label">
                  <strong>{sceneDraft?.name || 'no-scene'}</strong>
                  <span>{sceneDraft?.path || 'content/scenes/*.scene.toml'}</span>
                </div>
                <div className="scene-viewport__focus">
                  {sceneDraft ? (
                    <>
                      <span className="scene-viewport__eyebrow">Proxy viewer</span>
                      <strong>{sceneDraft.title}</strong>
                      <p>
                        Scene equals level/world. Use the adjacent level tools to manage actors,
                        selection, transforms, and placed prefabs.
                      </p>
                    </>
                  ) : (
                    <>
                      <span className="scene-viewport__eyebrow">Scene = Level</span>
                      <strong>Create or open a scene to start authoring.</strong>
                      <p>
                        Prefabs are reusable assets. Scenes place those prefabs into the level or
                        world instance.
                      </p>
                    </>
                  )}
                </div>
                <div className="scene-viewport__axes scene-viewport__axes--horizontal" />
                <div className="scene-viewport__axes scene-viewport__axes--vertical" />
                <div className="scene-viewport__summary">
                  <div>
                    <span>Run scene</span>
                    <strong>{runSceneName}</strong>
                  </div>
                  <div>
                    <span>Runtime</span>
                    <strong>{runtimeStatus.state}</strong>
                  </div>
                  <div>
                    <span>Entities</span>
                    <strong>{sceneDraft?.entities.length || 0}</strong>
                  </div>
                  <div>
                    <span>Primary prefab</span>
                    <strong>{sceneDraft?.primaryPrefab || 'unassigned'}</strong>
                  </div>
                </div>
              </div>
            </article>

            <div className="scene-statusbar">
              <div className="scene-statusbar__message">
                <strong>{statusMessage}</strong>
                <span>
                  Use `Run Scene` above to launch the native runtime window. `F7` reloads authored
                  content there.
                </span>
              </div>
              <div className="scene-statusbar__tokens">
                <span className="scene-status-token">
                  <span>Mode</span>
                  <strong>{toSceneStatusLabel(mode)}</strong>
                </span>
                <span className="scene-status-token">
                  <span>Dirty</span>
                  <strong>{dirtyStateLabel}</strong>
                </span>
                <span className="scene-status-token">
                  <span>Entities</span>
                  <strong>{sceneDraft?.entities.length || 0}</strong>
                </span>
                <span className="scene-status-token">
                  <span>Roots</span>
                  <strong>{rootEntityCount}</strong>
                </span>
                <span className="scene-status-token">
                  <span>Runtime</span>
                  <strong>{runtimeStatus.state}</strong>
                </span>
                <span className="scene-status-token">
                  <span>Workspace</span>
                  <strong>{activeSession.name}</strong>
                </span>
              </div>
            </div>
          </div>

          <div
            aria-label="Resize level tools panel"
            className={`scene-editor__resize-handle${sceneSidebarResizing ? ' is-resizing' : ''}`}
            onPointerDown={handleSceneSidebarResizeStart}
            role="separator"
          />

          <aside
            className="scene-editor__sidebar"
            style={{ width: `${sceneSidebarWidth}px` }}
          >
            <div className="scene-editor__sidebar-header">
              <div>
                <div className="surface-eyebrow">Level Tools</div>
                <h2>World Outliner And Inspector</h2>
                <p>
                  Actors/entities, selection details, scene assets, and prefab placement all live
                  in this adjacent tool stack.
                </p>
              </div>
            </div>
            <div className="tab-row tab-row--scene-sidebar">
              <button
                className={`pill-button${activeSidebarTab === 'scenes' ? ' is-active' : ''}`}
                onClick={() => setActiveSidebarTab('scenes')}
                type="button"
              >
                Scenes
              </button>
              <button
                className={`pill-button${activeSidebarTab === 'outliner' ? ' is-active' : ''}`}
                onClick={() => setActiveSidebarTab('outliner')}
                type="button"
              >
                Outliner
              </button>
              <button
                className={`pill-button${activeSidebarTab === 'inspector' ? ' is-active' : ''}`}
                onClick={() => setActiveSidebarTab('inspector')}
                type="button"
              >
                Inspector
              </button>
              <button
                className={`pill-button${activeSidebarTab === 'assets' ? ' is-active' : ''}`}
                onClick={() => setActiveSidebarTab('assets')}
                type="button"
              >
                Assets
              </button>
            </div>

            <div className="scene-editor__sidebar-body">
              {activeSidebarTab === 'scenes' ? (
                <div className="scene-sidebar-panel">
                  <div className="scene-sidebar-panel__header">
                    <div>
                      <span>Scene Files</span>
                      <strong>{sceneDocuments.length ? `${sceneDocuments.length} scene files` : 'No scenes yet'}</strong>
                    </div>
                    <span>{sceneDraft?.path || activeSession.rootPath}</span>
                  </div>
                  {sceneDraft ? (
                    <div className="scene-selection-summary">
                      <div>
                        <span>Active scene</span>
                        <strong>{sceneDraft.title}</strong>
                      </div>
                      <div>
                        <span>Run scene</span>
                        <strong>{sceneDraft.name}</strong>
                      </div>
                      <div>
                        <span>Primary prefab</span>
                        <strong>{sceneDraft.primaryPrefab || 'unassigned'}</strong>
                      </div>
                      <div>
                        <span>Entities</span>
                        <strong>{sceneDraft.entities.length}</strong>
                      </div>
                    </div>
                  ) : (
                    <div className="scene-selection-summary scene-selection-summary--empty">
                      <div>
                        <span>Scene authoring</span>
                        <strong>Start with a level/world scene asset.</strong>
                      </div>
                      <p>Create a scene, then place prefabs and actors into it.</p>
                    </div>
                  )}
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
                        autoComplete="off"
                        disabled={!canEdit || busy}
                        onChange={(event) => setNewSceneName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void handleCreateScene();
                          }
                        }}
                        placeholder="prototype_arena"
                        spellCheck={false}
                        type="text"
                        value={newSceneName}
                      />
                    </label>
                    <p className="scene-form-help">
                      A scene is the authored level/world instance saved under `content/scenes`.
                    </p>
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
                        autoComplete="off"
                        disabled={!sceneDraft || !canEdit || busy}
                        onChange={(event) => setDuplicateSceneName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault();
                            void handleDuplicateScene();
                          }
                        }}
                        placeholder="sandbox_copy"
                        spellCheck={false}
                        type="text"
                        value={duplicateSceneName}
                      />
                    </label>
                    <p className="scene-form-help">
                      Copies the active scene asset and its current authored entity layout.
                    </p>
                    <button
                      className="ghost-button ghost-button--sm"
                      disabled={!sceneDraft || !canEdit || busy}
                      onClick={() => void handleDuplicateScene()}
                      type="button"
                    >
                      Duplicate Scene
                    </button>
                  </div>
                </div>
              ) : null}

              {activeSidebarTab === 'outliner' ? (
                <div className="scene-sidebar-panel">
                  <div className="scene-sidebar-panel__header">
                    <div>
                      <span>World Outliner</span>
                      <strong>{sceneDraft?.name || 'No scene selected'}</strong>
                    </div>
                    <span>{selectedNode}</span>
                  </div>
                  <div className="scene-outliner-actions">
                    <button
                      className="ghost-button ghost-button--sm"
                      disabled={!sceneDraft || !canEdit || busy || !prefabDocuments.length}
                      onClick={() => instantiatePrefab(scenePrimaryPrefab || prefabDocuments[0])}
                      type="button"
                    >
                      Add Entity
                    </button>
                    <button
                      className="ghost-button ghost-button--sm"
                      disabled={!selectedEntity || !canEdit || busy}
                      onClick={duplicateSelectedEntity}
                      type="button"
                    >
                      Duplicate
                    </button>
                    <button
                      className="ghost-button ghost-button--sm"
                      disabled={!selectedEntity || !canEdit || busy}
                      onClick={deleteSelectedEntity}
                      type="button"
                    >
                      Delete
                    </button>
                  </div>
                  {sceneDraft ? (
                    <div className="scene-tree scene-tree--fill">
                      <button
                        className={`scene-tree__node${selectedNode === 'scene' ? ' is-active' : ''}`}
                        onClick={setSceneSelection}
                        type="button"
                      >
                        <strong>{sceneDraft.title}</strong>
                        <span>{sceneDraft.path}</span>
                      </button>
                      {sceneTreeRows.map((row) => (
                        <button
                          className={`scene-tree__node${selectedNode === 'entity' && selectedEntityId === row.entity.id ? ' is-active' : ''}`}
                          key={row.entity.id}
                          onClick={() => setEntitySelection(row.entity.id)}
                          style={{ paddingLeft: `${10 + row.depth * 18}px` }}
                          type="button"
                        >
                          <strong>{row.entity.displayName}</strong>
                          <span>{row.entity.id} · prefab {row.entity.sourcePrefab}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="scene-empty-state scene-empty-state--compact">
                      Open a scene to inspect its authored actor/entity hierarchy.
                    </div>
                  )}
                </div>
              ) : null}

              {activeSidebarTab === 'inspector' ? (
                <div className="scene-sidebar-panel">
                  <div className="scene-sidebar-panel__header">
                    <div>
                      <span>Selection Inspector</span>
                      <strong>{selectionInspectorLabel}</strong>
                    </div>
                    <span>
                      {selectedNode === 'scene'
                        ? sceneDraft?.path || 'none'
                        : selectedNode === 'entity'
                          ? selectedEntity?.id || 'none'
                          : prefabDraft?.path || 'none'}
                    </span>
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
                            updateSceneDraft({
                              ...sceneDraft,
                              primaryPrefab: event.target.value,
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
                          <dt>Entities</dt>
                          <dd>{sceneDraft.entities.length}</dd>
                        </div>
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

                  {selectedNode === 'entity' && selectedEntity && sceneDraft ? (
                    <div className="scene-details">
                      <label className="form-field">
                        <span>Entity id</span>
                        <input disabled type="text" value={selectedEntity.id} />
                      </label>
                      <label className="form-field">
                        <span>Display name</span>
                        <input
                          disabled={!canEdit || busy}
                          onChange={(event) =>
                            updateSelectedEntity((entity) => ({
                              ...entity,
                              displayName: event.target.value,
                            }))
                          }
                          type="text"
                          value={selectedEntity.displayName}
                        />
                      </label>
                      <label className="form-field">
                        <span>Source prefab</span>
                        <select
                          disabled={!canEdit || busy || !prefabDocuments.length}
                          onChange={(event) =>
                            updateSelectedEntity((entity) => ({
                              ...entity,
                              sourcePrefab: event.target.value,
                            }))
                          }
                          value={selectedEntity.sourcePrefab}
                        >
                          {prefabDocuments.map((document) => (
                            <option key={document.path} value={document.name}>
                              {document.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="form-field">
                        <span>Parent</span>
                        <select
                          disabled={!canEdit || busy}
                          onChange={(event) =>
                            updateSelectedEntity((entity) => ({
                              ...entity,
                              parent: event.target.value,
                            }))
                          }
                          value={selectedEntity.parent}
                        >
                          <option value="">Scene Root</option>
                          {sceneDraft.entities
                            .filter((entity) => entity.id !== selectedEntity.id)
                            .map((entity) => (
                              <option key={entity.id} value={entity.id}>
                                {entity.displayName}
                              </option>
                            ))}
                        </select>
                      </label>
                      <Vector3Editor
                        disabled={!canEdit || busy}
                        label="Position"
                        onChange={(value) =>
                          updateSelectedEntity((entity) => ({
                            ...entity,
                            position: value,
                          }))
                        }
                        value={selectedEntity.position}
                      />
                      <Vector3Editor
                        disabled={!canEdit || busy}
                        label="Rotation"
                        onChange={(value) =>
                          updateSelectedEntity((entity) => ({
                            ...entity,
                            rotation: value,
                          }))
                        }
                        value={selectedEntity.rotation}
                      />
                      <Vector3Editor
                        disabled={!canEdit || busy}
                        label="Scale"
                        onChange={(value) =>
                          updateSelectedEntity((entity) => ({
                            ...entity,
                            scale: value,
                          }))
                        }
                        value={selectedEntity.scale}
                      />
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
                      <label className="form-field">
                        <span>Render procgeo</span>
                        <input
                          disabled={!canEdit || busy}
                          onChange={(event) =>
                            updatePrefabDraft({
                              ...prefabDraft,
                              renderComponent: {
                                ...prefabDraft.renderComponent,
                                procgeo: sanitizeAssetName(event.target.value),
                              },
                            })
                          }
                          type="text"
                          value={prefabDraft.renderComponent.procgeo}
                        />
                      </label>
                      <label className="form-field">
                        <span>Material hint</span>
                        <input
                          disabled={!canEdit || busy}
                          onChange={(event) =>
                            updatePrefabDraft({
                              ...prefabDraft,
                              renderComponent: {
                                ...prefabDraft.renderComponent,
                                materialHint: sanitizeAssetName(event.target.value),
                              },
                            })
                          }
                          type="text"
                          value={prefabDraft.renderComponent.materialHint}
                        />
                      </label>
                      <label className="form-field">
                        <span>Effect asset</span>
                        <input
                          disabled={!canEdit || busy}
                          onChange={(event) =>
                            updatePrefabDraft({
                              ...prefabDraft,
                              effectComponent: {
                                ...prefabDraft.effectComponent,
                                effect: sanitizeAssetName(event.target.value),
                              },
                            })
                          }
                          type="text"
                          value={prefabDraft.effectComponent.effect}
                        />
                      </label>
                      <label className="form-field">
                        <span>Effect trigger</span>
                        <input
                          disabled={!canEdit || busy}
                          onChange={(event) =>
                            updatePrefabDraft({
                              ...prefabDraft,
                              effectComponent: {
                                ...prefabDraft.effectComponent,
                                trigger: sanitizeAssetName(event.target.value),
                              },
                            })
                          }
                          type="text"
                          value={prefabDraft.effectComponent.trigger}
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

                  {(selectedNode === 'entity' && !selectedEntity) || (selectedNode === 'prefab' && !prefabDraft) ? (
                    <div className="scene-empty-state scene-empty-state--compact">
                      Select an entity or prefab to inspect it.
                    </div>
                  ) : null}
                </div>
              ) : null}

              {activeSidebarTab === 'assets' ? (
                <div className="scene-sidebar-panel">
                  <div className="scene-sidebar-panel__header">
                    <div>
                      <span>Prefab Assets</span>
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
                            {document.renderComponent.procgeo ? (
                              <span>render: {document.renderComponent.procgeo}</span>
                            ) : null}
                            {document.effectComponent.effect ? (
                              <span>effect: {document.effectComponent.effect}</span>
                            ) : null}
                          </button>
                          <div className="scene-asset__actions">
                            <button
                              className="ghost-button ghost-button--sm"
                              disabled={!sceneDraft || !canEdit || busy}
                              onClick={() => selectPrimaryPrefab(document)}
                              type="button"
                            >
                              {sceneDraft?.primaryPrefab === document.name ? 'Primary' : 'Use As Primary'}
                            </button>
                            <button
                              className="ghost-button ghost-button--sm"
                              disabled={!sceneDraft || !canEdit || busy}
                              onClick={() => instantiatePrefab(document)}
                              type="button"
                            >
                              Add To Scene
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="scene-empty-state scene-empty-state--compact">
                        Add prefab assets under `content/prefabs` to widen the scene authoring lane.
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
