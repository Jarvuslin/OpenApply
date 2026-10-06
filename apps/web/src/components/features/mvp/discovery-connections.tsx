"use client";
import { useEffect, useState } from "react";
import type { discoveryConnectionSchema } from "@jobpilot/contracts/job-sources";
import {
  Alert,
  Button,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from "@mui/material";
import type { z } from "zod/v4";
import { api } from "@/api/client";
import { apiErrorMessage } from "@/api/error";

export function DiscoveryConnections() {
  const [provider, setProvider] = useState<"apify" | "serpapi">("serpapi");
  const [key, setKey] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [indeed, setIndeed] = useState("");
  const [linkedin, setLinkedin] = useState("");
  const [board, setBoard] = useState<"indeed" | "linkedin">("indeed");
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [actors, setActors] = useState<
    Pick<z.infer<typeof discoveryConnectionSchema>, "indeedActor" | "linkedinActor">
  >({});
  useEffect(() => {
    let cancelled = false;
    setLoaded(false);
    void api["job-sources"].connections
      .get()
      .then((result) => {
        if (cancelled) return;
        if (result.error) throw new Error(apiErrorMessage(result.error));
        const saved = result.data.find((row) => row.provider === provider);
        setEnabled(saved?.enabled ?? false);
        setIndeed(saved?.indeedActor?.id ?? "");
        setLinkedin(saved?.linkedinActor?.id ?? "");
        setActors({ indeedActor: saved?.indeedActor, linkedinActor: saved?.linkedinActor });
        setLoaded(true);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load connections.");
      });
    return () => {
      cancelled = true;
    };
  }, [provider]);
  async function save() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api["job-sources"].connections({ provider }).put({
        enabled,
        apiKey: key || undefined,
        ...(provider === "apify"
          ? {
              indeedActor: indeed
                ? {
                    queryField: "query",
                    locationField: "location",
                    limitField: "maxItems",
                    ...actors.indeedActor,
                    id: indeed,
                  }
                : undefined,
              linkedinActor: linkedin
                ? {
                    queryField: "query",
                    locationField: "location",
                    limitField: "maxItems",
                    ...actors.linkedinActor,
                    id: linkedin,
                  }
                : undefined,
            }
          : {}),
      });
      if (result.error) throw new Error(apiErrorMessage(result.error));
      setKey("");
      setMessage("Discovery connection saved. Keys stay encrypted on the server.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save connection.");
    } finally {
      setBusy(false);
    }
  }
  async function search() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api["job-sources"].discover.post({
        provider,
        query,
        location,
        board: provider === "apify" ? board : undefined,
        limit: 20,
      });
      if (result.error) throw new Error(apiErrorMessage(result.error));
      setMessage(
        `Imported ${result.data.imported} listings. ${result.data.resolved} have an employer apply page. Open Discover to review them.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Discovery failed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack spacing={2}>
      <Typography variant="h4">Optional job discovery</Typography>
      <Typography variant="body2Muted">
        Use your own SerpApi or Apify account. Searches use HTTP and may consume your provider
        credits. No board login or browser cookies are used.
      </Typography>
      <TextField
        select
        label="Provider"
        value={provider}
        onChange={(e) => {
          setProvider(e.target.value as typeof provider);
          setKey("");
          setEnabled(false);
          setMessage("");
        }}
      >
        <MenuItem value="serpapi">Google Jobs through SerpApi</MenuItem>
        <MenuItem value="apify">LinkedIn / Indeed through Apify</MenuItem>
      </TextField>
      <TextField
        label="API key"
        type="password"
        value={key}
        onChange={(e) => setKey(e.target.value)}
        helperText="Leave blank to retain an existing key."
      />
      {provider === "apify" && (
        <>
          <TextField
            label="Indeed actor (owner/name)"
            value={indeed}
            onChange={(e) => setIndeed(e.target.value)}
          />
          <TextField
            label="LinkedIn actor (owner/name)"
            value={linkedin}
            onChange={(e) => setLinkedin(e.target.value)}
          />
          <Typography variant="captionMuted">
            Choose actors that accept query, location and maxItems. Other input field names can be
            configured through the API. Actor availability and output formats must be tested with
            your account.
          </Typography>
        </>
      )}
      <FormControlLabel
        control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />}
        label="Enable this discovery connector"
      />
      <Button onClick={() => void save()} disabled={busy || !loaded} variant="outlined">
        Save connection
      </Button>
      <TextField label="Role to find" value={query} onChange={(e) => setQuery(e.target.value)} />
      <TextField label="Location" value={location} onChange={(e) => setLocation(e.target.value)} />
      {provider === "apify" && (
        <TextField
          select
          label="Board"
          value={board}
          onChange={(e) => setBoard(e.target.value as typeof board)}
        >
          <MenuItem value="indeed">Indeed</MenuItem>
          <MenuItem value="linkedin">LinkedIn</MenuItem>
        </TextField>
      )}
      <Button
        onClick={() => void search()}
        disabled={busy || !loaded || !enabled || query.trim().length < 2}
      >
        Find jobs
      </Button>
      {error && <Alert severity="error">{error}</Alert>}
      {message && <Alert severity="info">{message}</Alert>}
    </Stack>
  );
}
