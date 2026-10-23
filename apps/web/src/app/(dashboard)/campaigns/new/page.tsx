import type { ReactElement } from "react";
import type { Metadata } from "next";
import { CampaignComposer } from "@/components/features/campaigns";
import { PageHeader, PageShell } from "@/components/ui/layout";

export const metadata: Metadata = { title: "New search" };

export default function NewCampaignPage(): ReactElement {
  return (
    <PageShell>
      <PageHeader
        title="Start a new search"
        description="Search a job board, score matches, and optionally batch-apply."
      />
      <CampaignComposer />
    </PageShell>
  );
}
