"use client";

import { type ReactElement, useEffect, useState } from "react";
import { OpenInNew } from "@mui/icons-material";
import {
  Alert,
  Button,
  DialogActions,
  DialogContent,
  Divider,
  Link,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  discoverSearchInputSchema,
  type discoverSearchResultSchema,
} from "@openapply/contracts/discover-feed";
import { useForm } from "@tanstack/react-form";
import { z } from "zod/v4";
import { api } from "@/api/client";
import { apiErrorMessage } from "@/api/error";
import { LocationPicker } from "@/components/features/locations/location-picker";
import { Dialog, DialogTitle } from "@/components/ui/feedback";
import type { DiscoverFilters } from "./job-board-types";

interface FindMoreJobsProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
  filters: DiscoverFilters;
  keyword: string;
}

const SEARCH_SOURCES = [
  { id: "hiringcafe", name: "HiringCafe · free preview", provider: "hiringcafe" },
  { id: "google_jobs", name: "Google Jobs · SerpApi account", provider: "serpapi" },
  { id: "linkedin", name: "LinkedIn · Apify account", provider: "apify" },
  { id: "indeed", name: "Indeed · Apify account", provider: "apify" },
  { id: "glassdoor", name: "Glassdoor · Apify account", provider: "apify" },
  { id: "ycombinator", name: "Y Combinator · Apify account", provider: "apify" },
] as const;

type SearchResult = z.infer<typeof discoverSearchResultSchema>;
type SourceId = (typeof SEARCH_SOURCES)[number]["id"];
const searchFormSchema = discoverSearchInputSchema.pick({ query: true }).extend({
  sourceId: z.enum(SEARCH_SOURCES.map((source) => source.id)),
  location: z.string().trim().max(160, "Use at most 160 characters for the location."),
});

function postedTimestamp(value: Date | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

export function FindMoreJobs(props: FindMoreJobsProps): ReactElement {
  const { open, onClose, onImported, filters, keyword } = props;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const form = useForm({
    defaultValues: { sourceId: "hiringcafe" as SourceId, query: "", location: "" },
    validators: { onChange: searchFormSchema, onSubmit: searchFormSchema },
    onSubmit: async ({ value }) => {
      const input = searchFormSchema.parse(value);
      const source = SEARCH_SOURCES.find((entry) => entry.id === input.sourceId);
      if (!source) return;
      setBusy(true);
      setError("");
      try {
        const response = await api["job-sources"].search.post({
          provider: source.provider,
          query: input.query,
          location: input.location,
          ...(source.provider === "apify" && {
            board: source.id as "linkedin" | "indeed" | "glassdoor" | "ycombinator",
          }),
          limit: 20,
        });
        if (response.error) throw new Error(apiErrorMessage(response.error));
        setResult({
          ...response.data,
          jobs: response.data.jobs?.toSorted(
            (a, b) => postedTimestamp(b.postedAt) - postedTimestamp(a.postedAt),
          ),
        });
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Could not search this source.");
      } finally {
        setBusy(false);
      }
    },
  });
  const initialQuery = keyword || filters.titles.join(" OR ");
  let initialLocation = filters.locations[0] ?? "";
  if (!initialLocation && filters.countries.length === 1) {
    initialLocation = filters.countries[0] === "CA" ? "Canada" : "United States";
  }

  useEffect(() => {
    if (!open) return;
    form.reset({
      sourceId: form.getFieldValue("sourceId"),
      query: initialQuery,
      location: initialLocation,
    });
    setResult(null);
    setError("");
  }, [form, open, initialQuery, initialLocation]);

  function resetSearch(): void {
    setResult(null);
    setError("");
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>Find more jobs</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <Typography variant="body2Muted">
            Search beyond the current index. These search terms are separate from your profile.
          </Typography>
          <form.Field name="sourceId">
            {(field) => (
              <TextField
                select
                label="Job source"
                value={field.state.value}
                disabled={busy}
                onChange={(event) => {
                  field.handleChange(event.target.value as SourceId);
                  resetSearch();
                }}
              >
                {SEARCH_SOURCES.map((source) => (
                  <MenuItem key={source.id} value={source.id}>
                    {source.name}
                  </MenuItem>
                ))}
              </TextField>
            )}
          </form.Field>
          <form.Field name="query">
            {(field) => (
              <TextField
                label="Role or keywords"
                value={field.state.value}
                disabled={busy}
                onChange={(event) => {
                  field.handleChange(event.target.value);
                  resetSearch();
                }}
                onBlur={field.handleBlur}
                error={field.state.meta.isTouched && field.state.meta.errors.length > 0}
                helperText={
                  field.state.meta.isTouched &&
                  field.state.meta.errors.map((issue) => issue?.message).join(" ")
                }
                placeholder="Software engineer"
              />
            )}
          </form.Field>
          <form.Field name="location">
            {(field) => (
              <LocationPicker
                label="Location"
                single
                value={field.state.value ? [field.state.value] : []}
                disabled={busy}
                onChange={(places) => {
                  field.handleChange(places[0] ?? "");
                  resetSearch();
                }}
                helperText="This source searches one place at a time. A new pick replaces it; leave it empty for a broad search."
              />
            )}
          </form.Field>
          <form.Subscribe selector={(state) => state.values.sourceId}>
            {(sourceId) => (
              <>
                {sourceId === "hiringcafe" && (
                  <Typography variant="captionMuted">
                    HiringCafe returns a small private preview with one job per company. Open a
                    listing there for the full posting; these previews are not copied into the
                    shared index.
                  </Typography>
                )}
                {sourceId !== "hiringcafe" && (
                  <Typography variant="captionMuted">
                    Requires an enabled provider in{" "}
                    <Link href="/settings/connections">Settings → Connections</Link>. Each batch may
                    use provider credits; searches run only when you click Search.
                  </Typography>
                )}
              </>
            )}
          </form.Subscribe>
          {error && <Alert severity="error">{error}</Alert>}
          {result && <Alert severity="info">{result.message}</Alert>}
          {result?.jobs?.map((job) => (
            <Stack
              key={job.url}
              spacing={0.75}
              sx={{ border: 1, borderColor: "divider", borderRadius: 1, p: 2 }}
            >
              <Typography variant="body1Strong">{job.title}</Typography>
              <Typography variant="body2Muted">
                {job.company} · {job.location || "Location not specified"}
              </Typography>
              {job.postedAt && (
                <Typography variant="captionMuted">
                  Posted {new Date(job.postedAt).toLocaleDateString()}
                </Typography>
              )}
              <Typography
                variant="body2Muted"
                sx={{
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {job.description}
              </Typography>
              <Link
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                sx={{ display: "inline-flex", alignItems: "center", gap: 0.5 }}
              >
                View on HiringCafe <OpenInNew fontSize="inherit" />
              </Link>
            </Stack>
          ))}
          {!!result?.imported && (
            <Typography variant="captionMuted">
              Your Discover filters still apply when viewing the imported jobs.
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <Divider />
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Close
        </Button>
        {!!result?.imported && (
          <Button
            disabled={busy}
            onClick={() => {
              onImported();
              onClose();
            }}
          >
            View refreshed results
          </Button>
        )}
        <form.Subscribe selector={(state) => searchFormSchema.safeParse(state.values).success}>
          {(valid) => (
            <Button
              variant="contained"
              loading={busy}
              disabled={busy || !valid}
              onClick={() => void form.handleSubmit()}
            >
              {result?.hasMore ? "Load next batch" : "Search"}
            </Button>
          )}
        </form.Subscribe>
      </DialogActions>
    </Dialog>
  );
}
