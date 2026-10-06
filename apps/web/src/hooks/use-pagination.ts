"use client";

import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZE_OPTIONS,
  type Pagination as PageMeta,
  type PaginationQuery,
} from "@openapply/contracts/pagination";
import { useSearchParams } from "next/navigation";
import { useSearchParamWriter } from "@/hooks/use-search-param-writer";
import { pageParam, pageSizeParam } from "@/utils/search-params";

interface UsePaginationParamsOptions {
  /** Rows per page before the user picks one. Defaults to the API's own default. */
  pageSize?: number;
  /** Namespaces the params (`?jobsPage=`), so two pagers can share a route. */
  prefix?: string;
  /** Set on RSC pages, whose server fetch only re-runs on a real navigation. */
  navigate?: boolean;
}

export interface PaginationParams {
  page: number;
  pageSize: number;
  setPage: (page: number) => void;
  /** Also returns to page 1 - the old offset means nothing at a new page size. */
  setPageSize: (pageSize: number) => void;
  /**
   * Write URL-backed filter params and return to page 1, in one update. Use this rather than a
   * filter setter followed by `setPage(1)`: the old offset means nothing under a new filter, and
   * two writes would each start from the same URL snapshot, so the second undoes the first.
   */
  setFilters: (updates: Record<string, string | null>) => void;
  /** Drops straight into a query factory: `campaignQueries.list(query)`. */
  query: PaginationQuery;
}

/** `?page=1` and the default size are implicit, so the tidy URL is the one with no params. */
function paramValue(value: number, fallback: number): string | null {
  return value === fallback ? null : String(value);
}

/**
 * URL-backed page state for a server-paginated list. The URL is the source of truth, so a
 * refresh or a shared link restores the exact page. Pair with {@link PaginationFooter}.
 */
export function usePaginationParams(options: UsePaginationParamsOptions = {}): PaginationParams {
  const { pageSize: defaultPageSize = DEFAULT_PAGE_SIZE, prefix, navigate } = options;
  const pageKey = prefix ? `${prefix}Page` : "page";
  const sizeKey = prefix ? `${prefix}PageSize` : "pageSize";

  const searchParams = useSearchParams();
  const write = useSearchParamWriter(navigate ? "navigate" : "shallow");

  const page = pageParam(searchParams.get(pageKey) ?? undefined);
  const pageSize = pageSizeParam(searchParams.get(sizeKey) ?? undefined, defaultPageSize);

  return {
    page,
    pageSize,
    // A no-op write still calls replaceState, which re-renders every useSearchParams subscriber -
    // and filter handlers reset to page 1 on every keystroke.
    setPage: (next) => {
      if (next !== page) {
        write({ [pageKey]: paramValue(next, 1) });
      }
    },
    // One write, not two: separate setters would each start from the same URL snapshot.
    setPageSize: (next) => write({ [sizeKey]: paramValue(next, defaultPageSize), [pageKey]: null }),
    setFilters: (updates) => write({ ...updates, [pageKey]: null }),
    query: { page, limit: pageSize },
  };
}

/** MUI's 0-based grid model, structurally typed so this file never imports the grid package. */
interface GridPaginationModel {
  page: number;
  pageSize: number;
}

/**
 * Bridges {@link usePaginationParams} onto a `<DataTable>`: the grid keeps its own footer (range,
 * total, rows-per-page) but pages server-side off the same URL params as every other list.
 */
export type GridPaginationProps = ReturnType<typeof gridPagination>;

/**
 * Build the props for a `<DataTable>`'s pagination, from {@link usePaginationParams} plus the
 * `pagination` block of the response - which is absent until the first page loads.
 */
export function gridPagination(params: PaginationParams, meta: PageMeta | undefined) {
  return {
    paginationMode: "server" as const,
    rowCount: meta?.total ?? 0,
    pageSizeOptions: PAGE_SIZE_OPTIONS,
    paginationModel: { page: params.page - 1, pageSize: params.pageSize },
    onPaginationModelChange: (model: GridPaginationModel) => {
      if (model.pageSize !== params.pageSize) {
        params.setPageSize(model.pageSize);
        return;
      }
      params.setPage(model.page + 1);
    },
  };
}
