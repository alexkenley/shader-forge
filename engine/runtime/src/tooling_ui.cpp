#include "shader_forge/runtime/tooling_ui.hpp"

#include <algorithm>
#include <cctype>
#include <cmath>
#include <fstream>
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
    if (character == '_' || character == '-' || std::isspace(static_cast<unsigned char>(character)) != 0) {
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

bool parseIntValue(const std::string& rawValue, int* result) {
  try {
    *result = std::stoi(parseStringValue(rawValue));
    return true;
  } catch (...) {
    return false;
  }
}

const char* dockAreaName(ToolDockArea area) {
  switch (area) {
    case ToolDockArea::left:
      return "left";
    case ToolDockArea::right:
      return "right";
    case ToolDockArea::bottom:
      return "bottom";
    case ToolDockArea::center:
      return "center";
    case ToolDockArea::overlay:
      return "overlay";
    default:
      return "left";
  }
}

std::optional<ToolDockArea> parseDockArea(const std::string& rawValue) {
  const std::string normalized = normalizeToken(parseStringValue(rawValue));
  if (normalized == "left") {
    return ToolDockArea::left;
  }
  if (normalized == "right") {
    return ToolDockArea::right;
  }
  if (normalized == "bottom") {
    return ToolDockArea::bottom;
  }
  if (normalized == "center") {
    return ToolDockArea::center;
  }
  if (normalized == "overlay") {
    return ToolDockArea::overlay;
  }
  return std::nullopt;
}

std::string formatFloat(double value, int precision = 2) {
  std::ostringstream stream;
  stream.setf(std::ios::fixed);
  stream.precision(precision);
  stream << value;
  return stream.str();
}

}  // namespace

struct ToolingUiSystem::Impl {
  struct PanelEntry {
    std::string name;
    std::string title;
    std::string contextKey;
    ToolDockArea dockArea = ToolDockArea::left;
    bool visible = false;
    int order = 0;
  };

  ToolingUiConfig config;
  std::vector<PanelEntry> panels;
  std::unordered_map<std::string, std::size_t> panelIndices;
  std::vector<std::string> recentLogs;
  std::string layoutName = "default";
  std::string sceneName = "sandbox";
  std::string lastUiAction;
  ToolingRuntimeStateSnapshot runtimeState;
  bool overlayVisible = true;
  bool inputDebugEnabled = false;
  double frameTimeMs = 0.0;
  double framesPerSecond = 0.0;
  std::size_t frameIndex = 0;
  float moveX = 0.0F;
  float moveY = 0.0F;
  float lookX = 0.0F;
  float lookY = 0.0F;

  void registerDefaultPanels() {
    if (!panels.empty()) {
      return;
    }

    panels.push_back(PanelEntry{
      "runtime_stats",
      "Runtime Stats",
      "tool.runtime_stats",
      ToolDockArea::left,
      true,
      0,
    });
    panels.push_back(PanelEntry{
      "input_debug",
      "Input Debug",
      "tool.input_debug",
      ToolDockArea::right,
      false,
      1,
    });
    panels.push_back(PanelEntry{
      "log_view",
      "Log View",
      "tool.log_view",
      ToolDockArea::bottom,
      true,
      2,
    });
    panels.push_back(PanelEntry{
      "debug_state",
      "Debug State",
      "tool.debug_state",
      ToolDockArea::right,
      true,
      3,
    });

    rebuildIndices();
  }

  void rebuildIndices() {
    panelIndices.clear();
    for (std::size_t index = 0; index < panels.size(); index += 1) {
      panelIndices[panels[index].name] = index;
    }
  }

