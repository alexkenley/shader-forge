#include "shader_forge/runtime/animation_system.hpp"
#include "shader_forge/runtime/data_foundation.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <limits>
#include <locale>
#include <optional>
#include <sstream>
#include <string>
#include <string_view>
#include <vector>

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
using shader_forge::runtime::DataFoundation;
using shader_forge::runtime::DataFoundationConfig;
using shader_forge::runtime::DataAssetKind;
using shader_forge::runtime::PrefabSourceSnapshot;
using shader_forge::runtime::ProcgeoSourceSnapshot;
using shader_forge::runtime::SpatialAttachmentEvaluationSnapshot;
using shader_forge::runtime::SpatialJointLimitDiagnosticSnapshot;
using shader_forge::runtime::SpatialSampledAttachmentEvaluationSnapshot;
using shader_forge::runtime::SkeletonDefinitionSnapshot;
using shader_forge::runtime::SpatialQuaternionSnapshot;
using shader_forge::runtime::SpatialTransformSnapshot;
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

void appendNumber(std::ostringstream& out, double value) {
  out << (value == 0.0 ? 0.0 : value);
}

void appendVector(std::ostringstream& out, const SpatialVector3Snapshot& value) {
  out << '[';
  appendNumber(out, value.x);
  out << ',';
  appendNumber(out, value.y);
  out << ',';
  appendNumber(out, value.z);
  out << ']';
}

void appendQuaternion(std::ostringstream& out, const SpatialQuaternionSnapshot& value) {
  out << '[';
  appendNumber(out, value.x);
  out << ',';
  appendNumber(out, value.y);
  out << ',';
  appendNumber(out, value.z);
  out << ',';
  appendNumber(out, value.w);
  out << ']';
}

void appendTransform(std::ostringstream& out, const SpatialTransformSnapshot& value) {
  out << "{\"translation\":";
  appendVector(out, value.translation);
  out << ",\"rotation\":";
  appendQuaternion(out, value.rotation);
  out << ",\"axes\":{\"x\":";
  appendVector(out, value.axes.x);
  out << ",\"y\":";
  appendVector(out, value.axes.y);
  out << ",\"z\":";
  appendVector(out, value.axes.z);
  out << "}}";
}

void appendOptionalTransform(
  std::ostringstream& out,
  const std::optional<SpatialTransformSnapshot>& value) {
  if (value) appendTransform(out, *value);
  else out << "null";
}

void appendStringArray(std::ostringstream& out, const std::vector<std::string>& values) {
  out << '[';
  for (std::size_t index = 0; index < values.size(); ++index) {
    if (index != 0) out << ',';
    out << jsonString(values[index]);
  }
  out << ']';
}

struct ItemVisualBoxEvidence {
  bool available = false;
  std::string unavailableReason = "item_prefab_not_found";
  std::string procgeoId;
  double width = 0.0;
  double height = 0.0;
  double depth = 0.0;
  std::array<SpatialVector3Snapshot, 8> worldCorners{};
};

struct ItemCollisionBoxEvidence {
  std::string prefabId;
  SpatialTransformSnapshot world;
  SpatialVector3Snapshot dimensions;
  std::array<SpatialVector3Snapshot, 8> worldCorners{};
};

struct CapsuleClippingEvidence {
  std::string boneId;
  std::string role;
  SpatialVector3Snapshot centerWorld;
  SpatialVector3Snapshot axisWorld;
  double radiusMeters = 0.0;
  double halfLengthMeters = 0.0;
  SpatialVector3Snapshot segmentStartWorld;
  SpatialVector3Snapshot segmentEndWorld;
  double axisDistanceToBoxMeters = 0.0;
  double surfaceClearanceMeters = 0.0;
  double clearanceViolationMeters = 0.0;
  bool overlapping = false;
};

struct ClippingEvidence {
  std::string status = "unavailable";
  std::optional<std::string> reason = "item_prefab_not_found";
  std::size_t evaluatedCapsuleCount = 0;
  std::size_t overlapCount = 0;
  double maxClearanceViolationMeters = 0.0;
  std::optional<bool> hasOverlap;
  std::optional<ItemCollisionBoxEvidence> itemBox;
  std::vector<CapsuleClippingEvidence> capsules;
};

SpatialVector3Snapshot transformLocalCorner(
  const SpatialTransformSnapshot& world,
  double localX,
  double localY,
  double localZ) {
  return SpatialVector3Snapshot{
    world.translation.x + localX * world.axes.x.x + localY * world.axes.y.x + localZ * world.axes.z.x,
    world.translation.y + localX * world.axes.x.y + localY * world.axes.y.y + localZ * world.axes.z.y,
    world.translation.z + localX * world.axes.x.z + localY * world.axes.y.z + localZ * world.axes.z.z,
  };
}

bool finiteVector(const SpatialVector3Snapshot& value) {
  return std::isfinite(value.x) && std::isfinite(value.y) && std::isfinite(value.z);
}

bool resolveAuthoredVisualBox(
  const DataFoundation& foundation,
  const SpatialAttachmentEvaluationSnapshot& evaluation,
  ItemVisualBoxEvidence* evidence,
  std::string* errorMessage) {
  const std::optional<PrefabSourceSnapshot> prefab = foundation.prefabSource(evaluation.itemPrefabId);
  if (!prefab) return true;
  const auto assets = foundation.snapshotAssets();
  const std::size_t prefabMatches = std::count_if(
    assets.begin(),
    assets.end(),
    [&](const auto& asset) {
      return asset.kind == DataAssetKind::prefab && asset.name == prefab->name;
    });
  if (prefabMatches != 1) {
    evidence->unavailableReason = "item_prefab_ambiguous";
    return true;
  }
  if (!prefab->valid || prefab->renderComponent.procgeo.empty()) {
    evidence->unavailableReason = "item_prefab_visual_geometry_unavailable";
    return true;
  }
  const std::optional<ProcgeoSourceSnapshot> procgeo = foundation.procgeoSource(prefab->renderComponent.procgeo);
  if (!procgeo || !procgeo->valid) {
    evidence->unavailableReason = "item_prefab_visual_geometry_unavailable";
    return true;
  }
  const auto procgeoSources = foundation.snapshotProcgeoSources();
  const std::size_t procgeoMatches = std::count_if(
    procgeoSources.begin(),
    procgeoSources.end(),
    [&](const auto& candidate) { return candidate.name == procgeo->name; });
  if (procgeoMatches != 1) {
    evidence->unavailableReason = "item_prefab_visual_geometry_ambiguous";
    return true;
  }
  if (procgeo->generator != "box") {
    evidence->unavailableReason = "item_prefab_visual_geometry_not_box";
    return true;
  }

  const double width = static_cast<double>(procgeo->width);
  const double height = static_cast<double>(procgeo->height);
  const double depth = static_cast<double>(procgeo->depth);
  if (
    !std::isfinite(width) || !std::isfinite(height) || !std::isfinite(depth)
    || width <= 0.0 || height <= 0.0 || depth <= 0.0) {
    if (errorMessage) *errorMessage = "Authored visual-box dimensions are non-finite or non-positive.";
    return false;
  }
  const double halfWidth = width * 0.5;
  const double halfHeight = height * 0.5;
  const double halfDepth = depth * 0.5;
  // Same local corner order as buildBoxMesh in tools/engine-cli/lib/asset-pipeline.mjs.
  const double localCorners[8][3] = {
    {-halfWidth, -halfHeight, -halfDepth},
    { halfWidth, -halfHeight, -halfDepth},
    { halfWidth,  halfHeight, -halfDepth},
    {-halfWidth,  halfHeight, -halfDepth},
    {-halfWidth, -halfHeight,  halfDepth},
    { halfWidth, -halfHeight,  halfDepth},
    { halfWidth,  halfHeight,  halfDepth},
    {-halfWidth,  halfHeight,  halfDepth},
  };

  for (std::size_t index = 0; index < evidence->worldCorners.size(); ++index) {
    const SpatialVector3Snapshot corner = transformLocalCorner(
      evaluation.itemWorld,
      localCorners[index][0],
      localCorners[index][1],
      localCorners[index][2]);
    if (!finiteVector(corner)) {
      if (errorMessage) *errorMessage = "Authored visual-box world corners are non-finite.";
      return false;
    }
    evidence->worldCorners[index] = corner;
  }
  evidence->available = true;
  evidence->procgeoId = procgeo->name;
  evidence->width = width;
  evidence->height = height;
  evidence->depth = depth;
  return true;
}

