import type { ResumeData } from "@openapply/contracts/resume";

export interface FieldChange {
  /** Where the change is, e.g. "Summary" or "EmTech Care Labs - bullet 2". */
  where: string;
  before: string;
  after: string;
}

function label(key: string): string {
  const words = key.replace(/([a-z])([A-Z])/g, "$1 $2");
  return words.charAt(0).toUpperCase() + words.slice(1);
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
/** Include every content field so review cannot hide changed facts or removed entries. */
export function diffRewrite(base: ResumeData, suggested: ResumeData): FieldChange[] {
  const changes: FieldChange[] = [];
  function compare(before: unknown, after: unknown, path: string[]): void {
    if (Array.isArray(before) || Array.isArray(after)) {
      const from = Array.isArray(before) ? before : [];
      const to = Array.isArray(after) ? after : [];
      for (let i = 0; i < Math.max(from.length, to.length); i++) {
        compare(from[i], to[i], [...path, String(i + 1)]);
      }
      return;
    }
    if (
      (before !== null && typeof before === "object") ||
      (after !== null && typeof after === "object")
    ) {
      const from = record(before);
      const to = record(after);
      for (const key of new Set([...Object.keys(from), ...Object.keys(to)])) {
        if (key !== "id") compare(from[key], to[key], [...path, label(key)]);
      }
      return;
    }
    const from = before == null ? "" : String(before);
    const to = after == null ? "" : String(after);
    if (from !== to) changes.push({ where: path.join(" · "), before: from, after: to });
  }
  compare(base, suggested, []);
  return changes;
}
