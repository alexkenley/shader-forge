#include "shader_forge/runtime/physics_system.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cctype>
#include <filesystem>
#include <fstream>
#include <limits>
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

bool parseDoubleValue(const std::string& rawValue, double* result) {
  try {
    *result = std::stod(parseStringValue(rawValue));
    return true;
  } catch (...) {
    return false;
  }
}

bool parseBoolValue(const std::string& rawValue, bool* result) {
  const std::string normalized = normalizeToken(parseStringValue(rawValue));
  if (normalized == "true") {
    *result = true;
    return true;
  }
  if (normalized == "false") {
    *result = false;
    return true;
  }
  return false;
}

std::vector<std::string> splitListValue(const std::string& rawValue) {
  std::vector<std::string> items;
  const std::string value = parseStringValue(rawValue);
  std::string current;
  for (char character : value) {
    if (character == ',') {
      const std::string item = normalizeToken(trim(current));
      if (!item.empty()) {
        items.push_back(item);
      }
      current.clear();
      continue;
    }
    current.push_back(character);
  }
  const std::string item = normalizeToken(trim(current));
  if (!item.empty()) {
    items.push_back(item);
  }
  return items;
}

bool parseVector3Value(const std::string& rawValue, std::array<double, 3>* result) {
  const std::string value = parseStringValue(rawValue);
  std::array<double, 3> parsed = {0.0, 0.0, 0.0};
  std::string current;
  int index = 0;

  for (char character : value) {
    if (character == ',') {
      if (index >= 3) {
        return false;
      }
      try {
        parsed[static_cast<std::size_t>(index)] = std::stod(trim(current));
      } catch (...) {
        return false;
      }
      current.clear();
      index += 1;
      continue;
    }
    current.push_back(character);
  }

  if (index != 2) {
    return false;
  }

  try {
    parsed[2] = std::stod(trim(current));
  } catch (...) {
    return false;
  }

  *result = parsed;
  return true;
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

std::vector<std::filesystem::path> sortedRegularFiles(const std::filesystem::path& directory) {
  std::vector<std::filesystem::path> files;
  for (const auto& entry : std::filesystem::directory_iterator(directory)) {
    if (!entry.is_regular_file()) {
      continue;
    }
    files.push_back(entry.path());
  }
  std::sort(files.begin(), files.end());
  return files;
}

const PhysicsLayerSnapshot* findLayerByName(const std::vector<PhysicsLayerSnapshot>& layers, std::string_view name) {
  for (const auto& layer : layers) {
    if (layer.name == name) {
      return &layer;
    }
  }
  return nullptr;
}

const PhysicsMaterialSnapshot* findMaterialByName(const std::vector<PhysicsMaterialSnapshot>& materials, std::string_view name) {
  for (const auto& material : materials) {
    if (material.name == name) {
      return &material;
    }
  }
  return nullptr;
}

double dot(const std::array<double, 3>& left, const std::array<double, 3>& right) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

double lengthSquared(const std::array<double, 3>& value) {
  return dot(value, value);
}

double length(const std::array<double, 3>& value) {
  return std::sqrt(lengthSquared(value));
}

std::array<double, 3> subtract(const std::array<double, 3>& left, const std::array<double, 3>& right) {
  return {
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2],
  };
}

std::array<double, 3> addScaled(const std::array<double, 3>& origin, const std::array<double, 3>& direction, double distance) {
  return {
    origin[0] + direction[0] * distance,
    origin[1] + direction[1] * distance,
    origin[2] + direction[2] * distance,
  };
}

std::optional<std::array<double, 3>> normalizedVector(const std::array<double, 3>& value) {
  const double magnitude = length(value);
  if (magnitude <= 0.0) {
    return std::nullopt;
  }
  return std::array<double, 3>{
    value[0] / magnitude,
    value[1] / magnitude,
    value[2] / magnitude,
  };
}

