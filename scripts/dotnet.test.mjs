import assert from "node:assert/strict";
import test from "node:test";
import { dotnetCandidatePaths, pickDotnet } from "./dotnet.mjs";

test("Windows search order is DOTNET_ROOT, PATH, then the standard folders, without repeats", () => {
  const candidates = dotnetCandidatePaths({
    platform: "win32",
    home: "C:\\Users\\a",
    env: {
      DOTNET_ROOT: "D:\\tools\\dotnet",
      PATH: 'C:\\Program Files\\dotnet;"D:\\tools\\dotnet";C:\\bin',
      ProgramFiles: "C:\\Program Files",
      LOCALAPPDATA: "C:\\Users\\a\\AppData\\Local",
    },
  });
  assert.deepEqual(candidates, [
    { path: "D:\\tools\\dotnet\\dotnet.exe", onPath: false },
    { path: "C:\\Program Files\\dotnet\\dotnet.exe", onPath: true },
    { path: "C:\\bin\\dotnet.exe", onPath: true },
    { path: "C:\\Users\\a\\AppData\\Local\\Microsoft\\dotnet\\dotnet.exe", onPath: false },
    { path: "C:\\Users\\a\\.dotnet\\dotnet.exe", onPath: false },
  ]);
});

test("Mac search includes the Homebrew and installer folders after PATH", () => {
  const paths = dotnetCandidatePaths({
    platform: "darwin",
    home: "/Users/a",
    env: { PATH: "/usr/bin:/opt/homebrew/bin" },
  }).map((candidate) => candidate.path);
  assert.deepEqual(paths.slice(0, 3), [
    "/usr/bin/dotnet",
    "/opt/homebrew/bin/dotnet",
    "/Users/a/.dotnet/dotnet",
  ]);
  assert.ok(paths.includes("/usr/local/share/dotnet/dotnet"));
  assert.ok(paths.includes("/opt/homebrew/opt/dotnet/libexec/dotnet"));
});

test("picks the first dotnet with a 10.x SDK and reports what a bare dotnet runs", () => {
  const found = pickDotnet([
    { path: "/runtime-only/dotnet", onPath: true, sdks: "" },
    { path: "/old/dotnet", onPath: true, sdks: "8.0.404 [/old/sdk]" },
    {
      path: "/home/.dotnet/dotnet",
      onPath: false,
      sdks: "8.0.1 [x]\n10.0.401 [/home/.dotnet/sdk]",
    },
  ]);
  assert.deepEqual(found, {
    path: "/home/.dotnet/dotnet",
    version: "10.0.401",
    firstOnPath: "/runtime-only/dotnet",
    checked: 3,
  });
});

test("reports nothing usable when no candidate has a 10.x SDK", () => {
  assert.equal(pickDotnet([{ path: "/a/dotnet", onPath: true, sdks: "9.0.100 [x]" }]).path, null);
  assert.deepEqual(pickDotnet([]), { path: null, version: null, firstOnPath: null, checked: 0 });
});
