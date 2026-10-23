"use client";

import type { ReactElement } from "react";
import { ApplicationsPanel } from "./applications/applications-panel";
import { useWorkspaceUpdates } from "./use-workspace-updates";

export function ApplicationHistory(): ReactElement {
  useWorkspaceUpdates();
  return <ApplicationsPanel />;
}
