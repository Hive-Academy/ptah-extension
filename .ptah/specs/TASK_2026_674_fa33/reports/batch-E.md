# Batch E — clean session view selectors

Updated the three showcase scenes to find a session by its focus-header title and close it through the focus-header button. Also migrated one removed grid tile selector found elsewhere under the e2e source tree.

| File:line | Old selector | New selector | Markup evidence |
| --- | --- | --- | --- |
| `showcase/canvas-orchestra.scene.ts:123` | `.tile-header span` | `ptah-canvas-focus-header strong[title]` inside `[data-testid="canvas-tile"]` | `canvas-rail-board.component.ts:162,168`; `canvas-focus-area.component.ts:34-36`; `canvas-focus-header.component.ts:123-127` |
| `showcase/canvas-orchestra.scene.ts:129` | `[title="Close tile"]` | `getByRole('button', { name: 'Close session' })` inside the matched tile | `canvas-focus-header.component.ts:270-277` |
| `showcase/canvas-orchestra.scene.ts:140` | Comment naming `Close tile` | Comment naming `Close session` | `canvas-focus-header.component.ts:273-277` |
| `showcase/chat-code-edit.scene.ts:212` | `.tile-header span` | `ptah-canvas-focus-header strong[title]` inside `[data-testid="canvas-tile"]` | `canvas-rail-board.component.ts:162,168`; `canvas-focus-area.component.ts:34-36`; `canvas-focus-header.component.ts:123-127` |
| `showcase/chat-code-edit.scene.ts:218` | `[title="Close tile"]` | `getByRole('button', { name: 'Close session' })` inside the matched tile | `canvas-focus-header.component.ts:270-277` |
| `showcase/lane-console-review.scene.ts:98` | `.tile-header span` | `ptah-canvas-focus-header strong[title]` inside `[data-testid="canvas-tile"]` | `canvas-rail-board.component.ts:162,168`; `canvas-focus-area.component.ts:34-36`; `canvas-focus-header.component.ts:123-127` |
| `showcase/lane-console-review.scene.ts:110` | `[title="Close tile"]` | `getByRole('button', { name: 'Close session' })` inside the matched tile | `canvas-focus-header.component.ts:270-277` |
| `docs-screenshots/sessions.shot.ts:69` | `[data-testid="canvas-grid"] .grid-stack-item` | `[data-testid="canvas-grid"] [data-testid="canvas-tile"]` | `orchestra-canvas.component.ts:83`; `canvas-rail-board.component.ts:162` |

The repository search found no further `.tile-header`, `Close tile`, or `.grid-stack-item` selector under `apps/ptah-electron-e2e/src` after these edits.

## Verification

Scoped `ptah_get_diagnostics` did not finish within 45 seconds and returned all four changed TypeScript files as unchecked. The optional `npx tsc -p apps/ptah-electron-e2e/tsconfig.json --noEmit` check was skipped because the scoped TypeScript diagnostics already exceeded the cheap-check time budget. No e2e, Playwright, build, serve, or Nx target was run.

## Decisions

- Used the title-bearing `strong` within `ptah-canvas-focus-header` to preserve each scene's exact or named title match. The focus header template and focus-area input show this is the current session title. Reversible: yes.
- Used the accessible button name `Close session`, which matches both its `aria-label` and `title`, instead of a presentation class. Reversible: yes.
- Included the screenshot capture's `.grid-stack-item` count in scope because it referred to the removed canvas tile structure. Its replacement is the existing tile test ID. Reversible: yes.

## Open

- TypeScript verification remains unavailable due to the 45-second scoped diagnostics timeout.

## Fix round 1

The three stale-session cleanup loops now search the complete Sessions rail, focus each matched card, and close its rendered pane. Their existing bounds remain 9, 9, and 20 iterations. Only exact scene labels are selected.

| Change | Scene file:line | Markup / behavior evidence |
| --- | --- | --- |
| Match `agent-<n>` in the rail card title, focus the card, then use the focus-header `Close session` button | `showcase/canvas-orchestra.scene.ts:120-129` | `canvas-rail-board.component.ts:109-110` passes all `orderedTiles()` to the rail; `canvas-rail.component.ts:78-80,202-210` renders the Sessions list and one card per tile; `compact-rail-card.component.ts:234-239` displays the session title; `canvas-rail-card.component.ts:309-316` focuses on card click; `canvas-rail-board.component.ts:160-168` renders focused panes; `canvas-focus-header.component.ts:270-277` supplies the close button. |
| Match `code-edit` in the rail card title, focus, close | `showcase/chat-code-edit.scene.ts:209-218` | Same rail, card, pane, and close-button markup above. |
| Match `lane-review` in the rail card title, focus, close; check the full rail after the 20-iteration bound | `showcase/lane-console-review.scene.ts:108-119` | Same rail, card, pane, and close-button markup above. |

The click targets the card's left side at `(10, 40)` in both rail layouts. `canvas-rail-card.component.ts:63-71,117-129` defines the card and collapsed button; `compact-rail-card.component.ts:115-125` makes the displayed title layer pointer transparent, so clicking its title span would not reliably focus it.

Verification: source and diff review only. The optional `tsc` check was skipped because the prior scoped diagnostics attempt exceeded 45 seconds; no e2e, Playwright, build, serve, or Nx target was run.

Open: TypeScript verification is still unavailable. The first two scenes retain their existing best-effort close handling; if the close button fails, cleanup may stop with stale cards remaining.
