# TASK_2026_629_c0b3 — PR #730 follow-up map

Every follow-up and every "recorded, not fixed" item of PR #730, mapped to exactly one follow-up task.

Sources:
- PR = `.ptah/tmp/pr730/pr-body.md` (sections: Waived evidence, Recorded not fixed, Follow-up tasks, Test plan).
- H13 = `handoff-13.md` (§4 "Follow-ups recorded", §5 step 7).
- H12 = `handoff-12.md` §2 items 1-5.
- M3 = `mode3-r9-completion-report.md` ("Rows without a proving test", "Partly proven", Check 2-4).
- CLR = `code-logic-review-ci-fix-canvas.md`.

Notes:
- "dec. row N" = `decisions.md` row. "parity row N" = parity inventory row (Mode 3 Check 1). Decision row 116 (CLI
  permission gap) and parity row 116 (task-337 e2e) are different rows.
- M3 "Recorded, not fixed" and "Follow-up tasks" are word-for-word the same as the PR body. They add no items.
  The only M3 extras are the six "Partly proven" rows (T2-14 to T2-19).
- An item named in several sources is listed once, with every source.

## T1 — Agent tiles, lane stats header, right-sidebar tiles, Rail visual a11y (FEATURE, UI)

Process (from H12 §2.1, H13 §5.7; not counted as items): designer -> prototype -> cross-side review -> Gate 1.7
before code. The orchestrator and Claude sub-agents write the frontend; CLI lanes only review.

