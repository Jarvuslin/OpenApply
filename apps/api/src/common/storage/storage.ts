import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { slugify } from "@/common/utils/slug";
import { env } from "@/env";

const STORAGE_ROOT = path.resolve(env.STORAGE_ROOT);
const RESUMES_DIR = path.join(STORAGE_ROOT, "resumes");
const SCREENSHOTS_DIR = path.join(STORAGE_ROOT, "submission-screenshots");
const TRANSCRIPTS_DIR = path.join(STORAGE_ROOT, "transcripts");

export function resumePath(filename: string): string {
  return path.join(RESUMES_DIR, filename);
}

/** Unlinks a file, treating an already-missing file as success. Returns whether it removed anything. */
async function tryUnlink(filePath: string): Promise<boolean> {
  try {
    await unlink(filePath);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw e;
  }
}

export async function deleteResumeFile(filename: string): Promise<void> {
  await tryUnlink(resumePath(filename));
}

/** Writes an uploaded resume under a fresh name and returns that name. */
export async function saveResumeSource(file: File): Promise<string> {
  const ext = path.extname(file.name) || ".pdf";
  const slug = slugify(path.basename(file.name, ext), { fallback: "resume" });
  const filename = `${slug}-${randomUUID()}${ext}`;
  await mkdir(RESUMES_DIR, { recursive: true });
  await writeFile(resumePath(filename), Buffer.from(await file.arrayBuffer()), { flag: "wx" });
  return filename;
}

/** Streams a file inline. Rejects when the file is missing. */
export async function streamFile(
  filePath: string,
  mime: string,
  downloadName: string,
): Promise<Response> {
  const stats = await stat(filePath);
  return new Response(createReadStream(filePath) as unknown as ReadableStream, {
    headers: {
      "content-type": mime,
      "content-length": String(stats.size),
      "content-disposition": `inline; filename="${downloadName}"`,
    },
  });
}

export function slugifyForDownload(label: string): string {
  return slugify(label, { fallback: "resume" });
}

export interface CachePruneResult {
  scanned: number;
  removed: number;
  freedBytes: number;
  remainingBytes: number;
}

/**
 * Evicts files idle longer than `ttlMs`, then, if the survivors still exceed `maxBytes`, evicts
 * coldest (oldest mtime) first until under the cap. A `ttlMs`/`maxBytes` of 0 disables that stage.
 */
interface CachePruneOptions {
  ttlMs: number;
  maxBytes: number;
}

export function pruneSubmissionScreenshots(opts: CachePruneOptions): Promise<CachePruneResult> {
  return pruneDirectory(SCREENSHOTS_DIR, opts);
}

async function pruneDirectory(dir: string, opts: CachePruneOptions): Promise<CachePruneResult> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { scanned: 0, removed: 0, freedBytes: 0, remainingBytes: 0 };
    }
    throw e;
  }

  const files: { path: string; size: number; mtimeMs: number }[] = [];
  await Promise.all(
    names.map(async (name) => {
      const filePath = path.join(dir, name);
      try {
        const s = await stat(filePath);
        if (s.isFile()) {
          files.push({ path: filePath, size: s.size, mtimeMs: s.mtimeMs });
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
          throw e;
        }
      }
    }),
  );

  const now = Date.now();
  let removed = 0;
  let freedBytes = 0;
  const survivors: typeof files = [];

  // 1. TTL eviction - drop files untouched for longer than ttlMs.
  for (const f of files) {
    if (opts.ttlMs > 0 && now - f.mtimeMs > opts.ttlMs) {
      if (await tryUnlink(f.path)) {
        removed++;
        freedBytes += f.size;
      }
    } else {
      survivors.push(f);
    }
  }

  // 2. Size-cap eviction - coldest first until the survivors fit in maxBytes.
  let remainingBytes = survivors.reduce((n, f) => n + f.size, 0);
  if (opts.maxBytes > 0 && remainingBytes > opts.maxBytes) {
    survivors.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const f of survivors) {
      if (remainingBytes <= opts.maxBytes) {
        break;
      }
      if (await tryUnlink(f.path)) {
        removed++;
        freedBytes += f.size;
        remainingBytes -= f.size;
      }
    }
  }

  return { scanned: files.length, removed, freedBytes, remainingBytes };
}

/** One screenshot per work item, named by its id, so a resend replaces the old one. */
export function submissionScreenshotPath(workItemId: string): string {
  return path.join(SCREENSHOTS_DIR, `${workItemId}.png`);
}

export async function saveSubmissionScreenshot(workItemId: string, bytes: Buffer): Promise<void> {
  await mkdir(SCREENSHOTS_DIR, { recursive: true });
  await writeFile(submissionScreenshotPath(workItemId), bytes);
}

export async function hasSubmissionScreenshot(workItemId: string): Promise<boolean> {
  try {
    return (await stat(submissionScreenshotPath(workItemId))).isFile();
  } catch {
    return false;
  }
}

export async function deleteSubmissionScreenshot(workItemId: string): Promise<void> {
  await tryUnlink(submissionScreenshotPath(workItemId));
}

export function transcriptPath(filename: string): string {
  return path.join(TRANSCRIPTS_DIR, filename);
}

/** Writes the profile transcript under a fresh name and returns that name. */
export async function saveTranscript(userId: string, bytes: Buffer): Promise<string> {
  const filename = `${userId}-${randomUUID()}.pdf`;
  await mkdir(TRANSCRIPTS_DIR, { recursive: true });
  await writeFile(transcriptPath(filename), bytes, { flag: "wx" });
  return filename;
}

export async function deleteTranscriptFile(filename: string): Promise<void> {
  await tryUnlink(transcriptPath(filename));
}
