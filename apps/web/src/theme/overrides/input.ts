import type { Components, Theme } from "@mui/material/styles";

export const textFieldOverrides: Components<Theme>["MuiTextField"] = {
  defaultProps: { variant: "outlined", size: "small" },
};

export const formControlOverrides: Components<Theme>["MuiFormControl"] = {
  styleOverrides: {
    root: ({ theme }) => ({
      "&:has(> .MuiInputLabel-outlined)": { marginTop: theme.spacing(2.5) },
    }),
  },
};

export const inputLabelOverrides: Components<Theme>["MuiInputLabel"] = {
  defaultProps: { shrink: true },
  styleOverrides: {
    outlined: ({ theme }) => ({
      backgroundColor: "transparent",
      ...theme.typography.body2Strong,
      color: theme.palette.text.primary,
      "&.MuiInputLabel-shrink": {
        transform: `translate(0, ${theme.spacing(-2.75)})`,
        maxWidth: "100%",
      },
      "&.Mui-focused": { color: theme.palette.text.primary },
    }),
  },
};

export const outlinedInputOverrides: Components<Theme>["MuiOutlinedInput"] = {
  styleOverrides: {
    // Pinned to the shared control height so a text field and the button beside it are the same box.
    sizeSmall: ({ theme }) => ({ minHeight: theme.controlHeights.md }),
    root: ({ theme }) => ({
      borderRadius: theme.radii.sm,
      backgroundColor: theme.palette.surfaces.card,
      ...theme.typography.body1,
      transition: theme.motion.fast,
      "& fieldset": { borderColor: theme.palette.line.border },
      "& .MuiOutlinedInput-notchedOutline > legend": { maxWidth: 0 },
      "&:hover fieldset": { borderColor: theme.palette.line.borderHi },
      "&.Mui-focused fieldset": {
        borderColor: theme.palette.info.main,
        borderWidth: 1,
      },
      "&.Mui-focused": { boxShadow: theme.shadows_custom.focus },
      "&.Mui-error fieldset, &.Mui-error:hover fieldset": {
        borderColor: theme.palette.error.main,
      },
      "&.Mui-disabled": { backgroundColor: theme.palette.surfaces.elevated },
      "& input:-webkit-autofill, & input:-webkit-autofill:hover, & input:-webkit-autofill:focus, & input:-webkit-autofill:active":
        {
          WebkitBoxShadow: `0 0 0 1000px ${theme.palette.surfaces.card} inset`,
          WebkitTextFillColor: (theme.vars ?? theme).palette.text.primary,
          caretColor: (theme.vars ?? theme).palette.text.primary,
          borderRadius: "inherit",
          transition: "background-color 5000s ease-in-out 0s",
        },
    }),
    input: { padding: "7.5px 12px", "&::placeholder": { opacity: 1 } },
    multiline: { padding: 12 },
  },
};

export const formHelperTextOverrides: Components<Theme>["MuiFormHelperText"] = {
  styleOverrides: {
    root: ({ theme }) => ({ ...theme.typography.caption, marginInline: 0, marginTop: 6 }),
  },
};

export const selectOverrides: Components<Theme>["MuiSelect"] = {
  defaultProps: { size: "small" },
};
