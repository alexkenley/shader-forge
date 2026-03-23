#include "shader_forge/runtime/input_system.hpp"

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <cstddef>
#include <filesystem>
#include <fstream>
#include <limits>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <unordered_map>
#include <utility>
#include <vector>

#if SHADER_FORGE_INPUT_HAS_SDL3 && __has_include(<SDL3/SDL.h>)
#include <SDL3/SDL.h>
#endif

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

std::string toLower(std::string value) {
  std::transform(
    value.begin(),
    value.end(),
    value.begin(),
    [](unsigned char character) {
      return static_cast<char>(std::tolower(character));
    });
  return value;
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

bool parseFloatValue(const std::string& rawValue, float* result) {
  try {
    *result = std::stof(parseStringValue(rawValue));
    return true;
  } catch (...) {
    return false;
  }
}

const char* actionKindName(InputActionKind kind) {
  switch (kind) {
    case InputActionKind::button:
      return "button";
    case InputActionKind::axis:
      return "axis";
    default:
      return "unknown";
  }
}

const char* bindingSourceName(InputBindingSource source) {
  switch (source) {
    case InputBindingSource::keyboard:
      return "keyboard";
    case InputBindingSource::mouseButton:
      return "mouse_button";
    case InputBindingSource::mouseMotion:
      return "mouse_motion";
    case InputBindingSource::mouseWheel:
      return "mouse_wheel";
    case InputBindingSource::gamepadButton:
      return "gamepad_button";
    case InputBindingSource::gamepadAxis:
      return "gamepad_axis";
    default:
      return "unknown";
  }
}

std::optional<InputActionKind> parseActionKind(const std::string& rawValue) {
  const std::string normalized = normalizeToken(parseStringValue(rawValue));
  if (normalized == "button") {
    return InputActionKind::button;
  }
  if (normalized == "axis") {
    return InputActionKind::axis;
  }
  return std::nullopt;
}

std::optional<InputBindingSource> parseBindingSource(const std::string& rawValue) {
  const std::string normalized = normalizeToken(parseStringValue(rawValue));
  if (normalized == "keyboard") {
    return InputBindingSource::keyboard;
  }
  if (normalized == "mouse_button") {
    return InputBindingSource::mouseButton;
  }
  if (normalized == "mouse_motion") {
    return InputBindingSource::mouseMotion;
  }
  if (normalized == "mouse_wheel") {
    return InputBindingSource::mouseWheel;
  }
  if (normalized == "gamepad_button") {
    return InputBindingSource::gamepadButton;
  }
  if (normalized == "gamepad_axis") {
    return InputBindingSource::gamepadAxis;
  }
  return std::nullopt;
}

float clampAxisValue(float value) {
  return std::clamp(value, -1.0F, 1.0F);
}

std::string makeRawInputKey(InputBindingSource source, std::string_view code) {
  return std::string(bindingSourceName(source)) + ":" + normalizeToken(std::string(code));
}

#if SHADER_FORGE_INPUT_HAS_SDL3
std::string keyboardCodeFromScancode(SDL_Scancode scancode) {
  switch (scancode) {
    case SDL_SCANCODE_A:
      return "a";
    case SDL_SCANCODE_D:
      return "d";
    case SDL_SCANCODE_S:
      return "s";
    case SDL_SCANCODE_W:
      return "w";
    case SDL_SCANCODE_UP:
      return "up";
    case SDL_SCANCODE_DOWN:
      return "down";
    case SDL_SCANCODE_LEFT:
      return "left";
    case SDL_SCANCODE_RIGHT:
      return "right";
    case SDL_SCANCODE_ESCAPE:
      return "escape";
    case SDL_SCANCODE_RETURN:
      return "enter";
    case SDL_SCANCODE_BACKSPACE:
      return "backspace";
    case SDL_SCANCODE_SPACE:
      return "space";
    case SDL_SCANCODE_TAB:
      return "tab";
    case SDL_SCANCODE_F1:
      return "f1";
    default:
      return {};
  }
}

std::string mouseButtonCode(Uint8 button) {
  switch (button) {
    case SDL_BUTTON_LEFT:
      return "left";
    case SDL_BUTTON_RIGHT:
      return "right";
    case SDL_BUTTON_MIDDLE:
      return "middle";
    case SDL_BUTTON_X1:
      return "x1";
    case SDL_BUTTON_X2:
      return "x2";
    default:
      return {};
  }
}

std::string gamepadButtonCode(SDL_GamepadButton button) {
  switch (button) {
    case SDL_GAMEPAD_BUTTON_SOUTH:
      return "south";
    case SDL_GAMEPAD_BUTTON_EAST:
      return "east";
    case SDL_GAMEPAD_BUTTON_WEST:
      return "west";
    case SDL_GAMEPAD_BUTTON_NORTH:
      return "north";
    case SDL_GAMEPAD_BUTTON_BACK:
      return "back";
    case SDL_GAMEPAD_BUTTON_START:
      return "start";
    case SDL_GAMEPAD_BUTTON_GUIDE:
      return "guide";
    case SDL_GAMEPAD_BUTTON_LEFT_STICK:
      return "left_stick";
    case SDL_GAMEPAD_BUTTON_RIGHT_STICK:
      return "right_stick";
    case SDL_GAMEPAD_BUTTON_LEFT_SHOULDER:
      return "left_shoulder";
    case SDL_GAMEPAD_BUTTON_RIGHT_SHOULDER:
      return "right_shoulder";
    case SDL_GAMEPAD_BUTTON_DPAD_UP:
      return "dpad_up";
    case SDL_GAMEPAD_BUTTON_DPAD_DOWN:
      return "dpad_down";
    case SDL_GAMEPAD_BUTTON_DPAD_LEFT:
      return "dpad_left";
    case SDL_GAMEPAD_BUTTON_DPAD_RIGHT:
      return "dpad_right";
    default:
      return {};
  }
}

std::string gamepadAxisCode(SDL_GamepadAxis axis) {
  switch (axis) {
    case SDL_GAMEPAD_AXIS_LEFTX:
      return "left_x";
    case SDL_GAMEPAD_AXIS_LEFTY:
      return "left_y";
    case SDL_GAMEPAD_AXIS_RIGHTX:
      return "right_x";
    case SDL_GAMEPAD_AXIS_RIGHTY:
      return "right_y";
    case SDL_GAMEPAD_AXIS_LEFT_TRIGGER:
      return "left_trigger";
    case SDL_GAMEPAD_AXIS_RIGHT_TRIGGER:
      return "right_trigger";
    default:
      return {};
  }
}

float normalizeGamepadAxisValue(Sint16 value) {
  constexpr float minValue = -32768.0F;
  constexpr float maxValue = 32767.0F;
  if (value >= 0) {
    return static_cast<float>(value) / maxValue;
  }
  return static_cast<float>(value) / -minValue;
}
#endif

}  // namespace

