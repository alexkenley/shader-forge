#include "shader_forge/runtime/audio_system.hpp"

#include <algorithm>
#include <array>
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

bool parseFloatValue(const std::string& rawValue, float* result) {
  try {
    *result = std::stof(parseStringValue(rawValue));
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

bool hasSupportedAudioExtension(const std::filesystem::path& path) {
  const std::string extension = lowerString(path.extension().string());
  return extension == ".wav" || extension == ".ogg" || extension == ".flac" || extension == ".mp3";
}

const SoundDefinitionSnapshot* findSoundByName(const std::vector<SoundDefinitionSnapshot>& sounds, std::string_view name) {
  for (const auto& sound : sounds) {
    if (sound.name == name) {
      return &sound;
    }
  }
  return nullptr;
}

const AudioBusSnapshot* findBusByName(const std::vector<AudioBusSnapshot>& buses, std::string_view name) {
  for (const auto& bus : buses) {
    if (bus.name == name) {
      return &bus;
    }
  }
  return nullptr;
}

bool loadBusFile(
  const std::filesystem::path& path,
  std::vector<AudioBusSnapshot>* buses,
  std::string* errorMessage) {
  std::ifstream stream(path);
  if (!stream.is_open()) {
    if (errorMessage) {
      *errorMessage = "Could not open audio bus file at " + path.string();
    }
    return false;
  }

  std::string schema;
  int schemaVersion = 0;
  AudioBusSnapshot* currentBus = nullptr;
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
      if (!section.starts_with("bus.")) {
        if (errorMessage) {
          *errorMessage = "Invalid audio bus section '" + section + "' in " + path.string();
        }
        return false;
      }

      const std::string busName = normalizeToken(section.substr(4));
      if (busName.empty()) {
        if (errorMessage) {
          *errorMessage = "Audio bus section is missing a bus name in " + path.string();
        }
        return false;
      }

      buses->push_back(AudioBusSnapshot{
        .name = busName,
        .displayName = section.substr(4),
        .sourcePath = path,
        .valid = false,
      });
      currentBus = &buses->back();
      continue;
    }

    std::string key;
    std::string value;
    if (!parseKeyValue(cleaned, &key, &value)) {
      if (errorMessage) {
        *errorMessage = "Invalid audio bus line " + std::to_string(lineNumber) + " in " + path.string();
      }
      return false;
    }

    if (currentBus == nullptr) {
      if (key == "schema") {
        schema = lowerString(parseStringValue(value));
      } else if (key == "schema_version") {
        if (!parseIntValue(value, &schemaVersion)) {
          if (errorMessage) {
            *errorMessage = "Invalid audio bus schema_version in " + path.string();
          }
          return false;
        }
      }
      continue;
    }

    if (key == "display_name") {
      currentBus->displayName = parseStringValue(value);
    } else if (key == "parent") {
      currentBus->parent = normalizeToken(parseStringValue(value));
    } else if (key == "default_volume_db") {
      if (!parseFloatValue(value, &currentBus->defaultVolumeDb)) {
        if (errorMessage) {
          *errorMessage = "Invalid default_volume_db for bus '" + currentBus->name + "' in " + path.string();
        }
        return false;
      }
    } else if (key == "default_muted") {
      if (!parseBoolValue(value, &currentBus->defaultMuted)) {
        if (errorMessage) {
          *errorMessage = "Invalid default_muted for bus '" + currentBus->name + "' in " + path.string();
        }
        return false;
      }
    }
  }

  if (schema != "shader_forge.audio_buses") {
    if (errorMessage) {
      *errorMessage = "Audio bus file schema must be 'shader_forge.audio_buses'.";
    }
    return false;
  }
  if (schemaVersion <= 0) {
    if (errorMessage) {
      *errorMessage = "Audio bus file schema_version must be a positive integer.";
    }
    return false;
  }
  if (buses->empty()) {
    if (errorMessage) {
      *errorMessage = "Audio bus file does not declare any buses.";
    }
    return false;
  }

  constexpr std::array<std::string_view, 5> requiredBuses = {
    "master",
    "music",
    "sfx",
    "voice",
    "ambience",
  };

  for (auto& bus : *buses) {
    if (bus.displayName.empty()) {
      bus.displayName = bus.name;
    }
    if (!bus.parent.empty() && findBusByName(*buses, bus.parent) == nullptr) {
      if (errorMessage) {
        *errorMessage = "Audio bus '" + bus.name + "' references missing parent '" + bus.parent + "'.";
      }
      return false;
    }
    if (bus.parent == bus.name) {
      if (errorMessage) {
        *errorMessage = "Audio bus '" + bus.name + "' cannot parent itself.";
      }
      return false;
    }
    bus.valid = true;
  }

  for (std::string_view requiredBus : requiredBuses) {
    if (findBusByName(*buses, requiredBus) == nullptr) {
      if (errorMessage) {
        *errorMessage = "Audio bus file is missing required bus '" + std::string(requiredBus) + "'.";
      }
      return false;
    }
  }

  return true;
}

