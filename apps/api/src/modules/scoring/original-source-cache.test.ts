import { createHash } from "node:crypto";
import { OriginalSourceCache } from "./original-source-cache";
import { describe, expect, test } from "bun:test";

const original = "Built Python reporting tools and maintained SQL data validation scripts.";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

describe("original resume extraction cache", () => {
  test("100 unchanged reads perform 100 file reads but only one extraction", async () => {
    let reads = 0;
    let parses = 0;
    const cache = new OriginalSourceCache(
      async () => {
        reads++;
        return Buffer.from(original);
      },
      async (bytes) => {
        parses++;
        return bytes.toString();
      },
    );
    for (let index = 0; index < 100; index++)
      expect(await cache.read("owned.txt")).toEqual({ text: original, sha256: hash(original) });
    expect({ reads, parses }).toEqual({ reads: 100, parses: 1 });
  });

  test("20 concurrent byte-identical sources share one in-flight extraction", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let reads = 0;
    let parses = 0;
    const cache = new OriginalSourceCache(
      async () => {
        reads++;
        return Buffer.from(original);
      },
      async (bytes) => {
        parses++;
        started.resolve();
        await release.promise;
        return bytes.toString();
      },
    );
    const requests = Array.from({ length: 20 }, (_, index) => cache.read(`owned-${index}.txt`));
    await started.promise;
    expect({ reads, parses }).toEqual({ reads: 20, parses: 1 });
    release.resolve();
    const results = await Promise.all(requests);
    expect(results.every((result) => result.text === original)).toBe(true);
    results[0].text = "Caller changed its own response";
    expect((await cache.read("owned.txt")).text).toBe(original);
    expect(parses).toBe(1);
  });

  test("changed bytes at the same filename invalidate text and hash", async () => {
    let source = original;
    let parses = 0;
    const cache = new OriginalSourceCache(
      async () => Buffer.from(source),
      async (bytes) => {
        parses++;
        return bytes.toString();
      },
    );
    await cache.read("owned.txt");
    source = `${original}\nUsed TypeScript for a separate project.`;
    expect(await cache.read("owned.txt")).toEqual({ text: source, sha256: hash(source) });
    expect(parses).toBe(2);
  });

  test("the normalized extension is part of the key, not the filename", async () => {
    const extensions: string[] = [];
    const cache = new OriginalSourceCache(
      async () => Buffer.from(original),
      async (_bytes, extension) => {
        extensions.push(extension);
        return `${original} ${extension}`;
      },
    );
    expect((await cache.read("owned.TXT")).text).toEndWith(".txt");
    await cache.read("identical.txt");
    expect((await cache.read("different.docx")).text).toEndWith(".docx");
    expect(extensions).toEqual([".txt", ".docx"]);
  });

  test("a cached extraction cannot hide a missing or unreadable current file", async () => {
    let available = true;
    let parses = 0;
    const cache = new OriginalSourceCache(
      async () => {
        if (!available) throw new Error("Source deleted");
        return Buffer.from(original);
      },
      async (bytes) => {
        parses++;
        return bytes.toString();
      },
    );
    await cache.read("owned.txt");
    available = false;
    await expect(cache.read("owned.txt")).rejects.toThrow("Source deleted");
    expect(parses).toBe(1);
  });

  test("failed concurrent extraction is evicted and an explicit later read can recover", async () => {
    const release = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    let parses = 0;
    const cache = new OriginalSourceCache(
      async () => Buffer.from(original),
      async () => {
        parses++;
        if (parses === 1) {
          started.resolve();
          await release.promise;
          throw new Error("Parser failed");
        }
        return original;
      },
    );
    const requests = Promise.allSettled(Array.from({ length: 12 }, () => cache.read("owned.pdf")));
    await started.promise;
    release.resolve();
    expect((await requests).every((result) => result.status === "rejected")).toBe(true);
    expect(parses).toBe(1);
    expect((await cache.read("owned.pdf")).text).toBe(original);
    expect(parses).toBe(2);
  });

  test("unreadable short text is not retained", async () => {
    let parses = 0;
    const cache = new OriginalSourceCache(
      async () => Buffer.from("bytes"),
      async () => {
        parses++;
        return "Too short";
      },
    );
    for (let index = 0; index < 2; index++)
      await expect(cache.read("owned.pdf")).rejects.toThrow("no readable text");
    expect(parses).toBe(2);
  });

  test("entry limits evict the least recently read completed text", async () => {
    const parsed: string[] = [];
    const cache = new OriginalSourceCache(
      async (filename) => Buffer.from(filename),
      async (bytes) => {
        parsed.push(bytes.toString());
        return `${original} ${bytes}`;
      },
      { maxEntries: 2, maxTextBytes: 1024 },
    );
    for (const name of ["a.txt", "b.txt", "a.txt", "c.txt", "b.txt"]) await cache.read(name);
    expect(parsed).toEqual(["a.txt", "b.txt", "c.txt", "b.txt"]);
  });

  test("aggregate text size counts UTF-8 bytes and evicts completed text", async () => {
    const parsed: string[] = [];
    const cache = new OriginalSourceCache(
      async (filename) => Buffer.from(filename),
      async (bytes) => {
        parsed.push(bytes.toString());
        return "é".repeat(80);
      },
      { maxEntries: 10, maxTextBytes: 200 },
    );
    for (const name of ["a.txt", "b.txt", "b.txt", "a.txt"]) await cache.read(name);
    expect(parsed).toEqual(["a.txt", "b.txt", "a.txt"]);
  });

  test("oversized valid text is returned in full without retaining it or displacing warm text", async () => {
    const parsed: string[] = [];
    const cache = new OriginalSourceCache(
      async (filename) => Buffer.from(filename),
      async (bytes) => {
        parsed.push(bytes.toString());
        return bytes.toString() === "large.txt" ? "é".repeat(80) : "a".repeat(40);
      },
      { maxEntries: 4, maxTextBytes: 100 },
    );
    await cache.read("small.txt");
    for (let index = 0; index < 2; index++)
      expect((await cache.read("large.txt")).text).toBe("é".repeat(80));
    await cache.read("small.txt");
    expect(parsed).toEqual(["small.txt", "large.txt", "large.txt"]);
  });

  test("pending entries stay bounded without evicting an existing single flight", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const parsed: string[] = [];
    const cache = new OriginalSourceCache(
      async (filename) => Buffer.from(filename),
      async (bytes) => {
        parsed.push(bytes.toString());
        if (parsed.length === 2) started.resolve();
        if (bytes.toString() !== "c.txt") await release.promise;
        return `${original} ${bytes}`;
      },
      { maxEntries: 2, maxTextBytes: 1024 },
    );
    const first = cache.read("a.txt");
    const second = cache.read("b.txt");
    await started.promise;
    const shared = cache.read("a.txt");
    await cache.read("c.txt");
    await cache.read("c.txt");
    expect(parsed).toEqual(["a.txt", "b.txt", "c.txt", "c.txt"]);
    release.resolve();
    await Promise.all([first, second, shared]);
    await cache.read("a.txt");
    expect(parsed.filter((name) => name === "a.txt")).toHaveLength(1);
  });
});
