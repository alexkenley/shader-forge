export type SessiondHealth = {
  ok: boolean;
  service: string;
  now: string;
  capabilities: string[];
};

export type PlatformInfo = {
  platform: string;
  isWSL: boolean;
  homePath: string;
  defaultBrowsePath: string;
  windowsMounts: string[];
};

export type EngineSession = {
  id: string;
  name: string;
  rootPath: string;
  createdAt: string;
  updatedAt: string;
};

export type SessionFileEntry = {
  name: string;
  path: string;
  kind: 'file' | 'directory';
  size: number;
  modifiedAt: string;
};

export type SessionFileList = {
  session: EngineSession;
  path: string;
  entries: SessionFileEntry[];
};

export type SessionFileRead = {
  session: EngineSession;
  path: string;
  size: number;
  modifiedAt: string;
  content: string;
};

export type SessionFileWrite = SessionFileRead;

export type HostDirectoryList = {
  path: string;
  entries: SessionFileEntry[];
};

export type GitFileEntry = {
  status: string;
  path: string;
};

export type GitStatus = {
  rootPath: string;
  branch: string;
  staged: GitFileEntry[];
  unstaged: GitFileEntry[];
  untracked: GitFileEntry[];
  notARepo: boolean;
};

export type SessionTerminalOpen = {
  terminalId: string;
  shell: string;
  cwd: string;
  cols: number;
  rows: number;
};

export type RuntimeStatus = {
  state: 'stopped' | 'running' | 'paused';
  scene: string | null;
  sessionId: string | null;
  workspaceRoot: string | null;
  pid: number | null;
  startedAt: string | null;
  pausedAt: string | null;
  executablePath: string | null;
  supportsPause: boolean;
};

export type BuildStatus = {
  state: 'idle' | 'running' | 'succeeded' | 'failed' | 'stopped';
  target: string | null;
  config: string | null;
  buildDir: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  command: string | null;
  exitCode: number | null;
  error: string | null;
};

export type CodeTrustDiagnostic = {
  severity: string;
  code: string;
  message: string;
  suggestion?: string;
};

export type CodeTrustEvaluation = {
  action: string;
  actor: string;
  path: string;
  decision: 'allow' | 'review_required' | 'deny';
  allowed: boolean;
  targetTier: string;
  targetKind: string;
  effectiveOrigin: string;
  requestedOrigin: string | null;
  matchedRuleId: string | null;
  matchedRulePatterns: string[];
  policyPath: string;
  policySource: string;
  supportedHotReloadRoots: string[];
  diagnostics: CodeTrustDiagnostic[];
};

export type CodeTrustApproval = {
  id: string;
  sessionId: string | null;
  requestedBy: string;
  operationType: string;
  summary: string;
  status: 'pending' | 'approved' | 'denied' | 'failed';
  decision: 'approved' | 'denied' | 'failed' | null;
  decisionBy: string | null;
  createdAt: string;
  resolvedAt: string | null;
  codeTrust: CodeTrustEvaluation | null;
  outcome: unknown;
};

export type AiProviderStatus = {
  id: string;
  type: string;
  label: string;
  enabled: boolean;
  mode: string;
  model: string | null;
  endpoint: string | null;
  apiKeyEnv: string | null;
  supportedInSlice: boolean;
  available: boolean;
  status: string;
  diagnostics: string[];
  installedModels: string[];
  selectedModel: string | null;
};

export type AiProviderSummary = {
  rootPath: string;
  configPath: string;
  configSource: string;
  defaultProviderId: string | null;
  providerCount: number;
  readyProviderCount: number;
  providers: AiProviderStatus[];
};

export type AiTestResult = {
  rootPath: string;
  configPath: string;
  providerId: string;
  providerType: string;
  model: string | null;
  content: string;
  finishReason: string;
  durationMs: number;
  requestId: string;
  diagnostics: string[];
  prompt: string;
  systemPrompt: string;
};

