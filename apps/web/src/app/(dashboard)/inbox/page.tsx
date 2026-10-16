import type { ReactElement } from "react";
import type { Metadata } from "next";
import { InboxContent } from "@/components/features/inbox/inbox-content";
import { PageHeader, PageShell } from "@/components/ui/layout";

export const metadata: Metadata = { title: "Inbox" };

export default function InboxPage(): ReactElement {
  return (
    <PageShell maxWidth="lg">
      <PageHeader
        title="Inbox"
        description="Replies, rejections, and offers from the boards you applied to. Approve to update the matching application's status."
      />
      <InboxContent />
    </PageShell>
  );
}
