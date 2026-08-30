import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { SessionStore, textContentRevision } from '../tools/engine-sessiond/lib/session-store.mjs';
import { startEngineSessiond } from '../tools/engine-sessiond/server.mjs';
import { restEvaluation } from './lib/spatial-evaluation-fixture.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const spatialFixtureRoot = path.join(repoRoot, 'animation', 'fixtures', 'spatial');
const cliPath = path.join(repoRoot, 'tools', 'engine-cli', 'shaderforge.mjs');
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-spatial-cli-'));
const projectRoot = path.join(temporaryRoot, 'project');
const attachmentPath = 'animation/attachments/rifle.attachment.toml';
const originalContent = 'schema_version = 1\nid = "weapon.rifle"\ngrip_offset = 0\n';
const candidateContent = 'schema_version = 1\nid = "weapon.rifle"\ngrip_offset = 2\n';
const bomCandidateContent = `\ufeff${candidateContent}`;
let expectedCredential = '';

for (const directory of ['skeletons', 'clips', 'graphs', 'attachments']) {
  await fs.mkdir(path.join(projectRoot, 'animation', directory), { recursive: true });
}
for (const directory of ['scenes', 'prefabs', 'data', 'effects', 'procgeo']) {
  await fs.mkdir(path.join(projectRoot, 'content', directory), { recursive: true });
}
await fs.cp(
  path.join(spatialFixtureRoot, 'content', 'prefabs'),
  path.join(projectRoot, 'content', 'prefabs'),
  { recursive: true },
);
await fs.cp(
  path.join(spatialFixtureRoot, 'content', 'procgeo'),
  path.join(projectRoot, 'content', 'procgeo'),
  { recursive: true },
);
await fs.mkdir(path.join(projectRoot, 'data', 'foundation'), { recursive: true });
await fs.copyFile(
  path.join(spatialFixtureRoot, 'data', 'foundation', 'engine-data-layout.toml'),
  path.join(projectRoot, 'data', 'foundation', 'engine-data-layout.toml'),
);
await fs.writeFile(path.join(projectRoot, attachmentPath), originalContent, 'utf8');
const candidatePath = path.join(temporaryRoot, 'candidate.attachment.toml');
const invalidCandidatePath = path.join(temporaryRoot, 'invalid.attachment.toml');
const invalidUtf8Path = path.join(temporaryRoot, 'invalid-utf8.attachment.toml');
const bomCandidatePath = path.join(temporaryRoot, 'bom.attachment.toml');
await fs.writeFile(candidatePath, candidateContent, 'utf8');
await fs.writeFile(bomCandidatePath, bomCandidateContent, 'utf8');
await fs.writeFile(invalidCandidatePath, `${candidateContent}INVALID\n`, 'utf8');
await fs.writeFile(invalidUtf8Path, Buffer.from([0xc3, 0x28]));

function profileId(content) {
  return /^id\s*=\s*"([^"]+)"/m.exec(content)?.[1] || '';
}

