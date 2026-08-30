#include "shader_forge/runtime/animation_system.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <functional>
#include <map>
#include <optional>
#include <set>
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

using StrictTable = std::map<std::string, std::string>;

struct StrictDocument {
  StrictTable top;
  std::map<std::string, StrictTable> sections;
};

bool fail(std::string* errorMessage, std::string message) {
  if (errorMessage) {
    *errorMessage = std::move(message);
  }
  return false;
}

bool parseStrictDocument(
  const std::filesystem::path& path,
  StrictDocument* document,
  std::string* errorMessage) {
  std::ifstream stream(path);
  if (!stream.is_open()) {
    return fail(errorMessage, "Could not open spatial authoring file at " + path.string());
  }

  StrictTable* current = &document->top;
  std::string line;
  std::size_t lineNumber = 0;
  while (std::getline(stream, line)) {
    lineNumber += 1;
    const std::string cleaned = stripComment(line);
    if (cleaned.empty()) {
      continue;
    }
    if (cleaned.front() == '[') {
      if (cleaned.size() < 3 || cleaned.back() != ']' || cleaned.find(']', 1) != cleaned.size() - 1) {
        return fail(errorMessage, "Malformed section on line " + std::to_string(lineNumber) + " in " + path.string());
      }
      const std::string section = trim(std::string_view(cleaned).substr(1, cleaned.size() - 2));
      if (section.empty() || document->sections.contains(section)) {
        return fail(errorMessage, "Empty or duplicate section '" + section + "' in " + path.string());
      }
      current = &document->sections.emplace(section, StrictTable{}).first->second;
      continue;
    }

    const std::size_t separator = cleaned.find('=');
    if (separator == std::string::npos) {
      return fail(errorMessage, "Malformed key/value on line " + std::to_string(lineNumber) + " in " + path.string());
    }
    const std::string key = trim(std::string_view(cleaned).substr(0, separator));
    const std::string value = trim(std::string_view(cleaned).substr(separator + 1));
    if (key.empty() || value.empty() || key.find_first_not_of("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_") != std::string::npos) {
      return fail(errorMessage, "Invalid key '" + key + "' in " + path.string());
    }
    if (!current->emplace(key, value).second) {
      return fail(errorMessage, "Duplicate key '" + key + "' in " + path.string());
    }
  }
  return true;
}

bool requireOnlyKeys(
  const StrictTable& table,
  std::initializer_list<std::string_view> allowed,
  std::string_view context,
  std::string* errorMessage) {
  for (const auto& [key, ignored] : table) {
    (void)ignored;
    if (std::find(allowed.begin(), allowed.end(), key) == allowed.end()) {
      return fail(errorMessage, "Unknown key '" + key + "' in " + std::string(context));
    }
  }
  return true;
}

bool getRequired(const StrictTable& table, std::string_view key, const std::string** value, std::string_view context, std::string* errorMessage) {
  const auto found = table.find(std::string(key));
  if (found == table.end()) {
    return fail(errorMessage, "Missing key '" + std::string(key) + "' in " + std::string(context));
  }
  *value = &found->second;
  return true;
}

bool parseStrictString(const std::string& raw, std::string* value) {
  if (raw.size() < 2 || raw.front() != '"' || raw.back() != '"') {
    return false;
  }
  const std::string content = raw.substr(1, raw.size() - 2);
  if (content.find('"') != std::string::npos || content.find('\\') != std::string::npos) {
    return false;
  }
  *value = content;
  return true;
}

bool parseStrictInt(const std::string& raw, int* value) {
  std::size_t consumed = 0;
  try {
    const int parsed = std::stoi(raw, &consumed);
    if (consumed != raw.size()) {
      return false;
    }
    *value = parsed;
    return true;
  } catch (...) {
    return false;
  }
}

bool parseStrictDouble(const std::string& raw, double* value) {
  std::size_t consumed = 0;
  try {
    const double parsed = std::stod(raw, &consumed);
    if (consumed != raw.size() || !std::isfinite(parsed)) {
      return false;
    }
    *value = parsed;
    return true;
  } catch (...) {
    return false;
  }
}

bool parseStrictBool(const std::string& raw, bool* value) {
  if (raw == "true") {
    *value = true;
    return true;
  }
  if (raw == "false") {
    *value = false;
    return true;
  }
  return false;
}

bool parseNumberArray(const std::string& raw, std::vector<double>* values) {
  if (raw.size() < 2 || raw.front() != '[' || raw.back() != ']') {
    return false;
  }
  const std::string body = trim(std::string_view(raw).substr(1, raw.size() - 2));
  if (body.empty()) {
    return false;
  }
  std::size_t start = 0;
  while (start <= body.size()) {
    const std::size_t comma = body.find(',', start);
    const std::string token = trim(std::string_view(body).substr(start, comma == std::string::npos ? body.size() - start : comma - start));
    double value = 0.0;
    if (token.empty() || !parseStrictDouble(token, &value)) {
      return false;
    }
    values->push_back(value);
    if (comma == std::string::npos) {
      break;
    }
    start = comma + 1;
    if (start == body.size()) {
      return false;
    }
  }
  return true;
}

bool parseStringArray(const std::string& raw, std::vector<std::string>* values) {
  if (raw.size() < 2 || raw.front() != '[' || raw.back() != ']') {
    return false;
  }
  const std::string body = trim(std::string_view(raw).substr(1, raw.size() - 2));
  if (body.empty()) {
    return false;
  }
  std::size_t start = 0;
  while (start <= body.size()) {
    const std::size_t comma = body.find(',', start);
    const std::string token = trim(std::string_view(body).substr(start, comma == std::string::npos ? body.size() - start : comma - start));
    std::string value;
    if (!parseStrictString(token, &value) || value.empty()) {
      return false;
    }
    values->push_back(std::move(value));
    if (comma == std::string::npos) {
      break;
    }
    start = comma + 1;
    if (start == body.size()) {
      return false;
    }
  }
  return true;
}

bool parseVector3(const std::string& raw, SpatialVector3Snapshot* vector) {
  std::vector<double> values;
  if (!parseNumberArray(raw, &values) || values.size() != 3) {
    return false;
  }
  *vector = SpatialVector3Snapshot{values[0], values[1], values[2]};
  return true;
}

bool parseQuaternion(const std::string& raw, SpatialQuaternionSnapshot* rotation) {
  std::vector<double> values;
  if (!parseNumberArray(raw, &values) || values.size() != 4) {
    return false;
  }
  const double length = std::sqrt(
    values[0] * values[0] + values[1] * values[1] + values[2] * values[2] + values[3] * values[3]);
  if (std::abs(length - 1.0) > 1e-6) {
    return false;
  }
  if (values[3] < 0.0) {
    for (double& value : values) {
      value = -value;
    }
  }
  *rotation = SpatialQuaternionSnapshot{values[0], values[1], values[2], values[3]};
  return true;
}

bool readString(const StrictTable& table, std::string_view key, std::string* value, std::string_view context, std::string* errorMessage) {
  const std::string* raw = nullptr;
  return getRequired(table, key, &raw, context, errorMessage)
    && (parseStrictString(*raw, value) && !value->empty()
      ? true
      : fail(errorMessage, "Invalid string key '" + std::string(key) + "' in " + std::string(context)));
}

