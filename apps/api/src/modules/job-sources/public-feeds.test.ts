import { publicFeed } from "./public-feeds";
import { expect, it } from "bun:test";

const noJson = async () => {
  throw new Error("Unexpected JSON request");
};

it("imports Remote OK jobs with source attribution, dates and no fabricated location eligibility or salary currency", async () => {
  const jobs = await publicFeed(async (url) => {
    expect(url).toBe("https://remoteok.com/api");
    return [
      { legal: "Attribute Remote OK", last_updated: 1000 },
      {
        position: "Software &amp; AI Engineer",
        company_logo: "https://cdn.example.com/acme.png",
        company: "Acme",
        url: "https://remoteOK.com/remote-jobs/acme-1",
        apply_url: "https://acme.test/careers/1",
        epoch: 1700000000,
        description: "<p>Build tools</p>",
        salary_min: 100000,
        salary_max: 150000,
      },
      { position: "Duplicate", company: "Acme", url: "https://remoteok.com/remote-jobs/acme-1" },
      { position: "Unsafe", company: "Other", url: "javascript:alert(1)" },
      { position: "Offsite", company: "Other", url: "https://example.test/remote-jobs/1" },
    ];
  }, "remoteok");
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({
    title: "Software & AI Engineer",
    workMode: "remote",
    description: "Build tools",
    url: "https://remoteok.com/remote-jobs/acme-1",
    attributionUrl: "https://remoteok.com/remote-jobs/acme-1",
  });
  expect(jobs[0]?.postedAt?.toISOString()).toBe("2023-11-14T22:13:20.000Z");
  expect(jobs[0]?.countries).toBeUndefined();
  expect(jobs[0]?.salary).toBeUndefined();
  expect(jobs[0]?.companyLogoUrl).toBe("https://cdn.example.com/acme.png");
});

it("rejects malformed JSON feed shapes and propagates source outages", async () => {
  await expect(publicFeed(async () => ({}), "remoteok")).rejects.toThrow();
  await expect(
    publicFeed(async () => {
      throw new Error("HTTP 503");
    }, "remoteok"),
  ).rejects.toThrow("HTTP 503");
  expect(await publicFeed(async () => [], "remoteok")).toEqual([]);
});

it("reads WWR CDATA and encoded HTML while retaining its required board link and explicit publication date", async () => {
  const jobs = await publicFeed(noJson, "weworkremotely", async (url) => {
    expect(url).toBe("https://weworkremotely.com/remote-jobs.rss");
    return `<rss><channel><item>
      <title><![CDATA[Acme &amp; Co: Senior Engineer: Payments]]></title>
      <media:content url="https://cdn.example.com/acme.png?size=200&amp;v=1" type="image/png"/>
      <region>USA Only</region><country>United States</country><type>Full-Time</type>
      <description>&lt;p&gt;Build &amp;amp; maintain tools&lt;/p&gt;</description>
      <link>https://weworkremotely.com/remote-jobs/acme-senior</link>
      <pubDate>Wed, 07 Oct 2026 21:47:34 +0000</pubDate>
    </item><item><title>Acme: Unsafe</title><link>https://example.test/job</link></item>
    <item><title>Acme: Expired</title><link>https://weworkremotely.com/remote-jobs/expired</link><expires_at>Wed, 07 Oct 2020 21:47:34 +0000</expires_at></item>
    </channel></rss>`;
  });
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({
    title: "Senior Engineer: Payments",
    company: "Acme & Co",
    location: "USA Only",
    type: "Full-Time",
    description: "Build & maintain tools",
    workMode: "remote",
  });
  expect(jobs[0]?.url).toBe(jobs[0]?.attributionUrl);
  expect(jobs[0]?.companyLogoUrl).toBe("https://cdn.example.com/acme.png?size=200&v=1");
  expect(jobs[0]?.postedAt?.toISOString()).toBe("2026-10-07T21:47:34.000Z");
});

it("accepts empty RSS and rejects source challenge pages or truncated RSS", async () => {
  expect(
    await publicFeed(noJson, "weworkremotely", async () => "<rss><channel></channel></rss>"),
  ).toEqual([]);
  await expect(
    publicFeed(noJson, "weworkremotely", async () => "<html>Challenge</html>"),
  ).rejects.toThrow("invalid RSS");
  await expect(publicFeed(noJson, "weworkremotely", async () => "<rss><channel>")).rejects.toThrow(
    "invalid RSS",
  );
});

