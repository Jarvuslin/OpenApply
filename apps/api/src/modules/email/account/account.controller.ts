import { registerConnectorAccountSchema, sendEmailSchema } from "@openapply/contracts/email";
import { idParam } from "@openapply/contracts/shared";
import { Elysia } from "elysia";
import { verifyAccessToken } from "@/common/auth";
import { container } from "@/common/di/container";
import { authGuard } from "@/common/middleware";
import { RATE_LIMITS, rateLimit } from "@/common/rate-limit";
import {
  accountDisconnectedSchema,
  accountStatusSchema,
  emailAccountSchema,
  emailAccountsSchema,
  sentMessageSchema,
} from "../email.schema";
import { EmailAccountService } from "./account.service";
import { requireConnectorBrowserSession } from "./connector-registration";

const account = container.resolve(EmailAccountService);

/** Mailbox account status, disconnect, and outbound send. */
export const emailAccountController = new Elysia({
  prefix: "/email",
  detail: { tags: ["Email"] },
})
  .use(authGuard)
  .get("/accounts", ({ user }) => account.listAccounts(user.id), {
    response: emailAccountsSchema,
    detail: { summary: "List this user's saved mailboxes without credentials" },
  })
  .post(
    "/accounts/connector",
    async ({ user, body, cookie }) => {
      await requireConnectorBrowserSession(user.id, cookie.accessToken?.value, verifyAccessToken);
      return account.registerConnectorAccount(user.id, body);
    },
    {
      body: registerConnectorAccountSchema,
      response: emailAccountSchema,
      beforeHandle: rateLimit(RATE_LIMITS.mailboxIngest),
      detail: {
        summary: "Register a mailbox after a successful local-agent connection check",
        description:
          "Called after a successful read-access check and either authenticated mailbox identity verification or user confirmation of the address. Stores the check provenance without importing mail or changing the applicant contact email.",
      },
    },
  )
  .post("/accounts/:id/select", ({ user, params }) => account.selectAccount(user.id, params.id), {
    params: idParam,
    response: accountStatusSchema,
    detail: { summary: "Select an owned mailbox without deleting any imported mail" },
  })
  .delete("/accounts/:id", ({ user, params }) => account.disconnectAccount(user.id, params.id), {
    params: idParam,
    response: accountDisconnectedSchema,
    detail: { summary: "Remove one owned mailbox and its imported messages" },
  })
  .get("/account", ({ user }) => account.accountStatus(user.id), {
    response: accountStatusSchema,
    detail: {
      summary: "Get mailbox account status",
      description:
        "Returns the connection status of the profile's linked email account, including provider, email address, last sync time, and whether it can send.",
    },
  })
  .delete("/account", ({ user }) => account.disconnectAccount(user.id), {
    response: accountDisconnectedSchema,
    detail: {
      summary: "Disconnect mailbox account",
      description:
        "Removes only the selected mailbox and its imported messages. Other saved mailboxes and their messages are preserved.",
    },
  })
  .post("/send", ({ user, body }) => account.send(user.id, body), {
    body: sendEmailSchema,
    response: sentMessageSchema,
    detail: {
      summary: "Send outbound email",
      description:
        "Sends an email from the profile's connected mailbox (refreshing the token first), and returns the provider send result or errors when no account is connected or the mailbox lacks send access.",
    },
  });