async function validateAnimationRoot(animationRoot) {
  const profiles = [];
  for (const name of (await fs.readdir(path.join(animationRoot, 'attachments'))).sort()) {
    if (!name.endsWith('.attachment.toml')) continue;
    const content = await fs.readFile(path.join(animationRoot, 'attachments', name), 'utf8');
    if (content.includes('INVALID')) {
      const error = new Error('Candidate rejected.');
      error.stderr = `native diagnostic included ${expectedCredential}`;
      throw error;
    }
    profiles.push({
      id: profileId(content),
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

async function request(baseUrl, pathname, { method = 'GET', body, credential } = {}) {
  const response = await fetch(new URL(pathname, baseUrl), {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(credential ? { 'X-Shader-Forge-Agent-Credential': credential } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, payload: await response.json() };
}

async function runCli(args, { credential = expectedCredential } = {}) {
  const env = { ...process.env };
  if (credential) env.SHADER_FORGE_AGENT_CREDENTIAL = credential;
  else delete env.SHADER_FORGE_AGENT_CREDENTIAL;
  const result = await execFileAsync(process.execPath, [cliPath, ...args], {
    cwd: projectRoot,
    env,
    windowsHide: true,
  });
  assert.equal(result.stdout.includes(expectedCredential), false);
  assert.equal(result.stderr.includes(expectedCredential), false);
  return result;
}

async function expectCliFailure(args, pattern, options) {
  await assert.rejects(
    runCli(args, options),
    (error) => {
      const output = `${error.stdout || ''}${error.stderr || ''}`;
      assert.match(output, pattern);
      assert.equal(output.includes(expectedCredential), false, 'credential must not appear in CLI output');
      return true;
    },
  );
}

let service;
try {
  const sessionStore = new SessionStore({
    storageFilePath: path.join(temporaryRoot, 'state', 'sessions.json'),
  });
  service = await startEngineSessiond({
    port: 0,
    sessionStore,
    validateAnimationRoot,
    evaluateRestAttachment,
  });
  const baseUrlArgs = ['--base-url', service.baseUrl];

  const sessionResponse = await request(service.baseUrl, '/api/sessions', {
    method: 'POST',
    body: { name: 'spatial-cli', rootPath: projectRoot },
  });
  assert.equal(sessionResponse.status, 201);
  const sessionId = sessionResponse.payload.session.id;
  const registration = await request(service.baseUrl, '/api/coordination/agents', {
    method: 'POST',
    body: { sessionId, name: 'cli-test-agent' },
  });
  assert.equal(registration.status, 201);
  const agentId = registration.payload.agent.id;
  expectedCredential = registration.payload.credential;
  const leaseResponse = await request(service.baseUrl, '/api/coordination/leases', {
    method: 'POST',
    credential: expectedCredential,
    body: {
      agentId,
      mode: 'write',
      resources: ['spatial/attachment/weapon.rifle'],
    },
  });
  assert.equal(leaseResponse.status, 200);
  const leaseId = leaseResponse.payload.lease.id;
  const previewArgs = [
    'spatial', 'preview',
    '--session', sessionId,
    '--path', attachmentPath,
    '--content-file', candidatePath,
    '--base-revision', textContentRevision(originalContent),
    '--label', 'Tune rifle grip',
    '--agent', agentId,
    '--lease', leaseId,
    ...baseUrlArgs,
  ];

  const preview = JSON.parse((await runCli(previewArgs)).stdout);
  assert.equal(preview.operation.state, 'previewed');
  assert.equal(preview.operation.actor.kind, 'cli');
  assert.equal(preview.operation.actor.id, 'engine-cli');
  assert.equal(await fs.readFile(path.join(projectRoot, attachmentPath), 'utf8'), originalContent);

  const operationId = preview.operation.id;
  const approved = JSON.parse((await runCli([
    'spatial', 'approve', operationId, ...baseUrlArgs,
  ])).stdout);
  assert.equal(approved.operation.state, 'approved');
  assert.equal(await fs.readFile(path.join(projectRoot, attachmentPath), 'utf8'), originalContent);

  const applied = JSON.parse((await runCli([
    'spatial', 'apply', operationId,
    '--agent', agentId, '--lease', leaseId, ...baseUrlArgs,
  ])).stdout);
  assert.equal(applied.operation.state, 'applied');
  assert.equal(await fs.readFile(path.join(projectRoot, attachmentPath), 'utf8'), candidateContent);

  const undone = JSON.parse((await runCli([
    'spatial', 'undo', operationId,
    '--agent', agentId, '--lease', leaseId, ...baseUrlArgs,
  ])).stdout);
  assert.equal(undone.operation.state, 'undone');
  assert.equal(await fs.readFile(path.join(projectRoot, attachmentPath), 'utf8'), originalContent);

  const rejectedPreview = JSON.parse((await runCli(previewArgs)).stdout);
  const rejected = JSON.parse((await runCli([
    'spatial', 'reject', rejectedPreview.operation.id, ...baseUrlArgs,
  ])).stdout);
  assert.equal(rejected.operation.state, 'rejected');
  assert.equal(await fs.readFile(path.join(projectRoot, attachmentPath), 'utf8'), originalContent);

  await expectCliFailure(previewArgs, /SHADER_FORGE_AGENT_CREDENTIAL/, { credential: '' });
  await expectCliFailure([...previewArgs, '--wat', 'no'], /Unknown engine spatial preview flag: --wat/);
  await expectCliFailure([...previewArgs, '--label', 'duplicate'], /Duplicate engine spatial preview flag: --label/);
  await expectCliFailure([
    ...previewArgs.map((value) => value === candidatePath ? invalidUtf8Path : value),
  ], /not valid UTF-8/);
  await expectCliFailure([
    ...previewArgs.map((value) => value === candidatePath ? bomCandidatePath : value),
  ], /must not begin with a UTF-8 BOM/);
  await expectCliFailure([
    ...previewArgs.map((value) => value === attachmentPath ? 'animation/rifle.attachment.toml' : value),
  ], /--path must match animation\/attachments/);
  await expectCliFailure(['spatial', 'approve', ...baseUrlArgs], /requires exactly one operation id/);
  await expectCliFailure(['spatial', 'approve', operationId, 'extra', ...baseUrlArgs], /requires exactly one operation id/);
  await expectCliFailure(['spatial', 'apply', operationId, '--agent', agentId, ...baseUrlArgs], /requires --lease/);
  await expectCliFailure([
    ...previewArgs.map((value) => value === candidatePath ? invalidCandidatePath : value),
  ], /spatial_candidate_invalid: Proposed spatial attachment is invalid\.: native diagnostic included \[redacted\]/);
} finally {
  if (service) await service.close();
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}

console.log('Engine spatial CLI adapter passed.');
console.log('- Verified preview, approve, reject, apply, and undo through sessiond');
console.log('- Verified strict arguments, UTF-8 input, server diagnostics, and credential redaction');
