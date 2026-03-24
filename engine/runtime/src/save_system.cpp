#include "shader_forge/runtime/save_system.hpp"

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

bool parseVector3Value(const std::string& rawValue, std::array<float, 3>* result) {
  std::istringstream parts(parseStringValue(rawValue));
  std::string token;
  std::array<float, 3> parsed{0.0F, 0.0F, 0.0F};
  std::size_t index = 0;

  while (std::getline(parts, token, ',')) {
    if (index >= parsed.size()) {
      return false;
    }
    try {
      parsed[index] = std::stof(trim(token));
    } catch (...) {
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

std::vector<std::string> splitListValue(const std::string& rawValue) {
  std::vector<std::string> values;
  const std::string parsed = parseStringValue(rawValue);
  std::string current;
  for (char character : parsed) {
    if (character == ',') {
      const std::string item = normalizeToken(trim(current));
      if (!item.empty()) {
        values.push_back(item);
      }
      current.clear();
      continue;
    }
    current.push_back(character);
  }

  const std::string item = normalizeToken(trim(current));
  if (!item.empty()) {
    values.push_back(item);
  }
  return values;
}

std::string joinListValue(const std::vector<std::string>& values) {
  std::ostringstream stream;
  for (std::size_t index = 0; index < values.size(); index += 1) {
    if (index > 0) {
      stream << ", ";
    }
    stream << values[index];
  }
  return stream.str();
}

std::string vector3String(const std::array<float, 3>& value) {
  std::ostringstream stream;
  stream << value[0] << ", " << value[1] << ", " << value[2];
  return stream.str();
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

std::string slotFileName(std::string_view slotName) {
  const std::string normalized = normalizeToken(std::string(slotName));
  if (normalized.empty()) {
    return {};
  }
  return normalized + ".runtime-save.toml";
}

}  // namespace

struct SaveSystem::Impl {
  SaveSystemConfig config;
};

SaveSystem::SaveSystem()
    : impl_(std::make_unique<Impl>()) {}

SaveSystem::~SaveSystem() = default;

SaveSystem::SaveSystem(SaveSystem&&) noexcept = default;
SaveSystem& SaveSystem::operator=(SaveSystem&&) noexcept = default;

bool SaveSystem::initialize(const SaveSystemConfig& config, std::string* errorMessage) {
  impl_->config = config;
  std::error_code error;
  std::filesystem::create_directories(impl_->config.rootPath, error);
  if (error) {
    if (errorMessage) {
      *errorMessage = "Could not create runtime save root at " + impl_->config.rootPath.string();
    }
    return false;
  }
  return true;
}

std::filesystem::path SaveSystem::slotPath(std::string_view slotName) const {
  const std::string fileName = slotFileName(slotName);
  if (fileName.empty()) {
    return {};
  }
  return impl_->config.rootPath / fileName;
}

bool SaveSystem::saveSlot(
  std::string_view slotName,
  const RuntimeSaveSnapshot& snapshot,
  std::string* errorMessage) const {
  const std::filesystem::path path = slotPath(slotName);
  if (path.empty()) {
    if (errorMessage) {
      *errorMessage = "Runtime save slot name is invalid.";
    }
    return false;
  }

  std::error_code directoryError;
  std::filesystem::create_directories(path.parent_path(), directoryError);
  if (directoryError) {
    if (errorMessage) {
      *errorMessage = "Could not create runtime save directory at " + path.parent_path().string();
    }
    return false;
  }

  std::ofstream stream(path);
  if (!stream.is_open()) {
    if (errorMessage) {
      *errorMessage = "Could not open runtime save slot at " + path.string();
    }
    return false;
  }

  std::vector<std::string> overlapBodies = snapshot.triggeredOverlapBodies;
  std::sort(overlapBodies.begin(), overlapBodies.end());
  overlapBodies.erase(std::unique(overlapBodies.begin(), overlapBodies.end()), overlapBodies.end());

  stream << "schema = \"shader_forge.runtime_save\"\n";
  stream << "schema_version = 1\n";
  stream << "slot = \"" << normalizeToken(std::string(slotName)) << "\"\n";
  stream << "saved_at = \"" << snapshot.savedAt << "\"\n";
  stream << "scene = \"" << snapshot.sceneName << "\"\n";
  stream << "controlled_entity = \"" << snapshot.controlledEntityId << "\"\n";
  stream << "controlled_display_name = \"" << snapshot.controlledDisplayName << "\"\n";
  stream << "controlled_prefab = \"" << snapshot.controlledPrefabName << "\"\n";
  stream << "controlled_spawn_tag = \"" << snapshot.controlledSpawnTag << "\"\n";
  stream << "controlled_position = \"" << vector3String(snapshot.controlledPosition) << "\"\n";
  stream << "controlled_rotation = \"" << vector3String(snapshot.controlledRotation) << "\"\n";
  stream << "animation_graph = \"" << snapshot.animationGraphName << "\"\n";
  stream << "animation_state = \"" << snapshot.animationStateName << "\"\n";
  stream << "triggered_overlap_bodies = \"" << joinListValue(overlapBodies) << "\"\n";
  return true;
}

std::optional<RuntimeSaveSnapshot> SaveSystem::loadSlot(
  std::string_view slotName,
  std::string* errorMessage) const {
  const std::filesystem::path path = slotPath(slotName);
  if (path.empty()) {
    if (errorMessage) {
      *errorMessage = "Runtime save slot name is invalid.";
    }
    return std::nullopt;
  }

  std::ifstream stream(path);
  if (!stream.is_open()) {
    if (errorMessage) {
      *errorMessage = "Runtime save slot was not found at " + path.string();
    }
    return std::nullopt;
  }

  std::string schema;
  int schemaVersion = 0;
  RuntimeSaveSnapshot snapshot;
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
        *errorMessage = "Invalid runtime save line " + std::to_string(lineNumber) + " in " + path.string();
      }
      return std::nullopt;
    }

    if (key == "schema") {
      schema = parseStringValue(value);
    } else if (key == "schema_version") {
      if (!parseIntValue(value, &schemaVersion)) {
        if (errorMessage) {
          *errorMessage = "Runtime save schema_version is invalid in " + path.string();
        }
        return std::nullopt;
      }
    } else if (key == "slot") {
      snapshot.slotName = normalizeToken(parseStringValue(value));
    } else if (key == "saved_at") {
      snapshot.savedAt = parseStringValue(value);
    } else if (key == "scene") {
      snapshot.sceneName = normalizeToken(parseStringValue(value));
    } else if (key == "controlled_entity") {
      snapshot.controlledEntityId = normalizeToken(parseStringValue(value));
    } else if (key == "controlled_display_name") {
      snapshot.controlledDisplayName = parseStringValue(value);
    } else if (key == "controlled_prefab") {
      snapshot.controlledPrefabName = normalizeToken(parseStringValue(value));
    } else if (key == "controlled_spawn_tag") {
      snapshot.controlledSpawnTag = normalizeToken(parseStringValue(value));
    } else if (key == "controlled_position") {
      if (!parseVector3Value(value, &snapshot.controlledPosition)) {
        if (errorMessage) {
          *errorMessage = "Runtime save controlled_position is invalid in " + path.string();
        }
        return std::nullopt;
      }
    } else if (key == "controlled_rotation") {
      if (!parseVector3Value(value, &snapshot.controlledRotation)) {
        if (errorMessage) {
          *errorMessage = "Runtime save controlled_rotation is invalid in " + path.string();
        }
        return std::nullopt;
      }
    } else if (key == "animation_graph") {
      snapshot.animationGraphName = normalizeToken(parseStringValue(value));
    } else if (key == "animation_state") {
      snapshot.animationStateName = normalizeToken(parseStringValue(value));
    } else if (key == "triggered_overlap_bodies") {
      snapshot.triggeredOverlapBodies = splitListValue(value);
    }
  }

  snapshot.sourcePath = path;
  if (schema != "shader_forge.runtime_save") {
    if (errorMessage) {
      *errorMessage = "Runtime save schema must be 'shader_forge.runtime_save' in " + path.string();
    }
    return std::nullopt;
  }
  if (schemaVersion <= 0) {
    if (errorMessage) {
      *errorMessage = "Runtime save schema_version must be a positive integer in " + path.string();
    }
    return std::nullopt;
  }
  if (snapshot.slotName.empty()) {
    if (errorMessage) {
      *errorMessage = "Runtime save is missing slot metadata in " + path.string();
    }
    return std::nullopt;
  }
  if (snapshot.sceneName.empty()) {
    if (errorMessage) {
      *errorMessage = "Runtime save is missing scene metadata in " + path.string();
    }
    return std::nullopt;
  }
  if (snapshot.controlledEntityId.empty()) {
    if (errorMessage) {
      *errorMessage = "Runtime save is missing controlled_entity metadata in " + path.string();
    }
    return std::nullopt;
  }

  snapshot.valid = true;
  return snapshot;
}

std::string SaveSystem::foundationSummary() const {
  std::ostringstream summary;
  summary << "Save system: root=" << relativePathString(impl_->config.rootPath)
          << ", format=runtime_save_toml"
          << ", quickslot=" << relativePathString(slotPath("quickslot_01"));
  return summary.str();
}

}  // namespace shader_forge::runtime
