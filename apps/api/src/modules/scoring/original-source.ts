import { readFile } from "node:fs/promises";
import { singleton } from "tsyringe";
import { unprocessable } from "@/common/errors";
import { resumePath } from "@/common/storage/storage";
import { extractSourceBuffer } from "@/modules/resume/extract-source";
import { OriginalSourceCache } from "./original-source-cache";

const cache = new OriginalSourceCache(
  (filename) => readFile(resumePath(filename)),
  extractSourceBuffer,
);

@singleton()
export class OriginalResumeSource {
  async read(filename: string): Promise<{ text: string; sha256: string }> {
    try {
      return await cache.read(filename);
    } catch (error) {
      throw unprocessable(
        `Cannot score the original resume: ${error instanceof Error ? error.message : "source unavailable"}`,
      );
    }
  }
}
