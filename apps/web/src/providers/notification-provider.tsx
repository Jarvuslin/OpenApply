"use client";

import {
  createContext,
  type PropsWithChildren,
  type ReactElement,
  useContext,
  useState,
} from "react";
import { Alert, Button, Snackbar } from "@mui/material";
import NextLink from "next/link";

type ToastSeverity = "success" | "info" | "warning" | "error";

interface ToastAction {
  label: string;
  href: string;
}

interface Toast {
  id: number;
  message: string;
  severity: ToastSeverity;
  action?: ToastAction;
}

interface ToastApi {
  show: (message: string, severity?: ToastSeverity, action?: ToastAction) => void;
  success: (message: string, action?: ToastAction) => void;
  error: (message: string, action?: ToastAction) => void;
  info: (message: string, action?: ToastAction) => void;
  warning: (message: string, action?: ToastAction) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider(props: PropsWithChildren): ReactElement {
  const { children } = props;
  const [toast, setToast] = useState<Toast | null>(null);

  const show = (message: string, severity: ToastSeverity = "info", action?: ToastAction) => {
    setToast({ id: Date.now(), message, severity, action });
  };

  const api: ToastApi = {
    show,
    success: (m, action) => show(m, "success", action),
    error: (m, action) => show(m, "error", action),
    info: (m, action) => show(m, "info", action),
    warning: (m, action) => show(m, "warning", action),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <Snackbar
        open={toast !== null}
        key={toast?.id}
        autoHideDuration={toast?.action ? 8000 : 4000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
      >
        {toast ? (
          <Alert
            onClose={() => setToast(null)}
            severity={toast.severity}
            variant="filled"
            sx={{ minWidth: 280 }}
            action={
              toast.action && (
                <Button
                  component={NextLink}
                  href={toast.action.href}
                  color="inherit"
                  size="small"
                  onClick={() => setToast(null)}
                >
                  {toast.action.label}
                </Button>
              )
            }
          >
            {toast.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside NotificationProvider");
  return ctx;
}
