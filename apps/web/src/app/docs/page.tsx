import type { ReactElement } from "react";
import { Stack, Typography } from "@mui/material";
import type { Metadata } from "next";
import { DocsIndexCards } from "@/components/features/docs";

const description =
  "How to set up and use OpenApply: the agent, the Pilot, campaigns, email, and credentials.";

export const metadata: Metadata = {
  title: "Docs",
  description,
  alternates: { canonical: "/docs" },
  openGraph: { type: "article", url: "/docs", title: "Docs · OpenApply", description },
  twitter: { title: "Docs · OpenApply", description },
};

export default function DocsIndexPage(): ReactElement {
  return (
    <Stack spacing={3}>
      <Stack spacing={1.5}>
        <Typography variant="docsH1">OpenApply docs</Typography>
        <Typography variant="docsBody">
          OpenApply is an AI agent that runs your job search. The dashboard lives on the web and
          holds your profile, resumes, campaigns, and pipeline. The agent runs on your own machine,
          on your Claude Code or Codex subscription, and drives a real browser. There is no API key,
          and OpenApply bills you for nothing.
        </Typography>
        <Typography variant="docsBody">
          The agent searches job boards, scores each posting against your resume, tailors a variant
          per job, fills out the application, and tracks the reply in your inbox. Drive it action by
          action from the dashboard, or hand the whole search to the Pilot and read the journal in
          the morning. These guides cover setup and everyday use.
        </Typography>
      </Stack>
      <DocsIndexCards />
    </Stack>
  );
}
