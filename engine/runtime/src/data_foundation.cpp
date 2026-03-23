#include "shader_forge/runtime/data_foundation.hpp"

#include <algorithm>
#include <cctype>
#include <filesystem>
#include <fstream>
#include <optional>
#include <sstream>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

namespace shader_forge::runtime {

namespace {

std::string trim(std::string_view value) {
  std::size_t start = 0;
  while (start < value.size() && std::isspace(static_cast<unsigned char>(value[start])) != 0) {
    start += 1;
  }

  std::size_t end = value.size();
  while (end > start && std::isspace(static_cast<unsigned char>(value[end - 1])) != 0) {
    end -= 1;
  }

  return std::string(value.substr(start, end - start));
}

std::string stripComment(std::string_view value) {
  bool inString = false;
  for (std::size_t index = 0; index < value.size(); index += 1) {
    const char character = value[index];
    if (character == '"') {
      inString = !inString;
      continue;
    }
    if (!inString && character == '#') {
      return trim(value.substr(0, index));
    }
  }
  return trim(value);
}

std::string normalizeToken(std::string value) {
  std::string normalized;
  normalized.reserve(value.size());
  for (char character : value) {
    if (std::isalnum(static_cast<unsigned char>(character)) != 0) {
      normalized.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(character))));
      continue;
    }
    if (character == '_' || character == '-' || character == '.' || std::isspace(static_cast<unsigned char>(character)) != 0) {
      if (normalized.empty() || normalized.back() == '_') {
        continue;
      }
      normalized.push_back('_');
    }
  }
  if (!normalized.empty() && normalized.back() == '_') {
    normalized.pop_back();
  }
  return normalized;
}

bool parseKeyValue(std::string_view line, std::string* key, std::string* value) {
  const std::size_t separator = line.find('=');
  if (separator == std::string_view::npos) {
    return false;
  }

  *key = normalizeToken(trim(line.substr(0, separator)));
  *value = trim(line.substr(separator + 1));
  return !key->empty();
}

std::string parseStringValue(const std::string& rawValue) {
  if (rawValue.size() >= 2 && rawValue.front() == '"' && rawValue.back() == '"') {
    return rawValue.substr(1, rawValue.size() - 2);
  }
  return rawValue;
}

bool parseIntValue(const std::string& rawValue, int* result) {
  try {
    *result = std::stoi(parseStringValue(rawValue));
    return true;
  } catch (...) {
    return false;
  }
}

std::string lowerString(std::string value) {
  std::transform(
    value.begin(),
    value.end(),
    value.begin(),
    [](unsigned char character) {
      return static_cast<char>(std::tolower(character));
    });
  return value;
}

std::string dataAssetKindName(DataAssetKind kind) {
  switch (kind) {
    case DataAssetKind::scene:
      return "scene";
    case DataAssetKind::prefab:
      return "prefab";
    case DataAssetKind::data:
      return "data";
    case DataAssetKind::effect:
      return "effect";
    default:
      return "data";
  }
}

std::string dataAssetOutputFolder(DataAssetKind kind) {
  switch (kind) {
    case DataAssetKind::scene:
      return "scenes";
    case DataAssetKind::prefab:
      return "prefabs";
    case DataAssetKind::data:
      return "data";
    case DataAssetKind::effect:
      return "effects";
    default:
      return "data";
  }
}

std::string defaultSchemaForKind(DataAssetKind kind) {
  switch (kind) {
    case DataAssetKind::scene:
      return "shader_forge.scene";
    case DataAssetKind::prefab:
      return "shader_forge.prefab";
    case DataAssetKind::data:
      return "shader_forge.data";
    case DataAssetKind::effect:
      return "shader_forge.effect";
    default:
      return "shader_forge.data";
  }
}

std::string relativePathString(const std::filesystem::path& path) {
  std::error_code error;
  const std::filesystem::path currentPath = std::filesystem::current_path(error);
  if (!error) {
    const std::filesystem::path relative = std::filesystem::relative(path, currentPath, error);
    if (!error && !relative.empty()) {
      return relative.generic_string();
    }
  }
  return path.generic_string();
}

