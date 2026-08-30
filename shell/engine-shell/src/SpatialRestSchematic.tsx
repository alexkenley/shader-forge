import { useId, useMemo, useState, type ReactNode } from 'react';
import type {
  SpatialAttachmentEvaluation,
  SpatialEvaluationVec3,
} from './lib/sessiond';

export type SpatialRestSchematicProjection = 'xy' | 'zy' | 'xz';

type SpatialRestSchematicProps = {
  evaluation: SpatialAttachmentEvaluation | null;
  busy: boolean;
  error: string;
  evidenceLabel: string;
  path: string;
  revision: string;
  stale: boolean;
  staleReason: string;
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
} as const;

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

function validPole(value: unknown, schemaVersion: unknown, budget: ValidationBudget) {
  if (!exactRecord(value, ['translation', 'space', 'world', 'reason'])
      || !isSpatialEvaluationVec3(value.translation)) return false;
  if (schemaVersion === 1) {
    return value.space === 'unresolved'
      && value.world === null
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
  if (
    value.schema !== 'shader_forge.spatial_attachment_evaluation'
    || (value.schemaVersion !== 1 && value.schemaVersion !== 2)
    || !exactRecord(value.pose, ['kind', 'sampled'])
    || value.pose.kind !== 'rest'
    || value.pose.sampled !== false
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
    || !validTransform(value.item.world)
    || !validDiagnostic(value.item.geometry, budget, ['unavailable'])
    || !(value.item.primaryContactWorld === null || validTransform(value.item.primaryContactWorld))
    || !(value.item.handleAxisWorld === null || (
      exactRecord(value.item.handleAxisWorld, ['origin', 'direction'])
      && isSpatialEvaluationVec3(value.item.handleAxisWorld.origin)
      && unitVector(value.item.handleAxisWorld.direction)
    ))
  ) return false;
  if (!exactRecord(value.hands, ['dominant', 'secondary'])) return false;
  if (value.hands.dominant !== null && !(
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
    || !validDiagnostic(value.diagnostics.secondaryIk, budget)
    || !validDiagnostic(value.diagnostics.jointLimits, budget)
    || !validDiagnostic(value.diagnostics.clipping, budget)
    || !Array.isArray(value.limitations)
    || value.limitations.length > SPATIAL_EVALUATION_LIMITS.maxLimitations
    || !value.limitations.every((entry) => boundedString(entry, budget))
  ) return false;
  const coordinateRowCount = value.bones.length
    + value.segments.length * 2
    + value.sockets.length
    + 4
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
  add('Item geometry', evaluation.item.geometry);
  add('Secondary IK', evaluation.diagnostics.secondaryIk);
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
}: SpatialRestSchematicProps) {
  const titleId = useId();
  const descriptionId = useId();
  const [projection, setProjection] = useState<SpatialRestSchematicProjection>('xy');
  const safeEvaluation = isSpatialAttachmentEvaluation(evaluation) ? evaluation : null;
  const projectionDetail = PROJECTIONS.find((entry) => entry.id === projection)?.detail || '';
  const coordinates = useMemo(() => safeEvaluation ? coordinateRows(safeEvaluation) : [], [safeEvaluation]);
  const diagnostics = useMemo(() => safeEvaluation ? diagnosticRows(safeEvaluation) : [], [safeEvaluation]);
  const description = `${evidenceLabel}. Unsampled rest-pose evaluator geometry. ${projectionDetail}. Not review evidence. Item geometry is unavailable.`;

  let drawing: ReactNode;
  if (busy && !safeEvaluation) drawing = <p className="spatial-rest-schematic__empty">Evaluating the exact authored revision...</p>;
  else if (error && !safeEvaluation) drawing = <p className="spatial-rest-schematic__empty">Rest evaluation failed.</p>;
  else if (!safeEvaluation) drawing = <p className="spatial-rest-schematic__empty">Rest-pose schematic is unavailable or malformed.</p>;
  else drawing = <Drawing evaluation={safeEvaluation} projection={projection} />;

  return (
    <figure aria-busy={busy} className={`spatial-rest-schematic${stale ? ' is-stale' : ''}`}>
      <div className="spatial-rest-schematic__header">
        <div>
          <strong>REST-POSE RIG SCHEMATIC</strong>
          <span>{evidenceLabel}</span>
        </div>
        <div className="spatial-rest-schematic__badges" aria-label="Evidence limitations">
          <span>UNSAMPLED</span>
          <span>NOT REVIEW EVIDENCE</span>
        </div>
      </div>
      <dl className="spatial-rest-schematic__identity">
        <div><dt>Path</dt><dd>{path || 'Unavailable'}</dd></div>
        <div><dt>Revision</dt><dd>{revision || 'Unavailable'}</dd></div>
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
        {busy ? 'Rest evaluation in progress.' : safeEvaluation ? `${evidenceLabel} loaded.` : 'Rest evaluation unavailable.'}
      </div>
      <div aria-describedby={descriptionId} aria-labelledby={titleId} className="spatial-rest-schematic__frame" role="img">
        <span className="spatial-rest-schematic__sr" id={titleId}>Rest-pose rig schematic</span>
        <span className="spatial-rest-schematic__sr" id={descriptionId}>{description}</span>
        {drawing}
      </div>
      <figcaption>
        Native evaluator world frames only. The item marker is an origin with orientation axes; a resolved authored pole is shown as a green ring. No mesh, bounds, sampled animation, IK result, clipping result, camera, or capture is shown. An unresolved pole is never projected.
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
        </div>
      ) : null}
    </figure>
  );
}