struct InputSystem::Impl {
  struct ActionEntry {
    std::string name;
    InputActionKind kind = InputActionKind::button;
    float deadzone = 0.0F;
    float value = 0.0F;
    bool down = false;
    bool pressed = false;
    bool released = false;
  };

  struct BindingEntry {
    std::size_t actionIndex = 0;
    InputBindingSource source = InputBindingSource::keyboard;
    std::string code;
    float scale = 1.0F;
  };

  struct ContextEntry {
    std::string name;
    bool activeByDefault = false;
    bool enabled = false;
    std::vector<BindingEntry> bindings;
  };

  std::filesystem::path rootPath;
  std::vector<ActionEntry> actions;
  std::vector<ContextEntry> contexts;
  std::unordered_map<std::string, std::size_t> actionIndices;
  std::unordered_map<std::string, std::size_t> contextIndices;
  std::unordered_map<std::string, float> rawInputs;

  bool load(const InputConfig& config, std::string* errorMessage) {
    std::vector<ActionEntry> nextActions;
    std::unordered_map<std::string, std::size_t> nextActionIndices;
    std::vector<ContextEntry> nextContexts;
    std::unordered_map<std::string, std::size_t> nextContextIndices;

    const std::filesystem::path actionsPath = config.rootPath / "actions.toml";
    if (!loadActions(actionsPath, &nextActions, &nextActionIndices, errorMessage)) {
      return false;
    }

    const std::filesystem::path contextsPath = config.rootPath / "contexts";
    if (!loadContexts(contextsPath, nextActionIndices, &nextContexts, &nextContextIndices, errorMessage)) {
      return false;
    }

    rootPath = config.rootPath;
    actions = std::move(nextActions);
    contexts = std::move(nextContexts);
    actionIndices = std::move(nextActionIndices);
    contextIndices = std::move(nextContextIndices);
    rawInputs.clear();
    beginFrame();
    return true;
  }

