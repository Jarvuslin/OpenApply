import "reflect-metadata";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { db } from "../src/common/database/prisma.client";
import { evaluateEligibility } from "../src/modules/scoring-evaluation/evaluation.eligibility";
import { WorkQueueService } from "../src/modules/work-queue/work-queue.service";
import {
  evaluations,
  productionFingerprint,
  scoring,
  scoringFixture,
  submittedResult,
  uuid,
} from "./scoring-regression-fixtures";

const url = new URL(process.env.DATABASE_URL ?? "");
const expected = process.env.OPENAPPLY_SCORING_TEST_DATABASE;
if (
  !expected ||
  !/^apply_e2e_[a-f0-9]{12}$/.test(expected) ||
  url.pathname !== `/${expected}` ||
  url.hostname !== "127.0.0.1" ||
  url.port !== "15433"
)
  throw new Error("Scoring regression requires its verified disposable database bridge.");
const checks: string[] = [];
let stage = "database identity";
function report(value: Record<string, unknown>) {
  const text = JSON.stringify(value);
  if (process.env.OPENAPPLY_SCORING_TEST_REPORT)
    writeFileSync(process.env.OPENAPPLY_SCORING_TEST_REPORT, text);
  console.log(text);
}
async function check(name: string, fn: () => Promise<void>) {
  stage = name;
  await fn();
  checks.push(name);
}
const page = { page: 1, limit: 100 };
async function cases(userId: string, runId: string) {
  return (await evaluations.cases(userId, runId, page)).items;
}

