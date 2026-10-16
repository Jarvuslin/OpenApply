"use client";

import { Box, Stack } from "@mui/material";
import { APPLICATION_QUESTIONS, USER_DEFAULT_VALUES } from "@openapply/contracts/user";
import { FormSection } from "@/components/ui/form";
import { withForm } from "@/components/ui/form/tanstack";

const PHONE_TYPES =
  APPLICATION_QUESTIONS.find((question) => question.key === "phoneType")?.choices ?? [];

export const PersonalSection = withForm({
  defaultValues: USER_DEFAULT_VALUES,
  render: function PersonalSection({ form }) {
    return (
      <FormSection
        title="Personal"
        description="Your name, contact, and links shared with employers. Optional answers stay unknown when blank."
      >
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <form.AppField name="firstName">
            {(field) => <field.TextField label="First name" />}
          </form.AppField>
          <form.AppField name="lastName">
            {(field) => <field.TextField label="Last name" />}
          </form.AppField>
        </Stack>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <form.AppField name="preferredName">
            {(field) => <field.TextField label="Preferred name (optional)" />}
          </form.AppField>
          <form.AppField name="namePronunciation">
            {(field) => <field.TextField label="Name pronunciation (optional)" />}
          </form.AppField>
        </Stack>
        <form.AppField name="pronouns">
          {(field) => (
            <field.TextField
              label="Pronouns (optional)"
              helperText="Enter what you want shared with employers, or leave blank."
            />
          )}
        </form.AppField>
        <form.AppField name="currentCompany">
          {(field) => (
            <field.TextField
              label="Current company (optional)"
              helperText="Enter your current employer or an explicit answer such as Not currently employed. This is not inferred from resume dates."
            />
          )}
        </form.AppField>
        <form.AppField name="contactEmail">
          {(field) => <field.TextField label="Contact email" type="email" />}
        </form.AppField>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <Box sx={{ flex: 2 }}>
            <form.AppField name="phone">{(field) => <field.Phone label="Phone" />}</form.AppField>
          </Box>
          <Box sx={{ flex: 1 }}>
            <form.AppField name="applicationAnswers.phoneType">
              {(field) => (
                <field.Select
                  label="Phone type"
                  optional
                  emptyLabel="Ask me"
                  items={PHONE_TYPES.map((value) => ({ value, label: value }))}
                />
              )}
            </form.AppField>
          </Box>
        </Stack>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <form.AppField name="website">
            {(field) => <field.TextField label="Website" />}
          </form.AppField>
          <form.AppField name="linkedin">
            {(field) => <field.TextField label="LinkedIn URL" />}
          </form.AppField>
        </Stack>
        <form.AppField name="github">
          {(field) => <field.TextField label="GitHub URL" />}
        </form.AppField>
        <form.AppField name="portfolio">
          {(field) => <field.TextField label="Portfolio URL (optional)" />}
        </form.AppField>
        <form.AppField name="additionalLinks">
          {(field) => (
            <field.Multiselect
              label="Additional links (optional)"
              options={[]}
              placeholder="https://..."
              helperText="Enter each link and press Enter. Up to 10 links."
            />
          )}
        </form.AppField>
      </FormSection>
    );
  },
});
