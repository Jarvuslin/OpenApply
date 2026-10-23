import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cp, lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";

export async function storageFingerprint(directory) {
  const files = [];
  let bytes = 0;
  async function visit(relative) {
    const absolute = path.join(directory, relative);
    const stat = await lstat(absolute);
    assert.ok(!stat.isSymbolicLink(), "Synthetic artifact storage cannot contain links.");
    if (stat.isDirectory()) {
      for (const name of (await readdir(absolute)).sort()) await visit(path.join(relative, name));
      return;
    }
    assert.ok(stat.isFile(), "Unsupported synthetic storage entry.");
    bytes += stat.size;
    assert.ok(files.length < 1000 && bytes <= 100 * 1024 * 1024, "Fixture storage exceeds bounds.");
    const content = await readFile(absolute);
    files.push({
      path: relative.replaceAll(path.sep, "/"),
      bytes: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
    });
  }
  await visit("");
  return {
    files,
    sha256: createHash("sha256").update(JSON.stringify(files)).digest("hex"),
  };
}

export async function cloneStorage(source, destination, expected) {
  assert.notEqual(path.resolve(source), path.resolve(destination));
  assert.deepEqual(
    await storageFingerprint(source),
    expected,
    "Preserved artifact storage changed.",
  );
  await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
  assert.deepEqual(
    await storageFingerprint(destination),
    expected,
    "Copied artifact storage differs.",
  );
  assert.deepEqual(
    await storageFingerprint(source),
    expected,
    "Source artifacts changed while copying.",
  );
}
