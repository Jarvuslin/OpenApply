import {
  addCampaignNetworkingSchema,
  networkingMessageResultSchema,
  patchNetworkingMessageSchema,
} from "@jobpilot/contracts/networking";
import { paginationQuerySchema } from "@jobpilot/contracts/pagination";
import { idParam } from "@jobpilot/contracts/shared";
import { Elysia } from "elysia";
import { container } from "@/common/di/container";
import { authGuard, requireVerifiedEmail } from "@/common/middleware";
import {
  networkingMessageListSchema,
  networkingMessageParams,
  networkingMessageQuerySchema,
  networkingMessageResultResponseSchema,
  networkingMessageSchema,
} from "./networking.schema";
import { NetworkingService } from "./networking.service";

const svc = container.resolve(NetworkingService);

export const networkingController = new Elysia({ detail: { tags: ["Campaigns"] } })
  .use(authGuard)
  .get(
    "/networking/messages",
    ({ user, query }) => svc.listNetworking(user.id, { ...query, order: "desc" }),
    {
      query: networkingMessageQuerySchema,
      response: networkingMessageListSchema,
      detail: {
        summary: "List networking messages across campaigns",
        description:
          "Returns one page of the active profile's networking messages, newest first. Optional `status` and `campaignId` filters.",
      },
    },
  )
  .get(
    "/campaigns/:id/networking",
    ({ user, params, query }) => svc.listNetworking(user.id, { ...query, campaignId: params.id }),
    {
      params: idParam,
      query: paginationQuerySchema,
      response: networkingMessageListSchema,
      detail: {
        summary: "List networking messages",
        description:
          "Returns one page of the campaign's networking messages with contacts, ordered by creation.",
      },
    },
  )
  .post(
    "/campaigns/:id/networking",
    async ({ user, params, body }) => {
      await requireVerifiedEmail(user.id);
      return svc.addNetworking(user.id, params.id, body);
    },
    {
      params: idParam,
      body: addCampaignNetworkingSchema,
      response: networkingMessageSchema,
      detail: {
        summary: "Add networking message",
        description:
          "Atomically adds a contact (new or existing) and an initial non-terminal networking message. Requires a verified email address.",
      },
    },
  )
  .patch(
    "/campaigns/:id/networking/:messageId",
    ({ user, params, body }) => svc.patchNetworking(user.id, params.id, params.messageId, body),
    {
      params: networkingMessageParams,
      body: patchNetworkingMessageSchema,
      response: networkingMessageSchema,
      detail: {
        summary: "Update networking message",
        description:
          "Applies a conditional non-terminal message edit or contact connection update. Terminal outcomes go through the result route.",
      },
    },
  )
  .post(
    "/campaigns/:id/networking/:messageId/result",
    ({ user, params, body }) =>
      svc.recordNetworkingResult(user.id, params.id, params.messageId, body),
    {
      params: networkingMessageParams,
      body: networkingMessageResultSchema,
      response: networkingMessageResultResponseSchema,
      detail: {
        summary: "Record networking message result",
        description:
          "Idempotently records a terminal outcome, stamps delivery identifiers when sent, and returns the message with the campaign's current summary.",
      },
    },
  );
