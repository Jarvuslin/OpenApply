import { type ReactElement, Suspense } from "react";
import type { Metadata } from "next";
import { JobIntakeView } from "@/components/features/telegram/job-intake-view";
import { DetailSkeleton } from "@/components/ui/data";
import { PageHeader, PageShell } from "@/components/ui/layout";

export const metadata: Metadata = { title: "Review linked job" };
interface JobIntakePageProps {
  params: Promise<{ id: string }>;
}

export default function JobIntakePage(props: JobIntakePageProps): ReactElement {
  return (
    <PageShell maxWidth="md">
      <PageHeader
        title="Review linked job"
        description="Prepare the saved candidate, then decide whether to queue an application."
      />
      <Suspense fallback={<DetailSkeleton />}>
        <IntakeContent params={props.params} />
      </Suspense>
    </PageShell>
  );
}
async function IntakeContent(props: JobIntakePageProps): Promise<ReactElement> {
  const { id } = await props.params;
  return <JobIntakeView id={id} />;
}
