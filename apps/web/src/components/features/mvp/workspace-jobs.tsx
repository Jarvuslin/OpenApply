"use client";
import { useEffect, useState } from "react";
import { JOB_LEVEL_LABELS, JOB_LEVELS } from "@jobpilot/contracts/job-listing";
import { ArrowOutward, Search, WorkOutlined } from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { api } from "@/api/client";
import { apiErrorMessage } from "@/api/error";
import { formatSkillCommand, getStatus, injectCommand } from "@/lib/terminal";
import { useAgentDock } from "@/providers/agent-provider";

type Jobs = NonNullable<Awaited<ReturnType<typeof api.jobs.get>>["data"]>;
export function WorkspaceJobs() {
  const dock = useAgentDock();
  const [selected, setSelected] = useState<string[]>([]);
  const [queueing, setQueueing] = useState(false);
  const [queueResult, setQueueResult] = useState("");
  const [queuedCampaign, setQueuedCampaign] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [location, setLocation] = useState("");
  const [level, setLevel] = useState<(typeof JOB_LEVELS)[number] | "">("");
  const [maxYears, setMaxYears] = useState("");
  const [query, setQuery] = useState<{
    q?: string;
    location?: string;
    level?: (typeof JOB_LEVELS)[number];
    maxYears?: number;
  }>({});
  const [data, setData] = useState<Jobs | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSelected([]);
    setError("");
    void api.jobs
      .get({ query: { ...query, limit: 12, page: 1 } })
      .then((result) => {
        if (cancelled) return;
        if (result.error) setError(apiErrorMessage(result.error));
        else setData(result.data);
      })
      .catch(() => {
        if (!cancelled) setError("Cannot reach your job board. Try again shortly.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query]);
  const selectable = data?.items.filter((job) => job.canApply).map((job) => job.slug) ?? [];
  async function runSelected() {
    setQueueing(true);
    setError("");
    try {
      const result = await api.mvp.apply.post({ slugs: selected });
      if (result.error) throw new Error(apiErrorMessage(result.error));
      setSelected([]);
      setQueueResult(
        `Queued ${result.data.queued.length}. Skipped ${result.data.skipped.length}${result.data.skipped.length ? `: ${[...new Set(result.data.skipped.map((row) => row.reason))].join(", ")}` : "."}`,
      );
      if (result.data.queued.length) {
        setQueuedCampaign(result.data.campaignId);
        await startAgent(result.data.campaignId);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not queue jobs.");
    } finally {
      setQueueing(false);
    }
  }
  async function startAgent(campaignId: string) {
    dock.expand();
    const status = await getStatus();
    if (status.session !== "running" || status.provider !== dock.provider)
      throw new Error(
        "Jobs are queued. Start your selected agent, then click Run queued applications.",
      );
    await injectCommand(formatSkillCommand(dock.provider, "mvp-apply", campaignId), dock.provider);
    setQueuedCampaign(null);
  }
  return (
    <Stack spacing={2.5}>
      <Stack
        component="form"
        direction="column"
        spacing={1}
        onSubmit={(event) => {
          event.preventDefault();
          setQuery({
            q: input.trim() || undefined,
            location: location.trim() || undefined,
            level: level || undefined,
            maxYears: maxYears === "" ? undefined : Number(maxYears),
          });
        }}
      >
        <TextField
          fullWidth
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Search by role or company"
          aria-label="Search jobs"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Search fontSize="sm" />
                </InputAdornment>
              ),
            },
          }}
        />
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
          <TextField
            label="Location"
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            placeholder="Toronto"
            fullWidth
          />
          <TextField
            label="Job level"
            select
            value={level}
            onChange={(event) => setLevel(event.target.value as typeof level)}
            fullWidth
          >
            <MenuItem value="">Any level</MenuItem>
            {JOB_LEVELS.map((value) => (
              <MenuItem key={value} value={value}>
                {JOB_LEVEL_LABELS[value]}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Max. required years"
            type="number"
            value={maxYears}
            onChange={(event) => setMaxYears(event.target.value)}
            slotProps={{ htmlInput: { min: 0, max: 50, step: 1 } }}
            fullWidth
          />
        </Stack>
        <Typography variant="captionMuted">
          Levels are inferred from titles. A years filter excludes listings with unspecified
          experience.
        </Typography>
        <Button type="submit" variant="outlined">
          Search
        </Button>
      </Stack>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <FormControlLabel
          label="Select all shown"
          control={
            <Checkbox
              disabled={loading || !selectable.length}
              checked={selectable.length > 0 && selected.length === selectable.length}
              indeterminate={selected.length > 0 && selected.length < selectable.length}
              onChange={(_, checked) => setSelected(checked ? selectable : [])}
            />
          }
        />
        <Button
          variant="contained"
          disabled={loading || queueing || !selected.length}
          onClick={() => void runSelected()}
        >
          Apply to {selected.length} selected
        </Button>
        {queuedCampaign && (
          <Button
            onClick={() =>
              void startAgent(queuedCampaign).catch((e) =>
                setError(e instanceof Error ? e.message : "Could not start agent."),
              )
            }
          >
            Run queued applications
          </Button>
        )}
      </Stack>
      {queueResult && <Alert severity="info">{queueResult}</Alert>}
      {loading && <LinearProgress />}
      {error && <Alert severity="error">{error}</Alert>}
      {data && (
        <Typography variant="captionMuted">
          {data.pagination.total.toLocaleString()} roles in your library · showing{" "}
          {data.items.length}
        </Typography>
      )}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", md: "repeat(2, minmax(0, 1fr))" },
          gap: 1.5,
        }}
      >
        {data?.items.map((job) => (
          <Stack
            key={job.id}
            spacing={1.5}
            sx={{
              p: 2.5,
              bgcolor: "background.paper",
              border: 1,
              borderColor: "divider",
              borderRadius: 12,
              minWidth: 0,
              transition: "border-color 160ms",
              "&:hover": { borderColor: "line.borderHi" },
            }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <WorkOutlined fontSize="sm" sx={{ color: "text.secondary" }} />
              <Typography variant="body2Muted">{job.company}</Typography>
            </Stack>
            <FormControlLabel
              control={
                <Checkbox
                  checked={selected.includes(job.slug)}
                  disabled={!job.canApply || queueing}
                  onChange={(_, checked) =>
                    setSelected((current) =>
                      checked
                        ? [...current, job.slug]
                        : current.filter((slug) => slug !== job.slug),
                    )
                  }
                />
              }
              label={<Typography variant="h4">{job.title}</Typography>}
            />
            {!job.canApply && (
              <Typography color="warning.main" variant="body2">
                Found on {job.foundOn.join(", ")}. Employer page not found.
              </Typography>
            )}
            <Typography variant="body2Muted">{job.location || "Location in listing"}</Typography>
            <Typography variant="captionMuted">
              {JOB_LEVEL_LABELS[job.level]} ·{" "}
              {job.yearsExperience === null
                ? "Years not specified"
                : `${job.yearsExperience}+ years listed`}
            </Typography>
            <Stack
              direction="row"
              sx={{ justifyContent: "space-between", alignItems: "center", mt: "auto" }}
            >
              <Typography variant="captionMuted">
                {job.remote ? "Remote" : "Employer listing"}
              </Typography>
              <Button
                href={`/mvp?job=${encodeURIComponent(job.slug)}`}
                size="small"
                endIcon={<ArrowOutward fontSize="xs" />}
              >
                Review role
              </Button>
            </Stack>
          </Stack>
        ))}
      </Box>
      {!loading && data?.items.length === 0 && (
        <Typography color="text.secondary">
          No matches yet. Try a broader search or import a company board.
        </Typography>
      )}
    </Stack>
  );
}