bool readStringAllowEmpty(const StrictTable& table, std::string_view key, std::string* value, std::string_view context, std::string* errorMessage) {
  const std::string* raw = nullptr;
  return getRequired(table, key, &raw, context, errorMessage)
    && (parseStrictString(*raw, value)
      ? true
      : fail(errorMessage, "Invalid string key '" + std::string(key) + "' in " + std::string(context)));
}

bool readVector3(const StrictTable& table, std::string_view key, SpatialVector3Snapshot* value, std::string_view context, std::string* errorMessage) {
  const std::string* raw = nullptr;
  return getRequired(table, key, &raw, context, errorMessage)
    && (parseVector3(*raw, value)
      ? true
      : fail(errorMessage, "Invalid vec3 key '" + std::string(key) + "' in " + std::string(context)));
}

bool readQuaternion(const StrictTable& table, std::string_view key, SpatialQuaternionSnapshot* value, std::string_view context, std::string* errorMessage) {
  const std::string* raw = nullptr;
  return getRequired(table, key, &raw, context, errorMessage)
    && (parseQuaternion(*raw, value)
      ? true
      : fail(errorMessage, "Invalid canonical quaternion key '" + std::string(key) + "' in " + std::string(context)));
}

bool readInt(const StrictTable& table, std::string_view key, int* value, std::string_view context, std::string* errorMessage) {
  const std::string* raw = nullptr;
  return getRequired(table, key, &raw, context, errorMessage)
    && (parseStrictInt(*raw, value)
      ? true
      : fail(errorMessage, "Invalid integer key '" + std::string(key) + "' in " + std::string(context)));
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

const SkeletonDefinitionSnapshot* findSkeletonByName(const std::vector<SkeletonDefinitionSnapshot>& skeletons, std::string_view name) {
  for (const auto& skeleton : skeletons) {
    if (skeleton.name == name || skeleton.id == name) {
      return &skeleton;
    }
  }
  return nullptr;
}

const SkeletonDefinitionSnapshot* findSkeletonById(const std::vector<SkeletonDefinitionSnapshot>& skeletons, std::string_view id) {
  for (const auto& skeleton : skeletons) {
    if (skeleton.id == id) {
      return &skeleton;
    }
  }
  return nullptr;
}

const ClipDefinitionSnapshot* findClipByName(const std::vector<ClipDefinitionSnapshot>& clips, std::string_view name) {
  for (const auto& clip : clips) {
    if (clip.name == name) {
      return &clip;
    }
  }
  return nullptr;
}

const AnimationGraphStateSnapshot* findStateByName(const std::vector<AnimationGraphStateSnapshot>& states, std::string_view name) {
  for (const auto& state : states) {
    if (state.name == name) {
      return &state;
    }
  }
  return nullptr;
}

bool sortedRegularFilesWithSuffix(
  const std::filesystem::path& directory,
  std::string_view suffix,
  std::vector<std::filesystem::path>* files,
  std::string* errorMessage) {
  std::error_code error;
  std::filesystem::directory_iterator iterator(directory, error);
  if (error) {
    return fail(errorMessage, "Could not enumerate animation directory '" + directory.string() + "': " + error.message());
  }
  const std::filesystem::directory_iterator end;
  while (iterator != end) {
    const auto& entry = *iterator;
    const bool regular = entry.is_regular_file(error);
    if (error) {
      return fail(errorMessage, "Could not inspect animation directory entry '" + entry.path().string() + "': " + error.message());
    }
    if (regular && entry.path().filename().string().ends_with(suffix)) {
      files->push_back(entry.path());
    }
    iterator.increment(error);
    if (error) {
      return fail(errorMessage, "Could not continue enumerating animation directory '" + directory.string() + "': " + error.message());
    }
  }
  std::sort(files->begin(), files->end());
  return true;
}

bool loadSkeletonV2File(
  const std::filesystem::path& path,
  SkeletonDefinitionSnapshot* skeleton,
  std::string* errorMessage) {
  StrictDocument document;
  if (!parseStrictDocument(path, &document, errorMessage)) {
    return false;
  }
  const std::string context = path.string();
  if (!requireOnlyKeys(
        document.top,
        {"schema", "schema_version", "id", "name", "owner_system", "root_bone", "units", "up", "forward", "handedness"},
        context,
        errorMessage)) {
    return false;
  }

  std::string schema;
  std::string ownerSystem;
  std::string units;
  std::string up;
  std::string forward;
  std::string handedness;
  if (!readString(document.top, "schema", &schema, context, errorMessage)
      || !readInt(document.top, "schema_version", &skeleton->schemaVersion, context, errorMessage)
      || !readString(document.top, "id", &skeleton->id, context, errorMessage)
      || !readString(document.top, "name", &skeleton->name, context, errorMessage)
      || !readString(document.top, "owner_system", &ownerSystem, context, errorMessage)
      || !readString(document.top, "root_bone", &skeleton->rootBone, context, errorMessage)
      || !readString(document.top, "units", &units, context, errorMessage)
      || !readString(document.top, "up", &up, context, errorMessage)
      || !readString(document.top, "forward", &forward, context, errorMessage)
      || !readString(document.top, "handedness", &handedness, context, errorMessage)) {
    return false;
  }
  if (schema != "shader_forge.skeleton" || skeleton->schemaVersion != 2
      || ownerSystem != "animation_system" || units != "meters" || up != "y"
      || forward != "z" || handedness != "right") {
    return fail(errorMessage, "Invalid skeleton v2 header in " + context);
  }

  const std::set<std::string> boneRoles = {
    "hips", "spine", "chest", "neck", "head", "clavicle_l", "clavicle_r",
    "upper_arm_l", "upper_arm_r", "lower_arm_l", "lower_arm_r", "hand_l", "hand_r",
    "upper_leg_l", "upper_leg_r", "lower_leg_l", "lower_leg_r", "foot_l", "foot_r", "other",
  };
  const std::set<std::string> socketRoles = {
    "primary_grip", "secondary_ik_target", "palm_contact", "muzzle", "holster", "utility", "other",
  };
  std::set<std::string> boneIds;
  std::set<std::string> semanticBoneRoles;
  std::vector<std::pair<std::string, std::string>> socketRolePairs;

  for (const auto& [section, table] : document.sections) {
    if (section.starts_with("bone.")) {
      if (section.size() == 5 || !requireOnlyKeys(table, {"id", "parent", "role", "translation", "rotation"}, section, errorMessage)) {
        return false;
      }
      SkeletonBoneSnapshot bone;
      if (!readString(table, "id", &bone.id, section, errorMessage)
          || !readStringAllowEmpty(table, "parent", &bone.parent, section, errorMessage)
          || !readVector3(table, "translation", &bone.translation, section, errorMessage)
          || !readQuaternion(table, "rotation", &bone.rotation, section, errorMessage)) {
        return false;
      }
      if (const auto role = table.find("role"); role != table.end()) {
        if (!parseStrictString(role->second, &bone.role) || !boneRoles.contains(bone.role)) {
          return fail(errorMessage, "Invalid bone role in " + section);
        }
      }
      if (!boneIds.insert(bone.id).second) {
        return fail(errorMessage, "Duplicate bone id '" + bone.id + "' in " + context);
      }
      if (!bone.role.empty() && bone.role != "other" && !semanticBoneRoles.insert(bone.role).second) {
        return fail(errorMessage, "Duplicate bone role '" + bone.role + "' in " + context);
      }
      skeleton->bones.push_back(bone.id);
      skeleton->boneDefinitions.push_back(std::move(bone));
      continue;
    }
    if (section.starts_with("socket.")) {
      if (section.size() == 7 || !requireOnlyKeys(table, {"id", "bone", "role", "translation", "rotation"}, section, errorMessage)) {
        return false;
      }
      SkeletonSocketSnapshot socket;
      if (!readString(table, "id", &socket.id, section, errorMessage)
          || !readString(table, "bone", &socket.bone, section, errorMessage)
          || !readVector3(table, "translation", &socket.translation, section, errorMessage)
          || !readQuaternion(table, "rotation", &socket.rotation, section, errorMessage)) {
        return false;
      }
      if (const auto role = table.find("role"); role != table.end()) {
        if (!parseStrictString(role->second, &socket.role) || !socketRoles.contains(socket.role)) {
          return fail(errorMessage, "Invalid socket role in " + section);
        }
      }
      if (std::find_if(skeleton->sockets.begin(), skeleton->sockets.end(), [&](const auto& existing) { return existing.id == socket.id; }) != skeleton->sockets.end()) {
        return fail(errorMessage, "Duplicate socket id '" + socket.id + "' in " + context);
      }
      if (!socket.role.empty() && socket.role != "other") {
        const auto pair = std::pair{socket.bone, socket.role};
        if (std::find(socketRolePairs.begin(), socketRolePairs.end(), pair) != socketRolePairs.end()) {
          return fail(errorMessage, "Duplicate socket role '" + socket.role + "' on bone '" + socket.bone + "'.");
        }
        socketRolePairs.push_back(pair);
      }
      skeleton->sockets.push_back(std::move(socket));
      continue;
    }
    return fail(errorMessage, "Unknown skeleton section '" + section + "' in " + context);
  }

  if (skeleton->boneDefinitions.empty() || !boneIds.contains(skeleton->rootBone)) {
    return fail(errorMessage, "Skeleton root_bone is missing from the v2 bone tables in " + context);
  }
  int rootCount = 0;
  std::map<std::string, std::string> parents;
  for (const auto& bone : skeleton->boneDefinitions) {
    parents.emplace(bone.id, bone.parent);
    if (bone.parent.empty()) {
      rootCount += 1;
      if (bone.id != skeleton->rootBone) {
        return fail(errorMessage, "Only root_bone may have an empty parent in " + context);
      }
    } else if (!boneIds.contains(bone.parent)) {
      return fail(errorMessage, "Bone '" + bone.id + "' references missing parent '" + bone.parent + "'.");
    }
  }
  if (rootCount != 1 || !parents.at(skeleton->rootBone).empty()) {
    return fail(errorMessage, "Skeleton must have exactly one root in " + context);
  }
  for (const auto& bone : skeleton->boneDefinitions) {
    std::set<std::string> visited;
    std::string current = bone.id;
    while (!current.empty()) {
      if (!visited.insert(current).second) {
        return fail(errorMessage, "Skeleton bone graph contains a cycle in " + context);
      }
      current = parents.at(current);
    }
    if (!visited.contains(skeleton->rootBone)) {
      return fail(errorMessage, "Skeleton bone graph is disconnected in " + context);
    }
  }
  for (const auto& socket : skeleton->sockets) {
    if (!boneIds.contains(socket.bone)) {
      return fail(errorMessage, "Socket '" + socket.id + "' references missing bone '" + socket.bone + "'.");
    }
  }

  skeleton->boneCount = static_cast<int>(skeleton->bones.size());
  skeleton->sourcePath = path;
  skeleton->valid = true;
  return true;
}

bool loadSkeletonFile(
  const std::filesystem::path& path,
  SkeletonDefinitionSnapshot* skeleton,
  std::string* errorMessage) {
  std::ifstream stream(path);
  if (!stream.is_open()) {
    if (errorMessage) {
      *errorMessage = "Could not open animation skeleton file at " + path.string();
    }
    return false;
  }

  std::string schema;
  std::string ownerSystem;
  int schemaVersion = 0;
  std::string line;
  std::size_t lineNumber = 0;
  bool inSection = false;

  while (std::getline(stream, line)) {
    lineNumber += 1;
    const std::string cleaned = stripComment(line);
    if (cleaned.empty()) {
      continue;
    }
    if (cleaned.front() == '[') {
      inSection = true;
      continue;
    }
    if (inSection) {
      continue;
    }

    std::string key;
    std::string value;
    if (!parseKeyValue(cleaned, &key, &value)) {
      if (errorMessage) {
        *errorMessage = "Invalid animation skeleton line " + std::to_string(lineNumber) + " in " + path.string();
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
      skeleton->name = normalizeToken(parseStringValue(value));
    } else if (key == "owner_system") {
      ownerSystem = normalizeToken(parseStringValue(value));
    } else if (key == "root_bone") {
      skeleton->rootBone = normalizeToken(parseStringValue(value));
    } else if (key == "bone_count") {
      if (!parseIntValue(value, &skeleton->boneCount)) {
        if (errorMessage) {
          *errorMessage = "Invalid bone_count in " + path.string();
        }
        return false;
      }
    } else if (key == "bones") {
      skeleton->bones = splitListValue(value);
    }
  }

  skeleton->sourcePath = path;

  if (schema != "shader_forge_skeleton") {
    if (errorMessage) {
      *errorMessage = "Animation skeleton schema must be 'shader_forge.skeleton' in " + path.string();
    }
    return false;
  }
  if (schemaVersion == 2) {
    *skeleton = SkeletonDefinitionSnapshot{};
    return loadSkeletonV2File(path, skeleton, errorMessage);
  }
  if (schemaVersion != 1) {
    if (errorMessage) {
      *errorMessage = "Unsupported animation skeleton schema_version in " + path.string();
    }
    return false;
  }
  if (ownerSystem != "animation_system") {
    if (errorMessage) {
      *errorMessage = "Animation skeleton owner_system must be 'animation_system' in " + path.string();
    }
    return false;
  }
  if (skeleton->name.empty()) {
    if (errorMessage) {
      *errorMessage = "Animation skeleton is missing a name in " + path.string();
    }
    return false;
  }
  if (skeleton->rootBone.empty()) {
    if (errorMessage) {
      *errorMessage = "Animation skeleton '" + skeleton->name + "' is missing root_bone.";
    }
    return false;
  }
  if (skeleton->boneCount <= 0) {
    if (errorMessage) {
      *errorMessage = "Animation skeleton '" + skeleton->name + "' bone_count must be > 0.";
    }
    return false;
  }
  if (static_cast<int>(skeleton->bones.size()) != skeleton->boneCount) {
    if (errorMessage) {
      *errorMessage = "Animation skeleton '" + skeleton->name + "' bone_count does not match the listed bones.";
    }
    return false;
  }
  if (std::find(skeleton->bones.begin(), skeleton->bones.end(), skeleton->rootBone) == skeleton->bones.end()) {
    if (errorMessage) {
      *errorMessage = "Animation skeleton '" + skeleton->name + "' root_bone is not present in bones.";
    }
    return false;
  }

  skeleton->schemaVersion = 1;
  skeleton->id = skeleton->name;
  skeleton->valid = true;
  return true;
}

bool loadClipFile(
  const std::filesystem::path& path,
  const std::vector<SkeletonDefinitionSnapshot>& skeletons,
  ClipDefinitionSnapshot* clip,
  std::string* errorMessage) {
  std::ifstream stream(path);
  if (!stream.is_open()) {
    if (errorMessage) {
      *errorMessage = "Could not open animation clip file at " + path.string();
    }
    return false;
  }

  std::string schema;
  std::string ownerSystem;
  int schemaVersion = 0;
  AnimationClipEventSnapshot* currentEvent = nullptr;
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
      if (!section.starts_with("event.")) {
        if (errorMessage) {
          *errorMessage = "Invalid animation clip section '" + section + "' in " + path.string();
        }
        return false;
      }

      const std::string eventName = normalizeToken(section.substr(6));
      if (eventName.empty()) {
        if (errorMessage) {
          *errorMessage = "Animation clip section is missing an event name in " + path.string();
        }
        return false;
      }

      clip->events.push_back(AnimationClipEventSnapshot{
        .name = eventName,
        .valid = false,
      });
      currentEvent = &clip->events.back();
      continue;
    }

    std::string key;
    std::string value;
    if (!parseKeyValue(cleaned, &key, &value)) {
      if (errorMessage) {
        *errorMessage = "Invalid animation clip line " + std::to_string(lineNumber) + " in " + path.string();
      }
      return false;
    }

    if (currentEvent == nullptr) {
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
        clip->name = normalizeToken(parseStringValue(value));
      } else if (key == "owner_system") {
        ownerSystem = normalizeToken(parseStringValue(value));
      } else if (key == "skeleton") {
        clip->skeletonName = parseStringValue(value);
      } else if (key == "duration_seconds") {
        if (!parseDoubleValue(value, &clip->durationSeconds)) {
          if (errorMessage) {
            *errorMessage = "Invalid duration_seconds in " + path.string();
          }
          return false;
        }
      } else if (key == "loop") {
        if (!parseBoolValue(value, &clip->loop)) {
          if (errorMessage) {
            *errorMessage = "Invalid loop flag in " + path.string();
          }
          return false;
        }
      } else if (key == "root_motion_meters") {
        if (!parseDoubleValue(value, &clip->rootMotionMeters)) {
          if (errorMessage) {
            *errorMessage = "Invalid root_motion_meters in " + path.string();
          }
          return false;
        }
      }
      continue;
    }

    if (key == "time_seconds") {
      if (!parseDoubleValue(value, &currentEvent->timeSeconds)) {
        if (errorMessage) {
          *errorMessage = "Invalid event time_seconds in " + path.string();
        }
        return false;
      }
    } else if (key == "type") {
      currentEvent->type = normalizeToken(parseStringValue(value));
    } else if (key == "target") {
      currentEvent->target = normalizeToken(parseStringValue(value));
    }
  }

  clip->sourcePath = path;

  if (schema != "shader_forge_animation_clip") {
    if (errorMessage) {
      *errorMessage = "Animation clip schema must be 'shader_forge.animation_clip' in " + path.string();
    }
    return false;
  }
  if (schemaVersion <= 0) {
    if (errorMessage) {
      *errorMessage = "Animation clip schema_version must be a positive integer in " + path.string();
    }
    return false;
  }
  if (ownerSystem != "animation_system") {
    if (errorMessage) {
      *errorMessage = "Animation clip owner_system must be 'animation_system' in " + path.string();
    }
    return false;
  }
  if (clip->name.empty()) {
    if (errorMessage) {
      *errorMessage = "Animation clip is missing a name in " + path.string();
    }
    return false;
  }
  const SkeletonDefinitionSnapshot* clipSkeleton = findSkeletonByName(skeletons, clip->skeletonName);
  if (clipSkeleton == nullptr) {
    if (errorMessage) {
      *errorMessage = "Animation clip '" + clip->name + "' references missing skeleton '" + clip->skeletonName + "'.";
    }
    return false;
  }
  if (clipSkeleton->schemaVersion == 2 && clip->skeletonName != clipSkeleton->id) {
    return fail(errorMessage, "Animation clip '" + clip->name + "' must reference its v2 skeleton by stable id.");
  }
  if (clip->durationSeconds <= 0.0) {
    if (errorMessage) {
      *errorMessage = "Animation clip '" + clip->name + "' duration_seconds must be > 0.";
    }
    return false;
  }
  for (auto& eventSnapshot : clip->events) {
    if (eventSnapshot.timeSeconds < 0.0 || eventSnapshot.timeSeconds > clip->durationSeconds) {
      if (errorMessage) {
        *errorMessage = "Animation clip event '" + eventSnapshot.name + "' is out of range in clip '" + clip->name + "'.";
      }
      return false;
    }
    if (eventSnapshot.type != "audio_event" && eventSnapshot.type != "marker" && eventSnapshot.type != "vfx_event") {
      if (errorMessage) {
        *errorMessage = "Animation clip event '" + eventSnapshot.name + "' has unsupported type '" + eventSnapshot.type + "'.";
      }
      return false;
    }
    if (eventSnapshot.target.empty()) {
      if (errorMessage) {
        *errorMessage = "Animation clip event '" + eventSnapshot.name + "' is missing a target.";
      }
      return false;
    }
    eventSnapshot.valid = true;
  }

  clip->valid = true;
  return true;
}