- [ ] T1-01 CLI-agent and sub-agent lanes become tiles with CLI provider icons in the main view — source: PR Follow-up tasks; H12 §2.1 — dec. rows 112, 114
- [ ] T1-02 Tiles show permission requests and user-question notifications — source: PR Follow-up tasks; H12 §2.1 — dec. row 116
- [ ] T1-03 Lane header uses the main stats strip (MODEL/CONTEXT/TOKENS/COST/TIME) for `cli:`, `bg:`, `sub:` lanes — source: PR Follow-up tasks; H12 §2.1 — dec. rows 112, 114
- [ ] T1-04 Agent and sub-agent tiles with CLI provider icons in the RIGHT sidebar — source: H13 §5 step 7 (user addition) — dec. row 132
- [ ] T1-05 Better sub-agent execution display — source: H13 §5 step 7 (user addition) — dec. row 132
- [ ] T1-06 Smooth staggered animation on session switch — source: H13 §5 step 7 (user addition) — dec. row 132
- [ ] T1-07 Electron single chat view has no surface for CLI-agent permission requests (dock Agents tab gone) — source: PR Recorded/User-accepted gaps; H12 §2.1 (`code-logic-review-agents-dedupe.md` F2) — dec. row 116
- [ ] T1-08 Restored sub-agents (record not in the stores) can open their lane — source: H12 §2.1 (`recheck-s12-report.md` F-E)
- [ ] T1-09 `$agents` display is not a duplicate (dedupe review Minor 7) — source: H12 §2.1
- [ ] T1-10 Fix D M2: `CanvasDetailService.open` session-ownership branches untested (mocks share one session) — source: PR Session 12; H12 §2.1 — dec. row 119
- [ ] T1-11 Fix D m1: "Its agents appear as lanes of this session." is true only in the Rail — source: PR Session 12 — dec. row 119
- [ ] T1-12 Fix D m2: `canvas-rail-card.component.ts:273`, `canvas-needs-you-queue.component.ts:238` ignore the `open` result (silent no-op on race) — source: PR Session 12 — dec. row 119
- [ ] T1-13 Fix D m3: order-dependent `[role="status"]` query in `canvas-detail-transcript.component.spec.ts:126` — source: PR Session 12 — dec. row 119
- [ ] T1-14 Fix D m4: "not available yet" wording is wrong for restored history — source: PR Session 12 — dec. row 119
- [ ] T1-15 Fix D3: dev-mode NG0956 warning on every repeated rejection — source: PR Session 12; H12 §2.1 — dec. row 125
- [ ] T1-16 Fix D3: notice layout and stacking not pinned by a spec — source: PR Session 12; H12 §2.1 — dec. row 125
- [ ] T1-17 Fix D3: spec timers depend on incidental Angular timers — source: PR Session 12; H12 §2.1 — dec. row 125
- [ ] T1-18 Fix D3: post-destroy re-arm sits in one large `it` — source: PR Session 12; H12 §2.1 — dec. row 125
- [ ] T1-19 Notice overlay covers the context chip / stats strip for 4 s (pointer-events none) — source: PR Session 12; H12 §2.1 (recheck-s12-fix) — dec. row 125
- [ ] T1-20 R9f M3: no notice for a stale tile key (partly addressed by the session-12 notice) — source: PR R9 batches/R9f
- [ ] T1-21 R9f M4: the lane omits `[isStreaming]` and `[ptahUi]` — source: PR R9 batches/R9f
- [ ] T1-22 R9f N4: any unhandled Escape inside the lane closes it — source: PR R9 batches/R9f
- [ ] T1-23 R9f residual: reverse `bg:`->`sub:` lane-key migration — source: PR R9 batches/R9f
- [ ] T1-24 R9f residual: stale opener after a mixed open path — source: PR R9 batches/R9f
- [ ] T1-25 R9f residual: a late record pulls focus to Back — source: PR R9 batches/R9f
- [ ] T1-26 R9f residual: `sub:`->`bg:` remounts the lane — source: PR R9 batches/R9f
- [ ] T1-27 Style finding: details in `subagent-tile` — source: PR R9 phase reviews/Style F6-F12
- [ ] T1-28 Two non-null assertions in `subagent-tile.component.ts:80` — source: PR R9 batches/R9c/b/o/e/n
- [ ] T1-29 Collapsed Rail has no focus mark (visual Moderate) — source: H13 §4 — dec. row 136
- [ ] T1-30 Collapsed "+" new-session button has no accessible name — source: H13 §4 — dec. row 137
- [ ] T1-31 Two Rail header chips are 17x24 px (target size) — source: H13 §4 — dec. row 137
- [ ] T1-32 Below ~400 px: hide the 44 px "Open details" button, make the 288 px details aside an overlay — source: CLR Moderate 3 (`canvas-rail-board.component.ts:180-211`); H13 §4 — dec. row 134
- [ ] T1-33 R9v: the collapsed Rail scrollbar is hidden — source: PR R9 batches/R9v
- [ ] T1-34 Escape on the only collapsed button is swallowed (`canvas-rail-keyboard.ts:31-36`) — source: PR Earlier phases
- [ ] T1-35 `focusRailSelectButton` uses `aria-hidden` as its visibility signal — source: PR Earlier phases
- [ ] T1-36 The `+N more` hit area is 16 px — source: PR Earlier phases
- [ ] T1-37 R9u N3: `aria-valuemax` is off when the host is < 400 px — source: PR R9 batches/R9u
- [ ] T1-38 Earlier M8: the lane strip reveal re-fires — source: PR Earlier phases
- [ ] T1-39 Deferred needs-you queue host renders 10x28 / 16x30 for 1-2 frames before its 53x24 footprint: board shifts 4-5 px (CLS 0.02-0.035, 2/4 reloads); give the host a fixed footprint (`orchestra-canvas.component.ts:112-121`) — source: visual-review-bundle-defer.md Moderate — dec. row 138
- [ ] T1-40 Dock queue placeholder reserves the "All clear" width only; the loaded "N need you" label is wider (`orchestra-canvas.component.ts:112`) — source: codex-review-bundle-defer.md finding 4 — dec. row 138

## T2 — R9 parity tests and evidence (TEST-ONLY)

The task-337 stale selector item is NOT here; see "Done in PR #730".

