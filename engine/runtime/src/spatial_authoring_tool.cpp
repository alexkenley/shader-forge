#include "shader_forge/runtime/animation_system.hpp"

#include <filesystem>
#include <iomanip>
#include <iostream>
#include <sstream>
#include <string>
#include <string_view>

using shader_forge::runtime::AnimationConfig;
using shader_forge::runtime::AnimationSystem;

namespace {

std::string jsonString(std::string_view value) {
  std::ostringstream out;
  out << '"';
  for (const unsigned char character : value) {
    switch (character) {
      case '"': out << "\\\""; break;
      case '\\': out << "\\\\"; break;
      case '\b': out << "\\b"; break;
      case '\f': out << "\\f"; break;
      case '\n': out << "\\n"; break;
      case '\r': out << "\\r"; break;
      case '\t': out << "\\t"; break;
      default:
        if (character < 0x20) {
          out << "\\u00" << std::hex << std::setw(2) << std::setfill('0')
              << static_cast<int>(character) << std::dec;
        } else {
          out << static_cast<char>(character);
        }
    }
  }
  out << '"';
  return out.str();
}

int usageError(std::string_view message) {
  std::cerr << "shader_forge_spatial: " << message << '\n'
            << "usage: shader_forge_spatial validate --animation-root <path>\n";
  return 2;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 4 || std::string_view(argv[1]) != "validate"
      || std::string_view(argv[2]) != "--animation-root" || std::string_view(argv[3]).empty()) {
    return usageError("expected validate --animation-root <path>");
  }

  const std::filesystem::path requestedRoot = argv[3];
  std::error_code pathError;
  const std::filesystem::path absoluteRoot = std::filesystem::absolute(requestedRoot, pathError);
  if (pathError) {
    std::cerr << "shader_forge_spatial: cannot resolve animation root "
              << jsonString(requestedRoot.generic_string()) << ": " << pathError.message() << '\n';
    return 1;
  }
  const std::filesystem::path normalizedRoot = std::filesystem::weakly_canonical(absoluteRoot, pathError);
  if (pathError) {
    std::cerr << "shader_forge_spatial: cannot normalize animation root "
              << jsonString(absoluteRoot.generic_string()) << ": " << pathError.message() << '\n';
    return 1;
  }

  AnimationSystem animation;
  std::string error;
  if (!animation.loadFromDisk(AnimationConfig{normalizedRoot}, &error)) {
    std::cerr << "shader_forge_spatial: validation failed for "
              << jsonString(normalizedRoot.generic_string()) << ": " << error << '\n';
    return 1;
  }

  const auto skeletons = animation.snapshotSkeletons();
  const auto profiles = animation.snapshotAttachmentProfiles();

  std::ostringstream out;
  out << "{\"schema\":\"shader_forge.spatial_validation\",\"schemaVersion\":1"
      << ",\"animationRoot\":" << jsonString(normalizedRoot.generic_string())
      << ",\"counts\":{\"skeletons\":" << animation.skeletonCount()
      << ",\"clips\":" << animation.clipCount()
      << ",\"graphs\":" << animation.graphCount()
      << ",\"attachmentProfiles\":" << animation.attachmentProfileCount() << '}';

  out << ",\"skeletons\":[";
  for (std::size_t index = 0; index < skeletons.size(); ++index) {
    const auto& skeleton = skeletons[index];
    if (index != 0) out << ',';
    out << "{\"id\":" << jsonString(skeleton.id)
        << ",\"schemaVersion\":" << skeleton.schemaVersion
        << ",\"boneCount\":" << skeleton.boneCount
        << ",\"socketCount\":" << skeleton.sockets.size() << '}';
  }
  out << ']';

  out << ",\"attachmentProfiles\":[";
  for (std::size_t index = 0; index < profiles.size(); ++index) {
    const auto& profile = profiles[index];
    std::size_t sampleCount = 0;
    for (const auto& envelope : profile.motionEnvelopes) {
      sampleCount += envelope.normalizedTimes.size();
    }
    if (index != 0) out << ',';
    out << "{\"id\":" << jsonString(profile.id)
        << ",\"schemaVersion\":" << profile.schemaVersion
        << ",\"skeleton\":" << jsonString(profile.skeletonId)
        << ",\"itemPrefab\":" << jsonString(profile.itemPrefab)
        << ",\"mode\":" << jsonString(profile.mode)
        << ",\"perspective\":" << jsonString(profile.perspective)
        << ",\"motionEnvelopePhaseCount\":" << profile.motionEnvelopes.size()
        << ",\"motionEnvelopeSampleCount\":" << sampleCount << '}';
  }
  out << "]}\n";

  std::cout << out.str();
  return 0;
}
