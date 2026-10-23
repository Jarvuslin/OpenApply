"use client";

import { type KeyboardEvent, type ReactElement, type ReactNode, useState } from "react";
import {
  Autocomplete,
  alpha,
  Box,
  ButtonBase,
  Chip,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, CircleX, MapPin, Plus, Search, X } from "lucide-react";
import { api } from "@/api/client";
import { apiErrorMessage } from "@/api/error";
import { queryKeys } from "@/api/query-keys";
import { useDebouncedValue } from "@/hooks/use-debounced-value";

interface LocationPickerProps {
  value: string[];
  onChange: (value: string[]) => void;
  label?: string;
  helperText?: string;
  disabled?: boolean;
  /** "list" gives each pick its own row; "chips" fits a narrow panel. */
  layout?: "list" | "chips";
  /** At most one place; a new pick replaces it. */
  single?: boolean;
}

const VISIBLE_ROWS = 3;
const SEARCH_HINT = "Search by ZIP/postal code, city, region, country, or continent.";

/** "Toronto, Ontario, Canada" → "Toronto, Canada", for compact chips. */
function shortLabel(place: string): string {
  const parts = place.split(", ");
  return parts.length > 2 ? `${parts[0]}, ${parts.at(-1)}` : place;
}

function postalCaption(code: string): string {
  return /^\d/.test(code) ? `ZIP code ${code}` : `Postal code ${code}`;
}

interface SelectedRowProps {
  place: string;
  disabled: boolean;
  onRemove: () => void;
}

function SelectedRow({ place, disabled, onRemove }: SelectedRowProps): ReactElement {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={(theme) => ({
        alignItems: "center",
        px: 1.5,
        py: 1,
        borderRadius: 1.5,
        bgcolor: "action.hover",
        color: disabled ? "text.disabled" : "text.primary",
        "&:hover": disabled ? undefined : { bgcolor: alpha(theme.palette.primary.main, 0.08) },
      })}
    >
      <MapPin size={18} aria-hidden />
      <Typography variant="body2" noWrap sx={{ flex: 1, color: "inherit" }} title={place}>
        {place}
      </Typography>
      <IconButton
        size="small"
        disabled={disabled}
        aria-label={`Remove ${place}`}
        onClick={onRemove}
        sx={{ color: "text.disabled", "&:hover": { color: "primary.main" } }}
      >
        <CircleX size={18} />
      </IconButton>
    </Stack>
  );
}

function EmptyState(): ReactElement {
  return (
    <Stack spacing={1} sx={{ alignItems: "center", textAlign: "center", py: 2 }}>
      <Box
        sx={(theme) => ({
          display: "grid",
          placeItems: "center",
          width: 56,
          height: 56,
          borderRadius: "50%",
          bgcolor: alpha(theme.palette.primary.main, 0.08),
          color: "primary.main",
        })}
      >
        <MapPin size={24} aria-hidden />
      </Box>
      <Typography variant="body2Strong">No locations added yet</Typography>
      <Typography variant="body2Muted">Search above and pick a place to add it.</Typography>
    </Stack>
  );
}

