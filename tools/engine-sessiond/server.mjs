import http from 'node:http';
import path from 'node:path';
import { URL, pathToFileURL } from 'node:url';
import { BuildStore } from './lib/build-store.mjs';
import { CodeTrustApprovalStore } from './lib/code-trust-approval-store.mjs';
import { initGitRepository, readGitStatus } from './lib/git-service.mjs';
import { getPlatformInfo, listHostDirectory } from './lib/host-fs-service.mjs';
import { SessionStore } from './lib/session-store.mjs';
import { RuntimeStore } from './lib/runtime-store.mjs';
import { TerminalStore } from './lib/terminal-store.mjs';
import {
  codeTrustDefaultTargetPath,
  codeTrustRepoRoot,
  evaluateCodeTrustAction,
  inspectCodeTrustState,
  listCodeTrustArtifacts,
  recordCodeTrustArtifact,
  transitionCodeTrustArtifact,
} from '../shared/code-trust-policy.mjs';
import {
  inspectAiProviders,
  testAiProvider,
} from '../shared/engine-ai-service.mjs';
import {
  inspectPackagingPreset,
  packageProjectRelease,
} from '../shared/engine-packaging-service.mjs';
import {
  captureProfilingSnapshot,
  inspectProfilingState,
  listProfilingCaptures,
} from '../shared/engine-profiling-service.mjs';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  };
}

function jsonHeaders(statusCode = 200) {
  return {
    statusCode,
    headers: {
      ...corsHeaders(),
      'Content-Type': 'application/json; charset=utf-8',
    },
  };
}

function sseHeaders() {
  return {
    ...corsHeaders(),
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
}

function writeJson(response, statusCode, payload) {
  const { headers } = jsonHeaders(statusCode);
  response.writeHead(statusCode, headers);
  response.end(JSON.stringify(payload, null, 2));
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  if (!chunks.length) {
    return {};
  }
  const rawBody = Buffer.concat(chunks).toString('utf8');
  return rawBody ? JSON.parse(rawBody) : {};
}

function createEventHub() {
  const listeners = new Set();

  function emit(type, data) {
    const chunk = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const response of listeners) {
      response.write(chunk);
    }
  }

  function subscribe(request, response) {
    response.writeHead(200, sseHeaders());
    response.write(': connected\n\n');
    listeners.add(response);

    const heartbeat = setInterval(() => {
      response.write(': ping\n\n');
    }, 15000);

    request.on('close', () => {
      clearInterval(heartbeat);
      listeners.delete(response);
    });
  }

  function closeAll() {
    for (const response of listeners) {
      response.end();
    }
    listeners.clear();
  }

  return {
    emit,
    subscribe,
    closeAll,
  };
}

function trimLogBuffer(currentValue, appendedValue, maxLength = 16000) {
  const merged = `${String(currentValue || '')}${String(appendedValue || '')}`;
  if (merged.length <= maxLength) {
    return merged;
  }
  return merged.slice(merged.length - maxLength);
}

function createDiagnosticsRecorder(eventHub) {
  let runtimeLog = '';
  let buildLog = '';

  return {
    emit(type, data) {
      if (type === 'runtime.log') {
        runtimeLog = trimLogBuffer(runtimeLog, data?.data || '');
      }
      if (type === 'build.log') {
        buildLog = trimLogBuffer(buildLog, data?.data || '');
      }
      eventHub.emit(type, data);
    },
    snapshot() {
      return {
        runtimeLog,
        buildLog,
      };
    },
  };
}

function resolveTerminalCwd({ sessionStore, sessionId, cwd }) {
  if (sessionId) {
    return sessionStore.resolveSessionPath(sessionId, cwd || '.');
  }
  return path.resolve(cwd || process.cwd());
}

function resolveRuntimeLaunchContext(sessionStore, sessionId) {
  if (!sessionId) {
    return {
      sessionId: '',
      workspaceRoot: '',
    };
  }

  return {
    sessionId,
    workspaceRoot: sessionStore.resolveSessionPath(sessionId, '.'),
  };
}

function resolveCodeTrustRoot(sessionStore, sessionId, fallbackRoot = codeTrustRepoRoot) {
  if (!sessionId) {
    return path.resolve(fallbackRoot);
  }
  return sessionStore.resolveSessionPath(sessionId, '.');
}

