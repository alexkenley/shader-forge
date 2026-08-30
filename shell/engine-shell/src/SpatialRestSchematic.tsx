import { useId, useMemo, useState, type ReactNode } from 'react';
import type {
  SpatialAttachmentEvaluation,
  SpatialEvaluationVec3,
  SpatialSampledPose,
  SpatialSourceRevision,
} from './lib/sessiond';

export type SpatialRestSchematicProjection = 'xy' | 'zy' | 'xz';
export type SpatialSchematicPoseKind = 'rest' | 'sampled';

type SpatialRestSchematicProps = {
  evaluation: SpatialAttachmentEvaluation | null;
  busy: boolean;
  error: string;
  evidenceLabel: string;
  path: string;
  revision: string;
  stale: boolean;
  staleReason: string;
  poseKind?: SpatialSchematicPoseKind;
  sampleIdentity?: {
    phase: string;
    clip: string;
    normalizedTime: number;
    sourceRevisionCount: number;
  };
  sourceRevisions?: SpatialSourceRevision[];
};

type ProjectionBounds = { minU: number; minV: number; span: number };
type CoordinateRow = { kind: string; id: string; value: SpatialEvaluationVec3; unit?: string; detail?: string };

const VIEWBOX = 100;
const PAD = 8;
const INNER = VIEWBOX - PAD * 2;
const PROJECTIONS: Array<{ id: SpatialRestSchematicProjection; label: string; detail: string }> = [
  { id: 'xy', label: 'Front X/Y', detail: 'horizontal +X, vertical +Y; depth is Z' },
  { id: 'zy', label: 'Side Z/Y', detail: 'horizontal +Z, vertical +Y; depth is X' },
  { id: 'xz', label: 'Top X/Z', detail: 'horizontal +X, vertical +Z; depth is Y' },
];

const LEGEND = [
  ['Bone segment', '#9fb2c3'],
  ['Authored visual box', '#64748b'],
  ['Bone origin', '#d4d4d4'],
  ['Socket', '#fbbf24'],
  ['Item origin / axes', '#f8fafc'],
  ['Primary contact', '#f472b6'],
  ['Hand frame', '#38bdf8'],
  ['Palm frame', '#2dd4bf'],
  ['Secondary target', '#c084fc'],
  ['Secondary pole', '#34d399'],
  ['Handle direction', '#fb923c'],
] as const;
const ITEM_BOX_EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
] as const;
const ITEM_GEOMETRY_UNAVAILABLE_REASONS = new Set([
  'item_prefab_not_found',
  'item_prefab_ambiguous',
  'item_prefab_visual_geometry_unavailable',
  'item_prefab_visual_geometry_ambiguous',
  'item_prefab_visual_geometry_not_box',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export const SPATIAL_EVALUATION_LIMITS = {
  maxStringLength: 2048,
  maxTotalTextLength: 65536,
  maxBones: 1024,
  maxSegments: 2048,
  maxSockets: 1024,
  maxLimitations: 64,
  maxCoordinateRows: 4096,
  maxProceduralLayers: 8,
} as const;

const PRIMARY_ATTACHMENT_LAYER = 'primary_attachment';
const SECONDARY_HAND_IK_LAYER = 'secondary_hand_ik';
const ALLOWED_PROCEDURAL_LAYERS = [PRIMARY_ATTACHMENT_LAYER, SECONDARY_HAND_IK_LAYER] as const;
const SAMPLED_POSE_KEYS = [
  'kind',
  'sampled',
  'phase',
  'clip',
  'normalizedTime',
  'proceduralLayersRequested',
  'proceduralLayersApplied',
  'proceduralLayersUnavailable',
] as const;
const APPLIED_SECONDARY_IK_KEYS = [
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
] as const;

type ValidationBudget = { textLength: number };
type SpatialEvaluationQuat = [number, number, number, number];

const UNIT_EPSILON = 1e-6;

function exactRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function boundedString(value: unknown, budget: ValidationBudget, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || value.length > SPATIAL_EVALUATION_LIMITS.maxStringLength) {
    return false;
  }
  budget.textLength += value.length;
  return budget.textLength <= SPATIAL_EVALUATION_LIMITS.maxTotalTextLength;
}

export function isSpatialEvaluationVec3(value: unknown): value is SpatialEvaluationVec3 {
  return Array.isArray(value)
    && value.length === 3
    && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry));
}

function isSpatialEvaluationQuat(value: unknown): value is SpatialEvaluationQuat {
  return Array.isArray(value)
    && value.length === 4
    && value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
    && Math.abs(Math.hypot(...value) - 1) <= UNIT_EPSILON
    && value[3] >= 0;
}

function near(left: number, right: number) {
  return Math.abs(left - right) <= UNIT_EPSILON;
}

function unitVector(value: unknown): value is SpatialEvaluationVec3 {
  return isSpatialEvaluationVec3(value) && near(Math.hypot(...value), 1);
}

function dot(left: SpatialEvaluationVec3, right: SpatialEvaluationVec3) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function quaternionAxes([x, y, z, w]: SpatialEvaluationQuat) {
  return {
    x: [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)] as SpatialEvaluationVec3,
    y: [2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x)] as SpatialEvaluationVec3,
    z: [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)] as SpatialEvaluationVec3,
  };
}

function validAxes(value: unknown, rotation: SpatialEvaluationQuat) {
  if (!exactRecord(value, ['x', 'y', 'z'])) return false;
  const { x, y, z } = value;
  if (!unitVector(x)
    || !unitVector(y)
    || !unitVector(z)
    || !near(dot(x, y), 0)
    || !near(dot(x, z), 0)
    || !near(dot(y, z), 0)) return false;
  const axes = { x, y, z };
  const expected = quaternionAxes(rotation);
  return (['x', 'y', 'z'] as const).every((axis) => (
    axes[axis].every((entry, index) => near(entry, expected[axis][index]))
  ));
}

function validTransform(value: unknown) {
  return exactRecord(value, ['translation', 'rotation', 'axes'])
    && isSpatialEvaluationVec3(value.translation)
    && isSpatialEvaluationQuat(value.rotation)
    && validAxes(value.axes, value.rotation);
}

function validDiagnostic(value: unknown, budget: ValidationBudget, statuses: readonly string[] = ['unavailable', 'not_applicable']) {
  return exactRecord(value, ['status', 'reason'])
    && typeof value.status === 'string'
    && statuses.includes(value.status)
    && boundedString(value.reason, budget);
}