bool safeDouble(long double value, double* result) {
  if (!std::isfinite(value)
      || value > static_cast<long double>(std::numeric_limits<double>::max())
      || value < -static_cast<long double>(std::numeric_limits<double>::max())) {
    return false;
  }
  *result = static_cast<double>(value);
  if (*result == 0.0) *result = 0.0;
  return std::isfinite(*result);
}

bool safeVector(
  long double x,
  long double y,
  long double z,
  SpatialVector3Snapshot* result) {
  return safeDouble(x, &result->x)
    && safeDouble(y, &result->y)
    && safeDouble(z, &result->z);
}

bool quaternionNeedsSignFlip(const SpatialQuaternionSnapshot& value) {
  return value.w < 0.0
    || (value.w == 0.0
      && (value.x < 0.0 || (value.x == 0.0 && (value.y < 0.0 || (value.y == 0.0 && value.z < 0.0)))));
}

bool normalizeQuaternion(SpatialQuaternionSnapshot* value) {
  const double length = std::hypot(std::hypot(value->x, value->y), std::hypot(value->z, value->w));
  if (!std::isfinite(length) || length == 0.0) return false;
  value->x /= length;
  value->y /= length;
  value->z /= length;
  value->w /= length;
  if (quaternionNeedsSignFlip(*value)) {
    value->x = -value->x;
    value->y = -value->y;
    value->z = -value->z;
    value->w = -value->w;
  }
  value->x = value->x == 0.0 ? 0.0 : value->x;
  value->y = value->y == 0.0 ? 0.0 : value->y;
  value->z = value->z == 0.0 ? 0.0 : value->z;
  value->w = value->w == 0.0 ? 0.0 : value->w;
  return true;
}

SpatialQuaternionSnapshot multiplyQuaternions(
  const SpatialQuaternionSnapshot& parent,
  const SpatialQuaternionSnapshot& local) {
  return {
    parent.w * local.x + parent.x * local.w + parent.y * local.z - parent.z * local.y,
    parent.w * local.y - parent.x * local.z + parent.y * local.w + parent.z * local.x,
    parent.w * local.z + parent.x * local.y - parent.y * local.x + parent.z * local.w,
    parent.w * local.w - parent.x * local.x - parent.y * local.y - parent.z * local.z,
  };
}

SpatialVector3Snapshot rotateVector(
  const SpatialQuaternionSnapshot& rotation,
  const SpatialVector3Snapshot& value) {
  const double twiceCrossX = 2.0 * (rotation.y * value.z - rotation.z * value.y);
  const double twiceCrossY = 2.0 * (rotation.z * value.x - rotation.x * value.z);
  const double twiceCrossZ = 2.0 * (rotation.x * value.y - rotation.y * value.x);
  return {
    value.x + rotation.w * twiceCrossX + rotation.y * twiceCrossZ - rotation.z * twiceCrossY,
    value.y + rotation.w * twiceCrossY + rotation.z * twiceCrossX - rotation.x * twiceCrossZ,
    value.z + rotation.w * twiceCrossZ + rotation.x * twiceCrossY - rotation.y * twiceCrossX,
  };
}

bool makeTransformFromTranslationAndRotation(
  const SpatialVector3Snapshot& translation,
  SpatialQuaternionSnapshot rotation,
  SpatialTransformSnapshot* transform) {
  if (!finiteVector(translation) || !normalizeQuaternion(&rotation)) return false;
  transform->translation = translation;
  transform->rotation = rotation;
  transform->axes = {
    rotateVector(rotation, {1.0, 0.0, 0.0}),
    rotateVector(rotation, {0.0, 1.0, 0.0}),
    rotateVector(rotation, {0.0, 0.0, 1.0}),
  };
  return finiteVector(transform->axes.x)
    && finiteVector(transform->axes.y)
    && finiteVector(transform->axes.z);
}

bool transformPoint(
  const SpatialTransformSnapshot& transform,
  const SpatialVector3Snapshot& point,
  SpatialVector3Snapshot* result) {
  return safeVector(
    static_cast<long double>(transform.translation.x)
      + static_cast<long double>(point.x) * transform.axes.x.x
      + static_cast<long double>(point.y) * transform.axes.y.x
      + static_cast<long double>(point.z) * transform.axes.z.x,
    static_cast<long double>(transform.translation.y)
      + static_cast<long double>(point.x) * transform.axes.x.y
      + static_cast<long double>(point.y) * transform.axes.y.y
      + static_cast<long double>(point.z) * transform.axes.z.y,
    static_cast<long double>(transform.translation.z)
      + static_cast<long double>(point.x) * transform.axes.x.z
      + static_cast<long double>(point.y) * transform.axes.y.z
      + static_cast<long double>(point.z) * transform.axes.z.z,
    result);
}

bool transformDirection(
  const SpatialTransformSnapshot& transform,
  const SpatialVector3Snapshot& direction,
  SpatialVector3Snapshot* result) {
  if (!safeVector(
        static_cast<long double>(direction.x) * transform.axes.x.x
          + static_cast<long double>(direction.y) * transform.axes.y.x
          + static_cast<long double>(direction.z) * transform.axes.z.x,
        static_cast<long double>(direction.x) * transform.axes.x.y
          + static_cast<long double>(direction.y) * transform.axes.y.y
          + static_cast<long double>(direction.z) * transform.axes.z.y,
        static_cast<long double>(direction.x) * transform.axes.x.z
          + static_cast<long double>(direction.y) * transform.axes.y.z
          + static_cast<long double>(direction.z) * transform.axes.z.z,
        result)) {
    return false;
  }
  const double length = std::hypot(result->x, result->y, result->z);
  if (!std::isfinite(length) || length == 0.0) return false;
  result->x = result->x / length;
  result->y = result->y / length;
  result->z = result->z / length;
  result->x = result->x == 0.0 ? 0.0 : result->x;
  result->y = result->y == 0.0 ? 0.0 : result->y;
  result->z = result->z == 0.0 ? 0.0 : result->z;
  return finiteVector(*result);
}