  bool load(const ToolingUiConfig& nextConfig, std::string* errorMessage) {
    registerDefaultPanels();
    config = nextConfig;

    std::ifstream stream(config.layoutPath);
    if (!stream.is_open()) {
      if (errorMessage) {
        *errorMessage = "Could not open tooling layout file at " + config.layoutPath.string();
      }
      return false;
    }

    PanelEntry pending;
    bool inTool = false;
    std::string line;
    std::size_t lineNumber = 0;

    const auto finalizeTool = [&]() -> bool {
      if (!inTool) {
        return true;
      }

      pending.name = normalizeToken(pending.name);
      if (pending.name.empty()) {
        if (errorMessage) {
          *errorMessage = "Tool layout entry is missing a name in " + config.layoutPath.string();
        }
        return false;
      }

      const auto panelIt = panelIndices.find(pending.name);
      if (panelIt == panelIndices.end()) {
        if (errorMessage) {
          *errorMessage = "Tool layout references unknown panel '" + pending.name + "' in " + config.layoutPath.string();
        }
        return false;
      }

      PanelEntry& panel = panels[panelIt->second];
      if (!pending.title.empty()) {
        panel.title = pending.title;
      }
      panel.contextKey = pending.contextKey.empty() ? panel.contextKey : pending.contextKey;
      panel.dockArea = pending.dockArea;
      panel.visible = pending.visible;
      panel.order = pending.order;

      pending = PanelEntry{};
      inTool = false;
      return true;
    };

    while (std::getline(stream, line)) {
      lineNumber += 1;
      const std::string cleaned = stripComment(line);
      if (cleaned.empty()) {
        continue;
      }

      if (cleaned == "[[tool]]") {
        if (!finalizeTool()) {
          return false;
        }
        inTool = true;
        continue;
      }

      std::string key;
      std::string value;
      if (!parseKeyValue(cleaned, &key, &value)) {
        if (errorMessage) {
          *errorMessage = "Invalid tooling layout line " + std::to_string(lineNumber) + " in " + config.layoutPath.string();
        }
        return false;
      }

      if (!inTool) {
        if (key == "layout_name") {
          layoutName = parseStringValue(value);
          continue;
        }
        if (key == "overlay_visible") {
          if (!parseBoolValue(value, &overlayVisible) && errorMessage) {
            *errorMessage = "Invalid overlay_visible flag in " + config.layoutPath.string();
            return false;
          }
          continue;
        }
        continue;
      }

      if (key == "name") {
        pending.name = parseStringValue(value);
        continue;
      }
      if (key == "title") {
        pending.title = parseStringValue(value);
        continue;
      }
      if (key == "context") {
        pending.contextKey = normalizeToken(parseStringValue(value));
        continue;
      }
      if (key == "dock") {
        const auto parsedDock = parseDockArea(value);
        if (!parsedDock.has_value()) {
          if (errorMessage) {
            *errorMessage = "Invalid tool dock value in " + config.layoutPath.string();
          }
          return false;
        }
        pending.dockArea = *parsedDock;
        continue;
      }
      if (key == "visible") {
        if (!parseBoolValue(value, &pending.visible)) {
          if (errorMessage) {
            *errorMessage = "Invalid tool visibility value in " + config.layoutPath.string();
          }
          return false;
        }
        continue;
      }
      if (key == "order") {
        if (!parseIntValue(value, &pending.order)) {
          if (errorMessage) {
            *errorMessage = "Invalid tool order in " + config.layoutPath.string();
          }
          return false;
        }
        continue;
      }
    }

    if (!finalizeTool()) {
      return false;
    }

    std::sort(
      panels.begin(),
      panels.end(),
      [](const PanelEntry& left, const PanelEntry& right) {
        if (left.order != right.order) {
          return left.order < right.order;
        }
        return left.name < right.name;
      });
    rebuildIndices();
    return true;
  }

  bool save(std::string* errorMessage) const {
    if (config.sessionLayoutPath.empty()) {
      return true;
    }

    std::filesystem::create_directories(config.sessionLayoutPath.parent_path());
    std::ofstream output(config.sessionLayoutPath, std::ios::trunc);
    if (!output.is_open()) {
      if (errorMessage) {
        *errorMessage = "Could not write tooling session layout to " + config.sessionLayoutPath.string();
      }
      return false;
    }

    output << "layout_name = \"" << layoutName << "\"\n";
    output << "overlay_visible = " << (overlayVisible ? "true" : "false") << "\n\n";

    for (const auto& panel : panels) {
      output << "[[tool]]\n";
      output << "name = \"" << panel.name << "\"\n";
      output << "title = \"" << panel.title << "\"\n";
      output << "context = \"" << panel.contextKey << "\"\n";
      output << "dock = \"" << dockAreaName(panel.dockArea) << "\"\n";
      output << "visible = " << (panel.visible ? "true" : "false") << "\n";
      output << "order = " << panel.order << "\n\n";
    }

    return true;
  }

