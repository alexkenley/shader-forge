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

bool isValidUtf8(std::string_view value) {
  const auto* bytes = reinterpret_cast<const unsigned char*>(value.data());
  std::size_t index = 0;
  while (index < value.size()) {
    const unsigned char lead = bytes[index++];
    if (lead <= 0x7f) continue;
    int continuationCount = 0;
    unsigned char firstMinimum = 0x80;
    unsigned char firstMaximum = 0xbf;
    if (lead >= 0xc2 && lead <= 0xdf) {
      continuationCount = 1;
    } else if (lead >= 0xe0 && lead <= 0xef) {
      continuationCount = 2;
      if (lead == 0xe0) firstMinimum = 0xa0;
      if (lead == 0xed) firstMaximum = 0x9f;
    } else if (lead >= 0xf0 && lead <= 0xf4) {
      continuationCount = 3;
      if (lead == 0xf0) firstMinimum = 0x90;
      if (lead == 0xf4) firstMaximum = 0x8f;
    } else {
      return false;
    }
    if (index + static_cast<std::size_t>(continuationCount) > value.size()) return false;
    if (bytes[index] < firstMinimum || bytes[index] > firstMaximum) return false;
    index += 1;
    for (int continuation = 1; continuation < continuationCount; ++continuation, ++index) {
      if (bytes[index] < 0x80 || bytes[index] > 0xbf) return false;
    }
  }
  return true;
}

std::string utf8Path(const std::filesystem::path& path) {
  const std::u8string value = path.generic_u8string();
  return std::string(reinterpret_cast<const char*>(value.data()), value.size());
}

