import { EMPTY_RESUME_DATA, type ResumeData } from "@openapply/contracts/resume";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { dateRange } from "./jake/parts";
import { renderResumePdf } from "./render";
import { describe, expect, it } from "bun:test";

async function readPdf(data: ResumeData) {
  const task = getDocument({
    data: new Uint8Array(await renderResumePdf(data)),
    useSystemFonts: true,
  });
  const document = await task.promise;
  try {
    return await Promise.all(
      Array.from({ length: document.numPages }, async (_, index) => {
        const page = await document.getPage(index + 1);
        const content = await page.getTextContent();
        const items = content.items.flatMap((item) =>
          "str" in item && item.str.trim()
            ? [{ text: item.str, y: item.transform[5], height: item.height }]
            : [],
        );
        const annotations = await page.getAnnotations();
        return {
          items,
          text: items.map((item) => item.text).join(" "),
          urls: annotations.map((annotation) => annotation.url),
        };
      }),
    );
  } finally {
    await task.destroy();
  }
}

function withBullets(bullets: string[], summary = ""): ResumeData {
  return {
    ...EMPTY_RESUME_DATA,
    basics: { name: "Synthetic Applicant" },
    summary,
    experience: [
      {
        company: "Synthetic Employer",
        title: "Synthetic Role",
        start: "2020",
        end: "2021",
        bullets,
      },
    ],
  };
}

describe("resume PDF dates", () => {
  it.each([
    [undefined, undefined, ""],
    [" 2020 ", undefined, "2020"],
    ["2020", " ", "2020"],
    [undefined, "2024", "2024"],
    ["2020", "Present", "2020 – Present"],
    ["2020", "2024", "2020 – 2024"],
  ])("prints only known dates (%s, %s)", (start, end, expected) => {
    expect(dateRange(start, end)).toBe(expected);
  });

  it("does not add ongoing status to a dated certification and preserves its verification link", async () => {
    const pages = await readPdf({
      ...EMPTY_RESUME_DATA,
      basics: { name: "Synthetic Applicant" },
      certifications: [
        {
          name: "Example Certification",
          issued: "2020",
          url: "https://example.com/credentials/123",
        },
      ],
    });
    const text = pages.map((page) => page.text).join(" ");
    expect(text).toContain("2020");
    expect(text).not.toContain("Present");
    expect(text).toContain("example.com/credentials/123");
    expect(pages.flatMap((page) => page.urls)).toContain("https://example.com/credentials/123");
  });
});

describe("resume PDF pagination", () => {
  it("flows a long experience entry across pages without squeezing or losing bullets", async () => {
    const bullets = Array.from(
      { length: 70 },
      (_, index) => `PROBEBULLET${index} ${"sample content ".repeat(10)}`,
    );
    const pages = await readPdf(withBullets(bullets));
    expect(pages.length).toBeGreaterThan(1);
    const text = pages.map((page) => page.text).join(" ");
    expect([...text.matchAll(/PROBEBULLET\d+/g)].map((match) => match[0])).toEqual(
      bullets.map((_, index) => `PROBEBULLET${index}`),
    );
    for (const page of pages) {
      const starts = page.items.filter((item) => item.text.includes("PROBEBULLET"));
      for (let index = 1; index < starts.length; index++) {
        expect(starts[index - 1].y - starts[index].y).toBeGreaterThan(20);
      }
      for (const item of page.items) {
        expect(item.y).toBeGreaterThanOrEqual(36);
        expect(item.y).toBeLessThanOrEqual(756);
      }
    }
  });

  it("can split a single oversized bullet instead of overflowing the page", async () => {
    const pages = await readPdf(
      withBullets([`LONGSTART ${"sample content ".repeat(500)} LONGEND`]),
    );
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0].text).toContain("LONGSTART");
    expect(pages.at(-1)?.text).toContain("LONGEND");
    for (const page of pages) {
      for (const item of page.items) {
        expect(item.y).toBeGreaterThanOrEqual(36);
        expect(item.y).toBeLessThanOrEqual(756);
      }
    }
  });

  it.each([40, 42, 44, 46])(
    "keeps section and entry headings with their first content after %i lines",
    async (lines) => {
      const summary = Array.from({ length: lines }, (_, index) => `Summary line ${index}`).join(
        "\n",
      );
      const pages = await readPdf(withBullets(["FIRSTBULLET demonstrates the work."], summary));
      const section = pages.findIndex((page) => page.text.includes("EXPERIENCE"));
      const entry = pages.findIndex((page) => page.text.includes("Synthetic Employer"));
      const bullet = pages.findIndex((page) => page.text.includes("FIRSTBULLET"));
      expect(section).toBeGreaterThanOrEqual(0);
      expect(entry).toBe(section);
      expect(bullet).toBe(entry);
    },
  );
});
