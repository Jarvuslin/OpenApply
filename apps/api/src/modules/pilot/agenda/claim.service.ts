import type { ReleasePilotClaimInput } from "@jobpilot/contracts/pilot";
import { singleton } from "tsyringe";
import { z } from "zod/v4";
import { conflict, findOwned } from "@/common/errors";
import { toInputJson } from "@/common/json";
import { type Job, type PilotClaim, type Prisma, PrismaClient } from "@/generated/prisma/client";
import { claimJobForApply, guardApply } from "@/modules/campaign/jobs/apply-guard";
import { publishJob } from "@/modules/campaign/jobs/job-events";
import { toPilotClaim } from "../pilot.mapper";
import { verifyGrant } from "./grant";
import { parseJobPayload } from "./job-mutations";
import { parseAgendaSnapshot } from "./service";

const CLAIM_TTL_MS = 15 * 60 * 1000;
/** Hard limit from `grantedAt`. A stuck driver that still heartbeats would never expire. */
const MAX_CLAIM_LIFETIME_MS = 25 * 60 * 1000;

interface ClaimResult {
  claim: PilotClaim;
  claimedJob: Job | null;
}

/** Atomically claims versioned agenda items and manages claim heartbeats and release. */
@singleton()
export class ClaimService {
  constructor(private readonly prisma: PrismaClient) {}

  async claim(userId: string, agendaVersion: string, itemId: string) {
    const { claim, claimedJob } = await guardApply(this.prisma, userId, () =>
      this.prisma.$transaction((tx) => this.claimInTransaction(tx, userId, agendaVersion, itemId)),
    );
    if (claimedJob) {
      publishJob(userId, claimedJob, "updated");
    }
    return toPilotClaim(claim);
  }

  private async claimInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    agendaVersion: string,
    itemId: string,
  ): Promise<ClaimResult> {
    const now = new Date();
    const locked = await tx.pilotState.updateMany({
      where: {
        userId,
        running: true,
        agendaVersion,
        agendaExpiresAt: { gt: now },
      },
      data: { agendaVersion },
    });

    if (locked.count === 0) {
      const current = await tx.pilotState.findUnique({
        where: { userId },
        select: { running: true },
      });
      if (!current?.running) throw conflict("Pilot is stopped.");
      throw conflict("Agenda snapshot is stale; refresh it before claiming.");
    }

    const state = await tx.pilotState.findUniqueOrThrow({ where: { userId } });
    if (!state.agendaSnapshot) {
      throw conflict("Agenda snapshot is stale; refresh it before claiming.");
    }
    const item = parseAgendaSnapshot(state.agendaSnapshot).items.find(
      (candidate) => candidate.id === itemId,
    );
    if (!item) throw conflict("Agenda item is no longer available.");

    // Safe as a read-then-write: the pilotState update above locks this user's row for the
    // rest of the transaction, so concurrent claim() calls for one user serialize here.
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

    await verifyGrant(tx, userId, item.kind, item.subjectId);
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
    const open = await this.prisma.pilotClaim.findFirst({
      where: { id, userId, releasedAt: null },
      select: { grantedAt: true },
    });

    const now = Date.now();
    const ceiling = (open?.grantedAt.getTime() ?? Number.POSITIVE_INFINITY) + MAX_CLAIM_LIFETIME_MS;
    const updated = await this.prisma.pilotClaim.updateMany({
      where: { id, userId, releasedAt: null },
      data: {
        heartbeatAt: new Date(now),
        expiresAt: new Date(Math.min(now + CLAIM_TTL_MS, ceiling)),
      },
    });
    if (updated.count === 0) {
      const existing = await this.prisma.pilotClaim.findFirst({ where: { id, userId } });
      if (!existing) await findOwned(() => Promise.resolve(null), { id, userId }, "Claim");
      throw conflict("Claim is already released.");
    }
    return toPilotClaim(await this.prisma.pilotClaim.findUniqueOrThrow({ where: { id } }));
  }

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

    const payload = z.record(z.string(), z.json()).parse(existing.payload);

    const updated = await this.prisma.$transaction(async (tx) => {
      if (body.outcome === "abandoned" && existing.kind === "job.apply") {
        const jobRef = parseJobPayload(payload);
        await tx.job.updateMany({
          where: {
            campaignId: jobRef.campaignId,
            key: jobRef.jobKey,
            status: "applying",
            campaign: { userId },
          },
          data: { status: "approved" },
        });
      }

      const changed = await tx.pilotClaim.updateMany({
        where: { id, userId, releasedAt: null },
        data: {
          releasedAt: new Date(),
          outcome: body.outcome,
          payload: toInputJson(body.note ? { ...payload, releaseNote: body.note } : payload),
        },
      });
      if (changed.count === 0) throw conflict("Claim was released concurrently.");
      return tx.pilotClaim.findUniqueOrThrow({ where: { id } });
    });
    return toPilotClaim(updated);
  }
}
