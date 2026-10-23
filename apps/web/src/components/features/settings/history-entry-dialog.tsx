"use client";

import { type ReactElement, type ReactNode, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  DialogActions,
  DialogContent,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import {
  type EducationEntryInput,
  educationEntrySchema,
  type WorkEntryInput,
  workEntrySchema,
} from "@openapply/contracts/user";
import { useSelector } from "@tanstack/react-form";
import { Trash2 } from "lucide-react";
import { ConfirmDialog, Dialog, DialogTitle } from "@/components/ui/feedback";
import { useAppForm } from "@/components/ui/form/tanstack";
import { fromMonthInput, toMonthInput } from "./history-dates";

const SUMMARY_LIMIT = 600;

interface EntryDialogFrameProps {
  title: string;
  dirty: boolean;
  saving: boolean;
  error: string;
  deleteLabel?: string;
  onDelete?: () => void;
  onClose: () => void;
  onSubmit: () => void;
  children: ReactNode;
}

/** Dialog shell: scrolling fields, a footer that stays put, and a discard check on close. */
function EntryDialogFrame(props: EntryDialogFrameProps): ReactElement {
  const { title, dirty, saving, error, deleteLabel, onDelete, onClose, onSubmit, children } = props;
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const requestClose = () => {
    if (saving) return;
    if (dirty) setConfirmDiscard(true);
    else onClose();
  };
  return (
    <>
      <Dialog open onClose={requestClose} maxWidth="sm" fullWidth scroll="paper">
        <Box
          component="form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!saving) onSubmit();
          }}
          sx={{ display: "flex", flexDirection: "column", minHeight: 0 }}
        >
          <DialogTitle onClose={requestClose}>{title}</DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2} sx={{ py: 0.5 }}>
              {children}
              {error && <Alert severity="error">{error}</Alert>}
            </Stack>
          </DialogContent>
          <DialogActions sx={{ px: 3, py: 1.5 }}>
            {onDelete && (
              <Button
                color="error"
                startIcon={<Trash2 size={14} aria-hidden />}
                disabled={saving}
                onClick={onDelete}
                sx={{ mr: "auto" }}
              >
                {deleteLabel}
              </Button>
            )}
            <Button onClick={requestClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </DialogActions>
        </Box>
      </Dialog>
      <ConfirmDialog
        open={confirmDiscard}
        title="Discard changes?"
        description="Your edits to this entry haven't been saved."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onCancel={() => setConfirmDiscard(false)}
        onConfirm={() => {
          setConfirmDiscard(false);
          onClose();
        }}
      />
    </>
  );
}

function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : "Could not save. Your changes are still here.";
}

interface EntryDialogProps<T> {
  /** Null adds a new entry. */
  initial: T | null;
  onSave: (entry: T) => Promise<void>;
  onDelete: () => void;
  onClose: () => void;
}

const EMPTY_JOB: WorkEntryInput = {
  company: "",
  title: "",
  location: "",
  start: "",
  end: "",
  summary: "",
};

