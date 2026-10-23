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
import { type AutoApplySettingsInput, autoApplySettingsSchema } from "@openapply/contracts/user";
import type { QueueLimits } from "@openapply/contracts/work-queue-limits";
import { updateQueueLimitsSchema } from "@openapply/contracts/work-queue-limits";
import { useForm } from "@tanstack/react-form";
import { api } from "@/api/client";
import { ApiError } from "@/api/error";
import { useSession } from "@/hooks/use-auth";
import { queueRequests, sendQueueRequest } from "@/lib/queue-request";
import { queueLimitsDraft, queueLimitsDraftSchema, queueLimitsInput } from "./queue-limits-draft";

interface QueueLimitsFormProps {
  current: QueueLimits;
  /** The apply defaults, saved with the user rather than the queue policy. */
  applying: AutoApplySettingsInput;
  reload: () => Promise<QueueLimits>;
  saved: () => void;
  close: () => void;
}

const FIELDS = [
  {
    name: "maxConcurrentWorkers",
    label: "Applications at once",
    help: "How many applications your computer works on at the same time.",
    min: 1,
    max: 3,
  },
  {
    name: "dailyApplicationCap",
    label: "Applications per day",
    help: "The most applications sent in one day.",
    min: 1,
    max: 500,
  },
  {
    name: "companyApplicationCap",
    label: "Applications per company",
    help: "The most applications to one employer within the company window, so you don't flood one company.",
    min: 1,
    max: 100,
  },
  {
    name: "companyWindowDays",
    label: "Company window (days)",
    help: "How many days the per-company limit counts back.",
    min: 1,
    max: 90,
  },
  {
    name: "domainDelaySeconds",
    label: "Wait between starts on one site (seconds)",
    help: "Pause before starting another application on the same careers site, so it doesn't look like a bot.",
    min: 1,
    max: 3600,
  },
] as const;

