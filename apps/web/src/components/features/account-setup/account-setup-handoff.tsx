"use client";

import { type ReactElement, useState } from "react";
import { Alert, Button, Link, Stack, Typography } from "@mui/material";
import { api } from "@/api/client";
import { getAccountSetupHandoff } from "@/lib/account-setup-companion";

interface AccountSetupHandoffProps {
  id: string;
}

export function AccountSetupHandoff({ id }: AccountSetupHandoffProps): ReactElement {
  const [link, setLink] = useState<Awaited<ReturnType<typeof getAccountSetupHandoff>>>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function open(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError("");
    setLink(null);
    try {
      const token = await api.auth.tokens.terminal.post();
      if (token.error || !token.data) throw new Error("unauthorized");
      const handoff = await getAccountSetupHandoff(id, token.data.token);
      if (!handoff) throw new Error("unavailable");
      setLink(handoff);
    } catch {
      setError(
        "The retained account browser is unavailable. Keep this request open and inspect the connected computer before continuing.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack spacing={1}>
      <Typography variant="body2">
        Complete the requested password, terms, CAPTCHA, or verification step in this account’s
        retained browser. The worker must inspect the result before reporting success.
      </Typography>
      <Button variant="outlined" disabled={busy} onClick={() => void open()}>
        Find secure account browser
      </Button>
      {link && (
        <Link href={link.url} target="_blank" rel="noopener noreferrer">
          Open account browser · available until {new Date(link.expiresAt).toLocaleTimeString()}
        </Link>
      )}
      {error && <Alert severity="warning">{error}</Alert>}
    </Stack>
  );
}