export function WorkEntryDialog(props: EntryDialogProps<WorkEntryInput>): ReactElement {
  const { initial, onSave, onDelete, onClose } = props;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [current, setCurrent] = useState(!!initial && !initial.end);
  const [currentTouched, setCurrentTouched] = useState(false);
  const form = useAppForm({
    defaultValues: withMonthInputs(initial ?? EMPTY_JOB),
    validators: { onSubmit: workEntrySchema },
    onSubmit: async ({ value }) => {
      setSaving(true);
      setError("");
      try {
        await onSave(
          workEntrySchema.parse({
            ...value,
            start: fromMonthInput(value.start),
            end: current ? "" : fromMonthInput(value.end),
          }),
        );
      } catch (reason) {
        setError(errorText(reason));
      } finally {
        setSaving(false);
      }
    },
  });
  const dirty = useSelector(form.store, (state) => state.isDirty) || currentTouched;
  const summaryLength = useSelector(form.store, (state) => state.values.summary.length);
  return (
    <EntryDialogFrame
      title={initial ? "Edit work experience" : "Add work experience"}
      dirty={dirty}
      saving={saving}
      error={error}
      deleteLabel="Delete this entry"
      onDelete={initial ? onDelete : undefined}
      onClose={onClose}
      onSubmit={() => void form.handleSubmit()}
    >
      <Pair>
        <form.AppField name="title">
          {(field) => <field.TextField label="Job title" required autoFocus />}
        </form.AppField>
        <form.AppField name="company">
          {(field) => <field.TextField label="Company" required />}
        </form.AppField>
      </Pair>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: { xs: "1fr", sm: "repeat(3, minmax(0, 1fr))" },
          gap: 2,
        }}
      >
        <form.AppField name="location">
          {(field) => <field.TextField label="Location" placeholder="Toronto, ON" />}
        </form.AppField>
        <form.AppField name="start">
          {(field) => (
            <field.TextField label="Start date" {...dateInput(initial?.start, "Sep 2023")} />
          )}
        </form.AppField>
        {current ? (
          <TextField label="End date" value="Present" disabled fullWidth />
        ) : (
          <form.AppField name="end">
            {(field) => (
              <field.TextField label="End date" {...dateInput(initial?.end, "Oct 2025")} />
            )}
          </form.AppField>
        )}
      </Box>
      <FormControlLabel
        control={
          <Checkbox
            checked={current}
            onChange={(_, checked) => {
              setCurrent(checked);
              setCurrentTouched(true);
            }}
          />
        }
        label={<Typography variant="body2">I currently work here</Typography>}
      />
      <form.AppField name="summary">
        {(field) => (
          <field.TextField
            label="Description"
            multiline
            minRows={4}
            helperText={`A sentence or two. Used where a form asks you to describe the role. ${summaryLength} / ${SUMMARY_LIMIT}`}
          />
        )}
      </form.AppField>
    </EntryDialogFrame>
  );
}

const EMPTY_SCHOOL: EducationEntryInput = { school: "", degree: "", field: "", start: "", end: "" };

export function EducationEntryDialog(props: EntryDialogProps<EducationEntryInput>): ReactElement {
  const { initial, onSave, onDelete, onClose } = props;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const form = useAppForm({
    defaultValues: withMonthInputs(initial ?? EMPTY_SCHOOL),
    validators: { onSubmit: educationEntrySchema },
    onSubmit: async ({ value }) => {
      setSaving(true);
      setError("");
      try {
        await onSave(
          educationEntrySchema.parse({
            ...value,
            start: fromMonthInput(value.start),
            end: fromMonthInput(value.end),
          }),
        );
      } catch (reason) {
        setError(errorText(reason));
      } finally {
        setSaving(false);
      }
    },
  });
  const dirty = useSelector(form.store, (state) => state.isDirty);
  return (
    <EntryDialogFrame
      title={initial ? "Edit school" : "Add school"}
      dirty={dirty}
      saving={saving}
      error={error}
      deleteLabel="Delete this entry"
      onDelete={initial ? onDelete : undefined}
      onClose={onClose}
      onSubmit={() => void form.handleSubmit()}
    >
      <form.AppField name="school">
        {(field) => <field.TextField label="School" required autoFocus />}
      </form.AppField>
      <Pair>
        <form.AppField name="degree">
          {(field) => <field.TextField label="Degree" placeholder="Bachelor of Computing" />}
        </form.AppField>
        <form.AppField name="field">
          {(field) => <field.TextField label="Field of study" placeholder="Computer Science" />}
        </form.AppField>
      </Pair>
      <Pair>
        <form.AppField name="start">
          {(field) => (
            <field.TextField label="Start date" {...dateInput(initial?.start, "Sep 2022")} />
          )}
        </form.AppField>
        <form.AppField name="end">
          {(field) => (
            <field.TextField
              label="End date (or expected)"
              {...dateInput(initial?.end, "May 2026")}
            />
          )}
        </form.AppField>
      </Pair>
    </EntryDialogFrame>
  );
}

/** Saved dates as month-input values; one that is not a single month stays text. */
function withMonthInputs<T extends { start: string; end: string }>(entry: T): T {
  return {
    ...entry,
    start: toMonthInput(entry.start) ?? entry.start,
    end: toMonthInput(entry.end) ?? entry.end,
  };
}

/** A month picker, or a text box when the saved value (e.g. "Summer 2023") is not one month. */
function dateInput(saved: string | undefined, example: string) {
  const asMonth = toMonthInput(saved ?? "") !== null;
  return asMonth
    ? { type: "month", slotProps: { inputLabel: { shrink: true } } }
    : { placeholder: example };
}

function Pair({ children }: { children: ReactNode }): ReactElement {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(0, 1fr))" },
        gap: 2,
      }}
    >
      {children}
    </Box>
  );
}
