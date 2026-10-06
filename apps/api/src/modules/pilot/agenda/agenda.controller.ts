import {
  agendaResponseSchema,
  createPilotClaimSchema,
  currentAgendaResponseSchema,
  pilotClaimSchema,
  releasePilotClaimSchema,
} from "@openapply/contracts/pilot";
import { idParam } from "@openapply/contracts/shared";
import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import { AgendaService } from "./agenda.service";
import { ClaimService } from "./claim.service";

const agenda = container.resolve(AgendaService);
const claims = container.resolve(ClaimService);
const limitAgenda = rateLimit(RATE_LIMITS.pilotAgenda);
const limitClaim = rateLimit(RATE_LIMITS.pilotClaim);

export const pilotAgendaController = new Elysia({ prefix: "/pilot", detail: { tags: ["Pilot"] } })
  .use(authGuard)
  .get("/agenda", ({ user }) => agenda.getCurrent(user.id), {
    beforeHandle: limitAgenda,
    response: currentAgendaResponseSchema,
    detail: {
      summary: "Get the current agenda snapshot",
      description:
        "Returns the current unexpired agenda snapshot without running expiry, promotion, digest, or any other mutation.",
    },
  })
  .post("/agenda/refresh", ({ user }) => agenda.refresh(user.id), {
    beforeHandle: limitAgenda,
    response: agendaResponseSchema,
    detail: {
      summary: "Refresh the agenda snapshot",
      description:
        "Runs lifecycle maintenance, builds a typed agenda, persists a new expiring version, and returns that snapshot.",
    },
  })
  .post("/claims", ({ user, body }) => claims.claim(user.id, body.agendaVersion, body.itemId), {
    body: createPilotClaimSchema,
    beforeHandle: limitClaim,
    response: pilotClaimSchema,
    detail: {
      summary: "Claim an agenda item",
      description:
        "Atomically claims an item from the supplied agenda version and creates its 15-minute claim; stale versions and races return 409.",
    },
  })
  .post("/claims/:id/heartbeat", ({ user, params }) => claims.heartbeat(user.id, params.id), {
    params: idParam,
    beforeHandle: limitClaim,
    response: pilotClaimSchema,
    detail: {
      summary: "Heartbeat a claim",
      description: "Extends the claim TTL by 15 minutes and records the heartbeat.",
    },
  })
  .post(
    "/claims/:id/release",
    ({ user, params, body }) => claims.release(user.id, params.id, body),
    {
      params: idParam,
      body: releasePilotClaimSchema,
      beforeHandle: limitClaim,
      response: pilotClaimSchema,
      detail: {
        summary: "Release a claim",
        description:
          "Closes a claim (done/failed/abandoned); abandoned reverts the job to approved. Bookkeeping only - terminal job results go through the campaign result route.",
      },
    },
  );
