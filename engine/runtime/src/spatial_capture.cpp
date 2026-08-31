#include "shader_forge/runtime/spatial_capture.hpp"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <limits>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace shader_forge::runtime {
namespace {

constexpr double kPi = 3.1415926535897932384626433832795;
constexpr double kFovDegrees = 35.0;
constexpr double kMinCoverage = 0.50;
constexpr double kMaxCoverage = 0.75;
constexpr double kTargetCoverage = 0.625;
constexpr double kPrismRadiusMeters = 0.04;
constexpr int kPrismSides = 8;
constexpr double kKeyIntensity = 0.78;
constexpr double kFillIntensity = 0.28;
constexpr double kAmbientIntensity = 0.22;
constexpr double kExposure = 1.0;
constexpr double kBackgroundR = 24.0 / 255.0;
constexpr double kBackgroundG = 26.0 / 255.0;
constexpr double kBackgroundB = 30.0 / 255.0;
constexpr std::array<double, 3> kKeyDirection{0.35, 0.82, 0.44};
constexpr std::array<double, 3> kFillDirection{-0.55, 0.18, -0.28};

struct Vec3 {
  double x = 0.0;
  double y = 0.0;
  double z = 0.0;
};

struct Vec4 {
  double x = 0.0;
  double y = 0.0;
  double z = 0.0;
  double w = 0.0;
};

struct Mat4 {
  double m[16]{};
};

struct Rgb {
  double r = 0.0;
  double g = 0.0;
  double b = 0.0;
};

struct Vertex {
  Vec3 position;
  Vec3 normal;
  Rgb albedo;
};

struct Triangle {
  Vertex v0;
  Vertex v1;
  Vertex v2;
};

struct Bounds {
  Vec3 min{
    std::numeric_limits<double>::infinity(),
    std::numeric_limits<double>::infinity(),
    std::numeric_limits<double>::infinity()};
  Vec3 max{
    -std::numeric_limits<double>::infinity(),
    -std::numeric_limits<double>::infinity(),
    -std::numeric_limits<double>::infinity()};
};

struct CameraState {
  std::string id;
  Vec3 position;
  Vec3 target;
  Vec3 up;
  double fovDegrees = kFovDegrees;
  double nearMeters = 0.05;
  double farMeters = 100.0;
  int widthPx = 0;
  int heightPx = 0;
  Mat4 viewProj{};
};

struct ImageBuffer {
  int width = 0;
  int height = 0;
  std::vector<std::uint8_t> rgb;
  std::vector<float> depth;
};

bool finiteVec(const Vec3& value) {
  return std::isfinite(value.x) && std::isfinite(value.y) && std::isfinite(value.z);
}

Vec3 add(const Vec3& a, const Vec3& b) {
  return {a.x + b.x, a.y + b.y, a.z + b.z};
}

Vec3 sub(const Vec3& a, const Vec3& b) {
  return {a.x - b.x, a.y - b.y, a.z - b.z};
}

Vec3 scale(const Vec3& value, double amount) {
  return {value.x * amount, value.y * amount, value.z * amount};
}

double dot(const Vec3& a, const Vec3& b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

Vec3 cross(const Vec3& a, const Vec3& b) {
  return {
    a.y * b.z - a.z * b.y,
    a.z * b.x - a.x * b.z,
    a.x * b.y - a.y * b.x,
  };
}

double length(const Vec3& value) {
  return std::hypot(value.x, value.y, value.z);
}

bool normalize(const Vec3& value, Vec3* result) {
  const double mag = length(value);
  if (!std::isfinite(mag) || mag <= 0.0) return false;
  *result = scale(value, 1.0 / mag);
  return finiteVec(*result);
}

Vec3 fromSnapshot(const SpatialVector3Snapshot& value) {
  return {value.x, value.y, value.z};
}

SpatialVector3Snapshot toSnapshot(const Vec3& value) {
  return {
    value.x == 0.0 ? 0.0 : value.x,
    value.y == 0.0 ? 0.0 : value.y,
    value.z == 0.0 ? 0.0 : value.z,
  };
}

bool fail(std::string* errorMessage, std::string message) {
  if (errorMessage) *errorMessage = std::move(message);
  return false;
}

Vec3 rotateByAxes(const SpatialAxesSnapshot& axes, const Vec3& local) {
  return add(
    add(scale(fromSnapshot(axes.x), local.x), scale(fromSnapshot(axes.y), local.y)),
    scale(fromSnapshot(axes.z), local.z));
}

bool transformPoint(const SpatialTransformSnapshot& transform, const Vec3& local, Vec3* result) {
  *result = add(fromSnapshot(transform.translation), rotateByAxes(transform.axes, local));
  return finiteVec(*result);
}

void expandBounds(Bounds* bounds, const Vec3& point) {
  bounds->min.x = std::min(bounds->min.x, point.x);
  bounds->min.y = std::min(bounds->min.y, point.y);
  bounds->min.z = std::min(bounds->min.z, point.z);
  bounds->max.x = std::max(bounds->max.x, point.x);
  bounds->max.y = std::max(bounds->max.y, point.y);
  bounds->max.z = std::max(bounds->max.z, point.z);
}

void expandBounds(Bounds* bounds, const Bounds& other) {
  expandBounds(bounds, other.min);
  expandBounds(bounds, other.max);
}

bool boundsValid(const Bounds& bounds) {
  return finiteVec(bounds.min) && finiteVec(bounds.max)
    && bounds.min.x <= bounds.max.x
    && bounds.min.y <= bounds.max.y
    && bounds.min.z <= bounds.max.z;
}

Vec3 boundsCenter(const Bounds& bounds) {
  return scale(add(bounds.min, bounds.max), 0.5);
}

Vec3 boundsExtents(const Bounds& bounds) {
  return scale(sub(bounds.max, bounds.min), 0.5);
}

SpatialCaptureBoundsSnapshot snapshotBounds(const Bounds& bounds) {
  return {toSnapshot(bounds.min), toSnapshot(bounds.max), toSnapshot(boundsCenter(bounds))};
}

Rgb shade(const Vec3& normal, const Rgb& albedo) {
  const Vec3 key{kKeyDirection[0], kKeyDirection[1], kKeyDirection[2]};
  const Vec3 fill{kFillDirection[0], kFillDirection[1], kFillDirection[2]};
  Vec3 keyDir{};
  Vec3 fillDir{};
  Vec3 unitNormal{};
  if (!normalize(key, &keyDir) || !normalize(fill, &fillDir) || !normalize(normal, &unitNormal)) {
    return {0.0, 0.0, 0.0};
  }
  const double keyTerm = kKeyIntensity * std::max(0.0, dot(unitNormal, keyDir));
  const double fillTerm = kFillIntensity * std::max(0.0, dot(unitNormal, fillDir));
  const double lit = (kAmbientIntensity + keyTerm + fillTerm) * kExposure;
  return {albedo.r * lit, albedo.g * lit, albedo.b * lit};
}

std::uint8_t toByte(double value) {
  if (!std::isfinite(value) || value <= 0.0) return 0;
  if (value >= 1.0) return 255;
  return static_cast<std::uint8_t>(value * 255.0 + 0.5);
}

void addTriangle(std::vector<Triangle>* triangles, const Vertex& a, const Vertex& b, const Vertex& c) {
  triangles->push_back({a, b, c});
}

bool appendBoxMesh(
  const SpatialCaptureItemBox& itemBox,
  std::vector<Triangle>* triangles,
  Bounds* bounds,
  std::string* errorMessage) {
  if (!std::isfinite(itemBox.width) || !std::isfinite(itemBox.height) || !std::isfinite(itemBox.depth)
      || itemBox.width <= 0.0 || itemBox.height <= 0.0 || itemBox.depth <= 0.0) {
    return fail(errorMessage, "Evaluated capture geometry is non-finite or degenerate.");
  }
  const Vec3 half{itemBox.width * 0.5, itemBox.height * 0.5, itemBox.depth * 0.5};
  const Vec3 localCorners[8] = {
    {-half.x, -half.y, -half.z}, { half.x, -half.y, -half.z},
    { half.x,  half.y, -half.z}, {-half.x,  half.y, -half.z},
    {-half.x, -half.y,  half.z}, { half.x, -half.y,  half.z},
    { half.x,  half.y,  half.z}, {-half.x,  half.y,  half.z},
  };
  Vec3 worldCorners[8];
  for (int index = 0; index < 8; ++index) {
    if (!transformPoint(itemBox.world, localCorners[index], &worldCorners[index])) {
      return fail(errorMessage, "Evaluated capture geometry is non-finite or degenerate.");
    }
    expandBounds(bounds, worldCorners[index]);
  }

  const int faces[6][4] = {
    {0, 1, 2, 3},
    {4, 7, 6, 5},
    {0, 4, 5, 1},
    {3, 2, 6, 7},
    {0, 3, 7, 4},
    {1, 5, 6, 2},
  };
  const Vec3 localNormals[6] = {
    {0.0, 0.0, -1.0}, {0.0, 0.0, 1.0},
    {0.0, -1.0, 0.0}, {0.0, 1.0, 0.0},
    {-1.0, 0.0, 0.0}, {1.0, 0.0, 0.0},
  };
  const Rgb albedo{0.20, 0.27, 0.34};
  for (int face = 0; face < 6; ++face) {
    Vec3 worldNormal{};
    if (!normalize(rotateByAxes(itemBox.world.axes, localNormals[face]), &worldNormal)) {
      return fail(errorMessage, "Evaluated capture geometry is non-finite or degenerate.");
    }
    const Vertex verts[4] = {
      {worldCorners[faces[face][0]], worldNormal, albedo},
      {worldCorners[faces[face][1]], worldNormal, albedo},
      {worldCorners[faces[face][2]], worldNormal, albedo},
      {worldCorners[faces[face][3]], worldNormal, albedo},
    };
    addTriangle(triangles, verts[0], verts[1], verts[2]);
    addTriangle(triangles, verts[0], verts[2], verts[3]);
  }
  return true;
}

bool appendPrism(
  const Vec3& from,
  const Vec3& to,
  std::vector<Triangle>* triangles,
  Bounds* bounds,
  std::string* errorMessage) {
  const Vec3 delta = sub(to, from);
  const double mag = length(delta);
  if (!std::isfinite(mag) || mag <= 1e-8) {
    return fail(errorMessage, "Evaluated capture geometry is non-finite or degenerate.");
  }
  Vec3 axis{};
  if (!normalize(delta, &axis)) {
    return fail(errorMessage, "Evaluated capture geometry is non-finite or degenerate.");
  }
  const Vec3 helper = std::abs(axis.y) < 0.9 ? Vec3{0.0, 1.0, 0.0} : Vec3{1.0, 0.0, 0.0};
  Vec3 side{};
  if (!normalize(cross(axis, helper), &side)) {
    return fail(errorMessage, "Evaluated capture geometry is non-finite or degenerate.");
  }
  const Vec3 lift = cross(side, axis);
  if (!finiteVec(lift) || length(lift) <= 0.0) {
    return fail(errorMessage, "Evaluated capture geometry is non-finite or degenerate.");
  }
  const Rgb albedo{0.73, 0.61, 0.50};
  std::array<Vec3, kPrismSides> ringA{};
  std::array<Vec3, kPrismSides> ringB{};
  std::array<Vec3, kPrismSides> radial{};
  for (int index = 0; index < kPrismSides; ++index) {
    const double angle = (2.0 * kPi * static_cast<double>(index)) / static_cast<double>(kPrismSides);
    radial[index] = add(scale(side, std::cos(angle)), scale(lift, std::sin(angle)));
    if (!normalize(radial[index], &radial[index])) {
      return fail(errorMessage, "Evaluated capture geometry is non-finite or degenerate.");
    }
    ringA[index] = add(from, scale(radial[index], kPrismRadiusMeters));
    ringB[index] = add(to, scale(radial[index], kPrismRadiusMeters));
    if (!finiteVec(ringA[index]) || !finiteVec(ringB[index])) {
      return fail(errorMessage, "Evaluated capture geometry is non-finite or degenerate.");
    }
    expandBounds(bounds, ringA[index]);
    expandBounds(bounds, ringB[index]);
  }

  const Vec3 outwardA = scale(axis, -1.0);
  const Vec3 outwardB = axis;
  for (int index = 0; index < kPrismSides; ++index) {
    const int next = (index + 1) % kPrismSides;
    const Vertex a0{ringA[index], radial[index], albedo};
    const Vertex a1{ringA[next], radial[next], albedo};
    const Vertex b0{ringB[index], radial[index], albedo};
    const Vertex b1{ringB[next], radial[next], albedo};
    addTriangle(triangles, a0, a1, b1);
    addTriangle(triangles, a0, b1, b0);
    addTriangle(
      triangles,
      {from, outwardA, albedo},
      {ringA[next], outwardA, albedo},
      {ringA[index], outwardA, albedo});
    addTriangle(
      triangles,
      {to, outwardB, albedo},
      {ringB[index], outwardB, albedo},
      {ringB[next], outwardB, albedo});
  }
  return true;
}

bool buildCaptureMeshes(
  const SpatialAttachmentEvaluationSnapshot& evaluation,
  const SpatialCaptureItemBox& itemBox,
  std::vector<Triangle>* triangles,
  Bounds* characterBounds,
  Bounds* itemBounds,
  std::string* errorMessage) {
  *triangles = {};
  *characterBounds = {};
  *itemBounds = {};
  if (evaluation.segments.empty()) {
    return fail(errorMessage, "Evaluated capture geometry is non-finite or degenerate.");
  }
  for (const auto& segment : evaluation.segments) {
    if (!appendPrism(fromSnapshot(segment.from), fromSnapshot(segment.to), triangles, characterBounds, errorMessage)) {
      return false;
    }
  }
  if (!boundsValid(*characterBounds)) {
    return fail(errorMessage, "Evaluated capture geometry is non-finite or degenerate.");
  }
  const std::size_t characterTriangleCount = triangles->size();
  if (!appendBoxMesh(itemBox, triangles, itemBounds, errorMessage)) return false;
  if (!boundsValid(*itemBounds) || triangles->size() <= characterTriangleCount) {
    return fail(errorMessage, "Evaluated capture geometry is non-finite or degenerate.");
  }
  return true;
}

Mat4 lookAt(const Vec3& position, const Vec3& target, const Vec3& up, bool* ok) {
  Vec3 forward{};
  Vec3 right{};
  Vec3 trueUp{};
  *ok = normalize(sub(target, position), &forward)
    && normalize(cross(forward, up), &right);
  if (*ok) {
    trueUp = cross(right, forward);
    *ok = finiteVec(trueUp) && length(trueUp) > 0.0;
  }
  Mat4 view{};
  if (!*ok) return view;
  view.m[0] = right.x;
  view.m[1] = right.y;
  view.m[2] = right.z;
  view.m[3] = -dot(right, position);
  view.m[4] = trueUp.x;
  view.m[5] = trueUp.y;
  view.m[6] = trueUp.z;
  view.m[7] = -dot(trueUp, position);
  view.m[8] = -forward.x;
  view.m[9] = -forward.y;
  view.m[10] = -forward.z;
  view.m[11] = dot(forward, position);
  view.m[15] = 1.0;
  return view;
}

Mat4 perspective(double fovDegrees, double aspect, double nearMeters, double farMeters, bool* ok) {
  Mat4 proj{};
  *ok = std::isfinite(fovDegrees) && std::isfinite(aspect) && std::isfinite(nearMeters) && std::isfinite(farMeters)
    && fovDegrees > 0.0 && aspect > 0.0 && nearMeters > 0.0 && farMeters > nearMeters;
  if (!*ok) return proj;
  const double f = 1.0 / std::tan((fovDegrees * kPi / 180.0) * 0.5);
  if (!std::isfinite(f) || f <= 0.0) {
    *ok = false;
    return proj;
  }
  proj.m[0] = f / aspect;
  proj.m[5] = f;
  proj.m[10] = (farMeters + nearMeters) / (nearMeters - farMeters);
  proj.m[11] = (2.0 * farMeters * nearMeters) / (nearMeters - farMeters);
  proj.m[14] = -1.0;
  return proj;
}

Vec4 mul(const Mat4& matrix, const Vec4& value) {
  return {
    matrix.m[0] * value.x + matrix.m[1] * value.y + matrix.m[2] * value.z + matrix.m[3] * value.w,
    matrix.m[4] * value.x + matrix.m[5] * value.y + matrix.m[6] * value.z + matrix.m[7] * value.w,
    matrix.m[8] * value.x + matrix.m[9] * value.y + matrix.m[10] * value.z + matrix.m[11] * value.w,
    matrix.m[12] * value.x + matrix.m[13] * value.y + matrix.m[14] * value.z + matrix.m[15] * value.w,
  };
}

Mat4 mul(const Mat4& a, const Mat4& b) {
  Mat4 result{};
  for (int row = 0; row < 4; ++row) {
    for (int col = 0; col < 4; ++col) {
      double sum = 0.0;
      for (int k = 0; k < 4; ++k) sum += a.m[row * 4 + k] * b.m[k * 4 + col];
      result.m[row * 4 + col] = sum;
    }
  }
  return result;
}

bool composeCamera(CameraState* camera) {
  bool ok = false;
  const double aspect = static_cast<double>(camera->widthPx) / static_cast<double>(camera->heightPx);
  const Mat4 view = lookAt(camera->position, camera->target, camera->up, &ok);
  if (!ok) return false;
  const Mat4 proj = perspective(camera->fovDegrees, aspect, camera->nearMeters, camera->farMeters, &ok);
  if (!ok) return false;
  camera->viewProj = mul(proj, view);
  return true;
}

struct ProjectedPoint {
  double x = 0.0;
  double y = 0.0;
  double depth = 0.0;
  double invW = 0.0;
};

bool projectPoint(const CameraState& camera, const Vec3& world, ProjectedPoint* out) {
  const Vec4 clip = mul(camera.viewProj, Vec4{world.x, world.y, world.z, 1.0});
  if (!std::isfinite(clip.x) || !std::isfinite(clip.y) || !std::isfinite(clip.z) || !std::isfinite(clip.w)) {
    return false;
  }
  if (!(clip.w > 0.0)) return false;
  const double invW = 1.0 / clip.w;
  const double ndcX = clip.x * invW;
  const double ndcY = clip.y * invW;
  const double ndcZ = clip.z * invW;
  if (!std::isfinite(ndcX) || !std::isfinite(ndcY) || !std::isfinite(ndcZ)) return false;
  if (ndcZ < -1.0 || ndcZ > 1.0) return false;
  out->x = (ndcX + 1.0) * 0.5 * static_cast<double>(camera.widthPx);
  out->y = (1.0 - ndcY) * 0.5 * static_cast<double>(camera.heightPx);
  out->depth = static_cast<double>((ndcZ + 1.0) * 0.5);
  out->invW = invW;
  return std::isfinite(out->x) && std::isfinite(out->y) && std::isfinite(out->depth) && out->depth >= 0.0 && out->depth <= 1.0;
}

bool projectBounds(
  const CameraState& camera,
  const Bounds& bounds,
  double* minX,
  double* maxX,
  double* minY,
  double* maxY) {
  const Vec3 corners[8] = {
    {bounds.min.x, bounds.min.y, bounds.min.z}, {bounds.max.x, bounds.min.y, bounds.min.z},
    {bounds.max.x, bounds.max.y, bounds.min.z}, {bounds.min.x, bounds.max.y, bounds.min.z},
    {bounds.min.x, bounds.min.y, bounds.max.z}, {bounds.max.x, bounds.min.y, bounds.max.z},
    {bounds.max.x, bounds.max.y, bounds.max.z}, {bounds.min.x, bounds.max.y, bounds.max.z},
  };
  *minX = std::numeric_limits<double>::infinity();
  *maxX = -std::numeric_limits<double>::infinity();
  *minY = std::numeric_limits<double>::infinity();
  *maxY = -std::numeric_limits<double>::infinity();
  for (const Vec3& corner : corners) {
    ProjectedPoint projected{};
    if (!projectPoint(camera, corner, &projected)) return false;
    *minX = std::min(*minX, projected.x);
    *maxX = std::max(*maxX, projected.x);
    *minY = std::min(*minY, projected.y);
    *maxY = std::max(*maxY, projected.y);
  }
  return std::isfinite(*minX) && std::isfinite(*maxX) && std::isfinite(*minY) && std::isfinite(*maxY)
    && *maxX >= *minX && *maxY >= *minY;
}

double coverageOf(const CameraState& camera, double minX, double maxX, double minY, double maxY) {
  const double shorter = static_cast<double>(std::min(camera.widthPx, camera.heightPx));
  const double span = std::max(maxX - minX, maxY - minY);
  if (!(shorter > 0.0) || !std::isfinite(span) || span < 0.0) return 0.0;
  return span / shorter;
}

bool insideFrame(const CameraState& camera, double minX, double maxX, double minY, double maxY) {
  return minX >= 0.0 && minY >= 0.0
    && maxX <= static_cast<double>(camera.widthPx)
    && maxY <= static_cast<double>(camera.heightPx);
}

bool placeCamera(
  CameraState* camera,
  const Vec3& direction,
  const Vec3& up,
  const Bounds& combined,
  std::string* errorMessage) {
  Vec3 unitDirection{};
  Vec3 unitUp{};
  if (!normalize(direction, &unitDirection) || !normalize(up, &unitUp)) {
    return fail(errorMessage, "Capture camera '" + camera->id + "' is degenerate.");
  }
  const Vec3 target = boundsCenter(combined);
  const Vec3 extents = boundsExtents(combined);
  const double support = std::abs(unitDirection.x) * extents.x
    + std::abs(unitDirection.y) * extents.y
    + std::abs(unitDirection.z) * extents.z;
  const double diagonal = length(sub(combined.max, combined.min));
  if (!std::isfinite(support) || !std::isfinite(diagonal) || diagonal <= 0.0) {
    return fail(errorMessage, "Evaluated capture geometry is non-finite or degenerate.");
  }

  const auto evaluateDistance = [&](double distance, CameraState* candidate, double* coverage, bool* framed) {
    *framed = false;
    *coverage = 0.0;
    candidate->id = camera->id;
    candidate->target = target;
    candidate->up = unitUp;
    candidate->fovDegrees = kFovDegrees;
    candidate->widthPx = camera->widthPx;
    candidate->heightPx = camera->heightPx;
    candidate->position = add(target, scale(unitDirection, distance));
    candidate->nearMeters = std::max(0.01, (distance - support) * 0.35);
    candidate->farMeters = distance + diagonal * 2.0;
    if (!(candidate->farMeters > candidate->nearMeters) || !composeCamera(candidate)) return false;
    double minX = 0.0;
    double maxX = 0.0;
    double minY = 0.0;
    double maxY = 0.0;
    if (!projectBounds(*candidate, combined, &minX, &maxX, &minY, &maxY)) return false;
    *coverage = coverageOf(*candidate, minX, maxX, minY, maxY);
    *framed = insideFrame(*candidate, minX, maxX, minY, maxY)
      && *coverage >= kMinCoverage
      && *coverage <= kMaxCoverage;
    return std::isfinite(*coverage);
  };

  double lo = support + std::max(0.05, diagonal * 0.05);
  double hi = std::max(lo * 4.0, diagonal * 8.0);
  CameraState sample{};
  double coverage = 0.0;
  bool framed = false;
  for (int expand = 0; expand < 24; ++expand) {
    if (!evaluateDistance(hi, &sample, &coverage, &framed)) {
      hi *= 1.5;
      continue;
    }
    if (coverage <= kTargetCoverage) break;
    hi *= 2.0;
    if (hi > 1.0e6) break;
  }

  CameraState best{};
  bool haveBest = false;
  double bestError = std::numeric_limits<double>::infinity();
  for (int iteration = 0; iteration < 48; ++iteration) {
    const double mid = (lo + hi) * 0.5;
    if (!evaluateDistance(mid, &sample, &coverage, &framed)) {
      lo = mid;
      continue;
    }
    const double error = std::abs(coverage - kTargetCoverage);
    if (framed && error < bestError) {
      best = sample;
      bestError = error;
      haveBest = true;
    }
    if (coverage > kTargetCoverage) lo = mid;
    else hi = mid;
  }

  if (!haveBest) {
    const double candidates[6] = {lo, hi, (lo + hi) * 0.5, support + diagonal, diagonal * 3.0, diagonal * 6.0};
    for (double distance : candidates) {
      if (distance <= support) continue;
      if (evaluateDistance(distance, &sample, &coverage, &framed) && framed) {
        best = sample;
        haveBest = true;
        break;
      }
    }
  }
  if (!haveBest) {
    return fail(
      errorMessage,
      "Capture camera '" + camera->id
        + "' cannot keep combined character/item bounds within 50%-75% of the shorter frame.");
  }
  *camera = best;
  return true;
}

double edge(const ProjectedPoint& a, const ProjectedPoint& b, double x, double y) {
  return (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
}

bool rasterize(
  const CameraState& camera,
  const std::vector<Triangle>& triangles,
  ImageBuffer* image,
  std::string* errorMessage) {
  image->width = camera.widthPx;
  image->height = camera.heightPx;
  image->rgb.assign(static_cast<std::size_t>(camera.widthPx) * static_cast<std::size_t>(camera.heightPx) * 3, 0);
  image->depth.assign(static_cast<std::size_t>(camera.widthPx) * static_cast<std::size_t>(camera.heightPx), 1.0f);
  const std::uint8_t bgR = toByte(kBackgroundR);
  const std::uint8_t bgG = toByte(kBackgroundG);
  const std::uint8_t bgB = toByte(kBackgroundB);
  for (std::size_t index = 0; index < image->rgb.size(); index += 3) {
    image->rgb[index] = bgR;
    image->rgb[index + 1] = bgG;
    image->rgb[index + 2] = bgB;
  }

  std::size_t renderedPixelCount = 0;
  for (const Triangle& triangle : triangles) {
    ProjectedPoint p0{};
    ProjectedPoint p1{};
    ProjectedPoint p2{};
    if (!projectPoint(camera, triangle.v0.position, &p0)
        || !projectPoint(camera, triangle.v1.position, &p1)
        || !projectPoint(camera, triangle.v2.position, &p2)) {
      continue;
    }
    const double area = edge(p0, p1, p2.x, p2.y);
    if (!std::isfinite(area) || std::abs(area) <= 1e-12) continue;
    const int minX = std::max(0, static_cast<int>(std::floor(std::min({p0.x, p1.x, p2.x}))));
    const int maxX = std::min(camera.widthPx - 1, static_cast<int>(std::floor(std::max({p0.x, p1.x, p2.x}))));
    const int minY = std::max(0, static_cast<int>(std::floor(std::min({p0.y, p1.y, p2.y}))));
    const int maxY = std::min(camera.heightPx - 1, static_cast<int>(std::floor(std::max({p0.y, p1.y, p2.y}))));
    if (minX > maxX || minY > maxY) continue;
    for (int y = minY; y <= maxY; ++y) {
      for (int x = minX; x <= maxX; ++x) {
        const double px = static_cast<double>(x) + 0.5;
        const double py = static_cast<double>(y) + 0.5;
        const double w0 = edge(p1, p2, px, py) / area;
        const double w1 = edge(p2, p0, px, py) / area;
        const double w2 = edge(p0, p1, px, py) / area;
        if (w0 < 0.0 || w1 < 0.0 || w2 < 0.0) continue;
        const double depth = w0 * p0.depth + w1 * p1.depth + w2 * p2.depth;
        if (!std::isfinite(depth) || depth < 0.0 || depth > 1.0) {
          return fail(errorMessage, "Evaluated capture geometry is non-finite or degenerate.");
        }
        const std::size_t pixel = static_cast<std::size_t>(y) * static_cast<std::size_t>(camera.widthPx)
          + static_cast<std::size_t>(x);
        if (static_cast<float>(depth) >= image->depth[pixel]) continue;
        const Vec3 normal{
          w0 * triangle.v0.normal.x + w1 * triangle.v1.normal.x + w2 * triangle.v2.normal.x,
          w0 * triangle.v0.normal.y + w1 * triangle.v1.normal.y + w2 * triangle.v2.normal.y,
          w0 * triangle.v0.normal.z + w1 * triangle.v1.normal.z + w2 * triangle.v2.normal.z,
        };
        const Rgb albedo{
          w0 * triangle.v0.albedo.r + w1 * triangle.v1.albedo.r + w2 * triangle.v2.albedo.r,
          w0 * triangle.v0.albedo.g + w1 * triangle.v1.albedo.g + w2 * triangle.v2.albedo.g,
          w0 * triangle.v0.albedo.b + w1 * triangle.v1.albedo.b + w2 * triangle.v2.albedo.b,
        };
        const Rgb color = shade(normal, albedo);
        if (!std::isfinite(color.r) || !std::isfinite(color.g) || !std::isfinite(color.b)) {
          return fail(errorMessage, "Evaluated capture geometry is non-finite or degenerate.");
        }
        image->depth[pixel] = static_cast<float>(depth);
        image->rgb[pixel * 3] = toByte(color.r);
        image->rgb[pixel * 3 + 1] = toByte(color.g);
        image->rgb[pixel * 3 + 2] = toByte(color.b);
        renderedPixelCount += 1;
      }
    }
  }
  return renderedPixelCount > 0
    ? true
    : fail(errorMessage, "Capture camera rendered no character or item pixels.");
}

std::uint32_t crc32(const std::uint8_t* data, std::size_t size) {
  static std::uint32_t table[256];
  static bool ready = false;
  if (!ready) {
    for (std::uint32_t index = 0; index < 256; ++index) {
      std::uint32_t value = index;
      for (int bit = 0; bit < 8; ++bit) {
        value = (value & 1U) ? (0xEDB88320U ^ (value >> 1U)) : (value >> 1U);
      }
      table[index] = value;
    }
    ready = true;
  }
  std::uint32_t crc = 0xFFFFFFFFU;
  for (std::size_t index = 0; index < size; ++index) {
    crc = table[(crc ^ data[index]) & 0xFFU] ^ (crc >> 8U);
  }
  return crc ^ 0xFFFFFFFFU;
}

std::uint32_t adler32(const std::uint8_t* data, std::size_t size) {
  std::uint32_t s1 = 1;
  std::uint32_t s2 = 0;
  for (std::size_t index = 0; index < size; ++index) {
    s1 = (s1 + data[index]) % 65521U;
    s2 = (s2 + s1) % 65521U;
  }
  return (s2 << 16U) | s1;
}

void appendU16(std::vector<std::uint8_t>* out, std::uint16_t value) {
  out->push_back(static_cast<std::uint8_t>(value & 0xFFU));
  out->push_back(static_cast<std::uint8_t>((value >> 8U) & 0xFFU));
}

void appendU32(std::vector<std::uint8_t>* out, std::uint32_t value) {
  out->push_back(static_cast<std::uint8_t>((value >> 24U) & 0xFFU));
  out->push_back(static_cast<std::uint8_t>((value >> 16U) & 0xFFU));
  out->push_back(static_cast<std::uint8_t>((value >> 8U) & 0xFFU));
  out->push_back(static_cast<std::uint8_t>(value & 0xFFU));
}

void appendChunk(
  std::vector<std::uint8_t>* png,
  std::string_view type,
  const std::uint8_t* data,
  std::size_t size) {
  appendU32(png, static_cast<std::uint32_t>(size));
  const std::size_t typeOffset = png->size();
  png->insert(png->end(), type.begin(), type.end());
  if (size != 0) png->insert(png->end(), data, data + size);
  const std::uint32_t crc = crc32(png->data() + typeOffset, type.size() + size);
  appendU32(png, crc);
}

std::vector<std::uint8_t> encodePng(int width, int height, const std::vector<std::uint8_t>& rgb) {
  std::vector<std::uint8_t> raw;
  raw.reserve(static_cast<std::size_t>(height) * (1 + static_cast<std::size_t>(width) * 3));
  for (int y = 0; y < height; ++y) {
    raw.push_back(0);
    const std::size_t row = static_cast<std::size_t>(y) * static_cast<std::size_t>(width) * 3;
    raw.insert(raw.end(), rgb.begin() + static_cast<std::ptrdiff_t>(row), rgb.begin() + static_cast<std::ptrdiff_t>(row + static_cast<std::size_t>(width) * 3));
  }

  std::vector<std::uint8_t> zlibBytes;
  zlibBytes.push_back(0x78);
  zlibBytes.push_back(0x01);
  std::size_t remaining = raw.size();
  std::size_t offset = 0;
  while (remaining > 0) {
    const std::uint16_t chunk = static_cast<std::uint16_t>(std::min<std::size_t>(remaining, 65535));
    const bool last = chunk == remaining;
    zlibBytes.push_back(last ? 0x01 : 0x00);
    appendU16(&zlibBytes, chunk);
    appendU16(&zlibBytes, static_cast<std::uint16_t>(chunk ^ 0xFFFFU));
    zlibBytes.insert(zlibBytes.end(), raw.begin() + static_cast<std::ptrdiff_t>(offset), raw.begin() + static_cast<std::ptrdiff_t>(offset + chunk));
    offset += chunk;
    remaining -= chunk;
  }
  appendU32(&zlibBytes, adler32(raw.data(), raw.size()));

  std::vector<std::uint8_t> png{
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
  };
  std::uint8_t ihdr[13]{};
  ihdr[0] = static_cast<std::uint8_t>((width >> 24) & 0xFF);
  ihdr[1] = static_cast<std::uint8_t>((width >> 16) & 0xFF);
  ihdr[2] = static_cast<std::uint8_t>((width >> 8) & 0xFF);
  ihdr[3] = static_cast<std::uint8_t>(width & 0xFF);
  ihdr[4] = static_cast<std::uint8_t>((height >> 24) & 0xFF);
  ihdr[5] = static_cast<std::uint8_t>((height >> 16) & 0xFF);
  ihdr[6] = static_cast<std::uint8_t>((height >> 8) & 0xFF);
  ihdr[7] = static_cast<std::uint8_t>(height & 0xFF);
  ihdr[8] = 8;
  ihdr[9] = 2;
  appendChunk(&png, "IHDR", ihdr, sizeof(ihdr));
  appendChunk(&png, "IDAT", zlibBytes.data(), zlibBytes.size());
  appendChunk(&png, "IEND", nullptr, 0);
  return png;
}

bool pathStaysUnder(const std::filesystem::path& child, const std::filesystem::path& parent) {
  const std::filesystem::path relative = child.lexically_normal().lexically_relative(parent.lexically_normal());
  if (relative.empty() || relative.is_absolute()) return false;
  for (const auto& part : relative) {
    if (part == "..") return false;
  }
  return true;
}

bool writePngFile(const std::filesystem::path& path, const std::vector<std::uint8_t>& bytes, std::string* errorMessage) {
  std::ofstream stream(path, std::ios::binary | std::ios::trunc);
  if (!stream.is_open()) {
    return fail(errorMessage, "Could not open capture PNG for writing.");
  }
  stream.write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
  stream.close();
  if (!stream) {
    return fail(errorMessage, "Could not finish writing capture PNG.");
  }
  return true;
}

}  // namespace

bool writeSpatialCaptureSample(
  const SpatialSampledAttachmentEvaluationSnapshot& sampled,
  const SpatialCaptureItemBox& itemBox,
  const std::optional<SpatialCaptureCameraSnapshot>& playerCamera,
  const std::filesystem::path& outputDir,
  int widthPx,
  int heightPx,
  SpatialCaptureResultSnapshot* result,
  std::string* errorMessage) {
  if (result == nullptr) {
    return fail(errorMessage, "Capture result is required.");
  }
  *result = {};
  if (widthPx < kSpatialCaptureMinResolutionPx || widthPx > kSpatialCaptureMaxResolutionPx
      || heightPx < kSpatialCaptureMinResolutionPx || heightPx > kSpatialCaptureMaxResolutionPx) {
    return fail(errorMessage, "Capture resolution is outside the allowed range [64, 1024].");
  }

  std::error_code fsError;
  const std::filesystem::path absoluteOutput = std::filesystem::absolute(outputDir, fsError);
  if (fsError) {
    return fail(errorMessage, "Capture output path is unsafe.");
  }
  const std::filesystem::path normalizedOutput = std::filesystem::weakly_canonical(absoluteOutput, fsError);
  if (fsError) {
    return fail(errorMessage, "Capture output path is unsafe.");
  }
  if (normalizedOutput == normalizedOutput.root_path()
      || normalizedOutput.filename().empty()
      || normalizedOutput.filename() == "."
      || normalizedOutput.filename() == "..") {
    return fail(errorMessage, "Capture output path is unsafe.");
  }
  if (std::filesystem::exists(normalizedOutput, fsError) || fsError) {
    return fail(errorMessage, "Capture output directory must not already exist.");
  }
  const std::filesystem::path outputParent = normalizedOutput.parent_path();
  if (outputParent.empty()
      || !std::filesystem::exists(outputParent, fsError)
      || fsError
      || !std::filesystem::is_directory(outputParent, fsError)
      || fsError) {
    return fail(errorMessage, "Capture output parent must be an existing directory.");
  }

  std::vector<Triangle> triangles;
  Bounds characterBounds;
  Bounds itemBounds;
  if (!buildCaptureMeshes(sampled.evaluation, itemBox, &triangles, &characterBounds, &itemBounds, errorMessage)) {
    return false;
  }
  Bounds combined = characterBounds;
  expandBounds(&combined, itemBounds);
  if (!boundsValid(combined) || length(sub(combined.max, combined.min)) <= 0.0) {
    return fail(errorMessage, "Evaluated capture geometry is non-finite or degenerate.");
  }

  struct Preset {
    const char* id;
    Vec3 direction;
    Vec3 up;
  };
  const Preset presets[4] = {
    {"close_front", {0.0, 0.0, 1.0}, {0.0, 1.0, 0.0}},
    {"close_side", {1.0, 0.0, 0.0}, {0.0, 1.0, 0.0}},
    {"close_top", {0.0, 1.0, 0.0}, {0.0, 0.0, -1.0}},
    {"close_three_quarter", {1.0, 0.45, 1.0}, {0.0, 1.0, 0.0}},
  };

  std::vector<CameraState> cameras(4);
  std::vector<ImageBuffer> images(4);
  for (int index = 0; index < 4; ++index) {
    cameras[index].id = presets[index].id;
    cameras[index].widthPx = widthPx;
    cameras[index].heightPx = heightPx;
    if (!placeCamera(&cameras[index], presets[index].direction, presets[index].up, combined, errorMessage)) {
      return false;
    }
    if (!rasterize(cameras[index], triangles, &images[index], errorMessage)) {
      return false;
    }
  }

  if (playerCamera) {
    CameraState camera;
    camera.id = "player_camera";
    camera.position = fromSnapshot(playerCamera->position);
    camera.target = fromSnapshot(playerCamera->target);
    camera.up = fromSnapshot(playerCamera->up);
    camera.fovDegrees = playerCamera->fovDegrees;
    camera.nearMeters = playerCamera->nearMeters;
    camera.farMeters = playerCamera->farMeters;
    camera.widthPx = widthPx;
    camera.heightPx = heightPx;
    if (!finiteVec(camera.position) || !finiteVec(camera.target) || !finiteVec(camera.up)
        || !composeCamera(&camera)) {
      return fail(errorMessage, "Authored player camera is invalid.");
    }
    ImageBuffer image;
    if (!rasterize(camera, triangles, &image, errorMessage)) return false;
    cameras.push_back(std::move(camera));
    images.push_back(std::move(image));
  }

  std::vector<std::vector<std::uint8_t>> encodedFrames(cameras.size());
  for (std::size_t index = 0; index < cameras.size(); ++index) {
    encodedFrames[index] = encodePng(widthPx, heightPx, images[index].rgb);
  }

  if (!std::filesystem::create_directory(normalizedOutput, fsError) || fsError) {
    return fail(errorMessage, "Capture output path is unsafe.");
  }
  const std::filesystem::path finalOutput = std::filesystem::weakly_canonical(normalizedOutput, fsError);
  if (fsError || finalOutput != normalizedOutput) {
    std::error_code cleanupError;
    std::filesystem::remove_all(normalizedOutput, cleanupError);
    return fail(errorMessage, "Capture output path is unsafe.");
  }

  const auto cleanupOutput = [&]() {
    std::error_code cleanupError;
    std::filesystem::remove_all(finalOutput, cleanupError);
  };

  for (std::size_t index = 0; index < cameras.size(); ++index) {
    const std::string fileName = cameras[index].id + ".png";
    const std::filesystem::path pngPath = finalOutput / fileName;
    if (!pathStaysUnder(pngPath, finalOutput) || pngPath.filename().string() != fileName) {
      cleanupOutput();
      return fail(errorMessage, "Capture output path is unsafe.");
    }
    if (!writePngFile(pngPath, encodedFrames[index], errorMessage)) {
      cleanupOutput();
      return false;
    }
  }

  result->attachmentId = sampled.evaluation.attachmentId;
  result->phase = sampled.phase;
  result->normalizedTime = sampled.normalizedTime;
  result->renderGeometryKinds = {"authored_procgeo_box", "posed_bone_prisms"};
  result->characterBounds = snapshotBounds(characterBounds);
  result->itemBounds = snapshotBounds(itemBounds);
  result->combinedBounds = snapshotBounds(combined);
  Vec3 keyDirection{};
  Vec3 fillDirection{};
  if (!normalize({kKeyDirection[0], kKeyDirection[1], kKeyDirection[2]}, &keyDirection)
      || !normalize({kFillDirection[0], kFillDirection[1], kFillDirection[2]}, &fillDirection)) {
    cleanupOutput();
    return fail(errorMessage, "Capture lighting is invalid.");
  }
  result->lighting.keyDirection = toSnapshot(keyDirection);
  result->lighting.keyIntensity = kKeyIntensity;
  result->lighting.fillDirection = toSnapshot(fillDirection);
  result->lighting.fillIntensity = kFillIntensity;
  result->lighting.ambientIntensity = kAmbientIntensity;
  result->lighting.exposure = kExposure;
  result->frames.clear();
  result->frames.reserve(cameras.size());
  for (std::size_t index = 0; index < cameras.size(); ++index) {
    SpatialCaptureFrameSnapshot frame;
    frame.camera.id = cameras[index].id;
    frame.camera.position = toSnapshot(cameras[index].position);
    frame.camera.target = toSnapshot(cameras[index].target);
    frame.camera.up = toSnapshot(cameras[index].up);
    frame.camera.fovDegrees = cameras[index].fovDegrees;
    frame.camera.nearMeters = cameras[index].nearMeters == 0.0 ? 0.0 : cameras[index].nearMeters;
    frame.camera.farMeters = cameras[index].farMeters == 0.0 ? 0.0 : cameras[index].farMeters;
    frame.camera.widthPx = cameras[index].widthPx;
    frame.camera.heightPx = cameras[index].heightPx;
    frame.relativePath = cameras[index].id + ".png";
    result->frames.push_back(std::move(frame));
  }
  return true;
}

}  // namespace shader_forge::runtime
