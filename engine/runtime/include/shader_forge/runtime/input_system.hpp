#pragma once

#include <cstddef>
#include <filesystem>
#include <memory>
#include <string>
#include <string_view>
#include <vector>

#if defined(SHADER_FORGE_HAS_SDL3) && SHADER_FORGE_HAS_SDL3 && __has_include(<SDL3/SDL_events.h>)
#define SHADER_FORGE_INPUT_HAS_SDL3 1
#include <SDL3/SDL_events.h>
#else
#define SHADER_FORGE_INPUT_HAS_SDL3 0
#endif

namespace shader_forge::runtime {

enum class InputBindingSource {
  keyboard,
  mouseButton,
  mouseMotion,
  mouseWheel,
  gamepadButton,
  gamepadAxis,
};

enum class InputActionKind {
  button,
  axis,
};

struct InputConfig {
  std::filesystem::path rootPath = "input";
};

struct InputActionSnapshot {
  std::string name;
  InputActionKind kind = InputActionKind::button;
  float value = 0.0F;
  bool down = false;
  bool pressed = false;
  bool released = false;
};

class InputSystem {
public:
  InputSystem();
  ~InputSystem();

  InputSystem(InputSystem&&) noexcept;
  InputSystem& operator=(InputSystem&&) noexcept;

  InputSystem(const InputSystem&) = delete;
  InputSystem& operator=(const InputSystem&) = delete;

  bool loadFromDisk(const InputConfig& config, std::string* errorMessage = nullptr);
  void beginFrame();

  void applyButtonInput(InputBindingSource source, std::string_view code, bool pressed);
  void applyAxisInput(InputBindingSource source, std::string_view code, float value);

#if SHADER_FORGE_INPUT_HAS_SDL3
  void handleSdlEvent(const SDL_Event& event);
#endif

  bool setContextEnabled(std::string_view name, bool enabled);
  bool contextEnabled(std::string_view name) const;

  bool actionPressed(std::string_view name) const;
  bool actionReleased(std::string_view name) const;
  bool actionDown(std::string_view name) const;
  float actionValue(std::string_view name) const;

  std::size_t actionCount() const;
  std::size_t contextCount() const;
  std::vector<std::string> activeContexts() const;
  std::vector<InputActionSnapshot> snapshotActiveActions() const;
  std::string bindingSummary() const;

private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace shader_forge::runtime
