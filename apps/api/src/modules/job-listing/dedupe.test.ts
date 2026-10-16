import { canonicalizeUrl, dedupeKey, listingSlug, normalizeListingLocation } from "./dedupe";
import { describe, expect, it } from "bun:test";

const acme = { title: "Senior Software Engineer", company: "Acme Inc.", location: "New York, NY" };

describe("canonicalizeUrl", () => {
  it("preserves Greenhouse job identifiers while dropping its referral source", () => {
    const first = canonicalizeUrl(
      "https://www.mongodb.com/careers/jobs?gh_jid=100&gh_src=referral&utm_source=feed",
    );
    const second = canonicalizeUrl("https://www.mongodb.com/careers/jobs?gh_jid=200&gh_src=search");
    expect(first).toBe("https://mongodb.com/careers/jobs?gh_jid=100");
    expect(second).toBe("https://mongodb.com/careers/jobs?gh_jid=200");
    expect(first).not.toBe(second);
    expect(canonicalizeUrl("https://mongodb.com/careers/jobs?gh_jid=100&gh_src=other")).toBe(first);
  });
  it("strips tracking params, fragment, trailing slash and www", () => {
    expect(
      canonicalizeUrl(
        "https://WWW.Example.com/jobs/123/?utm_source=linkedin&gh_src=x&ref=abc#apply",
      ),
    ).toBe("https://example.com/jobs/123");
  });

  it("keeps params that identify the posting, in a stable order", () => {
    expect(canonicalizeUrl("https://example.com/j?id=9&currentJobId=7&utm_medium=email")).toBe(
      "https://example.com/j?currentJobId=7&id=9",
    );
  });

  it("collapses two links to the same posting onto one key", () => {
    const a = canonicalizeUrl("https://boards.example.com/acme/jobs/42?utm_campaign=spring");
    const b = canonicalizeUrl("https://boards.example.com/acme/jobs/42/#content");
    expect(a).toBe(b);
  });

  it("returns unparseable input untouched rather than throwing", () => {
    expect(canonicalizeUrl("  not a url  ")).toBe("not a url");
  });
});

describe("normalizeListingLocation", () => {
  it("maps remote-ish text onto one bucket", () => {
    for (const value of ["Remote", "Remote - US", "Anywhere", "Work From Home", "remote (WFH)"]) {
      expect(normalizeListingLocation(value)).toBe("remote");
    }
  });

  it("keeps only the city segment so suffixes don't split a posting", () => {
    expect(normalizeListingLocation("New York, NY, USA")).toBe("new york");
    expect(normalizeListingLocation("New York, NY")).toBe("new york");
  });

  it("treats a missing location as empty", () => {
    expect(normalizeListingLocation(null)).toBe("");
  });
});

describe("dedupeKey", () => {
  it("matches the same posting reposted on another board", () => {
    expect(dedupeKey(acme)).toBe(
      dedupeKey({
        title: "senior  software   engineer",
        company: "ACME, Inc",
        location: "New York, NY, USA",
      }),
    );
  });

  // The reason this module does not reuse scoring's `normalizeJobTitle`, which strips seniority.
  it("does NOT merge different seniorities at the same company", () => {
    expect(dedupeKey({ ...acme, title: "Senior Software Engineer" })).not.toBe(
      dedupeKey({ ...acme, title: "Junior Software Engineer" }),
    );
  });

  it("does not merge the same role opened in two cities", () => {
    expect(dedupeKey({ ...acme, location: "New York, NY" })).not.toBe(
      dedupeKey({ ...acme, location: "San Francisco, CA" }),
    );
  });

  it("separates a remote opening from an on-site one", () => {
    expect(dedupeKey({ ...acme, location: "Remote" })).not.toBe(dedupeKey(acme));
  });

  it("distinguishes companies", () => {
    expect(dedupeKey(acme)).not.toBe(dedupeKey({ ...acme, company: "Globex" }));
  });
});

describe("listingSlug", () => {
  it("is kebab-cased, human-readable and key-suffixed", () => {
    expect(listingSlug(acme)).toBe(
      `senior-software-engineer-at-acme-inc-${dedupeKey(acme).slice(0, 6)}`,
    );
  });

  it("is stable across re-scrapes of the same posting", () => {
    expect(listingSlug(acme)).toBe(
      listingSlug({
        title: "Senior Software Engineer",
        company: "Acme Inc.",
        location: "New York, NY, USA",
      }),
    );
  });

  it("survives a title that is entirely punctuation", () => {
    const slug = listingSlug({ title: "!!!", company: "Acme" });
    expect(slug.startsWith("at-acme-")).toBe(true);
  });
});
