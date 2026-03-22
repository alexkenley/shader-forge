cmake_minimum_required(VERSION 3.24)

project(
  ShaderForge
  VERSION 0.1.0
  DESCRIPTION "Shader Forge native runtime"
  LANGUAGES CXX
)

option(SHADER_FORGE_BUILD_RUNTIME "Build the native engine runtime." ON)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(SHADER_FORGE_BUILD_RUNTIME)
  add_subdirectory(engine/runtime)
endif()