bool loadGraphFile(
  const std::filesystem::path& path,
  const std::vector<SkeletonDefinitionSnapshot>& skeletons,
  const std::vector<ClipDefinitionSnapshot>& clips,
  GraphDefinitionSnapshot* graph,
  std::string* errorMessage) {
  std::ifstream stream(path);
  if (!stream.is_open()) {
    if (errorMessage) {
      *errorMessage = "Could not open animation graph file at " + path.string();
    }
    return false;
  }

  std::string schema;
  std::string ownerSystem;
  int schemaVersion = 0;
  AnimationGraphParameterSnapshot* currentParameter = nullptr;
  AnimationGraphStateSnapshot* currentState = nullptr;
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
      currentParameter = nullptr;
      currentState = nullptr;
      if (section.starts_with("parameter.")) {
        const std::string parameterName = normalizeToken(section.substr(10));
        if (parameterName.empty()) {
          if (errorMessage) {
            *errorMessage = "Animation graph parameter section is missing a name in " + path.string();
          }
          return false;
        }
        graph->parameters.push_back(AnimationGraphParameterSnapshot{
          .name = parameterName,
          .valid = false,
        });
        currentParameter = &graph->parameters.back();
        continue;
      }
      if (section.starts_with("state.")) {
        const std::string stateName = normalizeToken(section.substr(6));
        if (stateName.empty()) {
          if (errorMessage) {
            *errorMessage = "Animation graph state section is missing a name in " + path.string();
          }
          return false;
        }
        if (findStateByName(graph->states, stateName) != nullptr) {
          return fail(errorMessage, "Duplicate animation graph state '" + stateName + "' in " + path.string());
        }
        graph->states.push_back(AnimationGraphStateSnapshot{
          .name = stateName,
          .valid = false,
        });
        currentState = &graph->states.back();
        continue;
      }
      if (errorMessage) {
        *errorMessage = "Invalid animation graph section '" + section + "' in " + path.string();
      }
      return false;
    }

    std::string key;
    std::string value;
    if (!parseKeyValue(cleaned, &key, &value)) {
      if (errorMessage) {
        *errorMessage = "Invalid animation graph line " + std::to_string(lineNumber) + " in " + path.string();
      }
      return false;
    }

    if (currentParameter != nullptr) {
      if (key == "type") {
        currentParameter->type = normalizeToken(parseStringValue(value));
      } else if (key == "default_value") {
        if (!parseDoubleValue(value, &currentParameter->defaultFloatValue)) {
          if (errorMessage) {
            *errorMessage = "Invalid parameter default_value in " + path.string();
          }
          return false;
        }
      }
      continue;
    }

    if (currentState != nullptr) {
      if (key == "clip") {
        currentState->clip = normalizeToken(parseStringValue(value));
      } else if (key == "speed") {
        if (!parseDoubleValue(value, &currentState->speed)) {
          if (errorMessage) {
            *errorMessage = "Invalid state speed in " + path.string();
          }
          return false;
        }
      } else if (key == "loop") {
        if (!parseBoolValue(value, &currentState->loop)) {
          if (errorMessage) {
            *errorMessage = "Invalid state loop flag in " + path.string();
          }
          return false;
        }
      }
      continue;
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
      graph->name = normalizeToken(parseStringValue(value));
    } else if (key == "owner_system") {
      ownerSystem = normalizeToken(parseStringValue(value));
    } else if (key == "skeleton") {
      graph->skeletonName = parseStringValue(value);
    } else if (key == "entry_state") {
      graph->entryState = normalizeToken(parseStringValue(value));
    }
  }

  graph->sourcePath = path;

  if (schema != "shader_forge_animation_graph") {
    if (errorMessage) {
      *errorMessage = "Animation graph schema must be 'shader_forge.animation_graph' in " + path.string();
    }
    return false;
  }
  if (schemaVersion <= 0) {
    if (errorMessage) {
      *errorMessage = "Animation graph schema_version must be a positive integer in " + path.string();
    }
    return false;
  }
  if (ownerSystem != "animation_system") {
    if (errorMessage) {
      *errorMessage = "Animation graph owner_system must be 'animation_system' in " + path.string();
    }
    return false;
  }
  if (graph->name.empty()) {
    if (errorMessage) {
      *errorMessage = "Animation graph is missing a name in " + path.string();
    }
    return false;
  }
  const SkeletonDefinitionSnapshot* graphSkeleton = findSkeletonByName(skeletons, graph->skeletonName);
  if (graphSkeleton == nullptr) {
    if (errorMessage) {
      *errorMessage = "Animation graph '" + graph->name + "' references missing skeleton '" + graph->skeletonName + "'.";
    }
    return false;
  }
  if (graphSkeleton->schemaVersion == 2 && graph->skeletonName != graphSkeleton->id) {
    return fail(errorMessage, "Animation graph '" + graph->name + "' must reference its v2 skeleton by stable id.");
  }
  if (graph->states.empty()) {
    if (errorMessage) {
      *errorMessage = "Animation graph '" + graph->name + "' does not define any states.";
    }
    return false;
  }
  if (findStateByName(graph->states, graph->entryState) == nullptr) {
    if (errorMessage) {
      *errorMessage = "Animation graph '" + graph->name + "' entry_state '" + graph->entryState + "' is not defined.";
    }
    return false;
  }

  for (auto& parameter : graph->parameters) {
    if (parameter.type != "float") {
      if (errorMessage) {
        *errorMessage = "Animation graph parameter '" + parameter.name + "' must currently use type 'float'.";
      }
      return false;
    }
    parameter.valid = true;
  }

  for (auto& state : graph->states) {
    const ClipDefinitionSnapshot* clip = findClipByName(clips, state.clip);
    if (clip == nullptr) {
      if (errorMessage) {
        *errorMessage = "Animation graph state '" + state.name + "' references missing clip '" + state.clip + "'.";
      }
      return false;
    }
    if (clip->skeletonName != graph->skeletonName) {
      if (errorMessage) {
        *errorMessage = "Animation graph state '" + state.name + "' clip '" + state.clip + "' uses a different skeleton.";
      }
      return false;
    }
    if (state.speed <= 0.0) {
      if (errorMessage) {
        *errorMessage = "Animation graph state '" + state.name + "' speed must be > 0.";
      }
      return false;
    }
    state.valid = true;
  }

  graph->valid = true;
  return true;
}

