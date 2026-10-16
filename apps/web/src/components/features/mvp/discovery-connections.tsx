"use client";
import { useEffect, useState } from "react";
import { ExpandMore } from "@mui/icons-material";
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Button,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import { discoveryConnectionSchema } from "@openapply/contracts/job-sources";
import { useForm } from "@tanstack/react-form";
import type { z } from "zod/v4";
import { api } from "@/api/client";
import { apiErrorMessage } from "@/api/error";

const ACTORS = [
  { key: "indeedActor", label: "Indeed" },
  { key: "linkedinActor", label: "LinkedIn" },
  { key: "glassdoorActor", label: "Glassdoor" },
  { key: "hiringcafeActor", label: "HiringCafe" },
  { key: "ycombinatorActor", label: "Y Combinator" },
] as const;
const INPUT_FIELDS = [
  { key: "queryField", label: "Search input field" },
  { key: "locationField", label: "Location input field" },
  { key: "limitField", label: "Result limit input field" },
] as const;
type Connection = z.infer<typeof discoveryConnectionSchema>;
type ActorKey = (typeof ACTORS)[number]["key"];
type ActorDrafts = Record<ActorKey, NonNullable<Connection["indeedActor"]>>;

function actorDrafts(saved?: Partial<Connection>): ActorDrafts {
  return Object.fromEntries(
    ACTORS.map(({ key }) => [
      key,
      {
        id: "",
        queryField: "query",
        locationField: "location",
        limitField: "maxItems",
        ...saved?.[key],
      },
    ]),
  ) as ActorDrafts;
}

export function DiscoveryConnections() {
  const [provider, setProvider] = useState<"apify" | "serpapi">("serpapi");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [reload, setReload] = useState(0);
  const form = useForm({
    defaultValues: { apiKey: "", enabled: false, actors: actorDrafts() },
    onSubmit: async ({ value }) => {
      setError("");
      setMessage("");
      const actors = Object.fromEntries(
        ACTORS.filter(({ key }) => value.actors[key].id.trim()).map(({ key }) => [
          key,
          {
            id: value.actors[key].id.trim(),
            queryField: value.actors[key].queryField.trim(),
            locationField: value.actors[key].locationField.trim(),
            limitField: value.actors[key].limitField.trim(),
          },
        ]),
      );
      const input = discoveryConnectionSchema.safeParse({
        enabled: value.enabled,
        apiKey: value.apiKey.trim() || undefined,
        ...(provider === "apify" ? actors : {}),
      });
      if (!input.success) {
        setError(
          input.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(" "),
        );
        return;
      }
      setBusy(true);
      try {
        const result = await api["job-sources"].connections({ provider }).put(input.data);
        if (result.error) throw new Error(apiErrorMessage(result.error));
        form.setFieldValue("apiKey", "");
        setMessage("Discovery connection saved. Keys stay encrypted on the server.");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save connection.");
      } finally {
        setBusy(false);
      }
    },
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry repeats the load without changing providers.
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    setError("");
    void api["job-sources"].connections
      .get()
      .then((result) => {
        if (cancelled) return;
        if (result.error) throw new Error(apiErrorMessage(result.error));
        const saved = result.data.find((row) => row.provider === provider);
        form.reset({ apiKey: "", enabled: saved?.enabled ?? false, actors: actorDrafts(saved) });
        setLoaded(true);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load connections.");
      });
    return () => {
      cancelled = true;
    };
  }, [form, provider, reload]);

  return (
    <Stack
      component="form"
      spacing={2}
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && loaded) void form.handleSubmit();
      }}
    >
      <Typography variant="h4">Job search providers</Typography>
      <Typography variant="body2Muted">
        Use your own SerpApi or Apify account for additional coverage. Searches may consume provider
        credits. API keys are encrypted on the server; board passwords and browser cookies are not
        used.
      </Typography>
      <TextField
        select
        label="Provider"
        value={provider}
        disabled={busy}
        onChange={(e) => {
          setProvider(e.target.value as typeof provider);
          form.reset({ apiKey: "", enabled: false, actors: actorDrafts() });
          setMessage("");
        }}
      >
        <MenuItem value="serpapi">Google Jobs through SerpApi</MenuItem>
        <MenuItem value="apify">Job boards through Apify</MenuItem>
      </TextField>
      {!loaded && !error && <LinearProgress aria-label="Loading provider settings" />}
      <form.Field name="apiKey">
        {(field) => (
          <TextField
            label="API key"
            type="password"
            autoComplete="off"
            value={field.state.value}
            onChange={(e) => field.handleChange(e.target.value)}
            disabled={busy || !loaded}
            helperText="Leave blank to retain an existing key."
          />
        )}
      </form.Field>
      {provider === "apify" && (
        <Stack spacing={2}>
          <Typography variant="body2Muted">
            Add an actor only for the boards you want to use. Check its input names and output
            format against the actor's documentation; saving these settings does not verify the
            actor.
          </Typography>
          {ACTORS.map(({ key, label }) => (
            <Stack key={key} spacing={1}>
              <form.Field name={`actors.${key}.id`}>
                {(field) => (
                  <TextField
                    label={`${label} actor (owner/name)`}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    disabled={busy || !loaded}
                    helperText={
                      key === "hiringcafeActor"
                        ? "Optional saved configuration. HiringCafe results are available in private search previews, not the shared index."
                        : "Optional. Leave blank to disable this board's actor."
                    }
                  />
                )}
              </form.Field>
              <Accordion disableGutters disabled={busy || !loaded}>
                <AccordionSummary
                  expandIcon={<ExpandMore />}
                  aria-controls={`${key}-mapping-content`}
                  id={`${key}-mapping-header`}
                >
                  <Typography variant="body2">{label} input mapping</Typography>
                </AccordionSummary>
                <AccordionDetails id={`${key}-mapping-content`}>
                  <Stack spacing={1.5}>
                    <Typography variant="captionMuted">
                      Use the exact field names from this actor's input schema. These defaults may
                      need changing.
                    </Typography>
                    {INPUT_FIELDS.map(({ key: fieldKey, label: fieldLabel }) => (
                      <form.Field key={fieldKey} name={`actors.${key}.${fieldKey}`}>
                        {(field) => (
                          <TextField
                            label={`${label} ${fieldLabel.toLowerCase()}`}
                            size="small"
                            value={field.state.value}
                            onChange={(e) => field.handleChange(e.target.value)}
                            disabled={busy || !loaded}
                          />
                        )}
                      </form.Field>
                    ))}
                  </Stack>
                </AccordionDetails>
              </Accordion>
            </Stack>
          ))}
        </Stack>
      )}
      <form.Field name="enabled">
        {(field) => (
          <FormControlLabel
            control={
              <Switch
                checked={field.state.value}
                onChange={(e) => field.handleChange(e.target.checked)}
                disabled={busy || !loaded}
              />
            }
            label="Enable this discovery connector"
          />
        )}
      </form.Field>
      <Button type="submit" disabled={busy || !loaded} variant="outlined">
        {busy ? "Saving…" : "Save connection"}
      </Button>
      {error && (
        <Alert
          severity="error"
          action={
            !loaded && (
              <Button color="inherit" size="small" onClick={() => setReload((value) => value + 1)}>
                Retry
              </Button>
            )
          }
        >
          {error}
        </Alert>
      )}
      {message && <Alert severity="info">{message}</Alert>}
    </Stack>
  );
}
