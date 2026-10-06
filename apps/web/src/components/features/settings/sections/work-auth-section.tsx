"use client";
import { Button, MenuItem, Stack, TextField } from "@mui/material";
import { USER_DEFAULT_VALUES } from "@openapply/contracts/user";
import { useSelector } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { FormSection } from "@/components/ui/form";
import { withForm } from "@/components/ui/form/tanstack";
import { useKeyedList } from "@/hooks/use-keyed-list";

export const WorkAuthSection = withForm({
  defaultValues: USER_DEFAULT_VALUES,
  render: function WorkAuthSection({ form }) {
    const count = useSelector(form.store, (s) => s.values.workAuthorization?.length ?? 0);
    const country = useSelector(form.store, (s) => s.values.country ?? "");
    const state = useSelector(form.store, (s) => s.values.state ?? "");
    const { keys, onAdd, onRemove } = useKeyedList(count);
    const locations = useQuery({
      queryKey: ["locations", country, state],
      staleTime: Infinity,
      queryFn: async () => {
        const result = await api.locations.get({ query: { country, state } });
        if (result.error || !result.data) throw new Error("Could not load countries");
        return result.data;
      },
    });
    return (
      <FormSection
        title="Work authorization"
        description="Answer separately for each country. Unanswered does not mean No; these answers are never inferred from your resume."
      >
        <form.AppField name="workAuthorization" mode="array">
          {(field) => (
            <Stack spacing={3}>
              {(field.state.value ?? []).map((entry, i) => (
                <Stack key={keys[i]} spacing={2}>
                  <form.AppField name={`workAuthorization[${i}].country`}>
                    {(f) => (
                      <f.Autocomplete
                        label="Country where you want to work"
                        options={locations.data?.countries.map((c) => c.name) ?? []}
                      />
                    )}
                  </form.AppField>
                  <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                    <TextField
                      fullWidth
                      select
                      label="Authorized to work here?"
                      value={entry.authorized == null ? "" : String(entry.authorized)}
                      onChange={(e) =>
                        form.setFieldValue(
                          `workAuthorization[${i}].authorized`,
                          e.target.value === "true",
                        )
                      }
                    >
                      <MenuItem value="true">Yes</MenuItem>
                      <MenuItem value="false">No</MenuItem>
                    </TextField>
                    <TextField
                      fullWidth
                      select
                      label="Need visa sponsorship?"
                      value={entry.sponsorship == null ? "" : String(entry.sponsorship)}
                      onChange={(e) =>
                        form.setFieldValue(
                          `workAuthorization[${i}].sponsorship`,
                          e.target.value === "true",
                        )
                      }
                    >
                      <MenuItem value="true">Yes</MenuItem>
                      <MenuItem value="false">No</MenuItem>
                    </TextField>
                  </Stack>
                  <Button
                    onClick={() => {
                      onRemove(i);
                      field.removeValue(i);
                    }}
                  >
                    Remove country
                  </Button>
                </Stack>
              ))}
              <Button
                variant="outlined"
                onClick={() => {
                  onAdd();
                  field.pushValue({ country: "", authorized: null, sponsorship: null });
                }}
              >
                Add work country
              </Button>
            </Stack>
          )}
        </form.AppField>
        <form.AppField name="willingToRelocate">
          {(f) => <f.Switch label="Willing to relocate" />}
        </form.AppField>
        <form.AppField name="preferredLocations">
          {(f) => (
            <f.Multiselect
              label="Preferred job locations"
              placeholder="City, province / state, country"
              options={locations.data?.cities.map((city) => `${city}, ${state}, ${country}`) ?? []}
              helperText="Enter each location and press Enter."
            />
          )}
        </form.AppField>
      </FormSection>
    );
  },
});
