"use client";
import { useEffect, useState } from "react";
import {
  ArrowOutward,
  ArrowUpward,
  AutoAwesome,
  CheckCircleOutlined,
  CircleOutlined,
  DescriptionOutlined,
  Language,
  MailOutlined,
  Tune,
} from "@mui/icons-material";
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useSearchParams } from "next/navigation";
import { api } from "@/api/client";
import { apiErrorMessage } from "@/api/error";
import { EmailSection } from "@/components/features/settings/sections/email-section";
import { getStatus, injectCommand } from "@/lib/terminal";
import { useAgentDock } from "@/providers/agent-provider";
import { WorkspaceJobs } from "./workspace-jobs";
import { WorkspaceTabs } from "./workspace-tabs";

type Readiness = {
  browser: boolean;
  browserVersion: string;
  gmail: boolean;
  profile: boolean;
  resume: boolean;
};
const tabs = [
  { value: "assistant", label: "Assistant" },
  { value: "jobs", label: "Discover" },
  { value: "connections", label: "Connections" },
];
export function MvpWorkbench() {
  const slug = useSearchParams().get("job");
  const dock = useAgentDock();
  const [tab, setTab] = useState("assistant");
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [provider, setProvider] = useState<"ashby" | "greenhouse">("ashby");
  const [board, setBoard] = useState("ashby");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [job, setJob] = useState<{ title: string; company: string } | null>(null);
  const [campaign, setCampaign] = useState<string | null>(null);
  const [dispatched, setDispatched] = useState(false);
  const [trialDispatched, setTrialDispatched] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [lastPrompt, setLastPrompt] = useState("");
  const [jobsRevision, setJobsRevision] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void api.mvp.readiness
      .get()
      .then((result) => {
        if (cancelled) return;
        if (result.error) setError(apiErrorMessage(result.error));
        else setReadiness(result.data);
      })
      .catch(() => {
        if (!cancelled) setError("Cannot reach your workspace. Check the local API.");
      });
    setJob(null);
    setCampaign(null);
    setDispatched(false);
    setTrialDispatched(false);
    if (slug) {
      setTab("assistant");
      void api.public
        .jobs({ slug })
        .get()
        .then((result) => {
          if (!cancelled) {
            if (result.data) setJob(result.data);
            else setError("This listing is unavailable. Choose another role.");
          }
        })
        .catch(() => {
          if (!cancelled) setError("Could not load this role.");
        });
    }
    return () => {
      cancelled = true;
    };
  }, [slug]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }
  async function requireAgent() {
    const status = await getStatus();
    dock.expand();
    if (status.session !== "running" || status.provider !== "claude")
      throw new Error("Start Claude in the agent panel, then send your request again.");
  }
  async function apply() {
    if (!slug) return;
    await requireAgent();
    let id = campaign;
    if (!id) {
      const result = await api.mvp.apply.post({ slug });
      if (result.error || !result.data) throw new Error(apiErrorMessage(result.error));
      id = result.data.campaignId;
      setCampaign(id);
    }
    await injectCommand(`/jobpilot:mvp-apply ${id}`, "claude");
    setDispatched(true);
    setMessage(
      "Application sent to your agent. Follow its progress in the agent panel; a submission is confirmed only when the employer returns a receipt.",
    );
  }
  return (
    <Stack
      sx={{
        minHeight: "calc(100vh - 48px)",
        px: { xs: 2, md: 4 },
        maxWidth: 1440,
        width: "100%",
        mx: "auto",
      }}
      spacing={3}
    >
      <Stack direction="row" sx={{ justifyContent: "space-between", alignItems: "center", gap: 2 }}>
        <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
          <Typography variant="body1Strong">My workspace</Typography>
          <Typography variant="captionMuted">/ Job search</Typography>
        </Stack>
        <Button
          size="small"
          onClick={dock.expand}
          startIcon={
            <Box
              sx={{
                width: 6,
                height: 6,
                borderRadius: 99,
                bgcolor: readiness?.browser ? "success.main" : "warning.main",
              }}
            />
          }
        >
          Open agent
        </Button>
      </Stack>
      <Box sx={{ display: "flex", justifyContent: "center", pb: 1 }}>
        <WorkspaceTabs value={tab} onChange={setTab} tabs={tabs} />
      </Box>
      {error && (
        <Alert severity="error" onClose={() => setError("")}>
          {error}
        </Alert>
      )}
      {message && (
        <Alert severity="info" onClose={() => setMessage("")}>
          {message}
        </Alert>
      )}
      <Box
        role="tabpanel"
        id={`workspace-${tab}`}
        aria-label={tabs.find((item) => item.value === tab)?.label}
        sx={{ flex: 1, minWidth: 0 }}
      >
        {tab === "assistant" && (
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", lg: "minmax(0, 1fr) 240px" },
              gap: 4,
              minHeight: "65vh",
            }}
          >
            <Stack
              spacing={3}
              sx={{ minWidth: 0, pt: { xs: 3, md: 6 }, maxWidth: 760, mx: "auto", width: "100%" }}
            >
              <Stack spacing={1.5} sx={{ alignItems: "center", textAlign: "center", pb: 2 }}>
                <AutoAwesome sx={{ color: "text.primary" }} fontSize="xxl" />
                <Typography variant="h1" sx={{ maxWidth: 520 }}>
                  Make room for your next chapter.
                </Typography>
                <Typography color="text.secondary" sx={{ maxWidth: 460 }}>
                  Your experience, a thoughtful search, and an agent to handle the details.
                </Typography>
              </Stack>
              {job && (
                <Stack
                  spacing={1.5}
                  sx={{
                    p: 2.5,
                    border: 1,
                    borderColor: "divider",
                    borderRadius: 12,
                    bgcolor: "background.paper",
                  }}
                >
                  <Typography variant="overlineMuted">Selected opportunity</Typography>
                  <Typography variant="h3">{job.title}</Typography>
                  <Typography color="text.secondary">{job.company}</Typography>
                  <Typography variant="body2Muted">
                    Your agent will tailor your saved resume and apply to this role, creating a
                    career account if needed. Unanswered questions pause the application.
                  </Typography>
                  <Button
                    variant="outlined"
                    disabled={busy || trialDispatched || !readiness?.resume || !readiness.browser}
                    onClick={() =>
                      void run(async () => {
                        await requireAgent();
                        await injectCommand(`/jobpilot:mvp-trial ${slug}`, "claude");
                        setTrialDispatched(true);
                        setMessage(
                          "Trial sent to your agent. It will save a tailored resume and inspect the live form without submitting. Follow progress in the agent panel and results in Pilot.",
                        );
                      })
                    }
                  >
                    {trialDispatched ? "Trial sent to agent" : "Prepare trial · no submission"}
                  </Button>
                  {trialDispatched && (
                    <Stack direction="row" spacing={1}>
                      <Button href="/documents">Resume versions</Button>
                      <Button href="/pilot">Trial journal</Button>
                    </Stack>
                  )}
                  {readiness && !readiness.profile && (
                    <Alert severity="info">
                      You can prepare a trial now. Review your unanswered profile questions in Pilot
                      before submitting an application.
                    </Alert>
                  )}
                  <Button
                    variant="contained"
                    disabled={
                      busy ||
                      dispatched ||
                      !readiness?.profile ||
                      !readiness.resume ||
                      !readiness.browser
                    }
                    onClick={() => void run(apply)}
                  >
                    {dispatched
                      ? "Sent to agent"
                      : campaign
                        ? "Retry dispatch"
                        : "Apply to this role"}
                  </Button>
                  {campaign && (
                    <Button href={`/campaigns/${campaign}`}>Application progress</Button>
                  )}
                </Stack>
              )}
              {lastPrompt && (
                <Stack spacing={1} sx={{ p: 2, bgcolor: "surfaces.elevated", borderRadius: 12 }}>
                  <Typography>{lastPrompt}</Typography>
                  <Typography variant="captionMuted">
                    Sent to Claude · responses appear in the agent panel
                  </Typography>
                </Stack>
              )}
              <Stack
                component="form"
                spacing={1.5}
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!prompt.trim()) return;
                  void run(async () => {
                    await requireAgent();
                    await injectCommand(prompt.trim(), "claude");
                    setLastPrompt(prompt.trim());
                    setPrompt("");
                  });
                }}
                sx={{
                  p: 2,
                  bgcolor: "background.paper",
                  border: 1,
                  borderColor: "line.border",
                  borderRadius: 18,
                  boxShadow: 1,
                }}
              >
                <TextField
                  multiline
                  minRows={2}
                  maxRows={6}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="What would you like to work on?"
                  aria-label="Message your job agent"
                  variant="standard"
                  slotProps={{ input: { disableUnderline: true } }}
                />
                <Stack
                  direction="row"
                  sx={{ justifyContent: "space-between", alignItems: "center" }}
                >
                  <Stack direction="row" spacing={0.5}>
                    <Button
                      href="/documents"
                      size="small"
                      startIcon={<DescriptionOutlined fontSize="sm" />}
                    >
                      Resume
                    </Button>
                    <Button href="/onboarding" size="small" startIcon={<Tune fontSize="sm" />}>
                      Preferences
                    </Button>
                  </Stack>
                  <IconButton
                    type="submit"
                    aria-label="Send to agent"
                    disabled={busy || !prompt.trim()}
                    sx={{
                      bgcolor: "primary.main",
                      color: "primary.contrastText",
                      "&:hover": { bgcolor: "accent.dark" },
                    }}
                  >
                    <ArrowUpward fontSize="sm" />
                  </IconButton>
                </Stack>
              </Stack>
              <Stack
                direction={{ xs: "column", sm: "row" }}
                spacing={1}
                sx={{ justifyContent: "center" }}
              >
                <Button variant="outlined" size="small" onClick={() => setTab("jobs")}>
                  Find a role
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() =>
                    setPrompt(
                      "Review my saved resume and suggest improvements. Do not invent experience or change my original resume without showing me the proposed changes.",
                    )
                  }
                >
                  Review my resume
                </Button>
                <Button variant="outlined" size="small" onClick={() => setTab("connections")}>
                  Connect Gmail
                </Button>
              </Stack>
              <Typography variant="captionMuted" sx={{ textAlign: "center" }}>
                Powered by your Claude subscription · Your originals stay yours
              </Typography>
            </Stack>
            <Stack
              spacing={2.5}
              sx={{ borderLeft: { lg: 1 }, borderColor: { lg: "divider" }, pl: { lg: 3 }, pt: 3 }}
            >
              <Typography variant="overlineMuted">Ready when you are</Typography>
              {(
                [
                  { key: "profile", label: "Your profile", href: "/onboarding" },
                  { key: "resume", label: "Original resume", href: "/documents" },
                  { key: "gmail", label: "Gmail", href: "/settings/email" },
                  {
                    key: "browser",
                    label: "Browser session",
                    href: "http://localhost:6080/vnc.html?autoconnect=1",
                  },
                ] as const
              ).map((item) => (
                <Stack key={item.key} direction="row" spacing={1.25} sx={{ alignItems: "center" }}>
                  {readiness?.[item.key] ? (
                    <CheckCircleOutlined fontSize="sm" sx={{ color: "success.main" }} />
                  ) : (
                    <CircleOutlined fontSize="sm" sx={{ color: "text.disabled" }} />
                  )}
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="body2Strong">{item.label}</Typography>
                    <Typography variant="captionMuted">
                      {!readiness
                        ? "Checking…"
                        : readiness[item.key]
                          ? "Connected"
                          : "Setup needed"}
                    </Typography>
                  </Box>
                  <IconButton size="small" href={item.href} aria-label={`Open ${item.label}`}>
                    <ArrowOutward fontSize="xs" />
                  </IconButton>
                </Stack>
              ))}
              <Divider />
              <Typography variant="body2Muted">
                Start with one role. Follow the browser as your agent works, and answer anything it
                cannot infer.
              </Typography>
              <Button
                href="http://localhost:6080/vnc.html?autoconnect=1"
                target="_blank"
                rel="noreferrer"
                variant="outlined"
                startIcon={<Language fontSize="sm" />}
              >
                Watch browser
              </Button>
              <Button
                disabled={busy || !readiness?.browser}
                size="small"
                onClick={() =>
                  void run(async () => {
                    const result = await api.mvp.observe.post();
                    if (result.error || !result.data)
                      throw new Error(apiErrorMessage(result.error));
                    const challenges = result.data.filter((page) => page.challengePage);
                    setMessage(
                      challenges.length
                        ? `${challenges.length} page(s) need human verification. Open the browser to continue.`
                        : "No blocking challenge detected on the open pages. Observation saved to your journal.",
                    );
                  })
                }
              >
                Check browser status
              </Button>
            </Stack>
          </Box>
        )}
        {tab === "jobs" && (
          <Stack spacing={3}>
            <Stack spacing={0.75}>
              <Typography variant="h2">A next step worth taking.</Typography>
              <Typography color="text.secondary">
                Real openings from employer career boards. Choose one to review with your agent.
              </Typography>
            </Stack>
            <WorkspaceJobs key={jobsRevision} />
            <Divider />
            <Stack spacing={1.5}>
              <Typography variant="h4">Add a company board</Typography>
              <Typography variant="body2Muted">
                Bring in openings from a public Ashby or Greenhouse board.
              </Typography>
              <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                <TextField
                  select
                  label="Source"
                  value={provider}
                  onChange={(event) => setProvider(event.target.value as "ashby" | "greenhouse")}
                  sx={{ minWidth: 140 }}
                >
                  <MenuItem value="ashby">Ashby</MenuItem>
                  <MenuItem value="greenhouse">Greenhouse</MenuItem>
                </TextField>
                <TextField
                  label="Company board name"
                  value={board}
                  onChange={(event) => setBoard(event.target.value)}
                />
                <Button
                  variant="contained"
                  disabled={busy || !/^[a-zA-Z0-9_-][a-zA-Z0-9 _-]{0,79}$/.test(board.trim())}
                  onClick={() =>
                    void run(async () => {
                      const result = await api.mvp.sources.post({ provider, board });
                      if (result.error || !result.data)
                        throw new Error(apiErrorMessage(result.error));
                      setJobsRevision((revision) => revision + 1);
                      setMessage(`Refreshed ${result.data.imported} openings in your library.`);
                    })
                  }
                >
                  Import jobs
                </Button>
              </Stack>
            </Stack>
          </Stack>
        )}
        {tab === "connections" && (
          <Stack spacing={3} sx={{ maxWidth: 800, mx: "auto" }}>
            <Stack spacing={1}>
              <MailOutlined />
              <Typography variant="h2">Keep the loop connected.</Typography>
              <Typography color="text.secondary">
                Connect your own Gmail so the agent can find employer verification emails while it
                works.
              </Typography>
            </Stack>
            <Alert severity={readiness?.gmail ? "success" : "info"}>
              {readiness?.gmail
                ? "Gmail is connected to this app."
                : "A Gmail connection in this chat does not connect the app. Complete the Google setup below once to enable unattended verification."}
            </Alert>
            <EmailSection />
            <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
              <Chip label="Personal Google account supported" variant="outlined" />
              <Button href="/settings/credentials">Saved career accounts</Button>
            </Stack>
          </Stack>
        )}
      </Box>
      <Stack
        direction="row"
        sx={{
          justifyContent: "space-between",
          borderTop: 1,
          borderColor: "divider",
          pt: 2,
          mt: "auto",
        }}
      >
        <Typography variant="captionMuted">A quieter way to move forward.</Typography>
        <Typography variant="captionMuted">OpenApply / Personal</Typography>
      </Stack>
    </Stack>
  );
}
