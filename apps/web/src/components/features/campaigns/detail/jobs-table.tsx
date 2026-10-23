"use client";

import type { ReactElement } from "react";
import { Button } from "@mui/material";
import type { GridColDef, GridRowSelectionModel } from "@mui/x-data-grid";
import type { CampaignJobStatus } from "@openapply/contracts/campaign";
import type { CampaignJobDto } from "@/api/types";
import { DataTable } from "@/components/ui/data/data-table";
import type { GridPaginationProps } from "@/hooks/use-pagination";
import { CampaignJobStatusChip } from "../campaign-status-chip";

/** Statuses that can still be applied to from the campaigns detail page. */
function isApplicable(status: CampaignJobStatus): boolean {
  return status === "pending" || status === "approved";
}

/** Statuses eligible for selection + bulk re-apply on a stopped campaign. */
export function isReapplicable(status: CampaignJobStatus): boolean {
  return status !== "applied" && status !== "applying";
}

interface CampaignJobsTableProps extends GridPaginationProps {
  rows: ReadonlyArray<CampaignJobDto>;
  onViewJob: (job: CampaignJobDto) => void;
  loading?: boolean;
  /** When provided, applicable rows get an "Apply" action that calls this. */
  onApplyJob?: (job: CampaignJobDto) => void;

  onDraftProposal?: (job: CampaignJobDto) => void;

  showReason?: boolean;
  /** Enables checkbox selection (reapplicable rows only). */
  checkboxSelection?: boolean;
  rowSelectionModel?: GridRowSelectionModel;
  onRowSelectionModelChange?: (model: GridRowSelectionModel) => void;
}

export function CampaignJobsTable(props: CampaignJobsTableProps): ReactElement {
  const {
    rows,
    onViewJob,
    loading,
    onApplyJob,
    onDraftProposal,
    showReason,
    checkboxSelection,
    rowSelectionModel,
    onRowSelectionModelChange,
    ...pagination
  } = props;
  const columns: GridColDef<CampaignJobDto>[] = [
    {
      field: "status",
      headerName: "Status",
      width: 130,
      renderCell: (p) => <CampaignJobStatusChip status={p.row.status} />,
      sortable: false,
    },
    {
      field: "title",
      headerName: "Title",
      flex: 1.4,
      minWidth: 200,
      renderCell: (p) => (
        <Button
          color="inherit"
          onClick={(event) => {
            event.stopPropagation();
            onViewJob(p.row);
          }}
          sx={{ justifyContent: "flex-start", textAlign: "left" }}
        >
          {p.row.title}
        </Button>
      ),
    },
    { field: "company", headerName: "Company", flex: 1, minWidth: 160 },
    { field: "board", headerName: "Board", width: 130 },
    {
      field: "matchScore",
      headerName: "Resume fit",
      width: 120,
      align: "right",
      headerAlign: "right",
      valueGetter: (_v, row) => row.matchScore ?? "",
      renderCell: (p) => (
        <Button
          size="small"
          onClick={(event) => {
            event.stopPropagation();
            onViewJob(p.row);
          }}
          aria-label={`View fit evidence for ${p.row.title}`}
        >
          {p.row.matchScore === null ? "View fit" : `${p.row.matchScore}/100`}
        </Button>
      ),
    },
    ...(showReason
      ? [
          {
            field: "matchReason",
            headerName: "Why",
            flex: 1.5,
            minWidth: 220,
            valueGetter: (_v, row) => row.matchReason ?? "",
          } satisfies GridColDef<CampaignJobDto>,
        ]
      : []),
    {
      field: "failReason",
      headerName: "Fail reason",
      flex: 1,
      minWidth: 160,
      valueGetter: (_v, row) => row.failReason ?? row.skipReason ?? "",
    },
  ];

  if (onApplyJob || onDraftProposal) {
    columns.push({
      field: "actions",
      headerName: "",
      width: onDraftProposal ? 150 : 96,
      sortable: false,
      filterable: false,
      align: "right",
      headerAlign: "right",
      renderCell: (p) => {
        if (!isApplicable(p.row.status)) {
          return null;
        }
        if (onApplyJob) {
          return (
            <Button
              size="small"
              variant="outlined"
              onClick={(event) => {
                event.stopPropagation();
                onApplyJob(p.row);
              }}
            >
              Apply
            </Button>
          );
        }
        return (
          <Button
            size="small"
            variant="outlined"
            onClick={(event) => {
              event.stopPropagation();
              onDraftProposal?.(p.row);
            }}
          >
            Draft proposal
          </Button>
        );
      },
    });
  }

  return (
    <DataTable
      rows={rows}
      columns={columns}
      loading={loading}
      getRowId={(row) => row.id}
      onRowClick={onViewJob}
      disableRowSelectionOnClick
      checkboxSelection={checkboxSelection}
      rowSelectionModel={rowSelectionModel}
      onRowSelectionModelChange={onRowSelectionModelChange}
      isRowSelectable={(row) => isReapplicable(row.status)}
      keepNonExistentRowsSelected
      {...pagination}
    />
  );
}