bool loadAttachmentProfileFile(
  const std::filesystem::path& path,
  const std::vector<SkeletonDefinitionSnapshot>& skeletons,
  const std::vector<ClipDefinitionSnapshot>& clips,
  AttachmentProfileSnapshot* profile,
  std::string* errorMessage) {
  StrictDocument document;
  if (!parseStrictDocument(path, &document, errorMessage)) {
    return false;
  }
  const std::string context = path.string();
  if (!requireOnlyKeys(
        document.top,
        {"schema", "schema_version", "id", "name", "owner_system", "skeleton", "item_prefab", "dominant_hand", "mode", "perspective"},
        context,
        errorMessage)) {
    return false;
  }

  std::string schema;
  std::string ownerSystem;
  int schemaVersion = 0;
  if (!readString(document.top, "schema", &schema, context, errorMessage)
      || !readInt(document.top, "schema_version", &schemaVersion, context, errorMessage)
      || !readString(document.top, "id", &profile->id, context, errorMessage)
      || !readString(document.top, "name", &profile->name, context, errorMessage)
      || !readString(document.top, "owner_system", &ownerSystem, context, errorMessage)
      || !readString(document.top, "skeleton", &profile->skeletonId, context, errorMessage)
      || !readString(document.top, "item_prefab", &profile->itemPrefab, context, errorMessage)
      || !readString(document.top, "dominant_hand", &profile->dominantHand, context, errorMessage)
      || !readString(document.top, "mode", &profile->mode, context, errorMessage)
      || !readString(document.top, "perspective", &profile->perspective, context, errorMessage)) {
    return false;
  }
  if (schema != "shader_forge.attachment_profile" || schemaVersion != 1 || ownerSystem != "animation_system") {
    return fail(errorMessage, "Invalid attachment profile header in " + context);
  }
  if (profile->dominantHand != "right" && profile->dominantHand != "left") {
    return fail(errorMessage, "Attachment dominant_hand must be right or left in " + context);
  }
  if (profile->mode != "one_hand" && profile->mode != "two_hand") {
    return fail(errorMessage, "Attachment mode must be one_hand or two_hand in " + context);
  }
  if (profile->perspective != "first_person" && profile->perspective != "third_person" && profile->perspective != "both") {
    return fail(errorMessage, "Invalid attachment perspective in " + context);
  }

  const SkeletonDefinitionSnapshot* skeleton = findSkeletonById(skeletons, profile->skeletonId);
  if (skeleton == nullptr) {
    return fail(errorMessage, "Attachment references missing skeleton '" + profile->skeletonId + "'.");
  }
  if (skeleton->schemaVersion != 2) {
    return fail(errorMessage, "Attachment skeleton must use schema_version 2 in " + context);
  }
  profile->skeletonHandle = skeleton->handle;

  bool hasPrimaryGrip = false;
  bool hasSecondaryHeader = false;
  bool hasSecondaryTarget = false;
  bool hasSecondaryPole = false;
  bool hasSecondaryTolerances = false;
  AttachmentSecondaryHandSnapshot secondary;

  for (const auto& [section, table] : document.sections) {
    if (section == "primary_grip") {
      if (!requireOnlyKeys(table, {"socket", "space", "translation", "rotation"}, section, errorMessage)
          || !readString(table, "socket", &profile->primaryGrip.socket, section, errorMessage)
          || !readString(table, "space", &profile->primaryGrip.space, section, errorMessage)
          || !readVector3(table, "translation", &profile->primaryGrip.translation, section, errorMessage)
          || !readQuaternion(table, "rotation", &profile->primaryGrip.rotation, section, errorMessage)) {
        return false;
      }
      hasPrimaryGrip = true;
      continue;
    }
    if (section == "primary_contact") {
      AttachmentContactFrameSnapshot contact;
      if (!requireOnlyKeys(table, {"translation", "rotation"}, section, errorMessage)
          || !readVector3(table, "translation", &contact.translation, section, errorMessage)
          || !readQuaternion(table, "rotation", &contact.rotation, section, errorMessage)) {
        return false;
      }
      profile->primaryContact = contact;
      continue;
    }
    if (section == "handle_axis") {
      AttachmentHandleAxisSnapshot axis;
      if (!requireOnlyKeys(table, {"origin", "direction"}, section, errorMessage)
          || !readVector3(table, "origin", &axis.origin, section, errorMessage)
          || !readVector3(table, "direction", &axis.direction, section, errorMessage)) {
        return false;
      }
      const double length = std::sqrt(
        axis.direction.x * axis.direction.x
        + axis.direction.y * axis.direction.y
        + axis.direction.z * axis.direction.z);
      if (std::abs(length - 1.0) > 1e-6) {
        return fail(errorMessage, "Attachment handle_axis direction must be normalized in " + context);
      }
      profile->handleAxis = axis;
      continue;
    }
    if (section == "secondary_hand") {
      if (!requireOnlyKeys(table, {"enabled", "joint_limit_policy"}, section, errorMessage)) {
        return false;
      }
      const std::string* rawEnabled = nullptr;
      if (!getRequired(table, "enabled", &rawEnabled, section, errorMessage)
          || !parseStrictBool(*rawEnabled, &secondary.enabled)) {
        return fail(errorMessage, "Invalid secondary_hand section in " + context);
      }
      if (const auto policy = table.find("joint_limit_policy"); policy != table.end()) {
        if (!parseStrictString(policy->second, &secondary.jointLimitPolicy)
            || (secondary.jointLimitPolicy != "diagnose" && secondary.jointLimitPolicy != "clamp_and_diagnose")) {
          return fail(errorMessage, "Invalid joint_limit_policy in " + context);
        }
      }
      if (secondary.enabled && secondary.jointLimitPolicy.empty()) {
        return fail(errorMessage, "Enabled secondary_hand requires joint_limit_policy in " + context);
      }
      hasSecondaryHeader = true;
      continue;
    }
    if (section == "secondary_hand.target") {
      if (!requireOnlyKeys(table, {"translation", "rotation"}, section, errorMessage)
          || !readVector3(table, "translation", &secondary.targetTranslation, section, errorMessage)
          || !readQuaternion(table, "rotation", &secondary.targetRotation, section, errorMessage)) {
        return false;
      }
      hasSecondaryTarget = true;
      continue;
    }
    if (section == "secondary_hand.pole") {
      if (!requireOnlyKeys(table, {"translation"}, section, errorMessage)
          || !readVector3(table, "translation", &secondary.poleTranslation, section, errorMessage)) {
        return false;
      }
      hasSecondaryPole = true;
      continue;
    }
    if (section == "secondary_hand.tolerances") {
      if (!requireOnlyKeys(table, {"reach_meters", "angle_degrees", "contact_meters"}, section, errorMessage)) {
        return false;
      }
      const std::string* rawReach = nullptr;
      const std::string* rawAngle = nullptr;
      const std::string* rawContact = nullptr;
      if (!getRequired(table, "reach_meters", &rawReach, section, errorMessage)
          || !getRequired(table, "angle_degrees", &rawAngle, section, errorMessage)
          || !getRequired(table, "contact_meters", &rawContact, section, errorMessage)
          || !parseStrictDouble(*rawReach, &secondary.reachMeters)
          || !parseStrictDouble(*rawAngle, &secondary.angleDegrees)
          || !parseStrictDouble(*rawContact, &secondary.contactMeters)
          || secondary.reachMeters < 0.0
          || secondary.angleDegrees < 0.0 || secondary.angleDegrees > 180.0
          || secondary.contactMeters < 0.0) {
        return fail(errorMessage, "Invalid secondary_hand tolerances in " + context);
      }
      hasSecondaryTolerances = true;
      continue;
    }
    if (section.starts_with("motion_envelope.")) {
      AttachmentMotionEnvelopeSnapshot envelope;
      envelope.phase = section.substr(std::string("motion_envelope.").size());
      if (envelope.phase.empty()
          || !requireOnlyKeys(table, {"clip", "normalized_times", "procedural_layers"}, section, errorMessage)
          || !readString(table, "clip", &envelope.clip, section, errorMessage)) {
        return false;
      }
      const std::string* rawTimes = nullptr;
      if (!getRequired(table, "normalized_times", &rawTimes, section, errorMessage)
          || !parseNumberArray(*rawTimes, &envelope.normalizedTimes)) {
        return fail(errorMessage, "Invalid normalized_times in " + section);
      }
      for (const double time : envelope.normalizedTimes) {
        if (time < 0.0 || time > 1.0) {
          return fail(errorMessage, "Motion envelope normalized_times must be between 0 and 1 in " + section);
        }
      }
      if (const auto layers = table.find("procedural_layers"); layers != table.end()) {
        if (!parseStringArray(layers->second, &envelope.proceduralLayers)) {
          return fail(errorMessage, "Invalid procedural_layers in " + section);
        }
      } else if (profile->mode == "two_hand") {
        envelope.proceduralLayers = {"primary_attachment", "secondary_hand_ik"};
      }
      const ClipDefinitionSnapshot* clip = findClipByName(clips, envelope.clip);
      if (clip == nullptr) {
        return fail(errorMessage, "Motion envelope references missing clip '" + envelope.clip + "'.");
      }
      if (clip->skeletonName != skeleton->id && clip->skeletonName != skeleton->name) {
        return fail(errorMessage, "Motion envelope clip uses a different skeleton in " + section);
      }
      profile->motionEnvelopes.push_back(std::move(envelope));
      continue;
    }
    return fail(errorMessage, "Unknown attachment section '" + section + "' in " + context);
  }

  if (!hasPrimaryGrip || profile->primaryGrip.space != "socket") {
    return fail(errorMessage, "Attachment requires a socket-local primary_grip in " + context);
  }
  const auto socket = std::find_if(skeleton->sockets.begin(), skeleton->sockets.end(), [&](const auto& value) {
    return value.id == profile->primaryGrip.socket;
  });
  if (socket == skeleton->sockets.end() || socket->role != "primary_grip") {
    return fail(errorMessage, "Attachment primary_grip references a missing or non-primary socket in " + context);
  }
  profile->primaryGrip.socketHandle = socket->handle;
  const std::string dominantRole = profile->dominantHand == "right" ? "hand_r" : "hand_l";
  const std::string secondaryRole = profile->dominantHand == "right" ? "hand_l" : "hand_r";
  const auto hasRole = [&](std::string_view role) {
    return std::any_of(skeleton->boneDefinitions.begin(), skeleton->boneDefinitions.end(), [&](const auto& bone) {
      return bone.role == role;
    });
  };
  const auto socketBone = std::find_if(skeleton->boneDefinitions.begin(), skeleton->boneDefinitions.end(), [&](const auto& bone) {
    return bone.id == socket->bone;
  });
  if (!hasRole(dominantRole) || socketBone == skeleton->boneDefinitions.end() || socketBone->role != dominantRole) {
    return fail(errorMessage, "Attachment primary socket is not on the dominant hand in " + context);
  }

  if (profile->mode == "two_hand") {
    if (!hasRole(secondaryRole) || !hasSecondaryHeader || !secondary.enabled
        || !hasSecondaryTarget || !hasSecondaryPole || !hasSecondaryTolerances) {
      return fail(errorMessage, "Two-hand attachment is missing required secondary-hand data in " + context);
    }
    profile->secondaryHand = secondary;
  } else {
    if (hasSecondaryTarget || hasSecondaryPole || hasSecondaryTolerances || (hasSecondaryHeader && secondary.enabled)) {
      return fail(errorMessage, "One-hand attachment cannot enable or define secondary-hand data in " + context);
    }
    if (hasSecondaryHeader) {
      profile->secondaryHand = secondary;
    }
  }

  profile->sourcePath = path;
  profile->valid = true;
  return true;
}

}  // namespace

