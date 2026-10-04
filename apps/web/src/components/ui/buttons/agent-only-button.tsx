"use client";

import type { ReactElement, ReactNode } from "react";
import { Box, Button, type ButtonProps, Tooltip } from "@mui/material";
import { useAgentAvailable } from "@/providers/agent-provider";

const UNAVAILABLE = "Open OpenApply on your desktop to run this.";

interface AgentOnlyButtonProps extends ButtonProps {
  children: ReactNode;
  /** Shown while the agent is reachable; the unavailable reason replaces it otherwise. */
  tooltip?: string;
}

/** Disabled with a reason, not hidden: a control that vanishes reads as a missing feature. */
export function AgentOnlyButton(props: AgentOnlyButtonProps): ReactElement {
  const { children, disabled, tooltip = "", ...rest } = props;
  const available = useAgentAvailable();

  return (
    <Tooltip title={available ? tooltip : UNAVAILABLE}>
      {/* A disabled button emits no pointer events, so the tooltip needs an enabled wrapper. */}
      <Box component="span" sx={{ display: "inline-flex" }}>
        <Button {...rest} disabled={disabled || !available}>
          {children}
        </Button>
      </Box>
    </Tooltip>
  );
}
