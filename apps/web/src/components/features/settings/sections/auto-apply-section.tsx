"use client";

import { Checkbox, FormControlLabel, Stack } from "@mui/material";
import { USER_DEFAULT_VALUES } from "@openapply/contracts/user";
import { useSelector } from "@tanstack/react-form";
import { FormSection } from "@/components/ui/form";
import { withForm } from "@/components/ui/form/tanstack";

export const AutoApplySection = withForm({
  defaultValues: USER_DEFAULT_VALUES,
  render: function AutoApplySection({ form }) {
    const limit = useSelector(form.store, (s) => s.values.autoApply?.maxApplicationsPerCampaign);
    return (
      <FormSection
        title="Auto-apply"
        description="Defaults used by the auto-apply and apply skills."
      >
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <form.AppField name="autoApply.minMatchScore">
            {(field) => <field.TextField label="Min match score (0-100)" type="number" />}
          </form.AppField>
          <form.AppField name="autoApply.maxApplicationsPerCampaign">
            {(field) => (
              <field.TextField
                label="Max applications per campaign"
                type="number"
                disabled={limit == null || limit === 0}
                helperText="Enter 1–500, or choose No limit"
              />
            )}
          </form.AppField>
        </Stack>
        <FormControlLabel
          label="No limit per campaign"
          control={
            <Checkbox
              checked={limit == null || limit === 0}
              onChange={(_, checked) =>
                form.setFieldValue("autoApply.maxApplicationsPerCampaign", checked ? null : 10)
              }
            />
          }
        />
        <form.AppField name="autoApply.defaultStartDate">
          {(field) => (
            <field.Autocomplete
              label="Availability"
              freeSolo
              options={["Immediately", "2 weeks notice", "4 weeks notice"]}
              helperText="Choose a notice period or type a specific start date."
            />
          )}
        </form.AppField>
      </FormSection>
    );
  },
});
