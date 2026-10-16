"use client";

import { type ReactElement, useEffect, useState } from "react";
import { Alert, Button, MenuItem, Stack, TextField, Typography } from "@mui/material";
import NextLink from "next/link";
import { api } from "@/api/client";
import { apiErrorMessage } from "@/api/error";
import { SectionCard } from "@/components/ui/layout";

type Connections = NonNullable<
  Awaited<ReturnType<(typeof api)["job-sources"]["connections"]["get"]>>["data"]
>;

interface DiscoverySearchProps {
  onImported: () => void;
}

export function DiscoverySearch(props: DiscoverySearchProps): ReactElement {
  const { onImported } = props;
  const [connections, setConnections] = useState<Connections>([]);
  const [provider, setProvider] = useState<"apify" | "serpapi">("serpapi");
  const [board, setBoard] = useState<"indeed" | "linkedin">("indeed");
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    void api["job-sources"].connections
      .get()
      .then((result) => {
        if (cancelled) return;
        if (result.error) throw new Error(apiErrorMessage(result.error));
        const enabled = result.data.filter(
          (connection) =>
            connection.enabled &&
            (connection.provider === "apify" || connection.provider === "serpapi"),
        );
        setConnections(enabled);
        const firstProvider = enabled[0]?.provider;
        if (firstProvider === "apify" || firstProvider === "serpapi") setProvider(firstProvider);
        setLoaded(true);
      })
      .catch((reason) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : "Could not load search providers.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function search(): Promise<void> {
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
        `Imported ${result.data.imported} listings. ${result.data.resolved} have an employer apply page. Review them in Discover.`,
      );
      onImported();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Discovery failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard title="Search a provider manually">
      <Stack spacing={2}>
        <Typography variant="body2Muted">
          Import listings with your own search terms. Discover lets you filter and save the results.
          Searches may use provider credits.
        </Typography>
        {loaded && connections.length === 0 && (
          <Typography variant="body2">
            Connect a search provider in Settings to find more openings.
          </Typography>
        )}
        {connections.length > 0 && (
          <>
            <TextField
              select
              label="Search provider"
              value={provider}
              onChange={(event) => setProvider(event.target.value as typeof provider)}
            >
              {connections.map((connection) => (
                <MenuItem key={connection.provider} value={connection.provider}>
                  {connection.provider === "serpapi" ? "Google Jobs" : "LinkedIn / Indeed"}
                </MenuItem>
              ))}
            </TextField>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={2}>
              <TextField
                fullWidth
                label="Role to find"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <TextField
                fullWidth
                label="Location"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
              />
            </Stack>
            {provider === "apify" && (
              <TextField
                select
                label="Board"
                value={board}
                onChange={(event) => setBoard(event.target.value as typeof board)}
              >
                <MenuItem value="indeed">Indeed</MenuItem>
                <MenuItem value="linkedin">LinkedIn</MenuItem>
              </TextField>
            )}
            <Button
              variant="outlined"
              onClick={() => void search()}
              disabled={busy || query.trim().length < 2}
            >
              Find jobs
            </Button>
          </>
        )}
        <Button component={NextLink} href="/discover" sx={{ alignSelf: "flex-start" }}>
          Browse jobs
        </Button>
        {error && <Alert severity="error">{error}</Alert>}
        {message && <Alert severity="info">{message}</Alert>}
      </Stack>
    </SectionCard>
  );
}
