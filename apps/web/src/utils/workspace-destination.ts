import type { Route } from "next";

export function workspaceDestination(params: Record<string, string | string[] | undefined>): Route {
  let pathname = "/queue";
  if (params.tab === "applications") pathname = "/applications";
  if (params.tab === "overview") pathname = "/dashboard";
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "tab" || value === undefined) continue;
    for (const entry of Array.isArray(value) ? value : [value]) query.append(key, entry);
  }
  return (query.size ? `${pathname}?${query}` : pathname) as Route;
}
