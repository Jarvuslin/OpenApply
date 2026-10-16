const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Year and month from "Sep 2023", "September 2023", "09/2023" or "2023-09". */
function parseMonth(text: string): { year: number; month: number } | null {
  const value = text.trim();
  const named = /^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{4})$/.exec(value);
  if (named) {
    const month = MONTHS.findIndex((name) => name.toLowerCase() === named[1].toLowerCase());
    return month < 0 ? null : { year: Number(named[2]), month };
  }
  const slash = /^(\d{1,2})\/(\d{4})$/.exec(value);
  if (slash && Number(slash[1]) >= 1 && Number(slash[1]) <= 12)
    return { year: Number(slash[2]), month: Number(slash[1]) - 1 };
  const iso = /^(\d{4})-(\d{2})$/.exec(value);
  if (iso && Number(iso[2]) >= 1 && Number(iso[2]) <= 12)
    return { year: Number(iso[1]), month: Number(iso[2]) - 1 };
  return null;
}

/** The value a month input shows; null when the saved text is not a single month. */
export function toMonthInput(text: string): string | null {
  if (!text.trim()) return "";
  const parsed = parseMonth(text);
  return parsed ? `${parsed.year}-${String(parsed.month + 1).padStart(2, "0")}` : null;
}

/** "2023-09" from a month input back to the stored "Sep 2023"; other text is kept as typed. */
export function fromMonthInput(value: string): string {
  const parsed = /^\d{4}-\d{2}$/.test(value) ? parseMonth(value) : null;
  return parsed ? `${MONTHS[parsed.month]} ${parsed.year}` : value.trim();
}

/** "2 yrs 2 mos" between two saved dates, counting both end months; a blank end is today. */
export function durationLabel(start: string, end: string): string | null {
  const now = new Date();
  const year = (text: string) => /^(\d{4})$/.exec(text.trim());
  const index = (text: string, fallbackMonth: number) => {
    const parsed = parseMonth(text);
    if (parsed) return parsed.year * 12 + parsed.month;
    const bare = year(text);
    return bare ? Number(bare[1]) * 12 + fallbackMonth : null;
  };
  const from = index(start, 0);
  const to = end.trim() ? index(end, 11) : now.getFullYear() * 12 + now.getMonth();
  if (from === null || to === null || to < from) return null;
  const months = to - from + 1;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [
    years && `${years} ${years === 1 ? "yr" : "yrs"}`,
    rest && `${rest} ${rest === 1 ? "mo" : "mos"}`,
  ].filter(Boolean);
  return parts.join(" ") || null;
}
