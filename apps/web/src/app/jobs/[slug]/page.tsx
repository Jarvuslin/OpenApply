import { cache, type ReactElement, Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { api } from "@/api/client";
import { dataOrThrow } from "@/api/error";
import { getPublicFetchOptions } from "@/api/server";
import { JobDetail } from "@/components/features/jobs";
import { JsonLd } from "@/components/seo/json-ld";
import { DetailSkeleton } from "@/components/ui/data";
import { PUBLIC_SITE_ENABLED } from "@/lib/public-site";
import { breadcrumbLd, jobPostingLd } from "@/lib/structured-data";

interface JobPageProps {
  params: Promise<{ slug: string }>;
}

/** Called by both generateMetadata and the page; `cache` collapses that to one request. */
const getJob = cache(async (slug: string) =>
  dataOrThrow(
    await api.public.jobs({ slug }).get(await getPublicFetchOptions()),
    "Couldn't load this job listing",
  ),
);

export function generateMetadata(props: JobPageProps): Metadata | Promise<Metadata> {
  // The disabled page already returns 404; its metadata must stay static too.
  if (!PUBLIC_SITE_ENABLED) {
    return { title: "Job not found", robots: { index: false, follow: false } };
  }
  return getJobMetadata(props);
}

async function getJobMetadata(props: JobPageProps): Promise<Metadata> {
  const { slug } = await props.params;
  const job = await getJob(slug);
  if (!job) {
    return { title: "Job not found" };
  }

  const where = job.remote ? "Remote" : (job.location ?? "");
  const title = `${job.title} at ${job.company}${where ? ` · ${where}` : ""}`;

  return {
    title,
    description:
      job.descriptionExcerpt ??
      `${job.title} at ${job.company}. Apply with your own OpenApply AI agent.`,
    alternates: { canonical: `/jobs/${job.slug}` },
    openGraph: { title, type: "article" },
  };
}

export default function JobPage(props: JobPageProps): ReactElement {
  if (!PUBLIC_SITE_ENABLED) notFound();
  // The whole page is the listing, so the jobs layout is the shared App Shell.
  return (
    <Suspense fallback={<DetailSkeleton heights={[160, 400]} />}>
      <Job params={props.params} />
    </Suspense>
  );
}

async function Job(props: JobPageProps): Promise<ReactElement> {
  const { slug } = await props.params;
  const job = await getJob(slug);
  if (!job) {
    notFound();
  }

  return (
    <>
      <JsonLd
        data={[
          jobPostingLd({ ...job, firstSeenAt: new Date(job.firstSeenAt) }),
          breadcrumbLd([
            { name: "Home", path: "/" },
            { name: "Jobs", path: "/jobs" },
            { name: job.title, path: `/jobs/${job.slug}` },
          ]),
        ]}
      />
      <JobDetail job={job} />
    </>
  );
}