- [ ] T2-01 Parity row 8: click on `[data-compact]` reaches `toggleTabViewMode(focusedId)` — source: PR Waived evidence; M3 Rows without a proving test; H12 §2.2 — dec. row 126
- [ ] T2-02 Parity row 10 (Rail part): Rail card provides `SESSION_FORCED_CARD`, focus slot does not, no `viewMode` write — source: same — dec. row 126
- [ ] T2-03 Parity row 37: no-animation assertion in the Rail card spec — source: same — dec. row 126
- [ ] T2-04 Parity row 79: agent summary XML in the full lane (`ptah-agent-summary`) — source: same — dec. row 126
- [ ] T2-05 Parity row 80: thinking blocks in the full lane (`ptah-thinking-block`) — source: same — dec. row 126
- [ ] T2-06 Parity row 82: SDK workflow/task/monitor/scheduleWakeup cards in the full lane — source: same — dec. row 126
- [ ] T2-07 Parity row 85: tool errors in the full lane — source: same — dec. row 126
- [ ] T2-08 Parity row 91: `subagent-command-error` UI case in `inline-agent-bubble` — source: same — dec. row 126
- [ ] T2-09 Parity row 123: `CanvasStore.reorderTiles` (`canvas.store.ts:364`) reorder -> persist -> hydrate — source: same — dec. row 126
- [ ] T2-10 Copy parity rows 117-124 from `implementation-plan-rail-r9-split.md` into `parity-inventory-layout.md` — source: PR Follow-up tasks; H12 §2.2
- [ ] T2-11 Missing "before" screenshots of the display dock, dark + light (base with the Agents tab, e.g. `201175e0e`) — source: PR Waived evidence; M3 Check 3 — dec. row 126
- [ ] T2-12 Missing "before" screenshots of the split pane headers, dark + light (capture from `201175e0e`) — source: PR Waived evidence; M3 Check 3 — dec. rows 113, 126
- [ ] T2-13 Missing light "after" screenshot of the display dock — source: PR Waived evidence; M3 Check 3 — dec. row 126
- [ ] T2-14 Parity row 86 (partly proven): no tile or lane case for the `interrupted` status — source: M3 Partly proven
- [ ] T2-15 Parity row 94 (partly proven): follow and pin not asserted, only the listener — source: M3 Partly proven
- [ ] T2-16 Parity row 95 (partly proven): full-lane stats footer not rendered in a test — source: M3 Partly proven
- [ ] T2-17 Parity row 96 (partly proven): full-lane tool count proven only by the task-337 e2e — source: M3 Partly proven
- [ ] T2-18 Parity row 98 (partly proven): full-lane "Starting" and "No execution data" placeholders — source: M3 Partly proven
- [ ] T2-19 Parity row 34 (partly proven): Send to messaging not exercised — source: M3 Partly proven
- [ ] T2-20 C-headers finding 3: specs check the `pane-active` class, not the rendered bar or contrast — source: PR Session 12
- [ ] T2-21 Fix A N3: coverage gaps (stubbed Rail chain; no lane-action or stop case) — source: PR R9 phase reviews/Fix A
- [ ] T2-22 Fix B: fenced display path parser -> dock not exercised end to end in the conductor — source: PR R9 phase reviews/Fix B
- [ ] T2-23 Fix B: the conductor spec reads `__annotations__` — source: PR R9 phase reviews/Fix B
- [ ] T2-24 R9v: the `+N more` pixel fit is checked only in the visual check — source: PR R9 batches/R9v
- [ ] T2-25 R9w M4: no real A->B subtree case — source: PR R9 batches/R9w
- [ ] T2-26 R9u: the N1 test uses a stub pane — source: PR R9 batches/R9u
- [ ] T2-27 R9f: the named Rail display case feeds the dock through `PTAH_UI_DISPLAY_DOCK_SYNC` (not the real path) — source: PR R9 batches/R9f
- [ ] T2-28 R9l: dropped e2e guarantees (workspace DOM retention, Gridstack counters) — source: PR R9 batches/R9l
- [ ] T2-29 R9l: the hunk-revert overlap probe is unproven until e2e runs — source: PR R9 batches/R9l
- [ ] T2-30 R9s: the save-path assertion checks the projection — source: PR R9 batches/R9s
- [ ] T2-31 R9r: the viewMode reload case passes without a real restore — source: PR R9 batches/R9r
- [ ] T2-32 R9m: the Escape-from-lane-tab case has no exact Rail twin — source: PR R9 batches/R9m
- [ ] T2-33 R9k: vacuous selector-absence guards — source: PR R9 batches/R9k
- [ ] T2-34 R9k: re-observe and disconnect are not pinned — source: PR R9 batches/R9k
- [ ] T2-35 Keyboard activation of `.rc-select` is not tested directly — source: PR R9 batches/R9c/b/o/e/n
- [ ] T2-36 Earlier M7: one transcript and draft restore proven only on stubs plus the Electron s-heap — source: PR Earlier phases

