import type { Components, Theme } from "@mui/material/styles";
import type {} from "@mui/x-data-grid/themeAugmentation";
import { DEFAULT_PAGE_SIZE, PAGE_SIZE_OPTIONS } from "@openapply/contracts/pagination";

export const dataGridOverrides: Components<Theme>["MuiDataGrid"] = {
  defaultProps: {
    autoHeight: true,
    rowHeight: 56,
    columnHeaderHeight: 40,
    disableRowSelectionOnClick: true,
    pageSizeOptions: [...PAGE_SIZE_OPTIONS],
    initialState: { pagination: { paginationModel: { pageSize: DEFAULT_PAGE_SIZE } } },
  },
  styleOverrides: {
    root: ({ theme }) => ({
      width: "100%",
      border: `1px solid ${theme.palette.line.divider}`,
      borderRadius: theme.radii.md,
      backgroundColor: theme.palette.surfaces.card,
      "& .MuiDataGrid-columnHeaders": {
        backgroundColor: theme.palette.surfaces.elevated,
        ...theme.typography.overline,
        color: theme.palette.text.secondary,
      },
      "& .MuiDataGrid-cell": { ...theme.typography.body2, alignContent: "center" },
      "& .MuiDataGrid-row": {
        cursor: "pointer",
        "&:hover": { backgroundColor: theme.palette.surfaces.hover },
      },
      "& .MuiDataGrid-cell:focus, & .MuiDataGrid-columnHeader:focus": {
        outlineColor: theme.palette.info.main,
      },
    }),
  },
};
