"use client";

import { type ReactElement, type ReactNode, useState } from "react";
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  Card,
  Checkbox,
  Chip,
  Collapse,
  DialogActions,
  DialogContent,
  Divider,
  FormControlLabel,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import { APPLICATION_QUESTIONS, type ApplicationAnswers } from "@openapply/contracts/user";
import {
  Building2,
  ChevronDown,
  Ellipsis,
  FileQuestion,
  ListChecks,
  MessageSquareText,
  ShieldCheck,
  Truck,
} from "lucide-react";
import { EmptyState } from "@/components/ui/data";
import { Dialog, DialogTitle, DropdownMenu } from "@/components/ui/feedback";
import { SearchField } from "@/components/ui/form";
import { EditButton } from "./profile-card";

const ANSWER_GROUPS = [
  "Screening",
  "About this employer",
  "Checks and agreements",
  "Logistics",
] as const;
type Group = (typeof ANSWER_GROUPS)[number];
// The phone type is edited beside the phone number, not here.
const QUESTIONS = APPLICATION_QUESTIONS.filter((question) => question.group !== "Contact");
type Question = (typeof QUESTIONS)[number];
// More choices than this read better as a dropdown than a row of buttons.
const MAX_TOGGLE_CHOICES = 3;

const ICON = { size: 18, strokeWidth: 1.75, "aria-hidden": true } as const;
const GROUP_ICONS: Record<Group | "all", ReactNode> = {
  all: <FileQuestion {...ICON} />,
  Screening: <ListChecks {...ICON} />,
  "About this employer": <Building2 {...ICON} />,
  "Checks and agreements": <ShieldCheck {...ICON} />,
  Logistics: <Truck {...ICON} />,
};
const SORTS = [
  { value: "category", label: "Category" },
  { value: "missing", label: "Not answered first" },
  { value: "name", label: "Question A–Z" },
] as const;
type Sort = (typeof SORTS)[number]["value"];

interface ApplicationAnswersPanelProps {
  answers: ApplicationAnswers;
  /** Open with only the unanswered questions showing. */
  startWithMissing: boolean;
  onSave: (key: keyof ApplicationAnswers, value: string) => Promise<void>;
}

