# Lofi home polish

1. **Chat, Sessions, and Git dividers:** Added a left border to the Sessions aside and matched its right border, the workspace sidebar edge, and both vertical tabs to `--surface-border` in `apps/ptah-extension-webview/src/styles.css:2538-2552`. The Git dock already has its own left border (`libs/frontend/chat/src/lib/components/templates/electron-shell.component.ts:390`), so its markup was unchanged.
2. **Pane separation:** Gave the workspace sidebar, Sessions aside, and vertical tabs the lofi `base-200` tint, with `base-300` on tab hover. Removed the sidebar surface shadow and kept docked panes square (`apps/ptah-extension-webview/src/styles.css:2538-2554`).
3. **Hero action:** Filled only the empty board's `New session` button with lofi primary and primary-content, including a softened hover fill (`apps/ptah-extension-webview/src/styles.css:2556-2563`). The Sessions footer button remains outlined.
4. **Setup card:** Framed `Before you begin / Get ready` with the existing strong surface line, white fill, lofi `--rounded-box` radius, and no shadow (`apps/ptah-extension-webview/src/styles.css:2564-2569`). Its existing `p-4` inner padding and row dividers remain.
5. **Header tab:** Kept DaisyUI's lifted active border and aligned the lofi tab fill with the white header, avoiding a gray rectangle beside the active tab (`apps/ptah-extension-webview/src/styles.css:2570-2572`).

## Decisions

- All new rules are in one unlayered, lofi-only block before the glass section. No glass flag or backdrop was added; other themes are untouched.
- The lofi palette defines `base-200` as `#F2F2F2`, muted ink as neutral OKLCH 40%, primary as `#0D0D0D`, and primary-content as white. Muted ink on the pane tint exceeds 4.5:1; the hero label on primary exceeds 19:1.
- Source and baseline screenshot were inspected. `git diff --check` passed. No app run, screenshot regeneration, Nx, Jest, TypeScript, lint, build, or serve was performed, as required; runtime appearance remains unverified.

## Files modified

- `apps/ptah-extension-webview/src/styles.css`
- `.ptah/specs/TASK_2026_710_ptah-glass-theme/lane-d-lofi-polish.md`

## Anything not done

- No runtime visual verification because the task explicitly prohibited build and serve commands.
