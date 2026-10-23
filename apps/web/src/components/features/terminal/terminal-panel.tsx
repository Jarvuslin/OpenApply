"use client";

import "@xterm/xterm/css/xterm.css";
import { type ReactElement, useEffect, useRef, useState } from "react";
import { Box, Button, Stack, useTheme } from "@mui/material";
import { FitAddon } from "@xterm/addon-fit";
import { type ITheme, Terminal } from "@xterm/xterm";
import { API_BASE_URL } from "@/api/base-url";
import { api } from "@/api/client";
import { getStatus, startSession, TERMINAL_WS_URL, type TerminalProviderId } from "@/lib/terminal";
import { createSessionStarter } from "@/lib/terminal-session-start";
import { connectWebSocket, type WebSocketClient } from "@/lib/websocket";
import { toBase64 } from "@/utils/base64";

const RESIZE_DEBOUNCE_MS = 220;

const ensureSession = createSessionStarter({ getStatus, startSession });

const TERMINAL_FONT_FAMILY = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const SHIFT_ENTER_B64 = toBase64("\x1b[13;2u");
const CTRL_C_B64 = toBase64("\x03");

const DIM = 2;
const RED = 31;
const YELLOW = 33;

interface TerminalPanelProps {
  provider: TerminalProviderId;
}

type SendInput = (b64: string) => void;

function notice(color: number, text: string): string {
  return `\x1b[${color}m[terminal] ${text}\x1b[0m`;
}

function isCtrl(event: KeyboardEvent, code: string): boolean {
  return event.ctrlKey && !event.altKey && !event.metaKey && event.code === code;
}

/** Shift+Enter as CSI-u, Ctrl+C copy-or-interrupt, Ctrl+V paste; everything else falls through to xterm. */
function createKeyHandler(
  terminal: Terminal,
  sendInput: SendInput,
): (event: KeyboardEvent) => boolean {
  return (event) => {
    if (event.type !== "keydown") {
      return true;
    }

    if (event.key === "Enter" && event.shiftKey) {
      event.preventDefault();
      sendInput(SHIFT_ENTER_B64);
      return false;
    }
    if (isCtrl(event, "KeyC")) {
      // Ctrl+C only interrupts the running process; the Stop button kills the session.
      event.preventDefault();
      if (terminal.hasSelection()) {
        void navigator.clipboard?.writeText(terminal.getSelection());
      } else {
        sendInput(CTRL_C_B64);
      }
      return false;
    }
    if (isCtrl(event, "KeyV")) {
      event.preventDefault();
      void navigator.clipboard?.readText().then((text) => {
        if (text) {
          sendInput(toBase64(text));
        }
      });
      return false;
    }
    return true;
  };
}

/** Authenticates and starts the host session; on failure writes the reason and resolves false. */
async function openSession(
  terminal: Terminal,
  fit: FitAddon,
  provider: TerminalProviderId,
  signal: AbortSignal,
): Promise<boolean> {
  terminal.writeln(notice(DIM, "connecting…"));

  try {
    const { data, error } = await api.auth.tokens.terminal.post(undefined, {
      fetch: { signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) },
    });
    if (signal.aborted) {
      return false;
    }
    if (error) {
      terminal.writeln(
        notice(
          RED,
          `couldn't authenticate the agent - sign in to OpenApply, then restart the terminal. (${error.value.message})`,
        ),
      );
      return false;
    }

    fit.fit();
    await ensureSession(
      {
        cols: terminal.cols,
        rows: terminal.rows,
        provider,
        apiToken: data.token,
        webUrl: window.location.origin,
        apiUrl: API_BASE_URL,
      },
      signal,
    );
    return !signal.aborted;
  } catch (err) {
    if (signal.aborted) {
      return false;
    }

    const message = (err as Error).message;
    terminal.writeln(notice(RED, `failed to start session: ${message}`));

    if (/Failed to start '(claude|codex)'/.test(message)) {
      terminal.writeln(
        notice(
          YELLOW,
          `Install ${provider === "claude" ? "Claude Code" : "Codex"} on this computer, then click Retry terminal. OpenApply checks for it again on each attempt.`,
        ),
      );
    }
    return false;
  }
}

