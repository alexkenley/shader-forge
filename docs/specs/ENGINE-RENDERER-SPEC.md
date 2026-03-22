# Engine Renderer Spec

## Purpose

The renderer is Vulkan-first and should be treated as the primary graphics backend for Shader Forge.

## Initial Scope

- instance/device/swapchain
- command submission
- resource upload path
- simple scene rendering
- debug drawing

## Current First Slice

The current renderer implementation slice covers:

- present-capable device selection
- swapchain creation and image-view management
- single-pass clear-color render-pass submission
- per-frame fence and semaphore synchronization
- resize and out-of-date swapchain recovery
