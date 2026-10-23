"use client";

import { type MouseEvent, type ReactElement, type ReactNode, useState } from "react";
import { Divider, ListItemIcon, ListItemText, Menu, MenuItem } from "@mui/material";

/**
 * A single entry in a {@link DropdownMenu}. Pass `show: false` to hide it conditionally
 * without spreading `&&` checks across the JSX.
 */
export type DropdownMenuItem =
  | { kind: "divider"; key: string; show?: boolean }
  | {
      kind: "item";
      key: string;
      label: ReactNode;
      /** Leading icon, rendered inside a `ListItemIcon`. */
      icon?: ReactNode;
      /** Fires after the menu closes. */
      onClick?: () => void;
      disabled?: boolean;
      /** Tints the label red - for destructive actions like "Remove". */
      danger?: boolean;
      show?: boolean;
    };

interface DropdownMenuTriggerProps {
  /** Wire this to the trigger element's `onClick` to open the menu. */
  onOpen: (event: MouseEvent<HTMLElement>) => void;
  open: boolean;
}

interface DropdownMenuProps {
  /** Render-prop for the trigger element (Button, IconButton, etc.). */
  trigger: (props: DropdownMenuTriggerProps) => ReactElement;
  items: DropdownMenuItem[];
  minWidth?: number;
}

/**
 * Declarative dropdown menu. Pass a render-prop `trigger` and a flat `items` array;
 * dividers and conditional visibility are handled inline.
 *
 * @example
 * <DropdownMenu
 *   trigger={({ onOpen }) => <IconButton onClick={onOpen}><MoreVert /></IconButton>}
 *   items={[
 *     { kind: "item", key: "edit", label: "Edit", onClick: handleEdit },
 *     { kind: "divider", key: "d1" },
 *     { kind: "item", key: "del", label: "Delete", danger: true, onClick: handleDelete },
 *   ]}
 * />
 */
export function DropdownMenu(props: DropdownMenuProps): ReactElement {
  const { trigger, items, minWidth = 200 } = props;
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = anchor !== null;

  const handleOpen = (event: MouseEvent<HTMLElement>): void => {
    setAnchor(event.currentTarget);
  };

  const handleClose = (): void => {
    setAnchor(null);
  };

  return (
    <>
      {trigger({ onOpen: handleOpen, open })}
      <Menu
        anchorEl={anchor}
        open={open}
        onClose={handleClose}
        slotProps={{ paper: { sx: { minWidth } } }}
      >
        {items.flatMap((item) => {
          if (item.show === false) {
            return [];
          }
          if (item.kind === "divider") {
            return [<Divider key={item.key} />];
          }

          return [
            <MenuItem
              key={item.key}
              disabled={item.disabled}
              onClick={() => {
                handleClose();
                item.onClick?.();
              }}
            >
              {item.icon && <ListItemIcon>{item.icon}</ListItemIcon>}
              <ListItemText sx={item.danger ? { color: "error.main" } : undefined}>
                {item.label}
              </ListItemText>
            </MenuItem>,
          ];
        })}
      </Menu>
    </>
  );
}
