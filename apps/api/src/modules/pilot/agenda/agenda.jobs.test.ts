import { approvedJob, hasKind, service } from "./fakes";
import { describe, expect, it } from "bun:test";

describe("AgendaService warm intros", () => {
  const insider = {
    id: "ct1",
    name: "Insider",
    title: "Staff Eng",
    email: "in@acme.test",
    company: "Acme, Inc.",
  };

  it("matches contacts by normalized company onto both the apply and the intro", async () => {
    const agenda = await service({
      approvedJobs: [approvedJob({ matchScore: 90, company: "Acme" })],
      contacts: [insider],
    }).refresh("p1");
    const apply = agenda.items.find((i) => i.kind === "job.apply");
    const intro = agenda.items.find((i) => i.kind === "networking.warmIntro");
    expect(apply?.payload).toMatchObject({ warmContacts: [{ id: "ct1" }] });
    expect(intro?.payload).toMatchObject({ contacts: [{ id: "ct1" }] });
  });

  it("leaves a job below the score floor out of the pool", async () => {
    const agenda = await service({
      approvedJobs: [approvedJob({ matchScore: 79 })],
      contacts: [insider],
    }).refresh("p1");
    expect(hasKind(agenda, "networking.warmIntro")).toBe(false);
  });

  it("keeps a recent strong apply in the pool", async () => {
    const agenda = await service({
      recentAppliedJobs: [approvedJob({ matchScore: 90, key: "done1" })],
    }).refresh("p1");
    const intro = agenda.items.find((i) => i.kind === "networking.warmIntro");
    expect(intro?.subjectId).toBe("c1:done1");
  });

  it("drops an introduced job from the pool but keeps its contacts on the apply", async () => {
    const agenda = await service({
      approvedJobs: [approvedJob({ matchScore: 90, key: "j1" })],
      warmIntroClaims: [
        { subjectId: "c1:j1", grantedAt: new Date(), releasedAt: new Date(), outcome: "done" },
      ],
      contacts: [insider],
    }).refresh("p1");
    expect(hasKind(agenda, "networking.warmIntro")).toBe(false);
    const apply = agenda.items.find((i) => i.kind === "job.apply");
    expect(apply?.payload).toMatchObject({ warmContacts: [{ id: "ct1" }] });
  });
});

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
