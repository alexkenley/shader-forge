function identityTransform() {
  return {
    translation: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    axes: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
  };
}

export function unavailableJointLimits(reason = 'no_joint_limits_authored') {
  return {
    status: 'unavailable',
    reason,
    policy: 'diagnose',
    evaluatedBoneCount: 0,
    violationCount: 0,
    maxViolationDegrees: 0,
    withinLimits: null,
    bones: [],
  };
}

export function jointLimitBone(boneId, overrides = {}) {
  return {
    boneId,
    role: boneId,
    swingDegrees: 0,
    swingLimitDegrees: 70,
    twistDegrees: 0,
    twistMinDegrees: -80,
    twistMaxDegrees: 80,
    swingViolationDegrees: 0,
    twistViolationDegrees: 0,
    withinLimits: true,
    ...overrides,
  };
}

export function availableJointLimits(bones) {
  const violationCount = bones.filter((bone) => bone.withinLimits === false).length;
  const maxViolationDegrees = bones.reduce(
    (current, bone) => Math.max(current, bone.swingViolationDegrees, bone.twistViolationDegrees),
    0,
  );
  return {
    status: 'available',
    reason: null,
    policy: 'diagnose',
    evaluatedBoneCount: bones.length,
    violationCount,
    maxViolationDegrees,
    withinLimits: violationCount === 0,
    bones,
  };
}

export function unavailableClipping(reason = 'item_prefab_not_found') {
  return {
    status: 'unavailable',
    reason,
    policy: 'diagnose',
    metric: 'capsule_axis_to_oriented_box_clearance',
    evaluatedCapsuleCount: 0,
    overlapCount: 0,
    maxClearanceViolationMeters: 0,
    hasOverlap: null,
    itemBox: null,
    capsules: [],
  };
}

export function authoredCollisionBox(overrides = {}) {
  return {
    kind: 'authored_collision_box',
    prefabId: 'test.item',
    world: identityTransform(),
    dimensionsMeters: [2, 2, 2],
    worldCorners: [
      [-1, -1, -1],
      [1, -1, -1],
      [1, 1, -1],
      [-1, 1, -1],
      [-1, -1, 1],
      [1, -1, 1],
      [1, 1, 1],
      [-1, 1, 1],
    ],
    ...overrides,
  };
}

export function clippingCapsule(overrides = {}) {
  return {
    boneId: 'hand_r',
    role: 'hand_r',
    centerWorld: [2, 0, 0],
    axisWorld: [0, 1, 0],
    radiusMeters: 0.5,
    halfLengthMeters: 0.25,
    segmentStartWorld: [2, -0.25, 0],
    segmentEndWorld: [2, 0.25, 0],
    axisDistanceToBoxMeters: 1,
    surfaceClearanceMeters: 0.5,
    clearanceViolationMeters: 0,
    overlapping: false,
    ...overrides,
  };
}

export function availableClipping(
  capsules = [clippingCapsule()],
  itemBox = authoredCollisionBox(),
) {
  const overlapCount = capsules.filter((capsule) => capsule.overlapping).length;
  return {
    status: 'available',
    reason: null,
    policy: 'diagnose',
    metric: 'capsule_axis_to_oriented_box_clearance',
    evaluatedCapsuleCount: capsules.length,
    overlapCount,
    maxClearanceViolationMeters: capsules.reduce(
      (current, capsule) => Math.max(current, capsule.clearanceViolationMeters),
      0,
    ),
    hasOverlap: overlapCount > 0,
    itemBox,
    capsules,
  };
}

export function restEvaluation(attachmentId) {
  return {
    schema: 'shader_forge.spatial_attachment_evaluation',
    schemaVersion: 1,
    pose: { kind: 'rest', sampled: false },
    coordinateSystem: {
      units: 'meters', handedness: 'right', up: '+Y', forward: '+Z', quaternionOrder: 'xyzw',
    },
    skeleton: { id: 'test.skeleton', name: 'test', rootBone: 'hand_r' },
    attachment: {
      id: attachmentId,
      name: 'Test Attachment',
      itemPrefabId: 'test.item',
      dominantHand: 'right',
      mode: 'one_hand',
      perspective: 'third_person',
      primaryGripSocket: 'socket.hand_r.primary',
    },
    bones: [{
      id: 'hand_r', parent: '', role: 'hand_r', local: identityTransform(), world: identityTransform(),
    }],
    segments: [],
    sockets: [{
      id: 'socket.hand_r.primary',
      boneId: 'hand_r',
      role: 'primary_grip',
      local: identityTransform(),
      world: identityTransform(),
    }],
    item: {
      prefabId: 'test.item',
      world: identityTransform(),
      geometry: { status: 'unavailable', reason: 'item_prefab_not_found' },
      primaryContactWorld: null,
      handleAxisWorld: { origin: [0, 0, 0], direction: [0, 0, 1] },
    },
    hands: {
      dominant: {
        boneId: 'hand_r', role: 'hand_r', world: identityTransform(), palmWorld: null,
      },
      secondary: null,
    },
    diagnostics: {
      secondaryIk: { status: 'not_applicable', reason: 'one_hand_attachment' },
      jointLimits: unavailableJointLimits(),
      clipping: unavailableClipping(),
    },
    limitations: ['rest_pose_only', 'not_review_evidence', 'item_mesh_unavailable'],
  };
}

export function mutateRestEvaluation(attachmentId, mutate) {
  const evaluation = restEvaluation(attachmentId);
  mutate(evaluation);
  return evaluation;
}