export type PackageInspectSummary = {
  schema: string;
  version: number;
  rootPath: string;
  presetId: string;
  label: string;
  platform: string;
  runtimeConfig: string;
  launchScene: string;
  presetPath: string;
  presetSource: string;
  runtimeBinaryPath: string;
  inputRootPath: string;
  contentRootPath: string;
  audioRootPath: string;
  animationRootPath: string;
  physicsRootPath: string;
  dataFoundationPath: string;
  toolingLayoutPath: string;
  cookedRootPath: string;
  assetReportPath: string;
  packageRootPath: string;
  packageReportPath: string;
  platformHooks: string[];
  cookedAssetCount: number;
  generatedMeshCount: number;
  audioSoundCount: number;
  audioEventCount: number;
  animationClipCount: number;
  animationGraphCount: number;
  physicsBodyCount: number;
  lastPackageAt: string | null;
  lastPackageFileCount: number;
  needsRuntimeBuild: boolean;
  needsAssetBake: boolean;
  ready: boolean;
  warnings: string[];
  runtimeBinaryExists: boolean;
  inputRootExists: boolean;
  contentRootExists: boolean;
  audioRootExists: boolean;
  animationRootExists: boolean;
  physicsRootExists: boolean;
  dataFoundationExists: boolean;
  toolingLayoutExists: boolean;
  cookedRootExists: boolean;
};

export type PackageReport = {
  schema: string;
  version: number;
  packagedAt: string;
  rootPath: string;
  presetId: string;
  label: string;
  platform: string;
  runtimeConfig: string;
  launchScene: string;
  presetPath: string;
  presetSource: string;
  packageRootPath: string;
  runtimeBinaryPath: string;
  cookedRootPath: string;
  assetReportPath: string;
  launchManifestPath: string;
  unixLauncherPath: string;
  windowsLauncherPath: string;
  fileCount: number;
  totalBytes: number;
  cookedAssetCount: number;
  generatedMeshCount: number;
  audioSoundCount: number;
  audioEventCount: number;
  animationClipCount: number;
  animationGraphCount: number;
  physicsBodyCount: number;
  prerequisiteActions: Array<{
    id: string;
    status: string;
    message: string;
    outputRoot?: string;
    reportPath?: string;
  }>;
  warnings: string[];
  hookResults: Array<{
    id: string;
    status: string;
    message: string;
  }>;
  files: Array<{
    path: string;
    size: number;
    sha256: string;
  }>;
  reportPath: string;
};

export type ProfilingLiveSummary = {
  schema: string;
  version: number;
  capturedAt: string;
  rootPath: string;
  sessionId: string | null;
  runtime: {
    state: RuntimeStatus['state'];
    scene: string | null;
    sessionId: string | null;
    workspaceRoot: string | null;
    pid: number | null;
    startedAt: string | null;
    pausedAt: string | null;
    executablePath: string | null;
    supportsPause: boolean;
    logTail: string;
    logLineCount: number;
  };
  build: {
    state: BuildStatus['state'];
    target: string | null;
    config: string | null;
    buildDir: string | null;
    startedAt: string | null;
    finishedAt: string | null;
    command: string | null;
    exitCode: number | null;
    error: string | null;
    logTail: string;
    logLineCount: number;
  };
  workspace: {
    git: {
      branch: string;
      stagedCount: number;
      unstagedCount: number;
      untrackedCount: number;
      notARepo: boolean;
    };
    codeTrust: {
      policyPath: string;
      trackedArtifactCount: number;
      promotedArtifactCount: number;
      quarantinedArtifactCount: number;
      verificationIssueCount: number;
    };
    ai: {
      configPath: string;
      configSource: string;
      defaultProviderId: string | null;
      providerCount: number;
      readyProviderCount: number;
    };
    packaging: {
      presetId: string;
      presetPath: string;
      presetSource: string;
      packageRootPath: string;
      runtimeBinaryPath: string;
      cookedRootPath: string;
      ready: boolean;
      warnings: string[];
      cookedAssetCount: number;
      lastPackageAt: string | null;
    };
    profiling: {
      captureRootPath: string;
      captureCount: number;
      recentCaptures: ProfilingCaptureList['captures'];
    };
  };
  recommendations: string[];
};

