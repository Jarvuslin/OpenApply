import { readFile } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { dateRange } from "./canonical-template";
import { syntheticResume } from "./fakes";
import { renderResumeArtifact } from "./render";
import { validateResumePdf } from "./resume-validation";
import { describe, expect, it } from "bun:test";

it.each([
  [undefined, undefined, ""],
  [" 2020 ", undefined, "2020"],
  [undefined, "2024", "2024"],
  ["2020", "2024", "2020 – 2024"],
])("prints only known dates (%s, %s)", (start, end, expected) => {
  expect(dateRange(start, end)).toBe(expected);
});

describe("compiled PDF validation", () => {
  it("verifies actual page dimensions, embedded fonts and full text", async () => {
    const pdf = await readFile(new URL("./fixtures/canonical.pdf", import.meta.url));
    const validation = await validateResumePdf(pdf, [
      "Synthetic Applicant",
      "Structured outputs",
      "15%",
      "C#",
    ]);
    expect(validation.pageCount).toBe(1);
    expect(validation.fontFamilies).toContain("CMR10");
    expect(validation.textVerified).toBe(true);
  });

  it("rejects missing content rather than accepting a successful compiler exit", async () => {
    const pdf = await readFile(new URL("./fixtures/canonical.pdf", import.meta.url));
    await expect(validateResumePdf(pdf, ["A fact that is not in this document"])).rejects.toThrow(
      "lost or changed text",
    );
  });
});

const executable = process.env.OPENAPPLY_TEST_TECTONIC_PATH || Bun.which("tectonic");
const integration = executable ? describe : describe.skip;
integration("existing Tectonic integration (no compiler installation)", () => {
  it("renders the canonical one-page document and preserves dates, extras and safe links", async () => {
    const artifact = await renderResumeArtifact(syntheticResume(), {
      executable: executable ?? undefined,
      onlyCached: true,
    });
    expect(artifact.validation.pageCount).toBe(1);
    expect(artifact.compiler.version).toStartWith("Tectonic ");
    expect(artifact.template.sha256).toMatch(/^[a-f0-9]{64}$/);
    const task = getDocument({ data: new Uint8Array(artifact.pdf), useSystemFonts: false });
    try {
      const doc = await task.promise;
      const page = await doc.getPage(1);
      const text = await page.getTextContent();
      expect(text.items.map((item) => ("str" in item ? item.str : "")).join(" ")).not.toContain(
        "Present",
      );
      expect((await page.getAnnotations()).map((item) => item.url)).toContain(
        "https://example.com/certification",
      );
    } finally {
      await task.destroy();
    }
  }, 30_000);

  it("rejects multi-page content without dropping history or shrinking typography", async () => {
    const data = syntheticResume();
    data.experience[0].bullets = Array.from(
      { length: 50 },
      (_, i) => `Probe ${i}: ${"supported experience ".repeat(15)}`,
    );
    await expect(
      renderResumeArtifact(data, { executable: executable ?? undefined, onlyCached: true }),
    ).rejects.toThrow(/pages|overflow/i);
  }, 30_000);

  it("rejects overlapping long heading columns", async () => {
    const data = syntheticResume();
    data.experience[0].company = "Long employer heading ".repeat(15);
    await expect(
      renderResumeArtifact(data, { executable: executable ?? undefined, onlyCached: true }),
    ).rejects.toThrow(/overflow|bounds|overlap/i);
  }, 30_000);

  it("retains literal code symbols as extractable text", async () => {
    const data = syntheticResume();
    data.summary = String.raw`C# costs $5 at 15% & supports path_data {braces} ~ ^ C:\docs.`;
    const result = await renderResumeArtifact(data, {
      executable: executable ?? undefined,
      onlyCached: true,
    });
    expect(result.validation.textVerified).toBe(true);
    expect(result.validation.fontFamilies).toContain("SFRM1000");
  }, 30_000);

  it("reports unsupported name glyphs instead of losing accents silently", async () => {
    const data = syntheticResume();
    data.basics.name = "Zoë García";
    await expect(
      renderResumeArtifact(data, { executable: executable ?? undefined, onlyCached: true }),
    ).rejects.toMatchObject({
      details: {
        issues: expect.arrayContaining([expect.objectContaining({ kind: "missing_glyph" })]),
      },
    });
  }, 30_000);
});

it("fails closed when the configured compiler is missing", async () => {
  await expect(
    renderResumeArtifact(syntheticResume(), { executable: "/does-not-exist/tectonic" }),
  ).rejects.toThrow("unavailable");
});
