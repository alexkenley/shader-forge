#pragma once

#include <filesystem>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace shader_forge::runtime {

struct AudioConfig {
  std::filesystem::path rootPath = "audio";
};

struct AudioBusSnapshot {
  std::string name;
  std::string displayName;
  std::string parent;
  float defaultVolumeDb = 0.0f;
  bool defaultMuted = false;
  std::filesystem::path sourcePath;
  bool valid = false;
};

struct SoundDefinitionSnapshot {
  std::string name;
  std::string bus;
  std::filesystem::path sourceMediaPath;
  std::string playbackMode;
  std::string spatialization;
  float defaultVolumeDb = 0.0f;
  bool stream = false;
  bool loop = false;
  std::filesystem::path sourcePath;
  bool valid = false;
};

struct AudioEventSnapshot {
  std::string name;
  std::string action;
  std::string sound;
  std::string busOverride;
  int fadeMs = 0;
  std::filesystem::path sourcePath;
  bool valid = false;
};

struct ResolvedAudioEventSnapshot {
  std::string eventName;
  std::string action;
  std::string soundName;
  std::string busName;
  std::filesystem::path sourceMediaPath;
  std::string playbackMode;
  std::string spatialization;
  float defaultVolumeDb = 0.0f;
  bool stream = false;
  bool loop = false;
  int fadeMs = 0;
};

class AudioSystem {
public:
  AudioSystem();
  ~AudioSystem();

  AudioSystem(AudioSystem&&) noexcept;
  AudioSystem& operator=(AudioSystem&&) noexcept;

  AudioSystem(const AudioSystem&) = delete;
  AudioSystem& operator=(const AudioSystem&) = delete;

  bool loadFromDisk(const AudioConfig& config, std::string* errorMessage = nullptr);

  std::size_t busCount() const;
  std::size_t soundCount() const;
  std::size_t eventCount() const;

  bool hasEvent(std::string_view eventName) const;
  std::vector<AudioBusSnapshot> snapshotBuses() const;
  std::vector<SoundDefinitionSnapshot> snapshotSounds() const;
  std::vector<AudioEventSnapshot> snapshotEvents() const;
  std::optional<ResolvedAudioEventSnapshot> resolveEvent(std::string_view eventName) const;

  std::string foundationSummary() const;
  std::string busRoutingSummary() const;
  std::string eventCatalogSummary() const;

private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace shader_forge::runtime
