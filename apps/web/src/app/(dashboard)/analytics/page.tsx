import { redirect } from "next/navigation";

/** Analytics live on the Dashboard; scoring evaluations keep their own pages below this route. */
export default function AnalyticsPage(): never {
  redirect("/dashboard");
}
