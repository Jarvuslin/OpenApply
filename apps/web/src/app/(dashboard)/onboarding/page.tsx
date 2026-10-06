import type { ReactElement } from "react";
import type { Metadata } from "next";
import { OnboardingWizard } from "@/components/features/onboarding/onboarding-wizard";
import { PageHeader, PageShell } from "@/components/ui/layout";

export const metadata: Metadata = { title: "Onboarding" };

export default function OnboardingPage(): ReactElement {
  return (
    <PageShell maxWidth="md">
      <PageHeader
        eyebrow="First run"
        title="Welcome to OpenApply"
        description="Connect your agent, import your resume, and review your answers. Prefer to start manually? You can connect later."
      />
      <OnboardingWizard />
    </PageShell>
  );
}
