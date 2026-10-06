"use client";

import { type ReactElement, useId, useState } from "react";
import { Visibility, VisibilityOff } from "@mui/icons-material";
import {
  FormLabel,
  IconButton,
  InputAdornment,
  TextField as MuiTextField,
  type TextFieldProps as MuiTextFieldProps,
  Stack,
  Tooltip,
} from "@mui/material";

export interface TextFieldProps extends Omit<MuiTextFieldProps, "error"> {
  /** Error message; when set the field renders in its error state and shows the text below. */
  errorText?: string;
  labelPosition?: "floating" | "above";
}

/**
 * Themed text input built on MUI's TextField with inline error text and a
 * built-in show/hide toggle for `type="password"`. Presentational and
 * controlled - pass `value`/`onChange` (no form coupling).
 */
export function TextField(props: TextFieldProps): ReactElement {
  const {
    errorText,
    helperText,
    type,
    slotProps,
    label,
    labelPosition = "floating",
    id,
    ...rest
  } = props;
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const above = labelPosition === "above";
  const isPassword = type === "password";
  const [showPassword, setShowPassword] = useState(false);
  const effectiveType = isPassword && showPassword ? "text" : type;

  const passwordAdornment = isPassword && (
    <InputAdornment position="end">
      <Tooltip title={showPassword ? "Hide password" : "Show password"}>
        <IconButton
          onClick={() => setShowPassword((v) => !v)}
          onMouseDown={(e) => e.preventDefault()}
          edge="end"
          size="small"
          aria-label={showPassword ? "Hide password" : "Show password"}
        >
          {showPassword ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
        </IconButton>
      </Tooltip>
    </InputAdornment>
  );

  const input = (
    <MuiTextField
      fullWidth
      id={inputId}
      label={above ? undefined : label}
      type={effectiveType}
      error={Boolean(errorText)}
      helperText={errorText ?? helperText}
      slotProps={{
        ...slotProps,
        input: {
          ...(slotProps?.input as object),
          ...(above ? { notched: false } : {}),
          ...(isPassword ? { endAdornment: passwordAdornment } : {}),
        },
      }}
      {...rest}
    />
  );

  if (!above) return input;
  return (
    <Stack spacing={0.75} sx={{ width: "100%" }}>
      {label && (
        <FormLabel
          htmlFor={inputId}
          error={Boolean(errorText)}
          disabled={rest.disabled}
          required={rest.required}
          sx={{ typography: "body1", color: "text.primary" }}
        >
          {label}
        </FormLabel>
      )}
      {input}
    </Stack>
  );
}
