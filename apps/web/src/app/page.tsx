import type { ReactElement } from "react";
import { Box } from "@mui/material";
import type { Metadata } from "next";
import {
  BoardStrip,
  BuiltIn,
  CtaBand,
  FAQ_ITEMS,
  Faq,
  Features,
  Hero,
  HowItWorks,
  MarketingFooter,
  MarketingNav,
  PrivacyGrid,
  Setup,
} from "@/components/features/marketing";
import { JsonLd } from "@/components/seo/json-ld";
import { faqPageLd, organizationLd, softwareApplicationLd, websiteLd } from "@/lib/structured-data";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

const SOFTWARE_DESCRIPTION =
  "A free, open-source AI agent that finds new jobs minutes after they are posted, scores them against your resume, and applies for you. It runs on your own Claude Code or Codex subscription.";

export default function LandingPage(): ReactElement {
  return (
    // overflowX clip: decorative glows/orbs must never widen the page on mobile.
    <Box sx={{ minHeight: "100vh", backgroundColor: "surfaces.base", overflowX: "clip" }}>
      <JsonLd
        data={[
          organizationLd(),
          websiteLd(),
          softwareApplicationLd(SOFTWARE_DESCRIPTION),
          faqPageLd(FAQ_ITEMS),
        ]}
      />
      <MarketingNav />
      <Box component="main">
        <Hero />
        <BoardStrip />
        <HowItWorks />
        <Features />
        <BuiltIn />
        <PrivacyGrid />
        <Setup />
        <Faq />
        <CtaBand />
      </Box>
      <MarketingFooter />
    </Box>
  );
}
