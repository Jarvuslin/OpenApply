import type { ReactElement } from "react";
import { Box, Container, Stack, Typography } from "@mui/material";
import { accent } from "@/theme";

const BOARDS = [
  "LinkedIn",
  "Indeed",
  "Hiring Cafe",
  "We Work Remotely",
  "Wellfound",
  "Y Combinator",
  "Welcome to the Jungle",
  "HN Who's Hiring",
  "Remote OK",
  "4 Day Week",
];

const chipSx = { fontSize: { xs: "0.75rem", md: "0.8125rem" } } as const;

/**
 * The seeded boards as mono chips - the agent's territory, machine voice - with an
 * explicit "add your own" affordance: the agent drives a real browser, so the list
 * is a starting point, not a limit.
 */
export function BoardStrip(): ReactElement {
  return (
    <Box sx={{ borderBlock: 1, borderColor: "line.divider", backgroundColor: "surfaces.card" }}>
      <Container maxWidth="lg" sx={{ paddingBlock: { xs: 3, md: 4 } }}>
        <Stack spacing={2} sx={{ alignItems: "center" }}>
          <Typography variant="overlineMuted" sx={{ textAlign: "center" }}>
            Works where the jobs are ·{" "}
            <Box component="span" sx={{ color: "accent.primary" }}>
              {BOARDS.length} boards built in
            </Box>{" "}
            · any board you add
          </Typography>
          <Box
            sx={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: { xs: 0.75, md: 1 },
            }}
          >
            {BOARDS.map((board) => (
              <Typography key={board} variant="monoChip" sx={chipSx}>
                {board}
              </Typography>
            ))}
            <Typography
              variant="monoChip"
              sx={[
                chipSx,
                {
                  color: "accent.primary",
                  border: `1px dashed ${accent.primary}66`,
                  backgroundColor: "transparent",
                },
              ]}
            >
              + your board
            </Typography>
          </Box>
        </Stack>
      </Container>
    </Box>
  );
}
