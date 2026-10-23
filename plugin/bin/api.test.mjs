import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fixture, runHelper } from "./api-test-helpers.mjs";

test("sends repeated multipart files with exact bytes, base names, and MIME types", async (t) => {
  const { directory, requests, base } = await fixture(t);
  const pdfPath = join(directory, "Submitted Resume.PDF");
  const attachmentPath = join(directory, "evidence=copy.bin");
  const pdfBytes = Buffer.from("%PDF-1.7\noriginal resume\n%%EOF\n");
  const attachmentBytes = Buffer.from([0, 1, 255, 128]);
  await writeFile(pdfPath, pdfBytes);
  await writeFile(attachmentPath, attachmentBytes);

  const result = await runHelper(base, [
    "POST",
    "/api/campaigns/1/jobs/example/submission-resume",
    "--file",
    `file=${pdfPath}`,
    "--file",
    `evidence=${attachmentPath}`,
    "--query",
    "source=trial run",
  ]);

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stdout, '{"ok":true}');
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.equal(request.headers.authorization, "Bearer test-token");
  assert.equal(request.headers.accept, "application/json");
  assert.match(request.headers["content-type"], /^multipart\/form-data; boundary=/);
  assert.equal(request.url, "/api/campaigns/1/jobs/example/submission-resume?source=trial+run");
  const form = await new Response(request.bytes, {
    headers: { "content-type": request.headers["content-type"] },
  }).formData();
  const pdf = form.get("file");
  assert.equal(pdf.name, "Submitted Resume.PDF");
  assert.equal(pdf.type, "application/pdf");
  assert.deepEqual(Buffer.from(await pdf.arrayBuffer()), pdfBytes);
  const attachment = form.get("evidence");
  assert.equal(attachment.name, "evidence=copy.bin");
  assert.equal(attachment.type, "application/octet-stream");
  assert.deepEqual(Buffer.from(await attachment.arrayBuffer()), attachmentBytes);
  assert.equal(Array.from(form.keys()).length, 2);
  assert.doesNotMatch(result.stdout + result.stderr, /original resume|test-token/);
});

test("rejects --file with --data in either order before sending a request", async (t) => {
  const { directory, requests, base } = await fixture(t);
  const fileArgs = ["--file", `file=${join(directory, "not-read.pdf")}`];
  for (const options of [
    [...fileArgs, "--data", "{}"],
    ["-d", "{}", ...fileArgs],
  ]) {
    const result = await runHelper(base, ["POST", "/api/upload", ...options]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /--file cannot be combined with --data/);
    assert.equal(result.stdout, "");
  }
  assert.equal(requests.length, 0);
});

test("rejects malformed or relative file arguments", async (t) => {
  const { directory, requests, base } = await fixture(t);
  for (const value of ["file", `=${join(directory, "resume.pdf")}`, "file=relative.pdf", "file="]) {
    const result = await runHelper(base, ["POST", "/api/upload", "--file", value]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /--file (takes|requires)/);
  }
  assert.equal(requests.length, 0);
});

test("keeps JSON request handling unchanged", async (t) => {
  const { requests, base } = await fixture(t);
  const result = await runHelper(base, ["POST", "api/example", "--data", '{"status":"applied"}']);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers["content-type"], "application/json");
  assert.equal(requests[0].bytes.toString(), '{"status":"applied"}');
});

test("multipart uploads cannot send the bearer token to a supplied external URL", async (t) => {
  const { directory, requests, base } = await fixture(t);
  for (const path of ["https://example.com/api/upload", "//example.com/api/upload"]) {
    const result = await runHelper(base, [
      "POST",
      path,
      "--file",
      `file=${join(directory, "not-read.pdf")}`,
    ]);
    assert.equal(result.code, 2);
    assert.match(result.stderr, /path must be API-relative/);
    assert.doesNotMatch(result.stderr, /test-token/);
  }
  assert.equal(requests.length, 0);
});
