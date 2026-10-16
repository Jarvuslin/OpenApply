import type { ReactElement } from "react";
import { MenuItem, Stack, TextField, Typography } from "@mui/material";
import type { DiscoverFilters } from "./job-board-types";

interface DateFilterProps {
  label: string;
  range: DiscoverFilters["postedRange"];
  from: string;
  to: string;
  onChange: (range: DiscoverFilters["postedRange"], from: string, to: string) => void;
}

export function DateFilter(props: DateFilterProps): ReactElement {
  const { label, range, from, to, onChange } = props;
  return (
    <Stack spacing={1.5}>
      <TextField
        select
        size="small"
        label={label}
        value={range}
        onChange={(event) =>
          onChange(event.target.value as DiscoverFilters["postedRange"], from, to)
        }
      >
        <MenuItem value="all">All time</MenuItem>
        <MenuItem value="1">Past 24 hours</MenuItem>
        <MenuItem value="3">Past 3 days</MenuItem>
        <MenuItem value="7">Past week</MenuItem>
        <MenuItem value="14">Past 2 weeks</MenuItem>
        <MenuItem value="30">Past month</MenuItem>
        <MenuItem value="90">Past 3 months</MenuItem>
        <MenuItem value="custom">Custom range</MenuItem>
      </TextField>
      {range === "custom" && (
        <Stack spacing={1.5}>
          <TextField
            size="small"
            type="date"
            label={`${label} from`}
            value={from}
            onChange={(event) => onChange(range, event.target.value, to)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <TextField
            size="small"
            type="date"
            label={`${label} through`}
            value={to}
            onChange={(event) => onChange(range, from, event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          <Typography variant="captionMuted">Includes both dates, using UTC.</Typography>
        </Stack>
      )}
    </Stack>
  );
}
