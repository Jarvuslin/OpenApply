// biome-ignore lint/suspicious/noControlCharactersInRegex: explicitly remove terminal control sequences from agent text.
const TERMINAL_COLOR = /\u001b\[[0-9;]*[A-Za-z]/g;
// biome-ignore lint/suspicious/noControlCharactersInRegex: strip non-printing controls while retaining newlines and tabs.
const NONPRINTING = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;

/** Agent output saved for people to read: no terminal controls or echoed credentials. */
export function cleanAgentText(content: string) {
  return content
    .replace(TERMINAL_COLOR, "")
    .replace(NONPRINTING, "")
    .replace(/\bBearer\s+[A-Za-z0-9_.~+/=-]+/gi, "Bearer [redacted]")
    .replace(
      /\b((?:password|api[_ -]?key|access[_ -]?token|secret)\s*[:=]\s*)[^\s,;]+/gi,
      "$1[redacted]",
    );
}