bool validateUtf8File(const std::filesystem::path& path, std::string* errorMessage) {
  const std::string serializedPath = utf8Path(path);
  if (!isValidUtf8(serializedPath)) {
    return fail(errorMessage, "Animation source path is not valid UTF-8.");
  }
  std::ifstream stream(path, std::ios::binary);
  if (!stream.is_open()) {
    return fail(errorMessage, "Could not open animation source file at " + serializedPath);
  }
  std::ostringstream content;
  content << stream.rdbuf();
  if (!stream.good() && !stream.eof()) {
    return fail(errorMessage, "Could not read animation source file at " + serializedPath);
  }
  if (!isValidUtf8(content.str())) {
    return fail(errorMessage, "Animation source file is not valid UTF-8: " + serializedPath);
  }
  return true;
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

bool vectorIsUnitLength(const SpatialVector3Snapshot& value) {
  const double length = std::sqrt(value.x * value.x + value.y * value.y + value.z * value.z);
  return std::isfinite(length) && std::abs(length - 1.0) <= 1e-6;
}

bool parseBoneNestedKey(std::string_view section, std::string_view suffix, std::string* boneKey) {
  constexpr std::string_view prefix = "bone.";
  if (!section.starts_with(prefix) || !section.ends_with(suffix)) {
    return false;
  }
  if (section.size() <= prefix.size() + suffix.size()) {
    return false;
  }
  *boneKey = std::string(section.substr(prefix.size(), section.size() - prefix.size() - suffix.size()));
  return !boneKey->empty();
}

bool isV2OnlyBoneNestedSection(std::string_view section) {
  std::string boneKey;
  return parseBoneNestedKey(section, ".joint_limit", &boneKey)
    || parseBoneNestedKey(section, ".diagnostic_capsule", &boneKey);
}

bool quaternionNeedsSignFlip(double x, double y, double z, double w) {
  return w < 0.0
    || (w == 0.0 && (x < 0.0 || (x == 0.0 && (y < 0.0 || (y == 0.0 && z < 0.0)))));
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
  if (quaternionNeedsSignFlip(values[0], values[1], values[2], values[3])) {
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

bool readDouble(const StrictTable& table, std::string_view key, double* value, std::string_view context, std::string* errorMessage) {
  const std::string* raw = nullptr;
  return getRequired(table, key, &raw, context, errorMessage)
    && (parseStrictDouble(*raw, value)
      ? true
      : fail(errorMessage, "Invalid number key '" + std::string(key) + "' in " + std::string(context)));
}

bool readBool(const StrictTable& table, std::string_view key, bool* value, std::string_view context, std::string* errorMessage) {
  const std::string* raw = nullptr;
  return getRequired(table, key, &raw, context, errorMessage)
    && (parseStrictBool(*raw, value)
      ? true
      : fail(errorMessage, "Invalid boolean key '" + std::string(key) + "' in " + std::string(context)));
}

bool loadBoneJointLimit(
  const StrictTable& table,
  std::string_view section,
  SkeletonBoneJointLimitSnapshot* limit,
  std::string* errorMessage) {
  if (!requireOnlyKeys(
        table,
        {"kind", "twist_axis", "swing_degrees", "twist_min_degrees", "twist_max_degrees"},
        section,
        errorMessage)
      || !readString(table, "kind", &limit->kind, section, errorMessage)
      || !readVector3(table, "twist_axis", &limit->twistAxis, section, errorMessage)
      || !readDouble(table, "swing_degrees", &limit->swingDegrees, section, errorMessage)
      || !readDouble(table, "twist_min_degrees", &limit->twistMinDegrees, section, errorMessage)
      || !readDouble(table, "twist_max_degrees", &limit->twistMaxDegrees, section, errorMessage)) {
    return false;
  }
  if (limit->kind != "cone_twist") {
    return fail(errorMessage, "Invalid joint_limit kind in " + std::string(section));
  }
  if (!vectorIsUnitLength(limit->twistAxis)) {
    return fail(errorMessage, "joint_limit twist_axis must be a normalized finite vec3 in " + std::string(section));
  }
  if (limit->swingDegrees < 0.0 || limit->swingDegrees > 180.0) {
    return fail(errorMessage, "joint_limit swing_degrees must be between 0 and 180 in " + std::string(section));
  }
  if (limit->twistMinDegrees < -180.0 || limit->twistMinDegrees > 180.0
      || limit->twistMaxDegrees < -180.0 || limit->twistMaxDegrees > 180.0
      || limit->twistMinDegrees > limit->twistMaxDegrees) {
    return fail(errorMessage, "Invalid joint_limit twist range in " + std::string(section));
  }
  return true;
}

bool loadBoneDiagnosticCapsule(
  const StrictTable& table,
  std::string_view section,
  SkeletonBoneDiagnosticCapsuleSnapshot* capsule,
  std::string* errorMessage) {
  if (!requireOnlyKeys(table, {"center", "axis", "radius", "half_length"}, section, errorMessage)
      || !readVector3(table, "center", &capsule->center, section, errorMessage)
      || !readVector3(table, "axis", &capsule->axis, section, errorMessage)
      || !readDouble(table, "radius", &capsule->radius, section, errorMessage)
      || !readDouble(table, "half_length", &capsule->halfLength, section, errorMessage)) {
    return false;
  }
  if (!vectorIsUnitLength(capsule->axis)) {
    return fail(errorMessage, "diagnostic_capsule axis must be a normalized finite vec3 in " + std::string(section));
  }
  if (capsule->radius <= 0.0 || capsule->halfLength <= 0.0) {
    return fail(errorMessage, "diagnostic_capsule radius and half_length must be finite and > 0 in " + std::string(section));
  }
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
  std::sort(files->begin(), files->end(), [](const auto& left, const auto& right) {
    return utf8Path(left) < utf8Path(right);
  });
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
  std::map<std::string, std::size_t> boneSectionIndex;
  struct PendingBoneNestedSection {
    std::string section;
    const StrictTable* table = nullptr;
    std::string boneKey;
  };
  std::vector<PendingBoneNestedSection> pendingJointLimits;
  std::vector<PendingBoneNestedSection> pendingCapsules;

  for (const auto& [section, table] : document.sections) {
    std::string nestedBoneKey;
    const bool hasBoneFields = table.contains("id") || table.contains("parent")
      || table.contains("role") || table.contains("translation") || table.contains("rotation");
    if (!hasBoneFields && parseBoneNestedKey(section, ".joint_limit", &nestedBoneKey)) {
      pendingJointLimits.push_back({section, &table, std::move(nestedBoneKey)});
      continue;
    }
    if (!hasBoneFields && parseBoneNestedKey(section, ".diagnostic_capsule", &nestedBoneKey)) {
      pendingCapsules.push_back({section, &table, std::move(nestedBoneKey)});
      continue;
    }
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
      const std::string boneKey = section.substr(5);
      if (!boneSectionIndex.emplace(boneKey, skeleton->boneDefinitions.size()).second) {
        return fail(errorMessage, "Duplicate bone section '" + section + "' in " + context);
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

  const auto attachNested = [&](const PendingBoneNestedSection& pending, std::string_view label) -> SkeletonBoneSnapshot* {
    const auto found = boneSectionIndex.find(pending.boneKey);
    if (found == boneSectionIndex.end()) {
      fail(errorMessage, std::string(label) + " references missing bone table '" + pending.boneKey + "' in " + context);
      return nullptr;
    }
    return &skeleton->boneDefinitions[found->second];
  };
  for (const auto& pending : pendingJointLimits) {
    SkeletonBoneSnapshot* bone = attachNested(pending, "joint_limit");
    if (!bone) {
      return false;
    }
    if (bone->jointLimit) {
      return fail(errorMessage, "Duplicate joint_limit for bone '" + pending.boneKey + "' in " + context);
    }
    SkeletonBoneJointLimitSnapshot limit;
    if (!loadBoneJointLimit(*pending.table, pending.section, &limit, errorMessage)) {
      return false;
    }
    bone->jointLimit = std::move(limit);
  }
  for (const auto& pending : pendingCapsules) {
    SkeletonBoneSnapshot* bone = attachNested(pending, "diagnostic_capsule");
    if (!bone) {
      return false;
    }
    if (bone->diagnosticCapsule) {
      return fail(errorMessage, "Duplicate diagnostic_capsule for bone '" + pending.boneKey + "' in " + context);
    }
    SkeletonBoneDiagnosticCapsuleSnapshot capsule;
    if (!loadBoneDiagnosticCapsule(*pending.table, pending.section, &capsule, errorMessage)) {
      return false;
    }
    bone->diagnosticCapsule = std::move(capsule);
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
  std::vector<std::string> sectionNames;

  while (std::getline(stream, line)) {
    lineNumber += 1;
    const std::string cleaned = stripComment(line);
    if (cleaned.empty()) {
      continue;
    }
    if (cleaned.front() == '[') {
      if (cleaned.size() >= 3 && cleaned.back() == ']') {
        sectionNames.push_back(trim(std::string_view(cleaned).substr(1, cleaned.size() - 2)));
      }
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
  for (const auto& section : sectionNames) {
    if (isV2OnlyBoneNestedSection(section)) {
      return fail(
        errorMessage,
        "Schema-v1 skeleton rejects v2-only nested section '" + section + "' in " + path.string());
    }
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

bool readTopLevelClipSchemaVersion(
  const std::filesystem::path& path,
  int* schemaVersion,
  std::string* errorMessage) {
  std::ifstream stream(path);
  if (!stream.is_open()) {
    return fail(errorMessage, "Could not open animation clip file at " + path.string());
  }

  std::string line;
  std::size_t lineNumber = 0;
  bool inSection = false;
  bool found = false;
  int parsedVersion = 0;
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
      return fail(errorMessage, "Invalid animation clip line " + std::to_string(lineNumber) + " in " + path.string());
    }
    if (key == "schema_version") {
      if (!parseIntValue(value, &parsedVersion)) {
        return fail(errorMessage, "Invalid schema_version in " + path.string());
      }
      found = true;
    }
  }
  if (!found || parsedVersion <= 0) {
    return fail(errorMessage, "Animation clip schema_version must be a positive integer in " + path.string());
  }
  *schemaVersion = parsedVersion;
  return true;
}

bool parseTrackKeySection(const std::string& section, std::string* boneId, int* keyIndex) {
  static constexpr std::string_view prefix = "track.";
  static constexpr std::string_view marker = ".key.";
  if (!section.starts_with(prefix)) {
    return false;
  }
  const std::size_t markerOffset = section.rfind(marker);
  if (markerOffset == std::string::npos || markerOffset <= prefix.size()) {
    return false;
  }
  *boneId = section.substr(prefix.size(), markerOffset - prefix.size());
  const std::string indexToken = section.substr(markerOffset + marker.size());
  int parsedIndex = 0;
  if (boneId->empty() || indexToken.empty() || !parseStrictInt(indexToken, &parsedIndex)
      || parsedIndex < 0 || indexToken != std::to_string(parsedIndex)) {
    return false;
  }
  *keyIndex = parsedIndex;
  return true;
}

bool loadClipV2File(
  const std::filesystem::path& path,
  const std::vector<SkeletonDefinitionSnapshot>& skeletons,
  ClipDefinitionSnapshot* clip,
  std::string* errorMessage) {
  StrictDocument document;
  if (!parseStrictDocument(path, &document, errorMessage)) {
    return false;
  }
  const std::string context = path.string();
  if (!requireOnlyKeys(
        document.top,
        {"schema", "schema_version", "name", "owner_system", "skeleton", "duration_seconds", "loop", "root_motion_meters"},
        context,
        errorMessage)) {
    return false;
  }

  std::string schema;
  std::string ownerSystem;
  if (!readString(document.top, "schema", &schema, context, errorMessage)
      || !readInt(document.top, "schema_version", &clip->schemaVersion, context, errorMessage)
      || !readString(document.top, "name", &clip->name, context, errorMessage)
      || !readString(document.top, "owner_system", &ownerSystem, context, errorMessage)
      || !readString(document.top, "skeleton", &clip->skeletonName, context, errorMessage)
      || !readDouble(document.top, "duration_seconds", &clip->durationSeconds, context, errorMessage)
      || !readBool(document.top, "loop", &clip->loop, context, errorMessage)
      || !readDouble(document.top, "root_motion_meters", &clip->rootMotionMeters, context, errorMessage)) {
    return false;
  }
  if (schema != "shader_forge.animation_clip" || clip->schemaVersion != 2 || ownerSystem != "animation_system") {
    return fail(errorMessage, "Invalid animation clip v2 header in " + context);
  }
  if (clip->durationSeconds <= 0.0) {
    return fail(errorMessage, "Animation clip '" + clip->name + "' duration_seconds must be > 0.");
  }

  const SkeletonDefinitionSnapshot* clipSkeleton = findSkeletonByName(skeletons, clip->skeletonName);
  if (clipSkeleton == nullptr) {
    return fail(errorMessage, "Animation clip '" + clip->name + "' references missing skeleton '" + clip->skeletonName + "'.");
  }
  if (clipSkeleton->schemaVersion != 2) {
    return fail(errorMessage, "Animation clip '" + clip->name + "' schema_version 2 requires a v2 skeleton.");
  }
  if (clip->skeletonName != clipSkeleton->id) {
    return fail(errorMessage, "Animation clip '" + clip->name + "' must reference its v2 skeleton by stable id.");
  }

  std::set<std::string> boneIds;
  for (const auto& bone : clipSkeleton->boneDefinitions) {
    boneIds.insert(bone.id);
  }

  struct PendingKey {
    int index = 0;
    ClipKeyframeSnapshot key;
  };
  std::map<std::string, std::vector<PendingKey>> pendingTracks;

  for (const auto& [section, table] : document.sections) {
    if (section.starts_with("event.")) {
      AnimationClipEventSnapshot eventSnapshot;
      eventSnapshot.name = section.substr(6);
      if (eventSnapshot.name.empty()
          || !requireOnlyKeys(table, {"time_seconds", "type", "target"}, section, errorMessage)
          || !readDouble(table, "time_seconds", &eventSnapshot.timeSeconds, section, errorMessage)
          || !readString(table, "type", &eventSnapshot.type, section, errorMessage)
          || !readString(table, "target", &eventSnapshot.target, section, errorMessage)) {
        return false;
      }
      if (eventSnapshot.timeSeconds < 0.0 || eventSnapshot.timeSeconds > clip->durationSeconds) {
        return fail(errorMessage, "Animation clip event '" + eventSnapshot.name + "' is out of range in clip '" + clip->name + "'.");
      }
      if (eventSnapshot.type != "audio_event" && eventSnapshot.type != "marker" && eventSnapshot.type != "vfx_event") {
        return fail(errorMessage, "Animation clip event '" + eventSnapshot.name + "' has unsupported type '" + eventSnapshot.type + "'.");
      }
      eventSnapshot.valid = true;
      clip->events.push_back(std::move(eventSnapshot));
      continue;
    }

    std::string boneId;
    int keyIndex = 0;
    if (!section.starts_with("track.") || !parseTrackKeySection(section, &boneId, &keyIndex)) {
      return fail(errorMessage, "Unknown animation clip section '" + section + "' in " + context);
    }
    if (!boneIds.contains(boneId)) {
      return fail(errorMessage, "Animation clip '" + clip->name + "' track references missing bone '" + boneId + "'.");
    }
    if (!requireOnlyKeys(table, {"normalized_time", "translation", "rotation"}, section, errorMessage)) {
      return false;
    }
    ClipKeyframeSnapshot keyframe;
    if (!readDouble(table, "normalized_time", &keyframe.normalizedTime, section, errorMessage)
        || !readVector3(table, "translation", &keyframe.translation, section, errorMessage)
        || !readQuaternion(table, "rotation", &keyframe.rotation, section, errorMessage)) {
      return false;
    }
    auto& keys = pendingTracks[boneId];
    if (std::any_of(keys.begin(), keys.end(), [&](const PendingKey& existing) { return existing.index == keyIndex; })) {
      return fail(errorMessage, "Duplicate key index in animation clip track '" + boneId + "' in " + context);
    }
    keys.push_back(PendingKey{keyIndex, std::move(keyframe)});
  }

  std::map<std::string, ClipTrackSnapshot> tracksByBone;
  for (auto& [boneId, keys] : pendingTracks) {
    std::sort(keys.begin(), keys.end(), [](const PendingKey& left, const PendingKey& right) {
      return left.index < right.index;
    });
    if (keys.size() < 2) {
      return fail(errorMessage, "Animation clip track '" + boneId + "' must contain at least two keys.");
    }
    ClipTrackSnapshot track;
    track.bone = boneId;
    for (std::size_t index = 0; index < keys.size(); ++index) {
      if (keys[index].index != static_cast<int>(index)) {
        return fail(errorMessage, "Animation clip track '" + boneId + "' key indices must be consecutive and zero-based.");
      }
      if (index == 0 && keys[index].key.normalizedTime != 0.0) {
        return fail(errorMessage, "Animation clip track '" + boneId + "' must start at normalized_time 0.0.");
      }
      if (index + 1 == keys.size() && keys[index].key.normalizedTime != 1.0) {
        return fail(errorMessage, "Animation clip track '" + boneId + "' must end at normalized_time 1.0.");
      }
      if (index > 0 && !(keys[index].key.normalizedTime > keys[index - 1].key.normalizedTime)) {
        return fail(errorMessage, "Animation clip track '" + boneId + "' normalized_time values must be strictly increasing.");
      }
      track.keys.push_back(std::move(keys[index].key));
    }
    tracksByBone.emplace(boneId, std::move(track));
  }

  for (const auto& bone : clipSkeleton->boneDefinitions) {
    const auto found = tracksByBone.find(bone.id);
    if (found != tracksByBone.end()) {
      clip->tracks.push_back(std::move(found->second));
    }
  }

  clip->sourcePath = path;
  clip->valid = true;
  return true;
}

bool loadClipFile(
  const std::filesystem::path& path,
  const std::vector<SkeletonDefinitionSnapshot>& skeletons,
  ClipDefinitionSnapshot* clip,
  std::string* errorMessage) {
  int schemaVersionPeek = 0;
  if (!readTopLevelClipSchemaVersion(path, &schemaVersionPeek, errorMessage)) {
    return false;
  }
  if (schemaVersionPeek == 2) {
    return loadClipV2File(path, skeletons, clip, errorMessage);
  }
  if (schemaVersionPeek != 1) {
    return fail(errorMessage, "Unsupported animation clip schema_version in " + path.string());
  }

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

  clip->schemaVersion = 1;
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
  if (schema != "shader_forge.attachment_profile" || ownerSystem != "animation_system") {
    return fail(errorMessage, "Invalid attachment profile header in " + context);
  }
  if (schemaVersion != 1 && schemaVersion != 2) {
    return fail(errorMessage, "Unsupported attachment profile schema_version in " + context);
  }

  profile->schemaVersion = schemaVersion;
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
            || secondary.jointLimitPolicy != "diagnose") {
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
      if (schemaVersion >= 2) {
        if (!requireOnlyKeys(table, {"translation", "space"}, section, errorMessage)
            || !readVector3(table, "translation", &secondary.poleTranslation, section, errorMessage)
            || !readString(table, "space", &secondary.poleSpace, section, errorMessage)) {
          return false;
        }
        if (secondary.poleSpace != "item") {
          return fail(errorMessage, "Attachment secondary_hand.pole space must be \"item\" in " + context);
        }
      } else if (!requireOnlyKeys(table, {"translation"}, section, errorMessage)
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
      } else {
        envelope.proceduralLayers = profile->mode == "two_hand"
          ? std::vector<std::string>{"primary_attachment", "secondary_hand_ik"}
          : std::vector<std::string>{"primary_attachment"};
      }
      std::set<std::string> uniqueLayers;
      for (const auto& layer : envelope.proceduralLayers) {
        if (layer != "primary_attachment" && layer != "secondary_hand_ik") {
          return fail(errorMessage, "Unsupported procedural layer '" + layer + "' in " + section);
        }
        if (!uniqueLayers.insert(layer).second) {
          return fail(errorMessage, "Duplicate procedural layer '" + layer + "' in " + section);
        }
      }
      if (!uniqueLayers.contains("primary_attachment")) {
        return fail(errorMessage, "Motion envelope must request primary_attachment in " + section);
      }
      if (envelope.proceduralLayers.front() != "primary_attachment") {
        return fail(errorMessage, "Motion envelope procedural layers must begin with primary_attachment in " + section);
      }
      if (profile->mode != "two_hand" && uniqueLayers.contains("secondary_hand_ik")) {
        return fail(errorMessage, "One-hand motion envelope cannot request secondary_hand_ik in " + section);
      }
      if (profile->mode == "two_hand" && !uniqueLayers.contains("secondary_hand_ik")) {
        return fail(errorMessage, "Two-hand motion envelope must request secondary_hand_ik in " + section);
      }
      const ClipDefinitionSnapshot* clip = findClipByName(clips, envelope.clip);
      if (clip == nullptr) {
        return fail(errorMessage, "Motion envelope references missing clip '" + envelope.clip + "'.");
      }
      if (clip->schemaVersion != 2) {
        return fail(errorMessage, "Motion envelope requires a sampleable schema-version-2 clip in " + section);
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
    if (schemaVersion >= 2) {
      const std::string secondaryUpperRole = profile->dominantHand == "right" ? "upper_arm_l" : "upper_arm_r";
      const std::string secondaryLowerRole = profile->dominantHand == "right" ? "lower_arm_l" : "lower_arm_r";
      const auto findRole = [&](std::string_view role) -> const SkeletonBoneSnapshot* {
        const auto found = std::find_if(
          skeleton->boneDefinitions.begin(),
          skeleton->boneDefinitions.end(),
          [&](const auto& bone) { return bone.role == role; });
        return found == skeleton->boneDefinitions.end() ? nullptr : &*found;
      };
      const auto* upper = findRole(secondaryUpperRole);
      const auto* lower = findRole(secondaryLowerRole);
      const auto* hand = findRole(secondaryRole);
      if (upper == nullptr || lower == nullptr || hand == nullptr) {
        return fail(errorMessage, "Two-hand attachment is missing required secondary-hand chain roles in " + context);
      }
      if (lower->parent != upper->id || hand->parent != lower->id) {
        return fail(errorMessage, "Two-hand attachment secondary-hand chain is not a direct parent chain in " + context);
      }
      const bool hasSecondaryPalm = std::any_of(
        skeleton->sockets.begin(),
        skeleton->sockets.end(),
        [&](const auto& socket) { return socket.bone == hand->id && socket.role == "palm_contact"; });
      if (!hasSecondaryPalm) {
        return fail(errorMessage, "Two-hand attachment requires a secondary palm_contact socket in " + context);
      }
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

double withoutSignedZero(double value) {
  return value == 0.0 ? 0.0 : value;
}

SpatialVector3Snapshot cleanVector(SpatialVector3Snapshot value) {
  value.x = withoutSignedZero(value.x);
  value.y = withoutSignedZero(value.y);
  value.z = withoutSignedZero(value.z);
  return value;
}

SpatialVector3Snapshot addVectors(
  const SpatialVector3Snapshot& left,
  const SpatialVector3Snapshot& right) {
  return cleanVector({left.x + right.x, left.y + right.y, left.z + right.z});
}

SpatialVector3Snapshot crossVectors(
  const SpatialVector3Snapshot& left,
  const SpatialVector3Snapshot& right) {
  return {
    left.y * right.z - left.z * right.y,
    left.z * right.x - left.x * right.z,
    left.x * right.y - left.y * right.x,
  };
}

SpatialVector3Snapshot rotateVector(
  const SpatialQuaternionSnapshot& rotation,
  const SpatialVector3Snapshot& value) {
  const SpatialVector3Snapshot quaternionAxis{rotation.x, rotation.y, rotation.z};
  const SpatialVector3Snapshot cross = crossVectors(quaternionAxis, value);
  const SpatialVector3Snapshot twiceCross{cross.x * 2.0, cross.y * 2.0, cross.z * 2.0};
  const SpatialVector3Snapshot secondCross = crossVectors(quaternionAxis, twiceCross);
  return cleanVector({
    value.x + rotation.w * twiceCross.x + secondCross.x,
    value.y + rotation.w * twiceCross.y + secondCross.y,
    value.z + rotation.w * twiceCross.z + secondCross.z,
  });
}

SpatialQuaternionSnapshot multiplyQuaternions(
  const SpatialQuaternionSnapshot& parent,
  const SpatialQuaternionSnapshot& local) {
  return {
    parent.w * local.x + parent.x * local.w + parent.y * local.z - parent.z * local.y,
    parent.w * local.y - parent.x * local.z + parent.y * local.w + parent.z * local.x,
    parent.w * local.z + parent.x * local.y - parent.y * local.x + parent.z * local.w,
    parent.w * local.w - parent.x * local.x - parent.y * local.y - parent.z * local.z,
  };
}

bool canonicalizeQuaternion(SpatialQuaternionSnapshot* rotation, std::string* errorMessage) {
  const double length = std::sqrt(
    rotation->x * rotation->x
    + rotation->y * rotation->y
    + rotation->z * rotation->z
    + rotation->w * rotation->w);
  if (!std::isfinite(length) || length == 0.0) {
    return fail(errorMessage, "Spatial evaluation produced an invalid quaternion.");
  }
  rotation->x /= length;
  rotation->y /= length;
  rotation->z /= length;
  rotation->w /= length;
  if (quaternionNeedsSignFlip(rotation->x, rotation->y, rotation->z, rotation->w)) {
    rotation->x = -rotation->x;
    rotation->y = -rotation->y;
    rotation->z = -rotation->z;
    rotation->w = -rotation->w;
  }
  rotation->x = withoutSignedZero(rotation->x);
  rotation->y = withoutSignedZero(rotation->y);
  rotation->z = withoutSignedZero(rotation->z);
  rotation->w = withoutSignedZero(rotation->w);
  return true;
}

bool makeTransform(
  SpatialVector3Snapshot translation,
  SpatialQuaternionSnapshot rotation,
  SpatialTransformSnapshot* transform,
  std::string* errorMessage) {
  if (!std::isfinite(translation.x) || !std::isfinite(translation.y) || !std::isfinite(translation.z)
      || !canonicalizeQuaternion(&rotation, errorMessage)) {
    return fail(errorMessage, "Spatial evaluation produced a non-finite transform.");
  }
  transform->translation = cleanVector(translation);
  transform->rotation = rotation;
  transform->axes = {
    rotateVector(rotation, {1.0, 0.0, 0.0}),
    rotateVector(rotation, {0.0, 1.0, 0.0}),
    rotateVector(rotation, {0.0, 0.0, 1.0}),
  };
  return true;
}

bool composeTransforms(
  const SpatialTransformSnapshot& parent,
  const SpatialTransformSnapshot& local,
  SpatialTransformSnapshot* world,
  std::string* errorMessage) {
  return makeTransform(
    addVectors(parent.translation, rotateVector(parent.rotation, local.translation)),
    multiplyQuaternions(parent.rotation, local.rotation),
    world,
    errorMessage);
}

SpatialVector3Snapshot subtractVectors(
  const SpatialVector3Snapshot& left,
  const SpatialVector3Snapshot& right) {
  return cleanVector({left.x - right.x, left.y - right.y, left.z - right.z});
}

SpatialVector3Snapshot scaleVector(const SpatialVector3Snapshot& value, double scale) {
  return cleanVector({value.x * scale, value.y * scale, value.z * scale});
}

double dotVectors(const SpatialVector3Snapshot& left, const SpatialVector3Snapshot& right) {
  return left.x * right.x + left.y * right.y + left.z * right.z;
}

double vectorLength(const SpatialVector3Snapshot& value) {
  return std::hypot(value.x, value.y, value.z);
}

bool vectorIsFinite(const SpatialVector3Snapshot& value) {
  return std::isfinite(value.x) && std::isfinite(value.y) && std::isfinite(value.z);
}

bool tryNormalizeVector(
  const SpatialVector3Snapshot& value,
  SpatialVector3Snapshot* normalized,
  std::string_view error,
  std::string* errorMessage) {
  const double length = vectorLength(value);
  if (!std::isfinite(length) || length == 0.0) {
    return fail(errorMessage, std::string(error));
  }
  *normalized = cleanVector({value.x / length, value.y / length, value.z / length});
  if (!vectorIsFinite(*normalized)) {
    return fail(errorMessage, std::string(error));
  }
  return true;
}

SpatialQuaternionSnapshot conjugateQuaternion(const SpatialQuaternionSnapshot& value) {
  return {-value.x, -value.y, -value.z, value.w};
}

bool evaluateJointLimits(
  const AttachmentProfileSnapshot& profile,
  const SkeletonDefinitionSnapshot& skeleton,
  const std::vector<EvaluatedBonePoseSnapshot>& posedBones,
  SpatialJointLimitDiagnosticSnapshot* diagnostic,
  std::string* errorMessage) {
  *diagnostic = {};
  diagnostic->policy = profile.secondaryHand && !profile.secondaryHand->jointLimitPolicy.empty()
    ? profile.secondaryHand->jointLimitPolicy
    : "diagnose";

  const double radiansToDegrees = 180.0 / std::acos(-1.0);
  constexpr double degenerateEpsilon = 1e-12;
  for (std::size_t index = 0; index < skeleton.boneDefinitions.size(); ++index) {
    const auto& authored = skeleton.boneDefinitions[index];
    if (!authored.jointLimit) {
      continue;
    }
    if (index >= posedBones.size() || posedBones[index].id != authored.id) {
      return fail(errorMessage, "Spatial joint-limit evaluation pose is not in stable skeleton order.");
    }

    SpatialQuaternionSnapshot delta = multiplyQuaternions(
      conjugateQuaternion(authored.rotation),
      posedBones[index].local.rotation);
    if (!canonicalizeQuaternion(&delta, errorMessage)) {
      return fail(errorMessage, "Spatial joint-limit evaluation produced a non-finite rotation.");
    }

    const auto& limit = *authored.jointLimit;
    const double projected = delta.x * limit.twistAxis.x
      + delta.y * limit.twistAxis.y
      + delta.z * limit.twistAxis.z;
    SpatialQuaternionSnapshot twist{
      limit.twistAxis.x * projected,
      limit.twistAxis.y * projected,
      limit.twistAxis.z * projected,
      delta.w,
    };
    const double twistLength = std::sqrt(
      twist.x * twist.x + twist.y * twist.y + twist.z * twist.z + twist.w * twist.w);
    if (!std::isfinite(twistLength)) {
      return fail(errorMessage, "Spatial joint-limit evaluation produced non-finite twist math.");
    }
    if (twistLength <= degenerateEpsilon) {
      twist = {0.0, 0.0, 0.0, 1.0};
    } else {
      twist.x /= twistLength;
      twist.y /= twistLength;
      twist.z /= twistLength;
      twist.w /= twistLength;
      if (quaternionNeedsSignFlip(twist.x, twist.y, twist.z, twist.w)) {
        twist.x = -twist.x;
        twist.y = -twist.y;
        twist.z = -twist.z;
        twist.w = -twist.w;
      }
    }

    SpatialQuaternionSnapshot swing = multiplyQuaternions(delta, conjugateQuaternion(twist));
    if (!canonicalizeQuaternion(&swing, errorMessage)) {
      return fail(errorMessage, "Spatial joint-limit evaluation produced a non-finite swing rotation.");
    }
    const double signedTwistSine = twist.x * limit.twistAxis.x
      + twist.y * limit.twistAxis.y
      + twist.z * limit.twistAxis.z;
    const double twistDegrees = 2.0 * std::atan2(signedTwistSine, twist.w) * radiansToDegrees;
    const double swingDegrees = 2.0 * std::acos(std::clamp(swing.w, 0.0, 1.0)) * radiansToDegrees;
    if (!std::isfinite(twistDegrees) || !std::isfinite(swingDegrees)) {
      return fail(errorMessage, "Spatial joint-limit evaluation produced non-finite angular diagnostics.");
    }

    const double swingViolation = std::max(0.0, swingDegrees - limit.swingDegrees);
    const double twistViolation = twistDegrees < limit.twistMinDegrees
      ? limit.twistMinDegrees - twistDegrees
      : (twistDegrees > limit.twistMaxDegrees ? twistDegrees - limit.twistMaxDegrees : 0.0);
    const bool withinLimits = swingViolation == 0.0 && twistViolation == 0.0;
    diagnostic->bones.push_back({
      authored.id,
      authored.role,
      withoutSignedZero(swingDegrees),
      withoutSignedZero(limit.swingDegrees),
      withoutSignedZero(twistDegrees),
      withoutSignedZero(limit.twistMinDegrees),
      withoutSignedZero(limit.twistMaxDegrees),
      withoutSignedZero(swingViolation),
      withoutSignedZero(twistViolation),
      withinLimits,
    });
    if (!withinLimits) {
      diagnostic->violationCount += 1;
    }
    diagnostic->maxViolationDegrees = std::max(
      diagnostic->maxViolationDegrees,
      std::max(swingViolation, twistViolation));
  }

  diagnostic->evaluatedBoneCount = diagnostic->bones.size();
  if (diagnostic->bones.empty()) {
    diagnostic->status = "unavailable";
    diagnostic->reason = "no_joint_limits_authored";
    return true;
  }
  diagnostic->status = "available";
  diagnostic->withinLimits = diagnostic->violationCount == 0;
  diagnostic->maxViolationDegrees = withoutSignedZero(diagnostic->maxViolationDegrees);
  return true;
}

bool invertTransform(
  const SpatialTransformSnapshot& value,
  SpatialTransformSnapshot* inverse,
  std::string* errorMessage) {
  const SpatialQuaternionSnapshot conjugate = conjugateQuaternion(value.rotation);
  return makeTransform(
    rotateVector(conjugate, {-value.translation.x, -value.translation.y, -value.translation.z}),
    conjugate,
    inverse,
    errorMessage);
}

bool quaternionFromAxes(
  const SpatialVector3Snapshot& xAxis,
  const SpatialVector3Snapshot& yAxis,
  const SpatialVector3Snapshot& zAxis,
  SpatialQuaternionSnapshot* rotation,
  std::string* errorMessage) {
  if (!vectorIsFinite(xAxis) || !vectorIsFinite(yAxis) || !vectorIsFinite(zAxis)) {
    return fail(errorMessage, "Spatial evaluation secondary-hand IK produced non-finite math.");
  }
  const double r00 = xAxis.x;
  const double r01 = yAxis.x;
  const double r02 = zAxis.x;
  const double r10 = xAxis.y;
  const double r11 = yAxis.y;
  const double r12 = zAxis.y;
  const double r20 = xAxis.z;
  const double r21 = yAxis.z;
  const double r22 = zAxis.z;
  SpatialQuaternionSnapshot quaternion{
    std::copysign(0.5 * std::sqrt(std::max(0.0, 1.0 + r00 - r11 - r22)), r21 - r12),
    std::copysign(0.5 * std::sqrt(std::max(0.0, 1.0 - r00 + r11 - r22)), r02 - r20),
    std::copysign(0.5 * std::sqrt(std::max(0.0, 1.0 - r00 - r11 + r22)), r10 - r01),
    0.5 * std::sqrt(std::max(0.0, 1.0 + r00 + r11 + r22)),
  };
  if (!canonicalizeQuaternion(&quaternion, errorMessage)) {
    return fail(errorMessage, "Spatial evaluation secondary-hand IK produced non-finite math.");
  }
  *rotation = quaternion;
  return true;
}

bool rotationMappingOffset(
  const SpatialVector3Snapshot& localOffset,
  const SpatialVector3Snapshot& worldOffset,
  const SpatialVector3Snapshot& planeNormal,
  SpatialQuaternionSnapshot* rotation,
  std::string* errorMessage) {
  SpatialVector3Snapshot localX;
  SpatialVector3Snapshot worldX;
  SpatialVector3Snapshot normal;
  if (!tryNormalizeVector(localOffset, &localX, "Spatial evaluation secondary-hand IK produced non-finite math.", errorMessage)
      || !tryNormalizeVector(worldOffset, &worldX, "Spatial evaluation secondary-hand IK produced non-finite math.", errorMessage)
      || !tryNormalizeVector(planeNormal, &normal, "Spatial evaluation secondary-hand IK produced non-finite math.", errorMessage)) {
    return false;
  }

  SpatialVector3Snapshot worldY;
  if (!tryNormalizeVector(
        crossVectors(normal, worldX),
        &worldY,
        "Spatial evaluation secondary-hand IK produced non-finite math.",
        errorMessage)) {
    return false;
  }
  const SpatialVector3Snapshot worldZ = cleanVector(crossVectors(worldX, worldY));
  SpatialQuaternionSnapshot worldFromIdentity;
  if (!quaternionFromAxes(worldX, worldY, worldZ, &worldFromIdentity, errorMessage)) {
    return false;
  }

  const SpatialVector3Snapshot helper = std::abs(localX.y) < 0.9
    ? SpatialVector3Snapshot{0.0, 1.0, 0.0}
    : SpatialVector3Snapshot{1.0, 0.0, 0.0};
  SpatialVector3Snapshot localZ;
  if (!tryNormalizeVector(
        crossVectors(localX, helper),
        &localZ,
        "Spatial evaluation secondary-hand IK produced non-finite math.",
        errorMessage)) {
    return false;
  }
  const SpatialVector3Snapshot localY = cleanVector(crossVectors(localZ, localX));
  SpatialQuaternionSnapshot localFromIdentity;
  if (!quaternionFromAxes(localX, localY, localZ, &localFromIdentity, errorMessage)) {
    return false;
  }
  SpatialQuaternionSnapshot mapped = multiplyQuaternions(worldFromIdentity, conjugateQuaternion(localFromIdentity));
  if (!canonicalizeQuaternion(&mapped, errorMessage)) {
    return fail(errorMessage, "Spatial evaluation secondary-hand IK produced non-finite math.");
  }
  *rotation = mapped;
  return true;
}

bool recomputePoseWorlds(
  std::vector<EvaluatedBonePoseSnapshot>* posedBones,
  std::string* errorMessage) {
  std::map<std::string, EvaluatedBonePoseSnapshot*> bonesById;
  for (auto& bone : *posedBones) {
    bonesById.emplace(bone.id, &bone);
  }
  std::map<std::string, bool> resolved;
  std::set<std::string> visiting;
  const std::function<bool(EvaluatedBonePoseSnapshot&)> resolve = [&](EvaluatedBonePoseSnapshot& bone) {
    if (resolved[bone.id]) {
      return true;
    }
    if (!visiting.insert(bone.id).second) {
      return fail(errorMessage, "Spatial evaluation could not resolve bone '" + bone.id + "'.");
    }
    if (bone.parent.empty()) {
      bone.world = bone.local;
      resolved[bone.id] = true;
      visiting.erase(bone.id);
      return true;
    }
    const auto parent = bonesById.find(bone.parent);
    if (parent == bonesById.end()) {
      return fail(errorMessage, "Spatial evaluation could not resolve parent bone '" + bone.parent + "'.");
    }
    if (!resolve(*parent->second)
        || !composeTransforms(parent->second->world, bone.local, &bone.world, errorMessage)) {
      return false;
    }
    resolved[bone.id] = true;
    visiting.erase(bone.id);
    return true;
  };
  for (auto& bone : *posedBones) {
    if (!resolve(bone)) {
      return false;
    }
  }
  return true;
}

SpatialVector3Snapshot lerpVectors(
  const SpatialVector3Snapshot& start,
  const SpatialVector3Snapshot& end,
  double t) {
  return cleanVector({
    start.x + (end.x - start.x) * t,
    start.y + (end.y - start.y) * t,
    start.z + (end.z - start.z) * t,
  });
}

bool nlerpQuaternions(
  const SpatialQuaternionSnapshot& start,
  const SpatialQuaternionSnapshot& end,
  double t,
  SpatialQuaternionSnapshot* result,
  std::string* errorMessage) {
  SpatialQuaternionSnapshot target = end;
  const double dot = start.x * end.x + start.y * end.y + start.z * end.z + start.w * end.w;
  if (dot < 0.0) {
    target.x = -end.x;
    target.y = -end.y;
    target.z = -end.z;
    target.w = -end.w;
  }
  SpatialQuaternionSnapshot mixed{
    start.x + (target.x - start.x) * t,
    start.y + (target.y - start.y) * t,
    start.z + (target.z - start.z) * t,
    start.w + (target.w - start.w) * t,
  };
  if (!canonicalizeQuaternion(&mixed, errorMessage)) {
    return false;
  }
  *result = mixed;
  return true;
}

bool sampleClipTrack(
  const ClipTrackSnapshot& track,
  double normalizedTime,
  SpatialVector3Snapshot* translation,
  SpatialQuaternionSnapshot* rotation,
  std::string* errorMessage) {
  if (track.keys.size() < 2) {
    return fail(errorMessage, "Animation clip track '" + track.bone + "' is missing keyframes.");
  }
  const auto& first = track.keys.front();
  const auto& last = track.keys.back();
  if (normalizedTime <= first.normalizedTime) {
    *translation = first.translation;
    *rotation = first.rotation;
    return true;
  }
  if (normalizedTime >= last.normalizedTime) {
    *translation = last.translation;
    *rotation = last.rotation;
    return true;
  }
  for (std::size_t index = 0; index + 1 < track.keys.size(); ++index) {
    const auto& left = track.keys[index];
    const auto& right = track.keys[index + 1];
    if (normalizedTime < left.normalizedTime || normalizedTime > right.normalizedTime) {
      continue;
    }
    if (normalizedTime == left.normalizedTime) {
      *translation = left.translation;
      *rotation = left.rotation;
      return true;
    }
    if (normalizedTime == right.normalizedTime) {
      *translation = right.translation;
      *rotation = right.rotation;
      return true;
    }
    const double span = right.normalizedTime - left.normalizedTime;
    if (!(span > 0.0) || !std::isfinite(span)) {
      return fail(errorMessage, "Animation clip track '" + track.bone + "' has an invalid key interval.");
    }
    const double t = (normalizedTime - left.normalizedTime) / span;
    if (!std::isfinite(t) || t < 0.0 || t > 1.0) {
      return fail(errorMessage, "Animation clip sampling produced a non-finite interpolation weight.");
    }
    *translation = lerpVectors(left.translation, right.translation, t);
    if (!std::isfinite(translation->x) || !std::isfinite(translation->y) || !std::isfinite(translation->z)) {
      return fail(errorMessage, "Animation clip sampling produced a non-finite translation.");
    }
    return nlerpQuaternions(left.rotation, right.rotation, t, rotation, errorMessage);
  }
  return fail(errorMessage, "Animation clip track '" + track.bone + "' could not be sampled.");
}

bool resolveBoneWorld(
  std::string_view boneId,
  const std::map<std::string, const SkeletonBoneSnapshot*>& bonesById,
  std::map<std::string, SpatialTransformSnapshot>* locals,
  std::map<std::string, SpatialTransformSnapshot>* worlds,
  std::set<std::string>* visiting,
  std::string* errorMessage) {
  if (worlds->contains(std::string(boneId))) return true;
  const auto found = bonesById.find(std::string(boneId));
  if (found == bonesById.end() || !visiting->insert(std::string(boneId)).second) {
    return fail(errorMessage, "Spatial evaluation could not resolve bone '" + std::string(boneId) + "'.");
  }
  const auto& bone = *found->second;
  SpatialTransformSnapshot local;
  if (!makeTransform(bone.translation, bone.rotation, &local, errorMessage)) return false;
  (*locals)[bone.id] = local;
  if (bone.parent.empty()) {
    (*worlds)[bone.id] = local;
  } else {
    if (!resolveBoneWorld(bone.parent, bonesById, locals, worlds, visiting, errorMessage)) return false;
    SpatialTransformSnapshot world;
    if (!composeTransforms(worlds->at(bone.parent), local, &world, errorMessage)) return false;
    (*worlds)[bone.id] = world;
  }
  visiting->erase(bone.id);
  return true;
}

const SkeletonBoneSnapshot* boneWithRole(
  const SkeletonDefinitionSnapshot& skeleton,
  std::string_view role) {
  const auto found = std::find_if(
    skeleton.boneDefinitions.begin(),
    skeleton.boneDefinitions.end(),
    [&](const auto& bone) { return bone.role == role; });
  return found == skeleton.boneDefinitions.end() ? nullptr : &*found;
}

const SkeletonSocketSnapshot* palmSocketForBone(
  const SkeletonDefinitionSnapshot& skeleton,
  std::string_view boneId) {
  const auto found = std::find_if(
    skeleton.sockets.begin(),
    skeleton.sockets.end(),
    [&](const auto& socket) { return socket.bone == boneId && socket.role == "palm_contact"; });
  return found == skeleton.sockets.end() ? nullptr : &*found;
}

bool classifyProceduralLayers(
  const std::vector<std::string>& requested,
  bool secondaryIkApplied,
  std::vector<std::string>* applied,
  std::vector<std::string>* unavailable,
  std::string* errorMessage) {
  applied->clear();
  unavailable->clear();
  for (const auto& layer : requested) {
    if (layer == "primary_attachment") {
      applied->push_back(layer);
      continue;
    }
    if (layer == "secondary_hand_ik") {
      if (secondaryIkApplied) {
        applied->push_back(layer);
      } else {
        unavailable->push_back(layer);
      }
      continue;
    }
    return fail(errorMessage, "Unsupported procedural layer '" + layer + "'.");
  }
  return true;
}

EvaluatedBonePoseSnapshot* findPoseBoneById(
  std::vector<EvaluatedBonePoseSnapshot>* bones,
  std::string_view id) {
  const auto found = std::find_if(bones->begin(), bones->end(), [&](const auto& bone) {
    return bone.id == id;
  });
  return found == bones->end() ? nullptr : &*found;
}

EvaluatedBonePoseSnapshot* findPoseBoneByRole(
  std::vector<EvaluatedBonePoseSnapshot>* bones,
  std::string_view role) {
  const auto found = std::find_if(bones->begin(), bones->end(), [&](const auto& bone) {
    return bone.role == role;
  });
  return found == bones->end() ? nullptr : &*found;
}

void setSecondaryIkUnavailable(SpatialAttachmentEvaluationSnapshot* evaluation, std::string_view reason) {
  if (evaluation->mode == "two_hand") {
    evaluation->secondaryIk.status = "unavailable";
    evaluation->secondaryIk.reason = std::string(reason);
  } else {
    evaluation->secondaryIk.status = "not_applicable";
    evaluation->secondaryIk.reason = "one_hand_attachment";
  }
  evaluation->secondaryIk.solved = false;
  evaluation->secondaryIk.reachable.reset();
  evaluation->secondaryIk.preSolveDistanceMeters.reset();
  evaluation->secondaryIk.targetDistanceMeters.reset();
  evaluation->secondaryIk.minReachMeters.reset();
  evaluation->secondaryIk.maxReachMeters.reset();
  evaluation->secondaryIk.reachResidualMeters.reset();
  evaluation->secondaryIk.postSolveDistanceMeters.reset();
  evaluation->secondaryIk.reachToleranceMeters.reset();
  evaluation->secondaryIk.reachWithinTolerance.reset();
  evaluation->secondaryIk.contactToleranceMeters.reset();
  evaluation->secondaryIk.contactWithinTolerance.reset();
  evaluation->secondaryIk.postSolveAngleDegrees.reset();
  evaluation->secondaryIk.angleToleranceDegrees.reset();
  evaluation->secondaryIk.angleWithinTolerance.reset();
  evaluation->secondaryIk.withinTolerance.reset();
}

bool applySecondaryHandTwoBoneIk(
  const AttachmentProfileSnapshot& profile,
  const SkeletonDefinitionSnapshot& skeleton,
  const SpatialAttachmentEvaluationSnapshot& preSolve,
  std::vector<EvaluatedBonePoseSnapshot>* posedBones,
  SpatialSecondaryIkDiagnosticSnapshot* diagnostic,
  std::string* errorMessage) {
  if (!profile.secondaryHand || !preSolve.secondaryHandFrame || !preSolve.secondaryHandFrame->targetWorld
      || !preSolve.secondaryHandFrame->poleWorld) {
    return fail(errorMessage, "Spatial evaluation secondary-hand IK is missing a resolved target or pole.");
  }

  const std::string upperRole = profile.dominantHand == "right" ? "upper_arm_l" : "upper_arm_r";
  const std::string lowerRole = profile.dominantHand == "right" ? "lower_arm_l" : "lower_arm_r";
  const std::string handRole = profile.dominantHand == "right" ? "hand_l" : "hand_r";
  auto* upper = findPoseBoneByRole(posedBones, upperRole);
  auto* lower = findPoseBoneByRole(posedBones, lowerRole);
  auto* hand = findPoseBoneByRole(posedBones, handRole);
  if (upper == nullptr || lower == nullptr || hand == nullptr) {
    return fail(errorMessage, "Spatial evaluation secondary-hand IK chain is missing required roles.");
  }
  if (lower->parent != upper->id || hand->parent != lower->id) {
    return fail(errorMessage, "Spatial evaluation secondary-hand IK chain is not a direct parent chain.");
  }
  auto* upperParent = findPoseBoneById(posedBones, upper->parent);
  if (upperParent == nullptr && !upper->parent.empty()) {
    return fail(errorMessage, "Spatial evaluation secondary-hand IK chain is missing required roles.");
  }

  const auto* palm = palmSocketForBone(skeleton, hand->id);
  if (palm == nullptr) {
    return fail(errorMessage, "Spatial evaluation secondary-hand IK is missing a palm_contact socket.");
  }
  SpatialTransformSnapshot palmLocal;
  SpatialTransformSnapshot palmInverse;
  SpatialTransformSnapshot desiredHand;
  if (!makeTransform(palm->translation, palm->rotation, &palmLocal, errorMessage)
      || !invertTransform(palmLocal, &palmInverse, errorMessage)
      || !composeTransforms(*preSolve.secondaryHandFrame->targetWorld, palmInverse, &desiredHand, errorMessage)) {
    return false;
  }

  const SpatialVector3Snapshot shoulder = upper->world.translation;
  const SpatialVector3Snapshot desiredWrist = desiredHand.translation;
  const SpatialVector3Snapshot poleWorld = *preSolve.secondaryHandFrame->poleWorld;
  const double upperLength = vectorLength(lower->local.translation);
  const double lowerLength = vectorLength(hand->local.translation);
  if (!std::isfinite(upperLength) || upperLength <= 0.0 || !std::isfinite(lowerLength) || lowerLength <= 0.0) {
    return fail(errorMessage, "Spatial evaluation secondary-hand IK segment length is zero or non-finite.");
  }

  const SpatialVector3Snapshot shoulderToWrist = subtractVectors(desiredWrist, shoulder);
  const double desiredDistance = vectorLength(shoulderToWrist);
  if (!std::isfinite(desiredDistance) || desiredDistance == 0.0 || !vectorIsFinite(poleWorld)) {
    return fail(errorMessage, "Spatial evaluation secondary-hand IK produced non-finite math.");
  }
  const double maxReach = upperLength + lowerLength;
  const double minReach = std::abs(upperLength - lowerLength);
  const bool reachable = desiredDistance <= maxReach && desiredDistance >= minReach;
  const double reachResidual = desiredDistance > maxReach
    ? desiredDistance - maxReach
    : (desiredDistance < minReach ? minReach - desiredDistance : 0.0);
  const double solvedDistance = std::min(maxReach, std::max(minReach, desiredDistance));
  if (!std::isfinite(reachResidual) || !std::isfinite(solvedDistance) || solvedDistance == 0.0) {
    return fail(errorMessage, "Spatial evaluation secondary-hand IK produced non-finite math.");
  }

  SpatialVector3Snapshot axis;
  if (!tryNormalizeVector(
        shoulderToWrist,
        &axis,
        "Spatial evaluation secondary-hand IK produced non-finite math.",
        errorMessage)) {
    return false;
  }
  const SpatialVector3Snapshot solvedWrist = addVectors(shoulder, scaleVector(axis, solvedDistance));
  const SpatialVector3Snapshot poleRelative = subtractVectors(poleWorld, shoulder);
  const SpatialVector3Snapshot poleRejection = subtractVectors(poleRelative, scaleVector(axis, dotVectors(poleRelative, axis)));
  const double poleSeparation = vectorLength(poleRejection);
  if (!std::isfinite(poleSeparation) || poleSeparation <= 1e-10) {
    return fail(errorMessage, "Spatial evaluation secondary-hand IK pole is collinear with the shoulder-target line.");
  }
  SpatialVector3Snapshot bendDir;
  SpatialVector3Snapshot planeNormal;
  if (!tryNormalizeVector(
        poleRejection,
        &bendDir,
        "Spatial evaluation secondary-hand IK pole is collinear with the shoulder-target line.",
        errorMessage)
      || !tryNormalizeVector(
        crossVectors(axis, bendDir),
        &planeNormal,
        "Spatial evaluation secondary-hand IK produced non-finite math.",
        errorMessage)) {
    return false;
  }

  double cosShoulder = (upperLength * upperLength + solvedDistance * solvedDistance - lowerLength * lowerLength)
    / (2.0 * upperLength * solvedDistance);
  if (!std::isfinite(cosShoulder)) {
    return fail(errorMessage, "Spatial evaluation secondary-hand IK produced non-finite math.");
  }
  if (cosShoulder > 1.0) cosShoulder = 1.0;
  if (cosShoulder < -1.0) cosShoulder = -1.0;
  const double sinShoulder = std::sqrt(std::max(0.0, 1.0 - cosShoulder * cosShoulder));
  if (!std::isfinite(sinShoulder)) {
    return fail(errorMessage, "Spatial evaluation secondary-hand IK produced non-finite math.");
  }
  const SpatialVector3Snapshot elbow = addVectors(
    addVectors(shoulder, scaleVector(axis, upperLength * cosShoulder)),
    scaleVector(bendDir, upperLength * sinShoulder));
  const SpatialVector3Snapshot upperOffset = subtractVectors(elbow, shoulder);
  const SpatialVector3Snapshot lowerOffset = subtractVectors(solvedWrist, elbow);
  if (!vectorIsFinite(elbow) || !vectorIsFinite(upperOffset) || !vectorIsFinite(lowerOffset)) {
    return fail(errorMessage, "Spatial evaluation secondary-hand IK produced non-finite math.");
  }

  SpatialQuaternionSnapshot upperWorldRotation;
  SpatialQuaternionSnapshot lowerWorldRotation;
  if (!rotationMappingOffset(lower->local.translation, upperOffset, planeNormal, &upperWorldRotation, errorMessage)
      || !rotationMappingOffset(hand->local.translation, lowerOffset, planeNormal, &lowerWorldRotation, errorMessage)) {
    return false;
  }
  const SpatialQuaternionSnapshot parentWorldRotation = upperParent == nullptr
    ? SpatialQuaternionSnapshot{0.0, 0.0, 0.0, 1.0}
    : upperParent->world.rotation;
  SpatialQuaternionSnapshot upperLocalRotation = multiplyQuaternions(conjugateQuaternion(parentWorldRotation), upperWorldRotation);
  SpatialQuaternionSnapshot lowerLocalRotation = multiplyQuaternions(conjugateQuaternion(upperWorldRotation), lowerWorldRotation);
  SpatialQuaternionSnapshot handLocalRotation = multiplyQuaternions(conjugateQuaternion(lowerWorldRotation), desiredHand.rotation);
  if (!makeTransform(upper->local.translation, upperLocalRotation, &upper->local, errorMessage)
      || !makeTransform(lower->local.translation, lowerLocalRotation, &lower->local, errorMessage)
      || !makeTransform(hand->local.translation, handLocalRotation, &hand->local, errorMessage)
      || !recomputePoseWorlds(posedBones, errorMessage)) {
    return false;
  }

  diagnostic->status = "applied";
  diagnostic->reason.reset();
  diagnostic->solved = true;
  diagnostic->reachable = reachable;
  diagnostic->targetDistanceMeters = withoutSignedZero(desiredDistance);
  diagnostic->minReachMeters = withoutSignedZero(minReach);
  diagnostic->maxReachMeters = withoutSignedZero(maxReach);
  diagnostic->reachResidualMeters = withoutSignedZero(reachResidual);
  diagnostic->reachToleranceMeters = withoutSignedZero(profile.secondaryHand->reachMeters);
  diagnostic->reachWithinTolerance = reachResidual <= profile.secondaryHand->reachMeters;
  diagnostic->contactToleranceMeters = withoutSignedZero(profile.secondaryHand->contactMeters);
  diagnostic->angleToleranceDegrees = withoutSignedZero(profile.secondaryHand->angleDegrees);
  return true;
}

bool composeAttachmentEvaluation(
  const AttachmentProfileSnapshot& profile,
  const SkeletonDefinitionSnapshot& skeleton,
  const std::vector<EvaluatedBonePoseSnapshot>& posedBones,
  SpatialAttachmentEvaluationSnapshot* evaluation,
  std::string* errorMessage) {
  if (posedBones.size() != skeleton.boneDefinitions.size()) {
    return fail(errorMessage, "Spatial evaluation pose does not match the skeleton bone table.");
  }

  std::map<std::string, SpatialTransformSnapshot> worlds;
  for (std::size_t index = 0; index < posedBones.size(); ++index) {
    const auto& bone = posedBones[index];
    if (bone.id != skeleton.boneDefinitions[index].id || bone.parent != skeleton.boneDefinitions[index].parent) {
      return fail(errorMessage, "Spatial evaluation pose is not in stable skeleton order.");
    }
    worlds.emplace(bone.id, bone.world);
  }

  evaluation->skeletonId = skeleton.id;
  evaluation->attachmentSchemaVersion = profile.schemaVersion;
  evaluation->skeletonName = skeleton.name;
  evaluation->rootBone = skeleton.rootBone;
  evaluation->attachmentId = profile.id;
  evaluation->attachmentName = profile.name;
  evaluation->itemPrefabId = profile.itemPrefab;
  evaluation->dominantHand = profile.dominantHand;
  evaluation->mode = profile.mode;
  evaluation->perspective = profile.perspective;
  evaluation->primaryGripSocket = profile.primaryGrip.socket;
  evaluation->bones = posedBones;
  if (!evaluateJointLimits(profile, skeleton, posedBones, &evaluation->jointLimits, errorMessage)) {
    return false;
  }

  for (const auto& bone : posedBones) {
    if (bone.parent.empty()) {
      continue;
    }
    const auto parentWorld = worlds.find(bone.parent);
    if (parentWorld == worlds.end()) {
      return fail(errorMessage, "Spatial evaluation could not resolve parent bone '" + bone.parent + "'.");
    }
    evaluation->segments.push_back({
      bone.parent,
      bone.id,
      parentWorld->second.translation,
      bone.world.translation,
    });
  }

  std::map<std::string, SpatialTransformSnapshot> socketWorlds;
  for (const auto& socket : skeleton.sockets) {
    const auto boneWorld = worlds.find(socket.bone);
    if (boneWorld == worlds.end()) {
      return fail(errorMessage, "Spatial evaluation could not resolve socket bone '" + socket.bone + "'.");
    }
    SpatialTransformSnapshot local;
    SpatialTransformSnapshot world;
    if (!makeTransform(socket.translation, socket.rotation, &local, errorMessage)
        || !composeTransforms(boneWorld->second, local, &world, errorMessage)) {
      return false;
    }
    socketWorlds.emplace(socket.id, world);
    evaluation->sockets.push_back({socket.id, socket.bone, socket.role, local, world});
  }

  const auto primarySocket = socketWorlds.find(profile.primaryGrip.socket);
  if (primarySocket == socketWorlds.end()) {
    return fail(errorMessage, "Spatial evaluation could not resolve the primary socket.");
  }
  SpatialTransformSnapshot primaryGrip;
  if (!makeTransform(profile.primaryGrip.translation, profile.primaryGrip.rotation, &primaryGrip, errorMessage)
      || !composeTransforms(primarySocket->second, primaryGrip, &evaluation->itemWorld, errorMessage)) {
    return false;
  }

  if (profile.primaryContact) {
    SpatialTransformSnapshot local;
    SpatialTransformSnapshot world;
    if (!makeTransform(profile.primaryContact->translation, profile.primaryContact->rotation, &local, errorMessage)
        || !composeTransforms(evaluation->itemWorld, local, &world, errorMessage)) return false;
    evaluation->primaryContactWorld = world;
  }
  if (profile.handleAxis) {
    SpatialTransformSnapshot origin;
    if (!makeTransform(profile.handleAxis->origin, {}, &origin, errorMessage)
        || !composeTransforms(evaluation->itemWorld, origin, &origin, errorMessage)) return false;
    evaluation->handleAxisWorld = AttachmentHandleAxisSnapshot{
      origin.translation,
      rotateVector(evaluation->itemWorld.rotation, profile.handleAxis->direction),
    };
  }

  const std::string dominantRole = profile.dominantHand == "right" ? "hand_r" : "hand_l";
  const std::string secondaryRole = profile.dominantHand == "right" ? "hand_l" : "hand_r";
  const auto makeHand = [&](const SkeletonBoneSnapshot& bone) {
    EvaluatedHandFrameSnapshot hand{bone.id, bone.role, worlds.at(bone.id), std::nullopt};
    if (const auto* palm = palmSocketForBone(skeleton, bone.id)) hand.palmWorld = socketWorlds.at(palm->id);
    return hand;
  };
  if (const auto* dominant = boneWithRole(skeleton, dominantRole)) {
    evaluation->dominantHandFrame = makeHand(*dominant);
  }

  const bool secondaryEnabled = profile.secondaryHand && profile.secondaryHand->enabled;
  if (const auto* secondary = boneWithRole(skeleton, secondaryRole)) {
    const auto basicHand = makeHand(*secondary);
    EvaluatedSecondaryHandFrameSnapshot hand{
      secondaryEnabled,
      basicHand.bone,
      basicHand.role,
      basicHand.world,
      basicHand.palmWorld,
    };
    if (secondaryEnabled) {
      SpatialTransformSnapshot targetLocal;
      SpatialTransformSnapshot targetWorld;
      if (!makeTransform(profile.secondaryHand->targetTranslation, profile.secondaryHand->targetRotation, &targetLocal, errorMessage)
          || !composeTransforms(evaluation->itemWorld, targetLocal, &targetWorld, errorMessage)) return false;
      hand.targetWorld = targetWorld;
      hand.poleTranslation = profile.secondaryHand->poleTranslation;
      if (profile.schemaVersion >= 2 && profile.secondaryHand->poleSpace == "item") {
        hand.poleSpace = "item";
        const SpatialVector3Snapshot poleWorld = addVectors(
          evaluation->itemWorld.translation,
          rotateVector(evaluation->itemWorld.rotation, profile.secondaryHand->poleTranslation));
        if (!vectorIsFinite(poleWorld)) {
          return fail(errorMessage, "Spatial evaluation produced a non-finite secondary-hand pole.");
        }
        hand.poleWorld = poleWorld;
      } else {
        hand.poleSpace = "unresolved";
        hand.poleReason = "pole_space_not_authored";
      }
      if (hand.palmWorld) {
        const auto& palm = hand.palmWorld->translation;
        const double distance = std::hypot(
          targetWorld.translation.x - palm.x,
          targetWorld.translation.y - palm.y,
          targetWorld.translation.z - palm.z);
        if (!std::isfinite(distance)) {
          return fail(errorMessage, "Spatial evaluation produced a non-finite secondary-hand distance.");
        }
        hand.preSolveDistanceMeters = withoutSignedZero(distance);
      }
    }
    evaluation->secondaryHandFrame = std::move(hand);
  }
  return true;
}

bool evaluateRestAttachmentSnapshot(
  const AttachmentProfileSnapshot& profile,
  const SkeletonDefinitionSnapshot& skeleton,
  SpatialAttachmentEvaluationSnapshot* evaluation,
  std::string* errorMessage) {
  std::map<std::string, const SkeletonBoneSnapshot*> bonesById;
  for (const auto& bone : skeleton.boneDefinitions) bonesById.emplace(bone.id, &bone);

  std::map<std::string, SpatialTransformSnapshot> locals;
  std::map<std::string, SpatialTransformSnapshot> worlds;
  std::set<std::string> visiting;
  for (const auto& bone : skeleton.boneDefinitions) {
    if (!resolveBoneWorld(bone.id, bonesById, &locals, &worlds, &visiting, errorMessage)) return false;
  }

  std::vector<EvaluatedBonePoseSnapshot> posedBones;
  posedBones.reserve(skeleton.boneDefinitions.size());
  for (const auto& bone : skeleton.boneDefinitions) {
    posedBones.push_back({
      bone.id,
      bone.parent,
      bone.role,
      locals.at(bone.id),
      worlds.at(bone.id),
    });
  }
  return composeAttachmentEvaluation(profile, skeleton, posedBones, evaluation, errorMessage);
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
      if (!validateUtf8File(filePath, errorMessage)
          || !loadSkeletonFile(filePath, &skeleton, errorMessage)) {
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
      if (!validateUtf8File(filePath, errorMessage)
          || !loadClipFile(filePath, nextSkeletons, &clip, errorMessage)) {
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
      if (!validateUtf8File(filePath, errorMessage)
          || !loadGraphFile(filePath, nextSkeletons, nextClips, &graph, errorMessage)) {
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
        if (!validateUtf8File(filePath, errorMessage)
            || !loadAttachmentProfileFile(filePath, nextSkeletons, nextClips, &profile, errorMessage)) {
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

std::optional<SpatialAttachmentEvaluationSnapshot> AnimationSystem::evaluateRestAttachment(
  AttachmentProfileId id,
  std::string* errorMessage) const {
  const auto profile = snapshotAttachmentProfile(id);
  if (!profile) {
    fail(errorMessage, "Unknown attachment handle.");
    return std::nullopt;
  }
  const auto skeleton = snapshotSkeleton(profile->skeletonHandle);
  if (!skeleton) {
    fail(errorMessage, "Attachment references a missing skeleton handle.");
    return std::nullopt;
  }
  SpatialAttachmentEvaluationSnapshot evaluation;
  if (!evaluateRestAttachmentSnapshot(*profile, *skeleton, &evaluation, errorMessage)) return std::nullopt;
  setSecondaryIkUnavailable(
    &evaluation,
    profile->schemaVersion >= 2 ? "rest_pose_unsolved" : "secondary_hand_ik_not_implemented");
  return evaluation;
}

std::optional<SpatialSampledAttachmentEvaluationSnapshot> AnimationSystem::evaluateSampledAttachment(
  AttachmentProfileId id,
  std::string_view phase,
  double normalizedTime,
  std::string* errorMessage) const {
  if (phase.empty()) {
    fail(errorMessage, "Motion-envelope phase must not be empty.");
    return std::nullopt;
  }
  if (!std::isfinite(normalizedTime)) {
    fail(errorMessage, "Attachment sample time must be a finite value.");
    return std::nullopt;
  }

  const auto profile = snapshotAttachmentProfile(id);
  if (!profile) {
    fail(errorMessage, "Unknown attachment handle.");
    return std::nullopt;
  }
  const auto skeleton = snapshotSkeleton(profile->skeletonHandle);
  if (!skeleton) {
    fail(errorMessage, "Attachment references a missing skeleton handle.");
    return std::nullopt;
  }

  const AttachmentMotionEnvelopeSnapshot* envelope = nullptr;
  for (const auto& candidate : profile->motionEnvelopes) {
    if (candidate.phase == phase) {
      envelope = &candidate;
      break;
    }
  }
  if (envelope == nullptr) {
    fail(errorMessage, "Unknown motion-envelope phase '" + std::string(phase) + "'.");
    return std::nullopt;
  }
  if (std::find(envelope->normalizedTimes.begin(), envelope->normalizedTimes.end(), normalizedTime)
      == envelope->normalizedTimes.end()) {
    fail(errorMessage, "Normalized time is not an authored sample of motion-envelope phase '" + envelope->phase + "'.");
    return std::nullopt;
  }

  const bool requestSecondaryIk = std::find(
    envelope->proceduralLayers.begin(),
    envelope->proceduralLayers.end(),
    "secondary_hand_ik") != envelope->proceduralLayers.end();
  const bool applySecondaryIk = profile->schemaVersion >= 2
    && profile->mode == "two_hand"
    && profile->secondaryHand
    && profile->secondaryHand->enabled
    && profile->secondaryHand->poleSpace == "item"
    && requestSecondaryIk;

  std::vector<std::string> applied;
  std::vector<std::string> unavailable;
  if (!classifyProceduralLayers(envelope->proceduralLayers, applySecondaryIk, &applied, &unavailable, errorMessage)) {
    return std::nullopt;
  }

  const auto sampledPose = sampleClipPose(envelope->clip, normalizedTime, errorMessage);
  if (!sampledPose) {
    return std::nullopt;
  }

  SpatialSampledAttachmentEvaluationSnapshot result;
  if (!composeAttachmentEvaluation(*profile, *skeleton, sampledPose->bones, &result.evaluation, errorMessage)) {
    return std::nullopt;
  }
  if (applySecondaryIk) {
    const auto preSolveDistance = result.evaluation.secondaryHandFrame
      ? result.evaluation.secondaryHandFrame->preSolveDistanceMeters
      : std::nullopt;
    std::vector<EvaluatedBonePoseSnapshot> solvedBones = result.evaluation.bones;
    SpatialSecondaryIkDiagnosticSnapshot diagnostic;
    if (!applySecondaryHandTwoBoneIk(*profile, *skeleton, result.evaluation, &solvedBones, &diagnostic, errorMessage)) {
      return std::nullopt;
    }
    result.evaluation = {};
    if (!composeAttachmentEvaluation(*profile, *skeleton, solvedBones, &result.evaluation, errorMessage)) {
      return std::nullopt;
    }
    if (result.evaluation.secondaryHandFrame) {
      result.evaluation.secondaryHandFrame->preSolveDistanceMeters = preSolveDistance;
    }
    double postSolveDistance = 0.0;
    if (!result.evaluation.secondaryHandFrame
        || !result.evaluation.secondaryHandFrame->palmWorld
        || !result.evaluation.secondaryHandFrame->targetWorld) {
      fail(errorMessage, "Spatial evaluation secondary-hand IK is missing a palm_contact socket.");
      return std::nullopt;
    }
    const auto& palm = result.evaluation.secondaryHandFrame->palmWorld->translation;
    const auto& target = result.evaluation.secondaryHandFrame->targetWorld->translation;
    postSolveDistance = std::hypot(target.x - palm.x, target.y - palm.y, target.z - palm.z);
    const auto& palmRotation = result.evaluation.secondaryHandFrame->palmWorld->rotation;
    const auto& targetRotation = result.evaluation.secondaryHandFrame->targetWorld->rotation;
    const double rotationDot = std::clamp(std::abs(
      palmRotation.x * targetRotation.x
      + palmRotation.y * targetRotation.y
      + palmRotation.z * targetRotation.z
      + palmRotation.w * targetRotation.w), 0.0, 1.0);
    const double postSolveAngleDegrees = 2.0 * std::acos(rotationDot) * 180.0 / std::acos(-1.0);
    if (!std::isfinite(postSolveDistance) || !std::isfinite(postSolveAngleDegrees)) {
      fail(errorMessage, "Spatial evaluation produced a non-finite secondary-hand distance.");
      return std::nullopt;
    }
    diagnostic.preSolveDistanceMeters = preSolveDistance;
    diagnostic.postSolveDistanceMeters = withoutSignedZero(postSolveDistance);
    diagnostic.contactWithinTolerance = diagnostic.contactToleranceMeters
      && postSolveDistance <= *diagnostic.contactToleranceMeters;
    diagnostic.postSolveAngleDegrees = withoutSignedZero(postSolveAngleDegrees);
    diagnostic.angleWithinTolerance = diagnostic.angleToleranceDegrees
      && postSolveAngleDegrees <= *diagnostic.angleToleranceDegrees;
    diagnostic.withinTolerance = diagnostic.reachWithinTolerance
      && *diagnostic.reachWithinTolerance
      && diagnostic.contactWithinTolerance
      && *diagnostic.contactWithinTolerance
      && diagnostic.angleWithinTolerance
      && *diagnostic.angleWithinTolerance;
    result.evaluation.secondaryIk = std::move(diagnostic);
  } else if (profile->mode == "two_hand") {
    setSecondaryIkUnavailable(&result.evaluation, "secondary_hand_ik_not_implemented");
  } else {
    setSecondaryIkUnavailable(&result.evaluation, "one_hand_attachment");
  }
  result.phase = envelope->phase;
  result.clipName = sampledPose->clipName;
  result.normalizedTime = sampledPose->normalizedTime;
  result.proceduralLayersRequested = envelope->proceduralLayers;
  result.proceduralLayersApplied = std::move(applied);
  result.proceduralLayersUnavailable = std::move(unavailable);
  return result;
}

std::optional<SampledClipPoseSnapshot> AnimationSystem::sampleClipPose(
  std::string_view clipName,
  double normalizedTime,
  std::string* errorMessage) const {
  if (!std::isfinite(normalizedTime) || normalizedTime < 0.0 || normalizedTime > 1.0) {
    fail(errorMessage, "Clip sample time must be a finite value in [0, 1].");
    return std::nullopt;
  }

  const ClipDefinitionSnapshot* clip = findClipByName(impl_->clips, clipName);
  if (clip == nullptr) {
    fail(errorMessage, "Unknown animation clip '" + std::string(clipName) + "'.");
    return std::nullopt;
  }
  if (clip->schemaVersion != 2) {
    fail(errorMessage, "Animation clip '" + clip->name + "' does not support pose sampling.");
    return std::nullopt;
  }

  const SkeletonDefinitionSnapshot* skeleton = findSkeletonByName(impl_->skeletons, clip->skeletonName);
  if (skeleton == nullptr || skeleton->schemaVersion != 2) {
    fail(errorMessage, "Animation clip '" + clip->name + "' references a missing v2 skeleton.");
    return std::nullopt;
  }

  std::map<std::string, const ClipTrackSnapshot*> tracksByBone;
  for (const auto& track : clip->tracks) {
    tracksByBone.emplace(track.bone, &track);
  }

  std::vector<SkeletonBoneSnapshot> posedBones = skeleton->boneDefinitions;
  for (auto& bone : posedBones) {
    const auto found = tracksByBone.find(bone.id);
    if (found == tracksByBone.end()) {
      continue;
    }
    if (!sampleClipTrack(*found->second, normalizedTime, &bone.translation, &bone.rotation, errorMessage)) {
      return std::nullopt;
    }
  }

  std::map<std::string, const SkeletonBoneSnapshot*> bonesById;
  for (const auto& bone : posedBones) {
    bonesById.emplace(bone.id, &bone);
  }

  std::map<std::string, SpatialTransformSnapshot> locals;
  std::map<std::string, SpatialTransformSnapshot> worlds;
  std::set<std::string> visiting;
  for (const auto& bone : posedBones) {
    if (!resolveBoneWorld(bone.id, bonesById, &locals, &worlds, &visiting, errorMessage)) {
      return std::nullopt;
    }
  }

  SampledClipPoseSnapshot pose;
  pose.clipName = clip->name;
  pose.skeletonName = clip->skeletonName;
  pose.normalizedTime = withoutSignedZero(normalizedTime);
  for (const auto& bone : posedBones) {
    pose.bones.push_back({
      bone.id,
      bone.parent,
      bone.role,
      locals.at(bone.id),
      worlds.at(bone.id),
    });
  }
  return pose;
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
