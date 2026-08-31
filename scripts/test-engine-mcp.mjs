import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SessionStore, textContentRevision } from '../tools/engine-sessiond/lib/session-store.mjs';
import { startEngineSessiond } from '../tools/engine-sessiond/server.mjs';
import {
  availableClipping,
  availableJointLimits,
  jointLimitBone,
  restEvaluation,
} from './lib/spatial-evaluation-fixture.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spatialFixtureRoot = path.join(repoRoot, 'animation', 'fixtures', 'spatial');
const MCP_REQUEST_TIMEOUT_MS = 5_000;
const MCP_EXIT_TIMEOUT_MS = 5_000;
const sampledEvaluationCalls = [];

function createMcpClient(child) {
  let buffer = '';
  let nextId = 1;
  const pending = new Map();
  const messages = [];
  const protocolErrors = [];
  let stdoutFinalized = false;

  const rejectPending = (error) => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    pending.clear();
  };

  const finalizeStdout = () => {
    if (stdoutFinalized) return;
    stdoutFinalized = true;
    if (buffer.trim()) protocolErrors.push(`Partial stdout message: ${buffer.trim()}`);
  };

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    while (buffer.includes('\n')) {
      const newlineIndex = buffer.indexOf('\n');
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        protocolErrors.push(`Invalid JSON on stdout: ${line}`);
        rejectPending(error);
        continue;
      }
      messages.push({ line, message });
      if (message.jsonrpc !== '2.0') {
        protocolErrors.push(`Non-JSON-RPC stdout message: ${line}`);
      }
      if (message.id === undefined) continue;
      const waiter = pending.get(message.id);
      if (!waiter) continue;
      pending.delete(message.id);
      clearTimeout(waiter.timer);
      if (message.error) waiter.reject(new Error(`${message.error.code}: ${message.error.message}`));
      else waiter.resolve(message.result);
    }
  });
  child.stdout.on('end', finalizeStdout);
  child.stdout.on('close', finalizeStdout);
  child.stdin.on('error', rejectPending);
  child.once('error', (error) => rejectPending(error));
  child.once('exit', (code, signal) => {
    rejectPending(new Error(`sf-mcp exited before responding (code=${code}, signal=${signal}).`));
  });

  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  return {
    messages,
    protocolErrors,
    notify(method, params = {}) {
      send({ jsonrpc: '2.0', method, params });
    },
    request(method, params = {}) {
      const id = nextId;
      nextId += 1;
      const response = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out waiting for sf-mcp ${method} response.`));
        }, MCP_REQUEST_TIMEOUT_MS);
        pending.set(id, { resolve, reject, timer });
      });
      send({ jsonrpc: '2.0', id, method, params });
      return response;
    },
  };
}

async function waitForExit(child) {
  if (child.exitCode !== null && child.stdout.readableEnded && child.stderr.readableEnded) return child.exitCode;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for sf-mcp to exit.')), MCP_EXIT_TIMEOUT_MS);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

async function request(baseUrl, pathname, { method = 'GET', body, credential } = {}) {
  const response = await fetch(new URL(pathname, baseUrl), {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(credential ? { 'X-Shader-Forge-Agent-Credential': credential } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, payload: await response.json() };
}

function profileId(content) {
  return /^id\s*=\s*"([^"]+)"/m.exec(content)?.[1] || '';
}

async function validateAnimationRoot(animationRoot) {
  const profiles = [];
  for (const name of (await fs.readdir(path.join(animationRoot, 'attachments'))).sort()) {
    if (!name.endsWith('.attachment.toml')) continue;
    const content = await fs.readFile(path.join(animationRoot, 'attachments', name), 'utf8');
    if (content.includes('INVALID')) {
      const error = new Error('Attachment candidate is invalid.');
      error.stderr = 'native diagnostic: invalid attachment candidate';
      throw error;
    }
    const id = profileId(content);
    if (!id) throw new Error('Attachment id is required.');
    profiles.push({
      id,
      source: `attachments/${name}`,
      schemaVersion: 1,
      skeleton: 'test.skeleton',
      itemPrefab: 'test.item',
      mode: 'one_hand',
      perspective: 'third_person',
    });
  }
  return {
    schema: 'shader_forge.spatial_validation',
    schemaVersion: 1,
    animationRoot,
    counts: { skeletons: 0, clips: 0, graphs: 0, attachmentProfiles: profiles.length },
    skeletons: [],
    attachmentProfiles: profiles,
  };
}

async function evaluateRestAttachment(_animationRoot, _contentRoot, _foundationPath, attachmentId) {
  return restEvaluation(attachmentId);
}

async function evaluateSampledAttachment(
  _animationRoot,
  _contentRoot,
  _foundationPath,
  attachmentId,
  phase,
  normalizedTime,
) {
  sampledEvaluationCalls.push({ attachmentId, phase, normalizedTime });
  if (phase !== 'idle') {
    throw new Error(`Unknown motion-envelope phase '${phase}'.`);
  }
  const evaluation = restEvaluation(attachmentId);
  evaluation.pose = {
    kind: 'clip_sample',
    sampled: true,
    phase,
    clip: 'test.clip',
    normalizedTime,
    proceduralLayersRequested: ['primary_attachment'],
    proceduralLayersApplied: ['primary_attachment'],
    proceduralLayersUnavailable: [],
  };
  evaluation.diagnostics.jointLimits = availableJointLimits([jointLimitBone('hand_r')]);
  evaluation.diagnostics.clipping = availableClipping();
  evaluation.limitations = [
    'sampled_attachment_schematic_only',
    'not_review_evidence',
    'item_mesh_unavailable',
  ];
  return evaluation;
}

async function main() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-mcp-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const otherWorkspaceRoot = path.join(tempRoot, 'other-workspace');
  const attachmentPath = 'animation/attachments/rifle.attachment.toml';
  const originalAttachment = 'schema_version = 1\nid = "weapon.rifle"\ntranslation = [0.0, 0.0, 0.0]\n';
  const candidateAttachment = 'schema_version = 1\nid = "weapon.rifle"\ntranslation = [0.1, 0.0, 0.0]\n';
  await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
  await fs.mkdir(otherWorkspaceRoot, { recursive: true });
  for (const directory of ['skeletons', 'clips', 'graphs', 'attachments']) {
    await fs.mkdir(path.join(workspaceRoot, 'animation', directory), { recursive: true });
  }
  for (const directory of ['scenes', 'prefabs', 'data', 'effects', 'procgeo']) {
    await fs.mkdir(path.join(workspaceRoot, 'content', directory), { recursive: true });
  }
  await fs.cp(
    path.join(spatialFixtureRoot, 'content', 'prefabs'),
    path.join(workspaceRoot, 'content', 'prefabs'),
    { recursive: true },
  );
  await fs.cp(
    path.join(spatialFixtureRoot, 'content', 'procgeo'),
    path.join(workspaceRoot, 'content', 'procgeo'),
    { recursive: true },
  );
  await fs.mkdir(path.join(workspaceRoot, 'data', 'foundation'), { recursive: true });
  await fs.copyFile(
    path.join(spatialFixtureRoot, 'data', 'foundation', 'engine-data-layout.toml'),
    path.join(workspaceRoot, 'data', 'foundation', 'engine-data-layout.toml'),
  );
  await fs.writeFile(path.join(workspaceRoot, 'src', 'fixture.txt'), 'shader forge mcp fixture\n', 'utf8');
  await fs.writeFile(path.join(workspaceRoot, attachmentPath), originalAttachment, 'utf8');
  await fs.writeFile(path.join(workspaceRoot, 'animation', 'skeletons', 'test.skeleton.toml'), 'name = "test"\n', 'utf8');
  await fs.writeFile(path.join(workspaceRoot, 'animation', 'clips', 'test.anim.toml'), 'name = "test"\n', 'utf8');
  await fs.writeFile(path.join(workspaceRoot, 'animation', 'graphs', 'test.animgraph.toml'), 'name = "test"\n', 'utf8');
  await fs.writeFile(path.join(tempRoot, 'outside.txt'), 'outside workspace\n', 'utf8');
  await fs.cp(workspaceRoot, otherWorkspaceRoot, { recursive: true });
  await fs.writeFile(
    path.join(otherWorkspaceRoot, attachmentPath),
    'schema_version = 1\nid = "weapon.foreign"\ntranslation = [0.0, 0.0, 0.0]\n',
    'utf8',
  );

  const sessionStore = new SessionStore({ storageFilePath: path.join(tempRoot, 'state', 'sessions.json') });
  const sessiond = await startEngineSessiond({
    host: '127.0.0.1',
    port: 0,
    sessionStore,
    validateAnimationRoot,
    evaluateRestAttachment,
    evaluateSampledAttachment,
  });
  const otherSession = await sessionStore.createSession({ name: 'other', rootPath: otherWorkspaceRoot });
  let child;
  try {
    child = spawn(process.execPath, [
      path.join(repoRoot, 'tools', 'engine-mcp', 'server.mjs'),
      '--base-url', sessiond.baseUrl,
      '--root', workspaceRoot,
      '--name', 'sf-mcp-harness',
    ], {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const client = createMcpClient(child);

    const initialized = await client.request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'sf-mcp-harness', version: '1.0.0' },
    });
    assert.equal(initialized.serverInfo.name, 'sf-mcp');
    client.notify('notifications/initialized');

    const resources = await client.request('resources/list');
    assert.deepEqual(
      resources.resources.map((resource) => resource.uri).sort(),
      ['shaderforge://coordination', 'shaderforge://project'],
    );
    const projectResource = await client.request('resources/read', { uri: 'shaderforge://project' });
    const project = JSON.parse(projectResource.contents[0].text);
    assert.equal(project.product, 'Shader Forge MCP');
    assert.equal(path.resolve(project.session.rootPath), path.resolve(workspaceRoot));

    const coordinationResource = await client.request('resources/read', { uri: 'shaderforge://coordination' });
    const initialCoordination = JSON.parse(coordinationResource.contents[0].text);
    assert.equal(initialCoordination.agents.length, 1);
    assert.equal(initialCoordination.agents[0].name, 'sf-mcp-harness');

    const tools = await client.request('tools/list');
    assert.deepEqual(
      tools.tools.map((tool) => tool.name).sort(),
      [
        'agent_heartbeat',
        'coordination_state',
        'operation_apply',
        'operation_approve',
        'operation_list',
        'operation_read',
        'operation_reject',
        'operation_undo',
        'project_file_read',
        'project_files_list',
        'project_status',
        'spatial_attachment_preview',
        'spatial_attachment_read',
        'spatial_attachment_validate',
        'work_lease_release',
        'work_lease_request',
        'work_lease_status',
      ],
    );
    assert.equal(JSON.stringify(tools.tools.map((tool) => tool.inputSchema)).includes('credential'), false);
    const spatialReadTool = tools.tools.find((tool) => tool.name === 'spatial_attachment_read');
    assert.ok(spatialReadTool);
    assert.deepEqual(spatialReadTool.annotations, {
      readOnlyHint: true,
      idempotentHint: true,
    });
    assert.ok(Array.isArray(spatialReadTool.inputSchema.oneOf));
    assert.equal(spatialReadTool.inputSchema.oneOf.length, 2);
    assert.equal(
      spatialReadTool.inputSchema.oneOf.every((branch) => branch.additionalProperties === false),
      true,
    );
    const advertisedInput = JSON.stringify(spatialReadTool.inputSchema);
    assert.equal(advertisedInput.includes('sessionId'), false);
    assert.equal(advertisedInput.includes('credential'), false);
    assert.equal(advertisedInput.includes('leaseId'), false);
    assert.equal(spatialReadTool.outputSchema.type, 'object');
    assert.deepEqual(spatialReadTool.outputSchema.required.sort(), [
      'evaluation', 'path', 'revision', 'sourceRevisions',
    ]);
    const advertisedOutput = JSON.stringify(spatialReadTool.outputSchema);
    assert.match(advertisedOutput, /no_joint_limits_authored/);
    assert.match(advertisedOutput, /capsule_axis_to_oriented_box_clearance/);
    assert.match(advertisedOutput, /authored_collision_box/);

    const spatialValidateTool = tools.tools.find((tool) => tool.name === 'spatial_attachment_validate');
    assert.ok(spatialValidateTool);
    assert.deepEqual(spatialValidateTool.annotations, {
      destructiveHint: false,
      idempotentHint: false,
    });
    assert.equal(spatialValidateTool.inputSchema.additionalProperties, false);
    assert.deepEqual(Object.keys(spatialValidateTool.inputSchema.properties).sort(), [
      'operationId',
      'samples',
    ]);
    assert.deepEqual(spatialValidateTool.inputSchema.required, ['operationId']);
    assert.equal(spatialValidateTool.inputSchema.properties.samples.type, 'array');
    assert.equal(spatialValidateTool.inputSchema.properties.samples.maxItems, 64);
    assert.equal(spatialValidateTool.inputSchema.properties.samples.items.additionalProperties, false);
    assert.deepEqual(
      Object.keys(spatialValidateTool.inputSchema.properties.samples.items.properties).sort(),
      ['normalizedTime', 'phase'],
    );
    assert.deepEqual(
      [...spatialValidateTool.inputSchema.properties.samples.items.required].sort(),
      ['normalizedTime', 'phase'],
    );
    const advertisedValidate = JSON.stringify(spatialValidateTool.inputSchema);
    assert.equal(advertisedValidate.includes('credential'), false);
    assert.equal(advertisedValidate.includes('leaseId'), false);
    assert.equal(advertisedValidate.includes('agentId'), false);
    assert.equal(advertisedValidate.includes('sessionId'), false);

    const call = (name, args = {}) => client.request('tools/call', { name, arguments: args });
    const status = await call('project_status');
    assert.equal(status.structuredContent.shortName, 'sf-mcp');
    assert.equal(status.structuredContent.service.ok, true);
    assert.equal(JSON.parse(status.content[0].text).session.id, project.session.id);

    const listed = await call('project_files_list', { path: 'src' });
    assert.deepEqual(listed.structuredContent.entries.map((entry) => entry.name), ['fixture.txt']);
    const read = await call('project_file_read', { path: 'src/fixture.txt' });
    assert.equal(read.structuredContent.content, 'shader forge mcp fixture\n');
    const traversal = await call('project_file_read', { path: '../outside.txt' });
    assert.equal(traversal.isError, true);
    assert.match(traversal.content[0].text, /escapes (?:the workspace|session) root/i);

    const requested = await call('work_lease_request', { resources: ['files/src/fixture.txt'], mode: 'write' });
    assert.equal(requested.structuredContent.status, 'granted');
    const leaseId = requested.structuredContent.lease.id;
    const leaseStatus = await call('work_lease_status', { leaseId });
    assert.equal(leaseStatus.structuredContent.lease.status, 'granted');
    const coordinated = await call('coordination_state');
    assert.equal(coordinated.structuredContent.granted[0].id, leaseId);
    const heartbeat = await call('agent_heartbeat');
    assert.equal(heartbeat.structuredContent.agent.id, initialCoordination.agents[0].id);
    const released = await call('work_lease_release', { leaseId });
    assert.equal(released.structuredContent.status, 'released');

    const attachment = await call('project_file_read', { path: attachmentPath });
    assert.equal(attachment.structuredContent.content, originalAttachment);
    assert.equal(attachment.structuredContent.revision, textContentRevision(originalAttachment));

    const coordinationBeforeSpatialReads = await call('coordination_state');
    const operationsBeforeSpatialReads = await call('operation_list', { state: 'all', limit: 100 });
    const restRead = await call('spatial_attachment_read', {
      view: 'rest',
      path: attachmentPath,
      baseRevision: attachment.structuredContent.revision,
    });
    assert.equal(restRead.isError, undefined);
    assert.deepEqual(restRead.structuredContent.evaluation.pose, { kind: 'rest', sampled: false });
    assert.equal(restRead.structuredContent.path, attachmentPath);
    assert.equal(restRead.structuredContent.revision, attachment.structuredContent.revision);
    assert.equal(restRead.structuredContent.evaluation.diagnostics.jointLimits.status, 'unavailable');
    assert.equal(restRead.structuredContent.evaluation.diagnostics.clipping.status, 'unavailable');
    const sourceRevisionPaths = restRead.structuredContent.sourceRevisions.map((entry) => entry.path);
    assert.deepEqual(sourceRevisionPaths, [...sourceRevisionPaths].sort());
    assert.ok(sourceRevisionPaths.includes(attachmentPath));
    assert.ok(sourceRevisionPaths.includes('data/foundation/engine-data-layout.toml'));

    const sampleRead = await call('spatial_attachment_read', {
      view: 'sample',
      path: attachmentPath,
      baseRevision: attachment.structuredContent.revision,
      phase: 'idle',
      normalizedTime: 0.5,
    });
    assert.equal(sampleRead.isError, undefined);
    assert.equal(sampleRead.structuredContent.evaluation.pose.kind, 'clip_sample');
    assert.equal(sampleRead.structuredContent.evaluation.pose.phase, 'idle');
    assert.equal(sampleRead.structuredContent.evaluation.pose.normalizedTime, 0.5);
    assert.equal(sampleRead.structuredContent.evaluation.diagnostics.jointLimits.status, 'available');
    assert.equal(sampleRead.structuredContent.evaluation.diagnostics.clipping.status, 'available');
    assert.equal(sampleRead.structuredContent.evaluation.diagnostics.clipping.itemBox.kind, 'authored_collision_box');
    assert.equal(sampleRead.structuredContent.evaluation.attachment.id, 'weapon.rifle');
    assert.deepEqual(sampledEvaluationCalls.at(-1), {
      attachmentId: 'weapon.rifle',
      phase: 'idle',
      normalizedTime: 0.5,
    });

    const paddedSamplePhase = await call('spatial_attachment_read', {
      view: 'sample',
      path: attachmentPath,
      baseRevision: attachment.structuredContent.revision,
      phase: ' idle ',
      normalizedTime: 0.5,
    });
    assert.equal(paddedSamplePhase.isError, true);
    assert.equal(sampledEvaluationCalls.at(-1).phase, ' idle ');

    const staleSpatialRead = await call('spatial_attachment_read', {
      view: 'rest',
      path: attachmentPath,
      baseRevision: textContentRevision('stale spatial read'),
    });
    assert.equal(staleSpatialRead.isError, true);
    assert.equal(staleSpatialRead.structuredContent.status, 409);
    assert.equal(staleSpatialRead.structuredContent.code, 'revision_conflict');
    assert.equal(
      staleSpatialRead.structuredContent.conflict.actualRevision,
      attachment.structuredContent.revision,
    );

    const invalidSpatialPath = await call('spatial_attachment_read', {
      view: 'rest',
      path: '../outside.attachment.toml',
      baseRevision: attachment.structuredContent.revision,
    });
    assert.equal(invalidSpatialPath.isError, true);
    const invalidSampleTime = await call('spatial_attachment_read', {
      view: 'sample',
      path: attachmentPath,
      baseRevision: attachment.structuredContent.revision,
      phase: 'idle',
      normalizedTime: 2,
    });
    assert.equal(invalidSampleTime.isError, true);
    const injectedSpatialAuthority = await call('spatial_attachment_read', {
      view: 'rest',
      path: attachmentPath,
      baseRevision: attachment.structuredContent.revision,
      sessionId: otherSession.id,
      leaseId: 'caller-controlled-lease',
    });
    assert.equal(injectedSpatialAuthority.isError, true);

    const coordinationAfterSpatialReads = await call('coordination_state');
    const operationsAfterSpatialReads = await call('operation_list', { state: 'all', limit: 100 });
    assert.deepEqual(coordinationAfterSpatialReads.structuredContent.granted, coordinationBeforeSpatialReads.structuredContent.granted);
    assert.deepEqual(coordinationAfterSpatialReads.structuredContent.pending, coordinationBeforeSpatialReads.structuredContent.pending);
    assert.deepEqual(operationsAfterSpatialReads.structuredContent, operationsBeforeSpatialReads.structuredContent);
    assert.equal(await fs.readFile(path.join(workspaceRoot, attachmentPath), 'utf8'), originalAttachment);

    const readOnlySpatialLease = await call('work_lease_request', {
      resources: ['spatial/attachment/weapon.rifle'],
      mode: 'read',
    });
    const readOnlyPreview = await call('spatial_attachment_preview', {
      path: attachmentPath,
      content: candidateAttachment,
      baseRevision: attachment.structuredContent.revision,
      label: 'Read lease must not write',
      leaseId: readOnlySpatialLease.structuredContent.lease.id,
    });
    assert.equal(readOnlyPreview.isError, true);
    assert.equal(readOnlyPreview.structuredContent.code, 'lease_write_required');
    await call('work_lease_release', { leaseId: readOnlySpatialLease.structuredContent.lease.id });

    const holder = await request(sessiond.baseUrl, '/api/coordination/agents', {
      method: 'POST',
      body: { sessionId: project.session.id, name: 'external-holder' },
    });
    assert.equal(holder.status, 201);
    const held = await request(sessiond.baseUrl, '/api/coordination/leases', {
      method: 'POST',
      credential: holder.payload.credential,
      body: {
        agentId: holder.payload.agent.id,
        resources: ['spatial/attachment/weapon.rifle'],
        mode: 'write',
      },
    });
    assert.equal(held.payload.status, 'granted');

    const queued = await call('work_lease_request', {
      resources: ['spatial/attachment/weapon.rifle'],
      mode: 'write',
    });
    assert.equal(queued.structuredContent.status, 'queued');
    const spatialLeaseId = queued.structuredContent.lease.id;
    const queuedPreview = await call('spatial_attachment_preview', {
      path: attachmentPath,
      content: candidateAttachment,
      baseRevision: attachment.structuredContent.revision,
      label: 'Tune rifle grip',
      leaseId: spatialLeaseId,
    });
    assert.equal(queuedPreview.isError, true);
    assert.equal(queuedPreview.structuredContent.code, 'lease_not_granted');

    const foreignLease = await call('spatial_attachment_preview', {
      path: attachmentPath,
      content: candidateAttachment,
      baseRevision: attachment.structuredContent.revision,
      label: 'Borrow a lease',
      leaseId: held.payload.lease.id,
    });
    assert.equal(foreignLease.isError, true);
    assert.equal(foreignLease.structuredContent.code, 'lease_not_owned');

    await request(
      sessiond.baseUrl,
      `/api/coordination/leases/${encodeURIComponent(held.payload.lease.id)}/release`,
      {
        method: 'POST',
        credential: holder.payload.credential,
        body: { agentId: holder.payload.agent.id },
      },
    );
    await request(
      sessiond.baseUrl,
      `/api/coordination/agents/${encodeURIComponent(holder.payload.agent.id)}/disconnect`,
      {
        method: 'POST',
        credential: holder.payload.credential,
      },
    );
    const promoted = await call('work_lease_status', { leaseId: spatialLeaseId });
    assert.equal(promoted.structuredContent.status, 'granted');

    const stalePreview = await call('spatial_attachment_preview', {
      path: attachmentPath,
      content: candidateAttachment,
      baseRevision: textContentRevision('stale'),
      label: 'Stale rifle grip',
      leaseId: spatialLeaseId,
    });
    assert.equal(stalePreview.isError, true);
    assert.equal(stalePreview.structuredContent.status, 409);
    assert.equal(stalePreview.structuredContent.code, 'revision_conflict');
    assert.equal(stalePreview.structuredContent.conflict.actualRevision, attachment.structuredContent.revision);
    assert.equal(await fs.readFile(path.join(workspaceRoot, attachmentPath), 'utf8'), originalAttachment);

    const invalidPreview = await call('spatial_attachment_preview', {
      path: attachmentPath,
      content: `${candidateAttachment}INVALID\n`,
      baseRevision: attachment.structuredContent.revision,
      label: 'Invalid rifle grip',
      leaseId: spatialLeaseId,
    });
    assert.equal(invalidPreview.isError, true);
    assert.equal(invalidPreview.structuredContent.status, 422);
    assert.equal(invalidPreview.structuredContent.code, 'spatial_candidate_invalid');
    assert.match(invalidPreview.structuredContent.diagnostic, /native diagnostic/);
    assert.equal(await fs.readFile(path.join(workspaceRoot, attachmentPath), 'utf8'), originalAttachment);

    const preview = await call('spatial_attachment_preview', {
      path: attachmentPath,
      content: candidateAttachment,
      baseRevision: attachment.structuredContent.revision,
      label: 'Tune rifle grip',
      leaseId: spatialLeaseId,
    });
    assert.equal(preview.isError, undefined);
    assert.equal(preview.structuredContent.operation.state, 'previewed');
    assert.equal(preview.structuredContent.operation.actor.kind, 'mcp');
    assert.equal(preview.structuredContent.operation.actor.id, initialCoordination.agents[0].id);
    assert.equal(preview.structuredContent.operation.context.leaseId, spatialLeaseId);
    assert.equal(await fs.readFile(path.join(workspaceRoot, attachmentPath), 'utf8'), originalAttachment);
    const operationId = preview.structuredContent.operation.id;

    const coordinationBeforeValidate = await call('coordination_state');
    const validateSamples = [
      { phase: 'idle', normalizedTime: 0.25 },
      { phase: 'idle', normalizedTime: 0.75 },
    ];
    const validated = await call('spatial_attachment_validate', {
      operationId,
      samples: validateSamples,
    });
    assert.equal(validated.isError, undefined);
    assert.equal(validated.structuredContent.operation.id, operationId);
    assert.equal(validated.structuredContent.operation.state, 'previewed');
    assert.equal(validated.structuredContent.operation.validation.status, 'completed');
    assert.equal(validated.structuredContent.operation.events.at(-1).type, 'validated');
    assert.equal(validated.structuredContent.operation.events.at(-1).actor.kind, 'mcp');
    assert.equal(validated.structuredContent.operation.events.at(-1).actor.id, initialCoordination.agents[0].id);
    assert.deepEqual(
      validated.structuredContent.operation.validation.samples.map((sample) => ({
        phase: sample.phase,
        normalizedTime: sample.normalizedTime,
      })),
      validateSamples,
    );
    assert.deepEqual(sampledEvaluationCalls.slice(-2), [
      { attachmentId: 'weapon.rifle', phase: 'idle', normalizedTime: 0.25 },
      { attachmentId: 'weapon.rifle', phase: 'idle', normalizedTime: 0.75 },
    ]);
    assert.equal('proposedContent' in validated.structuredContent.operation, false);
    assert.equal(JSON.stringify(validated.structuredContent).includes(holder.payload.credential), false);
    assert.equal(JSON.stringify(validated.structuredContent).includes('native diagnostic'), false);
    const coordinationAfterValidate = await call('coordination_state');
    assert.deepEqual(
      coordinationAfterValidate.structuredContent.granted,
      coordinationBeforeValidate.structuredContent.granted,
    );
    assert.deepEqual(
      coordinationAfterValidate.structuredContent.pending,
      coordinationBeforeValidate.structuredContent.pending,
    );
    assert.equal(await fs.readFile(path.join(workspaceRoot, attachmentPath), 'utf8'), originalAttachment);

    const omittedSamples = await call('spatial_attachment_validate', { operationId });
    assert.equal(omittedSamples.isError, undefined);
    assert.equal(omittedSamples.structuredContent.operation.validation.status, 'completed');
    assert.equal(omittedSamples.structuredContent.operation.validation.sampleCount, 0);

    const injectedValidateLease = await call('spatial_attachment_validate', {
      operationId,
      leaseId: spatialLeaseId,
    });
    assert.equal(injectedValidateLease.isError, true);

    const extraSampleField = await call('spatial_attachment_validate', {
      operationId,
      samples: [{ phase: 'idle', normalizedTime: 0.5, extra: true }],
    });
    assert.equal(extraSampleField.isError, true);

    const invalidValidateTime = await call('spatial_attachment_validate', {
      operationId,
      samples: [{ phase: 'idle', normalizedTime: 2 }],
    });
    assert.equal(invalidValidateTime.isError, true);

    const duplicateValidateSample = await call('spatial_attachment_validate', {
      operationId,
      samples: [
        { phase: 'idle', normalizedTime: 0.5 },
        { phase: 'idle', normalizedTime: 0.5 },
      ],
    });
    assert.equal(duplicateValidateSample.isError, true);
    assert.equal(duplicateValidateSample.structuredContent.status, 400);
    assert.equal(duplicateValidateSample.structuredContent.code, 'spatial_request_invalid');
    assert.equal(JSON.stringify(duplicateValidateSample.structuredContent).includes(holder.payload.credential), false);

    const unknownPhaseValidate = await call('spatial_attachment_validate', {
      operationId,
      samples: [{ phase: 'unknown', normalizedTime: 0.5 }],
    });
    assert.equal(unknownPhaseValidate.isError, undefined);
    assert.equal(unknownPhaseValidate.structuredContent.operation.validation.status, 'failed');
    assert.equal(
      unknownPhaseValidate.structuredContent.operation.validation.error.code,
      'spatial_sample_evaluation_invalid',
    );
    assert.equal(JSON.stringify(unknownPhaseValidate.structuredContent).includes('Unknown motion-envelope'), false);
    assert.equal('proposedContent' in unknownPhaseValidate.structuredContent.operation, false);

    const operations = await call('operation_list', { state: 'previewed', limit: 1 });
    assert.deepEqual(operations.structuredContent.operations.map((operation) => operation.id), [operationId]);
    const operationRead = await call('operation_read', { operationId });
    assert.equal(operationRead.structuredContent.operation.id, operationId);
    assert.equal('proposedContent' in operationRead.structuredContent.operation, false);

    const foreignOperation = await sessiond.operationStore.previewFileWrite({
      sessionId: otherSession.id,
      path: 'foreign.txt',
      content: 'foreign\n',
      baseRevision: 'missing',
      actor: { kind: 'human', id: 'foreign', name: 'Foreign' },
    });
    const crossSessionRead = await call('operation_read', { operationId: foreignOperation.id });
    assert.equal(crossSessionRead.isError, true);
    assert.equal(crossSessionRead.structuredContent.code, 'operation_session_mismatch');
    const crossSessionApprove = await call('operation_approve', { operationId: foreignOperation.id });
    assert.equal(crossSessionApprove.isError, true);
    assert.equal(crossSessionApprove.structuredContent.code, 'operation_session_mismatch');
    const crossSessionValidate = await call('spatial_attachment_validate', {
      operationId: foreignOperation.id,
    });
    assert.equal(crossSessionValidate.isError, true);
    assert.equal(crossSessionValidate.structuredContent.code, 'operation_session_mismatch');

    const genericOperation = await sessiond.operationStore.previewFileWrite({
      sessionId: project.session.id,
      path: 'src/generic.txt',
      content: 'generic\n',
      baseRevision: 'missing',
      actor: { kind: 'human', id: 'generic', name: 'Generic' },
    });
    const genericApproval = await call('operation_approve', { operationId: genericOperation.id });
    assert.equal(genericApproval.structuredContent.operation.state, 'approved');
    const genericApply = await call('operation_apply', {
      operationId: genericOperation.id,
      leaseId: spatialLeaseId,
    });
    assert.equal(genericApply.isError, true);
    assert.equal(genericApply.structuredContent.code, 'operation_not_spatial_attachment');
    await assert.rejects(fs.stat(path.join(workspaceRoot, 'src', 'generic.txt')), { code: 'ENOENT' });

    const genericApplied = await sessiond.operationStore.apply(genericOperation.id, {
      actor: { kind: 'human', id: 'generic', name: 'Generic' },
    });
    assert.equal(genericApplied.state, 'applied');
    const genericUndo = await call('operation_undo', {
      operationId: genericOperation.id,
      leaseId: spatialLeaseId,
    });
    assert.equal(genericUndo.isError, true);
    assert.equal(genericUndo.structuredContent.code, 'operation_not_spatial_attachment');
    assert.equal(await fs.readFile(path.join(workspaceRoot, 'src', 'generic.txt'), 'utf8'), 'generic\n');

    const approved = await call('operation_approve', { operationId });
    assert.equal(approved.structuredContent.operation.state, 'approved');
    assert.equal(approved.structuredContent.operation.events.at(-1).actor.kind, 'mcp');

    const wrongResourceLease = await call('work_lease_request', {
      resources: ['spatial/attachment/weapon.pistol'],
      mode: 'write',
    });
    const wrongResourceApply = await call('operation_apply', {
      operationId,
      leaseId: wrongResourceLease.structuredContent.lease.id,
    });
    assert.equal(wrongResourceApply.isError, true);
    assert.equal(wrongResourceApply.structuredContent.code, 'lease_resource_mismatch');
    assert.equal(wrongResourceApply.structuredContent.authoritativeOperation.state, 'approved');
    await call('work_lease_release', { leaseId: wrongResourceLease.structuredContent.lease.id });

    const applied = await call('operation_apply', { operationId, leaseId: spatialLeaseId });
    assert.equal(applied.structuredContent.operation.state, 'applied');
    assert.equal(await fs.readFile(path.join(workspaceRoot, attachmentPath), 'utf8'), candidateAttachment);

    const repeatedApply = await call('operation_apply', { operationId, leaseId: spatialLeaseId });
    assert.equal(repeatedApply.isError, true);
    assert.equal(repeatedApply.structuredContent.status, 409);
    assert.equal(repeatedApply.structuredContent.authoritativeOperation.state, 'applied');

    const undone = await call('operation_undo', { operationId, leaseId: spatialLeaseId });
    assert.equal(undone.structuredContent.operation.state, 'undone');
    assert.equal(await fs.readFile(path.join(workspaceRoot, attachmentPath), 'utf8'), originalAttachment);

    const rejectionPreview = await call('spatial_attachment_preview', {
      path: attachmentPath,
      content: candidateAttachment,
      baseRevision: textContentRevision(originalAttachment),
      label: 'Reject rifle grip',
      leaseId: spatialLeaseId,
    });
    const rejected = await call('operation_reject', {
      operationId: rejectionPreview.structuredContent.operation.id,
    });
    assert.equal(rejected.structuredContent.operation.state, 'rejected');
    assert.equal(await fs.readFile(path.join(workspaceRoot, attachmentPath), 'utf8'), originalAttachment);

    await call('work_lease_release', { leaseId: spatialLeaseId });
    const releasedPreview = await call('spatial_attachment_preview', {
      path: attachmentPath,
      content: candidateAttachment,
      baseRevision: textContentRevision(originalAttachment),
      label: 'Released lease',
      leaseId: spatialLeaseId,
    });
    assert.equal(releasedPreview.isError, true);
    assert.equal(releasedPreview.structuredContent.code, 'lease_not_owned');

    const active = await call('work_lease_request', { resources: ['files/src/active.txt'], mode: 'write' });
    assert.equal(active.structuredContent.status, 'granted');

    child.stdin.end();
    const exitCode = await waitForExit(child);
    assert.equal(exitCode, 0);
    assert.equal(stderr, '', `sf-mcp emitted unexpected stderr: ${stderr}`);
    assert.deepEqual(client.protocolErrors, []);
    assert.equal(client.messages.every(({ line }) => !line.toLowerCase().includes('credential')), true);
    assert.equal(client.messages.every(({ line }) => !line.includes(holder.payload.credential)), true);

    const operationJournal = await fs.readFile(path.join(tempRoot, 'state', 'operations.json'), 'utf8');
    assert.equal(operationJournal.includes(holder.payload.credential), false);

    const cleanupResponse = await fetch(`${sessiond.baseUrl}/api/coordination/state?sessionId=${encodeURIComponent(project.session.id)}`);
    const cleanupState = await cleanupResponse.json();
    assert.deepEqual(cleanupState.agents, []);
    assert.deepEqual(cleanupState.granted, []);
    assert.deepEqual(cleanupState.pending, []);

    console.log('Shader Forge MCP harness passed.');
  } finally {
    if (child && child.exitCode === null) child.kill('SIGTERM');
    await sessiond.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
