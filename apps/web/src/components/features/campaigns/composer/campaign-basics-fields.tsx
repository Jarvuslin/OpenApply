"use client";

import { Chip, Stack, Typography } from "@mui/material";
import { useSelector } from "@tanstack/react-form";
import type { UserAggregateResponse } from "@/api/types";
import { withForm } from "@/components/ui/form/tanstack";
import { type BoardOption, COMPOSER_DEFAULT_VALUES, MODE_DESCRIPTIONS } from "./form-config";

/** Campaign basics: the mode toggle, plus query (+ recent), board, and resume for every mode but apply. */
export const CampaignBasicsFields = withForm({
  defaultValues: COMPOSER_DEFAULT_VALUES,
  props: {
    boards: [] as BoardOption[],
    resumes: [] as UserAggregateResponse["resumes"],
    recentQueries: [] as string[],
  },
  render: function CampaignBasicsFields({ form, boards, resumes, recentQueries }) {
    const mode = useSelector(form.store, (s) => s.values.mode);

    const isApply = mode === "apply";

    return (
      <>
        <Stack spacing={0.75}>
          <form.AppField name="mode">
            {(field) => (
              <field.Toggle
                label="Mode"
                options={[
                  { value: "search", label: "Search only" },
                  { value: "auto_apply", label: "Auto-apply" },

                  { value: "apply", label: "Apply to links" },
                ]}
              />
            )}
          </form.AppField>
          <Typography variant="captionMuted">{MODE_DESCRIPTIONS[mode]}</Typography>
        </Stack>

        {/* Apply has none of these - it takes pasted links and tailors a resume per job. */}
        {!isApply && (
          <>
            <Stack spacing={0.75}>
              <form.AppField name="query">
                {(field) => (
                  <field.TextField
                    label={"Query"}
                    placeholder={"Senior React TypeScript remote"}
                    autoFocus
                  />
                )}
              </form.AppField>
              {recentQueries.length > 0 && (
                <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap", gap: 0.75 }}>
                  <Typography variant="captionMuted" sx={{ alignSelf: "center" }}>
                    Recent:
                  </Typography>
                  {recentQueries.map((q) => (
                    <Chip
                      key={q}
                      label={q}
                      size="small"
                      variant="outlined"
                      onClick={() => form.setFieldValue("query", q)}
                    />
                  ))}
                </Stack>
              )}
            </Stack>

            {boards.length > 0 && (
              <Stack spacing={0.75}>
                <form.AppField name="board">
                  {(field) => (
                    <field.Select
                      label="Board"
                      items={boards.map((b) => ({ value: b.domain, label: b.name }))}
                    />
                  )}
                </form.AppField>
              </Stack>
            )}

            {boards.length === 0 && (
              <Typography variant="body2Muted">
                No boards configured. Add one on the Boards page first.
              </Typography>
            )}

            {resumes.length > 0 ? (
              <Stack spacing={0.75}>
                <form.AppField name="resumeId">
                  {(field) => (
                    <field.Select
                      label="Resume"
                      items={resumes.map((r) => ({
                        value: r.id,
                        label: r.isPrimary ? `${r.label} (primary)` : r.label,
                      }))}
                    />
                  )}
                </form.AppField>
                <Typography variant="captionMuted">
                  OpenApply tailors a copy of this resume to each application automatically - your
                  original stays unchanged.
                </Typography>
              </Stack>
            ) : (
              <Typography variant="body2Muted">
                No resumes yet. Upload one on the Resumes page first.
              </Typography>
            )}
          </>
        )}
      </>
    );
  },
});
