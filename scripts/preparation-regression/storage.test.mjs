import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { cloneStorage, storageFingerprint } from "./storage.mjs";

async function fixture(t) {
  const temporaryRoot = path.resolve(os.tmpdir());
  const root = await mkdtemp(path.join(temporaryRoot, "openapply-preparation-storage-"));
  assert.equal(path.dirname(root), temporaryRoot);
  assert.ok(path.basename(root).startsWith("openapply-preparation-storage-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = path.join(root, "source");
  await mkdir(source);
  await writeFile(path.join(source, "resume.pdf"), "%PDF-synthetic immutable evidence");
  return { root, source, expected: await storageFingerprint(source) };
}

test("UI clone preserves exact synthetic document bytes and source fingerprint", async (t) => {
  const f = await fixture(t);
  const target = path.join(f.root, "clone");
  await cloneStorage(f.source, target, f.expected);
  assert.deepEqual(await storageFingerprint(f.source), f.expected);
  assert.deepEqual(await storageFingerprint(target), f.expected);
  await writeFile(path.join(target, "resume.pdf"), "clone-only change");
  assert.deepEqual(await storageFingerprint(f.source), f.expected);
});

test("changed source and source-as-destination are refused before copying", async (t) => {
  const f = await fixture(t);
  await assert.rejects(cloneStorage(f.source, f.source, f.expected));
  await writeFile(path.join(f.source, "resume.pdf"), "changed");
  await assert.rejects(cloneStorage(f.source, path.join(f.root, "clone"), f.expected));
});

test("storage links cannot pull unrelated files into synthetic UI evidence", async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.root, "outside");
  await mkdir(outside);
  await writeFile(path.join(outside, "private.txt"), "must remain outside the fixture");
  await symlink(
    outside,
    path.join(f.source, "link"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(storageFingerprint(f.source), /cannot contain links/);
  assert.equal(
    await readFile(path.join(outside, "private.txt"), "utf8"),
    "must remain outside the fixture",
  );
});
