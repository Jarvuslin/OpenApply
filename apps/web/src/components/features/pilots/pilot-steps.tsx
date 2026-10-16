"use client";

import type { ReactElement, ReactNode } from "react";
import {
  Autocomplete,
  Box,
  FormControlLabel,
  MenuItem,
  Radio,
  RadioGroup,
  Slider,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { NO_EXPERIENCE_LABEL } from "@/components/features/experience/experience-labels";
import { YearsRangeSlider } from "@/components/features/experience/years-range-slider";
import { LocationPicker } from "@/components/features/locations/location-picker";
import { ChipGroup } from "./chip-group";
import type { PilotForm } from "./pilot-form";
import {
  COMPANY_TYPE_OPTIONS,
  INTERVAL_OPTIONS,
  LEVEL_OPTIONS,
  ROLE_SUGGESTIONS,
  WINDOW_OPTIONS,
  WORK_MODE_OPTIONS,
} from "./pilot-format";

// A chip value for the noExperience flag, shown among the levels it widens.
const NO_EXPERIENCE = "no_experience";

interface StepFieldProps {
  label: string;
  helper?: string;
  children: ReactNode;
}

function StepField({ label, helper, children }: StepFieldProps): ReactElement {
  return (
    <Stack spacing={1.25}>
      <Box>
        <Typography variant="body2Strong" component="h3">
          {label}
        </Typography>
        {helper && <Typography variant="captionMuted">{helper}</Typography>}
      </Box>
      {children}
    </Stack>
  );
}

interface TagsProps {
  label: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder: string;
}

function Tags({ label, value, onChange, placeholder }: TagsProps): ReactElement {
  return (
    <Autocomplete
      multiple
      freeSolo
      options={[]}
      value={value}
      onChange={(_, next) => onChange(next.map((item) => item.trim()).filter(Boolean))}
      renderInput={(params) => (
        <TextField {...params} size="small" placeholder={placeholder} aria-label={label} />
      )}
    />
  );
}

interface StepProps {
  form: PilotForm;
}

export function BasicsStep({ form }: StepProps): ReactElement {
  return (
    <Stack spacing={2.75}>
      <form.Field name="name">
        {(field) => (
          <StepField label="Pilot name">
            <TextField
              size="small"
              value={field.state.value}
              placeholder="e.g. AI engineer · startups"
              onChange={(event) => field.handleChange(event.target.value)}
            />
          </StepField>
        )}
      </form.Field>
      <form.Field name="rules.roles">
        {(field) => (
          <StepField
            label="What to look for"
            helper="Pick the roles to look for. You can add keywords in the next step."
          >
            <ChipGroup
              label="Roles"
              options={ROLE_SUGGESTIONS.map((role) => ({ value: role, label: role }))}
              value={field.state.value}
              onChange={field.handleChange}
              addLabel="Add role"
            />
          </StepField>
        )}
      </form.Field>
      <form.Field name="rules.noExperience">
        {(noExperience) => (
          <form.Field name="rules.levels">
            {(levels) => (
              <StepField
                label="Experience level"
                helper="Showing every level. Pick one or more to narrow."
              >
                <ChipGroup<string>
                  label="Experience level"
                  options={[{ value: NO_EXPERIENCE, label: NO_EXPERIENCE_LABEL }, ...LEVEL_OPTIONS]}
                  value={[
                    ...(noExperience.state.value ? [NO_EXPERIENCE] : []),
                    ...levels.state.value,
                  ]}
                  onChange={(picked) => {
                    noExperience.handleChange(picked.includes(NO_EXPERIENCE));
                    levels.handleChange(
                      LEVEL_OPTIONS.map((option) => option.value).filter((level) =>
                        picked.includes(level),
                      ),
                    );
                  }}
                />
              </StepField>
            )}
          </form.Field>
        )}
      </form.Field>
      <form.Field name="rules.minYears">
        {(minYears) => (
          <form.Field name="rules.maxYears">
            {(maxYears) => (
              <StepField
                label="Years of experience"
                helper="How many years the job asks for. Jobs that don't say are kept unless you skip unknown details."
              >
                <YearsRangeSlider
                  label="Years of experience"
                  min={minYears.state.value}
                  max={maxYears.state.value}
                  onChange={(min, max) => {
                    minYears.handleChange(min);
                    maxYears.handleChange(max);
                  }}
                />
              </StepField>
            )}
          </form.Field>
        )}
      </form.Field>
      <form.Field name="rules.companyTypes">
        {(field) => (
          <StepField
            label="Company type"
            helper="Choose the kinds of companies to target. Companies we can't place yet are kept."
          >
            <ChipGroup
              label="Company type"
              options={COMPANY_TYPE_OPTIONS}
              value={field.state.value}
              onChange={field.handleChange}
            />
          </StepField>
        )}
      </form.Field>
      <form.Field name="rules.locations">
        {(field) => (
          <LocationPicker
            label="Location"
            value={field.state.value}
            onChange={field.handleChange}
            helperText="Jobs matching any of these places are included. Leave empty to search anywhere."
          />
        )}
      </form.Field>
      <form.Field name="rules.workModes">
        {(field) => (
          <StepField label="Work mode">
            <ChipGroup
              label="Work mode"
              options={WORK_MODE_OPTIONS}
              value={field.state.value}
              onChange={field.handleChange}
            />
          </StepField>
        )}
      </form.Field>
    </Stack>
  );
}

export function FiltersStep({ form }: StepProps): ReactElement {
  return (
    <Stack spacing={2.75}>
      <form.Field name="rules.keywords">
        {(field) => (
          <StepField
            label="Keywords (optional)"
            helper="Jobs must mention at least one. Press Enter to add each."
          >
            <Tags
              label="Keywords"
              value={field.state.value}
              onChange={field.handleChange}
              placeholder="Add a keyword"
            />
          </StepField>
        )}
      </form.Field>
      <form.Field name="rules.excludeKeywords">
        {(field) => (
          <StepField
            label="Exclude keywords (optional)"
            helper="Skip jobs that mention any of these."
          >
            <Tags
              label="Exclude keywords"
              value={field.state.value}
              onChange={field.handleChange}
              placeholder="Add a keyword"
            />
          </StepField>
        )}
      </form.Field>
      <form.Field name="rules.companies">
        {(field) => (
          <StepField
            label="Companies (optional)"
            helper="Only look at these companies. Leave empty for any company."
          >
            <Tags
              label="Companies"
              value={field.state.value}
              onChange={field.handleChange}
              placeholder="e.g. OpenAI, Anthropic, Shopify"
            />
          </StepField>
        )}
      </form.Field>
      <form.Field name="rules.skipCompanies">
        {(field) => (
          <StepField label="Skip companies (optional)" helper="Never add jobs from these.">
            <Tags
              label="Skip companies"
              value={field.state.value}
              onChange={field.handleChange}
              placeholder="Add a company"
            />
          </StepField>
        )}
      </form.Field>
      <form.Field name="rules.postedWithin">
        {(field) => (
          <StepField
            label="Posted within"
            helper="Pick one or more. Results are grouped by window, newest first. None means any time."
          >
            <ChipGroup
              label="Posted within"
              options={WINDOW_OPTIONS}
              value={field.state.value}
              onChange={field.handleChange}
            />
          </StepField>
        )}
      </form.Field>
    </Stack>
  );
}

interface MatchingStepProps extends StepProps {
  resumes: { id: string; label: string }[];
}

export function MatchingStep({ form, resumes }: MatchingStepProps): ReactElement {
  return (
    <Stack spacing={2.75}>
      <form.Field name="minScore">
        {(field) => (
          <StepField
            label="Minimum fit"
            helper="Each posting is scored against your original resume. Only jobs at or above this score are kept."
          >
            <Stack direction="row" spacing={3} sx={{ alignItems: "center", px: 1 }}>
              <Slider
                value={field.state.value}
                onChange={(_, value) => field.handleChange(value as number)}
                min={0}
                max={100}
                step={5}
                marks={[0, 50, 70, 90].map((value) => ({ value, label: `${value}%` }))}
                aria-label="Minimum fit"
              />
              <Typography variant="statValue" sx={{ minWidth: 48, textAlign: "right" }}>
                {field.state.value}%
              </Typography>
            </Stack>
          </StepField>
        )}
      </form.Field>
      <form.Field name="resumeId">
        {(field) => (
          <StepField
            label="Score against"
            helper="The resume the agent compares each posting with."
          >
            <TextField
              select
              size="small"
              value={field.state.value}
              onChange={(event) => field.handleChange(event.target.value)}
              sx={{ maxWidth: 360 }}
            >
              {resumes.map((resume) => (
                <MenuItem key={resume.id} value={resume.id}>
                  {resume.label}
                </MenuItem>
              ))}
            </TextField>
          </StepField>
        )}
      </form.Field>
      <form.Field name="rules.includeUnknown">
        {(field) => (
          <StepField
            label="Unknown details"
            helper="Some postings don't say the level or company type."
          >
            <RadioGroup
              value={field.state.value ? "include" : "skip"}
              onChange={(event) => field.handleChange(event.target.value === "include")}
            >
              <FormControlLabel
                value="include"
                control={<Radio size="small" />}
                label="Include them and let the fit score decide"
              />
              <FormControlLabel value="skip" control={<Radio size="small" />} label="Skip them" />
            </RadioGroup>
          </StepField>
        )}
      </form.Field>
    </Stack>
  );
}

export function ScheduleStep({ form }: StepProps): ReactElement {
  return (
    <Stack spacing={2.75}>
      <form.Field name="autoRun">
        {(field) => (
          <Stack direction="row" spacing={2} sx={{ alignItems: "center" }}>
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2Strong">Auto run</Typography>
              <Typography variant="captionMuted" component="p">
                Run automatically on a schedule. Off means it only runs when you press Run now.
              </Typography>
            </Box>
            <Switch
              checked={field.state.value}
              onChange={(event) => field.handleChange(event.target.checked)}
              slotProps={{ input: { "aria-label": "Auto run" } }}
            />
          </Stack>
        )}
      </form.Field>
      <form.Subscribe selector={(state) => state.values.autoRun}>
        {(autoRun) =>
          autoRun && (
            <>
              <form.Field name="intervalMinutes">
                {(field) => (
                  <StepField
                    label="How often"
                    helper="Always on checks every 2 minutes while your computer is connected."
                  >
                    <ChipGroup
                      label="How often"
                      single
                      options={INTERVAL_OPTIONS}
                      value={[field.state.value]}
                      onChange={(value) => field.handleChange(value[0] ?? 10)}
                    />
                  </StepField>
                )}
              </form.Field>
              <form.Field name="mode">
                {(field) => (
                  <StepField label="When a job matches">
                    <RadioGroup
                      value={field.state.value}
                      onChange={(event) =>
                        field.handleChange(event.target.value as "review" | "queue")
                      }
                    >
                      <FormControlLabel
                        value="review"
                        control={<Radio size="small" />}
                        label="Hold them for my review"
                      />
                      <FormControlLabel
                        value="queue"
                        control={<Radio size="small" />}
                        label="Add them to my queue automatically"
                      />
                    </RadioGroup>
                    <Typography variant="captionMuted">
                      Run now always holds results for review, whatever you pick here.
                    </Typography>
                  </StepField>
                )}
              </form.Field>
            </>
          )
        }
      </form.Subscribe>
      <form.Field name="maxJobsPerRun">
        {(field) => (
          <StepField
            label="Max jobs per run"
            helper="Newest first. Your daily limit in Queue settings still applies when jobs are added."
          >
            <TextField
              size="small"
              type="number"
              value={field.state.value}
              onChange={(event) => field.handleChange(Number(event.target.value))}
              slotProps={{ htmlInput: { min: 1, max: 50, "aria-label": "Max jobs per run" } }}
              sx={{ width: 96 }}
            />
          </StepField>
        )}
      </form.Field>
    </Stack>
  );
}
