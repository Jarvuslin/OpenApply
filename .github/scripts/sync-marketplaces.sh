#!/usr/bin/env bash

set -euo pipefail

if [ "$#" -ne 3 ]; then
  echo "usage: sync-marketplaces.sh <openapply-root> <claude-marketplace-root> <codex-marketplace-root>" >&2
  exit 2
fi

repo_root="$(cd "$1" && pwd)"
claude_root="$(cd "$2" && pwd)"
codex_root="$(cd "$3" && pwd)"
staging="$(mktemp -d)"
trap 'rm -rf "$staging"' EXIT

claude_stage="$staging/claude"
codex_stage="$staging/codex"

mkdir -p \
  "$claude_stage/.claude-plugin" \
  "$claude_stage/skills/setup" \
  "$codex_stage/.codex-plugin" \
  "$codex_stage/skills/setup"

# Claude's marketplace is the setup bootstrap. Dashboard Claude loads the bundled full plugin.
rsync -a --checksum "$repo_root/plugin/.claude-plugin/" "$claude_stage/.claude-plugin/"
rsync -a --checksum "$repo_root/plugin/skills/setup/" "$claude_stage/skills/setup/"

# Codex's marketplace is also bootstrap-only. The terminal host owns runtime skills and MCP wiring.
rsync -a --checksum "$repo_root/plugin/.codex-plugin/" "$codex_stage/.codex-plugin/"
rsync -a --checksum "$repo_root/plugin/skills/setup/" "$codex_stage/skills/setup/"

# --checksum is intentional: release manifests often retain size and checkout-time mtimes while content changes.
rsync -a --checksum --delete "$claude_stage/" "$claude_root/plugins/openapply/"
rsync -a --checksum --delete "$codex_stage/" "$codex_root/plugins/openapply/"

version_of() {
  node -e 'const v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version; if (!v) process.exit(1); console.log(v)' "$1"
}

release_version="$(version_of "$repo_root/package.json")"
test "$(version_of "$repo_root/plugin/.claude-plugin/plugin.json")" = "$release_version"
test "$(version_of "$repo_root/plugin/.codex-plugin/plugin.json")" = "$release_version"
test "$(version_of "$claude_root/plugins/openapply/.claude-plugin/plugin.json")" = "$release_version"
test "$(version_of "$codex_root/plugins/openapply/.codex-plugin/plugin.json")" = "$release_version"

cmp "$repo_root/plugin/.codex-plugin/plugin.json" "$codex_root/plugins/openapply/.codex-plugin/plugin.json"
cmp "$repo_root/plugin/skills/setup/SKILL.md" "$codex_root/plugins/openapply/skills/setup/SKILL.md"
test ! -e "$codex_root/plugins/openapply/.mcp.json"
test ! -e "$codex_root/plugins/openapply/skills/pilot"
test ! -e "$codex_root/plugins/openapply/skills/_shared"

node -e '
  const market = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const entries = (market.plugins ?? []).filter((p) => p.name === "openapply");
  const [p] = entries;
  const ok =
    market.name === "sukhrob-codex-plugins" &&
    entries.length === 1 &&
    p.source?.source === "local" &&
    p.source?.path === "./plugins/openapply" &&
    p.policy?.installation === "AVAILABLE" &&
    p.policy?.authentication === "ON_USE" &&
    p.category === "Productivity";
  process.exit(ok ? 0 : 1);
' "$codex_root/.agents/plugins/marketplace.json"
