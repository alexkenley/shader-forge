#include "shader_forge/runtime/animation_system.hpp"

#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <locale>
#include <sstream>
#include <string>
#include <string_view>

#if defined(_WIN32)
#include <process.h>
#include <windows.h>
#else
#include <cstdio>
#include <unistd.h>
#endif

using shader_forge::runtime::AnimationConfig;
using shader_forge::runtime::AnimationSystem;
using shader_forge::runtime::AttachmentProfileSnapshot;
using shader_forge::runtime::SkeletonDefinitionSnapshot;
using shader_forge::runtime::SpatialQuaternionSnapshot;
using shader_forge::runtime::SpatialVector3Snapshot;

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

void appendVector(std::ostringstream& out, const SpatialVector3Snapshot& value) {
  out << '[' << value.x << ',' << value.y << ',' << value.z << ']';
}

void appendQuaternion(std::ostringstream& out, const SpatialQuaternionSnapshot& value) {
  out << '[' << value.x << ',' << value.y << ',' << value.z << ',' << value.w << ']';
}

void appendStringArray(std::ostringstream& out, const std::vector<std::string>& values) {
  out << '[';
  for (std::size_t index = 0; index < values.size(); ++index) {
    if (index != 0) out << ',';
    out << jsonString(values[index]);
  }
  out << ']';
}

std::string utf8Path(const std::filesystem::path& path) {
  const std::u8string value = path.generic_u8string();
  return std::string(reinterpret_cast<const char*>(value.data()), value.size());
}

std::string relativeSourcePath(
  const std::filesystem::path& sourcePath,
  const std::filesystem::path& animationRoot) {
  const std::filesystem::path relative = sourcePath.lexically_normal().lexically_relative(animationRoot);
  if (relative.empty() || relative.is_absolute()) return {};
  const auto first = relative.begin();
  if (first != relative.end() && *first == "..") return {};
  return utf8Path(relative);
}

bool appendSkeleton(
  std::ostringstream& out,
  const SkeletonDefinitionSnapshot& skeleton,
  const std::filesystem::path& animationRoot,
  std::string* errorMessage) {
  const std::string source = relativeSourcePath(skeleton.sourcePath, animationRoot);
  if (source.empty()) {
    if (errorMessage) *errorMessage = "Skeleton source is outside the animation root: " + skeleton.sourcePath.string();
    return false;
  }
  out << "{\"id\":" << jsonString(skeleton.id)
      << ",\"schemaVersion\":" << skeleton.schemaVersion
      << ",\"source\":" << jsonString(source)
      << ",\"name\":" << jsonString(skeleton.name)
      << ",\"rootBone\":" << jsonString(skeleton.rootBone)
      << ",\"boneCount\":" << skeleton.boneCount
      << ",\"boneIds\":";
  appendStringArray(out, skeleton.bones);
  out << ",\"bones\":[";
  for (std::size_t index = 0; index < skeleton.boneDefinitions.size(); ++index) {
    const auto& bone = skeleton.boneDefinitions[index];
    if (index != 0) out << ',';
    out << "{\"id\":" << jsonString(bone.id)
        << ",\"parent\":" << jsonString(bone.parent)
        << ",\"role\":" << jsonString(bone.role)
        << ",\"translation\":";
    appendVector(out, bone.translation);
    out << ",\"rotation\":";
    appendQuaternion(out, bone.rotation);
    out << '}';
  }
  out << "],\"sockets\":[";
  for (std::size_t index = 0; index < skeleton.sockets.size(); ++index) {
    const auto& socket = skeleton.sockets[index];
    if (index != 0) out << ',';
    out << "{\"id\":" << jsonString(socket.id)
        << ",\"bone\":" << jsonString(socket.bone)
        << ",\"role\":" << jsonString(socket.role)
        << ",\"translation\":";
    appendVector(out, socket.translation);
    out << ",\"rotation\":";
    appendQuaternion(out, socket.rotation);
    out << '}';
  }
  out << "]}";
  return true;
}