/** xterm.js bridged to a OpenApply.Terminal PTY over WebSocket; Shift+Enter sent as CSI-u `ESC[13;2u`. */
export function TerminalPanel(props: TerminalPanelProps): ReactElement {
  const { provider } = props;
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const { palette } = useTheme();
  const background = palette.surfaces.base;
  const foreground = palette.text.primary;
  const accent = palette.primary.main;

  // Retheme the live terminal in place - remounting it would wipe the visible session.
  // Declared before the mount effect so themeRef is filled by the time the terminal is created.
  const themeRef = useRef<ITheme>(undefined);
  useEffect(() => {
    const theme: ITheme = {
      background,
      foreground,
      cursor: accent,
      selectionBackground: `${accent}40`,
    };
    themeRef.current = theme;
    if (terminalRef.current) {
      terminalRef.current.options.theme = theme;
    }
  }, [background, foreground, accent]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries a failed session start
  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: TERMINAL_FONT_FAMILY,
      fontSize: 13,
      scrollOnUserInput: true,
      smoothScrollDuration: 0,
      windowsPty: { backend: "conpty" },
      theme: themeRef.current,
    });
    terminalRef.current = terminal;

    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);

    const abort = new AbortController();
    let socket: WebSocketClient | null = null;

    const fitAndResize = (): void => {
      try {
        fit.fit();
        socket?.sendJson({ type: "resize", cols: terminal.cols, rows: terminal.rows });
      } catch {
        // container not laid out yet
      }
    };

    // sendJson is a no-op after the socket closes, so late key events are harmless.
    const sendInput: SendInput = (data) => {
      socket?.sendJson({ type: "input", data });
    };
    terminal.attachCustomKeyEventHandler(createKeyHandler(terminal, sendInput));
    terminal.onData((data) => sendInput(toBase64(data)));

    // socket.close() in the cleanup detaches these callbacks, so none can hit a disposed terminal.
    const write = (data: string | Uint8Array): void => {
      terminal.write(data);
    };
    openSession(terminal, fit, provider, abort.signal).then((started) => {
      if (abort.signal.aborted) return;
      if (started) {
        setFailed(false);
        try {
          socket = connectWebSocket(TERMINAL_WS_URL, {
            connectTimeoutMs: 10_000,
            onOpen: fitAndResize,
            onBinary: write,
            onText: write,
            onClose: () => {
              write(
                `\r\n${notice(YELLOW, "disconnected — click Retry terminal to reconnect")}\r\n`,
              );
              setFailed(true);
            },
            onError: () => {
              write(
                `\r\n${notice(RED, "terminal connection failed — click Retry terminal to reconnect")}\r\n`,
              );
              setFailed(true);
            },
          });
        } catch (error) {
          write(
            `\r\n${notice(RED, `terminal connection failed: ${(error as Error).message}`)}\r\n`,
          );
          setFailed(true);
        }
      } else {
        setFailed(true);
      }
    });

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new ResizeObserver(() => {
      if (resizeTimer) {
        clearTimeout(resizeTimer);
      }
      resizeTimer = setTimeout(fitAndResize, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(container);

    return () => {
      abort.abort();
      if (resizeTimer) {
        clearTimeout(resizeTimer);
      }
      observer.disconnect();
      socket?.close(1000, "panel unmounted");
      terminalRef.current = null;
      terminal.dispose();
    };
  }, [provider, attempt]);

  return (
    <Stack sx={{ flex: 1, minHeight: 0, height: "100%" }}>
      <Box
        ref={containerRef}
        sx={(t) => ({
          flex: 1,
          minHeight: 0,
          backgroundColor: t.palette.surfaces.base,
          overflow: "hidden",
          position: "relative",
          px: 1,
          py: 0.5,
          "& .xterm": { height: "100%", maxWidth: "100%" },
          "& .xterm-viewport": { overscrollBehavior: "contain" },
        })}
      />
      {failed && (
        <Button
          sx={{ alignSelf: "flex-start", m: 1 }}
          onClick={() => {
            setFailed(false);
            setAttempt((value) => value + 1);
          }}
        >
          Retry terminal
        </Button>
      )}
    </Stack>
  );
}
