#pragma once

#include <filesystem>
#include <string>

namespace shader_forge::runtime {

struct RuntimeConfig {
  std::string title = "Shader Forge Runtime";
  std::string scene = "sandbox";
  std::filesystem::path inputRoot = "input";
  int width = 1600;
  int height = 900;
  bool enableValidation = true;
};

class RuntimeApp {
public:
  int run(const RuntimeConfig& config);
};

}  // namespace shader_forge::runtime