function readCodeTrustActor(body) {
  return body?.policy && typeof body.policy === 'object' && typeof body.policy.actor === 'string'
    ? body.policy.actor.trim()
    : typeof body?.actor === 'string'
      ? body.actor.trim()
      : 'human';
}

function readCodeTrustOrigin(body) {
  return body?.policy && typeof body.policy === 'object' && typeof body.policy.origin === 'string'
    ? body.policy.origin.trim()
    : typeof body?.origin === 'string'
      ? body.origin.trim()
      : '';
}

function createHttpError(statusCode, message, extras = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  Object.assign(error, extras);
  return error;
}

function codeTrustErrorMessage(codeTrust) {
  if (Array.isArray(codeTrust?.diagnostics) && codeTrust.diagnostics.length) {
    return codeTrust.diagnostics[0].message;
  }
  return `Code-trust policy blocked ${codeTrust?.action || 'the request'} for ${codeTrust?.path || 'the target path'}.`;
}

function requireTrimmedString(value, fieldName) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw createHttpError(400, `${fieldName} is required.`);
  }
  return normalized;
}

function normalizeFileWriteRequest(body = {}) {
  return {
    sessionId: requireTrimmedString(body.sessionId, 'sessionId'),
    path: requireTrimmedString(body.path, 'path'),
    content: typeof body.content === 'string' ? body.content : '',
  };
}

function normalizeBuildRuntimeRequest(body = {}) {
  return {
    config: typeof body.config === 'string' && body.config.trim() ? body.config.trim() : 'Debug',
    buildDir: typeof body.buildDir === 'string' && body.buildDir.trim() ? body.buildDir.trim() : undefined,
  };
}

function normalizeRuntimeRequest(body = {}) {
  return {
    sessionId: typeof body.sessionId === 'string' ? body.sessionId.trim() : '',
    scene: typeof body.scene === 'string' && body.scene.trim() ? body.scene.trim() : 'sandbox',
  };
}

function approvalRequestForOperation(operationType, body) {
  if (operationType === 'file_write') {
    return normalizeFileWriteRequest(body);
  }
  if (operationType === 'build_runtime') {
    return normalizeBuildRuntimeRequest(body);
  }
  if (operationType === 'runtime_start' || operationType === 'runtime_restart') {
    return normalizeRuntimeRequest(body);
  }
  throw createHttpError(400, `Unsupported approval operation: ${operationType}`);
}

function approvalSummary(operationType, request, codeTrust) {
  if (operationType === 'file_write') {
    return `Review assistant file write to ${codeTrust?.path || request.path}`;
  }
  if (operationType === 'build_runtime') {
    return `Review assistant runtime build (${request.config})`;
  }
  if (operationType === 'runtime_start') {
    return `Review assistant runtime start (${request.scene})`;
  }
  if (operationType === 'runtime_restart') {
    return `Review assistant runtime restart (${request.scene})`;
  }
  return `${operationType} review`;
}

async function executeFileWrite({
  sessionStore,
  request,
  codeTrust,
  actor = 'human',
  origin = '',
}) {
  const fileWrite = normalizeFileWriteRequest(request);
  const rootPath = resolveCodeTrustRoot(sessionStore, fileWrite.sessionId);
  const result = await sessionStore.writeFile(fileWrite.sessionId, fileWrite.path, fileWrite.content);
  await recordCodeTrustArtifact({
    rootPath,
    relativePath: fileWrite.path,
    actor,
    origin,
    evaluation: codeTrust,
  });
  return {
    ...result,
    codeTrust,
  };
}

function executeBuildRuntime({ buildStore, request }) {
  const buildRequest = normalizeBuildRuntimeRequest(request);
  return buildStore.startBuild({
    target: 'runtime',
    config: buildRequest.config,
    buildDir: buildRequest.buildDir,
  });
}

function executeRuntimeStart({ sessionStore, runtimeStore, request }) {
  const runtimeRequest = normalizeRuntimeRequest(request);
  const launchContext = resolveRuntimeLaunchContext(sessionStore, runtimeRequest.sessionId);
  return runtimeStore.startRuntime({
    scene: runtimeRequest.scene,
    sessionId: launchContext.sessionId,
    workspaceRoot: launchContext.workspaceRoot,
  });
}