function validItemGeometry(
  value: unknown,
  itemWorld: unknown,
  budget: ValidationBudget,
) {
  if (!isRecord(value) || !isRecord(itemWorld)) return false;
  if (value.status === 'unavailable') {
    return exactRecord(value, ['status', 'reason'])
      && boundedString(value.reason, budget)
      && ITEM_GEOMETRY_UNAVAILABLE_REASONS.has(value.reason as string);
  }
  if (
    !exactRecord(value, ['status', 'kind', 'procgeoId', 'dimensionsMeters', 'worldCorners'])
    || value.status !== 'available'
    || value.kind !== 'authored_visual_box'
    || !boundedString(value.procgeoId, budget)
    || !isSpatialEvaluationVec3(value.dimensionsMeters)
    || value.dimensionsMeters.some((entry) => entry <= 0)
    || !Array.isArray(value.worldCorners)
    || value.worldCorners.length !== 8
    || !exactRecord(itemWorld.axes, ['x', 'y', 'z'])
    || !isSpatialEvaluationVec3(itemWorld.translation)
    || !isSpatialEvaluationVec3(itemWorld.axes.x)
    || !isSpatialEvaluationVec3(itemWorld.axes.y)
    || !isSpatialEvaluationVec3(itemWorld.axes.z)
  ) return false;
  const itemTranslation = itemWorld.translation as SpatialEvaluationVec3;
  const itemAxes = itemWorld.axes as {
    x: SpatialEvaluationVec3;
    y: SpatialEvaluationVec3;
    z: SpatialEvaluationVec3;
  };
  const half = value.dimensionsMeters.map((entry) => entry * 0.5);
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
  return value.worldCorners.every((corner, index) => {
    if (!isSpatialEvaluationVec3(corner)) return false;
    const local = localCorners[index];
    const expected = itemTranslation.map((entry, axisIndex) => (
      entry
      + local[0] * itemAxes.x[axisIndex]
      + local[1] * itemAxes.y[axisIndex]
      + local[2] * itemAxes.z[axisIndex]
    ));
    return corner.every((entry, axisIndex) => near(entry, expected[axisIndex]));
  });
}

function exactStatusReason(value: unknown, status: string, reason: string, budget: ValidationBudget) {
  return isRecord(value)
    && validDiagnostic(value, budget, [status])
    && value.status === status
    && value.reason === reason;
}

function exactStringArray(value: unknown, expected: readonly string[]) {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index]);
}

function uniqueAllowedLayers(value: unknown, budget: ValidationBudget): value is string[] {
  if (!Array.isArray(value) || value.length > SPATIAL_EVALUATION_LIMITS.maxProceduralLayers) return false;
  const seen = new Set<string>();
  for (const layer of value) {
    if (
      typeof layer !== 'string'
      || !(ALLOWED_PROCEDURAL_LAYERS as readonly string[]).includes(layer)
      || seen.has(layer)
      || !boundedString(layer, budget)
    ) return false;
    seen.add(layer);
  }
  return true;
}

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function sampledPoseShape(value: unknown, budget: ValidationBudget): value is SpatialSampledPose {
  return exactRecord(value, SAMPLED_POSE_KEYS)
    && value.kind === 'clip_sample'
    && value.sampled === true
    && boundedString(value.phase, budget)
    && boundedString(value.clip, budget)
    && typeof value.normalizedTime === 'number'
    && Number.isFinite(value.normalizedTime)
    && !Object.is(value.normalizedTime, -0)
    && value.normalizedTime >= 0
    && value.normalizedTime <= 1
    && uniqueAllowedLayers(value.proceduralLayersRequested, budget)
    && uniqueAllowedLayers(value.proceduralLayersApplied, budget)
    && uniqueAllowedLayers(value.proceduralLayersUnavailable, budget);
}

function validAppliedSecondaryIk(value: unknown, secondary: unknown) {
  if (!exactRecord(value, APPLIED_SECONDARY_IK_KEYS)
    || value.status !== 'applied'
    || value.solved !== true
    || typeof value.reachable !== 'boolean'
    || !finiteNonNegative(value.preSolveDistanceMeters)
    || !finiteNonNegative(value.targetDistanceMeters)
    || !finiteNonNegative(value.minReachMeters)
    || !finiteNonNegative(value.maxReachMeters)
    || value.maxReachMeters < value.minReachMeters
    || !finiteNonNegative(value.reachResidualMeters)
    || !finiteNonNegative(value.reachToleranceMeters)
    || typeof value.reachWithinTolerance !== 'boolean'
    || !finiteNonNegative(value.postSolveDistanceMeters)
    || !finiteNonNegative(value.contactToleranceMeters)
    || typeof value.contactWithinTolerance !== 'boolean'
    || !finiteNonNegative(value.postSolveAngleDegrees)
    || !finiteNonNegative(value.angleToleranceDegrees)
    || typeof value.angleWithinTolerance !== 'boolean'
    || typeof value.withinTolerance !== 'boolean') {
    return false;
  }
  if (value.reachWithinTolerance !== (value.reachResidualMeters <= value.reachToleranceMeters)) return false;
  if (value.contactWithinTolerance !== (value.postSolveDistanceMeters <= value.contactToleranceMeters)) return false;
  if (value.angleWithinTolerance !== (value.postSolveAngleDegrees <= value.angleToleranceDegrees)) return false;
  if (value.withinTolerance !== (value.reachWithinTolerance && value.contactWithinTolerance && value.angleWithinTolerance)) {
    return false;
  }
  const reachableByDistance = value.targetDistanceMeters >= value.minReachMeters
    && value.targetDistanceMeters <= value.maxReachMeters;
  if (value.reachable !== reachableByDistance) return false;
  const expectedReachResidual = value.targetDistanceMeters < value.minReachMeters
    ? value.minReachMeters - value.targetDistanceMeters
    : value.targetDistanceMeters > value.maxReachMeters
      ? value.targetDistanceMeters - value.maxReachMeters
      : 0;
  if (!near(value.reachResidualMeters, expectedReachResidual)) return false;
  if (!isRecord(secondary)
    || typeof secondary.preSolveDistanceMeters !== 'number'
    || !Number.isFinite(secondary.preSolveDistanceMeters)
    || !near(secondary.preSolveDistanceMeters, value.preSolveDistanceMeters)
    || !validTransform(secondary.palmWorld)
    || !validTransform(secondary.targetWorld)) {
    return false;
  }
  const palm = secondary.palmWorld as { translation: SpatialEvaluationVec3; rotation: SpatialEvaluationQuat };
  const target = secondary.targetWorld as { translation: SpatialEvaluationVec3; rotation: SpatialEvaluationQuat };
  const geometryDistance = Math.hypot(
    target.translation[0] - palm.translation[0],
    target.translation[1] - palm.translation[1],
    target.translation[2] - palm.translation[2],
  );
  const rotationDot = Math.min(1, Math.abs(
    palm.rotation[0] * target.rotation[0]
    + palm.rotation[1] * target.rotation[1]
    + palm.rotation[2] * target.rotation[2]
    + palm.rotation[3] * target.rotation[3],
  ));
  const geometryAngleDegrees = 2 * Math.acos(rotationDot) * 180 / Math.PI;
  return near(value.postSolveDistanceMeters, geometryDistance)
    && near(value.postSolveAngleDegrees, geometryAngleDegrees);
}

