"use client";

import type { ReactNode } from "react";
import { CheckCircle, RadioButtonUnchecked } from "@mui/icons-material";
import { Stack, Typography } from "@mui/material";
import type { Route } from "next";
import { useApiQuery } from "@/api/hooks";
import { credentialQueries, emailQueries, userQueries } from "@/api/queries";
import { LinkButton } from "@/components/ui/buttons";
import { SectionCard } from "@/components/ui/layout";
import { useSession } from "@/hooks/use-auth";

interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
  href: Route;
  action: string;
}

/** Optional setup tasks; account verification is handled by the shared banner. */
export function ProfileChecklistCard(): ReactNode {
  const { user } = useSession();
  const profileQuery = useApiQuery(userQueries.detail());
  const emailQuery = useApiQuery(emailQueries.account());
  const loginQuery = useApiQuery(credentialQueries.login());

  // Don't flash an incomplete checklist while the queries load.
  if (!user || !profileQuery.data || !emailQuery.data || !loginQuery.data) {
    return null;
  }

  const profile = profileQuery.data.user;
  const mailbox = emailQuery.data;
  const needsReauth = mailbox.connected && mailbox.needsReauth;
  const items: ChecklistItem[] = [
    {
      key: "address",
      label: "Add your address and work authorization. Application forms ask for both.",
      done: Boolean(profile?.street && profile.city),
      href: "/profile" as Route,
      action: "Fill in",
    },
    {
      key: "mailbox",
      label: needsReauth
        ? "Reconnect your mailbox - Google rejected its access grant, so mail sync has stopped."
        : "Check your Gmail so the agent can read verification codes and recruiter replies.",
      done: mailbox.connected && !needsReauth,
      href: "/queue#login" as Route,
      action: needsReauth ? "Reconnect" : "Connect",
    },
    {
      key: "login",
      label: "Save your job login so the agent can sign in or create accounts on career sites.",
      done: !!loginQuery.data.email && loginQuery.data.hasPassword,
      href: "/queue#login" as Route,
      action: "Add",
    },
  ];

  const remaining = items.filter((item) => !item.done);
  if (remaining.length === 0) {
    return null;
  }

  return (
    <SectionCard title={`Finish setting up · ${items.length - remaining.length}/${items.length}`}>
      <Stack spacing={1}>
        {items.map((item) => (
          <Stack
            key={item.key}
            direction="row"
            spacing={1.25}
            sx={{ alignItems: "center", minHeight: 36 }}
          >
            {item.done ? (
              <CheckCircle fontSize="small" sx={{ color: "success.main" }} />
            ) : (
              <RadioButtonUnchecked fontSize="small" sx={{ color: "text.disabled" }} />
            )}
            <Typography
              variant="body2"
              sx={{ flex: 1, color: item.done ? "text.disabled" : "text.primary" }}
            >
              {item.label}
            </Typography>
            {!item.done && (
              <LinkButton href={item.href} size="small" variant="outlined">
                {item.action}
              </LinkButton>
            )}
          </Stack>
        ))}
      </Stack>
    </SectionCard>
  );
}
