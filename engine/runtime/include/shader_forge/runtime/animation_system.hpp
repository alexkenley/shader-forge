#pragma once

#include <cstdint>
#include <filesystem>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace shader_forge::runtime {

struct SkeletonId {
  std::uint64_t generation = 0;
  std::uint64_t index = 0;
  bool operator==(const SkeletonId&) const = default;
};

struct BoneId {
  std::uint64_t generation = 0;
  std::uint64_t index = 0;
  bool operator==(const BoneId&) const = default;
};

struct SocketId {
  std::uint64_t generation = 0;
  std::uint64_t index = 0;
  bool operator==(const SocketId&) const = default;
};

struct AttachmentProfileId {
  std::uint64_t generation = 0;
  std::uint64_t index = 0;
  bool operator==(const AttachmentProfileId&) const = default;
};

struct AnimationConfig {
  std::filesystem::path rootPath = "animation";
};

struct AnimationClipEventSnapshot {
  std::string name;
  double timeSeconds = 0.0;
  std::string type;
  std::string target;
  bool valid = false;
};

struct SpatialVector3Snapshot {
  double x = 0.0;
  double y = 0.0;
  double z = 0.0;
};

struct SpatialQuaternionSnapshot {
  double x = 0.0;
  double y = 0.0;
  double z = 0.0;
  double w = 1.0;
};

struct SkeletonBoneSnapshot {
  BoneId handle;
  std::string id;
  std::string parent;
  std::string role;
  SpatialVector3Snapshot translation;
  SpatialQuaternionSnapshot rotation;
};

struct SkeletonSocketSnapshot {
  SocketId handle;
  std::string id;
  std::string bone;
  std::string role;
  SpatialVector3Snapshot translation;
  SpatialQuaternionSnapshot rotation;
};

struct SkeletonDefinitionSnapshot {
  SkeletonId handle;
  int schemaVersion = 0;
  std::string id;
  std::string name;
  std::string rootBone;
  int boneCount = 0;
  std::vector<std::string> bones;
  std::vector<SkeletonBoneSnapshot> boneDefinitions;
  std::vector<SkeletonSocketSnapshot> sockets;
  std::filesystem::path sourcePath;
  bool valid = false;
};

struct AttachmentPrimaryGripSnapshot {
  SocketId socketHandle;
  std::string socket;
  std::string space;
  SpatialVector3Snapshot translation;
  SpatialQuaternionSnapshot rotation;
};

struct AttachmentContactFrameSnapshot {
  SpatialVector3Snapshot translation;
  SpatialQuaternionSnapshot rotation;
};

struct AttachmentHandleAxisSnapshot {
  SpatialVector3Snapshot origin;
  SpatialVector3Snapshot direction;
};

struct AttachmentSecondaryHandSnapshot {
  bool enabled = false;
  SpatialVector3Snapshot targetTranslation;
  SpatialQuaternionSnapshot targetRotation;
  SpatialVector3Snapshot poleTranslation;
  double reachMeters = 0.0;
  double angleDegrees = 0.0;
  double contactMeters = 0.0;
  std::string jointLimitPolicy;
};

struct AttachmentMotionEnvelopeSnapshot {
  std::string phase;
  std::string clip;
  std::vector<double> normalizedTimes;
  std::vector<std::string> proceduralLayers;
};

struct AttachmentProfileSnapshot {
  AttachmentProfileId handle;
  SkeletonId skeletonHandle;
  int schemaVersion = 0;
  std::string id;
  std::string name;
  std::string skeletonId;
  std::string itemPrefab;
  std::string dominantHand;
  std::string mode;
  std::string perspective;
  AttachmentPrimaryGripSnapshot primaryGrip;
  std::optional<AttachmentContactFrameSnapshot> primaryContact;
  std::optional<AttachmentHandleAxisSnapshot> handleAxis;
  std::optional<AttachmentSecondaryHandSnapshot> secondaryHand;
  std::vector<AttachmentMotionEnvelopeSnapshot> motionEnvelopes;
  std::filesystem::path sourcePath;
  bool valid = false;
};

