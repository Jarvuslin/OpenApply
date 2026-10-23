import assert from "node:assert/strict";
import test from "node:test";
import { assertAggregates, assertCaseEvidence, validateManifest } from "./assertions.mjs";
import { caseEvidence } from "./assertions-test-helpers.mjs";
import { CASES } from "./cases.mjs";

test("acceptance catalog contains the three ATS cases and unfamiliar layout", () => {
  assert.deepEqual(CASES.map((fixture) => fixture.id).sort(), [
    "ashby",
    "greenhouse",
    "lever",
    "unfamiliar",
  ]);
});

for (const fixture of CASES) {
  test(`deterministic assertion unit accepts complete ${fixture.id} evidence`, () => {
    const result = assertCaseEvidence(caseEvidence(fixture.id));
    assert.deepEqual(
      result.checks.filter((item) => !item.passed),
      [],
    );
  });
  test(`rejects swapped sponsorship for ${fixture.id}, even when checkpoint repeats it`, () => {
    const evidence = caseEvidence(fixture.id);
    const wrong = fixture.expectedSponsorship === "yes" ? "no" : "yes";
    evidence.submissions[0].fields[fixture.sponsorshipField] = wrong;
    evidence.attempt.checkpoint.fields.find(
      (field) => field.id === fixture.sponsorshipField,
    ).value = wrong;
    assert.equal(assertCaseEvidence(evidence).passed, false);
  });
}

test("rejects wrong authorization independently of correct sponsorship", () => {
  const evidence = caseEvidence();
  evidence.submissions[0].fields.workAuthorization = "no";
  assert.equal(assertCaseEvidence(evidence).passed, false);
});

test("rejects duplicate submissions, modified PDFs, missing conditionals and foreign receipts", () => {
  const mutations = [
    (input) => input.submissions.push(structuredClone(input.submissions[0])),
    (input) => {
      input.submissions[0].submissionRequests = 2;
    },
    (input) => {
      input.checkpointPdf = Buffer.from("%PDF-wrong");
    },
    (input) => {
      delete input.submissions[0].fields.sponsorshipDetails;
    },
    (input) => {
      input.attempt.receipt.confirmation.url = "http://127.0.0.1:14110/other-receipt";
    },
    (input) => {
      input.job.description = "TypeScript PostgreSQL";
    },
    (input) => {
      input.sourceText = "A tailored replacement";
    },
    (input) => {
      input.job.fitAssessment = {};
    },
    (input) => {
      input.workerCheck = undefined;
    },
    (input) => {
      input.variant.createdAt = "2026-10-07T10:00:00Z";
    },
    (input) => {
      input.variant.jobUrl = "http://127.0.0.1:14110/runs/unit/another";
    },
    (input) => {
      input.artifact.job.url = "http://127.0.0.1:14110/runs/unit/another";
    },
  ];
  for (const mutate of mutations) {
    const evidence = caseEvidence();
    mutate(evidence);
    assert.equal(assertCaseEvidence(evidence).passed, false);
  }
});

test("why-us must match the preapproved synthetic answer, not merely mention the company and a skill", () => {
  for (const whyUs of [
    "React",
    "x".repeat(1300),
    "I have substantial executive leadership experience with multinational organizations and would love to help your business grow.",
    "I want to join Harbor because I was the chief executive of NASA and invented React for interplanetary spacecraft navigation.",
  ]) {
    const evidence = caseEvidence();
    evidence.submissions[0].fields.whyUs = whyUs;
    assert.equal(assertCaseEvidence(evidence).passed, false);
  }
});

test("receipt text may omit its ID when the exact visible reference is recorded separately", () => {
  const evidence = caseEvidence();
  evidence.submissions[0].receipt.text = "Your local test application has been received.";
  evidence.attempt.receipt.confirmation.text = evidence.submissions[0].receipt.text;
  assert.equal(assertCaseEvidence(evidence).passed, true);
});

test("checkpoint matching accepts observed vendor control IDs from the fixture manifest", () => {
  const evidence = caseEvidence("ashby");
  evidence.fixture.fields = [
    { id: "email", controlId: "_systemfield_email", label: "Email address" },
  ];
  evidence.attempt.checkpoint.fields.find((field) => field.id === "email").id =
    "_systemfield_email";
  evidence.application.submission.fields.find((field) => field.id === "email").id =
    "_systemfield_email";
  assert.equal(assertCaseEvidence(evidence).passed, true);
});

