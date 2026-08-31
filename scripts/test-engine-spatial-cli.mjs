import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
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

async function evaluateSampledAttachment(
  _animationRoot,
  _contentRoot,
  _foundationPath,
  attachmentId,
  phase,
  normalizedTime,
) {
  if (phase !== 'idle') {
    const error = new Error(`Unknown motion-envelope phase '${phase}'.`);
    error.stderr = `private native sample diagnostic ${expectedCredential}`;
    throw error;
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
  evaluation.limitations = [
    'sampled_attachment_schematic_only',
    'not_review_evidence',
    'item_mesh_unavailable',
  ];
  return evaluation;
}

async function writeSamplesFile(filePath, value) {
  await fs.writeFile(filePath, value, 'utf8');
}

async function withRecordingServer(handler) {
  const requests = [];
  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      requests.push({
        method: request.method,
        url: request.url,
        credential: request.headers['x-shader-forge-agent-credential'] || '',
        body: raw ? JSON.parse(raw) : undefined,
      });
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        operation: {
          id: 'op_recorded',
          state: 'previewed',
          actor: { kind: 'cli', id: 'engine-cli', name: 'Shader Forge CLI' },
          validation: { status: 'completed', samples: [] },
        },
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await handler(`http://127.0.0.1:${port}`, requests);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
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
    evaluateSampledAttachment,
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
  const samplesPath = path.join(temporaryRoot, 'samples.json');
  const samples = [
    { phase: 'idle', normalizedTime: 0.25 },
    { phase: 'idle', normalizedTime: 0.75 },
  ];
  await writeSamplesFile(samplesPath, `${JSON.stringify(samples, null, 2)}\n`);
  const validated = JSON.parse((await runCli([
    'spatial', 'validate-operation', operationId,
    '--samples-file', samplesPath,
    ...baseUrlArgs,
  ], { credential: '' })).stdout);
  assert.equal(validated.operation.id, operationId);
  assert.equal(validated.operation.actor.kind, 'cli');
  assert.equal(validated.operation.validation.status, 'completed');
  assert.deepEqual(
    validated.operation.validation.samples.map((sample) => ({
      phase: sample.phase,
      normalizedTime: sample.normalizedTime,
    })),
    samples,
  );
  assert.equal(validated.operation.events.at(-1).type, 'validated');
  assert.equal(validated.operation.events.at(-1).actor.kind, 'cli');
  assert.equal('proposedContent' in validated.operation, false);
  assert.equal(JSON.stringify(validated).includes('private native'), false);
  assert.equal(await fs.readFile(path.join(projectRoot, attachmentPath), 'utf8'), originalContent);

  const invalidSamplesPath = path.join(temporaryRoot, 'invalid-samples.json');
  await writeSamplesFile(invalidSamplesPath, JSON.stringify([
    { phase: 'idle', normalizedTime: 0.5, extra: true },
  ]));
  await expectCliFailure([
    'spatial', 'validate-operation', operationId,
    '--samples-file', invalidSamplesPath,
    ...baseUrlArgs,
  ], /spatial_request_invalid/, { credential: '' });

  const unknownPhasePath = path.join(temporaryRoot, 'unknown-phase.json');
  await writeSamplesFile(unknownPhasePath, JSON.stringify([
    { phase: 'unknown', normalizedTime: 0.5 },
  ]));
  const failedValidation = JSON.parse((await runCli([
    'spatial', 'validate-operation', operationId,
    '--samples-file', unknownPhasePath,
    ...baseUrlArgs,
  ], { credential: '' })).stdout);
  assert.equal(failedValidation.operation.validation.status, 'failed');
  assert.equal(failedValidation.operation.validation.error.code, 'spatial_sample_evaluation_invalid');
  assert.equal(JSON.stringify(failedValidation).includes('private native'), false);
  assert.equal(JSON.stringify(failedValidation).includes(expectedCredential), false);
  assert.equal('proposedContent' in failedValidation.operation, false);

  const malformedJsonPath = path.join(temporaryRoot, 'malformed-samples.json');
  const objectSamplesPath = path.join(temporaryRoot, 'object-samples.json');
  const bomSamplesPath = path.join(temporaryRoot, 'bom-samples.json');
  const invalidUtf8SamplesPath = path.join(temporaryRoot, 'invalid-utf8-samples.json');
  await writeSamplesFile(malformedJsonPath, '{');
  await writeSamplesFile(objectSamplesPath, JSON.stringify({ samples }));
  await writeSamplesFile(bomSamplesPath, `\ufeff${JSON.stringify(samples)}`);
  await fs.writeFile(invalidUtf8SamplesPath, Buffer.from([0xc3, 0x28]));
  await expectCliFailure([
    'spatial', 'validate-operation', operationId,
    '--samples-file', malformedJsonPath,
    ...baseUrlArgs,
  ], /not valid JSON/, { credential: '' });
  await expectCliFailure([
    'spatial', 'validate-operation', operationId,
    '--samples-file', objectSamplesPath,
    ...baseUrlArgs,
  ], /must be a JSON array/, { credential: '' });
  await expectCliFailure([
    'spatial', 'validate-operation', operationId,
    '--samples-file', bomSamplesPath,
    ...baseUrlArgs,
  ], /must not begin with a UTF-8 BOM/, { credential: '' });
  await expectCliFailure([
    'spatial', 'validate-operation', operationId,
    '--samples-file', invalidUtf8SamplesPath,
    ...baseUrlArgs,
  ], /not valid UTF-8/, { credential: '' });
  await expectCliFailure([
    'spatial', 'validate-operation', ...baseUrlArgs,
    '--samples-file', samplesPath,
  ], /requires exactly one operation id/, { credential: '' });
  await expectCliFailure([
    'spatial', 'validate-operation', operationId, 'extra',
    '--samples-file', samplesPath,
    ...baseUrlArgs,
  ], /requires exactly one operation id/, { credential: '' });
  await expectCliFailure([
    'spatial', 'validate-operation', operationId, ...baseUrlArgs,
  ], /requires --samples-file/, { credential: '' });
  await expectCliFailure([
    'spatial', 'validate-operation', operationId,
    '--samples-file', samplesPath,
    '--lease', leaseId,
    ...baseUrlArgs,
  ], /Unknown engine spatial validate-operation flag: --lease/, { credential: '' });
  await expectCliFailure([
    'spatial', 'validate-operation', operationId,
    '--samples-file', samplesPath,
    '--samples-file', samplesPath,
    ...baseUrlArgs,
  ], /Duplicate engine spatial validate-operation flag: --samples-file/, { credential: '' });

  await withRecordingServer(async (recordedBaseUrl, requests) => {
    const recorded = JSON.parse((await runCli([
      'spatial', 'validate-operation', 'op_recorded',
      '--samples-file', samplesPath,
      '--base-url', recordedBaseUrl,
    ], { credential: expectedCredential })).stdout);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, 'POST');
    assert.equal(requests[0].url, '/api/operations/op_recorded/validate');
    assert.equal(requests[0].credential, '');
    assert.deepEqual(Object.keys(requests[0].body).sort(), ['actor', 'samples']);
    assert.deepEqual(requests[0].body, {
      actor: { kind: 'cli', id: 'engine-cli', name: 'Shader Forge CLI' },
      samples,
    });
    assert.equal('proposedContent' in recorded.operation, false);
  });

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
console.log('- Verified preview, validate-operation, approve, reject, apply, and undo through sessiond');
console.log('- Verified strict arguments, UTF-8 input, server diagnostics, and credential redaction');
