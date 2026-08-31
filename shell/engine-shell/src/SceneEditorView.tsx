import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  type BuildStatus,
  disconnectCoordinationAgent,
  engineShellActor,
  type EngineOperation,
  type EngineSession,
  fetchCoordinationLease,
  fetchOperation,
  heartbeatCoordinationAgent,
  listFiles,
  previewSceneAsset,
  readFile,
  registerCoordinationAgent,
  releaseCoordinationLease,
  requestCoordinationLease,
  type RuntimeStatus,
  type SessionFileRead,
  transitionOperation,
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
const sceneSidebarTabs = ['scenes', 'outliner', 'inspector', 'assets'] as const;
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
  preferredSidebarTab?: SceneSidebarTab;
};

const emptySnapshot: EditorSnapshot = {
  scene: null,
  prefab: null,
};
const DETACHED_WORLD_STATUS =
  'This world belongs to another workspace. Reopen that workspace to save it, or Reload to discard it and load the current workspace.';

function worldWorkspaceAuthority(session: EngineSession | null) {
  return session ? `${session.id}\0${session.rootPath}` : '';
}

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

type SceneAssetMutation = {
  sessionId: string;
  path: string;
  content: string;
  baseRevision: string;
  assetKind: 'scene' | 'prefab';
  intent: 'save' | 'create' | 'duplicate';
  subjectId: string;
  sourceSubjectId?: string;
  sourceRevision?: string;
  label: string;
};

function sceneAssetResourceKey(assetKind: 'scene' | 'prefab', subjectId: string) {
  return `${assetKind === 'scene' ? 'scene/world' : 'scene/prefab'}/${subjectId}`;
}

