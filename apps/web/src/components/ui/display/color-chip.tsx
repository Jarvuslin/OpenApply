import type { ReactElement } from "react";
import { Chip, type ChipProps } from "@mui/material";

interface ColorChipProps<T extends string> {
  value: T;
  colors: Readonly<Record<T, ChipProps["color"]>>;
  /** Defaults to the raw value. */
  label?: string;
  size?: ChipProps["size"];
  variant?: ChipProps["variant"];
  sx?: ChipProps["sx"];
}

export function ColorChip<T extends string>(props: ColorChipProps<T>): ReactElement {
  const { value, colors, label, size = "small", variant = "filled", sx = [] } = props;
  return (
    <Chip
      size={size}
      variant={variant}
      label={label ?? value}
      color={colors[value]}
      sx={[
        (theme) => ({
          borderRadius: theme.radii.pill,
          "&::before": {
            content: '""',
            width: theme.spacing(0.75),
            height: theme.spacing(0.75),
            marginLeft: theme.spacing(1),
            flexShrink: 0,
            borderRadius: theme.radii.pill,
            backgroundColor: "currentColor",
          },
          "& .MuiChip-label": { paddingLeft: theme.spacing(0.75) },
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    />
  );
}
