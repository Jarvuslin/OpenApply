import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { createRedactor } from "../apply-e2e/api.mjs";
import { seedApplicant, syntheticApplicant } from "../apply-e2e/applicant.mjs";
import { validateManifest } from "../apply-e2e/assertions.mjs";
import { inspectEnvironment, provisionEnvironment } from "../apply-e2e/environment.mjs";
import { claimApproval } from "../apply-e2e/model-approval.mjs";
import { fetchJson } from "../apply-e2e/processes.mjs";
import { createQueueApi } from "./api.mjs";
import { exactQueueGrant, validateQueueTestApproval } from "./approval.mjs";
import { collectQueueEvidence, finalRunChecks, readQueueUsage } from "./evidence.mjs";
import { startEvidenceObserver } from "./observer.mjs";
import { assertPreparedWork, assertPristineFixture, subscriptionPreflight } from "./preflight.mjs";

export function options(args) {
  if (args.length === 1 && args[0] === "--preflight") return { preflight: true };
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = {
      "--run-id": "runId",
      "--approval-file": "approvalFile",
      "--evidence-dir": "evidenceDir",
    }[args[index]];
    if (!key || !args[index + 1] || result[key])
      throw new Error(
        "Use --preflight or --run-id UUID --approval-file PATH --evidence-dir NEW_PATH.",
      );
    result[key] = key === "runId" ? args[index + 1] : path.resolve(args[index + 1]);
  }
  if (!result.runId || !result.approvalFile || !result.evidenceDir)
    throw new Error("An exact one-use approval, run ID and new evidence directory are required.");
  return result;
}

export async function pollQueue(
  api,
  workItemId,
  {
    timeoutMs,
    assertHealthy,
    readRuntime,
    connection,
    execution,
    sleep = delay,
    now = Date.now,
    progress = async () => {},
  },
) {
  const deadline = now() + timeoutMs;
  for (;;) {
    await assertHealthy();
    const detail = await api.request(`/api/work-queue/${workItemId}`);
    const runtime = await readRuntime();
    const claimed = execution();
    if (
      !connection.ownerId ||
      !connection.connectionId ||
      runtime.ownerId !== connection.ownerId ||
      runtime.connectionId !== connection.connectionId ||
      runtime.connected !== true ||
      !Array.isArray(runtime.workers) ||
      runtime.workers.length > 1 ||
      runtime.running !== runtime.workers.length > 0 ||
      runtime.workers.some(
        (worker) =>
          worker.workItemId !== workItemId ||
          !claimed ||
          worker.executionId !== claimed.executionId ||
          worker.browserSessionId !== claimed.browserSessionId,
      )
    )
      throw new Error(
        "The exact companion execution could not be confirmed; no retry is permitted.",
      );
    await progress(detail.item);
    if (
      ["submitted", "failed", "skipped", "needs_user", "cancelled", "paused", "completed"].includes(
        detail.item.state,
      ) &&
      runtime.workers.length === 0
    ) {
      const canonicalObserver =
        claimed && detail.item.state === "submitted"
          ? await api.request(
              `/api/work-queue/${workItemId}/observer?${new URLSearchParams({
                executionId: claimed.executionId,
                browserSessionId: claimed.browserSessionId,
              })}`,
            )
          : null;
      let lastError = "Runtime error metadata unavailable.";
      if (runtime.lastError === null) lastError = null;
      else if (typeof runtime.lastError === "string") lastError = runtime.lastError.slice(0, 512);
      return {
        ...detail,
        runtimeSettlement: {
          state: claimed ? "worker_drained" : "no_claim_observed",
          ...claimed,
          ownerId: connection.ownerId,
          lastError,
          canonicalObserver,
          observedAt: new Date(now()).toISOString(),
        },
      };
    }
    if (now() >= deadline)
      throw new Error("Queue test deadline reached; preserve submission state and do not retry.");
    await sleep(2000);
  }
}

