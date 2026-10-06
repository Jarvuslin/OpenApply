import type { getStatus, SessionStatus, startSession, TerminalProviderId } from "./terminal";

interface SessionApi {
  getStatus: typeof getStatus;
  startSession: typeof startSession;
}

function confirmSession(status: SessionStatus, provider: TerminalProviderId): void {
  if (status.session !== "running") {
    throw new Error(
      "The terminal stopped while connecting. Click Retry terminal to start it again.",
    );
  }
  if (status.provider !== provider) {
    throw new Error(
      `The companion is running ${status.provider}. Choose that provider or switch providers before retrying.`,
    );
  }
}

/** Reconcile the companion after shared or uncertain starts; a remounted panel may follow a stop. */
export function createSessionStarter(api: SessionApi) {
  let pending: Promise<SessionStatus> | null = null;

  return async (
    options: Parameters<typeof startSession>[0],
    signal: AbortSignal,
  ): Promise<void> => {
    signal.throwIfAborted();
    if (pending) {
      let startError: unknown;
      try {
        await pending;
      } catch (error) {
        startError = error;
      }
      signal.throwIfAborted();
      const current = await api.getStatus();
      signal.throwIfAborted();
      if (current.session === "running") {
        confirmSession(current, options.provider);
        return;
      }
      // An aborted HTTP response does not prove that the host stopped starting the process.
      if (startError) throw startError;
    } else {
      const current = await api.getStatus();
      signal.throwIfAborted();
      if (current.session === "running") {
        confirmSession(current, options.provider);
        return;
      }
    }

    if (!pending) {
      const request = api.startSession(options);
      pending = request;
      void request.then(
        () => {
          if (pending === request) pending = null;
        },
        () => {
          if (pending === request) pending = null;
        },
      );
    }
    let startError: unknown;
    try {
      await pending;
    } catch (error) {
      startError = error;
    }
    signal.throwIfAborted();
    const current = await api.getStatus();
    signal.throwIfAborted();
    if (startError && current.session !== "running") throw startError;
    confirmSession(current, options.provider);
  };
}
