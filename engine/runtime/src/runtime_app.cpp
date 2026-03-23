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
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <unordered_map>
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

#if SHADER_FORGE_NATIVE_RUNTIME

constexpr const char* kValidationLayerName = "VK_LAYER_KHRONOS_validation";
constexpr std::uint32_t kMaxFramesInFlight = 2;

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

  void resolveDataDrivenRuntimeState() {
    activeSceneName_ = config_.scene;
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

  void resolveAnimationRuntimeState() {
    activeAnimationGraphName_.clear();
    activeAnimationEntryState_.clear();
    activeAnimationEntryClip_.clear();

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
  }

  void applyBootstrapPreferences() {
    if (!hasBootstrapOverlayPreference_ || bootstrapOverlayEnabled_ == toolingUi_.overlayVisible()) {
      return;
    }

    toolingUi_.toggleOverlay();
    bootstrapOverlayApplied_ = true;
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
    logRuntimeMultiline(audioSystem_.busRoutingSummary());
    logRuntimeMultiline(audioSystem_.eventCatalogSummary());
    logRuntimeMultiline(animationSystem_.graphCatalogSummary());
    logRuntimeMultiline(physicsSystem_.layerMatrixSummary());
    logRuntimeMultiline(physicsSystem_.sceneBodySummary(activeSceneName_));
    logRuntimeMultiline(dataFoundation_.relationshipSummary());
    logRuntimeMultiline(dataFoundation_.cookPlanSummary());
    logRuntimeMultiline(inputSystem_.bindingSummary());
    logRuntimeMultiline(toolingUi_.panelRegistrySummary());
    triggerAudioEvent("runtime_boot", "startup");
    triggerAnimationGraph(activeAnimationGraphName_, "startup");
    logPhysicsQueries("startup");
    logSwapchain("Swapchain ready");
    logRuntimeLine(
      "Native runtime window is live. Press Escape to exit, F1 for input diagnostics, and F2-F6 for tooling panels.");
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

  void logPhysicsQueries(std::string_view reason) {
    const auto raycastHit = physicsSystem_.raycastScene(
      activeSceneName_.empty() ? config_.scene : activeSceneName_,
      std::array<double, 3>{0.0, 3.0, 0.0},
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
      std::array<double, 3>{0.0, 0.5, 0.0},
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
    }
    if (!activeAnimationGraphName_.empty()) {
      title << " anim=" << activeAnimationGraphName_;
      if (!activeAnimationEntryState_.empty()) {
        title << ':' << activeAnimationEntryState_;
      }
    }

    if (toolingUi_.overlayVisible()) {
      title << " | " << toolingUi_.overlaySummary();
      SDL_SetWindowTitle(window_, title.str().c_str());
      return;
    }

    const std::uint64_t now = SDL_GetTicksNS();
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

  void updateToolingState(double deltaSeconds) {
    toolingUi_.recordFrame(deltaSeconds, activeSceneName_.empty() ? config_.scene : activeSceneName_);
    toolingUi_.recordInputState(moveX_, moveY_, lookX_, lookY_, lastUiAction_, inputDebugEnabled_);

    const std::uint64_t now = SDL_GetTicksNS();
    if (toolingUi_.overlayVisible() && now >= nextToolingLogTicks_) {
      logRuntimeLine(toolingUi_.overlaySummary());
      nextToolingLogTicks_ = now + 2'500'000'000ULL;
    }

    refreshWindowTitle();
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

    if (inputSystem_.actionPressed("ui_accept")) {
      lastUiAction_ = "ui_accept";
      uiFlashUntilTicks_ = SDL_GetTicksNS() + 350'000'000ULL;
      logRuntimeLine("ui_accept action triggered.");
      triggerAudioEvent("ui_accept", "ui_accept");
    }

    if (inputSystem_.actionPressed("ui_back")) {
      lastUiAction_ = "ui_back";
      uiFlashUntilTicks_ = SDL_GetTicksNS() + 350'000'000ULL;
      logRuntimeLine("ui_back action triggered.");
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

      updateToolingState(deltaSeconds);

      const std::uint64_t elapsedTicks = currentTicks - startTicks_;
      const double elapsedSeconds = static_cast<double>(elapsedTicks) / 1'000'000'000.0;
      drawFrame(elapsedSeconds);
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
  std::string activeAnimationGraphName_;
  std::string activeAnimationEntryState_;
  std::string activeAnimationEntryClip_;
  std::string lastUiAction_;
  bool sceneSelectedFromBootstrap_ = false;
  bool hasBootstrapOverlayPreference_ = false;
  bool bootstrapOverlayEnabled_ = true;
  bool bootstrapOverlayApplied_ = false;
  std::uint64_t uiFlashUntilTicks_ = 0;
  std::uint64_t startTicks_ = 0;
  std::uint64_t previousFrameTicks_ = 0;
  std::uint64_t nextToolingLogTicks_ = 0;
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
