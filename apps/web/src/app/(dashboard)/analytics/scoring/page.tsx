import { type ReactElement, Suspense } from "react";
import type { Metadata } from "next";
import { ScoringEvaluationsView } from "@/components/features/scoring/scoring-evaluations-view";
import { TableSkeleton } from "@/components/ui/data";
import { PageHeader, PageShell } from "@/components/ui/layout";

export const metadata: Metadata = { title: "Scoring evaluations" };

export default function ScoringEvaluationsPage(): ReactElement {
  return (
    <PageShell maxWidth="lg">
      <PageHeader
        title="Scoring evaluations"
        description="Compare preserved scoring evidence separately from production decisions."
        backHref="/analytics"
        backLabel="Analytics"
      />
      <Suspense fallback={<TableSkeleton />}>
        <ScoringEvaluationsView />
      </Suspense>
    </PageShell>
  );
}
