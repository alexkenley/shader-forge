#include "shader_forge/runtime/runtime_app.hpp"

#include <cstdlib>
#include <iostream>
#include <string>

namespace {

int parseIntOrDefault(const char* value, int fallback) {
  if (!value || !*value) {
    return fallback;
  }

  char* end = nullptr;
  const long parsed = std::strtol(value, &end, 10);
  if (!end || *end != '\0') {
    return fallback;
  }
  return static_cast<int>(parsed);
}

void printHelp() {
  std::cout << "Shader Forge Runtime\n\n"
            << "Usage:\n"
            << "  shader_forge_runtime [--scene <name>] [--title <name>] [--input-root <path>] [--content-root <path>] [--audio-root <path>] [--animation-root <path>] [--data-foundation <path>] [--tooling-layout <path>] [--tooling-layout-save <path>] [--width <px>] [--height <px>] [--no-validation]\n";
}

}  // namespace

int main(int argc, char** argv) {
  shader_forge::runtime::RuntimeConfig config;

  for (int index = 1; index < argc; ++index) {
    const std::string argument = argv[index];
    if (argument == "--scene" && index + 1 < argc) {
      config.scene = argv[++index];
      continue;
    }
    if (argument == "--title" && index + 1 < argc) {
      config.title = argv[++index];
      continue;
    }
    if (argument == "--input-root" && index + 1 < argc) {
      config.inputRoot = argv[++index];
      continue;
    }
    if (argument == "--content-root" && index + 1 < argc) {
      config.contentRoot = argv[++index];
      continue;
    }
    if (argument == "--audio-root" && index + 1 < argc) {
      config.audioRoot = argv[++index];
      continue;
    }
    if (argument == "--animation-root" && index + 1 < argc) {
      config.animationRoot = argv[++index];
      continue;
    }
    if (argument == "--data-foundation" && index + 1 < argc) {
      config.dataFoundationPath = argv[++index];
      continue;
    }
    if (argument == "--tooling-layout" && index + 1 < argc) {
      config.toolingLayoutPath = argv[++index];
      continue;
    }
    if (argument == "--tooling-layout-save" && index + 1 < argc) {
      config.toolingSessionLayoutPath = argv[++index];
      continue;
    }
    if (argument == "--width" && index + 1 < argc) {
      config.width = parseIntOrDefault(argv[++index], config.width);
      continue;
    }
    if (argument == "--height" && index + 1 < argc) {
      config.height = parseIntOrDefault(argv[++index], config.height);
      continue;
    }
    if (argument == "--no-validation") {
      config.enableValidation = false;
      continue;
    }
    if (argument == "--help" || argument == "-h") {
      printHelp();
      return 0;
    }

    std::cerr << "Unknown argument: " << argument << '\n';
    printHelp();
    return 1;
  }

  shader_forge::runtime::RuntimeApp app;
  return app.run(config);
}
