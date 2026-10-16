"use client";

import { Add, DeleteOutlined } from "@mui/icons-material";
import {
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  Checkbox,
  FormControlLabel,
  FormHelperText,
  IconButton,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type {
  LinkedinSearch,
  LinkedinSettingsInput,
} from "@openapply/contracts/linkedin-discovery";
import { useSelector } from "@tanstack/react-form";
import { withForm } from "@/components/ui/form/tanstack";
import { firstErrorMessage } from "@/components/ui/form/tanstack/error-message";
import { useKeyedList } from "@/hooks/use-keyed-list";

const LINKEDIN_SETTINGS_DEFAULTS: LinkedinSettingsInput = { enabled: false, searches: [] };
const EMPTY_SEARCH: LinkedinSearch = {
  query: "",
  location: "",
  distance: 25,
  experienceLevels: ["entry"],
  maxYearsExperience: 2,
  countries: [],
  remoteOnly: false,
};
const LEVELS = [
  { value: "entry", label: "Entry level" },
  { value: "intern", label: "Internship" },
] as const;

export const LinkedinSearches = withForm({
  defaultValues: LINKEDIN_SETTINGS_DEFAULTS,
  props: { disabled: false },
  render: function LinkedinSearches({ form, disabled }) {
    const count = useSelector(form.store, (state) => state.values.searches.length);
    const { keys, onAdd, onRemove } = useKeyedList(count);
    return (
      <form.AppField name="searches" mode="array">
        {(field) => (
          <Stack spacing={2}>
            <Typography variant="body2Muted">
              Save up to four searches. These preferences are separate from your profile and
              Discover filters.
            </Typography>
            {field.state.value.map((_, index) => (
              <Card key={keys[index]} variant="outlined">
                <CardHeader
                  title={<Typography variant="subtitle2">Search {index + 1}</Typography>}
                  action={
                    <IconButton
                      type="button"
                      size="small"
                      disabled={disabled}
                      aria-label={`Remove LinkedIn search ${index + 1}`}
                      onClick={() => {
                        onRemove(index);
                        field.removeValue(index);
                      }}
                    >
                      <DeleteOutlined fontSize="small" />
                    </IconButton>
                  }
                />
                <CardContent>
                  <Stack spacing={2}>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                      <form.AppField name={`searches[${index}].query`}>
                        {(sub) => (
                          <sub.TextField
                            label="Role or keywords"
                            placeholder="Software engineer"
                            disabled={disabled}
                            required
                            slotProps={{ htmlInput: { minLength: 2, maxLength: 200 } }}
                          />
                        )}
                      </form.AppField>
                      <form.AppField name={`searches[${index}].location`}>
                        {(sub) => (
                          <sub.TextField
                            label="Search location"
                            placeholder="Toronto, Canada"
                            disabled={disabled}
                            required
                            slotProps={{ htmlInput: { minLength: 2, maxLength: 200 } }}
                          />
                        )}
                      </form.AppField>
                    </Stack>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
                      <form.AppField name={`searches[${index}].distance`}>
                        {(sub) => (
                          <sub.TextField
                            label="Search radius (miles)"
                            type="number"
                            disabled={disabled}
                            required
                            slotProps={{ htmlInput: { min: 1, max: 100, step: 1 } }}
                          />
                        )}
                      </form.AppField>
                      <form.AppField name={`searches[${index}].maxYearsExperience`}>
                        {(sub) => (
                          <sub.TextField
                            label="Maximum required experience (years)"
                            type="number"
                            disabled={disabled}
                            required
                            slotProps={{ htmlInput: { min: 0, max: 10, step: 1 } }}
                          />
                        )}
                      </form.AppField>
                    </Stack>
                    <form.AppField name={`searches[${index}].experienceLevels`}>
                      {(sub) => (
                        <Box>
                          <Typography variant="body2">Experience levels</Typography>
                          <Stack direction="row" spacing={2}>
                            {LEVELS.map(({ value, label }) => (
                              <FormControlLabel
                                key={value}
                                label={label}
                                control={
                                  <Checkbox
                                    disabled={disabled}
                                    checked={sub.state.value.includes(value)}
                                    onBlur={sub.handleBlur}
                                    onChange={(_, checked) =>
                                      sub.handleChange(
                                        checked
                                          ? [...sub.state.value, value]
                                          : sub.state.value.filter((level) => level !== value),
                                      )
                                    }
                                  />
                                }
                              />
                            ))}
                          </Stack>
                          <FormHelperText error={sub.state.meta.errors.length > 0}>
                            {firstErrorMessage(sub.state.meta.errors) ?? "Choose at least one."}
                          </FormHelperText>
                        </Box>
                      )}
                    </form.AppField>
                    <form.AppField name={`searches[${index}].countries`}>
                      {(sub) => (
                        <Autocomplete
                          multiple
                          freeSolo
                          disabled={disabled}
                          options={["CA", "US"]}
                          value={sub.state.value}
                          onBlur={sub.handleBlur}
                          onChange={(_, values) =>
                            sub.handleChange([
                              ...new Set(values.map((value) => value.trim().toUpperCase())),
                            ])
                          }
                          renderInput={(params) => (
                            <TextField
                              {...params}
                              label="Allowed countries"
                              placeholder="CA or US"
                              error={sub.state.meta.errors.length > 0}
                              helperText={
                                firstErrorMessage(sub.state.meta.errors) ??
                                "Optional two-letter country codes. Leave empty for any country."
                              }
                            />
                          )}
                        />
                      )}
                    </form.AppField>
                    <form.AppField name={`searches[${index}].remoteOnly`}>
                      {(sub) => <sub.Switch label="Remote jobs only" disabled={disabled} />}
                    </form.AppField>
                  </Stack>
                </CardContent>
              </Card>
            ))}
            <Box>
              <Button
                type="button"
                variant="outlined"
                startIcon={<Add />}
                disabled={disabled || count >= 4}
                onClick={() => {
                  onAdd();
                  field.pushValue({ ...EMPTY_SEARCH, experienceLevels: ["entry"], countries: [] });
                }}
              >
                Add saved search ({count}/4)
              </Button>
              {field.state.meta.errors.length > 0 && (
                <FormHelperText error>{firstErrorMessage(field.state.meta.errors)}</FormHelperText>
              )}
            </Box>
          </Stack>
        )}
      </form.AppField>
    );
  },
});
