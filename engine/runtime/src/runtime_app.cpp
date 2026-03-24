#include "shader_forge/runtime/animation_system.hpp"
#include "shader_forge/runtime/audio_system.hpp"
#include "shader_forge/runtime/data_foundation.hpp"
#include "shader_forge/runtime/input_system.hpp"
#include "shader_forge/runtime/physics_system.hpp"
#include "shader_forge/runtime/runtime_app.hpp"
#include "shader_forge/runtime/tooling_ui.hpp"

#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <exception>
#include <filesystem>
#include <iostream>
#include <limits>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <system_error>
#include <thread>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

#if defined(SHADER_FORGE_HAS_SDL3) && SHADER_FORGE_HAS_SDL3 && defined(SHADER_FORGE_HAS_VULKAN) && SHADER_FORGE_HAS_VULKAN && __has_include(<SDL3/SDL.h>) && __has_include(<SDL3/SDL_vulkan.h>) && __has_include(<vulkan/vulkan.h>)
#define SHADER_FORGE_NATIVE_RUNTIME 1
#include <SDL3/SDL.h>
#include <SDL3/SDL_vulkan.h>
#include <vulkan/vulkan.h>
#else
#define SHADER_FORGE_NATIVE_RUNTIME 0
#endif

namespace shader_forge::runtime {

namespace {

void logLine(const std::string& message) {
  std::cout << "[shader-forge-runtime] " << message << '\n';
}

void logMultiline(const std::string& message) {
  std::istringstream lines(message);
  std::string line;
  while (std::getline(lines, line)) {
    if (!line.empty()) {
      logLine(line);
    }
  }
}

std::string runtimeVector3String(const std::array<float, 3>& value) {
  std::ostringstream stream;
  stream << value[0] << ", " << value[1] << ", " << value[2];
  return stream.str();
}

#if SHADER_FORGE_NATIVE_RUNTIME

constexpr const char* kValidationLayerName = "VK_LAYER_KHRONOS_validation";
constexpr std::uint32_t kMaxFramesInFlight = 2;
constexpr std::uint64_t kAuthoredContentPollIntervalNs = 750'000'000ULL;

std::string sdlErrorString() {
  const char* error = SDL_GetError();
  return error && *error ? error : "unknown SDL error";
}

std::string vkResultString(VkResult result) {
  switch (result) {
    case VK_SUCCESS:
      return "VK_SUCCESS";
    case VK_NOT_READY:
      return "VK_NOT_READY";
    case VK_TIMEOUT:
      return "VK_TIMEOUT";
    case VK_EVENT_SET:
      return "VK_EVENT_SET";
    case VK_EVENT_RESET:
      return "VK_EVENT_RESET";
    case VK_INCOMPLETE:
      return "VK_INCOMPLETE";
    case VK_SUBOPTIMAL_KHR:
      return "VK_SUBOPTIMAL_KHR";
    case VK_ERROR_OUT_OF_HOST_MEMORY:
      return "VK_ERROR_OUT_OF_HOST_MEMORY";
    case VK_ERROR_OUT_OF_DEVICE_MEMORY:
      return "VK_ERROR_OUT_OF_DEVICE_MEMORY";
    case VK_ERROR_INITIALIZATION_FAILED:
      return "VK_ERROR_INITIALIZATION_FAILED";
    case VK_ERROR_DEVICE_LOST:
      return "VK_ERROR_DEVICE_LOST";
    case VK_ERROR_LAYER_NOT_PRESENT:
      return "VK_ERROR_LAYER_NOT_PRESENT";
    case VK_ERROR_EXTENSION_NOT_PRESENT:
      return "VK_ERROR_EXTENSION_NOT_PRESENT";
    case VK_ERROR_FEATURE_NOT_PRESENT:
      return "VK_ERROR_FEATURE_NOT_PRESENT";
    case VK_ERROR_INCOMPATIBLE_DRIVER:
      return "VK_ERROR_INCOMPATIBLE_DRIVER";
    case VK_ERROR_SURFACE_LOST_KHR:
      return "VK_ERROR_SURFACE_LOST_KHR";
    case VK_ERROR_OUT_OF_DATE_KHR:
      return "VK_ERROR_OUT_OF_DATE_KHR";
    default:
      return "VK_ERROR_UNKNOWN";
  }
}

void throwVkIfFailed(VkResult result, const char* action) {
  if (result == VK_SUCCESS) {
    return;
  }

  std::ostringstream buffer;
  buffer << action << " failed: " << vkResultString(result);
  throw std::runtime_error(buffer.str());
}

struct DeviceSelection {
  VkPhysicalDevice physicalDevice = VK_NULL_HANDLE;
  std::uint32_t graphicsQueueFamily = 0;
  std::string deviceName;
};

struct SwapchainSupportDetails {
  VkSurfaceCapabilitiesKHR capabilities{};
  std::vector<VkSurfaceFormatKHR> formats;
  std::vector<VkPresentModeKHR> presentModes;
};

struct FrameSync {
  VkSemaphore imageAvailable = VK_NULL_HANDLE;
  VkSemaphore renderFinished = VK_NULL_HANDLE;
  VkFence inFlight = VK_NULL_HANDLE;
};

struct RuntimeControlledEntityState {
  std::string id;
  std::string displayName;
  std::string prefabName;
  std::string spawnTag;
  std::string effectName;
  std::string effectTrigger;
  std::array<float, 3> position{0.0F, 0.0F, 0.0F};
  std::array<float, 3> rotation{0.0F, 0.0F, 0.0F};
  bool valid = false;
};

struct RuntimeSceneRenderProxy {
  std::string id;
  std::string displayName;
  std::string prefabName;
  std::string spawnTag;
  std::string procgeoName;
  std::string procgeoGenerator;
  std::string materialHint;
  std::string effectName;
  std::string effectTrigger;
  std::array<float, 3> worldPosition{0.0F, 0.0F, 0.0F};
  std::array<float, 3> worldScale{1.0F, 1.0F, 1.0F};
  std::array<float, 3> dimensions{1.0F, 1.0F, 1.0F};
  bool hasEffectComponent = false;
};

struct RuntimeProjectedProxy {
  VkRect2D bodyRect{};
  VkRect2D accentRect{};
  std::array<float, 4> bodyColor{0.0F, 0.0F, 0.0F, 1.0F};
  std::array<float, 4> accentColor{0.0F, 0.0F, 0.0F, 1.0F};
  float depth = 0.0F;
  bool hasAccent = false;
};

float clampUnit(float value) {
  return std::clamp(value, 0.0F, 1.0F);
}

std::uint32_t fnv1a(std::string_view value) {
  std::uint32_t hash = 2166136261u;
  for (const unsigned char character : value) {
    hash ^= character;
    hash *= 16777619u;
  }
  return hash;
}

std::array<float, 4> hashedDebugColor(std::string_view seed, float brightness = 1.0F) {
  const std::uint32_t hash = fnv1a(seed);
  const float red = 0.28F + static_cast<float>((hash >> 0) & 0xffu) / 255.0F * 0.52F;
  const float green = 0.24F + static_cast<float>((hash >> 8) & 0xffu) / 255.0F * 0.52F;
  const float blue = 0.26F + static_cast<float>((hash >> 16) & 0xffu) / 255.0F * 0.52F;
  return {
    clampUnit(red * brightness),
    clampUnit(green * brightness),
    clampUnit(blue * brightness),
    1.0F,
  };
}

std::array<float, 4> debugProxyColor(const RuntimeSceneRenderProxy& proxy, bool interactionTarget, float pulse) {
  if (proxy.materialHint == "debug_crate" || proxy.procgeoName == "debug_crate") {
    return {
      clampUnit(0.58F + pulse * 0.08F),
      clampUnit(0.33F + pulse * 0.04F),
      clampUnit(0.16F + pulse * 0.03F),
      1.0F,
    };
  }

  if (interactionTarget) {
    return {
      clampUnit(0.22F + pulse * 0.16F),
      clampUnit(0.56F + pulse * 0.18F),
      clampUnit(0.62F + pulse * 0.16F),
      1.0F,
    };
  }

  return hashedDebugColor(!proxy.materialHint.empty() ? proxy.materialHint : proxy.procgeoName, 1.0F);
}

VkRect2D buildRect(std::int32_t offsetX, std::int32_t offsetY, std::uint32_t width, std::uint32_t height) {
  VkRect2D rect{};
  rect.offset = {offsetX, offsetY};
  rect.extent = {width, height};
  return rect;
}

float pointDistanceToRect(float x, float y, const VkRect2D& rect) {
  const float minX = static_cast<float>(rect.offset.x);
  const float minY = static_cast<float>(rect.offset.y);
  const float maxX = minX + static_cast<float>(rect.extent.width);
  const float maxY = minY + static_cast<float>(rect.extent.height);
  const float deltaX = std::max(std::max(minX - x, 0.0F), x - maxX);
  const float deltaY = std::max(std::max(minY - y, 0.0F), y - maxY);
  return std::sqrt(deltaX * deltaX + deltaY * deltaY);
}

bool physicsBodyBlocksControlledMovement(const PhysicsBodySnapshot& body) {
  return body.valid
    && body.motionType != "kinematic"
    && body.layer != "Query_Only";
}

bool effectTriggerRequiresOverlap(std::string_view trigger) {
  return trigger == "on_overlap";
}

bool effectTriggerSupportsManualInteraction(std::string_view trigger) {
  return !effectTriggerRequiresOverlap(trigger);
}

bool overlapsHorizontalCircleAabb(const std::array<float, 3>& center, float radius, const PhysicsBodySnapshot& body) {
  const double minX = body.position[0] - body.halfExtents[0];
  const double maxX = body.position[0] + body.halfExtents[0];
  const double minZ = body.position[2] - body.halfExtents[2];
  const double maxZ = body.position[2] + body.halfExtents[2];
  const double nearestX = std::clamp(static_cast<double>(center[0]), minX, maxX);
  const double nearestZ = std::clamp(static_cast<double>(center[2]), minZ, maxZ);
  const double deltaX = static_cast<double>(center[0]) - nearestX;
  const double deltaZ = static_cast<double>(center[2]) - nearestZ;
  return deltaX * deltaX + deltaZ * deltaZ < static_cast<double>(radius * radius);
}

bool overlapsHorizontalCircleSphere(const std::array<float, 3>& center, float radius, const PhysicsBodySnapshot& body) {
  const double deltaX = static_cast<double>(center[0]) - body.position[0];
  const double deltaZ = static_cast<double>(center[2]) - body.position[2];
  const double combinedRadius = static_cast<double>(radius) + body.radius;
  return deltaX * deltaX + deltaZ * deltaZ < combinedRadius * combinedRadius;
}

void clearAttachmentRect(VkCommandBuffer commandBuffer, const VkRect2D& rect, const std::array<float, 4>& color) {
  if (rect.extent.width == 0 || rect.extent.height == 0) {
    return;
  }

  VkClearAttachment attachment{};
  attachment.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
  attachment.colorAttachment = 0;
  attachment.clearValue.color.float32[0] = color[0];
  attachment.clearValue.color.float32[1] = color[1];
  attachment.clearValue.color.float32[2] = color[2];
  attachment.clearValue.color.float32[3] = color[3];

  VkClearRect clearRect{};
  clearRect.rect = rect;
  clearRect.baseArrayLayer = 0;
  clearRect.layerCount = 1;
  vkCmdClearAttachments(commandBuffer, 1, &attachment, 1, &clearRect);
}

void foldPathLatestTimestamp(
  const std::filesystem::path& path,
  std::optional<std::filesystem::file_time_type>* latestTimestamp) {
  if (latestTimestamp == nullptr) {
    return;
  }

  std::error_code error;
  const bool exists = std::filesystem::exists(path, error);
  if (error || !exists) {
    return;
  }

  const auto updateTimestamp = [latestTimestamp](const std::filesystem::path& candidatePath) {
    std::error_code timestampError;
    const auto timestamp = std::filesystem::last_write_time(candidatePath, timestampError);
    if (timestampError) {
      return;
    }

    if (!latestTimestamp->has_value() || timestamp > latestTimestamp->value()) {
      *latestTimestamp = timestamp;
    }
  };

  updateTimestamp(path);

  const bool isDirectory = std::filesystem::is_directory(path, error);
  if (error || !isDirectory) {
    return;
  }

  std::filesystem::recursive_directory_iterator end;
  for (std::filesystem::recursive_directory_iterator it(
         path,
         std::filesystem::directory_options::skip_permission_denied,
         error);
       !error && it != end;
       it.increment(error)) {
    updateTimestamp(it->path());
  }
}

bool instanceLayerAvailable(const char* layerName) {
  std::uint32_t layerCount = 0;
  throwVkIfFailed(vkEnumerateInstanceLayerProperties(&layerCount, nullptr), "vkEnumerateInstanceLayerProperties(count)");

  std::vector<VkLayerProperties> layers(layerCount);
  throwVkIfFailed(vkEnumerateInstanceLayerProperties(&layerCount, layers.data()), "vkEnumerateInstanceLayerProperties(list)");

  for (const auto& layer : layers) {
    if (std::string(layer.layerName) == layerName) {
      return true;
    }
  }

  return false;
}

std::vector<const char*> requiredInstanceExtensions() {
  std::uint32_t count = 0;
  const char* const* names = SDL_Vulkan_GetInstanceExtensions(&count);
  if (!names || count == 0) {
    throw std::runtime_error("SDL_Vulkan_GetInstanceExtensions returned no extensions.");
  }

  return std::vector<const char*>(names, names + count);
}

SwapchainSupportDetails querySwapchainSupport(VkPhysicalDevice physicalDevice, VkSurfaceKHR surface) {
  SwapchainSupportDetails support;
  throwVkIfFailed(
    vkGetPhysicalDeviceSurfaceCapabilitiesKHR(physicalDevice, surface, &support.capabilities),
    "vkGetPhysicalDeviceSurfaceCapabilitiesKHR");

  std::uint32_t formatCount = 0;
  throwVkIfFailed(vkGetPhysicalDeviceSurfaceFormatsKHR(physicalDevice, surface, &formatCount, nullptr), "vkGetPhysicalDeviceSurfaceFormatsKHR(count)");
  support.formats.resize(formatCount);
  if (formatCount > 0) {
    throwVkIfFailed(
      vkGetPhysicalDeviceSurfaceFormatsKHR(physicalDevice, surface, &formatCount, support.formats.data()),
      "vkGetPhysicalDeviceSurfaceFormatsKHR(list)");
  }

  std::uint32_t presentModeCount = 0;
  throwVkIfFailed(
    vkGetPhysicalDeviceSurfacePresentModesKHR(physicalDevice, surface, &presentModeCount, nullptr),
    "vkGetPhysicalDeviceSurfacePresentModesKHR(count)");
  support.presentModes.resize(presentModeCount);
  if (presentModeCount > 0) {
    throwVkIfFailed(
      vkGetPhysicalDeviceSurfacePresentModesKHR(physicalDevice, surface, &presentModeCount, support.presentModes.data()),
      "vkGetPhysicalDeviceSurfacePresentModesKHR(list)");
  }

  return support;
}

VkSurfaceFormatKHR chooseSurfaceFormat(const std::vector<VkSurfaceFormatKHR>& formats) {
  for (const auto& format : formats) {
    if (format.format == VK_FORMAT_B8G8R8A8_UNORM && format.colorSpace == VK_COLOR_SPACE_SRGB_NONLINEAR_KHR) {
      return format;
    }
  }

  return formats.front();
}

VkPresentModeKHR choosePresentMode(const std::vector<VkPresentModeKHR>& presentModes) {
  for (VkPresentModeKHR presentMode : presentModes) {
    if (presentMode == VK_PRESENT_MODE_MAILBOX_KHR) {
      return presentMode;
    }
  }

  return VK_PRESENT_MODE_FIFO_KHR;
}

VkCompositeAlphaFlagBitsKHR chooseCompositeAlpha(VkCompositeAlphaFlagsKHR supportedFlags) {
  constexpr std::array<VkCompositeAlphaFlagBitsKHR, 4> preferredOrder = {
    VK_COMPOSITE_ALPHA_OPAQUE_BIT_KHR,
    VK_COMPOSITE_ALPHA_PRE_MULTIPLIED_BIT_KHR,
    VK_COMPOSITE_ALPHA_POST_MULTIPLIED_BIT_KHR,
    VK_COMPOSITE_ALPHA_INHERIT_BIT_KHR,
  };

  for (VkCompositeAlphaFlagBitsKHR candidate : preferredOrder) {
    if ((supportedFlags & candidate) != 0) {
      return candidate;
    }
  }

  return VK_COMPOSITE_ALPHA_OPAQUE_BIT_KHR;
}

VkExtent2D chooseSwapchainExtent(SDL_Window* window, const VkSurfaceCapabilitiesKHR& capabilities) {
  if (capabilities.currentExtent.width != std::numeric_limits<std::uint32_t>::max()) {
    return capabilities.currentExtent;
  }

  int drawableWidth = 0;
  int drawableHeight = 0;
  if (!SDL_GetWindowSizeInPixels(window, &drawableWidth, &drawableHeight)) {
    throw std::runtime_error("SDL_GetWindowSizeInPixels failed: " + sdlErrorString());
  }

  if (drawableWidth < 1) {
    drawableWidth = 1;
  }
  if (drawableHeight < 1) {
    drawableHeight = 1;
  }

  VkExtent2D extent{};
  extent.width = std::clamp(
    static_cast<std::uint32_t>(drawableWidth),
    capabilities.minImageExtent.width,
    capabilities.maxImageExtent.width);
  extent.height = std::clamp(
    static_cast<std::uint32_t>(drawableHeight),
    capabilities.minImageExtent.height,
    capabilities.maxImageExtent.height);
  return extent;
}

DeviceSelection pickDevice(VkInstance instance, VkSurfaceKHR surface) {
  std::uint32_t deviceCount = 0;
  throwVkIfFailed(vkEnumeratePhysicalDevices(instance, &deviceCount, nullptr), "vkEnumeratePhysicalDevices(count)");
  if (deviceCount == 0) {
    throw std::runtime_error("No Vulkan physical devices were found.");
  }

  std::vector<VkPhysicalDevice> devices(deviceCount);
  throwVkIfFailed(vkEnumeratePhysicalDevices(instance, &deviceCount, devices.data()), "vkEnumeratePhysicalDevices(list)");

  for (VkPhysicalDevice device : devices) {
    std::uint32_t extensionCount = 0;
    throwVkIfFailed(vkEnumerateDeviceExtensionProperties(device, nullptr, &extensionCount, nullptr), "vkEnumerateDeviceExtensionProperties(count)");

    std::vector<VkExtensionProperties> extensions(extensionCount);
    throwVkIfFailed(
      vkEnumerateDeviceExtensionProperties(device, nullptr, &extensionCount, extensions.data()),
      "vkEnumerateDeviceExtensionProperties(list)");

    bool hasSwapchainExtension = false;
    for (const auto& extension : extensions) {
      if (std::string(extension.extensionName) == VK_KHR_SWAPCHAIN_EXTENSION_NAME) {
        hasSwapchainExtension = true;
        break;
      }
    }
    if (!hasSwapchainExtension) {
      continue;
    }

    const SwapchainSupportDetails swapchainSupport = querySwapchainSupport(device, surface);
    if (swapchainSupport.formats.empty() || swapchainSupport.presentModes.empty()) {
      continue;
    }

    std::uint32_t queueFamilyCount = 0;
    vkGetPhysicalDeviceQueueFamilyProperties(device, &queueFamilyCount, nullptr);
    std::vector<VkQueueFamilyProperties> queueFamilies(queueFamilyCount);
    vkGetPhysicalDeviceQueueFamilyProperties(device, &queueFamilyCount, queueFamilies.data());

    for (std::uint32_t familyIndex = 0; familyIndex < queueFamilyCount; ++familyIndex) {
      const bool hasGraphics = (queueFamilies[familyIndex].queueFlags & VK_QUEUE_GRAPHICS_BIT) != 0;
      if (!hasGraphics) {
        continue;
      }

      VkBool32 supportsPresentation = VK_FALSE;
      throwVkIfFailed(
        vkGetPhysicalDeviceSurfaceSupportKHR(device, familyIndex, surface, &supportsPresentation),
        "vkGetPhysicalDeviceSurfaceSupportKHR");
      if (!supportsPresentation) {
        continue;
      }

      VkPhysicalDeviceProperties properties{};
      vkGetPhysicalDeviceProperties(device, &properties);

      DeviceSelection selection;
      selection.physicalDevice = device;
      selection.graphicsQueueFamily = familyIndex;
      selection.deviceName = properties.deviceName;
      return selection;
    }
  }

  throw std::runtime_error("No Vulkan device with graphics and presentation support was found.");
}

class NativeRuntime {
public:
  explicit NativeRuntime(RuntimeConfig config)
      : config_(std::move(config)) {}

