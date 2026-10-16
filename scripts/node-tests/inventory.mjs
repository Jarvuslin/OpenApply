import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NODE_TEST_GROUPS } from "./manifest.mjs";

export const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

export function discoverNodeTests(root = repositoryRoot) {
  return execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "*.test.mjs"],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    },
  )
    .split("\0")
    .filter((file) => file && existsSync(resolve(root, file)))
    .sort();
}

export function assertNodeTestInventory(discovered, groups = NODE_TEST_GROUPS) {
  const classified = Object.values(groups).flatMap((group) => group.files);
  assert.equal(
    new Set(classified).size,
    classified.length,
    "A Node test is classified more than once.",
  );
  assert.deepEqual(
    [...classified].sort(),
    discovered,
    "Every repository .test.mjs needs an explicit local, browser, or guest-host classification.",
  );
}

export function selectNodeTests(args, groups = NODE_TEST_GROUPS) {
  let group = "local",
    list = false;
  const prefixes = [];
  for (const arg of args) {
    if (arg === "--list") list = true;
    else if (arg.startsWith("--group=")) group = arg.slice(8);
    else if (arg.startsWith("--prefix=")) prefixes.push(arg.slice(9));
    else
      throw new Error(
        "Expected --list, --group=local|browser|guest-host, or --prefix=<repository path>.",
      );
  }
  assert.ok(Object.hasOwn(groups, group), "Unknown Node test group.");
  assert.ok(
    prefixes.every(
      (prefix) => /^(?:scripts|plugin)\/[a-z0-9/.-]+$/.test(prefix) && !prefix.includes(".."),
    ),
    "Invalid Node test prefix.",
  );
  const files = groups[group].files
    .filter((file) => !prefixes.length || prefixes.some((prefix) => file.startsWith(prefix)))
    .sort();
  assert.ok(files.length, "No classified Node tests match this group and prefix.");
  return { group, list, files };
}
