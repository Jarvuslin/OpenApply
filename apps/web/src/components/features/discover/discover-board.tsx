"use client";

import { type ReactElement, useEffect, useState } from "react";
import { BookmarkBorder, SearchOff } from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  LinearProgress,
  MenuItem,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from "@mui/material";
import type { JobListingQuery } from "@openapply/contracts/job-listing";
import { useSearchParams } from "next/navigation";
import { discoverQueries } from "@/api/discover-queries";
import { useApiQuery } from "@/api/hooks";
import { userQueries } from "@/api/queries";
import { PaginationFooter } from "@/components/ui/data";
import { usePaginationParams } from "@/hooks/use-pagination";
import { useSearchParamWriter } from "@/hooks/use-search-param-writer";
import { ActiveFilters } from "./active-filters";
import {
  EMPTY_FILTERS,
  filterError,
  filterParams,
  filtersForMarket,
  filtersFromParams,
  filtersFromProfile,
  listingFilters,
} from "./discover-filters";
import { FilterPanel } from "./filter-panel";
import { FindMoreJobs } from "./find-more-jobs";
import type { DiscoverFilters } from "./job-board-types";
import { JobCard } from "./job-card";
import { JobDetail } from "./job-detail";
import { SavedApply } from "./saved-apply";
import { SearchToolbar } from "./search-toolbar";
import { useAddToQueue } from "./use-add-to-queue";
import { useDiscoverActions } from "./use-discover-actions";
import { useDiscoverPaging } from "./use-discover-paging";

const DISCOVER_PAGE_SIZE = 12;

