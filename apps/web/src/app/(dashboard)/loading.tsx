import type { ReactElement } from "react";
import { DetailSkeleton } from "@/components/ui/data";
import { PageShell } from "@/components/ui/layout";

export default function DashboardLoading(): ReactElement {
  return (
    <PageShell maxWidth="xl">
      <DetailSkeleton />
    </PageShell>
  );
}
