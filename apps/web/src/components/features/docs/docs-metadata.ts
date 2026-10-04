import type { Metadata } from "next";
import { DOCS_NAV } from "./docs-nav";

/**
 * Per-page docs metadata, single-sourced from DOCS_NAV: sets the canonical URL and
 * article OpenGraph/Twitter cards. Pass `description` to override the nav card's blurb.
 */
export function buildDocsMetadata(slug: string, overrides?: { description?: string }): Metadata {
  const href = `/docs/${slug}`;
  const entry = DOCS_NAV.find((e) => e.href === href);
  const title = entry?.title ?? "Docs";
  const description = overrides?.description ?? entry?.description ?? "";
  const ogTitle = `${title} · OpenApply`;
  return {
    title,
    description,
    alternates: { canonical: href },
    openGraph: { type: "article", url: href, title: ogTitle, description },
    twitter: { title: ogTitle, description },
  };
}
