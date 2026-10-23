import path from "node:path";

export function questionRegressionOptions(args) {
  const result = { databaseOnly: false };
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--database-only") result.databaseOnly = true;
    else if (["--run-id", "--ui-source"].includes(flag) && args[index + 1]) {
      const value = args[++index];
      if (flag === "--run-id") result.runId = value;
      else result.uiSource = path.resolve(value);
    } else throw new Error(`Unknown or incomplete question regression flag: ${flag}`);
  }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(result.runId ?? ""))
    throw new Error("Supply a fresh --run-id with lowercase letters, digits or hyphens.");
  if (result.uiSource && result.databaseOnly)
    throw new Error("Choose database verification or UI verification from preserved evidence.");
  return result;
}
