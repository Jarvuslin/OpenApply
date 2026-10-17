import { recruitee } from "./recruitee";
import { expect, it } from "bun:test";

it("reads every published offer with its countries and UTC posting time", async () => {
  const { jobs, complete } = await recruitee(
    async (url) => {
      expect(url).toBe("https://huaweicanada.recruitee.com/api/offers/");
      return {
        offers: [
          {
            id: 2782295,
            slug: "researcher",
            title: "Researcher &amp; Strategist",
            company_name: "Huawei Technologies Canada Co., Ltd.",
            description: "<p>Build things.</p>",
            requirements: "<p>Know things.</p>",
            location: "Markham, Ontario, Canada",
            country_code: "CA",
            locations: [{ country_code: "CA" }, { country_code: "US" }],
            published_at: "2026-10-15 17:57:27 UTC",
            hybrid: true,
          },
        ],
      };
    },
    "huaweicanada",
    "Huawei Canada",
  );
  expect(complete).toBe(true);
  expect(jobs).toEqual([
    {
      title: "Researcher & Strategist",
      company: "Huawei Canada",
      location: "Markham, Ontario, Canada",
      countries: ["CA", "US"],
      url: "https://huaweicanada.recruitee.com/o/researcher",
      attributionUrl: "https://huaweicanada.recruitee.com/o/researcher",
      externalId: "2782295",
      description: "Build things.\n\nKnow things.",
      postedAt: new Date("2026-10-15T17:57:27Z"),
      workMode: "hybrid",
    },
  ]);
});

it("refuses a slug that isn't a company subdomain", async () => {
  await expect(recruitee(async () => ({}), "evil.example")).rejects.toThrow("Invalid Recruitee");
});
