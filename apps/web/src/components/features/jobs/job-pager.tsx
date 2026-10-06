import type { ReactNode } from "react";
import { Stack, Typography } from "@mui/material";
import type { Pagination } from "@openapply/contracts/pagination";
import type { Route } from "next";
import { LinkButton } from "@/components/ui/buttons";
import { jobsHref } from "./jobs-href";

interface JobPagerProps {
  pagination: Pagination;
  /** The current query, minus `page` - preserved so paging keeps the active filters. */
  params: Record<string, string>;
}

/**
 * Real `<a href>` paging, not the shared `PaginationFooter` - a crawler cannot click a React
 * handler, and a rows-per-page control would multiply the crawlable URLs for one index.
 */
export function JobPager(props: JobPagerProps): ReactNode {
  const { pagination, params } = props;
  const { page, totalPages, total } = pagination;
  if (totalPages <= 1) {
    return null;
  }

  const href = (target: number): Route => jobsHref(new URLSearchParams(params), target);

  return (
    <Stack
      direction="row"
      sx={{
        flexWrap: "wrap",
        gap: 1,
        alignItems: "center",
        justifyContent: "space-between",
        pt: 2,
      }}
    >
      <LinkButton href={href(page - 1)} disabled={page <= 1} size="small" variant="outlined">
        Previous
      </LinkButton>
      <Typography variant="captionMuted">
        Page {page} of {totalPages} · {total} jobs
      </Typography>
      <LinkButton
        href={href(page + 1)}
        disabled={page >= totalPages}
        size="small"
        variant="outlined"
      >
        Next
      </LinkButton>
    </Stack>
  );
}
