import { questionAnswerValuesSchema } from "@openapply/contracts/application-question";

function canonicalValues(value: unknown): string | null {
  const parsed = questionAnswerValuesSchema.safeParse(value);
  if (!parsed.success) return null;
  const keys = new Set<string>();
  for (const entry of parsed.data) {
    if (keys.has(entry.fieldKey)) return null;
    keys.add(entry.fieldKey);
    if (Array.isArray(entry.value) && new Set(entry.value).size !== entry.value.length) return null;
  }
  return JSON.stringify(
    parsed.data
      .sort((a, b) => (a.fieldKey < b.fieldKey ? -1 : Number(a.fieldKey > b.fieldKey)))
      .map((entry) => ({
        fieldKey: entry.fieldKey,
        value: Array.isArray(entry.value) ? [...entry.value].sort() : entry.value,
      })),
  );
}

// JSONB key order and checkbox selection order do not change a typed answer.
export function sameAnswerValues(first: unknown, second: unknown): boolean {
  const left = canonicalValues(first);
  return left !== null && left === canonicalValues(second);
}
