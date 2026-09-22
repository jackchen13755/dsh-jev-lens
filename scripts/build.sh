#!/bin/bash
# Build dsh-jev-lens — two steps, no bundler, no network.
#
#   host   : tsc → lib/                          (types from @deepseek-ai/dsh-tools)
#   client : client/client.js → lib/client.js    (hand-written lazy-CJS: a copy)
#
# Works in a normal checkout (`npm install` first) and in an offline one (it
# calls scripts/link-deps.sh when the types are not installed yet).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Types: an installed package wins; otherwise borrow the ones already here.
if [ ! -e node_modules/@deepseek-ai/dsh-tools ]; then
  bash scripts/link-deps.sh || true
fi
if [ ! -e node_modules/@deepseek-ai/dsh-tools ]; then
  echo "build: @deepseek-ai/dsh-tools not resolvable — run 'npm install' here, or scripts/link-deps.sh" >&2
  exit 1
fi

# Compiler: the local devDependency first, then whatever is on PATH.
TSC="${TSC:-}"
if [ -z "$TSC" ]; then
  if [ -x node_modules/.bin/tsc ]; then TSC=node_modules/.bin/tsc
  elif command -v tsc >/dev/null 2>&1; then TSC=tsc
  else
    echo "build: no TypeScript compiler — run 'npm install' here, or set TSC=/path/to/tsc" >&2
    exit 1
  fi
fi

echo "=== typecheck + compile src → lib ($("$TSC" --version | awk '{print $2}')) ==="
"$TSC" -p tsconfig.json

# The browser half is hand-written lazy-CJS (no tsdown, no bundler): the harness
# only requires `__ModuleLoader__.load` plus an `inject` list, and the injector's
# precheck looks for the built artifact at lib/client.js. So the client step is a
# copy — the readable source stays in client/, the served file is lib/.
cp client/client.js lib/client.js
grep -q "__ModuleLoader__" lib/client.js || { echo "build: lib/client.js is not a ModuleLoader bundle" >&2; exit 1; }

echo "=== build complete: lib/index.js + lib/client.js ==="
