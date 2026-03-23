#pragma once

#include <filesystem>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace shader_forge::runtime {

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

struct SkeletonDefinitionSnapshot {
  std::string name;
  std::string rootBone;
  int boneCount = 0;
  std::vector<std::string> bones;
  std::filesystem::path sourcePath;
  bool valid = false;
};

struct ClipDefinitionSnapshot {
  std::string name;
  std::string skeletonName;
  double durationSeconds = 0.0;
  bool loop = false;
  double rootMotionMeters = 0.0;
  std::vector<AnimationClipEventSnapshot> events;
  std::filesystem::path sourcePath;
  bool valid = false;
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

  bool hasGraph(std::string_view graphName) const;
  std::optional<std::string> defaultGraphName() const;
  std::vector<SkeletonDefinitionSnapshot> snapshotSkeletons() const;
  std::vector<ClipDefinitionSnapshot> snapshotClips() const;
  std::vector<GraphDefinitionSnapshot> snapshotGraphs() const;
  std::optional<ResolvedAnimationGraphSnapshot> resolveGraph(std::string_view graphName) const;

  std::string foundationSummary() const;
  std::string graphCatalogSummary() const;

private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace shader_forge::runtime
