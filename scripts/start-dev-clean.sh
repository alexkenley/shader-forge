#!/usr/bin/env bash
set -euo pipefail

skip_install=0
skip_tests=0
skip_shell=0
skip_sessiond=0

while (($#)); do
  case "$1" in
    --skip-install)
      skip_install=1
      ;;
    --skip-tests)
      skip_tests=1
      ;;
    --skip-shell)
      skip_shell=1
      ;;
    --skip-sessiond)
      skip_sessiond=1
      ;;
    *)
      printf '[shader-forge] Unknown argument: %s\n' "$1" >&2
      exit 1
      ;;
  esac
  shift
done

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

normalize_command_token() {
  local value="${1:-}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"

  if [[ ${#value} -ge 2 ]]; then
    if [[ "$value" == '"'*'"' ]]; then
      value="${value:1:${#value}-2}"
    elif [[ "$value" == "'"*"'" ]]; then
      value="${value:1:${#value}-2}"
    fi
  fi

  printf '%s' "$value"
}

command_responds() {
  local command
  command="$(normalize_command_token "${1:-}")"
  [[ -n "$command" ]] || return 1
  "$command" --version >/dev/null 2>&1
}

resolve_cmake_command() {
  local configured
  configured="$(normalize_command_token "${SHADER_FORGE_CMAKE:-}")"
  if [[ -n "$configured" ]] && command_responds "$configured"; then
    printf '%s' "$configured"
    return 0
  fi

  if command -v cmake >/dev/null 2>&1; then
    command -v cmake
    return 0
  fi

  local candidate=''
  local candidates=(
    "/mnt/c/Program Files/CMake/bin/cmake.exe"
    "/mnt/c/Program Files (x86)/CMake/bin/cmake.exe"
    "/mnt/c/Program Files/Microsoft Visual Studio/2022/Community/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe"
    "/mnt/c/Program Files/Microsoft Visual Studio/2022/Professional/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe"
    "/mnt/c/Program Files/Microsoft Visual Studio/2022/Enterprise/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe"
    "/mnt/c/Program Files/Microsoft Visual Studio/2022/BuildTools/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe"
    "/mnt/c/Program Files/Microsoft Visual Studio/2022/Preview/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe"
    "/mnt/c/Program Files (x86)/Microsoft Visual Studio/2019/Community/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe"
    "/mnt/c/Program Files (x86)/Microsoft Visual Studio/2019/Professional/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe"
    "/mnt/c/Program Files (x86)/Microsoft Visual Studio/2019/Enterprise/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe"
    "/mnt/c/Program Files (x86)/Microsoft Visual Studio/2019/BuildTools/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe"
    "/mnt/c/Program Files (x86)/Microsoft Visual Studio/2019/Preview/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe"
  )

  for candidate in "${candidates[@]}"; do
    if [[ -x "$candidate" ]]; then
      printf '%s' "$candidate"
      return 0
    fi
  done

  return 1
}

configure_cmake_environment() {
  local cmake_command=''
  if cmake_command="$(resolve_cmake_command)"; then
    export SHADER_FORGE_CMAKE="$cmake_command"
    if [[ "$cmake_command" == */* ]]; then
      local cmake_dir
      cmake_dir="$(dirname "$cmake_command")"
      case ":$PATH:" in
        *":$cmake_dir:"*) ;;
        *) export PATH="$cmake_dir:$PATH" ;;
      esac
    fi
    printf '[shader-forge] Using CMake: %s\n' "$cmake_command"
    return 0
  fi

  printf '[shader-forge] CMake was not found on PATH or in common install locations. Build and Build + Run will stay unavailable until it is installed.\n'
  return 1
}

clean_targets=(
  build
  out
  .cache
  tmp
  .harness
  coverage
  engine/build
  engine/out
  tools/build
  tools/out
  shell/engine-shell/dist
  shell/engine-shell/.vite
  shell/engine-shell/node_modules/.vite
  shell/engine-shell/vite.config.d.ts
  shell/engine-shell/vite.config.js
)

printf '[shader-forge] Repo root: %s\n' "$repo_root"
configure_cmake_environment || true
printf '[shader-forge] Cleaning generated outputs before startup...\n'

cd "$repo_root"

for target in "${clean_targets[@]}"; do
  if [[ -e "$target" ]]; then
    rm -rf "$target"
    printf '[shader-forge] Removed %s\n' "$target"
  fi
done

root_install_stamp='node_modules/.shader-forge-install-stamp'
needs_root_install=0

if [[ ! -d node_modules ]]; then
  needs_root_install=1
elif [[ ! -f "$root_install_stamp" ]]; then
  needs_root_install=1
elif [[ package.json -nt "$root_install_stamp" ]]; then
  needs_root_install=1
elif [[ -f package-lock.json && package-lock.json -nt "$root_install_stamp" ]]; then
  needs_root_install=1
fi

if [[ "$needs_root_install" == "1" ]]; then
  if [[ "$skip_install" == "1" ]]; then
    printf '[shader-forge] root dependencies are stale or missing and --skip-install was set.\n' >&2
    exit 1
  fi

  printf '[shader-forge] Installing root dependencies...\n'
  npm install
  touch "$root_install_stamp"
fi

shell_install_stamp='shell/engine-shell/node_modules/.shader-forge-install-stamp'
needs_shell_install=0

if [[ ! -d shell/engine-shell/node_modules ]]; then
  needs_shell_install=1
elif [[ ! -f "$shell_install_stamp" ]]; then
  needs_shell_install=1
elif [[ shell/engine-shell/package.json -nt "$shell_install_stamp" ]]; then
  needs_shell_install=1
elif [[ -f shell/engine-shell/package-lock.json && shell/engine-shell/package-lock.json -nt "$shell_install_stamp" ]]; then
  needs_shell_install=1
fi

if [[ "$needs_shell_install" == "1" ]]; then
  if [[ "$skip_install" == "1" ]]; then
    printf '[shader-forge] shell/engine-shell dependencies are stale or missing and --skip-install was set.\n' >&2
    exit 1
  fi

  printf '[shader-forge] Installing shell dependencies...\n'
  npm install --prefix shell/engine-shell
  touch "$shell_install_stamp"
fi

if [[ "$skip_tests" != "1" ]]; then
  printf '[shader-forge] Running shell smoke harness...\n'
  npm test
  printf '[shader-forge] Running sessiond smoke harness...\n'
  npm run test:sessiond
  printf '[shader-forge] Running viewer bridge harness...\n'
  npm run test:viewer-bridge
  printf '[shader-forge] Running scene authoring harness...\n'
  npm run test:scene-authoring
  printf '[shader-forge] Running data foundation scaffold harness...\n'
  npm run test:data-foundation-scaffold
  printf '[shader-forge] Running asset pipeline harness...\n'
  npm run test:asset-pipeline
  printf '[shader-forge] Running migration fixtures harness...\n'
  npm run test:migration-fixtures
  printf '[shader-forge] Running audio scaffold harness...\n'
  npm run test:audio-scaffold
  printf '[shader-forge] Running animation scaffold harness...\n'
  npm run test:animation-scaffold
  printf '[shader-forge] Running physics scaffold harness...\n'
  npm run test:physics-scaffold
  printf '[shader-forge] Running input scaffold harness...\n'
  npm run test:input-scaffold
  printf '[shader-forge] Running tooling UI scaffold harness...\n'
  npm run test:tooling-ui-scaffold
  printf '[shader-forge] Running scene runtime scaffold harness...\n'
  npm run test:scene-runtime-scaffold
  printf '[shader-forge] Running runtime scaffold harness...\n'
  npm run test:runtime-scaffold
  printf '[shader-forge] Running shell build validation...\n'
  npm run shell:build
fi

sessiond_pid=''

cleanup() {
  if [[ -n "$sessiond_pid" ]]; then
    kill "$sessiond_pid" >/dev/null 2>&1 || true
    wait "$sessiond_pid" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT INT TERM

if [[ "$skip_sessiond" != "1" ]]; then
  printf '[shader-forge] Starting engine_sessiond...\n'
  npm run sessiond:start &
  sessiond_pid=$!
fi

if [[ "$skip_shell" != "1" ]]; then
  printf '[shader-forge] Starting shell dev server...\n'
  npm run shell:dev
elif [[ -n "$sessiond_pid" ]]; then
  printf '[shader-forge] engine_sessiond is running in the foreground hold state.\n'
  wait "$sessiond_pid"
fi
