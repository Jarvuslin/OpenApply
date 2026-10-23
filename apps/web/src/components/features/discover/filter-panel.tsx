"use client";

import type { ReactElement } from "react";
import { ExpandMore, RestartAlt, Tune } from "@mui/icons-material";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Divider,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { JOB_LEVEL_LABELS, JOB_LEVELS } from "@openapply/contracts/job-listing";
import { SALARY_CURRENCIES } from "@openapply/contracts/user";
import { NO_EXPERIENCE_LABEL } from "@/components/features/experience/experience-labels";
import { YearsRangeSlider } from "@/components/features/experience/years-range-slider";
import { LocationPicker } from "@/components/features/locations/location-picker";
import { DateFilter } from "./date-filter";
import { yearsValue } from "./discover-filters";
import type { DiscoverFilters } from "./job-board-types";

interface FilterPanelProps {
  filters: DiscoverFilters;
  onChange: (filters: DiscoverFilters) => void;
  onReset: () => void;
  loading?: boolean;
  profileDefaultsAvailable?: boolean;
}

interface CheckboxGroupProps<T extends string> {
  label: string;
  options: readonly { value: T; label: string }[];
  values: T[];
  onChange: (values: T[]) => void;
}

// A checkbox value for the noExperience flag, listed among the levels it widens.
const NO_EXPERIENCE = "no_experience";
const LEVEL_OPTIONS = JOB_LEVELS.map((value) => ({ value, label: JOB_LEVEL_LABELS[value] }));
const WORK_MODES = [
  { value: "remote", label: "Remote" },
  { value: "hybrid", label: "Hybrid" },
  { value: "onsite", label: "Onsite" },
] as const;
const EMPLOYMENT_TYPES = [
  { value: "full_time", label: "Full-time" },
  { value: "part_time", label: "Part-time" },
  { value: "contract", label: "Contract" },
  { value: "internship", label: "Internship" },
  { value: "temporary", label: "Temporary" },
] as const;

function CheckboxGroup<T extends string>(props: CheckboxGroupProps<T>): ReactElement {
  const { label, options, values, onChange } = props;
  return (
    <FormControl component="fieldset" variant="standard">
      <FormLabel
        component="legend"
        sx={{ typography: "body2Strong", color: "text.primary", mb: 1 }}
      >
        {label}
      </FormLabel>
      <FormGroup>
        {options.map((option) => (
          <FormControlLabel
            key={option.value}
            sx={{ ml: -0.5, mr: 0, "& .MuiFormControlLabel-label": { typography: "body2" } }}
            control={
              <Checkbox
                size="small"
                checked={values.includes(option.value)}
                onChange={(_, checked) =>
                  onChange(
                    checked
                      ? [...values, option.value]
                      : values.filter((value) => value !== option.value),
                  )
                }
                sx={{ p: 0.5, mr: 0.5 }}
              />
            }
            label={option.label}
          />
        ))}
      </FormGroup>
    </FormControl>
  );
}

