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
- CPU-side debug-proxy projection from the selected root `player_camera`'s composed transform and strict authored perspective FOV/near/far values, with the ordinary runtime's legacy 70/0.15/1000 fallback when no camera component is authored

Current boundary:

- this is projection for debug proxies, not asset-backed geometry submission or a general camera/render-view abstraction
- no screenshot/readback capture or spatial-review renderer exists; the legacy runtime fallback cannot satisfy a future review packet's explicit camera requirement
