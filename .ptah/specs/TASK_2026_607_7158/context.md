# TASK_2026_607 — Electron shell sidebar contrast

## Why

Measured in TASK_2026_555 Gate V 38 (finding B38-6, follow-up 11 in `TASK_2026_555/batches.md`; evidence
`TASK_2026_555/screenshots/gate-v38/sweep-electron-*.json`). Outside Settings, so not fixed there. The Batch 51
"0 color-contrast" result holds only inside `ptah-settings`.

| Element | Theme | Colours | Contrast | Needed |
| --- | --- | --- | --- | --- |
| Active workspace name | dark (anubis) | `#2563eb` on `#242430` | 2.96:1 | 4.5:1 (text) |
| "Hide Workspaces" rail label | dark | — | 3.45:1 | 4.5:1 |
| "Hide Workspaces" rail label | light (anubis-light) | `#44ebd3` on `#f3efec` | 1.3:1 | 4.5:1 |

## Scope

- Find the Electron shell sidebar components (thoth-shell / Electron layout) and use `text-base-content` for the text,
  with colour on an icon, dot or badge if the active state needs an accent (the Settings rule).
- Keep a visible active state that does not rely on colour alone.

## Acceptance criteria

1. axe `color-contrast` reports 0 for the shell sidebar in both themes.
2. Before/after captures in both themes, reviewed by a visual reviewer.

## Out of scope

The rest of the shell layout.

## Triage 2026-10-30

Backlog audit after the October refactors: partly delivered, still open.

- Still open: Active workspace name still uses text-primary for text; re-measure in anubis/anubis-light and the new default ptah-glass pair (#805) and move colour to the icon/dot. Re-confirm the rail label with axe.
- Evidence on main: Rail label: main:libs/frontend/chat-ui/src/lib/atoms/sidebar-tab.component.ts now uses text-base-content (open) / text-base-content-muted (closed), touched by 82b79b348 (2026-10-19 visual review fixes) and c89ca28b9; base-content-muted contrast is pinned by apps/ptah-extension-webview/src/app/base-content-muted.spec.ts. Active workspace name: main:libs/frontend/chat/src/lib/components/organisms/workspace-sidebar.component.ts:66 still applies `text-primary` to the active row text.
