# Context - TASK_2026_705_9d53

## User request (2026-10-19, verbatim)

> lets remove that old tangled component completely it shouldn't be used or shown and its
> increasing our bundle without being used make sure its not used anywhere though before we dleete

"That component" = `ptah-tab-bar` (`libs/frontend/chat/src/lib/components/organisms/tab-bar.component.ts`),
seen as a top session navbar in the TASK_2026_699_833e visual-review screenshots.

## Usage found before deletion (orchestrator, on main 15fe6031a)

- Only consumer: `libs/frontend/chat/src/lib/components/templates/app-shell.component.html:222-226`
  (`@if (layoutMode() === 'single') { <ptah-tab-bar /> }`), imported in `app-shell.component.ts:31,118`.
- Electron: unreachable. `ElectronShellComponent` pins `LayoutMode` to `'grid'`
  (`libs/frontend/core/src/lib/services/app-state.service.ts:393-403`).
- VS Code webview: reachable. The "Canvas" toggle (`app-shell.component.html` ~209-219, inside
  `@if (!isElectron)`) flips `'grid'` ↔ `'single'`; the value persists in `localStorage`
  key `ptah-layout-mode` (`app-state.service.ts:776-781`). In `'single'` the tab bar is the
  only session switcher there.

## User decision (AskUserQuestion, 2026-10-19) — APPROVED REMOVAL

"Remove single layout too": delete `ptah-tab-bar` AND the `'single'` layout in every host,
including the VS Code Canvas/single toggle. Both hosts always use the canvas grid with the
session rail. A saved `'single'` value maps to `'grid'`.

## Constraints

- Work only in worktree `D:\projects\ptah-extension\.claude-worktrees\remove-single-layout`
  (branch `refactor/remove-single-layout`).
- Peer branches: do not edit `chat-transcript.*`, `message-bubble.*`, `chat-input.component.ts`.
- Scoped verification only (CLAUDE.md).
