"use client";

import { type ReactElement, useState } from "react";
import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { type TelegramSettings, telegramSettingsInputSchema } from "@openapply/contracts/telegram";
import { useForm } from "@tanstack/react-form";
import { api } from "@/api/client";
import { ApiError } from "@/api/error";
import { SectionCard } from "@/components/ui/layout";
import { useSession } from "@/hooks/use-auth";
import { queueRequests, sendQueueRequest } from "@/lib/queue-request";
import {
  notificationDraft,
  notificationDraftSchema,
  notificationInput,
} from "./notification-draft";

interface TelegramNotificationsProps {
  current: TelegramSettings;
  reload: () => Promise<TelegramSettings>;
  saved: () => void;
}

export function TelegramNotifications(props: TelegramNotificationsProps): ReactElement {
  const { current, reload, saved } = props;
  const { user } = useSession();
  const [basis, setBasis] = useState(current);
  const [pending, setPending] = useState<ReturnType<typeof notificationInput> | null>(null);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const stale = conflict || (!pending && basis.revision !== current.revision);
  const form = useForm({
    defaultValues: notificationDraft(basis),
    validators: { onSubmit: notificationDraftSchema },
    onSubmit: async ({ value }) => {
      if (stale || busy) return;
      setBusy(true);
      setError("");
      let input = pending;
      try {
        input ??= notificationInput(value, basis, current);
        const result = await sendQueueRequest(
          queueRequests,
          user?.id ?? "",
          ["telegram-settings", input],
          async (requestId) => {
            const response = await api.telegram.settings.patch(
              telegramSettingsInputSchema.parse({ ...input, requestId }),
            );
            if (response.error) throw new ApiError(response.error);
            return response.data;
          },
        );
        setPending(null);
        setBasis(result);
        form.reset(notificationDraft(result));
        saved();
      } catch (reason) {
        setError("Could not confirm the notification settings save.");
        if (reason instanceof ApiError && reason.status === 409) {
          setConflict(true);
          setPending(null);
        } else if (
          input &&
          (!(reason instanceof ApiError) || reason.status === undefined || reason.status >= 500)
        )
          setPending(input);
      } finally {
        setBusy(false);
      }
    },
  });
  async function reloadSaved(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      const latest = await reload();
      setBasis(latest);
      form.reset(notificationDraft(latest));
      setPending(null);
      setConflict(false);
    } catch {
      setError("Could not reload saved settings. Your draft is still here.");
    } finally {
      setBusy(false);
    }
  }
  const locked = busy || stale || !!pending;
  return (
    <SectionCard
      title="Telegram notifications"
      description="A daily digest and safe blocker notices, in your chosen time zone."
    >
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <Stack spacing={2} data-telegram-settings-revision={basis.revision}>
          <Typography variant="caption" color="text.secondary">
            Settings revision {basis.revision}
          </Typography>
          {error && <Alert severity="error">{error}</Alert>}
          {pending && (
            <Alert severity="warning">
              The save was not acknowledged. Retry the same save or reload saved settings to inspect
              the result.
            </Alert>
          )}
          {stale && (
            <Alert severity="warning">
              Saved settings changed. Reload them before editing again; this replaces your draft.
            </Alert>
          )}
          <form.Field name="digestEnabled">
            {(field) => (
              <FormControlLabel
                label="Daily digest"
                control={
                  <Switch
                    checked={field.state.value}
                    disabled={locked}
                    onChange={(_, value) => field.handleChange(value)}
                  />
                }
              />
            )}
          </form.Field>
          <form.Field name="digestHour">
            {(field) => (
              <TextField
                label="Digest hour (0–23)"
                type="number"
                value={Number.isNaN(field.state.value) ? "" : field.state.value}
                disabled={locked}
                onChange={(event) =>
                  field.handleChange(
                    event.target.value === "" ? Number.NaN : Number(event.target.value),
                  )
                }
                onBlur={field.handleBlur}
                error={field.state.meta.errors.length > 0}
                helperText="Local hour in the time zone below"
                slotProps={{ htmlInput: { min: 0, max: 23, step: 1 } }}
              />
            )}
          </form.Field>
          <form.Field name="timeZone">
            {(field) => (
              <TextField
                label="Time zone"
                value={field.state.value}
                disabled={locked}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                error={field.state.meta.errors.length > 0}
                helperText="For example, America/Toronto"
              />
            )}
          </form.Field>
          <form.Field name="quietEnabled">
            {(field) => (
              <FormControlLabel
                label="Quiet hours"
                control={
                  <Switch
                    checked={field.state.value}
                    disabled={locked}
                    onChange={(_, value) => field.handleChange(value)}
                  />
                }
              />
            )}
          </form.Field>
          <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
            <form.Field name="quietStart">
              {(field) => (
                <TextField
                  label="Quiet hours start"
                  type="time"
                  value={field.state.value}
                  disabled={locked}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              )}
            </form.Field>
            <form.Field name="quietEnd">
              {(field) => (
                <TextField
                  label="Quiet hours end"
                  type="time"
                  value={field.state.value}
                  disabled={locked}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              )}
            </form.Field>
          </Stack>
          <form.Subscribe selector={(state) => state.errors}>
            {(errors) =>
              errors.length > 0 && (
                <Alert severity="error">
                  Check the digest hour, time zone and distinct quiet-hour times.
                </Alert>
              )
            }
          </form.Subscribe>
          <Stack direction="row" spacing={1}>
            <Button type="submit" variant="contained" disabled={busy || stale}>
              {pending ? "Retry same notification save" : "Save Telegram notifications"}
            </Button>
            <Button disabled={busy} onClick={() => void reloadSaved()}>
              Reload saved notifications
            </Button>
          </Stack>
        </Stack>
      </Box>
    </SectionCard>
  );
}
