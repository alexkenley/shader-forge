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

Write-Host "[shader-forge] Repo root: $repoRoot"

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

        Write-Host "[shader-forge] Running data foundation scaffold harness..."
        & npm run test:data-foundation-scaffold
        if ($LASTEXITCODE -ne 0) { throw "Data foundation scaffold test failed" }

        Write-Host "[shader-forge] Running asset pipeline harness..."
        & npm run test:asset-pipeline
        if ($LASTEXITCODE -ne 0) { throw "Asset pipeline test failed" }

        Write-Host "[shader-forge] Running migration fixtures harness..."
        & npm run test:migration-fixtures
        if ($LASTEXITCODE -ne 0) { throw "Migration fixtures test failed" }

        Write-Host "[shader-forge] Running input scaffold harness..."
        & npm run test:input-scaffold
        if ($LASTEXITCODE -ne 0) { throw "Input scaffold test failed" }

        Write-Host "[shader-forge] Running tooling UI scaffold harness..."
        & npm run test:tooling-ui-scaffold
        if ($LASTEXITCODE -ne 0) { throw "Tooling UI scaffold test failed" }

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
