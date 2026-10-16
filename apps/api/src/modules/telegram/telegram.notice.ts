import type { TelegramActionKind, TelegramTemplateKind } from "@openapply/contracts/telegram";
import { toInputJson } from "@/common/json";
import type { Prisma, TelegramAction, TelegramLink } from "@/generated/prisma/client";
import { actionToken } from "./telegram.policy";
import type { TelegramMessage } from "./telegram.transport";

export interface TelegramActionSpec {
  kind: TelegramActionKind;
  targetId: string;
  expectedRevision?: number;
  expectedHash?: string;
  payload?: Record<string, unknown>;
  expiresAt?: Date;
}
export interface TelegramNotice {
  eventKey: string;
  template: TelegramTemplateKind;
  payload?: Record<string, unknown>;
  actions?: TelegramActionSpec[];
}
export async function enqueueTelegramNotice(
  tx: Prisma.TransactionClient,
  link: TelegramLink,
  notice: TelegramNotice,
) {
  if (!link.active || !link.chatId) return;
  const actions = [];
  for (const [index, spec] of (notice.actions ?? []).slice(0, 6).entries()) {
    const eventKey = `${notice.eventKey}:action:${index}`;
    const action = await tx.telegramAction.upsert({
      where: {
        linkId_generation_eventKey: { linkId: link.id, generation: link.generation, eventKey },
      },
      update: {},
      create: {
        userId: link.userId,
        linkId: link.id,
        generation: link.generation,
        eventKey,
        kind: spec.kind,
        targetId: spec.targetId,
        expectedRevision: spec.expectedRevision ?? null,
        expectedHash: spec.expectedHash ?? null,
        payload: toInputJson(spec.payload ?? {}),
        requestId: crypto.randomUUID(),
        expiresAt: spec.expiresAt ?? new Date(Date.now() + 30 * 60_000),
      },
    });
    actions.push(action.id);
  }
  await tx.telegramDelivery.upsert({
    where: {
      linkId_generation_eventKey: {
        linkId: link.id,
        generation: link.generation,
        eventKey: notice.eventKey,
      },
    },
    update: {},
    create: {
      userId: link.userId,
      linkId: link.id,
      generation: link.generation,
      eventKey: notice.eventKey,
      template: notice.template,
      payload: toInputJson({ ...notice.payload, actions }),
    },
  });
}
const labels: Record<TelegramActionKind, string> = {
  answer: "Answer",
  apply_now: "Apply now",
  queue: "Add to queue",
  skip: "Skip",
  approve: "Approve reviewed checkpoint",
  decline: "Skip application",
  exclude_company: "Confirm exclusion",
  undo: "Undo",
};
function count(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : "unknown";
}
function label(value: unknown) {
  return typeof value === "string"
    ? value
        .replace(/[\p{Cc}\p{Cf}]/gu, " ")
        .trim()
        .slice(0, 160)
    : "";
}
export function renderTelegramNotice(
  template: TelegramTemplateKind,
  payload: Record<string, unknown>,
  actions: TelegramAction[],
  chatId: string,
  webUrl: string,
  secret: string,
): TelegramMessage {
  let text: string;
  let silent = true;
  switch (template) {
    case "help":
      text =
        'Send one HTTPS job link or /add <HTTPS-link> to prepare it. Use /status, /help, /unlink; stop applying to <exact known company> or /exclude "<exact known company>". Current buttons and /answer <token>, /approve <token>, /skip <token>, /undo <token> target one saved item. Other input opens web review.';
      break;
    case "paired":
      text =
        "Connected to OpenApply! Sending a job link prepares a candidate; it does not authorize an application or model spending.";
      break;
    case "status":
    case "digest": {
      const lastSeen =
        typeof payload.lastSeenAt === "string" &&
        /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(payload.lastSeenAt)
          ? payload.lastSeenAt
          : "not yet observed";
      text = `OpenApply: ${count(payload.queued)} queued, ${count(payload.running)} running, ${count(payload.needsYou)} need you. ${payload.presence === "online" ? (payload.executionAvailable === true ? "Computer online and ready" : "Computer online; execution blocked") : "Waiting for your computer"}. Last seen: ${lastSeen}.`;
      break;
    }
    case "intake":
      text = `Job link saved. Preparation: ${["ready", "pending", "unresolved", "already_applied"].includes(String(payload.preparation)) ? payload.preparation : "pending"}. Match: ${typeof payload.matchScore === "number" && payload.matchScore >= 0 && payload.matchScore <= 100 ? `${payload.matchScore}/100` : "not scored"}. Open questions: ${count(payload.unansweredCount)}. Review the saved candidate before deciding.`;
      break;
    case "question":
      text =
        payload.safe === true
          ? "Preferred contact method? Choose your confirmed answer for this application."
          : "An application needs an answer. Review and confirm it in authenticated OpenApply.";
      silent = false;
      break;
    case "approval":
      text =
        "An application checkpoint needs your review. Open OpenApply to inspect the exact form and PDF before approving this checkpoint. Approval does not grant model spending.";
      silent = false;
      break;
    case "rule":
      text = "The company exclusion was saved. Its revision-bound Undo is available below.";
      break;
    case "action_done":
      text = "Your decision was recorded in OpenApply.";
      break;
    case "web_required":
      text =
        "This item changed or requires authenticated web review. Open OpenApply for the current state.";
      break;
  }
  const title = label(payload.title),
    company = label(payload.company);
  if (title || company) text = `${title}${title && company ? " — " : ""}${company}\n${text}`;
  if (actions.length)
    text +=
      "\nButtons expire after 30 minutes or when the item changes. Use authenticated web review after expiry.";
  const buttons: NonNullable<TelegramMessage["buttons"]> = [];
  for (const action of actions) {
    if (action.state !== "pending" || action.expiresAt <= new Date()) continue;
    const details = action.payload as Record<string, unknown>;
    const label =
      action.kind === "answer" && (details.label === "Email" || details.label === "Phone")
        ? details.label
        : labels[action.kind];
    buttons.push([{ text: label, callback_data: actionToken(action, secret) }]);
  }
  const target =
    typeof payload.targetId === "string" && /^[a-f0-9-]{36}$/.test(payload.targetId)
      ? payload.targetId
      : null;
  const path =
    template === "intake" && target
      ? `/job-intakes/${target}`
      : target
        ? `/needs-you?target=${target}`
        : "/needs-you";
  buttons.push([{ text: "Open OpenApply", url: new URL(path, webUrl).href }]);
  return { chatId, text, silent, buttons };
}
