"use client";

import type { ReactElement } from "react";
import { Stack, TextField, Typography } from "@mui/material";
import Grid from "@mui/material/Grid";
import type { ResumeEducation } from "@openapply/contracts/resume";
import { BulletListEditor } from "./bullet-list-editor";
import { EntryList } from "./entry-list";

interface EducationSectionProps {
  value: ResumeEducation[];
  onChange: (next: ResumeEducation[]) => void;
}

export function EducationSection(props: EducationSectionProps): ReactElement {
  const { value, onChange } = props;
  return (
    <EntryList<ResumeEducation>
      value={value}
      onChange={onChange}
      newItem={() => ({
        id: `edu_${crypto.randomUUID()}`,
        school: "",
        degree: "",
        start: "",
        end: "",
        details: [],
      })}
      addLabel="Add education"
      emptyLabel="No education entries yet."
      renderTitle={(e, i) => e.school || `Entry ${i + 1}`}
      renderEntry={(entry, onUpdate) => (
        <Stack spacing={1.5}>
          <Grid container spacing={1.5}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="School"
                value={entry.school}
                onChange={(e) => onUpdate({ ...entry, school: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Degree"
                value={entry.degree}
                onChange={(e) => onUpdate({ ...entry, degree: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField
                fullWidth
                label="Start"
                value={entry.start ?? ""}
                onChange={(e) => onUpdate({ ...entry, start: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField
                fullWidth
                label="End"
                value={entry.end ?? ""}
                onChange={(e) => onUpdate({ ...entry, end: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                label="Location"
                value={entry.location ?? ""}
                onChange={(e) => onUpdate({ ...entry, location: e.target.value })}
              />
            </Grid>
          </Grid>
          <Typography variant="body2Strong">Education details</Typography>
          <BulletListEditor
            label="Details"
            placeholder="GPA, honors, coursework, …"
            value={entry.details}
            onChange={(details) => onUpdate({ ...entry, details })}
          />
          <Typography variant="body2Strong">Additional achievements</Typography>
          <BulletListEditor
            label="Additional achievements"
            placeholder="An additional academic achievement"
            value={entry.bullets ?? []}
            onChange={(bullets) => onUpdate({ ...entry, bullets })}
          />
        </Stack>
      )}
    />
  );
}
