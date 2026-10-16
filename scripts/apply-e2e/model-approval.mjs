import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CASES } from "./cases.mjs";

const denial =
  "Model execution is disabled. Use model-free verification; a new explicit user approval and one-use budget file are required for application acceptance.";
const integerLimits = {
  maxRequests: 1000,
  maxTokens: 100_000_000,
  maxSubagents: 20,
  maxTurns: 200,
  maxWorkerTurns: 200,
  maxSeconds: 3600,
};
const defaultClaimDirectory = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../.temp/apply-e2e/model-claims",
);

export function validateApproval(value, runId, now = Date.now()) {
  if (
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(runId) ||
    value?.version !== 1 ||
    value.approved !== true ||
    value.runId !== runId ||
    value.provider !== "claude" ||
    value.model !== "sonnet" ||
    value.maxCampaigns !== 1 ||
    value.maxAutomaticRetries !== 0 ||
    typeof value.approvalReference !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9:/_.-]{0,199}$/.test(value.approvalReference)
  )
    throw new Error(denial);
  const expires = Date.parse(value.expiresAt);
  const approved = Date.parse(value.approvedAt);
  if (
    !Number.isFinite(expires) ||
    !Number.isFinite(approved) ||
    approved > now ||
    expires <= now ||
    expires - approved > 24 * 60 * 60_000
  )
    throw new Error("Model approval is expired or has an invalid approval window.");
  const known = new Set(CASES.map((item) => item.id));
  if (
    !Array.isArray(value.cases) ||
    value.cases.length === 0 ||
    new Set(value.cases).size !== value.cases.length ||
    value.cases.some((id) => !known.has(id))
  )
    throw new Error("Model approval must name distinct known fixture cases.");
  for (const [name, maximum] of Object.entries(integerLimits)) {
    const minimum = name === "maxSubagents" ? 0 : 1;
    if (
      !Number.isSafeInteger(value.budget?.[name]) ||
      value.budget[name] < minimum ||
      value.budget[name] > maximum
    )
      throw new Error(`Model approval requires a finite ${name} budget within supported limits.`);
  }
  if (
    !Number.isFinite(value.budget.maxBudgetUsd) ||
    value.budget.maxBudgetUsd <= 0 ||
    value.budget.maxBudgetUsd > 100
  )
    throw new Error("Model approval requires a finite list-price-equivalent budget.");
  return {
    version: 1,
    runId,
    approvalReference: value.approvalReference,
    approvedAt: value.approvedAt,
    expiresAt: value.expiresAt,
    provider: "claude",
    model: "sonnet",
    cases: [...value.cases],
    maxCampaigns: 1,
    maxAutomaticRetries: 0,
    budget: Object.fromEntries(
      [...Object.keys(integerLimits), "maxBudgetUsd"].map((key) => [key, value.budget[key]]),
    ),
  };
}

export async function claimApproval(
  filename,
  runId,
  now = Date.now(),
  claimDirectory = defaultClaimDirectory,
) {
  if (!filename) throw new Error(denial);
  const path = resolve(filename);
  const bytes = await readFile(path);
  if (bytes.length > 8192) throw new Error("Model approval file is too large.");
  const approval = validateApproval(JSON.parse(bytes.toString("utf8")), runId, now);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  // Claim before any provider or service starts; a failed run never releases this approval.
  await mkdir(claimDirectory, { recursive: true });
  const claim = `${JSON.stringify({ runId, sha256, claimedAt: new Date(now).toISOString() })}\n`;
  await writeFile(resolve(claimDirectory, `${runId}.json`), claim, { flag: "wx", mode: 0o600 });
  await writeFile(`${path}.used`, claim, { flag: "wx", mode: 0o600 });
  return { ...approval, sha256 };
}
