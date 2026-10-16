/** The rules robots.txt gives every crawler (`User-agent: *`), per RFC 9309. */
export interface RobotsRules {
  allow: string[];
  disallow: string[];
  /** Seconds between requests, when the site asks for one. */
  crawlDelay: number | null;
}

const EVERYONE: RobotsRules = { allow: [], disallow: [], crawlDelay: null };

export function parseRobots(text: string): RobotsRules {
  const rules: RobotsRules = { allow: [], disallow: [], crawlDelay: null };
  let agents: string[] = [];
  let inRules = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      // Consecutive User-agent lines share the group that follows them.
      if (inRules) agents = [];
      inRules = false;
      agents.push(value.toLowerCase());
      continue;
    }
    inRules = true;
    if (!agents.includes("*")) continue;
    if (field === "allow" && value) rules.allow.push(value);
    if (field === "disallow" && value) rules.disallow.push(value);
    if (field === "crawl-delay") {
      const seconds = Number(value);
      if (Number.isFinite(seconds) && seconds > 0) rules.crawlDelay = Math.min(seconds, 60);
    }
  }
  return rules;
}

function pattern(rule: string): RegExp {
  const anchored = rule.endsWith("$");
  const body = (anchored ? rule.slice(0, -1) : rule)
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

/** The longest matching rule wins; on a tie, Allow wins. `path` includes the query string. */
export function robotsAllows(rules: RobotsRules, path: string, ignoreCase = false): boolean {
  const target = ignoreCase ? path.toLowerCase() : path;
  let best = { length: -1, allowed: true };
  for (const [list, allowed] of [
    [rules.disallow, false],
    [rules.allow, true],
  ] as const) {
    for (const rule of list) {
      const source = ignoreCase ? rule.toLowerCase() : rule;
      if (!pattern(source).test(target)) continue;
      if (source.length > best.length || (source.length === best.length && allowed))
        best = { length: source.length, allowed };
    }
  }
  return best.allowed;
}

/** A missing robots.txt (4xx) allows everything. */
export function rulesForStatus(status: number, text: string): RobotsRules | null {
  if (status >= 200 && status < 300) return parseRobots(text);
  if (status >= 400 && status < 500) return EVERYONE;
  return null;
}