bool appendAttachmentProfile(
  std::ostringstream& out,
  const AttachmentProfileSnapshot& profile,
  const std::filesystem::path& animationRoot,
  std::string* errorMessage) {
  const std::string source = relativeSourcePath(profile.sourcePath, animationRoot);
  if (source.empty()) {
    if (errorMessage) *errorMessage = "Attachment profile source is outside the animation root: " + profile.sourcePath.string();
    return false;
  }
  out << "{\"id\":" << jsonString(profile.id)
      << ",\"schemaVersion\":" << profile.schemaVersion
      << ",\"source\":" << jsonString(source)
      << ",\"name\":" << jsonString(profile.name)
      << ",\"skeleton\":" << jsonString(profile.skeletonId)
      << ",\"itemPrefab\":" << jsonString(profile.itemPrefab)
      << ",\"dominantHand\":" << jsonString(profile.dominantHand)
      << ",\"mode\":" << jsonString(profile.mode)
      << ",\"perspective\":" << jsonString(profile.perspective)
      << ",\"primaryGrip\":{\"socket\":" << jsonString(profile.primaryGrip.socket)
      << ",\"space\":" << jsonString(profile.primaryGrip.space)
      << ",\"translation\":";
  appendVector(out, profile.primaryGrip.translation);
  out << ",\"rotation\":";
  appendQuaternion(out, profile.primaryGrip.rotation);
  out << '}';
  out << ",\"primaryContact\":";
  if (profile.primaryContact) {
    out << "{\"translation\":";
    appendVector(out, profile.primaryContact->translation);
    out << ",\"rotation\":";
    appendQuaternion(out, profile.primaryContact->rotation);
    out << '}';
  } else {
    out << "null";
  }
  out << ",\"handleAxis\":";
  if (profile.handleAxis) {
    out << "{\"origin\":";
    appendVector(out, profile.handleAxis->origin);
    out << ",\"direction\":";
    appendVector(out, profile.handleAxis->direction);
    out << '}';
  } else {
    out << "null";
  }
  out << ",\"secondaryHand\":";
  if (profile.secondaryHand) {
    out << "{\"enabled\":" << (profile.secondaryHand->enabled ? "true" : "false")
        << ",\"targetTranslation\":";
    appendVector(out, profile.secondaryHand->targetTranslation);
    out << ",\"targetRotation\":";
    appendQuaternion(out, profile.secondaryHand->targetRotation);
    out << ",\"poleTranslation\":";
    appendVector(out, profile.secondaryHand->poleTranslation);
    out << ",\"reachMeters\":" << profile.secondaryHand->reachMeters
        << ",\"angleDegrees\":" << profile.secondaryHand->angleDegrees
        << ",\"contactMeters\":" << profile.secondaryHand->contactMeters
        << ",\"jointLimitPolicy\":" << jsonString(profile.secondaryHand->jointLimitPolicy) << '}';
  } else {
    out << "null";
  }
  out << ",\"motionEnvelopes\":[";
  for (std::size_t index = 0; index < profile.motionEnvelopes.size(); ++index) {
    const auto& envelope = profile.motionEnvelopes[index];
    if (index != 0) out << ',';
    out << "{\"phase\":" << jsonString(envelope.phase)
        << ",\"clip\":" << jsonString(envelope.clip)
        << ",\"normalizedTimes\":[";
    for (std::size_t sampleIndex = 0; sampleIndex < envelope.normalizedTimes.size(); ++sampleIndex) {
      if (sampleIndex != 0) out << ',';
      out << envelope.normalizedTimes[sampleIndex];
    }
    out << "],\"proceduralLayers\":";
    appendStringArray(out, envelope.proceduralLayers);
    out << '}';
  }
  out << "]}";
  return true;
}