  ~NativeRuntime() {
    cleanup();
  }

  int run() {
    initialize();
    logStartup();
    mainLoop();

    if (device_ != VK_NULL_HANDLE) {
      vkDeviceWaitIdle(device_);
    }
    logRuntimeLine("Runtime exiting.");
    return 0;
  }

private:
  void initialize() {
    if (!SDL_SetAppMetadata("Shader Forge Runtime", "0.1.0", "com.alexkenley.shaderforge.runtime")) {
      logLine("SDL metadata setup failed: " + sdlErrorString());
    }

    if (!SDL_Init(SDL_INIT_VIDEO | SDL_INIT_EVENTS | SDL_INIT_GAMEPAD)) {
      throw std::runtime_error("SDL_Init failed: " + sdlErrorString());
    }
    sdlInitialized_ = true;

    initializeInputSystem();
    initializeAudioSystem();
    initializeAnimationSystem();
    initializeDataFoundation();
    resolveDataDrivenRuntimeState();
    resolveRuntimeSceneComposition();
    initializePhysicsSystem();
    resolveAnimationRuntimeState();
    initializeToolingUi();
    applyBootstrapPreferences();

    window_ = SDL_CreateWindow(config_.title.c_str(), config_.width, config_.height, SDL_WINDOW_VULKAN | SDL_WINDOW_RESIZABLE);
    if (!window_) {
      throw std::runtime_error("SDL_CreateWindow failed: " + sdlErrorString());
    }

    createInstance();
    createSurface();
    selectPhysicalDevice();
    createDevice();
    createCommandPool();
    allocateCommandBuffers();
    createSyncObjects();
    createSwapchainResources();

    startTicks_ = SDL_GetTicksNS();
    previousFrameTicks_ = startTicks_;
    nextToolingLogTicks_ = startTicks_ + 2'000'000'000ULL;
    nextAuthoredContentPollTicks_ = startTicks_ + kAuthoredContentPollIntervalNs;
    lastObservedAuthoredContentTimestamp_ = authoredContentTimestamp();
    updateInteractionTargetFromView();
    refreshWindowTitle();
  }

  void initializeInputSystem() {
    std::string error;
    if (!inputSystem_.loadFromDisk(InputConfig{.rootPath = config_.inputRoot}, &error)) {
      throw std::runtime_error("Input system initialization failed: " + error);
    }
  }

  void initializeToolingUi() {
    std::filesystem::path layoutPath = config_.toolingLayoutPath;
    if (std::filesystem::exists(config_.toolingSessionLayoutPath)) {
      layoutPath = config_.toolingSessionLayoutPath;
    }

    std::string error;
    if (!toolingUi_.loadLayout(ToolingUiConfig{
      .layoutPath = layoutPath,
      .sessionLayoutPath = config_.toolingSessionLayoutPath,
    }, &error)) {
      throw std::runtime_error("Tooling UI initialization failed: " + error);
    }
  }

  void initializeAudioSystem() {
    std::string error;
    if (!audioSystem_.loadFromDisk(AudioConfig{.rootPath = config_.audioRoot}, &error)) {
      throw std::runtime_error("Audio system initialization failed: " + error);
    }
  }

  void initializeAnimationSystem() {
    std::string error;
    if (!animationSystem_.loadFromDisk(AnimationConfig{.rootPath = config_.animationRoot}, &error)) {
      throw std::runtime_error("Animation system initialization failed: " + error);
    }
  }

  void initializeDataFoundation() {
    std::string error;
    if (!dataFoundation_.loadFromDisk(DataFoundationConfig{
      .contentRoot = config_.contentRoot,
      .foundationPath = config_.dataFoundationPath,
    }, &error)) {
      throw std::runtime_error("Data foundation initialization failed: " + error);
    }
  }

  void initializePhysicsSystem() {
    std::string error;
    if (!physicsSystem_.loadFromDisk(PhysicsConfig{.rootPath = config_.physicsRoot}, &error)) {
      throw std::runtime_error("Physics system initialization failed: " + error);
    }
  }

  void resolveDataDrivenRuntimeState(std::string_view preferredSceneName = {}) {
    activeSceneName_ = preferredSceneName.empty() ? config_.scene : std::string(preferredSceneName);
    activeSceneTitle_.clear();
    activePrimaryPrefab_.clear();
    sceneSelectedFromBootstrap_ = false;
    hasBootstrapOverlayPreference_ = false;
    bootstrapOverlayApplied_ = false;

    const auto bootstrap = dataFoundation_.runtimeBootstrap();
    if (!dataFoundation_.hasScene(activeSceneName_) && bootstrap.has_value() && bootstrap->valid && !bootstrap->defaultScene.empty()) {
      activeSceneName_ = bootstrap->defaultScene;
      sceneSelectedFromBootstrap_ = true;
    }

    if (const auto scene = dataFoundation_.sceneSource(activeSceneName_); scene.has_value() && scene->valid) {
      activeSceneTitle_ = scene->title;
      activePrimaryPrefab_ = scene->primaryPrefab;
    }

    if (bootstrap.has_value() && bootstrap->valid && bootstrap->hasToolingOverlayPreference) {
      hasBootstrapOverlayPreference_ = true;
      bootstrapOverlayEnabled_ = bootstrap->toolingOverlayEnabled;
    }
  }

