#pragma once

#include "shader_forge/runtime/animation_system.hpp"

#include <filesystem>
#include <optional>
#include <string>
#include <vector>

namespace shader_forge::runtime {

inline constexpr int kSpatialCaptureMinResolutionPx = 64;
inline constexpr int kSpatialCaptureMaxResolutionPx = 1024;

struct SpatialCaptureItemBox {
  double width = 0.0;
  double height = 0.0;
  double depth = 0.0;
  SpatialTransformSnapshot world;
};

struct SpatialCaptureBoundsSnapshot {
  SpatialVector3Snapshot min;
  SpatialVector3Snapshot max;
  SpatialVector3Snapshot center;
};

struct SpatialCaptureCameraSnapshot {
  std::string id;
  SpatialVector3Snapshot position;
  SpatialVector3Snapshot target;
  SpatialVector3Snapshot up;
  double fovDegrees = 0.0;
  double nearMeters = 0.0;
  double farMeters = 0.0;
  int widthPx = 0;
  int heightPx = 0;
};

struct SpatialCaptureFrameSnapshot {
  SpatialCaptureCameraSnapshot camera;
  std::string relativePath;
};

struct SpatialCaptureLightingSnapshot {
  SpatialVector3Snapshot keyDirection;
  double keyIntensity = 0.0;
  SpatialVector3Snapshot fillDirection;
  double fillIntensity = 0.0;
  double ambientIntensity = 0.0;
  double exposure = 0.0;
};

struct SpatialCaptureResultSnapshot {
  std::string attachmentId;
  std::string phase;
  double normalizedTime = 0.0;
  std::vector<std::string> renderGeometryKinds;
  SpatialCaptureBoundsSnapshot characterBounds;
  SpatialCaptureBoundsSnapshot itemBounds;
  SpatialCaptureBoundsSnapshot combinedBounds;
  SpatialCaptureLightingSnapshot lighting;
  std::vector<SpatialCaptureFrameSnapshot> frames;
};

bool writeSpatialCaptureSample(
  const SpatialSampledAttachmentEvaluationSnapshot& sampled,
  const SpatialCaptureItemBox& itemBox,
  const std::optional<SpatialCaptureCameraSnapshot>& playerCamera,
  const std::filesystem::path& outputDir,
  int widthPx,
  int heightPx,
  SpatialCaptureResultSnapshot* result,
  std::string* errorMessage);

}  // namespace shader_forge::runtime
