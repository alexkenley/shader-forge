#include "shader_forge/runtime/data_foundation.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <filesystem>
#include <functional>
#include <fstream>
#include <limits>
#include <optional>
#include <sstream>
#include <string>
#include <string_view>
#include <unordered_map>
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

bool parseCompleteFiniteFloat(std::string_view token, float* result);

bool parseIntValue(const std::string& rawValue, int* result) {
  const std::string text = trim(rawValue);
  if (text.empty()) {
    return false;
  }

  std::size_t consumed = 0;
  try {
    const int parsed = std::stoi(text, &consumed, 10);
    if (consumed != text.size()) {
      return false;
    }
    *result = parsed;
    return true;
  } catch (...) {
    return false;
  }
}

bool parseFloatValue(const std::string& rawValue, float* result) {
  return parseCompleteFiniteFloat(rawValue, result);
}

bool parseVector3Value(const std::string& rawValue, std::array<float, 3>* result) {
  const std::string value = trim(rawValue);
  if (value.size() < 2 || value.front() != '"' || value.back() != '"') {
    return false;
  }
  std::istringstream parts(value.substr(1, value.size() - 2));
  std::string token;
  std::array<float, 3> parsed{0.0F, 0.0F, 0.0F};
  std::size_t index = 0;

  while (std::getline(parts, token, ',')) {
    if (index >= parsed.size()) {
      return false;
    }

    if (!parseCompleteFiniteFloat(token, &parsed[index])) {
      return false;
    }
    index += 1;
  }

  if (index != parsed.size()) {
    return false;
  }

  *result = parsed;
  return true;
}

bool parseCompleteFiniteFloat(std::string_view token, float* result) {
  const std::string text = trim(token);
  if (text.empty()) {
    return false;
  }
  std::size_t prefixOffset = (text.front() == '+' || text.front() == '-') ? 1 : 0;
  if (prefixOffset + 1 < text.size() && text[prefixOffset] == '0') {
    const char radixMarker = static_cast<char>(std::tolower(static_cast<unsigned char>(text[prefixOffset + 1])));
    if (radixMarker == 'x' || radixMarker == 'b' || radixMarker == 'o') {
      return false;
    }
  }

  std::size_t consumed = 0;
  try {
    const float parsed = std::stof(text, &consumed);
    if (consumed != text.size() || !std::isfinite(parsed)
        || (parsed != 0.0F && std::abs(parsed) < std::numeric_limits<float>::min())) {
      return false;
    }
    *result = parsed;
    return true;
  } catch (...) {
    return false;
  }
}

template <std::size_t N>
bool parseFiniteFloatArray(const std::string& rawValue, std::array<float, N>* result) {
  const std::string raw = trim(rawValue);
  if (raw.size() < 2 || raw.front() != '[' || raw.back() != ']') {
    return false;
  }

  const std::string body = trim(std::string_view(raw).substr(1, raw.size() - 2));
  if (body.empty()) {
    return false;
  }

  std::array<float, N> parsed{};
  std::size_t start = 0;
  std::size_t index = 0;
  while (start <= body.size()) {
    if (index >= N) {
      return false;
    }

    const std::size_t comma = body.find(',', start);
    const std::string token = trim(std::string_view(body).substr(
      start,
      comma == std::string::npos ? body.size() - start : comma - start));
    if (!parseCompleteFiniteFloat(token, &parsed[index])) {
      return false;
    }
    index += 1;

    if (comma == std::string::npos) {
      break;
    }
    start = comma + 1;
    if (start >= body.size()) {
      return false;
    }
  }

  if (index != N) {
    return false;
  }

  *result = parsed;
  return true;
}