  void resolveRuntimeSceneComposition() {
    activeSceneEntityCount_ = 0;
    activeSceneRootCount_ = 0;
    activeScenePrefabCount_ = 0;
    activeSceneRenderableCount_ = 0;
    activeControlledEntity_ = RuntimeControlledEntityState{};
    activeInteractionTarget_ = RuntimeControlledEntityState{};
    activeMovementBlockedBodyName_.clear();
    activeOverlapTriggeredBodies_.clear();
    activeSceneRenderProxies_.clear();
    activeTriggeredInteractionEntityId_.clear();
    activeTriggeredInteractionEffectName_.clear();
    activeTriggeredInteractionUntilTicks_ = 0;

    const auto composed = dataFoundation_.composeScene(activeSceneName_);
    if (!composed.has_value() || !composed->valid) {
      return;
    }

    activeSceneEntityCount_ = composed->entities.size();
    activeSceneRootCount_ = composed->rootEntities.size();
    activeScenePrefabCount_ = composed->prefabNames.size();

    const ComposedSceneEntitySnapshot* preferredEntity = nullptr;
    if (!composed->preferredPlayerEntity.empty()) {
      const auto playerIt = std::find_if(
        composed->entities.begin(),
        composed->entities.end(),
        [&composed](const ComposedSceneEntitySnapshot& entity) {
          return entity.id == composed->preferredPlayerEntity;
        });
      if (playerIt != composed->entities.end()) {
        preferredEntity = &(*playerIt);
      }
    }

    if (preferredEntity == nullptr && !composed->entities.empty()) {
      preferredEntity = &composed->entities.front();
    }

    auto applyEntityState = [](const ComposedSceneEntitySnapshot& source, RuntimeControlledEntityState* target) {
      target->id = source.id;
      target->displayName = source.displayName;
      target->prefabName = source.prefabName;
      target->spawnTag = source.spawnTag;
      target->effectName = source.effectName;
      target->effectTrigger = source.effectTrigger;
      target->position = source.worldPosition;
      target->rotation = source.worldRotation;
      target->valid = true;
    };

    if (preferredEntity != nullptr) {
      applyEntityState(*preferredEntity, &activeControlledEntity_);
    }

    for (const auto& entity : composed->entities) {
      if (!entity.hasRenderComponent || entity.renderProcgeo.empty()) {
        continue;
      }

      const auto procgeo = dataFoundation_.procgeoSource(entity.renderProcgeo);
      if (!procgeo.has_value() || !procgeo->valid) {
        continue;
      }

      RuntimeSceneRenderProxy proxy;
      proxy.id = entity.id;
      proxy.displayName = entity.displayName;
      proxy.prefabName = entity.prefabName;
      proxy.spawnTag = entity.spawnTag;
      proxy.procgeoName = entity.renderProcgeo;
      proxy.procgeoGenerator = procgeo->generator;
      proxy.materialHint = !entity.renderMaterialHint.empty() ? entity.renderMaterialHint : procgeo->materialHint;
      proxy.effectName = entity.effectName;
      proxy.effectTrigger = entity.effectTrigger;
      proxy.worldPosition = entity.worldPosition;
      proxy.worldScale = entity.worldScale;
      proxy.dimensions = {
        std::max(procgeo->width * std::abs(entity.worldScale[0]), 0.1F),
        std::max(procgeo->height * std::abs(entity.worldScale[1]), 0.1F),
        std::max(procgeo->depth * std::abs(entity.worldScale[2]), 0.1F),
      };
      proxy.hasEffectComponent = entity.hasEffectComponent;
      activeSceneRenderProxies_.push_back(std::move(proxy));
    }

    activeSceneRenderableCount_ = activeSceneRenderProxies_.size();
  }

  void resolveAnimationRuntimeState() {
    activeAnimationGraphName_.clear();
    activeAnimationEntryState_.clear();
    activeAnimationEntryClip_.clear();
    activeAnimationState_.clear();
    activeAnimationClip_.clear();
    activeAnimationStateTimeSeconds_ = 0.0;
    activeControlledEntityMoveSpeed_ = 0.0F;

    const auto defaultGraph = animationSystem_.defaultGraphName();
    if (!defaultGraph.has_value()) {
      return;
    }

    activeAnimationGraphName_ = *defaultGraph;
    const auto resolved = animationSystem_.resolveGraph(activeAnimationGraphName_);
    if (!resolved.has_value()) {
      activeAnimationGraphName_.clear();
      return;
    }

    activeAnimationEntryState_ = resolved->entryState;
    activeAnimationEntryClip_ = resolved->entryClipName;
    activeAnimationState_ = resolved->entryState;
    activeAnimationClip_ = resolved->entryClipName;
  }

  void applyBootstrapPreferences() {
    if (!hasBootstrapOverlayPreference_ || bootstrapOverlayEnabled_ == toolingUi_.overlayVisible()) {
      return;
    }

    toolingUi_.toggleOverlay();
    bootstrapOverlayApplied_ = true;
  }

  void setInteractionTargetFromProxy(const RuntimeSceneRenderProxy& proxy) {
    activeInteractionTarget_.id = proxy.id;
    activeInteractionTarget_.displayName = proxy.displayName;
    activeInteractionTarget_.prefabName = proxy.prefabName;
    activeInteractionTarget_.spawnTag = proxy.spawnTag;
    activeInteractionTarget_.effectName = proxy.effectName;
    activeInteractionTarget_.effectTrigger = proxy.effectTrigger;
    activeInteractionTarget_.position = proxy.worldPosition;
    activeInteractionTarget_.rotation = {0.0F, 0.0F, 0.0F};
    activeInteractionTarget_.valid = true;
  }

  void updateInteractionTargetFromView() {
    activeInteractionTarget_ = RuntimeControlledEntityState{};
    if (swapchainExtent_.width == 0 || swapchainExtent_.height == 0) {
      return;
    }

    const float centerX = static_cast<float>(swapchainExtent_.width) * 0.5F;
    const float centerY = static_cast<float>(swapchainExtent_.height) * 0.5F;
    const RuntimeSceneRenderProxy* bestProxy = nullptr;
    float bestScore = std::numeric_limits<float>::max();

    for (const auto& proxy : activeSceneRenderProxies_) {
      if (!proxy.hasEffectComponent || proxy.effectName.empty()) {
        continue;
      }
      if (!effectTriggerSupportsManualInteraction(proxy.effectTrigger)) {
        continue;
      }

      const auto projectedProxy = projectSceneRenderProxy(proxy, 0.0);
      if (!projectedProxy.has_value()) {
        continue;
      }

      const VkRect2D& focusRect = projectedProxy->hasAccent ? projectedProxy->accentRect : projectedProxy->bodyRect;
      const float aimDistance = pointDistanceToRect(centerX, centerY, focusRect);
      const float focusThreshold = std::max(
        18.0F,
        std::min(
          static_cast<float>(focusRect.extent.width),
          static_cast<float>(focusRect.extent.height)) * 0.35F);
      if (aimDistance > focusThreshold) {
        continue;
      }

      const float score = aimDistance + projectedProxy->depth * 6.0F;
      if (score < bestScore) {
        bestScore = score;
        bestProxy = &proxy;
      }
    }

    if (bestProxy != nullptr) {
      setInteractionTargetFromProxy(*bestProxy);
    }
  }

  void triggerSceneInteraction(std::string_view reason) {
    if (!activeInteractionTarget_.valid || activeInteractionTarget_.effectName.empty()) {
      logRuntimeLine("Scene interaction request via " + std::string(reason) + ": no active effect target.");
      return;
    }

    activeTriggeredInteractionEntityId_ = activeInteractionTarget_.id;
    activeTriggeredInteractionEffectName_ = activeInteractionTarget_.effectName;
    activeTriggeredInteractionUntilTicks_ = SDL_GetTicksNS() + 650'000'000ULL;

    const auto effectDescriptor = dataFoundation_.effectDescriptor(activeInteractionTarget_.effectName);
    std::ostringstream message;
    message << "Scene effect " << activeInteractionTarget_.effectName
            << " triggered via " << reason
            << ": entity=" << activeInteractionTarget_.id;
    if (!activeInteractionTarget_.prefabName.empty()) {
      message << ", prefab=" << activeInteractionTarget_.prefabName;
    }
    if (!activeInteractionTarget_.effectTrigger.empty()) {
      message << ", scene_trigger=" << activeInteractionTarget_.effectTrigger;
    }
    message << ", position=(" << runtimeVector3String(activeInteractionTarget_.position) << ')';

    if (effectDescriptor.has_value()) {
      if (!effectDescriptor->category.empty()) {
        message << ", category=" << effectDescriptor->category;
      }
      if (!effectDescriptor->runtimeModel.empty()) {
        message << ", runtime_model=" << effectDescriptor->runtimeModel;
      }
      if (!effectDescriptor->trigger.empty()) {
        message << ", authored_trigger=" << effectDescriptor->trigger;
      }
    }

    logRuntimeLine(message.str());
    refreshWindowTitle();
  }

  std::optional<std::filesystem::file_time_type> authoredContentTimestamp() const {
    std::optional<std::filesystem::file_time_type> latestTimestamp;
    foldPathLatestTimestamp(config_.contentRoot, &latestTimestamp);
    foldPathLatestTimestamp(config_.audioRoot, &latestTimestamp);
    foldPathLatestTimestamp(config_.animationRoot, &latestTimestamp);
    foldPathLatestTimestamp(config_.physicsRoot, &latestTimestamp);
    foldPathLatestTimestamp(config_.dataFoundationPath, &latestTimestamp);
    return latestTimestamp;
  }

  bool reloadRuntimeContent(std::string_view reason) {
    AudioSystem nextAudioSystem;
    AnimationSystem nextAnimationSystem;
    DataFoundation nextDataFoundation;
    PhysicsSystem nextPhysicsSystem;
    std::string error;

    if (!nextAudioSystem.loadFromDisk(AudioConfig{.rootPath = config_.audioRoot}, &error)) {
      logRuntimeLine("Authored runtime content reload failed while reloading audio: " + error);
      return false;
    }

    error.clear();
    if (!nextAnimationSystem.loadFromDisk(AnimationConfig{.rootPath = config_.animationRoot}, &error)) {
      logRuntimeLine("Authored runtime content reload failed while reloading animation: " + error);
      return false;
    }

    error.clear();
    if (!nextDataFoundation.loadFromDisk(DataFoundationConfig{
          .contentRoot = config_.contentRoot,
          .foundationPath = config_.dataFoundationPath,
        },
        &error)) {
      logRuntimeLine("Authored runtime content reload failed while reloading data foundation: " + error);
      return false;
    }

    error.clear();
    if (!nextPhysicsSystem.loadFromDisk(PhysicsConfig{.rootPath = config_.physicsRoot}, &error)) {
      logRuntimeLine("Authored runtime content reload failed while reloading physics: " + error);
      return false;
    }

    const std::string requestedScene = activeSceneName_.empty() ? config_.scene : activeSceneName_;
    audioSystem_ = std::move(nextAudioSystem);
    animationSystem_ = std::move(nextAnimationSystem);
    dataFoundation_ = std::move(nextDataFoundation);
    physicsSystem_ = std::move(nextPhysicsSystem);

    resolveDataDrivenRuntimeState(requestedScene);
    resolveRuntimeSceneComposition();
    resolveAnimationRuntimeState();
    applyBootstrapPreferences();
    updateInteractionTargetFromView();

    lastObservedAuthoredContentTimestamp_ = authoredContentTimestamp();
    authoredContentReloadCount_ += 1;

    const std::string reasonLabel = reason.empty() ? "reload" : std::string(reason);
    std::ostringstream summary;
    summary << "Reloaded authored runtime content via " << reasonLabel
            << ": reloads=" << authoredContentReloadCount_
            << ", active-scene=" << activeSceneName_
            << ", entities=" << activeSceneEntityCount_
            << ", renderables=" << activeSceneRenderableCount_;
    logRuntimeLine(summary.str());

    if (sceneSelectedFromBootstrap_) {
      logRuntimeLine("Requested scene was not found after reload. Runtime fell back to the bootstrap default scene.");
    }

    logRuntimeLine(dataFoundation_.sceneLookupSummary(activeSceneName_));
    if (activeSceneEntityCount_ > 0) {
      std::ostringstream sceneRuntimeSummary;
      sceneRuntimeSummary << "Runtime scene state: entities=" << activeSceneEntityCount_
                          << ", roots=" << activeSceneRootCount_
                          << ", prefabs=" << activeScenePrefabCount_;
      logRuntimeLine(sceneRuntimeSummary.str());
    }
    if (activeSceneRenderableCount_ > 0) {
      std::ostringstream renderSummary;
      renderSummary << "Runtime scene renderables: proxies=" << activeSceneRenderableCount_
                    << ", mode=projected_debug_proxies";
      logRuntimeLine(renderSummary.str());
    }

    logControlledEntityState(reasonLabel);
    logInteractionTarget(reasonLabel);
    logPhysicsQueries(reasonLabel);
    refreshWindowTitle();
    return true;
  }

  void pollAuthoredContentReload(std::uint64_t currentTicks) {
    if (nextAuthoredContentPollTicks_ != 0 && currentTicks < nextAuthoredContentPollTicks_) {
      return;
    }

    nextAuthoredContentPollTicks_ = currentTicks + kAuthoredContentPollIntervalNs;
    const auto latestTimestamp = authoredContentTimestamp();
    if (!latestTimestamp.has_value()) {
      return;
    }

    if (!lastObservedAuthoredContentTimestamp_.has_value()) {
      lastObservedAuthoredContentTimestamp_ = latestTimestamp;
      return;
    }

    if (latestTimestamp.value() <= lastObservedAuthoredContentTimestamp_.value()) {
      return;
    }

    lastObservedAuthoredContentTimestamp_ = latestTimestamp;
    logRuntimeLine("Detected authored runtime content change on disk. Reloading runtime content.");
    (void)reloadRuntimeContent("file_change");
  }

