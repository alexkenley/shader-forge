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
  kind: 'file' | 'directory' | 'symlink';
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
  revision: string;
  content: string;
};

export type SessionFileWrite = Omit<SessionFileRead, 'revision'> & { revision?: string };

export type CoordinationAgent = {
  id: string;
  sessionId: string;
  name: string;
  status: 'connected' | 'disconnected' | 'expired';
  connectedAt: string;
  lastHeartbeatAt: string;
  expiresAt: string;
};

export type CoordinationLease = {
  id: string;
  agentId: string;
  sessionId: string;
  resources: string[];
  mode: 'read' | 'write';
  status: 'queued' | 'granted' | 'released' | 'expired';
  createdAt: string;
  grantedAt: string | null;
  releasedAt: string | null;
  queuePosition: number | null;
  blockedBy: Array<{ id: string; agentId: string; resources: string[]; mode: 'read' | 'write'; status: string }>;
};

export type EngineOperationActor = {
  kind: 'human' | 'shell' | 'cli' | 'mcp';
  id: string;
  name: string;
};

export type EngineOperationState =
  | 'previewed'
  | 'approved'
  | 'rejected'
  | 'applying'
  | 'applied'
  | 'undoing'
  | 'undone'
  | 'conflicted';

export type EngineOperationEvent = {
  type:
    | 'previewed'
    | 'approved'
    | 'rejected'
    | 'applying'
    | 'applied'
    | 'undoing'
    | 'undone'
    | 'conflicted'
    | 'apply_failed'
    | 'undo_failed'
    | 'recovered';
  at: string;
  state: EngineOperationState;
  actor: EngineOperationActor | null;
  conflict?: {
    code: 'revision_conflict' | 'code_trust_artifact_conflict';
    path: string;
    expectedRevision?: string;
    actualRevision?: string;
    operationId?: string;
  };
};

export type EngineOperation = {
  id: string;
  kind: string;
  sessionId: string;
  path: string;
  workspaceRoot: string;
  workspaceIdentity: { canonicalPath: string; dev: string; ino: string } | null;
  actor: EngineOperationActor;
  context: null | {
    type: 'spatial_attachment';
    label: string;
    subjectId: string;
    resourceKeys: string[];
    leaseId: string;
  } | {
    type: 'scene_asset';
    assetKind: 'scene' | 'prefab';
    intent: 'save' | 'create' | 'duplicate';
    label: string;
    subjectId: string;
    sourceSubjectId?: string;
    sourceRevision?: string;
    resourceKeys: string[];
    leaseId: string;
  };
  state: EngineOperationState;
  baseRevision: string;
  proposedRevision: string;
  appliedRevision: string | null;
  resultingRevision: string | null;
  preview: {
    addedLines: number;
    removedLines: number;
    beforeLineCount: number;
    afterLineCount: number;
    created: boolean;
    summary: string;
  };
  codeTrustEffect: {
    status: 'idle' | 'pending' | 'recorded' | 'reverted' | 'skipped' | 'failed';
    phase: 'apply' | 'undo' | null;
    actor: string;
    origin: string;
    artifact: unknown;
    error: string | null;
    updatedAt: string | null;
  };
  validation: null | {
    status: 'completed' | 'failed';
    proposedRevision: string;
  };
  createdAt: string;
  updatedAt: string;
  events: EngineOperationEvent[];
};

export type EngineOperationDiffLine = {
  type: 'context' | 'removed' | 'added';
  oldLine: number | null;
  newLine: number | null;
  text: string;
  ending: 'lf' | 'crlf' | 'cr' | 'none';
};

export type EngineOperationDiffHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: EngineOperationDiffLine[];
};

export type EngineOperationDiff = {
  operationId: string;
  path: string;
  beforeRevision: string;
  afterRevision: string;
  status: 'available' | 'summary_only';
  reason: 'binary' | 'too_large' | 'unavailable' | null;
  truncated: boolean;
  summary: EngineOperation['preview'];
  hunks: EngineOperationDiffHunk[];
};

export const engineShellActor = {
  kind: 'shell',
  id: 'engine-shell',
  name: 'Shader Forge Shell',
} as const;

export class SessiondRequestError extends Error {
  status: number;
  code: string;
  diagnostic: string;
  conflict: unknown;
  operation: EngineOperation | null;

