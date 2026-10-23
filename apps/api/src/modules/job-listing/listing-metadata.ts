import type {
  JOB_EMPLOYMENT_TYPES,
  JOB_SALARY_PERIODS,
  JOB_WORK_MODES,
} from "@openapply/contracts/job-listing";

type SalaryPeriod = (typeof JOB_SALARY_PERIODS)[number];
type WorkMode = (typeof JOB_WORK_MODES)[number];
type EmploymentKind = (typeof JOB_EMPLOYMENT_TYPES)[number];

interface NormalizedSalary {
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
}

const EMPTY_SALARY: NormalizedSalary = {
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  salaryPeriod: null,
};
const PERIOD_PATTERN =
  /(?:\bper\s+|\/\s*)?(?:annually|annual|yearly|years?|yrs?|hourly|hours?|hrs?|monthly|months?|mos?)\b/gi;
const CURRENCY_PATTERN = /\b(?:USD|CAD|AUD|NZD|EUR|GBP|INR|JPY|CHF)\b/gi;
const AMOUNT = "((?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d+)?\\s*[kK]?)";
const RANGE = new RegExp(`^\\s*${AMOUNT}(?:\\s*(?:-|–|—|to)\\s*${AMOUNT})?\\s*$`, "i");

/** Bare dollar signs and unstated pay periods remain unknown; they cannot safely be compared. */
export function normalizeListingSalary(value: string | null | undefined): NormalizedSalary {
  if (!value) return { ...EMPTY_SALARY };
  const text = value
    .replace(/US\$/gi, "USD ")
    .replace(/CA\$/gi, "CAD ")
    .replace(/AU\$|A\$/gi, "AUD ")
    .replace(/NZ\$/gi, "NZD ")
    .replace(/€/g, "EUR ")
    .replace(/£/g, "GBP ")
    .replace(/₹/g, "INR ");
  const currencies = [
    ...new Set((text.match(CURRENCY_PATTERN) ?? []).map((entry) => entry.toUpperCase())),
  ];
  const periods = new Set<SalaryPeriod>();
  if (/\b(?:annual|annually|yearly|years?|yrs?)\b/i.test(text)) periods.add("year");
  if (/\b(?:hourly|hours?|hrs?)\b/i.test(text)) periods.add("hour");
  if (/\b(?:monthly|months?|mos?)\b/i.test(text)) periods.add("month");
  if (currencies.length !== 1 || periods.size !== 1) return { ...EMPTY_SALARY };
  const match = text
    .replace(CURRENCY_PATTERN, "")
    .replace(PERIOD_PATTERN, "")
    .replace(/\$/g, "")
    .trim()
    .match(RANGE);
  if (!match?.[1]) return { ...EMPTY_SALARY };
  const amount = (part: string) =>
    Number(part.replace(/[,\sKk]/g, "")) * (/k/i.test(part) ? 1000 : 1);
  const min = amount(match[1]);
  const max = match[2] ? amount(match[2]) : min;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min < 0 || max < min || max > 1_000_000_000)
    return { ...EMPTY_SALARY };
  return {
    salaryMin: min,
    salaryMax: max,
    salaryCurrency: currencies[0] ?? null,
    salaryPeriod: [...periods][0] ?? null,
  };
}

export function listingEmploymentKind(value: string | null | undefined): EmploymentKind | null {
  const normalized = value?.toLowerCase().replace(/[\s_-]/g, "");
  if (normalized === "fulltime") return "full_time";
  if (normalized === "parttime") return "part_time";
  if (normalized === "contract" || normalized === "contractor") return "contract";
  if (normalized === "intern" || normalized === "internship") return "internship";
  if (normalized === "temporary" || normalized === "temp") return "temporary";
  return null;
}

export function listingWorkMode(
  location: string | null,
  remote: boolean,
  explicit?: WorkMode | null,
): WorkMode | null {
  if (explicit) return explicit;
  if (/\bhybrid\b/i.test(location ?? "")) return "hybrid";
  if (/\bon[\s-]?site\b/i.test(location ?? "")) return "onsite";
  if (remote || /\bremote\b/i.test(location ?? "")) return "remote";
  return null;
}
