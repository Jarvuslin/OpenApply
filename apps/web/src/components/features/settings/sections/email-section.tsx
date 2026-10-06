import type { ReactElement } from "react";
import { ConnectCard } from "./connect-card";

/** Shared Gmail connection flow for Settings and the workbench. */
export function EmailSection(): ReactElement {
  return <ConnectCard />;
}