struct SpatialAxesSnapshot {
  SpatialVector3Snapshot x{1.0, 0.0, 0.0};
  SpatialVector3Snapshot y{0.0, 1.0, 0.0};
  SpatialVector3Snapshot z{0.0, 0.0, 1.0};
};

struct SpatialTransformSnapshot {
  SpatialVector3Snapshot translation;
  SpatialQuaternionSnapshot rotation;
  SpatialAxesSnapshot axes;
};

struct EvaluatedBonePoseSnapshot {
  std::string id;
  std::string parent;
  std::string role;
  SpatialTransformSnapshot local;
  SpatialTransformSnapshot world;
};

struct EvaluatedBoneSegmentSnapshot {
  std::string parent;
  std::string child;
  SpatialVector3Snapshot from;
  SpatialVector3Snapshot to;
};

struct EvaluatedSocketPoseSnapshot {
  std::string id;
  std::string bone;
  std::string role;
  SpatialTransformSnapshot local;
  SpatialTransformSnapshot world;
};

struct EvaluatedHandFrameSnapshot {
  std::string bone;
  std::string role;
  SpatialTransformSnapshot world;
  std::optional<SpatialTransformSnapshot> palmWorld;
};

struct EvaluatedSecondaryHandFrameSnapshot {
  bool enabled = false;
  std::string bone;
  std::string role;
  SpatialTransformSnapshot world;
  std::optional<SpatialTransformSnapshot> palmWorld;
  std::optional<SpatialTransformSnapshot> targetWorld;
  std::optional<SpatialVector3Snapshot> poleTranslation;
  std::optional<double> preSolveDistanceMeters;
};

struct SpatialAttachmentEvaluationSnapshot {
  std::string skeletonId;
  std::string skeletonName;
  std::string rootBone;
  std::string attachmentId;
  std::string attachmentName;
  std::string itemPrefabId;
  std::string dominantHand;
  std::string mode;
  std::string perspective;
  std::string primaryGripSocket;
  std::vector<EvaluatedBonePoseSnapshot> bones;
  std::vector<EvaluatedBoneSegmentSnapshot> segments;
  std::vector<EvaluatedSocketPoseSnapshot> sockets;
  SpatialTransformSnapshot itemWorld;
  std::optional<SpatialTransformSnapshot> primaryContactWorld;
  std::optional<AttachmentHandleAxisSnapshot> handleAxisWorld;
  std::optional<EvaluatedHandFrameSnapshot> dominantHandFrame;
  std::optional<EvaluatedSecondaryHandFrameSnapshot> secondaryHandFrame;
};

struct SpatialSampledAttachmentEvaluationSnapshot {
  SpatialAttachmentEvaluationSnapshot evaluation;
  std::string phase;
  std::string clipName;
  double normalizedTime = 0.0;
  std::vector<std::string> proceduralLayersRequested;
  std::vector<std::string> proceduralLayersApplied;
  std::vector<std::string> proceduralLayersUnavailable;
};

struct ClipKeyframeSnapshot {
  double normalizedTime = 0.0;
  SpatialVector3Snapshot translation;
  SpatialQuaternionSnapshot rotation;
};

struct ClipTrackSnapshot {
  std::string bone;
  std::vector<ClipKeyframeSnapshot> keys;
};

struct ClipDefinitionSnapshot {
  std::string name;
  std::string skeletonName;
  int schemaVersion = 0;
  double durationSeconds = 0.0;
  bool loop = false;
  double rootMotionMeters = 0.0;
  std::vector<AnimationClipEventSnapshot> events;
  std::vector<ClipTrackSnapshot> tracks;
  std::filesystem::path sourcePath;
  bool valid = false;
};

struct SampledClipPoseSnapshot {
  std::string clipName;
  std::string skeletonName;
  double normalizedTime = 0.0;
  std::vector<EvaluatedBonePoseSnapshot> bones;
};

