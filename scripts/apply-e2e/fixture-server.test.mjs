import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { startFixtureServer } from "./fixture-server.mjs";
import { applicationForm, setupFixture, submit, TEST_PDF } from "./fixture-test-helpers.mjs";

test("the manifest and rendered job description share the exact run-specific employer identity", async (t) => {
  const fixture = await setupFixture(t);
  const manifest = await (await fetch(`${fixture.origin}/__fixture__/manifest`)).json();
  for (const job of manifest.cases) {
    assert.ok(job.company.endsWith(` ${manifest.runId}`));
    assert.ok(job.description.startsWith(`${job.company} is a synthetic employer`));
    const posting = await (await fetch(job.url)).text();
    assert.ok(posting.includes(`<strong>${job.company}</strong>`));
    assert.equal(posting.match(/<h2>About the role<\/h2><p>([^<]+)<\/p>/)?.[1], job.description);
    assert.equal(
      job.fields.find((field) => field.id === "whyUs").label,
      `Why do you want to work at ${job.company}?`,
    );
  }
});

test("fixture records exact posted values, PDF bytes, and distinct receipts for all four cases", async (t) => {
  const fixture = await setupFixture(t);
  assert.equal(new URL(fixture.origin).hostname, "127.0.0.1");
  const manifest = await (await fetch(`${fixture.origin}/__fixture__/manifest`)).json();
  assert.equal(manifest.runId, "fixture-unit-test");
  assert.equal(manifest.cases.length, 4);
  for (const job of manifest.cases) {
    const response = await submit(fixture, job);
    assert.equal(response.status, 303);
    const receipt = await (await fetch(response.headers.get("location"))).text();
    assert.match(receipt, /Test application received/);
    assert.match(receipt, /LOCAL TEST FIXTURE/);
  }
  const result = await (await fetch(`${fixture.origin}/__fixture__/submissions`)).json();
  assert.equal(result.submissions.length, 4);
  assert.equal(new Set(result.submissions.map((entry) => entry.receipt.id)).size, 4);
  const disk = JSON.parse(await readFile(join(fixture.outputDir, "submissions.json"), "utf8"));
  assert.deepEqual(disk, result);
  for (const entry of result.submissions) {
    const job = manifest.cases.find((item) => item.id === entry.caseId);
    assert.equal(entry.fields.workAuthorization, "yes");
    assert.equal(entry.submissionRequests, 1);
    assert.equal(entry.fields[job.sponsorshipField], job.expectedSponsorship);
    assert.equal(entry.resume.sha256, createHash("sha256").update(TEST_PDF).digest("hex"));
    assert.equal(entry.resume.size, TEST_PDF.length);
    assert.deepEqual(
      await readFile(join(fixture.outputDir, `${entry.caseId}-resume.pdf`)),
      TEST_PDF,
    );
  }
});

test("concurrent identical submissions retain exactly one receipt; changed duplicate is rejected", async (t) => {
  const fixture = await setupFixture(t);
  const job = fixture.manifest.cases[0];
  const responses = await Promise.all([
    submit(fixture, job),
    submit(fixture, job),
    submit(fixture, job),
  ]);
  assert.deepEqual(
    responses.map((response) => response.status),
    [303, 303, 303],
  );
  assert.equal(new Set(responses.map((response) => response.headers.get("location"))).size, 1);
  const changed = await submit(fixture, job, { workAuthorization: "no" });
  assert.equal(changed.status, 409);
  const result = await (await fetch(`${fixture.origin}/__fixture__/submissions`)).json();
  assert.equal(result.submissions.length, 1);
  assert.equal(result.submissions[0].submissionRequests, 4);
});

test("persisted receipts survive restart and reordered form fields remain idempotent", async (t) => {
  const fixture = await setupFixture(t);
  const job = fixture.manifest.cases[0];
  const submitted = await submit(fixture, job);
  const originalReceipt = submitted.headers.get("location");
  await fixture.close();
  const restarted = await startFixtureServer({
    port: Number(new URL(fixture.origin).port),
    runId: "fixture-unit-test",
    outputDir: fixture.outputDir,
  });
  t.after(() => restarted.close());
  const newJob = restarted.manifest.cases[0];
  const original = await applicationForm(newJob);
  const reordered = new FormData();
  for (const [name, value] of [...original.entries()].reverse()) reordered.append(name, value);
  const response = await fetch(`${newJob.url}/apply`, {
    method: "POST",
    body: reordered,
    headers: { Origin: restarted.origin },
    redirect: "manual",
  });
  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), originalReceipt);
  assert.equal((await fetch(originalReceipt)).status, 200);
  const result = await (await fetch(`${restarted.origin}/__fixture__/submissions`)).json();
  assert.equal(result.submissions.length, 1);
  assert.equal(result.submissions[0].submissionRequests, 2);
});

test("missing required values, malformed files, and unsupported fields never produce receipts", async (t) => {
  const fixture = await setupFixture(t);
  const job = fixture.manifest.cases[0];
  const invalid = [
    { name: "A real applicant" },
    { email: "person@company.com" },
    { workAuthorization: undefined },
    { needsSponsorship: "maybe" },
    { sponsorshipDetails: undefined },
    { whyUs: "Too short" },
    { whyUs: "x".repeat(1201) },
    { resume: undefined },
    { resume: new Blob(["x".repeat(100)], { type: "application/pdf" }) },
    { resume: new Blob([TEST_PDF], { type: "text/plain" }) },
    { resume: new Blob(["x".repeat(1024 * 1024 + 1)], { type: "application/pdf" }) },
    { unexpected: "field" },
    { idempotencyKey: "wrong" },
  ];
  for (const fields of invalid) {
    const response = await submit(fixture, job, fields);
    assert.ok(
      [400, 422].includes(response.status),
      `unexpected status ${response.status} for ${Object.keys(fields)}`,
    );
  }
  const duplicate = await applicationForm(job);
  duplicate.append("workAuthorization", "no");
  const response = await fetch(`${job.url}/apply`, {
    method: "POST",
    body: duplicate,
    headers: { Origin: fixture.origin },
  });
  assert.equal(response.status, 422);
  const records = await (await fetch(`${fixture.origin}/__fixture__/submissions`)).json();
  assert.equal(records.submissions.length, 0);
  assert.equal(records.submissionRequests[job.id], invalid.length + 1);
});

test("fixture accepts valid but factually wrong yes/no answers so the E2E assertions must detect them", async (t) => {
  const fixture = await setupFixture(t);
  for (const job of fixture.manifest.cases) {
    const response = await submit(fixture, job, {
      workAuthorization: "no",
      [job.sponsorshipField]: job.expectedSponsorship === "yes" ? "no" : "yes",
      sponsorshipDetails: undefined,
    });
    assert.equal(response.status, 303);
  }
  const records = await (await fetch(`${fixture.origin}/__fixture__/submissions`)).json();
  assert.equal(records.submissions.length, 4);
  assert.ok(records.submissions.every((entry) => entry.fields.workAuthorization === "no"));
});
