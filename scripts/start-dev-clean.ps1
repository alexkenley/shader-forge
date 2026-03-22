[CmdletBinding()]
param(
    [switch]$SkipInstall,
    [switch]$SkipTests,
    [switch]$SkipShell,
    [switch]$SkipSessiond
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Convert-ToWslPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$WindowsPath
    )

    $fullPath = [System.IO.Path]::GetFullPath($WindowsPath)
    if ($fullPath -notmatch '^(?<drive>[A-Za-z]):(?<rest>.*)$') {
        throw "Only drive-letter paths are supported: $fullPath"
    }

    $drive = $Matches['drive'].ToLowerInvariant()
    $rest = ($Matches['rest'] -replace '\\', '/')
    return "/mnt/$drive$rest"
}

function Invoke-WslBash {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Script
    )

    & wsl.exe bash -lc $Script
    if ($LASTEXITCODE -ne 0) {
        throw "WSL command failed with exit code $LASTEXITCODE"
    }
}

$scriptDir = Split-Path -Parent $PSCommandPath
$repoRoot = (Resolve-Path (Join-Path $scriptDir '..')).ProviderPath
$repoRootWsl = Convert-ToWslPath -WindowsPath $repoRoot

$cleanTargets = @(
    'build',
    'out',
    '.cache',
    'tmp',
    '.harness',
    'coverage',
    'engine/build',
    'engine/out',
    'tools/build',
    'tools/out',
    'shell/engine-shell/dist',
    'shell/engine-shell/.vite',
    'shell/engine-shell/node_modules/.vite'
)

$quotedTargets = ($cleanTargets | ForEach-Object { "'$_'" }) -join ' '
$skipInstallFlag = if ($SkipInstall) { '1' } else { '0' }
$skipTestsFlag = if ($SkipTests) { '1' } else { '0' }
$skipShellFlag = if ($SkipShell) { '1' } else { '0' }
$skipSessiondFlag = if ($SkipSessiond) { '1' } else { '0' }

Write-Host "[shader-forge] Repo root: $repoRoot"
Write-Host "[shader-forge] WSL root:  $repoRootWsl"
Write-Host "[shader-forge] Cleaning generated outputs before startup..."

$bashScript = @"
set -euo pipefail

cd '$repoRootWsl'

targets=($quotedTargets)
for target in "`${targets[@]}"; do
  if [ -e "`$target" ]; then
    rm -rf "`$target"
    printf '[shader-forge] Removed %s\n' "`$target"
  fi
done

if [ ! -d 'shell/engine-shell/node_modules' ]; then
  if [ '$skipInstallFlag' = '1' ]; then
    printf '[shader-forge] shell/engine-shell/node_modules is missing and -SkipInstall was set.\n' >&2
    exit 1
  fi

  printf '[shader-forge] Installing shell dependencies...\n'
  npm install --prefix shell/engine-shell
fi

if [ '$skipTestsFlag' != '1' ]; then
  printf '[shader-forge] Running shell smoke harness...\n'
  npm test
  printf '[shader-forge] Running sessiond smoke harness...\n'
  npm run test:sessiond
fi

sessiond_pid=''

cleanup() {
  if [ -n "$sessiond_pid" ]; then
    kill "$sessiond_pid" >/dev/null 2>&1 || true
    wait "$sessiond_pid" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

if [ '$skipSessiondFlag' != '1' ]; then
  printf '[shader-forge] Starting engine_sessiond...\n'
  npm run sessiond:start &
  sessiond_pid=$!
fi

if [ '$skipShellFlag' != '1' ]; then
  printf '[shader-forge] Starting shell dev server...\n'
  npm run shell:dev
elif [ -n "$sessiond_pid" ]; then
  printf '[shader-forge] engine_sessiond is running in the foreground hold state.\n'
  wait "$sessiond_pid"
fi
"@

Invoke-WslBash -Script $bashScript
