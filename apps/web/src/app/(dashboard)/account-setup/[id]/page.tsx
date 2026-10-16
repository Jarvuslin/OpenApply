import { type ReactElement, Suspense } from "react";
import type { Metadata } from "next";
import { AccountSetupView } from "@/components/features/account-setup/account-setup-view";
import { DetailSkeleton } from "@/components/ui/data";
import { PageHeader, PageShell } from "@/components/ui/layout";

export const metadata: Metadata = { title: "Employer account" };
interface AccountSetupPageProps {
  params: Promise<{ id: string }>;
}

export default function AccountSetupDetailPage(props: AccountSetupPageProps): ReactElement {
  return (
    <PageShell maxWidth="md">
      <PageHeader
        title="Employer account"
        description="Review the saved account state and any step that needs you."
      />
      <Suspense fallback={<DetailSkeleton />}>
        <AccountContent params={props.params} />
      </Suspense>
    </PageShell>
  );
}

async function AccountContent({ params }: AccountSetupPageProps): Promise<ReactElement> {
  const { id } = await params;
  return <AccountSetupView id={id} />;
}
