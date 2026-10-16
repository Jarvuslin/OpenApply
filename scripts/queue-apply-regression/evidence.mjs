import { readFile } from "node:fs/promises";
import path from "node:path";
import { assertAggregates, assertCaseEvidence } from "../apply-e2e/assertions.mjs";

export async function collectQueueEvidence({
  api,
  environment,
  fixture,
  job,
  seeded,
  applicant,
  startedAt,
  handback,
}) {
  const jobPath = `/api/campaigns/${job.campaignId}/jobs/${encodeURIComponent(job.key)}`;
  const current = await api.request(jobPath);
  const { attempt } = await api.request(`${jobPath}/submission-attempt`);
  const application = attempt?.applicationId
    ? await api.request(`/api/applied/${attempt.applicationId}`)
    : null;
  const variantId = attempt?.checkpoint?.resumeVariantId;
  const variant = variantId ? await api.request(`/api/resumes/variants/${variantId}`) : null;
  const revision = attempt?.checkpoint?.resume?.artifact?.revision;
  const artifact =
    variantId && revision
      ? await api.request(`/api/resumes/variants/${variantId}/artifacts/${revision}`)
      : null;
  const checkpointPdf = attempt?.checkpointId
    ? await api.request(`${jobPath}/submission-checkpoints/${attempt.checkpointId}/pdf`, {
        binary: true,
      })
    : null;
  const applicationPdf = application
    ? await api.request(`/api/applied/${application.id}/submitted-resume`, { binary: true })
    : null;
  const sourceText = (await api.request(`/api/resumes/${seeded.resumeId}/source-text`)).text;
  const submissions = await environment.readFixtureSubmissions();
  const result = assertCaseEvidence({
    fixture,
    submissions: submissions.submissions,
    job: current,
    attempt,
    application,
    variant,
    artifact,
    checkpointPdf,
    applicationPdf,
    originalText: applicant.originalText,
    sourceText,
    resumeId: seeded.resumeId,
    startedAt,
    workerCheck: handback?.workerCheck,
  });
  const [campaign, applications, summary, analytics] = await Promise.all([
    api.request(`/api/campaigns/${job.campaignId}`),
    api.list("/api/applied/"),
    api.request("/api/applied/summary"),
    api.request("/api/analytics/"),
  ]);
  return {
    case: result,
    aggregates: assertAggregates({ campaign, applications, summary, analytics, expected: 1 }),
    records: { job: current, attempt, application, variant, artifact },
    fixtureSubmissions: submissions,
    workerEvidence: handback
      ? {
          provenance:
            "Actual leased worker POST /worker-result-check and its successful production API response, captured in transit without reconstruction.",
          ...handback,
        }
      : null,
  };
}

export async function readQueueUsage(workspace, grant) {
  const filename = path.join(
    workspace,
    "queue-model-evidence",
    grant.runId,
    `${grant.allocations[0].allocationId}.usage.jsonl`,
  );
  try {
    const lines = (await readFile(filename, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    const stop = lines.findLast((line) => line.event === "stop");
    return {
      path: filename,
      summary: stop ?? null,
      state: stop?.usageState ?? "incomplete_metadata",
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { path: filename, summary: null, state: "unavailable" };
  }
}

export function finalRunChecks(report, grant) {
  const fixture = report.finalFixtureSubmissions;
  const requestCounts = Object.entries(fixture?.submissionRequests ?? {});
  const usage = report.usage?.summary;
  const allocation = grant?.allocations[0];
  const settlement = report.work?.runtimeSettlement;
  const canonical = settlement?.canonicalObserver;
  return [
    {
      name: "exactly_one_total_fixture_submission_after_cleanup",
      passed:
        fixture?.runId === grant?.runId &&
        fixture?.submissions?.length === 1 &&
        fixture.submissions[0].caseId === "greenhouse" &&
        requestCounts.length === 1 &&
        requestCounts[0][0] === "greenhouse" &&
        requestCounts[0][1] === 1,
    },
    {
      name: "exact_worker_drained_before_cleanup",
      passed:
        !!allocation &&
        settlement?.state === "worker_drained" &&
        settlement.workItemId === allocation.workItemId &&
        typeof settlement.executionId === "string" &&
        typeof settlement.browserSessionId === "string",
    },
    {
      name: "canonical_submitted_execution_without_runtime_error",
      passed:
        settlement?.lastError === null &&
        typeof settlement.ownerId === "string" &&
        canonical?.ownerId === settlement.ownerId &&
        canonical.workItemId === settlement.workItemId &&
        canonical.executionId === settlement.executionId &&
        canonical.currentExecutionId === settlement.executionId &&
        canonical.browserSessionId === settlement.browserSessionId &&
        canonical.state === "submitted" &&
        canonical.active === false &&
        canonical.leaseExpiresAt === null,
    },
    {
      name: "complete_matching_model_usage",
      passed:
        !!allocation &&
        usage?.event === "stop" &&
        usage.processOutcome === "completed" &&
        usage.reason === "completed" &&
        usage.usageState === "final_provider_metadata" &&
        usage.runId === grant.runId &&
        usage.allocationId === allocation.allocationId &&
        usage.workItemId === allocation.workItemId &&
        typeof usage.executionId === "string" &&
        usage.executionId === settlement?.executionId &&
        usage.requestedModel === "sonnet" &&
        usage.provider === "claude" &&
        Array.isArray(usage.actualModels) &&
        usage.actualModels.length > 0 &&
        usage.actualModels.every(
          (model) =>
            typeof model === "string" &&
            /^(?:sonnet|claude-sonnet-\d+(?:-\d+){0,2}|claude-\d+(?:-\d+)?-sonnet(?:-\d{8})?)$/.test(
              model,
            ),
        ) &&
        Number.isFinite(usage.durationMs) &&
        usage.durationMs >= 0 &&
        usage.measuredUsage?.requests > 0 &&
        Number.isFinite(usage.measuredUsage?.totalTokenOccurrences) &&
        usage.measuredUsage.totalTokenOccurrences > 0 &&
        ["inputTokens", "cacheWriteTokens", "cacheReadTokens", "outputTokens"].every(
          (key) =>
            Number.isSafeInteger(usage.measuredUsage?.tokens?.[key]) &&
            usage.measuredUsage.tokens[key] >= 0,
        ),
    },
  ];
}
