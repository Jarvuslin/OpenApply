import { type ReactElement, Suspense } from "react";
import type { Metadata } from "next";
import { ScoringEvaluationView } from "@/components/features/scoring/scoring-evaluation-view";
import { DetailSkeleton } from "@/components/ui/data";
import { PageHeader, PageShell } from "@/components/ui/layout";

export const metadata: Metadata = { title: "Scoring evaluation" };

interface ScoringEvaluationPageProps {
  params: Promise<{ id: string }>;
}

async function Evaluation(props: ScoringEvaluationPageProps): Promise<ReactElement> {
  const { id } = await props.params;
  return <ScoringEvaluationView runId={id} />;
}

export default function ScoringEvaluationPage(props: ScoringEvaluationPageProps): ReactElement {
  return (
    <PageShell maxWidth="lg">
      <PageHeader
        title="Scoring evaluation"
        backHref="/analytics/scoring"
        backLabel="Scoring evaluations"
      />
      <Suspense fallback={<DetailSkeleton />}>
        <Evaluation params={props.params} />
      </Suspense>
    </PageShell>
  );
}
