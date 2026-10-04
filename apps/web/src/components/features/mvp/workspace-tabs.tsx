"use client";
import { useId } from "react";
import { Box, Button, Stack } from "@mui/material";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";

interface WorkspaceTabsProps {
  value: string;
  onChange: (value: string) => void;
  tabs: { value: string; label: string }[];
}
/** Custom navigation using Aceternity's shared-layout active pill pattern.
 * Reference: https://ui.aceternity.com/components/tabs. No template markup copied. */
export function WorkspaceTabs({ value, onChange, tabs }: WorkspaceTabsProps) {
  const id = useId();
  const reduceMotion = useReducedMotion();
  return (
    <LayoutGroup id={id}>
      <Stack
        role="tablist"
        aria-label="Workspace views"
        direction="row"
        sx={{
          p: 0.5,
          borderRadius: 99,
          bgcolor: "surfaces.elevated",
          width: "fit-content",
          maxWidth: "100%",
        }}
      >
        {tabs.map((tab, index) => (
          <Button
            key={tab.value}
            id={`${id}-${tab.value}`}
            role="tab"
            aria-selected={value === tab.value}
            aria-controls={`workspace-${tab.value}`}
            tabIndex={value === tab.value ? 0 : -1}
            onClick={() => onChange(tab.value)}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
              else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = tabs.length - 1;
              else return;
              event.preventDefault();
              const target = tabs[next];
              if (target) {
                onChange(target.value);
                document.getElementById(`${id}-${target.value}`)?.focus();
              }
            }}
            sx={{
              borderRadius: 99,
              minWidth: 0,
              px: { xs: 1.5, sm: 2.5 },
              color: value === tab.value ? "text.primary" : "text.secondary",
              position: "relative",
              "&:hover": { bgcolor: "transparent" },
            }}
          >
            {value === tab.value && (
              <Box
                component={motion.div}
                layoutId="active-pill"
                transition={{ duration: reduceMotion ? 0 : 0.22 }}
                sx={{
                  position: "absolute",
                  inset: 0,
                  bgcolor: "background.paper",
                  borderRadius: 99,
                  border: 1,
                  borderColor: "divider",
                  boxShadow: 1,
                }}
              />
            )}
            <Box component="span" sx={{ position: "relative" }}>
              {tab.label}
            </Box>
          </Button>
        ))}
      </Stack>
    </LayoutGroup>
  );
}