async function sha256Revision(content: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return `sha256:${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function sameStringList(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function assertSceneAssetOperation(
  operation: EngineOperation,
  expected: SceneAssetMutation & {
    leaseId: string;
    operationId?: string;
    proposedRevision: string;
    resourceKeys: string[];
  },
  state: EngineOperation['state'],
) {
  const context = operation.context;
  if (
    !operation.id
    || (expected.operationId != null && operation.id !== expected.operationId)
    || operation.kind !== 'file_write'
    || operation.state !== state
    || operation.sessionId !== expected.sessionId
    || operation.path !== expected.path
    || operation.baseRevision !== expected.baseRevision
    || operation.proposedRevision !== expected.proposedRevision
    || context?.type !== 'scene_asset'
    || context.assetKind !== expected.assetKind
    || context.intent !== expected.intent
    || context.label !== expected.label
    || context.subjectId !== expected.subjectId
    || context.leaseId !== expected.leaseId
    || !sameStringList(context.resourceKeys, expected.resourceKeys)
    || (expected.intent === 'duplicate'
      ? context.sourceSubjectId !== expected.sourceSubjectId || context.sourceRevision !== expected.sourceRevision
      : context.sourceSubjectId != null || context.sourceRevision != null)
    || (state === 'applied'
      ? operation.appliedRevision !== expected.proposedRevision
      : operation.appliedRevision != null)
    || operation.resultingRevision != null
  ) {
    throw new Error('Sessiond returned a scene asset operation that did not match the requested identity.');
  }
}

async function mutateSceneAsset(request: SceneAssetMutation): Promise<SessionFileRead> {
  if (request.intent === 'duplicate' && (!request.sourceSubjectId || !request.sourceRevision)) {
    throw new Error('Duplicate requires sourceSubjectId and sourceRevision.');
  }

  const resourceKeys = [...new Set([
    sceneAssetResourceKey(request.assetKind, request.subjectId),
    ...(request.intent === 'duplicate' && request.sourceSubjectId
      ? [sceneAssetResourceKey(request.assetKind, request.sourceSubjectId)]
      : []),
  ])].sort();
  const proposedRevision = await sha256Revision(request.content);
  const registration = await registerCoordinationAgent(request.sessionId);
  const agentId = registration.agent.id;
  const credential = registration.credential;
  let leaseId = '';

  try {
    if (registration.agent.sessionId !== request.sessionId || !agentId || !credential) {
      throw new Error('Sessiond returned an invalid World coordination identity.');
    }
    const lease = await requestCoordinationLease(agentId, credential, resourceKeys);
    leaseId = lease.id;
    if (
      !leaseId
      || lease.agentId !== agentId
      || lease.sessionId !== request.sessionId
      || lease.mode !== 'write'
    ) {
      throw new Error('Sessiond returned a World write lock with the wrong identity. The draft was preserved.');
    }
    if (lease.status !== 'granted') {
      throw new Error(
        lease.status === 'queued'
          ? 'World write lock is queued. The draft was preserved.'
          : `World write lock is ${lease.status}. The draft was preserved.`,
      );
    }
    if (!sameStringList([...lease.resources].sort(), resourceKeys)) {
      throw new Error('World write lock did not cover the exact scene resources. The draft was preserved.');
    }

    const expected = { ...request, leaseId, proposedRevision, resourceKeys };
    const previewed = await previewSceneAsset({
      sessionId: request.sessionId,
      assetKind: request.assetKind,
      intent: request.intent,
      subjectId: request.subjectId,
      content: request.content,
      baseRevision: request.baseRevision,
      label: request.label,
      agentId,
      leaseId,
      credential,
      ...(request.intent === 'duplicate'
        ? { sourceSubjectId: request.sourceSubjectId, sourceRevision: request.sourceRevision }
        : {}),
    });
    assertSceneAssetOperation(previewed.operation, expected, 'previewed');
    const operationExpected = { ...expected, operationId: previewed.operation.id };

    const approved = await transitionOperation(previewed.operation.id, 'approve', { actor: engineShellActor });
    assertSceneAssetOperation(approved.operation, operationExpected, 'approved');

    await heartbeatCoordinationAgent(agentId, credential);
    const currentLease = await fetchCoordinationLease(leaseId);
    if (
      currentLease.id !== leaseId
      || currentLease.agentId !== agentId
      || currentLease.sessionId !== request.sessionId
      || currentLease.mode !== 'write'
      || currentLease.status !== 'granted'
      || !sameStringList([...currentLease.resources].sort(), resourceKeys)
    ) {
      throw new Error('World write lock was lost. The draft was preserved.');
    }

    let applied: EngineOperation;
    try {
      const result = await transitionOperation(previewed.operation.id, 'apply', {
        actor: engineShellActor,
        coordination: { agentId, leaseId, credential },
      });
      assertSceneAssetOperation(result.operation, operationExpected, 'applied');
      applied = result.operation;
    } catch (error) {
      let reconciled: SessionFileRead | null = null;
      try {
        const authoritative = await fetchOperation(previewed.operation.id);
        const latest = await readFile(request.sessionId, request.path);
        if (
          latest.path === request.path
          && latest.revision === expected.proposedRevision
        ) {
          assertSceneAssetOperation(authoritative, operationExpected, 'applied');
          reconciled = latest;
        }
      } catch {
        reconciled = null;
      }
      if (reconciled) {
        return reconciled;
      }
      throw error;
    }

    const latest = await readFile(request.sessionId, request.path);
    if (
      latest.path !== request.path
      || latest.revision !== expected.proposedRevision
      || latest.revision !== applied.appliedRevision
    ) {
      throw new Error('Authoritative scene file did not match the applied revision.');
    }
    return latest;
  } finally {
    if (leaseId) {
      await releaseCoordinationLease(leaseId, agentId, credential).catch(() => undefined);
    }
    await disconnectCoordinationAgent(agentId, credential).catch(() => undefined);
  }
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
  return mode === 'edit' ? 'Edit' : 'Verify';
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
  preferredSidebarTab,
}: SceneEditorViewProps) {
  const sceneShellRef = useRef<HTMLDivElement | null>(null);
  const primaryActionRef = useRef<HTMLButtonElement | null>(null);
  const activeSessionIdRef = useRef(activeSession?.id || '');
  const sceneDraftPathRef = useRef('');
  const prefabDraftPathRef = useRef('');
  const sceneDirtyRef = useRef(false);
  const prefabDirtyRef = useRef(false);
  const worldRequestRef = useRef(0);
  const activeWorkspaceAuthorityRef = useRef(worldWorkspaceAuthority(activeSession));
  const draftWorkspaceAuthorityRef = useRef('');
  const [mode, setMode] = useState<EditorMode>('edit');
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState('Select a workspace to open a world.');
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
  const [activeSidebarTab, setActiveSidebarTab] = useState<SceneSidebarTab>(preferredSidebarTab ?? 'outliner');
  const [sceneSidebarWidth, setSceneSidebarWidth] = useState(DEFAULT_SCENE_SIDEBAR_WIDTH);
  const [sceneSidebarResizing, setSceneSidebarResizing] = useState(false);
  const [draftWorkspaceAuthority, setDraftWorkspaceAuthority] = useState('');

  const currentSnapshot = history[historyIndex] || emptySnapshot;
  const sceneDraft = currentSnapshot.scene;
  const prefabDraft = currentSnapshot.prefab;
  const activeWorkspaceAuthority = worldWorkspaceAuthority(activeSession);
  activeSessionIdRef.current = activeSession?.id || '';
  activeWorkspaceAuthorityRef.current = activeWorkspaceAuthority;
  sceneDraftPathRef.current = sceneDraft?.path || '';
  prefabDraftPathRef.current = prefabDraft?.path || '';
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

  sceneDirtyRef.current = sceneDirty;
  prefabDirtyRef.current = prefabDirty;
  const worldMutationsEnabled = Boolean(
    activeWorkspaceAuthority && activeWorkspaceAuthority === draftWorkspaceAuthority,
  );
  const draftDetached = Boolean(
    draftWorkspaceAuthority && draftWorkspaceAuthority !== activeWorkspaceAuthority,
  );
  const canEdit = mode === 'edit' && worldMutationsEnabled;
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
    if (preferredSidebarTab) {
      setActiveSidebarTab(preferredSidebarTab);
    }
  }, [preferredSidebarTab]);

  useEffect(() => {
    if (!sceneDraft) {
      setActiveSidebarTab(preferredSidebarTab === 'assets' ? 'assets' : 'scenes');
    }
  }, [preferredSidebarTab, sceneDraft]);

  function resetDrafts(nextScene: SceneAssetDocument | null, nextPrefab: PrefabAssetDocument | null) {
    setHistory([
      {
        scene: cloneSceneDocument(nextScene),
        prefab: clonePrefabDocument(nextPrefab),
      },
    ]);
    setHistoryIndex(0);
  }

  function bindDraftWorkspace(authority: string) {
    draftWorkspaceAuthorityRef.current = authority;
    setDraftWorkspaceAuthority(authority);
  }

  function worldResponseIsCurrent(authority: string, requestId: number) {
    return Boolean(
      authority
      && worldRequestRef.current === requestId
      && activeWorkspaceAuthorityRef.current === authority
      && draftWorkspaceAuthorityRef.current === authority,
    );
  }

  function markWorldDraftDetached() {
    setStatusMessage(DETACHED_WORLD_STATUS);
    onBackendStatus('connected', DETACHED_WORLD_STATUS);
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

  function handleSceneSidebarResizeKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    let nextWidth = sceneSidebarWidth;
    if (event.key === 'ArrowLeft') nextWidth += 16;
    else if (event.key === 'ArrowRight') nextWidth -= 16;
    else if (event.key === 'Home') nextWidth = MIN_SCENE_SIDEBAR_WIDTH;
    else if (event.key === 'End') nextWidth = MAX_SCENE_SIDEBAR_WIDTH;
    else return;
    event.preventDefault();
    setSceneSidebarWidth(clampSceneSidebarWidth(nextWidth));
  }

  function handleSceneSidebarTabKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const currentIndex = sceneSidebarTabs.indexOf(activeSidebarTab);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % sceneSidebarTabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + sceneSidebarTabs.length) % sceneSidebarTabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = sceneSidebarTabs.length - 1;
    else return;
    event.preventDefault();
    const nextTab = sceneSidebarTabs[nextIndex];
    setActiveSidebarTab(nextTab);
    event.currentTarget.querySelector<HTMLElement>(`[data-scene-sidebar-tab="${nextTab}"]`)?.focus();
  }

  function confirmDiscardChanges(message: string, includeScene = true, includePrefab = true) {
    const hasChanges = (includeScene && sceneDirtyRef.current) || (includePrefab && prefabDirtyRef.current);
    return !hasChanges || typeof window === 'undefined' || window.confirm(message);
  }

  function handleSelectScene(document: SceneAssetDocument) {
    if (!worldMutationsEnabled || document.path === selectedScenePath) {
      return;
    }
    if (!confirmDiscardChanges('Open another world and discard the unsaved changes in this one?')) {
      return;
    }
    worldRequestRef.current += 1;
    openSceneDocument(document, prefabDocuments, mode);
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
    setStatusMessage(`Opened ${nextScene.title || nextScene.name}.`);
    onLaunchSceneChange(nextScene.name);
    onBackendStatus('connected', `Opened ${nextScene.title || nextScene.name}.`);
  }

  useEffect(() => {
    let cancelled = false;
    const requestId = ++worldRequestRef.current;
    const requestedSession = activeSession;
    const requestedAuthority = worldWorkspaceAuthority(requestedSession);

    async function loadAuthoringAssets() {
      if (requestedAuthority === draftWorkspaceAuthorityRef.current) {
        if (requestedAuthority && (sceneDirtyRef.current || prefabDirtyRef.current)) {
          const message = 'Reopened the draft workspace. Save authority is restored.';
          setStatusMessage(message);
          onBackendStatus('connected', message);
        }
        return;
      }

      if (
        draftWorkspaceAuthorityRef.current
        && (sceneDirtyRef.current || prefabDirtyRef.current)
        && !confirmDiscardChanges('Switch workspace and discard the unsaved World changes?')
      ) {
        markWorldDraftDetached();
        return;
      }

      if (!requestedSession) {
        bindDraftWorkspace('');
        setSceneDocuments([]);
        setPrefabDocuments([]);
        setSelectedScenePath('');
        setSceneSaved(null);
        setPrefabSaved(null);
        setSceneSelection();
        setMode('edit');
        resetDrafts(null, null);
        setStatusMessage('Select a workspace to open a world.');
        return;
      }

      setBusy(true);
      try {
        const [nextScenes, nextPrefabs] = await Promise.all([
          loadSceneDocuments(requestedSession.id),
          loadPrefabDocuments(requestedSession.id),
        ]);

        if (
          cancelled
          || worldRequestRef.current !== requestId
          || activeWorkspaceAuthorityRef.current !== requestedAuthority
        ) {
          return;
        }

        bindDraftWorkspace(requestedAuthority);
        setSceneDocuments(nextScenes);
        setPrefabDocuments(nextPrefabs);

        if (!nextScenes.length) {
          setSelectedScenePath('');
          setSceneSaved(null);
          setPrefabSaved(null);
          setSceneSelection();
          resetDrafts(null, null);
          setStatusMessage('No worlds found yet. Create one to start.');
          onBackendStatus(
            'connected',
            `Loaded workspace ${requestedSession.name}, but no worlds were found.`,
          );
          return;
        }

        const preferredScene =
          nextScenes.find((document) => document.path === selectedScenePath) ||
          nextScenes.find((document) => document.name === launchScene) ||
          nextScenes[0];
        openSceneDocument(preferredScene, nextPrefabs);
      } catch (error) {
        if (
          cancelled
          || worldRequestRef.current !== requestId
          || activeWorkspaceAuthorityRef.current !== requestedAuthority
        ) {
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        setStatusMessage(message);
        onBackendStatus('offline', message);
      } finally {
        if (!cancelled && worldRequestRef.current === requestId) {
          setBusy(false);
        }
      }
    }

    void loadAuthoringAssets();
    return () => {
      cancelled = true;
    };
  }, [activeSession?.id, activeSession?.rootPath]);

  async function reloadFromDisk() {
    if (!activeSession) {
      if (!draftDetached || !confirmDiscardChanges('Discard the detached World changes?')) {
        return;
      }
      bindDraftWorkspace('');
      setSceneDocuments([]);
      setPrefabDocuments([]);
      setSelectedScenePath('');
      setSceneSaved(null);
      setPrefabSaved(null);
      resetDrafts(null, null);
      setStatusMessage('Select a workspace to open a world.');
      return;
    }
    if (!confirmDiscardChanges('Reload from disk and discard your unsaved changes?')) {
      return;
    }

    const targetAuthority = worldWorkspaceAuthority(activeSession);
    const targetSessionId = activeSession.id;
    const requestId = ++worldRequestRef.current;
    setBusy(true);
    try {
      const [nextScenes, nextPrefabs] = await Promise.all([
        loadSceneDocuments(targetSessionId),
        loadPrefabDocuments(targetSessionId),
      ]);
      if (
        worldRequestRef.current !== requestId
        || activeWorkspaceAuthorityRef.current !== targetAuthority
      ) {
        return;
      }
      bindDraftWorkspace(targetAuthority);
      setSceneDocuments(nextScenes);
      setPrefabDocuments(nextPrefabs);

      if (!nextScenes.length) {
        setSelectedScenePath('');
        setSceneSaved(null);
        setPrefabSaved(null);
        setSceneSelection();
        resetDrafts(null, null);
        setStatusMessage('Reloaded from disk. No worlds remain.');
        onBackendStatus('connected', 'Reloaded worlds from disk.');
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
      setStatusMessage(`Reloaded ${preferredScene.title || preferredScene.name}.`);
      onLaunchSceneChange(preferredScene.name);
      onBackendStatus('connected', `Reloaded ${preferredScene.title || preferredScene.name}.`);
    } catch (error) {
      if (
        worldRequestRef.current !== requestId
        || activeWorkspaceAuthorityRef.current !== targetAuthority
      ) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      setStatusMessage(message);
      onBackendStatus('offline', message);
    } finally {
      if (
        worldRequestRef.current === requestId
        && activeWorkspaceAuthorityRef.current === targetAuthority
      ) {
        setBusy(false);
      }
    }
  }

  function handleModeChange(nextMode: EditorMode) {
    if (nextMode === mode) {
      return;
    }

    setMode(nextMode);
    if (nextMode === 'play') {
      const message = 'Verify locks editing and keeps your changes. Play saves them before testing.';
      setStatusMessage(message);
      onBackendStatus('connected', message);
      return;
    }

    const message = sceneDirty || prefabDirty
      ? 'Returned to Edit. Unsaved changes are still here.'
      : 'Returned to Edit.';
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
    if (!worldMutationsEnabled) {
      return;
    }
    if (document.path === prefabDraft?.path) {
      setSelectedNode('prefab');
      setActiveSidebarTab('inspector');
      return;
    }
    if (!confirmDiscardChanges(
        'Select another reusable object and discard the unsaved changes in this one?',
        false,
        true,
      )) {
      return;
    }
    overwriteCurrentSnapshot({
      scene: cloneSceneDocument(sceneDraft),
      prefab: clonePrefabDocument(document),
    });
    worldRequestRef.current += 1;
    setPrefabSaved(document);
    setSelectedNode('prefab');
    setActiveSidebarTab('inspector');
    setStatusMessage(`Selected reusable object ${document.name}.`);
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
    setStatusMessage(`Primary reusable object for ${sceneDraft.title || sceneDraft.name} set to ${document.name}.`);
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
    setStatusMessage(`Added ${nextEntity.displayName} from ${document.name}.`);
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
    setStatusMessage(`Duplicated ${selectedEntity.displayName}.`);
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
    setStatusMessage(`Deleted ${selectedEntity.displayName}.`);
  }

  async function handleSaveScene() {
    if (!activeSession || !sceneDraft || !worldMutationsEnabled) {
      return false;
    }

    const targetSessionId = activeSession.id;
    const targetAuthority = worldWorkspaceAuthority(activeSession);
    const targetPath = sceneDraft.path;
    const requestId = ++worldRequestRef.current;
    setBusy(true);
    try {
      const savedPayload = await mutateSceneAsset({
        sessionId: targetSessionId,
        path: targetPath,
        content: formatSceneAssetDocument(sceneDraft),
        baseRevision: sceneDraft.revision,
        assetKind: 'scene',
        intent: 'save',
        subjectId: sceneDraft.name,
        label: `save scene ${sceneDraft.name}`,
      });
      if (
        activeSessionIdRef.current !== targetSessionId
        || sceneDraftPathRef.current !== targetPath
        || !worldResponseIsCurrent(targetAuthority, requestId)
      ) {
        return false;
      }
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
      setStatusMessage(`Saved ${nextScene.title || nextScene.name}.`);
      onLaunchSceneChange(nextScene.name);
      onBackendStatus('connected', `Saved ${nextScene.title || nextScene.name}.`);
      primaryActionRef.current?.focus();
      return true;
    } catch (error) {
      if (!worldResponseIsCurrent(targetAuthority, requestId)) {
        return false;
      }
      const message = error instanceof Error ? error.message : String(error);
      setStatusMessage(message);
      onBackendStatus('offline', message);
      return false;
    } finally {
      if (worldResponseIsCurrent(targetAuthority, requestId)) {
        setBusy(false);
      }
    }
  }

  async function handleSavePrefab() {
    if (!activeSession || !prefabDraft || !worldMutationsEnabled) {
      return false;
    }

    const targetSessionId = activeSession.id;
    const targetAuthority = worldWorkspaceAuthority(activeSession);
    const targetPath = prefabDraft.path;
    const requestId = ++worldRequestRef.current;
    setBusy(true);
    try {
      const savedPayload = await mutateSceneAsset({
        sessionId: targetSessionId,
        path: targetPath,
        content: formatPrefabAssetDocument(prefabDraft),
        baseRevision: prefabDraft.revision,
        assetKind: 'prefab',
        intent: 'save',
        subjectId: prefabDraft.name,
        label: `save prefab ${prefabDraft.name}`,
      });
      if (
        activeSessionIdRef.current !== targetSessionId
        || prefabDraftPathRef.current !== targetPath
        || !worldResponseIsCurrent(targetAuthority, requestId)
      ) {
        return false;
      }
      const nextPrefab = parsePrefabAssetDocument(savedPayload);
      setPrefabSaved(nextPrefab);
      setPrefabDocuments((current) =>
        sortPrefabs([...current.filter((document) => document.path !== nextPrefab.path), nextPrefab]),
      );
      overwriteCurrentSnapshot({
        scene: cloneSceneDocument(sceneDraft),
        prefab: clonePrefabDocument(nextPrefab),
      });
      setStatusMessage(`Saved reusable object ${nextPrefab.name}.`);
      onBackendStatus('connected', `Saved reusable object ${nextPrefab.name}.`);
      primaryActionRef.current?.focus();
      return true;
    } catch (error) {
      if (!worldResponseIsCurrent(targetAuthority, requestId)) {
        return false;
      }
      const message = error instanceof Error ? error.message : String(error);
      setStatusMessage(message);
      onBackendStatus('offline', message);
      return false;
    } finally {
      if (worldResponseIsCurrent(targetAuthority, requestId)) {
        setBusy(false);
      }
    }
  }

  async function handlePlay() {
    if (!sceneDraft || busy || !worldMutationsEnabled) {
      return;
    }

    if (sceneDirty && !(await handleSaveScene())) {
      return;
    }
    if (prefabDirty && !(await handleSavePrefab())) {
      return;
    }
    onBuildAndRun();
  }

  async function handleCreateScene() {
    if (!activeSession || !canEdit) {
      return;
    }

    const targetAuthority = worldWorkspaceAuthority(activeSession);
    const targetSessionId = activeSession.id;
    const sanitizedName = sanitizeAssetName(newSceneName);
    if (!sanitizedName) {
      setStatusMessage('Enter a world name before creating a new world.');
      return;
    }

    const nextPath = buildSceneAssetPath(sanitizedName);
    if (sceneDocuments.some((document) => document.path === nextPath)) {
      setStatusMessage(`A world already exists at ${nextPath}.`);
      return;
    }
    if (!confirmDiscardChanges('Create a new world and discard the current unsaved changes?')) {
      return;
    }

    const primaryPrefab = scenePrimaryPrefab?.name || prefabDocuments[0]?.name || '';
    const nextScene = createSceneAssetDocument(newSceneName, primaryPrefab);

    const requestId = ++worldRequestRef.current;
    setBusy(true);
    try {
      const savedPayload = await mutateSceneAsset({
        sessionId: targetSessionId,
        path: nextScene.path,
        content: formatSceneAssetDocument(nextScene),
        baseRevision: nextScene.revision,
        assetKind: 'scene',
        intent: 'create',
        subjectId: nextScene.name,
        label: `create scene ${nextScene.name}`,
      });
      if (!worldResponseIsCurrent(targetAuthority, requestId)) {
        return;
      }
      const createdScene = parseSceneAssetDocument(savedPayload);
      const nextScenes = sortScenes([...sceneDocuments, createdScene]);
      setSceneDocuments(nextScenes);
      setNewSceneName('');
      openSceneDocument(createdScene);
      setStatusMessage(`Created ${createdScene.title || createdScene.name}.`);
      onBackendStatus('connected', `Created ${createdScene.title || createdScene.name}.`);
    } catch (error) {
      if (!worldResponseIsCurrent(targetAuthority, requestId)) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      setStatusMessage(message);
      onBackendStatus('offline', message);
    } finally {
      if (worldResponseIsCurrent(targetAuthority, requestId)) {
        setBusy(false);
      }
    }
  }

  async function handleDuplicateScene() {
    if (!activeSession || !sceneDraft || !canEdit) {
      return;
    }

    const targetAuthority = worldWorkspaceAuthority(activeSession);
    const targetSessionId = activeSession.id;
    const sanitizedName = sanitizeAssetName(duplicateSceneName);
    if (!sanitizedName) {
      setStatusMessage('Enter a name before duplicating this world.');
      return;
    }

    const duplicateDocument = cloneSceneForDuplicate(sceneDraft, duplicateSceneName);
    if (sceneDocuments.some((document) => document.path === duplicateDocument.path)) {
      setStatusMessage(`A world already exists at ${duplicateDocument.path}.`);
      return;
    }
    if (!confirmDiscardChanges(
      'Duplicate this world and discard the unsaved reusable-object changes?',
      false,
      true,
    )) {
      return;
    }

    const requestId = ++worldRequestRef.current;
    setBusy(true);
    try {
      const savedPayload = await mutateSceneAsset({
        sessionId: targetSessionId,
        path: duplicateDocument.path,
        content: formatSceneAssetDocument(duplicateDocument),
        baseRevision: duplicateDocument.revision,
        assetKind: 'scene',
        intent: 'duplicate',
        subjectId: duplicateDocument.name,
        sourceSubjectId: sceneDraft.name,
        sourceRevision: sceneDraft.revision,
        label: `duplicate scene ${duplicateDocument.name}`,
      });
      if (!worldResponseIsCurrent(targetAuthority, requestId)) {
        return;
      }
      const nextScene = parseSceneAssetDocument(savedPayload);
      setSceneDocuments((current) => sortScenes([...current, nextScene]));
      openSceneDocument(nextScene);
      setStatusMessage(`Duplicated ${sceneDraft.title || sceneDraft.name} into ${nextScene.title || nextScene.name}.`);
      onBackendStatus('connected', `Duplicated ${sceneDraft.title || sceneDraft.name} into ${nextScene.title || nextScene.name}.`);
    } catch (error) {
      if (!worldResponseIsCurrent(targetAuthority, requestId)) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      setStatusMessage(message);
      onBackendStatus('offline', message);
    } finally {
      if (worldResponseIsCurrent(targetAuthority, requestId)) {
        setBusy(false);
      }
    }
  }

  function handleRevertDrafts() {
    resetDrafts(sceneSaved, prefabSaved);
    setSceneSelection();
    const message = sceneSaved
      ? `Reverted unsaved changes for ${sceneSaved.title || sceneSaved.name}.`
      : 'Reverted unsaved changes.';
    setStatusMessage(message);
    onBackendStatus('connected', message);
    primaryActionRef.current?.focus();
  }

  function handleUndo() {
    if (!canUndo) {
      return;
    }
    setHistoryIndex((current) => Math.max(0, current - 1));
    setStatusMessage('Undid the last change.');
  }

  function handleRedo() {
    if (!canRedo) {
      return;
    }
    setHistoryIndex((current) => Math.min(history.length - 1, current + 1));
    setStatusMessage('Redid the last change.');
  }

  const dirtyStateLabel = sceneDirty || prefabDirty ? 'Unsaved' : 'Saved';
  const dirtyStateDetail = sceneDirty
    ? 'World changes are not saved yet.'
    : prefabDirty
      ? 'Reusable object changes are not saved yet.'
      : 'Saved.';
  const selectionInspectorLabel =
    selectedNode === 'scene'
      ? 'World'
      : selectedNode === 'entity'
        ? 'Object'
        : 'Reusable object';
  const worldTitle = sceneDraft?.title || sceneDraft?.name || 'No world open';
  const canPlay = Boolean(sceneDraft) && !busy && buildStatus.state !== 'running' && worldMutationsEnabled;
  const canApplyAndRestart = canPlay && runtimeStatus.state !== 'stopped' && (sceneDirty || prefabDirty);
  const canRestartRuntime = buildStatus.state !== 'running' && runtimeStatus.state !== 'stopped';
  const canStopRuntime = buildStatus.state !== 'running' && runtimeStatus.state !== 'stopped';
  const buildRequiresCmake = /cmake is required/i.test(buildStatus.error || '');
  const playFailureMessage = buildStatus.state === 'failed'
    ? buildRequiresCmake
      ? 'Play needs CMake. Install it or add it to PATH, then try again.'
      : `Play could not start. ${buildStatus.error || 'Open More for diagnostics.'}`
    : nativeRuntimeHint && runtimeStatus.state === 'stopped'
      ? 'The game could not open because native runtime files are missing. Open More for setup details.'
      : '';

  if (!activeSession && !draftDetached) {
    return (
      <div className="workspace-layout workspace-layout--scene-editor">
        <section className="surface scene-workspace">
          <div className="scene-editor__topbar">
            <div className="scene-editor__identity">
              <div className="surface-eyebrow">World</div>
              <h2>World</h2>
              <p>Select a workspace to open a world.</p>
            </div>
          </div>
          <div className="scene-empty-state">
            Select a workspace first. Worlds and objects appear here after that.
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
            <div className="surface-eyebrow">World</div>
            <h2>{worldTitle}</h2>
            <p>
              {busy ? 'Working' : dirtyStateLabel}
              {sceneDraft ? ` · ${sceneDraft.entities.length} objects` : ''}
              {` · ${toSceneStatusLabel(mode)}`}
            </p>
          </div>
          <div className="scene-editor__toolbar-groups">
            <div className="scene-toolbar__group">
              {runtimeStatus.state === 'stopped' ? (
                <button
                  className="ghost-button ghost-button--sm ghost-button--primary"
                  disabled={!canPlay}
                  onClick={() => void handlePlay()}
                  ref={primaryActionRef}
                  type="button"
                >
                  Play
                </button>
              ) : (
                <>
                  {canApplyAndRestart ? (
                    <button
                      className="ghost-button ghost-button--sm ghost-button--primary"
                      onClick={() => void handlePlay()}
                      ref={primaryActionRef}
                      type="button"
                    >
                      Apply and restart
                    </button>
                  ) : null}
                  <button
                    className="ghost-button ghost-button--sm"
                    disabled={!canStopRuntime}
                    onClick={onStopRuntime}
                    ref={canApplyAndRestart ? undefined : primaryActionRef}
                    type="button"
                  >
                    Stop
                  </button>
                </>
              )}
            </div>
            <div className="scene-toolbar__group">
              {sceneDirty ? (
                <button
                  className="ghost-button ghost-button--sm"
                  disabled={busy || !canEdit}
                  onClick={() => void handleSaveScene()}
                  type="button"
                >
                  Save world
                </button>
              ) : null}
              {prefabDirty ? (
                <button
                  className="ghost-button ghost-button--sm"
                  disabled={busy || !canEdit}
                  onClick={() => void handleSavePrefab()}
                  type="button"
                >
                  Save object
                </button>
              ) : null}
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
                aria-pressed={mode === 'edit'}
                className={`ghost-button ghost-button--sm${mode === 'edit' ? ' ghost-button--primary' : ''}`}
                onClick={() => handleModeChange('edit')}
                type="button"
              >
                Edit
              </button>
              <button
                aria-pressed={mode === 'play'}
                className={`ghost-button ghost-button--sm${mode === 'play' ? ' ghost-button--primary' : ''}`}
                onClick={() => handleModeChange('play')}
                type="button"
              >
                Verify
              </button>
            </div>
          </div>
        </div>

        {playFailureMessage ? (
          <div className="setup-hint setup-hint--scene" role="alert">
            <strong>Play needs attention</strong>
            <span>{playFailureMessage}</span>
          </div>
        ) : null}

        <details className="scene-disclosure">
          <summary>More</summary>
          <div className="scene-disclosure__body">
            <div className="scene-toolbar__group">
              {sceneDirty || prefabDirty ? (
                <button
                  className="ghost-button ghost-button--sm"
                  disabled={busy}
                  onClick={handleRevertDrafts}
                  type="button"
                >
                  Discard changes
                </button>
              ) : null}
              <button
                className="ghost-button ghost-button--sm"
                disabled={busy}
                onClick={() => void reloadFromDisk()}
                type="button"
              >
                Reload
              </button>
              <button
                className="ghost-button ghost-button--sm"
                disabled={!sceneDraft || draftDetached || buildStatus.state === 'running' || runtimeStatus.state !== 'stopped'}
                onClick={onRunScene}
                type="button"
              >
                Run existing build
              </button>
              <button
                className="ghost-button ghost-button--sm"
                disabled={!canRestartRuntime}
                onClick={onRestartRuntime}
                type="button"
              >
                Restart
              </button>
            </div>
            {buildRequiresCmake ? (
              <div className="setup-hint setup-hint--scene">
                <strong>Build + Run needs CMake</strong>
                <span>
                  The clean-start scripts now auto-detect common installs and export
                  `SHADER_FORGE_CMAKE` when possible. If this still fails, install CMake or add it
                  to PATH. If the runtime binary already exists under `build/runtime/bin`, use Run
                  existing build instead.
                </span>
              </div>
            ) : null}
            {!buildRequiresCmake && nativeRuntimeHint ? (
              <div className="setup-hint setup-hint--scene">
                <strong>Native runtime dependencies missing</strong>
                <span>{nativeRuntimeHint}</span>
              </div>
            ) : null}
            <dl className="fact-list">
              <div>
                <dt>Workspace</dt>
                <dd>{activeSession?.name || 'none selected'}</dd>
              </div>
              <div>
                <dt>World</dt>
                <dd>{sceneDraft?.name || launchScene}</dd>
              </div>
              <div>
                <dt>Play</dt>
                <dd>{runtimeStatus.state === 'stopped' ? 'Stopped' : runtimeStatus.state === 'paused' ? 'Paused' : 'Running'}</dd>
              </div>
              <div>
                <dt>State</dt>
                <dd>{dirtyStateDetail}</dd>
              </div>
            </dl>
          </div>
        </details>

        <div className="scene-editor__body" ref={sceneShellRef}>
          <div className="scene-editor__canvas-column">
            <article className="scene-card scene-card--viewport scene-card--viewport-expanded">
              <div className="scene-viewport">
                <div className="scene-viewport__focus">
                  {sceneDraft ? (
                    <>
                      <strong>Browser preview is not connected yet.</strong>
                      <p>Play opens the game in a separate window.</p>
                    </>
                  ) : (
                    <>
                      <strong>Open a world to start.</strong>
                      <p>Create or choose a world, then place objects from the library.</p>
                    </>
                  )}
                </div>
              </div>
            </article>

            <div aria-live="polite" className="scene-statusbar" role="status">
              <div className="scene-statusbar__message">
                <strong>{statusMessage}</strong>
              </div>
              <span className={`scene-status-pill scene-status-pill--${mode}`}>
                {toSceneStatusLabel(mode)}
              </span>
            </div>
          </div>

          <div
            aria-label="Resize level tools panel"
            aria-orientation="vertical"
            aria-valuemax={MAX_SCENE_SIDEBAR_WIDTH}
            aria-valuemin={MIN_SCENE_SIDEBAR_WIDTH}
            aria-valuenow={sceneSidebarWidth}
            className={`scene-editor__resize-handle${sceneSidebarResizing ? ' is-resizing' : ''}`}
            onKeyDown={handleSceneSidebarResizeKeyDown}
            onPointerDown={handleSceneSidebarResizeStart}
            role="separator"
            tabIndex={0}
          />

          <aside
            className="scene-editor__sidebar"
            style={{ width: `${sceneSidebarWidth}px` }}
          >
            <div
              aria-label="World tools"
              className="tab-row tab-row--scene-sidebar"
              onKeyDown={handleSceneSidebarTabKeyDown}
              role="tablist"
            >
              <button
                aria-controls="scene-sidebar-panel-scenes"
                aria-selected={activeSidebarTab === 'scenes'}
                className={`pill-button${activeSidebarTab === 'scenes' ? ' is-active' : ''}`}
                data-scene-sidebar-tab="scenes"
                id="scene-sidebar-tab-scenes"
                onClick={() => setActiveSidebarTab('scenes')}
                role="tab"
                tabIndex={activeSidebarTab === 'scenes' ? 0 : -1}
                type="button"
              >
                World
              </button>
              <button
                aria-controls="scene-sidebar-panel-outliner"
                aria-selected={activeSidebarTab === 'outliner'}
                className={`pill-button${activeSidebarTab === 'outliner' ? ' is-active' : ''}`}
                data-scene-sidebar-tab="outliner"
                id="scene-sidebar-tab-outliner"
                onClick={() => setActiveSidebarTab('outliner')}
                role="tab"
                tabIndex={activeSidebarTab === 'outliner' ? 0 : -1}
                type="button"
              >
                Objects
              </button>
              <button
                aria-controls="scene-sidebar-panel-inspector"
                aria-selected={activeSidebarTab === 'inspector'}
                className={`pill-button${activeSidebarTab === 'inspector' ? ' is-active' : ''}`}
                data-scene-sidebar-tab="inspector"
                id="scene-sidebar-tab-inspector"
                onClick={() => setActiveSidebarTab('inspector')}
                role="tab"
                tabIndex={activeSidebarTab === 'inspector' ? 0 : -1}
                type="button"
              >
                Selection
              </button>
              <button
                aria-controls="scene-sidebar-panel-assets"
                aria-selected={activeSidebarTab === 'assets'}
                className={`pill-button${activeSidebarTab === 'assets' ? ' is-active' : ''}`}
                data-scene-sidebar-tab="assets"
                id="scene-sidebar-tab-assets"
                onClick={() => setActiveSidebarTab('assets')}
                role="tab"
                tabIndex={activeSidebarTab === 'assets' ? 0 : -1}
                type="button"
              >
                Library
              </button>
            </div>

            <div className="scene-editor__sidebar-body">
              {activeSidebarTab === 'scenes' ? (
                <div aria-labelledby="scene-sidebar-tab-scenes" className="scene-sidebar-panel" id="scene-sidebar-panel-scenes" role="tabpanel">
                  <div className="scene-sidebar-panel__header">
                    <div>
                      <span>World</span>
                      <strong>{sceneDocuments.length ? `${sceneDocuments.length} worlds` : 'No worlds yet'}</strong>
                    </div>
                  </div>
                  {sceneDraft ? (
                    <div className="scene-selection-summary">
                      <div>
                        <span>Open world</span>
                        <strong>{sceneDraft.title}</strong>
                      </div>
                      <div>
                        <span>Objects</span>
                        <strong>{sceneDraft.entities.length}</strong>
                      </div>
                      <div>
                        <span>Reusable object</span>
                        <strong>{sceneDraft.primaryPrefab || 'none'}</strong>
                      </div>
                    </div>
                  ) : (
                    <div className="scene-selection-summary scene-selection-summary--empty">
                      <div>
                        <span>World</span>
                        <strong>Create or open a world to start.</strong>
                      </div>
                    </div>
                  )}
                  <div className="scene-list">
                    {sceneDocuments.length ? (
                      sceneDocuments.map((document) => (
                        <button
                          className={`scene-list__item${selectedScenePath === document.path ? ' is-active' : ''}`}
                          disabled={busy || draftDetached}
                          key={document.path}
                          onClick={() => handleSelectScene(document)}
                          type="button"
                        >
                          <strong>{document.title}</strong>
                          <span>{document.name}</span>
                        </button>
                      ))
                    ) : (
                      <div className="scene-empty-state scene-empty-state--compact">
                        Create the first world below.
                      </div>
                    )}
                  </div>

                  <div className="scene-form-block">
                    <label className="form-field">
                      <span>New world name</span>
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
                    <button
                      className="ghost-button ghost-button--sm ghost-button--primary"
                      disabled={!canEdit || busy}
                      onClick={() => void handleCreateScene()}
                      type="button"
                    >
                      Create world
                    </button>
                  </div>

                  <div className="scene-form-block">
                    <label className="form-field">
                      <span>Duplicate world as</span>
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
                    <button
                      className="ghost-button ghost-button--sm"
                      disabled={!sceneDraft || !canEdit || busy}
                      onClick={() => void handleDuplicateScene()}
                      type="button"
                    >
                      Duplicate world
                    </button>
                  </div>
                </div>
              ) : null}

              {activeSidebarTab === 'outliner' ? (
                <div aria-labelledby="scene-sidebar-tab-outliner" className="scene-sidebar-panel" id="scene-sidebar-panel-outliner" role="tabpanel">
                  <div className="scene-sidebar-panel__header">
                    <div>
                      <span>Objects</span>
                      <strong>{sceneDraft?.title || sceneDraft?.name || 'No world open'}</strong>
                    </div>
                    <span>{sceneDraft ? `${rootEntityCount} top-level` : ''}</span>
                  </div>
                  <div className="scene-outliner-actions">
                    <button
                      className="ghost-button ghost-button--sm"
                      disabled={!sceneDraft || !canEdit || busy || !prefabDocuments.length}
                      onClick={() => instantiatePrefab(scenePrimaryPrefab || prefabDocuments[0])}
                      type="button"
                    >
                      Add object
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
                        <span>World</span>
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
                          <span>{row.entity.sourcePrefab}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="scene-empty-state scene-empty-state--compact">
                      Open a world to see its objects.
                    </div>
                  )}
                </div>
              ) : null}

              {activeSidebarTab === 'inspector' ? (
                <div aria-labelledby="scene-sidebar-tab-inspector" className="scene-sidebar-panel" id="scene-sidebar-panel-inspector" role="tabpanel">
                  <div className="scene-sidebar-panel__header">
                    <div>
                      <span>Selection</span>
                      <strong>{selectionInspectorLabel}</strong>
                    </div>
                  </div>

                  {selectedNode === 'scene' && sceneDraft ? (
                    <div className="scene-details">
                      <label className="form-field">
                        <span>World name</span>
                        <input disabled type="text" value={sceneDraft.name} />
                      </label>
                      <label className="form-field">
                        <span>Title</span>
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
                        <span>Reusable object</span>
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
                          {prefabDocuments.length ? null : <option value="">No reusable objects</option>}
                          {prefabDocuments.map((document) => (
                            <option key={document.path} value={document.name}>
                              {document.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <dl className="fact-list">
                        <div>
                          <dt>Objects</dt>
                          <dd>{sceneDraft.entities.length}</dd>
                        </div>
                      </dl>
                      <details className="scene-disclosure scene-disclosure--nested">
                        <summary>Diagnostics</summary>
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
                      </details>
                    </div>
                  ) : null}

                  {selectedNode === 'entity' && selectedEntity && sceneDraft ? (
                    <div className="scene-details">
                      <label className="form-field">
                        <span>Name</span>
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
                        <span>Reusable object</span>
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
                          <option value="">World</option>
                          {sceneDraft.entities
                            .filter((entity) => entity.id !== selectedEntity.id)
                            .map((entity) => (
                              <option key={entity.id} value={entity.id}>
                                {entity.displayName} · {entity.id}
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
                      <details className="scene-disclosure scene-disclosure--nested">
                        <summary>Diagnostics</summary>
                        <dl className="fact-list">
                          <div>
                            <dt>Object ID</dt>
                            <dd>{selectedEntity.id}</dd>
                          </div>
                        </dl>
                      </details>
                    </div>
                  ) : null}

                  {selectedNode === 'prefab' && prefabDraft ? (
                    <div className="scene-details">
                      <label className="form-field">
                        <span>Reusable object</span>
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
                      <details className="scene-disclosure scene-disclosure--nested">
                        <summary>Advanced settings</summary>
                        <div className="scene-disclosure__body">
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
                            <span>Geometry asset</span>
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
                            <span>Material</span>
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
                            <span>Effect</span>
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
                            <span>Effect event</span>
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
                        </div>
                      </details>
                      <details className="scene-disclosure scene-disclosure--nested">
                        <summary>Diagnostics</summary>
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
                      </details>
                    </div>
                  ) : null}

                  {(selectedNode === 'entity' && !selectedEntity) || (selectedNode === 'prefab' && !prefabDraft) ? (
                    <div className="scene-empty-state scene-empty-state--compact">
                      Select an object to inspect it.
                    </div>
                  ) : null}
                </div>
              ) : null}

              {activeSidebarTab === 'assets' ? (
                <div aria-labelledby="scene-sidebar-tab-assets" className="scene-sidebar-panel" id="scene-sidebar-panel-assets" role="tabpanel">
                  <div className="scene-sidebar-panel__header">
                    <div>
                      <span>Library</span>
                      <strong>{prefabDocuments.length ? `${prefabDocuments.length} reusable objects` : 'No reusable objects yet'}</strong>
                    </div>
                    <span>{sceneDraft?.primaryPrefab || 'none'}</span>
                  </div>
                  <div className="scene-asset-list">
                    {prefabDocuments.length ? (
                      prefabDocuments.map((document) => (
                        <div className="scene-asset" key={document.path}>
                          <button
                            className={`scene-asset__main${prefabDraft?.path === document.path ? ' is-active' : ''}`}
                            disabled={busy || draftDetached}
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
                              {sceneDraft?.primaryPrefab === document.name ? 'Used by world' : 'Use for world'}
                            </button>
                            <button
                              className="ghost-button ghost-button--sm"
                              disabled={!sceneDraft || !canEdit || busy}
                              onClick={() => instantiatePrefab(document)}
                              type="button"
                            >
                              Add to world
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="scene-empty-state scene-empty-state--compact">
                        No reusable objects yet.
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
