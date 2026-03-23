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
  printf '[shader-forge] Running input scaffold harness...\n'
  npm run test:input-scaffold
  printf '[shader-forge] Running tooling UI scaffold harness...\n'
  npm run test:tooling-ui-scaffold
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
