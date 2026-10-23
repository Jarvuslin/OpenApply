import type { ReactElement } from "react";
import { Container, Stack, Typography } from "@mui/material";
import { LinkButton } from "@/components/ui/buttons";

export function CtaBand(): ReactElement {
  return (
    <Container maxWidth="lg" sx={{ pb: { xs: 7, md: 12 } }}>
      <Stack
        spacing={2.5}
        sx={{
          alignItems: "center",
          textAlign: "center",
          py: { xs: 6, md: 8 },
          px: 3,
          border: 1,
          borderColor: "divider",
          borderRadius: 4,
          bgcolor: "surfaces.elevated",
        }}
      >
        <Typography variant="displayMd" component="h2">
          Make your first pilot tonight.
        </Typography>
        <Typography variant="body1Muted" sx={{ fontSize: "1.0625rem" }}>
          Free and open source. Install the plugin, set your rules, and wake up to applications.
        </Typography>
        <Stack direction="row" sx={{ flexWrap: "wrap", justifyContent: "center", gap: 1.25 }}>
          <LinkButton href="/install" variant="contained" size="large">
            Get started — free
          </LinkButton>
          <LinkButton href="/docs" variant="outlined" size="large">
            Read the docs
          </LinkButton>
        </Stack>
      </Stack>
    </Container>
  );
}
