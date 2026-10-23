"use client";

import { type MouseEvent, type ReactElement, useState } from "react";
import { MoreHoriz } from "@mui/icons-material";
import { IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip } from "@mui/material";
import { feedbackLinks } from "./shell-config";

/** Rail icon opening a popup with GitHub bug-report / feature-request links. */
export function FeedbackMenu(): ReactElement {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const handleOpen = (e: MouseEvent<HTMLElement>) => setAnchorEl(e.currentTarget);
  const handleClose = () => setAnchorEl(null);

  return (
    <>
      <Tooltip title="Feedback" placement="right">
        <IconButton
          aria-label="Feedback"
          size="small"
          onClick={handleOpen}
          sx={{ color: "text.secondary" }}
        >
          <MoreHoriz fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={!!anchorEl}
        onClose={handleClose}
        anchorOrigin={{ horizontal: "right", vertical: "center" }}
        transformOrigin={{ horizontal: "left", vertical: "center" }}
      >
        {feedbackLinks.map((link) => (
          <MenuItem
            key={link.href}
            component="a"
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleClose}
          >
            <ListItemIcon>
              <link.icon size={16} strokeWidth={1.75} />
            </ListItemIcon>
            <ListItemText>{link.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
