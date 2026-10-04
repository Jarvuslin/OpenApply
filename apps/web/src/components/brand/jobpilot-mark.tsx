import type { ReactElement } from "react";
import { Box } from "@mui/material";

interface JobPilotMarkProps {
  size?: number;
}

/** OpenApply's open frame and outward arrow. The export retains the upstream internal name. */
export function JobPilotMark({ size = 36 }: JobPilotMarkProps): ReactElement {
  return (
    <Box
      component="svg"
      aria-hidden
      viewBox="0 0 100 100"
      sx={{ width: size, height: size, display: "block", color: "text.primary" }}
    >
      <rect x="3" y="3" width="94" height="94" rx="24" fill="currentColor" />
      <path
        d="M57 28H30V72H72V48M50 50L74 26M58 26H74V42"
        fill="none"
        stroke="white"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Box>
  );
}
