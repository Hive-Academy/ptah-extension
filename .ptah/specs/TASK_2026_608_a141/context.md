# TASK_2026_608 — align Settings with the app-wide focus, disabled and table-header styles

## Why

After `origin/main` was merged into TASK_2026_555, main's TASK_2026_576 style changes became visible in Settings
(`TASK_2026_555/visual-review.md`, "Final review on PR 631", "Interaction of main's merged styles"):

- **Focus ring:** main's light-theme rule (`apps/ptah-extension-webview/src/styles.css`, a `:where()` rule around
  lines 630-633) draws a gold-strong ring. Settings uses `outline-base-content` on most controls, and TASK_2026_555
  Batch 55b added a Settings-only rule for checkbox, radio and toggle (`:where(ptah-settings) :is(.checkbox, .radio,
  .toggle):focus-visible`). So two ring colours exist on one page in the light theme.
- **Disabled icons:** main's ghost-button default makes disabled icons faint; Settings sets `disabled:opacity-50`
  on the built-in output-style icons.
- **Table headers:** TASK_2026_555 Batch 51 set a Settings table-header rule; it is not applied app-wide.

All pass WCAG 2.2 AA today; the issue is consistency, not a failure.

## Scope

1. Decide one rule per element (focus ring, disabled control, table header) with the design owner; record it.
2. Apply it app-wide in the webview stylesheet / tokens; remove the Settings-only duplicates.
3. Measure contrast for each rule in both themes (>= 3:1 for rings and components).

## Acceptance criteria

1. One focus-ring rule in both themes; axe `color-contrast` 0 in Settings and in the main views checked.
2. Before/after captures in both hosts and both themes, reviewed by a visual reviewer; Settings Playwright folder
   green.

## Out of scope

New design tokens beyond what the rules need.