struct AnimationGraphParameterSnapshot {
  std::string name;
  std::string type;
  double defaultFloatValue = 0.0;
  bool valid = false;
};

struct AnimationGraphStateSnapshot {
  std::string name;
  std::string clip;
  double speed = 1.0;
  bool loop = false;
  bool valid = false;
};

struct GraphDefinitionSnapshot {
  std::string name;
  std::string skeletonName;
  std::string entryState;
  std::vector<AnimationGraphParameterSnapshot> parameters;
  std::vector<AnimationGraphStateSnapshot> states;
  std::filesystem::path sourcePath;
  bool valid = false;
};

struct ResolvedAnimationGraphSnapshot {
  std::string graphName;
  std::string skeletonName;
  std::string entryState;
  std::string entryClipName;
  std::vector<std::string> stateNames;
  std::vector<std::string> clipNames;
  std::vector<AnimationClipEventSnapshot> entryClipEvents;
};

struct ResolvedAnimationStateSnapshot {
  std::string graphName;
  std::string stateName;
  std::string skeletonName;
  std::string clipName;
  double speed = 1.0;
  bool loop = false;
  double durationSeconds = 0.0;
  double rootMotionMeters = 0.0;
  std::vector<AnimationClipEventSnapshot> clipEvents;
};

class AnimationSystem {
public:
  AnimationSystem();
  ~AnimationSystem();

  AnimationSystem(AnimationSystem&&) noexcept;
  AnimationSystem& operator=(AnimationSystem&&) noexcept;

  AnimationSystem(const AnimationSystem&) = delete;
  AnimationSystem& operator=(const AnimationSystem&) = delete;

  bool loadFromDisk(const AnimationConfig& config, std::string* errorMessage = nullptr);

  std::size_t skeletonCount() const;
  std::size_t clipCount() const;
  std::size_t graphCount() const;
  std::size_t attachmentProfileCount() const;

  bool hasGraph(std::string_view graphName) const;
  std::optional<std::string> defaultGraphName() const;
  std::vector<SkeletonDefinitionSnapshot> snapshotSkeletons() const;
  std::vector<ClipDefinitionSnapshot> snapshotClips() const;
  std::vector<GraphDefinitionSnapshot> snapshotGraphs() const;
  std::vector<AttachmentProfileSnapshot> snapshotAttachmentProfiles() const;
  std::optional<SkeletonId> findSkeletonId(std::string_view id) const;
  std::optional<AttachmentProfileId> findAttachmentProfileId(std::string_view id) const;
  std::optional<SkeletonDefinitionSnapshot> snapshotSkeleton(SkeletonId id) const;
  std::optional<AttachmentProfileSnapshot> snapshotAttachmentProfile(AttachmentProfileId id) const;
  std::optional<SkeletonDefinitionSnapshot> findSkeleton(std::string_view idOrName) const;
  std::optional<AttachmentProfileSnapshot> findAttachmentProfile(std::string_view id) const;
  std::optional<ResolvedAnimationGraphSnapshot> resolveGraph(std::string_view graphName) const;
  std::optional<ResolvedAnimationStateSnapshot> resolveGraphState(
    std::string_view graphName,
    std::string_view stateName) const;
  std::optional<SpatialAttachmentEvaluationSnapshot> evaluateRestAttachment(
    AttachmentProfileId id,
    std::string* errorMessage = nullptr) const;
  std::optional<SpatialSampledAttachmentEvaluationSnapshot> evaluateSampledAttachment(
    AttachmentProfileId id,
    std::string_view phase,
    double normalizedTime,
    std::string* errorMessage = nullptr) const;
  std::optional<SampledClipPoseSnapshot> sampleClipPose(
    std::string_view clipName,
    double normalizedTime,
    std::string* errorMessage = nullptr) const;

  std::string foundationSummary() const;
  std::string graphCatalogSummary() const;

private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace shader_forge::runtime
