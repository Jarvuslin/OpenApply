import type { ReactElement } from "react";
import { Stack, Typography } from "@mui/material";

interface SectionHeadingProps {
  eyebrow: string;
  title: string;
  description?: string;
  /** Centered over a full-width section; left-aligned beside a visual. */
  align?: "center" | "left";
}

/** Small blue kicker, a display title and an optional muted line. */
export function SectionHeading(props: SectionHeadingProps): ReactElement {
  const { eyebrow, title, description, align = "center" } = props;
  const centered = align === "center";
  return (
    <Stack
      spacing={1.5}
      sx={{
        alignItems: centered ? "center" : "flex-start",
        textAlign: centered ? "center" : "left",
        maxWidth: centered ? 680 : "none",
        mx: centered ? "auto" : 0,
      }}
    >
      <Typography
        variant="overlineMuted"
        sx={{ color: "primary.main", letterSpacing: "0.12em", textTransform: "uppercase" }}
      >
        {eyebrow}
      </Typography>
      <Typography variant="displayMd" component="h2">
        {title}
      </Typography>
      {description && (
        <Typography variant="body1Muted" sx={{ fontSize: "1.0625rem", lineHeight: 1.55 }}>
          {description}
        </Typography>
      )}
    </Stack>
  );
}
