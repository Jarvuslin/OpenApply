import { singleton } from "tsyringe";
import { badRequest, notFound } from "@/common/errors";
import {
  deleteTranscriptFile,
  saveTranscript,
  streamFile,
  transcriptPath,
} from "@/common/storage/storage";
import { PrismaClient } from "@/generated/prisma/client";

const MAX_TRANSCRIPT_BYTES = 10 * 1024 * 1024;

/** The profile's one unofficial transcript, uploaded by the person and attached by the agent. */
@singleton()
export class TranscriptService {
  constructor(private readonly prisma: PrismaClient) {}

  async upload(userId: string, file: File) {
    if (file.size > MAX_TRANSCRIPT_BYTES) throw badRequest("Transcript must be 10 MB or less.");
    const bytes = Buffer.from(await file.arrayBuffer());
    if (bytes.subarray(0, 5).toString("latin1") !== "%PDF-")
      throw badRequest("Upload the transcript as a PDF.");
    const filename = await saveTranscript(userId, bytes);
    // The name is echoed in a download header, so only plain characters survive.
    const originalName = file.name.replace(/[^\w.\- ]/g, "_").slice(0, 200) || "transcript.pdf";
    const previous = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { transcriptFilename: true },
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: { transcriptFilename: filename, transcriptOriginalName: originalName },
    });
    if (previous.transcriptFilename) await deleteTranscriptFile(previous.transcriptFilename);
    return { transcriptOriginalName: originalName };
  }

  async download(userId: string): Promise<Response> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { transcriptFilename: true, transcriptOriginalName: true },
    });
    if (!user.transcriptFilename) throw notFound("No transcript is saved.");
    try {
      return await streamFile(
        transcriptPath(user.transcriptFilename),
        "application/pdf",
        user.transcriptOriginalName ?? "transcript.pdf",
      );
    } catch {
      throw notFound("No transcript is saved.");
    }
  }

  async remove(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { transcriptFilename: true },
    });
    await this.prisma.user.update({
      where: { id: userId },
      data: { transcriptFilename: null, transcriptOriginalName: null },
    });
    if (user.transcriptFilename) await deleteTranscriptFile(user.transcriptFilename);
    return { ok: true as const };
  }
}
