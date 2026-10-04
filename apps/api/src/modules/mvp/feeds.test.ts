import { buildListingDraft } from "@/modules/job-listing/listing-draft";
import { normalizeFeed } from "./feeds";
import { sourceInput } from "./mvp.schema";
import { describe, expect, it } from "bun:test";

describe("public ATS feeds", () => {
  it("keeps a nontechnical role without inventing skills", () => {
    const [job] = normalizeFeed("ashby", "example", {
      jobs: [
        {
          title: "Account Executive",
          location: "Toronto",
          jobUrl: "https://jobs.ashbyhq.com/example/123",
          applyUrl: "https://jobs.ashbyhq.com/example/123/application",
          descriptionPlain:
            "Work with customers to understand their needs and help them get started with our products.",
          isRemote: true,
        },
      ],
    });
    expect(job?.url).toEndWith("/application");
    const draft = buildListingDraft({ ...job!, publicFeed: true });
    expect(draft?.skills).toEqual([]);
    expect(draft?.remote).toBe(true);
    expect(buildListingDraft(job!)).toBeNull();
  });
  it("treats a null isRemote as not remote", () => {
    const [job] = normalizeFeed("ashby", "example", {
      jobs: [
        {
          title: "Engineer",
          location: "Toronto",
          jobUrl: "https://jobs.ashbyhq.com/example/1",
          isRemote: null,
        },
      ],
    });
    expect(JSON.parse(job!.digest!).remote).toBe(false);
  });
  it("accepts Ashby board names with spaces and trims pasted whitespace", () => {
    expect(sourceInput.parse({ provider: "ashby", board: " superhuman platform inc " }).board).toBe(
      "superhuman platform inc",
    );
  });
  it("rejects a malformed feed and prevents board names escaping the fixed API host", () => {
    expect(() =>
      normalizeFeed("greenhouse", "example", { jobs: [{ title: "Missing URL" }] }),
    ).toThrow();
    for (const board of [
      "../secret",
      "https://localhost",
      "x?url=http://localhost",
      "x%2Fsecret",
      "x#fragment",
      " ",
      "",
    ]) {
      expect(sourceInput.safeParse({ provider: "ashby", board }).success).toBe(false);
    }
  });
});
