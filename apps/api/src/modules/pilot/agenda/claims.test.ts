import { HOUR_MS } from "@/common/date/buckets";
import { claimDamped, parseJobSubject } from "./claims";
import { describe, expect, it } from "bun:test";

describe("claimDamped", () => {
  const now = new Date("2026-07-15T12:00:00.000Z");
  const releasedHoursAgo = (hours: number, outcome: "done" | "expired" | "abandoned") => ({
    grantedAt: new Date(now.getTime() - (hours + 1) * HOUR_MS),
    releasedAt: new Date(now.getTime() - hours * HOUR_MS),
    outcome,
  });
  const DAY = 24 * HOUR_MS;

  it("damps a subject whose claim is still open", () => {
    expect(claimDamped({ grantedAt: now, releasedAt: null, outcome: null }, now, DAY)).toBe(true);
  });

  it("damps a deliberate outcome for the whole cooldown", () => {
    expect(claimDamped(releasedHoursAgo(3, "done"), now, DAY)).toBe(true);
    expect(claimDamped(releasedHoursAgo(25, "done"), now, DAY)).toBe(false);
  });

  it("lets a crashed claim retry after two hours, whatever the cooldown", () => {
    expect(claimDamped(releasedHoursAgo(1, "expired"), now, DAY)).toBe(true);
    expect(claimDamped(releasedHoursAgo(3, "expired"), now, DAY)).toBe(false);
    expect(claimDamped(releasedHoursAgo(3, "abandoned"), now, DAY)).toBe(false);
  });

  it("never damps a subject with no claim", () => {
    expect(claimDamped(null, now, DAY)).toBe(false);
  });
});

describe("parseJobSubject", () => {
  it("splits on the first colon, so job keys may contain colons", () => {
    expect(parseJobSubject("c1:a:b")).toEqual({ campaignId: "c1", key: "a:b" });
  });

  it("rejects a subject missing either half", () => {
    expect(() => parseJobSubject(":j1")).toThrow();
    expect(() => parseJobSubject("c1:")).toThrow();
  });
});
