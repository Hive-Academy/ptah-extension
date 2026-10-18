# Batch 4 — Sheet and migration

## Implemented

| File | Change |
| --- | --- |
| `libs/frontend/chat/src/lib/components/organisms/display-sheet/display-sheet.component.ts:15` | Added the eager peek bar, count/new badge, pin, collapse, full-height button, keyboard controls, pulse, bounded region and deferred existing display panel with summary actions. |
| `libs/frontend/chat/src/lib/components/organisms/display-sheet/display-sheet.state.ts:5` | Added per-tab peek/full preference and tab cleanup; `DisplayDockState.open` remains the single expanded flag. |
| `libs/frontend/chat/src/lib/services/display-dock/display-dock.state.ts:52,355` | Added surface publication revision for the sheet pulse without changing close suppression or selection rules. |
| `libs/frontend/chat/src/lib/components/templates/chat-session-layout.component.ts:9,15` | Added the projected sheet slot and a size container for session-relative heights. |
| `libs/frontend/chat/src/lib/components/templates/chat-view.component.html:270,318` | Inserted the sheet between transcript and composer and removed the Electron right Display rail/toggle/separator markup. |
| `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:33,234,434,1390` | Wired the sheet, cleaned up per-tab mode, and removed Electron width persistence. |
| `libs/frontend/chat/src/lib/components/organisms/execution/execution-node.component.ts:28,201` | Bound the inline block's Open in display event to current-surface selection in the owning tab. |
| `libs/frontend/chat-ui/src/lib/organisms/display-panel/display-panel.component.ts:334` | Scrolls to an externally selected current surface. |
| `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:40` | Replaced the stale dock overlay selector with the full sheet region selector; no other Canvas lines edited. |
| `scripts/eager-closure-gate.js:30` and `apps/ptah-electron/src/config/eager-closure-gate.spec.ts:131` | Allowed the eager sheet bar/state while retaining the display-panel renderer as a forbidden eager input. |
| `libs/frontend/chat/src/lib/components/organisms/display-sheet/display-sheet.component.spec.ts:1` | Added focused peek, full, pin, Escape, auto-open and suppression cases. |

## Preserve-list parity

| Existing capability | New place / status |
| --- | --- |
| Closed inline blocks and streaming identity | Batch 3 inline message text, unchanged. |
| Transcript-order latest-ID replacement, cap, invalid prior surface | Existing display feed and resolver, unchanged; sheet reads the same surface set. |
| Pending/invalid/current/superseded/evicted chip statuses and action | Batch 3 inline block/chip; execution-node binding opens current sheet surface. |
| Per-tab surfaces, statuses, view state, seen set and cleanup | `DisplayDockState`; `DisplaySheetState` additionally cleans per-tab height preference. |
| Auto-open, closed-during-turn suppression and new count | Existing `DisplayDockState.open` rule; sheet bar shows count and pulses on publication. |
| Pin selection/scroll/focus semantics | Existing state and display panel; visible sheet pin button. |
| Surface strip, unread dot, render failure and view state | Existing deferred `DisplayPanelComponent` inside sheet. |
| Turn summary, files/tests, open-file/review, inline chip | Existing summary model and chip; sheet hosts display panel's summary and action handlers. |
| Shared right-panel Agents/width and VS Code monitor | `DisplayDockState` and existing VS Code panel branch retained. |
| Inline fences across hosts | Existing Batch 3 renderer; Electron action is bound to sheet selection. |
| Electron right Display rail/toggle/width/separator/overlay | Rail markup and width persistence removed; old dock component and stale specs still need deletion/migration. |

## Verification and limits

- `chat-view.component.ts` line count: **2082 before, 2041 after**. New sheet source: **130** lines; sheet state: **25** lines.
- No tests, typecheck, lint, build, serve or e2e were run, as instructed. First scoped `ptah_get_diagnostics` found no errors in the requested source files but reported pre-existing sibling errors. A later scoped diagnostic request timed out after 45 seconds and returned unchecked.
- Nx projects to check later: `chat`, `chat-ui`, `canvas`, `ptah-electron` with `--parallel=1` and one heavy run at a time.
- **Not done:** `DisplayDockComponent` and its old dock/rail specs still reference the removed presentation; migrate those specs and delete the component before treating the migration as complete. The new sheet spec was written but not run. VS Code host regression, Canvas pane focus, eager chunk behavior, scroll-position/tab-switch geometry and rendered visual measurements remain unverified. Full-height sizing also needs measurement against a tall composer, and lazy-load retry behavior needs a rendered check.

## Decisions

- **Single open flag:** `DisplayDockState.open` controls expansion; `DisplaySheetState` stores only peek/full mode. The review N1 and existing close suppression require this. Reversible within the state facade.
- **Current-surface navigation:** The inline event opens only a surface still present in the owning tab. Batch 3 already suppresses unavailable chip actions; this avoids selecting an unrelated panel after eviction. Reversible.
- **Eager boundary:** The sheet component is eager for the bar; only `DisplayPanelComponent` is deferred. This follows the plan's light bar/deferred renderer contract. Reversible by splitting the body later.
