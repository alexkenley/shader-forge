#pragma once
#include "Types/Renderer/Texture.h"

namespace VulkanTextureManager {
    void AllocateTexture(Texture& vkTexture);
    void CleanupTexture(Texture& vkTexture);
    void GenerateMipmaps(Texture& texture);
}
