import { buildListingDraft } from "@/modules/job-listing/listing-draft";
import { ashby } from "./ashby";
import { expect, it } from "bun:test";

it("keeps explicit work mode, secondary countries, salary units and publication date", async () => {
  const jobs = await ashby(
    async () => ({
      jobs: [
        {
          title: "Software Engineer",
          location: "Toronto",
          jobUrl: "https://jobs.ashbyhq.com/acme/one",
          isRemote: true,
          workplaceType: "Hybrid",
          employmentType: "FullTime",
          publishedAt: "2026-10-01T00:00:00Z",
          address: { postalAddress: { addressCountry: "CAN" } },
          secondaryLocations: [{ location: "New York", address: { addressCountry: "USA" } }],
          compensation: {
            summaryComponents: [
              { compensationType: "EquityPercentage", minValue: 1, maxValue: 2, interval: "NONE" },
              {
                compensationType: "Salary",
                minValue: 100000,
                maxValue: 150000,
                currencyCode: "USD",
                interval: "1 YEAR",
              },
            ],
          },
        },
      ],
    }),
    "acme",
  );
  const job = jobs[0]!;
  expect(job.location).toBe("Toronto; New York");
  expect(job.countries).toEqual(["CAN", "USA"]);
  expect(job.workMode).toBe("hybrid");
  const draft = buildListingDraft({ ...job, publicFeed: true });
  expect(draft).toMatchObject({
    employmentKind: "full_time",
    salaryMin: 100000,
    salaryMax: 150000,
    salaryCurrency: "USD",
    salaryPeriod: "year",
    postedAt: new Date("2026-10-01"),
  });
});

it("omits unlisted jobs and never assumes a salary currency or period", async () => {
  const jobs = await ashby(
    async () => ({
      jobs: [
        {
          title: "Private job",
          location: "US",
          jobUrl: "https://jobs.ashbyhq.com/acme/private",
          isListed: false,
        },
        {
          title: "Engineer",
          location: "Remote",
          jobUrl: "https://jobs.ashbyhq.com/acme/public",
          compensation: { scrapeableCompensationSalarySummary: "$100K-$150K" },
        },
      ],
    }),
    "acme",
  );
  expect(jobs).toHaveLength(1);
  const draft = buildListingDraft({ ...jobs[0]!, publicFeed: true });
  expect(draft?.salary).toBe("$100K-$150K");
  expect(draft?.salaryCurrency).toBeNull();
  expect(draft?.salaryPeriod).toBeNull();
});
