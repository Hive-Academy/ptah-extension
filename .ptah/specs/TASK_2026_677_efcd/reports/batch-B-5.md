# Batch B-5 report

## Files

- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts` — modified: hosts deferred inspector in split, narrow and wide asides and a compact sheet; binds focused-tab stats and lane navigation.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts` — modified: replaces details stub with inspector stub and updates deferred keyboard test and service fixtures.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.ts` — modified: exposes the details trigger below 400 px while retaining the workflow badge.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-session-details.component.ts` — deleted after parity review.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-session-details.component.spec.ts` — deleted with the replaced component.
- `.ptah/specs/TASK_2026_677_efcd/reports/batch-B-5.md` — created: batch evidence and decisions.

## Parity D-1..D-11

| Row | Capability | Where it lives now (file:line) |
| --- | --- | --- |
| D-1 | Session landmark and heading | `chat/src/lib/components/organisms/session-inspector/session-inspector.component.html:9,13` |
| D-2 | Context percentage, accessible progress, unknown state | `chat-ui/src/lib/molecules/session/inspector-stats/inspector-session-stats.component.ts:42-54` |
| D-3 | Tokens and unknown value | `chat-ui/src/lib/molecules/session/inspector-stats/inspector-session-stats.component.ts:63-69` |
| D-4 | Cost and unknown value | `chat-ui/src/lib/molecules/session/inspector-stats/inspector-session-stats.component.ts:72` |
| D-5 | Turns | `chat/src/lib/components/organisms/session-inspector/session-inspector.component.html:42` (SESSION stats tile) |
| D-6 | Todo count, active item, per-item content | `chat/src/lib/components/organisms/session-inspector/inspector-todos-section.component.ts:88,120,149-153` |
| D-7 | Branch and full-name hint | `chat/src/lib/components/organisms/session-inspector/inspector-git-section.component.ts:59`; `canvas/src/lib/canvas-rail/canvas-focus-header.component.ts:108` (title) |
| D-8 | Additions, deletions and partial marker | `chat/src/lib/components/organisms/session-inspector/inspector-git-section.component.ts:62-65` |
| D-9 | Git tracking per root and tab | `chat/src/lib/components/organisms/session-inspector/inspector-git-section.component.ts:125-148` |
| D-10 | Deferred body and placeholder | `canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:178-183,196-207,232-235,243-248` |
| D-11 | Rail aside and compact sheet | `canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:190-245`; header trigger `canvas/src/lib/canvas-rail/canvas-focus-header.component.ts:167` |

## Acceptance

- The board uses public chat imports and provides `InspectorShellController` and `StatsTileExpansionState`: `canvas-rail-board.component.ts:16,64`.
- The inspector receives the focused tab, session ID, budget and availability through `injectSessionStatsSource`: `canvas-rail-board.component.ts:316-325`; `[stats]`, lane navigation and deferred loading are at `:178-179,196-204,232-233,243-244`.
- Below 400 px, the pane and rail become inert behind the sheet, with Escape, Tab wrap and header focus return: `canvas-rail-board.component.ts:78,150,240-248,683-706`.
- The workflow badge remains at `canvas-focus-header.component.ts:104`; the compact details gate is at `:167,264`.
- `rg` found no `canvas-session-details` or `CanvasSessionDetailsComponent` reference in `libs/frontend/canvas/src`.
- Canvas typecheck, lint and all 370 tests pass. Lint reports 29 warnings and zero errors.

## Spec changes

- `canvas-rail-board.component.spec.ts:171-184` replaces the deleted selector with an inspector stub. `:1564` waits for the deferred inspector before checking overlay keyboard behavior. Service fixtures supply the stats source dependencies.
- The focus-header spec did not assert the compact-width gate; no change was needed there.

## Checks

| Command | Exit | Result |
| --- | ---: | --- |
| `node .ptah/tmp/check-run.mjs b5-typecheck -- npx nx typecheck @ptah-extension/canvas --parallel=1 --skip-nx-cache` | 0 | Passed. |
| `node .ptah/tmp/check-run.mjs b5-lint -- npx nx lint @ptah-extension/canvas --parallel=1 --skip-nx-cache` | 0 | Passed; 29 warnings, zero errors. |
| `node .ptah/tmp/check-run.mjs b5-test -- npx nx test @ptah-extension/canvas --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` | 0 | 370/370 tests passed. First two runs failed on fixture dependencies and a deferred-button assertion; both were fixed before the passing run. |
| `ptah_get_diagnostics` (three changed source/spec files) | — | No diagnostics in requested files; seven existing sibling diagnostics reported. |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use the existing inspector in every rail position and a full-width sheet below 400 px | New rail inspector / existing shared inspector | B §8 and D-1..D-11; public exports in `chat/src/index.ts` and `chat/src/lib/components/index.ts` | Yes |
| Keep the existing board open state and focus logic for the 400 px threshold while providing `InspectorShellController` to the inspector | Controller's 960/640 px bands / board's specified 400 px band | `inspector-shell.controller.ts:105-142`; B §8 | Yes |
| Leave `answerRequested` as the plan's accepted degradation for Rail | Forward to a focused chat-view API / row error and counted request | B §4 O9 says forwarding only if the canvas detail API supports it; `canvas-detail.service.ts` exposes lane selection, not question focus | Yes |
| Hide the inspector close control in the always-visible wide aside | Show an inoperative close control / hide it | Existing wide aside has no close/reopen state; `canvas-rail-board.component.ts:224-233` | Yes |

## Proposed Removals

None. All D-1..D-11 capabilities have a current inspector or rail host location.

## Clarifications Needed

- **D-O6 design call:** Yes, the narrow aside and compact sheet can be closed while a plan limit is near or at its threshold (`canvas-rail-board.component.ts:204,244,683-687`). The closed Rail view has no agreed persistent limit cue. Options: (Recommended) specify a cue in design review; keep the current behavior until then. No cue was invented in this batch.