export async function run(args = process.argv.slice(2)) {
  const config = options(args);
  const auth = await subscriptionPreflight();
  if (config.preflight) {
    const result = await inspectEnvironment({ provider: "claude" });
    console.log(
      JSON.stringify({
        ...result,
        auth,
        modelCalls: 0,
        meaning: "Metadata/infrastructure readiness only; no quota probe or application execution.",
      }),
    );
    return result.ready;
  }
  const bytes = await readFile(config.approvalFile);
  if (bytes.length > 8192) throw new Error("The approval exceeds its size bound.");
  validateQueueTestApproval(JSON.parse(bytes), config.runId);
  await mkdir(path.dirname(config.evidenceDir), { recursive: true });
  await mkdir(config.evidenceDir);
  const report = {
    version: 1,
    runId: config.runId,
    status: "preparing",
    startedAt: new Date().toISOString(),
    scope:
      "One synthetic Greenhouse saved job through the production common queue; not Add-job intake, discovery, Gmail or employer-account acceptance.",
    automaticRetries: 0,
    modelExecution: "not-started",
    auth,
    ui: "separate model-free verification",
  };
  const redactor = createRedactor();
  const save = () =>
    writeFile(
      path.join(config.evidenceDir, "report.json"),
      `${JSON.stringify(redactor.clean(report), null, 2)}\n`,
      { mode: 0o600 },
    );
  let environment, observer, api, grant, workItemId;
  try {
    await save();
    const approval = await claimApproval(
      config.approvalFile,
      config.runId,
      Date.now(),
      path.resolve(".temp/queue-apply-regression/claims"),
    );
    report.approval = approval;
    environment = await provisionEnvironment({
      runId: config.runId,
      evidenceDir: config.evidenceDir,
      approval,
    });
    const manifest = validateManifest(environment.fixtureManifest, config.runId);
    const fixture = manifest.cases.find((item) => item.id === "greenhouse");
    assertPristineFixture(await environment.readFixtureSubmissions());
    api = createQueueApi(environment.apiUrl, { redactor });
    const applicant = syntheticApplicant(config.runId, 1);
    const seeded = await seedApplicant(api, applicant, redactor);
    const { seedPreparedJob } = await import("./prepared-job.mjs");
    const prepared = await seedPreparedJob({
      api,
      environment,
      fixture,
      applicant,
      seeded,
      startedAt: report.startedAt,
      report,
      save,
    });
    const job = prepared.job;
    report.preparation = prepared.preparation;
    report.fixtureMailRestriction = {
      configuredDeny: ["mcp__*gmail*", "mcp__*Gmail*"],
      source: "Private staged Claude settings; installed plugin permissions are unchanged.",
      limitation:
        "Configured CLI tool denial, not full operating-system/network isolation or proof of mailbox access.",
    };
    report.syntheticAccount = { userId: seeded.userId, resumeId: seeded.resumeId };
    report.manifest = { ...manifest, cases: [fixture] };
    report.campaignId = job.campaignId;
    api.finishSeeding();
    const admission = await api.request("/api/work-queue/enqueue", {
      method: "POST",
      body: {
        idempotencyKey: randomUUID(),
        jobIds: [job.id],
        source: "user",
        provider: "claude",
      },
    });
    if (admission.items?.length !== 1 || admission.items[0].jobId !== job.id)
      throw new Error("Queue admission did not return the exact synthetic job.");
    workItemId = admission.items[0].id;
    report.workItemId = workItemId;
    const jobPath = `/api/campaigns/${job.campaignId}/jobs/${encodeURIComponent(job.key)}`;
    const current = await api.request(jobPath);
    const { attempt } = await api.request(`${jobPath}/submission-attempt`);
    const ordered = await api.request("/api/work-queue/ordered", {
      method: "POST",
      body: { workItemIds: [workItemId] },
    });
    assertPreparedWork(current, fixture, attempt, ordered, workItemId);
    assertPristineFixture(await environment.readFixtureSubmissions());
    report.preflight = {
      passed: true,
      workItemId,
      preparedInputs: "validated by current APIs",
      modelCalls: 0,
    };
    await subscriptionPreflight();
    grant = exactQueueGrant(approval, workItemId);
    const queueApprovalPath = path.join(config.evidenceDir, "queue-approval.json");
    await writeFile(queueApprovalPath, `${JSON.stringify(grant, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    const terminal = await api.request("/api/auth/tokens/terminal", { method: "POST" });
    redactor.add(terminal.token);
    observer = await startEvidenceObserver({
      apiUrl: environment.apiUrl,
      terminalToken: terminal.token,
      workItemId,
      jobPath,
      onHandback: async (value) =>
        writeFile(
          path.join(config.evidenceDir, "worker-handback.json"),
          JSON.stringify(value, null, 2),
          { mode: 0o600 },
        ),
    });
    await save();
    report.modelExecution = "dispatch-requested";
    report.dispatchAt = new Date().toISOString();
    await save();
    const connection = await environment.startQueueCompanion({
      terminalToken: terminal.token,
      queueApprovalPath,
      queueApiUrl: observer.url,
    });
    const detail = await pollQueue(api, workItemId, {
      timeoutMs: approval.budget.maxSeconds * 1000 + 30_000,
      connection,
      execution: observer.execution,
      readRuntime: async () => {
        const status = await fetchJson(`${environment.companionUrl}/queue/status`);
        observer.assertHealthy();
        return status;
      },
      assertHealthy: async () => {
        observer.assertHealthy();
        await environment.assertHealthy();
      },
      progress: async (item) => {
        if (report.lastState !== item.state) {
          report.lastState = item.state;
          await save();
          console.log(JSON.stringify({ workItemId, state: item.state }));
        }
      },
    });
    observer.assertHealthy();
    report.work = detail;
    if (detail.item.state === "submitted" && observer.result()) {
      await api.request(`/api/campaigns/${job.campaignId}/status`, {
        method: "POST",
        body: {
          status: "completed",
          actor: "user",
          reason: "The sole synthetic fixture was recorded by the current queue worker.",
        },
      });
      report.campaignCompletionActor =
        "Harness lifecycle action after actual worker receipt/recording; not an agent action.";
    }
    Object.assign(
      report,
      await collectQueueEvidence({
        api,
        environment,
        fixture,
        job,
        seeded,
        applicant,
        startedAt: report.startedAt,
        handback: observer.result(),
      }),
    );
    report.status =
      detail.item.state === "submitted" && report.case.passed && report.aggregates.passed
        ? "passed"
        : "failed";
    report.modelExecution = "finished";
  } catch (error) {
    report.status = "failed";
    report.error = error.message;
    if (api && workItemId) {
      try {
        report.retainedWork = await api.request(`/api/work-queue/${workItemId}`);
      } catch {
        report.retainedWork = "unavailable";
      }
      if (
        report.modelExecution !== "not-started" &&
        !["submitted", "failed", "cancelled", "needs_user"].includes(
          report.retainedWork?.item?.state,
        )
      )
        try {
          await api.request(`/api/work-queue/${workItemId}/control`, {
            method: "POST",
            body: { action: "stop" },
          });
        } catch {
          report.stopRequest = "unconfirmed";
        }
    }
  } finally {
    if (environment) {
      try {
        await environment.cleanup();
        report.cleanup = "owned processes stopped; disposable database retained";
      } catch {
        report.cleanup = "unconfirmed";
        report.status = "failed";
      }
      try {
        report.finalFixtureSubmissions = await environment.readFixtureSubmissions();
      } catch {
        report.finalFixtureSubmissions = "unavailable";
      }
    }
    if (observer)
      await observer.close().catch(() => {
        report.cleanup = "observer shutdown unconfirmed";
        report.status = "failed";
      });
    if (environment && grant) {
      try {
        report.usage = await readQueueUsage(environment.workspace, grant);
      } catch {
        report.usage = { state: "invalid_metadata", summary: null };
      }
      report.finalChecks = finalRunChecks(report, grant);
      if (report.finalChecks.some((check) => !check.passed)) report.status = "failed";
    }
    report.finishedAt = new Date().toISOString();
    await save();
  }
  console.log(
    JSON.stringify({
      status: report.status,
      report: path.join(config.evidenceDir, "report.json"),
      modelExecution: report.modelExecution,
      automaticRetries: 0,
    }),
  );
  return report.status === "passed";
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  run()
    .then((passed) => {
      process.exitCode = passed ? 0 : 1;
    })
    .catch(() => {
      console.error(
        "Queue fixture stopped before a complete report; inspect the unique evidence path. No automatic retry was started.",
      );
      process.exitCode = 1;
    });
