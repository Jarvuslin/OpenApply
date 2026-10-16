import type { ReactNode } from "react";
import { NeedsYouCount } from "@/components/features/questions/needs-you-badge";
import { QueueCount } from "@/components/features/queue/queue-badge";
import type { NavItem } from "./shell-config";

interface NavCountProps {
  badge: NavItem["badge"];
  active: boolean;
}

export function NavCount({ badge, active }: NavCountProps): ReactNode {
  if (badge === "queue") return <QueueCount active={active} />;
  if (badge === "needs-you") return <NeedsYouCount />;
  return null;
}
