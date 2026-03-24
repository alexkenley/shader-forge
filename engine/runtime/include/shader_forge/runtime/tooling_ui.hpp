#pragma once

#include <cstddef>
#include <filesystem>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

namespace shader_forge::runtime {

enum class ToolDockArea {
  left,
  right,
  bottom,
  center,
  overlay,
};

struct ToolingUiConfig {
  std::filesystem::path layoutPath = "tooling/layouts/default.tooling-layout.toml";
  std::filesystem::path sessionLayoutPath = "tooling/layouts/runtime-session.tooling-layout.toml";
};

struct ToolPanelSnapshot {
  std::string name;
  std::string title;
  std::string contextKey;
  ToolDockArea dockArea = ToolDockArea::left;
  bool visible = false;
  int order = 0;
};

struct ToolingRuntimeStateSnapshot {
  std::string controlledEntityId;
  std::string controlledEntityPosition;
  std::string blockedBodyName;
  std::string physicsFocusBodyName;
  std::string animationGraphName;
  std::string animationStateName;
  std::string animationClipName;
  std::string interactionTargetId;
  std::string interactionEffectName;
  std::string activeTriggeredEffectName;
  std::size_t physicsBodyCount = 0;
  std::size_t queryBodyCount = 0;
  std::size_t activeOverlapBodyCount = 0;
  float moveSpeed = 0.0F;
  bool controlledEntityValid = false;
  bool interactionTargetValid = false;
  bool physicsDebugEnabled = false;
};

class ToolingUiSystem {
public:
  ToolingUiSystem();
  ~ToolingUiSystem();

  ToolingUiSystem(ToolingUiSystem&&) noexcept;
  ToolingUiSystem& operator=(ToolingUiSystem&&) noexcept;

  ToolingUiSystem(const ToolingUiSystem&) = delete;
  ToolingUiSystem& operator=(const ToolingUiSystem&) = delete;

  bool loadLayout(const ToolingUiConfig& config, std::string* errorMessage = nullptr);
  bool saveSessionLayout(std::string* errorMessage = nullptr) const;

  void toggleOverlay();
  bool overlayVisible() const;

  bool togglePanel(std::string_view name);
  bool panelVisible(std::string_view name) const;

  void recordFrame(double deltaSeconds, std::string_view sceneName);
  void recordInputState(
    float moveX,
    float moveY,
    float lookX,
    float lookY,
    std::string_view lastUiAction,
    bool inputDebugEnabled);
  void recordRuntimeState(const ToolingRuntimeStateSnapshot& state);
  void appendLogLine(std::string_view line);

  std::vector<ToolPanelSnapshot> snapshotPanels() const;
  std::string panelRegistrySummary() const;
  std::string overlaySummary() const;
  std::string recentLogSummary(std::size_t maxLines = 6) const;

private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace shader_forge::runtime
