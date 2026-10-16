import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SubmittedResume } from "@openapply/contracts/submission";
import { submittedResumeSchema } from "@openapply/contracts/submission";
import { sha256 } from "@/common/crypto/hash";
import { badRequest, notFound, unprocessable } from "@/common/errors";

const MAX_PDF_BYTES = 5 * 1024 * 1024;

export function submissionPdfPath(root: string, userId: string, resume: SubmittedResume): string {
  const checked = submittedResumeSchema.parse(resume);
  return path.join(root, userId, checked.jobId, `${checked.sha256}.pdf`);
}

export async function saveSubmissionPdf(
  root: string,
  userId: string,
  jobId: string,
  file: File,
): Promise<SubmittedResume> {
  if (file.size === 0 || file.size > MAX_PDF_BYTES)
    throw badRequest("PDF must be between 1 byte and 5 MB");
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.subarray(0, 5).toString() !== "%PDF-") throw badRequest("Uploaded file must be a PDF");
  const parsed = submittedResumeSchema.safeParse({
    jobId,
    sha256: sha256(bytes),
    filename: file.name,
  });
  if (!parsed.success) throw badRequest("PDF filename is invalid");
  const resume = parsed.data;
  const filePath = submissionPdfPath(root, userId, resume);
  await mkdir(path.dirname(filePath), { recursive: true });
  try {
    // Content-addressed files are never overwritten, including on repeated uploads.
    await writeFile(filePath, bytes, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    await verifySubmissionPdf(root, userId, jobId, resume);
  }
  return resume;
}

export async function verifySubmissionPdf(
  root: string,
  userId: string,
  jobId: string,
  resume: SubmittedResume,
): Promise<void> {
  if (resume.jobId !== jobId) throw unprocessable("Submitted PDF belongs to a different job");
  let bytes: Buffer;
  try {
    bytes = await readFile(submissionPdfPath(root, userId, resume));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw notFound("Submitted PDF has not been uploaded for this job");
    throw error;
  }
  if (sha256(bytes) !== resume.sha256) {
    throw unprocessable("Submitted PDF hash does not match the retained file");
  }
}
