import type { ReactElement, ReactNode } from "react";
import { PageHeader, PageShell } from "@/components/ui/layout";

interface SettingsLayoutProps {
  children: ReactNode;
}

export default function SettingsLayout(props: SettingsLayoutProps): ReactElement {
  const { children } = props;
  return (
    <PageShell>
      <PageHeader title="Settings" description="Your agent, Gmail and Telegram connections." />
      {children}
    </PageShell>
  );
}
