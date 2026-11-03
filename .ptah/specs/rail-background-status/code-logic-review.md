# Code Logic Review - rail-background-status

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7/10 |
| Assessment | APPROVED (with moderate follow-ups) |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 4 |
| Failure modes found | 4 |

Scope: full git diff vs main (18 files), plus BackgroundTaskStore, TabManagerService.updateTabInternal, lane summary wiring, persistence schema. `npm run verify -- -t test -p @ptah-extension/canvas` = pass (Nx cache hit, so it confirms the tree was already green, not a fresh run).

## Five logic questions

1. Silent failure: persisted `railSort` falls back to `recent` through `.catch` (canvas-layout-persistence.service.ts:51), so a corrupt value silently resets the user's Manual choice. Acceptable and consistent with railDensity.
2. Unexpected action: any tab mutation that is not Object.is-equal bumps `lastActivityAt` (tab-manager.service.ts:1735-1742). In Recent mode, non-conversation edits (viewMode toggle, title rename, session-id assignment) move a tile to the top of its group under the user's pointer.
3. Wrong answer input: a session in `needs` or `error` that keeps updating its tab (permission pending while stream flushes) is not pinned like `running`; it ranks by a ticking `lastActivityAt` (canvas-rail-grouping.util.ts sortRailTiles, only 'running' gets +Infinity), so it can jump within the waiting group.
4. Dependency failure: BackgroundTaskStore only holds `running` entries and deletes the session on an empty snapshot (background-task.store.ts:33-47), so a lost/never-sent "empty" snapshot leaves a session in `background` forever. Same exposure as the composer chips; not new.
5. Missing: lane/background-task output does not bump the tab's `lastActivityAt`, so "newest activity first" for `background` sessions reflects the last main-turn change, not the background work. Not specified, so noted only.

## Failure modes

### Reorder from unrelated tab edits (Moderate)
- Trigger: Recent mode; rename / view-mode toggle / any changed field via updateTabInternal.
- Symptom: tile jumps to top of its group while being interacted with.
- Evidence: tab-manager.service.ts:1735-1742; sort key at canvas-rail-board.component.ts (orderedTiles) and canvas-rail.component.ts (orderedTiles).
- Recommendation: acceptable for v1; if reported, key the sort on a dedicated "last message/turn end" timestamp or freeze order while a card menu/rename is open.

### needs/error streaming tiles not pinned (Moderate)
- Trigger: session in `needs`/`error` whose tab is still updated (status 'streaming' while permission is pending).
- Evidence: canvas-rail-grouping.util.ts sortRailTiles pins only `states === 'running'`.
- Recommendation: pin any state whose tab status is streaming, or pin needs/error as well (use a stable key such as the time the state was entered).

### Downgrade incompatibility of persisted board (Moderate)
- Trigger: user opens a build older than this change after saving with it.
- Evidence: boardSchema is `z.strictObject` (canvas-layout-persistence.service.ts:46); an older build rejects the unknown `railSort` key and v3 parse fails. Forward direction (old record, no railSort) is correct: `.catch('recent')` handles `undefined`, spec covers it.
- Recommendation: acceptable if downgrade is unsupported; confirm the v3 failure path does not overwrite the record (writable flag).

### Default flips existing users to Recent (Moderate, product)
- Trigger: boards saved before this change have no railSort, so they load as `recent` and users' manual order silently stops showing (still stored, reachable via the toggle).
- Evidence: DEFAULT_BOARD_STATE.railSort 'recent' (canvas-board-mode.ts:18) and schema catch.
- Recommendation: intentional per requirement 2 ("Recent by default"); consider defaulting legacy records (no key) to `manual` to preserve their arrangement.

## Requirement checks (verified)

- Session identity: card resolves background commands via `tab().claudeSessionId ?? null` (compact-session-card.component.ts:~579), identical to BackgroundTaskTilesContainer (background-task-tiles-container.component.ts:34-46) and the store key `event.sessionId`. Correct. Lanes use `sessionIdentity()` (claudeSessionId ?? tab.id) as before.
- Double counting: agent-type snapshot entries excluded via `isAgentTaskType`; lanes and Bash are OR-ed into a boolean, so no counting issue. Subagents (incl. background) come through laneSummary (agentsOwnedBySession + subagents with parentSessionId).
- Priority: needs > error > running (streaming/resuming only) > background > done/idle. Lane-only running no longer yields `running` (intended).
- Group placement: GROUPS order running, background, waiting, finished; `Record<CompactRailState,number>` counts updated; chips, labels, CSS for card/rail/chat-ui/inspector (state-label util) updated; TypeScript would flag a missed exhaustive Record. `railGroupFor` default maps needs/error/idle to waiting.
- Stale order: `running` ranks +Infinity so streaming ticks do not reorder; `{equal: sameTileOrder}` stops re-render when order is unchanged. Running->done transition lands at the top of its new group (activity = now). A newly started session ties with other running tiles and falls back to stored order (not top of Running).
- Keyboard/displayedIds: board `orderedTiles`, rail `orderedTiles`, `jumpTo`, and `groupRailTiles(...).displayedIds` all consume the same sorted list; rail re-sorts with the same inputs (redundant but consistent; `sort` input default 'manual' only matters if a host forgets to bind it).
- Move gating: card (menu items hidden, key handler, moveUp/moveDown guards) and board `move()` guard all refuse in Recent mode, with an announcement. Persistence: setRailSort -> updateBoard -> saved via `{...snapshot.board}` (persistence.service.ts:326).

## Test quality

- Good: grouping util (group order, counts, moves), sortRailTiles (manual, ties, unknown, running pinned), card rail-state tests (streaming vs background, local_bash, agent type ignored, needs priority, clearSession), persistence back-compat.
- Weak: board spec uses a RailStub, and its comment notes the stub re-emits a source state for the first tile, so the displayed-order assertion partly encodes stub behaviour; no integration test that the real CanvasRailComponent hides the sort toggle semantics or that `sort` input propagates to reorderable. No test for needs/error ranking while ticking (failure mode 2). No test for streaming status + running lane -> `running` in the real rail path beyond the card.

## Verdict

- Recommendation: APPROVE
- Confidence: MEDIUM-HIGH
- Top risk: tiles jumping in Recent mode from non-conversation tab edits or from streaming needs/error sessions.
- Robust additions: pin all streaming states (or a dedicated turn-end timestamp) as sort key; legacy boards without railSort default to manual; test for needs-while-streaming order stability.
