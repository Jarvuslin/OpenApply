"use client";
import { useEffect, useState } from "react";
import { JOB_LEVEL_LABELS, JOB_LEVELS } from "@jobpilot/contracts/job-listing";
import { ArrowOutward, Search, WorkOutlined } from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  InputAdornment,
  LinearProgress,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { api } from "@/api/client";
import { apiErrorMessage } from "@/api/error";

type Jobs = NonNullable<Awaited<ReturnType<typeof api.jobs.get>>["data"]>;
export function WorkspaceJobs() {
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
            <Typography variant="h4">{job.title}</Typography>
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