export type ProfilingCapture = ProfilingLiveSummary & {
  label: string;
  outputPath: string;
};

export type ProfilingCaptureList = {
  schema: string;
  version: number;
  rootPath: string;
  captureRootPath: string;
  captureCount: number;
  captures: Array<{
    label: string;
    outputPath: string;
    capturedAt: string;
    sessionId: string | null;
    runtimeState: string;
    runtimeScene: string | null;
    buildState: string;
    size: number;
  }>;
};

export type CodeTrustSummary = {
  rootPath: string;
  policyPath: string;
  policySource: string;
  summary: string;
  unsafeDevOverrides: {
    allowAssistantEngineWrites: boolean;
    allowAssistantCompile: boolean;
    allowAssistantLoad: boolean;
    allowAssistantHotReload: boolean;
    allowExternalPluginLoad: boolean;
  };
  supportedHotReloadRoots: string[];
  pathRules: Array<{
    id: string;
    description: string;
    trustTier: string;
    kind: string;
    patterns: string[];
    assistantActions: Record<string, string>;
  }>;
  trackedArtifactCount: number;
  promotedArtifactCount: number;
  quarantinedArtifactCount: number;
  verificationIssueCount: number;
  trackedArtifacts: CodeTrustArtifactRecord[];
};

export type CodeTrustArtifactRecord = {
  path: string;
  origin: string;
  targetTier: string;
  targetKind: string;
  lastAction: string;
  updatedAt: string;
  hashAlgorithm: string;
  contentHash: string;
  promotionStatus: 'tracked' | 'promoted' | 'quarantined';
  promotedAt: string | null;
  promotedBy: string | null;
  promotionNote: string;
  quarantinedAt: string | null;
  quarantinedBy: string | null;
  quarantineNote: string;
  verificationStatus: 'verified' | 'modified' | 'missing' | 'unhashed';
  currentHash: string | null;
};

export type SessiondTerminalEvent =
  | {
      type: 'terminal.output';
      data: {
        terminalId: string;
        data: string;
      };
    }
  | {
      type: 'terminal.exit';
      data: {
        terminalId: string;
        exitCode: number;
        signal?: number;
      };
    }
  | {
      type: 'runtime.log';
      data: {
        stream: 'stdout' | 'stderr';
        data: string;
      };
    }
  | {
      type: 'runtime.exit';
      data: {
        scene: string;
        sessionId: string | null;
        workspaceRoot: string | null;
        exitCode: number | null;
        signal: number | null;
        executablePath: string;
      };
    }
  | {
      type: 'runtime.status';
      data: RuntimeStatus;
    }
  | {
      type: 'runtime.started';
      data: RuntimeStatus;
    }
  | {
      type: 'build.log';
      data: {
        stream: 'stdout' | 'stderr';
        data: string;
      };
    }
  | {
      type: 'build.status';
      data: BuildStatus;
    }
  | {
      type: 'build.started';
      data: BuildStatus;
    }
  | {
      type: 'build.completed';
      data: BuildStatus;
    }
  | {
      type: 'code-trust.approval.created';
      data: CodeTrustApproval;
    }
  | {
      type: 'code-trust.approval.resolved';
      data: CodeTrustApproval;
    }
  | {
      type: 'code-trust.artifact.transitioned';
      data: {
        sessionId: string | null;
        transition: 'promote' | 'quarantine';
        artifact: CodeTrustArtifactRecord;
      };
    };

const DEFAULT_SESSIOND_BASE_URL = 'http://127.0.0.1:41741';