## T3 — R9 cleanup (REFACTORING)

- [ ] T3-01 ~650 lines dead Grid projection and drag code (`canvas-layout-intent.ts`, store `commitDragIntent`, `toggleLayoutFocus`) — source: PR Follow-up tasks; H12 §2.3 — dec. row 108
- [ ] T3-02 `max-lines` on `canvas-rail-board.component.ts` — source: PR Follow-up tasks; PR R9 batches/R9x; H12 §2.3 — dec. row 108
- [ ] T3-03 `RAIL_MIN_CONTENT_WIDTH` location — source: PR Follow-up tasks; H12 §2.3 — dec. row 108
- [ ] T3-04 The cap of 4 is written twice — source: PR Follow-up tasks; H12 §2.3 — dec. row 108
- [ ] T3-05 Repeated 360/400/1440 literals — source: PR Follow-up tasks; H12 §2.3 — dec. row 108
- [ ] T3-06 Hand-rolled header menu — source: PR Follow-up tasks; H12 §2.3 — dec. row 108
- [ ] T3-07 Canvas lint warnings (31 at PR time; includes +3 C-headers spec warnings and +12 R9x) — source: PR Test plan, Session 12 Lint, R9x; H12 §2.3
- [ ] T3-08 Phase style findings F1-F5 (H12 names F1-F12; the PR body itemises only F6-F12) — source: H12 §2.3
- [ ] T3-09 Style: `distinctRetainedCount` has no consumer — source: PR R9 phase reviews/Style F6-F12
- [ ] T3-10 Style: ignored output payloads — source: PR R9 phase reviews/Style F6-F12
- [ ] T3-11 Style: `chat-transcript.component.ts` is 1231 lines — source: PR R9 phase reviews/Style F6-F12
- [ ] T3-12 Style: glyph controls instead of lucide icons — source: PR R9 phase reviews/Style F6-F12
- [ ] T3-13 Style: the retention service and coordinator are coupled — source: PR R9 phase reviews/Style F6-F12
- [ ] T3-14 Style: canvas token names live in the `chat` lib — source: PR R9 phase reviews/Style F6-F12
- [ ] T3-15 Logic F4: `close()` acts after `await removeTile` without re-checking the active workspace — source: PR R9 phase reviews
- [ ] T3-16 Logic F5: focus-repair effect can call `switchTab` with a null store focus above the hydrate bound — source: PR R9 phase reviews
- [ ] T3-17 Logic F6: `focus-area.stop()` relies on `focusin` running before `click` — source: PR R9 phase reviews
- [ ] T3-18 Logic F7: `assertDistinct` throws after the state was mutated (dev) — source: PR R9 phase reviews
- [ ] T3-19 Logic F8: stale Grid references in `app-shell.component.ts:118`, `lazy-view-components.token.ts:38`, `sessions.shot.ts:68` — source: PR R9 phase reviews
- [ ] T3-20 Fix A N1: a silent guard — source: PR R9 phase reviews/Fix A
- [ ] T3-21 Fix A N2: transient third-tab window (cosmetic) — source: PR R9 phase reviews/Fix A
- [ ] T3-22 R9v: `native-dropdown` emits `opened` after a cancelled position (pre-existing, ui lib) — source: PR R9 batches/R9v
- [ ] T3-23 R9v: the unpositioned popover fallback can clip at a viewport edge — source: PR R9 batches/R9v
- [ ] T3-24 R9v: NG0953 dev warning — source: PR R9 batches/R9v
- [ ] T3-25 R9w Minors 1 and 3-6 — source: PR R9 batches/R9w
- [ ] T3-26 R9w NEW-5 and NEW-7 — source: PR R9 batches/R9w
- [ ] T3-27 R9w M1: repeated write failure needs a persistence-service counter (`writeFailed` stays true) — source: PR R9 batches/R9w; M3 Check 2
- [ ] T3-28 R9w correction findings C4 and C5 — source: PR R9 batches/R9w
- [ ] T3-29 R9u: unregistered host without SESSION_CONTEXT — source: PR R9 batches/R9u
- [ ] T3-30 R9u: soft cap above two hosts — source: PR R9 batches/R9u
- [ ] T3-31 R9u: no dev assert for the same tab in both panes — source: PR R9 batches/R9u
- [ ] T3-32 R9u N4: stored vs visible dock width after End — source: PR R9 batches/R9u
- [ ] T3-33 R9u: `releaseHost` rewrites the registry for an unregistered host — source: PR R9 batches/R9u
- [ ] T3-34 R9f m1-m4 — source: PR R9 batches/R9f
- [ ] T3-35 R9l: stale `canvas-tile` locators in 6 e2e and perf support files (re-check after `82b923929`) — source: PR R9 batches/R9l
- [ ] T3-36 R9l: dead `detailTabId`/`laneKey`/`selectLane`/`close` in `canvas-detail.service.ts` — source: PR R9 batches/R9l
- [ ] T3-37 R9l Minors 5-6 — source: PR R9 batches/R9l
- [ ] T3-38 R9t Minors 3-5 — source: PR R9 batches/R9t
- [ ] T3-39 R9s: no defensive omit — source: PR R9 batches/R9s
- [ ] T3-40 R9s: an unknown `viewMode` passes through — source: PR R9 batches/R9s
- [ ] T3-41 R9m: mcp-bench fixtures name deleted files — source: PR R9 batches/R9m
- [ ] T3-42 R9k: the observer gates on width only — source: PR R9 batches/R9k
- [ ] T3-43 R9h m1: SESSION_CONTEXT strictness reaches the conductor and the detail transcript — source: PR R9 batches/R9h
- [ ] T3-44 R9h m2: `dispose` of a never-retained id — source: PR R9 batches/R9h
- [ ] T3-45 R9h m3: per-instance panel state survives a context switch — source: PR R9 batches/R9h
- [ ] T3-46 Duplicated "board is full" text — source: PR R9 batches/R9c/b/o/e/n
- [ ] T3-47 Duplicated owner rule — source: PR R9 batches/R9c/b/o/e/n
- [ ] T3-48 R9n Minors — source: PR R9 batches/R9c/b/o/e/n
- [ ] T3-49 Showcase locators/scenes still use Grid selectors (`apps/ptah-electron-e2e/src/showcase/*.scene.ts`) — source: PR R9 batches/R9c/b/o/e/n; H13 §4
- [ ] T3-50 `tile-open-longtask-budget.perf.spec.ts` assumes 3 mounted sessions (selector-only fix + NOTE) — source: H13 §4
- [ ] T3-51 No scroll re-anchor on the 640 px auto-collapse; one-frame 272 px Rail flash — source: CLR Minor 4 (`canvas-rail-board.component.ts:289-295,411-415`); H13 §4 — dec. row 134
- [ ] T3-52 Keyboard guard is horizontal-only; non-input arrow widgets in a pane lose to board navigation — source: CLR Minor 6 (`canvas-rail-keyboard.ts:64-80`); H13 §4 — dec. rows 129, 134
- [ ] T3-53 Earlier M2: scroll restore happens once per instance — source: PR Earlier phases
- [ ] T3-54 Earlier M3: hold latch on a collapsed caret — source: PR Earlier phases
- [ ] T3-55 Earlier M4: overflow-menu Escape works only inside the menu (pair with T3-06) — source: PR Earlier phases
- [ ] T3-56 Earlier m1-m7 and style Moderates 2-5 — source: PR Earlier phases (handoff-6 §6)