struct AnimationSystem::Impl {
  AnimationConfig config;
  std::vector<SkeletonDefinitionSnapshot> skeletons;
  std::vector<ClipDefinitionSnapshot> clips;
  std::vector<GraphDefinitionSnapshot> graphs;
  std::vector<AttachmentProfileSnapshot> attachmentProfiles;
  std::uint64_t generation = 0;

  bool load(const AnimationConfig& nextConfig, std::string* errorMessage) {
    std::vector<SkeletonDefinitionSnapshot> nextSkeletons;
    std::vector<ClipDefinitionSnapshot> nextClips;
    std::vector<GraphDefinitionSnapshot> nextGraphs;
    std::vector<AttachmentProfileSnapshot> nextAttachmentProfiles;
    const std::uint64_t nextGeneration = generation + 1;
    if (nextGeneration == 0) {
      return fail(errorMessage, "Animation handle generation overflow.");
    }
    std::uint64_t nextBoneIndex = 1;
    std::uint64_t nextSocketIndex = 1;

    const std::filesystem::path skeletonsPath = nextConfig.rootPath / "skeletons";
    const std::filesystem::path clipsPath = nextConfig.rootPath / "clips";
    const std::filesystem::path graphsPath = nextConfig.rootPath / "graphs";
    const std::filesystem::path attachmentsPath = nextConfig.rootPath / "attachments";

    const auto requireDirectory = [&](const std::filesystem::path& path, std::string_view label) {
      std::error_code error;
      const bool directory = std::filesystem::is_directory(path, error);
      if (error) {
        return fail(errorMessage, "Could not inspect animation " + std::string(label) + " directory '" + path.string() + "': " + error.message());
      }
      if (!directory) {
        return fail(errorMessage, "Animation " + std::string(label) + " root is not a directory: " + path.string());
      }
      return true;
    };
    if (!requireDirectory(skeletonsPath, "skeletons")
        || !requireDirectory(clipsPath, "clips")
        || !requireDirectory(graphsPath, "graphs")) {
      return false;
    }

    std::vector<std::filesystem::path> skeletonFiles;
    if (!sortedRegularFilesWithSuffix(skeletonsPath, ".skeleton.toml", &skeletonFiles, errorMessage)) {
      return false;
    }
    for (const auto& filePath : skeletonFiles) {
      SkeletonDefinitionSnapshot skeleton;
      if (!loadSkeletonFile(filePath, &skeleton, errorMessage)) {
        return false;
      }
      if (std::any_of(nextSkeletons.begin(), nextSkeletons.end(), [&](const auto& existing) {
            return existing.id == skeleton.id || existing.name == skeleton.name
              || existing.id == skeleton.name || existing.name == skeleton.id;
          })) {
        return fail(errorMessage, "Duplicate animation skeleton id or name '" + skeleton.id + "'.");
      }
      skeleton.handle = SkeletonId{nextGeneration, static_cast<std::uint64_t>(nextSkeletons.size() + 1)};
      for (auto& bone : skeleton.boneDefinitions) {
        bone.handle = BoneId{nextGeneration, nextBoneIndex++};
      }
      for (auto& socket : skeleton.sockets) {
        socket.handle = SocketId{nextGeneration, nextSocketIndex++};
      }
      nextSkeletons.push_back(std::move(skeleton));
    }

    if (nextSkeletons.empty()) {
      if (errorMessage) {
        *errorMessage = "Animation system does not have any skeleton definitions under " + skeletonsPath.string();
      }
      return false;
    }

    std::vector<std::filesystem::path> clipFiles;
    if (!sortedRegularFilesWithSuffix(clipsPath, ".anim.toml", &clipFiles, errorMessage)) {
      return false;
    }
    for (const auto& filePath : clipFiles) {
      ClipDefinitionSnapshot clip;
      if (!loadClipFile(filePath, nextSkeletons, &clip, errorMessage)) {
        return false;
      }
      if (findClipByName(nextClips, clip.name) != nullptr) {
        return fail(errorMessage, "Duplicate animation clip name '" + clip.name + "'.");
      }
      nextClips.push_back(std::move(clip));
    }

    if (nextClips.empty()) {
      if (errorMessage) {
        *errorMessage = "Animation system does not have any clip definitions under " + clipsPath.string();
      }
      return false;
    }

    std::vector<std::filesystem::path> graphFiles;
    if (!sortedRegularFilesWithSuffix(graphsPath, ".animgraph.toml", &graphFiles, errorMessage)) {
      return false;
    }
    for (const auto& filePath : graphFiles) {
      GraphDefinitionSnapshot graph;
      if (!loadGraphFile(filePath, nextSkeletons, nextClips, &graph, errorMessage)) {
        return false;
      }
      if (std::any_of(nextGraphs.begin(), nextGraphs.end(), [&](const auto& existing) {
            return existing.name == graph.name;
          })) {
        return fail(errorMessage, "Duplicate animation graph name '" + graph.name + "'.");
      }
      nextGraphs.push_back(std::move(graph));
    }

    if (nextGraphs.empty()) {
      if (errorMessage) {
        *errorMessage = "Animation system does not have any graph definitions under " + graphsPath.string();
      }
      return false;
    }

    std::error_code attachmentsError;
    const bool attachmentsExist = std::filesystem::exists(attachmentsPath, attachmentsError);
    if (attachmentsError) {
      return fail(errorMessage, "Could not inspect animation attachments root '" + attachmentsPath.string() + "': " + attachmentsError.message());
    }
    if (attachmentsExist) {
      if (!std::filesystem::is_directory(attachmentsPath, attachmentsError) || attachmentsError) {
        return fail(errorMessage, "Animation attachments path is not a directory: " + attachmentsPath.string());
      }
      std::vector<std::filesystem::path> attachmentFiles;
      if (!sortedRegularFilesWithSuffix(attachmentsPath, ".attachment.toml", &attachmentFiles, errorMessage)) {
        return false;
      }
      for (const auto& filePath : attachmentFiles) {
        AttachmentProfileSnapshot profile;
        if (!loadAttachmentProfileFile(filePath, nextSkeletons, nextClips, &profile, errorMessage)) {
          return false;
        }
        if (std::any_of(nextAttachmentProfiles.begin(), nextAttachmentProfiles.end(), [&](const auto& existing) {
              return existing.id == profile.id;
            })) {
          return fail(errorMessage, "Duplicate attachment profile id '" + profile.id + "'.");
        }
        profile.handle = AttachmentProfileId{nextGeneration, static_cast<std::uint64_t>(nextAttachmentProfiles.size() + 1)};
        nextAttachmentProfiles.push_back(std::move(profile));
      }
    }

    config = nextConfig;
    skeletons = std::move(nextSkeletons);
    clips = std::move(nextClips);
    graphs = std::move(nextGraphs);
    attachmentProfiles = std::move(nextAttachmentProfiles);
    generation = nextGeneration;
    return true;
  }
};