  void beginFrame() {
    for (auto& action : actions) {
      action.pressed = false;
      action.released = false;
    }

    rawInputs.erase(makeRawInputKey(InputBindingSource::mouseMotion, "x"));
    rawInputs.erase(makeRawInputKey(InputBindingSource::mouseMotion, "y"));
    rawInputs.erase(makeRawInputKey(InputBindingSource::mouseWheel, "x"));
    rawInputs.erase(makeRawInputKey(InputBindingSource::mouseWheel, "y"));

    rebuildActionStates(false);
  }

  void setRawValue(InputBindingSource source, std::string_view code, float value, bool trackTransitions) {
    const std::string key = makeRawInputKey(source, code);
    if (std::fabs(value) <= std::numeric_limits<float>::epsilon()) {
      rawInputs.erase(key);
    } else {
      rawInputs[key] = value;
    }
    rebuildActionStates(trackTransitions);
  }

  bool loadActions(
    const std::filesystem::path& path,
    std::vector<ActionEntry>* outActions,
    std::unordered_map<std::string, std::size_t>* outIndices,
    std::string* errorMessage) {
    std::ifstream stream(path);
    if (!stream.is_open()) {
      if (errorMessage) {
        *errorMessage = "Could not open input actions file at " + path.string();
      }
      return false;
    }

    ActionEntry pending;
    bool pendingStarted = false;
    std::string line;
    std::size_t lineNumber = 0;

    const auto finalizePending = [&]() -> bool {
      if (!pendingStarted) {
        return true;
      }
      pending.name = normalizeToken(pending.name);
      if (pending.name.empty()) {
        if (errorMessage) {
          *errorMessage = "Input action is missing a name in " + path.string();
        }
        return false;
      }
      if (outIndices->contains(pending.name)) {
        if (errorMessage) {
          *errorMessage = "Duplicate input action '" + pending.name + "' in " + path.string();
        }
        return false;
      }
      if (pending.kind == InputActionKind::axis && pending.deadzone < 0.0F) {
        pending.deadzone = 0.0F;
      }
      (*outIndices)[pending.name] = outActions->size();
      outActions->push_back(pending);
      pending = ActionEntry{};
      pendingStarted = false;
      return true;
    };

    while (std::getline(stream, line)) {
      lineNumber += 1;
      const std::string cleaned = stripComment(line);
      if (cleaned.empty()) {
        continue;
      }

      if (cleaned == "[[action]]") {
        if (!finalizePending()) {
          return false;
        }
        pendingStarted = true;
        continue;
      }

      std::string key;
      std::string value;
      if (!parseKeyValue(cleaned, &key, &value)) {
        if (errorMessage) {
          *errorMessage = "Invalid action line " + std::to_string(lineNumber) + " in " + path.string();
        }
        return false;
      }

      if (!pendingStarted) {
        if (errorMessage) {
          *errorMessage = "Input actions must be declared inside [[action]] tables in " + path.string();
        }
        return false;
      }

      if (key == "name") {
        pending.name = parseStringValue(value);
        continue;
      }
      if (key == "kind") {
        const auto parsedKind = parseActionKind(value);
        if (!parsedKind.has_value()) {
          if (errorMessage) {
            *errorMessage = "Unknown action kind on line " + std::to_string(lineNumber) + " in " + path.string();
          }
          return false;
        }
        pending.kind = *parsedKind;
        continue;
      }
      if (key == "deadzone") {
        if (!parseFloatValue(value, &pending.deadzone)) {
          if (errorMessage) {
            *errorMessage = "Invalid deadzone on line " + std::to_string(lineNumber) + " in " + path.string();
          }
          return false;
        }
        continue;
      }
    }

    if (!finalizePending()) {
      return false;
    }

    if (outActions->empty()) {
      if (errorMessage) {
        *errorMessage = "No input actions were declared in " + path.string();
      }
      return false;
    }

    return true;
  }

