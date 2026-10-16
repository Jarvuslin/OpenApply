"use client";

import { type ReactElement, type ReactNode, useEffect, useRef, useState } from "react";
import { Box } from "@mui/material";

const COUNT_MS = 500;

/** Motion only for people who have not asked their system to reduce it. */
const MOTION_OK = "@media (prefers-reduced-motion: no-preference)";

interface SpinProps {
  children: ReactNode;
}

/** Turns an icon, like a loader, continuously while work is in progress. */
export function Spin({ children }: SpinProps): ReactElement {
  return (
    <Box
      component="span"
      sx={{
        display: "inline-flex",
        "@keyframes pilot-spin": { to: { transform: "rotate(360deg)" } },
        [MOTION_OK]: { animation: "pilot-spin 1s linear infinite" },
      }}
    >
      {children}
    </Box>
  );
}

interface PulseDotProps {
  color: string;
  pulsing: boolean;
}

/** A status dot with a soft ring that breathes while something is running. */
export function PulseDot({ color, pulsing }: PulseDotProps): ReactElement {
  return (
    <Box
      sx={{
        position: "relative",
        width: 7,
        height: 7,
        borderRadius: "50%",
        bgcolor: color,
        flexShrink: 0,
        "@keyframes pilot-pulse": {
          from: { transform: "scale(1)", opacity: 0.6 },
          to: { transform: "scale(2.6)", opacity: 0 },
        },
        "&::after": pulsing
          ? {
              content: '""',
              position: "absolute",
              inset: 0,
              borderRadius: "50%",
              bgcolor: color,
              [MOTION_OK]: { animation: "pilot-pulse 1.4s ease-out infinite" },
            }
          : undefined,
      }}
    />
  );
}

interface CountProps {
  value: number;
}

/** A number that counts up or down to its new value instead of jumping. */
export function Count({ value }: CountProps): ReactElement {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = value;
      setShown(value);
      return;
    }
    const began = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - began) / COUNT_MS);
      const eased = 1 - (1 - progress) ** 3;
      const next = Math.round(start + (value - start) * eased);
      from.current = next;
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <>{shown}</>;
}

interface RiseProps {
  children: ReactNode;
  /** Staggers a list: each item waits a little longer than the one before. */
  delayMs?: number;
}

/** Fades and lifts content in when it first appears, like a step finishing or results arriving. */
export function Rise({ children, delayMs = 0 }: RiseProps): ReactElement {
  return (
    <Box
      sx={{
        "@keyframes pilot-rise": {
          from: { opacity: 0, transform: "translateY(6px)" },
          to: { opacity: 1, transform: "none" },
        },
        [MOTION_OK]: {
          animation: `pilot-rise 320ms cubic-bezier(0.2,0.8,0.2,1) ${delayMs}ms both`,
        },
      }}
    >
      {children}
    </Box>
  );
}