export function DiscoverBoard(): ReactElement {
  const params = useSearchParams();
  const write = useSearchParamWriter();
  const pagination = usePaginationParams({ pageSize: DISCOVER_PAGE_SIZE });
  const profile = useApiQuery(userQueries.detail());
  const savedCount = useApiQuery(discoverQueries.count());
  const saved = params.get("tab") === "saved";
  const initialized = params.has("filters");
  const defaults = profile.data ? filtersFromProfile(profile.data.user) : EMPTY_FILTERS;
  const filters = initialized
    ? filtersFromParams(new URLSearchParams(params.toString()))
    : defaults;
  const filterKey = JSON.stringify(filters);
  const keyword = params.get("q") ?? "";
  const [findMoreOpen, setFindMoreOpen] = useState(false);
  const [error, setError] = useState("");
  const actions = useDiscoverActions(setError);
  const queue = useAddToQueue();
  const sort = params.get("sort") === "salary_desc" ? "salary_desc" : "newest";
  const slug = params.get("job");
  const queryError = saved ? null : filterError(filters);
  const indexedBefore = params.get("indexedBefore") ?? undefined;
  const request: JobListingQuery = {
    ...pagination.query,
    limit: DISCOVER_PAGE_SIZE,
    ...(!saved && !queryError && listingFilters(filters)),
    q: !saved && keyword.trim() ? keyword.trim() : undefined,
    sort: saved ? "newest" : sort,
    indexedBefore,
  };
  const { jobs, updates } = useDiscoverPaging(
    request,
    saved,
    saved || (!queryError && (initialized || !!profile.data)),
  );
  const detail = useApiQuery(discoverQueries.detail(slug ?? ""), { enabled: !!slug });
  const results = queryError ? undefined : jobs.data;

  useEffect(() => {
    if (!initialized && profile.data)
      pagination.setFilters({
        ...filterParams(filtersFromProfile(profile.data.user)),
        pageSize: null,
        indexedBefore: null,
      });
  }, [initialized, profile.data, pagination.setFilters]);
  useEffect(() => {
    if (!initialized) return;
    const updates: Record<string, string | null> = {};
    if (params.has("pageSize")) updates.pageSize = null;
    if (!indexedBefore && results?.indexedBefore && !jobs.isFetching) {
      updates.indexedBefore = new Date(results.indexedBefore).toISOString();
    }
    if (Object.keys(updates).length > 0) write(updates);
  }, [initialized, indexedBefore, results?.indexedBefore, jobs.isFetching, params, write]);
  useEffect(() => {
    if (results && pagination.page > Math.max(1, results.pagination.totalPages)) {
      pagination.setPage(Math.max(1, results.pagination.totalPages));
    }
  }, [results, pagination.page, pagination.setPage]);

  function setFilters(values: Record<string, string | null>): void {
    pagination.setFilters({ ...values, indexedBefore: null });
  }
  function changeFilters(next: DiscoverFilters): void {
    setError("");
    setFilters({
      ...filterParams(next),
      sort: next.salaryMin || next.salaryMax ? sort : null,
    });
  }
  function reset(): void {
    if (!profile.data) return;
    setError("");
    setFilters({ ...filterParams(defaults), q: null, sort: null });
  }
  function clear(): void {
    setError("");
    setFilters({ ...filterParams(EMPTY_FILTERS), q: null, sort: null });
  }
  function selectMarket(market: "CA" | "US" | "CA_US" | "US_REMOTE"): void {
    changeFilters(filtersForMarket(filters, market));
  }
  const customized = filterKey !== JSON.stringify(defaults) || !!keyword;
  const total = results?.pagination.total;
  let resultsLabel = "Finding openings…";
  if (queryError) resultsLabel = "Check your filters";
  if (jobs.error) resultsLabel = "Jobs unavailable";
  if (total !== undefined) {
    const noun = total === 1 ? "job" : "jobs";
    const label = saved ? `saved ${noun}` : `${noun} found`;
    resultsLabel = `${total.toLocaleString()} ${label}`;
  }
  const detailSaved = detail.data?.isSaved ?? false;
  const detailApplied = detail.data?.isApplied ?? false;
  const detailCanUndoApplied = detail.data?.canUndoApplied ?? false;
  const loading = jobs.isLoading || (!initialized && profile.isLoading);
  const filterPanel = (
    <FilterPanel
      filters={filters}
      onChange={changeFilters}
      onReset={reset}
      loading={profile.isLoading}
      profileDefaultsAvailable={!!profile.data}
    />
  );

  return (
    <Stack spacing={3}>
      <Tabs
        value={saved ? "saved" : "explore"}
        onChange={(_, value: string) =>
          setFilters({ tab: value === "saved" ? "saved" : null, job: null })
        }
        aria-label="Job lists"
        sx={{ borderBottom: 1, borderColor: "divider" }}
      >
        <Tab value="explore" label="Explore jobs" />
        <Tab
          value="saved"
          label={`Saved jobs${savedCount.data ? ` · ${savedCount.data.count}` : ""}`}
          icon={<BookmarkBorder fontSize="sm" />}
          iconPosition="start"
        />
      </Tabs>
      {!saved && (
        <SearchToolbar
          filters={filters}
          onChange={changeFilters}
          keyword={keyword}
          onKeywordChange={(value) => setFilters({ q: value || null })}
          onReset={reset}
          onClear={clear}
          onMarket={selectMarket}
          customized={customized}
          loading={profile.isLoading}
        />
      )}
      {saved && (
        <Stack
          direction={{ xs: "column", md: "row" }}
          spacing={2}
          sx={{ justifyContent: "space-between" }}
        >
          <Stack spacing={0.5}>
            <Typography variant="h3">Your application to-do list</Typography>
            <Typography color="text.secondary">
              A place for the roles you want to come back to. Only you can see this list.
            </Typography>
          </Stack>
          <SavedApply count={savedCount.data?.count ?? 0} />
        </Stack>
      )}
      {profile.error && !saved && (
        <Alert
          severity="warning"
          action={<Button onClick={() => void profile.refetch()}>Retry</Button>}
        >
          Your profile filters couldn’t load.{" "}
          <Button onClick={() => setFilters(filterParams(EMPTY_FILTERS))}>Browse all jobs</Button>
        </Alert>
      )}
      {(error || queryError) && (
        <Alert severity="error" onClose={() => setError("")}>
          {error || queryError}
        </Alert>
      )}
      {savedCount.error && (
        <Alert
          severity="warning"
          action={<Button onClick={() => void savedCount.refetch()}>Retry</Button>}
        >
          Could not load your saved-job count.
        </Alert>
      )}
      <Box
        sx={(theme) => ({
          display: "grid",
          gridTemplateColumns: {
            xs: "minmax(0, 1fr)",
            lg: saved ? "minmax(0, 1fr)" : `${theme.spacing(30)} minmax(0, 1fr)`,
          },
          gap: 3,
          alignItems: "start",
        })}
      >
        {!saved && (
          <Box component="aside" aria-label="Job filters">
            {filterPanel}
          </Box>
        )}
        <Stack spacing={2} sx={{ minWidth: 0 }}>
          <Stack
            direction="row"
            spacing={1.5}
            sx={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 1 }}
          >
            <Stack spacing={0.5}>
              <Typography variant="h4" aria-live="polite">
                {resultsLabel}
              </Typography>
              {results && (
                <Typography variant="captionMuted">
                  {results.indexedTotal.toLocaleString()} jobs indexed across all locations
                </Typography>
              )}
            </Stack>
            {!saved && (
              <TextField
                select
                size="small"
                label="Sort by"
                value={sort}
                onChange={(event) => setFilters({ sort: event.target.value })}
                helperText={
                  !filters.salaryMin && !filters.salaryMax
                    ? "Set a salary range to compare pay in one currency and period."
                    : undefined
                }
                sx={{ minWidth: 180 }}
              >
                <MenuItem value="newest">Newest first</MenuItem>
                <MenuItem value="salary_desc" disabled={!filters.salaryMin && !filters.salaryMax}>
                  Highest salary
                </MenuItem>
              </TextField>
            )}
          </Stack>
          {!saved && <ActiveFilters filters={filters} onChange={changeFilters} />}
          {!saved && !queryError && (updates.data?.newCount ?? 0) > 0 && (
            <Alert
              severity="info"
              action={<Button onClick={() => setFilters({})}>Show new jobs</Button>}
            >
              {updates.data?.newCount.toLocaleString()} new jobs match your filters. Your current
              page has stayed in place.
            </Alert>
          )}
          {jobs.isFetching && !loading && <LinearProgress aria-label="Updating jobs" />}
          {jobs.error && (
            <Alert
              severity="error"
              action={<Button onClick={() => void jobs.refetch()}>Retry</Button>}
            >
              Could not load jobs. Your filters and saved jobs are unchanged.
            </Alert>
          )}
          {loading && (
            <Stack spacing={1.5} aria-label="Loading jobs">
              {["one", "two", "three", "four", "five", "six"].map((key) => (
                <Skeleton
                  key={key}
                  variant="rounded"
                  sx={{ height: (theme) => theme.spacing(18) }}
                />
              ))}
            </Stack>
          )}
          {!loading && results?.items.length === 0 && (
            <Stack
              spacing={1.5}
              sx={{
                p: { xs: 4, md: 8 },
                alignItems: "center",
                textAlign: "center",
              }}
            >
              {saved ? <BookmarkBorder color="action" /> : <SearchOff color="action" />}
              <Typography variant="h3">
                {saved
                  ? "Good opportunities deserve a second look."
                  : "No openings with these filters yet."}
              </Typography>
              <Typography color="text.secondary">
                {saved
                  ? "Select the bookmark on any job to add it here. Come back when you’re ready to apply."
                  : "Try fewer titles, another location, or a wider range of levels."}
              </Typography>
              <Button
                variant="outlined"
                onClick={() =>
                  saved
                    ? setFilters({ tab: null })
                    : setFilters({ ...filterParams(EMPTY_FILTERS), q: null, sort: null })
                }
              >
                {saved ? "Explore jobs" : "Clear all filters"}
              </Button>
              {!saved && <Button onClick={() => setFindMoreOpen(true)}>Find more jobs</Button>}
            </Stack>
          )}
          <Stack spacing={1.5}>
            {results?.items.map((job) => (
              <JobCard
                key={job.id}
                job={{
                  id: job.id,
                  title: job.title,
                  company: job.company,
                  companyLogoUrl: job.companyLogoUrl,
                  location: job.location,
                  level: job.level,
                  workMode: job.workMode,
                  employmentType: job.employmentKind ?? job.employmentType,
                  salaryText: job.salary,
                  description: job.descriptionExcerpt,
                  techStack: job.skills,
                  postedAt: job.postedAt ? new Date(job.postedAt).toISOString() : null,
                  careerUrl: job.employerUrl,
                  attributionLinks: job.attributionLinks,
                }}
                saved={job.isSaved}
                saving={actions.isPending(job.slug, "saved")}
                onToggleSaved={() => actions.update(job.slug, job.isSaved ? "unsave" : "save")}
                onOpenDetails={() => write({ job: job.slug })}
                applied={job.isApplied}
                canUndoApplied={job.canUndoApplied}
                onUndoApplied={() => actions.update(job.slug, "undo")}
                markingApplied={actions.isPending(job.slug, "applied")}
                onMarkApplied={() => actions.update(job.slug, "apply")}
                queueing={queue.isPending(job.slug)}
                onAddToQueue={() => queue.add(job.slug)}
              />
            ))}
          </Stack>
          {results && results.pagination.total > 0 && (
            <PaginationFooter pagination={results.pagination} onPageChange={pagination.setPage} />
          )}
          {!saved &&
            !loading &&
            results &&
            results.pagination.total > 0 &&
            pagination.page >= Math.max(1, results.pagination.totalPages) && (
              <Stack spacing={1} sx={{ alignItems: "center", textAlign: "center", py: 3 }}>
                <Typography variant="body2Muted">
                  You’ve reached the end of the jobs currently indexed with these filters.
                </Typography>
                <Button variant="outlined" onClick={() => setFindMoreOpen(true)}>
                  Find more jobs
                </Button>
              </Stack>
            )}
        </Stack>
      </Box>
      <JobDetail
        slug={slug}
        onClose={() => write({ job: null })}
        saved={detailSaved}
        saving={!!slug && actions.isPending(slug, "saved")}
        onToggleSaved={() => {
          if (slug) actions.update(slug, detailSaved ? "unsave" : "save");
        }}
        applied={detailApplied}
        canUndoApplied={detailCanUndoApplied}
        onUndoApplied={() => {
          if (slug) actions.update(slug, "undo");
        }}
        actionError={error}
        markingApplied={!!slug && actions.isPending(slug, "applied")}
        onMarkApplied={() => {
          if (slug) actions.update(slug, "apply");
        }}
      />
      <FindMoreJobs
        open={findMoreOpen}
        onClose={() => setFindMoreOpen(false)}
        onImported={() => setFilters({})}
        filters={filters}
        keyword={keyword}
      />
    </Stack>
  );
}
