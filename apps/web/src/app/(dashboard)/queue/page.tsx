import { type ReactElement, Suspense } from "react";
import { LinearProgress } from "@mui/material";
import type { Metadata } from "next";
import { QueueView } from "@/components/features/queue/queue-view";
import { PageHeader, PageShell } from "@/components/ui/layout";

export const metadata: Metadata = { title: "Queue" };

export default function QueuePage(): ReactElement {
  return (
    <PageShell maxWidth="lg">
      <PageHeader
        title="Queue"
        description="Follow your applications and control the work running on your computer."
      />
      <Suspense fallback={<LinearProgress />}>
        <QueueView />
      </Suspense>
    </PageShell>
  );
}
