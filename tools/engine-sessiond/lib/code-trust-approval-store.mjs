import { randomUUID } from 'node:crypto';

function approvalView(record) {
  return {
    id: record.id,
    sessionId: record.sessionId,
    requestedBy: record.requestedBy,
    operationType: record.operationType,
    summary: record.summary,
    status: record.status,
    decision: record.decision,
    decisionBy: record.decisionBy,
    createdAt: record.createdAt,
    resolvedAt: record.resolvedAt,
    codeTrust: record.codeTrust,
    outcome: record.outcome,
  };
}

function approvalFingerprint({ sessionId, requestedBy, operationType, request, codeTrust }) {
  return JSON.stringify({
    sessionId: sessionId || null,
    requestedBy: requestedBy || 'assistant',
    operationType: operationType || '',
    request: request || null,
    action: codeTrust?.action || '',
    path: codeTrust?.path || '',
    origin: codeTrust?.effectiveOrigin || '',
  });
}

export class CodeTrustApprovalStore {
  #approvals = new Map();
  #emitEvent;

  constructor({ emitEvent } = {}) {
    this.#emitEvent = typeof emitEvent === 'function' ? emitEvent : () => {};
  }

  listApprovals({ sessionId = '', state = 'pending' } = {}) {
    return Array.from(this.#approvals.values())
      .filter((approval) => {
        if (sessionId && approval.sessionId && approval.sessionId !== sessionId) {
          return false;
        }
        if (state === 'all') {
          return true;
        }
        return approval.status === state;
      })
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((approval) => structuredClone(approvalView(approval)));
  }

  getApprovalRecord(approvalId) {
    const approval = this.#approvals.get(approvalId);
    return approval ? structuredClone(approval) : null;
  }

  createApproval({
    sessionId = '',
    requestedBy = 'assistant',
    operationType,
    summary,
    request,
    codeTrust,
  } = {}) {
    const fingerprint = approvalFingerprint({
      sessionId,
      requestedBy,
      operationType,
      request,
      codeTrust,
    });

    for (const approval of this.#approvals.values()) {
      if (approval.status === 'pending' && approval.fingerprint === fingerprint) {
        return structuredClone(approvalView(approval));
      }
    }

    const timestamp = new Date().toISOString();
    const record = {
      id: `approval_${randomUUID()}`,
      sessionId: sessionId || null,
      requestedBy,
      operationType,
      summary: String(summary || '').trim() || `${operationType} review`,
      status: 'pending',
      decision: null,
      decisionBy: null,
      createdAt: timestamp,
      resolvedAt: null,
      request: structuredClone(request || {}),
      codeTrust: structuredClone(codeTrust || null),
      outcome: null,
      fingerprint,
    };

    this.#approvals.set(record.id, record);
    const view = approvalView(record);
    this.#emitEvent('code-trust.approval.created', view);
    return structuredClone(view);
  }

  resolveApproval(approvalId, { status, decisionBy = 'human', outcome = null } = {}) {
    const approval = this.#approvals.get(approvalId);
    if (!approval) {
      throw new Error(`Unknown code-trust approval: ${approvalId}`);
    }
    if (approval.status !== 'pending') {
      throw new Error(`Code-trust approval ${approvalId} is already ${approval.status}.`);
    }

    const resolved = {
      ...approval,
      status,
      decision: status === 'approved' ? 'approved' : status === 'denied' ? 'denied' : 'failed',
      decisionBy,
      resolvedAt: new Date().toISOString(),
      outcome: outcome ? structuredClone(outcome) : null,
    };

    this.#approvals.set(approvalId, resolved);
    const view = approvalView(resolved);
    this.#emitEvent('code-trust.approval.resolved', view);
    return structuredClone(view);
  }
}
