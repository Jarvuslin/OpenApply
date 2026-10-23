import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function subscriptionConfiguration(environment, config, credentials) {
  const routing =
    /^(ANTHROPIC_|CLAUDE_CODE_USE_|CLAUDE_CONFIG_DIR$|CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CODE_SUBAGENT_MODEL$)/i;
  if (
    Object.entries(environment).some(([key, value]) => value && routing.test(key)) ||
    config?.primaryApiKey != null ||
    !["pro", "max"].includes(credentials?.claudeAiOauth?.subscriptionType)
  )
    throw new Error(
      "Subscription-only model routing could not be verified; no provider may start.",
    );
  return {
    subscriptionType: credentials.claudeAiOauth.subscriptionType,
    alternateRouting: false,
    modelCalls: 0,
  };
}

export async function subscriptionPreflight() {
  const home = os.homedir();
  const config = JSON.parse(await readFile(path.join(home, ".claude.json"), "utf8"));
  const credentials = JSON.parse(
    await readFile(path.join(home, ".claude", ".credentials.json"), "utf8"),
  );
  return subscriptionConfiguration(process.env, config, credentials);
}

export function assertPristineFixture(evidence) {
  if (
    !Array.isArray(evidence?.submissions) ||
    evidence.submissions.length ||
    Object.values(evidence.submissionRequests ?? {}).some((count) => count !== 0)
  )
    throw new Error("Fixture submission activity already exists; this run cannot be replayed.");
}

export function assertPreparedWork(job, fixture, attempt, ordered, workItemId) {
  if (
    job.url !== fixture.url ||
    job.title !== fixture.title ||
    job.company !== fixture.company ||
    !job.description?.includes(fixture.description) ||
    !job.fitAssessment ||
    !Number.isInteger(job.matchScore)
  )
    throw new Error("Prepared synthetic posting or current fit evidence is missing.");
  if (
    attempt &&
    (attempt.startedAt ||
      attempt.receiptStoredAt ||
      attempt.recordedAt ||
      attempt.applicationId ||
      attempt.legacyOutcomeUnknown)
  )
    throw new Error("A prior submission attempt needs recovery; model execution is forbidden.");
  if (
    ordered?.items?.length !== 1 ||
    ordered.items[0].workItemId !== workItemId ||
    !ordered.items[0].eligible
  )
    throw new Error(
      `The exact prepared work item is blocked: ${ordered?.items?.[0]?.blockedReason ?? "unknown"}.`,
    );
}