export function FilterPanel(props: FilterPanelProps): ReactElement {
  const { filters, onChange, onReset, loading = false, profileDefaultsAvailable = true } = props;
  const invalidRange =
    filters.salaryMin !== "" &&
    filters.salaryMax !== "" &&
    Number(filters.salaryMin) > Number(filters.salaryMax);

  return (
    <Box aria-label="Job filters">
      <Stack spacing={2.5}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Tune fontSize="small" />
          <Typography component="h2" variant="h5">
            Filters
          </Typography>
        </Stack>
        <Typography variant="body2Muted">
          Start with your profile preferences. Changes here are just for this search.
        </Typography>
        <CheckboxGroup
          label="Countries"
          options={
            [
              { value: "CA", label: "Canada" },
              { value: "US", label: "United States" },
            ] as const
          }
          values={filters.countries}
          onChange={(countries) => onChange({ ...filters, countries })}
        />
        <Typography variant="captionMuted">
          No country selected means worldwide. Country and location filters apply together.
        </Typography>
        <LocationPicker
          layout="chips"
          value={filters.locations}
          onChange={(locations) => onChange({ ...filters, locations })}
          helperText="Jobs in any picked place are included. None means anywhere."
        />
        <Divider />
        <CheckboxGroup<string>
          label="Position level"
          options={[{ value: NO_EXPERIENCE, label: NO_EXPERIENCE_LABEL }, ...LEVEL_OPTIONS]}
          values={[...(filters.noExperience ? [NO_EXPERIENCE] : []), ...filters.levels]}
          onChange={(picked) =>
            onChange({
              ...filters,
              noExperience: picked.includes(NO_EXPERIENCE),
              levels: JOB_LEVELS.filter((level) => picked.includes(level)),
            })
          }
        />
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={filters.includeUnknownLevel}
              disabled={!filters.levels.length}
              onChange={(_, checked) => onChange({ ...filters, includeUnknownLevel: checked })}
            />
          }
          label={<Typography variant="body2">Also include unspecified levels</Typography>}
        />
        <Stack spacing={0.5}>
          <Typography variant="body2Strong">Years of experience</Typography>
          <YearsRangeSlider
            label="Years of experience"
            min={yearsValue(filters.minYears)}
            max={yearsValue(filters.maxYears)}
            onChange={(min, max) =>
              onChange({
                ...filters,
                minYears: min === null ? "" : String(min),
                maxYears: max === null ? "" : String(max),
              })
            }
          />
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={filters.includeUnknownYears}
                disabled={!filters.minYears && !filters.maxYears}
                onChange={(_, checked) => onChange({ ...filters, includeUnknownYears: checked })}
              />
            }
            label={<Typography variant="body2">Include jobs that don't say</Typography>}
          />
        </Stack>
        <CheckboxGroup
          label="Workplace"
          options={WORK_MODES}
          values={filters.workModes}
          onChange={(workModes) => onChange({ ...filters, workModes })}
        />
        <CheckboxGroup
          label="Employment type"
          options={EMPLOYMENT_TYPES}
          values={filters.employmentTypes}
          onChange={(employmentTypes) => onChange({ ...filters, employmentTypes })}
        />
        <Divider />
        <TextField
          select
          size="small"
          label="Your activity"
          value={filters.activity}
          onChange={(event) =>
            onChange({ ...filters, activity: event.target.value as DiscoverFilters["activity"] })
          }
        >
          <MenuItem value="all">All jobs</MenuItem>
          <MenuItem value="not_applied">Not applied yet</MenuItem>
          <MenuItem value="applied">Applied</MenuItem>
          <MenuItem value="saved">Saved jobs</MenuItem>
        </TextField>
        <DateFilter
          label="Date posted"
          range={filters.postedRange}
          from={filters.postedFrom}
          to={filters.postedTo}
          onChange={(postedRange, postedFrom, postedTo) =>
            onChange({ ...filters, postedRange, postedFrom, postedTo })
          }
        />
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={filters.includeUnknownPostedAt}
              disabled={filters.postedRange === "all"}
              onChange={(_, checked) => onChange({ ...filters, includeUnknownPostedAt: checked })}
            />
          }
          label={<Typography variant="body2">Include unknown posting dates</Typography>}
        />
        <DateFilter
          label="Date added to OpenApply"
          range={filters.discoveredRange}
          from={filters.discoveredFrom}
          to={filters.discoveredTo}
          onChange={(discoveredRange, discoveredFrom, discoveredTo) =>
            onChange({ ...filters, discoveredRange, discoveredFrom, discoveredTo })
          }
        />
        <Typography variant="captionMuted">
          Added dates describe when OpenApply first found a job, not when the employer posted it.
        </Typography>
        <Accordion disableGutters>
          <AccordionSummary expandIcon={<ExpandMore />}>
            <Typography variant="body2Strong">Companies and exclusions</Typography>
          </AccordionSummary>
          <AccordionDetails>
            <Stack spacing={2}>
              {(
                [
                  { key: "companies", label: "Include companies" },
                  { key: "excludeCompanies", label: "Exclude companies" },
                  { key: "excludeTitles", label: "Exclude title words" },
                ] as const
              ).map(({ key, label }) => (
                <Autocomplete
                  key={key}
                  multiple
                  freeSolo
                  autoSelect
                  options={[] as string[]}
                  size="small"
                  value={filters[key]}
                  onChange={(_, values) =>
                    onChange({
                      ...filters,
                      [key]: [...new Set(values.map((value) => value.trim()).filter(Boolean))],
                    })
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label={label}
                      helperText="Type a name or phrase, then press Enter."
                    />
                  )}
                />
              ))}
            </Stack>
          </AccordionDetails>
        </Accordion>
        <Divider />
        <Stack spacing={1.5}>
          <Typography variant="body2Strong">Salary range</Typography>
          <Stack direction="row" spacing={1}>
            <TextField
              fullWidth
              size="small"
              label="Minimum"
              type="number"
              value={filters.salaryMin}
              onChange={(event) => onChange({ ...filters, salaryMin: event.target.value })}
              slotProps={{ htmlInput: { min: 0, step: "any" } }}
            />
            <TextField
              fullWidth
              size="small"
              label="Maximum"
              type="number"
              value={filters.salaryMax}
              error={invalidRange}
              onChange={(event) => onChange({ ...filters, salaryMax: event.target.value })}
              slotProps={{ htmlInput: { min: 0, step: "any" } }}
            />
          </Stack>
          {invalidRange && (
            <Typography variant="caption" color="error.main" role="alert">
              Maximum salary must be at least the minimum.
            </Typography>
          )}
          <Stack direction="row" spacing={1}>
            <TextField
              select
              fullWidth
              size="small"
              label="Currency"
              value={filters.salaryCurrency}
              onChange={(event) =>
                onChange({
                  ...filters,
                  salaryCurrency: event.target.value as DiscoverFilters["salaryCurrency"],
                })
              }
            >
              {SALARY_CURRENCIES.map((currency) => (
                <MenuItem key={currency} value={currency}>
                  {currency}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              fullWidth
              size="small"
              label="Per"
              value={filters.salaryPeriod}
              onChange={(event) =>
                onChange({
                  ...filters,
                  salaryPeriod: event.target.value as DiscoverFilters["salaryPeriod"],
                })
              }
            >
              <MenuItem value="year">Year</MenuItem>
              <MenuItem value="month">Month</MenuItem>
              <MenuItem value="hour">Hour</MenuItem>
            </TextField>
          </Stack>
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={filters.includeUnknownSalary}
                onChange={(_, checked) => onChange({ ...filters, includeUnknownSalary: checked })}
              />
            }
            label={<Typography variant="body2">Include incomplete salary details</Typography>}
          />
          <Typography variant="captionMuted">
            Also show jobs whose pay range, currency, or pay period is missing.
          </Typography>
        </Stack>
        <Stack spacing={1}>
          <Button
            startIcon={<RestartAlt />}
            onClick={onReset}
            disabled={!profileDefaultsAvailable || loading}
          >
            Reset to match profile
          </Button>
        </Stack>
      </Stack>
    </Box>
  );
}
