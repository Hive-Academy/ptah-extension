---
title: Opening a Workspace
description: Open a project folder from the menu, the workspace sidebar, or the command line.
---

# Opening a Workspace

PtahCode can open any local folder as a workspace.

## From the menu

Select **File → Open Folder...** and select the project root.

## From the workspace sidebar

Click **Add Folder** in the workspace sidebar and select the project root. The sidebar lists all open workspaces. Click **Remove workspace** to remove a workspace from the list. This does not delete the folder.

![Recent workspaces list](/screenshots/recent-workspaces.png)

## From the command line

Start the app with a folder path as an argument. PtahCode opens that folder as the active workspace. PtahCode ignores a path that is not a readable folder.

When the app already runs, a second start brings the open window to the front. It does not open the folder.

## Supported folders

Any folder works. PtahCode does not require a `package.json`, a `.git` folder, or other marker files.

:::caution
Do not open very large folders, such as your home folder. Open the project root, not its parent.
:::
