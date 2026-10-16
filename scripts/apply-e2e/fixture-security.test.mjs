import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";
import test from "node:test";
import { startFixtureServer } from "./fixture-server.mjs";
import { applicationForm, setupFixture, submit } from "./fixture-test-helpers.mjs";

test("fixture refuses non-loopback binds, missing run directories, and unsafe run IDs", async () => {
  await assert.rejects(
    startFixtureServer({ host: "0.0.0.0", runId: "test", outputDir: ".temp/test" }),
    /127\.0\.0\.1/,
  );
  await assert.rejects(
    startFixtureServer({ runId: "../escape", outputDir: ".temp/test" }),
    /run ID/,
  );
  await assert.rejects(startFixtureServer({ runId: "test" }), /outputDir/);
});

test("fixture rejects unsafe Host, Origin, fetch-site and unsigned POST requests", async (t) => {
  const fixture = await setupFixture(t);
  const path = `${fixture.origin}/__fixture__/submissions`;
  for (const headers of [
    { Host: "evil.test" },
    { Host: "127.0.0.1.evil.test" },
    { Origin: "https://evil.test" },
    { Origin: "null" },
    { "Sec-Fetch-Site": "cross-site" },
  ]) {
    const status = await new Promise((accept, reject) => {
      const connection = request(path, { headers }, (response) => {
        response.resume();
        response.once("end", () => accept(response.statusCode));
      });
      connection.once("error", reject);
      connection.end();
    });
    assert.equal(status, 403, JSON.stringify(headers));
  }
  const response = await fetch(`${fixture.manifest.cases[0].url}/apply`, {
    method: "POST",
    body: new FormData(),
  });
  assert.equal(response.status, 403);
});

test("fixture response policy preserves same-origin form origins and still rejects null POST origins", async (t) => {
  const fixture = await setupFixture(t);
  const job = fixture.manifest.cases.find((item) => item.id === "unfamiliar");
  const page = await fetch(`${job.url}/start`);
  assert.equal(page.headers.get("referrer-policy"), "same-origin");
  const response = await fetch(`${job.url}/step/1`, {
    method: "POST",
    headers: { Origin: "null" },
    body: new FormData(),
  });
  assert.equal(response.status, 403);
});

test("a null-origin final POST is counted before rejection, then one valid POST creates one receipt", async (t) => {
  const fixture = await setupFixture(t);
  const job = fixture.manifest.cases[0];
  const rejected = await fetch(`${job.url}/apply`, {
    method: "POST",
    headers: { Origin: "null" },
    body: await applicationForm(job),
    redirect: "manual",
  });
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get("location"), null);
  const before = JSON.parse(await readFile(join(fixture.outputDir, "submissions.json"), "utf8"));
  assert.equal(before.submissionRequests[job.id], 1);
  assert.deepEqual(before.submissions, []);

  const accepted = await submit(fixture, job);
  assert.equal(accepted.status, 303);
  const result = await (await fetch(`${fixture.origin}/__fixture__/submissions`)).json();
  assert.equal(result.submissionRequests[job.id], 2);
  assert.equal(result.submissions.length, 1);
  assert.equal(result.submissions[0].submissionRequests, 2);
  assert.equal(result.submissions[0].receipt.url, accepted.headers.get("location"));
  assert.deepEqual(
    JSON.parse(await readFile(join(fixture.outputDir, "submissions.json"), "utf8")),
    result,
  );
});

test("fixture enforces body size and malformed multipart limits", async (t) => {
  const fixture = await setupFixture(t);
  const path = `${fixture.manifest.cases[0].url}/apply`;
  const tooLarge = await fetch(path, {
    method: "POST",
    headers: { Origin: fixture.origin, "Content-Type": "multipart/form-data; boundary=fixture" },
    body: "x".repeat(2 * 1024 * 1024 + 1),
  });
  assert.equal(tooLarge.status, 413);
  const malformed = await fetch(path, {
    method: "POST",
    headers: { Origin: fixture.origin, "Content-Type": "multipart/form-data; boundary=fixture" },
    body: "broken",
  });
  assert.equal(malformed.status, 400);
  const wrongType = await fetch(path, {
    method: "POST",
    headers: { Origin: fixture.origin, "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(wrongType.status, 415);
});
