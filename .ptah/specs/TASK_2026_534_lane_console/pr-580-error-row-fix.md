# Lane A — PR #580 failed-turn error row fix

Worktree: `D:\projects\ptah-extension\.claude-worktrees\feat-task-2026-534-resizable-lane-console-438e420c2e66`
Scope kept: `libs/frontend/chat-ui/src/lib/molecules/compact-session/**` only. No git operations. No new `as any`, no `@ts-ignore`, OnPush kept. `apps/ptah-electron-e2e/src/showcase/lane-console-review.scene.ts` was not touched.

## Root cause

- The compact card builds its summary with `summarizeFinalized` (`libs/frontend/chat/src/lib/components/molecules/compact-session/compact-session-card.component.ts:142-144` — read only, not modified). That call passes `terminalReason: tab.lastTerminalReason` in the context, and the summary walks each assistant message's finalized node tree.
- In `collectFinalizedNode` (`compact-session-summary.ts:244-253`), every `text` node — the assistant message — became a mark with `kind: 'prose'` and `tone: 'success'`, unconditionally. A turn that failed with a provider error ends with that error as its final assistant message, so the wire feed rendered it as `✓ PROSE` with the success tone, while the recap correctly showed FAILED.
- The recap's FAILED comes from `selectStatus` → `terminalStatus(context.terminalReason)` (`compact-session-summary.ts:451` call site, function at `:465`): an error terminal reason (e.g. `api_error`, `model_error`, or any unknown reason) yields tone `error`, which the component maps to the FAILED tag and the `✖ ERR` status badge (`compact-session-activity.component.ts:1043-1057`). `lastTerminalReason` is cleared by the tab manager when a new turn starts (`libs/frontend/chat-state/src/lib/tab-manager.service.ts:1025,1251,2581` — read only), so the reason is set exactly in the window where the recap shows FAILED. That is the structured signal; no `API Error` string match exists in the fix.

## Fix

**`compact-session-summary.ts:287` — new `markFailedTurnProse(items)`.** Re-tones the newest `prose` item (the turn's final assistant message) to `tone: 'error'` and `contentKind: 'error'`; all other items pass through unchanged. It only runs when the turn failed (below), so a normal session is untouched.

**`compact-session-summary.ts:302-310` — `buildSummary` derives the failure signal.** `terminalStatus(context.terminalReason)?.tone === 'error'` — the same function, on the same context field, that makes `selectStatus` show FAILED/Needs attention. When it holds, `buildSummary` feeds `markFailedTurnProse(items)` into everything downstream: the marks list, `selectContent`, `selectStatus` and `countAgents` all read the re-toned `semanticItems`.

Downstream effects, all from the one tone change — no component code was modified:

- Wire row: `✖` glyph, red error badge (`wireBadgeClass` gives error tone priority, `compact-session-activity.component.ts:1030`), error row accent (`:608-609`).
- ERR filter: `feedCounts` counts `tone === 'error'` marks (`:730`) and the ERR filter selects them (`:744`), so the failed turn's row is counted and shown under ERR.
- Recap content: `findNewest(items, 'error')` in `selectContent` now finds the re-toned item, so `content.kind` becomes `'error'` and the recap text renders with the error class (`compact-session-activity.component.ts:471`) — consistent with the FAILED tag it already shows.

Scope note: the mark `kind` stays `'prose'` (the badge label stays PROSE); only the tone changes, which is what the glyph, badge color, row accent and ERR count all read.

## Specs (`compact-session-summary.spec.ts`)

- `:212` — "tones the failed turn final assistant message as an error row": two turns, the second ends with an assistant message `API Error: 400 Invalid Messages request`, context `terminalReason: 'api_error'`. Asserts the `prose:error-turn` mark has tone `error`, exactly one error-toned mark exists (the ERR count), `content.kind === 'error'` with the error text, and `status.tone === 'error'`.
- `:242` — "keeps a normal final prose message on the success tone": a completed turn (`terminalReason: 'completed'`) keeps its final prose mark on tone `success`, zero error marks, `content.kind === 'prose'`.

## Verification

- `npx nx run-many -t test,lint,typecheck -p @ptah-extension/chat-ui --skip-nx-cache`:
  - **test**: passed — 34/34 suites, **286 passed, 0 failed** (was 284; +2 new specs).
  - **typecheck**: passed.
  - **lint**: failed with **1 error, 9 warnings — the known pre-existing set** (`@angular-eslint/no-output-native` at `agent-card-output.component.ts:76`, plus `max-lines` and unused-import warnings in other molecules). None of them are in files this lane touched.
- `npx prettier --write` run on both changed files.

## Files

- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-2026-534-resizable-lane-console-438e420c2e66\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-session-summary.ts`
- MODIFIED `D:\projects\ptah-extension\.claude-worktrees\feat-task-2026-534-resizable-lane-console-438e420c2e66\libs\frontend\chat-ui\src\lib\molecules\compact-session\compact-session-summary.spec.ts`
- CREATED `D:\projects\ptah-extension\.claude-worktrees\feat-task-2026-534-resizable-lane-console-438e420c2e66\.ptah\specs\TASK_2026_534_lane_console\pr-580-error-row-fix.md` (this report)

Nothing was left undone.