#pragma once

#include <array>
#include <filesystem>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace shader_forge::runtime {

struct PhysicsConfig {
  std::filesystem::path rootPath = "physics";
};

struct PhysicsLayerSnapshot {
  std::string name;
  std::string displayName;
  std::vector<std::string> collidesWith;
  bool queryable = false;
  bool staticOnly = false;
  std::filesystem::path sourcePath;
  bool valid = false;
};

struct PhysicsMaterialSnapshot {
  std::string name;
  double friction = 0.0;
  double restitution = 0.0;
  double density = 0.0;
  std::filesystem::path sourcePath;
  bool valid = false;
};

struct PhysicsBodySnapshot {
  std::string name;
  std::string sceneName;
  std::string sourcePrefab;
  std::string layer;
  std::string material;
  std::string motionType;
  std::string shapeType;
  std::array<double, 3> position = {0.0, 0.0, 0.0};
  std::array<double, 3> halfExtents = {0.0, 0.0, 0.0};
  double radius = 0.0;
  std::filesystem::path sourcePath;
  bool valid = false;
};

struct PhysicsRaycastHitSnapshot {
  std::string bodyName;
  std::string layerName;
  std::string materialName;
  std::string shapeType;
  double distance = 0.0;
  std::array<double, 3> point = {0.0, 0.0, 0.0};
};

struct PhysicsOverlapSnapshot {
  std::string bodyName;
  std::string layerName;
  std::string shapeType;
};

class PhysicsSystem {
public:
  PhysicsSystem();
  ~PhysicsSystem();

  PhysicsSystem(PhysicsSystem&&) noexcept;
  PhysicsSystem& operator=(PhysicsSystem&&) noexcept;

  PhysicsSystem(const PhysicsSystem&) = delete;
  PhysicsSystem& operator=(const PhysicsSystem&) = delete;

  bool loadFromDisk(const PhysicsConfig& config, std::string* errorMessage = nullptr);

  std::size_t layerCount() const;
  std::size_t materialCount() const;
  std::size_t bodyCount() const;

  bool hasBody(std::string_view bodyName) const;
  std::vector<PhysicsLayerSnapshot> snapshotLayers() const;
  std::vector<PhysicsMaterialSnapshot> snapshotMaterials() const;
  std::vector<PhysicsBodySnapshot> snapshotBodies() const;
  std::vector<PhysicsBodySnapshot> bodiesForScene(std::string_view sceneName) const;
  std::optional<PhysicsRaycastHitSnapshot> raycastScene(
    std::string_view sceneName,
    const std::array<double, 3>& origin,
    const std::array<double, 3>& direction,
    double maxDistance) const;
  std::vector<PhysicsOverlapSnapshot> overlapSphereScene(
    std::string_view sceneName,
    const std::array<double, 3>& center,
    double radius) const;

  std::string foundationSummary() const;
  std::string layerMatrixSummary() const;
  std::string sceneBodySummary(std::string_view sceneName) const;

private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace shader_forge::runtime
