import type { ReactElement } from "react";
import { Plus } from "lucide-react";
import type { Metadata, Route } from "next";
import { PilotsList } from "@/components/features/pilots/pilots-list";
import { LinkButton } from "@/components/ui/buttons";
import { PageHeader, PageShell } from "@/components/ui/layout";

export const metadata: Metadata = { title: "Pilots" };

export default function PilotsPage(): ReactElement {
  return (
    <PageShell maxWidth="lg">
      <PageHeader
        title="Pilots"
        description="Each pilot looks for new jobs that match your rules and adds them to your queue."
        actions={
          <LinkButton
            href={"/pilots/new" as Route}
            variant="contained"
            startIcon={<Plus size={15} aria-hidden />}
          >
            New pilot
          </LinkButton>
        }
      />
      <PilotsList />
    </PageShell>
  );
}
