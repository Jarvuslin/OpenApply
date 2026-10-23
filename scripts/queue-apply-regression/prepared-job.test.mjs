import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { sha256 } from "../apply-e2e/api.mjs";
import { syntheticApplicant } from "../apply-e2e/applicant.mjs";
import { CASES, expectedWhyUs } from "../apply-e2e/cases.mjs";
import { renderJob } from "../apply-e2e/forms.mjs";
import { seedPreparedJob } from "./prepared-job.mjs";

const corpus = JSON.parse(
  await readFile(new URL("../scoring-regression/fixtures/phase1-g.json", import.meta.url)),
);
const preserved = corpus.cases.find((item) => item.fixture === "greenhouse");

function setup() {
  const applicant = syntheticApplicant("queue-preparation-unit", 1);
  const fixture = {
    ...CASES[0],
    company: "Harbor Accessibility Labs queue-preparation-unit",
    url: "http://127.0.0.1:14110/runs/queue-preparation-unit/greenhouse",
  };
  const description = preserved.context.job.description.replaceAll(
    preserved.context.job.company,
    fixture.company,
  );
  fixture.description = description.split("\n\n").at(-1);
  const labels = {
    firstName: "First name",
    lastName: "Last name",
    email: "Email address",
    resume: "Resume PDF",
    workAuthorization: "Are you currently legally authorized to work in Canada?",
    needsSponsorship: fixture.sponsorshipQuestion,
    sponsorshipDetails: "Please describe the sponsorship you will require",
    whyUs: `Why do you want to work at ${fixture.company}?`,
  };
  fixture.fields = Object.entries(labels).map(([id, label]) => ({ id, label }));
  const definitions = fixture.fields.map(({ id, label }) => ({
    stableKey: `fields:${id}`,
    prompt:
      id === "whyUs"
        ? `${label} *Use 80–1200 characters grounded in your experience and the company mission.`
        : `${label} *`,
    required: "required",
    visibility: "visible",
    condition: { state: "unknown", rules: [] },
    groupMode: "all",
    fields: [
      {
        key: id,
        label:
          id === "whyUs"
            ? `${label} *Use 80–1200 characters grounded in your experience and the company mission.`
            : `${label} *`,
        type:
          {
            email: "email",
            resume: "file",
            workAuthorization: "single_choice",
            needsSponsorship: "single_choice",
          }[id] ?? "text",
        options: ["workAuthorization", "needsSponsorship"].includes(id)
          ? [
              { value: "yes", label: "Yes" },
              { value: "no", label: "No" },
            ]
          : [],
      },
    ],
  }));
  const script = [...renderJob(fixture, "key").matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
  const observed = {
    sourceUrl: fixture.url,
    description,
    scriptSha256: sha256(script),
    blockedRequests: [],
    states: ["", "no", "yes", "no", "yes"].map((value) => ({
      value,
      observation: {
        coverage: "partial",
        definitions: definitions.map((item) => {
          const definition = structuredClone(item);
          if (item.fields[0].key === "sponsorshipDetails" && value !== "yes") {
            definition.visibility = "hidden";
            definition.required = "unknown";
          }
          return definition;
        }),
      },
    })),
  };
  const context = structuredClone(preserved.context);
  context.basis.resumeId = "resume";
  context.basis.jobSha256 = "f".repeat(64);
  context.job.company = fixture.company;
  context.job.url = fixture.url;
  context.job.description = description;
  let offset = 0;
  context.job.criteria = context.job.criteria.map((criterion, index) => {
    const text = criterion.text.replaceAll(preserved.context.job.company, fixture.company);
    const start = description.indexOf(text, offset);
    offset = start + text.length;
    return { ...criterion, id: `current-${index}`, text, start, end: offset };
  });
  const calls = [];
  const report = {};
  const pdf = Buffer.from("%PDF-1.4\nsynthetic pure unit bytes\n%%EOF");
  let questions = [];
  let variant;
  let artifact;
  let selection;
  let job;
  const request = async (path, options = {}) => {
    calls.push({ path, ...options });
    const body = options.body;
    if (path === "/api/campaigns/") return { campaignId: "campaign" };
    if (path === "/api/campaigns/campaign/jobs") {
      job = { ...body, id: "job", campaignId: "campaign" };
      return job;
    }
    if (path === "/api/score-fit/context") return context;
    if (path === "/api/score-fit/") return { basis: body.basis, score: 100, verdict: "assessed" };
    if (path === "/api/resumes/resume/tailor") {
      const rewrite = body.bulletRewrites[0].bullets[0];
      variant = {
        id: "variant",
        resumeId: "resume",
        jobUrl: fixture.url,
        createdAt: "2026-10-08T12:00:01Z",
        content: structuredClone(applicant.content),
        rewrites: {
          experience: [{ entryIndex: 0, bullets: [rewrite] }],
          workflowReview: body.workflowReview,
        },
      };
      variant.content.experience[0].bullets[0] = rewrite.tailored;
      artifact = {
        variantId: "variant",
        source: { sha256: sha256(applicant.originalText) },
        job: { url: fixture.url },
        validation: { valid: true },
        audit: variant.rewrites,
        revision: "r".repeat(64),
        pdfSha256: sha256(pdf),
        sizeBytes: pdf.length,
      };
      return {
        id: "variant",
        flags: ["Independent review incomplete", "Humanizer review incomplete"],
      };
    }
    if (path === "/api/resumes/variants/variant") return variant;
    if (path === "/api/resumes/variants/variant/artifacts") return { artifact };
    if (options.binary) return pdf;
    if (path === "/api/jobs/job/questions/observations") {
      questions = body.definitions.map((definition, index) => ({
        id: `question-${index}`,
        definition,
        revision: 1,
        definitionHash: "d".repeat(64),
        current: true,
        blocking: false,
      }));
      return {};
    }
    if (path === "/api/jobs/job/questions")
      return {
        collectionVersion: questions.length ? 1 : 0,
        latestCollection: { coverage: "complete" },
        questions,
      };
    if (path.endsWith("/answers")) {
      const question = questions.find((item) => path.includes(`/${item.id}/`));
      question.answer = {
        id: `answer-${question.id}`,
        confirmedAt: "2026-10-08T12:00:02Z",
        values: body.values,
      };
      return question;
    }
    if (path.endsWith("/document-selection")) {
      selection = {
        id: "selection",
        available: true,
        current: true,
        pdfSha256: artifact.pdfSha256,
      };
      return selection;
    }
    if (path === "/api/jobs/job/preparation?mode=preview")
      return {
        coverage: "complete",
        submissionAllowed: false,
        questions,
        documentFields: [{ selection }],
        collectionVersion: 1,
        manifestHash: "m".repeat(64),
      };
    if (path === "/api/campaigns/campaign/jobs/queue-greenhouse")
      return { ...job, status: "approved" };
    assert.fail(`Unexpected fake API route: ${path}`);
  };
  const args = {
    api: { request },
    environment: {
      cdpUrl: "http://127.0.0.1:19222",
      guestCommand: async (command, options) => {
        assert.deepEqual(command, ["node", "--input-type=module"]);
        assert.match(options.input, /outside_exact_fixture_read/);
        assert.match(options.input, /routeWebSocket/);
        assert.ok(
          options.input.includes(
            "file:///home/pilot/openapply-tools/node_modules/playwright-core/index.mjs",
          ),
        );
        assert.ok(options.timeout <= 90_000);
        return JSON.stringify(observed);
      },
    },
    fixture,
    applicant,
    seeded: { resumeId: "resume" },
    startedAt: "2026-10-08T12:00:00Z",
    report,
    save: async () => {},
  };
  return { args, calls, observed, context, report, request };
}

test("prepared fixture confirms exact answers and PDF while honestly retaining replay and unavailable reviews", async () => {
  const f = setup();
  const result = await seedPreparedJob(f.args);
  assert.equal(result.job.status, "approved");
  assert.equal(result.preparation.stage, "ready_for_actual_queue_worker");
  assert.equal(result.preparation.modelCalls, 0);
  assert.equal(result.preparation.fit.origin, "preserved_synthetic");
  assert.equal(result.preparation.fit.actualModel, null);
  assert.equal(result.preparation.variant.reviewer.status, "unavailable");
  assert.equal(result.preparation.variant.humanizer.status, "unavailable");
  const answers = f.calls.filter((call) => call.path.endsWith("/answers"));
  assert.equal(answers.length, 7);
  assert.equal(
    answers.find((call) => call.body.values[0].fieldKey === "whyUs").body.values[0].value,
    expectedWhyUs(f.args.fixture),
  );
  assert.ok(
    answers.every((call) => call.body.confirmed === true && call.body.expectedRevision === 1),
  );
  const collected = f.calls.find((call) => call.path.endsWith("/observations")).body;
  assert.equal(collected.coverage, "complete");
  assert.equal(
    collected.definitions.filter((definition) => definition.condition.state === "known").length,
    1,
  );
  const selected = f.calls.find((call) => call.path.endsWith("/document-selection")).body;
  assert.equal(selected.jobId, "job");
  assert.equal(selected.variantId, "variant");
  assert.equal(selected.confirmed, true);
  assert.equal(selected.expectedSelectionId, null);
  assert.ok(
    !f.calls.some((call) => /submission|receipt|\/result|\/claim|\/begin|grants/.test(call.path)),
  );
  const score = f.calls.find((call) => call.path === "/api/score-fit/").body;
  assert.equal(score.assessments[0].criterionId, "current-0");
  for (const evidence of score.preferenceChecks.workMode.evidence)
    assert.equal(
      f.context.job[evidence.source].slice(evidence.start, evidence.end),
      evidence.quote,
    );
  if (typeof Bun !== "undefined") {
    const { buildTailoredVariant } = await import(
      "../../apps/api/src/modules/resume/tailoring/build-variant.ts"
    );
    const { tailorResumeSchema } = await import(
      "../../apps/api/src/modules/resume/variants/variant.schema.ts"
    );
    const body = tailorResumeSchema.parse(
      f.calls.find((call) => call.path.endsWith("/tailor")).body,
    );
    const built = buildTailoredVariant(f.args.applicant.content, body);
    assert.equal(built.rewordedBullets, 1);
    assert.equal(built.audit.workflowReview.reviewer.status, "unavailable");
    assert.equal(built.audit.workflowReview.humanizer.status, "unavailable");
  }
});

test("changed source text stops before browser inspection or writes", async () => {
  const f = setup();
  f.args.applicant.originalText += "Changed";
  f.args.environment.guestCommand = () => assert.fail("Must not inspect changed inputs.");
  await assert.rejects(seedPreparedJob(f.args));
  assert.equal(f.calls.length, 0);
});

test("an unproven sponsorship branch stops before any preparation API mutation", async () => {
  const f = setup();
  f.observed.states[1].observation.definitions.find(
    (item) => item.stableKey === "fields:sponsorshipDetails",
  ).visibility = "visible";
  await assert.rejects(seedPreparedJob(f.args));
  assert.equal(f.calls.length, 0);
});

test("a new field or changed conditional script cannot silently gain complete coverage", async () => {
  for (const mutate of [
    (f) => {
      f.observed.scriptSha256 = "changed";
    },
    (f) => {
      f.observed.states[2].observation.definitions.push({ fields: [{ key: "newQuestion" }] });
    },
  ]) {
    const f = setup();
    mutate(f);
    await assert.rejects(seedPreparedJob(f.args));
    assert.equal(f.calls.length, 0);
  }
});

test("preference drift rejects historical fit before persisting a new score or variant", async () => {
  const f = setup();
  f.context.preferences.preferredLocations = ["Elsewhere"];
  await assert.rejects(seedPreparedJob(f.args), /Preserved preferences changed/);
  assert.ok(
    !f.calls.some((call) => call.path === "/api/score-fit/" || call.path.endsWith("/tailor")),
  );
});

test("a missing confirmed answer acknowledgement prevents document selection and approval", async () => {
  const f = setup();
  f.args.api.request = async (path, options) => {
    const value = await f.request(path, options);
    if (path.endsWith("/answers")) value.answer.confirmedAt = null;
    return value;
  };
  await assert.rejects(seedPreparedJob(f.args));
  assert.ok(
    !f.calls.some((call) => call.path.endsWith("/document-selection") || call.method === "PATCH"),
  );
});

test("artifact byte mismatch prevents synthetic answers and queue eligibility", async () => {
  const f = setup();
  f.args.api.request = async (path, options) => {
    const value = await f.request(path, options);
    return options?.binary ? Buffer.from("%PDF-wrong immutable bytes") : value;
  };
  await assert.rejects(seedPreparedJob(f.args));
  assert.ok(
    !f.calls.some((call) => call.path.endsWith("/observations") || call.method === "PATCH"),
  );
});
