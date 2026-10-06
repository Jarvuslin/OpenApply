import type { ReactElement, ReactNode } from "react";
import { Box, Container } from "@mui/material";
import { notFound } from "next/navigation";
import { MarketingFooter, MarketingNav } from "@/components/features/marketing";
import { PUBLIC_SITE_ENABLED } from "@/lib/public-site";

interface JobsLayoutProps {
  children: ReactNode;
}

/** The public job index shares the marketing shell - it is an acquisition surface, not the app. */
export default function JobsLayout(props: JobsLayoutProps): ReactElement {
  if (!PUBLIC_SITE_ENABLED) notFound();
  const { children } = props;
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "surfaces.base",
        overflowX: "clip",
      }}
    >
      <MarketingNav />
      <Container component="main" maxWidth="lg" sx={{ flex: 1, paddingBlock: { xs: 4, md: 6 } }}>
        {children}
      </Container>
      <MarketingFooter />
    </Box>
  );
}