bool buildCookedPayload(
  const AnimationSystem& animation,
  const std::filesystem::path& animationRoot,
  std::string* payload,
  std::string* errorMessage) {
  const auto skeletons = animation.snapshotSkeletons();
  const auto profiles = animation.snapshotAttachmentProfiles();
  std::ostringstream out;
  out.imbue(std::locale::classic());
  out << std::setprecision(std::numeric_limits<double>::max_digits10)
      << "{\"schema\":\"shader_forge.spatial_authoring_cooked\",\"schemaVersion\":1,\"skeletons\":[";
  for (std::size_t index = 0; index < skeletons.size(); ++index) {
    if (index != 0) out << ',';
    if (!appendSkeleton(out, skeletons[index], animationRoot, errorMessage)) return false;
  }
  out << "],\"attachmentProfiles\":[";
  for (std::size_t index = 0; index < profiles.size(); ++index) {
    if (index != 0) out << ',';
    if (!appendAttachmentProfile(out, profiles[index], animationRoot, errorMessage)) return false;
  }
  out << "]}\n";
  *payload = out.str();
  return true;
}

std::string tempSuffix() {
#if defined(_WIN32)
  return ".tmp." + std::to_string(_getpid());
#else
  return ".tmp." + std::to_string(getpid());
#endif
}

bool replaceFile(
  const std::filesystem::path& temporaryPath,
  const std::filesystem::path& finalPath,
  std::string* errorMessage) {
#if defined(_WIN32)
  if (MoveFileExW(temporaryPath.c_str(), finalPath.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH) == 0) {
    if (errorMessage) {
      *errorMessage = "Could not replace cooked spatial payload (Windows error "
        + std::to_string(GetLastError()) + ").";
    }
    return false;
  }
#else
  if (std::rename(temporaryPath.c_str(), finalPath.c_str()) != 0) {
    if (errorMessage) *errorMessage = "Could not replace cooked spatial payload.";
    return false;
  }
#endif
  return true;
}

bool writeCookedPayload(
  const std::filesystem::path& outputRoot,
  std::string_view payload,
  std::filesystem::path* cookedPath,
  std::string* errorMessage) {
  const std::filesystem::path finalPath = outputRoot / "animation" / "spatial-authoring.bin";
  std::error_code fileError;
  std::filesystem::create_directories(finalPath.parent_path(), fileError);
  if (fileError) {
    if (errorMessage) *errorMessage = "Could not create cooked spatial output directory: " + fileError.message();
    return false;
  }
  const std::filesystem::path temporaryPath = finalPath.string() + tempSuffix();
  std::filesystem::remove(temporaryPath, fileError);
  fileError.clear();
  {
    std::ofstream stream(temporaryPath, std::ios::binary | std::ios::trunc);
    if (!stream.is_open()) {
      if (errorMessage) *errorMessage = "Could not open temporary cooked spatial payload for writing.";
      return false;
    }
    stream.write(payload.data(), static_cast<std::streamsize>(payload.size()));
    stream.close();
    if (!stream) {
      std::filesystem::remove(temporaryPath, fileError);
      if (errorMessage) *errorMessage = "Could not finish writing temporary cooked spatial payload.";
      return false;
    }
  }
  if (!replaceFile(temporaryPath, finalPath, errorMessage)) {
    std::filesystem::remove(temporaryPath, fileError);
    return false;
  }
  *cookedPath = finalPath;
  return true;
}

int usageError(std::string_view message) {
  std::cerr << "shader_forge_spatial: " << message << '\n'
            << "usage: shader_forge_spatial validate --animation-root <path>\n"
            << "       shader_forge_spatial cook --animation-root <path> --output-root <path>\n";
  return 2;
}