function validSampledBranch(
  value: Record<string, unknown>,
  pose: SpatialSampledPose,
  budget: ValidationBudget,
) {
  if (!isRecord(value.attachment) || !isRecord(value.hands) || !isRecord(value.diagnostics)) return false;
  if (value.hands.dominant === null) return false;
  const mode = value.attachment.mode;
  const schemaVersion = value.schemaVersion;
  if (mode === 'one_hand') {
    return value.hands.secondary === null
      && exactStringArray(pose.proceduralLayersRequested, [PRIMARY_ATTACHMENT_LAYER])
      && exactStringArray(pose.proceduralLayersApplied, [PRIMARY_ATTACHMENT_LAYER])
      && exactStringArray(pose.proceduralLayersUnavailable, [])
      && exactStatusReason(value.diagnostics.secondaryIk, 'not_applicable', 'one_hand_attachment', budget)
      && exactStringArray(value.limitations, [
        'sampled_attachment_schematic_only',
        'not_review_evidence',
        'item_mesh_unavailable',
      ]);
  }
  if (mode !== 'two_hand' || value.hands.secondary === null || !isRecord(value.hands.secondary)) return false;
  if (value.hands.secondary.enabled !== true
    || value.hands.secondary.palmWorld === null
    || value.hands.secondary.targetWorld === null
    || value.hands.secondary.pole === null) {
    return false;
  }
  if (schemaVersion === 1) {
    return exactStringArray(pose.proceduralLayersRequested, [PRIMARY_ATTACHMENT_LAYER, SECONDARY_HAND_IK_LAYER])
      && exactStringArray(pose.proceduralLayersApplied, [PRIMARY_ATTACHMENT_LAYER])
      && exactStringArray(pose.proceduralLayersUnavailable, [SECONDARY_HAND_IK_LAYER])
      && exactStatusReason(value.diagnostics.secondaryIk, 'unavailable', 'secondary_hand_ik_not_implemented', budget)
      && exactStringArray(value.limitations, [
        'pre_ik_only',
        'not_review_evidence',
        'item_mesh_unavailable',
        'secondary_hand_ik_unavailable',
      ]);
  }
  return schemaVersion === 2
    && exactStringArray(pose.proceduralLayersRequested, [PRIMARY_ATTACHMENT_LAYER, SECONDARY_HAND_IK_LAYER])
    && exactStringArray(pose.proceduralLayersApplied, [PRIMARY_ATTACHMENT_LAYER, SECONDARY_HAND_IK_LAYER])
    && exactStringArray(pose.proceduralLayersUnavailable, [])
    && validAppliedSecondaryIk(value.diagnostics.secondaryIk, value.hands.secondary)
    && exactStringArray(value.limitations, [
      'sampled_attachment_schematic_only',
      'not_review_evidence',
      'item_mesh_unavailable',
    ]);
}

function validRestBranch(value: Record<string, unknown>, budget: ValidationBudget) {
  if (!isRecord(value.attachment) || !isRecord(value.hands) || !isRecord(value.diagnostics)) return false;
  if (value.hands.dominant === null) return false;
  if (value.attachment.mode === 'one_hand') {
    return value.hands.secondary === null
      && exactStatusReason(value.diagnostics.secondaryIk, 'not_applicable', 'one_hand_attachment', budget)
      && exactStringArray(value.limitations, [
        'rest_pose_only',
        'not_review_evidence',
        'item_mesh_unavailable',
      ]);
  }
  if (
    value.attachment.mode !== 'two_hand'
    || !isRecord(value.hands.secondary)
    || value.hands.secondary.enabled !== true
    || value.hands.secondary.palmWorld === null
    || value.hands.secondary.targetWorld === null
    || value.hands.secondary.pole === null
  ) return false;
  return exactStatusReason(
    value.diagnostics.secondaryIk,
    'unavailable',
    value.schemaVersion === 2 ? 'rest_pose_unsolved' : 'secondary_hand_ik_not_implemented',
    budget,
  ) && exactStringArray(value.limitations, [
    'rest_pose_only',
    'not_review_evidence',
    'item_mesh_unavailable',
    'secondary_hand_ik_unavailable',
  ]);
}

function validPole(value: unknown, schemaVersion: unknown, budget: ValidationBudget) {
  if (!exactRecord(value, ['translation', 'space', 'world', 'reason'])
      || !isSpatialEvaluationVec3(value.translation)) return false;
  if (schemaVersion === 1) {
    return value.space === 'unresolved'
      && value.world === null
      && value.reason === 'pole_space_not_authored'
      && boundedString(value.reason, budget);
  }
  return schemaVersion === 2
    && value.space === 'item'
    && isSpatialEvaluationVec3(value.world)
    && value.reason === null;
}

function transformTranslation(value: unknown): SpatialEvaluationVec3 | null {
  return isRecord(value) && isSpatialEvaluationVec3(value.translation) ? value.translation : null;
}

function transformAxes(value: unknown) {
  if (!isRecord(value) || !isRecord(value.axes)) return null;
  const { x, y, z } = value.axes;
  return isSpatialEvaluationVec3(x) && isSpatialEvaluationVec3(y) && isSpatialEvaluationVec3(z)
    ? { x, y, z }
    : null;
}

