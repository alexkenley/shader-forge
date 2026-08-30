import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SessionStore } from '../tools/engine-sessiond/lib/session-store.mjs';
import { startEngineSessiond } from '../tools/engine-sessiond/server.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MCP_REQUEST_TIMEOUT_MS = 5_000;
const MCP_EXIT_TIMEOUT_MS = 5_000;

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

async function main() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-mcp-'));
  const workspaceRoot = path.join(tempRoot, 'workspace');
  await fs.mkdir(path.join(workspaceRoot, 'src'), { recursive: true });
  await fs.writeFile(path.join(workspaceRoot, 'src', 'fixture.txt'), 'shader forge mcp fixture\n', 'utf8');
  await fs.writeFile(path.join(tempRoot, 'outside.txt'), 'outside workspace\n', 'utf8');

  const sessiond = await startEngineSessiond({
    host: '127.0.0.1',
    port: 0,
    sessionStore: new SessionStore({ storageFilePath: path.join(tempRoot, 'sessions.json') }),
  });
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
        'project_file_read',
        'project_files_list',
        'project_status',
        'work_lease_release',
        'work_lease_request',
        'work_lease_status',
      ],
    );

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

    const active = await call('work_lease_request', { resources: ['files/src/active.txt'], mode: 'write' });
    assert.equal(active.structuredContent.status, 'granted');

    child.stdin.end();
    const exitCode = await waitForExit(child);
    assert.equal(exitCode, 0);
    assert.equal(stderr, '', `sf-mcp emitted unexpected stderr: ${stderr}`);
    assert.deepEqual(client.protocolErrors, []);
    assert.equal(client.messages.every(({ line }) => !line.toLowerCase().includes('credential')), true);

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
