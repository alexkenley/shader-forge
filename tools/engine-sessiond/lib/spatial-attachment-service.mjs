import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  MISSING_FILE_REVISION,
  textContentRevision,
} from './session-store.mjs';

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const animationDirectories = Object.freeze({
  skeletons: '.skeleton.toml',
  clips: '.anim.toml',
  graphs: '.animgraph.toml',
  attachments: '.attachment.toml',
});
const attachmentPathPattern = /^animation\/attachments\/([^/]+\.attachment\.toml)$/;
const revisionPattern = /^sha256:[a-f0-9]{64}$/;
const actorKinds = new Set(['human', 'shell', 'cli', 'mcp']);
const restEvaluationSchema = 'shader_forge.spatial_attachment_evaluation';
const restEvaluationMaxBytes = 8 * 1024 * 1024;
const sampledLayerMaxCount = 8;
const sampledNormalizedTimePattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const primaryAttachmentLayer = 'primary_attachment';
const secondaryHandIkLayer = 'secondary_hand_ik';
const dataFoundationRelativePath = 'data/foundation/engine-data-layout.toml';
const itemGeometryUnavailableReasons = new Set([
  'item_prefab_not_found',
  'item_prefab_ambiguous',
  'item_prefab_visual_geometry_unavailable',
  'item_prefab_visual_geometry_ambiguous',
  'item_prefab_visual_geometry_not_box',
]);
const appliedSecondaryIkKeys = Object.freeze([
  'status',
  'solved',
  'reachable',
  'preSolveDistanceMeters',
  'targetDistanceMeters',
  'minReachMeters',
  'maxReachMeters',
  'reachResidualMeters',
  'reachToleranceMeters',
  'reachWithinTolerance',
  'postSolveDistanceMeters',
  'contactToleranceMeters',
  'contactWithinTolerance',
  'postSolveAngleDegrees',
  'angleToleranceDegrees',
  'angleWithinTolerance',
  'withinTolerance',
]);
const jointLimitKeys = Object.freeze([
  'status',
  'reason',
  'policy',
  'evaluatedBoneCount',
  'violationCount',
  'maxViolationDegrees',
  'withinLimits',
  'bones',
]);
const jointLimitBoneKeys = Object.freeze([
  'boneId',
  'role',
  'swingDegrees',
  'swingLimitDegrees',
  'twistDegrees',
  'twistMinDegrees',
  'twistMaxDegrees',
  'swingViolationDegrees',
  'twistViolationDegrees',
  'withinLimits',
]);
const jointLimitPolicy = 'diagnose';
const jointLimitDegreeBound = 180;
const clippingKeys = Object.freeze([
  'status',
  'reason',
  'policy',
  'metric',
  'evaluatedCapsuleCount',
  'overlapCount',
  'maxClearanceViolationMeters',
  'hasOverlap',
  'itemBox',
  'capsules',
]);
const clippingItemBoxKeys = Object.freeze([
  'kind',
  'prefabId',
  'world',
  'dimensionsMeters',
  'worldCorners',
]);
const clippingCapsuleKeys = Object.freeze([
  'boneId',
  'role',
  'centerWorld',
  'axisWorld',
  'radiusMeters',
  'halfLengthMeters',
  'segmentStartWorld',
  'segmentEndWorld',
  'axisDistanceToBoxMeters',
  'surfaceClearanceMeters',
  'clearanceViolationMeters',
  'overlapping',
]);
const clippingUnavailableReasons = new Set([
  'item_prefab_not_found',
  'item_prefab_ambiguous',
  'item_prefab_invalid',
  'item_collision_not_authored',
  'diagnostic_capsules_not_authored',
]);
const clippingPolicy = 'diagnose';
const clippingMetric = 'capsule_axis_to_oriented_box_clearance';
const unitTolerance = 1e-6;

function serviceError(statusCode, code, message, extras = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  Object.assign(error, extras);
  return error;
}

function requiredString(value, fieldName) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) {
    throw serviceError(400, 'spatial_request_invalid', `${fieldName} is required.`);
  }
  return normalized;
}

function normalizeActor(actor) {
  if (!actor || typeof actor !== 'object' || Array.isArray(actor)) {
    throw serviceError(400, 'spatial_request_invalid', 'actor must be an object.');
  }
  const kind = typeof actor.kind === 'string' ? actor.kind.trim() : '';
  if (!actorKinds.has(kind)) {
    throw serviceError(400, 'spatial_request_invalid', 'actor.kind must be human, shell, cli, or mcp.');
  }
  return actor;
}

function parseAttachmentPath(value) {
  const relativePath = requiredString(value, 'path').replaceAll('\\', '/');
  const match = attachmentPathPattern.exec(relativePath);
  if (!match) {
    throw serviceError(
      400,
      'spatial_attachment_path_invalid',
      'path must match animation/attachments/*.attachment.toml.',
    );
  }
  return {
    path: relativePath,
    stagedSource: `attachments/${match[1]}`,
  };
}

function parseBaseRevision(value, { allowMissing = false } = {}) {
  const baseRevision = requiredString(value, 'baseRevision');
  if (allowMissing && baseRevision === MISSING_FILE_REVISION) {
    return baseRevision;
  }
  if (!revisionPattern.test(baseRevision)) {
    throw serviceError(400, 'spatial_request_invalid', 'baseRevision is invalid.');
  }
  return baseRevision;
}

function normalizeRequest(request = {}) {
  const parsedPath = parseAttachmentPath(request.path);
  if (typeof request.content !== 'string') {
    throw serviceError(400, 'spatial_request_invalid', 'content must be a string.');
  }
  return {
    sessionId: requiredString(request.sessionId, 'sessionId'),
    path: parsedPath.path,
    stagedSource: parsedPath.stagedSource,
    content: request.content,
    baseRevision: parseBaseRevision(request.baseRevision, { allowMissing: true }),
    label: requiredString(request.label, 'label'),
    actor: normalizeActor(request.actor),
    agentId: requiredString(request.agentId, 'agentId'),
    leaseId: requiredString(request.leaseId, 'leaseId'),
    credential: requiredString(request.credential, 'Agent credential'),
  };
}

function normalizeEvaluateRequest(request = {}) {
  const parsedPath = parseAttachmentPath(request.path);
  return {
    sessionId: requiredString(request.sessionId, 'sessionId'),
    path: parsedPath.path,
    stagedSource: parsedPath.stagedSource,
    baseRevision: parseBaseRevision(request.baseRevision),
  };
}

function parseSamplePhase(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw serviceError(400, 'spatial_request_invalid', 'phase is required.');
  }
  return value;
}

function parseSampleNormalizedTime(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0) || value < 0 || value > 1) {
      throw serviceError(400, 'spatial_request_invalid', 'normalizedTime is invalid.');
    }
    return value;
  }
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    throw serviceError(400, 'spatial_request_invalid', 'normalizedTime is required.');
  }
  if (!sampledNormalizedTimePattern.test(raw)) {
    throw serviceError(400, 'spatial_request_invalid', 'normalizedTime is invalid.');
  }
  const normalizedTime = Number(raw);
  if (
    !Number.isFinite(normalizedTime)
    || Object.is(normalizedTime, -0)
    || normalizedTime < 0
    || normalizedTime > 1
  ) {
    throw serviceError(400, 'spatial_request_invalid', 'normalizedTime is invalid.');
  }
  return normalizedTime;
}

function formatSampleNormalizedTime(value) {
  return Number(value).toString();
}

function normalizeEvaluateSampleRequest(request = {}) {
  const parsedPath = parseAttachmentPath(request.path);
  return {
    sessionId: requiredString(request.sessionId, 'sessionId'),
    path: parsedPath.path,
    stagedSource: parsedPath.stagedSource,
    baseRevision: parseBaseRevision(request.baseRevision),
    phase: parseSamplePhase(request.phase),
    normalizedTime: parseSampleNormalizedTime(request.normalizedTime),
  };
}

function boundedDiagnostic(error) {
  const diagnostic = typeof error?.diagnostic === 'string' && error.diagnostic.trim()
    ? error.diagnostic.trim()
    : typeof error?.stderr === 'string' && error.stderr.trim()
      ? error.stderr.trim()
      : error instanceof Error
        ? error.message
        : String(error);
  return diagnostic.slice(0, 8000);
}

function validationFailure(code, message, error) {
  return serviceError(422, code, message, { diagnostic: boundedDiagnostic(error) });
}

