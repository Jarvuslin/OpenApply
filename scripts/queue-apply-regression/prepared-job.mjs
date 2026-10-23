import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extractQuestions } from "../../plugin/bin/question-dom.mjs";
import { requireLoopback, sha256 } from "../apply-e2e/api.mjs";
import { expectedWhyUs, SYNTHETIC_APPLICANT } from "../apply-e2e/cases.mjs";
import { renderJob } from "../apply-e2e/forms.mjs";

const corpusUrl = new URL("../scoring-regression/fixtures/phase1-g.json", import.meta.url);
const unavailable = {
  status: "unavailable",
  reason: "Deterministic fixture setup; no independent model reviewer or humanizer was run.",
};

async function observeFixture(config) {
  const { chromium } = await import(
    "file:///home/pilot/openapply-tools/node_modules/playwright-core/index.mjs"
  );
  const { createHash } = await import("node:crypto");
  const browser = await chromium.connectOverCDP(config.cdpUrl, { timeout: 20_000 });
  const context = await browser.newContext({ serviceWorkers: "block" });
  const blocked = [];
  try {
    await context.route("**/*", async (route) => {
      const request = route.request();
      if (request.method() === "GET" && request.url() === config.url) await route.continue();
      else {
        blocked.push({ method: request.method(), category: "outside_exact_fixture_read" });
        await route.abort();
      }
    });
    await context.routeWebSocket("**/*", (socket) => {
      blocked.push({ category: "websocket" });
      socket.close();
    });
    const page = await context.newPage();
    const response = await page.goto(config.url, { waitUntil: "networkidle", timeout: 20_000 });
    if (!response?.ok() || page.url() !== config.url) throw new Error("Fixture GET failed.");
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
        scripts: [...document.scripts].map((script) => script.textContent),
        frames: document.querySelectorAll("iframe").length,
        forms: [...document.forms].map((form) => ({ method: form.method, action: form.action })),
      };
    });
    if (
      structure.scripts.length !== 1 ||
      structure.frames !== 0 ||
      structure.forms.length !== 1 ||
      structure.forms[0].method !== "post" ||
      structure.forms[0].action !== `${config.url}/apply` ||
      createHash("sha256").update(structure.scripts[0]).digest("hex") !== config.scriptSha256
    )
      throw new Error("Fixture form or conditional script changed.");
    const states = [];
    for (const value of ["", "no", "yes", "no", "yes"]) {
      await page.locator('[name="needsSponsorship"]').selectOption(value);
      states.push({ value, observation: await page.evaluate(extractQuestions) });
    }
    if (blocked.length) throw new Error("Fixture inspection attempted an unapproved request.");
    console.log(
      JSON.stringify({
        sourceUrl: page.url(),
        description: structure.description,
        scriptSha256: config.scriptSha256,
        states,
        blockedRequests: blocked,
      }),
    );
  } finally {
    await context.close();
    await browser.close();
  }
}

