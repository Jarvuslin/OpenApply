"use client";

import type { ReactElement } from "react";
import { OverviewPanel } from "./overview-panel";
import { useWorkspaceUpdates } from "./use-workspace-updates";

export function WorkspaceView(): ReactElement {
  useWorkspaceUpdates();
  return <OverviewPanel />;
}
