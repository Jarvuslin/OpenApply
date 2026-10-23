import { type ReactElement, Suspense } from "react";
import { redirect } from "next/navigation";

interface MvpPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default function MvpPage(props: MvpPageProps): ReactElement {
  return (
    <Suspense>
      <DiscoverRedirect {...props} />
    </Suspense>
  );
}

async function DiscoverRedirect({ searchParams }: MvpPageProps): Promise<never> {
  const params = await searchParams;
  const job = typeof params.job === "string" ? params.job : null;
  redirect(job ? `/discover?job=${encodeURIComponent(job)}` : "/discover");
}
