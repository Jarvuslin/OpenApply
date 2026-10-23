// Finds a dotnet with a .NET 10 SDK, whatever order PATH is in, and runs it:
//   node scripts/dotnet.mjs <dotnet args>   runs that dotnet
//   node scripts/dotnet.mjs --print-path    prints its path, or exits 1 when none exists
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Where to look, in order: DOTNET_ROOT, each PATH entry, then the standard install folders. */
export function dotnetCandidatePaths({ platform, env, home }) {
  const windows = platform === "win32";
  const binary = windows ? "dotnet.exe" : "dotnet";
  const pathApi = windows ? path.win32 : path.posix;
  const separator = windows ? ";" : ":";
  const pathEntries = (env.PATH ?? env.Path ?? "")
    .split(separator)
    .map((entry) => entry.trim().replace(/^"|"$/g, ""))
    .filter(Boolean);
  const standard = windows
    ? [
        env.ProgramFiles && pathApi.join(env.ProgramFiles, "dotnet"),
        env.LOCALAPPDATA && pathApi.join(env.LOCALAPPDATA, "Microsoft", "dotnet"),
        pathApi.join(home, ".dotnet"),
      ]
    : [
        pathApi.join(home, ".dotnet"),
        "/usr/local/share/dotnet",
        "/opt/homebrew/opt/dotnet/libexec",
        "/opt/homebrew/opt/dotnet",
        "/usr/local/opt/dotnet/libexec",
        "/usr/share/dotnet",
      ];
  const all = [];
  if (env.DOTNET_ROOT) all.push({ path: pathApi.join(env.DOTNET_ROOT, binary), onPath: false });
  for (const entry of pathEntries) all.push({ path: pathApi.join(entry, binary), onPath: true });
  for (const folder of standard)
    if (folder) all.push({ path: pathApi.join(folder, binary), onPath: false });
  const seen = new Set();
  return all.filter((candidate) => {
    const key = windows ? candidate.path.toLowerCase() : candidate.path;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The first candidate whose `--list-sdks` shows a 10.x SDK, and the dotnet a bare `dotnet` would run.
 * `candidates` are existing files in search order with their `--list-sdks` output.
 */
export function pickDotnet(candidates) {
  const firstOnPath = candidates.find((candidate) => candidate.onPath)?.path ?? null;
  const usable = candidates.find((candidate) => /^10\.\d+/m.test(candidate.sdks));
  if (!usable) return { path: null, version: null, firstOnPath, checked: candidates.length };
  return {
    path: usable.path,
    version: usable.sdks.match(/^(10\.\S+)/m)?.[1] ?? null,
    firstOnPath,
    checked: candidates.length,
  };
}

export function findDotnet({
  platform = process.platform,
  env = process.env,
  home = os.homedir(),
} = {}) {
  const candidates = dotnetCandidatePaths({ platform, env, home })
    .filter((candidate) => existsSync(candidate.path))
    .map((candidate) => ({
      ...candidate,
      sdks:
        spawnSync(candidate.path, ["--list-sdks"], {
          encoding: "utf8",
          windowsHide: true,
          timeout: 20_000,
        }).stdout ?? "",
    }));
  return pickDotnet(candidates);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const found = findDotnet();
  if (!found.path) {
    console.error(
      "No .NET 10 SDK found. Install it from https://dotnet.microsoft.com/download/dotnet/10.0.",
    );
    process.exit(1);
  }
  if (args[0] === "--print-path") {
    console.log(found.path);
  } else {
    const child = spawn(found.path, args, { stdio: "inherit", windowsHide: true });
    for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
    child.on("exit", (code, signal) => {
      process.exitCode = code ?? (signal ? 1 : 0);
    });
  }
}
