import type { TelegramSettings } from "@openapply/contracts/telegram";
import { notificationDraft, notificationInput } from "./notification-draft";
import { describe, expect, test } from "bun:test";

const basis: TelegramSettings = {
  revision: 3,
  digestEnabled: false,
  digestHour: 17,
  timeZone: "America/Toronto",
  quietHours: { startMinute: 1320, endMinute: 420 },
};
describe("notification edits", () => {
  test("round-trip midnight-spanning quiet hours and the exact saved revision", () => {
    const draft = notificationDraft(basis);
    expect(draft.quietStart).toBe("22:00");
    expect(draft.quietEnd).toBe("07:00");
    expect(notificationInput(draft, basis, basis)).toEqual({
      expectedRevision: 3,
      digestEnabled: false,
      digestHour: 17,
      timeZone: "America/Toronto",
      quietHours: { startMinute: 1320, endMinute: 420 },
    });
    expect(
      notificationInput({ ...draft, quietEnabled: false }, basis, basis).quietHours,
    ).toBeNull();
  });
  test("reject stale drafts and invalid notification times", () => {
    const draft = notificationDraft(basis);
    expect(() => notificationInput(draft, basis, { ...basis, revision: 4 })).toThrow();
    for (const change of [
      { quietStart: "24:00" },
      { quietEnd: "22:00" },
      { digestHour: 24 },
      { timeZone: "Invalid/Zone" },
    ])
      expect(() => notificationInput({ ...draft, ...change }, basis, basis)).toThrow();
  });
});
