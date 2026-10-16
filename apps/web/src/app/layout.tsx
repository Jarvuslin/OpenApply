import "./globals.css";
import type { PropsWithChildren, ReactElement } from "react";
import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Libre_Caslon_Text } from "next/font/google";
import { SITE_URL } from "@/lib/constants";
import { AgentProvider } from "@/providers/agent-provider";
import { ConfirmProvider } from "@/providers/confirm-provider";
import { ToastProvider } from "@/providers/notification-provider";
import { QueryProvider } from "@/providers/query-provider";
import { ThemeProvider } from "@/providers/theme-provider";
import { surfaces } from "@/theme/palette";

// Every UI text; the serif is only the OpenApply wordmark.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const libreCaslon = Libre_Caslon_Text({
  subsets: ["latin"],
  weight: "700",
  variable: "--font-wordmark",
  display: "swap",
});

// Mono for code and the terminal.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

const title = "OpenApply — your next move";
const description =
  "A free, open-source AI agent that finds jobs, tailors your resume, and applies for you - running locally on your own Claude Code or Codex subscription.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: title, template: "%s · OpenApply" },
  description,
  applicationName: "OpenApply",
  keywords: [
    "autonomous job search",
    "AI job application",
    "job search agent",
    "auto apply jobs",
    "Claude Code",
    "Codex",
    "resume tailoring",

    "job board automation",
  ],
  authors: [{ name: "OpenApply contributors", url: "https://github.com/Jarvuslin/OpenApply" }],
  creator: "OpenApply",
  category: "technology",
  manifest: "/manifest.webmanifest",
  // apple-touch-icon comes from app/apple-icon.tsx (file convention); this covers the SVG favicon.
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }], shortcut: "/icon.svg" },
  appleWebApp: { capable: true, title: "OpenApply", statusBarStyle: "black-translucent" },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
  openGraph: {
    siteName: "OpenApply",
    type: "website",
    locale: "en_US",
    title,
    description,
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
  },
};

export const viewport: Viewport = {
  themeColor: surfaces.base,
  colorScheme: "light",
};

export default function RootLayout(props: PropsWithChildren): ReactElement {
  const { children } = props;
  return (
    <html
      lang="en"
      className={`${inter.variable} ${libreCaslon.variable} ${jetbrainsMono.variable}`}
    >
      <body suppressHydrationWarning>
        <ThemeProvider>
          <QueryProvider>
            <ToastProvider>
              <ConfirmProvider>
                <AgentProvider>{children}</AgentProvider>
              </ConfirmProvider>
            </ToastProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
