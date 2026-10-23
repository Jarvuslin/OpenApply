import path from "node:path";
import {
  applicationSubmissionRecordSchema,
  type SubmittedResume,
} from "@openapply/contracts/submission";
import { singleton } from "tsyringe";
import { conflict, findOwned, notFound } from "@/common/errors";
import { slugifyForDownload, streamFile } from "@/common/storage/storage";
import { env } from "@/env";
import { PrismaClient } from "@/generated/prisma/client";
import { saveSubmissionPdf, submissionPdfPath, verifySubmissionPdf } from "./submission-files";

const SUBMISSIONS_ROOT = path.resolve(env.STORAGE_ROOT, "application-submissions");

@singleton()
export class SubmissionService {
  constructor(private readonly prisma: PrismaClient) {}

  async uploadResume(userId: string, campaignId: string, key: string, file: File) {
    const job = await findOwned(
      (where) => this.prisma.job.findFirst({ where, select: { id: true, status: true } }),
      { campaignId, key, campaign: { userId } },
      "Campaign job",
    );
    if (job.status !== "applying")
      throw conflict("Only an applying job can retain its submitted PDF");
    return saveSubmissionPdf(SUBMISSIONS_ROOT, userId, job.id, file);
  }

  verifyResume(userId: string, jobId: string, resume: SubmittedResume) {
    return verifySubmissionPdf(SUBMISSIONS_ROOT, userId, jobId, resume);
  }

  async checkpointPdf(userId: string, resume: SubmittedResume) {
    await this.verifyResume(userId, resume.jobId, resume);
    return streamFile(
      submissionPdfPath(SUBMISSIONS_ROOT, userId, resume),
      "application/pdf",
      `${slugifyForDownload(path.basename(resume.filename, path.extname(resume.filename)))}.pdf`,
    );
  }

  async resumePdf(userId: string, id: string, sha256?: string) {
    const application = await findOwned(
      (where) => this.prisma.application.findFirst({ where, select: { submission: true } }),
      { id, userId },
      "Application",
    );
    const submission = applicationSubmissionRecordSchema.safeParse(application.submission);
    if (!submission.success) throw notFound("No submitted PDF was retained for this application");
    const snapshots = [submission.data, ...submission.data.previous];
    const selected = sha256
      ? snapshots.find((snapshot) => snapshot.resume.sha256 === sha256)
      : submission.data;
    if (!selected) throw notFound("Submitted PDF does not belong to this application");
    const { resume } = selected;
    await this.verifyResume(userId, resume.jobId, resume);
    return streamFile(
      submissionPdfPath(SUBMISSIONS_ROOT, userId, resume),
      "application/pdf",
      `${slugifyForDownload(path.basename(resume.filename, path.extname(resume.filename)))}.pdf`,
    );
  }
}