  bool loadContexts(
    const std::filesystem::path& path,
    const std::unordered_map<std::string, std::size_t>& knownActions,
    std::vector<ContextEntry>* outContexts,
    std::unordered_map<std::string, std::size_t>* outIndices,
    std::string* errorMessage) {
    if (!std::filesystem::exists(path) || !std::filesystem::is_directory(path)) {
      if (errorMessage) {
        *errorMessage = "Input contexts directory is missing at " + path.string();
      }
      return false;
    }

    std::vector<std::filesystem::path> files;
    for (const auto& entry : std::filesystem::directory_iterator(path)) {
      if (!entry.is_regular_file()) {
        continue;
      }
      if (entry.path().extension() == ".toml" && entry.path().filename().string().find(".input.") != std::string::npos) {
        files.push_back(entry.path());
      }
    }
    std::sort(files.begin(), files.end());

    if (files.empty()) {
      if (errorMessage) {
        *errorMessage = "No input context files were found in " + path.string();
      }
      return false;
    }

    for (const auto& file : files) {
      ContextEntry context;
      if (!loadContextFile(file, knownActions, &context, errorMessage)) {
        return false;
      }
      context.name = normalizeToken(context.name);
      if (context.name.empty()) {
        context.name = normalizeToken(file.stem().stem().string());
      }
      if (outIndices->contains(context.name)) {
        if (errorMessage) {
          *errorMessage = "Duplicate input context '" + context.name + "' in " + file.string();
        }
        return false;
      }
      context.enabled = context.activeByDefault;
      (*outIndices)[context.name] = outContexts->size();
      outContexts->push_back(std::move(context));
    }

    return true;
  }

  bool loadContextFile(
    const std::filesystem::path& path,
    const std::unordered_map<std::string, std::size_t>& knownActions,
    ContextEntry* outContext,
    std::string* errorMessage) {
    std::ifstream stream(path);
    if (!stream.is_open()) {
      if (errorMessage) {
        *errorMessage = "Could not open input context file at " + path.string();
      }
      return false;
    }

    BindingEntry pendingBinding;
    bool insideBinding = false;
    std::string line;
    std::size_t lineNumber = 0;
    std::string pendingActionName;

    outContext->name = path.stem().stem().string();
    outContext->activeByDefault = false;
    outContext->bindings.clear();

    const auto finalizeBinding = [&]() -> bool {
      if (!insideBinding) {
        return true;
      }

      pendingBinding.code = normalizeToken(pendingBinding.code);
      pendingActionName = normalizeToken(pendingActionName);
      if (pendingActionName.empty() || pendingBinding.code.empty()) {
        if (errorMessage) {
          *errorMessage = "Input binding is missing an action or code in " + path.string();
        }
        return false;
      }

      const auto actionIt = knownActions.find(pendingActionName);
      if (actionIt == knownActions.end()) {
        if (errorMessage) {
          *errorMessage = "Binding references unknown action '" + pendingActionName + "' in " + path.string();
        }
        return false;
      }

      pendingBinding.actionIndex = actionIt->second;
      outContext->bindings.push_back(pendingBinding);
      pendingBinding = BindingEntry{};
      pendingActionName.clear();
      insideBinding = false;
      return true;
    };

    while (std::getline(stream, line)) {
      lineNumber += 1;
      const std::string cleaned = stripComment(line);
      if (cleaned.empty()) {
        continue;
      }

      if (cleaned == "[[binding]]") {
        if (!finalizeBinding()) {
          return false;
        }
        insideBinding = true;
        continue;
      }

      std::string key;
      std::string value;
      if (!parseKeyValue(cleaned, &key, &value)) {
        if (errorMessage) {
          *errorMessage = "Invalid context line " + std::to_string(lineNumber) + " in " + path.string();
        }
        return false;
      }

      if (insideBinding) {
        if (key == "action") {
          pendingActionName = parseStringValue(value);
          continue;
        }
        if (key == "source") {
          const auto source = parseBindingSource(value);
          if (!source.has_value()) {
            if (errorMessage) {
              *errorMessage = "Unknown binding source on line " + std::to_string(lineNumber) + " in " + path.string();
            }
            return false;
          }
          pendingBinding.source = *source;
          continue;
        }
        if (key == "code") {
          pendingBinding.code = parseStringValue(value);
          continue;
        }
        if (key == "scale") {
          if (!parseFloatValue(value, &pendingBinding.scale)) {
            if (errorMessage) {
              *errorMessage = "Invalid binding scale on line " + std::to_string(lineNumber) + " in " + path.string();
            }
            return false;
          }
          continue;
        }
        continue;
      }

      if (key == "name") {
        outContext->name = parseStringValue(value);
        continue;
      }
      if (key == "active") {
        if (!parseBoolValue(value, &outContext->activeByDefault)) {
          if (errorMessage) {
            *errorMessage = "Invalid active flag on line " + std::to_string(lineNumber) + " in " + path.string();
          }
          return false;
        }
      }
    }

    if (!finalizeBinding()) {
      return false;
    }

    return true;
  }

