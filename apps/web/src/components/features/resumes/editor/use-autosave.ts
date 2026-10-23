"use client";

import { useEffect, useRef, useState } from "react";
import { createAutosaveWriter } from "./autosave-writer";

/** Long enough to swallow a burst of typing, short enough that leaving the page feels safe. */
const DEBOUNCE_MS = 1500;

export type SaveState = "clean" | "dirty" | "saving" | "saved" | "error";

interface AutosaveOptions<T> {
  save: (value: T) => Promise<unknown>;
}

interface Autosave<T> {
  state: SaveState;
  change: (value: T) => void;
  flush: () => void;
}

/** Pending value lives in a ref, so the timer writes the newest edit without re-arming. */
export function useAutosave<T>(options: AutosaveOptions<T>): Autosave<T> {
  const { save } = options;
  const [state, setState] = useState<SaveState>("clean");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  const writerRef = useRef<ReturnType<typeof createAutosaveWriter<T>> | null>(null);
  if (!writerRef.current) {
    writerRef.current = createAutosaveWriter<T>((value) => saveRef.current(value), setState);
  }
  const writer = writerRef.current;

  const clearTimer = (): void => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const flush = (): void => {
    clearTimer();
    void writer.flush();
  };

  const change = (value: T): void => {
    writer.change(value);
    clearTimer();
    timer.current = setTimeout(flush, DEBOUNCE_MS);
  };

  // Navigating away mid-debounce would otherwise drop the last edit.
  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
      }
      void writer.flush();
    };
  }, [writer]);

  return { state, change, flush };
}
