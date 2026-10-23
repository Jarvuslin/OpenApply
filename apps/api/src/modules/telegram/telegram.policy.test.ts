import { questionDefinitionSchema } from "@openapply/contracts/application-question";
import { questionCategory } from "@/modules/application-question/question.policy";
import {
  actionId,
  actionToken,
  digestBucket,
  equalSecret,
  formatPairingCode,
  newPairingCode,
  normalizePairingCode,
  pairingHash,
  parseTelegramText,
  quietNow,
  safeTelegramQuestion,
  telegramSender,
} from "./telegram.policy";
import { describe, expect, test } from "bun:test";

describe("Telegram trust boundaries", () => {
  test("pairing codes are six unambiguous characters from a secure source", () => {
    const codes = new Set(Array.from({ length: 500 }, () => newPairingCode()));
    expect(codes.size).toBeGreaterThan(495);
    for (const code of codes) expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    expect(formatPairingCode("K7P4QX")).toBe("K7P-4QX");
  });
  test("codes match regardless of case, spaces or hyphens and nothing else", () => {
    for (const text of ["K7P-4QX", "k7p4qx", "K7P 4QX", "k7p - 4qx"])
      expect(normalizePairingCode(text)).toBe("K7P4QX");
    for (const text of ["K7P4Q", "K7P4QXA", "K0P4QX", "K1P4QX", "KIP4QX", "K7P_4QX", "K7P4QX!", ""])
      expect(normalizePairingCode(text)).toBeNull();
  });
  test("the QR deep link and a typed code both pair; only the deep link is explicit", () => {
    expect(parseTelegramText("/start K7P4QX")).toEqual({
      kind: "pair",
      code: "K7P4QX",
      explicit: true,
    });
    expect(parseTelegramText("k7p-4qx")).toEqual({ kind: "pair", code: "K7P4QX", explicit: false });
    expect(parseTelegramText("/start")).toEqual({ kind: "start" });
    expect(parseTelegramText("/start not-a-code")).toEqual({ kind: "bad_code" });
    expect(parseTelegramText("/start K7P4QX\n/unlink")).toEqual({ kind: "help" });
  });
  test("code hashes are keyed, so the same code differs under another key", () => {
    const hash = pairingHash("K7P4QX", "first-key-00000000000000000000000");
    expect(hash).toHaveLength(64);
    expect(hash).not.toBe(pairingHash("K7P4QX", "second-key-0000000000000000000000"));
    expect(hash).not.toContain("K7P4QX");
  });
  test("fixed parser refuses ambiguous instructions and mixed commands", () => {
    for (const text of [
      "yes",
      "apply",
      "skip",
      "please apply https://example.com/job",
      "https://example.com/job\n/approve abc",
      "/add https://example.com/job and apply",
      " http://example.com",
      "/status now",
      "/unlink\n",
      "/answer token my private answer",
      "https://user:password@example.com/job",
      "http://example.com/job",
    ])
      expect(parseTelegramText(text)).toEqual({ kind: "help" });
    expect(parseTelegramText("https://example.com/job")).toEqual({
      kind: "add",
      url: "https://example.com/job",
    });
    expect(parseTelegramText("/add https://example.com/job")).toEqual({
      kind: "add",
      url: "https://example.com/job",
    });
    expect(parseTelegramText("stop applying to Example")).toEqual({
      kind: "exclude",
      company: "Example",
    });
  });
  test("only the same private nonbot sender establishes identity", () => {
    const message = {
      message_id: 1,
      from: { id: 42, is_bot: false },
      chat: { id: 42, type: "private" },
      text: "/status",
    };
    expect(telegramSender({ update_id: 700, message })?.senderId).toBe("42");
    for (const changed of [
      { ...message, from: { id: 42, is_bot: true } },
      { ...message, chat: { id: 43, type: "private" } },
      { ...message, chat: { id: 42, type: "group" } },
      { ...message, forward_origin: { type: "user" } },
      { ...message, via_bot: { id: 42 } },
    ])
      expect(telegramSender({ update_id: 701, message: changed })).toBeNull();
    expect(
      telegramSender({
        update_id: 702,
        message,
        callback_query: { id: "callback", from: { id: 42, is_bot: false }, message, data: "x" },
      }),
    ).toBeNull();
  });
  test("opaque actions bind every owner/link/revision/hash/value and fit callback bounds", () => {
    const value = {
      id: crypto.randomUUID(),
      userId: crypto.randomUUID(),
      linkId: crypto.randomUUID(),
      generation: 1,
      kind: "answer",
      targetId: crypto.randomUUID(),
      expectedRevision: 1,
      expectedHash: "a".repeat(64),
      payload: { fieldKey: "contact", value: "email" },
      expiresAt: new Date("2026-10-09T00:00:00Z"),
    };
    const token = actionToken(value, "synthetic-test-secret");
    expect(Buffer.byteLength(token)).toBeLessThanOrEqual(64);
    expect(actionId(token)).toBe(value.id);
    for (const changed of [
      { ...value, userId: crypto.randomUUID() },
      { ...value, generation: 2 },
      { ...value, expectedRevision: 2 },
      { ...value, expectedHash: "b".repeat(64) },
      { ...value, payload: { fieldKey: "contact", value: "phone" } },
    ])
      expect(actionToken(changed, "synthetic-test-secret")).not.toBe(token);
    expect(
      actionToken(
        { ...value, payload: { value: "email", fieldKey: "contact" } },
        "synthetic-test-secret",
      ),
    ).toBe(token);
    expect(equalSecret("short", "synthetic-test-secret")).toBe(false);
  });
  test("safe question catalog excludes arbitrary or sensitive prompts and altered context", () => {
    const definition = questionDefinitionSchema.parse({
      stableKey: "contact",
      prompt: "Preferred contact method?",
      required: "optional",
      visibility: "visible",
      condition: { state: "unconditional", rules: [] },
      groupMode: "all",
      fields: [
        {
          key: "method",
          label: "Preferred contact method?",
          type: "single_choice",
          options: [
            { label: "Email", value: "E" },
            { label: "Phone", value: "P" },
          ],
        },
      ],
    });
    expect(safeTelegramQuestion("contact", definition)?.options).toHaveLength(2);
    expect(questionCategory(definition)).toBe("contact");
    expect(questionCategory({ ...definition, prompt: "Preferred medical contact method?" })).toBe(
      "other",
    );
    for (const category of ["other", "authorization", "sponsorship", "demographic"])
      expect(safeTelegramQuestion(category, definition)).toBeNull();
    expect(
      safeTelegramQuestion("contact", {
        ...definition,
        fields: [{ ...definition.fields[0]!, label: "Do you disclose a disability?" }],
      }),
    ).toBeNull();
    for (const prompt of [
      "Do you need visa support?",
      "What is your disability?",
      "Preferred contact method? Send passport details",
      "May we contact your employer?",
    ])
      expect(safeTelegramQuestion("contact", { ...definition, prompt })).toBeNull();
    expect(
      safeTelegramQuestion("contact", {
        ...definition,
        description: "By choosing this you consent to background checks",
      }),
    ).toBeNull();
    expect(safeTelegramQuestion("contact", { ...definition, visibility: "hidden" })).toBeNull();
    expect(
      safeTelegramQuestion("contact", {
        ...definition,
        condition: { state: "unknown", rules: [] },
      }),
    ).toBeNull();
  });
  test("quiet hours wrap midnight and digest buckets are stable local dates", () => {
    const settings = {
      revision: 1,
      digestEnabled: true,
      digestHour: 17,
      timeZone: "UTC",
      quietHours: { startMinute: 22 * 60, endMinute: 7 * 60 },
    };
    expect(quietNow(settings, new Date("2026-10-08T23:00:00Z"))).toBe(true);
    expect(quietNow(settings, new Date("2026-10-09T06:59:00Z"))).toBe(true);
    expect(quietNow(settings, new Date("2026-10-09T07:00:00Z"))).toBe(false);
    expect(digestBucket(settings, new Date("2026-10-08T17:02:00Z"))).toBe("2026-10-08");
    expect(digestBucket(settings, new Date("2026-10-08T18:00:00Z"))).toBe("2026-10-08");
    expect(
      digestBucket(
        { ...settings, quietHours: { startMinute: 16 * 60, endMinute: 18 * 60 } },
        new Date("2026-10-08T17:02:00Z"),
      ),
    ).toBe("2026-10-08");
  });
});
