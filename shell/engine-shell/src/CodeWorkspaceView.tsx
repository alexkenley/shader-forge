import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { MonacoCodeEditor } from './MonacoCodeEditor';
import {
  applyFileReadToTabs,
  bindCodeTab,
  canMutateCodeTab,
  codeTabId,
  hasCodeWorkspaceAuthority,
  previewAuthority,
  retainTabsForSessionChange,
  shouldAcceptCodeRead,
  typedCodeOperationFromConflict,
  type CodeWorkspaceTab,
} from './code-workspace-state';
import {
  fetchOperation,
  listFiles,
  previewFileWrite,
  readFile,
  SessiondRequestError,
  transitionOperation,
  engineShellActor,
  type EngineOperation,
  type EngineSession,
  type SessionFileEntry,
} from './lib/sessiond';

type CodeRevisionConflict = {
  tabId: string;
  operationId: string;
  code: string;
  path: string;
  expectedRevision: string;
  actualRevision: string;
  diagnostic: string;
  message: string;
};

type CodeOperationBinding = {
  operationId: string;
  tabId: string;
  previewDraft: string;
  proposedRevision: string;
};

type TreeNode = {
  entry: SessionFileEntry;
  expanded: boolean;
  loading: boolean;
  children: TreeNode[] | null;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function fileName(path: string) {
  const parts = String(path || '').split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

function countLines(value: string) {
  if (!value) {
    return 1;
  }
  return value.split(/\r\n|\n|\r/).length;
}

function sortEntries(entries: SessionFileEntry[]) {
  return [...entries].sort((left, right) => {
    if (left.kind === 'directory' && right.kind !== 'directory') {
      return -1;
    }
    if (left.kind !== 'directory' && right.kind === 'directory') {
      return 1;
    }
    return left.name.localeCompare(right.name);
  });
}

function toTreeNodes(entries: SessionFileEntry[]): TreeNode[] {
  return sortEntries(entries).map((entry) => ({
    entry,
    expanded: false,
    loading: false,
    children: null,
  }));
}

function updateTreeNode(nodes: TreeNode[], path: string, updater: (node: TreeNode) => TreeNode): TreeNode[] {
  return nodes.map((node) => {
    if (node.entry.path === path) {
      return updater(node);
    }
    if (node.children) {
      return { ...node, children: updateTreeNode(node.children, path, updater) };
    }
    return node;
  });
}

function revisionConflictFromError(
  error: unknown,
  { tabId, operationId, path }: { tabId: string; operationId: string; path: string },
): CodeRevisionConflict | null {
  if (!(error instanceof SessiondRequestError) || error.status !== 409) {
    return null;
  }
  if (!error.conflict || typeof error.conflict !== 'object') {
    return null;
  }
  const conflict = error.conflict as {
    code?: string;
    path?: string;
    expectedRevision?: string;
    actualRevision?: string;
    operationId?: string;
  };
  if (
    conflict.code !== 'revision_conflict'
    || (conflict.path && conflict.path !== path)
    || (conflict.operationId && operationId && conflict.operationId !== operationId)
  ) {
    return null;
  }
  return {
    tabId,
    operationId: conflict.operationId || operationId,
    code: conflict.code,
    path: conflict.path || '',
    expectedRevision: conflict.expectedRevision || '',
    actualRevision: conflict.actualRevision || '',
    diagnostic: error.diagnostic,
    message: error.message,
  };
}

function trustLabel(operation: EngineOperation | null) {
  if (!operation) {
    return 'idle';
  }
  const effect = operation.codeTrustEffect;
  const parts: string[] = [effect.status];
  if (effect.phase) {
    parts.push(effect.phase);
  }
  if (effect.error) {
    parts.push(effect.error);
  }
  return parts.join(' · ');
}

export function CodeWorkspaceView({
  activeSession,
  operationEventEpoch,
}: {
  activeSession: EngineSession | null;
  operationEventEpoch: number;
}) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [treePath, setTreePath] = useState('.');
  const [treeBusy, setTreeBusy] = useState(false);
  const [tabs, setTabs] = useState<CodeWorkspaceTab[]>([]);
  const [activeTabId, setActiveTabId] = useState('');
  const [inspectOpen, setInspectOpen] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(-1);
  const [searchCount, setSearchCount] = useState(0);
  const [cursor, setCursor] = useState({ line: 1, column: 1, lineCount: 1 });
  const [operation, setOperation] = useState<EngineOperation | null>(null);
  const [operationBinding, setOperationBinding] = useState<CodeOperationBinding | null>(null);
  const [conflict, setConflict] = useState<CodeRevisionConflict | null>(null);
  const [pendingCloseTabId, setPendingCloseTabId] = useState('');
  const [status, setStatus] = useState('Select a workspace to browse and edit files.');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const tabsRef = useRef<CodeWorkspaceTab[]>([]);
  const activeTabIdRef = useRef('');
  const operationRef = useRef<EngineOperation | null>(null);
  const operationBindingRef = useRef<CodeOperationBinding | null>(null);
  const activeSessionIdRef = useRef(activeSession?.id || '');
  const previousSessionIdRef = useRef(activeSession?.id || '');
  const treeRequestRef = useRef(0);
  const expandRequestRef = useRef(new Map<string, number>());
  const readRequestRef = useRef(new Map<string, number>());
  const intendedOpenRef = useRef('');
  const actionRequestRef = useRef(0);
  const operationEventRequestRef = useRef(0);
  const dirtyDialogRef = useRef<HTMLDialogElement | null>(null);
  tabsRef.current = tabs;
  activeTabIdRef.current = activeTabId;
  operationRef.current = operation;
  operationBindingRef.current = operationBinding;
  activeSessionIdRef.current = activeSession?.id || '';

  const activeTab = tabs.find((tab) => tab.id === activeTabId) || null;
  const retainedTabIds = tabs.map((tab) => tab.id);
  const canMutate = canMutateCodeTab(activeTab, activeSession?.id || '');
  const operationIsStale = Boolean(operation && activeTab && (
    operationBinding?.operationId !== operation.id
    || operationBinding.tabId !== activeTab.id
    || operationBinding.proposedRevision !== operation.proposedRevision
    || operationBinding.previewDraft !== activeTab.draft
  ));
  const activeConflict = conflict && activeTab && conflict.tabId === activeTab.id ? conflict : null;

  function setActiveOperation(next: EngineOperation | null) {
    operationRef.current = next;
    setOperation(next);
    if (!next || operationBindingRef.current?.operationId !== next.id) {
      operationBindingRef.current = null;
      setOperationBinding(null);
    }
  }

  function bindActiveOperation(next: EngineOperation, tab: CodeWorkspaceTab, previewDraft: string) {
    const binding = {
      operationId: next.id,
      tabId: tab.id,
      previewDraft,
      proposedRevision: next.proposedRevision,
    };
    operationRef.current = next;
    operationBindingRef.current = binding;
    setOperation(next);
    setOperationBinding(binding);
  }

  function updateTab(tabId: string, updater: (tab: CodeWorkspaceTab) => CodeWorkspaceTab) {
    setTabs((current) => current.map((tab) => (tab.id === tabId ? updater(tab) : tab)));
  }

  function activateTab(tabId: string) {
    intendedOpenRef.current = tabId;
    if (activeTabIdRef.current !== tabId) {
      activeTabIdRef.current = tabId;
      actionRequestRef.current += 1;
      operationEventRequestRef.current += 1;
      setBusy(false);
    }
    setActiveTabId(tabId);
  }

  function handleDraftChange(tabId: string, draft: string) {
    setTabs((current) => current.map((tab) => {
      if (tab.id !== tabId) {
        return tab;
      }
      return {
        ...tab,
        draft,
        dirty: draft !== tab.baseline,
      };
    }));
  }

  async function loadRoot(sessionId: string) {
    const requestId = ++treeRequestRef.current;
    setTreeBusy(true);
    try {
      const listing = await listFiles(sessionId, '.');
      if (treeRequestRef.current !== requestId || activeSessionIdRef.current !== sessionId) {
        return;
      }
      if (listing.session.id !== sessionId) {
        return;
      }
      setTreePath(listing.path || '.');
      setTree(toTreeNodes(listing.entries));
    } catch (caught) {
      if (treeRequestRef.current !== requestId || activeSessionIdRef.current !== sessionId) {
        return;
      }
      setError(errorMessage(caught));
      setStatus('Workspace files could not be listed.');
    } finally {
      if (treeRequestRef.current === requestId && activeSessionIdRef.current === sessionId) {
        setTreeBusy(false);
      }
    }
  }

  async function expandDirectory(sessionId: string, path: string) {
    const requestId = (expandRequestRef.current.get(path) || 0) + 1;
    expandRequestRef.current.set(path, requestId);
    setTree((current) => updateTreeNode(current, path, (node) => ({ ...node, expanded: true, loading: true })));
    try {
      const listing = await listFiles(sessionId, path);
      if (expandRequestRef.current.get(path) !== requestId || activeSessionIdRef.current !== sessionId) {
        return;
      }
      if (listing.session.id !== sessionId) {
        return;
      }
      setTree((current) => updateTreeNode(current, path, (node) => ({
        ...node,
        expanded: true,
        loading: false,
        children: toTreeNodes(listing.entries),
      })));
    } catch (caught) {
      if (expandRequestRef.current.get(path) !== requestId || activeSessionIdRef.current !== sessionId) {
        return;
      }
      setError(errorMessage(caught));
      setTree((current) => updateTreeNode(current, path, (node) => ({ ...node, expanded: false, loading: false })));
    }
  }

  function collapseDirectory(path: string) {
    expandRequestRef.current.set(path, (expandRequestRef.current.get(path) || 0) + 1);
    setTree((current) => updateTreeNode(current, path, (node) => ({
      ...node,
      expanded: false,
      loading: false,
    })));
  }

  async function openExactFile(sessionId: string, path: string) {
    const tabId = codeTabId(sessionId, path);
    intendedOpenRef.current = tabId;
    const existing = tabsRef.current.find((tab) => tab.id === tabId);
    if (existing) {
      activateTab(existing.id);
      setStatus(existing.detached
        ? 'Detached unsaved tab kept until closed. It cannot preview under the current workspace.'
        : `Opened ${path}.`);
      return;
    }

    const requestId = (readRequestRef.current.get(tabId) || 0) + 1;
    readRequestRef.current.set(tabId, requestId);
    const actionGeneration = ++actionRequestRef.current;
    setBusy(true);
    setError('');
    try {
      const result = await readFile(sessionId, path);
      if (activeSessionIdRef.current !== sessionId || intendedOpenRef.current !== tabId) {
        return;
      }
      const openTabIds = tabsRef.current.map((tab) => tab.id).concat(tabId);
      if (!shouldAcceptCodeRead({
        requestId,
        latestRequestId: readRequestRef.current.get(tabId) || 0,
        tabId,
        openTabIds,
        resultSessionId: result.session.id,
        expectedSessionId: sessionId,
        resultPath: result.path,
        expectedPath: path,
        activeTabId: activeTabIdRef.current || tabId,
      })) {
        return;
      }
      if (result.session.id !== sessionId || result.path !== path) {
        return;
      }
      const nextTab = bindCodeTab(result.session.id, result.path, result.content, result.revision);
      setTabs((current) => {
        if (current.some((tab) => tab.id === nextTab.id)) {
          return applyFileReadToTabs(
            current,
            nextTab.id,
            result,
            !current.find((tab) => tab.id === nextTab.id)?.dirty,
            current.find((tab) => tab.id === nextTab.id)?.draft || result.content,
          );
        }
        return [...current, nextTab];
      });
      activateTab(nextTab.id);
      setCursor({ line: 1, column: 1, lineCount: countLines(result.content) });
      setStatus(`Loaded ${result.path} at ${result.revision}.`);
    } catch (caught) {
      if (
        readRequestRef.current.get(tabId) !== requestId
        || activeSessionIdRef.current !== sessionId
        || intendedOpenRef.current !== tabId
      ) {
        return;
      }
      setError(errorMessage(caught));
      setStatus('The selected file could not be opened.');
    } finally {
      if (actionRequestRef.current === actionGeneration) {
        setBusy(false);
      }
    }
  }

  async function rereadTab(
    tab: CodeWorkspaceTab,
    { replaceDraft, expectedDraft = tab.draft }: { replaceDraft: boolean; expectedDraft?: string },
  ) {
    const requestId = (readRequestRef.current.get(tab.id) || 0) + 1;
    readRequestRef.current.set(tab.id, requestId);
    const result = await readFile(tab.sessionId, tab.path);
    if (activeSessionIdRef.current !== tab.sessionId) {
      return null;
    }
    const openTabIds = tabsRef.current.map((entry) => entry.id);
    if (!shouldAcceptCodeRead({
      requestId,
      latestRequestId: readRequestRef.current.get(tab.id) || 0,
      tabId: tab.id,
      openTabIds,
      resultSessionId: result.session.id,
      expectedSessionId: tab.sessionId,
      resultPath: result.path,
      expectedPath: tab.path,
      activeTabId: activeTabIdRef.current,
      requireActiveTab: true,
    })) {
      return null;
    }
    if (result.session.id !== tab.sessionId || result.path !== tab.path) {
      return null;
    }
    setTabs((current) => applyFileReadToTabs(current, tab.id, result, replaceDraft, expectedDraft));
    return result;
  }

  function requestCloseTab(tab: CodeWorkspaceTab) {
    if (tab.dirty) {
      setPendingCloseTabId(tab.id);
      setStatus('Unsaved draft is NOT APPLIED. Confirm close to discard, or keep editing.');
      return;
    }
    closeTab(tab.id);
  }

  function closeTab(tabId: string) {
    readRequestRef.current.set(tabId, (readRequestRef.current.get(tabId) || 0) + 1);
    const remaining = tabsRef.current.filter((tab) => tab.id !== tabId);
    tabsRef.current = remaining;
    const nextActiveTabId = activeTabIdRef.current === tabId
      ? remaining[remaining.length - 1]?.id || ''
      : activeTabIdRef.current;
    setTabs(remaining);
    setPendingCloseTabId('');
    if (operationRef.current && codeTabId(operationRef.current.sessionId, operationRef.current.path) === tabId) {
      setActiveOperation(null);
    }
    activateTab(nextActiveTabId);
    if (conflict?.tabId === tabId) {
      setConflict(null);
    }
    window.requestAnimationFrame(() => {
      const nextTab = Array.from(document.querySelectorAll<HTMLElement>('[data-code-tab-id]'))
        .find((element) => element.dataset.codeTabId === nextActiveTabId);
      (nextTab || document.querySelector<HTMLElement>('.code-workspace__tree-row'))?.focus();
    });
  }

  async function runAction(action: (stillCurrent: () => boolean) => Promise<void>) {
    const requestId = ++actionRequestRef.current;
    const authoritySessionId = activeSessionIdRef.current;
    const authorityTabId = activeTabIdRef.current;
    const authorityTab = tabsRef.current.find((tab) => tab.id === authorityTabId) || null;
    const authorityOperationId = operationRef.current?.id || '';
    const stillCurrent = () => hasCodeWorkspaceAuthority({
      requestId,
      latestRequestId: actionRequestRef.current,
      sessionId: authoritySessionId,
      activeSessionId: activeSessionIdRef.current,
      tabId: authorityTabId,
      activeTabId: activeTabIdRef.current,
      operationId: authorityOperationId,
      activeOperationId: operationRef.current?.id || '',
    });
    setBusy(true);
    setError('');
    try {
      await action(stillCurrent);
    } catch (caught) {
      if (!stillCurrent()) {
        return;
      }
      const nextConflict = revisionConflictFromError(caught, {
        tabId: authorityTabId,
        operationId: authorityOperationId,
        path: authorityTab?.path || '',
      });
      if (nextConflict) {
        setConflict(nextConflict);
        setStatus('Revision conflict. The unsaved draft was preserved. Reload the baseline, then Re-preview. The editor was not overwritten.');
      }
      const authoritative = typedCodeOperationFromConflict<EngineOperation>(caught, {
        operationId: authorityOperationId,
        sessionId: authoritySessionId,
        path: authorityTab?.path || '',
      });
      if (authoritative) {
        setActiveOperation(authoritative);
      }
      setError(errorMessage(caught));
    } finally {
      if (actionRequestRef.current === requestId) {
        setBusy(false);
      }
    }
  }

  function handlePreview() {
    void runAction(async (stillCurrent) => {
      if (!activeTab || !activeSession) {
        throw new Error('Open a workspace file before previewing.');
      }
      const body = previewAuthority(activeTab, activeSession.id);
      const nextOperation = await previewFileWrite({
        sessionId: body.sessionId,
        path: body.path,
        content: body.content,
        baseRevision: body.baseRevision,
      });
      if (!stillCurrent()) {
        return;
      }
      if (nextOperation.sessionId !== body.sessionId || nextOperation.path !== body.path || nextOperation.baseRevision !== body.baseRevision) {
        throw new Error('Sessiond returned a file-write preview for a different session, path, or revision.');
      }
      setConflict(null);
      bindActiveOperation(nextOperation, activeTab, body.content);
      setStatus(`Previewed ${nextOperation.path}. NOT APPLIED. ${nextOperation.preview.summary}`);
    });
  }

  function handleReload() {
    void runAction(async (stillCurrent) => {
      if (!activeTab) {
        throw new Error('No file is open.');
      }
      const latest = await rereadTab(activeTab, { replaceDraft: false });
      if (!latest || !stillCurrent()) {
        return;
      }
      setConflict(null);
      setStatus(`Reloaded baseline ${latest.revision}. The unsaved draft was preserved; Re-preview to stage it against the current revision.`);
    });
  }

  function handleTransition(action: 'approve' | 'reject' | 'apply' | 'undo') {
    void runAction(async (stillCurrent) => {
      const current = operationRef.current;
      const tab = activeTab;
      if (!current) {
        throw new Error('No file-write operation is active.');
      }
      if (tab && (current.sessionId !== tab.sessionId || current.path !== tab.path)) {
        throw new Error('The active operation does not belong to this tab.');
      }
      if ((action === 'approve' || action === 'apply') && (
        !tab
        || operationBindingRef.current?.operationId !== current.id
        || operationBindingRef.current.tabId !== tab.id
        || operationBindingRef.current.proposedRevision !== current.proposedRevision
        || operationBindingRef.current.previewDraft !== tab.draft
      )) {
        throw new Error('The draft changed after preview. Re-preview before approving or applying.');
      }
      if ((action === 'apply' || action === 'undo') && tab && !canMutateCodeTab(tab, activeSessionIdRef.current)) {
        throw new Error('Detached or foreign-session tabs cannot mutate under the current workspace authority.');
      }
      const expectedDraft = action === 'apply'
        ? operationBindingRef.current?.operationId === current.id
          && operationBindingRef.current.tabId === tab?.id
          ? operationBindingRef.current.previewDraft
          : ''
        : tab?.baseline || '';
      const result = await transitionOperation(current.id, action, { actor: engineShellActor });
      if (!stillCurrent() || operationRef.current?.id !== current.id) {
        return;
      }
      if (result.operation.id !== current.id) {
        throw new Error('Sessiond returned a different operation.');
      }
      setActiveOperation(result.operation);
      if (action === 'approve') {
        setStatus('Candidate approved, still NOT APPLIED. Apply writes the reviewed bytes.');
        return;
      }
      if (action === 'reject') {
        setActiveOperation(null);
        setStatus('Candidate rejected. The workspace file was not changed, and the unsaved draft remains.');
        return;
      }
      if (!tab) {
        return;
      }
      const latest = await rereadTab(tab, { replaceDraft: true, expectedDraft });
      if (!latest || !stillCurrent()) {
        return;
      }
      if (action === 'apply') {
        setStatus(`Applied ${latest.path} at ${latest.revision}.`);
      } else {
        setActiveOperation(null);
        setStatus(`Undid ${latest.path}. Restored revision ${latest.revision}.`);
      }
    });
  }

  useEffect(() => {
    const nextSessionId = activeSession?.id || '';
    const previousSessionId = previousSessionIdRef.current;
    previousSessionIdRef.current = nextSessionId;
    actionRequestRef.current += 1;
    operationEventRequestRef.current += 1;
    treeRequestRef.current += 1;
    readRequestRef.current.clear();
    expandRequestRef.current.clear();
    intendedOpenRef.current = '';
    setBusy(false);
    setPendingCloseTabId('');
    setConflict(null);
    setSearchQuery('');
    setSearchIndex(-1);
    setSearchCount(0);
    setShowDiff(false);
    setError('');
    setActiveOperation(null);
    const retained = retainTabsForSessionChange(tabsRef.current, nextSessionId);
    tabsRef.current = retained;
    setTabs(retained);
    const nextActiveTabId = retained.find((tab) => tab.id === activeTabIdRef.current)?.id || retained[0]?.id || '';
    activeTabIdRef.current = nextActiveTabId;
    setActiveTabId(nextActiveTabId);
    if (!nextSessionId) {
      setTree([]);
      setStatus('Select a workspace to browse and edit files.');
      return;
    }
    setStatus(previousSessionId
      ? 'Workspace changed. Clean tabs were closed; unsaved tabs stay detached until closed.'
      : 'Workspace files loaded.');
    void loadRoot(nextSessionId);
  }, [activeSession?.id]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!tabsRef.current.some((tab) => tab.dirty)) {
        return;
      }
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  useEffect(() => {
    if (!pendingCloseTabId) {
      return;
    }
    const dialog = dirtyDialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (dialog && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLElement>('button')?.focus();
    }
    return () => {
      if (dialog?.open) {
        dialog.close();
      }
      previousFocus?.focus();
    };
  }, [pendingCloseTabId]);

  useEffect(() => {
    if (operationEventEpoch <= 0) {
      return;
    }
    const current = operationRef.current;
    if (!current) {
      return;
    }
    const requestId = ++operationEventRequestRef.current;
    const expectedOperationId = current.id;
    const expectedSessionId = current.sessionId;
    const expectedPath = current.path;
    const expectedTabId = codeTabId(expectedSessionId, expectedPath);
    const stillCurrent = () => hasCodeWorkspaceAuthority({
      requestId,
      latestRequestId: operationEventRequestRef.current,
      sessionId: expectedSessionId,
      activeSessionId: activeSessionIdRef.current,
      tabId: expectedTabId,
      activeTabId: activeTabIdRef.current,
      operationId: expectedOperationId,
      activeOperationId: operationRef.current?.id || '',
    });
    if (!stillCurrent()) {
      return;
    }
    void fetchOperation(expectedOperationId).then(async (authoritative) => {
      if (!stillCurrent()) {
        return;
      }
      if (
        authoritative.id !== expectedOperationId
        || authoritative.sessionId !== expectedSessionId
        || authoritative.path !== expectedPath
      ) {
        return;
      }
      setActiveOperation(authoritative);
      if (authoritative.state === 'approved') {
        setStatus('Candidate approved externally, still NOT APPLIED.');
        return;
      }
      if (authoritative.state === 'rejected') {
        setActiveOperation(null);
        setStatus('Candidate rejected externally. The workspace file was not changed.');
        return;
      }
      if (authoritative.state === 'conflicted') {
        const latestConflict = [...authoritative.events].reverse().find((event) => event.conflict)?.conflict;
        if (latestConflict?.code !== 'revision_conflict') {
          setError(latestConflict?.code === 'code_trust_artifact_conflict'
            ? 'Code-trust artifact changed. Resolve the artifact conflict from Activity before retrying.'
            : 'The operation state changed. Refresh Activity before retrying.');
          setStatus('The operation could not be completed; the unsaved draft was preserved.');
          return;
        }
        const tabId = codeTabId(expectedSessionId, expectedPath);
        setConflict({
          tabId,
          operationId: expectedOperationId,
          code: 'revision_conflict',
          path: authoritative.path,
          expectedRevision: authoritative.baseRevision,
          actualRevision: '',
          diagnostic: '',
          message: 'The active operation conflicted. The unsaved draft was preserved.',
        });
        setStatus('The active operation conflicted. The unsaved draft was preserved. Reload and Re-preview explicitly.');
        return;
      }
      if (authoritative.state !== 'applied' && authoritative.state !== 'undone') {
        return;
      }
      const tab = tabsRef.current.find((entry) => entry.sessionId === expectedSessionId && entry.path === expectedPath);
      if (!tab) {
        return;
      }
      const expectedDraft = authoritative.state === 'applied'
        && operationBindingRef.current?.operationId === expectedOperationId
        && operationBindingRef.current.tabId === expectedTabId
        ? operationBindingRef.current.previewDraft
        : tab.baseline;
      await rereadTab(tab, { replaceDraft: true, expectedDraft });
      if (!stillCurrent()) {
        return;
      }
      if (authoritative.state === 'undone') {
        setActiveOperation(null);
      }
    }).catch((caught) => {
      if (!stillCurrent()) {
        return;
      }
      setError(`Could not refresh the active file operation: ${errorMessage(caught)}`);
    });
    return () => {
      if (operationEventRequestRef.current === requestId) {
        operationEventRequestRef.current += 1;
      }
    };
  }, [operationEventEpoch, activeTabId]);

  function handleTreeActivate(node: TreeNode) {
    if (!activeSession) {
      return;
    }
    if (node.entry.kind === 'directory') {
      if (node.expanded) {
        collapseDirectory(node.entry.path);
      } else {
        void expandDirectory(activeSession.id, node.entry.path);
      }
      return;
    }
    if (node.entry.kind === 'file') {
      void openExactFile(activeSession.id, node.entry.path);
    }
  }

  function handleFileTabKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (!tabs.length) {
      return;
    }
    const currentIndex = Math.max(0, tabs.findIndex((tab) => tab.id === activeTabId));
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (currentIndex + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1;
    } else if (event.key === 'Delete' && activeTab) {
      event.preventDefault();
      requestCloseTab(activeTab);
      return;
    } else {
      return;
    }
    event.preventDefault();
    const next = tabs[nextIndex];
    intendedOpenRef.current = next.id;
    activateTab(next.id);
    const button = event.currentTarget.querySelector<HTMLElement>(`[data-code-tab-id="${CSS.escape(next.id)}"]`);
    button?.focus();
  }

  function moveSearch(direction: 1 | -1) {
    if (!searchQuery || searchCount <= 0) {
      return;
    }
    setSearchIndex((current) => {
      if (current < 0) {
        return 0;
      }
      return (current + direction + searchCount) % searchCount;
    });
  }

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      moveSearch(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setSearchQuery('');
      setSearchIndex(-1);
      setSearchCount(0);
    }
  }

  function renderTree(nodes: TreeNode[], depth: number) {
    return nodes.map((node) => {
      const isDirectory = node.entry.kind === 'directory';
      const selected = activeTab?.path === node.entry.path && activeTab.sessionId === activeSession?.id;
      return (
        <div className="code-workspace__tree-item" key={node.entry.path} style={{ paddingLeft: `${8 + depth * 14}px` }}>
          <button
            aria-current={selected ? 'true' : undefined}
            aria-expanded={isDirectory ? node.expanded : undefined}
            className={`code-workspace__tree-row${selected ? ' is-active' : ''}${isDirectory ? ' is-dir' : ''}`}
            onClick={() => handleTreeActivate(node)}
            type="button"
          >
            <span aria-hidden="true">{isDirectory ? (node.expanded ? '▾' : '▸') : '•'}</span>
            <span>{node.entry.name}</span>
          </button>
          {isDirectory && node.expanded ? (
            <div>
              {node.loading ? <div className="code-workspace__hint">Loading…</div> : null}
              {node.children ? renderTree(node.children, depth + 1) : null}
            </div>
          ) : null}
        </div>
      );
    });
  }

  const searchStatus = searchQuery
    ? (searchCount > 0 && searchIndex >= 0 ? `${searchIndex + 1}/${searchCount}` : `0/${searchCount}`)
    : 'Find in file';
  const pendingCloseTab = tabs.find((tab) => tab.id === pendingCloseTabId) || null;

  return (
    <div className="code-workspace">
      <aside aria-label="Workspace files" className="code-workspace__tree">
        <header>
          <div className="surface-eyebrow">Code workspace</div>
          <h2>Files</h2>
          <p>{activeSession ? activeSession.rootPath : 'No workspace selected'}</p>
        </header>
        {!activeSession ? (
          <div className="code-workspace__hint">Select a workspace to browse files through bounded list/read.</div>
        ) : treeBusy && !tree.length ? (
          <div className="code-workspace__hint">Listing {treePath}…</div>
        ) : tree.length ? (
          <div className="code-workspace__tree-list">{renderTree(tree, 0)}</div>
        ) : (
          <div className="code-workspace__hint">No files in {treePath}.</div>
        )}
      </aside>

      <section className="code-workspace__main" aria-label="Code editor">
        <div
          aria-label="Open files"
          className="code-workspace__tabs"
          onKeyDown={handleFileTabKeyDown}
          role="tablist"
        >
          {tabs.map((tab) => {
            const selected = tab.id === activeTabId;
            const label = `${fileName(tab.path)}${tab.dirty ? ', unsaved' : ''}${tab.detached ? ', detached' : ''}`;
            return (
              <div className={`code-workspace__tab${selected ? ' is-active' : ''}${tab.detached ? ' is-detached' : ''}`} key={tab.id}>
                <button
                  aria-label={label}
                  aria-selected={selected}
                  className="code-workspace__tab-button"
                  data-code-tab-id={tab.id}
                  onClick={() => {
                    activateTab(tab.id);
                  }}
                  role="tab"
                  tabIndex={selected ? 0 : -1}
                  type="button"
                >
                  <span>{fileName(tab.path)}</span>
                  {tab.dirty ? <span aria-hidden="true" className="code-workspace__dirty" title="Unsaved draft, NOT APPLIED">•</span> : null}
                  {tab.detached ? <span className="code-workspace__detached">detached</span> : null}
                </button>
                <button
                  aria-label={`Close ${label}`}
                  className="code-workspace__tab-close"
                  onClick={() => requestCloseTab(tab)}
                  type="button"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>

        <div className="code-workspace__toolbar">
          <div className="code-workspace__search" role="search" aria-label="Search in current file">
            <input
              aria-label="Search in current file"
              data-code-editor-search-input
              disabled={!activeTab}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setSearchIndex(event.target.value ? 0 : -1);
              }}
              onKeyDown={handleSearchKeyDown}
              placeholder="Search in file"
              type="search"
              value={searchQuery}
            />
            <span aria-live="polite" data-code-editor-search-status>{searchStatus}</span>
            <button
              aria-label="Previous match"
              data-code-editor-search-prev
              disabled={!searchQuery || searchCount === 0}
              onClick={() => moveSearch(-1)}
              type="button"
            >
              Prev
            </button>
            <button
              aria-label="Next match"
              data-code-editor-search-next
              disabled={!searchQuery || searchCount === 0}
              onClick={() => moveSearch(1)}
              type="button"
            >
              Next
            </button>
            <button
              aria-label="Clear search"
              data-code-editor-search-clear
              disabled={!searchQuery}
              onClick={() => {
                setSearchQuery('');
                setSearchIndex(-1);
                setSearchCount(0);
              }}
              type="button"
            >
              Clear
            </button>
          </div>
          <button
            aria-pressed={inspectOpen}
            className="ghost-button ghost-button--sm"
            disabled={!activeTab}
            onClick={() => setInspectOpen((current) => !current)}
            type="button"
          >
            Inspect
          </button>
          <button
            aria-pressed={showDiff}
            className="ghost-button ghost-button--sm"
            disabled={!activeTab}
            onClick={() => setShowDiff((current) => !current)}
            type="button"
          >
            {showDiff ? 'Source only' : 'Diff draft'}
          </button>
          <button className="ghost-button ghost-button--sm" disabled={!canMutate || busy || !activeTab?.dirty} onClick={handlePreview} type="button">
            Preview
          </button>
        </div>

        {error ? <div className="code-workspace__alert" role="alert">{error}</div> : null}
        <div className="code-workspace__status" aria-live="polite">{status}</div>
        {activeTab?.dirty ? (
          <div className="code-workspace__not-applied" role="status">
            Unsaved draft, NOT APPLIED
          </div>
        ) : null}
        {activeTab?.detached ? (
          <div className="code-workspace__alert" role="status">
            This tab is detached from a previous workspace. It keeps its unsaved draft until closed and will not send the old session or revision under the current workspace.
          </div>
        ) : null}
        {operationIsStale ? (
          <div className="code-workspace__not-applied" role="status">
            Draft changed after preview. The reviewed candidate is stale; Re-preview before approving or applying.
          </div>
        ) : null}
        {activeConflict ? (
          <div className="code-workspace__conflict" role="alert">
            <strong>{activeConflict.code}</strong>
            <span>{activeConflict.message}</span>
            {activeConflict.diagnostic ? <span>{activeConflict.diagnostic}</span> : null}
            {activeConflict.expectedRevision ? <code>expected {activeConflict.expectedRevision}</code> : null}
            {activeConflict.actualRevision ? <code>actual {activeConflict.actualRevision}</code> : null}
            <div className="inline-actions">
              <button className="ghost-button ghost-button--sm" disabled={busy || !activeTab} onClick={handleReload} type="button">
                Reload
              </button>
              <button className="ghost-button ghost-button--sm" disabled={busy || !canMutate} onClick={handlePreview} type="button">
                Re-preview
              </button>
            </div>
          </div>
        ) : null}

        <div className={`code-workspace__editor-shell${inspectOpen ? ' has-inspect' : ''}`}>
          {activeTab ? (
            <MonacoCodeEditor
              baseline={activeTab.baseline}
              draft={activeTab.draft}
              onCursorChange={(line, column, lineCount) => setCursor({ line, column, lineCount })}
              onDraftChange={(value) => handleDraftChange(activeTab.id, value)}
              onSearchMatches={(count) => {
                setSearchCount(count);
                setSearchIndex((current) => {
                  if (!searchQuery || count === 0) {
                    return -1;
                  }
                  if (current < 0) {
                    return 0;
                  }
                  return current % count;
                });
              }}
              path={activeTab.path}
              readOnly={!canMutateCodeTab(activeTab, activeSession?.id || '')}
              retainedTabIds={retainedTabIds}
              searchIndex={searchIndex}
              searchQuery={searchQuery}
              showDiff={showDiff}
              tabId={activeTab.id}
            />
          ) : (
            <div className="code-workspace__hint">Open a file from the workspace tree.</div>
          )}
          {inspectOpen && activeTab ? (
            <aside aria-label="File inspect" className="code-workspace__inspect">
              <h3>Inspect</h3>
              <dl>
                <div><dt>Session</dt><dd>{activeTab.sessionId}</dd></div>
                <div><dt>Path</dt><dd>{activeTab.path}</dd></div>
                <div><dt>Revision</dt><dd>{activeTab.revision}</dd></div>
                <div><dt>Dirty</dt><dd>{activeTab.dirty ? 'unsaved draft, NOT APPLIED' : 'clean'}</dd></div>
                <div><dt>Lines</dt><dd>{cursor.lineCount}</dd></div>
                <div><dt>Cursor</dt><dd>{cursor.line}:{cursor.column}</dd></div>
                <div><dt>Detached</dt><dd>{activeTab.detached ? 'yes' : 'no'}</dd></div>
              </dl>
            </aside>
          ) : null}
        </div>

        {operation && activeTab && operation.sessionId === activeTab.sessionId && operation.path === activeTab.path ? (
          <section aria-label="File write operation" className="code-workspace__operation">
            <strong>{operation.state === 'applied' ? operation.state : 'NOT APPLIED'}</strong>
            <span>{operation.id}</span>
            <span>{operation.state}</span>
            <p>{operation.preview.summary}</p>
            <p>{operation.preview.beforeLineCount} lines before · {operation.preview.afterLineCount} after · +{operation.preview.addedLines} / -{operation.preview.removedLines}</p>
            <p>Trust: {trustLabel(operation)}</p>
            {operation.codeTrustEffect.error ? <p role="alert">{operation.codeTrustEffect.error}</p> : null}
            <div className="inline-actions" aria-label="File operation actions">
              <button className="ghost-button ghost-button--sm" disabled={busy || operationIsStale || operation.state !== 'previewed'} onClick={() => handleTransition('approve')} type="button">
                Approve
              </button>
              <button className="ghost-button ghost-button--sm" disabled={busy || !['previewed', 'approved'].includes(operation.state)} onClick={() => handleTransition('reject')} type="button">
                Reject
              </button>
              <button className="ghost-button ghost-button--sm" disabled={busy || operationIsStale || !canMutate || operation.state !== 'approved'} onClick={() => handleTransition('apply')} type="button">
                Apply
              </button>
              <button className="ghost-button ghost-button--sm" disabled={busy || !canMutate || operation.state !== 'applied'} onClick={() => handleTransition('undo')} type="button">
                Undo
              </button>
            </div>
          </section>
        ) : null}

        {pendingCloseTab ? (
          <dialog
            aria-labelledby="code-dirty-close-title"
            className="code-workspace__dialog"
            onCancel={(event) => {
              event.preventDefault();
              setPendingCloseTabId('');
            }}
            ref={dirtyDialogRef}
          >
            <h3 id="code-dirty-close-title">Unsaved draft</h3>
            <p>
              {fileName(pendingCloseTab.path)} has an unsaved draft that is NOT APPLIED. Close discards it only if you confirm.
            </p>
            <div className="inline-actions">
              <button className="ghost-button ghost-button--sm" onClick={() => setPendingCloseTabId('')} type="button">
                Keep editing
              </button>
              <button className="ghost-button ghost-button--sm" onClick={() => closeTab(pendingCloseTab.id)} type="button">
                Close and discard
              </button>
            </div>
          </dialog>
        ) : null}
      </section>
    </div>
  );
}
