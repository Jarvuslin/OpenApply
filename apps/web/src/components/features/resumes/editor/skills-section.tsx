"use client";

import type { ReactElement } from "react";
import { Autocomplete, Stack, TextField } from "@mui/material";
import type { ResumeSkillGroup } from "@openapply/contracts/resume";
import { EntryList } from "./entry-list";

interface SkillsSectionProps {
  value: ResumeSkillGroup[];
  onChange: (next: ResumeSkillGroup[]) => void;
}

export function SkillsSection(props: SkillsSectionProps): ReactElement {
  const { value, onChange } = props;
  return (
    <EntryList<ResumeSkillGroup>
      value={value}
      onChange={onChange}
      newItem={() => ({ id: `skill_${crypto.randomUUID()}`, group: "", items: [] })}
      addLabel="Add skill group"
      emptyLabel="No skill groups yet."
      renderTitle={(g, i) => g.group || `Group ${i + 1}`}
      renderEntry={(entry, onUpdate) => (
        <Stack spacing={1.5}>
          <TextField
            fullWidth
            label="Group name"
            placeholder="e.g. Languages, Frameworks"
            value={entry.group}
            onChange={(e) => onUpdate({ ...entry, group: e.target.value })}
          />
          {/* Chips, not one comma-joined string: fixing item 9 of 12 shouldn't mean cursor-hunting. */}
          <Autocomplete
            multiple
            freeSolo
            options={[]}
            value={entry.items}
            onChange={(_e, items) =>
              onUpdate({ ...entry, items: items.map((k) => k.trim()).filter(Boolean) })
            }
            renderInput={(params) => (
              <TextField {...params} label="Items" placeholder="Type a skill, press Enter" />
            )}
          />
        </Stack>
      )}
    />
  );
}
