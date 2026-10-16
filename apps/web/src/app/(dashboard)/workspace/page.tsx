import { type ReactElement, Suspense } from "react";
import { redirect } from "next/navigation";
import { workspaceDestination } from "@/utils/workspace-destination";

interface WorkspacePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default function WorkspacePage(props: WorkspacePageProps): ReactElement {
  return (
    <Suspense>
      <WorkspaceRedirect {...props} />
    </Suspense>
  );
}

async function WorkspaceRedirect({ searchParams }: WorkspacePageProps): Promise<never> {
  redirect(workspaceDestination(await searchParams));
}
