export function bootstrapDiagnostic(error) {
  const name = typeof error?.name === "string" ? error.name : "";
  const code = typeof error?.code === "string" ? error.code : "";
  if (/^P\d{4}$/.test(code)) return { category: "database_error", code };
  if (["ERR_MODULE_NOT_FOUND", "MODULE_NOT_FOUND", "ERR_INVALID_PACKAGE_TARGET"].includes(code))
    return { category: "module_error", code };
  if (["SyntaxError", "ReferenceError", "TypeError", "AssertionError"].includes(name))
    return { category: "bootstrap_error", kind: name };
  return { category: "bootstrap_error" };
}

export function environmentDiagnostic(issues) {
  return {
    category: "environment_error",
    paths: [
      ...new Set(
        issues
          .slice(0, 50)
          .map((issue) => issue.path?.[0])
          .filter((value) => typeof value === "string" && /^[A-Z][A-Z0-9_]{0,100}$/.test(value)),
      ),
    ].sort(),
  };
}

export function databaseDiagnostic(error) {
  const diagnostic = bootstrapDiagnostic(error);
  const constraints = new Set([
    "work_item_owned_slot",
    "work_items_kind_link",
    "work_items_owned_execution_fk",
    "work_items_live_slot",
    "users_email_key",
    "users_username_key",
    "work_items_user_id_identity_key",
    "work_items_job_id_key",
  ]);
  const visited = new Set();
  const queue = [error];
  let sqlstate, constraint;
  for (let i = 0; i < queue.length && i < 40; i++) {
    const value = queue[i];
    if (!value || typeof value !== "object" || visited.has(value)) continue;
    visited.add(value);
    for (const [key, entry] of Object.entries(value).slice(0, 30)) {
      if (
        ["code", "sqlstate", "sqlState", "originalCode"].includes(key) &&
        typeof entry === "string" &&
        /^(?:[0-9]{2}|P0)[A-Z0-9]{3}$/.test(entry)
      )
        sqlstate = entry;
      if (["name", "constraint", "constraintName"].includes(key) && constraints.has(entry))
        constraint = entry;
      if (entry && typeof entry === "object" && queue.length < 40) queue.push(entry);
    }
  }
  return {
    ...diagnostic,
    ...(sqlstate ? { sqlstate } : {}),
    ...(constraint ? { constraint } : {}),
  };
}