AnimationSystem::AnimationSystem()
    : impl_(std::make_unique<Impl>()) {}

AnimationSystem::~AnimationSystem() = default;

AnimationSystem::AnimationSystem(AnimationSystem&&) noexcept = default;

AnimationSystem& AnimationSystem::operator=(AnimationSystem&&) noexcept = default;

bool AnimationSystem::loadFromDisk(const AnimationConfig& config, std::string* errorMessage) {
  return impl_->load(config, errorMessage);
}

std::size_t AnimationSystem::skeletonCount() const {
  return impl_->skeletons.size();
}

std::size_t AnimationSystem::clipCount() const {
  return impl_->clips.size();
}

std::size_t AnimationSystem::graphCount() const {
  return impl_->graphs.size();
}

std::size_t AnimationSystem::attachmentProfileCount() const {
  return impl_->attachmentProfiles.size();
}

bool AnimationSystem::hasGraph(std::string_view graphName) const {
  const std::string normalized = normalizeToken(std::string(graphName));
  for (const auto& graph : impl_->graphs) {
    if (graph.name == normalized) {
      return true;
    }
  }
  return false;
}

std::optional<std::string> AnimationSystem::defaultGraphName() const {
  if (impl_->graphs.empty()) {
    return std::nullopt;
  }
  return impl_->graphs.front().name;
}

