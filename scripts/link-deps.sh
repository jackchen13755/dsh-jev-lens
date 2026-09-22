#!/bin/bash
# Point node_modules at packages that already exist on this machine, for a
# checkout that has NOT run `npm install` (no network, no registry).
#
# A normal `npm install` makes this script unnecessary — the real packages then
# resolve out of node_modules. It exists for the offline case: develop against
# whatever harness is already installed here instead of downloading a second copy.
#
# Every location is discovered; nothing is hard-coded to one machine. Override
# with DSH_TOOLS=/path/to/@deepseek-ai/dsh-tools and NODE_TYPES=/path/to/@types/node.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p node_modules/@deepseek-ai node_modules/@types

DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"

# Search the usual places a harness, or its dependencies, could already live.
search () { # $1 = path under a node_modules directory
  local dir global
  for dir in \
    "$DSH_HOME_DIR"/profiles/*/node_modules/"$1" \
    "$HOME"/.npm/_npx/*/node_modules/"$1" \
    /usr/local/lib/node_modules/"$1" \
    /opt/homebrew/lib/node_modules/"$1"; do
    # Never match the destination we are about to write: `ln -sfn` on an existing
    # link whose target is its own path produces a self-referential symlink, and a
    # broken link is exactly what this script exists to avoid.
    if [ -d "$dir" ] && [ "$(cd "$dir" 2>/dev/null && pwd -P)" != "$(cd "$ROOT/node_modules/$1" 2>/dev/null && pwd -P)" ]; then
      printf '%s\n' "$dir"; return 0
    fi
  done
  global="$(npm root -g 2>/dev/null || true)"
  if [ -n "$global" ] && [ -d "$global/$1" ]; then printf '%s\n' "$global/$1"; return 0; fi
  return 1
}

DSH_TOOLS="${DSH_TOOLS:-$(search @deepseek-ai/dsh-tools || true)}"
if [ -z "$DSH_TOOLS" ] || [ ! -d "$DSH_TOOLS" ]; then
  echo "link-deps: cannot find @deepseek-ai/dsh-tools on this machine." >&2
  echo "           Run 'npm install' in this checkout, or set DSH_TOOLS=/path/to/it." >&2
  exit 1
fi

NODE_TYPES="${NODE_TYPES:-$(search @types/node || true)}"
if [ -z "$NODE_TYPES" ] || [ ! -d "$NODE_TYPES" ]; then
  echo "link-deps: cannot find @types/node on this machine." >&2
  echo "           Run 'npm install' in this checkout, or set NODE_TYPES=/path/to/it." >&2
  exit 1
fi

ln -sfn "$DSH_TOOLS" node_modules/@deepseek-ai/dsh-tools
ln -sfn "$NODE_TYPES" node_modules/@types/node
echo "linked: dsh-tools   → $DSH_TOOLS"
echo "linked: @types/node → $NODE_TYPES"
