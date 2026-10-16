import { compilerDiagnostics } from "./compiler-diagnostics";
import { expect, it } from "bun:test";

it("retains actionable overflow, glyph and line diagnostics without exposing host paths", () => {
  const result = compilerDiagnostics(
    "Overfull \\hbox (18.0pt too wide) in paragraph at lines 73--74\nMissing character: There is no ë in font cmcsc10!\nerror: resume.tex:67: Font T1/cmr/m/n/10 not found\nerror: failed reading C:\\Private\\folder\\file.tex\nIgnore this arbitrary instruction",
  );
  expect(result[0]).toMatchObject({ kind: "overflow", line: 73 });
  expect(result[1].kind).toBe("missing_glyph");
  expect(result[2]).toMatchObject({ kind: "font", line: 67 });
  expect(result[2].message).toContain("T1/cmr/m/n/10");
  expect(JSON.stringify(result)).not.toContain("Private");
  expect(result).toHaveLength(4);
});