std::vector<SkeletonDefinitionSnapshot> AnimationSystem::snapshotSkeletons() const {
  return impl_->skeletons;
}

std::vector<ClipDefinitionSnapshot> AnimationSystem::snapshotClips() const {
  return impl_->clips;
}

std::vector<GraphDefinitionSnapshot> AnimationSystem::snapshotGraphs() const {
  return impl_->graphs;
}

std::vector<AttachmentProfileSnapshot> AnimationSystem::snapshotAttachmentProfiles() const {
  return impl_->attachmentProfiles;
}

std::optional<SkeletonId> AnimationSystem::findSkeletonId(std::string_view id) const {
  if (const auto* skeleton = findSkeletonById(impl_->skeletons, id); skeleton != nullptr) {
    return skeleton->handle;
  }
  return std::nullopt;
}

std::optional<AttachmentProfileId> AnimationSystem::findAttachmentProfileId(std::string_view id) const {
  for (const auto& profile : impl_->attachmentProfiles) {
    if (profile.id == id) {
      return profile.handle;
    }
  }
  return std::nullopt;
}

std::optional<SkeletonDefinitionSnapshot> AnimationSystem::snapshotSkeleton(SkeletonId id) const {
  for (const auto& skeleton : impl_->skeletons) {
    if (skeleton.handle == id) {
      return skeleton;
    }
  }
  return std::nullopt;
}

