export type CodeWorkspaceTab = {
  id: string;
  sessionId: string;
  path: string;
  baseline: string;
  draft: string;
  revision: string;
  dirty: boolean;
  detached: boolean;
};

export function codeTabId(sessionId: string, path: string) {
  return `${sessionId}:${path}`;
}

export function bindCodeTab(sessionId: string, path: string, content: string, revision: string): CodeWorkspaceTab {
  return {
    id: codeTabId(sessionId, path),
    sessionId,
    path,
    baseline: content,
    draft: content,
    revision,
    dirty: false,
    detached: false,
  };
}

export function retainTabsForSessionChange(tabs: CodeWorkspaceTab[], nextSessionId: string) {
  return tabs
    .filter((tab) => tab.dirty)
    .map((tab) => ({
      ...tab,
      detached: tab.sessionId !== nextSessionId,
    }));
}

export function canMutateCodeTab(tab: CodeWorkspaceTab | null | undefined, activeSessionId: string) {
  return Boolean(tab && !tab.detached && tab.sessionId === activeSessionId && tab.path && tab.revision);
}

export function previewAuthority(tab: CodeWorkspaceTab, activeSessionId: string) {
  if (!canMutateCodeTab(tab, activeSessionId)) {
    throw new Error('Detached or foreign-session tabs cannot preview under the current workspace authority.');
  }
  return {
    sessionId: tab.sessionId,
    path: tab.path,
    content: tab.draft,
    baseRevision: tab.revision,
  };
}

export function shouldAcceptCodeRead(options: {
  requestId: number;
  latestRequestId: number;
  tabId: string;
  openTabIds: string[];
  resultSessionId: string;
  expectedSessionId: string;
  resultPath: string;
  expectedPath: string;
  activeTabId: string;
  requireActiveTab?: boolean;
}) {
  if (options.requestId !== options.latestRequestId) {
    return false;
  }
  if (options.requireActiveTab && options.activeTabId !== options.tabId) {
    return false;
  }
  if (options.tabId && !options.openTabIds.includes(options.tabId)) {
    return false;
  }
  return options.resultSessionId === options.expectedSessionId && options.resultPath === options.expectedPath;
}

export function hasCodeWorkspaceAuthority(options: {
  requestId: number;
  latestRequestId: number;
  sessionId: string;
  activeSessionId: string;
  tabId: string;
  activeTabId: string;
  operationId: string;
  activeOperationId: string;
}) {
  return options.requestId === options.latestRequestId
    && options.sessionId === options.activeSessionId
    && options.tabId === options.activeTabId
    && options.operationId === options.activeOperationId;
}

export function typedCodeOperationFromConflict<T extends { id: string; sessionId: string; path: string }>(
  error: unknown,
  expected: { operationId: string; sessionId: string; path: string },
): T | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const record = error as {
    status?: number;
    code?: string;
    conflict?: unknown;
    operation?: T | null;
  };
  if (record.status !== 409 || !expected.operationId) {
    return null;
  }
  const conflictCode = record.conflict && typeof record.conflict === 'object'
    ? (record.conflict as { code?: string }).code
    : '';
  if (
    record.code !== 'operation_state_conflict'
    && conflictCode !== 'revision_conflict'
    && conflictCode !== 'code_trust_artifact_conflict'
  ) {
    return null;
  }
  const candidate = record.operation;
  if (
    !candidate
    || candidate.id !== expected.operationId
    || candidate.sessionId !== expected.sessionId
    || candidate.path !== expected.path
  ) {
    return null;
  }
  return candidate;
}

export function applyFileReadToTabs(
  tabs: CodeWorkspaceTab[],
  tabId: string,
  next: { content: string; revision: string },
  replaceDraft: boolean,
  expectedDraft = '',
) {
  return tabs.map((tab) => {
    if (tab.id !== tabId) {
      return tab;
    }
    const nextDraft = replaceDraft && shouldRefreshCodeBaseline(tab, expectedDraft) ? next.content : tab.draft;
    return {
      ...tab,
      baseline: next.content,
      revision: next.revision,
      draft: nextDraft,
      dirty: nextDraft !== next.content,
    };
  });
}

export function shouldRefreshCodeBaseline(tab: CodeWorkspaceTab, expectedDraft: string) {
  return tab.draft === expectedDraft;
}
