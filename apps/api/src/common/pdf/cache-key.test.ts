import { resumePdfCacheKey } from "./cache-key";
import { expect, it } from "bun:test";

it.each(["master", "variant"] as const)(
  "invalidates legacy %s PDFs while retaining the document deletion prefix",
  (kind) => {
    const filename = resumePdfCacheKey(kind, "document-id", 1000);
    expect(filename).not.toBe(`${kind}-document-id-1000.pdf`);
    expect(filename).toStartWith(`${kind}-document-id-`);
    expect(filename).toMatch(/-v\d+\.pdf$/);
    expect(resumePdfCacheKey(kind, "document-id", 1001)).not.toBe(filename);
  },
);
