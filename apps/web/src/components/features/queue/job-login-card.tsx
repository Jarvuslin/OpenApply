"use client";

import { type ReactElement, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  DialogContent,
  IconButton,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import { type JobLogin as SavedJobLogin, SERVICE_PROVIDERS } from "@openapply/contracts/credential";
import { useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { z } from "zod/v4";
import { api } from "@/api/client";
import { ApiError } from "@/api/error";
import { useApiQuery } from "@/api/hooks";
import { credentialQueries, emailQueries } from "@/api/queries";
import { queryKeys } from "@/api/query-keys";
import { Dialog, DialogTitle } from "@/components/ui/feedback";
import { useAppForm } from "@/components/ui/form/tanstack";
import { SectionCard } from "@/components/ui/layout";
import { providerDisplayName } from "@/lib/terminal";
import { useAgentDock } from "@/providers/agent-provider";
import { DetailRow } from "./detail-row";
import { GmailCheckProgress } from "./gmail-check-progress";
import { useGmailCheck } from "./use-gmail-check";

const CAPTCHA_LABELS: Record<(typeof SERVICE_PROVIDERS)[number], string> = {
  "2captcha": "2Captcha",
  capsolver: "CapSolver",
};

const loginFormSchema = z.object({
  email: z.email("Enter the email you use on career sites."),
  password: z.string(),
  captchaProvider: z.string(),
  captchaApiKey: z.string(),
});

export function JobLoginCard(): ReactElement {
  const login = useApiQuery(credentialQueries.login(), { retry: false });
  const [editing, setEditing] = useState(false);
  const dock = useAgentDock();
  const check = useGmailCheck(dock.provider);
  const saved = login.data;
  const complete = !!saved?.email && !!saved.hasPassword;
  return (
    <SectionCard
      flush
      fullHeight
      title="Job login"
      icon={<KeyRound size={18} strokeWidth={1.75} aria-hidden />}
      actions={
        saved && (
          <Button size="small" variant="outlined" onClick={() => setEditing(true)}>
            {complete ? "Edit" : "Add login"}
          </Button>
        )
      }
    >
      {login.isLoading && <LinearProgress aria-label="Loading your job login" />}
      {login.error && (
        <Alert
          severity="error"
          action={<Button onClick={() => void login.refetch()}>Retry</Button>}
          sx={{ m: 2 }}
        >
          Could not load your job login.
        </Alert>
      )}
      {saved && !complete && (
        <Typography variant="body2Muted" sx={{ p: 2 }}>
          Add one email and password. The agent signs in to career sites with it, and creates an
          account when a site has none.
        </Typography>
      )}
      {saved && complete && (
        <Box sx={{ flex: 1, display: "grid", gridAutoRows: "1fr", py: 1 }}>
          <DetailRow label="Email" ruled={false}>
            <Typography variant="body2" noWrap>
              {saved.email}
            </Typography>
          </DetailRow>
          <DetailRow label="Password" ruled={false}>
            <SavedPassword />
          </DetailRow>
          <DetailRow label="Gmail" ruled={false}>
            <GmailStatus saved={saved} check={check} provider={dock.provider} />
          </DetailRow>
          <DetailRow label="Captcha solver" ruled={false}>
            <Typography variant="body2">
              {saved.captchaProvider ? CAPTCHA_LABELS[saved.captchaProvider] : "Off"}
            </Typography>
          </DetailRow>
        </Box>
      )}
      {(check.notice || check.phase === "checking" || check.confirmation) && (
        <Stack spacing={1} sx={{ px: 2, pb: 2 }}>
          {check.notice && (
            <Alert severity={check.notice.severity} role="status">
              {check.notice.text}
            </Alert>
          )}
          {check.phase === "checking" && (
            <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
              <Box sx={{ flex: 1 }}>
                <GmailCheckProgress />
              </Box>
              <Button size="small" onClick={check.cancel}>
                Cancel
              </Button>
            </Stack>
          )}
          {check.confirmation && (
            <Stack direction="row" spacing={1}>
              <Button size="small" variant="contained" onClick={() => void check.confirm()}>
                Yes, this is my Gmail
              </Button>
              <Button size="small" onClick={check.dismissConfirmation}>
                Cancel
              </Button>
            </Stack>
          )}
        </Stack>
      )}
      {saved && (
        <Dialog open={editing} onClose={() => setEditing(false)} maxWidth="xs" fullWidth>
          <DialogTitle>{complete ? "Edit job login" : "Add job login"}</DialogTitle>
          <DialogContent>
            {editing && (
              <JobLoginEditor
                saved={saved}
                onCancel={() => setEditing(false)}
                onSaved={(email) => {
                  setEditing(false);
                  if (email.toLowerCase() !== saved.email?.toLowerCase())
                    void check.run(email, true);
                }}
              />
            )}
          </DialogContent>
        </Dialog>
      )}
    </SectionCard>
  );
}

function SavedPassword(): ReactElement {
  const [password, setPassword] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function toggle(): Promise<void> {
    if (password !== null) {
      setPassword(null);
      return;
    }
    const response = await api.credentials.login.reveal.post();
    if (response.error) setError(new ApiError(response.error).message);
    else setPassword(response.data.password ?? "");
  }
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", minWidth: 0 }}>
      <Typography variant="monoData" noWrap>
        {password ?? "••••••••••"}
      </Typography>
      <IconButton
        size="small"
        aria-label={password === null ? "Show password" : "Hide password"}
        onClick={() => void toggle()}
      >
        {password === null ? <Eye size={14} aria-hidden /> : <EyeOff size={14} aria-hidden />}
      </IconButton>
      {error && (
        <Typography variant="captionMuted" sx={{ color: "error.main" }}>
          {error}
        </Typography>
      )}
    </Stack>
  );
}

interface JobLoginEditorProps {
  saved: SavedJobLogin;
  onCancel: () => void;
  onSaved: (email: string) => void;
}

function JobLoginEditor({ saved, onCancel, onSaved }: JobLoginEditorProps): ReactElement {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const savedEmail = saved.email?.toLowerCase() ?? "";
  const form = useAppForm({
    defaultValues: {
      email: saved.email ?? "",
      password: "",
      captchaProvider: saved.captchaProvider ?? "",
      captchaApiKey: "",
    },
    validators: {
      // A new email needs its password; otherwise a blank password keeps the saved one.
      onSubmit: loginFormSchema.refine(
        (value) =>
          value.password.length > 0 ||
          (saved.hasPassword && value.email.toLowerCase() === savedEmail),
        { message: "Enter the password for this email.", path: ["password"] },
      ),
    },
    onSubmit: async ({ value }) => {
      setError("");
      const provider = SERVICE_PROVIDERS.find((option) => option === value.captchaProvider) ?? null;
      const response = await api.credentials.login.put({
        email: value.email,
        ...(value.password && { password: value.password }),
        captchaProvider: provider,
        ...(provider && value.captchaApiKey && { captchaApiKey: value.captchaApiKey }),
      });
      if (response.error) {
        setError(new ApiError(response.error).message);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.credentials.all });
      await queryClient.invalidateQueries({ queryKey: queryKeys.email.all });
      onSaved(value.email);
    },
  });
  return (
    <Box
      component="form"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <Stack spacing={2} sx={{ pt: 1 }}>
        <Typography variant="body2Muted">
          One email and password for every career site. The agent signs in with it, or creates an
          account when a site has none.
        </Typography>
        <form.AppField name="email">
          {(field) => (
            <field.TextField
              label="Email"
              type="email"
              autoComplete="username"
              helperText="Use the Gmail connected to your Claude or Codex plugin so the agent can read verification codes."
            />
          )}
        </form.AppField>
        <form.AppField name="password">
          {(field) => (
            <field.TextField
              label="Password"
              type="password"
              autoComplete="new-password"
              helperText={
                saved.hasPassword ? "Leave blank to keep your current password." : undefined
              }
            />
          )}
        </form.AppField>
        <form.AppField name="captchaProvider">
          {(field) => (
            <field.Select
              label="Captcha solver (optional)"
              optional
              emptyLabel="Off"
              items={SERVICE_PROVIDERS.map((value) => ({ value, label: CAPTCHA_LABELS[value] }))}
            />
          )}
        </form.AppField>
        <form.Subscribe selector={(state) => state.values.captchaProvider}>
          {(provider) =>
            provider && (
              <form.AppField name="captchaApiKey">
                {(field) => (
                  <field.TextField
                    label="Captcha API key"
                    type="password"
                    helperText={
                      saved.hasCaptchaKey && saved.captchaProvider === provider
                        ? "Saved. Leave blank to keep it."
                        : "Only used when a site shows a captcha the agent can't pass on its own."
                    }
                  />
                )}
              </form.AppField>
            )
          }
        </form.Subscribe>
        {error && <Alert severity="error">{error}</Alert>}
        <Stack direction="row" spacing={1} sx={{ justifyContent: "flex-end" }}>
          <Button onClick={onCancel}>Cancel</Button>
          <form.AppForm>
            <form.SubmitButton>Save</form.SubmitButton>
          </form.AppForm>
        </Stack>
      </Stack>
    </Box>
  );
}

