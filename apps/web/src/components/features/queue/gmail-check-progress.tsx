"use client";

import { type ReactElement, useEffect, useState } from "react";
import { Typography } from "@mui/material";

export function GmailCheckProgress(): ReactElement {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1_000));
    }, 1_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <Typography variant="captionMuted" aria-live="off">
      Waiting for the connector result · {elapsedSeconds} seconds elapsed
    </Typography>
  );
}
