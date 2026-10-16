import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { run } from "./runtime.mjs";
import { stageFile } from "./stage-file.mjs";
import {
  assertAttachment,
  resultText,
  snapshotTarget,
  uploadFixture,
  uploadMcp,
} from "./worker-upload-test-helpers.mjs";

const skip =
  !existsSync("/home/pilot/openapply-tools/node_modules/@playwright/mcp/cli.js") ||
  !existsSync("/usr/bin/chromium")
    ? "Run actual MCP upload tests in the installed guest."
    : false;

test("owned MCP chooser and true dropzone retain the exact PDF and reject shared or foreign paths", {
  skip,
  timeout: 60000,
}, async (t) => {
  const session = randomUUID();
  const foreign = randomUUID();
  const root = `/home/pilot/openapply/queue-workers/${session}`;
  const other = `/home/pilot/openapply/queue-workers/${foreign}`;
  const directory = `${root}/documents`;
  const shared = `/home/pilot/openapply/${randomUUID()}.pdf`;
  const foreignFile = `${other}/${randomUUID()}.pdf`;
  const link = `${directory}/foreign-resume.pdf`;
  const bytes = Buffer.from(
    "%PDF-1.7\nSynthetic reviewed resume\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n",
  );
  await mkdir(directory, { recursive: true });
  await mkdir(other, { recursive: true });
  await Promise.all([writeFile(shared, bytes), writeFile(foreignFile, bytes)]);
  await symlink(foreignFile, link);
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(other, { recursive: true, force: true });
    await rm(shared, { force: true });
  });
  const file = await stageFile(shared, {
    environment: {
      OPENAPPLY_COMPANION: "http://127.0.0.1:14103",
      OPENAPPLY_BROWSER_SESSION_ID: session,
      OPENAPPLY_WORKER_CAPABILITY: "a".repeat(64),
    },
    runtime: () => ({ backend: "wsl" }),
    fetcher: async () => Response.json({ browserSessionId: session, port: 19444, outputDir: root }),
    execute: async (command, options) => {
      assert.deepEqual(command.slice(0, 6), [
        "wsl.exe",
        "-d",
        "OpenApply-MVP",
        "-u",
        "root",
        "--exec",
      ]);
      return run(command.slice(6), options);
    },
  });
  assert.equal(path.posix.dirname(file), directory);
  const name = path.posix.basename(file);
  const { url, uploads } = await uploadFixture(t);
  const call = await uploadMcp(t, root);
  assert.ok(!(await call("browser_navigate", { url })).isError);
  let page = await call("browser_snapshot");
  let target = snapshotTarget(page, "Choose resume");
  assert.ok(!(await call("browser_click", { target, element: "Choose resume" })).isError);
  for (const denied of [shared, foreignFile, link]) {
    const result = await call("browser_file_upload", { paths: [denied] });
    assert.ok(result.isError, `Unexpected chooser access to ${denied}`);
    assert.match(resultText(result), /File access denied.*outside allowed roots/);
    assert.equal(uploads.length, 0);
  }
  const chooser = await call("browser_file_upload", { paths: [file] });
  assert.ok(!chooser.isError, resultText(chooser));
  await assertAttachment(call, name);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].name, path.posix.basename(file));
  assert.deepEqual(uploads[0].bytes, bytes);

  assert.ok(!(await call("browser_navigate", { url })).isError);
  page = await call("browser_snapshot");
  target = snapshotTarget(page, "Resume dropzone");
  for (const denied of [shared, foreignFile, link]) {
    const result = await call("browser_drop", {
      target,
      element: "Resume dropzone",
      paths: [denied],
    });
    assert.ok(result.isError, `Unexpected dropzone access to ${denied}`);
    assert.match(resultText(result), /File access denied.*outside allowed roots/);
    assert.equal(uploads.length, 1);
  }
  const dropped = await call("browser_drop", { target, element: "Resume dropzone", paths: [file] });
  assert.ok(!dropped.isError, resultText(dropped));
  await assertAttachment(call, name);
  assert.equal(uploads.length, 2);
  assert.equal(uploads[1].name, path.posix.basename(file));
  assert.deepEqual(uploads[1].bytes, bytes);
  t.diagnostic(
    "Actual installed MCP: chooser + dropzone; two exact PDF attachments; six refused cross-worker/shared/symlink operations; zero employer/model actions.",
  );
});