function evaluationFailure(code, message, error) {
  return serviceError(422, code, message, { diagnostic: boundedDiagnostic(error) });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function evaluationProtocolError() {
  throw serviceError(
    500,
    'spatial_evaluator_protocol_error',
    'Spatial evaluator returned an invalid evaluation.',
  );
}

function requireExactObject(value, keys) {
  if (!isPlainObject(value)) evaluationProtocolError();
  const actualKeys = Object.keys(value);
  if (
    actualKeys.length !== keys.length
    || keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) {
    evaluationProtocolError();
  }
  return value;
}

function requireString(value, { allowEmpty = false, maxLength = Infinity } = {}) {
  if (
    typeof value !== 'string'
    || (!allowEmpty && value.length === 0)
    || value.length > maxLength
  ) {
    evaluationProtocolError();
  }
  return value;
}

function requireFiniteTuple(value, length) {
  if (
    !Array.isArray(value)
    || value.length !== length
    || value.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))
  ) {
    evaluationProtocolError();
  }
  return value;
}

function dot(left, right) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function cross(left, right) {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

function vectorClose(left, right) {
  return left.every((entry, index) => Math.abs(entry - right[index]) <= unitTolerance);
}

function requireUnitVector(value) {
  const vector = requireFiniteTuple(value, 3);
  if (Math.abs(Math.hypot(...vector) - 1) > unitTolerance) evaluationProtocolError();
  return vector;
}

function requireCanonicalQuaternion(value) {
  const rotation = requireFiniteTuple(value, 4);
  if (Math.abs(Math.hypot(...rotation) - 1) > unitTolerance || rotation[3] < 0) {
    evaluationProtocolError();
  }
  return rotation;
}

function rotateVector(rotation, vector) {
  const axis = rotation.slice(0, 3);
  const twiceCross = cross(axis, vector).map((entry) => entry * 2);
  const secondCross = cross(axis, twiceCross);
  return vector.map((entry, index) => (
    entry + rotation[3] * twiceCross[index] + secondCross[index]
  ));
}

function requireTransform(value) {
  const transform = requireExactObject(value, ['translation', 'rotation', 'axes']);
  requireFiniteTuple(transform.translation, 3);
  const rotation = requireCanonicalQuaternion(transform.rotation);
  const axes = requireExactObject(transform.axes, ['x', 'y', 'z']);
  const x = requireUnitVector(axes.x);
  const y = requireUnitVector(axes.y);
  const z = requireUnitVector(axes.z);
  if (
    Math.abs(dot(x, y)) > unitTolerance
    || Math.abs(dot(y, z)) > unitTolerance
    || Math.abs(dot(z, x)) > unitTolerance
    || !vectorClose(cross(x, y), z)
    || !vectorClose(x, rotateVector(rotation, [1, 0, 0]))
    || !vectorClose(y, rotateVector(rotation, [0, 1, 0]))
    || !vectorClose(z, rotateVector(rotation, [0, 0, 1]))
  ) {
    evaluationProtocolError();
  }
}

function requireOptionalTransform(value) {
  if (value !== null) requireTransform(value);
}

function requireStatusReason(value, status, reason) {
  const result = requireExactObject(value, ['status', 'reason']);
  if (result.status !== status || result.reason !== reason) evaluationProtocolError();
}

function requireItemGeometry(value, itemWorld) {
  if (isPlainObject(value) && value.status === 'unavailable') {
    const unavailable = requireExactObject(value, ['status', 'reason']);
    if (!itemGeometryUnavailableReasons.has(unavailable.reason)) evaluationProtocolError();
    return;
  }
  const geometry = requireExactObject(
    value,
    ['status', 'kind', 'procgeoId', 'dimensionsMeters', 'worldCorners'],
  );
  if (
    geometry.status !== 'available'
    || geometry.kind !== 'authored_visual_box'
    || typeof geometry.procgeoId !== 'string'
    || !geometry.procgeoId
  ) {
    evaluationProtocolError();
  }
  const dimensions = requireFiniteTuple(geometry.dimensionsMeters, 3);
  if (dimensions.some((entry) => entry <= 0)) evaluationProtocolError();
  if (!Array.isArray(geometry.worldCorners) || geometry.worldCorners.length !== 8) {
    evaluationProtocolError();
  }
  const half = dimensions.map((entry) => entry * 0.5);
  const localCorners = [
    [-half[0], -half[1], -half[2]],
    [half[0], -half[1], -half[2]],
    [half[0], half[1], -half[2]],
    [-half[0], half[1], -half[2]],
    [-half[0], -half[1], half[2]],
    [half[0], -half[1], half[2]],
    [half[0], half[1], half[2]],
    [-half[0], half[1], half[2]],
  ];
  const axes = itemWorld.axes;
  for (let index = 0; index < localCorners.length; index += 1) {
    const actual = requireFiniteTuple(geometry.worldCorners[index], 3);
    const local = localCorners[index];
    const expected = itemWorld.translation.map((entry, axisIndex) => (
      entry
      + local[0] * axes.x[axisIndex]
      + local[1] * axes.y[axisIndex]
      + local[2] * axes.z[axisIndex]
    ));
    if (!vectorClose(actual, expected)) evaluationProtocolError();
  }
}

function requireFiniteNumber(value, { min = -Infinity, max = Infinity } = {}) {
  if (
    typeof value !== 'number'
    || !Number.isFinite(value)
    || Object.is(value, -0)
    || value < min
    || value > max
  ) {
    evaluationProtocolError();
  }
  return value;
}

function requireNonnegativeInteger(value) {
  if (typeof value !== 'number' || !Number.isInteger(value) || Object.is(value, -0) || value < 0) {
    evaluationProtocolError();
  }
  return value;
}

function requireBoolean(value) {
  if (typeof value !== 'boolean') evaluationProtocolError();
  return value;
}

function requireEvaluationBoneIndex(skeletonBones) {
  const skeletonBoneById = new Map();
  for (let index = 0; index < skeletonBones.length; index += 1) {
    const bone = skeletonBones[index];
    if (skeletonBoneById.has(bone.id)) evaluationProtocolError();
    skeletonBoneById.set(bone.id, { index, role: bone.role });
  }
  return skeletonBoneById;
}

function requireJointLimits(value, skeletonBones, skeletonBoneById) {
  const diagnostic = requireExactObject(value, jointLimitKeys);
  if (diagnostic.policy !== jointLimitPolicy) evaluationProtocolError();
  if (!Array.isArray(diagnostic.bones) || diagnostic.bones.length > skeletonBones.length) {
    evaluationProtocolError();
  }
  const evaluatedBoneCount = requireNonnegativeInteger(diagnostic.evaluatedBoneCount);
  const violationCount = requireNonnegativeInteger(diagnostic.violationCount);
  if (evaluatedBoneCount !== diagnostic.bones.length) evaluationProtocolError();
  const maxViolationDegrees = requireFiniteNumber(diagnostic.maxViolationDegrees, {
    min: 0,
    max: jointLimitDegreeBound * 2,
  });

  let computedViolations = 0;
  let computedMax = 0;
  let previousSkeletonIndex = -1;
  for (const entry of diagnostic.bones) {
    const bone = requireExactObject(entry, jointLimitBoneKeys);
    const boneId = requireString(bone.boneId);
    const skeletonBone = skeletonBoneById.get(boneId);
    if (
      !skeletonBone
      || skeletonBone.index <= previousSkeletonIndex
      || bone.role !== skeletonBone.role
    ) {
      evaluationProtocolError();
    }
    previousSkeletonIndex = skeletonBone.index;
    const swingViolationDegrees = requireFiniteNumber(bone.swingViolationDegrees, {
      min: 0,
      max: jointLimitDegreeBound,
    });
    const twistViolationDegrees = requireFiniteNumber(bone.twistViolationDegrees, {
      min: 0,
      max: jointLimitDegreeBound * 2,
    });
    const swingDegrees = requireFiniteNumber(bone.swingDegrees, { min: 0, max: jointLimitDegreeBound });
    const swingLimitDegrees = requireFiniteNumber(bone.swingLimitDegrees, { min: 0, max: jointLimitDegreeBound });
    const twistDegrees = requireFiniteNumber(bone.twistDegrees, {
      min: -jointLimitDegreeBound,
      max: jointLimitDegreeBound,
    });
    const twistMinDegrees = requireFiniteNumber(bone.twistMinDegrees, {
      min: -jointLimitDegreeBound,
      max: jointLimitDegreeBound,
    });
    const twistMaxDegrees = requireFiniteNumber(bone.twistMaxDegrees, {
      min: -jointLimitDegreeBound,
      max: jointLimitDegreeBound,
    });
    if (twistMinDegrees > twistMaxDegrees) evaluationProtocolError();
    const expectedSwingViolation = Math.max(0, swingDegrees - swingLimitDegrees);
    const expectedTwistViolation = twistDegrees < twistMinDegrees
      ? twistMinDegrees - twistDegrees
      : (twistDegrees > twistMaxDegrees ? twistDegrees - twistMaxDegrees : 0);
    if (
      Math.abs(swingViolationDegrees - expectedSwingViolation) > unitTolerance
      || Math.abs(twistViolationDegrees - expectedTwistViolation) > unitTolerance
      || (swingViolationDegrees === 0) !== (expectedSwingViolation === 0)
      || (twistViolationDegrees === 0) !== (expectedTwistViolation === 0)
    ) {
      evaluationProtocolError();
    }
    const withinLimits = requireBoolean(bone.withinLimits);
    const expectedWithinLimits = expectedSwingViolation === 0 && expectedTwistViolation === 0;
    if (withinLimits !== expectedWithinLimits) {
      evaluationProtocolError();
    }
    if (!expectedWithinLimits) computedViolations += 1;
    computedMax = Math.max(computedMax, expectedSwingViolation, expectedTwistViolation);
  }
  if (violationCount !== computedViolations) evaluationProtocolError();
  if (
    Math.abs(maxViolationDegrees - computedMax) > unitTolerance
    || (maxViolationDegrees === 0) !== (computedMax === 0)
  ) evaluationProtocolError();

  if (diagnostic.status === 'available') {
    if (diagnostic.reason !== null || diagnostic.bones.length === 0) evaluationProtocolError();
    const withinLimits = requireBoolean(diagnostic.withinLimits);
    if (withinLimits !== (violationCount === 0)) evaluationProtocolError();
    return;
  }
  if (diagnostic.status !== 'unavailable') evaluationProtocolError();
  if (diagnostic.reason !== 'no_joint_limits_authored') evaluationProtocolError();
  if (
    diagnostic.withinLimits !== null
    || evaluatedBoneCount !== 0
    || violationCount !== 0
    || maxViolationDegrees !== 0
    || diagnostic.bones.length !== 0
  ) {
    evaluationProtocolError();
  }
}

function requireWorldBoxCorners(dimensions, worldCorners, world) {
  if (!Array.isArray(worldCorners) || worldCorners.length !== 8) evaluationProtocolError();
  const half = dimensions.map((entry) => entry * 0.5);
  const localCorners = [
    [-half[0], -half[1], -half[2]],
    [half[0], -half[1], -half[2]],
    [half[0], half[1], -half[2]],
    [-half[0], half[1], -half[2]],
    [-half[0], -half[1], half[2]],
    [half[0], -half[1], half[2]],
    [half[0], half[1], half[2]],
    [-half[0], half[1], half[2]],
  ];
  const axes = world.axes;
  for (let index = 0; index < localCorners.length; index += 1) {
    const actual = requireFiniteTuple(worldCorners[index], 3);
    const local = localCorners[index];
    const expected = world.translation.map((entry, axisIndex) => (
      entry
      + local[0] * axes.x[axisIndex]
      + local[1] * axes.y[axisIndex]
      + local[2] * axes.z[axisIndex]
    ));
    if (expected.some((entry) => !Number.isFinite(entry)) || !vectorClose(actual, expected)) {
      evaluationProtocolError();
    }
  }
}

function pointInBoxSpace(point, world) {
  const delta = point.map((entry, index) => entry - world.translation[index]);
  const local = [dot(delta, world.axes.x), dot(delta, world.axes.y), dot(delta, world.axes.z)];
  if (local.some((entry) => !Number.isFinite(entry))) evaluationProtocolError();
  return local;
}

function segmentDistanceToBox(start, end, boxWorld, dimensions) {
  const startLocal = pointInBoxSpace(start, boxWorld);
  const endLocal = pointInBoxSpace(end, boxWorld);
  const extents = dimensions.map((entry) => entry * 0.5);
  const scale = Math.max(1, ...startLocal.map(Math.abs), ...endLocal.map(Math.abs), ...extents);
  if (!Number.isFinite(scale)) evaluationProtocolError();
  const scaledStart = startLocal.map((entry) => entry / scale);
  const scaledEnd = endLocal.map((entry) => entry / scale);
  const scaledExtents = extents.map((entry) => entry / scale);
  const direction = scaledEnd.map((entry, index) => entry - scaledStart[index]);

  const breakpoints = [0, 1];
  for (let axis = 0; axis < 3; axis += 1) {
    if (direction[axis] === 0) continue;
    for (const boundary of [-scaledExtents[axis], scaledExtents[axis]]) {
      const value = (boundary - scaledStart[axis]) / direction[axis];
      if (Number.isFinite(value) && value > 0 && value < 1) breakpoints.push(value);
    }
  }
  breakpoints.sort((left, right) => left - right);
  const uniqueBreakpoints = breakpoints.filter((value, index) => (
    index === 0 || value !== breakpoints[index - 1]
  ));

  let minimumSquared = Number.POSITIVE_INFINITY;
  const evaluate = (time) => {
    let squared = 0;
    for (let axis = 0; axis < 3; axis += 1) {
      const value = scaledStart[axis] + direction[axis] * time;
      const outside = value < -scaledExtents[axis]
        ? value + scaledExtents[axis]
        : (value > scaledExtents[axis] ? value - scaledExtents[axis] : 0);
      squared += outside * outside;
    }
    minimumSquared = Math.min(minimumSquared, squared);
  };

  for (let interval = 0; interval + 1 < uniqueBreakpoints.length; interval += 1) {
    const begin = uniqueBreakpoints[interval];
    const finish = uniqueBreakpoints[interval + 1];
    evaluate(begin);
    evaluate(finish);
    const midpoint = (begin + finish) * 0.5;
    let quadratic = 0;
    let linear = 0;
    for (let axis = 0; axis < 3; axis += 1) {
      const middleValue = scaledStart[axis] + direction[axis] * midpoint;
      if (middleValue >= -scaledExtents[axis] && middleValue <= scaledExtents[axis]) continue;
      const boundary = middleValue < -scaledExtents[axis]
        ? -scaledExtents[axis]
        : scaledExtents[axis];
      quadratic += direction[axis] * direction[axis];
      linear += direction[axis] * (scaledStart[axis] - boundary);
    }
    if (quadratic > 0) {
      const stationary = -linear / quadratic;
      if (stationary > begin && stationary < finish) evaluate(stationary);
    }
  }
  const distance = Math.sqrt(minimumSquared) * scale;
  if (!Number.isFinite(distance) || distance < 0) evaluationProtocolError();
  return distance === 0 ? 0 : distance;
}

function requireDerivedNumber(actual, expected) {
  if (
    Math.abs(actual - expected) > unitTolerance
    || (actual === 0) !== (expected === 0)
    || Math.sign(actual) !== Math.sign(expected)
  ) {
    evaluationProtocolError();
  }
}

function requireClipping(value, skeletonBones, skeletonBoneById, attachment) {
  const diagnostic = requireExactObject(value, clippingKeys);
  if (diagnostic.policy !== clippingPolicy || diagnostic.metric !== clippingMetric) {
    evaluationProtocolError();
  }
  const evaluatedCapsuleCount = requireNonnegativeInteger(diagnostic.evaluatedCapsuleCount);
  const overlapCount = requireNonnegativeInteger(diagnostic.overlapCount);
  const maxClearanceViolationMeters = requireFiniteNumber(
    diagnostic.maxClearanceViolationMeters,
    { min: 0 },
  );
  if (!Array.isArray(diagnostic.capsules) || diagnostic.capsules.length > skeletonBones.length) {
    evaluationProtocolError();
  }

  if (diagnostic.status === 'unavailable') {
    if (
      !clippingUnavailableReasons.has(diagnostic.reason)
      || evaluatedCapsuleCount !== 0
      || overlapCount !== 0
      || maxClearanceViolationMeters !== 0
      || diagnostic.hasOverlap !== null
      || diagnostic.itemBox !== null
      || diagnostic.capsules.length !== 0
    ) {
      evaluationProtocolError();
    }
    return;
  }
  if (diagnostic.status !== 'available' || diagnostic.reason !== null) evaluationProtocolError();
  if (diagnostic.capsules.length === 0) evaluationProtocolError();

  const itemBox = requireExactObject(diagnostic.itemBox, clippingItemBoxKeys);
  if (
    itemBox.kind !== 'authored_collision_box'
    || requireString(itemBox.prefabId) !== attachment.itemPrefabId
  ) {
    evaluationProtocolError();
  }
  requireTransform(itemBox.world);
  const dimensions = requireFiniteTuple(itemBox.dimensionsMeters, 3);
  if (dimensions.some((entry) => entry <= 0 || Object.is(entry, -0))) evaluationProtocolError();
  requireWorldBoxCorners(dimensions, itemBox.worldCorners, itemBox.world);

  let previousSkeletonIndex = -1;
  let computedOverlapCount = 0;
  let computedMaxViolation = 0;
  for (const valueEntry of diagnostic.capsules) {
    const capsule = requireExactObject(valueEntry, clippingCapsuleKeys);
    const boneId = requireString(capsule.boneId);
    const skeletonBone = skeletonBoneById.get(boneId);
    if (
      !skeletonBone
      || skeletonBone.index <= previousSkeletonIndex
      || capsule.role !== skeletonBone.role
    ) {
      evaluationProtocolError();
    }
    previousSkeletonIndex = skeletonBone.index;

    const center = requireFiniteTuple(capsule.centerWorld, 3);
    const axis = requireUnitVector(capsule.axisWorld);
    const radius = requireFiniteNumber(capsule.radiusMeters, { min: 0 });
    const halfLength = requireFiniteNumber(capsule.halfLengthMeters, { min: 0 });
    if (radius === 0 || halfLength === 0) evaluationProtocolError();
    const segmentStart = requireFiniteTuple(capsule.segmentStartWorld, 3);
    const segmentEnd = requireFiniteTuple(capsule.segmentEndWorld, 3);
    const expectedStart = center.map((entry, index) => entry - axis[index] * halfLength);
    const expectedEnd = center.map((entry, index) => entry + axis[index] * halfLength);
    if (
      expectedStart.some((entry) => !Number.isFinite(entry))
      || expectedEnd.some((entry) => !Number.isFinite(entry))
      || !vectorClose(segmentStart, expectedStart)
      || !vectorClose(segmentEnd, expectedEnd)
    ) {
      evaluationProtocolError();
    }

    const axisDistance = requireFiniteNumber(capsule.axisDistanceToBoxMeters, { min: 0 });
    const surfaceClearance = requireFiniteNumber(capsule.surfaceClearanceMeters);
    const clearanceViolation = requireFiniteNumber(capsule.clearanceViolationMeters, { min: 0 });
    const expectedAxisDistance = segmentDistanceToBox(
      expectedStart,
      expectedEnd,
      itemBox.world,
      dimensions,
    );
    const rawSurfaceClearance = expectedAxisDistance - radius;
    const expectedSurfaceClearance = rawSurfaceClearance === 0 ? 0 : rawSurfaceClearance;
    const expectedClearanceViolation = expectedSurfaceClearance < 0
      ? -expectedSurfaceClearance
      : 0;
    requireDerivedNumber(axisDistance, expectedAxisDistance);
    requireDerivedNumber(surfaceClearance, expectedSurfaceClearance);
    requireDerivedNumber(clearanceViolation, expectedClearanceViolation);
    const overlapping = requireBoolean(capsule.overlapping);
    if (overlapping !== (expectedClearanceViolation > 0)) evaluationProtocolError();
    if (overlapping) computedOverlapCount += 1;
    computedMaxViolation = Math.max(computedMaxViolation, expectedClearanceViolation);
  }

  if (
    evaluatedCapsuleCount !== diagnostic.capsules.length
    || overlapCount !== computedOverlapCount
    || diagnostic.hasOverlap !== (computedOverlapCount > 0)
  ) {
    evaluationProtocolError();
  }
  requireDerivedNumber(maxClearanceViolationMeters, computedMaxViolation);
}

function requireExactStringArray(value, expected) {
  if (
    !Array.isArray(value)
    || value.length !== expected.length
    || value.some((entry, index) => entry !== expected[index])
  ) {
    evaluationProtocolError();
  }
  return value;
}

function requireLayerArray(value) {
  if (!Array.isArray(value) || value.length > sampledLayerMaxCount) evaluationProtocolError();
  const seen = new Set();
  for (const layer of value) {
    if (
      typeof layer !== 'string'
      || (layer !== primaryAttachmentLayer && layer !== secondaryHandIkLayer)
      || seen.has(layer)
    ) {
      evaluationProtocolError();
    }
    seen.add(layer);
  }
  return value;
}

function requireSerializedEvaluation(report, expectedSchemaVersion) {
  let serialized;
  try {
    serialized = JSON.stringify(report);
  } catch {
    evaluationProtocolError();
  }
  if (
    typeof serialized !== 'string'
    || Buffer.byteLength(serialized, 'utf8') > restEvaluationMaxBytes
  ) {
    evaluationProtocolError();
  }

  const evaluation = requireExactObject(report, [
    'schema', 'schemaVersion', 'pose', 'coordinateSystem', 'skeleton', 'attachment',
    'bones', 'segments', 'sockets', 'item', 'hands', 'diagnostics', 'limitations',
  ]);
  if (
    evaluation.schema !== restEvaluationSchema
    || evaluation.schemaVersion !== expectedSchemaVersion
  ) {
    evaluationProtocolError();
  }
  return evaluation;
}

function requireEvaluationGeometry(evaluation, expectedProfile) {
  const coordinateSystem = requireExactObject(
    evaluation.coordinateSystem,
    ['units', 'handedness', 'up', 'forward', 'quaternionOrder'],
  );
  if (
    coordinateSystem.units !== 'meters'
    || coordinateSystem.handedness !== 'right'
    || coordinateSystem.up !== '+Y'
    || coordinateSystem.forward !== '+Z'
    || coordinateSystem.quaternionOrder !== 'xyzw'
  ) {
    evaluationProtocolError();
  }

  const skeleton = requireExactObject(evaluation.skeleton, ['id', 'name', 'rootBone']);
  if (requireString(skeleton.id) !== expectedProfile.skeleton) evaluationProtocolError();
  requireString(skeleton.name);
  requireString(skeleton.rootBone);

  const attachment = requireExactObject(evaluation.attachment, [
    'id', 'name', 'itemPrefabId', 'dominantHand', 'mode', 'perspective', 'primaryGripSocket',
  ]);
  if (
    requireString(attachment.id) !== expectedProfile.id
    || attachment.itemPrefabId !== expectedProfile.itemPrefab
    || attachment.mode !== expectedProfile.mode
    || attachment.perspective !== expectedProfile.perspective
    || !['left', 'right'].includes(attachment.dominantHand)
    || !['one_hand', 'two_hand'].includes(attachment.mode)
    || !['first_person', 'third_person', 'both'].includes(attachment.perspective)
  ) {
    evaluationProtocolError();
  }
  requireString(attachment.name);
  requireString(attachment.itemPrefabId);
  requireString(attachment.primaryGripSocket);

  if (!Array.isArray(evaluation.bones)) evaluationProtocolError();
  for (const value of evaluation.bones) {
    const bone = requireExactObject(value, ['id', 'parent', 'role', 'local', 'world']);
    requireString(bone.id);
    requireString(bone.parent, { allowEmpty: true });
    requireString(bone.role, { allowEmpty: true });
    requireTransform(bone.local);
    requireTransform(bone.world);
  }
  const skeletonBoneById = requireEvaluationBoneIndex(evaluation.bones);

  if (!Array.isArray(evaluation.segments)) evaluationProtocolError();
  for (const value of evaluation.segments) {
    const segment = requireExactObject(value, ['parentBoneId', 'boneId', 'from', 'to']);
    requireString(segment.parentBoneId);
    requireString(segment.boneId);
    requireFiniteTuple(segment.from, 3);
    requireFiniteTuple(segment.to, 3);
  }

  if (!Array.isArray(evaluation.sockets)) evaluationProtocolError();
  for (const value of evaluation.sockets) {
    const socket = requireExactObject(value, ['id', 'boneId', 'role', 'local', 'world']);
    requireString(socket.id);
    requireString(socket.boneId);
    requireString(socket.role, { allowEmpty: true });
    requireTransform(socket.local);
    requireTransform(socket.world);
  }

  const item = requireExactObject(
    evaluation.item,
    ['prefabId', 'world', 'geometry', 'primaryContactWorld', 'handleAxisWorld'],
  );
  if (requireString(item.prefabId) !== attachment.itemPrefabId) evaluationProtocolError();
  requireTransform(item.world);
  requireItemGeometry(item.geometry, item.world);
  requireOptionalTransform(item.primaryContactWorld);
  if (item.handleAxisWorld !== null) {
    const handle = requireExactObject(item.handleAxisWorld, ['origin', 'direction']);
    requireFiniteTuple(handle.origin, 3);
    requireUnitVector(handle.direction);
  }

  const hands = requireExactObject(evaluation.hands, ['dominant', 'secondary']);
  if (hands.dominant === null) evaluationProtocolError();
  if (hands.dominant !== null) {
    const dominant = requireExactObject(hands.dominant, ['boneId', 'role', 'world', 'palmWorld']);
    requireString(dominant.boneId);
    requireString(dominant.role, { allowEmpty: true });
    requireTransform(dominant.world);
    requireOptionalTransform(dominant.palmWorld);
  }
  if (hands.secondary !== null) {
    const secondary = requireExactObject(hands.secondary, [
      'enabled', 'boneId', 'role', 'world', 'palmWorld', 'targetWorld', 'pole',
      'preSolveDistanceMeters',
    ]);
    if (typeof secondary.enabled !== 'boolean') evaluationProtocolError();
    requireString(secondary.boneId);
    requireString(secondary.role, { allowEmpty: true });
    requireTransform(secondary.world);
    requireOptionalTransform(secondary.palmWorld);
    requireOptionalTransform(secondary.targetWorld);
    if (secondary.pole !== null) {
      const pole = requireExactObject(secondary.pole, ['translation', 'space', 'world', 'reason']);
      requireFiniteTuple(pole.translation, 3);
      const validV1Pole = evaluation.schemaVersion === 1
        && pole.space === 'unresolved'
        && pole.world === null
        && pole.reason === 'pole_space_not_authored';
      const validV2Pole = evaluation.schemaVersion === 2
        && pole.space === 'item'
        && pole.reason === null;
      if (!validV1Pole && !validV2Pole) {
        evaluationProtocolError();
      }
      if (validV2Pole) requireFiniteTuple(pole.world, 3);
    }
    if (
      secondary.preSolveDistanceMeters !== null
      && (
        typeof secondary.preSolveDistanceMeters !== 'number'
        || !Number.isFinite(secondary.preSolveDistanceMeters)
        || secondary.preSolveDistanceMeters < 0
      )
    ) {
      evaluationProtocolError();
    }
  }
  if (attachment.mode === 'one_hand' && hands.secondary !== null) evaluationProtocolError();
  if (attachment.mode === 'two_hand') {
    if (
      hands.secondary === null
      || hands.secondary.enabled !== true
      || hands.secondary.palmWorld === null
      || hands.secondary.targetWorld === null
      || hands.secondary.pole === null
    ) {
      evaluationProtocolError();
    }
  }

  const diagnostics = requireExactObject(
    evaluation.diagnostics,
    ['secondaryIk', 'jointLimits', 'clipping'],
  );
  requireJointLimits(diagnostics.jointLimits, evaluation.bones, skeletonBoneById);
  requireClipping(diagnostics.clipping, evaluation.bones, skeletonBoneById, attachment);
  return { attachment, diagnostics, hands };
}

function requireLimitations(evaluation, expectedLimitations) {
  if (
    !Array.isArray(evaluation.limitations)
    || evaluation.limitations.length !== expectedLimitations.length
    || evaluation.limitations.some((value, index) => value !== expectedLimitations[index])
  ) {
    evaluationProtocolError();
  }
}

function requireRestEvaluationShape(report, expectedProfile) {
  const evaluation = requireSerializedEvaluation(report, expectedProfile.schemaVersion);
  const pose = requireExactObject(evaluation.pose, ['kind', 'sampled']);
  if (pose.kind !== 'rest' || pose.sampled !== false) evaluationProtocolError();

  const { attachment, diagnostics } = requireEvaluationGeometry(evaluation, expectedProfile);
  requireStatusReason(
    diagnostics.secondaryIk,
    attachment.mode === 'two_hand' ? 'unavailable' : 'not_applicable',
    attachment.mode === 'two_hand'
      ? (evaluation.schemaVersion === 2 ? 'rest_pose_unsolved' : 'secondary_hand_ik_not_implemented')
      : 'one_hand_attachment',
  );
  requireLimitations(evaluation, [
    'rest_pose_only',
    'not_review_evidence',
    'item_mesh_unavailable',
    ...(attachment.mode === 'two_hand' ? ['secondary_hand_ik_unavailable'] : []),
  ]);
}

function requireAppliedSecondaryIk(value, secondaryHand) {
  const diagnostic = requireExactObject(value, appliedSecondaryIkKeys);
  if (diagnostic.status !== 'applied' || diagnostic.solved !== true) evaluationProtocolError();
  requireBoolean(diagnostic.reachable);
  requireFiniteNumber(diagnostic.preSolveDistanceMeters, { min: 0 });
  const targetDistanceMeters = requireFiniteNumber(diagnostic.targetDistanceMeters, { min: 0 });
  const minReachMeters = requireFiniteNumber(diagnostic.minReachMeters, { min: 0 });
  const maxReachMeters = requireFiniteNumber(diagnostic.maxReachMeters, { min: minReachMeters });
  const reachResidualMeters = requireFiniteNumber(diagnostic.reachResidualMeters, { min: 0 });
  const reachToleranceMeters = requireFiniteNumber(diagnostic.reachToleranceMeters, { min: 0 });
  const reachWithinTolerance = requireBoolean(diagnostic.reachWithinTolerance);
  const postSolveDistanceMeters = requireFiniteNumber(diagnostic.postSolveDistanceMeters, { min: 0 });
  const contactToleranceMeters = requireFiniteNumber(diagnostic.contactToleranceMeters, { min: 0 });
  const contactWithinTolerance = requireBoolean(diagnostic.contactWithinTolerance);
  const postSolveAngleDegrees = requireFiniteNumber(diagnostic.postSolveAngleDegrees, { min: 0 });
  const angleToleranceDegrees = requireFiniteNumber(diagnostic.angleToleranceDegrees, { min: 0 });
  const angleWithinTolerance = requireBoolean(diagnostic.angleWithinTolerance);
  const withinTolerance = requireBoolean(diagnostic.withinTolerance);
  if (reachWithinTolerance !== (reachResidualMeters <= reachToleranceMeters)) {
    evaluationProtocolError();
  }
  if (contactWithinTolerance !== (postSolveDistanceMeters <= contactToleranceMeters)) {
    evaluationProtocolError();
  }
  if (angleWithinTolerance !== (postSolveAngleDegrees <= angleToleranceDegrees)) {
    evaluationProtocolError();
  }
  if (
    withinTolerance
    !== (reachWithinTolerance && contactWithinTolerance && angleWithinTolerance)
  ) {
    evaluationProtocolError();
  }
  const reachableByDistance = targetDistanceMeters >= minReachMeters
    && targetDistanceMeters <= maxReachMeters;
  if (diagnostic.reachable !== reachableByDistance) evaluationProtocolError();
  const expectedReachResidual = targetDistanceMeters < minReachMeters
    ? minReachMeters - targetDistanceMeters
    : targetDistanceMeters > maxReachMeters
      ? targetDistanceMeters - maxReachMeters
      : 0;
  if (Math.abs(reachResidualMeters - expectedReachResidual) > unitTolerance) {
    evaluationProtocolError();
  }
  if (
    secondaryHand.preSolveDistanceMeters === null
    || Math.abs(secondaryHand.preSolveDistanceMeters - diagnostic.preSolveDistanceMeters)
      > unitTolerance
  ) {
    evaluationProtocolError();
  }
  const palm = secondaryHand.palmWorld;
  const target = secondaryHand.targetWorld;
  const geometryDistance = Math.hypot(
    target.translation[0] - palm.translation[0],
    target.translation[1] - palm.translation[1],
    target.translation[2] - palm.translation[2],
  );
  const rotationDot = Math.min(1, Math.abs(
    palm.rotation[0] * target.rotation[0]
    + palm.rotation[1] * target.rotation[1]
    + palm.rotation[2] * target.rotation[2]
    + palm.rotation[3] * target.rotation[3]
  ));
  const geometryAngleDegrees = 2 * Math.acos(rotationDot) * 180 / Math.PI;
  if (
    Math.abs(postSolveDistanceMeters - geometryDistance) > unitTolerance
    || Math.abs(postSolveAngleDegrees - geometryAngleDegrees) > unitTolerance
  ) {
    evaluationProtocolError();
  }
}

function requireSampledPose(pose, attachment, expectedSchemaVersion, expectedPhase, expectedNormalizedTime) {
  const sampledPose = requireExactObject(pose, [
    'kind',
    'sampled',
    'phase',
    'clip',
    'normalizedTime',
    'proceduralLayersRequested',
    'proceduralLayersApplied',
    'proceduralLayersUnavailable',
  ]);
  if (
    sampledPose.kind !== 'clip_sample'
    || sampledPose.sampled !== true
    || requireString(sampledPose.phase) !== expectedPhase
    || requireString(sampledPose.clip).length === 0
    || sampledPose.normalizedTime !== expectedNormalizedTime
  ) {
    evaluationProtocolError();
  }
  requireFiniteNumber(sampledPose.normalizedTime, { min: 0, max: 1 });
  requireLayerArray(sampledPose.proceduralLayersRequested);
  requireLayerArray(sampledPose.proceduralLayersApplied);
  requireLayerArray(sampledPose.proceduralLayersUnavailable);

  if (attachment.mode === 'two_hand' && expectedSchemaVersion === 2) {
    requireExactStringArray(
      sampledPose.proceduralLayersRequested,
      [primaryAttachmentLayer, secondaryHandIkLayer],
    );
    requireExactStringArray(
      sampledPose.proceduralLayersApplied,
      [primaryAttachmentLayer, secondaryHandIkLayer],
    );
    requireExactStringArray(sampledPose.proceduralLayersUnavailable, []);
    return;
  }
  if (attachment.mode === 'two_hand') {
    requireExactStringArray(
      sampledPose.proceduralLayersRequested,
      [primaryAttachmentLayer, secondaryHandIkLayer],
    );
    requireExactStringArray(sampledPose.proceduralLayersApplied, [primaryAttachmentLayer]);
    requireExactStringArray(sampledPose.proceduralLayersUnavailable, [secondaryHandIkLayer]);
    return;
  }
  requireExactStringArray(sampledPose.proceduralLayersRequested, [primaryAttachmentLayer]);
  requireExactStringArray(sampledPose.proceduralLayersApplied, [primaryAttachmentLayer]);
  requireExactStringArray(sampledPose.proceduralLayersUnavailable, []);
}

function requireSampledEvaluationShape(
  report,
  expectedProfile,
  expectedPhase,
  expectedNormalizedTime,
) {
  const evaluation = requireSerializedEvaluation(report, expectedProfile.schemaVersion);
  const { attachment, diagnostics, hands } = requireEvaluationGeometry(
    evaluation,
    expectedProfile,
  );
  requireSampledPose(
    evaluation.pose,
    attachment,
    expectedProfile.schemaVersion,
    expectedPhase,
    expectedNormalizedTime,
  );

  if (expectedProfile.mode === 'two_hand' && expectedProfile.schemaVersion === 2) {
    requireAppliedSecondaryIk(diagnostics.secondaryIk, hands.secondary);
    requireLimitations(evaluation, [
      'sampled_attachment_schematic_only',
      'not_review_evidence',
      'item_mesh_unavailable',
    ]);
    return;
  }
  if (expectedProfile.mode === 'two_hand') {
    requireStatusReason(
      diagnostics.secondaryIk,
      'unavailable',
      'secondary_hand_ik_not_implemented',
    );
    requireLimitations(evaluation, [
      'pre_ik_only',
      'not_review_evidence',
      'item_mesh_unavailable',
      'secondary_hand_ik_unavailable',
    ]);
    return;
  }
  requireStatusReason(diagnostics.secondaryIk, 'not_applicable', 'one_hand_attachment');
  requireLimitations(evaluation, [
    'sampled_attachment_schematic_only',
    'not_review_evidence',
    'item_mesh_unavailable',
  ]);
}

function isEvaluatorInfrastructureError(error) {
  return Boolean(
    error?.killed
    || error?.signal
    || (typeof error?.code === 'string'
      && ![
        'spatial_evaluator_unavailable',
        'spatial_evaluator_protocol_error',
      ].includes(error.code)),
  );
}

function revisionConflict(filePath, expectedRevision, actualRevision) {
  return serviceError(409, 'revision_conflict', 'File revision conflict.', {
    conflict: {
      code: 'revision_conflict',
      path: filePath,
      expectedRevision,
      actualRevision,
    },
  });
}

function publicSourceRevisions(sources) {
  return sources
    .map((source) => ({ path: source.path.replaceAll('\\', '/'), revision: source.revision }))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
}

function firstSourceRevisionDifference(expected, actual) {
  const expectedByPath = new Map(expected.map((entry) => [entry.path, entry.revision]));
  const actualByPath = new Map(actual.map((entry) => [entry.path, entry.revision]));
  const paths = [...new Set([...expectedByPath.keys(), ...actualByPath.keys()])].sort();
  for (const sourcePath of paths) {
    const expectedRevision = expectedByPath.get(sourcePath) || MISSING_FILE_REVISION;
    const actualRevision = actualByPath.get(sourcePath) || MISSING_FILE_REVISION;
    if (expectedRevision !== actualRevision) {
      return { path: sourcePath, expectedRevision, actualRevision };
    }
  }
  return null;
}

function evaluationInputsChanged(difference) {
  return serviceError(
    409,
    'spatial_evaluation_inputs_changed',
    'Authored spatial evaluation inputs changed during spatial evaluation.',
    {
      conflict: {
        code: 'spatial_evaluation_inputs_changed',
        ...difference,
      },
    },
  );
}

function evaluationInputsChangedDuringSnapshot(sourcePath, fallbackPath) {
  const candidate = typeof sourcePath === 'string' ? sourcePath.replaceAll('\\', '/') : '';
  const components = candidate.split('/');
  const safePath = candidate.length > 0
    && candidate.length <= 512
    && !candidate.startsWith('/')
    && !/^[A-Za-z]:/.test(candidate)
    && !/[\u0000-\u001f\u007f]/.test(candidate)
    && components.every((component) => component && component !== '.' && component !== '..')
    ? candidate
    : fallbackPath;
  return serviceError(
    409,
    'spatial_evaluation_inputs_changed',
    'Authored spatial inputs changed while the evaluation snapshot was being read.',
    {
      conflict: {
        code: 'spatial_evaluation_inputs_changed',
        path: safePath,
      },
    },
  );
}

async function readOptionalUtf8(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function publicValidation(report) {
  if (!report || typeof report !== 'object' || !Array.isArray(report.attachmentProfiles)) {
    throw serviceError(500, 'spatial_validator_protocol_error', 'Spatial validator returned an invalid report.');
  }
  const { animationRoot: _discardedRoot, ...publicReport } = report;
  return structuredClone(publicReport);
}

function profileBySource(report, source) {
  const matches = report.attachmentProfiles.filter((profile) => profile?.source === source);
  if (matches.length > 1) {
    throw serviceError(500, 'spatial_validator_protocol_error', `Validator returned duplicate source: ${source}`);
  }
  return matches[0] || null;
}

function requiredProfileIdentity(profile, code, message) {
  const attachmentId = typeof profile?.id === 'string' ? profile.id.trim() : '';
  if (!profile || !attachmentId) {
    throw serviceError(code === 'spatial_candidate_source_missing' ? 422 : 500, code, message);
  }
  if (![1, 2].includes(profile.schemaVersion)) {
    throw serviceError(
      500,
      'spatial_validator_protocol_error',
      'Spatial validator returned an unsupported attachment profile schema version.',
    );
  }
  const skeleton = typeof profile.skeleton === 'string' ? profile.skeleton.trim() : '';
  const itemPrefab = typeof profile.itemPrefab === 'string' ? profile.itemPrefab.trim() : '';
  if (
    !skeleton
    || !itemPrefab
    || !['one_hand', 'two_hand'].includes(profile.mode)
    || !['first_person', 'third_person', 'both'].includes(profile.perspective)
  ) {
    throw serviceError(
      500,
      'spatial_validator_protocol_error',
      'Spatial validator returned an invalid attachment profile contract.',
    );
  }
  return {
    id: attachmentId,
    schemaVersion: profile.schemaVersion,
    skeleton,
    itemPrefab,
    mode: profile.mode,
    perspective: profile.perspective,
  };
}

function publicEvaluation(report, expectedProfile) {
  requireRestEvaluationShape(report, expectedProfile);
  return structuredClone(report);
}

function publicSampledEvaluation(
  report,
  expectedProfile,
  expectedPhase,
  expectedNormalizedTime,
) {
  requireSampledEvaluationShape(
    report,
    expectedProfile,
    expectedPhase,
    expectedNormalizedTime,
  );
  return structuredClone(report);
}

function resolveSpatialBinaryPath() {
  const binaryName = process.platform === 'win32'
    ? 'shader_forge_spatial.exe'
    : 'shader_forge_spatial';
  return process.env.SHADER_FORGE_SPATIAL_BINARY?.trim()
    || path.join(repoRoot, 'build', 'runtime', 'bin', binaryName);
}

async function runSpatialJsonCommand(args, unavailableCode, toolName) {
  const binaryPath = resolveSpatialBinaryPath();
  try {
    const { stdout } = await execFileAsync(
      binaryPath,
      args,
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, windowsHide: true },
    );
    return JSON.parse(stdout);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw serviceError(
        503,
        unavailableCode,
        `Spatial ${toolName} was not found at ${binaryPath}. Build it with engine build spatial.`,
      );
    }
    throw error;
  }
}