### T3 (misc) — fits no bucket

- [ ] T3m-01 CLR Minor 7: `canvas-rail-board.component.ts` line numbers moved during the review; re-verify CLR line refs before acting on T1-32/T3-51 — source: CLR Minor 7; H13 §4 — why misc: a review-process note, not a code defect
- [ ] T3m-02 TASK_2026_653_2931 (sidebar strip, Details resizer, cursor audit) — source: PR Follow-up tasks; H12 §2 — why misc: it is already its own task; reference only, do not merge into T3
- [ ] T3m-03 Remove or ignore `D:\projects\ptah-s13-empty-ws` (empty folder the visual reviewer created; the app lists it) — source: H13 §4 side effect — why misc: Step 0 housekeeping, not code

## T4 — Rail state colours across all shipped themes

- [ ] T4-01 Focused Rail card frame < 3:1 in 13/32 DaisyUI themes (`codex-review-fix-c2.md`) — source: PR Recorded/User-accepted gaps; PR Follow-up tasks; H12 §2.4; M3 Check 3 — dec. row 124
- [ ] T4-02 State pill text < 4.5:1 in 23/32 themes — source: same — dec. row 124
- [ ] T4-03 Split-header state chip (`canvas-focus-header.component.ts:12-16`) — source: PR Recorded/User-accepted gaps; H12 §2.4 — dec. row 123
- [ ] T4-04 Rail items `canvas-rail.component.ts:51-63` — source: PR Recorded/User-accepted gaps; H12 §2.4 — dec. row 123
- [ ] T4-05 Earlier M5: small state-ink text < 4.5:1 in the non-anubis themes — source: PR Earlier phases

