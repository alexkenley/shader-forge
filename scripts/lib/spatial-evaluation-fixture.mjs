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
      clipping: { status: 'unavailable', reason: 'item_and_capsule_geometry_not_integrated' },
    },
    limitations: ['rest_pose_only', 'not_review_evidence', 'item_mesh_unavailable'],
  };
}

export function mutateRestEvaluation(attachmentId, mutate) {
  const evaluation = restEvaluation(attachmentId);
  mutate(evaluation);
  return evaluation;
}