bool intersectsRayAabb(
  const std::array<double, 3>& origin,
  const std::array<double, 3>& direction,
  const std::array<double, 3>& center,
  const std::array<double, 3>& halfExtents,
  double maxDistance,
  double* hitDistance) {
  double tMin = 0.0;
  double tMax = maxDistance;

  for (std::size_t axis = 0; axis < 3; axis += 1) {
    const double minBound = center[axis] - halfExtents[axis];
    const double maxBound = center[axis] + halfExtents[axis];
    const double axisDirection = direction[axis];

    if (std::abs(axisDirection) < 1e-9) {
      if (origin[axis] < minBound || origin[axis] > maxBound) {
        return false;
      }
      continue;
    }

    const double inverseDirection = 1.0 / axisDirection;
    double t1 = (minBound - origin[axis]) * inverseDirection;
    double t2 = (maxBound - origin[axis]) * inverseDirection;
    if (t1 > t2) {
      std::swap(t1, t2);
    }

    tMin = std::max(tMin, t1);
    tMax = std::min(tMax, t2);
    if (tMax < tMin) {
      return false;
    }
  }

  *hitDistance = tMin;
  return *hitDistance <= maxDistance;
}

bool intersectsRaySphere(
  const std::array<double, 3>& origin,
  const std::array<double, 3>& direction,
  const std::array<double, 3>& center,
  double radius,
  double maxDistance,
  double* hitDistance) {
  const std::array<double, 3> offset = subtract(origin, center);
  const double b = 2.0 * dot(direction, offset);
  const double c = dot(offset, offset) - (radius * radius);
  const double discriminant = (b * b) - (4.0 * c);
  if (discriminant < 0.0) {
    return false;
  }

  const double root = std::sqrt(discriminant);
  const double nearDistance = (-b - root) * 0.5;
  const double farDistance = (-b + root) * 0.5;
  const double candidate = nearDistance >= 0.0 ? nearDistance : farDistance;
  if (candidate < 0.0 || candidate > maxDistance) {
    return false;
  }

  *hitDistance = candidate;
  return true;
}

bool overlapsSphereAabb(
  const std::array<double, 3>& center,
  double radius,
  const std::array<double, 3>& boxCenter,
  const std::array<double, 3>& halfExtents) {
  double distanceSquared = 0.0;
  for (std::size_t axis = 0; axis < 3; axis += 1) {
    const double minBound = boxCenter[axis] - halfExtents[axis];
    const double maxBound = boxCenter[axis] + halfExtents[axis];
    const double value = center[axis];
    const double clamped = std::clamp(value, minBound, maxBound);
    const double delta = value - clamped;
    distanceSquared += delta * delta;
  }
  return distanceSquared <= (radius * radius);
}

bool overlapsSphereSphere(
  const std::array<double, 3>& center,
  double radius,
  const std::array<double, 3>& otherCenter,
  double otherRadius) {
  const double distanceSq = lengthSquared(subtract(center, otherCenter));
  const double combinedRadius = radius + otherRadius;
  return distanceSq <= (combinedRadius * combinedRadius);
}

