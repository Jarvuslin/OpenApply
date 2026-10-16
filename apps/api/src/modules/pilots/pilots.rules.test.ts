import { pilotRulesSchema } from "@openapply/contracts/pilots";
import { rulesWhere, settledStatus, windowFor, windowWhere } from "./pilots.rules";
import { describe, expect, test } from "bun:test";

const now = new Date("2026-10-12T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const rules = (input: Partial<ReturnType<typeof pilotRulesSchema.parse>> = {}) =>
  pilotRulesSchema.parse(input);

describe("windowFor", () => {
  test("puts a job in the narrowest selected window it still fits", () => {
    expect(windowFor(minutesAgo(12), [1440, 30], now)).toBe(30);
    expect(windowFor(minutesAgo(45), [30, 1440], now)).toBe(1440);
  });

  test("returns null when any time is allowed", () => {
    expect(windowFor(minutesAgo(5000), [], now)).toBeNull();
  });
});

describe("settledStatus", () => {
  test("keeps jobs at or above the minimum fit for review", () => {
    expect(settledStatus(70, 70)).toBe("review");
    expect(settledStatus(69, 70)).toBe("below_fit");
  });

  test("marks jobs the agent could not score", () => {
    expect(settledStatus(null, 70)).toBe("unscored");
  });
});

describe("rulesWhere", () => {
  test("looks back to the widest window, using first-seen time when a source has no date", () => {
    const where = windowWhere(rules({ postedWithin: [30, 1440] }), "u1", now);
    expect(JSON.stringify(where)).toContain(minutesAgo(1440).toISOString());
    expect(JSON.stringify(where)).toContain("firstSeenAt");
  });

  test("matches any picked place, and leaves remote work to the work mode", () => {
    const where = JSON.stringify(
      rulesWhere(
        rules({ locations: ["Canada", "Toronto, Ontario, Canada"], workModes: ["remote"] }),
        "u1",
        now,
      ),
    );
    expect(where).toContain('"has":"CA"');
    expect(where).toContain('"contains":"Toronto"');
    expect(where).toContain('"workMode":{"in":["remote"]}');
    expect(where).not.toContain('"remote":true');
  });

  test("never returns a listing the user already applied to", () => {
    expect(JSON.stringify(rulesWhere(rules(), "u1", now))).toContain(
      '"applications":{"none":{"userId":"u1"}}',
    );
  });
});
