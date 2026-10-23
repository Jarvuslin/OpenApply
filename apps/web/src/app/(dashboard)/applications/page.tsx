import { type ReactElement, Suspense } from "react";
import { LinearProgress } from "@mui/material";
import type { Metadata } from "next";
import { ApplicationsTabs } from "@/components/features/applications/applications-tabs";
import { ApplicationHistory } from "@/components/features/workspace/application-history";
import { PageHeader, PageShell } from "@/components/ui/layout";

export const metadata: Metadata = { title: "Applications" };

export default function ApplicationsPage(): ReactElement {
  return (
    <PageShell maxWidth="lg">
      <PageHeader
        title="Applications"
        description="Your submitted applications, status, and saved records."
      />
      <ApplicationsTabs />
      <Suspense fallback={<LinearProgress />}>
        <ApplicationHistory />
      </Suspense>
    </PageShell>
  );
}