bool loadSoundFile(
  const std::filesystem::path& rootPath,
  const std::filesystem::path& path,
  const std::vector<AudioBusSnapshot>& buses,
  SoundDefinitionSnapshot* sound,
  std::string* errorMessage) {
  std::ifstream stream(path);
  if (!stream.is_open()) {
    if (errorMessage) {
      *errorMessage = "Could not open audio sound file at " + path.string();
    }
    return false;
  }

  std::string schema;
  std::string ownerSystem;
  int schemaVersion = 0;
  std::string sourceMedia;
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
        *errorMessage = "Invalid audio sound line " + std::to_string(lineNumber) + " in " + path.string();
      }
      return false;
    }

    if (key == "schema") {
      schema = lowerString(parseStringValue(value));
    } else if (key == "schema_version") {
      if (!parseIntValue(value, &schemaVersion)) {
        if (errorMessage) {
          *errorMessage = "Invalid schema_version in " + path.string();
        }
        return false;
      }
    } else if (key == "name") {
      sound->name = normalizeToken(parseStringValue(value));
    } else if (key == "owner_system") {
      ownerSystem = normalizeToken(parseStringValue(value));
    } else if (key == "source_media") {
      sourceMedia = parseStringValue(value);
    } else if (key == "bus") {
      sound->bus = normalizeToken(parseStringValue(value));
    } else if (key == "playback_mode") {
      sound->playbackMode = normalizeToken(parseStringValue(value));
    } else if (key == "spatialization") {
      sound->spatialization = normalizeToken(parseStringValue(value));
    } else if (key == "default_volume_db") {
      if (!parseFloatValue(value, &sound->defaultVolumeDb)) {
        if (errorMessage) {
          *errorMessage = "Invalid default_volume_db in " + path.string();
        }
        return false;
      }
    } else if (key == "stream") {
      if (!parseBoolValue(value, &sound->stream)) {
        if (errorMessage) {
          *errorMessage = "Invalid stream flag in " + path.string();
        }
        return false;
      }
    } else if (key == "loop") {
      if (!parseBoolValue(value, &sound->loop)) {
        if (errorMessage) {
          *errorMessage = "Invalid loop flag in " + path.string();
        }
        return false;
      }
    }
  }

  sound->sourcePath = path;
  sound->sourceMediaPath = rootPath / sourceMedia;

  if (schema != "shader_forge.sound") {
    if (errorMessage) {
      *errorMessage = "Audio sound schema must be 'shader_forge.sound' in " + path.string();
    }
    return false;
  }
  if (schemaVersion <= 0) {
    if (errorMessage) {
      *errorMessage = "Audio sound schema_version must be a positive integer in " + path.string();
    }
    return false;
  }
  if (ownerSystem != "audio_system") {
    if (errorMessage) {
      *errorMessage = "Audio sound owner_system must be 'audio_system' in " + path.string();
    }
    return false;
  }
  if (sound->name.empty()) {
    if (errorMessage) {
      *errorMessage = "Audio sound is missing a name in " + path.string();
    }
    return false;
  }
  if (findBusByName(buses, sound->bus) == nullptr) {
    if (errorMessage) {
      *errorMessage = "Audio sound '" + sound->name + "' references missing bus '" + sound->bus + "'.";
    }
    return false;
  }
  if (!hasSupportedAudioExtension(sound->sourceMediaPath)) {
    if (errorMessage) {
      *errorMessage = "Audio sound '" + sound->name + "' must reference .wav, .ogg, .flac, or .mp3 media.";
    }
    return false;
  }
  if (!std::filesystem::exists(sound->sourceMediaPath)) {
    if (errorMessage) {
      *errorMessage = "Audio sound '" + sound->name + "' references missing media '" + sound->sourceMediaPath.string() + "'.";
    }
    return false;
  }
  if (sound->playbackMode != "oneshot" && sound->playbackMode != "looped") {
    if (errorMessage) {
      *errorMessage = "Audio sound '" + sound->name + "' playback_mode must be 'oneshot' or 'looped'.";
    }
    return false;
  }
  if (sound->spatialization != "2d" && sound->spatialization != "3d") {
    if (errorMessage) {
      *errorMessage = "Audio sound '" + sound->name + "' spatialization must be '2d' or '3d'.";
    }
    return false;
  }

  sound->valid = true;
  return true;
}