  constructor(message: string, options: { status: number; code?: string; diagnostic?: string; conflict?: unknown; operation?: EngineOperation | null }) {
    super(message);
    this.name = 'SessiondRequestError';
    this.status = options.status;
    this.code = options.code || '';
    this.diagnostic = options.diagnostic || '';
    this.conflict = options.conflict;
    this.operation = options.operation || null;
  }
}

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
    }
  | {
      type:
        | 'operation.previewed'
        | 'operation.approved'
        | 'operation.rejected'
        | 'operation.applied'
        | 'operation.undone'
        | 'operation.conflicted';
      data: EngineOperation;
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

  const payload = (await response.json()) as T | {
    error?: string;
    code?: string;
    diagnostic?: string;
    conflict?: unknown;
    operation?: EngineOperation;
  };
  if (!response.ok) {
    const record = typeof payload === 'object' && payload ? payload : {};
    const credential = new Headers(options.headers).get('X-Shader-Forge-Agent-Credential') || '';
    const redact = (value: unknown) => {
      const text = value == null ? '' : String(value);
      return credential ? text.replaceAll(credential, '[redacted]') : text;
    };
    const redactValue = (value: unknown) => {
      if (!credential || value == null) return value;
      try {
        return JSON.parse(JSON.stringify(value).replaceAll(credential, '[redacted]')) as unknown;
      } catch {
        return undefined;
      }
    };
    const code = 'code' in record ? redact(record.code) : '';
    const diagnostic = 'diagnostic' in record ? redact(record.diagnostic) : '';
    const baseMessage = 'error' in record && record.error
      ? redact(record.error)
      : `Request failed with status ${response.status}`;
    throw new SessiondRequestError(
      [code, baseMessage, diagnostic].filter(Boolean).join(': '),
      {
        status: response.status,
        code,
        diagnostic,
        conflict: 'conflict' in record ? redactValue(record.conflict) : undefined,
        operation: 'operation' in record ? redactValue(record.operation) as EngineOperation || null : null,
      },
    );
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

function credentialHeader(credential: string) {
  return { 'X-Shader-Forge-Agent-Credential': credential };
}

export async function registerCoordinationAgent(sessionId: string) {
  return requestJson<{ agent: CoordinationAgent; credential: string }>('/api/coordination/agents', {
    method: 'POST',
    body: JSON.stringify({ sessionId, name: engineShellActor.name }),
  });
}

export async function heartbeatCoordinationAgent(agentId: string, credential: string) {
  const payload = await requestJson<{ agent: CoordinationAgent }>(
    `/api/coordination/agents/${encodeURIComponent(agentId)}/heartbeat`,
    { method: 'POST', headers: credentialHeader(credential) },
  );
  return payload.agent;
}

export async function disconnectCoordinationAgent(agentId: string, credential: string) {
  return requestJson<{ ok: boolean; agent: CoordinationAgent }>(
    `/api/coordination/agents/${encodeURIComponent(agentId)}/disconnect`,
    { method: 'POST', headers: credentialHeader(credential) },
  );
}

export async function requestCoordinationLease(
  agentId: string,
  credential: string,
  resources: string | string[],
  mode: 'read' | 'write' = 'write',
) {
  const payload = await requestJson<{ lease: CoordinationLease; status: CoordinationLease['status'] }>('/api/coordination/leases', {
    method: 'POST',
    headers: credentialHeader(credential),
    body: JSON.stringify({ agentId, mode, resources: Array.isArray(resources) ? resources : [resources] }),
  });
  return payload.lease;
}

export async function fetchCoordinationLease(leaseId: string) {
  const payload = await requestJson<{ lease: CoordinationLease; status: CoordinationLease['status'] }>(
    `/api/coordination/leases/${encodeURIComponent(leaseId)}`,
  );
  return payload.lease;
}

export async function releaseCoordinationLease(leaseId: string, agentId: string, credential: string) {
  const payload = await requestJson<{ lease: CoordinationLease; status: CoordinationLease['status'] }>(
    `/api/coordination/leases/${encodeURIComponent(leaseId)}/release`,
    {
      method: 'POST',
      headers: credentialHeader(credential),
      body: JSON.stringify({ agentId }),
    },
  );
  return payload.lease;
}

export type SpatialEvaluationVec3 = [number, number, number];
export type SpatialEvaluationQuat = [number, number, number, number];

export type SpatialEvaluationTransform = {
  translation: SpatialEvaluationVec3;
  rotation: SpatialEvaluationQuat;
  axes: {
    x: SpatialEvaluationVec3;
    y: SpatialEvaluationVec3;
    z: SpatialEvaluationVec3;
  };
};

export type SpatialEvaluationDiagnostic = {
  status: 'unavailable' | 'not_applicable';
  reason: string;
};

export type SpatialRestPose = {
  kind: 'rest';
  sampled: false;
};

export type SpatialProceduralLayer = 'primary_attachment' | 'secondary_hand_ik';

export type SpatialSampledPose = {
  kind: 'clip_sample';
  sampled: true;
  phase: string;
  clip: string;
  normalizedTime: number;
  proceduralLayersRequested: SpatialProceduralLayer[];
  proceduralLayersApplied: SpatialProceduralLayer[];
  proceduralLayersUnavailable: SpatialProceduralLayer[];
};

export type SpatialAppliedSecondaryIkDiagnostic = {
  status: 'applied';
  solved: true;
  reachable: boolean;
  preSolveDistanceMeters: number;
  targetDistanceMeters: number;
  minReachMeters: number;
  maxReachMeters: number;
  reachResidualMeters: number;
  reachToleranceMeters: number;
  reachWithinTolerance: boolean;
  postSolveDistanceMeters: number;
  contactToleranceMeters: number;
  contactWithinTolerance: boolean;
  postSolveAngleDegrees: number;
  angleToleranceDegrees: number;
  angleWithinTolerance: boolean;
  withinTolerance: boolean;
};

export type SpatialBoneJointLimitDiagnostic = {
  boneId: string;
  role: string;
  swingDegrees: number;
  swingLimitDegrees: number;
  twistDegrees: number;
  twistMinDegrees: number;
  twistMaxDegrees: number;
  swingViolationDegrees: number;
  twistViolationDegrees: number;
  withinLimits: boolean;
};

export type SpatialUnavailableJointLimitsDiagnostic = {
  status: 'unavailable';
  reason: 'no_joint_limits_authored';
  policy: 'diagnose';
  evaluatedBoneCount: 0;
  violationCount: 0;
  maxViolationDegrees: 0;
  withinLimits: null;
  bones: [];
};

export type SpatialAvailableJointLimitsDiagnostic = {
  status: 'available';
  reason: null;
  policy: 'diagnose';
  evaluatedBoneCount: number;
  violationCount: number;
  maxViolationDegrees: number;
  withinLimits: boolean;
  bones: SpatialBoneJointLimitDiagnostic[];
};

export type SpatialJointLimitsDiagnostic =
  | SpatialUnavailableJointLimitsDiagnostic
  | SpatialAvailableJointLimitsDiagnostic;

export type SpatialClippingUnavailableReason =
  | 'item_prefab_not_found'
  | 'item_prefab_ambiguous'
  | 'item_prefab_invalid'
  | 'item_collision_not_authored'
  | 'diagnostic_capsules_not_authored';

export type SpatialClippingItemBox = {
  kind: 'authored_collision_box';
  prefabId: string;
  world: SpatialEvaluationTransform;
  dimensionsMeters: SpatialEvaluationVec3;
  worldCorners: [
    SpatialEvaluationVec3,
    SpatialEvaluationVec3,
    SpatialEvaluationVec3,
    SpatialEvaluationVec3,
    SpatialEvaluationVec3,
    SpatialEvaluationVec3,
    SpatialEvaluationVec3,
    SpatialEvaluationVec3,
  ];
};

export type SpatialClippingCapsuleDiagnostic = {
  boneId: string;
  role: string;
  centerWorld: SpatialEvaluationVec3;
  axisWorld: SpatialEvaluationVec3;
  radiusMeters: number;
  halfLengthMeters: number;
  segmentStartWorld: SpatialEvaluationVec3;
  segmentEndWorld: SpatialEvaluationVec3;
  axisDistanceToBoxMeters: number;
  surfaceClearanceMeters: number;
  clearanceViolationMeters: number;
  overlapping: boolean;
};

export type SpatialUnavailableClippingDiagnostic = {
  status: 'unavailable';
  reason: SpatialClippingUnavailableReason;
  policy: 'diagnose';
  metric: 'capsule_axis_to_oriented_box_clearance';
  evaluatedCapsuleCount: 0;
  overlapCount: 0;
  maxClearanceViolationMeters: 0;
  hasOverlap: null;
  itemBox: null;
  capsules: [];
};

export type SpatialAvailableClippingDiagnostic = {
  status: 'available';
  reason: null;
  policy: 'diagnose';
  metric: 'capsule_axis_to_oriented_box_clearance';
  evaluatedCapsuleCount: number;
  overlapCount: number;
  maxClearanceViolationMeters: number;
  hasOverlap: boolean;
  itemBox: SpatialClippingItemBox;
  capsules: SpatialClippingCapsuleDiagnostic[];
};

export type SpatialClippingDiagnostic =
  | SpatialUnavailableClippingDiagnostic
  | SpatialAvailableClippingDiagnostic;

export type SpatialSourceRevision = {
  path: string;
  revision: string;
};

export type SpatialAttachmentEvaluation = {
  schema: 'shader_forge.spatial_attachment_evaluation';
  schemaVersion: 1 | 2;
  pose: SpatialRestPose | SpatialSampledPose;
  coordinateSystem: {
    units: 'meters';
    handedness: 'right';
    up: '+Y';
    forward: '+Z';
    quaternionOrder: 'xyzw';
  };
  skeleton: { id: string; name: string; rootBone: string };
  attachment: {
    id: string;
    name: string;
    itemPrefabId: string;
    dominantHand: string;
    mode: string;
    perspective: string;
    primaryGripSocket: string;
  };
  bones: Array<{
    id: string;
    parent: string;
    role: string;
    local: SpatialEvaluationTransform;
    world: SpatialEvaluationTransform;
  }>;
  segments: Array<{
    parentBoneId: string;
    boneId: string;
    from: SpatialEvaluationVec3;
    to: SpatialEvaluationVec3;
  }>;
  sockets: Array<{
    id: string;
    boneId: string;
    role: string;
    local: SpatialEvaluationTransform;
    world: SpatialEvaluationTransform;
  }>;
  item: {
    prefabId: string;
    world: SpatialEvaluationTransform;
    geometry: {
      status: 'unavailable';
      reason: string;
    } | {
      status: 'available';
      kind: 'authored_visual_box';
      procgeoId: string;
      dimensionsMeters: SpatialEvaluationVec3;
      worldCorners: [
        SpatialEvaluationVec3,
        SpatialEvaluationVec3,
        SpatialEvaluationVec3,
        SpatialEvaluationVec3,
        SpatialEvaluationVec3,
        SpatialEvaluationVec3,
        SpatialEvaluationVec3,
        SpatialEvaluationVec3,
      ];
    };
    primaryContactWorld: SpatialEvaluationTransform | null;
    handleAxisWorld: {
      origin: SpatialEvaluationVec3;
      direction: SpatialEvaluationVec3;
    } | null;
  };
  hands: {
    dominant: {
      boneId: string;
      role: string;
      world: SpatialEvaluationTransform;
      palmWorld: SpatialEvaluationTransform | null;
    } | null;
    secondary: {
      enabled: boolean;
      boneId: string;
      role: string;
      world: SpatialEvaluationTransform;
      palmWorld: SpatialEvaluationTransform | null;
      targetWorld: SpatialEvaluationTransform | null;
      pole: {
        translation: SpatialEvaluationVec3;
        space: 'unresolved' | 'item';
        world: SpatialEvaluationVec3 | null;
        reason: string | null;
      } | null;
      preSolveDistanceMeters: number | null;
    } | null;
  };
  diagnostics: {
    secondaryIk: SpatialEvaluationDiagnostic | SpatialAppliedSecondaryIkDiagnostic;
    jointLimits: SpatialJointLimitsDiagnostic;
    clipping: SpatialClippingDiagnostic;
  };
  limitations: string[];
};

export type SpatialAttachmentEvaluationResult = {
  evaluation: SpatialAttachmentEvaluation;
  path: string;
  revision: string;
  sourceRevisions: SpatialSourceRevision[];
};

export type SpatialAttachmentPreviewResult = {
  operation: EngineOperation;
  validation: unknown;
  evaluation: {
    baseline: SpatialAttachmentEvaluation | null;
    candidate: SpatialAttachmentEvaluation;
  };
};

export async function evaluateSpatialAttachment(
  sessionId: string,
  path: string,
  baseRevision: string,
) {
  const query = new URL('/api/spatial/attachment/evaluate', getSessiondBaseUrl());
  query.searchParams.set('sessionId', sessionId);
  query.searchParams.set('path', path);
  query.searchParams.set('baseRevision', baseRevision);
  return requestJson<SpatialAttachmentEvaluationResult>(`${query.pathname}${query.search}`);
}

export async function evaluateSpatialAttachmentSample(
  sessionId: string,
  path: string,
  baseRevision: string,
  phase: string,
  normalizedTime: number,
) {
  const query = new URL('/api/spatial/attachment/evaluate-sample', getSessiondBaseUrl());
  query.searchParams.set('sessionId', sessionId);
  query.searchParams.set('path', path);
  query.searchParams.set('baseRevision', baseRevision);
  query.searchParams.set('phase', phase);
  query.searchParams.set('normalizedTime', Number(normalizedTime).toString());
  return requestJson<SpatialAttachmentEvaluationResult>(`${query.pathname}${query.search}`);
}

export async function previewFileWrite(options: {
  sessionId: string;
  path: string;
  content: string;
  baseRevision: string;
}) {
  const payload = await requestJson<{ operation: EngineOperation }>('/api/operations/file-write/preview', {
    method: 'POST',
    body: JSON.stringify({
      sessionId: options.sessionId,
      path: options.path,
      content: options.content,
      baseRevision: options.baseRevision,
      actor: engineShellActor,
    }),
  });
  return payload.operation;
}

export async function previewSpatialAttachment(options: {
  sessionId: string;
  path: string;
  content: string;
  baseRevision: string;
  label: string;
  agentId: string;
  leaseId: string;
  credential: string;
}) {
  return requestJson<SpatialAttachmentPreviewResult>('/api/operations/spatial-attachment/preview', {
    method: 'POST',
    headers: credentialHeader(options.credential),
    body: JSON.stringify({
      sessionId: options.sessionId,
      path: options.path,
      content: options.content,
      baseRevision: options.baseRevision,
      label: options.label,
      actor: engineShellActor,
      agentId: options.agentId,
      leaseId: options.leaseId,
    }),
  });
}

export type SpatialReviewReservation = {
  reviewId: string;
  operationId: string;
  sessionId: string;
  agentId: string;
  resourceKey: string;
};

export async function validateSpatialAttachmentOperation(
  operationId: string,
  samples: Array<{ phase: string; normalizedTime: number }>,
) {
  const payload = await requestJson<{ operation: EngineOperation }>(
    `/api/operations/${encodeURIComponent(operationId)}/validate`,
    {
      method: 'POST',
      body: JSON.stringify({ actor: engineShellActor, samples }),
    },
  );
  return payload.operation;
}

export async function reserveSpatialReview(options: {
  operationId: string;
  sessionId: string;
  agentId: string;
  credential: string;
}) {
  const payload = await requestJson<{ reservation: SpatialReviewReservation }>(
    `/api/operations/${encodeURIComponent(options.operationId)}/review-reservations`,
    {
      method: 'POST',
      headers: credentialHeader(options.credential),
      body: JSON.stringify({ sessionId: options.sessionId, agentId: options.agentId }),
    },
  );
  return payload.reservation;
}

export async function recaptureSpatialReview(options: {
  operationId: string;
  agentId: string;
  credential: string;
  reviewId: string;
  sourceLeaseId: string;
  captureLeaseId: string;
  reviewLeaseId: string;
  phases: string[];
  cameras: string[];
  widthPx: number;
  heightPx: number;
  playerCameraScene?: string;
  playerCameraPrefab?: string;
}) {
  const payload = await requestJson<{ review: unknown }>(
    `/api/operations/${encodeURIComponent(options.operationId)}/recapture`,
    {
      method: 'POST',
      headers: credentialHeader(options.credential),
      body: JSON.stringify({
        actor: engineShellActor,
        agentId: options.agentId,
        reviewId: options.reviewId,
        sourceLeaseId: options.sourceLeaseId,
        captureLeaseId: options.captureLeaseId,
        reviewLeaseId: options.reviewLeaseId,
        phases: options.phases,
        cameras: options.cameras,
        widthPx: options.widthPx,
        heightPx: options.heightPx,
        ...(options.playerCameraScene ? { playerCameraScene: options.playerCameraScene } : {}),
        ...(options.playerCameraPrefab ? { playerCameraPrefab: options.playerCameraPrefab } : {}),
      }),
    },
  );
  return payload.review;
}

export async function readSpatialReview(sessionId: string, reviewId: string) {
  const query = new URL(`/api/spatial/reviews/${encodeURIComponent(reviewId)}`, getSessiondBaseUrl());
  query.searchParams.set('sessionId', sessionId);
  const payload = await requestJson<{ review: unknown }>(`${query.pathname}${query.search}`);
  return payload.review;
}

export function spatialReviewCaptureUrl(sessionId: string, reviewId: string, name: string) {
  const target = new URL(
    `/api/spatial/reviews/${encodeURIComponent(reviewId)}/captures/${encodeURIComponent(name)}`,
    getSessiondBaseUrl(),
  );
  target.searchParams.set('sessionId', sessionId);
  return target.href;
}

export type SceneAssetPreviewResult = {
  operation: EngineOperation;
  validation: unknown;
};

export async function previewSceneAsset(options: {
  sessionId: string;
  assetKind: 'scene' | 'prefab';
  intent: 'save' | 'create' | 'duplicate';
  subjectId: string;
  content: string;
  baseRevision: string;
  label: string;
  agentId: string;
  leaseId: string;
  credential: string;
  sourceSubjectId?: string;
  sourceRevision?: string;
}) {
  return requestJson<SceneAssetPreviewResult>('/api/operations/scene-asset/preview', {
    method: 'POST',
    headers: credentialHeader(options.credential),
    body: JSON.stringify({
      sessionId: options.sessionId,
      assetKind: options.assetKind,
      intent: options.intent,
      subjectId: options.subjectId,
      content: options.content,
      baseRevision: options.baseRevision,
      label: options.label,
      actor: engineShellActor,
      agentId: options.agentId,
      leaseId: options.leaseId,
      ...(options.sourceSubjectId
        ? { sourceSubjectId: options.sourceSubjectId, sourceRevision: options.sourceRevision }
        : {}),
    }),
  });
}

export async function transitionOperation(
  operationId: string,
  action: 'approve' | 'reject' | 'apply' | 'undo',
  options: {
    actor: EngineOperationActor;
    coordination?: { agentId: string; leaseId: string; credential: string };
  },
) {
  return requestJson<{ operation: EngineOperation }>(
    `/api/operations/${encodeURIComponent(operationId)}/${action}`,
    {
      method: 'POST',
      ...(options.coordination ? { headers: credentialHeader(options.coordination.credential) } : {}),
      body: JSON.stringify({
        actor: options.actor,
        ...(options.coordination
          ? { agentId: options.coordination.agentId, leaseId: options.coordination.leaseId }
          : {}),
      }),
    },
  );
}

export async function listOperations(sessionId: string) {
  const query = new URL('/api/operations', getSessiondBaseUrl());
  query.searchParams.set('sessionId', sessionId);
  const payload = await requestJson<{ operations: EngineOperation[] }>(`${query.pathname}${query.search}`);
  return payload.operations;
}

export async function fetchOperation(operationId: string) {
  const payload = await requestJson<{ operation: EngineOperation }>(
    `/api/operations/${encodeURIComponent(operationId)}`,
  );
  return payload.operation;
}

export async function fetchOperationDiff(operationId: string) {
  const payload = await requestJson<{ diff: EngineOperationDiff }>(
    `/api/operations/${encodeURIComponent(operationId)}/diff`,
  );
  return payload.diff;
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
  const operationEventTypes = [
    'operation.previewed',
    'operation.approved',
    'operation.rejected',
    'operation.applied',
    'operation.undone',
    'operation.conflicted',
  ] as const;
  const operationHandlers = operationEventTypes.map((type) => {
    const handler = (message: MessageEvent<string>) => {
      onEvent({ type, data: JSON.parse(message.data) as EngineOperation });
    };
    eventSource.addEventListener(type, handler as EventListener);
    return { type, handler };
  });

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
    for (const { type, handler } of operationHandlers) {
      eventSource.removeEventListener(type, handler as EventListener);
    }
    eventSource.close();
  };
}
