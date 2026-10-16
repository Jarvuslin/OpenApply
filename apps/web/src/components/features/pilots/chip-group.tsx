"use client";

import { type ReactElement, useState } from "react";
import { alpha, Chip, Stack, TextField } from "@mui/material";
import { Check, Plus } from "lucide-react";

interface ChipOption<T> {
  value: T;
  label: string;
}

interface ChipGroupProps<T> {
  label: string;
  options: readonly ChipOption<T>[];
  value: T[];
  onChange: (value: T[]) => void;
  /** Exactly one may be picked, like a segmented control. */
  single?: boolean;
  /** Shows "Add …" so the person can type a value that isn't in the list. */
  addLabel?: string;
}

/** Pick-chips: tap to toggle; selected ones turn blue with a check. */
export function ChipGroup<T extends string | number>(props: ChipGroupProps<T>): ReactElement {
  const { label, options, value, onChange, single = false, addLabel } = props;
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const custom = value
    .filter((item) => !options.some((option) => option.value === item))
    .map((item) => ({ value: item, label: String(item) }));

  function toggle(item: T): void {
    if (single) onChange([item]);
    else onChange(value.includes(item) ? value.filter((v) => v !== item) : [...value, item]);
  }

  function commit(): void {
    const text = draft.trim();
    if (text && !value.includes(text as T)) onChange([...value, text as T]);
    setDraft("");
    setAdding(false);
  }

  return (
    <Stack
      direction="row"
      role="group"
      aria-label={label}
      sx={{ flexWrap: "wrap", gap: 1, alignItems: "center" }}
    >
      {[...options, ...custom].map((option) => {
        const selected = value.includes(option.value);
        return (
          <Chip
            key={String(option.value)}
            label={option.label}
            clickable
            aria-pressed={selected}
            color={selected ? "primary" : "default"}
            variant="outlined"
            icon={selected ? <Check size={14} aria-hidden /> : undefined}
            onClick={() => toggle(option.value)}
            sx={
              selected
                ? (theme) => ({
                    bgcolor: alpha(theme.palette.primary.main, 0.08),
                    borderColor: "primary.main",
                  })
                : undefined
            }
          />
        );
      })}
      {addLabel && !adding && (
        <Chip
          label={addLabel}
          variant="outlined"
          clickable
          icon={<Plus size={14} aria-hidden />}
          onClick={() => setAdding(true)}
          sx={{ borderStyle: "dashed" }}
        />
      )}
      {adding && (
        <TextField
          size="small"
          autoFocus
          value={draft}
          placeholder={addLabel}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commit();
            }
            if (event.key === "Escape") setAdding(false);
          }}
        />
      )}
    </Stack>
  );
}
