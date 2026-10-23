import type { ReactElement } from "react";
import { Chip, Stack } from "@mui/material";
import { JOB_LEVEL_LABELS } from "@openapply/contracts/job-listing";
import {
  NO_EXPERIENCE_LABEL,
  yearsLabel,
} from "@/components/features/experience/experience-labels";
import { yearsValue } from "./discover-filters";
import type { DiscoverFilters } from "./job-board-types";

interface ActiveFiltersProps {
  filters: DiscoverFilters;
  onChange: (filters: DiscoverFilters) => void;
}

export function ActiveFilters(props: ActiveFiltersProps): ReactElement {
  const { filters, onChange } = props;
  const chips: { key: string; label: string; remove: () => void }[] = [];
  for (const key of [
    "titles",
    "locations",
    "levels",
    "countries",
    "workModes",
    "employmentTypes",
    "companies",
    "excludeCompanies",
    "excludeTitles",
  ] as const) {
    for (const value of filters[key]) {
      let label: string = value;
      if (key === "levels") label = JOB_LEVEL_LABELS[value as DiscoverFilters["levels"][number]];
      if (key === "countries") label = value === "CA" ? "Canada" : "United States";
      if (key === "employmentTypes") label = value.replaceAll("_", " ");
      if (key === "companies") label = `Company: ${value}`;
      if (key === "excludeCompanies") label = `Exclude company: ${value}`;
      if (key === "excludeTitles") label = `Exclude title: ${value}`;
      chips.push({
        key: `${key}-${value}`,
        label,
        remove: () =>
          onChange({ ...filters, [key]: filters[key].filter((item) => item !== value) }),
      });
    }
  }
  for (const key of ["posted", "discovered"] as const) {
    const range = filters[`${key}Range`];
    if (range === "all") continue;
    const prefix = key === "posted" ? "Posted" : "Added";
    let label = `${prefix}: past ${range} days`;
    if (range === "1") label = `${prefix}: past 24 hours`;
    if (range === "custom")
      label = `${prefix}: ${filters[`${key}From`] || "any date"} to ${filters[`${key}To`] || "today"}`;
    chips.push({
      key,
      label,
      remove: () =>
        onChange({ ...filters, [`${key}Range`]: "all", [`${key}From`]: "", [`${key}To`]: "" }),
    });
  }
  if (filters.activity !== "all") {
    const labels = { applied: "Applied", not_applied: "Not applied yet", saved: "Saved jobs" };
    chips.push({
      key: "activity",
      label: labels[filters.activity],
      remove: () => onChange({ ...filters, activity: "all" }),
    });
  }
  if (filters.noExperience)
    chips.push({
      key: "noExperience",
      label: NO_EXPERIENCE_LABEL,
      remove: () => onChange({ ...filters, noExperience: false }),
    });
  if (filters.minYears || filters.maxYears)
    chips.push({
      key: "experience",
      label: `Experience: ${yearsLabel(yearsValue(filters.minYears), yearsValue(filters.maxYears))}`,
      remove: () => onChange({ ...filters, minYears: "", maxYears: "" }),
    });
  if (filters.salaryMin || filters.salaryMax)
    chips.push({
      key: "salary",
      label: `${filters.salaryCurrency} ${filters.salaryMin || "0"}–${filters.salaryMax || "any"} / ${filters.salaryPeriod}`,
      remove: () => onChange({ ...filters, salaryMin: "", salaryMax: "" }),
    });
  if (filters.includeUnknownLevel && filters.levels.length)
    chips.push({
      key: "unknown-level",
      label: "Includes unspecified levels",
      remove: () => onChange({ ...filters, includeUnknownLevel: false }),
    });
  return (
    <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.75 }}>
      {chips.map(({ key, label, remove }) => (
        <Chip key={key} size="small" label={label} onDelete={remove} />
      ))}
    </Stack>
  );
}