bool resolvePath(
  const std::filesystem::path& requestedPath,
  std::string_view label,
  std::filesystem::path* normalizedPath) {
  std::error_code pathError;
  const std::filesystem::path absolutePath = std::filesystem::absolute(requestedPath, pathError);
  if (pathError) {
    std::cerr << "shader_forge_spatial: cannot resolve " << label << ' '
              << jsonString(requestedPath.generic_string()) << ": " << pathError.message() << '\n';
    return false;
  }
  *normalizedPath = std::filesystem::weakly_canonical(absolutePath, pathError);
  if (pathError) {
    std::cerr << "shader_forge_spatial: cannot normalize " << label << ' '
              << jsonString(absolutePath.generic_string()) << ": " << pathError.message() << '\n';
    return false;
  }
  return true;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 2) return usageError("expected validate or cook");
  const std::string_view command = argv[1];
  std::filesystem::path requestedAnimationRoot;
  std::filesystem::path requestedOutputRoot;
  if (command == "validate") {
    if (argc != 4 || std::string_view(argv[2]) != "--animation-root" || std::string_view(argv[3]).empty()) {
      return usageError("expected validate --animation-root <path>");
    }
    requestedAnimationRoot = argv[3];
  } else if (command == "cook") {
    if (argc != 6) return usageError("expected cook --animation-root <path> --output-root <path>");
    bool hasAnimationRoot = false;
    bool hasOutputRoot = false;
    for (int index = 2; index < argc; index += 2) {
      const std::string_view flag = argv[index];
      const std::string_view value = argv[index + 1];
      if (value.empty()) return usageError("cook flag values must not be empty");
      if (flag == "--animation-root" && !hasAnimationRoot) {
        requestedAnimationRoot = value;
        hasAnimationRoot = true;
      } else if (flag == "--output-root" && !hasOutputRoot) {
        requestedOutputRoot = value;
        hasOutputRoot = true;
      } else {
        return usageError("unknown or duplicate cook flag");
      }
    }
    if (!hasAnimationRoot || !hasOutputRoot) return usageError("cook requires --animation-root and --output-root");
  } else {
    return usageError("expected validate or cook");
  }

  std::filesystem::path animationRoot;
  if (!resolvePath(requestedAnimationRoot, "animation root", &animationRoot)) return 1;
  AnimationSystem animation;
  std::string error;
  if (!animation.loadFromDisk(AnimationConfig{animationRoot}, &error)) {
    std::cerr << "shader_forge_spatial: validation failed for "
              << jsonString(animationRoot.generic_string()) << ": " << error << '\n';
    return 1;
  }

  const auto skeletons = animation.snapshotSkeletons();
  const auto profiles = animation.snapshotAttachmentProfiles();
  if (command == "cook") {
    std::filesystem::path outputRoot;
    if (!resolvePath(requestedOutputRoot, "output root", &outputRoot)) return 1;
    std::string payload;
    if (!buildCookedPayload(animation, animationRoot, &payload, &error)) {
      std::cerr << "shader_forge_spatial: cook failed: " << error << '\n';
      return 1;
    }
    std::filesystem::path cookedPath;
    if (!writeCookedPayload(outputRoot, payload, &cookedPath, &error)) {
      std::cerr << "shader_forge_spatial: cook failed: " << error << '\n';
      return 1;
    }
    const std::string cookedRelativePath = utf8Path(cookedPath.lexically_relative(outputRoot));
    std::cout << "{\"schema\":\"shader_forge.spatial_cook_result\",\"schemaVersion\":1"
              << ",\"cookedPath\":" << jsonString(cookedRelativePath)
              << ",\"counts\":{\"skeletons\":" << skeletons.size()
              << ",\"attachmentProfiles\":" << profiles.size() << "}}\n";
    return 0;
  }

  std::ostringstream out;
  out << "{\"schema\":\"shader_forge.spatial_validation\",\"schemaVersion\":1"
      << ",\"animationRoot\":" << jsonString(animationRoot.generic_string())
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
    for (const auto& envelope : profile.motionEnvelopes) sampleCount += envelope.normalizedTimes.size();
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
