import type { ReactElement } from "react";
import { type Tab, TabStrip } from "@/components/ui/navigation/tab-strip";

const TABS: Tab[] = [{ label: "Resumes", href: "/documents/resumes" }];

export function DocumentsTabs(): ReactElement {
  return <TabStrip tabs={TABS} ariaLabel="Document types" />;
}
