import { hasKind, service } from "./fakes";
import { describe, expect, it } from "bun:test";

describe("AgendaService board.health", () => {
  // Newest-first apply outcomes for one board.
  const failed = (key: string) => ({
    campaignId: "c1",
    key,
    url: `https://x/${key}`,
    board: "linkedin",
    status: "failed",
    failReason: "captcha wall",
  });
  const applied = (key: string) => ({ ...failed(key), status: "applied", failReason: null });

  it("flags a board whose latest three applies failed, probing the newest failure", async () => {
    const agenda = await service({
      boardHealthJobs: [failed("a"), failed("b"), failed("c"), applied("d")],
    }).refresh("p1");
    const item = agenda.items.find((i) => i.kind === "board.health");
    expect(item?.payload).toEqual({
      board: "linkedin",
      consecutiveFailures: 3,
      recentFailReasons: ["captcha wall", "captcha wall", "captcha wall"],
      probeJob: { campaignId: "c1", jobKey: "a", url: "https://x/a" },
    });
  });

  it("does not flag a board whose streak a recent success broke", async () => {
    const agenda = await service({
      boardHealthJobs: [failed("a"), failed("b"), applied("c"), failed("d")],
    }).refresh("p1");
    expect(hasKind(agenda, "board.health")).toBe(false);
  });
});