bool loadLayersFile(
  const std::filesystem::path& path,
  std::vector<PhysicsLayerSnapshot>* layers,
  std::string* errorMessage) {
  std::ifstream stream(path);
  if (!stream.is_open()) {
    if (errorMessage) {
      *errorMessage = "Could not open physics layers file at " + path.string();
    }
    return false;
  }

  std::string schema;
  int schemaVersion = 0;
  PhysicsLayerSnapshot* currentLayer = nullptr;
  std::string line;
  std::size_t lineNumber = 0;

  while (std::getline(stream, line)) {
    lineNumber += 1;
    const std::string cleaned = stripComment(line);
    if (cleaned.empty()) {
      continue;
    }

    if (cleaned.front() == '[' && cleaned.back() == ']') {
      const std::string section = trim(cleaned.substr(1, cleaned.size() - 2));
      if (!section.starts_with("layer.")) {
        if (errorMessage) {
          *errorMessage = "Invalid physics layer section '" + section + "' in " + path.string();
        }
        return false;
      }

      const std::string layerName = normalizeToken(section.substr(6));
      if (layerName.empty()) {
        if (errorMessage) {
          *errorMessage = "Physics layer section is missing a layer name in " + path.string();
        }
        return false;
      }

      layers->push_back(PhysicsLayerSnapshot{
        .name = layerName,
        .displayName = section.substr(6),
        .sourcePath = path,
        .valid = false,
      });
      currentLayer = &layers->back();
      continue;
    }

    std::string key;
    std::string value;
    if (!parseKeyValue(cleaned, &key, &value)) {
      if (errorMessage) {
        *errorMessage = "Invalid physics layer line " + std::to_string(lineNumber) + " in " + path.string();
      }
      return false;
    }

    if (currentLayer == nullptr) {
      if (key == "schema") {
        schema = normalizeToken(parseStringValue(value));
      } else if (key == "schema_version") {
        if (!parseIntValue(value, &schemaVersion)) {
          if (errorMessage) {
            *errorMessage = "Invalid schema_version in " + path.string();
          }
          return false;
        }
      }
      continue;
    }

    if (key == "display_name") {
      currentLayer->displayName = parseStringValue(value);
    } else if (key == "collides_with") {
      currentLayer->collidesWith = splitListValue(value);
    } else if (key == "queryable") {
      if (!parseBoolValue(value, &currentLayer->queryable)) {
        if (errorMessage) {
          *errorMessage = "Invalid queryable flag for physics layer '" + currentLayer->name + "'.";
        }
        return false;
      }
    } else if (key == "static_only") {
      if (!parseBoolValue(value, &currentLayer->staticOnly)) {
        if (errorMessage) {
          *errorMessage = "Invalid static_only flag for physics layer '" + currentLayer->name + "'.";
        }
        return false;
      }
    }
  }

  if (schema != "shader_forge_physics_layers") {
    if (errorMessage) {
      *errorMessage = "Physics layers schema must be 'shader_forge.physics_layers'.";
    }
    return false;
  }
  if (schemaVersion <= 0) {
    if (errorMessage) {
      *errorMessage = "Physics layers schema_version must be a positive integer.";
    }
    return false;
  }
  if (layers->empty()) {
    if (errorMessage) {
      *errorMessage = "Physics layers file does not declare any layers.";
    }
    return false;
  }

  constexpr std::array<std::string_view, 3> requiredLayers = {
    "world_static",
    "world_dynamic",
    "query_only",
  };

  for (auto& layer : *layers) {
    if (layer.displayName.empty()) {
      layer.displayName = layer.name;
    }
    for (const auto& collisionLayer : layer.collidesWith) {
      if (findLayerByName(*layers, collisionLayer) == nullptr) {
        if (errorMessage) {
          *errorMessage = "Physics layer '" + layer.name + "' references missing collides_with layer '" + collisionLayer + "'.";
        }
        return false;
      }
    }
    layer.valid = true;
  }

  for (std::string_view requiredLayer : requiredLayers) {
    if (findLayerByName(*layers, requiredLayer) == nullptr) {
      if (errorMessage) {
        *errorMessage = "Physics layers file is missing required layer '" + std::string(requiredLayer) + "'.";
      }
      return false;
    }
  }

  return true;
}