async function defaultValidateAnimationRoot(animationRoot) {
  return runSpatialJsonCommand(
    ['validate', '--animation-root', animationRoot],
    'spatial_validator_unavailable',
    'validator',
  );
}

async function defaultEvaluateRestAttachment(
  animationRoot,
  contentRoot,
  foundationPath,
  attachmentId,
) {
  try {
    return await runSpatialJsonCommand(
      [
        'evaluate-rest',
        '--animation-root', animationRoot,
        '--attachment', attachmentId,
        '--content-root', contentRoot,
        '--data-foundation', foundationPath,
      ],
      'spatial_evaluator_unavailable',
      'evaluator',
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw serviceError(
        500,
        'spatial_evaluator_protocol_error',
        'Spatial evaluator returned malformed JSON.',
      );
    }
    throw error;
  }
}

async function defaultEvaluateSampledAttachment(
  animationRoot,
  contentRoot,
  foundationPath,
  attachmentId,
  phase,
  normalizedTime,
) {
  try {
    return await runSpatialJsonCommand(
      [
        'evaluate-sample',
        '--animation-root', animationRoot,
        '--attachment', attachmentId,
        '--phase', phase,
        '--normalized-time', formatSampleNormalizedTime(normalizedTime),
        '--content-root', contentRoot,
        '--data-foundation', foundationPath,
      ],
      'spatial_evaluator_unavailable',
      'evaluator',
    );
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw serviceError(
        500,
        'spatial_evaluator_protocol_error',
        'Spatial evaluator returned malformed JSON.',
      );
    }
    throw error;
  }
}

