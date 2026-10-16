import { type ReactElement, Suspense } from "react";
import type { Metadata } from "next";
import { DashboardHeader } from "@/components/features/workspace/dashboard/dashboard-header";
import { WorkspaceView } from "@/components/features/workspace/workspace-view";
import { TableSkeleton } from "@/components/ui/data";
import { PageShell } from "@/components/ui/layout";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage(): ReactElement {
  return (
    <PageShell maxWidth="lg">
      <DashboardHeader />
      <Suspense fallback={<TableSkeleton />}>
        <WorkspaceView />
      </Suspense>
    </PageShell>
  );
}
