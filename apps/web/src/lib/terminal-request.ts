interface TerminalRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Bound the response body too: a connected companion can still stop responding mid-request. */
export async function terminalRequest<T>(
  url: string,
  init: RequestInit,
  read: (response: Response) => Promise<T>,
  options: TerminalRequestOptions = {},
): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", cancel, { once: true });
  if (options.signal?.aborted) cancel();
  const timer = setTimeout(
    () =>
      controller.abort(
        new DOMException(
          "The companion request timed out. Retry when it is ready.",
          "TimeoutError",
        ),
      ),
    options.timeoutMs ?? 20_000,
  );
  try {
    controller.signal.throwIfAborted();
    const response = await fetch(url, { ...init, signal: controller.signal });
    return await read(response);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", cancel);
  }
}
