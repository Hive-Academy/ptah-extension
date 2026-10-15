# Code Style Review, R9 phase (new public API) - `TASK_2026_629_c0b3`

Scope: the new public surfaces of R9 (`5a86ca72b..HEAD`) and their barrel exports. Read-only. No tests, typecheck or lint were run. `ptah_get_diagnostics` on the coordinator and `subagent-tile` returned no diagnostics in those files. The 262 errors it reported are in unrelated sibling spec files.

## Summary

| Metric | Value |
| --- | --- |
| Score | 7/10 |
| Verdict | APPROVE-WITH-FIXES |
| Moderate+ (fix in the one round) | 5 (F1-F5) |
| Minor (record) | 7 (F6-F12) |
| Blocking | 0 |

The surfaces follow the Angular conventions of their siblings:
- All components are standalone and OnPush, and use `inject()`, `input()`/`output()` and signals.
- Imports go through `@ptah-extension/<lib>` barrels.
- The new code has no `console`, `as any`, `@ts-ignore` or `@ts-expect-error`. The only new `eslint-disable` is in two spec files.
- `import type` is used for types (the coordinator's cycle-sensitive import of `TranscriptRetentionService`, the header's `OutputEmitterRef`).
- All new public methods have explicit return types.

The cost sits in four places:
- Three Rail tokens and constants are scattered, and the cap value is duplicated.
- The Rail layout vocabulary (pane side, width band, 360/400/1440) is copy-pasted as literals.
- The header overflow menu is hand-rolled while the card next to it uses `NativePopover`.
- `canvas-rail-board.component.ts` crossed the `max-lines` tripwire inside this phase.

### Lib boundary check

`chat`, `chat-ui`, `canvas` and `chat-streaming` are all `scope:webview, type:feature` (`project.json` tags), so the tag lattice does not constrain any edge here.

| Edge | Result |
| --- | --- |
| `canvas -> chat`, `chat -> chat-ui`, `chat -> chat-streaming` | Acyclic, barrel-only. |
| `chat-ui` importing `chat` | None (grep of `libs/frontend/chat-ui/src`: 0 hits). |
| `canvas/src/index.ts` drops `CanvasTileComponent`, `CanvasEmptyStateComponent`, `TileAgent*` and the `CanvasLayout` type | No remaining consumer in `apps` or `libs`. |

Correction to the brief: `subagent-tile` is not in chat-ui. It is `libs/frontend/chat/src/lib/components/organisms/execution/subagent-tile.component.ts`, internal to chat, and not on the chat barrel (the right call). The only chat-ui barrel change is the added `formatAgentElapsed` export (`chat-ui/src/index.ts:39`). That function already existed at `background-agent-strip.component.ts:96`. Re-exporting an existing pure helper through the barrel is fine.

## Findings

### Moderate (fix in the one round)

**F1. `canvas-rail-board.component.ts` crossed `max-lines` in this phase; split the two pure-DOM seams now and record the rest.**
- The file went from 381 lines at the phase base to 815 physical lines. Mode 2 counted 741 against the 700 ceiling (`eslint.config.mjs:556`, skip blanks and comments), so about 41 counted lines over (`mode2-h7-report.md:106`).
- The ceiling is deliberately a tripwire ("new growth gets a visible nudge", `eslint.config.mjs:518-531`). This is new growth, not one of the grandfathered 137 files.
- Two seams are pure DOM code that need no signals or store, so the move is behaviour-neutral:
  - `TABBABLE`, `PANE_OVERLAYS`, `isTabbable()` (`canvas-rail-board.component.ts:30-47`) and the body of `onTabKey` (about 28 lines): move into the existing `canvas-rail-keyboard.ts`. That file already holds `handleCanvasRailKeydown` and `railMoveKey`. Export `visualTabTarget(event, host, visualOrder): HTMLElement | null`, leaving a 3-line `onTabKey` in the board. It already has pure-ish test surface (R9x B3 cases).
  - The selection/pointer "hold" effect (constructor, about 38 lines, `holdTabId`): move into a `trackRailHold(host, onHold)` function in a new `canvas-rail-hold.ts`. It returns a disposer for `onCleanup`.
- Together that is about 80 counted lines, so the file lands around 660 and the warning clears.
- Do not split the split-pane state machine (`otherTabId`, `activeSide`, `visualOrder`, `paneTab`, `openBeside`, `closePane`, `swapPanes`, `collapseSplit`, the focus-repair effect, `lastFocusedId`). It is tightly coupled to `visible()`, `surfaceActive()` and the store effects. R9w/R9x just reached a stable contract (decisions 104-107), and moving it now is a regression risk with no spec round left. Record it as a named later task: "extract `CanvasRailSplitState` (pane model plus focus repair) from `CanvasRailBoardComponent`", owner R11/PR follow-up, trigger: the next split feature.