  void rebuildActionStates(bool trackTransitions) {
    std::vector<float> nextValues(actions.size(), 0.0F);

    for (const auto& context : contexts) {
      if (!context.enabled) {
        continue;
      }

      for (const auto& binding : context.bindings) {
        const auto inputIt = rawInputs.find(makeRawInputKey(binding.source, binding.code));
        if (inputIt == rawInputs.end()) {
          continue;
        }

        const float rawValue = inputIt->second;
        const float contribution = rawValue * binding.scale;
        ActionEntry& action = actions[binding.actionIndex];

        if (action.kind == InputActionKind::button) {
          nextValues[binding.actionIndex] = std::max(nextValues[binding.actionIndex], std::fabs(contribution));
        } else {
          nextValues[binding.actionIndex] += contribution;
        }
      }
    }

    for (std::size_t index = 0; index < actions.size(); index += 1) {
      ActionEntry& action = actions[index];
      float nextValue = nextValues[index];
      bool nextDown = false;

      if (action.kind == InputActionKind::button) {
        nextValue = nextValue >= 0.5F ? 1.0F : 0.0F;
        nextDown = nextValue >= 0.5F;
      } else {
        nextValue = clampAxisValue(nextValue);
        if (std::fabs(nextValue) < action.deadzone) {
          nextValue = 0.0F;
        }
      }

      if (trackTransitions && action.kind == InputActionKind::button) {
        if (!action.down && nextDown) {
          action.pressed = true;
        }
        if (action.down && !nextDown) {
          action.released = true;
        }
      }

      action.value = nextValue;
      action.down = nextDown;
    }
  }

  std::optional<std::size_t> findAction(std::string_view name) const {
    const auto it = actionIndices.find(normalizeToken(std::string(name)));
    if (it == actionIndices.end()) {
      return std::nullopt;
    }
    return it->second;
  }

  std::optional<std::size_t> findContext(std::string_view name) const {
    const auto it = contextIndices.find(normalizeToken(std::string(name)));
    if (it == contextIndices.end()) {
      return std::nullopt;
    }
    return it->second;
  }
};

InputSystem::InputSystem()
    : impl_(std::make_unique<Impl>()) {}

InputSystem::~InputSystem() = default;

InputSystem::InputSystem(InputSystem&&) noexcept = default;

InputSystem& InputSystem::operator=(InputSystem&&) noexcept = default;

bool InputSystem::loadFromDisk(const InputConfig& config, std::string* errorMessage) {
  return impl_->load(config, errorMessage);
}

void InputSystem::beginFrame() {
  impl_->beginFrame();
}

void InputSystem::applyButtonInput(InputBindingSource source, std::string_view code, bool pressed) {
  impl_->setRawValue(source, code, pressed ? 1.0F : 0.0F, true);
}

void InputSystem::applyAxisInput(InputBindingSource source, std::string_view code, float value) {
  impl_->setRawValue(source, code, clampAxisValue(value), true);
}

#if SHADER_FORGE_INPUT_HAS_SDL3
void InputSystem::handleSdlEvent(const SDL_Event& event) {
  switch (event.type) {
    case SDL_EVENT_KEY_DOWN:
    case SDL_EVENT_KEY_UP: {
      const std::string code = keyboardCodeFromScancode(event.key.scancode);
      if (!code.empty()) {
        applyButtonInput(InputBindingSource::keyboard, code, event.type == SDL_EVENT_KEY_DOWN);
      }
      break;
    }
    case SDL_EVENT_MOUSE_BUTTON_DOWN:
    case SDL_EVENT_MOUSE_BUTTON_UP: {
      const std::string code = mouseButtonCode(event.button.button);
      if (!code.empty()) {
        applyButtonInput(InputBindingSource::mouseButton, code, event.type == SDL_EVENT_MOUSE_BUTTON_DOWN);
      }
      break;
    }
    case SDL_EVENT_MOUSE_MOTION:
      applyAxisInput(InputBindingSource::mouseMotion, "x", static_cast<float>(event.motion.xrel));
      applyAxisInput(InputBindingSource::mouseMotion, "y", static_cast<float>(event.motion.yrel));
      break;
    case SDL_EVENT_MOUSE_WHEEL:
      applyAxisInput(InputBindingSource::mouseWheel, "x", static_cast<float>(event.wheel.x));
      applyAxisInput(InputBindingSource::mouseWheel, "y", static_cast<float>(event.wheel.y));
      break;
    case SDL_EVENT_GAMEPAD_BUTTON_DOWN:
    case SDL_EVENT_GAMEPAD_BUTTON_UP: {
      const std::string code = gamepadButtonCode(static_cast<SDL_GamepadButton>(event.gbutton.button));
      if (!code.empty()) {
        applyButtonInput(InputBindingSource::gamepadButton, code, event.type == SDL_EVENT_GAMEPAD_BUTTON_DOWN);
      }
      break;
    }
    case SDL_EVENT_GAMEPAD_AXIS_MOTION: {
      const std::string code = gamepadAxisCode(static_cast<SDL_GamepadAxis>(event.gaxis.axis));
      if (!code.empty()) {
        applyAxisInput(InputBindingSource::gamepadAxis, code, normalizeGamepadAxisValue(event.gaxis.value));
      }
      break;
    }
    default:
      break;
  }
}
#endif

