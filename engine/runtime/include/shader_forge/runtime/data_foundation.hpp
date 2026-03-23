#pragma once

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

struct SceneSourceSnapshot {
  std::string name;
  std::string title;
  std::string primaryPrefab;
  std::filesystem::path sourcePath;
  std::filesystem::path cookedPath;
  bool valid = false;
};

struct PrefabSourceSnapshot {
  std::string name;
  std::string category;
  std::string spawnTag;
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
  std::optional<SceneSourceSnapshot> sceneSource(std::string_view sceneName) const;
  std::optional<PrefabSourceSnapshot> prefabSource(std::string_view prefabName) const;
  std::optional<RuntimeBootstrapSnapshot> runtimeBootstrap() const;

  std::string foundationSummary() const;
  std::string assetCatalogSummary() const;
  std::string sceneLookupSummary(std::string_view sceneName) const;
  std::string relationshipSummary() const;
  std::string cookPlanSummary(std::size_t maxAssets = 6) const;

private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace shader_forge::runtime