struct ParsedAssetFields {
  std::string name;
  std::string schema;
  int schemaVersion = 0;
  std::string runtimeFormat;
  std::string ownerSystem;
  std::string title;
  std::string primaryPrefab;
  std::string spawnTag;
  std::string defaultScene;
  std::string toolingOverlay;
  std::string authoringMode;
  std::string runtimeModel;
  std::string trigger;
  std::string category;
};

struct FoundationManifest {
  std::string foundationName = "Shader Forge Data Foundation";
  std::string sourceFormat = "toml";
  std::string runtimeFormat = "flatbuffer";
  std::string toolingDbBackend = "sqlite";
  std::string toolingDbPath = "tooling/shader_forge.sqlite";
  std::string vfxAuthoringPrimary = "effekseer";
  std::string vfxAuthoringFallback = "simple_descriptor";
  std::string sceneSubdir = "scenes";
  std::string prefabSubdir = "prefabs";
  std::string dataSubdir = "data";
  std::string effectSubdir = "effects";
  std::string cookedRoot = "build/cooked";
  std::string sceneOwner = "scene_system";
  std::string prefabOwner = "scene_system";
  std::string dataOwner = "data_system";
  std::string effectOwner = "vfx_system";
};

bool loadFoundationManifest(const std::filesystem::path& path, FoundationManifest* manifest, std::string* errorMessage) {
  std::ifstream stream(path);
  if (!stream.is_open()) {
    if (errorMessage) {
      *errorMessage = "Could not open data foundation manifest at " + path.string();
    }
    return false;
  }

  std::string line;
  std::size_t lineNumber = 0;
  while (std::getline(stream, line)) {
    lineNumber += 1;
    const std::string cleaned = stripComment(line);
    if (cleaned.empty()) {
      continue;
    }

    std::string key;
    std::string value;
    if (!parseKeyValue(cleaned, &key, &value)) {
      if (errorMessage) {
        *errorMessage = "Invalid data foundation line " + std::to_string(lineNumber) + " in " + path.string();
      }
      return false;
    }

    const std::string parsedValue = parseStringValue(value);
    if (key == "foundation_name") {
      manifest->foundationName = parsedValue;
    } else if (key == "source_format") {
      manifest->sourceFormat = normalizeToken(parsedValue);
    } else if (key == "runtime_format") {
      manifest->runtimeFormat = normalizeToken(parsedValue);
    } else if (key == "tooling_db_backend") {
      manifest->toolingDbBackend = normalizeToken(parsedValue);
    } else if (key == "tooling_db_path") {
      manifest->toolingDbPath = parsedValue;
    } else if (key == "vfx_authoring_primary") {
      manifest->vfxAuthoringPrimary = normalizeToken(parsedValue);
    } else if (key == "vfx_authoring_fallback") {
      manifest->vfxAuthoringFallback = normalizeToken(parsedValue);
    } else if (key == "scene_subdir") {
      manifest->sceneSubdir = parsedValue;
    } else if (key == "prefab_subdir") {
      manifest->prefabSubdir = parsedValue;
    } else if (key == "data_subdir") {
      manifest->dataSubdir = parsedValue;
    } else if (key == "effect_subdir") {
      manifest->effectSubdir = parsedValue;
    } else if (key == "cooked_root") {
      manifest->cookedRoot = parsedValue;
    } else if (key == "scene_owner") {
      manifest->sceneOwner = normalizeToken(parsedValue);
    } else if (key == "prefab_owner") {
      manifest->prefabOwner = normalizeToken(parsedValue);
    } else if (key == "data_owner") {
      manifest->dataOwner = normalizeToken(parsedValue);
    } else if (key == "effect_owner") {
      manifest->effectOwner = normalizeToken(parsedValue);
    }
  }

  return true;
}

