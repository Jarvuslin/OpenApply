"use client";

import { type ReactElement, useState } from "react";
import { Alert, Button, Divider, LinearProgress, Link, Stack, Typography } from "@mui/material";
import {
  linkedinSettingsInputSchema,
  type linkedinSettingsSchema,
} from "@openapply/contracts/linkedin-discovery";
import { useQueryClient } from "@tanstack/react-query";
import type { z } from "zod/v4";
import { api } from "@/api/client";
import { apiErrorMessage } from "@/api/error";
import { useApiQuery } from "@/api/hooks";
import { linkedinDiscoveryQueries } from "@/api/linkedin-discovery-queries";
import { useAppForm } from "@/components/ui/form/tanstack";
import { LinkedinDiscoveryStatus } from "./linkedin-discovery-status";
import { LinkedinSearches } from "./linkedin-searches";

interface LinkedinSettingsFormProps {
  settings: z.infer<typeof linkedinSettingsSchema>;
}

const settingsFormSchema = linkedinSettingsInputSchema.safeExtend({
  searches: linkedinSettingsInputSchema.shape.searches.element.required().array().max(4),
});

function LinkedinSettingsForm(props: LinkedinSettingsFormProps): ReactElement {
  const { settings } = props;
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const form = useAppForm({
    defaultValues: { enabled: settings.enabled, searches: settings.searches },
    validators: { onChange: settingsFormSchema, onSubmit: settingsFormSchema },
    listeners: { onChange: () => setSaved(false) },
    onSubmit: async ({ value }) => {
      setBusy(true);
      setError("");
      setSaved(false);
      try {
        const result = await api["job-sources"].linkedin.settings.put(
          linkedinSettingsInputSchema.parse(value),
        );
        if (result.error) throw new Error(apiErrorMessage(result.error));
        queryClient.setQueryData(linkedinDiscoveryQueries.settings().queryKey, result.data);
        form.reset({ enabled: result.data.enabled, searches: result.data.searches });
        setSaved(true);
      } catch (reason) {
        setError(
          reason instanceof Error ? reason.message : "Could not save LinkedIn discovery settings.",
        );
      } finally {
        setBusy(false);
      }
    },
  });

  return (
    <Stack
      component="form"
      spacing={2}
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) void form.handleSubmit();
      }}
    >
      <LinkedinDiscoveryStatus settings={settings} />
      <form.AppField name="enabled">
        {(field) => (
          <field.Switch label="LinkedIn discovery (logged out, personal use)" disabled={busy} />
        )}
      </form.AppField>
      <LinkedinSearches form={form} disabled={busy} />
      <form.Subscribe selector={(state) => state.canSubmit}>
        {(canSubmit) => (
          <Button type="submit" variant="outlined" disabled={busy || !canSubmit}>
            {busy ? "Saving…" : "Save LinkedIn discovery settings"}
          </Button>
        )}
      </form.Subscribe>
      {error && <Alert severity="error">{error}</Alert>}
      {saved && <Alert severity="success">LinkedIn discovery settings saved.</Alert>}
    </Stack>
  );
}

export function LinkedinDiscoverySettings(): ReactElement {
  const settings = useApiQuery(linkedinDiscoveryQueries.settings(), {
    refetchOnWindowFocus: false,
  });
  return (
    <Stack spacing={2}>
      <Divider />
      <Typography variant="h4">LinkedIn discovery</Typography>
      <Typography variant="body2Muted">
        Optional personal searches, off by default. Requires the separate JobSpy collector to be
        running on your server. It searches at most once per day without a LinkedIn login or browser
        cookies. Results stay in your account; applications use resolved employer links.
      </Typography>
      <Alert severity="warning">
        Automated discovery is against{" "}
        <Link
          href="https://www.linkedin.com/legal/user-agreement"
          target="_blank"
          rel="noopener noreferrer"
        >
          LinkedIn's terms
        </Link>{" "}
        and may be rate limited or blocked. A blocked response pauses further requests.
      </Alert>
      {settings.isPending && <LinearProgress aria-label="Loading LinkedIn discovery settings" />}
      {settings.error && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => void settings.refetch()}>
              Retry
            </Button>
          }
        >
          {settings.error.message}
        </Alert>
      )}
      {settings.data && <LinkedinSettingsForm settings={settings.data} />}
    </Stack>
  );
}