export class SpatialAttachmentService {
  #sessionStore;
  #coordinationStore;
  #operationStore;
  #validateAnimationRoot;
  #evaluateRestAttachment;
  #evaluateSampledAttachment;

  constructor({
    sessionStore,
    coordinationStore,
    operationStore,
    validateAnimationRoot,
    evaluateRestAttachment,
    evaluateSampledAttachment,
  } = {}) {
    this.#sessionStore = sessionStore;
    this.#coordinationStore = coordinationStore;
    this.#operationStore = operationStore;
    this.#validateAnimationRoot = typeof validateAnimationRoot === 'function'
      ? validateAnimationRoot
      : defaultValidateAnimationRoot;
    this.#evaluateRestAttachment = typeof evaluateRestAttachment === 'function'
      ? evaluateRestAttachment
      : defaultEvaluateRestAttachment;
    this.#evaluateSampledAttachment = typeof evaluateSampledAttachment === 'function'
      ? evaluateSampledAttachment
      : defaultEvaluateSampledAttachment;
  }

  async previewAttachment(request = {}) {
    const normalized = normalizeRequest(request);
    const inspection = await this.#sessionStore.inspectTextFile(normalized.sessionId, normalized.path);
    if (inspection.revision !== normalized.baseRevision) {
      throw revisionConflict(inspection.path, normalized.baseRevision, inspection.revision);
    }

    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-spatial-preview-'));
    try {
      const staged = await this.#stageAuthoredSpatialInputs(normalized.sessionId, temporaryRoot);
      const stagedAnimationRoot = staged.animationRoot;
      const sourceRevisions = staged.sourceRevisions;
      const stagedAttachmentPath = path.join(stagedAnimationRoot, normalized.stagedSource);
      const stagedBaselineContent = await readOptionalUtf8(stagedAttachmentPath);
      const stagedBaselineRevision = stagedBaselineContent === null
        ? MISSING_FILE_REVISION
        : textContentRevision(stagedBaselineContent);
      if (stagedBaselineRevision !== normalized.baseRevision) {
        throw revisionConflict(inspection.path, normalized.baseRevision, stagedBaselineRevision);
      }

      let baseline;
      try {
        baseline = publicValidation(await this.#validateAnimationRoot(stagedAnimationRoot));
      } catch (error) {
        if (error?.code === 'spatial_validator_unavailable') throw error;
        throw validationFailure(
          'spatial_baseline_invalid',
          'Authored spatial baseline is invalid.',
          error,
        );
      }

      await fs.writeFile(
        stagedAttachmentPath,
        normalized.content,
        'utf8',
      );

      let candidate;
      try {
        candidate = publicValidation(await this.#validateAnimationRoot(stagedAnimationRoot));
      } catch (error) {
        if (error?.code === 'spatial_validator_unavailable') throw error;
        throw validationFailure(
          'spatial_candidate_invalid',
          'Proposed spatial attachment is invalid.',
          error,
        );
      }

      const oldProfile = profileBySource(baseline, normalized.stagedSource);
      const newProfile = profileBySource(candidate, normalized.stagedSource);
      const newAttachment = requiredProfileIdentity(
        newProfile,
        'spatial_candidate_source_missing',
        'Validator did not return the proposed attachment source.',
      );
      const oldAttachment = inspection.exists
        ? requiredProfileIdentity(
          oldProfile,
          'spatial_baseline_source_missing',
          'Validator did not return the authored attachment source.',
        )
        : null;

      const subjectId = newAttachment.id.toLowerCase();
      const previousSubjectId = oldAttachment ? oldAttachment.id.toLowerCase() : null;
      const resourceKeys = [...new Set([
        ...(previousSubjectId ? [`spatial/attachment/${previousSubjectId}`] : []),
        `spatial/attachment/${subjectId}`,
      ])].sort();

      this.#coordinationStore.assertGrantedWriteLease({
        sessionId: normalized.sessionId,
        agentId: normalized.agentId,
        credential: normalized.credential,
        leaseId: normalized.leaseId,
        resources: resourceKeys,
      });

      const evaluation = { baseline: null, candidate: null };
      if (oldAttachment) {
        await fs.writeFile(stagedAttachmentPath, stagedBaselineContent, 'utf8');
        evaluation.baseline = await this.#evaluateStagedAttachment(
          staged,
          oldAttachment,
          'baseline',
        );
      }
      await fs.writeFile(stagedAttachmentPath, normalized.content, 'utf8');
      evaluation.candidate = await this.#evaluateStagedAttachment(
        staged,
        newAttachment,
        'candidate',
      );