it("finds the newest official HN hiring thread and ignores seekers, replies, deleted rows and malformed posts", async () => {
  const data: Record<string, unknown> = {
    "user/whoishiring": { submitted: [12, 11, 10] },
    "item/12": {
      id: 12,
      type: "story",
      by: "whoishiring",
      title: "Ask HN: Who wants to be hired? (October 2026)",
      time: 200,
      kids: [999],
    },
    "item/11": {
      id: 11,
      type: "story",
      by: "whoishiring",
      title: "Ask HN: Who is hiring? (October 2026)",
      time: 200,
      kids: [21, 22, 23, 24, 25],
    },
    "item/10": {
      id: 10,
      type: "story",
      by: "whoishiring",
      title: "Ask HN: Who is hiring? (September 2026)",
      time: 100,
      kids: [998],
    },
    "item/21": {
      id: 21,
      parent: 11,
      type: "comment",
      time: 201,
      text: 'Acme (YC W25) | Software Engineer | Remote (US) | Full-Time<p>Build tools. <a href="https://acme.test/careers">Apply</a>',
    },
    "item/22": {
      id: 22,
      parent: 11,
      type: "comment",
      time: 202,
      text: "Other | Backend Developer | Toronto | ONSITE (hybrid)<p>Details",
    },
    "item/23": { id: 23, parent: 21, type: "comment", text: "Acme | Engineer | Remote" },
    "item/24": {
      id: 24,
      parent: 11,
      type: "comment",
      deleted: true,
      text: "Deleted | Engineer | Remote",
    },
    "item/25": { id: 25, parent: 11, type: "comment", text: "Is this still available?" },
  };
  const jobs = await publicFeed(async (url) => {
    const key = url.replace("https://hacker-news.firebaseio.com/v0/", "").replace(".json", "");
    expect(data).toHaveProperty(key);
    return data[key];
  }, "hackernews");
  expect(jobs).toHaveLength(2);
  expect(jobs[0]).toMatchObject({
    title: "Backend Developer",
    company: "Other",
    workMode: "hybrid",
  });
  expect(jobs[1]).toMatchObject({
    title: "Software Engineer",
    company: "Acme",
    location: "Remote (US)",
    workMode: "remote",
    url: "https://news.ycombinator.com/item?id=21",
  });
  expect(jobs[1]?.postedAt?.getTime()).toBe(201000);
  expect(jobs[1]?.description).toContain("Build tools.");
});

it("fails clearly if HN provides no hiring thread and bounds the comment window newest first", async () => {
  await expect(
    publicFeed(async (url) => (url.includes("/user/") ? { submitted: [] } : null), "hackernews"),
  ).rejects.toThrow("current hiring thread");
  const fetched: number[] = [];
  await publicFeed(async (url) => {
    if (url.includes("/user/")) return { submitted: [1] };
    if (url.endsWith("/1.json"))
      return {
        id: 1,
        type: "story",
        by: "whoishiring",
        title: "Ask HN: Who is hiring? (October 2026)",
        kids: Array.from({ length: 510 }, (_, index) => index + 2),
      };
    const id = Number(/\/item\/(\d+)\.json/.exec(url)?.[1]);
    fetched.push(id);
    return null;
  }, "hackernews");
  expect(fetched).toHaveLength(500);
  expect(Math.min(...fetched)).toBe(12);
  expect(Math.max(...fetched)).toBe(511);
});

it("imports HN's official job stories without pretending they represent all YC jobs", async () => {
  const jobs = await publicFeed(async (url) => {
    if (url.endsWith("jobstories.json")) return [101, 102, 103];
    if (url.endsWith("101.json"))
      return {
        id: 101,
        type: "job",
        title: "Acme (YC W25) Is Hiring an Engineer",
        time: 300,
        url: "https://acme.test/careers",
      };
    if (url.endsWith("102.json")) return { id: 102, type: "job", title: "A job", deleted: true };
    return { id: 103, type: "story", title: "Not a job" };
  }, "hackernews-jobs");
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({
    company: "Acme",
    url: "https://news.ycombinator.com/item?id=101",
  });
});
