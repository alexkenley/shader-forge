import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const DEFAULT_BASE_URL = 'http://127.0.0.1:41741';
const AGENT_CREDENTIAL_HEADER = 'x-shader-forge-agent-credential';
const HEARTBEAT_INTERVAL_MS = 10_000;
const SESSIOND_REQUEST_TIMEOUT_MS = 5_000;
const SPATIAL_READ_TIMEOUT_MS = 30_000;
const SHUTDOWN_TIMEOUT_MS = 2_000;
const MAX_OPERATION_LIST_RESULTS = 100;
const MAX_SPATIAL_ATTACHMENT_BYTES = 1024 * 1024;
const OPERATION_STATES = [
  'all',
  'previewed',
  'approved',
  'rejected',
  'applying',
  'applied',
  'undoing',
  'undone',
  'conflicted',
];
const SPATIAL_ATTACHMENT_PATH = /^animation\/attachments\/[^/]+\.attachment\.toml$/;
const REVISION = /^(?:missing|sha256:[a-f0-9]{64})$/;
const PRESENT_REVISION = /^sha256:[a-f0-9]{64}$/;
const PUBLIC_ERROR_FIELDS = [
  'code',
  'diagnostic',
  'conflict',
  'lease',
  'operation',
  'approval',
  'codeTrust',
];

