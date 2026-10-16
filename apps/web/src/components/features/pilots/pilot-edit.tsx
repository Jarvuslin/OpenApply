"use client";

import type { ReactElement } from "react";
import { Alert, LinearProgress } from "@mui/material";
import { useApiQuery } from "@/api/hooks";
import { pilotQueries } from "@/api/pilot-queries";
import { PilotWizard } from "./pilot-wizard";

interface PilotEditProps {
  id: string;
}

export function PilotEdit({ id }: PilotEditProps): ReactElement {
  const pilot = useApiQuery(pilotQueries.detail(id));
  if (pilot.isLoading) return <LinearProgress aria-label="Loading pilot" />;
  if (!pilot.data) return <Alert severity="error">This pilot no longer exists.</Alert>;
  return <PilotWizard pilot={pilot.data} />;
}