bool capsuleEndpoint(
  const SpatialVector3Snapshot& center,
  const SpatialVector3Snapshot& axis,
  double distance,
  SpatialVector3Snapshot* result) {
  return safeVector(
    static_cast<long double>(center.x) + static_cast<long double>(axis.x) * distance,
    static_cast<long double>(center.y) + static_cast<long double>(axis.y) * distance,
    static_cast<long double>(center.z) + static_cast<long double>(axis.z) * distance,
    result);
}

std::array<long double, 3> pointInBoxSpace(
  const SpatialVector3Snapshot& point,
  const SpatialTransformSnapshot& boxWorld) {
  const std::array<long double, 3> delta{
    static_cast<long double>(point.x) - boxWorld.translation.x,
    static_cast<long double>(point.y) - boxWorld.translation.y,
    static_cast<long double>(point.z) - boxWorld.translation.z,
  };
  const auto project = [&](const SpatialVector3Snapshot& axis) {
    return delta[0] * axis.x + delta[1] * axis.y + delta[2] * axis.z;
  };
  return {project(boxWorld.axes.x), project(boxWorld.axes.y), project(boxWorld.axes.z)};
}

bool segmentDistanceToBox(
  const SpatialVector3Snapshot& start,
  const SpatialVector3Snapshot& end,
  const ItemCollisionBoxEvidence& box,
  double* distance) {
  const auto startLocal = pointInBoxSpace(start, box.world);
  const auto endLocal = pointInBoxSpace(end, box.world);
  const std::array<long double, 3> direction{
    endLocal[0] - startLocal[0],
    endLocal[1] - startLocal[1],
    endLocal[2] - startLocal[2],
  };
  const std::array<long double, 3> extents{
    static_cast<long double>(box.dimensions.x) * 0.5L,
    static_cast<long double>(box.dimensions.y) * 0.5L,
    static_cast<long double>(box.dimensions.z) * 0.5L,
  };
  for (std::size_t axis = 0; axis < 3; ++axis) {
    if (!std::isfinite(startLocal[axis]) || !std::isfinite(endLocal[axis])
        || !std::isfinite(direction[axis]) || !std::isfinite(extents[axis])) {
      return false;
    }
  }

  std::vector<long double> breakpoints{0.0L, 1.0L};
  for (std::size_t axis = 0; axis < 3; ++axis) {
    if (direction[axis] == 0.0L) continue;
    for (const long double boundary : {-extents[axis], extents[axis]}) {
      const long double t = (boundary - startLocal[axis]) / direction[axis];
      if (std::isfinite(t) && t > 0.0L && t < 1.0L) breakpoints.push_back(t);
    }
  }
  std::sort(breakpoints.begin(), breakpoints.end());
  breakpoints.erase(std::unique(breakpoints.begin(), breakpoints.end()), breakpoints.end());

  long double minimumSquared = std::numeric_limits<long double>::infinity();
  const auto evaluate = [&](long double t) {
    long double squared = 0.0L;
    for (std::size_t axis = 0; axis < 3; ++axis) {
      const long double value = startLocal[axis] + direction[axis] * t;
      const long double outside = value < -extents[axis]
        ? value + extents[axis]
        : (value > extents[axis] ? value - extents[axis] : 0.0L);
      squared += outside * outside;
    }
    minimumSquared = std::min(minimumSquared, squared);
  };

  for (std::size_t interval = 0; interval + 1 < breakpoints.size(); ++interval) {
    const long double begin = breakpoints[interval];
    const long double finish = breakpoints[interval + 1];
    evaluate(begin);
    evaluate(finish);
    const long double midpoint = (begin + finish) * 0.5L;
    long double quadratic = 0.0L;
    long double linear = 0.0L;
    for (std::size_t axis = 0; axis < 3; ++axis) {
      const long double middleValue = startLocal[axis] + direction[axis] * midpoint;
      if (middleValue >= -extents[axis] && middleValue <= extents[axis]) continue;
      const long double boundary = middleValue < -extents[axis] ? -extents[axis] : extents[axis];
      quadratic += direction[axis] * direction[axis];
      linear += direction[axis] * (startLocal[axis] - boundary);
    }
    if (quadratic > 0.0L) {
      const long double stationary = -linear / quadratic;
      if (stationary > begin && stationary < finish) evaluate(stationary);
    }
  }
  if (!std::isfinite(minimumSquared) || minimumSquared < 0.0L) return false;
  return safeDouble(std::sqrt(minimumSquared), distance);
}