  bool togglePanelByName(std::string_view name) {
    const auto panelIt = panelIndices.find(normalizeToken(std::string(name)));
    if (panelIt == panelIndices.end()) {
      return false;
    }

    panels[panelIt->second].visible = !panels[panelIt->second].visible;
    return true;
  }

  bool panelVisibleByName(std::string_view name) const {
    const auto panelIt = panelIndices.find(normalizeToken(std::string(name)));
    if (panelIt == panelIndices.end()) {
      return false;
    }
    return panels[panelIt->second].visible;
  }
};

ToolingUiSystem::ToolingUiSystem()
    : impl_(std::make_unique<Impl>()) {}

ToolingUiSystem::~ToolingUiSystem() = default;

ToolingUiSystem::ToolingUiSystem(ToolingUiSystem&&) noexcept = default;

ToolingUiSystem& ToolingUiSystem::operator=(ToolingUiSystem&&) noexcept = default;

bool ToolingUiSystem::loadLayout(const ToolingUiConfig& config, std::string* errorMessage) {
  return impl_->load(config, errorMessage);
}

bool ToolingUiSystem::saveSessionLayout(std::string* errorMessage) const {
  return impl_->save(errorMessage);
}

void ToolingUiSystem::toggleOverlay() {
  impl_->overlayVisible = !impl_->overlayVisible;
}

bool ToolingUiSystem::overlayVisible() const {
  return impl_->overlayVisible;
}

bool ToolingUiSystem::togglePanel(std::string_view name) {
  return impl_->togglePanelByName(name);
}

bool ToolingUiSystem::panelVisible(std::string_view name) const {
  return impl_->panelVisibleByName(name);
}

void ToolingUiSystem::recordFrame(double deltaSeconds, std::string_view sceneName) {
  impl_->frameIndex += 1;
  impl_->sceneName = std::string(sceneName);
  impl_->frameTimeMs = deltaSeconds * 1000.0;
  if (deltaSeconds > 0.0) {
    impl_->framesPerSecond = 1.0 / deltaSeconds;
  }
}

void ToolingUiSystem::recordInputState(
  float moveX,
  float moveY,
  float lookX,
  float lookY,
  std::string_view lastUiAction,
  bool inputDebugEnabled) {
  impl_->moveX = moveX;
  impl_->moveY = moveY;
  impl_->lookX = lookX;
  impl_->lookY = lookY;
  impl_->lastUiAction = std::string(lastUiAction);
  impl_->inputDebugEnabled = inputDebugEnabled;
}

void ToolingUiSystem::recordRuntimeState(const ToolingRuntimeStateSnapshot& state) {
  impl_->runtimeState = state;
}

void ToolingUiSystem::appendLogLine(std::string_view line) {
  const std::string cleaned = trim(line);
  if (cleaned.empty()) {
    return;
  }

  impl_->recentLogs.push_back(cleaned);
  if (impl_->recentLogs.size() > 24) {
    impl_->recentLogs.erase(impl_->recentLogs.begin(), impl_->recentLogs.begin() + static_cast<std::ptrdiff_t>(impl_->recentLogs.size() - 24));
  }
}

std::vector<ToolPanelSnapshot> ToolingUiSystem::snapshotPanels() const {
  std::vector<ToolPanelSnapshot> snapshots;
  snapshots.reserve(impl_->panels.size());
  for (const auto& panel : impl_->panels) {
    snapshots.push_back(ToolPanelSnapshot{
      panel.name,
      panel.title,
      panel.contextKey,
      panel.dockArea,
      panel.visible,
      panel.order,
    });
  }
  return snapshots;
}

std::string ToolingUiSystem::panelRegistrySummary() const {
  std::ostringstream summary;
  summary << "tooling-layout=" << impl_->config.layoutPath.string()
          << ", session-layout=" << impl_->config.sessionLayoutPath.string()
          << ", layout-name=" << impl_->layoutName
          << ", overlay=" << (impl_->overlayVisible ? "visible" : "hidden");

  for (const auto& panel : impl_->panels) {
    summary << "\n- panel " << panel.name
            << " (" << panel.title << ")"
            << " dock=" << dockAreaName(panel.dockArea)
            << " visible=" << (panel.visible ? "true" : "false")
            << " order=" << panel.order
            << " context=" << panel.contextKey;
  }

  return summary.str();
}