test("saved application history must retain exact checkpoint fields and observed receipt text", () => {
  const mutations = [
    (evidence) => {
      evidence.application.submission.fields = [];
    },
    (evidence) => {
      evidence.application.submission.fields.find((field) => field.id === "whyUs").value =
        "Changed after submission";
    },
    (evidence) => {
      evidence.application.submission.confirmation = {
        ...evidence.application.submission.confirmation,
        text: "Reconstructed receipt",
      };
    },
  ];
  for (const mutate of mutations) {
    const evidence = caseEvidence();
    mutate(evidence);
    assert.equal(assertCaseEvidence(evidence).passed, false);
  }
});

test("tailoring requires an actual grounded text change retained in artifact audit and content", () => {
  const mutations = [
    (evidence) => {
      const pair = evidence.variant.rewrites.experience[0].bullets[0];
      pair.tailored = pair.original;
    },
    (evidence) => {
      evidence.variant.rewrites.experience[0].bullets[0].tailored = "";
    },
    (evidence) => {
      evidence.artifact.audit = null;
    },
    (evidence) => {
      evidence.artifact.content.experience[0].bullets = [evidence.originalText];
    },
  ];
  for (const mutate of mutations) {
    const evidence = caseEvidence();
    mutate(evidence);
    assert.equal(assertCaseEvidence(evidence).passed, false);
  }
});

test("Greenhouse split first and last names are checked independently", () => {
  const evidence = caseEvidence("greenhouse");
  assert.deepEqual(evidence.fixture.nameFields, ["firstName", "lastName"]);
  evidence.submissions[0].fields.firstName = "Fixture";
  evidence.submissions[0].fields.lastName = "Morgan";
  assert.equal(assertCaseEvidence(evidence).passed, false);
});

test("application identity must match the API's exact HTTPS canonical fixture URL", () => {
  assert.equal(assertCaseEvidence(caseEvidence()).passed, true);
  for (const url of [
    "http://127.0.0.1:14110/runs/unit/greenhouse",
    "https://127.0.0.1:14111/runs/unit/greenhouse",
    "https://127.0.0.1:14110/runs/other/greenhouse",
    "https://employer.example/runs/unit/greenhouse",
  ]) {
    const evidence = caseEvidence();
    evidence.application.url = url;
    evidence.attempt.canonicalUrl = url;
    evidence.attempt.checkpoint.job.canonicalUrl = url;
    assert.equal(assertCaseEvidence(evidence).passed, false);
  }
});

test("manifest rejects external domains, another run and changed answer semantics", () => {
  const manifest = {
    runId: "unit",
    origin: "http://127.0.0.1:14110",
    cases: CASES.map((fixture) => ({
      ...fixture,
      url: `http://127.0.0.1:14110/runs/unit/${fixture.id}`,
    })),
  };
  assert.equal(validateManifest(manifest, "unit"), manifest);
  for (const url of ["https://employer.example/apply", "http://127.0.0.1:14110/runs/other/ashby"]) {
    const copy = structuredClone(manifest);
    copy.cases[0].url = url;
    assert.throws(() => validateManifest(copy, "unit"));
  }
  const copy = structuredClone(manifest);
  copy.cases.find((fixture) => fixture.id === "ashby").expectedSponsorship = "yes";
  assert.throws(() => validateManifest(copy, "unit"));
  const incomplete = structuredClone(manifest);
  incomplete.cases.pop();
  assert.throws(() => validateManifest(incomplete, "unit"), /fixture cases/);
  const unknown = structuredClone(manifest);
  unknown.cases[0].id = "unexpected";
  assert.throws(() => validateManifest(unknown, "unit"));
});

test("aggregate checks use API applied status and submitted event total separately", () => {
  const expected = CASES.length;
  const evidence = {
    campaign: {
      status: "completed",
      summary: { totalFound: expected, applied: expected, byStatus: { applied: expected } },
    },
    applications: CASES.map((fixture) => ({ id: fixture.id })),
    summary: { total: expected, byStatus: { applied: expected } },
    analytics: {
      totals: { applications: expected, submitted: expected },
      statusBreakdown: [{ status: "applied", count: expected }],
    },
  };
  assert.equal(assertAggregates(evidence).passed, true);
  evidence.analytics.totals.submitted = expected - 1;
  assert.equal(assertAggregates(evidence).passed, false);
});