bool InputSystem::setContextEnabled(std::string_view name, bool enabled) {
  const auto contextIndex = impl_->findContext(name);
  if (!contextIndex.has_value()) {
    return false;
  }

  impl_->contexts[*contextIndex].enabled = enabled;
  impl_->rebuildActionStates(false);
  return true;
}

bool InputSystem::contextEnabled(std::string_view name) const {
  const auto contextIndex = impl_->findContext(name);
  if (!contextIndex.has_value()) {
    return false;
  }
  return impl_->contexts[*contextIndex].enabled;
}

bool InputSystem::actionPressed(std::string_view name) const {
  const auto actionIndex = impl_->findAction(name);
  if (!actionIndex.has_value()) {
    return false;
  }
  return impl_->actions[*actionIndex].pressed;
}

bool InputSystem::actionReleased(std::string_view name) const {
  const auto actionIndex = impl_->findAction(name);
  if (!actionIndex.has_value()) {
    return false;
  }
  return impl_->actions[*actionIndex].released;
}

bool InputSystem::actionDown(std::string_view name) const {
  const auto actionIndex = impl_->findAction(name);
  if (!actionIndex.has_value()) {
    return false;
  }
  return impl_->actions[*actionIndex].down;
}

float InputSystem::actionValue(std::string_view name) const {
  const auto actionIndex = impl_->findAction(name);
  if (!actionIndex.has_value()) {
    return 0.0F;
  }
  return impl_->actions[*actionIndex].value;
}

std::size_t InputSystem::actionCount() const {
  return impl_->actions.size();
}

std::size_t InputSystem::contextCount() const {
  return impl_->contexts.size();
}

std::vector<std::string> InputSystem::activeContexts() const {
  std::vector<std::string> names;
  for (const auto& context : impl_->contexts) {
    if (context.enabled) {
      names.push_back(context.name);
    }
  }
  return names;
}

std::vector<InputActionSnapshot> InputSystem::snapshotActiveActions() const {
  std::vector<InputActionSnapshot> snapshots;
  for (const auto& action : impl_->actions) {
    if (!action.down && !action.pressed && !action.released && std::fabs(action.value) < 0.0001F) {
      continue;
    }

    snapshots.push_back(InputActionSnapshot{
      .name = action.name,
      .kind = action.kind,
      .value = action.value,
      .down = action.down,
      .pressed = action.pressed,
      .released = action.released,
    });
  }
  return snapshots;
}

std::string InputSystem::bindingSummary() const {
  std::ostringstream message;
  message << "input-root=" << impl_->rootPath.string()
          << ", actions=" << impl_->actions.size()
          << ", contexts=" << impl_->contexts.size();

  const auto active = activeContexts();
  message << ", active-contexts=";
  if (active.empty()) {
    message << "none";
  } else {
    for (std::size_t index = 0; index < active.size(); index += 1) {
      if (index > 0) {
        message << ',';
      }
      message << active[index];
    }
  }

  for (const auto& context : impl_->contexts) {
    message << "\n- context " << context.name
            << " (" << (context.enabled ? "enabled" : "disabled") << ")";
    for (const auto& binding : context.bindings) {
      const auto& action = impl_->actions[binding.actionIndex];
      message << "\n  * " << action.name
              << " <- " << bindingSourceName(binding.source)
              << ":" << binding.code
              << " x" << binding.scale
              << " [" << actionKindName(action.kind) << "]";
    }
  }
  return message.str();
}

}  // namespace shader_forge::runtime
