import assert from "node:assert/strict";
import test from "node:test";
import { browserFor, skip } from "../../plugin/bin/preparation-test-helpers.mjs";
import { extractQuestions } from "../../plugin/bin/question-dom.mjs";
import { sha256 } from "../apply-e2e/api.mjs";
import { syntheticApplicant } from "../apply-e2e/applicant.mjs";
import { setupFixture } from "../apply-e2e/fixture-test-helpers.mjs";
import { seedPreparedJob } from "./prepared-job.mjs";

test("actual fixture DOM preserves help in labels and proves only its observed sponsorship dependency", {
  skip,
  timeout: 30_000,
}, async (t) => {
  const server = await setupFixture(t);
  const fixture = server.manifest.cases.find((item) => item.id === "greenhouse");
  const browser = await browserFor(t);
  const page = await browser.newPage();
  const blocked = [];
  await page.route("**/*", async (route) => {
    if (route.request().method() === "GET" && route.request().url() === fixture.url)
      await route.continue();
    else {
      blocked.push(route.request().method());
      await route.abort();
    }
  });
  await page.goto(fixture.url, { waitUntil: "networkidle" });
  const structure = await page.evaluate(() => {
    const main = document.querySelector("main");
    const heading = main.querySelector(":scope > h1");
    const about = main.querySelector(":scope > h2");
    return {
      description: [
        heading.innerText,
        heading.nextElementSibling.innerText,
        about.innerText,
        about.nextElementSibling.innerText,
      ].join("\n\n"),
      script: document.scripts[0].textContent,
    };
  });
  const states = [];
  for (const value of ["", "no", "yes", "no", "yes"]) {
    await page.locator('[name="needsSponsorship"]').selectOption(value);
    states.push({ value, observation: await page.evaluate(extractQuestions) });
  }
  const observed = {
    sourceUrl: fixture.url,
    description: structure.description,
    scriptSha256: sha256(structure.script),
    states,
    blockedRequests: blocked,
  };
  const whyUs = states[2].observation.definitions.find((item) => item.stableKey === "fields:whyUs");
  assert.equal(
    whyUs.prompt,
    `Why do you want to work at ${fixture.company}? *Use 80–1200 characters grounded in your experience and the company mission.`,
  );
  assert.equal(whyUs.fields[0].label, whyUs.prompt);
  const stop = new Error("Stop before first API operation.");
  let apiCalls = 0;
  const report = {};
  const args = {
    fixture,
    applicant: syntheticApplicant("fixture-unit-test", 1),
    seeded: { resumeId: "unused-before-api" },
    startedAt: new Date().toISOString(),
    report,
    save: async () => {},
    api: {
      request: async (path) => {
        assert.equal(path, "/api/campaigns/");
        apiCalls++;
        throw stop;
      },
    },
    environment: {
      cdpUrl: "http://127.0.0.1:19222",
      guestCommand: async () => JSON.stringify(observed),
    },
  };
  await assert.rejects(seedPreparedJob(args), (error) => error === stop);
  assert.equal(apiCalls, 1);
  assert.equal(report.preparation.stage, "create_current_job");
  assert.deepEqual(report.preparation.observation.states, states);
  // The same real DOM observation must fail closed when any help text is unaccounted for.
  const changed = structuredClone(observed);
  for (const state of changed.states) {
    const question = state.observation.definitions.find(
      (item) => item.stableKey === "fields:whyUs",
    );
    question.prompt += " Changed instructions.";
    question.fields[0].label = question.prompt;
  }
  args.environment.guestCommand = async () => JSON.stringify(changed);
  await assert.rejects(seedPreparedJob(args), /Expected values to be strictly equal/);
  assert.equal(apiCalls, 1);
  assert.deepEqual(blocked, []);
  const evidence = await (await fetch(`${server.origin}/__fixture__/submissions`)).json();
  assert.deepEqual(evidence.submissions, []);
  assert.deepEqual(evidence.submissionRequests, {});
});
