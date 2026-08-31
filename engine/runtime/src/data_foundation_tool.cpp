#include "shader_forge/runtime/data_foundation.hpp"

#include <filesystem>
#include <iostream>
#include <optional>
#include <sstream>
#include <string>
#include <string_view>
#include <utility>

using shader_forge::runtime::DataAssetKind;
using shader_forge::runtime::DataFoundation;
using shader_forge::runtime::DataFoundationConfig;

namespace {

std::string jsonString(std::string_view value) {
  std::ostringstream output;
  output << '"';
  for (const unsigned char character : value) {
    switch (character) {
      case '"': output << "\\\""; break;
      case '\\': output << "\\\\"; break;
      case '\b': output << "\\b"; break;
      case '\f': output << "\\f"; break;
      case '\n': output << "\\n"; break;
      case '\r': output << "\\r"; break;
      case '\t': output << "\\t"; break;
      default:
        if (character < 0x20U) {
          constexpr char hex[] = "0123456789abcdef";
          output << "\\u00" << hex[(character >> 4U) & 0x0FU] << hex[character & 0x0FU];
        } else {
          output << character;
        }
    }
  }
  output << '"';
  return output.str();
}

std::string boundedDiagnostic(std::string value) {
  constexpr std::size_t maxLength = 2000;
  if (value.size() > maxLength) {
    value.resize(maxLength);
  }
  return value;
}

void emitResult(
  bool valid,
  std::string_view assetKind,
  std::string_view assetId,
  std::string_view expectedPath,
  std::size_t assetCount,
  std::size_t invalidAssetCount,
  std::string diagnostic
) {
  std::cout << '{'
            << "\"schema\":\"shader_forge.data_foundation_validation\","
            << "\"schemaVersion\":1,"
            << "\"valid\":" << (valid ? "true" : "false") << ','
            << "\"assetKind\":" << jsonString(assetKind) << ','
            << "\"assetId\":" << jsonString(assetId) << ','
            << "\"expectedPath\":" << jsonString(expectedPath) << ','
            << "\"assetCount\":" << assetCount << ','
            << "\"invalidAssetCount\":" << invalidAssetCount << ','
            << "\"diagnostic\":" << jsonString(boundedDiagnostic(std::move(diagnostic)))
            << "}\n";
}

int usageError(std::string_view message) {
  std::cerr << "shader_forge_data: " << message << '\n';
  std::cerr << "usage: shader_forge_data validate-asset --content-root <path> "
               "--data-foundation <path> --kind <scene|prefab> --id <id> "
               "--expected-path <relative-path> [--expect-absent]\n";
  return 2;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 2 || std::string_view(argv[1]) != "validate-asset") {
    return usageError("expected validate-asset");
  }

  std::filesystem::path contentRoot;
  std::filesystem::path foundationPath;
  std::string assetKind;
  std::string assetId;
  std::filesystem::path expectedPath;
  bool expectAbsent = false;

  for (int index = 2; index < argc; ++index) {
    const std::string flag = argv[index];
    if (flag == "--expect-absent") {
      expectAbsent = true;
      continue;
    }
    if (index + 1 >= argc) return usageError("missing value for " + flag);
    const std::string value = argv[++index];
    if (flag == "--content-root") contentRoot = value;
    else if (flag == "--data-foundation") foundationPath = value;
    else if (flag == "--kind") assetKind = value;
    else if (flag == "--id") assetId = value;
    else if (flag == "--expected-path") expectedPath = value;
    else return usageError("unknown flag " + flag);
  }

  if (contentRoot.empty() || foundationPath.empty() || assetId.empty() || expectedPath.empty()) {
    return usageError("all validate-asset arguments are required");
  }
  if (assetKind != "scene" && assetKind != "prefab") {
    return usageError("kind must be scene or prefab");
  }
  if (expectedPath.is_absolute() || expectedPath.has_root_name()) {
    return usageError("expected-path must be relative");
  }
  for (const auto& component : expectedPath) {
    if (component == "." || component == "..") return usageError("expected-path is unsafe");
  }

  DataFoundation foundation;
  std::string error;
  if (!foundation.loadFromDisk(DataFoundationConfig{contentRoot, foundationPath}, &error)) {
    emitResult(false, assetKind, assetId, expectedPath.generic_string(), 0, 0, error);
    return 0;
  }

  const auto expectedAbsolute = std::filesystem::weakly_canonical(contentRoot / expectedPath);
  bool selectedPresent = false;
  bool selectedValid = false;
  bool selectedPathMatches = false;
  if (assetKind == "scene") {
    const auto selected = foundation.sceneSource(assetId);
    if (selected) {
      selectedPresent = true;
      selectedValid = selected->valid;
      selectedPathMatches = std::filesystem::weakly_canonical(selected->sourcePath) == expectedAbsolute;
    }
  } else {
    const auto selected = foundation.prefabSource(assetId);
    if (selected) {
      selectedPresent = true;
      selectedValid = selected->valid;
      selectedPathMatches = std::filesystem::weakly_canonical(selected->sourcePath) == expectedAbsolute;
    }
  }

  const std::size_t invalidCount = foundation.invalidAssetCount();
  bool valid = invalidCount == 0;
  std::string diagnostic;
  if (expectAbsent) {
    valid = valid && !selectedPresent;
    if (selectedPresent) diagnostic = "Expected asset to be absent after the candidate mutation.";
  } else {
    valid = valid && selectedPresent && selectedValid && selectedPathMatches;
    if (!selectedPresent) diagnostic = "Selected asset is missing from the native catalog.";
    else if (!selectedValid) diagnostic = "Selected asset is invalid in the native catalog.";
    else if (!selectedPathMatches) diagnostic = "Selected asset path does not match the expected canonical path.";
  }
  if (invalidCount != 0) {
    diagnostic = foundation.assetCatalogSummary();
  }
  if (valid) diagnostic = "Native DataFoundation validation passed.";

  emitResult(
    valid,
    assetKind,
    assetId,
    expectedPath.generic_string(),
    foundation.assetCount(),
    invalidCount,
    diagnostic
  );
  return 0;
}
