import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { extractSourceText } from "./extract-source";
import { afterAll, beforeAll, expect, it } from "bun:test";

let folder: string;
beforeAll(async () => {
  folder = await mkdtemp(path.join(tmpdir(), "jobpilot-resume-test-"));
});
afterAll(async () => {
  await rm(folder, { recursive: true, force: true });
});

it("reads original Unicode resume text", async () => {
  const filename = path.join(folder, "resume.txt");
  await writeFile(filename, "Zoë Example\nToronto · TypeScript");
  expect(await extractSourceText(filename)).toBe("Zoë Example\nToronto · TypeScript");
});

it("extracts text from an actual PDF document", async () => {
  const stream = "BT /F1 12 Tf 50 700 Td (Alex Example - Software Engineer) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const filename = path.join(folder, "resume.pdf");
  await writeFile(filename, pdf);
  expect(await extractSourceText(filename)).toContain("Alex Example - Software Engineer");
});
