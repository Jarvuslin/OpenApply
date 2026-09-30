import { service } from "./fakes";
import { describe, expect, it } from "bun:test";

describe("AgendaService promotion cadence", () => {
  const instructionsConfig = { promotion: { platforms: [{ platform: "hn", postEveryDays: 30 }] } };
  const composes = (agenda: { items: { kind: string }[] }) =>
    agenda.items.some((i) => i.kind === "promo.compose");

  it("composes for a platform with no post yet, and not after a recent one", async () => {
    expect(composes(await service({ instructionsConfig }).refresh("p1"))).toBe(true);

    const recent = await service({
      instructionsConfig,
      platformPosts: [{ platform: "hn", createdAt: new Date() }],
    }).refresh("p1");
    expect(composes(recent)).toBe(false);
  });
});
