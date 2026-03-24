#pragma once

#include <array>
#include <filesystem>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace shader_forge::runtime {

struct SaveSystemConfig {
  std::filesystem::path rootPath = "saved/runtime";
};

struct RuntimeSaveSnapshot {
  std::string slotName;
  std::string savedAt;
  std::string sceneName;
  std::string controlledEntityId;
  std::string controlledDisplayName;
  std::string controlledPrefabName;
  std::string controlledSpawnTag;
  std::array<float, 3> controlledPosition{0.0F, 0.0F, 0.0F};
  std::array<float, 3> controlledRotation{0.0F, 0.0F, 0.0F};
  std::string animationGraphName;
  std::string animationStateName;
  std::vector<std::string> triggeredOverlapBodies;
  std::filesystem::path sourcePath;
  bool valid = false;
};

class SaveSystem {
public:
  SaveSystem();
  ~SaveSystem();

  SaveSystem(SaveSystem&&) noexcept;
  SaveSystem& operator=(SaveSystem&&) noexcept;

  SaveSystem(const SaveSystem&) = delete;
  SaveSystem& operator=(const SaveSystem&) = delete;

  bool initialize(const SaveSystemConfig& config, std::string* errorMessage = nullptr);

  std::filesystem::path slotPath(std::string_view slotName) const;
  bool saveSlot(
    std::string_view slotName,
    const RuntimeSaveSnapshot& snapshot,
    std::string* errorMessage = nullptr) const;
  std::optional<RuntimeSaveSnapshot> loadSlot(
    std::string_view slotName,
    std::string* errorMessage = nullptr) const;

  std::string foundationSummary() const;

private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace shader_forge::runtime