export function isSpatialAttachmentEvaluation(value: unknown): value is SpatialAttachmentEvaluation {
  const budget: ValidationBudget = { textLength: 0 };
  if (!exactRecord(value, [
    'schema', 'schemaVersion', 'pose', 'coordinateSystem', 'skeleton', 'attachment',
    'bones', 'segments', 'sockets', 'item', 'hands', 'diagnostics', 'limitations',
  ])) return false;
  const restPose = exactRecord(value.pose, ['kind', 'sampled'])
    && value.pose.kind === 'rest'
    && value.pose.sampled === false;
  const sampledPose = sampledPoseShape(value.pose, budget);
  if (
    value.schema !== 'shader_forge.spatial_attachment_evaluation'
    || (value.schemaVersion !== 1 && value.schemaVersion !== 2)
    || (!restPose && !sampledPose)
    || !exactRecord(value.coordinateSystem, ['units', 'handedness', 'up', 'forward', 'quaternionOrder'])
    || value.coordinateSystem.units !== 'meters'
    || value.coordinateSystem.handedness !== 'right'
    || value.coordinateSystem.up !== '+Y'
    || value.coordinateSystem.forward !== '+Z'
    || value.coordinateSystem.quaternionOrder !== 'xyzw'
  ) return false;
  if (
    !exactRecord(value.skeleton, ['id', 'name', 'rootBone'])
    || !boundedString(value.skeleton.id, budget)
    || !boundedString(value.skeleton.name, budget)
    || !boundedString(value.skeleton.rootBone, budget)
    || !exactRecord(value.attachment, [
      'id', 'name', 'itemPrefabId', 'dominantHand', 'mode', 'perspective', 'primaryGripSocket',
    ])
    || !boundedString(value.attachment.id, budget)
    || !boundedString(value.attachment.name, budget)
    || !boundedString(value.attachment.itemPrefabId, budget)
    || !boundedString(value.attachment.dominantHand, budget)
    || !boundedString(value.attachment.mode, budget)
    || !boundedString(value.attachment.perspective, budget)
    || !boundedString(value.attachment.primaryGripSocket, budget)
    || !['left', 'right'].includes(value.attachment.dominantHand as string)
    || !['one_hand', 'two_hand'].includes(value.attachment.mode as string)
    || !['first_person', 'third_person', 'both'].includes(value.attachment.perspective as string)
  ) return false;
  if (
    !Array.isArray(value.bones)
    || value.bones.length > SPATIAL_EVALUATION_LIMITS.maxBones
    || !value.bones.every((entry) => exactRecord(entry, ['id', 'parent', 'role', 'local', 'world'])
      && boundedString(entry.id, budget)
      && boundedString(entry.parent, budget, true)
      && boundedString(entry.role, budget)
      && validTransform(entry.local)
      && validTransform(entry.world))
  ) return false;
  if (
    !Array.isArray(value.segments)
    || value.segments.length > SPATIAL_EVALUATION_LIMITS.maxSegments
    || !value.segments.every((entry) => exactRecord(entry, ['parentBoneId', 'boneId', 'from', 'to'])
      && boundedString(entry.parentBoneId, budget)
      && boundedString(entry.boneId, budget)
      && isSpatialEvaluationVec3(entry.from)
      && isSpatialEvaluationVec3(entry.to))
  ) return false;
  if (
    !Array.isArray(value.sockets)
    || value.sockets.length > SPATIAL_EVALUATION_LIMITS.maxSockets
    || !value.sockets.every((entry) => exactRecord(entry, ['id', 'boneId', 'role', 'local', 'world'])
      && boundedString(entry.id, budget)
      && boundedString(entry.boneId, budget)
      && boundedString(entry.role, budget)
      && validTransform(entry.local)
      && validTransform(entry.world))
  ) return false;
  if (
    !exactRecord(value.item, ['prefabId', 'world', 'geometry', 'primaryContactWorld', 'handleAxisWorld'])
    || !boundedString(value.item.prefabId, budget)
    || value.item.prefabId !== value.attachment.itemPrefabId
    || !validTransform(value.item.world)
    || !validItemGeometry(value.item.geometry, value.item.world, budget)
    || !(value.item.primaryContactWorld === null || validTransform(value.item.primaryContactWorld))
    || !(value.item.handleAxisWorld === null || (
      exactRecord(value.item.handleAxisWorld, ['origin', 'direction'])
      && isSpatialEvaluationVec3(value.item.handleAxisWorld.origin)
      && unitVector(value.item.handleAxisWorld.direction)
    ))
  ) return false;
  if (!exactRecord(value.hands, ['dominant', 'secondary'])) return false;
  if (value.hands.dominant === null || !(
    exactRecord(value.hands.dominant, ['boneId', 'role', 'world', 'palmWorld'])
    && boundedString(value.hands.dominant.boneId, budget)
    && boundedString(value.hands.dominant.role, budget)
    && validTransform(value.hands.dominant.world)
    && (value.hands.dominant.palmWorld === null || validTransform(value.hands.dominant.palmWorld))
  )) return false;
  if (value.hands.secondary !== null && !(
    exactRecord(value.hands.secondary, [
      'enabled', 'boneId', 'role', 'world', 'palmWorld', 'targetWorld', 'pole', 'preSolveDistanceMeters',
    ])
    && typeof value.hands.secondary.enabled === 'boolean'
    && boundedString(value.hands.secondary.boneId, budget)
    && boundedString(value.hands.secondary.role, budget)
    && validTransform(value.hands.secondary.world)
    && (value.hands.secondary.palmWorld === null || validTransform(value.hands.secondary.palmWorld))
    && (value.hands.secondary.targetWorld === null || validTransform(value.hands.secondary.targetWorld))
    && (value.hands.secondary.pole === null
      || validPole(value.hands.secondary.pole, value.schemaVersion, budget))
    && (value.hands.secondary.preSolveDistanceMeters === null || (
      typeof value.hands.secondary.preSolveDistanceMeters === 'number'
      && Number.isFinite(value.hands.secondary.preSolveDistanceMeters)
      && value.hands.secondary.preSolveDistanceMeters >= 0
    ))
  )) return false;
  if (
    !exactRecord(value.diagnostics, ['secondaryIk', 'jointLimits', 'clipping'])
    || !exactStatusReason(value.diagnostics.jointLimits, 'unavailable', 'joint_limits_not_authored', budget)
    || !exactStatusReason(value.diagnostics.clipping, 'unavailable', 'item_and_capsule_geometry_not_integrated', budget)
    || !Array.isArray(value.limitations)
    || value.limitations.length > SPATIAL_EVALUATION_LIMITS.maxLimitations
    || !value.limitations.every((entry) => boundedString(entry, budget))
  ) return false;
  if (restPose && !validRestBranch(value, budget)) return false;
  if (sampledPose && !validSampledBranch(value, value.pose as SpatialSampledPose, budget)) return false;
  const coordinateRowCount = value.bones.length
    + value.segments.length * 2
    + value.sockets.length
    + 4
    + (isRecord(value.item.geometry)
      && value.item.geometry.status === 'available'
      && Array.isArray(value.item.geometry.worldCorners) ? 8 : 0)
    + (value.item.primaryContactWorld ? 1 : 0)
    + (value.item.handleAxisWorld ? 2 : 0)
    + (value.hands.dominant ? 1 + (value.hands.dominant.palmWorld ? 1 : 0) : 0)
    + (value.hands.secondary
      ? 1
        + (value.hands.secondary.palmWorld ? 1 : 0)
        + (value.hands.secondary.targetWorld ? 1 : 0)
        + (isRecord(value.hands.secondary.pole)
          && isSpatialEvaluationVec3(value.hands.secondary.pole.world) ? 1 : 0)
      : 0);
  if (coordinateRowCount > SPATIAL_EVALUATION_LIMITS.maxCoordinateRows) return false;
  const points = evaluationPoints(value as SpatialAttachmentEvaluation);
  return points.length > 0
    && PROJECTIONS.every((entry) => spatialProjectionBounds(points, entry.id) !== null);
}

function projectedPair(point: SpatialEvaluationVec3, projection: SpatialRestSchematicProjection): [number, number] {
  if (projection === 'xy') return [point[0], point[1]];
  if (projection === 'zy') return [point[2], point[1]];
  return [point[0], point[2]];
}

export function spatialProjectionBounds(
  points: SpatialEvaluationVec3[],
  projection: SpatialRestSchematicProjection,
): ProjectionBounds | null {
  if (!Array.isArray(points) || points.length === 0) return null;
  let minU = Infinity;
  let minV = Infinity;
  let maxU = -Infinity;
  let maxV = -Infinity;
  for (const point of points) {
    if (!isSpatialEvaluationVec3(point)) return null;
    const [u, v] = projectedPair(point, projection);
    minU = Math.min(minU, u);
    minV = Math.min(minV, v);
    maxU = Math.max(maxU, u);
    maxV = Math.max(maxV, v);
  }
  if (![minU, minV, maxU, maxV].every(Number.isFinite)) return null;
  const spanU = maxU - minU;
  const spanV = maxV - minV;
  if (!Number.isFinite(spanU) || !Number.isFinite(spanV)) return null;
  const span = Math.max(spanU, spanV, 0.05);
  if (!Number.isFinite(span) || span <= 0) return null;
  const centerU = minU / 2 + maxU / 2;
  const centerV = minV / 2 + maxV / 2;
  if (!Number.isFinite(centerU) || !Number.isFinite(centerV)) return null;
  const result = { minU: centerU - span / 2, minV: centerV - span / 2, span };
  return Object.values(result).every(Number.isFinite) ? result : null;
}