export function getSessiondBaseUrl() {
  return import.meta.env.VITE_SESSIOND_BASE_URL || DEFAULT_SESSIOND_BASE_URL;
}

async function requestJson<T>(pathname: string, options: RequestInit = {}) {
  const response = await fetch(new URL(pathname, getSessiondBaseUrl()), {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });

  const payload = (await response.json()) as T | { error?: string };
  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload && 'error' in payload && payload.error
        ? String(payload.error)
        : `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload as T;
}

export async function fetchSessiondHealth() {
  return requestJson<SessiondHealth>('/health');
}

export async function fetchPlatformInfo() {
  return requestJson<PlatformInfo>('/api/platform');
}

export async function listSessions() {
  const payload = await requestJson<{ sessions: EngineSession[] }>('/api/sessions');
  return payload.sessions;
}

export async function createSession(options: { name?: string; rootPath?: string } = {}) {
  const payload = await requestJson<{ session: EngineSession }>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({
      ...(options.name ? { name: options.name } : {}),
      ...(options.rootPath ? { rootPath: options.rootPath } : {}),
    }),
  });
  return payload.session;
}

export async function updateSession(
  sessionId: string,
  options: { name?: string; rootPath?: string } = {},
) {
  const payload = await requestJson<{ session: EngineSession }>(
    `/api/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: 'PATCH',
      body: JSON.stringify({
        ...(options.name ? { name: options.name } : {}),
        ...(options.rootPath ? { rootPath: options.rootPath } : {}),
      }),
    },
  );
  return payload.session;
}

export async function deleteSession(sessionId: string) {
  return requestJson<{ ok: boolean }>(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  });
}

export async function listFiles(sessionId: string, relativePath = '.') {
  const query = new URL('/api/files/list', getSessiondBaseUrl());
  query.searchParams.set('sessionId', sessionId);
  query.searchParams.set('path', relativePath);
  return requestJson<SessionFileList>(`${query.pathname}${query.search}`);
}

export async function readFile(sessionId: string, relativePath: string) {
  const query = new URL('/api/files/read', getSessiondBaseUrl());
  query.searchParams.set('sessionId', sessionId);
  query.searchParams.set('path', relativePath);
  return requestJson<SessionFileRead>(`${query.pathname}${query.search}`);
}

export async function writeFile(sessionId: string, relativePath: string, content: string) {
  return requestJson<SessionFileWrite>('/api/files/write', {
    method: 'POST',
    body: JSON.stringify({
      sessionId,
      path: relativePath,
      content,
    }),
  });
}

export async function listHostDirectories(targetPath = '/') {
  const query = new URL('/api/hostfs/list', getSessiondBaseUrl());
  query.searchParams.set('path', targetPath);
  return requestJson<HostDirectoryList>(`${query.pathname}${query.search}`);
}

export async function fetchGitStatus(sessionId: string) {
  const query = new URL('/api/git/status', getSessiondBaseUrl());
  query.searchParams.set('sessionId', sessionId);
  return requestJson<GitStatus>(`${query.pathname}${query.search}`);
}

export async function initGitRepository(sessionId: string) {
  return requestJson<GitStatus>('/api/git/init', {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  });
}

export async function fetchCodeTrustSummary(sessionId: string) {
  const query = new URL('/api/code-trust/summary', getSessiondBaseUrl());
  query.searchParams.set('sessionId', sessionId);
  return requestJson<CodeTrustSummary>(`${query.pathname}${query.search}`);
}

export async function fetchAiProviders(sessionId: string) {
  const query = new URL('/api/ai/providers', getSessiondBaseUrl());
  query.searchParams.set('sessionId', sessionId);
  return requestJson<AiProviderSummary>(`${query.pathname}${query.search}`);
}

