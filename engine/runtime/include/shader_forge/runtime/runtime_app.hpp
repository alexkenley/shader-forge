#pragma once

#include <filesystem>
#include <string>

namespace shader_forge::runtime {

struct RuntimeConfig {
  std::string title = "Shader Forge Runtime";
  std::string scene = "sandbox";
  std::filesystem::path inputRoot = "input";
  std::filesystem::path contentRoot = "content";
  std::filesystem::path audioRoot = "audio";
  std::filesystem::path dataFoundationPath = "data/foundation/engine-data-layout.toml";
  std::filesystem::path toolingLayoutPath = "tooling/layouts/default.tooling-layout.toml";
  std::filesystem::path toolingSessionLayoutPath = "tooling/layouts/runtime-session.tooling-layout.toml";
  int width = 1600;
  int height = 900;
  bool enableValidation = true;
};

class RuntimeApp {
public:
  int run(const RuntimeConfig& config);
};

}  // namespace shader_forge::runtime