function resolveFixtureDefinitions(observed, fixture) {
  assert.equal(observed.sourceUrl, fixture.url, "Observed fixture identity changed.");
  assert.deepEqual(observed.blockedRequests, [], "Preflight made an unapproved request.");
  assert.deepEqual(
    observed.states.map((state) => state.value),
    ["", "no", "yes", "no", "yes"],
  );
  const active = observed.states[2].observation.definitions;
  assert.deepEqual(
    active.map((definition) => definition.fields[0]?.key).sort(),
    fixture.fields.map((field) => field.id).sort(),
    "Fixture control inventory changed.",
  );
  for (const definition of active) {
    assert.equal(definition.fields.length, 1);
    const field = definition.fields[0];
    const expected = fixture.fields.find((item) => item.id === field.key);
    const expectedPrompt =
      field.key === "whyUs"
        ? `${expected.label} *Use 80–1200 characters grounded in your experience and the company mission.`
        : `${expected.label} *`;
    assert.equal(definition.prompt, expectedPrompt);
    assert.equal(field.label, definition.prompt);
    assert.equal(definition.stableKey, `fields:${field.key}`);
    assert.equal(definition.required, "required");
    assert.equal(definition.visibility, "visible");
    const expectedType =
      {
        email: "email",
        resume: "file",
        workAuthorization: "single_choice",
        needsSponsorship: "single_choice",
      }[field.key] ?? "text";
    assert.equal(field.type, expectedType);
    assert.deepEqual(
      field.options,
      expectedType === "single_choice"
        ? [
            { value: "yes", label: "Yes" },
            { value: "no", label: "No" },
          ]
        : [],
    );
    for (const state of observed.states) {
      const actual = state.observation.definitions.find(
        (item) => item.stableKey === definition.stableKey,
      );
      assert.ok(actual, "A branch lost a fixture control.");
      if (field.key === "sponsorshipDetails" && state.value !== "yes") {
        assert.equal(actual.visibility, "hidden");
        assert.equal(actual.required, "unknown");
        assert.deepEqual({ ...actual, visibility: "visible", required: "required" }, definition);
      } else assert.deepEqual(actual, definition, "A second dynamic branch changed.");
      assert.equal(state.observation.definitions.length, active.length);
    }
  }
  return active.map((definition) => ({
    ...definition,
    condition:
      definition.fields[0].key === "sponsorshipDetails"
        ? {
            state: "known",
            rules: [{ fieldKey: "needsSponsorship", operator: "equals", values: ["yes"] }],
          }
        : { state: "unconditional", rules: [] },
  }));
}

function replayAssessment(context, preserved, sourceHash, fixture) {
  const previous = preserved.context;
  const assessment = preserved.historical.assessment;
  assert.equal(context.basis.version, previous.basis.version);
  assert.equal(context.basis.sourceSha256, sourceHash);
  assert.equal(context.basis.sourceTextSha256, sourceHash);
  assert.equal(context.resume.text, previous.resume.text, "Preserved resume text changed.");
  assert.deepEqual(context.preferences, previous.preferences, "Preserved preferences changed.");
  assert.equal(context.basis.preferencesSha256, previous.basis.preferencesSha256);
  for (const field of ["title", "location", "type"])
    assert.equal(context.job[field], previous.job[field]);
  assert.equal(context.job.company, fixture.company);
  assert.equal(context.job.url, fixture.url);
  assert.equal(
    context.job.description,
    previous.job.description.replaceAll(previous.job.company, fixture.company),
    "Preserved posting template changed.",
  );
  assert.equal(context.job.criteria.length, assessment.assessments.length);
  const assessments = assessment.assessments.map((item, index) => {
    const criterion = context.job.criteria[index];
    assert.equal(
      criterion.text,
      item.criterion.text.replaceAll(previous.job.company, fixture.company),
    );
    assert.equal(criterion.section, item.criterion.section);
    assert.equal(criterion.isHeading, item.criterion.isHeading);
    assert.equal(context.job.description.slice(criterion.start, criterion.end), criterion.text);
    for (const evidence of item.evidence)
      assert.equal(context.resume.text.slice(evidence.start, evidence.end), evidence.quote);
    return {
      criterionId: criterion.id,
      category: item.category,
      rating: item.rating,
      evidence: item.evidence,
      explanation: item.explanation,
    };
  });
  const rebase = (evidence) => {
    assert.equal(previous.job[evidence.source].slice(evidence.start, evidence.end), evidence.quote);
    const text = context.job[evidence.source];
    const start = text.indexOf(evidence.quote);
    assert.ok(
      start >= 0 && text.indexOf(evidence.quote, start + 1) === -1,
      "Posting evidence must retain one exact location.",
    );
    return { ...evidence, start, end: start + evidence.quote.length };
  };
  const preferenceChecks = structuredClone(assessment.preferenceChecks);
  for (const check of [
    preferenceChecks.level,
    preferenceChecks.workMode,
    preferenceChecks.employmentType,
    preferenceChecks.location,
    ...preferenceChecks.eligibility,
  ])
    check.evidence = check.evidence.map(rebase);
  return {
    basis: context.basis,
    assessments,
    preferenceChecks,
    roleMatch: {
      family: assessment.roleMatch.family,
      explanation: assessment.roleMatch.explanation,
      evidence: assessment.roleMatch.evidence.map(rebase),
    },
  };
}

