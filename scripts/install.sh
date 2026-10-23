#!/usr/bin/env bash
# OpenApply installer for macOS 14+ (Mac beta). On a new Mac, in Terminal:
#   curl -fsSL https://raw.githubusercontent.com/Jarvuslin/OpenApply/main/scripts/install.sh | bash
# That installs Homebrew and Git, clones into ~/OpenApply (or $OPENAPPLY_DIR) and continues there.
# In a checkout: bash scripts/install.sh [--no-start] [--skip-vm]
# Safe to run again: installed tools are skipped, and it stops whenever you need to act.
# --skip-vm installs only the host tools, for machines that cannot run a VM (such as CI runners).
# Piped options go after "bash -s --", for example: curl ... | bash -s -- --no-start
set -euo pipefail

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
# A new Mac has a /usr/bin/git placeholder that only offers to install Apple's developer tools.
git_works() { git --version >/dev/null 2>&1; }
# Prompts (sudo, Homebrew) must read the keyboard, not the piped script.
has_tty() { : </dev/tty 2>/dev/null; }

[ "$(uname -s)" = Darwin ] || { echo "This installer is for macOS. Use scripts/install.ps1 on Windows."; exit 1; }
major=$(sw_vers -productVersion | cut -d. -f1)
[ "$major" -ge 14 ] || { echo "OpenApply needs macOS 14 or newer."; exit 1; }

step "Homebrew"
if ! have brew; then
  # Homebrew's official installer; it asks for your password itself.
  if has_tty; then
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)" </dev/tty
  else
    NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  fi
fi
for prefix in /opt/homebrew /usr/local; do
  if [ -x "$prefix/bin/brew" ]; then eval "$("$prefix/bin/brew" shellenv)"; fi
done
have brew || stop_for_user "Homebrew is installed but not on PATH. Open a new terminal."

script_dir=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "$(dirname "${BASH_SOURCE[0]}")/openapply.mjs" ]; then
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi
if [ -z "$script_dir" ]; then
  # Piped from curl: get Git and the code, then run the checkout's own copy of this script.
  install_dir="${OPENAPPLY_DIR:-$HOME/OpenApply}"
  repo="${OPENAPPLY_REPO:-https://github.com/Jarvuslin/OpenApply.git}"
  branch="${OPENAPPLY_BRANCH:-main}"
  step "Getting the OpenApply code"
  if git_works; then echo "Git: installed"; else brew install git; fi
  if [ -d "$install_dir/.git" ]; then
    echo "Updating $install_dir"
    git -C "$install_dir" fetch origin "$branch"
    git -C "$install_dir" checkout "$branch"
    git -C "$install_dir" pull --ff-only origin "$branch" ||
      echo "Could not fast-forward; continuing with the code already there."
  elif [ -d "$install_dir" ] && [ -n "$(ls -A "$install_dir")" ]; then
    echo "$install_dir exists and is not an OpenApply checkout. Set OPENAPPLY_DIR to another folder."
    exit 1
  else
    git clone --branch "$branch" "$repo" "$install_dir"
  fi
  if has_tty; then exec bash "$install_dir/scripts/install.sh" "$@" </dev/tty; fi
  exec bash "$install_dir/scripts/install.sh" "$@" </dev/null
fi
cd "$script_dir/.."

step "Developer tools"
if git_works; then echo "Git: installed"; else brew install git; fi
node_major=0
if have node; then node_major=$(node --version | sed 's/^v//' | cut -d. -f1); fi
if [ "$node_major" -ge 22 ]; then echo "Node.js: v$node_major"; else brew install node; fi
if have bun; then echo "Bun: installed"; else brew install oven-sh/bun/bun; fi
if node scripts/dotnet.mjs --print-path >/dev/null 2>&1; then
  echo ".NET 10 SDK: installed"
else
  brew install --cask dotnet-sdk
fi
if $skip_vm; then
  echo "Lima: skipped (--skip-vm)"
elif have limactl; then
  echo "Lima: installed"
else
  brew install lima
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
