"use client";

import { createContext, type ReactElement, type ReactNode, use } from "react";
import {
  Box,
  IconButton,
  Dialog as MuiDialog,
  type DialogProps as MuiDialogProps,
  DialogTitle as MuiDialogTitle,
} from "@mui/material";
import { X } from "lucide-react";

const CloseContext = createContext<(() => void) | null>(null);

/** MUI's Dialog that hands its close handler to DialogTitle, so every title gets an X. */
export function Dialog(props: MuiDialogProps): ReactElement {
  const { onClose } = props;
  const close = onClose ? () => onClose({}, "backdropClick") : null;
  return (
    <CloseContext value={close}>
      <MuiDialog {...props} />
    </CloseContext>
  );
}

interface DialogTitleProps {
  children: ReactNode;
  /** For the dialog's aria-labelledby. */
  id?: string;
  /** Overrides the dialog's own close handler, e.g. to ask before discarding. */
  onClose?: () => void;
}

/** The app's dialog header: title on the left, a close button on the right, a rule below. */
export function DialogTitle({ children, id, onClose }: DialogTitleProps): ReactElement {
  const dialogClose = use(CloseContext);
  const close = onClose ?? dialogClose;
  return (
    <MuiDialogTitle
      id={id}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
        pr: close ? 1.5 : 3,
        borderBottom: 1,
        borderColor: "divider",
      }}
    >
      <Box component="span" sx={{ flex: 1, minWidth: 0 }}>
        {children}
      </Box>
      {close && (
        <IconButton
          aria-label="Close"
          size="small"
          onClick={close}
          sx={{ color: "text.secondary" }}
        >
          <X size={18} aria-hidden />
        </IconButton>
      )}
    </MuiDialogTitle>
  );
}
