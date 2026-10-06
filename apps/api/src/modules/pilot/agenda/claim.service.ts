import {
  type AgendaItem,
  type PilotClaim,
  pilotClaimSchema,
  type ReleasePilotClaimInput,
} from "@jobpilot/contracts/pilot";
import { singleton } from "tsyringe";
import { z } from "zod/v4";
import { conflict, findOwned } from "@/common/errors";
import { reviveJsonDates, toInputJson } from "@/common/json";
import {
  type PilotClaim as PilotClaimModel,
  type Prisma,
  PrismaClient,
} from "@/generated/prisma/client";
import { claimJobForApply, guardApply } from "@/modules/campaign/jobs/apply-guard";
import { publishJob } from "@/modules/campaign/jobs/job-events";
import { parseJobRef, revertApplyingJobs } from "./claims";
import { NEEDS_WORKER_VISIT } from "./gather-campaigns";
import { parseAgendaSnapshot } from "./snapshot";

const CLAIM_TTL_MS = 15 * 60 * 1000;
/** Counted from `grantedAt`, so a stuck driver that keeps heartbeating still expires. */
const MAX_CLAIM_LIFETIME_MS = 25 * 60 * 1000;
const STALE_AGENDA = "Agenda snapshot is stale; refresh it before claiming.";

const payloadSchema = z.record(z.string(), z.json());

function toPilotClaim(row: PilotClaimModel): PilotClaim {
  return pilotClaimSchema.parse({ ...row, payload: reviveJsonDates(row.payload) });
}

/** Kinds whose row can change after the agenda was built are re-checked rather than trusted. */
async function assertStillClaimable(
  tx: Prisma.TransactionClient,
  userId: string,
  item: AgendaItem,
): Promise<void> {
  const { subjectId } = item;
  let remaining: number;
  let gone: string;
  switch (item.kind) {
    case "campaign.reviewPaused":
      remaining = await tx.campaign.count({
        where: { campaignId: subjectId, userId, status: "paused" },
      });
      gone = "Campaign is no longer paused.";
      break;
    case "campaign.scorePending":
      remaining = await tx.campaign.count({
        where: {
          campaignId: subjectId,
          userId,
          status: "in_progress",
          jobs: { some: NEEDS_WORKER_VISIT },
        },
      });
      gone = "Campaign has no jobs left to score.";
      break;
    default:
      return;
  }
  if (remaining === 0) throw conflict(gone);
}

/** Claims items off a versioned agenda snapshot, and keeps those claims alive or releases them. */
@singleton()
export class ClaimService {
  constructor(private readonly prisma: PrismaClient) {}

  async claim(userId: string, agendaVersion: string, itemId: string) {
    const { claim, claimedJob } = await guardApply(this.prisma, userId, () =>
      this.prisma.$transaction((tx) => this.claimInTransaction(tx, userId, agendaVersion, itemId)),
    );
    if (claimedJob) publishJob(userId, claimedJob, "updated");
    return toPilotClaim(claim);
  }

  private async claimInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    agendaVersion: string,
    itemId: string,
  ) {
    const now = new Date();
    // The no-op write locks this user's state row, which serializes concurrent claims below.
    const [locked] = await tx.pilotState.updateManyAndReturn({
      where: { userId, running: true, agendaVersion, agendaExpiresAt: { gt: now } },
      data: { agendaVersion },
      select: { agendaSnapshot: true },
    });
    if (!locked?.agendaSnapshot) {
      const state = await tx.pilotState.findUnique({
        where: { userId },
        select: { running: true },
      });
      throw conflict(state?.running ? STALE_AGENDA : "Pilot is stopped.");
    }

    const item = parseAgendaSnapshot(locked.agendaSnapshot).items.find((i) => i.id === itemId);
    if (!item) throw conflict("Agenda item is no longer available.");

    const open = await tx.pilotClaim.findFirst({
      where: {
        userId,
        kind: item.kind,
        subjectType: item.subjectType,
        subjectId: item.subjectId,
        releasedAt: null,
      },
      select: { id: true },
    });
    if (open) throw conflict("This item is already claimed.");

    await assertStillClaimable(tx, userId, item);
    const claimedJob =
      item.kind === "job.apply"
        ? await claimJobForApply(tx, userId, item.payload.campaignId, item.payload.jobKey)
        : null;

    const claim = await tx.pilotClaim.create({
      data: {
        userId,
        kind: item.kind,
        subjectType: item.subjectType,
        subjectId: item.subjectId,
        payload: toInputJson(item.payload),
        expiresAt: new Date(now.getTime() + CLAIM_TTL_MS),
      },
    });
    return { claim, claimedJob };
  }

  async heartbeat(userId: string, id: string) {
    const claim = await findOwned(
      (where) =>
        this.prisma.pilotClaim.findFirst({ where, select: { grantedAt: true, releasedAt: true } }),
      { id, userId },
      "Claim",
    );
    if (claim.releasedAt) throw conflict("Claim is already released.");

    const now = Date.now();
    const ceiling = claim.grantedAt.getTime() + MAX_CLAIM_LIFETIME_MS;
    const [updated] = await this.prisma.pilotClaim.updateManyAndReturn({
      where: { id, userId, releasedAt: null },
      data: {
        heartbeatAt: new Date(now),
        expiresAt: new Date(Math.min(now + CLAIM_TTL_MS, ceiling)),
      },
    });
    if (!updated) throw conflict("Claim is already released.");
    return toPilotClaim(updated);
  }

  /** Bookkeeping only: an abandoned apply goes back to approved, other results use their own routes. */
  async release(userId: string, id: string, body: ReleasePilotClaimInput) {
    const existing = await findOwned(
      (where) => this.prisma.pilotClaim.findFirst({ where }),
      { id, userId },
      "Claim",
    );
    if (existing.releasedAt) {
      if (existing.outcome === body.outcome) return toPilotClaim(existing);
      throw conflict(`Claim already released with outcome ${existing.outcome}.`);
    }

    const payload = payloadSchema.parse(existing.payload);
    const released = await this.prisma.$transaction(async (tx) => {
      if (body.outcome === "abandoned" && existing.kind === "job.apply") {
        await revertApplyingJobs(tx, userId, [parseJobRef(payload)]);
      }
      const [row] = await tx.pilotClaim.updateManyAndReturn({
        where: { id, userId, releasedAt: null },
        data: {
          releasedAt: new Date(),
          outcome: body.outcome,
          payload: toInputJson(body.note ? { ...payload, releaseNote: body.note } : payload),
        },
      });
      if (!row) throw conflict("Claim was released concurrently.");
      return row;
    });
    return toPilotClaim(released);
  }
}