export async function runAiSmokeTest(
  sessionId: string,
  options: { providerId?: string; prompt?: string; systemPrompt?: string } = {},
) {
  return requestJson<AiTestResult>('/api/ai/test', {
    method: 'POST',
    body: JSON.stringify({
      sessionId,
      ...(options.providerId ? { providerId: options.providerId } : {}),
      ...(options.prompt ? { prompt: options.prompt } : {}),
      ...(options.systemPrompt ? { systemPrompt: options.systemPrompt } : {}),
    }),
  });
}

export async function fetchPackageInspect(sessionId: string, presetId = 'default') {
  const query = new URL('/api/package/inspect', getSessiondBaseUrl());
  query.searchParams.set('sessionId', sessionId);
  query.searchParams.set('preset', presetId);
  return requestJson<PackageInspectSummary>(`${query.pathname}${query.search}`);
}

export async function runPackageRelease(
  sessionId: string,
  options: {
    presetId?: string;
    packageRoot?: string;
    prepareCookedAssets?: boolean;
    forceBake?: boolean;
  } = {},
) {
  return requestJson<PackageReport>('/api/package/run', {
    method: 'POST',
    body: JSON.stringify({
      sessionId,
      ...(options.presetId ? { presetId: options.presetId } : {}),
      ...(options.packageRoot ? { packageRoot: options.packageRoot } : {}),
      ...(options.prepareCookedAssets === false ? { prepareCookedAssets: false } : {}),
      ...(options.forceBake ? { forceBake: true } : {}),
    }),
  });
}

export async function fetchProfileLive(sessionId: string, presetId = 'default') {
  const query = new URL('/api/profile/live', getSessiondBaseUrl());
  query.searchParams.set('sessionId', sessionId);
  query.searchParams.set('preset', presetId);
  return requestJson<ProfilingLiveSummary>(`${query.pathname}${query.search}`);
}

export async function captureProfile(
  sessionId: string,
  options: { presetId?: string; label?: string; outputPath?: string } = {},
) {
  return requestJson<ProfilingCapture>('/api/profile/capture', {
    method: 'POST',
    body: JSON.stringify({
      sessionId,
      ...(options.presetId ? { presetId: options.presetId } : {}),
      ...(options.label ? { label: options.label } : {}),
      ...(options.outputPath ? { outputPath: options.outputPath } : {}),
    }),
  });
}

export async function fetchProfileCaptures(sessionId: string, limit = 10) {
  const query = new URL('/api/profile/captures', getSessiondBaseUrl());
  query.searchParams.set('sessionId', sessionId);
  query.searchParams.set('limit', String(limit));
  return requestJson<ProfilingCaptureList>(`${query.pathname}${query.search}`);
}

export async function fetchCodeTrustApprovals(sessionId: string, state = 'pending') {
  const query = new URL('/api/code-trust/approvals', getSessiondBaseUrl());
  query.searchParams.set('sessionId', sessionId);
  query.searchParams.set('state', state);
  const payload = await requestJson<{ approvals: CodeTrustApproval[] }>(`${query.pathname}${query.search}`);
  return payload.approvals;
}

export async function decideCodeTrustApproval(
  approvalId: string,
  decision: 'approved' | 'denied',
  decisionBy = 'human',
) {
  return requestJson<{ approval: CodeTrustApproval; outcome?: unknown }>(
    `/api/code-trust/approvals/${encodeURIComponent(approvalId)}/decision`,
    {
      method: 'POST',
      body: JSON.stringify({ decision, decisionBy }),
    },
  );
}

export async function transitionCodeTrustArtifact(
  sessionId: string,
  path: string,
  transition: 'promote' | 'quarantine',
  decisionBy = 'human',
  note = '',
) {
  return requestJson<{ artifact: CodeTrustArtifactRecord }>('/api/code-trust/artifacts/transition', {
    method: 'POST',
    body: JSON.stringify({
      sessionId,
      path,
      transition,
      decisionBy,
      ...(note ? { note } : {}),
    }),
  });
}

