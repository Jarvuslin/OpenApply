"use client";

import type { ReactElement } from "react";
import { RestartAlt, Search } from "@mui/icons-material";
import {
  Autocomplete,
  Button,
  Chip,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import type { DiscoverFilters } from "./job-board-types";

const TITLES = [
  "Software engineer",
  "AI engineer",
  "Frontend",
  "Backend",
  "Full stack",
  "Data engineer",
  "Machine learning",
  "DevOps",
  "Product designer",
  "Product manager",
  "QA",
  "Security",
];

interface SearchToolbarProps {
  filters: DiscoverFilters;
  onChange: (filters: DiscoverFilters) => void;
  keyword: string;
  onKeywordChange: (value: string) => void;
  onReset: () => void;
  onClear: () => void;
  onMarket: (market: "CA" | "US" | "CA_US" | "US_REMOTE") => void;
  customized: boolean;
  loading: boolean;
}

export function SearchToolbar(props: SearchToolbarProps): ReactElement {
  const {
    filters,
    onChange,
    keyword,
    onKeywordChange,
    onReset,
    onClear,
    onMarket,
    customized,
    loading,
  } = props;
  return (
    <Stack spacing={1.5}>
      <Stack
        direction="row"
        spacing={1.25}
        sx={{
          p: 2,
          border: 1,
          borderColor: "divider",
          borderRadius: 12,
          bgcolor: "background.paper",
        }}
      >
        <Autocomplete
          multiple
          freeSolo
          autoSelect
          options={TITLES}
          value={filters.titles}
          onChange={(_, titles) =>
            onChange({
              ...filters,
              titles: [...new Set(titles.map((title) => title.trim()).filter(Boolean))],
            })
          }
          renderInput={(params) => (
            <TextField
              {...params}
              label="Job titles"
              placeholder={
                filters.titles.length ? "Add a title" : "Software engineer, AI engineer…"
              }
            />
          )}
          renderValue={(values, getItemProps) =>
            values.map((value, index) => {
              const { key: _key, ...itemProps } = getItemProps({ index });
              return <Chip {...itemProps} key={value} label={value} size="small" />;
            })
          }
          sx={{ flex: 1.5, minWidth: 0 }}
        />
        <TextField
          value={keyword}
          onChange={(event) => onKeywordChange(event.target.value)}
          label="Keyword or company"
          placeholder="Search openings"
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <Search fontSize="sm" />
                </InputAdornment>
              ),
            },
          }}
          sx={{ flex: 1, minWidth: 0 }}
        />
      </Stack>
      <Stack
        direction="row"
        spacing={1}
        sx={{ alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}
      >
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: "center", flexWrap: "wrap", gap: 0.5 }}
        >
          <Chip
            size="small"
            variant="outlined"
            color={customized ? "default" : "success"}
            label={customized ? "Custom filters" : "From your profile"}
          />
          <Typography variant="captionMuted">
            Filters update results automatically and won’t change your profile.
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1}>
          <Button size="small" onClick={onClear} disabled={loading}>
            Clear all
          </Button>
          <Button
            size="small"
            startIcon={<RestartAlt fontSize="sm" />}
            onClick={onReset}
            disabled={loading}
          >
            Reset to match profile
          </Button>
        </Stack>
      </Stack>
      <Stack direction="row" sx={{ alignItems: "center", flexWrap: "wrap", gap: 1 }}>
        <Typography variant="body2Muted">Explore markets</Typography>
        <Chip label="Canada + US" variant="outlined" clickable onClick={() => onMarket("CA_US")} />
        <Chip label="Canada" variant="outlined" clickable onClick={() => onMarket("CA")} />
        <Chip label="United States" variant="outlined" clickable onClick={() => onMarket("US")} />
        <Chip
          label="US remote"
          variant="outlined"
          clickable
          onClick={() => onMarket("US_REMOTE")}
        />
        <Typography variant="captionMuted">
          Replaces location and workplace filters. Other preferences stay.
        </Typography>
      </Stack>
    </Stack>
  );
}
