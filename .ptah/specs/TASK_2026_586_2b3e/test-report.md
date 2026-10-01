# Test Report - TASK_2026_586_2b3e

## Scope

- User request: prove the Thoth activity-feed fix end to end on the real backend path (live push then poll), prove the Settings trigger toggles match the deleted accordion and persist unchanged, and confirm the original bugs are pinned by regression tests. Specs only, no production changes.
- Criteria tested (all from the QA brief, context.md Acceptance, batches.md R14):
  1. Live wire == snapshot wire for the same id, newest-first, deduped, stable ids across polls (R14).
  2. The webview merges live pushes and snapshot polls without duplicates or reordering.
  3. Each of the 8 trigger controls sends the base accordion's `setTriggers` payload; the backend persists it unchanged.
  4. Regressions: oldest-end-of-window, `timestamp+kind` row key, repeated `analyze-run` per drain tick, frozen shell tiles.
- Regressions covered (new tests are marked NEW, the rest were already pinned and I verified they exist):
  - Oldest end of window / events[0] latest: NEW `live-poll` "mount refresh ... newest first" and "converge on one order"; NEW backend "returns the 50-event window ... latest at index 0". Existing: `skill-synthesis-tab.component.spec.ts` "renders the newest event first", status-card "takes the reason chip from the first (newest) event".
  - `timestamp+kind` row key: NEW `live-poll` "two same-kind events in the same millisecond ... no duplicate-key warning" (asserts no `NG0955`); NEW backend "same-millisecond same-kind events get distinct ids". Existing: `event-feed.component.spec.ts` "two same-millisecond events ... tracked by their real ids".
  - Repeated `analyze-run` per drain tick: NEW `live-poll` "one analyze-run per drain tick ... stays ONE row whose count grows" (live x2..x6, same after a poll, a new session breaks the run). Existing: `event-feed` grouping specs, tab spec "groups five repeated analyze-run events".
  - Frozen shell tiles: no new test; already pinned by `thoth-shell.component.spec.ts` "tile refresh (real ThothStatusService)" (tab switch, then workspace switch, workspace-scoped Skills count; re-click does not refetch) and `thoth-status.service.spec.ts` (overlap guard, workspace scoping).
- Review findings covered: code-logic-review.md findings were verified closed in the batch records; no open finding describing wrong behaviour remained that lacked a test.
- Deliberately not tested: a single cross-lib spec (a webview lib may not import a backend lib; enforce-module-boundaries is untouched). The two halves share the contract by construction, see Risks. Visual rendering (already covered by the batch 6 e2e visual run).

## Suites

### Activity feed on the real backend path - integration

- Requirement: live push and snapshot poll are the same wire for the same id, newest-first, ids unique/ULID/stable, window and ring cap honoured.
- Real: `SkillSynthesisService` (event ring, ULID factory, `toSkillSynthesisEventWire`), `SkillSynthesisDiagnosticsService`, `SkillsSynthesisRpcHandlers` (`skillSynthesis:diagnostics`). Stubbed: SQLite store, webview manager (captures the broadcast), in-memory workspace provider.
- Cases (6): live == `reverse(snapshot)` object for object including the folded `reason`/`candidateId` stats and a backwards timestamp; same-ms same-kind ids distinct and each decodes to that ms; ids stable across polls and later pushes only prepend; `eventLimit` returns the newest, 205 pushes cap at 200 and evicted ids vanish; 50-event window with latest at index 0; a throwing broadcast never loses the event.
- File: `D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed/libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.activity-feed.integration.spec.ts`

### Trigger toggles write path - integration

- Requirement: each control's payload persists unchanged through `skillSynthesis:setTriggers` and reads back via `getTriggers` and the diagnostics snapshot.
- Cases (15): 13 payload rows (sessionEnd, idleMs on/off/typed, bootScan, subagentStop, turnComplete, postToolUse x2, minEditCount 20, maxAnalyzes 60/0/1000) asserting the exact flat `setConfiguration('ptah', key, value)` calls and read-back; all-controls-in-turn leaves nothing clobbered; invalid bounds (idleMs 4999, minEditCount 0/21, maxAnalyzes 1001/-1) rejected with `INVALID_PARAMS` and nothing written, 5000 accepted.
- File: same backend spec file as above (second `describe`).

### Live push + poll in the webview - integration