bool loadEventFile(
  const std::filesystem::path& path,
  const std::vector<AudioBusSnapshot>& buses,
  const std::vector<SoundDefinitionSnapshot>& sounds,
  AudioEventSnapshot* eventSnapshot,
  std::string* errorMessage) {
  std::ifstream stream(path);
  if (!stream.is_open()) {
    if (errorMessage) {
      *errorMessage = "Could not open audio event file at " + path.string();
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
        *errorMessage = "Invalid audio event line " + std::to_string(lineNumber) + " in " + path.string();
      }
      return false;
    }

    if (key == "schema") {
      schema = lowerString(parseStringValue(value));
    } else if (key == "schema_version") {
      if (!parseIntValue(value, &schemaVersion)) {
        if (errorMessage) {
          *errorMessage = "Invalid schema_version in " + path.string();
        }
        return false;
      }
    } else if (key == "name") {
      eventSnapshot->name = normalizeToken(parseStringValue(value));
    } else if (key == "owner_system") {
      ownerSystem = normalizeToken(parseStringValue(value));
    } else if (key == "action") {
      eventSnapshot->action = normalizeToken(parseStringValue(value));
    } else if (key == "sound") {
      eventSnapshot->sound = normalizeToken(parseStringValue(value));
    } else if (key == "bus_override") {
      eventSnapshot->busOverride = normalizeToken(parseStringValue(value));
    } else if (key == "fade_ms") {
      if (!parseIntValue(value, &eventSnapshot->fadeMs)) {
        if (errorMessage) {
          *errorMessage = "Invalid fade_ms in " + path.string();
        }
        return false;
      }
    }
  }

  eventSnapshot->sourcePath = path;

  if (schema != "shader_forge.audio_event") {
    if (errorMessage) {
      *errorMessage = "Audio event schema must be 'shader_forge.audio_event' in " + path.string();
    }
    return false;
  }
  if (schemaVersion <= 0) {
    if (errorMessage) {
      *errorMessage = "Audio event schema_version must be a positive integer in " + path.string();
    }
    return false;
  }
  if (ownerSystem != "audio_system") {
    if (errorMessage) {
      *errorMessage = "Audio event owner_system must be 'audio_system' in " + path.string();
    }
    return false;
  }
  if (eventSnapshot->name.empty()) {
    if (errorMessage) {
      *errorMessage = "Audio event is missing a name in " + path.string();
    }
    return false;
  }
  if (eventSnapshot->action != "play_sound") {
    if (errorMessage) {
      *errorMessage = "Audio event '" + eventSnapshot->name + "' action must be 'play_sound'.";
    }
    return false;
  }
  if (findSoundByName(sounds, eventSnapshot->sound) == nullptr) {
    if (errorMessage) {
      *errorMessage = "Audio event '" + eventSnapshot->name + "' references missing sound '" + eventSnapshot->sound + "'.";
    }
    return false;
  }
  if (!eventSnapshot->busOverride.empty() && findBusByName(buses, eventSnapshot->busOverride) == nullptr) {
    if (errorMessage) {
      *errorMessage = "Audio event '" + eventSnapshot->name + "' references missing bus override '" + eventSnapshot->busOverride + "'.";
    }
    return false;
  }
  if (eventSnapshot->fadeMs < 0) {
    if (errorMessage) {
      *errorMessage = "Audio event '" + eventSnapshot->name + "' fade_ms must be >= 0.";
    }
    return false;
  }

  eventSnapshot->valid = true;
  return true;
}

}  // namespace

struct AudioSystem::Impl {
  AudioConfig config;
  std::vector<AudioBusSnapshot> buses;
  std::vector<SoundDefinitionSnapshot> sounds;
  std::vector<AudioEventSnapshot> events;

  bool load(const AudioConfig& nextConfig, std::string* errorMessage) {
    config = nextConfig;
    buses.clear();
    sounds.clear();
    events.clear();

    const std::filesystem::path busesPath = config.rootPath / "buses.toml";
    const std::filesystem::path soundsPath = config.rootPath / "sounds";
    const std::filesystem::path eventsPath = config.rootPath / "events";

    if (!loadBusFile(busesPath, &buses, errorMessage)) {
      return false;
    }

    if (!std::filesystem::exists(soundsPath)) {
      if (errorMessage) {
        *errorMessage = "Audio sounds directory is missing: " + soundsPath.string();
      }
      return false;
    }
    if (!std::filesystem::exists(eventsPath)) {
      if (errorMessage) {
        *errorMessage = "Audio events directory is missing: " + eventsPath.string();
      }
      return false;
    }

    for (const auto& entry : std::filesystem::directory_iterator(soundsPath)) {
      if (!entry.is_regular_file()) {
        continue;
      }
      SoundDefinitionSnapshot sound;
      if (!loadSoundFile(config.rootPath, entry.path(), buses, &sound, errorMessage)) {
        return false;
      }
      sounds.push_back(sound);
    }

    if (sounds.empty()) {
      if (errorMessage) {
        *errorMessage = "Audio system does not have any sound definitions under " + soundsPath.string();
      }
      return false;
    }

    for (const auto& entry : std::filesystem::directory_iterator(eventsPath)) {
      if (!entry.is_regular_file()) {
        continue;
      }
      AudioEventSnapshot eventSnapshot;
      if (!loadEventFile(entry.path(), buses, sounds, &eventSnapshot, errorMessage)) {
        return false;
      }
      events.push_back(eventSnapshot);
    }

    if (events.empty()) {
      if (errorMessage) {
        *errorMessage = "Audio system does not have any audio events under " + eventsPath.string();
      }
      return false;
    }

    return true;
  }
};

