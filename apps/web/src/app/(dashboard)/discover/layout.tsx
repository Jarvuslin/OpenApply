import type { ReactElement, ReactNode } from "react";
import { PageHeader, PageShell } from "@/components/ui/layout";

export default function JobsLayout({ children }: { children: ReactNode }): ReactElement {
  return (
    <PageShell>
      <PageHeader title="Jobs" description="Find openings and add them to your queue." />
      {children}
    </PageShell>
  );
}
