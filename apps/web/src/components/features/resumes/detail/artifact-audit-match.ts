function canonical(value: unknown): string | undefined {
  return JSON.stringify(value, (_, current) =>
    current && typeof current === "object" && !Array.isArray(current)
      ? Object.fromEntries(Object.entries(current).sort(([a], [b]) => a.localeCompare(b)))
      : current,
  );
}

/** The typed draft audit may be shown as artifact evidence only when every saved field matches. */
export function matchesArtifactAudit(saved: unknown, draft: unknown): boolean {
  return saved !== undefined && draft !== undefined && canonical(saved) === canonical(draft);
}
