import { formatDistanceToNowStrict } from "date-fns";
import { enUS } from "date-fns/locale/en-US";

const COMPACT_UNIT: Record<string, string> = {
  xSeconds: "s",
  xMinutes: "m",
  xHours: "h",
  xDays: "d",
  xMonths: "mo",
  xYears: "y",
};

/** Minimal date-fns locale rendering strict-distance tokens as compact units ("3h") instead of words ("3 hours"). */
const compactLocale = {
  ...enUS,
  formatDistance: (token: string, count: number) =>
    `${Math.max(1, count)}${COMPACT_UNIT[token] ?? ""}`,
};

/** `3 jobs` / `1 job`. Pass `pluralWord` for anything an `s` does not cover. */
export function plural(count: number, word: string, pluralWord?: string): string {
  if (count === 1) return `${count} ${word}`;
  return `${count} ${pluralWord ?? `${word}s`}`;
}

/** Compact age of a past timestamp, e.g. `12m`. Empty string for invalid dates. */
export function formatRelativeTime(value: string | Date): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : formatDistanceToNowStrict(date, { locale: compactLocale });
}

/** Human-readable date in the viewer's locale, e.g. `Jul 19, 2026`. Takes `Date | string` because Eden types `z.date()` fields as `Date`. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** Locale month + day for a timeline bucket. UTC-pinned: the bucket is UTC midnight, which localises to the previous day west of Greenwich. */
export function formatDayBucket(value: Date): string {
  if (Number.isNaN(value.getTime())) {
    return "";
  }
  return value.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// Constructing the formatter is the expensive half, and RelativeTime builds one per rendered row.
const absoluteTimeFormat = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  timeZoneName: "short",
});

/** Absolute local timestamp with timezone, e.g. `Jul 19, 2026, 6:34 PM GMT+5`. Component options only - `dateStyle` + `timeZoneName` throws. */
export function formatAbsoluteTime(value: string | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return absoluteTimeFormat.format(date);
}
