import { Suspense } from "react";
import { MvpWorkbench } from "@/components/features/mvp/mvp-workbench";

export default function MvpPage() {
  return (
    <Suspense>
      <MvpWorkbench />
    </Suspense>
  );
}