bool resolveClippingEvidence(
  const DataFoundation& foundation,
  const SkeletonDefinitionSnapshot& skeleton,
  const SpatialAttachmentEvaluationSnapshot& evaluation,
  ClippingEvidence* evidence,
  std::string* errorMessage) {
  *evidence = {};
  const std::optional<PrefabSourceSnapshot> prefab = foundation.prefabSource(evaluation.itemPrefabId);
  if (!prefab) return true;
  const auto assets = foundation.snapshotAssets();
  const std::size_t prefabMatches = std::count_if(
    assets.begin(),
    assets.end(),
    [&](const auto& asset) {
      return asset.kind == DataAssetKind::prefab && asset.name == prefab->name;
    });
  if (prefabMatches != 1) {
    evidence->reason = "item_prefab_ambiguous";
    return true;
  }
  if (!prefab->valid) {
    evidence->reason = "item_prefab_invalid";
    return true;
  }
  if (!prefab->collisionComponent) {
    evidence->reason = "item_collision_not_authored";
    return true;
  }

  const std::size_t authoredCapsuleCount = static_cast<std::size_t>(std::count_if(
    skeleton.boneDefinitions.begin(),
    skeleton.boneDefinitions.end(),
    [](const auto& bone) { return bone.diagnosticCapsule.has_value(); }));
  if (authoredCapsuleCount == 0) {
    evidence->reason = "diagnostic_capsules_not_authored";
    return true;
  }
  if (evaluation.bones.size() != skeleton.boneDefinitions.size()) {
    if (errorMessage) *errorMessage = "Clipping evaluation pose does not match the skeleton bone table.";
    return false;
  }

  const auto& collision = *prefab->collisionComponent;
  if (collision.shape != "box") {
    evidence->reason = "item_prefab_invalid";
    return true;
  }
  ItemCollisionBoxEvidence box;
  box.prefabId = evaluation.itemPrefabId;
  box.dimensions = {
    static_cast<double>(collision.dimensions[0]),
    static_cast<double>(collision.dimensions[1]),
    static_cast<double>(collision.dimensions[2]),
  };
  SpatialQuaternionSnapshot collisionRotation{
    static_cast<double>(collision.rotation[0]),
    static_cast<double>(collision.rotation[1]),
    static_cast<double>(collision.rotation[2]),
    static_cast<double>(collision.rotation[3]),
  };
  SpatialVector3Snapshot collisionCenter{
    static_cast<double>(collision.center[0]),
    static_cast<double>(collision.center[1]),
    static_cast<double>(collision.center[2]),
  };
  SpatialVector3Snapshot boxTranslation;
  SpatialQuaternionSnapshot boxRotation = multiplyQuaternions(evaluation.itemWorld.rotation, collisionRotation);
  if (!finiteVector(box.dimensions) || box.dimensions.x <= 0.0 || box.dimensions.y <= 0.0 || box.dimensions.z <= 0.0
      || !transformPoint(evaluation.itemWorld, collisionCenter, &boxTranslation)
      || !makeTransformFromTranslationAndRotation(boxTranslation, boxRotation, &box.world)) {
    if (errorMessage) *errorMessage = "Authored collision box produced non-finite clipping geometry.";
    return false;
  }
  const double halfX = box.dimensions.x * 0.5;
  const double halfY = box.dimensions.y * 0.5;
  const double halfZ = box.dimensions.z * 0.5;
  const double localCorners[8][3] = {
    {-halfX, -halfY, -halfZ}, {halfX, -halfY, -halfZ},
    {halfX, halfY, -halfZ}, {-halfX, halfY, -halfZ},
    {-halfX, -halfY, halfZ}, {halfX, -halfY, halfZ},
    {halfX, halfY, halfZ}, {-halfX, halfY, halfZ},
  };
  for (std::size_t index = 0; index < box.worldCorners.size(); ++index) {
    if (!transformPoint(
          box.world,
          {localCorners[index][0], localCorners[index][1], localCorners[index][2]},
          &box.worldCorners[index])) {
      if (errorMessage) *errorMessage = "Authored collision box produced non-finite clipping corners.";
      return false;
    }
  }
  evidence->itemBox = box;

  for (std::size_t index = 0; index < skeleton.boneDefinitions.size(); ++index) {
    const auto& authored = skeleton.boneDefinitions[index];
    if (evaluation.bones[index].id != authored.id || evaluation.bones[index].parent != authored.parent) {
      if (errorMessage) *errorMessage = "Clipping evaluation pose is not in stable skeleton order.";
      return false;
    }
    if (!authored.diagnosticCapsule) continue;
    const auto& capsule = *authored.diagnosticCapsule;
    CapsuleClippingEvidence result;
    result.boneId = authored.id;
    result.role = authored.role;
    result.radiusMeters = capsule.radius == 0.0 ? 0.0 : capsule.radius;
    result.halfLengthMeters = capsule.halfLength == 0.0 ? 0.0 : capsule.halfLength;
    if (!transformPoint(evaluation.bones[index].world, capsule.center, &result.centerWorld)
        || !transformDirection(evaluation.bones[index].world, capsule.axis, &result.axisWorld)
        || !capsuleEndpoint(result.centerWorld, result.axisWorld, -result.halfLengthMeters, &result.segmentStartWorld)
        || !capsuleEndpoint(result.centerWorld, result.axisWorld, result.halfLengthMeters, &result.segmentEndWorld)
        || !segmentDistanceToBox(result.segmentStartWorld, result.segmentEndWorld, box, &result.axisDistanceToBoxMeters)) {
      if (errorMessage) *errorMessage = "Authored diagnostic capsule produced non-finite clipping geometry.";
      return false;
    }
    const long double clearance = static_cast<long double>(result.axisDistanceToBoxMeters) - result.radiusMeters;
    if (!safeDouble(clearance, &result.surfaceClearanceMeters)) {
      if (errorMessage) *errorMessage = "Clipping evaluation produced non-finite surface clearance.";
      return false;
    }
    result.clearanceViolationMeters = result.surfaceClearanceMeters < 0.0
      ? -result.surfaceClearanceMeters
      : 0.0;
    result.clearanceViolationMeters = result.clearanceViolationMeters == 0.0
      ? 0.0
      : result.clearanceViolationMeters;
    result.overlapping = result.clearanceViolationMeters > 0.0;
    if (result.overlapping) evidence->overlapCount += 1;
    evidence->maxClearanceViolationMeters = std::max(
      evidence->maxClearanceViolationMeters,
      result.clearanceViolationMeters);
    evidence->capsules.push_back(std::move(result));
  }

  evidence->status = "available";
  evidence->reason.reset();
  evidence->evaluatedCapsuleCount = evidence->capsules.size();
  evidence->maxClearanceViolationMeters = evidence->maxClearanceViolationMeters == 0.0
    ? 0.0
    : evidence->maxClearanceViolationMeters;
  evidence->hasOverlap = evidence->overlapCount != 0;
  return true;
}

void appendJointLimits(std::ostringstream& out, const SpatialJointLimitDiagnosticSnapshot& jointLimits) {
  out << "{\"status\":" << jsonString(jointLimits.status)
      << ",\"reason\":";
  if (jointLimits.reason) out << jsonString(*jointLimits.reason);
  else out << "null";
  out << ",\"policy\":" << jsonString(jointLimits.policy)
      << ",\"evaluatedBoneCount\":" << jointLimits.evaluatedBoneCount
      << ",\"violationCount\":" << jointLimits.violationCount
      << ",\"maxViolationDegrees\":";
  appendNumber(out, jointLimits.maxViolationDegrees);
  out << ",\"withinLimits\":";
  if (jointLimits.withinLimits) out << (*jointLimits.withinLimits ? "true" : "false");
  else out << "null";
  out << ",\"bones\":[";
  for (std::size_t index = 0; index < jointLimits.bones.size(); ++index) {
    const auto& bone = jointLimits.bones[index];
    if (index != 0) out << ',';
    out << "{\"boneId\":" << jsonString(bone.boneId)
        << ",\"role\":" << jsonString(bone.role)
        << ",\"swingDegrees\":";
    appendNumber(out, bone.swingDegrees);
    out << ",\"swingLimitDegrees\":";
    appendNumber(out, bone.swingLimitDegrees);
    out << ",\"twistDegrees\":";
    appendNumber(out, bone.twistDegrees);
    out << ",\"twistMinDegrees\":";
    appendNumber(out, bone.twistMinDegrees);
    out << ",\"twistMaxDegrees\":";
    appendNumber(out, bone.twistMaxDegrees);
    out << ",\"swingViolationDegrees\":";
    appendNumber(out, bone.swingViolationDegrees);
    out << ",\"twistViolationDegrees\":";
    appendNumber(out, bone.twistViolationDegrees);
    out << ",\"withinLimits\":" << (bone.withinLimits ? "true" : "false") << '}';
  }
  out << "]}";
}

