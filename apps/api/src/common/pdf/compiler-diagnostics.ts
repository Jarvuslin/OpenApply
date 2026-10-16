export function compilerDiagnostics(
  output: string,
): { kind: string; message: string; line?: number }[] {
  const issues: { kind: string; message: string; line?: number }[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    const location = /(?:resume\.tex:|at lines? |^l\.)(\d+)/.exec(line);
    let kind: string | undefined;
    if (/Overfull \\[hv]box/.test(line)) kind = "overflow";
    else if (/Missing character:/.test(line)) kind = "missing_glyph";
    else if (/LaTeX Font Warning|font.*not found/i.test(line)) kind = "font";
    else if (/^!|^error:|^caused by:/i.test(line)) kind = "compile";
    if (!kind) continue;
    const message = line
      .replace(/[A-Za-z]:[\\/][^\s"']+/g, "<path>")
      .replace(/(^|\s)\/(?:[^\s/]+\/)+[^\s"']*/g, "$1<path>")
      .replace(/\p{Cc}/gu, "")
      .slice(0, 240);
    if (!issues.some((issue) => issue.message === message))
      issues.push({ kind, message, ...(location ? { line: Number(location[1]) } : {}) });
    if (issues.length === 8) break;
  }
  return issues;
}
