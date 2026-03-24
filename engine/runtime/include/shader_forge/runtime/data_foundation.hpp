#pragma once

#include <array>
#include <cstddef>
#include <filesystem>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace shader_forge::runtime {

enum class DataAssetKind {
  scene,
  prefab,
  data,
  effect,
  procgeo,
};

struct DataFoundationConfig {
  std::filesystem::path contentRoot = "content";
  std::filesystem::path foundationPath = "data/foundation/engine-data-layout.toml";
};

struct DataAssetSnapshot {
  DataAssetKind kind = DataAssetKind::data;
  std::string name;
  std::string schema;
  int schemaVersion = 0;
  std::string ownerSystem;
  std::filesystem::path sourcePath;
  std::filesystem::path cookedPath;
  bool valid = false;
};

struct EffectDescriptorSnapshot {
  std::string name;
  std::string authoringMode;
  std::string runtimeModel;
  std::string trigger;
  std::string category;
  std::filesystem::path sourcePath;
};

struct SceneEntitySnapshot {
  std::string id;
  std::string displayName;
  std::string sourcePrefab;
  std::string parent;
  std::array<float, 3> position{0.0F, 0.0F, 0.0F};
  std::array<float, 3> rotation{0.0F, 0.0F, 0.0F};
  std::array<float, 3> scale{1.0F, 1.0F, 1.0F};
};

struct SceneSourceSnapshot {
  std::string name;
  std::string title;
  std::string primaryPrefab;
  std::vector<SceneEntitySnapshot> entities;
  std::filesystem::path sourcePath;
  std::filesystem::path cookedPath;
  bool valid = false;
};

struct PrefabRenderComponentSnapshot {
  std::string procgeo;
  std::string materialHint;
};

struct PrefabEffectComponentSnapshot {
  std::string effect;
  std::string trigger;
};

struct PrefabSourceSnapshot {
  std::string name;
  std::string category;
  std::string spawnTag;
  PrefabRenderComponentSnapshot renderComponent;
  PrefabEffectComponentSnapshot effectComponent;
  std::filesystem::path sourcePath;
  std::filesystem::path cookedPath;
  bool valid = false;
};

struct ComposedSceneEntitySnapshot {
  std::string id;
  std::string displayName;
  std::string prefabName;
  std::string prefabCategory;
  std::string spawnTag;
  std::string parent;
  std::vector<std::string> children;
  std::array<float, 3> localPosition{0.0F, 0.0F, 0.0F};
  std::array<float, 3> localRotation{0.0F, 0.0F, 0.0F};
  std::array<float, 3> localScale{1.0F, 1.0F, 1.0F};
  std::array<float, 3> worldPosition{0.0F, 0.0F, 0.0F};
  std::array<float, 3> worldRotation{0.0F, 0.0F, 0.0F};
  std::array<float, 3> worldScale{1.0F, 1.0F, 1.0F};
  bool hasRenderComponent = false;
  std::string renderProcgeo;
  std::string renderMaterialHint;
  bool hasEffectComponent = false;
  std::string effectName;
  std::string effectTrigger;
};

struct ComposedSceneSnapshot {
  std::string name;
  std::string title;
  std::string primaryPrefab;
  std::vector<ComposedSceneEntitySnapshot> entities;
  std::vector<std::string> rootEntities;
  std::vector<std::string> prefabNames;
  std::string preferredPlayerEntity;
  std::filesystem::path sourcePath;
  std::filesystem::path cookedPath;
  bool valid = false;
};

struct RuntimeBootstrapSnapshot {
  std::string name;
  std::string defaultScene;
  bool toolingOverlayEnabled = false;
  bool hasToolingOverlayPreference = false;
  std::filesystem::path sourcePath;
  bool valid = false;
};

struct ProcgeoSourceSnapshot {
  std::string name;
  std::string generator;
  std::string bakeOutput;
  std::string materialHint;
  float width = 1.0F;
  float height = 1.0F;
  float depth = 1.0F;
  int rows = 1;
  int columns = 1;
  std::filesystem::path sourcePath;
  std::filesystem::path cookedPath;
  bool valid = false;
};

class DataFoundation {
public:
  DataFoundation();
  ~DataFoundation();

  DataFoundation(DataFoundation&&) noexcept;
  DataFoundation& operator=(DataFoundation&&) noexcept;

  DataFoundation(const DataFoundation&) = delete;
  DataFoundation& operator=(const DataFoundation&) = delete;

  bool loadFromDisk(const DataFoundationConfig& config, std::string* errorMessage = nullptr);

  bool hasScene(std::string_view sceneName) const;
  std::size_t assetCount() const;
  std::size_t invalidAssetCount() const;

  std::vector<DataAssetSnapshot> snapshotAssets() const;
  std::vector<EffectDescriptorSnapshot> snapshotEffects() const;
  std::vector<ProcgeoSourceSnapshot> snapshotProcgeoSources() const;
  std::optional<ProcgeoSourceSnapshot> procgeoSource(std::string_view procgeoName) const;
  std::optional<SceneSourceSnapshot> sceneSource(std::string_view sceneName) const;
  std::optional<PrefabSourceSnapshot> prefabSource(std::string_view prefabName) const;
  std::optional<ComposedSceneSnapshot> composeScene(std::string_view sceneName) const;
  std::optional<RuntimeBootstrapSnapshot> runtimeBootstrap() const;

  std::string foundationSummary() const;
  std::string assetCatalogSummary() const;
  std::string sceneLookupSummary(std::string_view sceneName) const;
  std::string sceneEntitySummary(std::string_view sceneName) const;
  std::string scenePrefabComponentSummary(std::string_view sceneName) const;
  std::string composedSceneSummary(std::string_view sceneName) const;
  std::string relationshipSummary() const;
  std::string cookPlanSummary(std::size_t maxAssets = 6) const;

private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace shader_forge::runtime
