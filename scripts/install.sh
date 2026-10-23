#!/usr/bin/env bash
# OpenApply installer for macOS 14+ (Mac beta). Run from the repository root:
#   bash scripts/install.sh [--no-start] [--skip-vm]
# Safe to run again: installed tools are skipped, and it stops whenever you need to act.
# --skip-vm installs only the host tools, for machines that cannot run a VM (such as CI runners).
set -euo pipefail
cd "$(dirname "$0")/.."

no_start=false
skip_vm=false
for arg in "$@"; do
  case "$arg" in
    --no-start) no_start=true ;;
    --skip-vm) skip_vm=true ;;
    *) echo "Unknown option: $arg (expected --no-start or --skip-vm)"; exit 1 ;;
  esac
done

step() { printf '\n==> %s\n' "$1"; }
stop_for_user() {
  printf '\n%s\nThen run scripts/install.sh again. It continues where it stopped.\n' "$1"
  exit 2
}
have() { command -v "$1" >/dev/null 2>&1; }

[ "$(uname -s)" = Darwin ] || { echo "This installer is for macOS. Use scripts/install.ps1 on Windows."; exit 1; }
major=$(sw_vers -productVersion | cut -d. -f1)
[ "$major" -ge 14 ] || { echo "OpenApply needs macOS 14 or newer."; exit 1; }

step "Homebrew"
if ! have brew; then
  # Homebrew's official installer; it asks for your password itself.
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
for prefix in /opt/homebrew /usr/local; do
  [ -x "$prefix/bin/brew" ] && eval "$("$prefix/bin/brew" shellenv)"
done
have brew || stop_for_user "Homebrew is installed but not on PATH. Open a new terminal."

step "Developer tools"
have git && echo "Git: installed" || brew install git
node_major=0
have node && node_major=$(node --version | sed 's/^v//' | cut -d. -f1)
if [ "$node_major" -ge 22 ]; then echo "Node.js: v$node_major"; else brew install node; fi
have bun && echo "Bun: installed" || brew install oven-sh/bun/bun
if node scripts/dotnet.mjs --print-path >/dev/null 2>&1; then
  echo ".NET 10 SDK: installed"
else
  brew install --cask dotnet-sdk
fi
if $skip_vm; then
  echo "Lima: skipped (--skip-vm)"
else
  have limactl && echo "Lima: installed" || brew install lima
fi

step "Claude Code"
export PATH="$HOME/.local/bin:$PATH"
if ! have claude; then
  # Anthropic's official native installer.
  curl -fsSL https://claude.ai/install.sh | bash
fi
have claude || stop_for_user "Claude Code installed but is not on PATH yet. Open a new terminal."
auth=$(claude auth status 2>/dev/null || true)
case "$auth" in
  *'"loggedIn": true'* | *'"loggedIn":true'*) echo "Claude Code: signed in" ;;
  *'"loggedIn"'*)
    if $skip_vm; then
      echo "Claude Code: not signed in (run claude auth login later)."
    else
      stop_for_user "Sign in to Claude Code: run claude auth login and finish in the browser."
    fi
    ;;
  *) echo "Could not read sign-in status. Run claude once and sign in if asked." ;;
esac

step "Project dependencies"
bun install --frozen-lockfile

if $skip_vm; then
  step "Host-only setup (--skip-vm)"
  node scripts/openapply.mjs env
  bun --cwd=apps/api run db:generate
  node scripts/dotnet.mjs build apps/terminal
  step "Doctor"
  node scripts/openapply.mjs doctor || true
  echo "Host tools installed. The VM, database and start were skipped (--skip-vm)."
  exit 0
fi

step "OpenApply setup (creates the Lima VM on first run; this can take several minutes)"
node scripts/openapply.mjs setup

step "Doctor"
node scripts/openapply.mjs doctor || stop_for_user "Doctor found a required check that failed. Follow the Fix line above."

if $no_start; then
  echo "Installed. Start with: node scripts/openapply.mjs start"
  exit 0
fi
step "Starting OpenApply"
node scripts/openapply.mjs start --open