bool loadMaterialFile(
  const std::filesystem::path& path,
  PhysicsMaterialSnapshot* material,
  std::string* errorMessage) {
  std::ifstream stream(path);
  if (!stream.is_open()) {
    if (errorMessage) {
      *errorMessage = "Could not open physics material file at " + path.string();
    }
    return false;
  }

  std::string schema;
  std::string ownerSystem;
  int schemaVersion = 0;
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
        *errorMessage = "Invalid physics material line " + std::to_string(lineNumber) + " in " + path.string();
      }
      return false;
    }

    if (key == "schema") {
      schema = normalizeToken(parseStringValue(value));
    } else if (key == "schema_version") {
      if (!parseIntValue(value, &schemaVersion)) {
        if (errorMessage) {
          *errorMessage = "Invalid schema_version in " + path.string();
        }
        return false;
      }
    } else if (key == "name") {
      material->name = normalizeToken(parseStringValue(value));
    } else if (key == "owner_system") {
      ownerSystem = normalizeToken(parseStringValue(value));
    } else if (key == "friction") {
      if (!parseDoubleValue(value, &material->friction)) {
        if (errorMessage) {
          *errorMessage = "Invalid friction in " + path.string();
        }
        return false;
      }
    } else if (key == "restitution") {
      if (!parseDoubleValue(value, &material->restitution)) {
        if (errorMessage) {
          *errorMessage = "Invalid restitution in " + path.string();
        }
        return false;
      }
    } else if (key == "density") {
      if (!parseDoubleValue(value, &material->density)) {
        if (errorMessage) {
          *errorMessage = "Invalid density in " + path.string();
        }
        return false;
      }
    }
  }

  material->sourcePath = path;

  if (schema != "shader_forge_physics_material") {
    if (errorMessage) {
      *errorMessage = "Physics material schema must be 'shader_forge.physics_material' in " + path.string();
    }
    return false;
  }
  if (schemaVersion <= 0) {
    if (errorMessage) {
      *errorMessage = "Physics material schema_version must be a positive integer in " + path.string();
    }
    return false;
  }
  if (ownerSystem != "physics_system") {
    if (errorMessage) {
      *errorMessage = "Physics material owner_system must be 'physics_system' in " + path.string();
    }
    return false;
  }
  if (material->name.empty()) {
    if (errorMessage) {
      *errorMessage = "Physics material is missing a name in " + path.string();
    }
    return false;
  }
  if (material->friction < 0.0 || material->friction > 1.0) {
    if (errorMessage) {
      *errorMessage = "Physics material '" + material->name + "' friction must be between 0 and 1.";
    }
    return false;
  }
  if (material->restitution < 0.0 || material->restitution > 1.0) {
    if (errorMessage) {
      *errorMessage = "Physics material '" + material->name + "' restitution must be between 0 and 1.";
    }
    return false;
  }
  if (material->density <= 0.0) {
    if (errorMessage) {
      *errorMessage = "Physics material '" + material->name + "' density must be > 0.";
    }
    return false;
  }

  material->valid = true;
  return true;
}