bool parseAssetFile(const std::filesystem::path& path, ParsedAssetFields* asset, std::string* errorMessage) {
  std::ifstream stream(path);
  if (!stream.is_open()) {
    if (errorMessage) {
      *errorMessage = "Could not open asset file at " + path.string();
    }
    return false;
  }

  std::string line;
  std::size_t lineNumber = 0;
  while (std::getline(stream, line)) {
    lineNumber += 1;
    const std::string cleaned = stripComment(line);
    if (cleaned.empty() || cleaned.front() == '[') {
      continue;
    }

    std::string key;
    std::string value;
    if (!parseKeyValue(cleaned, &key, &value)) {
      if (errorMessage) {
        *errorMessage = "Invalid asset line " + std::to_string(lineNumber) + " in " + path.string();
      }
      return false;
    }

    const std::string parsedValue = parseStringValue(value);
    if (key == "name") {
      asset->name = normalizeToken(parsedValue);
    } else if (key == "schema") {
      asset->schema = lowerString(parsedValue);
    } else if (key == "schema_version") {
      if (!parseIntValue(value, &asset->schemaVersion)) {
        if (errorMessage) {
          *errorMessage = "Invalid schema_version in " + path.string();
        }
        return false;
      }
    } else if (key == "runtime_format") {
      asset->runtimeFormat = normalizeToken(parsedValue);
    } else if (key == "owner_system") {
      asset->ownerSystem = normalizeToken(parsedValue);
    } else if (key == "title") {
      asset->title = parsedValue;
    } else if (key == "primary_prefab") {
      asset->primaryPrefab = normalizeToken(parsedValue);
    } else if (key == "spawn_tag") {
      asset->spawnTag = normalizeToken(parsedValue);
    } else if (key == "default_scene") {
      asset->defaultScene = normalizeToken(parsedValue);
    } else if (key == "tooling_overlay") {
      asset->toolingOverlay = normalizeToken(parsedValue);
    } else if (key == "authoring_mode") {
      asset->authoringMode = normalizeToken(parsedValue);
    } else if (key == "runtime_model") {
      asset->runtimeModel = normalizeToken(parsedValue);
    } else if (key == "trigger") {
      asset->trigger = normalizeToken(parsedValue);
    } else if (key == "category") {
      asset->category = normalizeToken(parsedValue);
    }
  }

  return true;
}

std::optional<std::string> validateAsset(
  const ParsedAssetFields& asset,
  DataAssetKind kind,
  const FoundationManifest& manifest) {
  if (asset.name.empty()) {
    return "missing name";
  }
  if (asset.schema.empty()) {
    return "missing schema";
  }
  if (asset.schemaVersion <= 0) {
    return "invalid schema_version";
  }
  if (asset.runtimeFormat.empty()) {
    return "missing runtime_format";
  }

  if (asset.schema != defaultSchemaForKind(kind)) {
    return "unexpected schema '" + asset.schema + "'";
  }
  if (asset.runtimeFormat != manifest.runtimeFormat) {
    return "runtime_format must be '" + manifest.runtimeFormat + "'";
  }

  std::string expectedOwner;
  switch (kind) {
    case DataAssetKind::scene:
      expectedOwner = manifest.sceneOwner;
      break;
    case DataAssetKind::prefab:
      expectedOwner = manifest.prefabOwner;
      break;
    case DataAssetKind::data:
      expectedOwner = manifest.dataOwner;
      break;
    case DataAssetKind::effect:
      expectedOwner = manifest.effectOwner;
      break;
    default:
      break;
  }

  if (!expectedOwner.empty() && asset.ownerSystem != expectedOwner) {
    return "owner_system must be '" + expectedOwner + "'";
  }

  if (kind == DataAssetKind::data && asset.name == "runtime_bootstrap") {
    if (asset.defaultScene.empty()) {
      return "runtime_bootstrap is missing default_scene";
    }
    if (!asset.toolingOverlay.empty() && asset.toolingOverlay != "enabled" && asset.toolingOverlay != "disabled") {
      return "tooling_overlay must be 'enabled' or 'disabled'";
    }
  }

  if (kind == DataAssetKind::effect) {
    const bool validAuthoringMode =
      asset.authoringMode == manifest.vfxAuthoringPrimary || asset.authoringMode == manifest.vfxAuthoringFallback;
    if (!validAuthoringMode) {
      return "authoring_mode must be '" + manifest.vfxAuthoringPrimary + "' or '" + manifest.vfxAuthoringFallback + "'";
    }
    if (asset.runtimeModel.empty()) {
      return "missing runtime_model";
    }
  }

  return std::nullopt;
}

}  // namespace

