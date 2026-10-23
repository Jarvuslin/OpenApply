"use client";

import type { ReactElement } from "react";
import { LinearProgress, Stack, Typography } from "@mui/material";
import { useApiQuery } from "@/api/hooks";
import { telegramQueries } from "@/api/telegram-queries";
import { SectionCard } from "@/components/ui/layout";
import { useSession } from "@/hooks/use-auth";
import { useHydrated } from "@/hooks/use-hydrated";
import { TelegramConnectCard } from "./telegram-connect-card";
import { TelegramNotifications } from "./telegram-notifications";

export function TelegramSettingsView(): ReactElement {
  const hydrated = useHydrated();
  if (!hydrated) return <LinearProgress aria-label="Loading Telegram settings" />;
  return <OwnedTelegramSettings />;
}

function OwnedTelegramSettings(): ReactElement {
  const { user } = useSession();
  if (!user) return <LinearProgress aria-label="Loading Telegram account" />;
  return <TelegramSettingsContent key={user.id} userId={user.id} />;
}

interface TelegramSettingsContentProps {
  userId: string;
}

function TelegramSettingsContent({ userId }: TelegramSettingsContentProps): ReactElement {
  const status = useApiQuery(telegramQueries.status(), { retry: false });
  const data = status.data;
  return (
    <Stack spacing={3}>
      <TelegramConnectCard userId={userId} />
      {data && (
        <TelegramNotifications
          current={data.settings}
          reload={async () => {
            const result = await status.refetch();
            if (result.error || !result.data)
              throw new Error("Could not load saved notification settings.");
            return result.data.settings;
          }}
          saved={() => void status.refetch()}
        />
      )}
      <SectionCard title="Supported messages">
        <Stack spacing={1}>
          <Typography>
            Send one job link to prepare it. Use the card buttons to add it to the queue or skip it.
          </Typography>
          <Typography>
            Use /status, /help or /unlink. To exclude a known company, say “stop applying to”
            followed by its exact company name. The confirmation includes Undo.
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Preparation, answers and approvals use the same records as the web app. Work still needs
            your computer and a separately approved model budget.
          </Typography>
        </Stack>
      </SectionCard>
    </Stack>
  );
}