/** Search-and-pick places. Only a suggested place can be added, never free text. */
export function LocationPicker(props: LocationPickerProps): ReactElement {
  const {
    value,
    onChange,
    label = "Locations",
    helperText,
    disabled = false,
    layout = "list",
    single = false,
  } = props;
  const [input, setInput] = useState("");
  const [expanded, setExpanded] = useState(false);
  const search = useDebouncedValue(input.trim(), 200);
  const places = useQuery({
    queryKey: queryKeys.locations.search(search),
    enabled: search.length > 0,
    staleTime: Number.POSITIVE_INFINITY,
    queryFn: async () => {
      const { data, error } = await api.locations.search.get({ query: { q: search } });
      if (error) throw new Error(apiErrorMessage(error));
      return data;
    },
  });
  const typed = input.trim().toLowerCase();
  const current = search && search === input.trim() ? (places.data ?? []) : [];
  const postalCodes = new Map(current.map((place) => [place.label, place.postalCode]));
  const options = [...postalCodes.keys()].filter((option) => !value.includes(option));
  const searching = typed.length > 0 && (search !== input.trim() || places.isFetching);

  let noOptionsText = "No matching places. Try a ZIP code, nearby city, or the country.";
  if (!typed) noOptionsText = "Start typing to search places.";
  else if (searching) noOptionsText = "Searching…";
  else if (places.isError) noOptionsText = "Location search is unavailable. Try again.";

  function add(place: string): void {
    if (single) onChange([place]);
    else if (!value.includes(place)) onChange([...value, place]);
  }

  function remove(place: string): void {
    onChange(value.filter((item) => item !== place));
  }

  const hidden = layout === "list" && !expanded ? value.slice(VISIBLE_ROWS) : [];
  const shown = value.slice(0, value.length - hidden.length);
  let selected: ReactNode = null;
  if (layout === "chips" && value.length > 0) {
    selected = (
      <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1 }}>
        {value.map((place) => (
          <Chip
            key={place}
            label={shortLabel(place)}
            title={place}
            disabled={disabled}
            onDelete={() => remove(place)}
            deleteIcon={<X size={14} aria-label={`Remove ${place}`} />}
          />
        ))}
      </Stack>
    );
  }
  if (layout === "list" && value.length > 0) {
    selected = (
      <Stack spacing={1}>
        {shown.map((place) => (
          <SelectedRow
            key={place}
            place={place}
            disabled={disabled}
            onRemove={() => remove(place)}
          />
        ))}
        {value.length > VISIBLE_ROWS && (
          <ButtonBase
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
            sx={{
              justifyContent: "flex-start",
              gap: 1.5,
              px: 1.5,
              py: 1.25,
              borderRadius: 1.5,
              bgcolor: "action.hover",
              typography: "body2",
            }}
          >
            {expanded ? <ChevronUp size={18} aria-hidden /> : <Plus size={18} aria-hidden />}
            <Box component="span" sx={{ flex: 1, textAlign: "left" }}>
              {expanded && "Show fewer"}
              {!expanded &&
                `${hidden.length} more ${hidden.length === 1 ? "location" : "locations"}`}
            </Box>
            {!expanded && <ChevronDown size={18} aria-hidden />}
          </ButtonBase>
        )}
      </Stack>
    );
  }

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" sx={{ alignItems: "baseline", justifyContent: "space-between" }}>
        <Typography variant="body2Strong" component="h3">
          {label}
        </Typography>
        {!single && <Typography variant="captionMuted">{value.length} selected</Typography>}
      </Stack>
      <Stack spacing={0.75}>
        <Autocomplete
          disabled={disabled}
          options={options}
          value={null}
          onChange={(_, place) => place && add(place)}
          inputValue={input}
          // Only typing fills the box; a pick or blur empties it for the next search.
          onInputChange={(_, next, reason) => setInput(reason === "input" ? next : "")}
          filterOptions={(all) => all}
          autoHighlight
          forcePopupIcon={false}
          onKeyDown={(event: KeyboardEvent<HTMLDivElement> & { defaultMuiPrevented?: boolean }) => {
            // A pick is removed only with its own button, never by Backspace in the search box.
            if (event.key === "Backspace" && !input) event.defaultMuiPrevented = true;
          }}
          slotProps={{
            popper: { placement: "bottom-start", modifiers: [{ name: "flip", enabled: false }] },
            paper: { elevation: 4, sx: { mt: 0.5, borderRadius: 2 } },
            listbox: {
              sx: (theme) => ({
                p: 0.75,
                "& .MuiAutocomplete-option": { borderRadius: 1.5, gap: 1.5 },
                "& .MuiAutocomplete-option.Mui-focused": {
                  bgcolor: alpha(theme.palette.primary.main, 0.08),
                },
              }),
            },
          }}
          loading={searching}
          loadingText="Searching…"
          noOptionsText={noOptionsText}
          renderOption={({ key, ...optionProps }, option) => {
            const postalCode = postalCodes.get(option);
            return (
              <Box component="li" key={key} {...optionProps}>
                <MapPin size={18} aria-hidden />
                <Stack sx={{ minWidth: 0 }}>
                  <Typography variant="body2">{option}</Typography>
                  {postalCode && (
                    <Typography variant="captionMuted">{postalCaption(postalCode)}</Typography>
                  )}
                </Stack>
              </Box>
            );
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder={value.length && !single ? "Add another location…" : "Add a location…"}
              sx={{
                // The theme's hover outline is near-black; a mid gray reads as a hover, not a focus.
                "& .MuiOutlinedInput-root:hover:not(.Mui-focused):not(.Mui-disabled) .MuiOutlinedInput-notchedOutline":
                  { borderColor: "grey.500" },
              }}
              slotProps={{
                ...params.slotProps,
                htmlInput: { ...params.slotProps.htmlInput, "aria-label": label },
                input: {
                  ...params.slotProps.input,
                  startAdornment: (
                    <InputAdornment position="start">
                      <Search size={18} aria-hidden />
                    </InputAdornment>
                  ),
                },
              }}
            />
          )}
        />
        <Typography variant="captionMuted">{SEARCH_HINT}</Typography>
      </Stack>
      {layout === "list" && !single && value.length === 0 && <EmptyState />}
      {selected}
      {helperText && <Typography variant="captionMuted">{helperText}</Typography>}
    </Stack>
  );
}
