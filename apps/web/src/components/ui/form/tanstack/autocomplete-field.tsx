"use client";
import { Autocomplete as MuiAutocomplete, TextField } from "@mui/material";
import { firstErrorMessage } from "./error-message";
import { useFieldContext } from "./form-context";

interface AutocompleteProps {
  label: string;
  options: string[];
  freeSolo?: boolean;
  helperText?: string;
  onValueChange?: (value: string) => void;
}

export function Autocomplete({
  label,
  options,
  freeSolo = false,
  helperText,
  onValueChange,
}: AutocompleteProps) {
  const field = useFieldContext<string | null | undefined>();
  const change = (value: string) => {
    field.handleChange(value);
    onValueChange?.(value);
  };
  const error = firstErrorMessage(field.state.meta.errors);
  return (
    <MuiAutocomplete
      fullWidth
      freeSolo={freeSolo}
      autoSelect={freeSolo}
      options={options}
      value={field.state.value || null}
      onChange={(_, value) => change(value ?? "")}
      onInputChange={(_, value, reason) => {
        if (freeSolo && reason === "input") change(value);
      }}
      onBlur={field.handleBlur}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          error={Boolean(error)}
          helperText={error ?? helperText}
        />
      )}
    />
  );
}