  void logControlledEntityState(std::string_view reason) {
    if (!activeControlledEntity_.valid) {
      return;
    }

    std::ostringstream message;
    message << "Controlled scene entity via " << reason
            << ": id=" << activeControlledEntity_.id
            << ", prefab=" << activeControlledEntity_.prefabName;
    if (!activeControlledEntity_.spawnTag.empty()) {
      message << ", spawn_tag=" << activeControlledEntity_.spawnTag;
    }
    message << ", position=(" << runtimeVector3String(activeControlledEntity_.position) << ')'
            << ", rotation=(" << runtimeVector3String(activeControlledEntity_.rotation) << ')';
    if (activeControlledEntityMoveSpeed_ > 0.0F) {
      message << ", move_speed=" << activeControlledEntityMoveSpeed_;
    }
    if (!activeAnimationState_.empty()) {
      message << ", anim_state=" << activeAnimationState_;
    }
    if (!activeMovementBlockedBodyName_.empty()) {
      message << ", blocked_by=" << activeMovementBlockedBodyName_;
    }
    logRuntimeLine(message.str());
  }

  void logInteractionTarget(std::string_view reason) {
    if (!activeInteractionTarget_.valid || activeInteractionTarget_.effectName.empty()) {
      return;
    }

    std::ostringstream message;
    message << "Scene interaction via " << reason
            << ": entity=" << activeInteractionTarget_.id
            << ", effect=" << activeInteractionTarget_.effectName;
    if (!activeInteractionTarget_.effectTrigger.empty()) {
      message << ", trigger=" << activeInteractionTarget_.effectTrigger;
    }
    message << ", position=(" << runtimeVector3String(activeInteractionTarget_.position) << ')';
    logRuntimeLine(message.str());
  }

  void logRuntimeLine(const std::string& message) {
    toolingUi_.appendLogLine(message);
    logLine(message);
  }

  void logRuntimeMultiline(const std::string& message) {
    std::istringstream lines(message);
    std::string line;
    while (std::getline(lines, line)) {
      if (!line.empty()) {
        logRuntimeLine(line);
      }
    }
  }

  void createInstance() {
    const auto extensions = requiredInstanceExtensions();
    std::vector<const char*> layers;

    if (config_.enableValidation) {
      if (instanceLayerAvailable(kValidationLayerName)) {
        layers.push_back(kValidationLayerName);
        validationEnabled_ = true;
      } else {
        logRuntimeLine("Validation requested, but VK_LAYER_KHRONOS_validation is not available.");
      }
    }

    VkApplicationInfo applicationInfo{};
    applicationInfo.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO;
    applicationInfo.pApplicationName = config_.title.c_str();
    applicationInfo.applicationVersion = VK_MAKE_API_VERSION(0, 0, 1, 0);
    applicationInfo.pEngineName = "Shader Forge";
    applicationInfo.engineVersion = VK_MAKE_API_VERSION(0, 0, 1, 0);
    applicationInfo.apiVersion = VK_API_VERSION_1_3;

    VkInstanceCreateInfo createInfo{};
    createInfo.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO;
    createInfo.pApplicationInfo = &applicationInfo;
    createInfo.enabledExtensionCount = static_cast<std::uint32_t>(extensions.size());
    createInfo.ppEnabledExtensionNames = extensions.data();
    createInfo.enabledLayerCount = static_cast<std::uint32_t>(layers.size());
    createInfo.ppEnabledLayerNames = layers.empty() ? nullptr : layers.data();

    throwVkIfFailed(vkCreateInstance(&createInfo, nullptr, &instance_), "vkCreateInstance");
  }

  void createSurface() {
    if (!SDL_Vulkan_CreateSurface(window_, instance_, nullptr, &surface_)) {
      throw std::runtime_error("SDL_Vulkan_CreateSurface failed: " + sdlErrorString());
    }
  }

  void selectPhysicalDevice() {
    const DeviceSelection selection = pickDevice(instance_, surface_);
    physicalDevice_ = selection.physicalDevice;
    graphicsQueueFamily_ = selection.graphicsQueueFamily;
    physicalDeviceName_ = selection.deviceName;
  }

  void createDevice() {
    const float queuePriority = 1.0f;
    VkDeviceQueueCreateInfo queueInfo{};
    queueInfo.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO;
    queueInfo.queueFamilyIndex = graphicsQueueFamily_;
    queueInfo.queueCount = 1;
    queueInfo.pQueuePriorities = &queuePriority;

    const char* requiredExtensions[] = {VK_KHR_SWAPCHAIN_EXTENSION_NAME};
    VkDeviceCreateInfo deviceInfo{};
    deviceInfo.sType = VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO;
    deviceInfo.queueCreateInfoCount = 1;
    deviceInfo.pQueueCreateInfos = &queueInfo;
    deviceInfo.enabledExtensionCount = 1;
    deviceInfo.ppEnabledExtensionNames = requiredExtensions;

    throwVkIfFailed(vkCreateDevice(physicalDevice_, &deviceInfo, nullptr, &device_), "vkCreateDevice");
    vkGetDeviceQueue(device_, graphicsQueueFamily_, 0, &graphicsQueue_);
  }

  void createCommandPool() {
    VkCommandPoolCreateInfo createInfo{};
    createInfo.sType = VK_STRUCTURE_TYPE_COMMAND_POOL_CREATE_INFO;
    createInfo.flags = VK_COMMAND_POOL_CREATE_RESET_COMMAND_BUFFER_BIT;
    createInfo.queueFamilyIndex = graphicsQueueFamily_;

    throwVkIfFailed(vkCreateCommandPool(device_, &createInfo, nullptr, &commandPool_), "vkCreateCommandPool");
  }

  void allocateCommandBuffers() {
    commandBuffers_.resize(kMaxFramesInFlight);

    VkCommandBufferAllocateInfo allocateInfo{};
    allocateInfo.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_ALLOCATE_INFO;
    allocateInfo.commandPool = commandPool_;
    allocateInfo.level = VK_COMMAND_BUFFER_LEVEL_PRIMARY;
    allocateInfo.commandBufferCount = static_cast<std::uint32_t>(commandBuffers_.size());

    throwVkIfFailed(vkAllocateCommandBuffers(device_, &allocateInfo, commandBuffers_.data()), "vkAllocateCommandBuffers");
  }

  void createSyncObjects() {
    VkSemaphoreCreateInfo semaphoreInfo{};
    semaphoreInfo.sType = VK_STRUCTURE_TYPE_SEMAPHORE_CREATE_INFO;

    VkFenceCreateInfo fenceInfo{};
    fenceInfo.sType = VK_STRUCTURE_TYPE_FENCE_CREATE_INFO;
    fenceInfo.flags = VK_FENCE_CREATE_SIGNALED_BIT;

    for (auto& frame : frames_) {
      throwVkIfFailed(vkCreateSemaphore(device_, &semaphoreInfo, nullptr, &frame.imageAvailable), "vkCreateSemaphore(imageAvailable)");
      throwVkIfFailed(vkCreateSemaphore(device_, &semaphoreInfo, nullptr, &frame.renderFinished), "vkCreateSemaphore(renderFinished)");
      throwVkIfFailed(vkCreateFence(device_, &fenceInfo, nullptr, &frame.inFlight), "vkCreateFence");
    }
  }

  void createSwapchainResources() {
    createSwapchain();
    createImageViews();
    createRenderPass();
    createFramebuffers();
    framebufferDirty_ = false;
  }

  void createSwapchain() {
    const SwapchainSupportDetails support = querySwapchainSupport(physicalDevice_, surface_);
    if (support.formats.empty()) {
      throw std::runtime_error("No Vulkan surface formats are available.");
    }
    if (support.presentModes.empty()) {
      throw std::runtime_error("No Vulkan presentation modes are available.");
    }

    const VkSurfaceFormatKHR surfaceFormat = chooseSurfaceFormat(support.formats);
    const VkPresentModeKHR presentMode = choosePresentMode(support.presentModes);
    const VkExtent2D extent = chooseSwapchainExtent(window_, support.capabilities);

    std::uint32_t imageCount = support.capabilities.minImageCount + 1;
    if (support.capabilities.maxImageCount > 0 && imageCount > support.capabilities.maxImageCount) {
      imageCount = support.capabilities.maxImageCount;
    }

    VkSwapchainCreateInfoKHR createInfo{};
    createInfo.sType = VK_STRUCTURE_TYPE_SWAPCHAIN_CREATE_INFO_KHR;
    createInfo.surface = surface_;
    createInfo.minImageCount = imageCount;
    createInfo.imageFormat = surfaceFormat.format;
    createInfo.imageColorSpace = surfaceFormat.colorSpace;
    createInfo.imageExtent = extent;
    createInfo.imageArrayLayers = 1;
    createInfo.imageUsage = VK_IMAGE_USAGE_COLOR_ATTACHMENT_BIT;
    createInfo.imageSharingMode = VK_SHARING_MODE_EXCLUSIVE;
    createInfo.preTransform = support.capabilities.currentTransform;
    createInfo.compositeAlpha = chooseCompositeAlpha(support.capabilities.supportedCompositeAlpha);
    createInfo.presentMode = presentMode;
    createInfo.clipped = VK_TRUE;
    createInfo.oldSwapchain = VK_NULL_HANDLE;

    throwVkIfFailed(vkCreateSwapchainKHR(device_, &createInfo, nullptr, &swapchain_), "vkCreateSwapchainKHR");

    std::uint32_t actualImageCount = 0;
    throwVkIfFailed(vkGetSwapchainImagesKHR(device_, swapchain_, &actualImageCount, nullptr), "vkGetSwapchainImagesKHR(count)");
    swapchainImages_.resize(actualImageCount);
    throwVkIfFailed(vkGetSwapchainImagesKHR(device_, swapchain_, &actualImageCount, swapchainImages_.data()), "vkGetSwapchainImagesKHR(list)");

    swapchainImageFormat_ = surfaceFormat.format;
    swapchainExtent_ = extent;
  }

  void createImageViews() {
    swapchainImageViews_.clear();
    swapchainImageViews_.reserve(swapchainImages_.size());

    for (VkImage image : swapchainImages_) {
      VkImageViewCreateInfo createInfo{};
      createInfo.sType = VK_STRUCTURE_TYPE_IMAGE_VIEW_CREATE_INFO;
      createInfo.image = image;
      createInfo.viewType = VK_IMAGE_VIEW_TYPE_2D;
      createInfo.format = swapchainImageFormat_;
      createInfo.components.r = VK_COMPONENT_SWIZZLE_IDENTITY;
      createInfo.components.g = VK_COMPONENT_SWIZZLE_IDENTITY;
      createInfo.components.b = VK_COMPONENT_SWIZZLE_IDENTITY;
      createInfo.components.a = VK_COMPONENT_SWIZZLE_IDENTITY;
      createInfo.subresourceRange.aspectMask = VK_IMAGE_ASPECT_COLOR_BIT;
      createInfo.subresourceRange.baseMipLevel = 0;
      createInfo.subresourceRange.levelCount = 1;
      createInfo.subresourceRange.baseArrayLayer = 0;
      createInfo.subresourceRange.layerCount = 1;

      VkImageView imageView = VK_NULL_HANDLE;
      throwVkIfFailed(vkCreateImageView(device_, &createInfo, nullptr, &imageView), "vkCreateImageView");
      swapchainImageViews_.push_back(imageView);
    }
  }

  void createRenderPass() {
    VkAttachmentDescription colorAttachment{};
    colorAttachment.format = swapchainImageFormat_;
    colorAttachment.samples = VK_SAMPLE_COUNT_1_BIT;
    colorAttachment.loadOp = VK_ATTACHMENT_LOAD_OP_CLEAR;
    colorAttachment.storeOp = VK_ATTACHMENT_STORE_OP_STORE;
    colorAttachment.stencilLoadOp = VK_ATTACHMENT_LOAD_OP_DONT_CARE;
    colorAttachment.stencilStoreOp = VK_ATTACHMENT_STORE_OP_DONT_CARE;
    colorAttachment.initialLayout = VK_IMAGE_LAYOUT_UNDEFINED;
    colorAttachment.finalLayout = VK_IMAGE_LAYOUT_PRESENT_SRC_KHR;

    VkAttachmentReference colorReference{};
    colorReference.attachment = 0;
    colorReference.layout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;

    VkSubpassDescription subpass{};
    subpass.pipelineBindPoint = VK_PIPELINE_BIND_POINT_GRAPHICS;
    subpass.colorAttachmentCount = 1;
    subpass.pColorAttachments = &colorReference;

    VkSubpassDependency dependency{};
    dependency.srcSubpass = VK_SUBPASS_EXTERNAL;
    dependency.dstSubpass = 0;
    dependency.srcStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    dependency.dstStageMask = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT;
    dependency.srcAccessMask = 0;
    dependency.dstAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;

    VkRenderPassCreateInfo createInfo{};
    createInfo.sType = VK_STRUCTURE_TYPE_RENDER_PASS_CREATE_INFO;
    createInfo.attachmentCount = 1;
    createInfo.pAttachments = &colorAttachment;
    createInfo.subpassCount = 1;
    createInfo.pSubpasses = &subpass;
    createInfo.dependencyCount = 1;
    createInfo.pDependencies = &dependency;

    throwVkIfFailed(vkCreateRenderPass(device_, &createInfo, nullptr, &renderPass_), "vkCreateRenderPass");
  }

  void createFramebuffers() {
    swapchainFramebuffers_.clear();
    swapchainFramebuffers_.reserve(swapchainImageViews_.size());

    for (VkImageView imageView : swapchainImageViews_) {
      VkFramebufferCreateInfo createInfo{};
      createInfo.sType = VK_STRUCTURE_TYPE_FRAMEBUFFER_CREATE_INFO;
      createInfo.renderPass = renderPass_;
      createInfo.attachmentCount = 1;
      createInfo.pAttachments = &imageView;
      createInfo.width = swapchainExtent_.width;
      createInfo.height = swapchainExtent_.height;
      createInfo.layers = 1;

      VkFramebuffer framebuffer = VK_NULL_HANDLE;
      throwVkIfFailed(vkCreateFramebuffer(device_, &createInfo, nullptr, &framebuffer), "vkCreateFramebuffer");
      swapchainFramebuffers_.push_back(framebuffer);
    }
  }

