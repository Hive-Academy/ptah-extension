---
id: TASK_2026_607_7158
status: backlog
type: BUGFIX
title: Fix the active workspace name contrast in the Electron sidebar
depends_on: []
created: "2026-10-03T12:10:12.694Z"
updated: '2026-11-07T00:00:00.000Z'
description: >-
  The active workspace row in the workspace sidebar uses text-primary for its text (2.96:1 measured
  in dark anubis). Use text-base-content for the text and keep the accent on the icon.
executor: frontend-developer
estimate: XS
labels:
  - electron
  - accessibility
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

The active workspace name in the Electron workspace sidebar uses `text-primary` for its text. In
TASK_2026_555 it measured 2.96:1 (`#2563eb` on `#242430`, dark anubis); text needs 4.5:1.

- Use `text-base-content` for the row text. Keep the accent on the folder icon (or a dot or badge),
  and keep a visible active state that does not rely on colour alone (the Settings rule).
- Re-measure with axe in the current themes, including the default `ptah-glass` pair (#805) and
  anubis / anubis-light.

Acceptance: axe `color-contrast` reports 0 for the shell sidebar in both themes of each pair;
before and after captures in Electron, reviewed by a visual reviewer.

## Current state (2026-11-07)

- Open: `libs/frontend/chat/src/lib/components/organisms/workspace-sidebar.component.ts:66` sets
  `[class.text-primary]` on the active row, so the name text is primary-coloured. The icon at
  `:73` also uses `text-primary`, which can stay.
- Done: the rail tab label now uses `text-base-content` / `text-base-content-muted`
  (`libs/frontend/chat-ui/src/lib/atoms/sidebar-tab.component.ts:88-90`, from `82b79b348` and
  `c89ca28b9`). The muted contrast is pinned by
  `apps/ptah-extension-webview/src/app/base-content-muted.spec.ts`. The "Hide Workspaces" label no
  longer exists in the code.

Full context, plan and discussion live in [./context.md](./context.md).
