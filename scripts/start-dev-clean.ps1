[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [switch]$SkipTests,
    [switch]$SkipShell,
    [switch]$SkipSessiond
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $PSCommandPath
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..')).ProviderPath

function Resolve-CMakeCommand {
    $configured = [string]($env:SHADER_FORGE_CMAKE ?? '')
    $configured = $configured.Trim().Trim('"').Trim("'")
    if ($configured) {
        $configuredCommand = Get-Command $configured -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($configuredCommand) {
            return $configuredCommand.Source
        }
    }

    $pathCommand = Get-Command cmake -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($pathCommand) {
        return $pathCommand.Source
    }

    $candidates = New-Object System.Collections.Generic.List[string]
    foreach ($programFilesRoot in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if (-not $programFilesRoot) {
            continue
        }
        $candidates.Add((Join-Path $programFilesRoot 'CMake\bin\cmake.exe'))
    }

    if ($env:LOCALAPPDATA) {
        $candidates.Add((Join-Path $env:LOCALAPPDATA 'Programs\CMake\bin\cmake.exe'))
    }

    $vsVersions = @('2022', '2019')
    $vsEditions = @('Community', 'Professional', 'Enterprise', 'BuildTools', 'Preview')
    foreach ($programFilesRoot in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if (-not $programFilesRoot) {
            continue
        }
        $vsRoot = Join-Path $programFilesRoot 'Microsoft Visual Studio'
        foreach ($version in $vsVersions) {
            foreach ($edition in $vsEditions) {
                $candidates.Add((Join-Path $vsRoot "$version\$edition\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"))
            }
        }
    }

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path $candidate -PathType Leaf)) {
            return (Resolve-Path $candidate).ProviderPath
        }
    }

    return $null
}

function Initialize-CMakeEnvironment {
    $cmakeCommand = Resolve-CMakeCommand
    if ($cmakeCommand) {
        $env:SHADER_FORGE_CMAKE = $cmakeCommand
        $cmakeDir = Split-Path -Parent $cmakeCommand
        if ($cmakeDir) {
            $pathEntries = $env:Path -split ';'
            if (-not ($pathEntries | Where-Object { $_ -eq $cmakeDir })) {
                $env:Path = "$cmakeDir;$env:Path"
            }
        }
        Write-Host "[shader-forge] Using CMake: $cmakeCommand"
        return
    }

    Write-Host "[shader-forge] CMake was not found on PATH or in common install locations. Build and Build + Run will stay unavailable until it is installed."
}

function Resolve-VcpkgToolchainPath {
    $configured = [string]($env:CMAKE_TOOLCHAIN_FILE ?? '')
    $configured = $configured.Trim().Trim('"').Trim("'")
    if ($configured -and (Test-Path $configured -PathType Leaf)) {
        return (Resolve-Path $configured).ProviderPath
    }

    $configuredRoot = [string]($env:VCPKG_ROOT ?? '')
    $configuredRoot = $configuredRoot.Trim().Trim('"').Trim("'")
    if ($configuredRoot) {
        $configuredCandidate = Join-Path $configuredRoot 'scripts\buildsystems\vcpkg.cmake'
        if (Test-Path $configuredCandidate -PathType Leaf) {
            return (Resolve-Path $configuredCandidate).ProviderPath
        }
    }

    $candidates = @(
        'C:\src\vcpkg\scripts\buildsystems\vcpkg.cmake',
        (Join-Path $env:USERPROFILE 'vcpkg\scripts\buildsystems\vcpkg.cmake')
    )

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path $candidate -PathType Leaf)) {
            return (Resolve-Path $candidate).ProviderPath
        }
    }

    return $null
}

