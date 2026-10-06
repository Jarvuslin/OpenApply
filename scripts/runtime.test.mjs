import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { detectRuntime, guestCommand, run } from "../plugin/bin/runtime.mjs";
import { setupEnv } from "./setup-env.mjs";

test("OS routing selects native Mac and Windows backends", () => {
  assert.equal(detectRuntime("win32", "x64").backend, "wsl");
  for (const arch of ["arm64", "x64"]) {
    const runtime = detectRuntime("darwin", arch);
    assert.equal(runtime.backend, "lima");
    assert.equal(runtime.beta, true);
  }
  assert.equal(detectRuntime("darwin", "x64", true).arch, "arm64");
  assert.throws(() => detectRuntime("linux", "x64"), /Unsupported/);
  assert.throws(() => detectRuntime("win32", "arm64"), /not validated/);
});

test("guest commands keep untrusted filenames in distinct argv entries", () => {
  const filename = "/home/pilot/openapply/resume ' $x; spaces.pdf";
  const args = ["cat", filename];
  const mac = guestCommand(detectRuntime("darwin", "arm64"), args, "pilot");
  const win = guestCommand(detectRuntime("win32", "x64"), args, "pilot");
  assert.deepEqual(mac.slice(-2), args);
  assert.deepEqual(win.slice(-2), args);
  assert.equal(mac[0], "limactl");
  assert.equal(win[0], "wsl.exe");
  assert.ok(
    win.includes("--exec"),
    "WSL must not evaluate a second shell before the guest command",
  );
  assert.ok(mac.includes("--workdir=/tmp"));
  assert.throws(() => guestCommand({ backend: "unknown" }, []));
});

test("subprocess transport preserves bytes and surfaces failures", async () => {
  const text = "résumé 多伦多\n' \" $ ;";
  const result = await run([process.execPath, "-e", "process.stdin.pipe(process.stdout)"], {
    input: text,
    capture: true,
  });
  assert.equal(result, text);
  await assert.rejects(
    run([process.execPath, "-e", "process.exit(4)"], { capture: true }),
    /exited with 4/,
  );
});

test("environment setup generates distinct keys and never overwrites existing secrets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openapply-env-"));
  try {
    await mkdir(path.join(root, "apps/api"), { recursive: true });
    await mkdir(path.join(root, "apps/web"), { recursive: true });
    await writeFile(
      path.join(root, "apps/api/.env.example"),
      "JWT_SECRET=dev-insecure-change-me\r\nSECRET_MASTER_KEY=\r\nOPTIONAL=\r\nGOOGLE_CLIENT_ID=\r\nGOOGLE_CLIENT_SECRET=\r\nGITHUB_CLIENT_ID=\r\nGITHUB_CLIENT_SECRET=\r\nDATABASE_URL=postgresql://postgres@127.0.0.1:5433/openapply\r\n",
    );
    await writeFile(
      path.join(root, "apps/web/.env.example"),
      "NEXT_PUBLIC_API_URL=http://localhost:4101\n",
    );
    await setupEnv(root);
    const file = path.join(root, "apps/api/.env");
    const first = await readFile(file, "utf8");
    assert.match(first, /^JWT_SECRET=[a-f0-9]{64}$/m);
    const encoded = first.match(/^SECRET_MASTER_KEY=(.+)$/m)[1];
    assert.equal(Buffer.from(encoded, "base64").length, 32);
    assert.doesNotMatch(first, /^OPTIONAL=/m);
    for (const provider of ["GOOGLE", "GITHUB"]) {
      assert.match(first, new RegExp("^" + provider + "_CLIENT_ID=$", "m"));
      assert.match(first, new RegExp("^" + provider + "_CLIENT_SECRET=$", "m"));
    }
    assert.ok(first.includes("postgresql://postgres@127.0.0.1:5433/openapply"));
    await setupEnv(root);
    assert.equal(await readFile(file, "utf8"), first);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
