"use client";
import {
  EMPLOYMENT_TYPES,
  JOB_LEVELS,
  USER_DEFAULT_VALUES,
  WORK_MODES,
} from "@openapply/contracts/user";
import { FormSection } from "@/components/ui/form";
import { withForm } from "@/components/ui/form/tanstack";

export const JobPreferencesSection = withForm({
  defaultValues: USER_DEFAULT_VALUES,
  render: function JobPreferencesSection({ form }) {
    return (
      <FormSection
        title="Jobs you want"
        description="Choose the levels and working arrangements you want to include in your search."
      >
        <form.AppField name="jobPreferences.levels">
          {(f) => <f.Multiselect label="Job levels" options={JOB_LEVELS} freeSolo={false} />}
        </form.AppField>
        <form.AppField name="jobPreferences.yearsExperience">
          {(f) => (
            <f.TextField
              label="Years of professional experience"
              type="number"
              helperText="Enter your actual experience; this is separate from the levels you want to target."
            />
          )}
        </form.AppField>
        <form.AppField name="jobPreferences.workModes">
          {(f) => <f.Multiselect label="Work arrangement" options={WORK_MODES} freeSolo={false} />}
        </form.AppField>
        <form.AppField name="jobPreferences.employmentTypes">
          {(f) => (
            <f.Multiselect label="Employment type" options={EMPLOYMENT_TYPES} freeSolo={false} />
          )}
        </form.AppField>
      </FormSection>
    );
  },
});