function Initialize-VcpkgToolchainEnvironment {
    $toolchainPath = Resolve-VcpkgToolchainPath
    if (-not $toolchainPath) {
        return
    }

    $env:CMAKE_TOOLCHAIN_FILE = $toolchainPath
    $vcpkgRoot = Split-Path -Parent (Split-Path -Parent $toolchainPath)
    if ($vcpkgRoot) {
        $env:VCPKG_ROOT = $vcpkgRoot
    }

    Write-Host "[shader-forge] Using vcpkg toolchain: $toolchainPath"
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

function Initialize-VulkanSdkEnvironment {
    $sdkRoot = Resolve-VulkanSdkRoot
    if (-not $sdkRoot) {
        return
    }

    $env:VULKAN_SDK = $sdkRoot
    $binPath = Join-Path $sdkRoot 'Bin'
    if (Test-Path $binPath -PathType Container) {
        $pathEntries = $env:Path -split ';'
        if (-not ($pathEntries | Where-Object { $_ -eq $binPath })) {
            $env:Path = "$binPath;$env:Path"
        }
    }

    Write-Host "[shader-forge] Using Vulkan SDK: $sdkRoot"
}

Write-Host "[shader-forge] Repo root: $repoRoot"
Initialize-CMakeEnvironment
Initialize-VcpkgToolchainEnvironment
Initialize-VulkanSdkEnvironment

# ─── Clean generated outputs ───

Write-Host "[shader-forge] Cleaning generated outputs..."

$cleanTargets = @(
    'build',
    'out',
    '.cache',
    'tmp',
    '.harness',
    'coverage',
    'engine\build',
    'engine\out',
    'tools\build',
    'tools\out',
    'shell\engine-shell\dist',
    'shell\engine-shell\.vite',
    'shell\engine-shell\node_modules\.vite',
    'shell\engine-shell\vite.config.d.ts',
    'shell\engine-shell\vite.config.js'
)

foreach ($target in $cleanTargets) {
    $fullTarget = Join-Path $repoRoot $target
    if (Test-Path $fullTarget) {
        Remove-Item -Recurse -Force $fullTarget
        Write-Host "[shader-forge] Removed $target"
    }
}

# ─── Install dependencies ───

Push-Location $repoRoot
try {
    if (-not $SkipInstall) {
        # Check if node-pty native module matches this platform
        $ptyNode = Join-Path $repoRoot 'node_modules\node-pty\build\Release\pty.node'
        $needsRebuild = $false
        if (Test-Path $ptyNode) {
            # If pty.node exists but is an ELF binary (installed from WSL), force reinstall
            $header = [System.IO.File]::ReadAllBytes($ptyNode)[0..3]
            if ($header[0] -eq 0x7F -and $header[1] -eq 0x45 -and $header[2] -eq 0x4C -and $header[3] -eq 0x46) {
                Write-Host "[shader-forge] node-pty was built for Linux — rebuilding for Windows..."
                $needsRebuild = $true
            }
        }

        $rootStamp = Join-Path $repoRoot 'node_modules\.shader-forge-install-stamp'
        $needsRootInstall = $false

        if ($needsRebuild) {
            $needsRootInstall = $true
        } elseif (-not (Test-Path (Join-Path $repoRoot 'node_modules'))) {
            $needsRootInstall = $true
        } elseif (-not (Test-Path $rootStamp)) {
            $needsRootInstall = $true
        } elseif ((Get-Item (Join-Path $repoRoot 'package.json')).LastWriteTime -gt (Get-Item $rootStamp).LastWriteTime) {
            $needsRootInstall = $true
        }

        if ($needsRebuild) {
            # Rebuild native modules for this platform
            & npm rebuild node-pty
            if ($LASTEXITCODE -ne 0) { throw "npm rebuild node-pty failed" }
            Write-Host "[shader-forge] node-pty rebuilt for Windows."
        }

        if ($needsRootInstall) {
            Write-Host "[shader-forge] Installing root dependencies..."
            & npm install
            if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
            New-Item -ItemType File -Path $rootStamp -Force | Out-Null
        }

        $shellDir = Join-Path $repoRoot 'shell\engine-shell'
        $shellStamp = Join-Path $shellDir 'node_modules\.shader-forge-install-stamp'
        $needsShellInstall = $false

        if (-not (Test-Path (Join-Path $shellDir 'node_modules'))) {
            $needsShellInstall = $true
        } elseif (-not (Test-Path $shellStamp)) {
            $needsShellInstall = $true
        } elseif ((Get-Item (Join-Path $shellDir 'package.json')).LastWriteTime -gt (Get-Item $shellStamp).LastWriteTime) {
            $needsShellInstall = $true
        }

        if ($needsShellInstall) {
            Write-Host "[shader-forge] Installing shell dependencies..."
            & npm install --prefix shell/engine-shell
            if ($LASTEXITCODE -ne 0) { throw "shell npm install failed" }
            New-Item -ItemType File -Path $shellStamp -Force | Out-Null
        }
    }

    # ─── Run tests ───

    if (-not $SkipTests) {
        Write-Host "[shader-forge] Running shell smoke harness..."
        & npm test
        if ($LASTEXITCODE -ne 0) { throw "Shell smoke test failed" }

        Write-Host "[shader-forge] Running sessiond smoke harness..."
        & npm run test:sessiond
        if ($LASTEXITCODE -ne 0) { throw "Sessiond test failed" }

        Write-Host "[shader-forge] Running viewer bridge harness..."
        & npm run test:viewer-bridge
        if ($LASTEXITCODE -ne 0) { throw "Viewer bridge test failed" }

        Write-Host "[shader-forge] Running scene authoring harness..."
        & npm run test:scene-authoring
        if ($LASTEXITCODE -ne 0) { throw "Scene authoring test failed" }

        Write-Host "[shader-forge] Running data foundation scaffold harness..."
        & npm run test:data-foundation-scaffold
        if ($LASTEXITCODE -ne 0) { throw "Data foundation scaffold test failed" }

        Write-Host "[shader-forge] Running asset pipeline harness..."
        & npm run test:asset-pipeline
        if ($LASTEXITCODE -ne 0) { throw "Asset pipeline test failed" }

        Write-Host "[shader-forge] Running migration fixtures harness..."
        & npm run test:migration-fixtures
        if ($LASTEXITCODE -ne 0) { throw "Migration fixtures test failed" }

        Write-Host "[shader-forge] Running audio scaffold harness..."
        & npm run test:audio-scaffold
        if ($LASTEXITCODE -ne 0) { throw "Audio scaffold test failed" }

        Write-Host "[shader-forge] Running animation scaffold harness..."
        & npm run test:animation-scaffold
        if ($LASTEXITCODE -ne 0) { throw "Animation scaffold test failed" }

        Write-Host "[shader-forge] Running physics scaffold harness..."
        & npm run test:physics-scaffold
        if ($LASTEXITCODE -ne 0) { throw "Physics scaffold test failed" }

        Write-Host "[shader-forge] Running input scaffold harness..."
        & npm run test:input-scaffold
        if ($LASTEXITCODE -ne 0) { throw "Input scaffold test failed" }

        Write-Host "[shader-forge] Running tooling UI scaffold harness..."
        & npm run test:tooling-ui-scaffold
        if ($LASTEXITCODE -ne 0) { throw "Tooling UI scaffold test failed" }

        Write-Host "[shader-forge] Running scene runtime scaffold harness..."
        & npm run test:scene-runtime-scaffold
        if ($LASTEXITCODE -ne 0) { throw "Scene runtime scaffold test failed" }

        Write-Host "[shader-forge] Running runtime scaffold harness..."
        & npm run test:runtime-scaffold
        if ($LASTEXITCODE -ne 0) { throw "Runtime scaffold test failed" }

        Write-Host "[shader-forge] Running shell build validation..."
        & npm run shell:build
        if ($LASTEXITCODE -ne 0) { throw "Shell build failed" }
    }

    # ─── Start services ───

    $sessiondJob = $null

    try {
        if (-not $SkipSessiond) {
            Write-Host "[shader-forge] Starting engine_sessiond..."
            $sessiondJob = Start-Job -ScriptBlock {
                param($dir)
                Set-Location $dir
                & npm run sessiond:start 2>&1
            } -ArgumentList $repoRoot
        }

        if (-not $SkipShell) {
            Write-Host "[shader-forge] Starting shell dev server..."
            # Give sessiond a moment to bind its port
            if ($sessiondJob) { Start-Sleep -Milliseconds 800 }
            & npm run shell:dev
        } elseif ($sessiondJob) {
            Write-Host "[shader-forge] engine_sessiond running. Press Ctrl+C to stop."
            Wait-Job $sessiondJob | Out-Null
            Receive-Job $sessiondJob
        }
    } finally {
        if ($sessiondJob) {
            Stop-Job $sessiondJob -ErrorAction SilentlyContinue
            Remove-Job $sessiondJob -Force -ErrorAction SilentlyContinue
        }
    }
} finally {
    Pop-Location
}
