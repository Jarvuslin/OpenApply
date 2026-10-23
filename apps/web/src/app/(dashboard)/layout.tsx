import type { PropsWithChildren, ReactElement } from "react";
import { AppShell } from "@/components/layout";

export default function DashboardLayout(props: PropsWithChildren): ReactElement {
  const { children } = props;
  return <AppShell>{children}</AppShell>;
}
