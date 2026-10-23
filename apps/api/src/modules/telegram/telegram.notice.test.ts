import { renderTelegramNotice } from "./telegram.notice";
import { expect, test } from "bun:test";

test("cards expose bounded canonical job identity and exact web targets without arbitrary prompts or answers", () => {
  const id = crypto.randomUUID(),
    payload = {
      targetId: id,
      title: "Engineer",
      company: "Synthetic Company",
      preparation: "pending",
      unansweredCount: 2,
      prompt: "Private health question",
      answer: "private answer",
      error: "private token",
    };
  const card = renderTelegramNotice(
    "intake",
    payload,
    [],
    "42",
    "https://openapply.example",
    "synthetic-secret",
  );
  expect(card.text).toContain("Engineer — Synthetic Company");
  expect(JSON.stringify(card)).not.toContain("private");
  expect(card.buttons?.[0]?.[0]?.url).toBe(`https://openapply.example/job-intakes/${id}`);
  expect(card.silent).toBe(true);
  const blocker = renderTelegramNotice(
    "question",
    { targetId: id, safe: false },
    [],
    "42",
    "https://openapply.example",
    "synthetic-secret",
  );
  expect(blocker.silent).toBe(false);
  expect(blocker.buttons?.[0]?.[0]?.url).toBe(`https://openapply.example/needs-you?target=${id}`);
});
test("unknown computer status states the wait and help lists only supported anchored commands", () => {
  const status = renderTelegramNotice(
    "status",
    { queued: 0, running: 0, needsYou: 0, presence: "unknown" },
    [],
    "42",
    "https://openapply.example",
    "synthetic-secret",
  );
  expect(status.text).toContain("Waiting for your computer");
  expect(status.text).toContain("Last seen: not yet observed");
  const help = renderTelegramNotice(
    "help",
    {},
    [],
    "42",
    "https://openapply.example",
    "synthetic-secret",
  );
  for (const command of [
    "/add",
    "/status",
    "/unlink",
    "/answer",
    "/approve",
    "/skip",
    "/undo",
    "/exclude",
    "stop applying to",
  ])
    expect(help.text).toContain(command);
});
