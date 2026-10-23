import type { UserWithAutoApplyInput } from "@openapply/contracts/user";

interface SettingsDraft {
  baseline: UserWithAutoApplyInput;
  values: UserWithAutoApplyInput;
}

interface SettingsSave {
  userId: string;
  generation: number;
  values: UserWithAutoApplyInput;
}

// Keep unfinished edits across App Router history navigation, without persisting profile data to disk.
const drafts = new Map<string, SettingsDraft>();
const savedSnapshots = new Map<string, { values: UserWithAutoApplyInput; savedAt: number }>();
const listeners = new Map<string, Set<(saved: UserWithAutoApplyInput) => void>>();
let generation = 0;

export const settingsDrafts = {
  generation(): number {
    return generation;
  },
  read(userId: string): SettingsDraft | undefined {
    const draft = drafts.get(userId);
    return draft && structuredClone(draft);
  },
  readSaved(userId: string, serverUpdatedAt: number): UserWithAutoApplyInput | undefined {
    const snapshot = savedSnapshots.get(userId);
    if (!snapshot || serverUpdatedAt > snapshot.savedAt) return undefined;
    return structuredClone(snapshot.values);
  },
  write(userId: string, draft: SettingsDraft, sessionGeneration = generation): void {
    if (sessionGeneration !== generation) return;
    drafts.set(userId, structuredClone(draft));
  },
  delete(userId: string, sessionGeneration = generation): void {
    if (sessionGeneration !== generation) return;
    drafts.delete(userId);
  },
  beginSave(userId: string, values: UserWithAutoApplyInput): SettingsSave {
    return { userId, generation, values: structuredClone(values) };
  },
  completeSave(save: SettingsSave): boolean {
    if (save.generation !== generation) return false;
    savedSnapshots.set(save.userId, { values: structuredClone(save.values), savedAt: Date.now() });
    const current = drafts.get(save.userId);
    if (current && JSON.stringify(current.values) !== JSON.stringify(save.values)) {
      drafts.set(save.userId, { baseline: structuredClone(save.values), values: current.values });
    } else {
      drafts.delete(save.userId);
    }
    for (const listener of listeners.get(save.userId) ?? []) listener(structuredClone(save.values));
    return true;
  },
  subscribe(userId: string, listener: (saved: UserWithAutoApplyInput) => void): () => void {
    const subscriptions =
      listeners.get(userId) ?? new Set<(saved: UserWithAutoApplyInput) => void>();
    listeners.set(userId, subscriptions);
    subscriptions.add(listener);
    return () => {
      subscriptions.delete(listener);
      if (subscriptions.size === 0 && listeners.get(userId) === subscriptions)
        listeners.delete(userId);
    };
  },
  clear(): void {
    generation += 1;
    drafts.clear();
    savedSnapshots.clear();
    listeners.clear();
  },
};
