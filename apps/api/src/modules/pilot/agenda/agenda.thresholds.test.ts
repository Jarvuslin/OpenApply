import { serviceWithRec } from "./fakes";
import { describe, expect, it } from "bun:test";

describe("AgendaService minimum score precedence", () => {
  for (const campaignMinimum of [undefined, 0, 80]) {
    it(`uses campaign ${campaignMinimum ?? "inheritance"} consistently for promotion and scoring`, async () => {
      const config = campaignMinimum === undefined ? {} : { minScore: campaignMinimum };
      const campaign = {
        campaignId: "c1",
        query: "Entry software Toronto",
        config,
        _count: { jobs: 1 },
        jobs: [{ key: "j1", url: "https://example.test/job", title: "Engineer" }],
      };
      const { svc, rec } = serviceWithRec({
        profileMinimum: 20,
        instructionsConfig: { minScore: 70 },
        scorePendingCampaigns: [campaign],
        scoredPendingJobs: [
          {
            campaignId: "c1",
            key: "j1",
            matchScore: 35,
            campaign: { config, source: "auto_apply" },
          },
        ],
      });
      const agenda = await svc.refresh("p1");
      const expected = campaignMinimum ?? 20;
      expect(rec.promoteScoredJobs[0]?.[3]).toEqual([
        { key: "j1", matchScore: 35, threshold: expected },
      ]);
      expect(
        agenda.items.find((item) => item.kind === "campaign.scorePending")?.payload,
      ).toMatchObject({ minScore: expected });
    });
  }

  it("inherits profile20 for new Pilot searches unless an explicit Pilot override is saved", async () => {
    for (const pilotMinimum of [undefined, 0, 70]) {
      const { svc } = serviceWithRec({
        profileMinimum: 20,
        instructionsConfig: pilotMinimum === undefined ? {} : { minScore: pilotMinimum },
        instructionsGoals: "Entry software Toronto",
      });
      const agenda = await svc.refresh("p1");
      expect(
        agenda.items.find((item) => item.kind === "strategy.bootstrap")?.payload,
      ).toMatchObject({ minScore: pilotMinimum ?? 20 });
    }
  });
});