bool isUnitLengthQuaternion(const std::array<float, 4>& rotation) {
  const double x = static_cast<double>(rotation[0]);
  const double y = static_cast<double>(rotation[1]);
  const double z = static_cast<double>(rotation[2]);
  const double w = static_cast<double>(rotation[3]);
  const double length = std::sqrt(x * x + y * y + z * z + w * w);
  return std::isfinite(length) && std::abs(length - 1.0) <= 1e-6;
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
    case DataAssetKind::procgeo:
      return "procgeo";
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
    case DataAssetKind::procgeo:
      return "procgeo";
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
    case DataAssetKind::procgeo:
      return "shader_forge.procgeo";
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

std::string vector3String(const std::array<float, 3>& value) {
  std::ostringstream stream;
  stream << value[0] << ", " << value[1] << ", " << value[2];
  return stream.str();
}

std::array<float, 3> addVector3(const std::array<float, 3>& left, const std::array<float, 3>& right) {
  return {
    left[0] + right[0],
    left[1] + right[1],
    left[2] + right[2],
  };
}

std::array<float, 3> multiplyVector3(const std::array<float, 3>& left, const std::array<float, 3>& right) {
  return {
    left[0] * right[0],
    left[1] * right[1],
    left[2] * right[2],
  };
}

using RotationMatrix = std::array<std::array<double, 3>, 3>;

RotationMatrix rotationMatrixFromEulerDegrees(const std::array<float, 3>& rotation) {
  constexpr double kDegreesToRadians = 3.14159265358979323846 / 180.0;
  const double pitch = static_cast<double>(rotation[0]) * kDegreesToRadians;
  const double yaw = static_cast<double>(rotation[1]) * kDegreesToRadians;
  const double roll = static_cast<double>(rotation[2]) * kDegreesToRadians;
  const double cx = std::cos(pitch);
  const double sx = std::sin(pitch);
  const double cy = std::cos(yaw);
  const double sy = std::sin(yaw);
  const double cz = std::cos(roll);
  const double sz = std::sin(roll);
  return {{
    {{cy * cz + sy * sx * sz, -cy * sz + sy * sx * cz, sy * cx}},
    {{cx * sz, cx * cz, -sx}},
    {{-sy * cz + cy * sx * sz, sy * sz + cy * sx * cz, cy * cx}},
  }};
}

RotationMatrix multiplyRotationMatrices(const RotationMatrix& left, const RotationMatrix& right) {
  RotationMatrix result{};
  for (std::size_t row = 0; row < 3; row += 1) {
    for (std::size_t column = 0; column < 3; column += 1) {
      for (std::size_t index = 0; index < 3; index += 1) {
        result[row][column] += left[row][index] * right[index][column];
      }
    }
  }
  return result;
}

std::array<float, 3> rotateVector3(const RotationMatrix& rotation, const std::array<float, 3>& value) {
  std::array<float, 3> result{};
  for (std::size_t row = 0; row < 3; row += 1) {
    double component = 0.0;
    for (std::size_t column = 0; column < 3; column += 1) {
      component += rotation[row][column] * static_cast<double>(value[column]);
    }
    result[row] = static_cast<float>(component);
  }
  return result;
}

std::array<float, 3> eulerDegreesFromRotationMatrix(const RotationMatrix& rotation) {
  constexpr double kRadiansToDegrees = 180.0 / 3.14159265358979323846;
  const double pitch = std::asin(std::clamp(-rotation[1][2], -1.0, 1.0));
  double yaw = 0.0;
  double roll = 0.0;
  if (std::abs(std::cos(pitch)) > 1e-8) {
    yaw = std::atan2(rotation[0][2], rotation[2][2]);
    roll = std::atan2(rotation[1][0], rotation[1][1]);
  } else {
    yaw = std::atan2(-rotation[2][0], rotation[0][0]);
  }
  return {
    static_cast<float>(pitch * kRadiansToDegrees),
    static_cast<float>(yaw * kRadiansToDegrees),
    static_cast<float>(roll * kRadiansToDegrees),
  };
}

bool hasPrefabRenderComponent(const PrefabSourceSnapshot& prefab) {
  return !prefab.renderComponent.procgeo.empty() || !prefab.renderComponent.materialHint.empty();
}

bool hasPrefabEffectComponent(const PrefabSourceSnapshot& prefab) {
  return !prefab.effectComponent.effect.empty() || !prefab.effectComponent.trigger.empty();
}

struct ParsedAssetFields {
  struct SceneEntityFields {
    std::string id;
    std::string displayName;
    std::string sourcePrefab;
    std::string parent;
    std::array<float, 3> position{0.0F, 0.0F, 0.0F};
    std::array<float, 3> rotation{0.0F, 0.0F, 0.0F};
    std::array<float, 3> scale{1.0F, 1.0F, 1.0F};
  };

  struct PrefabRenderComponentFields {
    std::string procgeo;
    std::string materialHint;
  };

  struct PrefabEffectComponentFields {
    std::string effect;
    std::string trigger;
  };

  struct PrefabCollisionComponentFields {
    bool seenSection = false;
    bool hasShape = false;
    bool hasCenter = false;
    bool hasRotation = false;
    bool hasDimensions = false;
    std::string shape;
    std::array<float, 3> center{0.0F, 0.0F, 0.0F};
    std::array<float, 4> rotation{0.0F, 0.0F, 0.0F, 1.0F};
    std::array<float, 3> dimensions{1.0F, 1.0F, 1.0F};
  };

  struct PrefabCameraComponentFields {
    bool seenSection = false;
    bool hasProjection = false;
    bool hasVerticalFovDegrees = false;
    bool hasNearMeters = false;
    bool hasFarMeters = false;
    std::string projection;
    float verticalFovDegrees = 70.0F;
    float nearMeters = 0.15F;
    float farMeters = 1000.0F;
  };

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
  std::string generator;
  std::string bakeOutput;
  std::string materialHint;
  float width = 1.0F;
  float height = 1.0F;
  float depth = 1.0F;
  int rows = 1;
  int columns = 1;
  PrefabRenderComponentFields renderComponent;
  PrefabEffectComponentFields effectComponent;
  PrefabCollisionComponentFields collisionComponent;
  PrefabCameraComponentFields cameraComponent;
  std::vector<SceneEntityFields> sceneEntities;
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
  std::string procgeoSubdir = "procgeo";
  std::string cookedRoot = "build/cooked";
  std::string sceneOwner = "scene_system";
  std::string prefabOwner = "scene_system";
  std::string dataOwner = "data_system";
  std::string effectOwner = "vfx_system";
  std::string procgeoOwner = "procgeo_system";
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
    } else if (key == "procgeo_subdir") {
      manifest->procgeoSubdir = parsedValue;
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
    } else if (key == "procgeo_owner") {
      manifest->procgeoOwner = normalizeToken(parsedValue);
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
  enum class SectionMode {
    none,
    sceneEntity,
    prefabRenderComponent,
    prefabEffectComponent,
    prefabCollisionComponent,
    prefabCameraComponent,
  };
  SectionMode currentSection = SectionMode::none;
  ParsedAssetFields::SceneEntityFields* currentSceneEntity = nullptr;
  while (std::getline(stream, line)) {
    lineNumber += 1;
    const std::string cleaned = stripComment(line);
    if (cleaned.empty()) {
      continue;
    }

    if (cleaned.front() == '[' && cleaned.back() == ']') {
      currentSceneEntity = nullptr;
      currentSection = SectionMode::none;
      const std::string sectionName = trim(cleaned.substr(1, cleaned.size() - 2));
      constexpr std::string_view kSceneEntityPrefix = "entity.";
      if (sectionName.rfind(kSceneEntityPrefix.data(), 0) == 0) {
        ParsedAssetFields::SceneEntityFields entity;
        entity.id = normalizeToken(sectionName.substr(kSceneEntityPrefix.size()));
        asset->sceneEntities.push_back(entity);
        currentSceneEntity = &asset->sceneEntities.back();
        currentSection = SectionMode::sceneEntity;
      } else if (sectionName == "component.render") {
        currentSection = SectionMode::prefabRenderComponent;
      } else if (sectionName == "component.effect") {
        currentSection = SectionMode::prefabEffectComponent;
      } else if (sectionName == "component.collision") {
        if (asset->collisionComponent.seenSection) {
          if (errorMessage) {
            *errorMessage = "Duplicate [component.collision] section in " + path.string();
          }
          return false;
        }
        asset->collisionComponent.seenSection = true;
        currentSection = SectionMode::prefabCollisionComponent;
      } else if (sectionName == "component.camera") {
        if (asset->cameraComponent.seenSection) {
          if (errorMessage) {
            *errorMessage = "Duplicate [component.camera] section in " + path.string();
          }
          return false;
        }
        asset->cameraComponent.seenSection = true;
        currentSection = SectionMode::prefabCameraComponent;
      } else if (sectionName.rfind("component.", 0) == 0) {
        if (errorMessage) {
          *errorMessage = "Unsupported component section [" + sectionName + "] in " + path.string();
        }
        return false;
      }
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
    if (currentSection == SectionMode::sceneEntity && currentSceneEntity != nullptr) {
      if (key == "display_name") {
        currentSceneEntity->displayName = parsedValue;
      } else if (key == "source_prefab") {
        currentSceneEntity->sourcePrefab = normalizeToken(parsedValue);
      } else if (key == "parent") {
        currentSceneEntity->parent = normalizeToken(parsedValue);
      } else if (key == "position") {
        if (!parseVector3Value(value, &currentSceneEntity->position)) {
          if (errorMessage) {
            *errorMessage = "Invalid position in " + path.string();
          }
          return false;
        }
      } else if (key == "rotation") {
        if (!parseVector3Value(value, &currentSceneEntity->rotation)) {
          if (errorMessage) {
            *errorMessage = "Invalid rotation in " + path.string();
          }
          return false;
        }
      } else if (key == "scale") {
        if (!parseVector3Value(value, &currentSceneEntity->scale)) {
          if (errorMessage) {
            *errorMessage = "Invalid scale in " + path.string();
          }
          return false;
        }
      }
      continue;
    }

    if (currentSection == SectionMode::prefabRenderComponent) {
      if (key == "procgeo") {
        asset->renderComponent.procgeo = normalizeToken(parsedValue);
      } else if (key == "material_hint") {
        asset->renderComponent.materialHint = normalizeToken(parsedValue);
      }
      continue;
    }

    if (currentSection == SectionMode::prefabEffectComponent) {
      if (key == "effect") {
        asset->effectComponent.effect = normalizeToken(parsedValue);
      } else if (key == "trigger") {
        asset->effectComponent.trigger = normalizeToken(parsedValue);
      }
      continue;
    }

    if (currentSection == SectionMode::prefabCollisionComponent) {
      if (key == "shape") {
        if (asset->collisionComponent.hasShape) {
          if (errorMessage) {
            *errorMessage = "Duplicate key 'shape' in [component.collision] in " + path.string();
          }
          return false;
        }
        if (value.size() < 2 || value.front() != '"' || value.back() != '"') {
          if (errorMessage) {
            *errorMessage = "Malformed collision shape in " + path.string();
          }
          return false;
        }
        asset->collisionComponent.shape = parsedValue;
        asset->collisionComponent.hasShape = true;
        if (asset->collisionComponent.shape != "box") {
          if (errorMessage) {
            *errorMessage =
              "Unsupported collision shape '" + asset->collisionComponent.shape + "' in " + path.string();
          }
          return false;
        }
      } else if (key == "center") {
        if (asset->collisionComponent.hasCenter) {
          if (errorMessage) {
            *errorMessage = "Duplicate key 'center' in [component.collision] in " + path.string();
          }
          return false;
        }
        if (!parseFiniteFloatArray(value, &asset->collisionComponent.center)) {
          if (errorMessage) {
            *errorMessage = "Malformed collision center in " + path.string();
          }
          return false;
        }
        asset->collisionComponent.hasCenter = true;
      } else if (key == "rotation") {
        if (asset->collisionComponent.hasRotation) {
          if (errorMessage) {
            *errorMessage = "Duplicate key 'rotation' in [component.collision] in " + path.string();
          }
          return false;
        }
        if (!parseFiniteFloatArray(value, &asset->collisionComponent.rotation)) {
          if (errorMessage) {
            *errorMessage = "Malformed collision rotation in " + path.string();
          }
          return false;
        }
        if (!isUnitLengthQuaternion(asset->collisionComponent.rotation)) {
          if (errorMessage) {
            *errorMessage = "collision rotation must be unit length within 1e-6 in " + path.string();
          }
          return false;
        }
        if (asset->collisionComponent.rotation[3] < 0.0F) {
          if (errorMessage) {
            *errorMessage = "collision rotation must be canonical with w >= 0 in " + path.string();
          }
          return false;
        }
        asset->collisionComponent.hasRotation = true;
      } else if (key == "dimensions") {
        if (asset->collisionComponent.hasDimensions) {
          if (errorMessage) {
            *errorMessage = "Duplicate key 'dimensions' in [component.collision] in " + path.string();
          }
          return false;
        }
        if (!parseFiniteFloatArray(value, &asset->collisionComponent.dimensions)) {
          if (errorMessage) {
            *errorMessage = "Malformed collision dimensions in " + path.string();
          }
          return false;
        }
        if (
          asset->collisionComponent.dimensions[0] <= 0.0F
          || asset->collisionComponent.dimensions[1] <= 0.0F
          || asset->collisionComponent.dimensions[2] <= 0.0F) {
          if (errorMessage) {
            *errorMessage = "collision dimensions must be finite and each > 0 in " + path.string();
          }
          return false;
        }
        asset->collisionComponent.hasDimensions = true;
      } else {
        if (errorMessage) {
          *errorMessage = "Unknown key '" + key + "' in [component.collision] in " + path.string();
        }
        return false;
      }
      continue;
    }

    if (currentSection == SectionMode::prefabCameraComponent) {
      auto duplicateCameraKey = [&](bool alreadySet) {
        if (!alreadySet) {
          return false;
        }
        if (errorMessage) {
          *errorMessage = "Duplicate key '" + key + "' in [component.camera] in " + path.string();
        }
        return true;
      };
      if (key == "projection") {
        if (duplicateCameraKey(asset->cameraComponent.hasProjection)) {
          return false;
        }
        if (value.size() < 2 || value.front() != '"' || value.back() != '"') {
          if (errorMessage) {
            *errorMessage = "Malformed camera projection in " + path.string();
          }
          return false;
        }
        asset->cameraComponent.projection = parsedValue;
        asset->cameraComponent.hasProjection = true;
        if (asset->cameraComponent.projection != "perspective") {
          if (errorMessage) {
            *errorMessage = "camera projection must be \"perspective\" in " + path.string();
          }
          return false;
        }
      } else if (key == "vertical_fov_degrees") {
        if (duplicateCameraKey(asset->cameraComponent.hasVerticalFovDegrees)) {
          return false;
        }
        if (!parseCompleteFiniteFloat(value, &asset->cameraComponent.verticalFovDegrees)) {
          if (errorMessage) {
            *errorMessage = "camera vertical_fov_degrees must be finite in " + path.string();
          }
          return false;
        }
        asset->cameraComponent.hasVerticalFovDegrees = true;
      } else if (key == "near_meters") {
        if (duplicateCameraKey(asset->cameraComponent.hasNearMeters)) {
          return false;
        }
        if (!parseCompleteFiniteFloat(value, &asset->cameraComponent.nearMeters)) {
          if (errorMessage) {
            *errorMessage = "camera near_meters must be finite in " + path.string();
          }
          return false;
        }
        asset->cameraComponent.hasNearMeters = true;
      } else if (key == "far_meters") {
        if (duplicateCameraKey(asset->cameraComponent.hasFarMeters)) {
          return false;
        }
        if (!parseCompleteFiniteFloat(value, &asset->cameraComponent.farMeters)) {
          if (errorMessage) {
            *errorMessage = "camera far_meters must be finite in " + path.string();
          }
          return false;
        }
        asset->cameraComponent.hasFarMeters = true;
      } else {
        if (errorMessage) {
          *errorMessage = "Unknown key '" + key + "' in [component.camera] in " + path.string();
        }
        return false;
      }
      continue;
    }

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
    } else if (key == "generator") {
      asset->generator = normalizeToken(parsedValue);
    } else if (key == "bake_output") {
      asset->bakeOutput = normalizeToken(parsedValue);
    } else if (key == "material_hint") {
      asset->materialHint = normalizeToken(parsedValue);
    } else if (key == "width") {
      if (!parseFloatValue(value, &asset->width)) {
        if (errorMessage) {
          *errorMessage = "Invalid width in " + path.string();
        }
        return false;
      }
    } else if (key == "height") {
      if (!parseFloatValue(value, &asset->height)) {
        if (errorMessage) {
          *errorMessage = "Invalid height in " + path.string();
        }
        return false;
      }
    } else if (key == "depth") {
      if (!parseFloatValue(value, &asset->depth)) {
        if (errorMessage) {
          *errorMessage = "Invalid depth in " + path.string();
        }
        return false;
      }
    } else if (key == "rows") {
      if (!parseIntValue(value, &asset->rows)) {
        if (errorMessage) {
          *errorMessage = "Invalid rows in " + path.string();
        }
        return false;
      }
    } else if (key == "columns") {
      if (!parseIntValue(value, &asset->columns)) {
        if (errorMessage) {
          *errorMessage = "Invalid columns in " + path.string();
        }
        return false;
      }
    }
  }

  if (asset->collisionComponent.seenSection) {
    if (!asset->collisionComponent.hasShape) {
      if (errorMessage) {
        *errorMessage = "Missing shape in [component.collision] in " + path.string();
      }
      return false;
    }
    if (!asset->collisionComponent.hasCenter) {
      if (errorMessage) {
        *errorMessage = "Missing center in [component.collision] in " + path.string();
      }
      return false;
    }
    if (!asset->collisionComponent.hasRotation) {
      if (errorMessage) {
        *errorMessage = "Missing rotation in [component.collision] in " + path.string();
      }
      return false;
    }
    if (!asset->collisionComponent.hasDimensions) {
      if (errorMessage) {
        *errorMessage = "Missing dimensions in [component.collision] in " + path.string();
      }
      return false;
    }
  }

  if (asset->cameraComponent.seenSection) {
    if (!asset->cameraComponent.hasProjection || !asset->cameraComponent.hasVerticalFovDegrees
        || !asset->cameraComponent.hasNearMeters || !asset->cameraComponent.hasFarMeters) {
      if (errorMessage) {
        *errorMessage = "[component.camera] requires projection, vertical_fov_degrees, near_meters, and far_meters in "
          + path.string();
      }
      return false;
    }
    if (asset->cameraComponent.verticalFovDegrees <= 0.0F || asset->cameraComponent.verticalFovDegrees >= 180.0F) {
      if (errorMessage) {
        *errorMessage = "camera vertical_fov_degrees must be > 0 and < 180 in " + path.string();
      }
      return false;
    }
    if (asset->cameraComponent.nearMeters <= 0.0F || asset->cameraComponent.farMeters <= 0.0F
        || asset->cameraComponent.nearMeters >= asset->cameraComponent.farMeters) {
      if (errorMessage) {
        *errorMessage = "camera clip distances must be > 0 with near_meters < far_meters in " + path.string();
      }
      return false;
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
    case DataAssetKind::procgeo:
      expectedOwner = manifest.procgeoOwner;
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

  if (kind == DataAssetKind::procgeo) {
    if (asset.generator != "box" && asset.generator != "plane_grid") {
      return "generator must be 'box' or 'plane_grid'";
    }
    if (asset.bakeOutput != "generated_mesh") {
      return "bake_output must be 'generated_mesh'";
    }
    if (
      !std::isfinite(asset.width) || !std::isfinite(asset.height) || !std::isfinite(asset.depth)
      || asset.width <= 0.0F || asset.height <= 0.0F || asset.depth <= 0.0F) {
      return "width, height, and depth must be finite positive numbers";
    }
    if (asset.generator == "plane_grid" && (asset.rows < 1 || asset.columns < 1)) {
      return "plane_grid requires rows and columns >= 1";
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
  std::vector<ProcgeoSourceSnapshot> procgeoSources;
  std::vector<SceneSourceSnapshot> scenes;
  std::vector<PrefabSourceSnapshot> prefabs;
  std::optional<RuntimeBootstrapSnapshot> bootstrap;
  std::vector<std::string> warnings;

  bool load(const DataFoundationConfig& nextConfig, std::string* errorMessage) {
    config = nextConfig;
    assets.clear();
    effects.clear();
    procgeoSources.clear();
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
    if (!scanKind(DataAssetKind::procgeo, manifest.procgeoSubdir, errorMessage)) {
      return false;
    }

    validateRelationships();
    return true;
  }

  bool scanKind(DataAssetKind kind, const std::filesystem::path& subdir, std::string* errorMessage) {
    const std::filesystem::path normalizedSubdir = subdir.lexically_normal();
    bool unsafeSubdir = normalizedSubdir.empty() || normalizedSubdir.is_absolute() || normalizedSubdir.has_root_name();
    for (const auto& component : normalizedSubdir) {
      unsafeSubdir = unsafeSubdir || component == "." || component == "..";
    }

    std::error_code rootError;
    std::error_code directoryError;
    std::error_code relativeError;
    const std::filesystem::path canonicalRoot = std::filesystem::weakly_canonical(config.contentRoot, rootError);
    const std::filesystem::path directory = std::filesystem::weakly_canonical(config.contentRoot / normalizedSubdir, directoryError);
    const std::filesystem::path relativeDirectory = std::filesystem::relative(directory, canonicalRoot, relativeError);
    for (const auto& component : relativeDirectory) {
      unsafeSubdir = unsafeSubdir || component == "..";
    }
    if (unsafeSubdir || rootError || directoryError || relativeError) {
      if (errorMessage) {
        *errorMessage = "Content subdirectory must stay under content root: " + subdir.generic_string();
      }
      return false;
    }

    if (!std::filesystem::exists(directory)) {
      if (errorMessage) {
        *errorMessage = "Expected content directory is missing: " + directory.string();
      }
      return false;
    }

    for (const auto& entry : std::filesystem::directory_iterator(directory)) {
      if (!entry.is_regular_file() || entry.path().extension() != ".toml") {
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
    if (parsed.collisionComponent.seenSection && kind != DataAssetKind::prefab) {
      if (errorMessage) {
        *errorMessage = "[component.collision] is only valid on prefab assets in " + path.string();
      }
      return false;
    }
    if (parsed.cameraComponent.seenSection && kind != DataAssetKind::prefab) {
      if (errorMessage) {
        *errorMessage = "[component.camera] is only valid on prefab assets in " + path.string();
      }
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
      std::vector<SceneEntitySnapshot> entities;
      entities.reserve(parsed.sceneEntities.size());
      for (const auto& entity : parsed.sceneEntities) {
        entities.push_back(SceneEntitySnapshot{
          .id = entity.id,
          .displayName = entity.displayName,
          .sourcePrefab = entity.sourcePrefab,
          .parent = entity.parent,
          .position = entity.position,
          .rotation = entity.rotation,
          .scale = entity.scale,
        });
      }
      scenes.push_back(SceneSourceSnapshot{
        .name = parsed.name,
        .title = parsed.title,
        .primaryPrefab = parsed.primaryPrefab,
        .entities = std::move(entities),
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
        .renderComponent = PrefabRenderComponentSnapshot{
          .procgeo = parsed.renderComponent.procgeo,
          .materialHint = parsed.renderComponent.materialHint,
        },
        .effectComponent = PrefabEffectComponentSnapshot{
          .effect = parsed.effectComponent.effect,
          .trigger = parsed.effectComponent.trigger,
        },
        .collisionComponent = parsed.collisionComponent.seenSection
          ? std::optional<PrefabCollisionComponentSnapshot>{PrefabCollisionComponentSnapshot{
              .shape = parsed.collisionComponent.shape,
              .center = parsed.collisionComponent.center,
              .rotation = parsed.collisionComponent.rotation,
              .dimensions = parsed.collisionComponent.dimensions,
            }}
          : std::nullopt,
        .cameraComponent = parsed.cameraComponent.seenSection
          ? std::optional<PrefabCameraComponentSnapshot>{PrefabCameraComponentSnapshot{
              .projection = parsed.cameraComponent.projection,
              .verticalFovDegrees = parsed.cameraComponent.verticalFovDegrees,
              .nearMeters = parsed.cameraComponent.nearMeters,
              .farMeters = parsed.cameraComponent.farMeters,
            }}
          : std::nullopt,
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

    if (kind == DataAssetKind::procgeo) {
      procgeoSources.push_back(ProcgeoSourceSnapshot{
        .name = parsed.name,
        .generator = parsed.generator,
        .bakeOutput = parsed.bakeOutput,
        .materialHint = parsed.materialHint,
        .width = parsed.width,
        .height = parsed.height,
        .depth = parsed.depth,
        .rows = parsed.rows,
        .columns = parsed.columns,
        .sourcePath = path,
        .cookedPath = asset.cookedPath,
        .valid = asset.valid,
      });
    }

    return true;
  }

  void validateRelationships() {
    for (auto& prefab : prefabs) {
      if (!prefab.valid) {
        continue;
      }

      if (!prefab.renderComponent.materialHint.empty() && prefab.renderComponent.procgeo.empty()) {
        prefab.valid = false;
        markAssetInvalid(
          DataAssetKind::prefab,
          prefab.name,
          prefab.sourcePath,
          "render component declares material_hint without procgeo");
        continue;
      }

      if (!prefab.renderComponent.procgeo.empty() && !hasValidAsset(DataAssetKind::procgeo, prefab.renderComponent.procgeo)) {
        prefab.valid = false;
        markAssetInvalid(
          DataAssetKind::prefab,
          prefab.name,
          prefab.sourcePath,
          "render component references missing procgeo '" + prefab.renderComponent.procgeo + "'");
        continue;
      }

      if (!prefab.effectComponent.trigger.empty() && prefab.effectComponent.effect.empty()) {
        prefab.valid = false;
        markAssetInvalid(
          DataAssetKind::prefab,
          prefab.name,
          prefab.sourcePath,
          "effect component declares trigger without effect");
        continue;
      }

      if (!prefab.effectComponent.effect.empty() && !hasValidAsset(DataAssetKind::effect, prefab.effectComponent.effect)) {
        prefab.valid = false;
        markAssetInvalid(
          DataAssetKind::prefab,
          prefab.name,
          prefab.sourcePath,
          "effect component references missing effect '" + prefab.effectComponent.effect + "'");
        continue;
      }
    }

    for (auto& scene : scenes) {
      if (!scene.valid) {
        continue;
      }

      if (!scene.primaryPrefab.empty() && !hasValidPrefab(scene.primaryPrefab)) {
        scene.valid = false;
        markAssetInvalid(
          DataAssetKind::scene,
          scene.name,
          scene.sourcePath,
          "primary_prefab references missing prefab '" + scene.primaryPrefab + "'");
        continue;
      }

      std::vector<std::string> entityIds;
      entityIds.reserve(scene.entities.size());
      for (const auto& entity : scene.entities) {
        entityIds.push_back(entity.id);
      }

      for (const auto& entity : scene.entities) {
        if (entity.id.empty()) {
          scene.valid = false;
          markAssetInvalid(
            DataAssetKind::scene,
            scene.name,
            scene.sourcePath,
            "scene entity is missing an id");
          break;
        }

        if (entity.sourcePrefab.empty() || !hasValidPrefab(entity.sourcePrefab)) {
          scene.valid = false;
          markAssetInvalid(
            DataAssetKind::scene,
            scene.name,
            scene.sourcePath,
            "entity '" + entity.id + "' source_prefab references missing prefab '" + entity.sourcePrefab + "'");
          break;
        }

        if (!entity.parent.empty()) {
          if (entity.parent == entity.id) {
            scene.valid = false;
            markAssetInvalid(
              DataAssetKind::scene,
              scene.name,
              scene.sourcePath,
              "entity '" + entity.id + "' cannot parent itself");
            break;
          }

          if (std::find(entityIds.begin(), entityIds.end(), entity.parent) == entityIds.end()) {
            scene.valid = false;
            markAssetInvalid(
              DataAssetKind::scene,
              scene.name,
              scene.sourcePath,
              "entity '" + entity.id + "' parent references missing entity '" + entity.parent + "'");
            break;
          }
        }
      }

      if (!scene.valid) {
        continue;
      }

      std::size_t playerCameraCount = 0;
      for (const auto& entity : scene.entities) {
        const auto prefabIt = std::find_if(
          prefabs.begin(),
          prefabs.end(),
          [&entity](const PrefabSourceSnapshot& prefab) {
            return prefab.valid && prefab.name == entity.sourcePrefab;
          });
        if (prefabIt != prefabs.end() && prefabIt->spawnTag == "player_camera") {
          playerCameraCount += 1;
        }
      }
      if (!scene.valid) {
        continue;
      }
      if (playerCameraCount > 1) {
        scene.valid = false;
        markAssetInvalid(
          DataAssetKind::scene,
          scene.name,
          scene.sourcePath,
          "scene must reference at most one prefab with spawn_tag 'player_camera'");
        continue;
      }

      for (const auto& entity : scene.entities) {
        std::vector<std::string> parentChain;
        std::string currentParent = entity.parent;
        while (!currentParent.empty()) {
          if (currentParent == entity.id
              || std::find(parentChain.begin(), parentChain.end(), currentParent) != parentChain.end()) {
            scene.valid = false;
            markAssetInvalid(
              DataAssetKind::scene,
              scene.name,
              scene.sourcePath,
              "entity '" + entity.id + "' is part of a parent cycle via '" + currentParent + "'");
            break;
          }

          parentChain.push_back(currentParent);
          const auto parentIt = std::find_if(
            scene.entities.begin(),
            scene.entities.end(),
            [&currentParent](const SceneEntitySnapshot& candidate) {
              return candidate.id == currentParent;
            });
          if (parentIt == scene.entities.end()) {
            break;
          }
          currentParent = parentIt->parent;
        }

        if (!scene.valid) {
          break;
        }
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

  bool hasValidAsset(DataAssetKind kind, std::string_view assetName) const {
    const std::string normalized = normalizeToken(std::string(assetName));
    for (const auto& asset : assets) {
      if (asset.valid && asset.kind == kind && asset.name == normalized) {
        return true;
      }
    }
    return false;
  }

  bool hasValidScene(std::string_view sceneName) const {
    return hasValidAsset(DataAssetKind::scene, sceneName);
  }

  bool hasValidPrefab(std::string_view prefabName) const {
    return hasValidAsset(DataAssetKind::prefab, prefabName);
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

std::optional<EffectDescriptorSnapshot> DataFoundation::effectDescriptor(std::string_view effectName) const {
  const std::string normalized = normalizeToken(std::string(effectName));
  for (const auto& effect : impl_->effects) {
    if (effect.name == normalized) {
      return effect;
    }
  }
  return std::nullopt;
}

std::vector<ProcgeoSourceSnapshot> DataFoundation::snapshotProcgeoSources() const {
  return impl_->procgeoSources;
}

std::optional<ProcgeoSourceSnapshot> DataFoundation::procgeoSource(std::string_view procgeoName) const {
  const std::string normalized = normalizeToken(std::string(procgeoName));
  for (const auto& procgeo : impl_->procgeoSources) {
    if (procgeo.name == normalized) {
      return procgeo;
    }
  }
  return std::nullopt;
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

std::optional<ComposedSceneSnapshot> DataFoundation::composeScene(std::string_view sceneName) const {
  const std::string normalized = normalizeToken(std::string(sceneName));
  const auto scene = sceneSource(normalized);
  if (!scene.has_value()) {
    return std::nullopt;
  }

  ComposedSceneSnapshot composed;
  composed.name = scene->name;
  composed.title = scene->title;
  composed.primaryPrefab = scene->primaryPrefab;
  composed.sourcePath = scene->sourcePath;
  composed.cookedPath = scene->cookedPath;
  composed.valid = scene->valid;
  if (!scene->valid) {
    return composed;
  }

  composed.entities.reserve(scene->entities.size());
  std::unordered_map<std::string, std::size_t> entityIndices;
  entityIndices.reserve(scene->entities.size());

  auto appendPrefabName = [&composed](const std::string& prefabName) {
    if (prefabName.empty()) {
      return;
    }
    if (std::find(composed.prefabNames.begin(), composed.prefabNames.end(), prefabName) == composed.prefabNames.end()) {
      composed.prefabNames.push_back(prefabName);
    }
  };

  appendPrefabName(scene->primaryPrefab);
  std::string playerCameraEntity;
  std::string playerSpawnEntity;

  for (const auto& entity : scene->entities) {
    ComposedSceneEntitySnapshot composedEntity;
    composedEntity.id = entity.id;
    composedEntity.displayName = entity.displayName.empty() ? entity.id : entity.displayName;
    composedEntity.prefabName = entity.sourcePrefab;
    composedEntity.parent = entity.parent;
    composedEntity.localPosition = entity.position;
    composedEntity.localRotation = entity.rotation;
    composedEntity.localScale = entity.scale;
    composedEntity.worldPosition = entity.position;
    composedEntity.worldRotation = entity.rotation;
    composedEntity.worldScale = entity.scale;

    if (const auto prefab = prefabSource(entity.sourcePrefab); prefab.has_value() && prefab->valid) {
      composedEntity.prefabCategory = prefab->category;
      composedEntity.spawnTag = prefab->spawnTag;
      composedEntity.hasRenderComponent = hasPrefabRenderComponent(*prefab);
      composedEntity.renderProcgeo = prefab->renderComponent.procgeo;
      composedEntity.renderMaterialHint = prefab->renderComponent.materialHint;
      composedEntity.hasEffectComponent = hasPrefabEffectComponent(*prefab);
      composedEntity.effectName = prefab->effectComponent.effect;
      composedEntity.effectTrigger = prefab->effectComponent.trigger;
      composedEntity.cameraComponent = prefab->cameraComponent;
      if (prefab->spawnTag == "player_camera") {
        playerCameraEntity = entity.id;
      } else if (playerSpawnEntity.empty() && prefab->spawnTag == "player_spawn") {
        playerSpawnEntity = entity.id;
      }
    }

    entityIndices.emplace(composedEntity.id, composed.entities.size());
    appendPrefabName(composedEntity.prefabName);
    composed.entities.push_back(std::move(composedEntity));
  }

  composed.preferredPlayerEntity = playerCameraEntity.empty() ? playerSpawnEntity : playerCameraEntity;

  for (auto& entity : composed.entities) {
    if (entity.parent.empty()) {
      composed.rootEntities.push_back(entity.id);
      continue;
    }

    const auto parentIt = entityIndices.find(entity.parent);
    if (parentIt != entityIndices.end()) {
      composed.entities[parentIt->second].children.push_back(entity.id);
    }
  }

  std::vector<std::uint8_t> state(composed.entities.size(), 0);
  std::vector<RotationMatrix> worldRotations(composed.entities.size());
  std::function<void(std::size_t)> resolveWorldTransform = [&](std::size_t entityIndex) {
    if (entityIndex >= composed.entities.size() || state[entityIndex] == 2) {
      return;
    }
    if (state[entityIndex] == 1) {
      composed.valid = false;
      return;
    }

    state[entityIndex] = 1;
    auto& entity = composed.entities[entityIndex];
    const RotationMatrix localRotation = rotationMatrixFromEulerDegrees(entity.localRotation);
    if (!entity.parent.empty()) {
      const auto parentIt = entityIndices.find(entity.parent);
      if (parentIt != entityIndices.end()) {
        resolveWorldTransform(parentIt->second);
        const auto& parent = composed.entities[parentIt->second];
        worldRotations[entityIndex] = multiplyRotationMatrices(worldRotations[parentIt->second], localRotation);
        entity.worldPosition = addVector3(
          parent.worldPosition,
          rotateVector3(worldRotations[parentIt->second], multiplyVector3(parent.worldScale, entity.localPosition)));
        entity.worldRotation = eulerDegreesFromRotationMatrix(worldRotations[entityIndex]);
        entity.worldScale = multiplyVector3(parent.worldScale, entity.localScale);
      }
    } else {
      worldRotations[entityIndex] = localRotation;
    }
    state[entityIndex] = 2;
  };

  for (std::size_t entityIndex = 0; entityIndex < composed.entities.size(); entityIndex += 1) {
    resolveWorldTransform(entityIndex);
  }

  return composed;
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
  std::size_t procgeoCount = 0;

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
      case DataAssetKind::procgeo:
        procgeoCount += 1;
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
          << ", procgeo=" << procgeoCount
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
    summary << ", entities=" << scene->entities.size();
    return summary.str();
  }

  return "Scene source missing: " + normalized + " under " + relativePathString(impl_->config.contentRoot / impl_->manifest.sceneSubdir);
}

std::string DataFoundation::sceneEntitySummary(std::string_view sceneName) const {
  const std::string normalized = normalizeToken(std::string(sceneName));
  const auto scene = sceneSource(normalized);
  if (!scene.has_value()) {
    return "Scene entity layout missing: " + normalized;
  }
  if (!scene->valid) {
    return "Scene entity layout invalid: " + normalized;
  }

  std::ostringstream summary;
  summary << "Scene entity layout: " << scene->name << " (" << scene->entities.size() << " entities)";
  for (const auto& entity : scene->entities) {
    summary << "\n- entity " << entity.id
            << " -> prefab " << entity.sourcePrefab;
    if (!entity.parent.empty()) {
      summary << ", parent=" << entity.parent;
    }
    summary << ", position=(" << vector3String(entity.position) << ')'
            << ", rotation=(" << vector3String(entity.rotation) << ')'
            << ", scale=(" << vector3String(entity.scale) << ')';
  }
  return summary.str();
}

std::string DataFoundation::scenePrefabComponentSummary(std::string_view sceneName) const {
  const std::string normalized = normalizeToken(std::string(sceneName));
  const auto scene = sceneSource(normalized);
  if (!scene.has_value()) {
    return "Scene prefab components missing: " + normalized;
  }
  if (!scene->valid) {
    return "Scene prefab components invalid: " + normalized;
  }

  std::vector<std::string> prefabNames;
  auto pushUniquePrefab = [&prefabNames](const std::string& prefabName) {
    if (prefabName.empty()) {
      return;
    }
    if (std::find(prefabNames.begin(), prefabNames.end(), prefabName) == prefabNames.end()) {
      prefabNames.push_back(prefabName);
    }
  };

  pushUniquePrefab(scene->primaryPrefab);
  for (const auto& entity : scene->entities) {
    pushUniquePrefab(entity.sourcePrefab);
  }

  std::ostringstream summary;
  summary << "Scene prefab components: " << scene->name << " (" << prefabNames.size() << " prefabs)";
  for (const auto& prefabName : prefabNames) {
    const auto prefab = prefabSource(prefabName);
    if (!prefab.has_value()) {
      summary << "\n- prefab " << prefabName << " missing";
      continue;
    }
    if (!prefab->valid) {
      summary << "\n- prefab " << prefab->name << " invalid";
      continue;
    }

    summary << "\n- prefab " << prefab->name;
    if (!prefab->category.empty()) {
      summary << " [category=" << prefab->category << ']';
    }
    if (!prefab->spawnTag.empty()) {
      summary << " [spawn_tag=" << prefab->spawnTag << ']';
    }

    if (!hasPrefabRenderComponent(*prefab) && !hasPrefabEffectComponent(*prefab) && !prefab->cameraComponent.has_value()) {
      summary << " [no explicit components]";
      continue;
    }

    if (hasPrefabRenderComponent(*prefab)) {
      summary << "\n  - render -> procgeo " << prefab->renderComponent.procgeo;
      if (!prefab->renderComponent.materialHint.empty()) {
        summary << ", material_hint=" << prefab->renderComponent.materialHint;
      }
    }

    if (hasPrefabEffectComponent(*prefab)) {
      summary << "\n  - effect -> asset " << prefab->effectComponent.effect;
      if (!prefab->effectComponent.trigger.empty()) {
        summary << ", trigger=" << prefab->effectComponent.trigger;
      }
    }
    if (prefab->cameraComponent.has_value()) {
      summary << "\n  - camera -> projection=" << prefab->cameraComponent->projection
              << ", vertical_fov_degrees=" << prefab->cameraComponent->verticalFovDegrees
              << ", near_meters=" << prefab->cameraComponent->nearMeters
              << ", far_meters=" << prefab->cameraComponent->farMeters;
    }
  }
  return summary.str();
}

std::string DataFoundation::composedSceneSummary(std::string_view sceneName) const {
  const std::string normalized = normalizeToken(std::string(sceneName));
  const auto composed = composeScene(normalized);
  if (!composed.has_value()) {
    return "Composed scene missing: " + normalized;
  }
  if (!composed->valid) {
    return "Composed scene invalid: " + normalized;
  }

  std::ostringstream summary;
  summary << "Composed scene: " << composed->name
          << " [entities=" << composed->entities.size()
          << ", roots=" << composed->rootEntities.size()
          << ", prefabs=" << composed->prefabNames.size() << ']';
  if (!composed->preferredPlayerEntity.empty()) {
    summary << "\n- preferred_player_entity=" << composed->preferredPlayerEntity;
  }

  for (const auto& entity : composed->entities) {
    summary << "\n- entity " << entity.id
            << " -> prefab " << entity.prefabName;
    if (!entity.spawnTag.empty()) {
      summary << " [spawn_tag=" << entity.spawnTag << ']';
    }
    if (!entity.parent.empty()) {
      summary << ", parent=" << entity.parent;
    }
    if (!entity.children.empty()) {
      summary << ", children=" << entity.children.size();
    }
    summary << ", local_pos=(" << vector3String(entity.localPosition) << ')'
            << ", world_pos=(" << vector3String(entity.worldPosition) << ')';

    if (entity.hasRenderComponent) {
      summary << "\n  - render -> procgeo " << entity.renderProcgeo;
      if (!entity.renderMaterialHint.empty()) {
        summary << ", material_hint=" << entity.renderMaterialHint;
      }
    }
    if (entity.hasEffectComponent) {
      summary << "\n  - effect -> asset " << entity.effectName;
      if (!entity.effectTrigger.empty()) {
        summary << ", trigger=" << entity.effectTrigger;
      }
    }
    if (entity.cameraComponent.has_value()) {
      summary << "\n  - camera -> projection=" << entity.cameraComponent->projection
              << ", vertical_fov_degrees=" << entity.cameraComponent->verticalFovDegrees
              << ", near_meters=" << entity.cameraComponent->nearMeters
              << ", far_meters=" << entity.cameraComponent->farMeters;
    }
  }

  return summary.str();
}

std::string DataFoundation::relationshipSummary() const {
  std::ostringstream summary;
  summary << "Content relationships:";

  for (const auto& prefab : impl_->prefabs) {
    if (!prefab.valid) {
      continue;
    }

    summary << "\n- prefab " << prefab.name;
    if (!prefab.category.empty()) {
      summary << " (category=" << prefab.category << ')';
    }
    if (!prefab.spawnTag.empty()) {
      summary << " [spawn_tag=" << prefab.spawnTag << ']';
    }

    if (hasPrefabRenderComponent(prefab)) {
      summary << "\n  - render -> procgeo " << prefab.renderComponent.procgeo;
      if (!prefab.renderComponent.materialHint.empty()) {
        summary << ", material_hint=" << prefab.renderComponent.materialHint;
      }
    }

    if (hasPrefabEffectComponent(prefab)) {
      summary << "\n  - effect -> asset " << prefab.effectComponent.effect;
      if (!prefab.effectComponent.trigger.empty()) {
        summary << ", trigger=" << prefab.effectComponent.trigger;
      }
    }
    if (prefab.cameraComponent.has_value()) {
      summary << "\n  - camera -> projection=" << prefab.cameraComponent->projection
              << ", vertical_fov_degrees=" << prefab.cameraComponent->verticalFovDegrees
              << ", near_meters=" << prefab.cameraComponent->nearMeters
              << ", far_meters=" << prefab.cameraComponent->farMeters;
    }
  }

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
    summary << " [entities=" << scene.entities.size() << ']';

    for (const auto& entity : scene.entities) {
      summary << "\n  - entity " << entity.id << " -> prefab " << entity.sourcePrefab;
      if (!entity.parent.empty()) {
        summary << ", parent=" << entity.parent;
      }
    }
  }

  if (impl_->bootstrap.has_value() && impl_->bootstrap->valid) {
    summary << "\n- runtime_bootstrap -> default_scene=" << impl_->bootstrap->defaultScene;
    if (impl_->bootstrap->hasToolingOverlayPreference) {
      summary << ", tooling_overlay=" << (impl_->bootstrap->toolingOverlayEnabled ? "enabled" : "disabled");
    }
  }

  for (const auto& procgeo : impl_->procgeoSources) {
    if (!procgeo.valid) {
      continue;
    }

    summary << "\n- procgeo " << procgeo.name
            << " -> bake_output=" << procgeo.bakeOutput
            << ", generator=" << procgeo.generator;
    if (!procgeo.materialHint.empty()) {
      summary << ", material_hint=" << procgeo.materialHint;
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
