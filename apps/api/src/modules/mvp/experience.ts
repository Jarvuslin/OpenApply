// Only explicit experience phrases qualify; company age and graduation years do not.
export function listedExperience(text: string): number | undefined {
  const pattern =
    /\b(\d{1,2})(?:\s*[-–]\s*\d{1,2})?\+?\s+years?\s+(?:of\s+)?(?:(?:professional|relevant|hands-on|software|development|engineering|industry|work)\s+){0,4}experience\b/gi;
  const years: number[] = [];
  for (const match of text.matchAll(pattern)) {
    const after = text.slice(
      (match.index ?? 0) + match[0].length,
      (match.index ?? 0) + match[0].length + 40,
    );
    if (/^\s*(?:is\s+)?(?:preferred|a plus|nice to have)/i.test(after)) continue;
    const value = Number(match[1]);
    if (value <= 50) years.push(value);
  }
  return years.length ? Math.max(...years) : undefined;
}
