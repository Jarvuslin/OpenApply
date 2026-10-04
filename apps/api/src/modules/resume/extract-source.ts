import { readFile } from "node:fs/promises";
import path from "node:path";
import mammoth from "mammoth";

export async function extractSourceText(filename: string): Promise<string> {
  const buffer = await readFile(filename);
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ buffer });
    return result.value.slice(0, 80_000);
  }
  if (ext === ".txt") return buffer.toString("utf8").slice(0, 80_000);
  if (ext !== ".pdf") throw new Error("Use a PDF, DOCX or plain text resume.");
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
  const document = await task.promise;
  try {
    if (document.numPages > 20) throw new Error("Please use a resume of 20 pages or fewer.");
    const pages: string[] = [];
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index);
      const text = await page.getTextContent();
      pages.push(
        text.items
          .map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : " ") : ""))
          .join(""),
      );
    }
    return pages.join("\n").slice(0, 80_000);
  } finally {
    await task.destroy();
  }
}