const finiteNumber = z.number();
const nonNegativeNumber = finiteNumber.min(0);
const nonNegativeInteger = z.number().int().min(0);
const spatialVec3Schema = z.tuple([finiteNumber, finiteNumber, finiteNumber]);
const spatialQuaternionSchema = z.tuple([
  finiteNumber,
  finiteNumber,
  finiteNumber,
  finiteNumber,
]);
const spatialTransformSchema = z.object({
  translation: spatialVec3Schema,
  rotation: spatialQuaternionSchema,
  axes: z.object({
    x: spatialVec3Schema,
    y: spatialVec3Schema,
    z: spatialVec3Schema,
  }).strict(),
}).strict();
const unavailableSecondaryIkSchema = z.union([
  z.object({
    status: z.literal('unavailable'),
    reason: z.enum(['rest_pose_unsolved', 'secondary_hand_ik_not_implemented']),
  }).strict(),
  z.object({
    status: z.literal('not_applicable'),
    reason: z.literal('one_hand_attachment'),
  }).strict(),
]);
const appliedSecondaryIkSchema = z.object({
  status: z.literal('applied'),
  solved: z.literal(true),
  reachable: z.boolean(),
  preSolveDistanceMeters: nonNegativeNumber,
  targetDistanceMeters: nonNegativeNumber,
  minReachMeters: nonNegativeNumber,
  maxReachMeters: nonNegativeNumber,
  reachResidualMeters: nonNegativeNumber,
  reachToleranceMeters: nonNegativeNumber,
  reachWithinTolerance: z.boolean(),
  postSolveDistanceMeters: nonNegativeNumber,
  contactToleranceMeters: nonNegativeNumber,
  contactWithinTolerance: z.boolean(),
  postSolveAngleDegrees: nonNegativeNumber,
  angleToleranceDegrees: nonNegativeNumber,
  angleWithinTolerance: z.boolean(),
  withinTolerance: z.boolean(),
}).strict();
const jointLimitBoneSchema = z.object({
  boneId: z.string(),
  role: z.string(),
  swingDegrees: finiteNumber.min(0).max(180),
  swingLimitDegrees: finiteNumber.min(0).max(180),
  twistDegrees: finiteNumber.min(-180).max(180),
  twistMinDegrees: finiteNumber.min(-180).max(180),
  twistMaxDegrees: finiteNumber.min(-180).max(180),
  swingViolationDegrees: nonNegativeNumber.max(180),
  twistViolationDegrees: nonNegativeNumber.max(360),
  withinLimits: z.boolean(),
}).strict();
const jointLimitsSchema = z.union([
  z.object({
    status: z.literal('unavailable'),
    reason: z.literal('no_joint_limits_authored'),
    policy: z.literal('diagnose'),
    evaluatedBoneCount: z.literal(0),
    violationCount: z.literal(0),
    maxViolationDegrees: z.literal(0),
    withinLimits: z.null(),
    bones: z.tuple([]),
  }).strict(),
  z.object({
    status: z.literal('available'),
    reason: z.null(),
    policy: z.literal('diagnose'),
    evaluatedBoneCount: nonNegativeInteger.min(1),
    violationCount: nonNegativeInteger,
    maxViolationDegrees: nonNegativeNumber.max(360),
    withinLimits: z.boolean(),
    bones: z.array(jointLimitBoneSchema).min(1),
  }).strict(),
]);
const clippingCapsuleSchema = z.object({
  boneId: z.string(),
  role: z.string(),
  centerWorld: spatialVec3Schema,
  axisWorld: spatialVec3Schema,
  radiusMeters: finiteNumber.positive(),
  halfLengthMeters: finiteNumber.positive(),
  segmentStartWorld: spatialVec3Schema,
  segmentEndWorld: spatialVec3Schema,
  axisDistanceToBoxMeters: nonNegativeNumber,
  surfaceClearanceMeters: finiteNumber,
  clearanceViolationMeters: nonNegativeNumber,
  overlapping: z.boolean(),
}).strict();
const clippingItemBoxSchema = z.object({
  kind: z.literal('authored_collision_box'),
  prefabId: z.string(),
  world: spatialTransformSchema,
  dimensionsMeters: z.tuple([
    finiteNumber.positive(),
    finiteNumber.positive(),
    finiteNumber.positive(),
  ]),
  worldCorners: z.tuple([
    spatialVec3Schema,
    spatialVec3Schema,
    spatialVec3Schema,
    spatialVec3Schema,
    spatialVec3Schema,
    spatialVec3Schema,
    spatialVec3Schema,
    spatialVec3Schema,
  ]),
}).strict();
const clippingCommonShape = {
  policy: z.literal('diagnose'),
  metric: z.literal('capsule_axis_to_oriented_box_clearance'),
};
const clippingSchema = z.union([
  z.object({
    status: z.literal('unavailable'),
    reason: z.enum([
      'item_prefab_not_found',
      'item_prefab_ambiguous',
      'item_prefab_invalid',
      'item_collision_not_authored',
      'diagnostic_capsules_not_authored',
    ]),
    ...clippingCommonShape,
    evaluatedCapsuleCount: z.literal(0),
    overlapCount: z.literal(0),
    maxClearanceViolationMeters: z.literal(0),
    hasOverlap: z.null(),
    itemBox: z.null(),
    capsules: z.tuple([]),
  }).strict(),
  z.object({
    status: z.literal('available'),
    reason: z.null(),
    ...clippingCommonShape,
    evaluatedCapsuleCount: nonNegativeInteger.min(1),
    overlapCount: nonNegativeInteger,
    maxClearanceViolationMeters: nonNegativeNumber,
    hasOverlap: z.boolean(),
    itemBox: clippingItemBoxSchema,
    capsules: z.array(clippingCapsuleSchema).min(1),
  }).strict(),
]);
const itemGeometrySchema = z.union([
  z.object({
    status: z.literal('unavailable'),
    reason: z.enum([
      'item_prefab_not_found',
      'item_prefab_ambiguous',
      'item_prefab_visual_geometry_unavailable',
      'item_prefab_visual_geometry_ambiguous',
      'item_prefab_visual_geometry_not_box',
    ]),
  }).strict(),
  z.object({
    status: z.literal('available'),
    kind: z.literal('authored_visual_box'),
    procgeoId: z.string(),
    dimensionsMeters: z.tuple([
      finiteNumber.positive(),
      finiteNumber.positive(),
      finiteNumber.positive(),
    ]),
    worldCorners: z.tuple([
      spatialVec3Schema,
      spatialVec3Schema,
      spatialVec3Schema,
      spatialVec3Schema,
      spatialVec3Schema,
      spatialVec3Schema,
      spatialVec3Schema,
      spatialVec3Schema,
    ]),
  }).strict(),
]);
const spatialRestPoseSchema = z.object({
  kind: z.literal('rest'),
  sampled: z.literal(false),
}).strict();
const spatialSamplePoseSchema = z.object({
  kind: z.literal('clip_sample'),
  sampled: z.literal(true),
  phase: z.string(),
  clip: z.string(),
  normalizedTime: finiteNumber.min(0).max(1),
  proceduralLayersRequested: z.array(z.enum(['primary_attachment', 'secondary_hand_ik'])),
  proceduralLayersApplied: z.array(z.enum(['primary_attachment', 'secondary_hand_ik'])),
  proceduralLayersUnavailable: z.array(z.enum(['primary_attachment', 'secondary_hand_ik'])),
}).strict();
const evaluatedBoneSchema = z.object({
  id: z.string(),
  parent: z.string(),
  role: z.string(),
  local: spatialTransformSchema,
  world: spatialTransformSchema,
}).strict();
const spatialEvaluationSchema = z.object({
  schema: z.literal('shader_forge.spatial_attachment_evaluation'),
  schemaVersion: z.union([z.literal(1), z.literal(2)]),
  pose: z.union([spatialRestPoseSchema, spatialSamplePoseSchema]),
  coordinateSystem: z.object({
    units: z.literal('meters'),
    handedness: z.literal('right'),
    up: z.literal('+Y'),
    forward: z.literal('+Z'),
    quaternionOrder: z.literal('xyzw'),
  }).strict(),
  skeleton: z.object({ id: z.string(), name: z.string(), rootBone: z.string() }).strict(),
  attachment: z.object({
    id: z.string(),
    name: z.string(),
    itemPrefabId: z.string(),
    dominantHand: z.enum(['left', 'right']),
    mode: z.enum(['one_hand', 'two_hand']),
    perspective: z.enum(['first_person', 'third_person', 'both']),
    primaryGripSocket: z.string(),
  }).strict(),
  bones: z.array(evaluatedBoneSchema),
  segments: z.array(z.object({
    parentBoneId: z.string(),
    boneId: z.string(),
    from: spatialVec3Schema,
    to: spatialVec3Schema,
  }).strict()),
  sockets: z.array(z.object({
    id: z.string(),
    boneId: z.string(),
    role: z.string(),
    local: spatialTransformSchema,
    world: spatialTransformSchema,
  }).strict()),
  item: z.object({
    prefabId: z.string(),
    world: spatialTransformSchema,
    geometry: itemGeometrySchema,
    primaryContactWorld: spatialTransformSchema.nullable(),
    handleAxisWorld: z.object({
      origin: spatialVec3Schema,
      direction: spatialVec3Schema,
    }).strict().nullable(),
  }).strict(),
  hands: z.object({
    dominant: z.object({
      boneId: z.string(),
      role: z.string(),
      world: spatialTransformSchema,
      palmWorld: spatialTransformSchema.nullable(),
    }).strict(),
    secondary: z.object({
      enabled: z.boolean(),
      boneId: z.string(),
      role: z.string(),
      world: spatialTransformSchema,
      palmWorld: spatialTransformSchema.nullable(),
      targetWorld: spatialTransformSchema.nullable(),
      pole: z.object({
        translation: spatialVec3Schema,
        space: z.enum(['unresolved', 'item']),
        world: spatialVec3Schema.nullable(),
        reason: z.string().nullable(),
      }).strict().nullable(),
      preSolveDistanceMeters: nonNegativeNumber.nullable(),
    }).strict().nullable(),
  }).strict(),
  diagnostics: z.object({
    secondaryIk: z.union([unavailableSecondaryIkSchema, appliedSecondaryIkSchema]),
    jointLimits: jointLimitsSchema,
    clipping: clippingSchema,
  }).strict(),
  limitations: z.array(z.string()),
}).strict();
const spatialSourceRevisionSchema = z.object({
  path: z.string(),
  revision: z.string().regex(PRESENT_REVISION),
}).strict();
const spatialReadOutputSchema = z.object({
  evaluation: spatialEvaluationSchema,
  path: z.string(),
  revision: z.string().regex(PRESENT_REVISION),
  sourceRevisions: z.array(spatialSourceRevisionSchema),
}).strict();
const spatialReadInputSchema = z.discriminatedUnion('view', [
  z.object({
    view: z.literal('rest'),
    path: z.string().trim().regex(SPATIAL_ATTACHMENT_PATH),
    baseRevision: z.string().regex(PRESENT_REVISION),
  }).strict(),
  z.object({
    view: z.literal('sample'),
    path: z.string().trim().regex(SPATIAL_ATTACHMENT_PATH),
    baseRevision: z.string().regex(PRESENT_REVISION),
    phase: z.string().refine((value) => value.trim().length > 0),
    normalizedTime: finiteNumber.min(0).max(1).refine((value) => !Object.is(value, -0)),
  }).strict(),
]);