export function projectSpatialPoint(
  point: SpatialEvaluationVec3,
  projection: SpatialRestSchematicProjection,
  bounds: ProjectionBounds,
) {
  if (
    !isSpatialEvaluationVec3(point)
    || ![bounds.minU, bounds.minV, bounds.span].every(Number.isFinite)
    || bounds.span <= 0
  ) return null;
  const [u, v] = projectedPair(point, projection);
  const normalizedU = (u - bounds.minU) / bounds.span;
  const normalizedV = (v - bounds.minV) / bounds.span;
  if (![normalizedU, normalizedV].every(Number.isFinite)) return null;
  return {
    x: normalizedU * INNER + PAD,
    y: VIEWBOX - (normalizedV * INNER + PAD),
  };
}

function addScaledDirection(
  origin: SpatialEvaluationVec3,
  direction: SpatialEvaluationVec3,
  length: number,
): SpatialEvaluationVec3 | null {
  const result = origin.map((entry, index) => entry + direction[index] * length);
  return isSpatialEvaluationVec3(result) ? result : null;
}

function evaluationPoints(evaluation: SpatialAttachmentEvaluation) {
  const points: SpatialEvaluationVec3[] = [];
  const add = (value: unknown) => { if (isSpatialEvaluationVec3(value)) points.push(value); };
  for (const entry of evaluation.segments) {
    if (!isRecord(entry)) continue;
    add(entry.from);
    add(entry.to);
  }
  for (const entry of evaluation.bones) {
    if (isRecord(entry)) add(transformTranslation(entry.world));
  }
  for (const entry of evaluation.sockets) {
    if (isRecord(entry)) add(transformTranslation(entry.world));
  }
  if (evaluation.item.geometry.status === 'available') {
    for (const corner of evaluation.item.geometry.worldCorners) add(corner);
  }
  add(transformTranslation(evaluation.item.world));
  add(transformTranslation(evaluation.item.primaryContactWorld));
  if (isRecord(evaluation.item.handleAxisWorld)) add(evaluation.item.handleAxisWorld.origin);
  if (isRecord(evaluation.hands.dominant)) {
    add(transformTranslation(evaluation.hands.dominant.world));
    add(transformTranslation(evaluation.hands.dominant.palmWorld));
  }
  if (isRecord(evaluation.hands.secondary)) {
    add(transformTranslation(evaluation.hands.secondary.world));
    add(transformTranslation(evaluation.hands.secondary.palmWorld));
    add(transformTranslation(evaluation.hands.secondary.targetWorld));
    if (isRecord(evaluation.hands.secondary.pole)) add(evaluation.hands.secondary.pole.world);
  }
  return points;
}

function CoordinateMarker({
  point,
  projection,
  bounds,
  kind,
  color,
}: {
  point: SpatialEvaluationVec3;
  projection: SpatialRestSchematicProjection;
  bounds: ProjectionBounds;
  kind: 'point' | 'socket' | 'contact' | 'target' | 'pole' | 'palm' | 'item';
  color: string;
}) {
  const mapped = projectSpatialPoint(point, projection, bounds);
  if (!mapped) return null;
  if (kind === 'socket' || kind === 'contact') {
    return (
      <rect
        fill={color}
        height={kind === 'contact' ? 3 : 2.4}
        transform={`rotate(45 ${mapped.x} ${mapped.y})`}
        width={kind === 'contact' ? 3 : 2.4}
        x={mapped.x - (kind === 'contact' ? 1.5 : 1.2)}
        y={mapped.y - (kind === 'contact' ? 1.5 : 1.2)}
      />
    );
  }
  if (kind === 'target') {
    return <circle cx={mapped.x} cy={mapped.y} fill="none" r="2.2" stroke={color} strokeWidth="0.8" />;
  }
  if (kind === 'pole') {
    return <circle cx={mapped.x} cy={mapped.y} fill="none" r="1.8" stroke={color} strokeDasharray="1 0.8" strokeWidth="0.8" />;
  }
  return <circle cx={mapped.x} cy={mapped.y} fill={color} r={kind === 'item' ? 1.7 : kind === 'palm' ? 1.35 : 1.05} />;
}

function DirectionGlyph({
  origin,
  directions,
  projection,
  bounds,
  length,
  colors,
}: {
  origin: SpatialEvaluationVec3;
  directions: SpatialEvaluationVec3[];
  projection: SpatialRestSchematicProjection;
  bounds: ProjectionBounds;
  length: number;
  colors: string[];
}) {
  const start = projectSpatialPoint(origin, projection, bounds);
  if (!start) return null;
  return (
    <g>
      {directions.map((direction, index) => {
        const endpoint = addScaledDirection(origin, direction, length);
        const end = endpoint ? projectSpatialPoint(endpoint, projection, bounds) : null;
        const color = colors[index] || colors[0];
        return end ? (
          <g key={index}>
            <line
              stroke={color}
              strokeLinecap="round"
              strokeWidth="0.8"
              x1={start.x}
              x2={end.x}
              y1={start.y}
              y2={end.y}
            />
            <circle cx={end.x} cy={end.y} fill={color} r="0.65" />
          </g>
        ) : null;
      })}
    </g>
  );
}

