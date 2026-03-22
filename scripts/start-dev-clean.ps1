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
    'shell/engine-shell/node_modules/.vite',
    'shell/engine-shell/vite.config.d.ts',
    'shell/engine-shell/vite.config.js'
)

$quotedTargets = ($cleanTargets | ForEach-Object { "'$_'" }) -join ' '
$skipInstallFlag = if ($SkipInstall) { '1' } else { '0' }
$skipTestsFlag = if ($SkipTests) { '1' } else { '0' }
$skipShellFlag = if ($SkipShell) { '1' } else { '0' }
$skipSessiondFlag = if ($SkipSessiond) { '1' } else { '0' }

Write-Host "[shader-forge] Repo root: $repoRoot"
Write-Host "[shader-forge] WSL root:  $repoRootWsl"
Write-Host "[shader-forge] Cleaning generated outputs before startup..."

$bashScript = @'
set -euo pipefail

cd '__REPO_ROOT_WSL__'

targets=(__QUOTED_TARGETS__)
for target in "${targets[@]}"; do
  if [ -e "$target" ]; then
    rm -rf "$target"
    printf '[shader-forge] Removed %s\n' "$target"
  fi
done

root_install_stamp='node_modules/.shader-forge-install-stamp'
needs_root_install='0'

if [ ! -d 'node_modules' ]; then
  needs_root_install='1'
elif [ ! -f "$root_install_stamp" ]; then
  needs_root_install='1'
elif [ 'package.json' -nt "$root_install_stamp" ]; then
  needs_root_install='1'
elif [ -f 'package-lock.json' ] && [ 'package-lock.json' -nt "$root_install_stamp" ]; then
  needs_root_install='1'
fi

if [ "$needs_root_install" = '1' ]; then
  if [ '__SKIP_INSTALL__' = '1' ]; then
    printf '[shader-forge] root dependencies are stale or missing and -SkipInstall was set.\n' >&2
    exit 1
  fi

  printf '[shader-forge] Installing root dependencies...\n'
  npm install
  touch "$root_install_stamp"
fi

shell_install_stamp='shell/engine-shell/node_modules/.shader-forge-install-stamp'
needs_shell_install='0'

if [ ! -d 'shell/engine-shell/node_modules' ]; then
  needs_shell_install='1'
elif [ ! -f "$shell_install_stamp" ]; then
  needs_shell_install='1'
elif [ 'shell/engine-shell/package.json' -nt "$shell_install_stamp" ]; then
  needs_shell_install='1'
elif [ -f 'shell/engine-shell/package-lock.json' ] && [ 'shell/engine-shell/package-lock.json' -nt "$shell_install_stamp" ]; then
  needs_shell_install='1'
fi

if [ "$needs_shell_install" = '1' ]; then
  if [ '__SKIP_INSTALL__' = '1' ]; then
    printf '[shader-forge] shell/engine-shell dependencies are stale or missing and -SkipInstall was set.\n' >&2
    exit 1
  fi

  printf '[shader-forge] Installing shell dependencies...\n'
  npm install --prefix shell/engine-shell
  touch "$shell_install_stamp"
fi

if [ '__SKIP_TESTS__' != '1' ]; then
  printf '[shader-forge] Running shell smoke harness...\n'
  npm test
  printf '[shader-forge] Running sessiond smoke harness...\n'
  npm run test:sessiond
  printf '[shader-forge] Running shell build validation...\n'
  npm run shell:build
fi

sessiond_pid=''

cleanup() {
  if [ -n "$sessiond_pid" ]; then
    kill "$sessiond_pid" >/dev/null 2>&1 || true
    wait "$sessiond_pid" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

if [ '__SKIP_SESSIOND__' != '1' ]; then
  printf '[shader-forge] Starting engine_sessiond...\n'
  npm run sessiond:start &
  sessiond_pid=$!
fi

if [ '__SKIP_SHELL__' != '1' ]; then
  printf '[shader-forge] Starting shell dev server...\n'
  npm run shell:dev
elif [ -n "$sessiond_pid" ]; then
  printf '[shader-forge] engine_sessiond is running in the foreground hold state.\n'
  wait "$sessiond_pid"
fi
'@

$bashScript = $bashScript.Replace('__REPO_ROOT_WSL__', $repoRootWsl)
$bashScript = $bashScript.Replace('__QUOTED_TARGETS__', $quotedTargets)
$bashScript = $bashScript.Replace('__SKIP_INSTALL__', $skipInstallFlag)
$bashScript = $bashScript.Replace('__SKIP_TESTS__', $skipTestsFlag)
$bashScript = $bashScript.Replace('__SKIP_SHELL__', $skipShellFlag)
$bashScript = $bashScript.Replace('__SKIP_SESSIOND__', $skipSessiondFlag)

Invoke-WslBash -Script $bashScript
