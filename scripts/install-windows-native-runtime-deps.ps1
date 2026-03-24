[CmdletBinding()]
param(
    [string]$VcpkgRoot = 'C:\src\vcpkg',
    [string]$Triplet = 'x64-windows',
    [switch]$SkipPersistUserEnvironment,
    [switch]$DisableMetrics
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $IsWindows) {
    throw "install-windows-native-runtime-deps.ps1 is intended for Windows hosts."
}

function Get-ResolvedToolchainPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RootPath
    )

    return Join-Path $RootPath 'scripts\buildsystems\vcpkg.cmake'
}

function Resolve-VulkanSdkRoot {
    if ($env:VULKAN_SDK -and (Test-Path $env:VULKAN_SDK -PathType Container)) {
        return (Resolve-Path $env:VULKAN_SDK).ProviderPath
    }

    $defaultSdkRoot = 'C:\VulkanSDK'
    if (Test-Path $defaultSdkRoot -PathType Container) {
        $latest = Get-ChildItem $defaultSdkRoot -Directory |
            Sort-Object Name -Descending |
            Select-Object -First 1
        if ($latest) {
            return $latest.FullName
        }
    }

    return $null
}

function Set-CurrentProcessEnvironment {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ResolvedVcpkgRoot
    )

    $toolchainPath = Get-ResolvedToolchainPath -RootPath $ResolvedVcpkgRoot
    $env:VCPKG_ROOT = $ResolvedVcpkgRoot
    $env:CMAKE_TOOLCHAIN_FILE = $toolchainPath
}

function Persist-UserEnvironment {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ResolvedVcpkgRoot
    )

    $toolchainPath = Get-ResolvedToolchainPath -RootPath $ResolvedVcpkgRoot
    [System.Environment]::SetEnvironmentVariable('VCPKG_ROOT', $ResolvedVcpkgRoot, 'User')
    [System.Environment]::SetEnvironmentVariable('CMAKE_TOOLCHAIN_FILE', $toolchainPath, 'User')
}

$resolvedVcpkgRoot = [System.IO.Path]::GetFullPath($VcpkgRoot)
$vcpkgExe = Join-Path $resolvedVcpkgRoot 'vcpkg.exe'
$bootstrapScript = Join-Path $resolvedVcpkgRoot 'bootstrap-vcpkg.bat'
$toolchainPath = Get-ResolvedToolchainPath -RootPath $resolvedVcpkgRoot
$gitCommand = Get-Command git -ErrorAction SilentlyContinue | Select-Object -First 1

if (-not $gitCommand) {
    throw "Git is required to clone vcpkg. Install Git for Windows and rerun this script."
}

if (-not (Test-Path $resolvedVcpkgRoot)) {
    $parentDirectory = Split-Path -Parent $resolvedVcpkgRoot
    if ($parentDirectory) {
        New-Item -ItemType Directory -Path $parentDirectory -Force | Out-Null
    }

    Write-Host "[shader-forge] Cloning vcpkg into $resolvedVcpkgRoot..."
    & $gitCommand.Source clone https://github.com/microsoft/vcpkg.git $resolvedVcpkgRoot
    if ($LASTEXITCODE -ne 0) { throw "git clone for vcpkg failed" }
} elseif (-not (Test-Path (Join-Path $resolvedVcpkgRoot '.git'))) {
    throw "$resolvedVcpkgRoot already exists but is not a vcpkg checkout."
} else {
    Write-Host "[shader-forge] Reusing existing vcpkg checkout at $resolvedVcpkgRoot."
}

Push-Location $resolvedVcpkgRoot
try {
    if (-not (Test-Path $bootstrapScript -PathType Leaf)) {
        throw "bootstrap-vcpkg.bat was not found under $resolvedVcpkgRoot."
    }

    if (-not (Test-Path $vcpkgExe -PathType Leaf)) {
        Write-Host "[shader-forge] Bootstrapping vcpkg..."
        $bootstrapArgs = @()
        if ($DisableMetrics) {
            $bootstrapArgs += '-disableMetrics'
        }
        & $bootstrapScript @bootstrapArgs
        if ($LASTEXITCODE -ne 0) { throw "bootstrap-vcpkg.bat failed" }
    } else {
        Write-Host "[shader-forge] vcpkg is already bootstrapped."
    }

    Write-Host "[shader-forge] Installing or rebuilding SDL3 with Vulkan window support for $Triplet..."
    Write-Host "[shader-forge] This uses vcpkg --recurse so an existing plain SDL3 install can be rebuilt with the Vulkan feature enabled."
    $installArgs = @('install', "sdl3[vulkan]:$Triplet", '--recurse')
    if ($DisableMetrics) {
        $installArgs += '--disable-metrics'
    }
    & $vcpkgExe @installArgs
    if ($LASTEXITCODE -ne 0) { throw "vcpkg install sdl3[vulkan]:$Triplet failed" }
} finally {
    Pop-Location
}

if (-not (Test-Path $toolchainPath -PathType Leaf)) {
    throw "Expected vcpkg toolchain file was not created at $toolchainPath."
}

Set-CurrentProcessEnvironment -ResolvedVcpkgRoot $resolvedVcpkgRoot
Write-Host "[shader-forge] Current-process VCPKG_ROOT set to $resolvedVcpkgRoot"
Write-Host "[shader-forge] Current-process CMAKE_TOOLCHAIN_FILE set to $toolchainPath"
Write-Host "[shader-forge] If SDL3 was previously installed without Vulkan support, this helper has already requested the required vcpkg rebuild path."

if (-not $SkipPersistUserEnvironment) {
    Persist-UserEnvironment -ResolvedVcpkgRoot $resolvedVcpkgRoot
    Write-Host "[shader-forge] Persisted VCPKG_ROOT and CMAKE_TOOLCHAIN_FILE to the user environment."
    Write-Host "[shader-forge] Open a new PowerShell window before rerunning Shader Forge so the persisted environment is picked up cleanly."
} else {
    Write-Host "[shader-forge] Skipped persisting user environment variables."
}

$vulkanSdkRoot = Resolve-VulkanSdkRoot
if ($vulkanSdkRoot) {
    Write-Host "[shader-forge] Detected Vulkan SDK at $vulkanSdkRoot"
} else {
    Write-Host "[shader-forge] Vulkan SDK was not detected. Install the LunarG Vulkan SDK and choose 'The Vulkan SDK Core' for the current Shader Forge setup."
    Write-Host "[shader-forge] Download: https://vulkan.lunarg.com/sdk/home"
}

Write-Host "[shader-forge] Native runtime dependency bootstrap complete."