  void destroySwapchainResources() {
    for (VkFramebuffer framebuffer : swapchainFramebuffers_) {
      if (framebuffer != VK_NULL_HANDLE) {
        vkDestroyFramebuffer(device_, framebuffer, nullptr);
      }
    }
    swapchainFramebuffers_.clear();

    if (renderPass_ != VK_NULL_HANDLE) {
      vkDestroyRenderPass(device_, renderPass_, nullptr);
      renderPass_ = VK_NULL_HANDLE;
    }

    for (VkImageView imageView : swapchainImageViews_) {
      if (imageView != VK_NULL_HANDLE) {
        vkDestroyImageView(device_, imageView, nullptr);
      }
    }
    swapchainImageViews_.clear();

    if (swapchain_ != VK_NULL_HANDLE) {
      vkDestroySwapchainKHR(device_, swapchain_, nullptr);
      swapchain_ = VK_NULL_HANDLE;
    }
    swapchainImages_.clear();
  }

  void recreateSwapchain() {
    if (!drawableAreaAvailable()) {
      return;
    }

    vkDeviceWaitIdle(device_);
    destroySwapchainResources();
    createSwapchainResources();
    logSwapchain("Swapchain recreated");
  }

  bool drawableAreaAvailable() {
    int drawableWidth = 0;
    int drawableHeight = 0;
    if (!SDL_GetWindowSizeInPixels(window_, &drawableWidth, &drawableHeight)) {
      throw std::runtime_error("SDL_GetWindowSizeInPixels failed: " + sdlErrorString());
    }
    return drawableWidth > 0 && drawableHeight > 0;
  }

  void logStartup() {
    std::ostringstream startup;
    startup << "requested-scene=" << config_.scene
            << ", active-scene=" << activeSceneName_
            << ", device=" << physicalDeviceName_
            << ", queue-family=" << graphicsQueueFamily_
            << ", validation=" << (validationEnabled_ ? "enabled" : "disabled")
            << ", input-root=" << std::filesystem::absolute(config_.inputRoot).string()
            << ", content-root=" << std::filesystem::absolute(config_.contentRoot).string()
            << ", audio-root=" << std::filesystem::absolute(config_.audioRoot).string()
            << ", animation-root=" << std::filesystem::absolute(config_.animationRoot).string()
            << ", physics-root=" << std::filesystem::absolute(config_.physicsRoot).string()
            << ", data-foundation=" << std::filesystem::absolute(config_.dataFoundationPath).string()
            << ", tooling-layout=" << std::filesystem::absolute(config_.toolingLayoutPath).string();
    logRuntimeLine(startup.str());
    if (sceneSelectedFromBootstrap_) {
      logRuntimeLine("Requested scene was not found. Runtime fell back to the bootstrap default scene.");
    }
    if (bootstrapOverlayApplied_) {
      logRuntimeLine(std::string("Bootstrap overlay preference applied: ")
        + (toolingUi_.overlayVisible() ? "enabled." : "disabled."));
    }
    logRuntimeLine(audioSystem_.foundationSummary());
    logRuntimeLine(animationSystem_.foundationSummary());
    logRuntimeLine(physicsSystem_.foundationSummary());
    logRuntimeLine(dataFoundation_.foundationSummary());
    logRuntimeLine(dataFoundation_.assetCatalogSummary());
    logRuntimeLine(dataFoundation_.sceneLookupSummary(activeSceneName_));
    logRuntimeMultiline(dataFoundation_.sceneEntitySummary(activeSceneName_));
    logRuntimeMultiline(dataFoundation_.scenePrefabComponentSummary(activeSceneName_));
    logRuntimeMultiline(dataFoundation_.composedSceneSummary(activeSceneName_));
    logRuntimeMultiline(audioSystem_.busRoutingSummary());
    logRuntimeMultiline(audioSystem_.eventCatalogSummary());
    logRuntimeMultiline(animationSystem_.graphCatalogSummary());
    logRuntimeMultiline(physicsSystem_.layerMatrixSummary());
    logRuntimeMultiline(physicsSystem_.sceneBodySummary(activeSceneName_));
    logRuntimeMultiline(dataFoundation_.relationshipSummary());
    logRuntimeMultiline(dataFoundation_.cookPlanSummary());
    logRuntimeMultiline(inputSystem_.bindingSummary());
    logRuntimeMultiline(toolingUi_.panelRegistrySummary());
    if (activeSceneEntityCount_ > 0) {
      std::ostringstream sceneRuntimeSummary;
      sceneRuntimeSummary << "Runtime scene state: entities=" << activeSceneEntityCount_
                          << ", roots=" << activeSceneRootCount_
                          << ", prefabs=" << activeScenePrefabCount_;
      logRuntimeLine(sceneRuntimeSummary.str());
    }
    if (activeSceneRenderableCount_ > 0) {
      std::ostringstream renderSummary;
      renderSummary << "Runtime scene renderables: proxies=" << activeSceneRenderableCount_
                    << ", mode=projected_debug_proxies";
      logRuntimeLine(renderSummary.str());
    }
    logControlledEntityState("startup");
    logInteractionTarget("startup");
    triggerAudioEvent("runtime_boot", "startup");
    triggerAnimationGraph(activeAnimationGraphName_, "startup");
    logPhysicsQueries("startup");
    logSwapchain("Swapchain ready");
    logRuntimeLine(
      "Native runtime window is live. Press Escape to exit, F1 for input diagnostics, F2-F6 for tooling panels, Enter/left click to trigger the current interaction target, and F7 to reload authored runtime content.");
  }

  void triggerAudioEvent(std::string_view eventName, std::string_view reason) {
    const auto resolved = audioSystem_.resolveEvent(eventName);
    if (!resolved.has_value()) {
      logRuntimeLine("Audio event request could not be resolved: " + std::string(eventName));
      return;
    }

    std::ostringstream message;
    message << "Audio event " << resolved->eventName
            << " requested via " << reason
            << ": sound=" << resolved->soundName
            << ", bus=" << resolved->busName
            << ", playback=" << resolved->playbackMode
            << ", spatialization=" << resolved->spatialization
            << ", media=" << resolved->sourceMediaPath.generic_string()
            << ", fade_ms=" << resolved->fadeMs;
    logRuntimeLine(message.str());
  }

  void triggerAnimationGraph(std::string_view graphName, std::string_view reason) {
    if (graphName.empty()) {
      return;
    }

    const auto resolved = animationSystem_.resolveGraph(graphName);
    if (!resolved.has_value()) {
      logRuntimeLine("Animation graph request could not be resolved: " + std::string(graphName));
      return;
    }

    std::ostringstream message;
    message << "Animation graph " << resolved->graphName
            << " requested via " << reason
            << ": skeleton=" << resolved->skeletonName
            << ", entry_state=" << resolved->entryState
            << ", entry_clip=" << resolved->entryClipName
            << ", states=" << resolved->stateNames.size();
    logRuntimeLine(message.str());

    for (const auto& eventSnapshot : resolved->entryClipEvents) {
      std::ostringstream eventMessage;
      eventMessage << "Animation event " << resolved->entryClipName << '.' << eventSnapshot.name
                   << " -> type=" << eventSnapshot.type
                   << ", target=" << eventSnapshot.target
                   << ", time=" << eventSnapshot.timeSeconds;
      logRuntimeLine(eventMessage.str());

      if (eventSnapshot.type == "audio_event") {
        triggerAudioEvent(eventSnapshot.target, std::string(reason) + ":animation_event");
      }
    }
  }

  void emitAnimationStateEvents(
    const ResolvedAnimationStateSnapshot& state,
    double startTimeSeconds,
    double endTimeSeconds,
    std::string_view reason) {
    for (const auto& eventSnapshot : state.clipEvents) {
      if (!eventSnapshot.valid || eventSnapshot.timeSeconds < startTimeSeconds || eventSnapshot.timeSeconds > endTimeSeconds) {
        continue;
      }

      std::ostringstream eventMessage;
      eventMessage << "Animation state event " << state.clipName << '.' << eventSnapshot.name
                   << " -> type=" << eventSnapshot.type
                   << ", target=" << eventSnapshot.target
                   << ", time=" << eventSnapshot.timeSeconds
                   << ", state=" << state.stateName;
      logRuntimeLine(eventMessage.str());

      if (eventSnapshot.type == "audio_event") {
        triggerAudioEvent(eventSnapshot.target, std::string(reason) + ":animation_state_event");
      }
    }
  }

  std::string selectRuntimeAnimationState() const {
    if (activeAnimationGraphName_.empty()) {
      return {};
    }
    if (activeControlledEntityMoveSpeed_ > 0.2F) {
      if (animationSystem_.resolveGraphState(activeAnimationGraphName_, "walk").has_value()) {
        return "walk";
      }
    }
    if (animationSystem_.resolveGraphState(activeAnimationGraphName_, "idle").has_value()) {
      return "idle";
    }
    return activeAnimationEntryState_;
  }

  void updateAnimationRuntimeState(double deltaSeconds) {
    if (activeAnimationGraphName_.empty()) {
      return;
    }

    const std::string desiredState = selectRuntimeAnimationState();
    if (desiredState.empty()) {
      return;
    }

    const auto resolvedState = animationSystem_.resolveGraphState(activeAnimationGraphName_, desiredState);
    if (!resolvedState.has_value()) {
      return;
    }

    if (activeAnimationState_ != resolvedState->stateName || activeAnimationClip_ != resolvedState->clipName) {
      activeAnimationState_ = resolvedState->stateName;
      activeAnimationClip_ = resolvedState->clipName;
      activeAnimationStateTimeSeconds_ = 0.0;

      std::ostringstream message;
      message << "Animation state " << resolvedState->graphName << '.' << resolvedState->stateName
              << " active via runtime_state"
              << ": clip=" << resolvedState->clipName
              << ", speed=" << resolvedState->speed
              << ", duration=" << resolvedState->durationSeconds
              << ", root_motion_meters=" << resolvedState->rootMotionMeters;
      logRuntimeLine(message.str());
    }

    if (deltaSeconds <= 0.0 || resolvedState->durationSeconds <= 0.0) {
      return;
    }

    const double previousTime = activeAnimationStateTimeSeconds_;
    const double advancedTime = previousTime + deltaSeconds * resolvedState->speed;

    if (resolvedState->loop) {
      double localStart = previousTime;
      double remainingTime = advancedTime;
      while (remainingTime >= resolvedState->durationSeconds) {
        emitAnimationStateEvents(*resolvedState, localStart, resolvedState->durationSeconds, resolvedState->stateName);
        remainingTime -= resolvedState->durationSeconds;
        localStart = 0.0;
      }
      emitAnimationStateEvents(*resolvedState, localStart, remainingTime, resolvedState->stateName);
      activeAnimationStateTimeSeconds_ = remainingTime;
      return;
    }

    const double clampedTime = std::min(advancedTime, resolvedState->durationSeconds);
    emitAnimationStateEvents(*resolvedState, previousTime, clampedTime, resolvedState->stateName);
    activeAnimationStateTimeSeconds_ = clampedTime;
  }

  void logPhysicsQueries(std::string_view reason) {
    std::array<double, 3> rayOrigin{0.0, 3.0, 0.0};
    std::array<double, 3> overlapCenter{0.0, 0.5, 0.0};
    if (activeControlledEntity_.valid) {
      rayOrigin = {
        static_cast<double>(activeControlledEntity_.position[0]),
        static_cast<double>(activeControlledEntity_.position[1] + 1.6F),
        static_cast<double>(activeControlledEntity_.position[2]),
      };
      overlapCenter = {
        static_cast<double>(activeControlledEntity_.position[0]),
        static_cast<double>(activeControlledEntity_.position[1]),
        static_cast<double>(activeControlledEntity_.position[2]),
      };
    }

    const auto raycastHit = physicsSystem_.raycastScene(
      activeSceneName_.empty() ? config_.scene : activeSceneName_,
      rayOrigin,
      std::array<double, 3>{0.0, -1.0, 0.0},
      10.0);
    if (raycastHit.has_value()) {
      std::ostringstream rayMessage;
      rayMessage << "Physics raycast via " << reason
                 << ": hit=" << raycastHit->bodyName
                 << ", layer=" << raycastHit->layerName
                 << ", material=" << raycastHit->materialName
                 << ", shape=" << raycastHit->shapeType
                 << ", distance=" << raycastHit->distance;
      logRuntimeLine(rayMessage.str());
    } else {
      logRuntimeLine("Physics raycast via " + std::string(reason) + ": no hit.");
    }

    const auto overlaps = physicsSystem_.overlapSphereScene(
      activeSceneName_.empty() ? config_.scene : activeSceneName_,
      overlapCenter,
      0.75);
    std::ostringstream overlapMessage;
    overlapMessage << "Physics overlap via " << reason << ": count=" << overlaps.size();
    for (const auto& overlap : overlaps) {
      overlapMessage << " [" << overlap.bodyName << ':' << overlap.layerName << ']';
    }
    logRuntimeLine(overlapMessage.str());
  }

  void logSwapchain(const char* prefix) {
    std::ostringstream message;
    message << prefix
            << ": extent=" << swapchainExtent_.width << 'x' << swapchainExtent_.height
            << ", images=" << swapchainImages_.size();
    logRuntimeLine(message.str());
  }