struct DataFoundation::Impl {
  DataFoundationConfig config;
  FoundationManifest manifest;
  std::vector<DataAssetSnapshot> assets;
  std::vector<EffectDescriptorSnapshot> effects;
  std::vector<SceneSourceSnapshot> scenes;
  std::vector<PrefabSourceSnapshot> prefabs;
  std::optional<RuntimeBootstrapSnapshot> bootstrap;
  std::vector<std::string> warnings;

  bool load(const DataFoundationConfig& nextConfig, std::string* errorMessage) {
    config = nextConfig;
    assets.clear();
    effects.clear();
    scenes.clear();
    prefabs.clear();
    bootstrap.reset();
    warnings.clear();
    manifest = FoundationManifest{};

    if (!loadFoundationManifest(config.foundationPath, &manifest, errorMessage)) {
      return false;
    }

    if (manifest.sourceFormat != "toml") {
      if (errorMessage) {
        *errorMessage = "Data foundation source_format must be toml.";
      }
      return false;
    }
    if (manifest.runtimeFormat != "flatbuffer") {
      if (errorMessage) {
        *errorMessage = "Data foundation runtime_format must be flatbuffer.";
      }
      return false;
    }
    if (manifest.toolingDbBackend != "sqlite") {
      if (errorMessage) {
        *errorMessage = "Data foundation tooling_db_backend must be sqlite.";
      }
      return false;
    }

    if (!scanKind(DataAssetKind::scene, manifest.sceneSubdir, errorMessage)) {
      return false;
    }
    if (!scanKind(DataAssetKind::prefab, manifest.prefabSubdir, errorMessage)) {
      return false;
    }
    if (!scanKind(DataAssetKind::data, manifest.dataSubdir, errorMessage)) {
      return false;
    }
    if (!scanKind(DataAssetKind::effect, manifest.effectSubdir, errorMessage)) {
      return false;
    }

    validateRelationships();
    return true;
  }

  bool scanKind(DataAssetKind kind, const std::filesystem::path& subdir, std::string* errorMessage) {
    const std::filesystem::path directory = config.contentRoot / subdir;
    if (!std::filesystem::exists(directory)) {
      if (errorMessage) {
        *errorMessage = "Expected content directory is missing: " + directory.string();
      }
      return false;
    }

    for (const auto& entry : std::filesystem::directory_iterator(directory)) {
      if (!entry.is_regular_file()) {
        continue;
      }
      if (!recordAsset(kind, entry.path(), errorMessage)) {
        return false;
      }
    }

    return true;
  }

  bool recordAsset(DataAssetKind kind, const std::filesystem::path& path, std::string* errorMessage) {
    ParsedAssetFields parsed;
    if (!parseAssetFile(path, &parsed, errorMessage)) {
      return false;
    }

    const std::optional<std::string> validationError = validateAsset(parsed, kind, manifest);
    if (validationError.has_value()) {
      warnings.push_back(relativePathString(path) + ": " + validationError.value());
    }

    DataAssetSnapshot asset;
    asset.kind = kind;
    asset.name = parsed.name;
    asset.schema = parsed.schema;
    asset.schemaVersion = parsed.schemaVersion;
    asset.ownerSystem = parsed.ownerSystem;
    asset.sourcePath = path;
    asset.cookedPath = std::filesystem::path(manifest.cookedRoot) / dataAssetOutputFolder(kind) / (parsed.name + ".bin");
    asset.valid = !validationError.has_value();
    assets.push_back(asset);

    if (kind == DataAssetKind::scene) {
      scenes.push_back(SceneSourceSnapshot{
        .name = parsed.name,
        .title = parsed.title,
        .primaryPrefab = parsed.primaryPrefab,
        .sourcePath = path,
        .cookedPath = asset.cookedPath,
        .valid = asset.valid,
      });
    }

    if (kind == DataAssetKind::prefab) {
      prefabs.push_back(PrefabSourceSnapshot{
        .name = parsed.name,
        .category = parsed.category,
        .spawnTag = parsed.spawnTag,
        .sourcePath = path,
        .cookedPath = asset.cookedPath,
        .valid = asset.valid,
      });
    }

    if (kind == DataAssetKind::data && parsed.name == "runtime_bootstrap") {
      bootstrap = RuntimeBootstrapSnapshot{
        .name = parsed.name,
        .defaultScene = parsed.defaultScene,
        .toolingOverlayEnabled = parsed.toolingOverlay != "disabled",
        .hasToolingOverlayPreference = !parsed.toolingOverlay.empty(),
        .sourcePath = path,
        .valid = asset.valid,
      };
    }

    if (kind == DataAssetKind::effect) {
      effects.push_back(EffectDescriptorSnapshot{
        .name = parsed.name,
        .authoringMode = parsed.authoringMode,
        .runtimeModel = parsed.runtimeModel,
        .trigger = parsed.trigger,
        .category = parsed.category,
        .sourcePath = path,
      });
    }

    return true;
  }

