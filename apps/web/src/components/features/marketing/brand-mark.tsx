"use client";

import type { ReactElement } from "react";
import { Link, Typography } from "@mui/material";
import type { Route } from "next";
import { fontFamilies } from "@/theme";

interface BrandMarkProps {
  /** Where the mark points. Home by default - a logo that goes nowhere reads as broken. */
  href?: Route;
}

/** The serif OpenApply wordmark, the same one the app sidebar shows. */
export function BrandMark(props: BrandMarkProps): ReactElement {
  const { href = "/" as Route } = props;
  return (
    <Link href={href} aria-label="OpenApply home" underline="none" color="text.primary">
      <Typography
        component="span"
        sx={{
          fontFamily: fontFamilies.wordmark,
          fontWeight: 700,
          fontSize: "1.375rem",
          lineHeight: "28px",
          letterSpacing: "-0.01em",
        }}
      >
        OpenApply
      </Typography>
    </Link>
  );
}