export function QueueLimitsForm(props: QueueLimitsFormProps): ReactElement {
  const { current, applying, reload, saved, close } = props;
  const { user } = useSession();
  const [basis, setBasis] = useState(current);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<ReturnType<typeof queueLimitsInput> | null>(null);
  const stale = conflict || (!pending && basis.revision !== current.revision);
  const form = useForm({
    defaultValues: { ...queueLimitsDraft(basis), apply: applying },
    validators: { onSubmit: queueLimitsDraftSchema.extend({ apply: autoApplySettingsSchema }) },
    onSubmit: async ({ value }) => {
      if (stale || reloading) return;
      setError("");
      setSending(true);
      const { apply, ...draft } = value;
      let input = pending;
      try {
        if (JSON.stringify(apply) !== JSON.stringify(applying)) {
          const result = await api.user["auto-apply"].put(autoApplySettingsSchema.parse(apply));
          if (result.error) throw new ApiError(result.error);
        }
        input ??= queueLimitsInput(draft, basis, current);
        await sendQueueRequest(
          queueRequests,
          user?.id ?? "",
          ["queue-limits", input],
          async (requestId) => {
            const result = await api["work-queue"].limits.put(
              updateQueueLimitsSchema.parse({ ...input, requestId }),
            );
            if (result.error) throw new ApiError(result.error);
            return result.data;
          },
        );
        saved();
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not save queue limits. Your draft is still here.",
        );
        if (reason instanceof ApiError && reason.status === 409) {
          setPending(null);
          setConflict(true);
        } else if (
          input &&
          (!(reason instanceof ApiError) || reason.status === undefined || reason.status >= 500)
        ) {
          setPending(input);
        }
      } finally {
        setSending(false);
      }
    },
  });
  async function reloadSaved(): Promise<void> {
    setReloading(true);
    setError("");
    try {
      const latest = await reload();
      setBasis(latest);
      form.reset({ ...queueLimitsDraft(latest), apply: form.state.values.apply });
      setConflict(false);
      setPending(null);
    } catch {
      setError("Could not reload saved limits. Your draft is still here.");
    } finally {
      setReloading(false);
    }
  }
  return (
    <Box
      component="form"
      onSubmit={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void form.handleSubmit();
      }}
    >
      <Stack spacing={2}>
        {error && <Alert severity="error">{error}</Alert>}
        {pending && (
          <Alert
            severity="warning"
            action={
              <Button disabled={reloading || sending} onClick={() => void reloadSaved()}>
                Reload saved limits
              </Button>
            }
          >
            The save was not acknowledged. Retry the same save, or reload saved limits to inspect
            the current policy.
          </Alert>
        )}
        {stale && (
          <Alert
            severity="warning"
            action={
              <Button disabled={reloading} onClick={() => void reloadSaved()}>
                Reload saved limits
              </Button>
            }
          >
            The saved limits changed. Reload them before editing again; this replaces your draft.
          </Alert>
        )}
        {FIELDS.map((item) => (
          <form.Field key={item.name} name={item.name}>
            {(field) => (
              <TextField
                label={item.label}
                type="number"
                value={Number.isNaN(field.state.value) ? "" : field.state.value}
                disabled={stale || reloading || sending || !!pending}
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(
                    event.target.value === "" ? Number.NaN : Number(event.target.value),
                  )
                }
                error={field.state.meta.errors.length > 0}
                helperText={
                  field.state.meta.errors
                    .map((issue) => issue?.message)
                    .filter(Boolean)
                    .join(" ") || `${item.help} ${item.min}–${item.max}.`
                }
                slotProps={{ htmlInput: { min: item.min, max: item.max, step: 1 } }}
              />
            )}
          </form.Field>
        ))}
        <form.Field name="runsRemaining">
          {(field) => (
            <TextField
              label="Runs left"
              type="number"
              placeholder="No limit"
              value={field.state.value ?? ""}
              disabled={stale || reloading || sending || !!pending}
              onBlur={field.handleBlur}
              onChange={(event) =>
                field.handleChange(event.target.value === "" ? null : Number(event.target.value))
              }
              error={field.state.meta.errors.length > 0}
              helperText="How many more agent runs may start. Each application or account setup run uses one, retries included. Leave blank for no limit."
              slotProps={{ htmlInput: { min: 0, max: 10000, step: 1 } }}
            />
          )}
        </form.Field>
        <Typography variant="body2Strong" sx={{ pt: 1 }}>
          Applying
        </Typography>
        <form.Field name="apply.minMatchScore">
          {(field) => (
            <TextField
              label="Minimum match score"
              type="number"
              value={Number.isNaN(field.state.value) ? "" : field.state.value}
              disabled={sending}
              onBlur={field.handleBlur}
              onChange={(event) =>
                field.handleChange(
                  event.target.value === "" ? Number.NaN : Number(event.target.value),
                )
              }
              error={field.state.meta.errors.length > 0}
              helperText="Only apply to jobs scoring at least this, out of 100. Lower includes more stretch jobs. A search can set its own."
              slotProps={{ htmlInput: { min: 0, max: 100, step: 1 } }}
            />
          )}
        </form.Field>
        <form.Field name="apply.maxApplicationsPerCampaign">
          {(field) => (
            <TextField
              label="Applications per search"
              type="number"
              placeholder="No limit"
              value={field.state.value ?? ""}
              disabled={sending}
              onBlur={field.handleBlur}
              onChange={(event) =>
                field.handleChange(event.target.value === "" ? null : Number(event.target.value))
              }
              error={field.state.meta.errors.length > 0}
              helperText="The most applications one saved search sends. Leave blank for no limit."
              slotProps={{ htmlInput: { min: 1, max: 500, step: 1 } }}
            />
          )}
        </form.Field>
        <form.Field name="apply.defaultStartDate">
          {(field) => (
            <TextField
              label="Availability"
              placeholder="e.g. 2 weeks notice"
              value={field.state.value}
              disabled={sending}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.target.value)}
              helperText="Used when a form asks when you can start. Leave blank to be asked."
            />
          )}
        </form.Field>
        <Typography variant="body2Strong" sx={{ pt: 1 }}>
          Runs
        </Typography>
        <form.Field name="autoRetryFailed">
          {(field) => (
            <FormControlLabel
              control={
                <Switch
                  checked={!!field.state.value}
                  disabled={stale || reloading || sending || !!pending}
                  onChange={(event) => field.handleChange(event.target.checked)}
                />
              }
              label={
                <Box>
                  <Typography variant="body2">Retry failed runs</Typography>
                  <Typography variant="captionMuted" component="p">
                    After 15 minutes, a failed run goes back into the queue. The agent first looks
                    at why it failed and tries a different approach. At most 2 retries per job.
                  </Typography>
                </Box>
              }
              sx={{ alignItems: "flex-start", gap: 1, mx: 0 }}
            />
          )}
        </form.Field>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(busy) => (
            <Stack direction="row" spacing={1}>
              <Button type="submit" variant="contained" disabled={busy || stale || reloading}>
                {busy && "Saving settings…"}
                {!busy && pending && "Retry same save"}
                {!busy && !pending && "Save queue settings"}
              </Button>
              <Button disabled={busy} onClick={close}>
                Cancel
              </Button>
            </Stack>
          )}
        </form.Subscribe>
      </Stack>
    </Box>
  );
}
