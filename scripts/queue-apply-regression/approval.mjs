import { randomUUID } from "node:crypto";
import { validateApproval } from "../apply-e2e/model-approval.mjs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function validateQueueTestApproval(value, runId, now = Date.now()) {
  const approval = validateApproval(value, runId, now);
  if (
    !uuid.test(runId) ||
    value.purpose !== "queue-application-test" ||
    value.acceptObservedLimitOvershoot !== true ||
    approval.cases.length !== 1 ||
    approval.cases[0] !== "greenhouse"
  )
    throw new Error(
      "Approve exactly one synthetic Greenhouse common-queue application with a UUID run ID.",
    );
  return approval;
}

export function exactQueueGrant(approval, workItemId) {
  if (!uuid.test(workItemId)) throw new Error("The saved exact work UUID is required.");
  return {
    version: 1,
    approved: true,
    purpose: "queue-application",
    runId: approval.runId,
    provider: "claude",
    model: "sonnet",
    approvalReference: approval.approvalReference,
    approvedAt: approval.approvedAt,
    expiresAt: approval.expiresAt,
    acceptObservedLimitOvershoot: true,
    maxAutomaticRetries: 0,
    maxConcurrentWorkers: 1,
    budget: { ...approval.budget },
    allocations: [{ allocationId: randomUUID(), workItemId, budget: { ...approval.budget } }],
  };
}
