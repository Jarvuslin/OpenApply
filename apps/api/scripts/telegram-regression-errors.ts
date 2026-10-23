import { safeConcurrencyFailure } from "./concurrency-regression-guards";

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function safeTelegramFailure(error: unknown) {
  const root = object(error);
  const meta = object(root.meta);
  const driver = object(meta.driverAdapterError);
  const candidates = [root, meta, driver, object(driver.cause), object(root.cause)];
  const result: Record<string, unknown> = safeConcurrencyFailure(error);
  for (const candidate of candidates) {
    const code =
      candidate.sqlState ?? candidate.sqlstate ?? candidate.originalCode ?? candidate.code;
    const constraint = candidate.constraint;
    if (typeof code === "string" && /^(?:[0-9]{2}|P0|XX|HV|F0)[0-9A-Z]{3}$/.test(code))
      result.sqlState = code;
    if (
      typeof constraint === "string" &&
      /^(application_|answer_bank_|telegram_|pilot_|job_|runtime_)[a-z0-9_]{1,100}$/.test(
        constraint,
      )
    )
      result.constraint = constraint;
  }
  return result;
}
