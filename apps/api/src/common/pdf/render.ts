import type { ResumeData } from "@openapply/contracts/resume";
import { renderToBuffer } from "@react-pdf/renderer";
import { createElement } from "react";
import { buildResumeTex, RESUME_TEMPLATE } from "./canonical-template";
import { CoverLetterTemplate } from "./cover-letter-template";
import { compileResumeTex, type LatexCompilerOptions } from "./latex-compiler";
import { type ResumePdfValidation, validateResumePdf } from "./resume-validation";

export interface ResumeCompileArtifact {
  pdf: Buffer;
  tex: string;
  template: typeof RESUME_TEMPLATE;
  compiler: { name: "tectonic"; version: string };
  validation: ResumePdfValidation;
}

export async function renderResumeArtifact(
  data: ResumeData,
  options?: LatexCompilerOptions,
): Promise<ResumeCompileArtifact> {
  const { tex, expectedText } = buildResumeTex(data);
  const { pdf, version, warnings } = await compileResumeTex(tex, options);
  const validation = await validateResumePdf(pdf, expectedText, warnings);
  return {
    pdf,
    tex,
    template: RESUME_TEMPLATE,
    compiler: { name: "tectonic", version },
    validation,
  };
}

export async function renderCoverLetterPdf(text: string): Promise<Buffer> {
  const element = createElement(CoverLetterTemplate, { text });
  // @ts-expect-error - @react-pdf's Document typing is loose at the element seam.
  return renderToBuffer(element);
}