function Drawing({
  evaluation,
  projection,
}: {
  evaluation: SpatialAttachmentEvaluation;
  projection: SpatialRestSchematicProjection;
}) {
  const bounds = spatialProjectionBounds(evaluationPoints(evaluation), projection);
  if (!bounds) return <p className="spatial-rest-schematic__empty">Evaluator returned no safe drawable world points.</p>;
  const glyphLength = bounds.span * 0.08;
  const itemOrigin = transformTranslation(evaluation.item.world);
  const itemAxes = transformAxes(evaluation.item.world);
  const itemCorners = evaluation.item.geometry.status === 'available'
    ? evaluation.item.geometry.worldCorners
    : [];
  const contact = transformTranslation(evaluation.item.primaryContactWorld);
  const dominant = isRecord(evaluation.hands.dominant) ? evaluation.hands.dominant : null;
  const secondary = isRecord(evaluation.hands.secondary) ? evaluation.hands.secondary : null;
  const secondaryPole = secondary && isRecord(secondary.pole) && isSpatialEvaluationVec3(secondary.pole.world)
    ? secondary.pole.world
    : null;
  const handle = isRecord(evaluation.item.handleAxisWorld)
    && isSpatialEvaluationVec3(evaluation.item.handleAxisWorld.origin)
    && isSpatialEvaluationVec3(evaluation.item.handleAxisWorld.direction)
    ? evaluation.item.handleAxisWorld
    : null;

  return (
    <svg aria-hidden="true" className="spatial-rest-schematic__svg" viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}>
      {ITEM_BOX_EDGES.map(([fromIndex, toIndex]) => {
        const from = itemCorners[fromIndex]
          ? projectSpatialPoint(itemCorners[fromIndex], projection, bounds)
          : null;
        const to = itemCorners[toIndex]
          ? projectSpatialPoint(itemCorners[toIndex], projection, bounds)
          : null;
        return from && to ? (
          <line
            key={`item-box:${fromIndex}:${toIndex}`}
            stroke="#64748b"
            strokeLinecap="round"
            strokeWidth="0.75"
            x1={from.x}
            x2={to.x}
            y1={from.y}
            y2={to.y}
          />
        ) : null;
      })}
      {evaluation.segments.map((entry, index) => {
        if (!isRecord(entry) || !isSpatialEvaluationVec3(entry.from) || !isSpatialEvaluationVec3(entry.to)) return null;
        const from = projectSpatialPoint(entry.from, projection, bounds);
        const to = projectSpatialPoint(entry.to, projection, bounds);
        return from && to ? (
          <line
            key={`${String(entry.parentBoneId)}:${String(entry.boneId)}:${index}`}
            stroke="#9fb2c3"
            strokeLinecap="round"
            strokeWidth="1.1"
            x1={from.x}
            x2={to.x}
            y1={from.y}
            y2={to.y}
          />
        ) : null;
      })}
      {evaluation.bones.map((entry, index) => {
        const point = isRecord(entry) ? transformTranslation(entry.world) : null;
        return point ? <CoordinateMarker key={`bone:${index}`} bounds={bounds} color="#d4d4d4" kind="point" point={point} projection={projection} /> : null;
      })}
      {evaluation.sockets.map((entry, index) => {
        const point = isRecord(entry) ? transformTranslation(entry.world) : null;
        return point ? <CoordinateMarker key={`socket:${index}`} bounds={bounds} color="#fbbf24" kind="socket" point={point} projection={projection} /> : null;
      })}
      {itemOrigin ? <CoordinateMarker bounds={bounds} color="#f8fafc" kind="item" point={itemOrigin} projection={projection} /> : null}
      {itemOrigin && itemAxes ? (
        <DirectionGlyph
          bounds={bounds}
          colors={['#f87171', '#4ade80', '#38bdf8']}
          directions={[itemAxes.x, itemAxes.y, itemAxes.z]}
          length={glyphLength}
          origin={itemOrigin}
          projection={projection}
        />
      ) : null}
      {contact ? <CoordinateMarker bounds={bounds} color="#f472b6" kind="contact" point={contact} projection={projection} /> : null}
      {dominant ? <HandMarkers bounds={bounds} hand={dominant} projection={projection} /> : null}
      {secondary ? <HandMarkers bounds={bounds} hand={secondary} projection={projection} secondary /> : null}
      {secondary ? (
        <OptionalMarker bounds={bounds} color="#c084fc" kind="target" projection={projection} transform={secondary.targetWorld} />
      ) : null}
      {secondaryPole ? (
        <CoordinateMarker bounds={bounds} color="#34d399" kind="pole" point={secondaryPole} projection={projection} />
      ) : null}
      {handle ? (
        <>
          <CoordinateMarker bounds={bounds} color="#fb923c" kind="point" point={handle.origin} projection={projection} />
          <DirectionGlyph
            bounds={bounds}
            colors={['#fb923c']}
            directions={[handle.direction]}
            length={glyphLength * 1.3}
            origin={handle.origin}
            projection={projection}
          />
        </>
      ) : null}
    </svg>
  );
}

function OptionalMarker({
  transform,
  projection,
  bounds,
  kind,
  color,
}: {
  transform: unknown;
  projection: SpatialRestSchematicProjection;
  bounds: ProjectionBounds;
  kind: 'point' | 'target' | 'palm';
  color: string;
}) {
  const point = transformTranslation(transform);
  return point ? <CoordinateMarker bounds={bounds} color={color} kind={kind} point={point} projection={projection} /> : null;
}

function HandMarkers({
  hand,
  projection,
  bounds,
  secondary = false,
}: {
  hand: Record<string, unknown>;
  projection: SpatialRestSchematicProjection;
  bounds: ProjectionBounds;
  secondary?: boolean;
}) {
  return (
    <>
      <OptionalMarker bounds={bounds} color={secondary ? '#a78bfa' : '#38bdf8'} kind="point" projection={projection} transform={hand.world} />
      <OptionalMarker bounds={bounds} color="#2dd4bf" kind="palm" projection={projection} transform={hand.palmWorld} />
    </>
  );
}

function formatVector(value: SpatialEvaluationVec3, unit = 'm') {
  return `[${value.map(String).join(', ')}]${unit ? ` ${unit}` : ''}`;
}

function coordinateRows(evaluation: SpatialAttachmentEvaluation) {
  const rows: CoordinateRow[] = [];
  const addTransform = (kind: string, id: string, transform: unknown, detail?: string) => {
    const value = transformTranslation(transform);
    if (value) rows.push({ kind, id, value, detail });
  };
  for (const [index, entry] of evaluation.segments.entries()) {
    if (!isRecord(entry)) continue;
    const id = `${typeof entry.parentBoneId === 'string' ? entry.parentBoneId : '?'} -> ${typeof entry.boneId === 'string' ? entry.boneId : `#${index}`}`;
    if (isSpatialEvaluationVec3(entry.from)) rows.push({ kind: 'Segment start', id, value: entry.from });
    if (isSpatialEvaluationVec3(entry.to)) rows.push({ kind: 'Segment end', id, value: entry.to });
  }
  for (const [index, entry] of evaluation.bones.entries()) {
    if (isRecord(entry)) addTransform('Bone', typeof entry.id === 'string' ? entry.id : `#${index}`, entry.world, typeof entry.role === 'string' ? entry.role : undefined);
  }
  for (const [index, entry] of evaluation.sockets.entries()) {
    if (isRecord(entry)) addTransform('Socket', typeof entry.id === 'string' ? entry.id : `#${index}`, entry.world, typeof entry.role === 'string' ? entry.role : undefined);
  }
  addTransform('Item origin', typeof evaluation.item.prefabId === 'string' ? evaluation.item.prefabId : 'item', evaluation.item.world);
  if (evaluation.item.geometry.status === 'available') {
    evaluation.item.geometry.worldCorners.forEach((value, index) => {
      rows.push({ kind: 'Item visual-box corner', id: String(index), value });
    });
  }
  const itemAxes = transformAxes(evaluation.item.world);
  if (itemAxes) {
    rows.push({ kind: 'Item axis X', id: 'item', value: itemAxes.x, unit: '', detail: 'unit direction, not an extent' });
    rows.push({ kind: 'Item axis Y', id: 'item', value: itemAxes.y, unit: '', detail: 'unit direction, not an extent' });
    rows.push({ kind: 'Item axis Z', id: 'item', value: itemAxes.z, unit: '', detail: 'unit direction, not an extent' });
  }
  addTransform('Primary contact', 'primary', evaluation.item.primaryContactWorld);
  if (isRecord(evaluation.item.handleAxisWorld) && isSpatialEvaluationVec3(evaluation.item.handleAxisWorld.origin)) {
    rows.push({ kind: 'Handle origin', id: 'handle', value: evaluation.item.handleAxisWorld.origin });
  }
  if (isRecord(evaluation.item.handleAxisWorld) && isSpatialEvaluationVec3(evaluation.item.handleAxisWorld.direction)) {
    rows.push({ kind: 'Handle direction', id: 'handle', value: evaluation.item.handleAxisWorld.direction, unit: '', detail: 'unit direction, not an extent' });
  }
  if (isRecord(evaluation.hands.dominant)) {
    addTransform('Dominant hand', String(evaluation.hands.dominant.boneId || 'dominant'), evaluation.hands.dominant.world);
    addTransform('Dominant palm', String(evaluation.hands.dominant.boneId || 'dominant'), evaluation.hands.dominant.palmWorld);
  }
  if (isRecord(evaluation.hands.secondary)) {
    addTransform('Secondary hand', String(evaluation.hands.secondary.boneId || 'secondary'), evaluation.hands.secondary.world);
    addTransform('Secondary palm', String(evaluation.hands.secondary.boneId || 'secondary'), evaluation.hands.secondary.palmWorld);
    addTransform('Secondary target', 'target', evaluation.hands.secondary.targetWorld);
    if (isRecord(evaluation.hands.secondary.pole) && isSpatialEvaluationVec3(evaluation.hands.secondary.pole.world)) {
      rows.push({ kind: 'Secondary pole', id: String(evaluation.hands.secondary.pole.space || 'pole'), value: evaluation.hands.secondary.pole.world });
    }
  }
  return rows;
}

