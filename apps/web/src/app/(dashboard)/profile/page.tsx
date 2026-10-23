import type { ReactElement } from "react";
import type { Metadata } from "next";
import { SettingsContent } from "@/components/features/settings";
import { PageShell } from "@/components/ui/layout";

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage(): ReactElement {
  return (
    <PageShell maxWidth="lg">
      <SettingsContent />
    </PageShell>
  );
}
