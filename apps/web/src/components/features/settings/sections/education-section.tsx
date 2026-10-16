"use client";
import { type ReactElement, useState } from "react";
import { Alert, Button, Stack, Typography } from "@mui/material";
import { USER_DEFAULT_VALUES } from "@openapply/contracts/user";
import { useQueryClient } from "@tanstack/react-query";
import { API_BASE_URL } from "@/api/base-url";
import { api } from "@/api/client";
import { ApiError } from "@/api/error";
import { useApiQuery } from "@/api/hooks";
import { userQueries } from "@/api/queries";
import { queryKeys } from "@/api/query-keys";
import { FileUpload, FormSection } from "@/components/ui/form";
import { withForm } from "@/components/ui/form/tanstack";

export const EducationSection = withForm({
  defaultValues: USER_DEFAULT_VALUES,
  render: function EducationSection({ form }) {
    return (
      <FormSection
        title="Education"
        description="Applications ask for your GPA and sometimes an unofficial transcript. The agent uses these instead of asking you."
      >
        <Stack direction="row" spacing={2}>
          <form.AppField name="gpa">
            {(field) => <field.TextField label="Cumulative GPA" type="number" />}
          </form.AppField>
          <form.AppField name="gpaScale">
            {(field) => <field.TextField label="Out of" type="number" helperText="Usually 4.0" />}
          </form.AppField>
        </Stack>
        <Transcript />
      </FormSection>
    );
  },
});

function Transcript(): ReactElement {
  const profile = useApiQuery(userQueries.detail());
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const name = profile.data?.user.transcriptOriginalName ?? null;
  async function run(action: () => Promise<{ error: unknown }>): Promise<void> {
    setBusy(true);
    setError("");
    const response = await action();
    if (response.error) setError(new ApiError(response.error as never).message);
    await client.invalidateQueries({ queryKey: queryKeys.user.detail() });
    setBusy(false);
  }
  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">Unofficial transcript</Typography>
      {name ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
          <Typography variant="body2" sx={{ overflowWrap: "anywhere" }}>
            {name}
          </Typography>
          <Button size="small" component="a" href={`${API_BASE_URL}/api/user/transcript`}>
            View
          </Button>
          <Button
            size="small"
            color="error"
            disabled={busy}
            onClick={() => void run(() => api.user.transcript.delete())}
          >
            Remove
          </Button>
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">
          No transcript saved.
        </Typography>
      )}
      <FileUpload
        label={name ? "Replace transcript" : "Upload transcript (PDF)"}
        maxBytes={10 * 1024 * 1024}
        loading={busy}
        onError={setError}
        onFile={(file) => void run(() => api.user.transcript.post({ file }))}
      />
      {error && <Alert severity="error">{error}</Alert>}
    </Stack>
  );
}