**F2. `RAIL_MIN_CONTENT_WIDTH` is declared in a 1947-line component file; its sibling Rail token lives in `tokens/`.**
- Evidence:
  - `chat-view.component.ts:104-106` declares the token, next to `shouldOverlayDock`.
  - `chat/src/index.ts:46` exports it from the component file.
  - Its sibling `RAIL_TRANSCRIPT_RETENTION`, and every other `SESSION_*` and `HIDE_AGENT_SIDEBAR` token, is declared in `tokens/session-context.token.ts` (`:72`).
- Cost: a consumer of the token transitively resolves the largest component in the lib, and the retention service cannot depend on a token that sits in a component. The token also has no unit in its doc comment (`Minimum transcript/composer width requested by a Rail pane`). It is a `Signal<number | null>` in px, and the canvas side hard-codes 360 (F4).
- Fix:
  - Move the token to `tokens/session-context.token.ts` with the doc "in CSS px; null means no minimum".
  - Re-point `chat-view.component.ts` and `chat/src/index.ts:46` to it.
  - Group the two Rail exports together with the other token exports (currently appended after a blank line at `index.ts:44-47`, away from `SESSION_*` at `:38-42`).
  - Keep `shouldOverlayDock` where it is, since it is component logic.

**F3. The Rail cap of 4 exists twice, in two files.**
- Evidence:
  - `rail-transcript-retention-coordinator.service.ts:68` has the literal `while (this.owners.size > 4)`.
  - `transcript-retention.service.ts` has a private `RAIL_RETAINED_TRANSCRIPT_CAP = 4`, used only on the non-coordinated path.
  - The original comment "Single constant so profiling can dial it down without touching the eviction logic" was deleted in the same diff.
- Cost: dialling one value without the other leaves a silent split cap. The batch contract is "one shared cap of four per Rail board".
- Fix:
  - `export const RAIL_RETAINED_TRANSCRIPT_CAP` from `transcript-retention.service.ts`. Both files may import it, since the coordinator's import of that file is already type-only.
  - Alternatively, declare it in the coordinator file and import it into the service. The service already imports the coordinator class as a value, so no new edge appears.
  - Use the constant at `:68`.
  - Restore the one-line "single constant" comment on it.

**F4. Rail layout vocabulary is pasted as literals across five files.**
- Evidence:
  - Min pane width 360 appears in three places:
    - `canvas-rail-board.component.ts:142` (`min-w-[360px]`, and `:160` `w-[min(360px,100%)]`)
    - `canvas-detail-transcript.component.ts:54` (`splitDisplayed() ? 360 : null`)
    - The Details aside (`:205`)
  - The stack breakpoint 1440 is at `canvas-rail-board.component.ts:~211` (`splitStacked`), and the pane min height 400 is at `:142`.
  - `'left' | 'right'` appears 14 times in non-spec canvas code: the board, focus-area inputs and outputs (`paneId`, `closePaneRequested`, ...), and `opposite()`.
  - `'xl' | 'lg' | 'md' | 'sm'` is re-declared in `canvas-focus-header.component.ts`, `canvas-focus-area.component.ts`, `canvas-rail.component.ts` and `canvas-board-mode.ts:18` (the return type of `railWidthBand`).
- The risky one is 360. The CSS minimum (board template) and the token value fed to `ChatView` (`canvas-detail-transcript`) must agree, or the dock overlay maths in `shouldOverlayDock` disagrees with the layout. Today that agreement exists only by coincidence.
- Fix, in `canvas-board-mode.ts`, which already hosts `railWidthBand`:
  - `export type RailWidthBand = ReturnType<typeof railWidthBand>`
  - `export type RailPaneSide = 'left' | 'right'`
  - `export const RAIL_SPLIT_PANE_MIN_WIDTH = 360`, `RAIL_SPLIT_PANE_MIN_HEIGHT = 400`, `RAIL_SPLIT_STACK_BREAKPOINT = 1440`
  - Use the constants in the TS (`canvas-detail-transcript`, `splitStacked`). For Tailwind arbitrary classes, bind via `[style.min-width.px]` instead of `min-w-[360px]`, so the number exists once.

