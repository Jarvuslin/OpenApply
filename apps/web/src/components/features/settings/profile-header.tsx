"use client";

import type { ReactElement, ReactNode } from "react";
import {
  Avatar,
  Box,
  Chip,
  LinearProgress,
  Link,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import type { UserWithAutoApplyInput } from "@openapply/contracts/user";
import { Link2, Mail, MapPin, Phone } from "lucide-react";

const PROFILE_TABS = [
  { value: "about", label: "About you" },
  { value: "work", label: "Work & education" },
  { value: "answers", label: "Application answers" },
  { value: "documents", label: "Documents" },
] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number]["value"];

interface ProfileHeaderProps {
  values: UserWithAutoApplyInput;
  percent: number;
  missingAnswers: number;
  tab: ProfileTab;
  onTab: (tab: ProfileTab) => void;
  onEditLinks: () => void;
  /** Opens the answers tab filtered to the unanswered questions. */
  onShowMissing: () => void;
}

/** Who the agent applies as, how complete that is, and the profile's tabs. */
export function ProfileHeader(props: ProfileHeaderProps): ReactElement {
  const { values, percent, missingAnswers, tab, onTab, onEditLinks, onShowMissing } = props;
  const name = [values.firstName, values.lastName].filter(Boolean).join(" ") || "Your name";
  const initials = [values.firstName, values.lastName].map((part) => part?.[0] ?? "").join("");
  const place = [values.city, values.country].filter(Boolean).join(", ");
  const current = PROFILE_TABS.find((option) => option.value === tab)?.label;
  return (
    <Box>
      <Typography variant="captionMuted" component="p" sx={{ mb: 1.5 }}>
        <Box component="span" sx={{ color: "text.primary" }}>
          Profile
        </Box>
        {"  /  "}
        {current}
      </Typography>
      <Stack
        direction={{ xs: "column", md: "row" }}
        spacing={2.5}
        sx={{ alignItems: { md: "center" }, pb: 2 }}
      >
        <Avatar
          sx={{ width: 64, height: 64, bgcolor: "primary.main", color: "primary.contrastText" }}
        >
          <Typography variant="h3" component="span">
            {initials || "?"}
          </Typography>
        </Avatar>
        <Stack spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h2" component="h1">
            {name}
          </Typography>
          <Stack direction="row" spacing={1.5} useFlexGap sx={{ flexWrap: "wrap" }}>
            {values.contactEmail && <Meta icon={<Mail size={13} />}>{values.contactEmail}</Meta>}
            {values.phone && <Meta icon={<Phone size={13} />}>{values.phone}</Meta>}
            {place && <Meta icon={<MapPin size={13} />}>{place}</Meta>}
            <ProfileLink label="LinkedIn" href={values.linkedin} onAdd={onEditLinks} />
            <ProfileLink label="GitHub" href={values.github} onAdd={onEditLinks} />
          </Stack>
        </Stack>
        <Stack spacing={0.75} sx={{ width: { md: 180 }, alignItems: { md: "flex-end" } }}>
          <Stack direction="row" spacing={0.75} sx={{ alignItems: "baseline" }}>
            <Typography variant="body1Strong">{percent}%</Typography>
            <Typography variant="captionMuted">complete</Typography>
          </Stack>
          <LinearProgress
            variant="determinate"
            value={percent}
            aria-label="Profile completeness"
            sx={{ width: "100%", height: 4, borderRadius: 1 }}
          />
          {missingAnswers > 0 && (
            <Link component="button" variant="caption" onClick={onShowMissing}>
              {missingAnswers} {missingAnswers === 1 ? "answer" : "answers"} to add →
            </Link>
          )}
        </Stack>
      </Stack>
      <Tabs
        value={tab}
        onChange={(_, value: ProfileTab) => onTab(value)}
        variant="scrollable"
        allowScrollButtonsMobile
        aria-label="Profile sections"
        sx={{
          borderBottom: 1,
          borderColor: "divider",
          "& .MuiTab-root": { px: 1.5, minWidth: 0, textTransform: "none" },
          "& .MuiTab-root:hover": { color: "text.primary" },
        }}
      >
        {PROFILE_TABS.map((option) => (
          <Tab
            key={option.value}
            value={option.value}
            label={
              <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
                <span>{option.label}</span>
                {option.value === "answers" && missingAnswers > 0 && (
                  <Chip size="small" color="primary" variant="outlined" label={missingAnswers} />
                )}
              </Stack>
            }
          />
        ))}
      </Tabs>
    </Box>
  );
}

function Meta({ icon, children }: { icon: ReactNode; children: ReactNode }): ReactElement {
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", color: "text.secondary" }}>
      <Box sx={{ display: "flex" }} aria-hidden>
        {icon}
      </Box>
      <Typography variant="captionMuted">{children}</Typography>
    </Stack>
  );
}

interface ProfileLinkProps {
  label: string;
  href?: string | null;
  onAdd: () => void;
}

function ProfileLink({ label, href, onAdd }: ProfileLinkProps): ReactElement {
  return (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
      <Link2 size={13} aria-hidden />
      {href ? (
        <Link href={href} target="_blank" rel="noopener noreferrer" variant="caption">
          {label}
        </Link>
      ) : (
        <Link component="button" variant="caption" onClick={onAdd}>
          Add {label}
        </Link>
      )}
    </Stack>
  );
}