function layerList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry) => typeof entry === 'string').join(', ') || 'none'
    : 'unavailable';
}

function diagnosticRows(evaluation: SpatialAttachmentEvaluation) {
  const rows: Array<{ name: string; status: string; reason: string }> = [];
  const add = (name: string, value: unknown) => {
    if (!isRecord(value)) {
      rows.push({ name, status: 'unavailable', reason: 'invalid evaluator field' });
      return;
    }
    rows.push({
      name,
      status: typeof value.status === 'string' ? value.status : 'unavailable',
      reason: typeof value.reason === 'string' ? value.reason : 'reason not provided',
    });
  };
  if (evaluation.pose.kind === 'clip_sample') {
    rows.push({
      name: 'Procedural requested',
      status: 'requested',
      reason: layerList(evaluation.pose.proceduralLayersRequested),
    });
    rows.push({
      name: 'Procedural applied',
      status: 'applied',
      reason: layerList(evaluation.pose.proceduralLayersApplied),
    });
    rows.push({
      name: 'Procedural unavailable',
      status: 'unavailable',
      reason: layerList(evaluation.pose.proceduralLayersUnavailable),
    });
  }
  if (evaluation.item.geometry.status === 'available') {
    rows.push({
      name: 'Item geometry',
      status: 'available',
      reason: `authored visual box ${evaluation.item.geometry.dimensionsMeters.join(' x ')} m via ${evaluation.item.geometry.procgeoId}`,
    });
  } else {
    add('Item geometry', evaluation.item.geometry);
  }
  const secondaryIk = evaluation.diagnostics.secondaryIk;
  if (isRecord(secondaryIk) && secondaryIk.status === 'applied') {
    rows.push({
      name: 'Secondary IK',
      status: 'applied',
      reason: secondaryIk.solved === true
        ? (secondaryIk.reachable === true ? 'solved reachable' : 'solved unreachable')
        : 'applied',
    });
    rows.push({
      name: 'Secondary IK reach',
      status: secondaryIk.reachWithinTolerance === true ? 'PASS' : 'FAIL',
      reason: `residual ${String(secondaryIk.reachResidualMeters)} m / tolerance ${String(secondaryIk.reachToleranceMeters)} m; target ${String(secondaryIk.targetDistanceMeters)} m; interval [${String(secondaryIk.minReachMeters)}, ${String(secondaryIk.maxReachMeters)}] m`,
    });
    rows.push({
      name: 'Secondary IK contact',
      status: secondaryIk.contactWithinTolerance === true ? 'PASS' : 'FAIL',
      reason: `post-solve ${String(secondaryIk.postSolveDistanceMeters)} m / tolerance ${String(secondaryIk.contactToleranceMeters)} m`,
    });
    rows.push({
      name: 'Secondary IK angle',
      status: secondaryIk.angleWithinTolerance === true ? 'PASS' : 'FAIL',
      reason: `post-solve ${String(secondaryIk.postSolveAngleDegrees)} deg / tolerance ${String(secondaryIk.angleToleranceDegrees)} deg`,
    });
  } else {
    add('Secondary IK', secondaryIk);
  }
  add('Joint limits', evaluation.diagnostics.jointLimits);
  add('Clipping', evaluation.diagnostics.clipping);
  const pole = isRecord(evaluation.hands.secondary) && isRecord(evaluation.hands.secondary.pole)
    ? evaluation.hands.secondary.pole
    : null;
  if (pole?.world === null) {
    rows.push({
      name: 'Secondary pole world frame',
      status: 'unavailable',
      reason: typeof pole.reason === 'string' ? pole.reason : 'world frame unresolved',
    });
  }
  return rows;
}