  void validateRelationships() {
    for (auto& scene : scenes) {
      if (!scene.valid || scene.primaryPrefab.empty()) {
        continue;
      }

      if (!hasValidPrefab(scene.primaryPrefab)) {
        scene.valid = false;
        markAssetInvalid(
          DataAssetKind::scene,
          scene.name,
          scene.sourcePath,
          "primary_prefab references missing prefab '" + scene.primaryPrefab + "'");
      }
    }

    if (bootstrap.has_value() && bootstrap->valid && !bootstrap->defaultScene.empty() && !hasValidScene(bootstrap->defaultScene)) {
      bootstrap->valid = false;
      markAssetInvalid(
        DataAssetKind::data,
        bootstrap->name,
        bootstrap->sourcePath,
        "default_scene references missing scene '" + bootstrap->defaultScene + "'");
    }
  }

  bool hasValidScene(std::string_view sceneName) const {
    const std::string normalized = normalizeToken(std::string(sceneName));
    for (const auto& scene : scenes) {
      if (scene.valid && scene.name == normalized) {
        return true;
      }
    }
    return false;
  }

  bool hasValidPrefab(std::string_view prefabName) const {
    const std::string normalized = normalizeToken(std::string(prefabName));
    for (const auto& prefab : prefabs) {
      if (prefab.valid && prefab.name == normalized) {
        return true;
      }
    }
    return false;
  }

  void markAssetInvalid(
    DataAssetKind kind,
    const std::string& name,
    const std::filesystem::path& sourcePath,
    const std::string& reason) {
    for (auto& asset : assets) {
      if (asset.kind == kind && asset.name == name && asset.sourcePath == sourcePath) {
        asset.valid = false;
        break;
      }
    }

    warnings.push_back(relativePathString(sourcePath) + ": " + reason);
  }
};

DataFoundation::DataFoundation()
    : impl_(std::make_unique<Impl>()) {}

DataFoundation::~DataFoundation() = default;

DataFoundation::DataFoundation(DataFoundation&&) noexcept = default;

DataFoundation& DataFoundation::operator=(DataFoundation&&) noexcept = default;

bool DataFoundation::loadFromDisk(const DataFoundationConfig& config, std::string* errorMessage) {
  return impl_->load(config, errorMessage);
}

bool DataFoundation::hasScene(std::string_view sceneName) const {
  return impl_->hasValidScene(sceneName);
}

std::size_t DataFoundation::assetCount() const {
  return impl_->assets.size();
}

std::size_t DataFoundation::invalidAssetCount() const {
  return static_cast<std::size_t>(std::count_if(
    impl_->assets.begin(),
    impl_->assets.end(),
    [](const DataAssetSnapshot& asset) {
      return !asset.valid;
    }));
}

std::vector<DataAssetSnapshot> DataFoundation::snapshotAssets() const {
  return impl_->assets;
}

std::vector<EffectDescriptorSnapshot> DataFoundation::snapshotEffects() const {
  return impl_->effects;
}

std::optional<SceneSourceSnapshot> DataFoundation::sceneSource(std::string_view sceneName) const {
  const std::string normalized = normalizeToken(std::string(sceneName));
  for (const auto& scene : impl_->scenes) {
    if (scene.name == normalized) {
      return scene;
    }
  }
  return std::nullopt;
}

std::optional<PrefabSourceSnapshot> DataFoundation::prefabSource(std::string_view prefabName) const {
  const std::string normalized = normalizeToken(std::string(prefabName));
  for (const auto& prefab : impl_->prefabs) {
    if (prefab.name == normalized) {
      return prefab;
    }
  }
  return std::nullopt;
}