- Requirement: real `SkillSynthesisLiveService` -> real `SkillDiagnosticsStateService` -> real `SkillActivityFeedComponent`/`SkillEventFeedComponent` merge push and poll without duplicates or reordering. The backend ring is mirrored by `FakeBackendRing` using the real `ulid` `monotonicFactory` and a newest-first snapshot.
- Cases (8): mount refresh sends `eventLimit: 50` and renders newest first with ULID row ids; live then poll holds one row per id and does not double-count the histogram; snapshot then late push of a known id adds nothing; double delivery and double poll never duplicate; live-only, snapshot-only and shuffled-live delivery converge on the same order including same-ms and backwards timestamps; repeated drain-tick `analyze-run` collapses to one growing row; same-ms same-kind events render as two rows with no `NG0955`; more than the window keeps the newest 50 on both paths.
- File: `D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed/libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/skill-activity-feed.live-poll.integration.spec.ts`

### Trigger card payload parity with the base accordion - integration

- Requirement: the card sends exactly the base accordion's payload per control, measured at `ClaudeRpcService.call` (real component, real state service, real RPC service). Oracle transcribed from `git show c4ab013f3:.../skill-diagnostics-accordion.component.ts` lines 244-305.
- Cases (17): guard that all 8 control keys are covered; 14 payload rows (including the `?? 1` and `?? false` fallbacks for postToolUse, 600000 and 60 defaults, 0 on switch-off); each write is followed by exactly one diagnostics refresh; ticking the min-edit-count checkbox sends nothing (as in the base); a rejected write shows the error and does not refresh.
- File: `D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed/libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/skill-triggers-settings.parity.spec.ts`

## Execution

- Command run: `npx nx run-many -t test lint typecheck -p rpc-handlers skill-synthesis-ui --parallel=2`, then (because the known rpc-handlers failure stops the run before the other targets) `npx nx run-many -t lint typecheck -p rpc-handlers skill-synthesis-ui --parallel=2` and `npx nx test skill-synthesis-ui`. New specs also run alone with `npx nx test <project> --testFile=<name>`.
- Result:
  - skill-synthesis-ui test: 30 suites, 491 passed, 0 failed (466 before this work; +8 live-poll, +17 parity).
  - rpc-handlers test: 115 suites, 3412 passed, 1 failed, 4 skipped. The 21 new tests pass.
  - lint and typecheck: pass for both projects.
- Failures: one, `harness-skill-selection-rpc.service.spec.ts:113` ("never writes state.json"), the known pre-existing failure that also fails on main. Not related to this task. The known skill-backlog-cleanup timeout did not occur (skill-synthesis was not run, no production file in it changed).
- Mutation checks (production changes reverted, `git status` clean of them): (a) event-feed row key changed away from `row.id`: the new `live-poll` spec emitted `NG0955` duplicate-key warnings; (b) `recentEvents` with `.reverse()` removed: 5 of the 21 new backend tests failed. Both confirm the new specs bite.
- Not executed: nothing skipped. Skill-synthesis lib tests were not re-run (no change in that lib).

## Verdict

- Result: PASS.
- Criteria proven: live wire == snapshot wire for the same id on the real service, diagnostics service and handler (R14); newest-first window and ids stable across polls; the webview merges push and poll without duplicate rows, histogram double counts or reordering (live-only, snapshot-only and shuffled delivery converge); trigger payload parity for all 8 controls at the RPC edge and unchanged persistence with read-back and bounds; the four original bugs are pinned.
- Criteria not proven: none that the brief asked for. The cross-tier link itself (the webview fixture really equals backend output) is by construction, not by one executed test.
- Defects found: none.
- Risks a reader should know about:
  1. Cross-tier contract by construction. `FakeBackendRing` in the webview spec mirrors the backend ring (monotonic ULID seeded by timestamp, newest-first snapshot). If the backend contract changes, the backend integration spec fails first, but the webview fixture must be updated by hand.
  2. Grouping is consecutive-only (recorded decision, batches.md). If a drain tick alternates sessions A, B, A, B the rows do not collapse. I did not pin this as a test; a product owner may want to confirm it fits the real 96-ticks/day pattern.
  3. Before the first diagnostics snapshot resolves the Settings card shows the state service defaults, which have no `subagentStop` or `postToolUse` (shown unchecked) while backend defaults are enabled. A toggle of `postToolUse` before the snapshot lands would send `minEditCount: 1` instead of the backend's 3. Low severity because the tab refreshes diagnostics on mount; not changed (read from code, not reproduced as a failing test).
  4. The typed `idleMs` below 5000 is sent as-is and rejected by the backend; the card shows the backend error (covered in the parity spec), identical to the base behaviour.

## Files created (no production file modified, nothing committed)

- `D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed/libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.activity-feed.integration.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed/libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/skill-activity-feed.live-poll.integration.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed/libs/frontend/skill-synthesis-ui/src/lib/components/diagnostics/skill-triggers-settings.parity.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/task-586-thoth-feed/.ptah/specs/TASK_2026_586_2b3e/test-report.md` (this file)
- Note: `.ptah/specs/TASK_2026_586_2b3e/task.md` shows as modified in git status; I did not touch it.