std::optional<AttachmentProfileSnapshot> AnimationSystem::snapshotAttachmentProfile(AttachmentProfileId id) const {
  for (const auto& profile : impl_->attachmentProfiles) {
    if (profile.handle == id) {
      return profile;
    }
  }
  return std::nullopt;
}

std::optional<SkeletonDefinitionSnapshot> AnimationSystem::findSkeleton(std::string_view idOrName) const {
  if (const auto* skeleton = findSkeletonByName(impl_->skeletons, idOrName); skeleton != nullptr) {
    return *skeleton;
  }
  return std::nullopt;
}

std::optional<AttachmentProfileSnapshot> AnimationSystem::findAttachmentProfile(std::string_view id) const {
  for (const auto& profile : impl_->attachmentProfiles) {
    if (profile.id == id) {
      return profile;
    }
  }
  return std::nullopt;
}

std::optional<ResolvedAnimationGraphSnapshot> AnimationSystem::resolveGraph(std::string_view graphName) const {
  const std::string normalized = normalizeToken(std::string(graphName));
  for (const auto& graph : impl_->graphs) {
    if (graph.name != normalized) {
      continue;
    }

    ResolvedAnimationGraphSnapshot resolved;
    resolved.graphName = graph.name;
    resolved.skeletonName = graph.skeletonName;
    resolved.entryState = graph.entryState;
    for (const auto& state : graph.states) {
      resolved.stateNames.push_back(state.name);
      resolved.clipNames.push_back(state.clip);
      if (state.name == graph.entryState) {
        resolved.entryClipName = state.clip;
        if (const ClipDefinitionSnapshot* clip = findClipByName(impl_->clips, state.clip); clip != nullptr) {
          resolved.entryClipEvents = clip->events;
        }
      }
    }
    return resolved;
  }
  return std::nullopt;
}

std::optional<ResolvedAnimationStateSnapshot> AnimationSystem::resolveGraphState(
  std::string_view graphName,
  std::string_view stateName) const {
  const std::string normalizedGraph = normalizeToken(std::string(graphName));
  const std::string normalizedState = normalizeToken(std::string(stateName));
  for (const auto& graph : impl_->graphs) {
    if (graph.name != normalizedGraph) {
      continue;
    }

    const AnimationGraphStateSnapshot* state = findStateByName(graph.states, normalizedState);
    if (state == nullptr) {
      return std::nullopt;
    }

    const ClipDefinitionSnapshot* clip = findClipByName(impl_->clips, state->clip);
    if (clip == nullptr) {
      return std::nullopt;
    }

    ResolvedAnimationStateSnapshot resolved;
    resolved.graphName = graph.name;
    resolved.stateName = state->name;
    resolved.skeletonName = graph.skeletonName;
    resolved.clipName = clip->name;
    resolved.speed = state->speed;
    resolved.loop = state->loop;
    resolved.durationSeconds = clip->durationSeconds;
    resolved.rootMotionMeters = clip->rootMotionMeters;
    resolved.clipEvents = clip->events;
    return resolved;
  }
  return std::nullopt;
}

std::string AnimationSystem::foundationSummary() const {
  std::ostringstream summary;
  summary << "Animation foundation: root=" << relativePathString(impl_->config.rootPath)
          << ", skeletons=" << impl_->skeletons.size()
          << ", clips=" << impl_->clips.size()
          << ", graphs=" << impl_->graphs.size()
          << ", attachments=" << impl_->attachmentProfiles.size();
  return summary.str();
}

std::string AnimationSystem::graphCatalogSummary() const {
  std::ostringstream summary;
  for (const auto& graph : impl_->graphs) {
    summary << "anim-graph " << graph.name
            << " -> skeleton=" << graph.skeletonName
            << ", entry_state=" << graph.entryState
            << ", states=" << graph.states.size()
            << ", parameters=" << graph.parameters.size() << '\n';
    for (const auto& state : graph.states) {
      summary << "anim-state " << graph.name << '.' << state.name
              << " -> clip=" << state.clip
              << ", speed=" << state.speed
              << ", loop=" << (state.loop ? "true" : "false") << '\n';
      if (const ClipDefinitionSnapshot* clip = findClipByName(impl_->clips, state.clip); clip != nullptr) {
        for (const auto& eventSnapshot : clip->events) {
          summary << "anim-event " << clip->name << '.' << eventSnapshot.name
                  << " -> type=" << eventSnapshot.type
                  << ", target=" << eventSnapshot.target
                  << ", time=" << eventSnapshot.timeSeconds << '\n';
        }
      }
    }
  }
  return summary.str();
}

}  // namespace shader_forge::runtime
