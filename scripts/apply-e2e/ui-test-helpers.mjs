import { randomUUID } from "node:crypto";
import { CASES } from "./cases.mjs";

export function preservedEvidence() {
  const runId = "preserved-unit";
  const database = "apply_e2e_012345678abc";
  const environment = {
    runId,
    database,
    apiUrl: "http://127.0.0.1:14101",
    webUrl: "http://127.0.0.1:14100",
    fixtureBaseUrl: "http://127.0.0.1:14110",
    cdpUrl: "http://127.0.0.1:19222",
  };
  const report = {
    runId,
    mode: "real-agent",
    realAgent: "completed",
    status: "failed",
    ui: { status: "failed" },
    finishedAt: "2026-10-08T16:00:00Z",
    manifest: {
      runId,
      origin: environment.fixtureBaseUrl,
      cases: CASES.map((fixture) => ({
        ...fixture,
        url: `${environment.fixtureBaseUrl}/runs/${runId}/${fixture.id}`,
      })),
    },
    syntheticAccount: { userId: randomUUID(), resumeId: randomUUID() },
    aggregates: { passed: true, checks: Array.from({ length: 8 }, () => ({ passed: true })) },
    cases: CASES.map(({ id }) => ({
      caseId: id,
      passed: true,
      checks: Array.from({ length: id === "greenhouse" ? 50 : 47 }, () => ({ passed: true })),
    })),
    records: CASES.map(({ id, company }) => {
      const applicationId = randomUUID();
      return {
        caseId: id,
        application: { id: applicationId, company, status: "applied" },
        attempt: {
          applicationId,
          receipt: { confirmation: { reference: `fixture-${id}-${randomUUID()}` } },
        },
      };
    }),
  };
  const verification = { database, guestClusterVerified: true, connectionVerified: true };
  return { report, environment, verification };
}