void appendClipping(std::ostringstream& out, const ClippingEvidence& clipping) {
  out << "{\"status\":" << jsonString(clipping.status)
      << ",\"reason\":";
  if (clipping.reason) out << jsonString(*clipping.reason);
  else out << "null";
  out << ",\"policy\":\"diagnose\""
      << ",\"metric\":\"capsule_axis_to_oriented_box_clearance\""
      << ",\"evaluatedCapsuleCount\":" << clipping.evaluatedCapsuleCount
      << ",\"overlapCount\":" << clipping.overlapCount
      << ",\"maxClearanceViolationMeters\":";
  appendNumber(out, clipping.maxClearanceViolationMeters);
  out << ",\"hasOverlap\":";
  if (clipping.hasOverlap) out << (*clipping.hasOverlap ? "true" : "false");
  else out << "null";
  out << ",\"itemBox\":";
  if (clipping.itemBox) {
    const auto& box = *clipping.itemBox;
    out << "{\"kind\":\"authored_collision_box\",\"prefabId\":" << jsonString(box.prefabId)
        << ",\"world\":";
    appendTransform(out, box.world);
    out << ",\"dimensionsMeters\":";
    appendVector(out, box.dimensions);
    out << ",\"worldCorners\":[";
    for (std::size_t index = 0; index < box.worldCorners.size(); ++index) {
      if (index != 0) out << ',';
      appendVector(out, box.worldCorners[index]);
    }
    out << "]}";
  } else {
    out << "null";
  }
  out << ",\"capsules\":[";
  for (std::size_t index = 0; index < clipping.capsules.size(); ++index) {
    const auto& capsule = clipping.capsules[index];
    if (index != 0) out << ',';
    out << "{\"boneId\":" << jsonString(capsule.boneId)
        << ",\"role\":" << jsonString(capsule.role)
        << ",\"centerWorld\":";
    appendVector(out, capsule.centerWorld);
    out << ",\"axisWorld\":";
    appendVector(out, capsule.axisWorld);
    out << ",\"radiusMeters\":";
    appendNumber(out, capsule.radiusMeters);
    out << ",\"halfLengthMeters\":";
    appendNumber(out, capsule.halfLengthMeters);
    out << ",\"segmentStartWorld\":";
    appendVector(out, capsule.segmentStartWorld);
    out << ",\"segmentEndWorld\":";
    appendVector(out, capsule.segmentEndWorld);
    out << ",\"axisDistanceToBoxMeters\":";
    appendNumber(out, capsule.axisDistanceToBoxMeters);
    out << ",\"surfaceClearanceMeters\":";
    appendNumber(out, capsule.surfaceClearanceMeters);
    out << ",\"clearanceViolationMeters\":";
    appendNumber(out, capsule.clearanceViolationMeters);
    out << ",\"overlapping\":" << (capsule.overlapping ? "true" : "false") << '}';
  }
  out << "]}";
}