export function SpatialRestSchematic({
  evaluation,
  busy,
  error,
  evidenceLabel,
  path,
  revision,
  stale,
  staleReason,
  poseKind = 'rest',
  sampleIdentity,
  sourceRevisions = [],
}: SpatialRestSchematicProps) {
  const titleId = useId();
  const descriptionId = useId();
  const [projection, setProjection] = useState<SpatialRestSchematicProjection>('xy');
  const candidateEvaluation = isSpatialAttachmentEvaluation(evaluation) ? evaluation : null;
  const sampleIdentityMatches = candidateEvaluation?.pose.kind !== 'clip_sample'
    || !sampleIdentity
    || (
      candidateEvaluation.pose.phase === sampleIdentity.phase
      && candidateEvaluation.pose.clip === sampleIdentity.clip
      && candidateEvaluation.pose.normalizedTime === sampleIdentity.normalizedTime
    );
  const safeEvaluation = candidateEvaluation
    && (poseKind !== 'rest' || candidateEvaluation.pose.kind === 'rest')
    && (poseKind !== 'sampled' || candidateEvaluation.pose.kind === 'clip_sample')
    && sampleIdentityMatches
    ? candidateEvaluation
    : null;
  const sampled = poseKind === 'sampled';
  const preIk = Boolean(
    sampled
    && (
      safeEvaluation?.limitations.includes('pre_ik_only')
      || (safeEvaluation?.schemaVersion === 1 && safeEvaluation.attachment.mode === 'two_hand')
    ),
  );
  const projectionDetail = PROJECTIONS.find((entry) => entry.id === projection)?.detail || '';
  const coordinates = useMemo(() => safeEvaluation ? coordinateRows(safeEvaluation) : [], [safeEvaluation]);
  const diagnostics = useMemo(() => safeEvaluation ? diagnosticRows(safeEvaluation) : [], [safeEvaluation]);
  const samplePhase = sampleIdentity?.phase
    || (safeEvaluation?.pose.kind === 'clip_sample' ? safeEvaluation.pose.phase : '');
  const sampleClip = sampleIdentity?.clip
    || (safeEvaluation?.pose.kind === 'clip_sample' ? safeEvaluation.pose.clip : '');
  const sampleTime = sampleIdentity && Number.isFinite(sampleIdentity.normalizedTime)
    ? sampleIdentity.normalizedTime
    : (safeEvaluation?.pose.kind === 'clip_sample' ? safeEvaluation.pose.normalizedTime : Number.NaN);
  const sourceRevisionCount = sampleIdentity?.sourceRevisionCount;
  const title = sampled ? 'SAMPLED RIG SCHEMATIC' : 'REST-POSE RIG SCHEMATIC';
  const hasVisualBox = safeEvaluation?.item.geometry.status === 'available';
  const itemGeometryDescription = hasVisualBox
    ? 'The exact authored visual-box outline is shown; it is not collision geometry or a rendered mesh.'
    : 'Authored visual-box evidence is unavailable.';
  const description = sampled
    ? `${evidenceLabel}. Sampled clip-pose evaluator geometry at phase ${samplePhase || 'unavailable'}, clip ${sampleClip || 'unavailable'}, normalized time ${Number.isFinite(sampleTime) ? String(sampleTime) : 'unavailable'}. ${projectionDetail}. ${itemGeometryDescription} Not review evidence. Not a camera, capture, or immutable review packet.`
    : `${evidenceLabel}. Unsampled rest-pose evaluator geometry. ${projectionDetail}. ${itemGeometryDescription} Not review evidence.`;

  let drawing: ReactNode;
  if (busy && !safeEvaluation) {
    drawing = (
      <p className="spatial-rest-schematic__empty">
        {sampled ? 'Evaluating the exact authored sample...' : 'Evaluating the exact authored revision...'}
      </p>
    );
  } else if (error && !safeEvaluation) {
    drawing = (
      <p className="spatial-rest-schematic__empty">
        {sampled ? 'Sample evaluation failed.' : 'Rest evaluation failed.'}
      </p>
    );
  } else if (!safeEvaluation) {
    drawing = (
      <p className="spatial-rest-schematic__empty">
        {sampled ? 'Sampled rig schematic is unavailable or malformed.' : 'Rest-pose schematic is unavailable or malformed.'}
      </p>
    );
  } else drawing = <Drawing evaluation={safeEvaluation} projection={projection} />;

  return (
    <figure aria-busy={busy} className={`spatial-rest-schematic${stale ? ' is-stale' : ''}`}>
      <div className="spatial-rest-schematic__header">
        <div>
          <strong>{title}</strong>
          <span>{evidenceLabel}</span>
        </div>
        <div className="spatial-rest-schematic__badges" aria-label="Evidence limitations">
          <span>{sampled ? 'SAMPLED' : 'UNSAMPLED'}</span>
          {preIk ? <span>PRE-IK</span> : null}
          <span>NOT REVIEW EVIDENCE</span>
        </div>
      </div>
      <dl className="spatial-rest-schematic__identity">
        <div><dt>Path</dt><dd>{path || 'Unavailable'}</dd></div>
        <div><dt>Revision</dt><dd>{revision || 'Unavailable'}</dd></div>
        {sampled ? (
          <>
            <div><dt>Phase</dt><dd>{samplePhase || 'Unavailable'}</dd></div>
            <div><dt>Clip</dt><dd>{sampleClip || 'Unavailable'}</dd></div>
            <div><dt>Normalized time</dt><dd>{Number.isFinite(sampleTime) ? String(sampleTime) : 'Unavailable'}</dd></div>
            <div><dt>Source revisions</dt><dd>{typeof sourceRevisionCount === 'number' ? String(sourceRevisionCount) : 'Unavailable'}</dd></div>
          </>
        ) : null}
      </dl>
      <div className="spatial-rest-schematic__toolbar">
        <div className="spatial-rest-schematic__projections" role="group" aria-label="Orthographic projection">
          {PROJECTIONS.map((entry) => (
            <button aria-pressed={projection === entry.id} key={entry.id} onClick={() => setProjection(entry.id)} type="button">
              {entry.label}
            </button>
          ))}
        </div>
        <p>{projectionDetail}. Axes and handle arrows are fixed display direction glyphs, not physical extents.</p>
      </div>
      {stale ? <div className="spatial-rest-schematic__stale" role="status">STALE — {staleReason}</div> : null}
      {error ? <div className="spatial-rest-schematic__error" role="alert">{error}</div> : null}
      <div aria-live="polite" className="spatial-rest-schematic__live">
        {busy
          ? (sampled ? 'Sample evaluation in progress.' : 'Rest evaluation in progress.')
          : safeEvaluation
            ? `${evidenceLabel} loaded.`
            : (sampled ? 'Sample evaluation unavailable.' : 'Rest evaluation unavailable.')}
      </div>
      <div aria-describedby={descriptionId} aria-labelledby={titleId} className="spatial-rest-schematic__frame" role="img">
        <span className="spatial-rest-schematic__sr" id={titleId}>{sampled ? 'Sampled rig schematic' : 'Rest-pose rig schematic'}</span>
        <span className="spatial-rest-schematic__sr" id={descriptionId}>{description}</span>
        {drawing}
      </div>
      <figcaption>
        {sampled
          ? `Native evaluator world frames only, including solved sampled hand and bone frames when present. ${hasVisualBox ? 'The outlined item box is exact authored render-procgeo evidence, not collision truth.' : 'No authored item box is available.'} A resolved authored pole is shown as a green ring. No item mesh, joint-limit result, clipping result, camera, capture, or immutable review packet is shown. An unresolved pole is never projected. V1 two-hand samples remain pre-IK.`
          : `Native evaluator world frames only. ${hasVisualBox ? 'The outlined item box is exact authored render-procgeo evidence, not collision truth.' : 'No authored item box is available.'} The item origin and axes plus any resolved authored pole remain explicit. No rendered mesh, sampled animation, IK result, clipping result, camera, capture, or immutable review packet is shown.`}
      </figcaption>
      <ul className="spatial-rest-schematic__legend" aria-label="Schematic legend">
        {LEGEND.map(([label, color]) => <li key={label}><span aria-hidden="true" style={{ background: color }} />{label}</li>)}
      </ul>
      {safeEvaluation ? (
        <div className="spatial-rest-schematic__data">
          <details>
            <summary>Exact evaluator coordinates ({coordinates.length})</summary>
            <div className="spatial-rest-schematic__table-wrap">
              <table>
                <thead><tr><th>Kind</th><th>ID</th><th>World value</th><th>Detail</th></tr></thead>
                <tbody>
                  {coordinates.map((row, index) => (
                    <tr key={`${row.kind}:${row.id}:${index}`}>
                      <th scope="row">{row.kind}</th><td>{row.id}</td><td><code>{formatVector(row.value, row.unit)}</code></td><td>{row.detail || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <details open>
            <summary>Evaluator diagnostics</summary>
            <dl className="spatial-rest-schematic__diagnostics">
              {diagnostics.map((row) => (
                <div key={row.name}><dt>{row.name}</dt><dd><strong>{row.status}</strong> — {row.reason}</dd></div>
              ))}
            </dl>
          </details>
          {sourceRevisions.length ? (
            <details>
              <summary>Exact source revisions ({sourceRevisions.length})</summary>
              <div className="spatial-rest-schematic__table-wrap">
                <table>
                  <thead><tr><th>Authored source</th><th>SHA-256 revision</th></tr></thead>
                  <tbody>
                    {sourceRevisions.map((entry) => (
                      <tr key={entry.path}><th scope="row">{entry.path}</th><td><code>{entry.revision}</code></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </figure>
  );
}
