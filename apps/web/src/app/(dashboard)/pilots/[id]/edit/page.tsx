import { type ReactElement, Suspense } from "react";
import type { Metadata } from "next";
import { PilotEdit } from "@/components/features/pilots/pilot-edit";
import { DetailSkeleton } from "@/components/ui/data";
import { PageShell } from "@/components/ui/layout";

export const metadata: Metadata = { title: "Edit pilot" };

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function EditPilotPage(props: PageProps): ReactElement {
  return (
    <PageShell maxWidth="lg">
      <Suspense fallback={<DetailSkeleton />}>
        <Edit params={props.params} />
      </Suspense>
    </PageShell>
  );
}

async function Edit(props: PageProps): Promise<ReactElement> {
  const { id } = await props.params;
  return <PilotEdit id={id} />;
}
