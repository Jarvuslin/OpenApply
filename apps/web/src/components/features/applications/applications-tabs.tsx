import type { ReactElement } from "react";
import type { Route } from "next";
import { TabStrip } from "@/components/ui/navigation/tab-strip";

export function ApplicationsTabs(): ReactElement {
  return (
    <TabStrip
      ariaLabel="Applications sections"
      tabs={[
        { label: "Applications", href: "/applications" },
        { label: "Searches", href: "/applications/searches" as Route },
      ]}
    />
  );
}