async function executeRuntimeRestart({ sessionStore, runtimeStore, request }) {
  const runtimeRequest = normalizeRuntimeRequest(request);
  const launchContext = resolveRuntimeLaunchContext(sessionStore, runtimeRequest.sessionId);
  return runtimeStore.restartRuntime({
    scene: runtimeRequest.scene,
    sessionId: launchContext.sessionId,
    workspaceRoot: launchContext.workspaceRoot,
  });
}

async function executeApprovedOperation({ sessionStore, runtimeStore, buildStore }, approvalRecord) {
  if (!approvalRecord) {
    throw createHttpError(404, 'Approval record is required.');
  }
  if (approvalRecord.operationType === 'file_write') {
    return executeFileWrite({
      sessionStore,
      request: approvalRecord.request,
      codeTrust: approvalRecord.codeTrust,
      actor: 'human',
      origin: approvalRecord.codeTrust?.effectiveOrigin || '',
    });
  }
  if (approvalRecord.operationType === 'build_runtime') {
    return executeBuildRuntime({
      buildStore,
      request: approvalRecord.request,
    });
  }
  if (approvalRecord.operationType === 'runtime_start') {
    return executeRuntimeStart({
      sessionStore,
      runtimeStore,
      request: approvalRecord.request,
    });
  }
  if (approvalRecord.operationType === 'runtime_restart') {
    return executeRuntimeRestart({
      sessionStore,
      runtimeStore,
      request: approvalRecord.request,
    });
  }
  throw createHttpError(400, `Unsupported approval operation: ${approvalRecord.operationType}`);
}

function queueOrRejectCodeTrustRequest({
  approvalStore,
  operationType,
  sessionId = '',
  requestBody,
  codeTrust,
}) {
  if (codeTrust.allowed) {
    return;
  }

  const message = codeTrustErrorMessage(codeTrust);
  if (codeTrust.decision === 'review_required') {
    const approvalRequest = approvalRequestForOperation(operationType, requestBody);
    const approval = approvalStore.createApproval({
      sessionId: sessionId || approvalRequest.sessionId || '',
      requestedBy: codeTrust.actor,
      operationType,
      summary: approvalSummary(operationType, approvalRequest, codeTrust),
      request: approvalRequest,
      codeTrust,
    });
    throw createHttpError(409, message, { codeTrust, approval });
  }

  throw createHttpError(403, message, { codeTrust });
}

function requirePendingApproval(approvalStore, approvalId) {
  const approval = approvalStore.getApprovalRecord(approvalId);
  if (!approval) {
    throw createHttpError(404, `Unknown code-trust approval: ${approvalId}`);
  }
  if (approval.status !== 'pending') {
    throw createHttpError(409, `Code-trust approval ${approvalId} is already ${approval.status}.`);
  }
  return approval;
}