bool loadBodyFile(
  const std::filesystem::path& path,
  const std::vector<PhysicsLayerSnapshot>& layers,
  const std::vector<PhysicsMaterialSnapshot>& materials,
  PhysicsBodySnapshot* body,
  std::string* errorMessage) {
  std::ifstream stream(path);
  if (!stream.is_open()) {
    if (errorMessage) {
      *errorMessage = "Could not open physics body file at " + path.string();
    }
    return false;
  }

  std::string schema;
  std::string ownerSystem;
  int schemaVersion = 0;
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
        *errorMessage = "Invalid physics body line " + std::to_string(lineNumber) + " in " + path.string();
      }
      return false;
    }

    if (key == "schema") {
      schema = normalizeToken(parseStringValue(value));
    } else if (key == "schema_version") {
      if (!parseIntValue(value, &schemaVersion)) {
        if (errorMessage) {
          *errorMessage = "Invalid schema_version in " + path.string();
        }
        return false;
      }
    } else if (key == "name") {
      body->name = normalizeToken(parseStringValue(value));
    } else if (key == "owner_system") {
      ownerSystem = normalizeToken(parseStringValue(value));
    } else if (key == "scene") {
      body->sceneName = normalizeToken(parseStringValue(value));
    } else if (key == "source_prefab") {
      body->sourcePrefab = normalizeToken(parseStringValue(value));
    } else if (key == "layer") {
      body->layer = normalizeToken(parseStringValue(value));
    } else if (key == "material") {
      body->material = normalizeToken(parseStringValue(value));
    } else if (key == "motion_type") {
      body->motionType = normalizeToken(parseStringValue(value));
    } else if (key == "shape_type") {
      body->shapeType = normalizeToken(parseStringValue(value));
    } else if (key == "position") {
      if (!parseVector3Value(value, &body->position)) {
        if (errorMessage) {
          *errorMessage = "Invalid position in " + path.string();
        }
        return false;
      }
    } else if (key == "half_extents") {
      if (!parseVector3Value(value, &body->halfExtents)) {
        if (errorMessage) {
          *errorMessage = "Invalid half_extents in " + path.string();
        }
        return false;
      }
    } else if (key == "radius") {
      if (!parseDoubleValue(value, &body->radius)) {
        if (errorMessage) {
          *errorMessage = "Invalid radius in " + path.string();
        }
        return false;
      }
    }
  }

  body->sourcePath = path;

  if (schema != "shader_forge_physics_body") {
    if (errorMessage) {
      *errorMessage = "Physics body schema must be 'shader_forge.physics_body' in " + path.string();
    }
    return false;
  }
  if (schemaVersion <= 0) {
    if (errorMessage) {
      *errorMessage = "Physics body schema_version must be a positive integer in " + path.string();
    }
    return false;
  }
  if (ownerSystem != "physics_system") {
    if (errorMessage) {
      *errorMessage = "Physics body owner_system must be 'physics_system' in " + path.string();
    }
    return false;
  }
  if (body->name.empty()) {
    if (errorMessage) {
      *errorMessage = "Physics body is missing a name in " + path.string();
    }
    return false;
  }
  if (body->sceneName.empty()) {
    if (errorMessage) {
      *errorMessage = "Physics body '" + body->name + "' is missing scene.";
    }
    return false;
  }
  if (findLayerByName(layers, body->layer) == nullptr) {
    if (errorMessage) {
      *errorMessage = "Physics body '" + body->name + "' references missing layer '" + body->layer + "'.";
    }
    return false;
  }
  if (findMaterialByName(materials, body->material) == nullptr) {
    if (errorMessage) {
      *errorMessage = "Physics body '" + body->name + "' references missing material '" + body->material + "'.";
    }
    return false;
  }
  if (body->motionType != "static" && body->motionType != "kinematic" && body->motionType != "dynamic") {
    if (errorMessage) {
      *errorMessage = "Physics body '" + body->name + "' motion_type must be static, kinematic, or dynamic.";
    }
    return false;
  }
  if (body->shapeType != "box" && body->shapeType != "sphere") {
    if (errorMessage) {
      *errorMessage = "Physics body '" + body->name + "' shape_type must be box or sphere.";
    }
    return false;
  }
  if (body->shapeType == "box") {
    if (body->halfExtents[0] <= 0.0 || body->halfExtents[1] <= 0.0 || body->halfExtents[2] <= 0.0) {
      if (errorMessage) {
        *errorMessage = "Physics body '" + body->name + "' box half_extents must all be > 0.";
      }
      return false;
    }
  }
  if (body->shapeType == "sphere" && body->radius <= 0.0) {
    if (errorMessage) {
      *errorMessage = "Physics body '" + body->name + "' sphere radius must be > 0.";
    }
    return false;
  }

  body->valid = true;
  return true;
}

}  // namespace

struct PhysicsSystem::Impl {
  PhysicsConfig config;
  std::vector<PhysicsLayerSnapshot> layers;
  std::vector<PhysicsMaterialSnapshot> materials;
  std::vector<PhysicsBodySnapshot> bodies;

