import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { unprocessable } from "@/common/errors";

export interface ResumePdfValidation {
  valid: true;
  pageCount: 1;
  pageSize: { width: 612; height: 792 };
  fontFamilies: string[];
  textVerified: true;
  boundsVerified: true;
  warnings: string[];
}

function normalized(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/\s/g, "");
}

interface PdfFont {
  name: string;
  missingFile: boolean;
  data?: Uint8Array;
}

export async function validateResumePdf(
  pdf: Buffer,
  expectedText: string[],
  warnings: string[] = [],
): Promise<ResumePdfValidation> {
  const task = getDocument({
    data: new Uint8Array(pdf),
    useSystemFonts: false,
    disableFontFace: true,
    fontExtraProperties: true,
  });
  try {
    const document = await task.promise;
    if (document.numPages !== 1)
      throw unprocessable(
        `Resume uses ${document.numPages} pages. Review content to fit one page; nothing was shrunk or dropped.`,
        { pageCount: document.numPages },
      );
    const page = await document.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    if (Math.abs(viewport.width - 612) > 0.01 || Math.abs(viewport.height - 792) > 0.01)
      throw unprocessable("Resume PDF does not use the required US Letter page size.");
    await page.getOperatorList();
    const content = await page.getTextContent();
    const items = content.items.flatMap((item) => ("str" in item && item.str.trim() ? [item] : []));
    const extracted = normalized(items.map((item) => item.str).join(" "));
    if (!items.length || extracted.includes("\ufffd") || extracted.includes("\0"))
      throw unprocessable("Resume PDF text is missing or unreadable.");
    const expectedCounts = new Map<string, number>();
    for (const value of expectedText) {
      const key = normalized(value);
      if (key) expectedCounts.set(key, (expectedCounts.get(key) ?? 0) + 1);
    }
    for (const [value, count] of expectedCounts) {
      if (extracted.split(value).length - 1 < count)
        throw unprocessable(
          "Resume PDF lost or changed text during compilation; no artifact was accepted.",
          { check: "text", missing: value.slice(0, 100) },
        );
    }
    const families = new Set<string>();
    for (const item of items) {
      const font = page.commonObjs.get(item.fontName) as PdfFont;
      const family = font.name.replace(/^[A-Z]{6}\+/, "");
      const computerModernSymbol = family === "SFRM1000" && /^[\s_~^\\]+$/.test(item.str);
      if (
        (!/^(CMR10|CMBX10|CMTI10|CMCSC10|CMSY10|CMSY6)$/.test(family) && !computerModernSymbol) ||
        font.missingFile ||
        !font.data?.length
      )
        throw unprocessable(
          "Resume PDF does not contain the required embedded Computer Modern fonts.",
          { font: family },
        );
      families.add(family);
      const size = Math.hypot(item.transform[2], item.transform[3]);
      if (![5.978, 9.963, 11.955, 24.787].some((allowed) => Math.abs(allowed - size) < 0.02))
        throw unprocessable("Resume PDF changed the template font sizes.");
      const x = item.transform[4];
      const y = item.transform[5];
      if (
        Math.abs(item.transform[1]) > 0.01 ||
        Math.abs(item.transform[2]) > 0.01 ||
        x < 35.5 ||
        x + item.width > 576.5 ||
        y - size * 0.25 < 0 ||
        y + size > 792
      )
        throw unprocessable(
          "Resume PDF text exceeds the template bounds; shorten the affected content rather than changing the layout.",
        );
    }
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      for (const b of items.slice(i + 1)) {
        const xOverlap =
          Math.min(a.transform[4] + a.width, b.transform[4] + b.width) -
          Math.max(a.transform[4], b.transform[4]);
        const yGap = Math.abs(a.transform[5] - b.transform[5]);
        if (xOverlap > 1 && yGap < Math.min(a.height, b.height) * 0.65)
          throw unprocessable(
            "Resume PDF contains overlapping text; review long headings or content.",
          );
      }
    }
    return {
      valid: true,
      pageCount: 1,
      pageSize: { width: 612, height: 792 },
      fontFamilies: [...families].sort(),
      textVerified: true,
      boundsVerified: true,
      warnings,
    };
  } finally {
    await task.destroy();
  }
}