interface GmailStatusProps {
  saved: SavedJobLogin;
  check: ReturnType<typeof useGmailCheck>;
  provider: ReturnType<typeof useAgentDock>["provider"];
}

/** Whether the login email is the Gmail the agent's plugin reads verification codes from. */
function GmailStatus({ saved, check, provider }: GmailStatusProps): ReactElement {
  const mailbox = useApiQuery(emailQueries.account(), { refetchOnWindowFocus: true });
  const loginEmail = saved.email?.toLowerCase();
  const status = mailbox.data;
  const reconnect = !!status?.connected && status.needsReauth;
  const ready =
    !!loginEmail && !!status?.connected && status.email.toLowerCase() === loginEmail && !reconnect;
  const providerName = providerDisplayName(provider);
  let chip = <Chip size="small" label="Not connected" />;
  if (ready) chip = <Chip size="small" color="success" label="Connected" />;
  else if (reconnect) chip = <Chip size="small" color="warning" label="Reconnect" />;
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: "center", minWidth: 0 }}>
      {chip}
      <Typography variant="captionMuted" sx={{ flex: 1, minWidth: 0 }}>
        {ready
          ? `For verification codes · ${providerName} plugin`
          : `Connect it in your ${providerName} Gmail plugin`}
      </Typography>
      <Button
        size="small"
        disabled={check.busy || Boolean(check.confirmation)}
        title={check.busy ? "A Gmail check is already running" : undefined}
        onClick={() => void check.run(saved.email ?? "", true)}
      >
        Check
      </Button>
    </Stack>
  );
}