AudioSystem::AudioSystem()
    : impl_(std::make_unique<Impl>()) {}

AudioSystem::~AudioSystem() = default;

AudioSystem::AudioSystem(AudioSystem&&) noexcept = default;

AudioSystem& AudioSystem::operator=(AudioSystem&&) noexcept = default;

bool AudioSystem::loadFromDisk(const AudioConfig& config, std::string* errorMessage) {
  return impl_->load(config, errorMessage);
}

std::size_t AudioSystem::busCount() const {
  return impl_->buses.size();
}

std::size_t AudioSystem::soundCount() const {
  return impl_->sounds.size();
}

std::size_t AudioSystem::eventCount() const {
  return impl_->events.size();
}

bool AudioSystem::hasEvent(std::string_view eventName) const {
  const std::string normalized = normalizeToken(std::string(eventName));
  for (const auto& eventSnapshot : impl_->events) {
    if (eventSnapshot.name == normalized) {
      return true;
    }
  }
  return false;
}

std::vector<AudioBusSnapshot> AudioSystem::snapshotBuses() const {
  return impl_->buses;
}

std::vector<SoundDefinitionSnapshot> AudioSystem::snapshotSounds() const {
  return impl_->sounds;
}

std::vector<AudioEventSnapshot> AudioSystem::snapshotEvents() const {
  return impl_->events;
}

std::optional<ResolvedAudioEventSnapshot> AudioSystem::resolveEvent(std::string_view eventName) const {
  const std::string normalized = normalizeToken(std::string(eventName));
  for (const auto& eventSnapshot : impl_->events) {
    if (eventSnapshot.name != normalized) {
      continue;
    }

    const SoundDefinitionSnapshot* sound = findSoundByName(impl_->sounds, eventSnapshot.sound);
    if (sound == nullptr) {
      return std::nullopt;
    }

    ResolvedAudioEventSnapshot resolved;
    resolved.eventName = eventSnapshot.name;
    resolved.action = eventSnapshot.action;
    resolved.soundName = sound->name;
    resolved.busName = !eventSnapshot.busOverride.empty() ? eventSnapshot.busOverride : sound->bus;
    resolved.sourceMediaPath = sound->sourceMediaPath;
    resolved.playbackMode = sound->playbackMode;
    resolved.spatialization = sound->spatialization;
    resolved.defaultVolumeDb = sound->defaultVolumeDb;
    resolved.stream = sound->stream;
    resolved.loop = sound->loop;
    resolved.fadeMs = eventSnapshot.fadeMs;
    return resolved;
  }
  return std::nullopt;
}

std::string AudioSystem::foundationSummary() const {
  std::ostringstream summary;
  summary << "Audio foundation: root=" << relativePathString(impl_->config.rootPath)
          << ", buses=" << impl_->buses.size()
          << ", sounds=" << impl_->sounds.size()
          << ", events=" << impl_->events.size();
  return summary.str();
}

std::string AudioSystem::busRoutingSummary() const {
  std::ostringstream summary;
  for (const auto& bus : impl_->buses) {
    summary << "audio-bus " << bus.name << " -> "
            << (bus.parent.empty() ? "output" : bus.parent)
            << " (default_volume_db=" << bus.defaultVolumeDb
            << ", muted=" << (bus.defaultMuted ? "true" : "false") << ")\n";
  }
  return summary.str();
}

std::string AudioSystem::eventCatalogSummary() const {
  std::ostringstream summary;
  for (const auto& eventSnapshot : impl_->events) {
    summary << "audio-event " << eventSnapshot.name
            << " -> sound=" << eventSnapshot.sound;
    if (const auto resolved = resolveEvent(eventSnapshot.name); resolved.has_value()) {
      summary << ", bus=" << resolved->busName
              << ", spatialization=" << resolved->spatialization
              << ", media=" << relativePathString(resolved->sourceMediaPath);
    }
    summary << '\n';
  }
  return summary.str();
}

}  // namespace shader_forge::runtime