**F5. The focus-header overflow menu is hand-rolled; the card two files over uses `NativePopover`.**
- Evidence:
  - `canvas-rail-card.component.ts:25,43,152-228` uses `ptah-native-popover` with a backdrop, `(closed)`, and `onMenuKeydown`. R9v spent decision 102/103 hardening that component.
  - `canvas-focus-header.component.ts` builds its menu from a positioned div (`absolute right-10 top-10 z-20`, `role="menu"`).
  - To make Escape work it needs a bespoke `escape()`, `choose()` and `focusTrigger()`. This is the R9x Serious from decision 107.
  - The div menu has no outside-click close, no arrow-key roving for `role="menu"`, and no collision handling.
- Cost: two implementations of one idiom in one directory. The next menu fix lands on one of them only. The Escape and focus-return code in the header is exactly what the shared component already owns.
- Fix: render the header menu through `ptah-native-popover` with the same trigger/content slots and `onMenuKeydown` helper (extract that helper into `canvas-rail-keyboard.ts` if the card's version is private). Keep `choose()` for "return focus before the emit". Delete the bespoke `escape()` and absolute-positioned panel. If the lane would rather not touch the header again after three R9x rounds, the minimum acceptable fix is to record this as a named follow-up. I rate it Moderate because the divergence is already paid for once, in decision 107.

### Minor (record, do not fix in this round)

**F6. `RailTranscriptRetentionCoordinator.distinctRetainedCount` has no production consumer.**
- Only specs read it (`rail-transcript-retention-coordinator.service.ts:12`). It is a public signal on an exported class, and the board's `data-canvas-live-views` is a DOM count, not this.
- Either wire it to a board attribute (the s-heap criteria want "distinct retained / 4") or delete `count` and the property.

**F7. Header and focus-area outputs emit a payload the board ignores.**
- `closeSplitRequested` and `swapPanesRequested` are `output<'left' | 'right'>()` (`canvas-focus-area.component.ts`, the `paneId()` emits).
- The board binds them to `closeSplit()` and `swapPanes()`, which take no argument. Only `closePaneRequested` and `detailsRequested` use the side.
- Make the two `output<void>()` to avoid a misleading contract.
- Also, the "split unavailable" copy is split between the board (`splitDisabledReason`, "Open another session first to split") and the rail (`SPLIT_ALREADY_FOCUSED_REASON`, `canvas-rail.component.ts`). That is acceptable for now, but note it as one policy in two files.

**F8. `chat-transcript.component.ts` grew from 1021 to 1231 lines.**
- It already exceeded the ceiling before R9. The new sub-agent open/close controller adds `openSubagentId`, `subagentReturn`, `subagentOwner`, `_frozenOpenSubagent`, `subagentNotice` and the `closeSubagent`/`openSubagentLane` methods (about 150 lines).
- It also adds a public `singleChatCardActions()` that exists only for the self-referencing provider factory (`inject(ChatTranscriptComponent)` inside its own `providers`).
- That is a cohesive responsibility ("open one agent in place, keep scroll/focus/owner") and extractable as a small controller class provided at the transcript.
- Record as a named later task. Do not extract now; there is no spec round left and the R9n review closed.

**F9. `subagent-tile.component.ts` details.**
- The status-to-label map duplicates the background-agent strip (`'In background'` exists in both `subagent-tile.component.ts` and `chat-ui/.../background-agent-strip.component.ts`). The tile already imports `formatAgentElapsed` from that strip, so a shared `agentStatusLabel` would be the same dependency.
- `node().endTime! - node().startTime!` uses non-null assertions inside a single 170-character computed. A local `const { startTime, endTime } = node()` would remove both.
- `status` has no declared return type, so `statusLabel`'s object-literal lookup depends on inference. A named union would make it explicit.
- It is OnPush and uses `inject(..., { optional: true })` consistently, which matches the monitor/actions pattern of its siblings.

**F10. The header (`canvas-focus-header.component.ts`) uses glyph characters for controls (`■ ▣ ⋯ ⓘ ×`) while `subagent-tile` and `single-chat-subagent-view` use `lucide-angular`.**
- The rail card also uses a glyph (`⋮`), so this may be an intended local convention. Check with the design owner.
- `narrow = () => ...` is a plain arrow, not a `computed`, which is inconsistent with the signal-based inputs around it.
- `ngDoCheck` for focus rescue after Stop disappears runs on every check pass; an `effect` on `running()` would be the idiomatic form.

**F11. `TranscriptRetentionService` and the coordinator are mutually coupled through public methods.**
- `retainFromCoordinator`, `releaseFromCoordinator` and `releaseForTransfer` are public on the service, though it is not barrel-exported.
- The coordinator's `owners` (tab to host) collides in name with the service's `static owners` (a `WeakMap` of tree-builder to refcounts).
- Both are internal. When the coordinator is next touched, give the service one interface (`RetentionHost`) and rename the static to `treeCacheRefs`.
- Related wiring note: `canvas-detail-transcript.component.ts:70` provides the coordinator conditionally. A host without it silently falls back to one cap of 4 per host. A dev-mode assert when `RAIL_TRANSCRIPT_RETENTION` is true and the coordinator is absent would catch a mis-wired host.

**F12. The token names `RAIL_TRANSCRIPT_RETENTION` and `RAIL_MIN_CONTENT_WIDTH` bake a canvas concept into the `chat` lib.**
- Sibling tokens are capability-named (`SESSION_CONTEXT`, `HIDE_AGENT_SIDEBAR`). I would not rename now; the decisions already adopted the Rail vocabulary. This is a note only.

## Pattern compliance

| Rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| Standalone, OnPush, `inject()`, signals, `input()`/`output()` | PASS | `subagent-tile.component.ts:9-17,45-49`; `single-chat-subagent-view.component.ts:29-33,90-100`; canvas-rail components |
| Imports via `@ptah-extension/<lib>` barrels | PASS | `canvas-detail-transcript.component.ts:15-29`; `canvas-rail-board.component.ts:16-18`; chat-ui barrel adds `formatAgentElapsed` only |
| `import type` for types | PASS | coordinator `:2`; header `:1`; `subagent-tile` `:3` |
| Presentational lib never imports orchestrator lib | PASS (not enforced by tags) | `chat-ui` imports nothing from `chat`; all four libs are `type:feature` |
| Explicit return types on public API | PASS | coordinator methods; `SingleChatSubagentViewComponent.onEscape`; `singleChatCardActions` |
| No new `as any`, `@ts-ignore`, `console` in production code | PASS | grep of the added lines in canvas-rail, chat and chat-ui: only spec-file `eslint-disable` hits. The one `console.error` in `canvas-focus-area.component.ts` is pre-existing. |
| Tokens declared in `tokens/` | FAIL | `RAIL_MIN_CONTENT_WIDTH` at `chat-view.component.ts:104` (F2) |
| Single source for shared constants | FAIL | cap 4 (F3); 360/400/1440 and `'left'\|'right'` (F4) |
| One idiom per menu in a directory | FAIL | header menu vs card `NativePopover` (F5) |
| `max-lines` 700 tripwire on production `.ts` | FAIL (warn) | `canvas-rail-board.component.ts` at 741 counted (F1). `chat-transcript` and `chat-view` were already over before R9. |
| New public surface has no unused members | FAIL (minor) | `distinctRetainedCount` (F6); unused output payloads (F7) |
| Kebab-case files and role suffixes | PASS | `*.component.ts`, `*.service.ts`, `*.token.ts` |

## Maintenance debt

- Introduced:
  - Three scattered Rail tokens and constants.
  - A duplicated cap value.
  - A pane-geometry contract kept in sync by coincidence (360).
  - Two menu implementations in one directory.
  - About 440 lines in a board file that is now over the lint tripwire.
  - About 210 lines in an already oversized transcript component.
- Retired: the Grid canvas barrel surface (`CanvasTile`, `CanvasEmptyState`, `TileAgent*`), with no remaining consumers. The explicit-prop `agentTileMode` chain is now the only tile-mode switch.
- Net: roughly neutral on public surface, negative on file size in `canvas-rail-board` and `chat-transcript`. F1-F5 reverse the avoidable part in one round.

## Verdict

- Recommendation: APPROVE-WITH-FIXES (7/10). No boundary or type-safety break. The structure is in line with sibling code except for the five items above.
- Confidence: HIGH on F2, F3, F4 and F6/F7 (single-file evidence). MEDIUM on F1's line counts (taken from Mode 2's 741 figure, not re-run). MEDIUM on F5's severity, because it depends on how much of the card's keydown helper is already shared.
- Key concern: shared Rail constants and tokens have no single home (F2-F4), and the board crossed the lint tripwire with cleanly separable code (F1).
- What a 10/10 version would do differently:
  - Define every Rail token in `tokens/`, with the cap and geometry constants declared once.
  - Give the board a `RailPaneSide`/`RailWidthBand` vocabulary and move the Tab-order and hold-tracking code into the keyboard helpers.
  - Share one popover-based menu between card and header.
  - Keep the sub-agent open/close state in its own controller class instead of a 1231-line transcript.
  - Ship no public member without a consumer.