  bool load(const PhysicsConfig& nextConfig, std::string* errorMessage) {
    config = nextConfig;
    layers.clear();
    materials.clear();
    bodies.clear();

    const std::filesystem::path layersPath = config.rootPath / "layers.toml";
    const std::filesystem::path materialsPath = config.rootPath / "materials";
    const std::filesystem::path bodiesPath = config.rootPath / "bodies";

    if (!std::filesystem::exists(layersPath)) {
      if (errorMessage) {
        *errorMessage = "Physics layers file is missing: " + layersPath.string();
      }
      return false;
    }
    if (!std::filesystem::exists(materialsPath)) {
      if (errorMessage) {
        *errorMessage = "Physics materials directory is missing: " + materialsPath.string();
      }
      return false;
    }
    if (!std::filesystem::exists(bodiesPath)) {
      if (errorMessage) {
        *errorMessage = "Physics bodies directory is missing: " + bodiesPath.string();
      }
      return false;
    }

    if (!loadLayersFile(layersPath, &layers, errorMessage)) {
      return false;
    }

    for (const auto& filePath : sortedRegularFiles(materialsPath)) {
      PhysicsMaterialSnapshot material;
      if (!loadMaterialFile(filePath, &material, errorMessage)) {
        return false;
      }
      materials.push_back(std::move(material));
    }

    if (materials.empty()) {
      if (errorMessage) {
        *errorMessage = "Physics system does not have any material definitions under " + materialsPath.string();
      }
      return false;
    }

    for (const auto& filePath : sortedRegularFiles(bodiesPath)) {
      PhysicsBodySnapshot body;
      if (!loadBodyFile(filePath, layers, materials, &body, errorMessage)) {
        return false;
      }
      bodies.push_back(std::move(body));
    }

    if (bodies.empty()) {
      if (errorMessage) {
        *errorMessage = "Physics system does not have any body definitions under " + bodiesPath.string();
      }
      return false;
    }

    return true;
  }
};

PhysicsSystem::PhysicsSystem()
    : impl_(std::make_unique<Impl>()) {}

PhysicsSystem::~PhysicsSystem() = default;

PhysicsSystem::PhysicsSystem(PhysicsSystem&&) noexcept = default;

PhysicsSystem& PhysicsSystem::operator=(PhysicsSystem&&) noexcept = default;

bool PhysicsSystem::loadFromDisk(const PhysicsConfig& config, std::string* errorMessage) {
  return impl_->load(config, errorMessage);
}

std::size_t PhysicsSystem::layerCount() const {
  return impl_->layers.size();
}

std::size_t PhysicsSystem::materialCount() const {
  return impl_->materials.size();
}

std::size_t PhysicsSystem::bodyCount() const {
  return impl_->bodies.size();
}

bool PhysicsSystem::hasBody(std::string_view bodyName) const {
  const std::string normalized = normalizeToken(std::string(bodyName));
  for (const auto& body : impl_->bodies) {
    if (body.name == normalized) {
      return true;
    }
  }
  return false;
}

std::vector<PhysicsLayerSnapshot> PhysicsSystem::snapshotLayers() const {
  return impl_->layers;
}

std::vector<PhysicsMaterialSnapshot> PhysicsSystem::snapshotMaterials() const {
  return impl_->materials;
}

std::vector<PhysicsBodySnapshot> PhysicsSystem::snapshotBodies() const {
  return impl_->bodies;
}

std::vector<PhysicsBodySnapshot> PhysicsSystem::bodiesForScene(std::string_view sceneName) const {
  const std::string normalizedScene = normalizeToken(std::string(sceneName));
  std::vector<PhysicsBodySnapshot> sceneBodies;
  for (const auto& body : impl_->bodies) {
    if (body.sceneName == normalizedScene) {
      sceneBodies.push_back(body);
    }
  }
  return sceneBodies;
}

