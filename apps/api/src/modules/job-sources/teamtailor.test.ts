import { teamtailor } from "./teamtailor";
import { expect, it } from "bun:test";

const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:tt="https://teamtailor.com/locations"><channel>
  <title>Swish Analytics</title><link>https://swishanalytics.na.teamtailor.com/jobs</link>
  <item>
    <title>Backend Engineer &amp; Analyst</title>
    <description>&lt;p&gt;Build the models.&lt;/p&gt;</description>
    <pubDate>Mon, 12 Oct 2026 15:00:09 -0700</pubDate>
    <link>https://swishanalytics.na.teamtailor.com/jobs/718582-backend-engineer</link>
    <remoteStatus>fully</remoteStatus>
    <tt:locations>
      <tt:location><tt:city>San Francisco</tt:city><tt:country>United States</tt:country></tt:location>
      <tt:location><tt:city>Toronto</tt:city><tt:country>Canada</tt:country></tt:location>
    </tt:locations>
  </item>
  <item>
    <title>A sister company's job</title>
    <link>https://othercompany.teamtailor.com/jobs/1-engineer</link>
  </item>
</channel></rss>`;

it("reads the board's own jobs from its RSS feed, with every place", async () => {
  const { jobs, complete } = await teamtailor(async (url) => {
    expect(url).toBe("https://swishanalytics.na.teamtailor.com/jobs.rss");
    return feed;
  }, "swishanalytics.na");
  expect(complete).toBe(true);
  expect(jobs).toEqual([
    {
      title: "Backend Engineer & Analyst",
      company: "Swish Analytics",
      location: "San Francisco, United States; Toronto, Canada",
      countries: ["United States", "Canada"],
      url: "https://swishanalytics.na.teamtailor.com/jobs/718582-backend-engineer",
      attributionUrl: "https://swishanalytics.na.teamtailor.com/jobs/718582-backend-engineer",
      externalId: "718582",
      description: "Build the models.",
      postedAt: new Date("2026-10-12T22:00:09Z"),
      workMode: "remote",
    },
  ]);
});

it("refuses a slug that isn't a board subdomain", async () => {
  await expect(teamtailor(async () => "", "evil.example.com")).rejects.toThrow(
    "Invalid Teamtailor",
  );
});
