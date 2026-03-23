find_package(SDL3 CONFIG QUIET)
find_package(Vulkan QUIET)

add_executable(
  shader_forge_runtime
  src/main.cpp
  src/input_system.cpp
  src/runtime_app.cpp
)

target_include_directories(
  shader_forge_runtime
  PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_compile_features(shader_forge_runtime PRIVATE cxx_std_20)

set_target_properties(
  shader_forge_runtime
  PROPERTIES
    OUTPUT_NAME "shader_forge_runtime"
    RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
    RUNTIME_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}/bin"
    RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/bin"
    RUNTIME_OUTPUT_DIRECTORY_RELWITHDEBINFO "${CMAKE_BINARY_DIR}/bin"
    RUNTIME_OUTPUT_DIRECTORY_MINSIZEREL "${CMAKE_BINARY_DIR}/bin"
)

if(SDL3_FOUND)
  target_link_libraries(shader_forge_runtime PRIVATE SDL3::SDL3)
  target_compile_definitions(shader_forge_runtime PRIVATE SHADER_FORGE_HAS_SDL3=1)
else()
  message(WARNING "SDL3 was not found. shader_forge_runtime will build in stub mode.")
endif()

if(Vulkan_FOUND)
  target_link_libraries(shader_forge_runtime PRIVATE Vulkan::Vulkan)
  target_compile_definitions(shader_forge_runtime PRIVATE SHADER_FORGE_HAS_VULKAN=1)
else()
  message(WARNING "Vulkan was not found. shader_forge_runtime will build in stub mode.")
endif()