  void openGamepad(SDL_JoystickID instanceId) {
    if (gamepads_.contains(instanceId)) {
      return;
    }

    SDL_Gamepad* gamepad = SDL_OpenGamepad(instanceId);
    if (gamepad == nullptr) {
      logRuntimeLine("SDL_OpenGamepad failed: " + sdlErrorString());
      return;
    }

    gamepads_[instanceId] = gamepad;
    const char* name = SDL_GetGamepadName(gamepad);
    logRuntimeLine("Gamepad connected: " + std::string(name && *name ? name : "unknown gamepad"));
  }

  void closeGamepad(SDL_JoystickID instanceId) {
    const auto it = gamepads_.find(instanceId);
    if (it == gamepads_.end()) {
      return;
    }

    if (it->second != nullptr) {
      SDL_CloseGamepad(it->second);
    }
    gamepads_.erase(it);
    logRuntimeLine("Gamepad disconnected.");
  }

  void toggleToolPanel(const char* panelName, const char* label) {
    if (!toolingUi_.togglePanel(panelName)) {
      return;
    }

    std::ostringstream message;
    message << label << ' ' << (toolingUi_.panelVisible(panelName) ? "shown." : "hidden.");
    logRuntimeLine(message.str());
    logRuntimeMultiline(toolingUi_.panelRegistrySummary());
  }

  void refreshWindowTitle() {
    if (window_ == nullptr) {
      return;
    }

    const std::uint64_t now = SDL_GetTicksNS();
    std::ostringstream title;
    title << config_.title;
    if (!activeSceneName_.empty()) {
      title << " | scene=" << activeSceneName_;
      if (!activeSceneTitle_.empty() && activeSceneTitle_ != activeSceneName_) {
        title << " (" << activeSceneTitle_ << ')';
      }
      if (!activePrimaryPrefab_.empty()) {
        title << " prefab=" << activePrimaryPrefab_;
      }
      if (activeSceneEntityCount_ > 0) {
        title << " entities=" << activeSceneEntityCount_;
      }
      if (activeSceneRenderableCount_ > 0) {
        title << " renderables=" << activeSceneRenderableCount_;
      }
      if (authoredContentReloadCount_ > 0) {
        title << " reloads=" << authoredContentReloadCount_;
      }
    }
    if (!activeAnimationGraphName_.empty()) {
      title << " anim=" << activeAnimationGraphName_;
      if (!activeAnimationState_.empty()) {
        title << ':' << activeAnimationState_;
      } else if (!activeAnimationEntryState_.empty()) {
        title << ':' << activeAnimationEntryState_;
      }
      if (!activeAnimationClip_.empty()) {
        title << " clip=" << activeAnimationClip_;
      }
    }
    if (activeControlledEntity_.valid) {
      title << " | player=" << activeControlledEntity_.id
            << " pos=(" << runtimeVector3String(activeControlledEntity_.position) << ')';
      if (!activeMovementBlockedBodyName_.empty()) {
        title << " blocked=" << activeMovementBlockedBodyName_;
      }
    }
    if (activeInteractionTarget_.valid && !activeInteractionTarget_.effectName.empty()) {
      title << " target=" << activeInteractionTarget_.id;
    }
    if (!activeTriggeredInteractionEffectName_.empty() && now <= activeTriggeredInteractionUntilTicks_) {
      title << " fx=" << activeTriggeredInteractionEffectName_;
    }

    if (toolingUi_.overlayVisible()) {
      title << " | " << toolingUi_.overlaySummary();
      SDL_SetWindowTitle(window_, title.str().c_str());
      return;
    }

    if (!lastUiAction_.empty() && now > uiFlashUntilTicks_ + 1'500'000'000ULL) {
      lastUiAction_.clear();
    }

    if (!inputDebugEnabled_ && lastUiAction_.empty()) {
      SDL_SetWindowTitle(window_, title.str().c_str());
      return;
    }

    title << " | move=(" << moveX_ << ',' << moveY_ << ')'
          << " look=(" << lookX_ << ',' << lookY_ << ')';
    if (!lastUiAction_.empty()) {
      title << " ui=" << lastUiAction_;
    }

    const auto activeContexts = inputSystem_.activeContexts();
    if (!activeContexts.empty()) {
      title << " ctx=";
      for (std::size_t index = 0; index < activeContexts.size(); index += 1) {
        if (index > 0) {
          title << '+';
        }
        title << activeContexts[index];
      }
    }

    SDL_SetWindowTitle(window_, title.str().c_str());
  }

  bool controlledEntityBlockedAt(
    const std::array<float, 3>& position,
    const std::vector<PhysicsBodySnapshot>& sceneBodies,
    std::string* blockingBodyName) const {
    constexpr float kControlledEntityRadius = 0.38F;

    if (blockingBodyName != nullptr) {
      blockingBodyName->clear();
    }

    for (const auto& body : sceneBodies) {
      if (!physicsBodyBlocksControlledMovement(body)) {
        continue;
      }

      const bool blocked = body.shapeType == "box"
        ? overlapsHorizontalCircleAabb(position, kControlledEntityRadius, body)
        : overlapsHorizontalCircleSphere(position, kControlledEntityRadius, body);
      if (!blocked) {
        continue;
      }

      if (blockingBodyName != nullptr) {
        *blockingBodyName = body.name;
      }
      return true;
    }

    return false;
  }

  void updateControlledEntityMovementBlock(std::string_view bodyName) {
    const std::string normalizedBodyName(bodyName);
    if (activeMovementBlockedBodyName_ == normalizedBodyName) {
      return;
    }

    activeMovementBlockedBodyName_ = normalizedBodyName;
    if (!activeMovementBlockedBodyName_.empty()) {
      logRuntimeLine("Controlled entity movement blocked by physics body " + activeMovementBlockedBodyName_ + '.');
    }
  }

  const RuntimeSceneRenderProxy* findOverlapEffectProxyForPhysicsBody(const PhysicsBodySnapshot& body) const {
    const RuntimeSceneRenderProxy* bestProxy = nullptr;
    float bestDistanceSquared = std::numeric_limits<float>::max();

    for (const auto& proxy : activeSceneRenderProxies_) {
      if (proxy.prefabName != body.sourcePrefab || proxy.effectName.empty()) {
        continue;
      }
      if (!effectTriggerRequiresOverlap(proxy.effectTrigger)) {
        continue;
      }

      const float deltaX = proxy.worldPosition[0] - static_cast<float>(body.position[0]);
      const float deltaY = proxy.worldPosition[1] - static_cast<float>(body.position[1]);
      const float deltaZ = proxy.worldPosition[2] - static_cast<float>(body.position[2]);
      const float distanceSquared = deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ;
      if (distanceSquared < bestDistanceSquared) {
        bestDistanceSquared = distanceSquared;
        bestProxy = &proxy;
      }
    }

    return bestProxy;
  }

  void updateOverlapTriggeredEffects() {
    if (!activeControlledEntity_.valid) {
      activeOverlapTriggeredBodies_.clear();
      return;
    }

    const std::string sceneName = activeSceneName_.empty() ? config_.scene : activeSceneName_;
    const auto sceneBodies = physicsSystem_.bodiesForScene(sceneName);
    const auto overlaps = physicsSystem_.overlapSphereScene(
      sceneName,
      {
        static_cast<double>(activeControlledEntity_.position[0]),
        static_cast<double>(activeControlledEntity_.position[1]),
        static_cast<double>(activeControlledEntity_.position[2]),
      },
      0.75);

    std::unordered_set<std::string> nextTriggeredBodies;
    for (const auto& overlap : overlaps) {
      if (overlap.layerName != "Query_Only") {
        continue;
      }

      const auto bodyIt = std::find_if(
        sceneBodies.begin(),
        sceneBodies.end(),
        [&overlap](const PhysicsBodySnapshot& body) {
          return body.name == overlap.bodyName;
        });
      if (bodyIt == sceneBodies.end()) {
        continue;
      }

      const RuntimeSceneRenderProxy* proxy = findOverlapEffectProxyForPhysicsBody(*bodyIt);
      if (proxy == nullptr) {
        continue;
      }

      nextTriggeredBodies.insert(bodyIt->name);
      if (activeOverlapTriggeredBodies_.contains(bodyIt->name)) {
        continue;
      }

      activeTriggeredInteractionEntityId_ = proxy->id;
      activeTriggeredInteractionEffectName_ = proxy->effectName;
      activeTriggeredInteractionUntilTicks_ = SDL_GetTicksNS() + 650'000'000ULL;

      std::ostringstream message;
      message << "Scene overlap effect " << proxy->effectName
              << " triggered via on_overlap"
              << ": entity=" << proxy->id
              << ", body=" << bodyIt->name
              << ", prefab=" << proxy->prefabName
              << ", position=(" << runtimeVector3String(proxy->worldPosition) << ')';
      logRuntimeLine(message.str());
      refreshWindowTitle();
    }

    activeOverlapTriggeredBodies_ = std::move(nextTriggeredBodies);
  }

  void updateToolingState(double deltaSeconds) {
    toolingUi_.recordFrame(deltaSeconds, activeSceneName_.empty() ? config_.scene : activeSceneName_);
    toolingUi_.recordInputState(moveX_, moveY_, lookX_, lookY_, lastUiAction_, inputDebugEnabled_);
    toolingUi_.recordRuntimeState(ToolingRuntimeStateSnapshot{
      .controlledEntityId = activeControlledEntity_.id,
      .controlledEntityPosition = activeControlledEntity_.valid ? runtimeVector3String(activeControlledEntity_.position) : std::string{},
      .blockedBodyName = activeMovementBlockedBodyName_,
      .animationGraphName = activeAnimationGraphName_,
      .animationStateName = activeAnimationState_,
      .animationClipName = activeAnimationClip_,
      .interactionTargetId = activeInteractionTarget_.id,
      .interactionEffectName = activeInteractionTarget_.effectName,
      .activeTriggeredEffectName = activeTriggeredInteractionEffectName_,
      .moveSpeed = activeControlledEntityMoveSpeed_,
      .controlledEntityValid = activeControlledEntity_.valid,
      .interactionTargetValid = activeInteractionTarget_.valid,
    });

    const std::uint64_t now = SDL_GetTicksNS();
    if (toolingUi_.overlayVisible() && now >= nextToolingLogTicks_) {
      logRuntimeLine(toolingUi_.overlaySummary());
      nextToolingLogTicks_ = now + 2'500'000'000ULL;
    }

    refreshWindowTitle();
  }

  void updateRuntimeSceneState(double deltaSeconds) {
    if (!activeControlledEntity_.valid) {
      activeControlledEntityMoveSpeed_ = 0.0F;
      return;
    }

    constexpr float kMoveSpeedUnitsPerSecond = 3.5F;
    constexpr float kLookSpeedDegreesPerSecond = 90.0F;
    constexpr float kPi = 3.1415926535F;

    activeControlledEntity_.rotation[1] += lookX_ * kLookSpeedDegreesPerSecond * static_cast<float>(deltaSeconds);
    activeControlledEntity_.rotation[0] = std::clamp(
      activeControlledEntity_.rotation[0] + lookY_ * kLookSpeedDegreesPerSecond * static_cast<float>(deltaSeconds),
      -89.0F,
      89.0F);

    const float yawRadians = activeControlledEntity_.rotation[1] * (kPi / 180.0F);
    const float forwardX = std::sin(yawRadians);
    const float forwardZ = std::cos(yawRadians);
    const float rightX = std::cos(yawRadians);
    const float rightZ = -std::sin(yawRadians);
    const float deltaX =
      ((forwardX * moveY_) + (rightX * moveX_)) * kMoveSpeedUnitsPerSecond * static_cast<float>(deltaSeconds);
    const float deltaZ =
      ((forwardZ * moveY_) + (rightZ * moveX_)) * kMoveSpeedUnitsPerSecond * static_cast<float>(deltaSeconds);

    const auto sceneBodies = physicsSystem_.bodiesForScene(activeSceneName_.empty() ? config_.scene : activeSceneName_);
    std::string blockingBodyName;
    std::array<float, 3> nextPosition = activeControlledEntity_.position;

    if (std::abs(deltaX) > 0.0001F) {
      auto axisCandidate = nextPosition;
      axisCandidate[0] += deltaX;
      if (!controlledEntityBlockedAt(axisCandidate, sceneBodies, &blockingBodyName)) {
        nextPosition[0] = axisCandidate[0];
      }
    }

    if (std::abs(deltaZ) > 0.0001F) {
      auto axisCandidate = nextPosition;
      axisCandidate[2] += deltaZ;
      if (!controlledEntityBlockedAt(axisCandidate, sceneBodies, &blockingBodyName)) {
        nextPosition[2] = axisCandidate[2];
      }
    }

    const std::array<float, 3> previousPosition = activeControlledEntity_.position;
    activeControlledEntity_.position = nextPosition;
    const float movementDistance = std::sqrt(
      std::pow(activeControlledEntity_.position[0] - previousPosition[0], 2.0F)
      + std::pow(activeControlledEntity_.position[2] - previousPosition[2], 2.0F));
    activeControlledEntityMoveSpeed_ =
      deltaSeconds > 0.0 ? movementDistance / static_cast<float>(deltaSeconds) : 0.0F;
    updateControlledEntityMovementBlock(blockingBodyName);
  }

