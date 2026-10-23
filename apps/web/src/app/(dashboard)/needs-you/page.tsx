import { type ReactElement, Suspense } from "react";
import { LinearProgress } from "@mui/material";
import type { Metadata } from "next";
import { NeedsYouView } from "@/components/features/questions/needs-you-view";
import { PageHeader, PageShell } from "@/components/ui/layout";

export const metadata: Metadata = { title: "Needs you" };

export default function NeedsYouPage(): ReactElement {
  return (
    <PageShell maxWidth="md">
      <PageHeader
        title="Needs you"
        description="Review application questions and requests that need your answer."
      />
      <Suspense fallback={<LinearProgress />}>
        <NeedsYouView />
      </Suspense>
    </PageShell>
  );
}