function createRouter({
  sessionStore,
  terminalStore,
  runtimeStore,
  buildStore,
  approvalStore,
  eventHub,
  diagnosticsRecorder,
}) {
  return async function route(request, response) {
    if (!request.url) {
      writeJson(response, 400, { error: 'Request URL is required.' });
      return;
    }

    if (request.method === 'OPTIONS') {
      response.writeHead(204, corsHeaders());
      response.end();
      return;
    }

    const requestUrl = new URL(request.url, 'http://127.0.0.1');
    const { pathname, searchParams } = requestUrl;

    try {
      if (request.method === 'GET' && pathname === '/health') {
        const capabilities = [
          'sessions',
          'sessions:update',
          'sessions:delete',
          'files:list',
          'files:read',
          'files:write',
          'hostfs:list',
          'git:status',
          'git:init',
          'terminals',
          'runtime:lifecycle',
          'build:lifecycle',
          'code-trust:summary',
          'code-trust:evaluate',
          'code-trust:artifacts',
          'code-trust:approvals',
          'ai:providers',
          'ai:test',
          'package:inspect',
          'package:run',
          'profile:live',
          'profile:capture',
          'profile:list',
          'events',
        ];
        if (runtimeStore.supportsPause()) {
          capabilities.push('runtime:lifecycle:pause', 'runtime:lifecycle:resume');
        }
        writeJson(response, 200, {
          ok: true,
          service: 'engine_sessiond',
          now: new Date().toISOString(),
          capabilities,
        });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/platform') {
        writeJson(response, 200, getPlatformInfo());
        return;
      }

      if (request.method === 'GET' && pathname === '/api/ai/providers') {
        const sessionId = searchParams.get('sessionId') || '';
        const summary = await inspectAiProviders(resolveCodeTrustRoot(sessionStore, sessionId, codeTrustRepoRoot));
        writeJson(response, 200, summary);
        return;
      }

      if (request.method === 'POST' && pathname === '/api/ai/test') {
        const body = await readJsonBody(request);
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
        const result = await testAiProvider(
          resolveCodeTrustRoot(sessionStore, sessionId, codeTrustRepoRoot),
          {
            providerId: typeof body.providerId === 'string' ? body.providerId.trim() : '',
            prompt: typeof body.prompt === 'string' && body.prompt.trim() ? body.prompt.trim() : undefined,
            systemPrompt: typeof body.systemPrompt === 'string' && body.systemPrompt.trim()
              ? body.systemPrompt.trim()
              : undefined,
          },
        );
        writeJson(response, 200, result);
        return;
      }

      if (request.method === 'GET' && pathname === '/api/package/inspect') {
        const sessionId = searchParams.get('sessionId') || '';
        const presetId = searchParams.get('preset') || 'default';
        const summary = await inspectPackagingPreset(
          resolveCodeTrustRoot(sessionStore, sessionId, codeTrustRepoRoot),
          {
            presetId,
          },
        );
        writeJson(response, 200, summary);
        return;
      }

      if (request.method === 'POST' && pathname === '/api/package/run') {
        const body = await readJsonBody(request);
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
        const presetId = typeof body.presetId === 'string' && body.presetId.trim()
          ? body.presetId.trim()
          : 'default';
        const packageRoot = typeof body.packageRoot === 'string' && body.packageRoot.trim()
          ? body.packageRoot.trim()
          : '';
        const forceBake = body.forceBake === true;
        const prepareCookedAssets = body.prepareCookedAssets !== false;
        const report = await packageProjectRelease(
          resolveCodeTrustRoot(sessionStore, sessionId, codeTrustRepoRoot),
          {
            presetId,
            ...(packageRoot ? { packageRoot } : {}),
            forceBake,
            prepareCookedAssets,
          },
        );
        writeJson(response, 200, report);
        return;
      }

      if (request.method === 'GET' && pathname === '/api/profile/live') {
        const sessionId = searchParams.get('sessionId') || '';
        const presetId = searchParams.get('preset') || 'default';
        const rootPath = resolveCodeTrustRoot(sessionStore, sessionId, codeTrustRepoRoot);
        const profile = await inspectProfilingState({
          rootPath,
          sessionId,
          presetId,
          runtimeStatus: runtimeStore.status(),
          buildStatus: buildStore.status(),
          gitStatus: readGitStatus(rootPath),
          ...diagnosticsRecorder.snapshot(),
        });
        writeJson(response, 200, profile);
        return;
      }

      if (request.method === 'GET' && pathname === '/api/profile/captures') {
        const sessionId = searchParams.get('sessionId') || '';
        const limit = Number.parseInt(searchParams.get('limit') || '10', 10);
        const rootPath = resolveCodeTrustRoot(sessionStore, sessionId, codeTrustRepoRoot);
        const captures = await listProfilingCaptures(rootPath, {
          limit: Number.isFinite(limit) ? limit : 10,
        });
        writeJson(response, 200, captures);
        return;
      }

      if (request.method === 'POST' && pathname === '/api/profile/capture') {
        const body = await readJsonBody(request);
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
        const presetId = typeof body.presetId === 'string' && body.presetId.trim()
          ? body.presetId.trim()
          : 'default';
        const label = typeof body.label === 'string' && body.label.trim()
          ? body.label.trim()
          : 'diagnostics';
        const outputPath = typeof body.outputPath === 'string' && body.outputPath.trim()
          ? body.outputPath.trim()
          : '';
        const rootPath = resolveCodeTrustRoot(sessionStore, sessionId, codeTrustRepoRoot);
        const capture = await captureProfilingSnapshot({
          rootPath,
          sessionId,
          presetId,
          label,
          ...(outputPath ? { outputPath } : {}),
          runtimeStatus: runtimeStore.status(),
          buildStatus: buildStore.status(),
          gitStatus: readGitStatus(rootPath),
          ...diagnosticsRecorder.snapshot(),
        });
        writeJson(response, 200, capture);
        return;
      }

      if (request.method === 'GET' && pathname === '/api/events') {
        eventHub.subscribe(request, response);
        return;
      }

      if (request.method === 'GET' && pathname === '/api/code-trust/summary') {
        const sessionId = searchParams.get('sessionId') || '';
        const rootPath = resolveCodeTrustRoot(sessionStore, sessionId);
        const summary = await inspectCodeTrustState(rootPath);
        writeJson(response, 200, summary);
        return;
      }

      if (request.method === 'POST' && pathname === '/api/code-trust/evaluate') {
        const body = await readJsonBody(request);
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
        const action = typeof body.action === 'string' ? body.action.trim() : '';
        const scope = typeof body.scope === 'string' ? body.scope.trim() : '';
        const relativePath = typeof body.path === 'string' && body.path.trim()
          ? body.path.trim()
          : codeTrustDefaultTargetPath(action);
        const rootPath = scope === 'engine'
          ? resolveCodeTrustRoot(sessionStore, '', codeTrustRepoRoot)
          : resolveCodeTrustRoot(
            sessionStore,
            sessionId,
            action === 'compile' || action === 'load' ? codeTrustRepoRoot : codeTrustRepoRoot,
          );
        const evaluation = await evaluateCodeTrustAction({
          rootPath,
          action,
          relativePath,
          actor: readCodeTrustActor(body),
          origin: readCodeTrustOrigin(body),
        });
        writeJson(response, 200, evaluation);
        return;
      }

      if (request.method === 'GET' && pathname === '/api/code-trust/artifacts') {
        const sessionId = searchParams.get('sessionId') || '';
        const limit = Number.parseInt(searchParams.get('limit') || '64', 10);
        const rootPath = resolveCodeTrustRoot(sessionStore, sessionId);
        const artifacts = await listCodeTrustArtifacts(rootPath, {
          limit: Number.isFinite(limit) ? limit : 64,
        });
        writeJson(response, 200, { artifacts });
        return;
      }

      if (request.method === 'POST' && pathname === '/api/code-trust/artifacts/transition') {
        const body = await readJsonBody(request);
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
        const relativePath = typeof body.path === 'string' ? body.path.trim() : '';
        const transition = typeof body.transition === 'string' ? body.transition.trim() : '';
        const decisionBy = typeof body.decisionBy === 'string' && body.decisionBy.trim()
          ? body.decisionBy.trim()
          : 'human';
        const note = typeof body.note === 'string' ? body.note : '';
        if (!relativePath) {
          throw createHttpError(400, 'path is required.');
        }

        const artifact = await transitionCodeTrustArtifact({
          rootPath: resolveCodeTrustRoot(sessionStore, sessionId),
          relativePath,
          transition,
          decidedBy: decisionBy,
          note,
        });
        eventHub.emit('code-trust.artifact.transitioned', {
          sessionId: sessionId || null,
          transition,
          artifact,
        });
        writeJson(response, 200, { artifact });
        return;
      }

      if (request.method === 'GET' && pathname === '/api/code-trust/approvals') {
        const sessionId = searchParams.get('sessionId') || '';
        const state = searchParams.get('state') || 'pending';
        writeJson(response, 200, {
          approvals: approvalStore.listApprovals({ sessionId, state }),
        });
        return;
      }

      const approvalDecisionMatch = request.method === 'POST'
        ? pathname.match(/^\/api\/code-trust\/approvals\/([^/]+)\/decision$/)
        : null;
      if (approvalDecisionMatch) {
        const approvalId = decodeURIComponent(approvalDecisionMatch[1]);
        const body = await readJsonBody(request);
        const decision = typeof body.decision === 'string' ? body.decision.trim() : '';
        const decisionBy = typeof body.decisionBy === 'string' && body.decisionBy.trim()
          ? body.decisionBy.trim()
          : 'human';
        const approvalRecord = requirePendingApproval(approvalStore, approvalId);

        if (!['approved', 'denied'].includes(decision)) {
          throw createHttpError(400, 'decision must be approved or denied.');
        }

        if (decision === 'denied') {
          const approval = approvalStore.resolveApproval(approvalId, {
            status: 'denied',
            decisionBy,
            outcome: {
              deniedAt: new Date().toISOString(),
            },
          });
          writeJson(response, 200, { approval });
          return;
        }

        try {
          const outcome = await executeApprovedOperation(
            { sessionStore, runtimeStore, buildStore },
            approvalRecord,
          );
          const approval = approvalStore.resolveApproval(approvalId, {
            status: 'approved',
            decisionBy,
            outcome,
          });
          writeJson(response, 200, { approval, outcome });
          return;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const statusCode =
            typeof error === 'object' && error && 'statusCode' in error && Number.isInteger(error.statusCode)
              ? Number(error.statusCode)
              : 500;
          const approval = approvalStore.resolveApproval(approvalId, {
            status: 'failed',
            decisionBy,
            outcome: {
              error: message,
            },
          });
          throw createHttpError(statusCode, message, { approval });
        }
      }

      if (request.method === 'GET' && pathname === '/api/sessions') {
        writeJson(response, 200, { sessions: sessionStore.listSessions() });
        return;
      }

      if (request.method === 'POST' && pathname === '/api/sessions') {
        const body = await readJsonBody(request);
        const session = await sessionStore.createSession({
          name: body.name,
          rootPath: body.rootPath,
        });
        writeJson(response, 201, { session });
        return;
      }

      if (request.method === 'GET' && pathname.startsWith('/api/sessions/')) {
        const sessionId = pathname.slice('/api/sessions/'.length);
        const session = sessionStore.getSession(sessionId);
        if (!session) {
          writeJson(response, 404, { error: `Unknown session: ${sessionId}` });
          return;
        }
        writeJson(response, 200, { session });
        return;
      }

      if (request.method === 'PATCH' && pathname.startsWith('/api/sessions/')) {
        const sessionId = pathname.slice('/api/sessions/'.length);
        const body = await readJsonBody(request);
        const session = await sessionStore.updateSession(sessionId, {
          name: body.name,
          rootPath: body.rootPath,
        });
        writeJson(response, 200, { session });
        return;
      }

      if (request.method === 'DELETE' && pathname.startsWith('/api/sessions/')) {
        const sessionId = pathname.slice('/api/sessions/'.length);
        const result = await sessionStore.deleteSession(sessionId);
        writeJson(response, 200, result);
        return;
      }

      if (request.method === 'GET' && pathname === '/api/files/list') {
        const sessionId = searchParams.get('sessionId') || '';
        const relativePath = searchParams.get('path') || '.';
        const result = await sessionStore.listFiles(sessionId, relativePath);
        writeJson(response, 200, result);
        return;
      }

      if (request.method === 'GET' && pathname === '/api/files/read') {
        const sessionId = searchParams.get('sessionId') || '';
        const relativePath = searchParams.get('path') || '';
        const result = await sessionStore.readFile(sessionId, relativePath);
        writeJson(response, 200, result);
        return;
      }

      if (request.method === 'POST' && pathname === '/api/files/write') {
        const body = await readJsonBody(request);
        const fileWrite = normalizeFileWriteRequest(body);
        const rootPath = resolveCodeTrustRoot(sessionStore, fileWrite.sessionId);
        const codeTrust = await evaluateCodeTrustAction({
          rootPath,
          action: 'apply',
          relativePath: fileWrite.path,
          actor: readCodeTrustActor(body),
          origin: readCodeTrustOrigin(body),
        });
        queueOrRejectCodeTrustRequest({
          approvalStore,
          operationType: 'file_write',
          sessionId: fileWrite.sessionId,
          requestBody: fileWrite,
          codeTrust,
        });
        const result = await executeFileWrite({
          sessionStore,
          request: fileWrite,
          codeTrust,
          actor: readCodeTrustActor(body),
          origin: readCodeTrustOrigin(body),
        });
        writeJson(response, 200, result);
        return;
      }

      if (request.method === 'GET' && pathname === '/api/hostfs/list') {
        const targetPath = searchParams.get('path') || '/';
        const result = await listHostDirectory(targetPath);
        writeJson(response, 200, result);
        return;
      }

      if (request.method === 'GET' && pathname === '/api/git/status') {
        const sessionId = searchParams.get('sessionId') || '';
        const sessionRoot = sessionStore.resolveSessionPath(sessionId, '.');
        writeJson(response, 200, readGitStatus(sessionRoot));
        return;
      }

      if (request.method === 'GET' && pathname === '/api/runtime/status') {
        writeJson(response, 200, runtimeStore.status());
        return;
      }

      if (request.method === 'GET' && pathname === '/api/build/status') {
        writeJson(response, 200, buildStore.status());
        return;
      }

      if (request.method === 'POST' && pathname === '/api/runtime/start') {
        const body = await readJsonBody(request);
        const runtimeRequest = normalizeRuntimeRequest(body);
        const codeTrust = await evaluateCodeTrustAction({
          rootPath: resolveCodeTrustRoot(sessionStore, '', codeTrustRepoRoot),
          action: 'load',
          relativePath: codeTrustDefaultTargetPath('load'),
          actor: readCodeTrustActor(body),
          origin: readCodeTrustOrigin(body),
        });
        queueOrRejectCodeTrustRequest({
          approvalStore,
          operationType: 'runtime_start',
          sessionId: runtimeRequest.sessionId,
          requestBody: runtimeRequest,
          codeTrust,
        });
        const status = executeRuntimeStart({
          sessionStore,
          runtimeStore,
          request: runtimeRequest,
        });
        writeJson(response, 200, status);
        return;
      }

      if (request.method === 'POST' && pathname === '/api/build/runtime') {
        const body = await readJsonBody(request);
        const buildRequest = normalizeBuildRuntimeRequest(body);
        const codeTrust = await evaluateCodeTrustAction({
          rootPath: resolveCodeTrustRoot(sessionStore, '', codeTrustRepoRoot),
          action: 'compile',
          relativePath: codeTrustDefaultTargetPath('compile'),
          actor: readCodeTrustActor(body),
          origin: readCodeTrustOrigin(body),
        });
        queueOrRejectCodeTrustRequest({
          approvalStore,
          operationType: 'build_runtime',
          requestBody: buildRequest,
          codeTrust,
        });
        const status = executeBuildRuntime({
          buildStore,
          request: buildRequest,
        });
        writeJson(response, 200, status);
        return;
      }

      if (request.method === 'POST' && pathname === '/api/git/init') {
        const body = await readJsonBody(request);
        const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
        const sessionRoot = sessionStore.resolveSessionPath(sessionId, '.');
        writeJson(response, 200, initGitRepository(sessionRoot));
        return;
      }

      if (request.method === 'POST' && pathname === '/api/runtime/stop') {
        const status = await runtimeStore.stopRuntime();
        writeJson(response, 200, status);
        return;
      }

      if (request.method === 'POST' && pathname === '/api/runtime/pause') {
        const status = runtimeStore.pauseRuntime();
        writeJson(response, 200, status);
        return;
      }

      if (request.method === 'POST' && pathname === '/api/runtime/resume') {
        const status = runtimeStore.resumeRuntime();
        writeJson(response, 200, status);
        return;
      }

      if (request.method === 'POST' && pathname === '/api/build/stop') {
        const status = await buildStore.stopBuild();
        writeJson(response, 200, status);
        return;
      }

      if (request.method === 'POST' && pathname === '/api/runtime/restart') {
        const body = await readJsonBody(request);
        const runtimeRequest = normalizeRuntimeRequest(body);
        const codeTrust = await evaluateCodeTrustAction({
          rootPath: resolveCodeTrustRoot(sessionStore, '', codeTrustRepoRoot),
          action: 'load',
          relativePath: codeTrustDefaultTargetPath('load'),
          actor: readCodeTrustActor(body),
          origin: readCodeTrustOrigin(body),
        });
        queueOrRejectCodeTrustRequest({
          approvalStore,
          operationType: 'runtime_restart',
          sessionId: runtimeRequest.sessionId,
          requestBody: runtimeRequest,
          codeTrust,
        });
        const status = await executeRuntimeRestart({
          sessionStore,
          runtimeStore,
          request: runtimeRequest,
        });
        writeJson(response, 200, status);
        return;
      }

      if (request.method === 'POST' && pathname === '/api/terminals') {
        const body = await readJsonBody(request);
        const cwd = resolveTerminalCwd({
          sessionStore,
          sessionId: typeof body.sessionId === 'string' ? body.sessionId : '',
          cwd: typeof body.cwd === 'string' ? body.cwd : '.',
        });
        const result = terminalStore.openTerminal({
          cwd,
          shell: body.shell,
          cols: body.cols,
          rows: body.rows,
        });
        writeJson(response, 201, result);
        return;
      }

      const inputMatch = request.method === 'POST' ? pathname.match(/^\/api\/terminals\/([^/]+)\/input$/) : null;
      if (inputMatch) {
        const terminalId = decodeURIComponent(inputMatch[1]);
        const body = await readJsonBody(request);
        terminalStore.writeInput(terminalId, body.input);
        writeJson(response, 200, { ok: true });
        return;
      }

      const resizeMatch = request.method === 'POST' ? pathname.match(/^\/api\/terminals\/([^/]+)\/resize$/) : null;
      if (resizeMatch) {
        const terminalId = decodeURIComponent(resizeMatch[1]);
        const body = await readJsonBody(request);
        const result = terminalStore.resizeTerminal(terminalId, {
          cols: body.cols,
          rows: body.rows,
        });
        writeJson(response, 200, result);
        return;
      }

      const deleteMatch = request.method === 'DELETE' ? pathname.match(/^\/api\/terminals\/([^/]+)$/) : null;
      if (deleteMatch) {
        const terminalId = decodeURIComponent(deleteMatch[1]);
        terminalStore.closeTerminal(terminalId);
        writeJson(response, 200, { ok: true });
        return;
      }

      writeJson(response, 404, {
        error: `No route for ${request.method} ${pathname}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const statusCode =
        typeof error === 'object' && error && 'statusCode' in error && Number.isInteger(error.statusCode)
          ? Number(error.statusCode)
          : 400;
      const payload = { error: message };
      if (typeof error === 'object' && error && 'codeTrust' in error && error.codeTrust) {
        payload.codeTrust = error.codeTrust;
      }
      if (typeof error === 'object' && error && 'approval' in error && error.approval) {
        payload.approval = error.approval;
      }
      writeJson(response, statusCode, payload);
    }
  };
}

export async function startEngineSessiond({
  host = '127.0.0.1',
  port = 41741,
  sessionStore = new SessionStore(),
  runtimeLaunchFactory,
  buildLaunchFactory,
  approvalStore,
} = {}) {
  const eventHub = createEventHub();
  const diagnosticsRecorder = createDiagnosticsRecorder(eventHub);
  const terminalStore = new TerminalStore({
    emitEvent: (type, data) => {
      diagnosticsRecorder.emit(type, data);
    },
  });
  const runtimeStore = new RuntimeStore({
    emitEvent: (type, data) => {
      diagnosticsRecorder.emit(type, data);
    },
    launchFactory: runtimeLaunchFactory,
  });
  const buildStore = new BuildStore({
    emitEvent: (type, data) => {
      diagnosticsRecorder.emit(type, data);
    },
    launchFactory: buildLaunchFactory,
  });
  const resolvedApprovalStore = approvalStore || new CodeTrustApprovalStore({
    emitEvent: (type, data) => {
      diagnosticsRecorder.emit(type, data);
    },
  });
  if (typeof sessionStore.loadSessions === 'function') {
    await sessionStore.loadSessions();
  }
  const server = http.createServer(createRouter({
    sessionStore,
    terminalStore,
    runtimeStore,
    buildStore,
    approvalStore: resolvedApprovalStore,
    eventHub,
    diagnosticsRecorder,
  }));

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to resolve engine_sessiond address.');
  }

  return {
    host: address.address,
    port: address.port,
    baseUrl: `http://${address.address}:${address.port}`,
    sessionStore,
    terminalStore,
    runtimeStore,
    buildStore,
    approvalStore: resolvedApprovalStore,
    close: async () => {
      await buildStore.close();
      await runtimeStore.close();
      terminalStore.closeAll();
      eventHub.closeAll();
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

async function runStandalone() {
  const host = process.env.SHADER_FORGE_SESSIOND_HOST?.trim() || '127.0.0.1';
  const port = Number.parseInt(process.env.SHADER_FORGE_SESSIOND_PORT?.trim() || '41741', 10);
  const service = await startEngineSessiond({ host, port });
  console.log(`engine_sessiond listening on ${service.baseUrl}`);

  const shutdown = async () => {
    await service.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runStandalone().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