void appendItemGeometry(std::ostringstream& out, const ItemVisualBoxEvidence& geometry) {
  if (!geometry.available) {
    out << "{\"status\":\"unavailable\",\"reason\":" << jsonString(geometry.unavailableReason) << '}';
    return;
  }
  out << "{\"status\":\"available\",\"kind\":\"authored_visual_box\",\"procgeoId\":"
      << jsonString(geometry.procgeoId)
      << ",\"dimensionsMeters\":[";
  appendNumber(out, geometry.width);
  out << ',';
  appendNumber(out, geometry.height);
  out << ',';
  appendNumber(out, geometry.depth);
  out << "],\"worldCorners\":[";
  for (std::size_t index = 0; index < geometry.worldCorners.size(); ++index) {
    if (index != 0) out << ',';
    appendVector(out, geometry.worldCorners[index]);
  }
  out << "]}";
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
    out << ",\"jointLimit\":";
    if (bone.jointLimit) {
      out << "{\"kind\":" << jsonString(bone.jointLimit->kind)
          << ",\"twistAxis\":";
      appendVector(out, bone.jointLimit->twistAxis);
      out << ",\"swingDegrees\":";
      appendNumber(out, bone.jointLimit->swingDegrees);
      out << ",\"twistMinDegrees\":";
      appendNumber(out, bone.jointLimit->twistMinDegrees);
      out << ",\"twistMaxDegrees\":";
      appendNumber(out, bone.jointLimit->twistMaxDegrees);
      out << '}';
    } else {
      out << "null";
    }
    out << ",\"diagnosticCapsule\":";
    if (bone.diagnosticCapsule) {
      out << "{\"center\":";
      appendVector(out, bone.diagnosticCapsule->center);
      out << ",\"axis\":";
      appendVector(out, bone.diagnosticCapsule->axis);
      out << ",\"radius\":";
      appendNumber(out, bone.diagnosticCapsule->radius);
      out << ",\"halfLength\":";
      appendNumber(out, bone.diagnosticCapsule->halfLength);
      out << '}';
    } else {
      out << "null";
    }
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
    if (!profile.secondaryHand->poleSpace.empty()) {
      out << ",\"poleSpace\":" << jsonString(profile.secondaryHand->poleSpace);
    }
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
  const int schemaVersion = std::any_of(profiles.begin(), profiles.end(), [](const auto& profile) {
    return profile.schemaVersion >= 2;
  }) ? 2 : 1;
  std::ostringstream out;
  out.imbue(std::locale::classic());
  out << std::setprecision(std::numeric_limits<double>::max_digits10)
      << "{\"schema\":\"shader_forge.spatial_authoring_cooked\",\"schemaVersion\":" << schemaVersion
      << ",\"skeletons\":[";
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

void appendAttachmentEvaluationFields(
  std::ostringstream& out,
  const SpatialAttachmentEvaluationSnapshot& evaluation,
  const ItemVisualBoxEvidence& geometry,
  const ClippingEvidence& clipping) {
  out << ",\"coordinateSystem\":{\"units\":\"meters\",\"handedness\":\"right\",\"up\":\"+Y\",\"forward\":\"+Z\",\"quaternionOrder\":\"xyzw\"}"
      << ",\"skeleton\":{\"id\":" << jsonString(evaluation.skeletonId)
      << ",\"name\":" << jsonString(evaluation.skeletonName)
      << ",\"rootBone\":" << jsonString(evaluation.rootBone) << '}'
      << ",\"attachment\":{\"id\":" << jsonString(evaluation.attachmentId)
      << ",\"name\":" << jsonString(evaluation.attachmentName)
      << ",\"itemPrefabId\":" << jsonString(evaluation.itemPrefabId)
      << ",\"dominantHand\":" << jsonString(evaluation.dominantHand)
      << ",\"mode\":" << jsonString(evaluation.mode)
      << ",\"perspective\":" << jsonString(evaluation.perspective)
      << ",\"primaryGripSocket\":" << jsonString(evaluation.primaryGripSocket) << '}'
      << ",\"bones\":[";
  for (std::size_t index = 0; index < evaluation.bones.size(); ++index) {
    const auto& bone = evaluation.bones[index];
    if (index != 0) out << ',';
    out << "{\"id\":" << jsonString(bone.id)
        << ",\"parent\":" << jsonString(bone.parent)
        << ",\"role\":" << jsonString(bone.role)
        << ",\"local\":";
    appendTransform(out, bone.local);
    out << ",\"world\":";
    appendTransform(out, bone.world);
    out << '}';
  }
  out << "],\"segments\":[";
  for (std::size_t index = 0; index < evaluation.segments.size(); ++index) {
    const auto& segment = evaluation.segments[index];
    if (index != 0) out << ',';
    out << "{\"parentBoneId\":" << jsonString(segment.parent)
        << ",\"boneId\":" << jsonString(segment.child)
        << ",\"from\":";
    appendVector(out, segment.from);
    out << ",\"to\":";
    appendVector(out, segment.to);
    out << '}';
  }
  out << "],\"sockets\":[";
  for (std::size_t index = 0; index < evaluation.sockets.size(); ++index) {
    const auto& socket = evaluation.sockets[index];
    if (index != 0) out << ',';
    out << "{\"id\":" << jsonString(socket.id)
        << ",\"boneId\":" << jsonString(socket.bone)
        << ",\"role\":" << jsonString(socket.role)
        << ",\"local\":";
    appendTransform(out, socket.local);
    out << ",\"world\":";
    appendTransform(out, socket.world);
    out << '}';
  }
  out << "],\"item\":{\"prefabId\":" << jsonString(evaluation.itemPrefabId)
      << ",\"world\":";
  appendTransform(out, evaluation.itemWorld);
  out << ",\"geometry\":";
  appendItemGeometry(out, geometry);
  out << ",\"primaryContactWorld\":";
  appendOptionalTransform(out, evaluation.primaryContactWorld);
  out << ",\"handleAxisWorld\":";
  if (evaluation.handleAxisWorld) {
    out << "{\"origin\":";
    appendVector(out, evaluation.handleAxisWorld->origin);
    out << ",\"direction\":";
    appendVector(out, evaluation.handleAxisWorld->direction);
    out << '}';
  } else {
    out << "null";
  }
  out << "},\"hands\":{\"dominant\":";
  if (evaluation.dominantHandFrame) {
    const auto& hand = *evaluation.dominantHandFrame;
    out << "{\"boneId\":" << jsonString(hand.bone) << ",\"role\":" << jsonString(hand.role)
        << ",\"world\":";
    appendTransform(out, hand.world);
    out << ",\"palmWorld\":";
    appendOptionalTransform(out, hand.palmWorld);
    out << '}';
  } else {
    out << "null";
  }
  out << ",\"secondary\":";
  if (evaluation.secondaryHandFrame) {
    const auto& hand = *evaluation.secondaryHandFrame;
    out << "{\"enabled\":" << (hand.enabled ? "true" : "false")
        << ",\"boneId\":" << jsonString(hand.bone)
        << ",\"role\":" << jsonString(hand.role)
        << ",\"world\":";
    appendTransform(out, hand.world);
    out << ",\"palmWorld\":";
    appendOptionalTransform(out, hand.palmWorld);
    out << ",\"targetWorld\":";
    appendOptionalTransform(out, hand.targetWorld);
    out << ",\"pole\":";
    if (hand.poleTranslation) {
      out << "{\"translation\":";
      appendVector(out, *hand.poleTranslation);
      out << ",\"space\":" << jsonString(hand.poleSpace.empty() ? "unresolved" : hand.poleSpace)
          << ",\"world\":";
      if (hand.poleWorld) appendVector(out, *hand.poleWorld);
      else out << "null";
      out << ",\"reason\":";
      if (hand.poleReason) out << jsonString(*hand.poleReason);
      else out << "null";
      out << '}';
    } else {
      out << "null";
    }
    out << ",\"preSolveDistanceMeters\":";
    if (hand.preSolveDistanceMeters) appendNumber(out, *hand.preSolveDistanceMeters);
    else out << "null";
    out << '}';
  } else {
    out << "null";
  }
  out << "},\"diagnostics\":{\"secondaryIk\":";
  const auto& secondaryIk = evaluation.secondaryIk;
  out << "{\"status\":" << jsonString(secondaryIk.status.empty()
    ? (evaluation.mode == "two_hand" ? "unavailable" : "not_applicable")
    : secondaryIk.status);
  if (secondaryIk.reason) {
    out << ",\"reason\":" << jsonString(*secondaryIk.reason);
  } else if (secondaryIk.status != "applied") {
    out << ",\"reason\":" << jsonString(evaluation.mode == "two_hand" ? "rest_pose_unsolved" : "one_hand_attachment");
  }
  if (secondaryIk.solved || secondaryIk.status == "applied") {
    const auto appendOptionalNumberField = [&](std::string_view name, const std::optional<double>& value) {
      out << ",\"" << name << "\":";
      if (value) appendNumber(out, *value);
      else out << "null";
    };
    const auto appendOptionalBoolField = [&](std::string_view name, const std::optional<bool>& value) {
      out << ",\"" << name << "\":";
      if (value) out << (*value ? "true" : "false");
      else out << "null";
    };
    out << ",\"solved\":" << (secondaryIk.solved ? "true" : "false")
        << ",\"reachable\":" << (secondaryIk.reachable && *secondaryIk.reachable ? "true" : "false");
    appendOptionalNumberField("preSolveDistanceMeters", secondaryIk.preSolveDistanceMeters);
    appendOptionalNumberField("targetDistanceMeters", secondaryIk.targetDistanceMeters);
    appendOptionalNumberField("minReachMeters", secondaryIk.minReachMeters);
    appendOptionalNumberField("maxReachMeters", secondaryIk.maxReachMeters);
    appendOptionalNumberField("reachResidualMeters", secondaryIk.reachResidualMeters);
    appendOptionalNumberField("reachToleranceMeters", secondaryIk.reachToleranceMeters);
    appendOptionalBoolField("reachWithinTolerance", secondaryIk.reachWithinTolerance);
    appendOptionalNumberField("postSolveDistanceMeters", secondaryIk.postSolveDistanceMeters);
    appendOptionalNumberField("contactToleranceMeters", secondaryIk.contactToleranceMeters);
    appendOptionalBoolField("contactWithinTolerance", secondaryIk.contactWithinTolerance);
    appendOptionalNumberField("postSolveAngleDegrees", secondaryIk.postSolveAngleDegrees);
    appendOptionalNumberField("angleToleranceDegrees", secondaryIk.angleToleranceDegrees);
    appendOptionalBoolField("angleWithinTolerance", secondaryIk.angleWithinTolerance);
    appendOptionalBoolField("withinTolerance", secondaryIk.withinTolerance);
  }
  out << '}'
      << ','
      << "\"jointLimits\":";
  appendJointLimits(out, evaluation.jointLimits);
  out << ",\"clipping\":";
  appendClipping(out, clipping);
  out << '}';
}

void appendEvaluationLimitations(
  std::ostringstream& out,
  const SpatialAttachmentEvaluationSnapshot& evaluation,
  std::string_view poseLimitation) {
  out << ",\"limitations\":[" << jsonString(poseLimitation)
      << ",\"not_review_evidence\",\"item_mesh_unavailable\"";
  if (evaluation.mode == "two_hand" && evaluation.secondaryIk.status != "applied") {
    out << ",\"secondary_hand_ik_unavailable\"";
  }
  out << "]}\n";
}

void appendRestEvaluation(
  std::ostringstream& out,
  const SpatialAttachmentEvaluationSnapshot& evaluation,
  const ItemVisualBoxEvidence& geometry,
  const ClippingEvidence& clipping) {
  out << "{\"schema\":\"shader_forge.spatial_attachment_evaluation\",\"schemaVersion\":"
      << (evaluation.attachmentSchemaVersion >= 2 ? 2 : 1)
      << ",\"pose\":{\"kind\":\"rest\",\"sampled\":false}";
  appendAttachmentEvaluationFields(out, evaluation, geometry, clipping);
  appendEvaluationLimitations(out, evaluation, "rest_pose_only");
}

void appendSampledEvaluation(
  std::ostringstream& out,
  const SpatialSampledAttachmentEvaluationSnapshot& sampled,
  const ItemVisualBoxEvidence& geometry,
  const ClippingEvidence& clipping) {
  out << "{\"schema\":\"shader_forge.spatial_attachment_evaluation\",\"schemaVersion\":"
      << (sampled.evaluation.attachmentSchemaVersion >= 2 ? 2 : 1)
      << ",\"pose\":{\"kind\":\"clip_sample\",\"sampled\":true"
      << ",\"phase\":" << jsonString(sampled.phase)
      << ",\"clip\":" << jsonString(sampled.clipName)
      << ",\"normalizedTime\":";
  appendNumber(out, sampled.normalizedTime);
  out << ",\"proceduralLayersRequested\":";
  appendStringArray(out, sampled.proceduralLayersRequested);
  out << ",\"proceduralLayersApplied\":";
  appendStringArray(out, sampled.proceduralLayersApplied);
  out << ",\"proceduralLayersUnavailable\":";
  appendStringArray(out, sampled.proceduralLayersUnavailable);
  out << '}';
  appendAttachmentEvaluationFields(out, sampled.evaluation, geometry, clipping);
  const bool awaitsSecondaryIk = std::find(
    sampled.proceduralLayersUnavailable.begin(),
    sampled.proceduralLayersUnavailable.end(),
    "secondary_hand_ik") != sampled.proceduralLayersUnavailable.end();
  appendEvaluationLimitations(
    out,
    sampled.evaluation,
    awaitsSecondaryIk ? "pre_ik_only" : "sampled_attachment_schematic_only");
}

bool parseCliFiniteNumber(std::string_view raw, double* value) {
  if (raw.empty()) return false;
  std::istringstream stream{std::string(raw)};
  stream.imbue(std::locale::classic());
  double parsed = 0.0;
  if (!(stream >> parsed) || !std::isfinite(parsed)) return false;
  stream >> std::ws;
  if (!stream.eof()) return false;
  *value = parsed;
  return true;
}

int usageError(std::string_view message) {
  std::cerr << "shader_forge_spatial: " << message << '\n'
            << "usage: shader_forge_spatial validate --animation-root <path>\n"
            << "       shader_forge_spatial cook --animation-root <path> --output-root <path>\n"
            << "       shader_forge_spatial evaluate-rest --animation-root <path> --attachment <attachment-id> --content-root <path> --data-foundation <path>\n"
            << "       shader_forge_spatial evaluate-sample --animation-root <path> --attachment <attachment-id> --phase <phase> --normalized-time <value> --content-root <path> --data-foundation <path>\n";
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
  if (argc < 2) return usageError("expected validate, cook, evaluate-rest, or evaluate-sample");
  const std::string_view command = argv[1];
  std::filesystem::path requestedAnimationRoot;
  std::filesystem::path requestedOutputRoot;
  std::filesystem::path requestedContentRoot;
  std::filesystem::path requestedDataFoundation;
  std::string requestedAttachmentId;
  std::string requestedPhase;
  double requestedNormalizedTime = 0.0;
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
  } else if (command == "evaluate-rest") {
    if (argc != 10) {
      return usageError("expected evaluate-rest --animation-root <path> --attachment <attachment-id> --content-root <path> --data-foundation <path>");
    }
    bool hasAnimationRoot = false;
    bool hasAttachment = false;
    bool hasContentRoot = false;
    bool hasDataFoundation = false;
    for (int index = 2; index < argc; index += 2) {
      const std::string_view flag = argv[index];
      const std::string_view value = argv[index + 1];
      if (value.empty()) return usageError("evaluate-rest flag values must not be empty");
      if (flag == "--animation-root" && !hasAnimationRoot) {
        requestedAnimationRoot = value;
        hasAnimationRoot = true;
      } else if (flag == "--attachment" && !hasAttachment) {
        requestedAttachmentId = value;
        hasAttachment = true;
      } else if (flag == "--content-root" && !hasContentRoot) {
        requestedContentRoot = value;
        hasContentRoot = true;
      } else if (flag == "--data-foundation" && !hasDataFoundation) {
        requestedDataFoundation = value;
        hasDataFoundation = true;
      } else {
        return usageError("unknown or duplicate evaluate-rest flag");
      }
    }
    if (!hasAnimationRoot || !hasAttachment || !hasContentRoot || !hasDataFoundation) {
      return usageError("evaluate-rest requires --animation-root, --attachment, --content-root, and --data-foundation");
    }
  } else if (command == "evaluate-sample") {
    if (argc != 14) {
      return usageError("expected evaluate-sample --animation-root <path> --attachment <attachment-id> --phase <phase> --normalized-time <value> --content-root <path> --data-foundation <path>");
    }
    bool hasAnimationRoot = false;
    bool hasAttachment = false;
    bool hasPhase = false;
    bool hasNormalizedTime = false;
    bool hasContentRoot = false;
    bool hasDataFoundation = false;
    std::string requestedNormalizedTimeRaw;
    for (int index = 2; index < argc; index += 2) {
      const std::string_view flag = argv[index];
      const std::string_view value = argv[index + 1];
      if (value.empty()) return usageError("evaluate-sample flag values must not be empty");
      if (flag == "--animation-root" && !hasAnimationRoot) {
        requestedAnimationRoot = value;
        hasAnimationRoot = true;
      } else if (flag == "--attachment" && !hasAttachment) {
        requestedAttachmentId = value;
        hasAttachment = true;
      } else if (flag == "--phase" && !hasPhase) {
        requestedPhase = value;
        hasPhase = true;
      } else if (flag == "--normalized-time" && !hasNormalizedTime) {
        requestedNormalizedTimeRaw = value;
        hasNormalizedTime = true;
      } else if (flag == "--content-root" && !hasContentRoot) {
        requestedContentRoot = value;
        hasContentRoot = true;
      } else if (flag == "--data-foundation" && !hasDataFoundation) {
        requestedDataFoundation = value;
        hasDataFoundation = true;
      } else {
        return usageError("unknown or duplicate evaluate-sample flag");
      }
    }
    if (!hasAnimationRoot || !hasAttachment || !hasPhase || !hasNormalizedTime || !hasContentRoot || !hasDataFoundation) {
      return usageError("evaluate-sample requires --animation-root, --attachment, --phase, --normalized-time, --content-root, and --data-foundation");
    }
    if (!parseCliFiniteNumber(requestedNormalizedTimeRaw, &requestedNormalizedTime)) {
      return usageError("evaluate-sample --normalized-time must be a locale-independent finite number");
    }
  } else {
    return usageError("expected validate, cook, evaluate-rest, or evaluate-sample");
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
  DataFoundation dataFoundation;
  if (command == "evaluate-rest" || command == "evaluate-sample") {
    std::filesystem::path contentRoot;
    std::filesystem::path dataFoundationPath;
    if (!resolvePath(requestedContentRoot, "content root", &contentRoot)) return 1;
    if (!resolvePath(requestedDataFoundation, "data foundation", &dataFoundationPath)) return 1;
    if (!dataFoundation.loadFromDisk(DataFoundationConfig{contentRoot, dataFoundationPath}, &error)) {
      std::cerr << "shader_forge_spatial: " << command << " failed: " << error << '\n';
      return 1;
    }
  }
  if (command == "evaluate-rest") {
    const auto attachmentId = animation.findAttachmentProfileId(requestedAttachmentId);
    if (!attachmentId) {
      std::cerr << "shader_forge_spatial: evaluate-rest failed: unknown attachment "
                << jsonString(requestedAttachmentId) << "\n";
      return 1;
    }
    const auto evaluation = animation.evaluateRestAttachment(*attachmentId, &error);
    if (!evaluation) {
      std::cerr << "shader_forge_spatial: evaluate-rest failed for "
                << jsonString(requestedAttachmentId) << ": " << error << '\n';
      return 1;
    }
    std::ostringstream out;
    out.imbue(std::locale::classic());
    out << std::setprecision(std::numeric_limits<double>::max_digits10);
    ItemVisualBoxEvidence geometry;
    if (!resolveAuthoredVisualBox(dataFoundation, *evaluation, &geometry, &error)) {
      std::cerr << "shader_forge_spatial: evaluate-rest failed for "
                << jsonString(requestedAttachmentId) << ": " << error << '\n';
      return 1;
    }
    const auto skeleton = std::find_if(
      skeletons.begin(),
      skeletons.end(),
      [&](const auto& candidate) { return candidate.id == evaluation->skeletonId; });
    if (skeleton == skeletons.end()) {
      std::cerr << "shader_forge_spatial: evaluate-rest failed for "
                << jsonString(requestedAttachmentId) << ": evaluated skeleton is unavailable\n";
      return 1;
    }
    ClippingEvidence clipping;
    if (!resolveClippingEvidence(dataFoundation, *skeleton, *evaluation, &clipping, &error)) {
      std::cerr << "shader_forge_spatial: evaluate-rest failed for "
                << jsonString(requestedAttachmentId) << ": " << error << '\n';
      return 1;
    }
    appendRestEvaluation(out, *evaluation, geometry, clipping);
    std::cout << out.str();
    return 0;
  }
  if (command == "evaluate-sample") {
    const auto attachmentId = animation.findAttachmentProfileId(requestedAttachmentId);
    if (!attachmentId) {
      std::cerr << "shader_forge_spatial: evaluate-sample failed: unknown attachment "
                << jsonString(requestedAttachmentId) << "\n";
      return 1;
    }
    const auto evaluation = animation.evaluateSampledAttachment(
      *attachmentId, requestedPhase, requestedNormalizedTime, &error);
    if (!evaluation) {
      std::cerr << "shader_forge_spatial: evaluate-sample failed for "
                << jsonString(requestedAttachmentId) << ": " << error << '\n';
      return 1;
    }
    std::ostringstream out;
    out.imbue(std::locale::classic());
    out << std::setprecision(std::numeric_limits<double>::max_digits10);
    ItemVisualBoxEvidence geometry;
    if (!resolveAuthoredVisualBox(dataFoundation, evaluation->evaluation, &geometry, &error)) {
      std::cerr << "shader_forge_spatial: evaluate-sample failed for "
                << jsonString(requestedAttachmentId) << ": " << error << '\n';
      return 1;
    }
    const auto skeleton = std::find_if(
      skeletons.begin(),
      skeletons.end(),
      [&](const auto& candidate) { return candidate.id == evaluation->evaluation.skeletonId; });
    if (skeleton == skeletons.end()) {
      std::cerr << "shader_forge_spatial: evaluate-sample failed for "
                << jsonString(requestedAttachmentId) << ": evaluated skeleton is unavailable\n";
      return 1;
    }
    ClippingEvidence clipping;
    if (!resolveClippingEvidence(dataFoundation, *skeleton, evaluation->evaluation, &clipping, &error)) {
      std::cerr << "shader_forge_spatial: evaluate-sample failed for "
                << jsonString(requestedAttachmentId) << ": " << error << '\n';
      return 1;
    }
    appendSampledEvaluation(out, *evaluation, geometry, clipping);
    std::cout << out.str();
    return 0;
  }
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
    const std::string source = relativeSourcePath(profile.sourcePath, animationRoot);
    if (source.empty()) {
      std::cerr << "shader_forge_spatial: attachment profile source is outside the animation root: "
                << profile.sourcePath.string() << '\n';
      return 1;
    }
    std::size_t sampleCount = 0;
    for (const auto& envelope : profile.motionEnvelopes) sampleCount += envelope.normalizedTimes.size();
    if (index != 0) out << ',';
    out << "{\"id\":" << jsonString(profile.id)
        << ",\"schemaVersion\":" << profile.schemaVersion
        << ",\"source\":" << jsonString(source)
        << ",\"skeleton\":" << jsonString(profile.skeletonId)
        << ",\"itemPrefab\":" << jsonString(profile.itemPrefab)
        << ",\"mode\":" << jsonString(profile.mode)
        << ",\"perspective\":" << jsonString(profile.perspective)
        << ",\"motionEnvelopePhaseCount\":" << profile.motionEnvelopes.size()
        << ",\"motionEnvelopeSampleCount\":" << sampleCount
        << ",\"motionEnvelopes\":[";
    for (std::size_t envelopeIndex = 0; envelopeIndex < profile.motionEnvelopes.size(); ++envelopeIndex) {
      const auto& envelope = profile.motionEnvelopes[envelopeIndex];
      if (envelopeIndex != 0) out << ',';
      out << "{\"phase\":" << jsonString(envelope.phase)
          << ",\"clip\":" << jsonString(envelope.clip)
          << ",\"normalizedTimes\":[";
      for (std::size_t sampleIndex = 0; sampleIndex < envelope.normalizedTimes.size(); ++sampleIndex) {
        if (sampleIndex != 0) out << ',';
        appendNumber(out, envelope.normalizedTimes[sampleIndex]);
      }
      out << "],\"proceduralLayers\":";
      appendStringArray(out, envelope.proceduralLayers);
      out << '}';
    }
    out << "]}";
  }
  out << "]}\n";
  std::cout << out.str();
  return 0;
}