export async function openTerminal(payload: {
  sessionId?: string;
  cwd?: string;
  shell?: string;
  cols?: number;
  rows?: number;
}) {
  return requestJson<SessionTerminalOpen>('/api/terminals', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function writeTerminalInput(terminalId: string, input: string) {
  return requestJson<{ ok: boolean }>(`/api/terminals/${encodeURIComponent(terminalId)}/input`, {
    method: 'POST',
    body: JSON.stringify({ input }),
  });
}

export async function resizeTerminal(terminalId: string, cols: number, rows: number) {
  return requestJson<{ terminalId: string; cols: number; rows: number }>(
    `/api/terminals/${encodeURIComponent(terminalId)}/resize`,
    {
      method: 'POST',
      body: JSON.stringify({ cols, rows }),
    },
  );
}

export async function closeTerminal(terminalId: string) {
  return requestJson<{ ok: boolean }>(`/api/terminals/${encodeURIComponent(terminalId)}`, {
    method: 'DELETE',
  });
}

export async function fetchRuntimeStatus() {
  return requestJson<RuntimeStatus>('/api/runtime/status');
}

export async function startRuntime(scene = 'sandbox', sessionId?: string) {
  return requestJson<RuntimeStatus>('/api/runtime/start', {
    method: 'POST',
    body: JSON.stringify({
      scene,
      ...(sessionId ? { sessionId } : {}),
    }),
  });
}

export async function stopRuntime() {
  return requestJson<RuntimeStatus>('/api/runtime/stop', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function pauseRuntime() {
  return requestJson<RuntimeStatus>('/api/runtime/pause', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function resumeRuntime() {
  return requestJson<RuntimeStatus>('/api/runtime/resume', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function restartRuntime(scene = 'sandbox', sessionId?: string) {
  return requestJson<RuntimeStatus>('/api/runtime/restart', {
    method: 'POST',
    body: JSON.stringify({
      scene,
      ...(sessionId ? { sessionId } : {}),
    }),
  });
}

export async function fetchBuildStatus() {
  return requestJson<BuildStatus>('/api/build/status');
}

export async function startRuntimeBuild(config = 'Debug', buildDir?: string) {
  return requestJson<BuildStatus>('/api/build/runtime', {
    method: 'POST',
    body: JSON.stringify({
      config,
      ...(buildDir ? { buildDir } : {}),
    }),
  });
}

export async function stopBuild() {
  return requestJson<BuildStatus>('/api/build/stop', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function subscribeSessiondEvents(onEvent: (event: SessiondTerminalEvent) => void) {
  const eventSource = new EventSource(new URL('/api/events', getSessiondBaseUrl()).toString());
  const outputHandler = (message: MessageEvent<string>) => {
    onEvent({
      type: 'terminal.output',
      data: JSON.parse(message.data) as Extract<SessiondTerminalEvent, { type: 'terminal.output' }>['data'],
    });
  };
  const exitHandler = (message: MessageEvent<string>) => {
    onEvent({
      type: 'terminal.exit',
      data: JSON.parse(message.data) as Extract<SessiondTerminalEvent, { type: 'terminal.exit' }>['data'],
    });
  };
  const runtimeLogHandler = (message: MessageEvent<string>) => {
    onEvent({
      type: 'runtime.log',
      data: JSON.parse(message.data) as Extract<SessiondTerminalEvent, { type: 'runtime.log' }>['data'],
    });
  };
  const runtimeExitHandler = (message: MessageEvent<string>) => {
    onEvent({
      type: 'runtime.exit',
      data: JSON.parse(message.data) as Extract<SessiondTerminalEvent, { type: 'runtime.exit' }>['data'],
    });
  };
  const runtimeStatusHandler = (message: MessageEvent<string>) => {
    onEvent({
      type: 'runtime.status',
      data: JSON.parse(message.data) as Extract<SessiondTerminalEvent, { type: 'runtime.status' }>['data'],
    });
  };
  const runtimeStartedHandler = (message: MessageEvent<string>) => {
    onEvent({
      type: 'runtime.started',
      data: JSON.parse(message.data) as Extract<SessiondTerminalEvent, { type: 'runtime.started' }>['data'],
    });
  };
  const buildLogHandler = (message: MessageEvent<string>) => {
    onEvent({
      type: 'build.log',
      data: JSON.parse(message.data) as Extract<SessiondTerminalEvent, { type: 'build.log' }>['data'],
    });
  };
  const buildStatusHandler = (message: MessageEvent<string>) => {
    onEvent({
      type: 'build.status',
      data: JSON.parse(message.data) as Extract<SessiondTerminalEvent, { type: 'build.status' }>['data'],
    });
  };
  const buildStartedHandler = (message: MessageEvent<string>) => {
    onEvent({
      type: 'build.started',
      data: JSON.parse(message.data) as Extract<SessiondTerminalEvent, { type: 'build.started' }>['data'],
    });
  };
  const buildCompletedHandler = (message: MessageEvent<string>) => {
    onEvent({
      type: 'build.completed',
      data: JSON.parse(message.data) as Extract<SessiondTerminalEvent, { type: 'build.completed' }>['data'],
    });
  };
  const approvalCreatedHandler = (message: MessageEvent<string>) => {
    onEvent({
      type: 'code-trust.approval.created',
      data: JSON.parse(message.data) as Extract<SessiondTerminalEvent, { type: 'code-trust.approval.created' }>['data'],
    });
  };
  const approvalResolvedHandler = (message: MessageEvent<string>) => {
    onEvent({
      type: 'code-trust.approval.resolved',
      data: JSON.parse(message.data) as Extract<SessiondTerminalEvent, { type: 'code-trust.approval.resolved' }>['data'],
    });
  };

  eventSource.addEventListener('terminal.output', outputHandler as EventListener);
  eventSource.addEventListener('terminal.exit', exitHandler as EventListener);
  eventSource.addEventListener('runtime.log', runtimeLogHandler as EventListener);
  eventSource.addEventListener('runtime.exit', runtimeExitHandler as EventListener);
  eventSource.addEventListener('runtime.status', runtimeStatusHandler as EventListener);
  eventSource.addEventListener('runtime.started', runtimeStartedHandler as EventListener);
  eventSource.addEventListener('build.log', buildLogHandler as EventListener);
  eventSource.addEventListener('build.status', buildStatusHandler as EventListener);
  eventSource.addEventListener('build.started', buildStartedHandler as EventListener);
  eventSource.addEventListener('build.completed', buildCompletedHandler as EventListener);
  eventSource.addEventListener('code-trust.approval.created', approvalCreatedHandler as EventListener);
  eventSource.addEventListener('code-trust.approval.resolved', approvalResolvedHandler as EventListener);

  return () => {
    eventSource.removeEventListener('terminal.output', outputHandler as EventListener);
    eventSource.removeEventListener('terminal.exit', exitHandler as EventListener);
    eventSource.removeEventListener('runtime.log', runtimeLogHandler as EventListener);
    eventSource.removeEventListener('runtime.exit', runtimeExitHandler as EventListener);
    eventSource.removeEventListener('runtime.status', runtimeStatusHandler as EventListener);
    eventSource.removeEventListener('runtime.started', runtimeStartedHandler as EventListener);
    eventSource.removeEventListener('build.log', buildLogHandler as EventListener);
    eventSource.removeEventListener('build.status', buildStatusHandler as EventListener);
    eventSource.removeEventListener('build.started', buildStartedHandler as EventListener);
    eventSource.removeEventListener('build.completed', buildCompletedHandler as EventListener);
    eventSource.removeEventListener('code-trust.approval.created', approvalCreatedHandler as EventListener);
    eventSource.removeEventListener('code-trust.approval.resolved', approvalResolvedHandler as EventListener);
    eventSource.close();
  };
}