async function run() {
  const identity = await db.$queryRaw<
    { database: string; directory: string }[]
  >`SELECT current_database() AS database,current_setting('data_directory') AS directory`;
  assert.equal(identity[0]?.database, expected);
  assert.equal(identity[0]?.directory, "/var/lib/postgresql/mvp");
  if (process.argv[2] === "ui-login") {
    const id = process.env.OPENAPPLY_SCORING_TEST_UI_USER,
      email = process.env.OPENAPPLY_SCORING_TEST_LOGIN_EMAIL,
      password = process.env.OPENAPPLY_SCORING_TEST_PASSWORD;
    assert.ok(id && email?.endsWith("@scoring.example.test") && password);
    const user = await db.user.findFirstOrThrow({
      where: { id, email, firstName: "Scoring", lastName: "Fixture" },
    });
    await db.user.update({
      where: { id: user.id },
      data: { passwordHash: await Bun.password.hash(password), emailVerified: true },
    });
    console.log(JSON.stringify({ status: "passed", mode: "clone-only-synthetic-login" }));
    return;
  }
  assert.equal(await db.user.count(), 0);
  checks.push(stage);
  const loginEmail = process.env.OPENAPPLY_SCORING_TEST_LOGIN_EMAIL,
    password = process.env.OPENAPPLY_SCORING_TEST_PASSWORD;
  assert.ok(loginEmail?.endsWith("@scoring.example.test") && password);
  const f = await scoringFixture("Preserved G shadow fixtures", {
    historical: true,
    email: loginEmail,
    password,
  });
  const foreign = await scoringFixture("Foreign account");
  const queue = new WorkQueueService(db);
  await queue.enqueue(f.user.id, {
    jobIds: [f.jobs[0].id],
    source: "user",
    provider: "claude",
    idempotencyKey: uuid(),
  });
  const production = await productionFingerprint(f.user.id, f.sourceFile);
  const pendingInput = await f.create("Pending model comparison — no launches approved");
  let pendingRunId = "";
  await check("atomic concurrent run admission and exact historical source snapshots", async () => {
    const [a, b] = await Promise.all([
      evaluations.create(f.user.id, pendingInput, "agent"),
      evaluations.create(f.user.id, pendingInput, "agent"),
    ]);
    pendingRunId = a.id;
    assert.equal(a.id, b.id);
    assert.equal(await db.scoringEvaluationRun.count({ where: { userId: f.user.id } }), 1);
    const rows = await cases(f.user.id, a.id);
    assert.equal(rows.length, 4);
    for (const row of rows) {
      assert.equal(row.context.cachedAssessment, null);
      assert.equal(row.historicalReference?.score, 100);
      assert.equal(row.eligibility.facts, null);
      assert.equal(row.factsConfirmedAt, null);
    }
    assert.equal((await evaluations.report(f.user.id, a.id)).unrunCases, 4);
    await assert.rejects(
      evaluations.create(f.user.id, { ...pendingInput, name: "Changed replay" }, "agent"),
    );
  });
  await check("foreign and stale source admission rolls back without partial cases", async () => {
    const count = await db.scoringEvaluationRun.count();
    await assert.rejects(
      evaluations.create(foreign.user.id, { ...pendingInput, requestId: uuid() }, "agent"),
    );
    await assert.rejects(
      evaluations.create(
        f.user.id,
        {
          ...pendingInput,
          requestId: uuid(),
          cases: [
            {
              ...pendingInput.cases[0],
              expectedBasis: { ...pendingInput.cases[0].expectedBasis, jobSha256: "0".repeat(64) },
            },
          ],
        },
        "agent",
      ),
    );
    await assert.rejects(evaluations.detail(foreign.user.id, pendingRunId));
    await assert.rejects(evaluations.report(foreign.user.id, pendingRunId));
    assert.equal(await db.scoringEvaluationRun.count(), count);
  });
  const synthetic = await evaluations.create(
    f.user.id,
    { ...(await f.create("Synthetic replay — no measured model comparison")), cohort: "authored" },
    "agent",
  );
  const syntheticRows = await cases(f.user.id, synthetic.id);
  const first = syntheticRows[0];
  assert.ok(first);
  await check(
    "concurrent result request identity is idempotent and slots are immutable",
    async () => {
      const input = submittedResult(first);
      const [a, b] = await Promise.all([
        evaluations.result(f.user.id, first.id, input),
        evaluations.result(f.user.id, first.id, input),
      ]);
      assert.equal(a.id, b.id);
      assert.equal(a.status, "completed");
      assert.equal(a.assessment?.score, 100);
      await assert.rejects(
        evaluations.result(f.user.id, first.id, { ...input, requestId: uuid() }),
      );
      await assert.rejects(
        evaluations.result(f.user.id, first.id, { ...input, modelVersion: "conflicting" }),
      );
      await assert.rejects(evaluations.result(foreign.user.id, first.id, input));
      const candidate = submittedResult(first, "candidate");
      const race = await Promise.allSettled([
        evaluations.result(f.user.id, first.id, candidate),
        evaluations.result(f.user.id, first.id, { ...candidate, requestId: uuid() }),
      ]);
      assert.equal(race.filter((row) => row.status === "fulfilled").length, 1);
      assert.equal(race.filter((row) => row.status === "rejected").length, 1);
      assert.equal(await db.scoringEvaluationResult.count({ where: { caseId: first.id } }), 2);
    },
  );
  await check(
    "simulated replay metrics do not become measured and unknown usage stays null",
    async () => {
      for (const row of syntheticRows.slice(1))
        for (const slot of ["baseline", "candidate"] as const)
          await evaluations.result(f.user.id, row.id, submittedResult(row, slot));
      const summary = await evaluations.report(f.user.id, synthetic.id);
      assert.equal(summary.validPairs, 4);
      assert.equal(summary.excludedPairs, 4);
      assert.equal(summary.measuredPairs, 0);
      assert.equal(summary.measurementStatus, "not_run");
      assert.equal(summary.comparison.exactScoreAgreement, 1);
      assert.equal(summary.measured.exactScoreAgreement, null);
      assert.equal(summary.usage.baseline.results, 0);
      assert.equal(summary.usage.baseline.inputTokens.total, null);
      assert.equal(summary.usage.candidate.requests.total, null);
    },
  );
  await check(
    "historical reference preserves unknown model identity and cannot invent a launch",
    async () => {
      const run = await evaluations.create(
        f.user.id,
        await f.create("Historical references only", [0]),
        "agent",
      );
      const row = (await cases(f.user.id, run.id))[0];
      assert.ok(row);
      const input = {
        ...submittedResult(row),
        origin: "historical" as const,
        judgments: null,
        telemetry: { ...submittedResult(row).telemetry, provenance: "unavailable" as const },
      };
      await assert.rejects(
        evaluations.result(f.user.id, row.id, { ...input, actualModels: ["claude-sonnet-4-5"] }),
      );
      const result = await evaluations.result(f.user.id, row.id, input);
      assert.equal(result.origin, "historical");
      assert.deepEqual(result.assessment, row.historicalReference);
      assert.deepEqual(result.actualModels, []);
      assert.equal((await evaluations.report(f.user.id, run.id)).incompleteCases, 1);
    },
  );
  await check(
    "wrong context hash and exact-quote errors cannot occupy a successful slot",
    async () => {
      const run = await evaluations.create(
        f.user.id,
        await f.create("Rejected quote evidence", [1]),
        "agent",
      );
      const row = (await cases(f.user.id, run.id))[0];
      assert.ok(row);
      await assert.rejects(
        evaluations.result(f.user.id, row.id, {
          ...submittedResult(row),
          expectedContextHash: "f".repeat(64),
        }),
      );
      const bad = submittedResult(row);
      const evidence = bad.judgments?.assessments.find((item) => item.evidence.length)?.evidence[0];
      assert.ok(evidence);
      evidence.quote = "Invented evidence";
      const rejected = await evaluations.result(f.user.id, row.id, bad);
      assert.equal(rejected.status, "rejected");
      assert.equal(rejected.assessment, null);
      assert.equal(rejected.failureCode, "invalid_output");
      await assert.rejects(evaluations.result(f.user.id, row.id, submittedResult(row)));
      assert.equal((await evaluations.report(f.user.id, run.id)).failedCases, 1);
    },
  );
  await check(
    "country facts require human confirmation and profile defaults never resolve restrictions",
    async () => {
      const separate = await scoringFixture("Explicit country facts");
      const job = separate.jobs[0];
      await db.job.update({
        where: { id: job.id },
        data: { description: `${job.description}\nNo visa sponsorship in Canada.` },
      });
      const input = await separate.create("Country-specific filter", [0]);
      const facts = {
        countryCode: "CA",
        confirmed: true as const,
        authorized: true,
        requiresSponsorship: true,
      };
      await assert.rejects(
        evaluations.create(
          separate.user.id,
          { ...input, cases: [{ ...input.cases[0], facts }] },
          "agent",
        ),
      );
      const unknown = await evaluations.create(separate.user.id, input, "agent");
      const unresolved = (await cases(separate.user.id, unknown.id))[0];
      assert.equal(unresolved.eligibility.outcome, "needs_review");
      const known = await evaluations.create(
        separate.user.id,
        { ...input, requestId: uuid(), cases: [{ ...input.cases[0], facts }] },
        "session_user",
      );
      const resolved = (await cases(separate.user.id, known.id))[0];
      assert.equal(resolved.eligibility.outcome, "ineligible");
      assert.ok(resolved.factsConfirmedAt);
      for (const span of resolved.eligibility.restrictions)
        assert.equal(resolved.context.job[span.source].slice(span.start, span.end), span.quote);
      assert.equal(
        evaluateEligibility(resolved.context, { ...facts, countryCode: "US" }).outcome,
        "needs_review",
      );
    },
  );
  await check(
    "run and case pagination counts cover owned rows independently of the page",
    async () => {
      const runs = await evaluations.list(f.user.id, { page: 1, limit: 1 });
      assert.equal(runs.items.length, 1);
      assert.ok(runs.pagination.total >= 4);
      const rows = await evaluations.cases(f.user.id, synthetic.id, { page: 2, limit: 1 });
      assert.equal(rows.items.length, 1);
      assert.equal(rows.pagination.total, 4);
      assert.equal(rows.items[0].ordinal, 1);
      assert.equal((await evaluations.list(foreign.user.id, page)).pagination.total, 0);
      await assert.rejects(evaluations.cases(foreign.user.id, synthetic.id, page));
    },
  );
  await check(
    "production score, queue, campaign, resume and original file bytes stay unchanged",
    async () => {
      assert.equal(await productionFingerprint(f.user.id, f.sourceFile), production);
      assert.equal(await db.application.count(), 0);
      assert.equal(await db.submissionAttempt.count(), 0);
      const context = await scoring.context(f.user.id, {
        campaignId: f.campaign.campaignId,
        jobKey: f.jobs[0].key,
      });
      assert.equal(context.cachedAssessment?.score, 100);
    },
  );
  await check("deleted source jobs leave immutable evaluation snapshots available", async () => {
    const disposable = await scoringFixture("Deleted source snapshot");
    const run = await evaluations.create(
      disposable.user.id,
      await disposable.create("Retained snapshot", [0]),
      "agent",
    );
    const before = (await cases(disposable.user.id, run.id))[0];
    assert.ok(before);
    await db.campaign.delete({ where: { campaignId: disposable.campaign.campaignId } });
    const after = (await cases(disposable.user.id, run.id))[0];
    assert.deepEqual(after, before);
    assert.equal(
      (await evaluations.result(disposable.user.id, after.id, submittedResult(after))).status,
      "completed",
    );
  });
  stage = "read-only UI fixture metadata";
  checks.push(stage);
  report({
    status: "passed",
    checks,
    modelCalls: 0,
    providerProcesses: 0,
    employerSubmissions: 0,
    ui: { userId: f.user.id, loginEmail, pendingRunId, syntheticRunId: synthetic.id },
    evidence:
      "Preserved synthetic historical references and authored comparison outputs only. No live model measurement or production scoring change.",
  });
}
try {
  await run();
} catch (error) {
  report({
    status: "failed",
    stage,
    checks,
    reason:
      error instanceof Error
        ? error.message
            .replaceAll(process.env.OPENAPPLY_SCORING_TEST_PASSWORD ?? "<unset>", "[redacted]")
            .slice(0, 1200)
        : "Unknown regression failure",
    modelCalls: 0,
  });
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
