#include "shader_forge/runtime/runtime_app.hpp"

#include <chrono>
#include <cstdint>
#include <exception>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
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

#if SHADER_FORGE_NATIVE_RUNTIME

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

struct SdlScope {
  ~SdlScope() {
    SDL_Quit();
  }
};

struct WindowHandle {
  SDL_Window* window = nullptr;

  ~WindowHandle() {
    if (window) {
      SDL_DestroyWindow(window);
    }
  }
};

struct InstanceHandle {
  VkInstance instance = VK_NULL_HANDLE;

  ~InstanceHandle() {
    if (instance != VK_NULL_HANDLE) {
      vkDestroyInstance(instance, nullptr);
    }
  }
};

struct SurfaceHandle {
  VkInstance instance = VK_NULL_HANDLE;
  VkSurfaceKHR surface = VK_NULL_HANDLE;

  ~SurfaceHandle() {
    if (instance != VK_NULL_HANDLE && surface != VK_NULL_HANDLE) {
      vkDestroySurfaceKHR(instance, surface, nullptr);
    }
  }
};

struct DeviceSelection {
  VkPhysicalDevice physicalDevice = VK_NULL_HANDLE;
  std::uint32_t graphicsQueueFamily = 0;
  std::string deviceName;
};

struct DeviceHandle {
  VkDevice device = VK_NULL_HANDLE;

  ~DeviceHandle() {
    if (device != VK_NULL_HANDLE) {
      vkDestroyDevice(device, nullptr);
    }
  }
};

struct QueueHandle {
  VkQueue graphicsQueue = VK_NULL_HANDLE;
};

std::vector<const char*> requiredInstanceExtensions() {
  std::uint32_t count = 0;
  const char* const* names = SDL_Vulkan_GetInstanceExtensions(&count);
  if (!names || count == 0) {
    throw std::runtime_error("SDL_Vulkan_GetInstanceExtensions returned no extensions.");
  }
  return std::vector<const char*>(names, names + count);
}

bool deviceSupportsSwapchain(VkPhysicalDevice device) {
  std::uint32_t extensionCount = 0;
  throwVkIfFailed(vkEnumerateDeviceExtensionProperties(device, nullptr, &extensionCount, nullptr), "vkEnumerateDeviceExtensionProperties(count)");
  std::vector<VkExtensionProperties> extensions(extensionCount);
  throwVkIfFailed(
    vkEnumerateDeviceExtensionProperties(device, nullptr, &extensionCount, extensions.data()),
    "vkEnumerateDeviceExtensionProperties(list)");
  for (const auto& extension : extensions) {
    if (std::string(extension.extensionName) == VK_KHR_SWAPCHAIN_EXTENSION_NAME) {
      return true;
    }
  }
  return false;
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
    if (!deviceSupportsSwapchain(device)) {
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
      return {
        .physicalDevice = device,
        .graphicsQueueFamily = familyIndex,
        .deviceName = properties.deviceName,
      };
    }
  }

  throw std::runtime_error("No Vulkan device with graphics + presentation support was found.");
}

DeviceHandle createDevice(const DeviceSelection& selection, QueueHandle& queueHandle) {
  const float queuePriority = 1.0f;
  VkDeviceQueueCreateInfo queueInfo{};
  queueInfo.sType = VK_STRUCTURE_TYPE_DEVICE_QUEUE_CREATE_INFO;
  queueInfo.queueFamilyIndex = selection.graphicsQueueFamily;
  queueInfo.queueCount = 1;
  queueInfo.pQueuePriorities = &queuePriority;

  const char* requiredExtensions[] = {VK_KHR_SWAPCHAIN_EXTENSION_NAME};
  VkDeviceCreateInfo deviceInfo{};
  deviceInfo.sType = VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO;
  deviceInfo.queueCreateInfoCount = 1;
  deviceInfo.pQueueCreateInfos = &queueInfo;
  deviceInfo.enabledExtensionCount = 1;
  deviceInfo.ppEnabledExtensionNames = requiredExtensions;

  DeviceHandle deviceHandle;
  throwVkIfFailed(vkCreateDevice(selection.physicalDevice, &deviceInfo, nullptr, &deviceHandle.device), "vkCreateDevice");
  vkGetDeviceQueue(deviceHandle.device, selection.graphicsQueueFamily, 0, &queueHandle.graphicsQueue);
  return deviceHandle;
}

int runNativeRuntime(const RuntimeConfig& config) {
  if (!SDL_SetAppMetadata("Shader Forge Runtime", "0.1.0", "com.alexkenley.shaderforge.runtime")) {
    logLine("SDL metadata setup failed: " + sdlErrorString());
  }

  if (!SDL_Init(SDL_INIT_VIDEO | SDL_INIT_EVENTS | SDL_INIT_GAMEPAD)) {
    throw std::runtime_error("SDL_Init failed: " + sdlErrorString());
  }
  SdlScope sdlScope;

  WindowHandle window;
  window.window = SDL_CreateWindow(config.title.c_str(), config.width, config.height, SDL_WINDOW_VULKAN | SDL_WINDOW_RESIZABLE);
  if (!window.window) {
    throw std::runtime_error("SDL_CreateWindow failed: " + sdlErrorString());
  }

  const auto instanceExtensions = requiredInstanceExtensions();
  VkApplicationInfo applicationInfo{};
  applicationInfo.sType = VK_STRUCTURE_TYPE_APPLICATION_INFO;
  applicationInfo.pApplicationName = config.title.c_str();
  applicationInfo.applicationVersion = VK_MAKE_API_VERSION(0, 0, 1, 0);
  applicationInfo.pEngineName = "Shader Forge";
  applicationInfo.engineVersion = VK_MAKE_API_VERSION(0, 0, 1, 0);
  applicationInfo.apiVersion = VK_API_VERSION_1_3;

  VkInstanceCreateInfo createInfo{};
  createInfo.sType = VK_STRUCTURE_TYPE_INSTANCE_CREATE_INFO;
  createInfo.pApplicationInfo = &applicationInfo;
  createInfo.enabledExtensionCount = static_cast<std::uint32_t>(instanceExtensions.size());
  createInfo.ppEnabledExtensionNames = instanceExtensions.data();

  InstanceHandle instanceHandle;
  throwVkIfFailed(vkCreateInstance(&createInfo, nullptr, &instanceHandle.instance), "vkCreateInstance");

  SurfaceHandle surfaceHandle;
  surfaceHandle.instance = instanceHandle.instance;
  if (!SDL_Vulkan_CreateSurface(window.window, instanceHandle.instance, nullptr, &surfaceHandle.surface)) {
    throw std::runtime_error("SDL_Vulkan_CreateSurface failed: " + sdlErrorString());
  }

  const DeviceSelection selection = pickDevice(instanceHandle.instance, surfaceHandle.surface);
  QueueHandle queueHandle;
  DeviceHandle deviceHandle = createDevice(selection, queueHandle);

  (void)deviceHandle;
  (void)queueHandle;

  std::ostringstream startup;
  startup << "scene=" << config.scene << ", device=" << selection.deviceName
          << ", queue-family=" << selection.graphicsQueueFamily;
  logLine(startup.str());
  logLine("Native runtime window is live. Close the window to exit.");

  bool running = true;
  while (running) {
    SDL_Event event{};
    while (SDL_PollEvent(&event)) {
      if (event.type == SDL_EVENT_QUIT) {
        running = false;
      }
    }

    std::this_thread::sleep_for(std::chrono::milliseconds(16));
  }

  return 0;
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
