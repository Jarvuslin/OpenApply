import type { ReactElement } from "react";
import { Stack } from "@mui/material";
import type { Metadata } from "next";
import { SourceCoverage } from "@/components/features/discover/source-coverage";
import { DiscoveryConnections } from "@/components/features/mvp/discovery-connections";
import { LinkedinDiscoverySettings } from "@/components/features/mvp/linkedin-discovery-settings";
import { RuntimeStatus } from "@/components/features/mvp/runtime-status";
import { SourceImports } from "@/components/features/mvp/source-imports";
import { AdvancedTools } from "@/components/features/settings/advanced-tools";
import { LinkButton } from "@/components/ui/buttons";

export const metadata: Metadata = { title: "Connections" };

export default function ConnectionsSettingsPage(): ReactElement {
  return (
    <Stack spacing={3}>
      <Stack direction="row" spacing={2}>
        <LinkButton href="/queue" variant="outlined">
          Connect computer
        </LinkButton>
        <LinkButton href="/boards" variant="outlined">
          Manage job boards
        </LinkButton>
        <LinkButton href="/inbox" variant="outlined">
          Open inbox
        </LinkButton>
        <LinkButton href="/settings/telegram" variant="outlined">
          Telegram settings
        </LinkButton>
      </Stack>
      <RuntimeStatus />
      <DiscoveryConnections />
      <LinkedinDiscoverySettings />
      <SourceImports />
      <SourceCoverage />
      <AdvancedTools />
    </Stack>
  );
}