  void updateInputDrivenState() {
    if (inputSystem_.actionPressed("runtime_exit")) {
      runtimeExitRequested_ = true;
    }

    if (inputSystem_.actionPressed("toggle_input_debug")) {
      inputDebugEnabled_ = !inputDebugEnabled_;
      logRuntimeLine(std::string("Input diagnostics ") + (inputDebugEnabled_ ? "enabled." : "disabled."));
      if (inputDebugEnabled_) {
        logRuntimeMultiline(inputSystem_.bindingSummary());
      }
    }

    if (inputSystem_.actionPressed("toggle_tooling_overlay")) {
      toolingUi_.toggleOverlay();
      logRuntimeLine(std::string("Tooling overlay ") + (toolingUi_.overlayVisible() ? "enabled." : "hidden."));
      logRuntimeMultiline(toolingUi_.panelRegistrySummary());
    }

    if (inputSystem_.actionPressed("toggle_runtime_stats_panel")) {
      toggleToolPanel("runtime_stats", "Runtime Stats panel");
    }

    if (inputSystem_.actionPressed("toggle_input_panel")) {
      toggleToolPanel("input_debug", "Input Debug panel");
    }

    if (inputSystem_.actionPressed("toggle_log_panel")) {
      toggleToolPanel("log_view", "Log View panel");
    }

    if (inputSystem_.actionPressed("toggle_debug_state_panel")) {
      toggleToolPanel("debug_state", "Debug State panel");
    }

    if (inputSystem_.actionPressed("reload_runtime_content")) {
      lastUiAction_ = "reload_runtime_content";
      uiFlashUntilTicks_ = SDL_GetTicksNS() + 350'000'000ULL;
      lastObservedAuthoredContentTimestamp_ = authoredContentTimestamp();
      (void)reloadRuntimeContent("manual_reload");
    }

    if (inputSystem_.actionPressed("ui_accept")) {
      lastUiAction_ = "ui_accept";
      uiFlashUntilTicks_ = SDL_GetTicksNS() + 350'000'000ULL;
      logRuntimeLine("ui_accept action triggered.");
      logControlledEntityState("ui_accept");
      logInteractionTarget("ui_accept");
      triggerSceneInteraction("ui_accept");
      triggerAudioEvent("ui_accept", "ui_accept");
    }

    if (inputSystem_.actionPressed("ui_back")) {
      lastUiAction_ = "ui_back";
      uiFlashUntilTicks_ = SDL_GetTicksNS() + 350'000'000ULL;
      logRuntimeLine("ui_back action triggered.");
      logControlledEntityState("ui_back");
      triggerAnimationGraph(activeAnimationGraphName_, "ui_back");
      logPhysicsQueries("ui_back");
    }

    moveX_ = inputSystem_.actionValue("move_x");
    moveY_ = inputSystem_.actionValue("move_y");
    lookX_ = inputSystem_.actionValue("look_x");
    lookY_ = inputSystem_.actionValue("look_y");
  }

  bool pumpEvents() {
    bool keepRunning = true;
    SDL_Event event{};
    while (SDL_PollEvent(&event)) {
      inputSystem_.handleSdlEvent(event);

      switch (event.type) {
        case SDL_EVENT_QUIT:
        case SDL_EVENT_WINDOW_CLOSE_REQUESTED:
          keepRunning = false;
          break;
        case SDL_EVENT_WINDOW_RESIZED:
        case SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED:
          framebufferDirty_ = true;
          break;
        case SDL_EVENT_GAMEPAD_ADDED:
          openGamepad(event.gdevice.which);
          break;
        case SDL_EVENT_GAMEPAD_REMOVED:
          closeGamepad(event.gdevice.which);
          break;
        default:
          break;
      }
    }

    updateInputDrivenState();
    if (runtimeExitRequested_) {
      keepRunning = false;
    }

    return keepRunning;
  }

  void mainLoop() {
    bool running = true;
    while (running) {
      inputSystem_.beginFrame();
      running = pumpEvents();
      if (!running) {
        break;
      }

      if (!drawableAreaAvailable()) {
        std::this_thread::sleep_for(std::chrono::milliseconds(16));
        continue;
      }

      if (framebufferDirty_) {
        recreateSwapchain();
      }

      const std::uint64_t currentTicks = SDL_GetTicksNS();
      const double deltaSeconds = previousFrameTicks_ == 0
        ? (1.0 / 60.0)
        : static_cast<double>(currentTicks - previousFrameTicks_) / 1'000'000'000.0;
      previousFrameTicks_ = currentTicks;

      pollAuthoredContentReload(currentTicks);
      updateRuntimeSceneState(deltaSeconds);
      updateAnimationRuntimeState(deltaSeconds);
      updateOverlapTriggeredEffects();
      updateInteractionTargetFromView();
      updateToolingState(deltaSeconds);

      const std::uint64_t elapsedTicks = currentTicks - startTicks_;
      const double elapsedSeconds = static_cast<double>(elapsedTicks) / 1'000'000'000.0;
      drawFrame(elapsedSeconds);
    }
  }

  bool clipRectToSwapchain(VkRect2D* rect) const {
    if (rect == nullptr || swapchainExtent_.width == 0 || swapchainExtent_.height == 0) {
      return false;
    }

    const std::int32_t minX = std::max(rect->offset.x, 0);
    const std::int32_t minY = std::max(rect->offset.y, 0);
    const std::int32_t maxX = std::min(
      rect->offset.x + static_cast<std::int32_t>(rect->extent.width),
      static_cast<std::int32_t>(swapchainExtent_.width));
    const std::int32_t maxY = std::min(
      rect->offset.y + static_cast<std::int32_t>(rect->extent.height),
      static_cast<std::int32_t>(swapchainExtent_.height));

    if (maxX <= minX || maxY <= minY) {
      return false;
    }

    rect->offset = {minX, minY};
    rect->extent = {
      static_cast<std::uint32_t>(maxX - minX),
      static_cast<std::uint32_t>(maxY - minY),
    };
    return true;
  }

  std::optional<RuntimeProjectedProxy> projectSceneRenderProxy(const RuntimeSceneRenderProxy& proxy, double elapsedSeconds) const {
    if (proxy.id.empty()) {
      return std::nullopt;
    }
    if (activeControlledEntity_.valid && proxy.id == activeControlledEntity_.id) {
      return std::nullopt;
    }

    const std::array<float, 3> cameraPosition = activeControlledEntity_.valid
      ? activeControlledEntity_.position
      : std::array<float, 3>{0.0F, 1.6F, -4.0F};
    const std::array<float, 3> cameraRotation = activeControlledEntity_.valid
      ? activeControlledEntity_.rotation
      : std::array<float, 3>{0.0F, 0.0F, 0.0F};

    const float yawRadians = cameraRotation[1] * (3.1415926535F / 180.0F);
    const float pitchRadians = cameraRotation[0] * (3.1415926535F / 180.0F);
    const float cosYaw = std::cos(yawRadians);
    const float sinYaw = std::sin(yawRadians);
    const float cosPitch = std::cos(pitchRadians);
    const float sinPitch = std::sin(pitchRadians);

    const std::array<float, 3> delta = {
      proxy.worldPosition[0] - cameraPosition[0],
      proxy.worldPosition[1] - cameraPosition[1],
      proxy.worldPosition[2] - cameraPosition[2],
    };

    const float localX = delta[0] * cosYaw + delta[2] * -sinYaw;
    const float localY = delta[1];
    const float localZ = delta[0] * sinYaw + delta[2] * cosYaw;
    const float viewY = localY * cosPitch + localZ * sinPitch;
    const float viewZ = -localY * sinPitch + localZ * cosPitch;
    if (viewZ <= 0.15F) {
      return std::nullopt;
    }

    const float aspect = static_cast<float>(swapchainExtent_.width) / static_cast<float>(swapchainExtent_.height);
    const float tanHalfVertical = std::tan(70.0F * (3.1415926535F / 180.0F) * 0.5F);
    const float tanHalfHorizontal = tanHalfVertical * aspect;
    const float xNdc = localX / (viewZ * tanHalfHorizontal);
    const float yNdc = viewY / (viewZ * tanHalfVertical);
    if (xNdc < -1.35F || xNdc > 1.35F || yNdc < -1.35F || yNdc > 1.35F) {
      return std::nullopt;
    }

    const float proxyWidth = std::max(proxy.dimensions[0], proxy.dimensions[2]);
    const float proxyHeight = std::max(proxy.dimensions[1], 0.35F);
    const float halfWidthPixels = std::max(
      6.0F,
      0.5F * (proxyWidth / std::max(viewZ, 0.15F)) / tanHalfHorizontal * static_cast<float>(swapchainExtent_.width) * 0.5F);
    const float halfHeightPixels = std::max(
      8.0F,
      0.5F * (proxyHeight / std::max(viewZ, 0.15F)) / tanHalfVertical * static_cast<float>(swapchainExtent_.height) * 0.5F);

    const float centerX = (xNdc * 0.5F + 0.5F) * static_cast<float>(swapchainExtent_.width);
    const float centerY = (0.5F - yNdc * 0.5F) * static_cast<float>(swapchainExtent_.height);

    RuntimeProjectedProxy projected;
    projected.depth = viewZ;
    projected.bodyRect = buildRect(
      static_cast<std::int32_t>(std::round(centerX - halfWidthPixels)),
      static_cast<std::int32_t>(std::round(centerY - halfHeightPixels)),
      static_cast<std::uint32_t>(std::max(2.0F, std::round(halfWidthPixels * 2.0F))),
      static_cast<std::uint32_t>(std::max(2.0F, std::round(halfHeightPixels * 2.0F))));

    const bool interactionTarget = activeInteractionTarget_.valid && proxy.id == activeInteractionTarget_.id;
    const bool interactionTriggered =
      !activeTriggeredInteractionEntityId_.empty()
      && proxy.id == activeTriggeredInteractionEntityId_
      && SDL_GetTicksNS() <= activeTriggeredInteractionUntilTicks_;
    const float pulse = 0.55F + 0.45F * static_cast<float>(std::sin(elapsedSeconds * 2.2 + viewZ));
    projected.bodyColor = interactionTriggered
      ? std::array<float, 4>{
          clampUnit(0.82F + pulse * 0.14F),
          clampUnit(0.46F + pulse * 0.16F),
          clampUnit(0.18F + pulse * 0.12F),
          1.0F,
        }
      : debugProxyColor(proxy, interactionTarget, pulse);

    if (interactionTarget || proxy.hasEffectComponent || interactionTriggered) {
      projected.hasAccent = true;
      projected.accentRect = buildRect(
        projected.bodyRect.offset.x - 4,
        projected.bodyRect.offset.y - 4,
        projected.bodyRect.extent.width + 8,
        projected.bodyRect.extent.height + 8);
      projected.accentColor = interactionTriggered
        ? std::array<float, 4>{clampUnit(0.92F + pulse * 0.06F), clampUnit(0.72F + pulse * 0.08F), clampUnit(0.28F + pulse * 0.12F), 1.0F}
        : interactionTarget
          ? std::array<float, 4>{clampUnit(0.18F + pulse * 0.28F), clampUnit(0.58F + pulse * 0.22F), clampUnit(0.70F + pulse * 0.18F), 1.0F}
          : std::array<float, 4>{0.20F, 0.30F, 0.38F, 1.0F};
    }

    if (!clipRectToSwapchain(&projected.bodyRect)) {
      return std::nullopt;
    }
    if (projected.hasAccent && !clipRectToSwapchain(&projected.accentRect)) {
      projected.hasAccent = false;
    }

    return projected;
  }

  std::vector<RuntimeProjectedProxy> projectSceneRenderProxies(double elapsedSeconds) const {
    std::vector<RuntimeProjectedProxy> projected;
    projected.reserve(activeSceneRenderProxies_.size());

    for (const auto& proxy : activeSceneRenderProxies_) {
      const auto projectedProxy = projectSceneRenderProxy(proxy, elapsedSeconds);
      if (projectedProxy.has_value()) {
        projected.push_back(*projectedProxy);
      }
    }

    std::sort(
      projected.begin(),
      projected.end(),
      [](const RuntimeProjectedProxy& left, const RuntimeProjectedProxy& right) {
        return left.depth > right.depth;
      });
    return projected;
  }

