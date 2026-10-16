import type { ReactElement } from "react";
import { Container, Stack, Typography } from "@mui/material";

const BOARDS = [
  "Greenhouse",
  "Lever",
  "Ashby",
  "Workday",
  "LinkedIn",
  "Hacker News",
  "Remote OK",
  "We Work Remotely",
  "+ your board",
];

export function BoardStrip(): ReactElement {
  return (
    <Container maxWidth="lg" sx={{ pb: { xs: 6, md: 8 } }}>
      <Stack spacing={2.5} sx={{ alignItems: "center" }}>
        <Typography variant="captionMuted">
          Finds jobs on the boards companies actually post to
        </Typography>
        <Stack
          direction="row"
          component="ul"
          sx={{
            m: 0,
            p: 0,
            listStyle: "none",
            flexWrap: "wrap",
            justifyContent: "center",
            columnGap: 5,
            rowGap: 1.5,
          }}
        >
          {BOARDS.map((board) => (
            <Typography key={board} component="li" variant="h4" sx={{ color: "text.disabled" }}>
              {board}
            </Typography>
          ))}
        </Stack>
      </Stack>
    </Container>
  );
}
