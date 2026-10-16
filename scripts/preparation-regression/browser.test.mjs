import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import test from "node:test";
import { previewPreparation } from "../../plugin/bin/preparation-preview.mjs";
import { extractQuestions } from "../../plugin/bin/question-dom.mjs";
import { expectedWhyUs, SYNTHETIC_APPLICANT } from "../apply-e2e/cases.mjs";
import { setupFixture, TEST_PDF } from "../apply-e2e/fixture-test-helpers.mjs";

const modulePath = "/home/pilot/openapply-tools/node_modules/playwright-core/index.mjs";
const skip =
  !existsSync(modulePath) || !existsSync("/usr/bin/chromium")
    ? "Run in the existing browser guest with Chromium."
    : false;

test("four preserved ATS layouts prepare only confirmed native controls and never submit", {
  skip,
  timeout: 60000,
}, async (t) => {
  const fixture = await setupFixture(t);
  const { chromium } = await import(modulePath);
  const browser = await chromium.launch({
    executablePath: "/usr/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  t.after(() => browser.close());
  const pdfSha256 = createHash("sha256").update(TEST_PDF).digest("hex");
  for (const job of fixture.manifest.cases) {
    const url = `${job.url}${job.entryPath}`;
    const page = await browser.newPage();
    await page.goto(url);
    const observed = await page.evaluate(extractQuestions);
    await page.close();
    const jobId = randomUUID();
    const values = {
      ...SYNTHETIC_APPLICANT,
      workAuthorization: "yes",
      [job.sponsorshipField]: job.expectedSponsorship,
      whyUs: expectedWhyUs(job),
    };
    const questions = observed.definitions.map((definition) => ({
      id: randomUUID(),
      jobId,
      current: true,
      definition,
      revision: 1,
      definitionHash: "a".repeat(64),
      answer:
        definition.fields[0].type === "file"
          ? null
          : {
              id: randomUUID(),
              confirmedAt: new Date().toISOString(),
              values: definition.fields.map((field) => ({
                fieldKey: field.key,
                value: values[field.key],
              })),
            },
    }));
    const documents = questions
      .filter((question) => question.definition.fields[0].type === "file")
      .map((question) => ({
        questionId: question.id,
        fieldKey: question.definition.fields[0].key,
        pdfSha256,
        sizeBytes: TEST_PDF.length,
        base64: TEST_PDF.toString("base64"),
      }));
    const result = await previewPreparation(browser, {
      allowLoopback: true,
      manifest: {
        job: { id: jobId, url },
        mode: "preview",
        submissionAllowed: false,
        questions,
        documentFields: [],
        coverage: "partial",
        collectionVersion: 1,
        manifestHash: "b".repeat(64),
      },
      documents,
    });
    assert.equal(result.sourceUrl, url);
    assert.equal(result.status, "partial", `${job.id} must retain dynamic or multi-step fallback`);
    for (const key of [...job.nameFields, "email"])
      assert.equal(
        result.fields.find((field) => field.fieldKey === key)?.status,
        "verified",
        `${job.id}: ${key}`,
      );
    if (job.id === "unfamiliar") {
      assert.ok(
        !result.fields.some((field) => field.fieldKey === "workAuthorization"),
        "Must not advance the unfamiliar form",
      );
      assert.match(result.reason, /steps|branches|review/i);
    } else {
      for (const [fieldKey, value] of [
        ["workAuthorization", "yes"],
        [job.sponsorshipField, job.expectedSponsorship],
        ["sponsorshipDetails", SYNTHETIC_APPLICANT.sponsorshipDetails],
        ["whyUs", expectedWhyUs(job)],
      ]) {
        const field = result.fields.find((field) => field.fieldKey === fieldKey);
        assert.equal(field?.status, "verified", `${job.id}: ${fieldKey}`);
        assert.equal(field.value, value);
      }
      assert.equal(
        result.fields.find((field) => field.fieldKey === "resume")?.pdfSha256,
        pdfSha256,
      );
    }
  }
  const submissions = await (await fetch(`${fixture.origin}/__fixture__/submissions`)).json();
  assert.deepEqual(submissions.submissions, []);
  assert.deepEqual(submissions.submissionRequests, {});
});
