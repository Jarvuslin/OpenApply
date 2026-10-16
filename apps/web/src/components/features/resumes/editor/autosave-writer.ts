import type { SaveState } from "./use-autosave";

export function createAutosaveWriter<T>(
  save: (value: T) => Promise<unknown>,
  onState: (state: SaveState) => void,
) {
  let pending: T | undefined;
  let active: Promise<void> | null = null;
  const write = async (value: T): Promise<void> => {
    try {
      await save(value);
      onState(pending === undefined ? "saved" : "dirty");
    } catch {
      // Preserve newer typing when a request for an older draft fails.
      if (pending === undefined) pending = value;
      onState("error");
    }
  };
  const flush = async (): Promise<void> => {
    if (active) {
      await active;
      return flush();
    }
    if (pending === undefined) return;
    const value = pending;
    pending = undefined;
    onState("saving");
    active = write(value);
    await active;
    active = null;
  };
  return {
    change(value: T): void {
      pending = value;
      onState("dirty");
    },
    flush,
  };
}
