#include "shader_forge/runtime/animation_system.hpp"

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
    if (skeleton.name == name) {
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
  if (schemaVersion <= 0) {
    if (errorMessage) {
      *errorMessage = "Animation skeleton schema_version must be a positive integer in " + path.string();
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
        clip->skeletonName = normalizeToken(parseStringValue(value));
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
  if (findSkeletonByName(skeletons, clip->skeletonName) == nullptr) {
    if (errorMessage) {
      *errorMessage = "Animation clip '" + clip->name + "' references missing skeleton '" + clip->skeletonName + "'.";
    }
    return false;
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
      graph->skeletonName = normalizeToken(parseStringValue(value));
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
  if (findSkeletonByName(skeletons, graph->skeletonName) == nullptr) {
    if (errorMessage) {
      *errorMessage = "Animation graph '" + graph->name + "' references missing skeleton '" + graph->skeletonName + "'.";
    }
    return false;
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

}  // namespace

struct AnimationSystem::Impl {
  AnimationConfig config;
  std::vector<SkeletonDefinitionSnapshot> skeletons;
  std::vector<ClipDefinitionSnapshot> clips;
  std::vector<GraphDefinitionSnapshot> graphs;

  bool load(const AnimationConfig& nextConfig, std::string* errorMessage) {
    config = nextConfig;
    skeletons.clear();
    clips.clear();
    graphs.clear();

    const std::filesystem::path skeletonsPath = config.rootPath / "skeletons";
    const std::filesystem::path clipsPath = config.rootPath / "clips";
    const std::filesystem::path graphsPath = config.rootPath / "graphs";

    if (!std::filesystem::exists(skeletonsPath)) {
      if (errorMessage) {
        *errorMessage = "Animation skeletons directory is missing: " + skeletonsPath.string();
      }
      return false;
    }
    if (!std::filesystem::exists(clipsPath)) {
      if (errorMessage) {
        *errorMessage = "Animation clips directory is missing: " + clipsPath.string();
      }
      return false;
    }
    if (!std::filesystem::exists(graphsPath)) {
      if (errorMessage) {
        *errorMessage = "Animation graphs directory is missing: " + graphsPath.string();
      }
      return false;
    }

    for (const auto& filePath : sortedRegularFiles(skeletonsPath)) {
      SkeletonDefinitionSnapshot skeleton;
      if (!loadSkeletonFile(filePath, &skeleton, errorMessage)) {
        return false;
      }
      skeletons.push_back(std::move(skeleton));
    }

    if (skeletons.empty()) {
      if (errorMessage) {
        *errorMessage = "Animation system does not have any skeleton definitions under " + skeletonsPath.string();
      }
      return false;
    }

    for (const auto& filePath : sortedRegularFiles(clipsPath)) {
      ClipDefinitionSnapshot clip;
      if (!loadClipFile(filePath, skeletons, &clip, errorMessage)) {
        return false;
      }
      clips.push_back(std::move(clip));
    }

    if (clips.empty()) {
      if (errorMessage) {
        *errorMessage = "Animation system does not have any clip definitions under " + clipsPath.string();
      }
      return false;
    }

    for (const auto& filePath : sortedRegularFiles(graphsPath)) {
      GraphDefinitionSnapshot graph;
      if (!loadGraphFile(filePath, skeletons, clips, &graph, errorMessage)) {
        return false;
      }
      graphs.push_back(std::move(graph));
    }

    if (graphs.empty()) {
      if (errorMessage) {
        *errorMessage = "Animation system does not have any graph definitions under " + graphsPath.string();
      }
      return false;
    }

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
          << ", graphs=" << impl_->graphs.size();
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