/** Every common question with its saved answer, filterable by category and by answered state. */
export function ApplicationAnswersPanel(props: ApplicationAnswersPanelProps): ReactElement {
  const { answers, startWithMissing, onSave } = props;
  const [category, setCategory] = useState<Group | "all">("all");
  const [showAnswered, setShowAnswered] = useState(!startWithMissing);
  const [showMissing, setShowMissing] = useState(true);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("category");
  const [editing, setEditing] = useState<Question | null>(null);
  const [collapsed, setCollapsed] = useState<Set<Group>>(new Set());

  const term = search.trim().toLowerCase();
  const shown = QUESTIONS.filter((question) => {
    const answered = !!answers[question.key];
    if (answered ? !showAnswered : !showMissing) return false;
    if (category !== "all" && question.group !== category) return false;
    return !term || `${question.label} ${answers[question.key] ?? ""}`.toLowerCase().includes(term);
  });
  if (sort === "missing") shown.sort((a, b) => Number(!!answers[a.key]) - Number(!!answers[b.key]));
  if (sort === "name") shown.sort((a, b) => a.label.localeCompare(b.label));
  const sections =
    sort === "category"
      ? ANSWER_GROUPS.map((group) => ({
          group,
          rows: shown.filter((question) => question.group === group),
        })).filter((section) => section.rows.length > 0)
      : [{ group: null, rows: shown }];

  const row = (question: Question) => (
    <AnswerRow
      key={question.key}
      question={question}
      answer={answers[question.key] ?? ""}
      onEdit={() => setEditing(question)}
      onClear={() => void onSave(question.key, "").catch(() => undefined)}
    />
  );

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: { xs: "minmax(0, 1fr)", md: "240px minmax(0, 1fr)" },
        gap: 2,
        alignItems: "start",
      }}
    >
      <Card sx={{ p: 1.5 }}>
        <Typography variant="body2Strong" component="h3" sx={{ px: 1, pb: 1 }}>
          Categories
        </Typography>
        <Stack spacing={0.25} component="nav" aria-label="Answer categories">
          {(["all", ...ANSWER_GROUPS] as const).map((value) => (
            <CategoryButton
              key={value}
              icon={GROUP_ICONS[value]}
              label={value === "all" ? "All questions" : value}
              count={
                value === "all"
                  ? QUESTIONS.length
                  : QUESTIONS.filter((question) => question.group === value).length
              }
              selected={category === value}
              onClick={() => setCategory(value)}
            />
          ))}
        </Stack>
        <Divider sx={{ my: 1.5 }} />
        <Typography variant="body2Strong" component="h3" sx={{ px: 1, pb: 0.5 }}>
          Show
        </Typography>
        <Stack sx={{ px: 0.5 }}>
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={showAnswered}
                onChange={(_, checked) => setShowAnswered(checked)}
              />
            }
            label={<Typography variant="body2">Answered</Typography>}
          />
          <FormControlLabel
            control={
              <Checkbox
                size="small"
                checked={showMissing}
                onChange={(_, checked) => setShowMissing(checked)}
              />
            }
            label={<Typography variant="body2">Not answered</Typography>}
          />
        </Stack>
      </Card>
      <Card sx={{ p: { xs: 2, md: 2.5 } }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "flex-start", mb: 2 }}>
          <Box sx={{ display: "flex", pt: 0.5 }}>
            <MessageSquareText size={20} strokeWidth={1.75} aria-hidden />
          </Box>
          <Box>
            <Typography variant="h3" component="h2">
              Application answers
            </Typography>
            <Typography variant="body2Muted">
              Saved answers to questions most forms ask. The agent uses these instead of asking you.
            </Typography>
          </Box>
        </Stack>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5} sx={{ mb: 1.5 }}>
          <Box sx={{ flex: 1 }}>
            <SearchField value={search} onChange={setSearch} placeholder="Search questions" />
          </Box>
          <TextField
            select
            size="small"
            value={sort}
            onChange={(event) => setSort(event.target.value as Sort)}
            slotProps={{ htmlInput: { "aria-label": "Sort questions" } }}
            sx={{ width: { sm: 220 } }}
          >
            {SORTS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                Sort by: {option.label}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
        <Typography variant="captionMuted" component="p" sx={{ mb: 1.5 }}>
          {shown.length} {shown.length === 1 ? "question" : "questions"}
        </Typography>
        {shown.length === 0 && (
          <EmptyState
            title={
              showMissing && !showAnswered ? "Every question is answered" : "No questions match"
            }
            description={
              showMissing && !showAnswered
                ? "The agent can answer all of these on its own."
                : "Try a different search, category or filter."
            }
          />
        )}
        <Stack spacing={1.5}>
          {sections.map((section) =>
            section.group ? (
              <Card key={section.group} variant="outlined">
                <ButtonBase
                  onClick={() =>
                    setCollapsed((current) => {
                      const next = new Set(current);
                      if (next.has(section.group)) next.delete(section.group);
                      else next.add(section.group);
                      return next;
                    })
                  }
                  aria-expanded={!collapsed.has(section.group)}
                  sx={{
                    width: "100%",
                    justifyContent: "flex-start",
                    gap: 1.25,
                    px: 2,
                    py: 1.25,
                    bgcolor: "action.hover",
                  }}
                >
                  {GROUP_ICONS[section.group]}
                  <Typography variant="body1Strong">{section.group}</Typography>
                  <Chip size="small" label={section.rows.length} />
                  <Box sx={{ flex: 1 }} />
                  <Box
                    sx={{
                      display: "flex",
                      transform: collapsed.has(section.group) ? "rotate(-90deg)" : "none",
                      transition: (t) => t.transitions.create("transform"),
                    }}
                  >
                    <ChevronDown size={16} aria-hidden />
                  </Box>
                </ButtonBase>
                <Collapse in={!collapsed.has(section.group)}>{section.rows.map(row)}</Collapse>
              </Card>
            ) : (
              <Card key="all" variant="outlined">
                {section.rows.map(row)}
              </Card>
            ),
          )}
        </Stack>
      </Card>
      {editing && (
        <AnswerDialog
          question={editing}
          value={answers[editing.key] ?? ""}
          onClose={() => setEditing(null)}
          onSave={async (value) => {
            await onSave(editing.key, value);
            setEditing(null);
          }}
        />
      )}
    </Box>
  );
}

