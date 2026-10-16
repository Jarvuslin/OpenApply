import { createInterface } from "node:readline";

const empty = { type: "object", properties: {}, additionalProperties: false };
const tools = [
  {
    name: "inspect",
    description:
      "Inspect this account's isolated employer browser. Returns observations without passwords or verification codes.",
    inputSchema: empty,
  },
  {
    name: "signup",
    description:
      "Create the account once with the saved signup credential: the host fills the password, accepts the employer's signup terms and submits. Passwords never reach the model.",
    inputSchema: empty,
  },
  {
    name: "login",
    description:
      "Sign in using a human-confirmed existing account credential. Signup defaults cannot be used.",
    inputSchema: empty,
  },
  {
    name: "verification_context",
    description:
      "Read the exact current verification request and mailbox-confirmation basis before a bounded Gmail lookup.",
    inputSchema: empty,
  },
  {
    name: "verify",
    description:
      "Use one matching fresh code or link. Input is ephemeral and never logged. Employer authentication still requires visible evidence.",
    inputSchema: {
      type: "object",
      properties: {
        recipient: { type: "string" },
        sender: { type: "string" },
        receivedAt: { type: "string" },
        tenantOrigin: { type: "string" },
        code: { type: "string", maxLength: 32 },
        link: { type: "string", maxLength: 4000 },
      },
      required: ["recipient", "sender", "receivedAt", "tenantOrigin"],
      additionalProperties: false,
    },
  },
  {
    name: "request_help",
    description:
      "Persist a scoped Needs-you account request and stop. Never asks for a secret in the conversation.",
    inputSchema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          enum: [
            "existing_account_credentials",
            "password_entry",
            "terms_confirmation",
            "mailbox_identity",
            "verification",
            "captcha",
          ],
        },
      },
      required: ["reason"],
      additionalProperties: false,
    },
  },
];
const companion = new URL(process.env.OPENAPPLY_COMPANION ?? "http://localhost:4102");
const session = process.env.OPENAPPLY_BROWSER_SESSION_ID;
const capability = process.env.OPENAPPLY_WORKER_CAPABILITY;
if (
  companion.protocol !== "http:" ||
  !["localhost", "127.0.0.1", "[::1]"].includes(companion.hostname) ||
  companion.username ||
  companion.password ||
  companion.pathname !== "/" ||
  companion.search ||
  companion.hash ||
  !/^[a-f0-9-]{36}$/.test(session ?? "") ||
  !/^[a-f0-9]{64}$/.test(capability ?? "")
)
  throw Error("Account MCP configuration unavailable");
const reply = (id, result) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
const lines = createInterface({ input: process.stdin });
let busy = false;
lines.on("line", async (line) => {
  let message;
  try {
    if (line.length > 12000) throw Error();
    message = JSON.parse(line);
    if (message.id === undefined) return;
    if (message.method === "initialize")
      return reply(message.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "openapply_account", version: "1.0.0" },
      });
    if (message.method === "ping") return reply(message.id, {});
    if (message.method === "tools/list") return reply(message.id, { tools });
    const tool = tools.find((value) => value.name === message.params?.name);
    const input = message.params?.arguments ?? {};
    if (
      busy ||
      message.method !== "tools/call" ||
      !tool ||
      !input ||
      Array.isArray(input) ||
      Object.keys(input).some((key) => !(key in tool.inputSchema.properties))
    )
      throw Error();
    for (const key of tool.inputSchema.required ?? [])
      if (typeof input[key] !== "string") throw Error();
    busy = true;
    try {
      const response = await fetch(new URL(`/queue/workers/${session}/account`, companion), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-OpenApply-Worker-Capability": capability,
        },
        body: JSON.stringify({ operation: tool.name, input }),
        redirect: "error",
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) throw Error();
      const value = await response.text();
      if (value.length > 12000) throw Error();
      return reply(message.id, { content: [{ type: "text", text: value }] });
    } finally {
      busy = false;
    }
  } catch {
    if (message?.id !== undefined)
      reply(message.id, {
        isError: true,
        content: [
          {
            type: "text",
            text: "Account operation unavailable or refused. Inspect the saved account state; never retry signup.",
          },
        ],
      });
  }
});