  void recordSceneProxyPass(VkCommandBuffer commandBuffer, double elapsedSeconds) {
    if (swapchainExtent_.width == 0 || swapchainExtent_.height == 0) {
      return;
    }

    const float cameraPitch = activeControlledEntity_.valid ? activeControlledEntity_.rotation[0] : 0.0F;
    const float horizonShift = std::clamp(cameraPitch / 90.0F, -0.3F, 0.3F);
    const std::int32_t horizonY = static_cast<std::int32_t>(
      std::round((0.54F + horizonShift * 0.18F) * static_cast<float>(swapchainExtent_.height)));
    VkRect2D horizonRect = buildRect(0, horizonY, swapchainExtent_.width, 2);
    if (clipRectToSwapchain(&horizonRect)) {
      clearAttachmentRect(commandBuffer, horizonRect, {0.18F, 0.20F, 0.24F, 1.0F});
    }

    const auto projectedProxies = projectSceneRenderProxies(elapsedSeconds);
    for (const auto& proxy : projectedProxies) {
      if (proxy.hasAccent) {
        clearAttachmentRect(commandBuffer, proxy.accentRect, proxy.accentColor);
      }
      clearAttachmentRect(commandBuffer, proxy.bodyRect, proxy.bodyColor);
    }

    const bool interactionTargetLocked = activeInteractionTarget_.valid && !activeInteractionTarget_.effectName.empty();
    const bool interactionTriggered = SDL_GetTicksNS() <= activeTriggeredInteractionUntilTicks_ && !activeTriggeredInteractionEntityId_.empty();
    const float crosshairPulse = SDL_GetTicksNS() <= uiFlashUntilTicks_ ? 1.0F : 0.0F;
    const std::array<float, 4> crosshairColor = interactionTriggered
      ? std::array<float, 4>{
          clampUnit(0.94F + crosshairPulse * 0.04F),
          clampUnit(0.72F + crosshairPulse * 0.12F),
          clampUnit(0.24F + crosshairPulse * 0.16F),
          1.0F,
        }
      : interactionTargetLocked
        ? std::array<float, 4>{
            clampUnit(0.38F + crosshairPulse * 0.14F),
            clampUnit(0.78F + crosshairPulse * 0.12F),
            clampUnit(0.84F + crosshairPulse * 0.10F),
            1.0F,
          }
        : std::array<float, 4>{
            clampUnit(0.76F + crosshairPulse * 0.18F),
            clampUnit(0.78F + crosshairPulse * 0.12F),
            clampUnit(0.72F + crosshairPulse * 0.18F),
            1.0F,
          };
    const std::int32_t centerX = static_cast<std::int32_t>(swapchainExtent_.width / 2);
    const std::int32_t centerY = static_cast<std::int32_t>(swapchainExtent_.height / 2);
    VkRect2D horizontal = buildRect(centerX - 9, centerY - 1, 18, 2);
    VkRect2D vertical = buildRect(centerX - 1, centerY - 9, 2, 18);
    if (clipRectToSwapchain(&horizontal)) {
      clearAttachmentRect(commandBuffer, horizontal, crosshairColor);
    }
    if (clipRectToSwapchain(&vertical)) {
      clearAttachmentRect(commandBuffer, vertical, crosshairColor);
    }
  }

  void drawFrame(double elapsedSeconds) {
    FrameSync& frame = frames_[currentFrame_];

    throwVkIfFailed(vkWaitForFences(device_, 1, &frame.inFlight, VK_TRUE, std::numeric_limits<std::uint64_t>::max()), "vkWaitForFences");

    std::uint32_t imageIndex = 0;
    VkResult acquireResult =
      vkAcquireNextImageKHR(device_, swapchain_, std::numeric_limits<std::uint64_t>::max(), frame.imageAvailable, VK_NULL_HANDLE, &imageIndex);

    if (acquireResult == VK_ERROR_OUT_OF_DATE_KHR) {
      recreateSwapchain();
      return;
    }
    if (acquireResult != VK_SUCCESS && acquireResult != VK_SUBOPTIMAL_KHR) {
      throwVkIfFailed(acquireResult, "vkAcquireNextImageKHR");
    }

    throwVkIfFailed(vkResetFences(device_, 1, &frame.inFlight), "vkResetFences");
    throwVkIfFailed(vkResetCommandBuffer(commandBuffers_[currentFrame_], 0), "vkResetCommandBuffer");

    recordCommandBuffer(commandBuffers_[currentFrame_], imageIndex, elapsedSeconds);

    const VkPipelineStageFlags waitStages[] = {VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT};
    VkSubmitInfo submitInfo{};
    submitInfo.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
    submitInfo.waitSemaphoreCount = 1;
    submitInfo.pWaitSemaphores = &frame.imageAvailable;
    submitInfo.pWaitDstStageMask = waitStages;
    submitInfo.commandBufferCount = 1;
    submitInfo.pCommandBuffers = &commandBuffers_[currentFrame_];
    submitInfo.signalSemaphoreCount = 1;
    submitInfo.pSignalSemaphores = &frame.renderFinished;

    throwVkIfFailed(vkQueueSubmit(graphicsQueue_, 1, &submitInfo, frame.inFlight), "vkQueueSubmit");

    VkPresentInfoKHR presentInfo{};
    presentInfo.sType = VK_STRUCTURE_TYPE_PRESENT_INFO_KHR;
    presentInfo.waitSemaphoreCount = 1;
    presentInfo.pWaitSemaphores = &frame.renderFinished;
    presentInfo.swapchainCount = 1;
    presentInfo.pSwapchains = &swapchain_;
    presentInfo.pImageIndices = &imageIndex;

    const VkResult presentResult = vkQueuePresentKHR(graphicsQueue_, &presentInfo);
    if (presentResult == VK_ERROR_OUT_OF_DATE_KHR || presentResult == VK_SUBOPTIMAL_KHR || framebufferDirty_) {
      recreateSwapchain();
    } else if (presentResult != VK_SUCCESS) {
      throwVkIfFailed(presentResult, "vkQueuePresentKHR");
    }

    currentFrame_ = (currentFrame_ + 1) % kMaxFramesInFlight;
  }

  void recordCommandBuffer(VkCommandBuffer commandBuffer, std::uint32_t imageIndex, double elapsedSeconds) {
    VkCommandBufferBeginInfo beginInfo{};
    beginInfo.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_BEGIN_INFO;
    beginInfo.flags = VK_COMMAND_BUFFER_USAGE_ONE_TIME_SUBMIT_BIT;
    throwVkIfFailed(vkBeginCommandBuffer(commandBuffer, &beginInfo), "vkBeginCommandBuffer");

    const float pulse = 0.5f + 0.5f * static_cast<float>(std::sin(elapsedSeconds));
    const float accent = 0.5f + 0.5f * static_cast<float>(std::sin(elapsedSeconds * 0.5 + 1.0));
    const float uiFlash = SDL_GetTicksNS() <= uiFlashUntilTicks_ ? 0.08F : 0.0F;

    VkClearValue clearValue{};
    clearValue.color = {{
      std::clamp(0.06F + pulse * 0.16F + moveX_ * 0.09F + lookX_ * 0.04F + uiFlash, 0.0F, 1.0F),
      std::clamp(0.08F + accent * 0.24F + moveY_ * 0.09F + uiFlash * 0.5F, 0.0F, 1.0F),
      std::clamp(0.14F + (1.0F - pulse) * 0.12F + lookY_ * 0.08F, 0.0F, 1.0F),
      1.0f,
    }};

    VkRenderPassBeginInfo renderPassInfo{};
    renderPassInfo.sType = VK_STRUCTURE_TYPE_RENDER_PASS_BEGIN_INFO;
    renderPassInfo.renderPass = renderPass_;
    renderPassInfo.framebuffer = swapchainFramebuffers_.at(imageIndex);
    renderPassInfo.renderArea.offset = {0, 0};
    renderPassInfo.renderArea.extent = swapchainExtent_;
    renderPassInfo.clearValueCount = 1;
    renderPassInfo.pClearValues = &clearValue;

    vkCmdBeginRenderPass(commandBuffer, &renderPassInfo, VK_SUBPASS_CONTENTS_INLINE);
    recordSceneProxyPass(commandBuffer, elapsedSeconds);
    vkCmdEndRenderPass(commandBuffer);

    throwVkIfFailed(vkEndCommandBuffer(commandBuffer), "vkEndCommandBuffer");
  }

  void cleanup() {
    if (device_ != VK_NULL_HANDLE) {
      vkDeviceWaitIdle(device_);
    }

    std::string toolingSaveError;
    if (!toolingUi_.saveSessionLayout(&toolingSaveError)) {
      logLine("Tooling layout save failed: " + toolingSaveError);
    }

    if (device_ != VK_NULL_HANDLE) {
      destroySwapchainResources();

      for (auto& frame : frames_) {
        if (frame.inFlight != VK_NULL_HANDLE) {
          vkDestroyFence(device_, frame.inFlight, nullptr);
          frame.inFlight = VK_NULL_HANDLE;
        }
        if (frame.renderFinished != VK_NULL_HANDLE) {
          vkDestroySemaphore(device_, frame.renderFinished, nullptr);
          frame.renderFinished = VK_NULL_HANDLE;
        }
        if (frame.imageAvailable != VK_NULL_HANDLE) {
          vkDestroySemaphore(device_, frame.imageAvailable, nullptr);
          frame.imageAvailable = VK_NULL_HANDLE;
        }
      }

      if (commandPool_ != VK_NULL_HANDLE) {
        vkDestroyCommandPool(device_, commandPool_, nullptr);
        commandPool_ = VK_NULL_HANDLE;
      }

      vkDestroyDevice(device_, nullptr);
      device_ = VK_NULL_HANDLE;
    }

    if (surface_ != VK_NULL_HANDLE && instance_ != VK_NULL_HANDLE) {
      vkDestroySurfaceKHR(instance_, surface_, nullptr);
      surface_ = VK_NULL_HANDLE;
    }

    if (instance_ != VK_NULL_HANDLE) {
      vkDestroyInstance(instance_, nullptr);
      instance_ = VK_NULL_HANDLE;
    }

    if (window_ != nullptr) {
      SDL_DestroyWindow(window_);
      window_ = nullptr;
    }

    for (auto& [instanceId, gamepad] : gamepads_) {
      (void)instanceId;
      if (gamepad != nullptr) {
        SDL_CloseGamepad(gamepad);
      }
    }
    gamepads_.clear();

    if (sdlInitialized_) {
      SDL_Quit();
      sdlInitialized_ = false;
    }
  }

  RuntimeConfig config_;
  AnimationSystem animationSystem_;
  AudioSystem audioSystem_;
  DataFoundation dataFoundation_;
  InputSystem inputSystem_;
  PhysicsSystem physicsSystem_;
  ToolingUiSystem toolingUi_;
  SDL_Window* window_ = nullptr;
  bool sdlInitialized_ = false;
  std::unordered_map<SDL_JoystickID, SDL_Gamepad*> gamepads_;

  VkInstance instance_ = VK_NULL_HANDLE;
  VkSurfaceKHR surface_ = VK_NULL_HANDLE;
  VkPhysicalDevice physicalDevice_ = VK_NULL_HANDLE;
  VkDevice device_ = VK_NULL_HANDLE;
  VkQueue graphicsQueue_ = VK_NULL_HANDLE;
  std::uint32_t graphicsQueueFamily_ = 0;
  std::string physicalDeviceName_;
  bool validationEnabled_ = false;

  VkSwapchainKHR swapchain_ = VK_NULL_HANDLE;
  VkFormat swapchainImageFormat_ = VK_FORMAT_UNDEFINED;
  VkExtent2D swapchainExtent_{};
  std::vector<VkImage> swapchainImages_;
  std::vector<VkImageView> swapchainImageViews_;
  std::vector<VkFramebuffer> swapchainFramebuffers_;
  VkRenderPass renderPass_ = VK_NULL_HANDLE;

  VkCommandPool commandPool_ = VK_NULL_HANDLE;
  std::vector<VkCommandBuffer> commandBuffers_;
  std::array<FrameSync, kMaxFramesInFlight> frames_{};
  std::uint32_t currentFrame_ = 0;

  bool framebufferDirty_ = false;
  bool runtimeExitRequested_ = false;
  bool inputDebugEnabled_ = false;
  float moveX_ = 0.0F;
  float moveY_ = 0.0F;
  float lookX_ = 0.0F;
  float lookY_ = 0.0F;
  std::string activeSceneName_;
  std::string activeSceneTitle_;
  std::string activePrimaryPrefab_;
  std::size_t activeSceneEntityCount_ = 0;
  std::size_t activeSceneRootCount_ = 0;
  std::size_t activeScenePrefabCount_ = 0;
  std::size_t activeSceneRenderableCount_ = 0;
  std::string activeAnimationGraphName_;
  std::string activeAnimationEntryState_;
  std::string activeAnimationEntryClip_;
  std::string activeAnimationState_;
  std::string activeAnimationClip_;
  double activeAnimationStateTimeSeconds_ = 0.0;
  float activeControlledEntityMoveSpeed_ = 0.0F;
  RuntimeControlledEntityState activeControlledEntity_;
  RuntimeControlledEntityState activeInteractionTarget_;
  std::string activeMovementBlockedBodyName_;
  std::unordered_set<std::string> activeOverlapTriggeredBodies_;
  std::vector<RuntimeSceneRenderProxy> activeSceneRenderProxies_;
  std::string activeTriggeredInteractionEntityId_;
  std::string activeTriggeredInteractionEffectName_;
  std::string lastUiAction_;
  bool sceneSelectedFromBootstrap_ = false;
  bool hasBootstrapOverlayPreference_ = false;
  bool bootstrapOverlayEnabled_ = true;
  bool bootstrapOverlayApplied_ = false;
  std::optional<std::filesystem::file_time_type> lastObservedAuthoredContentTimestamp_;
  std::size_t authoredContentReloadCount_ = 0;
  std::uint64_t activeTriggeredInteractionUntilTicks_ = 0;
  std::uint64_t uiFlashUntilTicks_ = 0;
  std::uint64_t startTicks_ = 0;
  std::uint64_t previousFrameTicks_ = 0;
  std::uint64_t nextToolingLogTicks_ = 0;
  std::uint64_t nextAuthoredContentPollTicks_ = 0;
};

int runNativeRuntime(const RuntimeConfig& config) {
  NativeRuntime runtime(config);
  return runtime.run();
}

#endif

}  // namespace

int RuntimeApp::run(const RuntimeConfig& config) {
#if SHADER_FORGE_NATIVE_RUNTIME
  try {
    return runNativeRuntime(config);
  } catch (const std::exception& error) {
    logLine(error.what());
    return 1;
  }
#else
  (void)config;
  logLine("shader_forge_runtime built in stub mode. Install SDL3 development files, Vulkan headers/loader, and CMake to launch the native runtime.");
  return 2;
#endif
}

}  // namespace shader_forge::runtime
