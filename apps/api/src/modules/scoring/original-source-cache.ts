import path from "node:path";
import { sha256 as hashBytes } from "@/common/crypto/hash";

type Extraction = { promise: Promise<string>; textBytes: number | null };

export class OriginalSourceCache {
  private readonly entries = new Map<string, Extraction>();
  private textBytes = 0;

  constructor(
    private readonly readBytes: (filename: string) => Promise<Buffer>,
    private readonly extract: (bytes: Buffer, extension: string) => Promise<string>,
    private readonly limits = { maxEntries: 32, maxTextBytes: 2 * 1024 * 1024 },
  ) {
    if (!Number.isSafeInteger(limits.maxEntries) || limits.maxEntries < 1)
      throw new Error("Source cache must allow at least one entry.");
    if (!Number.isSafeInteger(limits.maxTextBytes) || limits.maxTextBytes < 1)
      throw new Error("Source cache must allow at least one text byte.");
  }

  async read(filename: string): Promise<{ text: string; sha256: string }> {
    // File reads and hashes are never cached: an unchanged filename does not prove unchanged bytes.
    const bytes = await this.readBytes(filename);
    const sha256 = hashBytes(bytes);
    const extension = path.extname(filename).toLowerCase();
    const key = `${sha256}:${extension}`;
    const existing = this.entries.get(key);
    if (existing) {
      this.entries.delete(key);
      this.entries.set(key, existing);
      return { text: await existing.promise, sha256 };
    }

    while (this.entries.size >= this.limits.maxEntries && this.evictOldestText()) {}
    // Pending entries are bounded too; overflow reads remain uncached without evicting an active flight.
    if (this.entries.size >= this.limits.maxEntries)
      return { text: await this.parse(bytes, extension), sha256 };

    const entry: Extraction = { promise: this.parse(bytes, extension), textBytes: null };
    this.entries.set(key, entry);
    try {
      const text = await entry.promise;
      entry.textBytes = Buffer.byteLength(text, "utf8");
      this.textBytes += entry.textBytes;
      if (entry.textBytes > this.limits.maxTextBytes) this.remove(key, entry);
      while (this.textBytes > this.limits.maxTextBytes && this.evictOldestText()) {}
      return { text, sha256 };
    } catch (error) {
      this.remove(key, entry);
      throw error;
    }
  }

  private async parse(bytes: Buffer, extension: string): Promise<string> {
    const text = await this.extract(bytes, extension);
    if (text.trim().length < 40) throw new Error("The original resume has no readable text.");
    return text;
  }

  private remove(key: string, entry: Extraction) {
    this.entries.delete(key);
    this.textBytes -= entry.textBytes ?? 0;
  }

  private evictOldestText(): boolean {
    for (const [key, entry] of this.entries) {
      if (entry.textBytes !== null) {
        this.remove(key, entry);
        return true;
      }
    }
    return false;
  }
}
