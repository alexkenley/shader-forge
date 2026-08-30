function identityTransform() {
  return {
    translation: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    axes: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] },
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
      jointLimits: { status: 'unavailable', reason: 'joint_limit_evaluation_not_integrated' },
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