      await this.#assertSpatialSourcesUnchanged(
        normalized.sessionId,
        sourceRevisions,
        normalized.path,
      );

      this.#coordinationStore.assertGrantedWriteLease({
        sessionId: normalized.sessionId,
        agentId: normalized.agentId,
        credential: normalized.credential,
        leaseId: normalized.leaseId,
        resources: resourceKeys,
      });

      const operation = await this.#operationStore.previewFileWrite({
        sessionId: normalized.sessionId,
        path: normalized.path,
        content: normalized.content,
        baseRevision: normalized.baseRevision,
        actor: normalized.actor,
        context: {
          type: 'spatial_attachment',
          label: normalized.label,
          subjectId,
          resourceKeys,
          leaseId: normalized.leaseId,
        },
      });
      return {
        operation,
        validation: {
          baseline,
          candidate,
          previousSubjectId,
          subjectId,
        },
        evaluation,
      };
    } finally {
      await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
  }

  async evaluateAttachment(request = {}) {
    const normalized = normalizeEvaluateRequest(request);
    let initial;
    try {
      initial = await this.#sessionStore.readFile(
        normalized.sessionId,
        normalized.path,
        { rejectSymbolicPath: true },
      );
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw serviceError(404, 'spatial_attachment_missing', 'Authored spatial attachment does not exist.');
      }
      throw error;
    }
    if (initial.revision !== normalized.baseRevision) {
      throw revisionConflict(initial.path, normalized.baseRevision, initial.revision);
    }

    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-spatial-evaluate-'));
    try {
      const staged = await this.#stageAuthoredSpatialInputs(normalized.sessionId, temporaryRoot);
      const stagedAnimationRoot = staged.animationRoot;
      const sourceRevisions = staged.sourceRevisions;
      const stagedContent = await readOptionalUtf8(
        path.join(stagedAnimationRoot, normalized.stagedSource),
      );
      const stagedRevision = stagedContent === null
        ? MISSING_FILE_REVISION
        : textContentRevision(stagedContent);
      if (stagedRevision !== normalized.baseRevision) {
        throw revisionConflict(initial.path, normalized.baseRevision, stagedRevision);
      }

      let baseline;
      try {
        baseline = publicValidation(await this.#validateAnimationRoot(stagedAnimationRoot));
      } catch (error) {
        if (error?.code === 'spatial_validator_unavailable') throw error;
        throw validationFailure(
          'spatial_baseline_invalid',
          'Authored spatial baseline is invalid.',
          error,
        );
      }

      const attachment = requiredProfileIdentity(
        profileBySource(baseline, normalized.stagedSource),
        'spatial_baseline_source_missing',
        'Validator did not return the authored attachment source.',
      );
      const evaluation = await this.#evaluateStagedAttachment(
        staged,
        attachment,
        'baseline',
      );

      await this.#assertSpatialSourcesUnchanged(
        normalized.sessionId,
        sourceRevisions,
        normalized.path,
      );

      return {
        evaluation,
        path: initial.path,
        revision: normalized.baseRevision,
        sourceRevisions,
      };
    } finally {
      await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
  }

  async evaluateSampledAttachment(request = {}) {
    const normalized = normalizeEvaluateSampleRequest(request);
    let initial;
    try {
      initial = await this.#sessionStore.readFile(
        normalized.sessionId,
        normalized.path,
        { rejectSymbolicPath: true },
      );
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw serviceError(404, 'spatial_attachment_missing', 'Authored spatial attachment does not exist.');
      }
      throw error;
    }
    if (initial.revision !== normalized.baseRevision) {
      throw revisionConflict(initial.path, normalized.baseRevision, initial.revision);
    }

    const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'shader-forge-spatial-evaluate-sample-'));
    try {
      const staged = await this.#stageAuthoredSpatialInputs(normalized.sessionId, temporaryRoot);
      const stagedAnimationRoot = staged.animationRoot;
      const sourceRevisions = staged.sourceRevisions;
      const stagedContent = await readOptionalUtf8(
        path.join(stagedAnimationRoot, normalized.stagedSource),
      );
      const stagedRevision = stagedContent === null
        ? MISSING_FILE_REVISION
        : textContentRevision(stagedContent);
      if (stagedRevision !== normalized.baseRevision) {
        throw revisionConflict(initial.path, normalized.baseRevision, stagedRevision);
      }

      let baseline;
      try {
        baseline = publicValidation(await this.#validateAnimationRoot(stagedAnimationRoot));
      } catch (error) {
        if (error?.code === 'spatial_validator_unavailable') throw error;
        throw validationFailure(
          'spatial_baseline_invalid',
          'Authored spatial baseline is invalid.',
          error,
        );
      }

      const attachment = requiredProfileIdentity(
        profileBySource(baseline, normalized.stagedSource),
        'spatial_baseline_source_missing',
        'Validator did not return the authored attachment source.',
      );
      const evaluation = await this.#evaluateStagedSampledAttachment(
        staged,
        attachment,
        normalized.phase,
        normalized.normalizedTime,
      );

      await this.#assertSpatialSourcesUnchanged(
        normalized.sessionId,
        sourceRevisions,
        normalized.path,
      );

      return {
        evaluation,
        path: initial.path,
        revision: normalized.baseRevision,
        sourceRevisions,
      };
    } finally {
      await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
  }

  async #evaluateStagedAttachment(staged, attachment, role) {
    let report;
    try {
      report = await this.#evaluateRestAttachment(
        staged.animationRoot,
        staged.contentRoot,
        staged.foundationPath,
        attachment.id,
      );
    } catch (error) {
      if (error?.code === 'spatial_evaluator_unavailable' || error?.code === 'ENOENT') {
        throw serviceError(
          503,
          'spatial_evaluator_unavailable',
          boundedDiagnostic(error) || 'Spatial evaluator was not found.',
        );
      }
      if (error?.code === 'spatial_evaluator_protocol_error') throw error;
      if (isEvaluatorInfrastructureError(error)) {
        throw serviceError(
          500,
          'spatial_evaluator_infrastructure_error',
          'Spatial evaluator could not complete.',
          { diagnostic: boundedDiagnostic(error) },
        );
      }
      throw evaluationFailure(
        role === 'candidate'
          ? 'spatial_candidate_evaluation_invalid'
          : 'spatial_baseline_evaluation_invalid',
        role === 'candidate'
          ? 'Proposed spatial attachment evaluation is invalid.'
          : 'Authored spatial baseline evaluation is invalid.',
        error,
      );
    }
    return publicEvaluation(report, attachment);
  }

  async #evaluateStagedSampledAttachment(
    staged,
    attachment,
    phase,
    normalizedTime,
  ) {
    let report;
    try {
      report = await this.#evaluateSampledAttachment(
        staged.animationRoot,
        staged.contentRoot,
        staged.foundationPath,
        attachment.id,
        phase,
        normalizedTime,
      );
    } catch (error) {
      if (error?.code === 'spatial_evaluator_unavailable' || error?.code === 'ENOENT') {
        throw serviceError(
          503,
          'spatial_evaluator_unavailable',
          boundedDiagnostic(error) || 'Spatial evaluator was not found.',
        );
      }
      if (error?.code === 'spatial_evaluator_protocol_error') throw error;
      if (isEvaluatorInfrastructureError(error)) {
        throw serviceError(
          500,
          'spatial_evaluator_infrastructure_error',
          'Spatial evaluator could not complete.',
          { diagnostic: boundedDiagnostic(error) },
        );
      }
      throw evaluationFailure(
        'spatial_sample_evaluation_invalid',
        'Authored spatial sample evaluation is invalid.',
        error,
      );
    }
    return publicSampledEvaluation(
      report,
      attachment,
      phase,
      normalizedTime,
    );
  }

  async #readAuthoredAnimationSources(sessionId) {
    const sources = [];
    for (const [directory, suffix] of Object.entries(animationDirectories)) {
      let listing;
      try {
        listing = await this.#sessionStore.listFiles(
          sessionId,
          `animation/${directory}`,
          { rejectSymbolicPath: true },
        );
      } catch (error) {
        if (error?.code === 'ENOENT') continue;
        throw error;
      }
      for (const entry of listing.entries) {
        if (entry.kind === 'symlink') {
          throw serviceError(
            400,
            'spatial_source_symlink_rejected',
            `Symbolic links are not allowed in animation/${directory}: ${entry.name}`,
          );
        }
        if (entry.kind !== 'file' || !entry.name.endsWith(suffix)) continue;
        let source;
        try {
          source = await this.#sessionStore.readFile(
            sessionId,
            entry.path,
            { rejectSymbolicPath: true },
          );
        } catch (error) {
          if (error?.code === 'ENOENT') continue;
          throw error;
        }
        sources.push({
          path: entry.path,
          directory,
          name: entry.name,
          revision: source.revision,
          content: source.content,
        });
      }
    }
    return sources.sort((left, right) => (
      left.path < right.path ? -1 : left.path > right.path ? 1 : 0
    ));
  }

  async #readAuthoredTomlTree(sessionId, relativeRoot) {
    const sources = [];
    const directories = [relativeRoot];
    const visit = async (relativePath) => {
      let listing;
      try {
        listing = await this.#sessionStore.listFiles(
          sessionId,
          relativePath,
          { rejectSymbolicPath: true },
        );
      } catch (error) {
        if (error?.code === 'ENOENT') {
          throw evaluationInputsChangedDuringSnapshot(relativePath, relativeRoot);
        }
        throw error;
      }
      for (const entry of listing.entries) {
        if (entry.kind === 'symlink') {
          throw serviceError(
            400,
            'spatial_source_symlink_rejected',
            `Symbolic links are not allowed in ${relativeRoot}: ${entry.path}`,
          );
        }
        if (entry.kind === 'directory') {
          directories.push(entry.path);
          await visit(entry.path);
          continue;
        }
        if (entry.kind !== 'file' || !entry.name.endsWith('.toml')) continue;
        let source;
        try {
          source = await this.#sessionStore.readFile(
            sessionId,
            entry.path,
            { rejectSymbolicPath: true },
          );
        } catch (error) {
          if (error?.code === 'ENOENT') {
            throw evaluationInputsChangedDuringSnapshot(entry.path, relativeRoot);
          }
          throw error;
        }
        sources.push({
          path: entry.path,
          revision: source.revision,
          content: source.content,
        });
      }
    };
    await visit(relativeRoot);
    return { sources, directories };
  }

  async #readDataFoundationSources(sessionId) {
    let foundation;
    try {
      foundation = await this.#sessionStore.readFile(
        sessionId,
        dataFoundationRelativePath,
        { rejectSymbolicPath: true },
      );
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw evaluationInputsChangedDuringSnapshot(
          dataFoundationRelativePath,
          dataFoundationRelativePath,
        );
      }
      throw error;
    }
    const contentTree = await this.#readAuthoredTomlTree(sessionId, 'content');
    return {
      sources: [
        {
          path: foundation.path,
          revision: foundation.revision,
          content: foundation.content,
        },
        ...contentTree.sources,
      ],
      contentDirectories: contentTree.directories,
    };
  }

  async #readSpatialSources(sessionId) {
    const [animationSources, dataSources] = await Promise.all([
      this.#readAuthoredAnimationSources(sessionId),
      this.#readDataFoundationSources(sessionId),
    ]);
    return {
      sources: [...animationSources, ...dataSources.sources].sort((left, right) => (
        left.path < right.path ? -1 : left.path > right.path ? 1 : 0
      )),
      contentDirectories: dataSources.contentDirectories,
    };
  }

  async #stageAuthoredSpatialInputs(sessionId, stagedRoot) {
    const snapshot = await this.#readSpatialSources(sessionId);
    for (const directory of Object.keys(animationDirectories)) {
      await fs.mkdir(path.join(stagedRoot, 'animation', directory), { recursive: true });
    }
    for (const directory of snapshot.contentDirectories) {
      await fs.mkdir(path.join(stagedRoot, ...directory.split('/')), { recursive: true });
    }
    for (const source of snapshot.sources) {
      const stagedPath = path.join(stagedRoot, ...source.path.split('/'));
      await fs.mkdir(path.dirname(stagedPath), { recursive: true });
      await fs.writeFile(stagedPath, source.content, 'utf8');
    }
    return {
      animationRoot: path.join(stagedRoot, 'animation'),
      contentRoot: path.join(stagedRoot, 'content'),
      foundationPath: path.join(stagedRoot, ...dataFoundationRelativePath.split('/')),
      sourceRevisions: publicSourceRevisions(snapshot.sources),
    };
  }

  async #assertSpatialSourcesUnchanged(sessionId, expected, selectedPath) {
    await this.#sessionStore.runSerializedFileMutation(async () => {
      const actual = publicSourceRevisions((await this.#readSpatialSources(sessionId)).sources);
      const difference = firstSourceRevisionDifference(expected, actual);
      if (!difference) return;
      if (difference.path === selectedPath) {
        throw revisionConflict(
          difference.path,
          difference.expectedRevision,
          difference.actualRevision,
        );
      }
      throw evaluationInputsChanged(difference);
    }, { sessionId });
  }
}