interface CategoryButtonProps {
  icon: ReactNode;
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
}

function CategoryButton(props: CategoryButtonProps): ReactElement {
  const { icon, label, count, selected, onClick } = props;
  return (
    <ButtonBase
      onClick={onClick}
      aria-current={selected ? "true" : undefined}
      sx={(theme) => ({
        justifyContent: "flex-start",
        gap: 1.25,
        px: 1,
        py: 0.875,
        borderRadius: theme.radii.sm,
        color: selected ? "primary.main" : "text.primary",
        bgcolor: selected ? "action.selected" : "transparent",
        "&:hover": { bgcolor: selected ? "action.selected" : "action.hover" },
        "&:focus-visible": { boxShadow: theme.shadows_custom.focus },
      })}
    >
      {icon}
      <Typography variant="body2" sx={{ flex: 1, textAlign: "left", color: "inherit" }}>
        {label}
      </Typography>
      <Typography variant="captionMuted">{count}</Typography>
    </ButtonBase>
  );
}

interface AnswerRowProps {
  question: Question;
  answer: string;
  onEdit: () => void;
  onClear: () => void;
}

function AnswerRow({ question, answer, onEdit, onClear }: AnswerRowProps): ReactElement {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{
        alignItems: "center",
        px: 2,
        py: 1,
        minHeight: 48,
        borderTop: 1,
        borderColor: "divider",
      }}
    >
      <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
        {question.label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          width: { xs: 120, sm: 220 },
          flexShrink: 0,
          overflowWrap: "anywhere",
          color: answer ? "text.primary" : "text.disabled",
        }}
      >
        {answer || "Not set"}
      </Typography>
      {answer ? (
        <EditButton onClick={onEdit} />
      ) : (
        <Button size="small" variant="contained" onClick={onEdit} sx={{ minWidth: 72 }}>
          Answer
        </Button>
      )}
      <DropdownMenu
        trigger={({ onOpen }) => (
          <IconButton size="small" onClick={onOpen} aria-label={`More for ${question.label}`}>
            <Ellipsis size={16} aria-hidden />
          </IconButton>
        )}
        items={[
          { kind: "item", key: "edit", label: answer ? "Edit answer" : "Answer", onClick: onEdit },
          {
            kind: "item",
            key: "clear",
            label: "Clear answer (ask me)",
            danger: true,
            disabled: !answer,
            onClick: onClear,
          },
        ]}
      />
    </Stack>
  );
}

interface AnswerDialogProps {
  question: Question;
  value: string;
  onClose: () => void;
  onSave: (value: string) => Promise<void>;
}

function AnswerDialog({ question, value, onClose, onSave }: AnswerDialogProps): ReactElement {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await onSave(draft.trim());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save this answer.");
      setSaving(false);
    }
  };
  return (
    <Dialog open onClose={saving ? undefined : onClose} maxWidth="xs" fullWidth>
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <DialogTitle>{question.label}</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <AnswerControl question={question} value={draft} onChange={setDraft} />
            <Typography variant="captionMuted">
              Leave it blank and the agent asks you the first time a form needs it.
            </Typography>
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="outlined" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" disabled={saving || draft.trim() === value}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}

interface AnswerControlProps {
  question: Question;
  value: string;
  onChange: (value: string) => void;
}

function AnswerControl({ question, value, onChange }: AnswerControlProps): ReactElement {
  const { choices, label, placeholder } = question;
  if (!choices)
    return (
      <TextField
        autoFocus
        fullWidth
        label="Answer"
        value={value}
        placeholder={placeholder ? `e.g. ${placeholder}` : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  if (choices.length > MAX_TOGGLE_CHOICES)
    return (
      <TextField
        select
        fullWidth
        label="Answer"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <MenuItem value="">Ask me</MenuItem>
        {choices.map((choice) => (
          <MenuItem key={choice} value={choice}>
            {choice}
          </MenuItem>
        ))}
      </TextField>
    );
  return (
    <ToggleButtonGroup
      exclusive
      fullWidth
      value={value || null}
      aria-label={label}
      onChange={(_, next: string | null) => onChange(next ?? "")}
    >
      {choices.map((choice) => (
        <ToggleButton key={choice} value={choice}>
          {choice}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
