"use client";

import { type ReactElement, type ReactNode, useState } from "react";
import {
  Alert,
  Box,
  Button,
  DialogContent,
  LinearProgress,
  Stack,
  Typography,
} from "@mui/material";
import { USER_DEFAULT_VALUES } from "@openapply/contracts/user";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { useApiQuery } from "@/api/hooks";
import { userQueries } from "@/api/queries";
import { queryKeys } from "@/api/query-keys";
import { queueQueries } from "@/api/queue-queries";
import { Dialog, DialogTitle } from "@/components/ui/feedback";
import { SectionCard } from "@/components/ui/layout";
import { useHydrated } from "@/hooks/use-hydrated";
import { plural } from "@/utils/format";
import { QueueLimitsForm } from "./queue-limits-form";

export function QueueLimitsPanel(): ReactElement {
  const hydrated = useHydrated();
  if (!hydrated) return <LinearProgress aria-label="Loading queue limits" />;
  return <QueueLimitsContent />;
}

function QueueLimitsContent(): ReactElement {
  const client = useQueryClient();
  const limits = useApiQuery(queueQueries.limits(), { retry: false });
  const profile = useApiQuery(userQueries.detail());
  const applying = profile.data?.autoApply ?? USER_DEFAULT_VALUES.autoApply!;
  const [editing, setEditing] = useState(false);
  const data = limits.data;
  return (
    <SectionCard
      flush
      fullHeight
      title="Queue settings"
      icon={<ShieldCheck size={18} strokeWidth={1.75} aria-hidden />}
      actions={
        <Button
          size="small"
          variant="outlined"
          disabled={!data || !!limits.error || limits.isFetching || profile.isPending}
          onClick={() => setEditing(true)}
        >
          Edit
        </Button>
      }
    >
      {limits.isLoading && <LinearProgress aria-label="Loading queue limits" />}
      {limits.error && (
        <Alert
          severity="error"
          action={<Button onClick={() => void limits.refetch()}>Retry limits</Button>}
          sx={{ m: 2 }}
        >
          Could not load queue limits.
        </Alert>
      )}
      {data && (
        <Box
          data-queue-limits-revision={data.revision}
          sx={{
            flex: 1,
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gridAutoFlow: "column",
            gridTemplateRows: "repeat(4, auto)",
            alignContent: "space-evenly",
            rowGap: 2,
            py: 2,
            position: "relative",
            // The same inset rule as the profile cards: card border colour, short of the edges.
            "&::before": {
              content: '""',
              position: "absolute",
              left: "50%",
              top: 16,
              bottom: 16,
              width: "1px",
              bgcolor: "divider",
            },
          }}
        >
          <Setting label="Runs">
            {typeof data.runsRemaining === "number" ? `${data.runsRemaining} left` : "No limit"}
          </Setting>
          <Setting label="At once">
            {plural(data.maxConcurrentWorkers, "application")} at a time
          </Setting>
          <Setting label="Per day">{plural(data.dailyApplicationCap, "application")}</Setting>
          <Setting label="Per search">
            {applying.maxApplicationsPerCampaign
              ? plural(applying.maxApplicationsPerCampaign, "application")
              : "No limit"}
          </Setting>
          <Setting label="Match score">{applying.minMatchScore}+ out of 100</Setting>
          <Setting label="Availability">{applying.defaultStartDate || "Ask me"}</Setting>
          <Setting label="Retry failed">
            {data.autoRetryFailed ? "On · up to 2 retries after 15 min" : "Off"}
          </Setting>
          <Setting label="Per company">
            {data.companyApplicationCap} every {plural(data.companyWindowDays, "day")} ·{" "}
            {data.domainDelaySeconds} s between starts on one site
          </Setting>
        </Box>
      )}
      <Dialog open={editing} onClose={() => setEditing(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Queue settings</DialogTitle>
        <DialogContent>
          {editing && limits.data && (
            <QueueLimitsForm
              current={limits.data}
              applying={applying}
              close={() => setEditing(false)}
              reload={async () => {
                const result = await limits.refetch();
                if (!result.data || result.error) throw new Error("Could not reload limits.");
                return result.data;
              }}
              saved={() => {
                setEditing(false);
                void client.invalidateQueries({ queryKey: queryKeys.queue.all });
                void client.invalidateQueries({ queryKey: queryKeys.user.all });
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </SectionCard>
  );
}

interface SettingProps {
  label: string;
  children: ReactNode;
}

/** One setting in the two-column grid: a muted label above its value. */
function Setting({ label, children }: SettingProps): ReactElement {
  return (
    <Stack spacing={0.25} sx={{ px: 2.5 }}>
      <Typography variant="captionMuted">{label}</Typography>
      <Typography variant="body2">{children}</Typography>
    </Stack>
  );
}
