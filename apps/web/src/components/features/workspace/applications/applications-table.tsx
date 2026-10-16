"use client";

import type { ReactElement } from "react";
import {
  Box,
  Link,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import type { ApplicationStatus } from "@openapply/contracts/application";
import type { Route } from "next";
import type { ApplicationDto } from "@/api/types";
import { LinkButton } from "@/components/ui/buttons";
import { EmptyState } from "@/components/ui/data";
import { CompanyLogo, StatusChip } from "@/components/ui/display";
import { formatRelativeTime } from "@/utils/format";

interface ApplicationsTableProps {
  rows: ApplicationDto[];
  /** Maps a campaignId to its query, for attribution. */
  campaignLabel: Map<string, string>;
  filtered: boolean;
}

export function ApplicationsTable(props: ApplicationsTableProps): ReactElement {
  const { rows, campaignLabel, filtered } = props;

  if (rows.length === 0) {
    return (
      <EmptyState
        variant="inline"
        title={filtered ? "No applications match the filters" : "No applications yet"}
        description={
          filtered
            ? "Try another search or clear your filters."
            : "Find a job to apply to. Your submitted applications will appear here."
        }
        action={!filtered && <LinkButton href="/discover">Find jobs</LinkButton>}
      />
    );
  }

  return (
    <Box sx={{ overflowX: "auto" }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Role</TableCell>
            <TableCell>Company</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Source</TableCell>
            <TableCell align="right">Applied</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((a) => (
            <TableRow key={a.id} hover>
              <TableCell>
                <Link
                  href={`/applications/${a.id}` as Route}
                  underline="hover"
                  variant="body2Strong"
                >
                  {a.title}
                </Link>
              </TableCell>
              <TableCell>
                <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                  <CompanyLogo url={a.url} />
                  <Typography variant="inherit">{a.company}</Typography>
                </Stack>
              </TableCell>
              <TableCell>
                <StatusChip status={a.status as ApplicationStatus} />
              </TableCell>
              <TableCell>
                <Typography variant="captionMuted">
                  {a.campaignId ? (campaignLabel.get(a.campaignId) ?? a.source) : "Single apply"}
                </Typography>
              </TableCell>
              <TableCell align="right">
                <Typography variant="captionMuted">{formatRelativeTime(a.appliedAt)}</Typography>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}
