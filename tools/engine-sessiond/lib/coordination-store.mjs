import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

// Exclusive operation classes are ordinary workspace-scoped keys, not a process mutex.
// Agents in different engine workspace sessions never share these resources.
export const WORKSPACE_EXCLUSIVE_RESOURCE_KEYS = Object.freeze(['build', 'runtime']);

const DEFAULT_HEARTBEAT_TIMEOUT_MS = 30_000;
const RESOURCE_SEGMENT = /^[a-z0-9._-]+$/;

function createStoreError(statusCode, message, extras = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, extras);
  return error;
}

function createOpaqueCredential() {
  return randomBytes(32).toString('base64url');
}

function credentialsEqual(expected, provided) {
  if (typeof expected !== 'string' || typeof provided !== 'string' || !expected || !provided) {
    return false;
  }
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(provided, 'utf8');
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

function toIso(epochMs) {
  return new Date(epochMs).toISOString();
}

function normalizeAccessMode(value) {
  const mode = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (mode !== 'read' && mode !== 'write') {
    throw createStoreError(400, 'mode must be read or write.');
  }
  return mode;
}

export function normalizeResourceKey(value) {
  if (typeof value !== 'string') {
    throw createStoreError(400, 'Resource keys must be strings.');
  }

  const segments = value
    .trim()
    .replaceAll('\\', '/')
    .split('/')
    .map((segment) => segment.trim().toLowerCase())
    .filter((segment) => segment.length > 0);

  if (!segments.length) {
    throw createStoreError(400, 'Resource key is empty.');
  }

  for (const segment of segments) {
    if (segment === '.' || segment === '..' || !RESOURCE_SEGMENT.test(segment)) {
      throw createStoreError(400, `Invalid resource key segment: ${segment}`);
    }
  }

  return segments.join('/');
}

function normalizeResourceKeys(resources) {
  if (!Array.isArray(resources) || resources.length === 0) {
    throw createStoreError(400, 'resources must be a non-empty array.');
  }

  const normalized = [];
  const seen = new Set();
  for (const resource of resources) {
    const key = normalizeResourceKey(resource);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(key);
  }
  return normalized;
}

function resourceKeysOverlap(left, right) {
  return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
}

// Reads may share a key. A write conflicts with any overlapping read or write,
// including ancestor and descendant keys. Same-agent leases do not block each other.
function leasesConflict(left, right) {
  if (!left || !right) {
    return false;
  }
  if (left.id && right.id && left.id === right.id) {
    return false;
  }
  if (left.sessionId !== right.sessionId) {
    return false;
  }
  if (left.agentId === right.agentId) {
    return false;
  }
  if (left.mode === 'read' && right.mode === 'read') {
    return false;
  }
  return left.resources.some((leftKey) => (
    right.resources.some((rightKey) => resourceKeysOverlap(leftKey, rightKey))
  ));
}

function agentView(record) {
  return {
    id: record.id,
    sessionId: record.sessionId,
    name: record.name,
    status: record.status,
    connectedAt: toIso(record.connectedAtMs),
    lastHeartbeatAt: toIso(record.lastHeartbeatAtMs),
    expiresAt: toIso(record.expiresAtMs),
    ...(record.disconnectedAtMs != null ? { disconnectedAt: toIso(record.disconnectedAtMs) } : {}),
    ...(record.disconnectReason ? { disconnectReason: record.disconnectReason } : {}),
  };
}

function leaseSummary(record) {
  return {
    id: record.id,
    agentId: record.agentId,
    sessionId: record.sessionId,
    resources: [...record.resources],
    mode: record.mode,
    status: record.status,
  };
}

function leaseView(record, { queuePosition = null, blockedBy = [] } = {}) {
  return {
    id: record.id,
    agentId: record.agentId,
    sessionId: record.sessionId,
    resources: [...record.resources],
    mode: record.mode,
    status: record.status,
    createdAt: toIso(record.createdAtMs),
    grantedAt: record.grantedAtMs == null ? null : toIso(record.grantedAtMs),
    releasedAt: record.releasedAtMs == null ? null : toIso(record.releasedAtMs),
    queuePosition,
    blockedBy: blockedBy.map((blocker) => leaseSummary(blocker)),
  };
}

export class CoordinationStore {
  #agents = new Map();
  #credentials = new Map();
  #granted = new Map();
  #pending = [];
  #completed = new Map();
  #emitEvent;
  #now;
  #heartbeatTimeoutMs;

  constructor({
    emitEvent,
    now = () => Date.now(),
    heartbeatTimeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS,
  } = {}) {
    this.#emitEvent = typeof emitEvent === 'function' ? emitEvent : () => {};
    this.#now = typeof now === 'function' ? now : () => Date.now();
    const timeout = Number(heartbeatTimeoutMs);
    this.#heartbeatTimeoutMs = Number.isFinite(timeout) && timeout > 0
      ? timeout
      : DEFAULT_HEARTBEAT_TIMEOUT_MS;
  }

  registerAgent({ sessionId, name = '' } = {}) {
    this.sweepExpired();
    const resolvedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!resolvedSessionId) {
      throw createStoreError(400, 'sessionId is required.');
    }

    const nowMs = this.#now();
    const record = {
      id: `agent_${randomUUID()}`,
      sessionId: resolvedSessionId,
      name: typeof name === 'string' ? name.trim() : '',
      status: 'connected',
      connectedAtMs: nowMs,
      lastHeartbeatAtMs: nowMs,
      expiresAtMs: nowMs + this.#heartbeatTimeoutMs,
      disconnectedAtMs: null,
      disconnectReason: null,
    };
    this.#agents.set(record.id, record);
    const credential = createOpaqueCredential();
    this.#credentials.set(record.id, credential);
    const view = agentView(record);
    this.#emitEvent('coordination.agent.connected', view);
    return {
      agent: structuredClone(view),
      credential,
    };
  }

  heartbeat(agentId, credential) {
    this.sweepExpired();
    const agent = this.#requireConnectedAgent(agentId, credential);
    const nowMs = this.#now();
    agent.lastHeartbeatAtMs = nowMs;
    agent.expiresAtMs = nowMs + this.#heartbeatTimeoutMs;
    return structuredClone(agentView(agent));
  }

  disconnectAgent(agentId, credential) {
    this.sweepExpired();
    const agent = this.#requireConnectedAgent(agentId, credential);
    const view = this.#removeAgent(agent, 'disconnect');
    this.#promoteReadyLeases();
    return view;
  }

  requestLease({ agentId, credential, resources, mode } = {}) {
    this.sweepExpired();
    const agent = this.#requireConnectedAgent(agentId, credential);
    const record = {
      id: `lease_${randomUUID()}`,
      agentId: agent.id,
      sessionId: agent.sessionId,
      resources: normalizeResourceKeys(resources),
      mode: normalizeAccessMode(mode),
      status: 'queued',
      createdAtMs: this.#now(),
      grantedAtMs: null,
      releasedAtMs: null,
    };

    if (this.#canGrant(record, this.#grantedRecords(), this.#pending)) {
      this.#grantLease(record);
      return this.#publicLease(record);
    }

    this.#pending.push(record);
    const view = this.#publicLease(record);
    this.#emitEvent('coordination.lease.queued', view);
    return view;
  }

  getLease(leaseId) {
    this.sweepExpired();
    const record = this.#findLease(leaseId);
    if (!record) {
      throw createStoreError(404, `Unknown lease: ${leaseId}`);
    }
    return this.#publicLease(record);
  }

  releaseLease(leaseId, { agentId, credential } = {}) {
    this.sweepExpired();
    const record = this.#findLease(leaseId);
    if (!record) {
      throw createStoreError(404, `Unknown lease: ${leaseId}`);
    }
    if (record.status !== 'granted' && record.status !== 'queued') {
      throw createStoreError(409, `Lease ${leaseId} is already ${record.status}.`, {
        lease: this.#publicLease(record),
      });
    }

    const agent = this.#requireConnectedAgent(agentId, credential);
    if (record.agentId !== agent.id) {
      throw createStoreError(403, 'Lease can only be released by its owning agent.');
    }

    this.#finishLease(record, 'released');
    this.#promoteReadyLeases();
    return this.#publicLease(record);
  }

  clearWorkspaceSession(sessionId) {
    this.sweepExpired();
    const resolvedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!resolvedSessionId) {
      throw createStoreError(400, 'sessionId is required.');
    }

    const sessionAgents = Array.from(this.#agents.values())
      .filter((agent) => agent.sessionId === resolvedSessionId);
    for (const agent of sessionAgents) {
      this.#removeAgent(agent, 'workspace-deleted');
    }

    const leftoverLeases = [
      ...this.#grantedRecords().filter((lease) => lease.sessionId === resolvedSessionId),
      ...this.#pending.filter((lease) => lease.sessionId === resolvedSessionId),
    ];
    for (const lease of leftoverLeases) {
      this.#finishLease(lease, 'released');
    }

    for (const [leaseId, lease] of [...this.#completed.entries()]) {
      if (lease.sessionId === resolvedSessionId) {
        this.#completed.delete(leaseId);
      }
    }

    this.#promoteReadyLeases();
    return { ok: true };
  }

  inspectState({ sessionId = '' } = {}) {
    this.sweepExpired();
    const resolvedSessionId = typeof sessionId === 'string' ? sessionId.trim() : '';
    const matchesSession = (record) => !resolvedSessionId || record.sessionId === resolvedSessionId;

    return {
      sessionId: resolvedSessionId || null,
      now: toIso(this.#now()),
      exclusiveResources: [...WORKSPACE_EXCLUSIVE_RESOURCE_KEYS],
      agents: Array.from(this.#agents.values())
        .filter((agent) => agent.status === 'connected' && matchesSession(agent))
        .sort((left, right) => left.connectedAtMs - right.connectedAtMs)
        .map((agent) => structuredClone(agentView(agent))),
      granted: Array.from(this.#granted.values())
        .filter(matchesSession)
        .sort((left, right) => left.grantedAtMs - right.grantedAtMs)
        .map((lease) => this.#publicLease(lease)),
      pending: this.#pending
        .filter(matchesSession)
        .map((lease) => this.#publicLease(lease)),
    };
  }

  sweepExpired() {
    const nowMs = this.#now();
    const expiredAgents = Array.from(this.#agents.values())
      .filter((agent) => agent.status === 'connected' && nowMs >= agent.expiresAtMs);

    for (const agent of expiredAgents) {
      this.#removeAgent(agent, 'expired');
    }

    if (expiredAgents.length) {
      this.#promoteReadyLeases();
    }

    return expiredAgents.length;
  }

  #requireConnectedAgent(agentId, credential) {
    const resolvedAgentId = typeof agentId === 'string' ? agentId.trim() : '';
    if (!resolvedAgentId) {
      throw createStoreError(400, 'agentId is required.');
    }
    const provided = typeof credential === 'string' ? credential.trim() : '';
    if (!provided) {
      throw createStoreError(401, 'Agent credential is required.');
    }
    const agent = this.#agents.get(resolvedAgentId);
    if (!agent || agent.status !== 'connected') {
      throw createStoreError(404, `Unknown agent: ${resolvedAgentId || agentId}`);
    }
    const expected = this.#credentials.get(agent.id);
    if (!expected || !credentialsEqual(expected, provided)) {
      throw createStoreError(401, 'Invalid agent credential.');
    }
    return agent;
  }

  #grantedRecords() {
    return Array.from(this.#granted.values());
  }

  #findLease(leaseId) {
    const resolvedLeaseId = typeof leaseId === 'string' ? leaseId.trim() : '';
    if (!resolvedLeaseId) {
      return null;
    }
    return this.#granted.get(resolvedLeaseId)
      || this.#pending.find((lease) => lease.id === resolvedLeaseId)
      || this.#completed.get(resolvedLeaseId)
      || null;
  }

  #agentLeases(agentId) {
    return [
      ...this.#grantedRecords().filter((lease) => lease.agentId === agentId),
      ...this.#pending.filter((lease) => lease.agentId === agentId),
    ];
  }

  // Grant only when the request is free of held conflicts and does not skip an
  // earlier queued request it would conflict with. That keeps later reads from
  // starving an earlier writer.
  #canGrant(lease, heldLeases, earlierPending) {
    for (const other of heldLeases) {
      if (leasesConflict(lease, other)) {
        return false;
      }
    }
    for (const other of earlierPending) {
      if (leasesConflict(lease, other)) {
        return false;
      }
    }
    return true;
  }

  #blockersFor(lease) {
    const pendingIndex = this.#pending.findIndex((item) => item.id === lease.id);
    const earlierPending = pendingIndex >= 0 ? this.#pending.slice(0, pendingIndex) : this.#pending;
    return [
      ...this.#grantedRecords(),
      ...earlierPending,
    ].filter((other) => leasesConflict(lease, other));
  }

  #publicLease(record) {
    if (record.status === 'queued') {
      const queueIndex = this.#pending.findIndex((item) => item.id === record.id);
      return structuredClone(leaseView(record, {
        queuePosition: queueIndex >= 0 ? queueIndex + 1 : null,
        blockedBy: this.#blockersFor(record),
      }));
    }
    return structuredClone(leaseView(record));
  }

  #grantLease(record) {
    record.status = 'granted';
    record.grantedAtMs = this.#now();
    this.#granted.set(record.id, record);
    this.#emitEvent('coordination.lease.granted', this.#publicLease(record));
  }

  #finishLease(record, status) {
    record.status = status;
    record.releasedAtMs = this.#now();
    this.#granted.delete(record.id);
    this.#pending = this.#pending.filter((item) => item.id !== record.id);
    this.#completed.set(record.id, record);
    const eventType = status === 'expired'
      ? 'coordination.lease.expired'
      : 'coordination.lease.released';
    this.#emitEvent(eventType, this.#publicLease(record));
  }

  #promoteReadyLeases() {
    const stillPending = [];
    const promoted = [];

    for (const lease of this.#pending) {
      if (this.#canGrant(lease, [...this.#grantedRecords(), ...promoted], stillPending)) {
        this.#grantLease(lease);
        promoted.push(lease);
      } else {
        stillPending.push(lease);
      }
    }

    this.#pending = stillPending;
    return promoted;
  }

  #removeAgent(agent, reason) {
    const finishStatus = reason === 'expired' ? 'expired' : 'released';
    for (const lease of this.#agentLeases(agent.id)) {
      this.#finishLease(lease, finishStatus);
    }

    agent.status = 'disconnected';
    agent.disconnectedAtMs = this.#now();
    agent.disconnectReason = reason;
    this.#credentials.delete(agent.id);
    this.#agents.delete(agent.id);

    const view = structuredClone(agentView(agent));
    this.#emitEvent('coordination.agent.disconnected', view);
    return view;
  }
}
