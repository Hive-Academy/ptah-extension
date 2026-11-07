---
id: TASK_2026_608_a141
status: backlog
type: REFACTORING
title: Align Settings with the app-wide focus, disabled and table-header styles
depends_on: []
created: "2026-10-03T12:10:15.081Z"
updated: '2026-11-07T00:00:00.000Z'
description: >-
  Settings keeps its own focus-ring and disabled rules next to the app-wide ones, so one page can
  show two ring colours. Decide one rule per element and apply it app-wide.
executor: frontend-developer
estimate: S
labels:
  - settings
  - accessibility
  - design-system
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

Settings has its own rules for the focus ring and disabled controls, next to the app-wide rules in
`apps/ptah-extension-webview/src/styles.css`. The result is a consistency issue, not a WCAG
failure: in a light theme one page can show two ring colours (Settings `outline-base-content` and
the app-wide gold or accent ring).

1. Decide one rule per element (focus ring, disabled control, table header) with the design owner,
   and record it.
2. Apply it app-wide in the renderer stylesheet or tokens. Remove the Settings-only duplicates.
3. Measure contrast for each rule in the current themes (at least 3:1 for rings and components),
   including the default `ptah-glass` pair and the per-theme accent ring.

Acceptance: one focus-ring rule per theme; axe `color-contrast` 0 in Settings and the main views
checked; before and after captures in Electron, reviewed by a visual reviewer; the Settings
Playwright folder green.

## Current state (2026-11-07)

- Not started. Settings-only rules are still in `apps/ptah-extension-webview/src/styles.css`:
  disabled controls at `:422-439` and the checkbox/radio/toggle focus ring at `:448`.
- The app-wide focus ring is at `:1053-1061`, with the anubis-light `--ptah-gold-strong` override
  at `:1073-1078` and a per-theme `--ptah-accent-ink` ring for the stock themes after it
  (TASK_2026_677).
- The table-header rule is at `:418` (`.table :where(thead, tfoot)`). Check whether it is still
  Settings-only before you change it.
- Themes changed since this task was filed (glass themes, #805), so re-capture before design.

Full context, plan and discussion live in [./context.md](./context.md).
