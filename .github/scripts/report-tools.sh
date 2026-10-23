#!/usr/bin/env bash
# Prints which tools a fresh shell would find. With --expect-brew, also fails unless Homebrew
# installed Node and the .NET 10 SDK and they resolve.
# Step logs need a GitHub sign-in, so the summary also goes out as a public ::notice:: annotation.
set -uo pipefail
title="$1"
repo="${2:-.}"
expect="${3:-}"
for prefix in /opt/homebrew /usr/local; do
  if [ -x "$prefix/bin/brew" ]; then eval "$("$prefix/bin/brew" shellenv)"; fi
done
export PATH="$HOME/.local/bin:$PATH"
echo "== $title"
summary=""
for name in git node bun dotnet limactl claude; do
  if found=$(command -v "$name"); then
    version=$("$name" --version 2>/dev/null | head -1)
    printf '%-8s %s  (%s)\n' "$name" "$version" "$found"
    summary="$summary$name $version ($found); "
  else
    printf '%-8s missing\n' "$name"
    summary="$summary$name missing; "
  fi
done
echo "::notice title=$title::$summary"
[ "$expect" = "--expect-brew" ] || exit 0

failed=""
brew list --formula node >/dev/null 2>&1 || failed="${failed}node not installed by brew; "
brew list --cask dotnet-sdk >/dev/null 2>&1 || failed="${failed}dotnet-sdk not installed by brew; "
git --version >/dev/null 2>&1 || failed="${failed}git does not work; "
major=$(node --version 2>/dev/null | sed 's/^v//' | cut -d. -f1)
[ "${major:-0}" -ge 22 ] || failed="${failed}node 22+ does not resolve; "
if dotnet=$(node "$repo/scripts/dotnet.mjs" --print-path 2>/dev/null); then
  echo "OpenApply uses $dotnet"
else
  failed="${failed}no dotnet with a 10.x SDK; "
fi
if [ -n "$failed" ]; then
  echo "::error title=$title::$failed"
  exit 1
fi
echo "brew installed node and dotnet-sdk."