std::optional<PhysicsRaycastHitSnapshot> PhysicsSystem::raycastScene(
  std::string_view sceneName,
  const std::array<double, 3>& origin,
  const std::array<double, 3>& direction,
  double maxDistance) const {
  if (maxDistance <= 0.0) {
    return std::nullopt;
  }

  const auto normalizedDirection = normalizedVector(direction);
  if (!normalizedDirection.has_value()) {
    return std::nullopt;
  }

  const std::string normalizedScene = normalizeToken(std::string(sceneName));
  double nearestDistance = maxDistance;
  std::optional<PhysicsRaycastHitSnapshot> nearestHit;

  for (const auto& body : impl_->bodies) {
    if (body.sceneName != normalizedScene) {
      continue;
    }

    const PhysicsLayerSnapshot* layer = findLayerByName(impl_->layers, body.layer);
    if (layer == nullptr || !layer->queryable) {
      continue;
    }

    double hitDistance = 0.0;
    const bool hit = body.shapeType == "box"
      ? intersectsRayAabb(origin, *normalizedDirection, body.position, body.halfExtents, nearestDistance, &hitDistance)
      : intersectsRaySphere(origin, *normalizedDirection, body.position, body.radius, nearestDistance, &hitDistance);
    if (!hit) {
      continue;
    }

    nearestDistance = hitDistance;
    nearestHit = PhysicsRaycastHitSnapshot{
      .bodyName = body.name,
      .layerName = body.layer,
      .materialName = body.material,
      .shapeType = body.shapeType,
      .distance = hitDistance,
      .point = addScaled(origin, *normalizedDirection, hitDistance),
    };
  }

  return nearestHit;
}

std::vector<PhysicsOverlapSnapshot> PhysicsSystem::overlapSphereScene(
  std::string_view sceneName,
  const std::array<double, 3>& center,
  double radius) const {
  std::vector<PhysicsOverlapSnapshot> overlaps;
  if (radius <= 0.0) {
    return overlaps;
  }

  const std::string normalizedScene = normalizeToken(std::string(sceneName));
  for (const auto& body : impl_->bodies) {
    if (body.sceneName != normalizedScene) {
      continue;
    }

    const PhysicsLayerSnapshot* layer = findLayerByName(impl_->layers, body.layer);
    if (layer == nullptr || !layer->queryable) {
      continue;
    }

    const bool hit = body.shapeType == "box"
      ? overlapsSphereAabb(center, radius, body.position, body.halfExtents)
      : overlapsSphereSphere(center, radius, body.position, body.radius);
    if (!hit) {
      continue;
    }

    overlaps.push_back(PhysicsOverlapSnapshot{
      .bodyName = body.name,
      .layerName = body.layer,
      .shapeType = body.shapeType,
    });
  }

  return overlaps;
}

std::string PhysicsSystem::foundationSummary() const {
  std::ostringstream summary;
  summary << "Physics foundation: root=" << relativePathString(impl_->config.rootPath)
          << ", layers=" << impl_->layers.size()
          << ", materials=" << impl_->materials.size()
          << ", bodies=" << impl_->bodies.size();
  return summary.str();
}

std::string PhysicsSystem::layerMatrixSummary() const {
  std::ostringstream summary;
  for (const auto& layer : impl_->layers) {
    summary << "physics-layer " << layer.name
            << " -> collides_with=";
    for (std::size_t index = 0; index < layer.collidesWith.size(); index += 1) {
      if (index > 0) {
        summary << ',';
      }
      summary << layer.collidesWith[index];
    }
    summary << ", queryable=" << (layer.queryable ? "true" : "false")
            << ", static_only=" << (layer.staticOnly ? "true" : "false") << '\n';
  }
  return summary.str();
}

std::string PhysicsSystem::sceneBodySummary(std::string_view sceneName) const {
  const auto sceneBodies = bodiesForScene(sceneName);
  const std::string normalizedScene = normalizeToken(std::string(sceneName));
  std::ostringstream summary;
  summary << "Physics scene bodies: scene=" << normalizedScene
          << ", count=" << sceneBodies.size();
  for (const auto& body : sceneBodies) {
    summary << '\n'
            << "physics-body " << body.name
            << " -> layer=" << body.layer
            << ", material=" << body.material
            << ", motion=" << body.motionType
            << ", shape=" << body.shapeType;
  }
  return summary.str();
}

}  // namespace shader_forge::runtime