export async function seedPreparedJob({
  api,
  environment,
  fixture,
  applicant,
  seeded,
  startedAt,
  report,
  save,
}) {
  assert.equal(fixture.id, "greenhouse", "Prepared fixture adapter supports Greenhouse only.");
  assert.equal(fixture.sponsorshipField, "needsSponsorship");
  assert.equal(fixture.expectedSponsorship, "yes");
  requireLoopback(fixture.url);
  requireLoopback(environment.cdpUrl);
  const corpusBytes = await readFile(corpusUrl);
  const corpus = JSON.parse(corpusBytes);
  const preserved = corpus.cases.find((item) => item.fixture === fixture.id);
  const originalHash = sha256(applicant.originalText);
  assert.equal(originalHash, corpus.provenance.originalTextSha256);
  assert.equal(applicant.originalText, preserved.context.resume.text);
  const preparation = {
    mode: "deterministic_prepared_fixture",
    stage: "observe_fixture",
    modelCalls: 0,
    fit: {
      origin: "preserved_synthetic",
      sourceRunId: corpus.provenance.sourceRunId,
      sourceReportSha256: corpus.provenance.sourceReportSha256,
      corpusSha256: sha256(corpusBytes),
      sourceSha256: originalHash,
      actualModel: null,
      usage: null,
      limitation: "Replayed judgments after exact input checks; no new live scoring model was run.",
    },
    variant: {
      origin: "deterministic_authored_fixture",
      reviewer: unavailable,
      humanizer: unavailable,
    },
  };
  report.preparation = preparation;
  const stage = async (value) => {
    preparation.stage = value;
    await save();
  };
  await save();
  const scripts = [
    ...renderJob(fixture, "fixture-preparation-not-a-submit-key").matchAll(
      /<script>([\s\S]*?)<\/script>/g,
    ),
  ];
  assert.equal(scripts.length, 1);
  const config = {
    cdpUrl: environment.cdpUrl,
    url: fixture.url,
    scriptSha256: sha256(scripts[0][1]),
  };
  const script = `const extractQuestions = ${extractQuestions.toString()}; await (${observeFixture.toString()})(${JSON.stringify(config)});`;
  const raw = await environment.guestCommand(["node", "--input-type=module"], {
    input: script,
    timeout: 90_000,
  });
  assert.ok(Buffer.byteLength(raw) <= 200_000, "Fixture observations exceeded their bound.");
  const observed = JSON.parse(raw);
  assert.equal(observed.scriptSha256, config.scriptSha256);
  const definitions = resolveFixtureDefinitions(observed, fixture);
  assert.equal(
    observed.description,
    preserved.context.job.description.replaceAll(preserved.context.job.company, fixture.company),
  );
  preparation.observation = observed;
  preparation.collector = "queue-fixture-greenhouse-branches-v1";
  await stage("create_current_job");
  const campaign = await api.request("/api/campaigns/", {
    method: "POST",
    body: {
      clientCampaignId: randomUUID(),
      query: `Queue fixture: ${fixture.company}`,
      source: "apply",
      config: { resumeId: seeded.resumeId, maxApplications: 1, minScore: 60 },
    },
  });
  const job = await api.request(`/api/campaigns/${campaign.campaignId}/jobs`, {
    method: "POST",
    body: {
      key: `queue-${fixture.id}`,
      title: fixture.title,
      company: fixture.company,
      url: fixture.url,
      location: "Remote, Canada",
      type: "Full time",
      board: "Local synthetic Greenhouse fixture",
      status: "pending",
      description: observed.description,
    },
  });
  preparation.job = { id: job.id, key: job.key, campaignId: campaign.campaignId };
  await stage("validate_replayed_fit");
  const input = { campaignId: campaign.campaignId, jobKey: job.key, resumeId: seeded.resumeId };
  const context = await api.request("/api/score-fit/context", { method: "POST", body: input });
  const fit = await api.request("/api/score-fit/", {
    method: "POST",
    body: {
      ...input,
      ...replayAssessment(context, preserved, originalHash, fixture),
    },
  });
  assert.equal(fit.score, preserved.historical.assessment.score);
  assert.equal(fit.verdict, "assessed");
  assert.deepEqual(fit.basis, context.basis);
  preparation.fit.currentBasis = fit.basis;
  preparation.fit.score = fit.score;
  await stage("create_deterministic_variant");
  const original = applicant.content.experience[0].bullets[0];
  assert.equal(
    original,
    "Built an accessible application dashboard with TypeScript, React, Node.js, and PostgreSQL.",
  );
  const tailored =
    "Built an accessible application dashboard using TypeScript, React, Node.js, and PostgreSQL.";
  const target =
    "We are hiring a software engineer to build accessible web application dashboards and reliable APIs.";
  assert.ok(observed.description.includes(target));
  const created = await api.request(`/api/resumes/${seeded.resumeId}/tailor`, {
    method: "POST",
    timeoutMs: 120_000,
    body: {
      label: `Deterministic fixture — ${fixture.company}`,
      jobUrl: fixture.url,
      jobDescription: observed.description,
      bulletRewrites: [
        {
          entryIndex: 0,
          bullets: [
            {
              original,
              tailored,
              grounding: {
                evidence: [{ path: "/experience/0/bullets/0", quote: original }],
                target: {
                  kind: "job_description",
                  quote: target,
                  reason: "Keep the dashboard implementation explicit.",
                },
                review: {
                  verdict: "supported",
                  claimType: "explicit",
                  rationale:
                    "Fixture-author review: only with becomes using; technology, scope and outcomes remain identical.",
                },
              },
            },
          ],
        },
      ],
      workflowReview: {
        evidencePlan: [
          {
            target,
            sources: ["/experience/0/bullets/0"],
            change: "Deterministic fixture wording: with becomes using; no new facts.",
          },
        ],
        reviewer: unavailable,
        humanizer: unavailable,
        optionalQuestions: [],
      },
      diffNotes:
        "Deterministic fixture setup. No live model tailoring, reviewer, or humanizer execution.",
    },
  });
  const variant = await api.request(`/api/resumes/variants/${created.id}`);
  const { artifact } = await api.request(`/api/resumes/variants/${created.id}/artifacts`);
  assert.equal(variant.resumeId, seeded.resumeId);
  assert.equal(variant.jobUrl, fixture.url);
  assert.ok(
    Date.parse(variant.createdAt) >= Date.parse(startedAt),
    "Variant must belong to this new run.",
  );
  assert.equal(variant.content.experience[0].bullets[0], tailored);
  assert.equal(artifact?.variantId, created.id);
  assert.equal(artifact.source.sha256, originalHash);
  assert.equal(artifact.job.url, fixture.url);
  assert.equal(artifact.validation.valid, true);
  assert.deepEqual(artifact.audit, variant.rewrites);
  const pdf = await api.request(
    `/api/resumes/variants/${created.id}/artifacts/${artifact.revision}/pdf`,
    { binary: true },
  );
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.equal(sha256(pdf), artifact.pdfSha256);
  assert.equal(pdf.length, artifact.sizeBytes);
  Object.assign(preparation.variant, {
    id: created.id,
    revision: artifact.revision,
    pdfSha256: artifact.pdfSha256,
    sizeBytes: artifact.sizeBytes,
    flags: created.flags,
    createdAt: variant.createdAt,
  });
  await stage("confirm_synthetic_answers");
  const before = await api.request(`/api/jobs/${job.id}/questions`);
  await api.request(`/api/jobs/${job.id}/questions/observations`, {
    method: "PUT",
    body: {
      requestId: randomUUID(),
      expectedCollectionVersion: before.collectionVersion,
      source: "browser_dom",
      sourceUrl: observed.sourceUrl,
      coverage: "complete",
      collectorVersion: preparation.collector,
      reason:
        "Exact local fixture script and control inventory verified; sponsorship blank/no/yes/no/yes branches observed without submission.",
      definitions,
    },
  });
  const questions = await api.request(`/api/jobs/${job.id}/questions`);
  assert.equal(questions.latestCollection.coverage, "complete");
  assert.equal(questions.questions.length, definitions.length);
  const values = {
    firstName: SYNTHETIC_APPLICANT.firstName,
    lastName: SYNTHETIC_APPLICANT.lastName,
    email: SYNTHETIC_APPLICANT.email,
    workAuthorization: "yes",
    needsSponsorship: "yes",
    sponsorshipDetails: SYNTHETIC_APPLICANT.sponsorshipDetails,
    whyUs: expectedWhyUs(fixture),
  };
  const answers = [];
  for (const question of questions.questions) {
    const field = question.definition.fields[0];
    assert.deepEqual(
      question.definition,
      definitions.find((item) => item.stableKey === question.definition.stableKey),
    );
    if (field.type === "file") continue;
    assert.ok(
      Object.hasOwn(values, field.key),
      "No authored fixture answer exists for this question.",
    );
    const answer = await api.request(`/api/application-questions/${question.id}/answers`, {
      method: "POST",
      body: {
        requestId: randomUUID(),
        expectedRevision: question.revision,
        expectedDefinitionHash: question.definitionHash,
        confirmed: true,
        values: [{ fieldKey: field.key, value: values[field.key] }],
      },
    });
    assert.ok(answer.answer?.confirmedAt);
    assert.deepEqual(answer.answer.values, [{ fieldKey: field.key, value: values[field.key] }]);
    answers.push({ questionId: question.id, fieldKey: field.key, answerId: answer.answer.id });
  }
  const resumeQuestion = questions.questions.find(
    (question) => question.definition.fields[0].key === "resume",
  );
  const selection = await api.request(
    `/api/application-questions/${resumeQuestion.id}/document-selection`,
    {
      method: "POST",
      body: {
        requestId: randomUUID(),
        jobId: job.id,
        expectedCollectionVersion: questions.collectionVersion,
        expectedRevision: resumeQuestion.revision,
        expectedDefinitionHash: resumeQuestion.definitionHash,
        fieldKey: "resume",
        resumeId: seeded.resumeId,
        variantId: created.id,
        artifactRevision: artifact.revision,
        expectedSelectionId: null,
        confirmed: true,
      },
    },
  );
  assert.equal(selection.pdfSha256, artifact.pdfSha256);
  assert.ok(selection.current && selection.available);
  const selectedPdf = await api.request(`/api/application-documents/${selection.id}/pdf`, {
    binary: true,
  });
  assert.equal(sha256(selectedPdf), artifact.pdfSha256);
  const manifest = await api.request(`/api/jobs/${job.id}/preparation?mode=preview`);
  assert.equal(manifest.coverage, "complete");
  assert.equal(manifest.submissionAllowed, false);
  assert.ok(manifest.questions.every((question) => !question.blocking));
  assert.equal(manifest.documentFields[0].selection.id, selection.id);
  preparation.answers = answers;
  preparation.documentSelectionId = selection.id;
  preparation.manifestHash = manifest.manifestHash;
  preparation.collectionVersion = manifest.collectionVersion;
  await stage("approve_prepared_fixture");
  const approved = await api.request(`/api/campaigns/${campaign.campaignId}/jobs/${job.key}`, {
    method: "PATCH",
    body: { status: "approved" },
  });
  assert.equal(approved.id, job.id);
  assert.equal(approved.status, "approved");
  await stage("ready_for_actual_queue_worker");
  return { job: approved, preparation };
}
