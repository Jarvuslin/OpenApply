"use client";

import { type ReactElement, useEffect, useState } from "react";
import { Alert, Box, LinearProgress, Stack, Typography } from "@mui/material";
import { api } from "@/api/client";
import { Dialog, DialogTitle } from "@/components/ui/feedback";
import { getQueueFrame, type QueueWorker } from "@/lib/queue-companion";

const REFRESH_MS = 1_000;

interface QueueBrowserProps {
  worker: QueueWorker;
  /** The job's address, shown in the frame's address bar. */
  url: string | null;
  accountSetup?: boolean;
}

/** Live, read-only view of what the worker's browser shows; it follows the agent's scrolling. */
export function QueueBrowser(props: QueueBrowserProps): ReactElement {
  const { worker, url, accountSetup = false } = props;
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [enlarged, setEnlarged] = useState(false);
  const [frame, setFrame] = useState<Awaited<ReturnType<typeof getQueueFrame>> | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    api.auth.tokens.terminal
      .post()
      .then((response) => {
        if (controller.signal.aborted) return;
        if (response.error || !response.data) setError("Could not open the live view.");
        else setToken(response.data.token);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError("Could not open the live view.");
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh(): Promise<void> {
      try {
        if (document.visibilityState === "hidden") return;
        const result = await getQueueFrame(worker, token as string, controller.signal);
        if (!controller.signal.aborted) {
          setFrame(result);
          setError("");
        }
      } catch {
        if (!controller.signal.aborted) setError("Live view paused. Retrying…");
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), REFRESH_MS);
      }
    }
    void refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [token, worker]);
  const label = `Worker ${worker.slot} ${accountSetup ? "account" : "job"} browser, live`;
  const address = url ? url.replace(/^https?:\/\/(www\.)?/, "") : "Live view";
  return (
    <Stack spacing={1} data-queue-browser={worker.browserSessionId}>
      {error && <Alert severity="warning">{error}</Alert>}
      <Box
        sx={(theme) => ({
          border: 1,
          borderColor: "divider",
          borderRadius: theme.radii.md,
          overflow: "hidden",
        })}
      >
        <Stack
          direction="row"
          spacing={1.5}
          sx={{
            alignItems: "center",
            px: 1.25,
            py: 0.75,
            bgcolor: "surfaces.elevated",
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Stack direction="row" spacing={0.5} aria-hidden>
            {["a", "b", "c"].map((key) => (
              <Box
                key={key}
                sx={{ width: 7, height: 7, borderRadius: "50%", bgcolor: "line.borderHi" }}
              />
            ))}
          </Stack>
          <Typography
            variant="captionMuted"
            noWrap
            sx={(theme) => ({
              flex: 1,
              px: 1,
              border: 1,
              borderColor: "divider",
              borderRadius: theme.radii.xs,
              bgcolor: "background.paper",
            })}
          >
            {address}
          </Typography>
        </Stack>
        {!frame && !error && <LinearProgress aria-label="Loading the live view" />}
        {frame && (
          <Box
            component="img"
            alt={label}
            title="Open full size"
            src={`data:${frame.mimeType};base64,${frame.imageBase64}`}
            onClick={() => setEnlarged(true)}
            sx={{ width: 1, height: "auto", display: "block", cursor: "zoom-in" }}
          />
        )}
      </Box>
      {frame && (
        <>
          <Typography variant="captionMuted">
            Live · {new Date(frame.capturedAt).toLocaleTimeString()} · Click to enlarge. The agent
            scrolls the page itself.
          </Typography>
          <Dialog open={enlarged} onClose={() => setEnlarged(false)} maxWidth="xl" fullWidth>
            <DialogTitle>Live view</DialogTitle>
            <Box
              component="img"
              alt={label}
              src={`data:${frame.mimeType};base64,${frame.imageBase64}`}
              onClick={() => setEnlarged(false)}
              sx={{ width: 1, height: "auto", display: "block", cursor: "zoom-out" }}
            />
          </Dialog>
        </>
      )}
    </Stack>
  );
}
