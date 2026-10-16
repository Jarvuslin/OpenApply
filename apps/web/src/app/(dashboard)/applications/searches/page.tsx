import { type ReactElement, Suspense } from "react";
import type { Metadata } from "next";
import { ApplicationsTabs } from "@/components/features/applications/applications-tabs";
import { CampaignGroups } from "@/components/features/workspace/dashboard/campaign-groups";
import { TableSkeleton } from "@/components/ui/data";
import { PageHeader, PageShell } from "@/components/ui/layout";

export const metadata: Metadata = { title: "Searches" };

export default function SearchesPage(): ReactElement {
  return (
    <PageShell maxWidth="lg">
      <PageHeader
        title="Applications"
        description="Searches you saved. Auto-apply searches add their matches to your queue."
      />
      <ApplicationsTabs />
      <Suspense fallback={<TableSkeleton />}>
        <CampaignGroups />
      </Suspense>
    </PageShell>
  );
}
