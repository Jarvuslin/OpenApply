import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { stageFile } from "./stage-file.mjs";

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "openapply-stage-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, "reviewed-resume.pdf");
  const bytes = Buffer.from("%PDF-1.7\nSynthetic resume bytes\n%%EOF\n");
  await writeFile(source, bytes);
  return { source, bytes };
}

test("ordinary staging preserves its guest location and exact reviewed bytes", async (t) => {
  const { source, bytes } = await fixture(t);
  let calls = 0;
  const target = await stageFile(source, {
    environment: { OPENAPPLY_COMPANION: "http://127.0.0.1:4102" },
    runtime: () => ({ backend: "wsl" }),
    fetcher: () => {
      throw Error("Ordinary staging must not attach a worker");
    },
    execute: async (command, options) => {
      calls++;
      assert.deepEqual(options.input, bytes);
      assert.equal(command.at(-1), "ordinary");
      assert.equal(command.at(-3), "/home/pilot/openapply");
      assert.ok(!command.join(" ").includes("chown -R"));
    },
  });
  assert.equal(calls, 1);
  assert.match(target, /^\/home\/pilot\/openapply\/[\da-f-]{36}\.pdf$/);
});

test("queue staging attaches the exact capability and places unchanged bytes inside owned documents", async (t) => {
  const { source, bytes } = await fixture(t);
  const session = randomUUID();
  const capability = "a".repeat(64);
  const base = `/home/pilot/openapply/queue-workers/${session}`;
  const environment = {
    OPENAPPLY_WORK_ITEM_ID: randomUUID(),
    OPENAPPLY_COMPANION: "http://127.0.0.1:14103",
    OPENAPPLY_BROWSER_SESSION_ID: session,
    OPENAPPLY_WORKER_CAPABILITY: capability,
    OPENAPPLY_BROWSER_OUTPUT_DIR: "/untrusted/environment/path",
  };
  let attached = false;
  let executed = false;
  const target = await stageFile(source, {
    environment,
    runtime: () => ({ backend: "wsl" }),
    fetcher: async (url, options) => {
      assert.equal(url, `http://127.0.0.1:14103/queue/workers/${session}/attach`);
      assert.equal(options.headers["X-OpenApply-Worker-Capability"], capability);
      assert.equal(options.body, undefined);
      assert.equal(options.redirect, "error");
      attached = true;
      return Response.json({ browserSessionId: session, port: 19444, outputDir: base });
    },
    execute: async (command, options) => {
      assert.ok(attached);
      executed = true;
      assert.deepEqual(options.input, bytes);
      assert.equal(command.at(-4), base);
      assert.equal(command.at(-3), `${base}/documents`);
      assert.equal(command.at(-1), "owned");
      assert.ok(!command.join(" ").includes(capability));
      assert.ok(!command.join(" ").includes("untrusted"));
    },
  });
  assert.ok(executed);
  assert.equal(path.posix.dirname(target), `${base}/documents`);
  assert.match(path.posix.basename(target), /^[\da-f-]{36}\.pdf$/);
});

test("partial worker context never falls back to shared staging", async (t) => {
  const { source } = await fixture(t);
  for (const key of [
    "OPENAPPLY_WORK_ITEM_ID",
    "OPENAPPLY_WORK_LEASE_TOKEN",
    "OPENAPPLY_BROWSER_SESSION_ID",
    "OPENAPPLY_WORKER_CAPABILITY",
    "OPENAPPLY_BROWSER_CDP_PORT",
    "OPENAPPLY_BROWSER_OUTPUT_DIR",
  ]) {
    await assert.rejects(
      stageFile(source, {
        environment: { [key]: "present" },
        runtime: () => {
          throw Error("Must not create a guest command");
        },
        fetcher: () => {
          throw Error("Must not fetch");
        },
        execute: () => {
          throw Error("Must not stage");
        },
      }),
      /Owned browser context is required/,
    );
  }
});

test("a refused or foreign attachment stops staging before any guest write", async (t) => {
  const { source } = await fixture(t);
  const session = randomUUID();
  const environment = {
    OPENAPPLY_COMPANION: "http://127.0.0.1:14103",
    OPENAPPLY_BROWSER_SESSION_ID: session,
    OPENAPPLY_WORKER_CAPABILITY: "a".repeat(64),
  };
  for (const response of [
    new Response("", { status: 403 }),
    Response.json({
      browserSessionId: session,
      port: 19444,
      outputDir: `/home/pilot/openapply/queue-workers/${randomUUID()}`,
    }),
    Response.json({
      browserSessionId: session,
      port: 9222,
      outputDir: `/home/pilot/openapply/queue-workers/${session}`,
    }),
  ]) {
    await assert.rejects(
      stageFile(source, {
        environment,
        fetcher: async () => response,
        execute: () => {
          throw Error("Must not stage");
        },
      }),
      /Owned browser/,
    );
  }
});

test("invalid or empty application documents do not produce guest writes", async (t) => {
  const { source } = await fixture(t);
  await writeFile(source, "");
  for (const filename of [source, source.replace(/\.pdf$/, ".exe")]) {
    await assert.rejects(
      stageFile(filename, {
        environment: {},
        execute: () => {
          throw Error("Must not stage");
        },
      }),
      /Only PDF|nonempty/,
    );
  }
});
