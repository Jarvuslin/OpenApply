"use client";
import { Alert, Stack } from "@mui/material";
import { USER_DEFAULT_VALUES } from "@openapply/contracts/user";
import { useSelector } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { FormSection } from "@/components/ui/form";
import { withForm } from "@/components/ui/form/tanstack";

export const AddressSection = withForm({
  defaultValues: USER_DEFAULT_VALUES,
  render: function AddressSection({ form }) {
    const country = useSelector(form.store, (s) => s.values.country ?? "");
    const state = useSelector(form.store, (s) => s.values.state ?? "");
    const locations = useQuery({
      queryKey: ["locations", country, state],
      staleTime: Infinity,
      queryFn: async () => {
        const { data, error } = await api.locations.get({ query: { country, state } });
        if (error || !data) throw new Error("Location suggestions unavailable");
        return data;
      },
    });
    const canada = country === "Canada" || country === "CA";
    return (
      <FormSection
        title="Address"
        description="Choose your country first. You can type a region or city if it is missing from the suggestions."
      >
        {locations.isError && (
          <Alert severity="warning">
            Location suggestions are unavailable. Your existing answers are preserved; you can still
            type your region and city.
          </Alert>
        )}
        <form.AppField name="country">
          {(field) => (
            <field.Autocomplete
              label="Country"
              options={locations.data?.countries.map((c) => c.name) ?? []}
              onValueChange={() => {
                form.setFieldValue("state", "");
                form.setFieldValue("city", "");
              }}
            />
          )}
        </form.AppField>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <form.AppField name="state">
            {(field) => (
              <field.Autocomplete
                label={canada ? "Province" : "State / Region"}
                freeSolo
                options={locations.data?.states.map((s) => s.name) ?? []}
              />
            )}
          </form.AppField>
          <form.AppField name="city">
            {(field) => (
              <field.Autocomplete label="City" freeSolo options={locations.data?.cities ?? []} />
            )}
          </form.AppField>
        </Stack>
        <form.AppField name="street">{(field) => <field.TextField label="Street" />}</form.AppField>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
          <form.AppField name="aptUnit">
            {(field) => <field.TextField label="Apt / Unit" />}
          </form.AppField>
          <form.AppField name="zipCode">
            {(field) => <field.TextField label={canada ? "Postal code" : "ZIP / Postal code"} />}
          </form.AppField>
        </Stack>
      </FormSection>
    );
  },
});
