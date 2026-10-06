import type { AgendaItem, AgendaResponse } from "@jobpilot/contracts/pilot";
import type { PrismaClient } from "@/generated/prisma/client";
import { ClaimService } from "./claim.service";
import { describe, expect, it } from "bun:test";

const USER_ID = "5f0d4d0e-4f27-4a0a-9f4e-2b1c6f1f7f01";
const CLAIM_ID = "4c965efd-b586-49ea-825b-1af715760116";
const VERSION = "31b0c512-b767-4dd7-9ee8-913e46d544c6";
const now = new Date();

const applyItem: AgendaItem = {
  id: "job.apply:c1:j1",
  kind: "job.apply",
  priority: 100,
  title: "Engineer",
  subjectType: "job",
  subjectId: "c1:j1",
  payload: {
    campaignId: "c1",
    jobKey: "j1",
    url: "https://example.test/job",
    board: null,
    digest: null,
    matchScore: 90,
  },
};

const pausedItem: AgendaItem = {
  id: "campaign.reviewPaused:c9",
  kind: "campaign.reviewPaused",
  priority: 910,
  title: "Review paused campaign: react",
  subjectType: "campaign",
  subjectId: "c9",
  payload: { campaignId: "c9", query: "react", board: null, pausedAt: now },
};

const snapshot: AgendaResponse = {
  version: VERSION,
  generatedAt: now,
  expiresAt: new Date(now.getTime() + 60_000),
  items: [applyItem, pausedItem],
  counts: { openQuestions: 0, activeClaims: 0, approvedJobs: 1, appliedToday: 0 },
  budget: {
    dailyApplyCap: 10,
    appliedToday: 0,
    capReached: false,

    resetsAt: now,
  },
  emptyReason: null,
  sleepSeconds: 15,
  nextWakeAt: new Date(now.getTime() + 15_000),
};

interface ClaimSetup {
  currentVersion?: string;
  openClaim?: { id: string } | null;
  campaignStillPaused?: boolean;
}

function claimDb({
  currentVersion = VERSION,
  openClaim = null,
  campaignStillPaused = true,
}: ClaimSetup) {
  const creates: Record<string, unknown>[] = [];
  const db = {
    pilotState: {
      updateManyAndReturn: async (a: { where: { agendaVersion: string } }) =>
        a.where.agendaVersion === currentVersion ? [{ agendaSnapshot: snapshot }] : [],
      findUnique: async () => ({ running: true }),
    },
    pilotClaim: {
      findFirst: async () => openClaim,
      create: async (a: { data: Record<string, unknown> }) => {
        creates.push(a.data);
        return {
          id: CLAIM_ID,
          userId: USER_ID,
          grantedAt: now,
          heartbeatAt: null,
          releasedAt: null,
          outcome: null,
          ...a.data,
        };
      },
    },
    campaign: { count: async () => (campaignStillPaused ? 1 : 0) },
    // What `claimJobForApply` reads and writes; no duplicate matches.
    job: {
      findFirst: async () => ({
        url: "https://example.test/job",
        title: "Engineer",
        company: "Acme",
      }),
      findMany: async () => [],
      updateManyAndReturn: async () => [{ campaignId: "c1", key: "j1", status: "applying" }],
    },
    application: { findUnique: async () => null, findMany: async () => [] },
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(db),
  };
  return { service: new ClaimService(db as unknown as PrismaClient), creates };
}

describe("ClaimService.claim", () => {
  it("claims an item off the supplied snapshot and stores its payload", async () => {
    const { service, creates } = claimDb({});
    const claim = await service.claim(USER_ID, VERSION, applyItem.id);
    expect(creates[0]).toMatchObject({ kind: "job.apply", subjectId: "c1:j1" });
    expect(claim.payload).toMatchObject({ campaignId: "c1", jobKey: "j1" });
  });

  it("refuses a stale snapshot, a held subject, or a row that changed since the build", async () => {
    const refusals: [ClaimSetup, string, string][] = [
      [{ currentVersion: "d6579e89-e9af-4f83-a04e-7d2cfad07cf3" }, applyItem.id, "stale"],
      [{ openClaim: { id: "held" } }, applyItem.id, "already claimed"],
      [{ campaignStillPaused: false }, pausedItem.id, "no longer paused"],
    ];
    for (const [setup, itemId, message] of refusals) {
      const { service, creates } = claimDb(setup);
      await expect(service.claim(USER_ID, VERSION, itemId)).rejects.toThrow(message);
      expect(creates).toHaveLength(0);
    }
  });
});

describe("ClaimService.heartbeat", () => {
  const heartbeat = async (grantedMinutesAgo: number) => {
    const grantedAt = new Date(Date.now() - grantedMinutesAgo * 60_000);
    let expiresAt = new Date(0);
    const db = {
      pilotClaim: {
        findFirst: async () => ({ grantedAt, releasedAt: null }),
        updateManyAndReturn: async (a: { data: { expiresAt: Date } }) => {
          expiresAt = a.data.expiresAt;
          const { kind, subjectType, subjectId, payload } = applyItem;
          const claim = { id: CLAIM_ID, userId: USER_ID, kind, subjectType, subjectId, payload };
          return [
            {
              ...claim,
              grantedAt,
              heartbeatAt: new Date(),
              expiresAt,
              releasedAt: null,
              outcome: null,
            },
          ];
        },
      },
    };
    await new ClaimService(db as unknown as PrismaClient).heartbeat(USER_ID, CLAIM_ID);
    return (expiresAt.getTime() - Date.now()) / 60_000;
  };

  it("extends a young claim by the full TTL", async () => {
    const minutesLeft = await heartbeat(1);
    expect(minutesLeft).toBeGreaterThan(14);
    expect(minutesLeft).toBeLessThanOrEqual(15);
  });

  it("holds a long-running claim to its lifetime ceiling, even past it", async () => {
    const nearCeiling = await heartbeat(20);
    expect(nearCeiling).toBeGreaterThan(4);
    expect(nearCeiling).toBeLessThanOrEqual(5);
    expect(await heartbeat(90)).toBeLessThan(0);
  });
});