class SessiondRequestError extends Error {
  constructor(message, status, details = {}) {
    super(message);
    this.name = 'SessiondRequestError';
    this.status = status;
    this.details = details;
  }
}

function boundaryError(status, code, message, details = {}) {
  return new SessiondRequestError(message, status, { code, ...details });
}

function usage() {
  return [
    'Shader Forge MCP (sf-mcp)',
    '',
    'Usage:',
    '  node tools/engine-mcp/server.mjs (--session ID | --root PATH) [--base-url URL] [--name NAME]',
  ].join('\n');
}

function requireOptionValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    sessionId: '',
    rootPath: '',
    name: 'sf-mcp',
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === '--help' || option === '-h') {
      options.help = true;
      continue;
    }
    if (!['--base-url', '--session', '--root', '--name'].includes(option)) {
      throw new Error(`Unknown option: ${option}`);
    }
    const value = requireOptionValue(argv, index, option).trim();
    index += 1;
    if (!value) {
      throw new Error(`${option} requires a non-empty value.`);
    }
    if (option === '--base-url') options.baseUrl = value;
    if (option === '--session') options.sessionId = value;
    if (option === '--root') options.rootPath = value;
    if (option === '--name') options.name = value;
  }

  if (options.help) return options;
  if (Boolean(options.sessionId) === Boolean(options.rootPath)) {
    throw new Error('Exactly one of --session or --root is required.');
  }

  options.baseUrl = options.baseUrl.replace(/\/$/, '');
  if (!/^https?:\/\//i.test(options.baseUrl)) {
    options.baseUrl = `http://${options.baseUrl}`;
  }
  new URL(options.baseUrl);
  if (options.rootPath) options.rootPath = path.resolve(options.rootPath);
  return options;
}

