import { JOB_LEVEL_LABELS } from "@openapply/contracts/job-listing";
import type { PilotRules } from "@openapply/contracts/pilots";
import {
  NO_EXPERIENCE_LABEL,
  yearsLabel,
} from "@/components/features/experience/experience-labels";

export const ROLE_SUGGESTIONS = [
  "Software engineer",
  "AI engineer",
  "ML engineer",
  "Backend",
  "Frontend",
  "Full stack",
  "Data engineer",
];

export const LEVEL_OPTIONS = (["intern", "entry", "mid", "senior", "lead"] as const).map(
  (value) => ({ value, label: JOB_LEVEL_LABELS[value] }),
);

/** Levels and years asked for, like "No prior experience required, Entry · Up to 2 years". */
export function experienceLabel(rules: PilotRules): string {
  const levels = [
    ...(rules.noExperience ? [NO_EXPERIENCE_LABEL] : []),
    ...rules.levels.map((level) => JOB_LEVEL_LABELS[level]),
  ];
  const years =
    rules.minYears === null && rules.maxYears === null
      ? ""
      : yearsLabel(rules.minYears, rules.maxYears);
  return [levels.join(", "), years].filter(Boolean).join(" · ") || "Any level";
}

export const COMPANY_TYPE_OPTIONS = [
  { value: "startup", label: "Startup" },
  { value: "scale_up", label: "Scale-up" },
  { value: "enterprise", label: "Enterprise" },
  { value: "agency", label: "Agency" },
] as const;

export const WORK_MODE_OPTIONS = [
  { value: "remote", label: "Remote" },
  { value: "hybrid", label: "Hybrid" },
  { value: "onsite", label: "On-site" },
] as const;

export const WINDOW_OPTIONS = [
  { value: 30, label: "Last 30 min", short: "30 min" },
  { value: 60, label: "Last hour", short: "1 h" },
  { value: 360, label: "Last 6 hours", short: "6 h" },
  { value: 1440, label: "Last 24 hours", short: "24 h" },
  { value: 4320, label: "Last 3 days", short: "3 days" },
] as const;

export const INTERVAL_OPTIONS = [
  { value: 2, label: "Always on" },
  { value: 10, label: "Every 10 min" },
  { value: 30, label: "Every 30 min" },
  { value: 60, label: "Every hour" },
  { value: 360, label: "Every 6 hours" },
  { value: 1440, label: "Daily" },
] as const;

export function intervalLabel(minutes: number): string {
  return (
    INTERVAL_OPTIONS.find((option) => option.value === minutes)?.label ?? `Every ${minutes} min`
  );
}

export function windowLabel(minutes: number | null): string {
  if (minutes === null) return "Posted any time";
  const label = WINDOW_OPTIONS.find((option) => option.value === minutes)?.label;
  return `Posted in the ${(label ?? `last ${minutes} min`).toLowerCase()}`;
}

function labelsOf<T extends string>(values: T[], options: readonly { value: T; label: string }[]) {
  return values.map((value) => options.find((option) => option.value === value)?.label ?? value);
}

/** One readable chip per rule, in the order the wizard asks for them. */
export function ruleChips(rules: PilotRules, minScore: number): string[] {
  const chips = [
    ...rules.roles,
    ...labelsOf(rules.companyTypes, COMPANY_TYPE_OPTIONS),
    labelsOf(rules.workModes, WORK_MODE_OPTIONS).join(", "),
    ...rules.locations,
    `${minScore}%+ fit`,
    rules.postedWithin.length
      ? `Posted in ${rules.postedWithin
          .map((value) => WINDOW_OPTIONS.find((option) => option.value === value)?.short)
          .join(", ")}`
      : "Posted any time",
  ];
  return chips.filter(Boolean);
}

/** The line under a pilot's name: where, which experience, which companies, how good a fit. */
export function ruleSubtitle(rules: PilotRules, minScore: number): string {
  return [
    rules.locations.join(", ") || "Anywhere",
    experienceLabel(rules),
    labelsOf(rules.companyTypes, COMPANY_TYPE_OPTIONS).join(", "),
    `${minScore}%+ fit`,
  ]
    .filter(Boolean)
    .join(" • ");
}
