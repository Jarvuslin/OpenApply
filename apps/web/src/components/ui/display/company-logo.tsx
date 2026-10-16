"use client";

import { type ReactNode, useState } from "react";
import { Box } from "@mui/material";

const ATS_HOSTS = ["greenhouse.io", "lever.co", "ashbyhq.com", "myworkdayjobs.com"];

/** The employer's own domain: the job link's host, or a guess from the ATS slug. */
export function companyDomain(url: string | null | undefined): string | null {
  const parsed = url ? URL.parse(url) : null;
  if (!parsed) return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const ats = ATS_HOSTS.find((domain) => host === domain || host.endsWith(`.${domain}`));
  if (!ats) return host.replace(/^(careers|jobs)\./, "");
  const slug =
    ats === "myworkdayjobs.com" ? host.split(".")[0] : parsed.pathname.split("/").find(Boolean);
  return slug && /^[a-z0-9-]+$/i.test(slug) ? `${slug.toLowerCase()}.com` : null;
}

interface CompanyLogoProps {
  url: string | null | undefined;
  size?: number;
}

/** The company's icon when one exists; otherwise nothing at all. */
export function CompanyLogo({ url, size = 20 }: CompanyLogoProps): ReactNode {
  const [missing, setMissing] = useState(false);
  const domain = companyDomain(url);
  if (!domain || missing) return null;
  return (
    <Box
      component="img"
      src={`https://icons.duckduckgo.com/ip3/${domain}.ico`}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setMissing(true)}
      sx={{ width: size, height: size, borderRadius: "50%", flexShrink: 0, objectFit: "contain" }}
    />
  );
}