async function requestJson(baseUrl, pathname, {
  method = 'GET',
  body,
  credential,
  timeoutMs = SESSIOND_REQUEST_TIMEOUT_MS,
} = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (credential) headers[AGENT_CREDENTIAL_HEADER] = credential;

  let response;
  try {
    response = await fetch(new URL(pathname, `${baseUrl}/`), {
      method,
      headers,
      signal: AbortSignal.timeout(timeoutMs),
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch (error) {
    throw new Error(`engine_sessiond is unavailable at ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`engine_sessiond returned invalid JSON for ${method} ${pathname}.`);
    }
  }
  if (!response.ok) {
    const message = typeof payload?.error === 'string' ? payload.error : `${response.status} ${response.statusText}`;
    const details = {};
    for (const field of PUBLIC_ERROR_FIELDS) {
      if (payload?.[field] !== undefined) details[field] = payload[field];
    }
    throw new SessiondRequestError(
      `engine_sessiond rejected ${method} ${pathname}: ${message}`,
      response.status,
      details,
    );
  }
  return payload;
}

async function resolveSession(options) {
  if (options.sessionId) {
    const payload = await requestJson(options.baseUrl, `/api/sessions/${encodeURIComponent(options.sessionId)}`);
    return payload.session;
  }

  const payload = await requestJson(options.baseUrl, '/api/sessions');
  const existing = payload.sessions.find((session) => path.resolve(session.rootPath) === options.rootPath);
  if (existing) return existing;

  const created = await requestJson(options.baseUrl, '/api/sessions', {
    method: 'POST',
    body: {
      name: path.basename(options.rootPath) || 'workspace',
      rootPath: options.rootPath,
    },
  });
  return created.session;
}

function toolResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function toolFailure(error, authoritativeOperation) {
  const failure = {
    ok: false,
    status: Number.isInteger(error?.status) ? error.status : 500,
    error: error instanceof Error ? error.message : String(error),
  };
  const details = error instanceof SessiondRequestError ? error.details : {};
  for (const field of PUBLIC_ERROR_FIELDS) {
    if (details[field] !== undefined) failure[field] = details[field];
  }
  if (authoritativeOperation) failure.authoritativeOperation = authoritativeOperation;
  return {
    ...toolResult(failure),
    isError: true,
  };
}

function resourceKeyCovers(held, required) {
  return held === required || required.startsWith(`${held}/`);
}

function registerSurface(server, state) {
  const readProject = async () => {
    const [health, session] = await Promise.all([
      requestJson(state.baseUrl, '/health'),
      requestJson(state.baseUrl, `/api/sessions/${encodeURIComponent(state.session.id)}`),
    ]);
    return {
      product: 'Shader Forge MCP',
      shortName: 'sf-mcp',
      session: session.session,
      service: health,
      agent: state.agent,
    };
  };
  const readCoordination = () => requestJson(
    state.baseUrl,
    `/api/coordination/state?sessionId=${encodeURIComponent(state.session.id)}`,
  );
  const operationActor = () => ({
    kind: 'mcp',
    id: state.agent.id,
    name: state.agent.name || 'sf-mcp',
  });
  const readOperation = async (operationId) => {
    const payload = await requestJson(
      state.baseUrl,
      `/api/operations/${encodeURIComponent(operationId)}`,
    );
    if (payload.operation?.sessionId !== state.session.id) {
      throw boundaryError(403, 'operation_session_mismatch', 'Operation belongs to a different Shader Forge workspace session.');
    }
    return payload.operation;
  };
  const requireGrantedWriteLease = async (leaseId, requiredResources = []) => {
    if (!state.leaseIds.has(leaseId)) {
      throw boundaryError(403, 'lease_not_owned', `Lease is not owned by this sf-mcp process: ${leaseId}`);
    }
    await state.heartbeat();
    const payload = await requestJson(
      state.baseUrl,
      `/api/coordination/leases/${encodeURIComponent(leaseId)}`,
    );
    const { lease } = payload;
    if (lease?.agentId !== state.agent.id || lease?.sessionId !== state.session.id) {
      throw boundaryError(403, 'lease_owner_mismatch', 'Lease is not owned by this sf-mcp workspace agent.', { lease });
    }
    if (lease.status !== 'granted') {
      throw boundaryError(409, 'lease_not_granted', `Lease ${leaseId} is ${lease.status}, not granted.`, { lease });
    }
    if (lease.mode !== 'write') {
      throw boundaryError(409, 'lease_write_required', 'A granted write lease is required.', { lease });
    }
    const uncovered = requiredResources.filter((required) => (
      !lease.resources.some((held) => resourceKeyCovers(held, required))
    ));
    if (uncovered.length) {
      throw boundaryError(
        409,
        'lease_resource_mismatch',
        `Lease does not cover required resources: ${uncovered.join(', ')}`,
        { lease },
      );
    }
    return lease;
  };
  const safeOperationAction = (action, { requireSpatialLease = false } = {}) => (
    async ({ operationId, leaseId }) => {
      let operation;
      try {
        operation = await readOperation(operationId);
        if (requireSpatialLease) {
          if (operation.context?.type !== 'spatial_attachment') {
            throw boundaryError(
              409,
              'operation_not_spatial_attachment',
              'sf-mcp apply and undo are limited to lease-gated spatial attachment operations.',
              { operation },
            );
          }
          await requireGrantedWriteLease(leaseId, operation.context.resourceKeys);
        }
        const payload = await requestJson(
          state.baseUrl,
          `/api/operations/${encodeURIComponent(operationId)}/${action}`,
          {
            method: 'POST',
            ...(requireSpatialLease ? { credential: state.credential } : {}),
            body: {
              actor: operationActor(),
              ...(requireSpatialLease
                ? { agentId: state.agent.id, leaseId }
                : {}),
            },
          },
        );
        return toolResult(payload);
      } catch (error) {
        let authoritativeOperation = error?.details?.operation || operation;
        if (error?.status === 409) {
          try {
            authoritativeOperation = await readOperation(operationId);
          } catch {
            // Keep the operation returned by the failed transition when a refresh is unavailable.
          }
        }
        return toolFailure(error, authoritativeOperation);
      }
    }
  );

  server.registerResource(
    'shader-forge-project',
    'shaderforge://project',
    { title: 'Shader Forge Project', description: 'Current Shader Forge workspace and service status.', mimeType: 'application/json' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await readProject(), null, 2) }] }),
  );
  server.registerResource(
    'shader-forge-coordination',
    'shaderforge://coordination',
    { title: 'Shader Forge Coordination', description: 'Live agents, granted leases, and queued work for this workspace.', mimeType: 'application/json' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await readCoordination(), null, 2) }] }),
  );

  server.registerTool(
    'project_status',
    { title: 'Project status', description: 'Read the current Shader Forge project and session daemon status.', inputSchema: z.object({}), annotations: { readOnlyHint: true } },
    async () => toolResult(await readProject()),
  );
  server.registerTool(
    'project_files_list',
    {
      title: 'List project files',
      description: 'List one directory inside the current Shader Forge project.',
      inputSchema: z.object({ path: z.string().trim().min(1).default('.') }),
      annotations: { readOnlyHint: true },
    },
    async ({ path: relativePath }) => toolResult(await requestJson(
      state.baseUrl,
      `/api/files/list?sessionId=${encodeURIComponent(state.session.id)}&path=${encodeURIComponent(relativePath)}`,
    )),
  );
  server.registerTool(
    'project_file_read',
    {
      title: 'Read project file',
      description: 'Read one UTF-8 file inside the current Shader Forge project.',
      inputSchema: z.object({ path: z.string().trim().min(1) }),
      annotations: { readOnlyHint: true },
    },
    async ({ path: relativePath }) => toolResult(await requestJson(
      state.baseUrl,
      `/api/files/read?sessionId=${encodeURIComponent(state.session.id)}&path=${encodeURIComponent(relativePath)}`,
    )),
  );
  server.registerTool(
    'spatial_attachment_read',
    {
      title: 'Read spatial attachment evidence',
      description: 'Read exact revision-bound rest or sampled spatial attachment evidence from the selected Shader Forge workspace.',
      inputSchema: spatialReadInputSchema,
      outputSchema: spatialReadOutputSchema,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (input) => {
      try {
        const query = new URL(
          input.view === 'rest'
            ? '/api/spatial/attachment/evaluate'
            : '/api/spatial/attachment/evaluate-sample',
          `${state.baseUrl}/`,
        );
        query.searchParams.set('sessionId', state.session.id);
        query.searchParams.set('path', input.path);
        query.searchParams.set('baseRevision', input.baseRevision);
        if (input.view === 'sample') {
          query.searchParams.set('phase', input.phase);
          query.searchParams.set('normalizedTime', input.normalizedTime.toString());
        }
        return toolResult(await requestJson(
          state.baseUrl,
          `${query.pathname}${query.search}`,
          { timeoutMs: SPATIAL_READ_TIMEOUT_MS },
        ));
      } catch (error) {
        return toolFailure(error);
      }
    },
  );
  server.registerTool(
    'coordination_state',
    { title: 'Coordination state', description: 'Read agents and work leases for this workspace.', inputSchema: z.object({}), annotations: { readOnlyHint: true } },
    async () => toolResult(await readCoordination()),
  );
  server.registerTool(
    'work_lease_request',
    {
      title: 'Request work lease',
      description: 'Request read or write ownership for one or more hierarchical workspace resources.',
      inputSchema: z.object({
        resources: z.array(z.string().trim().min(1)).min(1),
        mode: z.enum(['read', 'write']),
      }),
    },
    async ({ resources, mode }) => {
      const payload = await requestJson(state.baseUrl, '/api/coordination/leases', {
        method: 'POST',
        credential: state.credential,
        body: { agentId: state.agent.id, resources, mode },
      });
      state.leaseIds.add(payload.lease.id);
      return toolResult(payload);
    },
  );
  server.registerTool(
    'work_lease_status',
    {
      title: 'Work lease status',
      description: 'Read the current status of a work lease owned by this MCP process.',
      inputSchema: z.object({ leaseId: z.string().trim().min(1) }),
      annotations: { readOnlyHint: true },
    },
    async ({ leaseId }) => {
      if (!state.leaseIds.has(leaseId)) throw new Error(`Unknown sf-mcp lease: ${leaseId}`);
      return toolResult(await requestJson(state.baseUrl, `/api/coordination/leases/${encodeURIComponent(leaseId)}`));
    },
  );
  server.registerTool(
    'work_lease_release',
    {
      title: 'Release work lease',
      description: 'Release a work lease owned by this MCP process.',
      inputSchema: z.object({ leaseId: z.string().trim().min(1) }),
    },
    async ({ leaseId }) => {
      if (!state.leaseIds.has(leaseId)) throw new Error(`Unknown sf-mcp lease: ${leaseId}`);
      const payload = await requestJson(
        state.baseUrl,
        `/api/coordination/leases/${encodeURIComponent(leaseId)}/release`,
        { method: 'POST', credential: state.credential, body: { agentId: state.agent.id } },
      );
      state.leaseIds.delete(leaseId);
      return toolResult(payload);
    },
  );
  server.registerTool(
    'agent_heartbeat',
    { title: 'Agent heartbeat', description: 'Refresh this MCP process coordinator registration.', inputSchema: z.object({}) },
    async () => toolResult(await state.heartbeat()),
  );
  server.registerTool(
    'operation_list',
    {
      title: 'List operations',
      description: 'List recent engine-owned operations for this Shader Forge workspace. File contents are never returned.',
      inputSchema: z.object({
        state: z.enum(OPERATION_STATES).default('all'),
        limit: z.number().int().min(1).max(MAX_OPERATION_LIST_RESULTS).default(50),
      }).strict(),
      annotations: { readOnlyHint: true },
    },
    async ({ state: operationState, limit }) => {
      try {
        const payload = await requestJson(
          state.baseUrl,
          `/api/operations?sessionId=${encodeURIComponent(state.session.id)}&state=${encodeURIComponent(operationState)}`,
        );
        if (payload.operations.some((operation) => operation.sessionId !== state.session.id)) {
          throw boundaryError(
            502,
            'operation_list_session_mismatch',
            'engine_sessiond returned an operation from a different workspace session.',
          );
        }
        return toolResult({ operations: payload.operations.slice(0, limit) });
      } catch (error) {
        return toolFailure(error);
      }
    },
  );
  server.registerTool(
    'operation_read',
    {
      title: 'Read operation',
      description: 'Read one engine-owned operation from this Shader Forge workspace without exposing staged file contents.',
      inputSchema: z.object({ operationId: z.string().trim().min(1).max(128) }).strict(),
      annotations: { readOnlyHint: true },
    },
    async ({ operationId }) => {
      try {
        return toolResult({ operation: await readOperation(operationId) });
      } catch (error) {
        return toolFailure(error);
      }
    },
  );
  server.registerTool(
    'spatial_attachment_preview',
    {
      title: 'Preview spatial attachment change',
      description: 'Validate and preview a full authored attachment candidate under an owned write lease. This does not apply file bytes.',
      inputSchema: z.object({
        path: z.string().trim().regex(SPATIAL_ATTACHMENT_PATH),
        content: z.string().refine(
          (value) => Buffer.byteLength(value, 'utf8') <= MAX_SPATIAL_ATTACHMENT_BYTES,
          `content must be at most ${MAX_SPATIAL_ATTACHMENT_BYTES} UTF-8 bytes`,
        ),
        baseRevision: z.string().regex(REVISION),
        label: z.string().trim().min(1).max(200),
        leaseId: z.string().trim().min(1).max(128),
      }).strict(),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    async ({ path: relativePath, content, baseRevision, label, leaseId }) => {
      try {
        await requireGrantedWriteLease(leaseId);
        const payload = await requestJson(state.baseUrl, '/api/operations/spatial-attachment/preview', {
          method: 'POST',
          credential: state.credential,
          body: {
            sessionId: state.session.id,
            path: relativePath,
            content,
            baseRevision,
            label,
            actor: operationActor(),
            agentId: state.agent.id,
            leaseId,
          },
        });
        return toolResult(payload);
      } catch (error) {
        return toolFailure(error);
      }
    },
  );
  server.registerTool(
    'operation_approve',
    {
      title: 'Approve operation',
      description: 'Approve one previewed operation. Approval does not apply it.',
      inputSchema: z.object({ operationId: z.string().trim().min(1).max(128) }).strict(),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    safeOperationAction('approve'),
  );
  server.registerTool(
    'operation_reject',
    {
      title: 'Reject operation',
      description: 'Reject one previewed or approved operation without changing project files.',
      inputSchema: z.object({ operationId: z.string().trim().min(1).max(128) }).strict(),
      annotations: { destructiveHint: false, idempotentHint: false },
    },
    safeOperationAction('reject'),
  );
  server.registerTool(
    'operation_apply',
    {
      title: 'Apply spatial attachment operation',
      description: 'Apply one approved spatial attachment operation under an owned covering write lease.',
      inputSchema: z.object({
        operationId: z.string().trim().min(1).max(128),
        leaseId: z.string().trim().min(1).max(128),
      }).strict(),
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    safeOperationAction('apply', { requireSpatialLease: true }),
  );
  server.registerTool(
    'operation_undo',
    {
      title: 'Undo spatial attachment operation',
      description: 'Undo one applied spatial attachment operation under an owned covering write lease.',
      inputSchema: z.object({
        operationId: z.string().trim().min(1).max(128),
        leaseId: z.string().trim().min(1).max(128),
      }).strict(),
      annotations: { destructiveHint: true, idempotentHint: false },
    },
    safeOperationAction('undo', { requireSpatialLease: true }),
  );
}

async function start(options) {
  const session = await resolveSession(options);
  const registration = await requestJson(options.baseUrl, '/api/coordination/agents', {
    method: 'POST',
    body: { sessionId: session.id, name: options.name },
  });
  const state = {
    baseUrl: options.baseUrl,
    session,
    agent: registration.agent,
    credential: registration.credential,
    leaseIds: new Set(),
    heartbeat: async () => {
      const payload = await requestJson(
        options.baseUrl,
        `/api/coordination/agents/${encodeURIComponent(registration.agent.id)}/heartbeat`,
        { method: 'POST', credential: registration.credential },
      );
      state.agent = payload.agent;
      return payload;
    },
  };

  let closing = false;
  let cleanupPromise;
  let shutdownPromise;
  let automaticHeartbeatPending = false;
  let handle;
  const heartbeatTimer = setInterval(async () => {
    if (automaticHeartbeatPending || closing) return;
    automaticHeartbeatPending = true;
    try {
      await state.heartbeat();
    } catch (error) {
      if (!closing) console.error(`sf-mcp heartbeat failed: ${error.message}`);
    } finally {
      automaticHeartbeatPending = false;
    }
  }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref();

  const cleanup = () => {
    if (cleanupPromise) return cleanupPromise;
    closing = true;
    clearInterval(heartbeatTimer);
    cleanupPromise = requestJson(
      options.baseUrl,
      `/api/coordination/agents/${encodeURIComponent(state.agent.id)}/disconnect`,
      {
        method: 'POST',
        credential: state.credential,
        timeoutMs: SHUTDOWN_TIMEOUT_MS,
      },
    ).catch(() => {
      // The session daemon may already be gone or the agent may have expired.
    });
    return cleanupPromise;
  };

  const shutdown = (exitCode) => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      const timeout = new Promise((resolve) => {
        const timer = setTimeout(resolve, SHUTDOWN_TIMEOUT_MS);
        timer.unref();
      });
      await Promise.race([cleanup(), timeout]);
      if (handle) await Promise.race([handle.close().catch(() => {}), timeout]);
      process.exit(exitCode);
    })();
    return shutdownPromise;
  };

  process.once('SIGINT', () => void shutdown(0));
  process.once('SIGTERM', () => void shutdown(0));
  process.stdin.once('end', () => void shutdown(0));

  handle = serveStdio(() => {
    const server = new McpServer({ name: 'sf-mcp', title: 'Shader Forge MCP', version: '0.2.0' });
    registerSurface(server, state);
    return server;
  }, {
    onerror: (error) => console.error(`sf-mcp protocol error: ${error.message}`),
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stderr.write(`${usage()}\n`);
    return;
  }
  await start(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`sf-mcp failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
