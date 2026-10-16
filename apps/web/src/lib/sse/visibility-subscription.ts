interface VisibilitySource {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

/** Release the subscription while hidden and acquire it once when visible again. */
export function subscribeWhileVisible(
  visibility: VisibilitySource,
  acquire: () => () => void,
  onHidden: () => void,
): () => void {
  let release: (() => void) | null = null;
  let disposed = false;

  const releaseSubscription = () => {
    const current = release;
    release = null;
    current?.();
  };
  const onVisibilityChange = () => {
    if (disposed) return;
    if (visibility.visibilityState === "hidden") {
      releaseSubscription();
      onHidden();
    } else if (!release) {
      release = acquire();
    }
  };

  visibility.addEventListener("visibilitychange", onVisibilityChange);
  onVisibilityChange();

  return () => {
    if (disposed) return;
    disposed = true;
    visibility.removeEventListener("visibilitychange", onVisibilityChange);
    releaseSubscription();
  };
}
