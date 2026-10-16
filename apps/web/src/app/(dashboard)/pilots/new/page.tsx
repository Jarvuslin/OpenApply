import type { ReactElement } from "react";
import type { Metadata } from "next";
import { PilotWizard } from "@/components/features/pilots/pilot-wizard";
import { PageShell } from "@/components/ui/layout";

export const metadata: Metadata = { title: "New pilot" };

export default function NewPilotPage(): ReactElement {
  return (
    <PageShell maxWidth="lg">
      <PilotWizard />
    </PageShell>
  );
}
