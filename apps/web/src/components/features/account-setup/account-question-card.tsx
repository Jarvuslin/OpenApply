import type { ReactElement } from "react";
import { Alert, Button, Card, CardContent, Stack, Typography } from "@mui/material";
import type { PilotQuestion } from "@openapply/contracts/pilot";
import { z } from "zod/v4";

interface AccountQuestionCardProps {
  question: PilotQuestion;
}

export function AccountQuestionCard({ question }: AccountQuestionCardProps): ReactElement {
  const id = z.uuid().safeParse(question.subjectId);
  return (
    <Card variant="outlined" component="article" data-account-question-id={question.id}>
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h6">Employer account needs you</Typography>
          <Typography>Review this account’s login or verification step in OpenApply.</Typography>
          <Typography variant="body2" color="text.secondary">
            Passwords stay in the secure account form. Do not send them in chat or Telegram.
          </Typography>
          {id.success && (
            <Button component="a" href={`/account-setup/${id.data}`} variant="contained">
              Review account setup
            </Button>
          )}
          {!id.success && (
            <Alert severity="error">
              This account request is unavailable. Reload Needs you to inspect its current state.
            </Alert>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
