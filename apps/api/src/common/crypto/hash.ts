import { createHash } from "node:crypto";

/** Hex SHA-256 of a string (as UTF-8) or raw bytes. */
export function sha256(value: string | NodeJS.ArrayBufferView): string {
  return createHash("sha256").update(value).digest("hex");
}
