import type { ReactElement } from "react";
import { Box, Container, Link, Stack, Typography } from "@mui/material";
import { BrandMark } from "./brand-mark";
import { marketingLinkSx } from "./marketing-link-sx";

export function MarketingFooter(): ReactElement {
  return (
    <Box component="footer" sx={{ borderTop: 1, borderColor: "line.divider" }}>
      <Container maxWidth="lg" sx={{ paddingBlock: 5 }}>
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={3}
          sx={{ justifyContent: "space-between", alignItems: { xs: "flex-start", sm: "center" } }}
        >
          <Stack spacing={1.5} sx={{ alignItems: "flex-start" }}>
            <BrandMark />
            <Typography variant="captionMuted">
              The job search, run by your own AI agent.
            </Typography>
          </Stack>
          <Stack component="nav" aria-label="Footer" direction="row" spacing={3}>
            <Link href="/docs" underline="none" sx={marketingLinkSx}>
              Docs
            </Link>
            <Link href="/#how-it-works" underline="none" sx={marketingLinkSx}>
              How it works
            </Link>
          </Stack>
        </Stack>
      </Container>
    </Box>
  );
}
