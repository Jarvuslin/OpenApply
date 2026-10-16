import { type ReactElement, Suspense } from "react";
import { LinearProgress } from "@mui/material";
import type { Metadata } from "next";
import { DiscoverBoard } from "@/components/features/discover/discover-board";

export const metadata: Metadata = { title: "Discover" };

export default function DiscoverPage(): ReactElement {
  return (
    <Suspense fallback={<LinearProgress />}>
      <DiscoverBoard />
    </Suspense>
  );
}
