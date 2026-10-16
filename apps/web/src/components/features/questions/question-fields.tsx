import type { ReactElement } from "react";
import {
  Alert,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormLabel,
  MenuItem,
  Stack,
  TextField,
} from "@mui/material";
import type { QuestionDefinition } from "@openapply/contracts/application-question";
import type { AnswerDraft } from "./application-answer";

interface QuestionFieldsProps {
  definition: QuestionDefinition;
  draft: AnswerDraft;
  disabled: boolean;
  onChange: (draft: AnswerDraft) => void;
}

export function QuestionFields(props: QuestionFieldsProps): ReactElement {
  const { definition, draft, disabled, onChange } = props;
  return (
    <Stack spacing={2}>
      {definition.fields.map((field) => {
        const label = field.label || definition.prompt;
        if (field.type === "file" || field.type === "unknown")
          return (
            <Alert key={field.key} severity="info">
              {label}: this field requires browser inspection.
            </Alert>
          );
        if (field.type === "multi_choice") {
          const selected = draft[field.key];
          const values = Array.isArray(selected) ? selected : [];
          return (
            <FormControl key={field.key} component="fieldset" disabled={disabled}>
              <FormLabel component="legend">{label}</FormLabel>
              <FormGroup>
                {field.options.map((option) => (
                  <FormControlLabel
                    key={option.value}
                    label={option.label}
                    control={
                      <Checkbox
                        checked={values.includes(option.value)}
                        onChange={(_, checked) =>
                          onChange({
                            ...draft,
                            [field.key]: checked
                              ? [...values, option.value]
                              : values.filter((value) => value !== option.value),
                          })
                        }
                      />
                    }
                  />
                ))}
              </FormGroup>
            </FormControl>
          );
        }
        const value = draft[field.key] ?? "";
        if (field.type === "single_choice" || field.type === "boolean") {
          const options =
            field.type === "boolean"
              ? [
                  { value: "true", label: "Yes" },
                  { value: "false", label: "No" },
                ]
              : field.options;
          return (
            <TextField
              key={field.key}
              select
              fullWidth
              label={label}
              value={value}
              disabled={disabled}
              onChange={(event) => onChange({ ...draft, [field.key]: event.target.value })}
            >
              <MenuItem value="">Choose an answer</MenuItem>
              {options.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          );
        }
        let type = "text";
        if (["email", "number", "date"].includes(field.type)) type = field.type;
        if (field.type === "phone") type = "tel";
        return (
          <TextField
            key={field.key}
            fullWidth
            label={label}
            type={type}
            value={value}
            disabled={disabled}
            multiline={field.type === "text"}
            minRows={field.type === "text" ? 2 : undefined}
            slotProps={{ inputLabel: { shrink: true } }}
            onChange={(event) => onChange({ ...draft, [field.key]: event.target.value })}
          />
        );
      })}
    </Stack>
  );
}
