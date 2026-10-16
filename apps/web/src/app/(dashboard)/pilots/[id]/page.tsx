import { type ReactElement, Suspense } from "react";
import type { Metadata } from "next";
import { PilotDetail } from "@/components/features/pilots/pilot-detail";
import { DetailSkeleton } from "@/components/ui/data";
import { PageShell } from "@/components/ui/layout";

export const metadata: Metadata = { title: "Pilot" };

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function PilotPage(props: PageProps): ReactElement {
  return (
    <PageShell maxWidth="lg">
      <Suspense fallback={<DetailSkeleton />}>
        <Pilot params={props.params} />
      </Suspense>
    </PageShell>
  );
}

async function Pilot(props: PageProps): Promise<ReactElement> {
  const { id } = await props.params;
  return <PilotDetail id={id} />;
}
