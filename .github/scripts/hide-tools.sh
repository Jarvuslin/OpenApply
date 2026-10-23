#!/usr/bin/env bash
# Makes a macOS runner look like a new Mac for Node and .NET, so the installer really installs
# them. Apple's /usr/bin/git ships with the runner's Xcode and cannot be removed; only
# Homebrew's git is uninstalled, so the installer is expected to find the Xcode one.
set -euo pipefail

for formula in node git; do
  if brew list --formula "$formula" >/dev/null 2>&1; then
    echo "brew uninstall $formula"
    brew uninstall --ignore-dependencies --force "$formula"
  fi
done
if brew list --cask dotnet-sdk >/dev/null 2>&1; then brew uninstall --cask dotnet-sdk; fi

for folder in /usr/local/share/dotnet "$HOME/.dotnet"; do
  if [ -e "$folder" ]; then
    echo "Moving aside $folder"
    sudo mv "$folder" "$folder.hidden"
  fi
done

# Whatever is still on PATH (toolcache Node, a dotnet symlink) is moved aside one by one.
for tool in node dotnet; do
  for _ in 1 2 3 4 5 6 7 8; do
    found=$(command -v "$tool" || true)
    [ -n "$found" ] || break
    echo "Moving aside $found"
    sudo mv "$found" "$found.hidden"
    hash -r
  done
  if command -v "$tool" >/dev/null 2>&1; then
    echo "Still found: $(command -v "$tool")"
    exit 1
  fi
done
echo "Node and .NET are hidden. git: $(command -v git) (Xcode, expected)"
