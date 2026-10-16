"use client";

import type { ReactElement } from "react";
import { Box, Typography, useTheme } from "@mui/material";
import { ResponsiveSankey } from "@nivo/sankey";
import { Waypoints } from "lucide-react";
import type { AnalyticsStatsDto } from "@/api/types";
import { SectionCard } from "@/components/ui/layout";

type Outcomes = AnalyticsStatsDto["outcomes"];

interface ApplicationOutcomesChartProps {
  data: Outcomes;
}

export function ApplicationOutcomesChart({ data }: ApplicationOutcomesChartProps): ReactElement {
  const { palette, typography } = useTheme();
  const color: Record<string, string> = {
    Applications: palette.grey[500],
    Rejected: palette.info.main,
    "No answer": palette.warning.main,
    Withdrawn: palette.grey[400],
    Interviews: palette.error.main,
    Offers: palette.success.main,
    "No offer": palette.warning.dark,
    Withdrew: palette.grey[400],
    "Still interviewing": palette.secondary.main,
  };
  const links = [
    { source: "Applications", target: "Rejected", value: data.rejected },
    { source: "Applications", target: "No answer", value: data.noAnswer },
    { source: "Applications", target: "Withdrawn", value: data.withdrawn },
    { source: "Applications", target: "Interviews", value: data.interviews },
    { source: "Interviews", target: "Offers", value: data.offers },
    { source: "Interviews", target: "No offer", value: data.noOffer },
    { source: "Interviews", target: "Withdrew", value: data.withdrewAfterInterview },
    { source: "Interviews", target: "Still interviewing", value: data.interviewing },
  ].filter((link) => link.value > 0);
  const nodes = [...new Set(links.flatMap((link) => [link.source, link.target]))].map((id) => ({
    id,
  }));
  // Few outcomes need little height; a chart sized for many would stretch two applications.
  const height = Math.min(96 + links.length * 24, 220);

  return (
    <SectionCard
      fullHeight
      title="Outcomes"
      icon={<Waypoints size={18} strokeWidth={1.75} aria-hidden />}
    >
      {links.length === 0 ? (
        <Typography variant="body2Muted">No applications yet.</Typography>
      ) : (
        <Box sx={{ height, my: "auto" }}>
          <ResponsiveSankey
            data={{ nodes, links }}
            margin={{ top: 8, right: 104, bottom: 8, left: 104 }}
            align="justify"
            sort="input"
            colors={(node) => color[node.id] ?? palette.grey[500]}
            nodeOpacity={1}
            nodeThickness={12}
            nodeSpacing={14}
            nodeBorderWidth={0}
            nodeBorderRadius={2}
            linkOpacity={0.35}
            linkHoverOpacity={0.6}
            linkBlendMode="normal"
            enableLinkGradient
            labelPosition="outside"
            labelPadding={6}
            label={(node) => `${node.id} (${node.value})`}
            labelTextColor={palette.text.primary}
            theme={{
              text: { fontFamily: typography.fontFamily, fontSize: 11 },
              tooltip: {
                container: {
                  background: palette.background.paper,
                  color: palette.text.primary,
                  fontSize: 12,
                },
              },
            }}
          />
        </Box>
      )}
    </SectionCard>
  );
}
