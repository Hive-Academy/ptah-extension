---
title: File Tree
description: Browse your workspace files in the Ptah sidebar.
---

# File Tree

The **File Tree** panel in the left sidebar mirrors your workspace on disk. It's your primary way to navigate the codebase without leaving Ptah.

![File tree panel](/screenshots/file-tree-panel.png)

## Browsing

- **Click a folder** to expand or collapse it. Expansion is lazy — child entries are read from disk only when you open the folder, so very large projects stay snappy.
- **Click a file** to open a read-only preview in the main panel. Agents can still edit it; the preview just gives you a quick look.
- **Right-click** for context actions (copy path, reveal in OS file manager, open in terminal).

## Filtering

Ptah respects your `.gitignore` by default. Files and folders ignored by git (like `node_modules`, `dist`, `.venv`) are hidden from the tree to keep it focused on source code.

To show ignored entries temporarily, toggle **Show hidden files** from the panel's overflow menu.

## Refresh behavior

The tree updates automatically when files change on disk — creating a new file in your terminal or from an agent immediately reflects in the sidebar. There is no manual refresh button because there's no need for one.

:::tip
The file tree is intentionally minimal. For heavier navigation (symbol search, fuzzy file open, go-to-definition), use an external editor alongside Ptah — the two are designed to coexist.
:::
