## Summary

Removes the single-chat layout and `ptah-tab-bar` from every host (TASK_2026_705_9d53). Every host
now uses the canvas grid with the session rail.

- **What is removed:** the `'single'` `LayoutMode`, the VS Code "Canvas" grid/single toggle, the
  `ptah-tab-bar` component, chat-view's own layout branch, inspector host and session header, the
  layout API in core / harness-builder / webview, and the tab components that became dead
  (`TabItemComponent`, `AwaitingBackgroundIndicatorComponent`).
- **Why:** the tab bar was only reachable through the opt-in single layout in the VS Code webview
  and added bundle weight for an unused path. Electron was already canvas-only
  (`ElectronShellComponent` pinned `LayoutMode` to `'grid'`), and grid was already the default on
  main.
- **Stored state:** a stale `localStorage` value `ptah-layout-mode='single'` is now ignored; the
  app renders the grid. There is no production read or write of the key left (only two
  regression specs reference it).

Merge after #771.

### Commits

- `56451fc0b` refactor(core,chat): batch 1 - drop the tab bar and single layout
- `8e4fc7cb3` refactor(chat,canvas): batch 2 - drop chat-view layout and inspector
- `56fccb725` refactor(core,harness-builder,webview): batch 3 - drop layout API
- `1264d3d41` refactor(chat-ui,e2e): batch 4 - drop dead tab components

## Test plan

Scoped checks only (per repo rules), on this branch:

- [x] Typecheck, 7 projects (core, chat, chat-ui, canvas, harness-builder,
      ptah-extension-webview, ptah-electron-e2e): pass.
- [ ] Test, 6 projects: one failure in the `@ptah-extension/chat` suite. The failing spec changes
      per run (`chat-view.keepalive`, then `CompactSessionCardComponent`) together with a Jest
      worker force-exit. The same failure reproduces on main `79ad83bdb`, and each spec passes when
      run alone, so this is a pre-existing flake, not caused by this PR. All other projects pass.
- [ ] Lint, 7 projects: the only error is the pre-existing circular dependency
      `ptah-extension-webview` <-> `@ptah-extension/command-center` at
      `apps/ptah-extension-webview/src/app/app.routes.ts:224`, which also fails on main
      `15fe6031a`. No new lint errors.
- [x] Zero-reference sweep for the removed symbols and `ptah-layout-mode`: clean (only the two
      planned regression specs: e2e `canvas.spec.ts` and the `app-state.service.spec.ts`
      stored-`single` case).

## Visual evidence

Visual review (AFTER): **APPROVED, 9/10** — see
`.ptah/specs/TASK_2026_705_9d53/visual-review.md` (before capture: `visual-before.md`).

- Before: `.ptah/specs/TASK_2026_705_9d53/screenshots/before/` — VS Code wide and narrow, grid
  and single, dark and light; Electron grid and stored-single, dark and light.
- After: `.ptah/specs/TASK_2026_705_9d53/screenshots/after/` — the same states; the
  `*-single-stored-*` shots show that a stored `single` value now renders the grid.
- Capture scripts: `.ptah/specs/TASK_2026_705_9d53/capture/`.

The review reported three moderate accessibility notes, all pre-existing and not caused by this
PR (listed under follow-ups).

## Reviews

- **Code logic:** codex, **REVISE 4/10** (review family codex; implementer Claude, so the review
  is cross-family). Findings 1-4 are cases where a canvas tile opener can end with no visible
  tile and no error. All four are the unchanged grid path on main: grid is already the default and
  Electron pins it, so default users already hit them; this PR removes only the opt-in single
  fallback. Fixing them needs result channels across core / canvas / chat, which is a scope
  change. **User decision:** ship this PR as a pure removal and track findings 1-4 as a named
  follow-up task (decision 10 in `decisions.md`).
- **Visual:** APPROVED 9/10 (see above).
- **Plan (Gate 2):** approved by codex.

## Follow-ups

1. **Open-result channels for canvas tile openers** (code-logic-review.md findings 1-4):
   - Tasks "Open session" discards the `requestCanvasSession` result
     (`session-open-bridge.service.ts`).
   - Branch shows "Branch created." without awaiting the tile result (`chat-view.component.ts`).
   - Workflow/task tab launch reports success with no tile acknowledgement
     (`workflow-tab-launcher.service.ts`, `task-prompt-bridge.service.ts`), same for the
     harness-builder request (`harness-builder-view.component.ts`).
   - Keyboard Ctrl/Cmd+T and Ctrl/Cmd+Tab create or select tabs without a canvas tile
     (`keyboard-shortcuts.service.ts`).
2. **No-`SESSION_CONTEXT` fallbacks** (parity-inventory.md:114).
3. **`SESSION_WORKFLOW_ADDONS` token and `workflowAddonsFor`** clean-up.
4. **Pre-existing webview lint cycle** at `apps/ptah-extension-webview/src/app/app.routes.ts:224`
   (`ptah-extension-webview` <-> `@ptah-extension/command-center`).
5. **Pre-existing flaky `@ptah-extension/chat` suite** (random spec failure with a Jest worker
   force-exit).
6. **Visual a11y notes** (pre-existing):
   - Light theme: the active "Dashboard" header item (accent text, 11px) is 3.73:1, below AA
     4.5:1 (dark is 8.32:1).
   - At 420px the "New Session" icon button is 22x24 CSS px, borderline for the WCAG 2.2 24x24
     target size.
   - The "Change theme" trigger reports a transparent 2px outline on `:focus-visible`, so its
     focus ring may not be visible (unconfirmed; needs a manual check).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
