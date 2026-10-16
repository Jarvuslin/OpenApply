"use client";

import { type ReactElement, useState } from "react";
import { Alert, Button, MenuItem, Stack, TextField, Typography } from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
import NextLink from "next/link";
import { api } from "@/api/client";
import { apiErrorMessage } from "@/api/error";
import { SectionCard } from "@/components/ui/layout";
import { DiscoverySearch } from "./discovery-search";

export function SourceImports(): ReactElement {
  const queryClient = useQueryClient();
  const [provider, setProvider] = useState<
    "ashby" | "greenhouse" | "lever" | "smartrecruiters" | "workable"
  >("ashby");
  const [board, setBoard] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const imported = () => {
    void queryClient.invalidateQueries({ queryKey: ["discover"] });
  };
  async function refresh(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      const result = await api.mvp.sources.post({ provider, board: board.trim() });
      if (result.error) throw new Error(apiErrorMessage(result.error));
      setMessage(`Imported ${result.data.imported} openings. Browse them in Discover.`);
      imported();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not import jobs.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Stack spacing={3}>
      <DiscoverySearch onImported={imported} />
      <SectionCard title="Import a company’s openings">
        <Stack spacing={2}>
          <Typography color="text.secondary">
            Optional: add jobs from a specific employer’s public careers board.
          </Typography>
          <Stack
            component="form"
            direction={{ xs: "column", sm: "row" }}
            spacing={2}
            onSubmit={(event) => {
              event.preventDefault();
              if (board.trim()) void refresh();
            }}
          >
            <TextField
              select
              label="Source"
              value={provider}
              onChange={(event) => setProvider(event.target.value as typeof provider)}
              sx={{ minWidth: 160 }}
            >
              {(["ashby", "greenhouse", "lever", "smartrecruiters", "workable"] as const).map(
                (value) => (
                  <MenuItem key={value} value={value}>
                    {value}
                  </MenuItem>
                ),
              )}
            </TextField>
            <TextField
              label="Company board name"
              value={board}
              onChange={(event) => setBoard(event.target.value)}
              sx={{ flex: 1 }}
            />
            <Button
              type="submit"
              variant="outlined"
              disabled={busy || !/^[a-zA-Z0-9_-][a-zA-Z0-9 _-]{0,79}$/.test(board.trim())}
            >
              Import jobs
            </Button>
          </Stack>
          {error && <Alert severity="error">{error}</Alert>}
          {message && (
            <Alert
              severity="success"
              action={
                <Button component={NextLink} href="/discover">
                  Discover
                </Button>
              }
            >
              {message}
            </Alert>
          )}
        </Stack>
      </SectionCard>
    </Stack>
  );
}