## T5 — Rail switch long tasks and render performance

- [ ] T5-01 8/10 Rail swaps still have a long task > 50 ms (baseline 10/10; median 107 -> 35 ms; `switch-baseline.md`) — source: PR Recorded/User-accepted gaps; PR Follow-up tasks; H12 §2.5; M3 Check 3 — dec. row 121
- [ ] T5-02 10 of 13 render metrics have no production writer — source: PR R9 batches/R9c/b/o/e/n
- [ ] T5-03 R9h M3: non-retaining tiles are not tree-cache owners (CPU only) — source: PR R9 batches/R9h

## T6 — Chat draft loss and chat-lib residuals (BUGFIX)

- [ ] T6-01 Failures before any optimistic bubble (validation, service readiness) lose the only draft copy (`message-sender.service.ts:321-330,375-388`) — source: H13 §4 — dec. row 133
- [ ] T6-02 +2 dead imports in chat specs (C-dedupe) — source: PR Session 12 Lint
- [ ] T6-03 8 pre-existing NG0101 errors in `chat-view.keepalive.spec.ts` — source: PR R9 batches/R9u
- [ ] T6-04 R9f M6: a workspace switch resets the ChatView dock state — source: PR R9 batches/R9f
- [ ] T6-05 Shared disclosure key for identical no-file turns — source: PR R9 batches/R9c/b/o/e/n

## Done in PR #730

- [x] D-01 Stale task-337 selectors (`task-337-agent-card-refresh.spec.ts:57-58`; parity row 116): now `Focused session: <title>` and `ptah-subagent-tile` (`82b923929`); removed from T2 — source: PR Waived evidence; M3 row 116; H12 §2.2; H13 §4 — dec. row 126. The `:186` lane-open wait is still being fixed in this PR (H13 §5.2).
- [x] D-02 Electron e2e (`canvas.spec.ts`, `task-337-agent-card-refresh.spec.ts`) "not run in this branch": CI electron-e2e now runs them; `canvas.spec.ts:156` Swap fix is in progress in this PR (H13 §3, §5.2) — source: PR Test plan (unchecked item)

For reference, not counted: CLR findings 1, 2 and 5 were fixed in this PR (`fix-rail-toggle-report.md`).

## Count check

Total items found in the sources (after splitting combined sub-lists and merging cross-source duplicates) = 148;
total mapped = 148 (T1 38 + T2 36 + T3 56 + T3 misc 3 + T4 5 + T5 3 + T6 5 + Done 2).
Added after the CI round-2 fix (dec. row 138): T1-39, T1-40 -> 150 items.
