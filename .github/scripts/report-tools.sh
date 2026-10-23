#!/usr/bin/env bash
# Prints which tools a fresh shell would find. With --expect-brew, also fails unless Homebrew
# installed Node and the .NET 10 SDK and they resolve.
set -uo pipefail
title="$1"
repo="${2:-.}"
expect="${3:-}"
for prefix in /opt/homebrew /usr/local; do
  if [ -x "$prefix/bin/brew" ]; then eval "$("$prefix/bin/brew" shellenv)"; fi
done
export PATH="$HOME/.local/bin:$PATH"
echo "== $title"
for name in git node bun dotnet limactl claude; do
  if found=$(command -v "$name"); then
    printf '%-8s %s  (%s)\n' "$name" "$("$name" --version 2>/dev/null | head -1)" "$found"
  else
    printf '%-8s missing\n' "$name"
  fi
done
[ "$expect" = "--expect-brew" ] || exit 0

failed=0
brew list --formula node >/dev/null 2>&1 && echo "brew installed node" || { echo "FAIL: node not installed by brew"; failed=1; }
brew list --cask dotnet-sdk >/dev/null 2>&1 && echo "brew installed dotnet-sdk" || { echo "FAIL: dotnet-sdk not installed by brew"; failed=1; }
git --version >/dev/null 2>&1 || { echo "FAIL: git does not work"; failed=1; }
major=$(node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1)
[ "${major:-0}" -ge 22 ] || { echo "FAIL: node 22+ does not resolve"; failed=1; }
if dotnet=$(node "$repo/scripts/dotnet.mjs" --print-path 2>/dev/null); then
  echo "OpenApply uses $dotnet"
else
  echo "FAIL: no dotnet with a 10.x SDK"
  failed=1
fi
exit "$failed"