std::string ToolingUiSystem::overlaySummary() const {
  std::ostringstream summary;
  summary << "overlay=" << (impl_->overlayVisible ? "on" : "off")
          << " panels=";

  bool anyVisible = false;
  for (const auto& panel : impl_->panels) {
    if (!panel.visible) {
      continue;
    }
    if (anyVisible) {
      summary << '+';
    }
    summary << panel.name;
    anyVisible = true;
  }
  if (!anyVisible) {
    summary << "none";
  }

  summary << " fps=" << formatFloat(impl_->framesPerSecond, 1)
          << " frame-ms=" << formatFloat(impl_->frameTimeMs, 2)
          << " scene=" << impl_->sceneName;

  if (impl_->inputDebugEnabled || panelVisible("input_debug")) {
    summary << " move=(" << formatFloat(impl_->moveX, 2) << ',' << formatFloat(impl_->moveY, 2) << ')'
            << " look=(" << formatFloat(impl_->lookX, 2) << ',' << formatFloat(impl_->lookY, 2) << ')';
  }

  if (impl_->runtimeState.controlledEntityValid) {
    summary << " player=" << impl_->runtimeState.controlledEntityId;
    if (!impl_->runtimeState.controlledEntityPosition.empty()) {
      summary << " pos=(" << impl_->runtimeState.controlledEntityPosition << ')';
    }
    if (impl_->runtimeState.moveSpeed > 0.0F) {
      summary << " move-speed=" << formatFloat(impl_->runtimeState.moveSpeed, 2);
    }
  }

  if (!impl_->runtimeState.animationGraphName.empty()) {
    summary << " anim=" << impl_->runtimeState.animationGraphName;
    if (!impl_->runtimeState.animationStateName.empty()) {
      summary << ':' << impl_->runtimeState.animationStateName;
    }
    if (!impl_->runtimeState.animationClipName.empty()) {
      summary << " clip=" << impl_->runtimeState.animationClipName;
    }
  }

  if (!impl_->runtimeState.activeSaveSlotName.empty()) {
    summary << " save-slot=" << impl_->runtimeState.activeSaveSlotName;
  }
  if (impl_->runtimeState.saveSlotCount > 0) {
    summary << " save-slots=" << impl_->runtimeState.saveSlotCount;
  }

  if (!impl_->runtimeState.blockedBodyName.empty()) {
    summary << " blocked=" << impl_->runtimeState.blockedBodyName;
  }

  summary << " physics-debug=" << (impl_->runtimeState.physicsDebugEnabled ? "on" : "off");
  if (impl_->runtimeState.physicsBodyCount > 0) {
    summary << " physics-bodies=" << impl_->runtimeState.physicsBodyCount;
  }
  if (impl_->runtimeState.queryBodyCount > 0) {
    summary << " query-bodies=" << impl_->runtimeState.queryBodyCount;
  }
  if (impl_->runtimeState.activeOverlapBodyCount > 0) {
    summary << " overlap-bodies=" << impl_->runtimeState.activeOverlapBodyCount;
  }
  if (!impl_->runtimeState.physicsFocusBodyName.empty()) {
    summary << " physics-focus=" << impl_->runtimeState.physicsFocusBodyName;
  }

  if (impl_->runtimeState.interactionTargetValid) {
    summary << " target=" << impl_->runtimeState.interactionTargetId;
    if (!impl_->runtimeState.interactionEffectName.empty()) {
      summary << " target-fx=" << impl_->runtimeState.interactionEffectName;
    }
  }

  if (!impl_->runtimeState.activeTriggeredEffectName.empty()) {
    summary << " fx=" << impl_->runtimeState.activeTriggeredEffectName;
  }

  if (!impl_->lastUiAction.empty()) {
    summary << " ui=" << impl_->lastUiAction;
  }

  return summary.str();
}

std::string ToolingUiSystem::recentLogSummary(std::size_t maxLines) const {
  if (impl_->recentLogs.empty()) {
    return "[no runtime log lines]";
  }

  const std::size_t startIndex = impl_->recentLogs.size() > maxLines ? impl_->recentLogs.size() - maxLines : 0;
  std::ostringstream summary;
  for (std::size_t index = startIndex; index < impl_->recentLogs.size(); index += 1) {
    if (index > startIndex) {
      summary << '\n';
    }
    summary << impl_->recentLogs[index];
  }
  return summary.str();
}

}  // namespace shader_forge::runtime