std::optional<RuntimeBootstrapSnapshot> DataFoundation::runtimeBootstrap() const {
  return impl_->bootstrap;
}

std::string DataFoundation::foundationSummary() const {
  std::ostringstream summary;
  summary << "Data foundation: source=" << impl_->manifest.sourceFormat
          << ", cooked=" << impl_->manifest.runtimeFormat
          << ", tooling-db=" << impl_->manifest.toolingDbBackend
          << ", vfx=" << impl_->manifest.vfxAuthoringPrimary << '+' << impl_->manifest.vfxAuthoringFallback
          << ", manifest=" << relativePathString(impl_->config.foundationPath);
  return summary.str();
}

std::string DataFoundation::assetCatalogSummary() const {
  std::size_t sceneCount = 0;
  std::size_t prefabCount = 0;
  std::size_t dataCount = 0;
  std::size_t effectCount = 0;

  for (const auto& asset : impl_->assets) {
    switch (asset.kind) {
      case DataAssetKind::scene:
        sceneCount += 1;
        break;
      case DataAssetKind::prefab:
        prefabCount += 1;
        break;
      case DataAssetKind::data:
        dataCount += 1;
        break;
      case DataAssetKind::effect:
        effectCount += 1;
        break;
      default:
        break;
    }
  }

  std::ostringstream summary;
  summary << "Asset catalog: scenes=" << sceneCount
          << ", prefabs=" << prefabCount
          << ", data=" << dataCount
          << ", effects=" << effectCount
          << ", invalid=" << invalidAssetCount();
  return summary.str();
}

std::string DataFoundation::sceneLookupSummary(std::string_view sceneName) const {
  const std::string normalized = normalizeToken(std::string(sceneName));
  const auto scene = sceneSource(normalized);
  if (scene.has_value()) {
    if (!scene->valid) {
      return "Scene source invalid: " + normalized + " at " + relativePathString(scene->sourcePath);
    }

    std::ostringstream summary;
    summary << "Scene source: " << normalized
            << " -> " << relativePathString(scene->sourcePath)
            << " -> " << relativePathString(scene->cookedPath);
    if (!scene->primaryPrefab.empty()) {
      summary << ", primary_prefab=" << scene->primaryPrefab;
    }
    if (!scene->title.empty()) {
      summary << ", title=\"" << scene->title << '"';
    }
    return summary.str();
  }

  return "Scene source missing: " + normalized + " under " + relativePathString(impl_->config.contentRoot / impl_->manifest.sceneSubdir);
}

std::string DataFoundation::relationshipSummary() const {
  std::ostringstream summary;
  summary << "Content relationships:";

  for (const auto& scene : impl_->scenes) {
    if (!scene.valid) {
      continue;
    }

    summary << "\n- scene " << scene.name;
    if (!scene.primaryPrefab.empty()) {
      summary << " -> prefab " << scene.primaryPrefab;
    }
    if (!scene.title.empty()) {
      summary << " (title=\"" << scene.title << "\")";
    }
  }

  if (impl_->bootstrap.has_value() && impl_->bootstrap->valid) {
    summary << "\n- runtime_bootstrap -> default_scene=" << impl_->bootstrap->defaultScene;
    if (impl_->bootstrap->hasToolingOverlayPreference) {
      summary << ", tooling_overlay=" << (impl_->bootstrap->toolingOverlayEnabled ? "enabled" : "disabled");
    }
  }

  return summary.str();
}

std::string DataFoundation::cookPlanSummary(std::size_t maxAssets) const {
  std::ostringstream summary;
  summary << "Cook plan:";

  std::size_t emitted = 0;
  for (const auto& asset : impl_->assets) {
    if (!asset.valid) {
      continue;
    }
    if (emitted >= maxAssets) {
      break;
    }
    summary << "\n- " << dataAssetKindName(asset.kind)
            << ' ' << asset.name
            << ": " << relativePathString(asset.sourcePath)
            << " -> " << relativePathString(asset.cookedPath);
    emitted += 1;
  }

  if (!impl_->warnings.empty()) {
    for (const auto& warning : impl_->warnings) {
      summary << "\n- warning: " << warning;
    }
  }

  return summary.str();
}

}  // namespace shader_forge::runtime
