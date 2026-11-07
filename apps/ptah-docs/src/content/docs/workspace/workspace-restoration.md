---
title: Workspace Restoration
description: What PtahCode restores when you start the app again.
---

# Workspace Restoration

PtahCode restores your workspaces each time that the app starts.

## Launch flow

1. PtahCode reads the saved list of workspace folders and the active folder.
2. PtahCode skips a saved folder that no longer exists.
3. If you started the app with a folder path, PtahCode adds that folder and makes it active.
4. Otherwise, the saved active folder becomes active again.

## Moved or deleted folders

PtahCode does not try to find a moved folder. Open the folder again from its new location. Refer to [Opening a workspace](/workspace/opening-a-workspace/).

## CLI lanes after a restart

A CLI lane that ran when the app stopped shows **Interrupted by host restart** on its agent card. PtahCode can resume such a lane with its context if the lane started less than 24 hours earlier. After that, the lane starts again without its earlier context.
