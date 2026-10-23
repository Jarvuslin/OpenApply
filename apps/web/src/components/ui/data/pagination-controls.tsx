"use client";

import type { ReactNode } from "react";
import type { Pagination as PageMeta } from "@openapply/contracts/pagination";
import { usePaginationParams } from "@/hooks/use-pagination";
import { PaginationFooter } from "./pagination-footer";

interface PaginationControlsProps {
  /** The `pagination` block of a paginated API response. */
  pagination: PageMeta;
}

/**
 * Self-contained pager for a server-rendered page, which fetches its own rows and so has no
 * {@link usePaginationParams} instance to hand down. Its fetch only re-runs on a real
 * navigation, hence `navigate`. Client components pass their setters to
 * {@link PaginationFooter} directly instead.
 */
export function PaginationControls(props: PaginationControlsProps): ReactNode {
  const { pagination } = props;
  const { setPage, setPageSize } = usePaginationParams({ navigate: true });

  return (
    <PaginationFooter
      pagination={pagination}
      onPageChange={setPage}
      onPageSizeChange={setPageSize}
    />
  );
}
