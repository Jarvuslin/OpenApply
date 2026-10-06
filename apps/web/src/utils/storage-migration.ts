type MigrationStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

export function migrateOpenApplyStorage(storage: MigrationStorage): void {
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  for (const oldKey of keys) {
    if (oldKey !== "jobpilot:agent" && !oldKey?.startsWith("jobpilot:onboarding:v1:")) continue;
    const newKey = oldKey.replace(/^jobpilot:/, "openapply:");
    const value = storage.getItem(oldKey);
    if (value === null || storage.getItem(newKey) !== null) continue;
    // Keep the source until the new write succeeds, including when storage is full.
    storage.setItem(newKey, value);
    storage.removeItem(oldKey);
  }
}
