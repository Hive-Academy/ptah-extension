# Batches - TASK_2026_453_1eb4

Total tasks: 32 | Batches: 18 (13 code, 5 measurement; Batches 16-17 conditional; Task 13.2 conditional) | Complete: 10/18

Worktree (every path below is inside it; never touch `D:\projects\ptah-extension` root files or
`D:\projects\ptah-437`): `W = D:\projects\ptah-extension\.claude-worktrees\task-453-tile-open-long-tasks`
Branch `perf/task-453-tile-open-long-tasks`, base `51d0d2e1f` (origin/main with PR #518 and PR #519).

## Plan validation

Status: PASSED WITH RISKS

Gate 2 approved by the user 2026-09-16. P1 (PR #518) and P2 (PR #519, fix commit `30600120b`)
are done. P3 (re-citation) is done below. No design assumption was invalidated.

### P3 citation check (against `51d0d2e1f`)

Every file the plan cited under `D:\projects\ptah-437` is now on main at the same relative path
in `W`. Line numbers of the #518 files are unchanged unless listed.

| Ref         | Plan citation                                                                                                                                                                          | Found at `51d0d2e1f`                                                                                                                                                                                                                                                                                                                                                  | Verdict                                                                                                                                 |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| E1          | `app-state.service.ts:255-257, 696-714, 329, 721-723, 108-121, 682-695`                                                                                                                | `_canvasSessionRequest` :255, readonly :329, `requestCanvasSession` :696, set :705, `clearCanvasSessionRequest` :721-723, interface :109                                                                                                                                                                                                                              | OK                                                                                                                                      |
| E2          | `orchestra-canvas.component.ts:314-329`                                                                                                                                                | effect :314-329 (read :315, clear :319)                                                                                                                                                                                                                                                                                                                               | OK                                                                                                                                      |
| E3          | `app-shell.component.ts:562-568`; `chat-view.component.ts:981-983`                                                                                                                     | :564; :982                                                                                                                                                                                                                                                                                                                                                            | OK                                                                                                                                      |
| E4          | `app-state.service.spec.ts:617-642`, type :52; canvas spec mocks :210-214, :477-481, :636-640                                                                                          | :618-642, :52; :210/:213, :477/:480, :636/:639                                                                                                                                                                                                                                                                                                                        | OK                                                                                                                                      |
| E5          | `canvas.store.ts:175-190`                                                                                                                                                              | `addTileFromSession` :175, `MAX_TILES` check :176                                                                                                                                                                                                                                                                                                                     | OK                                                                                                                                      |
| E6          | replayer `:84, 92, 94-95, 110-124, 152-153, 154-192, 164-174, 176-186, 189-190`                                                                                                        | chunk size :84, fence limit :92, `claims` :94-95, `claim` :110, throw doc :150-152, `replay` :154-192, post-yield checks :175-186, finalize+closeFence :189-190. File 331 lines                                                                                                                                                                                       | OK                                                                                                                                      |
| E7          | loader claim :657, `applyResumingSession` :685-690, `setStatus('resuming')` :700, `replay` :782-787, failure :791-800, `loaded` :803, `release` :824, compaction :680-691; 1,350 lines | identical (failure branch :791-799)                                                                                                                                                                                                                                                                                                                                   | OK                                                                                                                                      |
| E8-E11      | tab-manager :2107, :1143, :1647; message-sender :632-633; finalization :326/:444; batched-update :85/:93; streaming-handler :419/:428                                                  | identical                                                                                                                                                                                                                                                                                                                                                             | OK                                                                                                                                      |
| E12         | transcript `:277-280, 315-341, 398-415`                                                                                                                                                | `isStreaming` :278-281, `streamingMessages` :316, `vm` :399-419 (`finalizedCount` :407, `totalCount` :409)                                                                                                                                                                                                                                                            | Shifted +1..+4                                                                                                                          |
| E13         | template `:15, 21-22`                                                                                                                                                                  | mount gate :15, `[isStreaming]` :21, `[isFinalizing]="isFinalizingTransition()"` :22. `chat-msg-cv` class gone from :16 (as E36 said)                                                                                                                                                                                                                                 | OK                                                                                                                                      |
| E14         | render window `:118-134, 142-146`; fed at transcript `:481-491`                                                                                                                        | `syncMessages` :118-134, `isMounted` :142-146; feeding effect :482-491 (`finalizedCount` arg :489)                                                                                                                                                                                                                                                                    | OK (+1)                                                                                                                                 |
| E15         | `isFinalizingTransition` edge `:456-477`                                                                                                                                               | signal :259, edge effect :457-478 (300 ms timer :468-474)                                                                                                                                                                                                                                                                                                             | OK (+1)                                                                                                                                 |
| E16         | bubble html :102-105, ts :85-86                                                                                                                                                        | html :104-105, ts :85-86, inputs :99, :106                                                                                                                                                                                                                                                                                                                            | OK                                                                                                                                      |
| E17         | execution-node `:73-80, 348-364, 385-404`; fade-in :127,133,153-177,221; `[autoAnimateDisabled]` :192, :244                                                                            | `scheduleFrame` :73-81, `isNodeStreaming` :348, `flipAnimationDisabled` :362-364, text effect :386-405 (`publishNow` :392, rAF path :398); fade-in and FLIP lines identical                                                                                                                                                                                           | OK                                                                                                                                      |
| E18         | inline-agent-bubble `:445-450, 512-518, 689`                                                                                                                                           | `[auto-animate]` container :446-451 (attr :449), footer :516-518, input :689                                                                                                                                                                                                                                                                                          | OK. Extra static `animate.enter="agent-fade-in"` on the sent-toast at :413 (user action only, not in replay path) — out of scope, noted |
| E19         | bubble badges `:127-131, 157-161`                                                                                                                                                      | static enter/leave :129-130 and :159-160                                                                                                                                                                                                                                                                                                                              | OK                                                                                                                                      |
| E21         | auto-animate directive :56-57, 68-99                                                                                                                                                   | input :57, enabled computed :69, `ngAfterViewInit` :84                                                                                                                                                                                                                                                                                                                | OK                                                                                                                                      |
| E26         | `app.config.ts:117`                                                                                                                                                                    | :117                                                                                                                                                                                                                                                                                                                                                                  | OK                                                                                                                                      |
| E27         | transcript stick rAF `:534-548`; chat-view :314; canvas-layout :60; inline-agent :769                                                                                                  | stick `scheduleStickToBottom` :543-557 (rAF :547), `restoreScrollOnActivation` rAF :562-577 (rAF :566); others identical                                                                                                                                                                                                                                              | Shifted +9                                                                                                                              |
| E28         | macrotask-scheduler :1-18, :73-77                                                                                                                                                      | hidden-window doc :7-8, `yieldToMacrotask` :73                                                                                                                                                                                                                                                                                                                        | OK                                                                                                                                      |
| E29         | chat-view :41-42, :150-160                                                                                                                                                             | identical. chat-view.component.ts is 1,296 lines (already past 1,000; C1 adds a few lines only)                                                                                                                                                                                                                                                                       | OK                                                                                                                                      |
| E30         | chat-view spec :335-370                                                                                                                                                                | providers block :337-370, no `SessionLoaderService` stub                                                                                                                                                                                                                                                                                                              | OK                                                                                                                                      |
| E31         | perf spec `:158-176, 443-482, 538-625, 791-795`                                                                                                                                        | flags :158-159, `BACKUP_DIR` :176, observer :443-470 (`buffered: true` :465), collect :472-480, `openTilesWithinPage` :538-625 (click :613, timestamp :614, rAF :617), asserts :794-795. File 923 lines                                                                                                                                                               | Asserts +3                                                                                                                              |
| E32         | fixture `:223-317`                                                                                                                                                                     | `buildLargeSessionEvents` :223-316, `SessionFixture` :318-324, `makeSessionFixture` :326-345, `makeRand` :203                                                                                                                                                                                                                                                         | OK (range to :345)                                                                                                                      |
| E33         | `perf-diagnostics.ts:72-104`                                                                                                                                                           | `bucketByClick` :72; file 323 lines; `summarizeCpuProfile` :264                                                                                                                                                                                                                                                                                                       | OK                                                                                                                                      |
| E34         | degradation audit                                                                                                                                                                      | `SCAN_GLOBS` :89; `apps/*-e2e/**` excluded :96; TOTAL print :852                                                                                                                                                                                                                                                                                                      | OK                                                                                                                                      |
| E35         | `libs/frontend/chat/CLAUDE.md:70-74` rule 7                                                                                                                                            | rule 7 :70, bullets Claims :71, Chunks :72, Fence :73, Yield :74; rule 8 :75                                                                                                                                                                                                                                                                                          | OK                                                                                                                                      |
| E36         | pending scroll work                                                                                                                                                                    | landed in #519 as described: `lastScrollTop` :239; `onScroll` :514-537 (unpin `movedUp && distanceFromBottom > 1` :524, re-pin :532); stick re-checks pin :550 and only moves down :552-554; restore syncs `lastScrollTop` :575; `.chat-scroll-container { overflow-anchor: auto }` css :27, nested `none` :20; bubble css has no `content-visibility` (comment :5-7) | OK                                                                                                                                      |
| Gate A      | "Gate A: mounted bubbles are bounded"                                                                                                                                                  | `chat-transcript.component.spec.ts:556` (doc :543)                                                                                                                                                                                                                                                                                                                    | Re-cited                                                                                                                                |
| Line count  | transcript "612 main, ~620 after scroll"                                                                                                                                               | 616 lines                                                                                                                                                                                                                                                                                                                                                             | Re-cited                                                                                                                                |
| New finding | —                                                                                                                                                                                      | perf spec doc comments name the single-slot API: `:142`, `:148-154`, `:525-535`, `:615-616`                                                                                                                                                                                                                                                                           | C3 must update them (Task 3.1)                                                                                                          |

Design re-check after #519: `onScroll` no longer reads `isFinalizingTransition` (confirmed), the
finalize effect still starts the 300 ms window on `resuming → loaded`, `vm().totalCount` exists
for C5, and the render window still treats every id at or past `finalizedCount` as tail. C1 and
C5 hold as designed.

### Degradation audit baseline (read, not run)

- `tools/degradation-audit/baseline.json` is unchanged since `f1a34aa55`; its per-directory
  ceilings sum to **304**. Relevant rows: `libs/frontend/chat` 11; `libs/frontend/core` and
  `libs/frontend/canvas` absent (ceiling 0, so any new site there fails); `apps/*-e2e/**` is not
  scanned (`check-degradation.ts:96`).
- The plan's actual TOTAL 303 was measured at `f1a34aa55` + #518; #513 landed since, so the
  actual TOTAL at `51d0d2e1f` is unmeasured. **Batch 1 records it** (Task 1.4, e2e is not
  scanned so Batch 1 cannot move it). Every later batch: TOTAL after == that recorded number,
  no `FAIL` row.

### Assumptions

- A1 replayed partial history mounts during replay — unverified; M0 DOM sample (Task 1.1) and
  C5 spec (Task 5.1).
- A2 `FireAnimationFrame` dominated by execution-node rAF + Angular `animate.enter/leave` —
  **VERIFIED and narrowed by the M0 rAF histogram (Batch 2)**: execution-node `scheduleFrame`
  (E17) alone is 88.3%; the `animate.enter/leave` half of the assumption did not appear as a
  distinct rAF site. See "Batch 2 outcome".
- A3 component effects run before the template in the same CD pass — unverified; C1 spec
  (Task 4.1).
- A4 injecting the replayer in `ChatViewComponent` needs no new stubs — verified by reading
  (E30); confirmed by the chat test run in Batch 4.
- A5 Stage 1 with C5 may meet AC-11 — estimate only; decided by M1 (Batch 6).
- A6 jsdom `requestAnimationFrame` / fake timers drive the paint yield — C2 spec (Task 3.2).
- A7 a replayed bubble leaving the tail while intersecting stays mounted — C5 spec (Task 5.1)
  and M1 scroll sanity check.
- Defaults chosen by team-leader (recorded per operating rules):
  - D1 C3 moves **after** M0 (not parallel with C4). The plan forbids C3 in the M0 build;
    building M0 from a pre-C3 commit in a second checkout adds risk to the measurement for a
    small saving. C3 then runs in parallel with C2 (file-disjoint).
  - D2 C2 before C1 (both edit the replayer); C1 before C5 (shared transcript files and the
    `historyReplaying` input). C1 and C5 stay separate batches so each review is focused.
  - D3 Executor for every code batch is the `codex` CLI lane (context.md "CLI Lanes"; overrides
    the plan's frontend-developer/senior-tester recommendation for C1-C5). Reviews are Claude
    `code-logic-reviewer` + `code-style-reviewer`, never the implementing lane. Measurements are
    Claude `senior-tester`. Commits only by team-leader.
  - D4 The three CodeRabbit Major findings on PR #518 and the stale auto-animate paragraph in
    `test-report-b22.md` fold into Batch 1 (C4), because they change the measurement M0 relies on.

| Risk                                                                                                                       | Severity | Mitigation                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `buffered: true` counts long tasks from before the window (CodeRabbit 1)                                                   | HIGH     | Task 1.1 filters by window start                                                                           |
| Marker can land in a non-final turn, so the window closes before the last turn replays (CodeRabbit 2)                      | HIGH     | Task 1.1 exact turn size                                                                                   |
| Click timestamp recorded after `click()` dispatch, so synchronous handler work buckets to the previous tile (CodeRabbit 3) | MEDIUM   | Task 1.1 timestamp before dispatch                                                                         |
| Settle window never settles (continuous mutations)                                                                         | MEDIUM   | Task 1.1 10 s cap → `settled: false` throws "measurement unusable"                                         |
| Harness adds work inside the asserted window                                                                               | MEDIUM   | rAF wrapper and tracing only behind diagnostic flags (Task 1.1/1.2)                                        |
| C3 in the M0 build                                                                                                         | HIGH     | D1: C3 is Batch 3, after M0                                                                                |
| Parallel lanes in Batch 3 read each other's edits in the degradation audit                                                 | LOW      | Each lane reports its own directory rows; team-leader checks TOTAL after both                              |
| Replay flag left set freezes motion / virtualizes a live turn                                                              | HIGH     | Task 4.1 claim-keyed `finally` + spec                                                                      |
| Admission slot wedged (throw, superseded waiter, closed tab)                                                               | HIGH     | Task 3.2 release in `finally` + specs + 10 s wait `console.warn`                                           |
| rAF never fires in a hidden window → paint yield hangs                                                                     | HIGH     | Task 3.2 race rAF with a 50 ms timer                                                                       |
| Bound `[animate.enter]` fails in production AOT                                                                            | MEDIUM   | Task 4.1 builds webview development + production                                                           |
| C5 tail-shift placeholder drop disturbs scroll (not provable in jsdom)                                                     | MEDIUM   | M1 scroll sanity check (Task 1.1 adds it); fix stays inside C5                                             |
| Re-adding `content-visibility` or editing scroll methods                                                                   | HIGH     | Forbidden in Tasks 4.1/5.1; grep check in batch verification                                               |
| Rapid clicks drop tile opens (FU-22a)                                                                                      | MEDIUM   | Task 3.1 queue                                                                                             |
| Shared-worktree hygiene (other lanes, Nx daemon)                                                                           | MEDIUM   | No `nx reset` (no `project.json` edits in this task); explicit-path staging; `--parallel=1 --maxWorkers=2` |

Edge cases:

- Timed-out canvas request later consumed by a mounting canvas — Task 3.1
- Tile cap reached for the 2nd of 2 queued requests — Task 3.1
- Superseding replay of the same tab while an older replay's `finally` runs — Task 4.1
- Waiter whose tab closed or rebound before admission — Task 3.2
- Uncontended ≤250-event replay must keep synchronous timing — Task 3.2
- Live events for a waiting session stay fenced (limit 2,000 unchanged) — Task 3.2
- Live `markResuming` continue must NOT be treated as replay — Task 4.1 (flag from replayer, not tab status)
- Reduced motion unchanged — Task 4.1
- No `IntersectionObserver` (jsdom) → window mounts everything — Task 5.1 uses a local fake
- Live streaming message after replay is exempt from the window again — Task 5.1
- Skeleton `animate.enter="fade-enter"` in transcript html :39-43 shows once per resuming tab before the first flush — one element, left as is
- Hidden/occluded window during measurement — Batch 2/6 protocol (idle, visible window)

---

## Common rules for every codex task (copy into each lane prompt)

- Work only inside `W`. Do not edit `batches.md`, `task.md`, `context.md`,
  `implementation-plan.md`. Do not commit, stash, amend, or `git add`. Do not run `nx reset`.
- TypeScript strict; `catch (error: unknown)`; no `@ts-ignore`; no TODO/stub/placeholder; no new
  `catch { return <literal> }` or empty `.catch`. Angular: signals, `inject()`, OnPush.
- Never add `content-visibility`. Never edit `onScroll`, `scheduleStickToBottom`,
  `restoreScrollOnActivation`, `lastScrollTop`, or `chat-transcript.component.css`.
- Replace in place; delete the old API; no `V2`/`Legacy` copies.
- Verification order (report the literal output lines):
  1. Tests: `npx nx run-many -t test -p <projects> --parallel=1 --maxWorkers=2` — quote the
     `Running target test for N projects` header; N must equal the count listed.
  2. `npx nx run-many -t typecheck -p <projects> --parallel=1`
  3. `npx nx run-many -t lint -p <projects> --parallel=1` (0 errors; report new warnings)
  4. `npx nx run degradation-audit:lint --skip-nx-cache` — quote `degradation-audit: TOTAL N`
     and the rows for touched directories; N must equal the Batch 1 recorded TOTAL.
  5. `npx prettier --check <every changed file>` (use `--write` on your own files if it fails).
- **Quote every `|` in an nx/jest argument** — on Windows PowerShell an unquoted `|` in
  `--testPathPatterns a|b` is parsed as a pipe; write `--testPathPatterns '"a|b"'`. Prefer
  `run-many -t test -p <projects>` over path patterns. A lane that did this left an executor hung
  with no worker children, no output and no report; it survived the lane's exit and held a CPU core
  for 3.5 hours. If a run goes unusually long with no output, check for an executor process with no
  worker children before waiting longer.
- At most 2 test runners at once across all lanes. Before a perf/Playwright run, the node-runner
  count must be 0:
  `powershell -NoProfile -c "(Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | ? { $_.CommandLine -match 'jest-worker|run-executor' }).Count"`
- Return: absolute path of every file created/modified; per task, evidence for each acceptance
  criterion; how each listed risk was handled.

---

## Batch 1: C4 perf harness + PR #518 CodeRabbit fixes — COMPLETE (commit `49b436256`)

- Recommended executor: CLI lane `codex` x 1
- Fallback executor: Claude `senior-tester` sub-agent (harness-only work)
- Execution mode: sequential
- Rationale: one spec file split into two new support files plus diagnostics; tasks share the
  spec file, so one lane in order. No product code.
- Tasks: 4 | Depends on: none (P1-P3 done)
- Review: `code-logic-reviewer` (measurement correctness) + `code-style-reviewer` in parallel →
  fixes to codex → delta review if non-trivial → team-leader commit.

### Task 1.1: Split the perf spec, settle-inclusive window, CodeRabbit fixes, diagnostics flags — COMPLETE

- Files:
  - MODIFY `W\apps\ptah-electron-e2e\src\specs\chat\tile-open-longtask-budget.perf.spec.ts` (923 lines)
  - CREATE `W\apps\ptah-electron-e2e\src\support\perf-session-fixture.ts`
  - CREATE `W\apps\ptah-electron-e2e\src\support\perf-page-capture.ts`
- Plan reference: implementation-plan.md:358-409 (C4), :500-523 (M0 run set); User Decision 2 :43-44
- Pattern to follow: existing support modules `W\apps\ptah-electron-e2e\src\support\perf-diagnostics.ts`
  (pure exported functions + interfaces); env-flag pattern at spec :158-159.
- Acceptance criteria:
  1. Move `makeRand` (:203), `buildLargeSessionEvents` (:223-316), `SessionFixture` (:318-324),
     `makeSessionFixture` (:326-345) and `GeneratedEvent` to `perf-session-fixture.ts`
     (exported). Move page/CDP capture helpers (`installLongTaskObserver` :443-470,
     `collectLongTasks` :472-480, `openTilesWithinPage` :538-625, the new settle observer, rAF
     wrapper and trace capture) to `perf-page-capture.ts`. The spec file ends shorter than 923 lines.
  2. **CodeRabbit 1 (`buffered: true`, spec :465, :673-676)**: record `windowStartMs =
performance.now()` in the page immediately before the first click. Long tasks with
     `startTime < windowStartMs` are excluded from `max`, `total` and buckets; their count and
     summed duration are written to the diagnostics JSON as `preWindowExcluded`. Apply to the
     cold, warm 1-tile and warm 3-tile tests. Update the comment at :673-676.
  3. **CodeRabbit 2 (marker before the final turn, spec :255-258)**: draw `deltaCount` then
     `toolCount` with `rand()` in the current order at the top of the turn, compute
     `turnSize = 4 + deltaCount + 2 * toolCount`, and set `isFinalTurn = events.length +
turnSize >= targetEvents`. The marker is the last text delta of the turn that ends the loop.
     Keep the rand call order so the fixture is otherwise identical. Remove the `markerPlaced`
     latch if it becomes redundant.
  4. **CodeRabbit 3 (timestamp after dispatch, spec :613-614)**: `clickTimes.push(performance.now())`
     BEFORE `btn.click()`. Keep the one-rAF yield between clicks (:617, disclosed stress cadence).
  5. Settle-inclusive window: after all markers are found, keep a `MutationObserver` on
     `[data-testid="canvas-tile"]` subtrees (childList, subtree, attributes, characterData); the
     window closes after 1,000 ms with no mutation, capped at 10,000 ms after the last marker.
     Cap hit → result `settled: false` and the test throws
     `"[AC-11 perf] measurement unusable: tiles did not settle within 10 s"` — never a pass.
     Record `performance.now()` when each marker is first found (`markerTimes[]`).
  6. The `longtask` observer stays connected until the window closes; `wallMs` measured to close.
  7. Per-tile buckets by marker appearance (a second call to a bucketing function with
     `markerTimes`) in addition to `bucketByClick`; both logged and written to diagnostics.
  8. DOM node count `document.querySelectorAll('[data-testid="canvas-tile"] *').length` at settle,
     and once while any tile is still replaying (sample at the first marker appearance, and
     record whether all markers were present at that point).
  9. `PTAH_PERF_RAF_ATTRIBUTION=1` (diagnostic tests only; the cold asserting test must refuse or
     ignore it — document which): `page.addInitScript` wraps `window.requestAnimationFrame`,
     captures `new Error().stack`, takes the first frame outside the wrapper, counts by
     `functionName url:line:column`; top 20 written to diagnostics JSON.
  10. `PTAH_PERF_TRACE=1`: CDP `Tracing.start` / `Tracing.end` with the FU-22d spike's categories
      (read `W\.ptah\specs\TASK_2026_437_0778\fu22d-attribution-spike-report.md` for them), trace
      events collected and summarized by `summarizeTraceEvents` (Task 1.2).
  11. `PTAH_PERF_EVENTS` (500 / 1000 / 2000; anything else throws) applies to diagnostic tests
      only; the asserting cold test always uses 2,000.
  12. Output directory from `PTAH_PERF_OUT_DIR`, default `path.join(os.tmpdir(), 'ptah-perf')`;
      delete hard-coded `BACKUP_DIR` (:176) and fix doc :99-103 (`D:\projects\ptah-437-backup`,
      stale "below"). The `.cpuprofile` write (:706-711) gets the same try/catch guard as
      `writeDiagnostics` (:627-639) — the guard logs and continues, it does not return a sentinel.
  13. Scroll sanity check, after the window closes and after long tasks are read: for each tile,
      `.chat-scroll-container` has `scrollHeight - scrollTop - clientHeight <= 120` and contains
      its own marker text. Failure throws `"[AC-11 functional] scroll sanity failed: ..."`
      (distinct from perf failure). Runs in the cold and warm 3-tile tests.
  14. Budgets unchanged: `MAX_SINGLE_LONG_TASK_MS` 200, `MAX_TOTAL_BLOCKED_MS` 1500; asserts stay
      in the cold test only. Skip without `PTAH_PERF_SPECS=1` unchanged.
- Validation notes: the harness must add no work inside the asserted window beyond the scoped
  mutation observer; rAF wrapper and tracing are off unless their flags are set.
- Do NOT touch the FU-22a doc comments (:142-154, :525-535, :615-616) beyond moving them with
  their code; Task 3.1 rewrites them after C3 lands.

### Task 1.2: `summarizeTraceEvents` and marker bucketing in perf-diagnostics — COMPLETE

- Depends on: none (used by Task 1.1)
- File: MODIFY `W\apps\ptah-electron-e2e\src\support\perf-diagnostics.ts` (323 lines)
- Plan reference: implementation-plan.md:374-377, :368-369
- Pattern to follow: `bucketByClick` :72-104, `summarizeCpuProfile` :264
- Acceptance criteria:
  1. `export function summarizeTraceEvents(events: readonly TraceEvent[], mainThread: { pid:
number; tid: number }): TraceEventSummary` — pure; returns per event `name` the `count` and
     total `dur` (µs → ms), main-thread events only; sorted by total desc.
  2. A helper that identifies the renderer main thread from trace metadata
     (`TracingStartedInBrowser` / `CrRendererMain` thread name) — pure, exported, and documented.
  3. `bucketByMarker` (or a generalised `bucketByTime` that `bucketByClick` delegates to — no
     duplicated loop) that assigns each long task to the last marker time at or before its start.
  4. Update the module doc (:1-30) for the new functions. No new dependency.

### Task 1.3: e2e CLAUDE.md "Perf specs" flags — COMPLETE

- File: MODIFY `W\apps\ptah-electron-e2e\CLAUDE.md` (section "Perf specs" :18-20)
- Acceptance criteria: documents `PTAH_PERF_RAF_ATTRIBUTION`, `PTAH_PERF_TRACE`,
  `PTAH_PERF_EVENTS`, `PTAH_PERF_OUT_DIR` (default `os.tmpdir()/ptah-perf`), the settle-inclusive
  window (1,000 ms quiet, 10 s cap → unusable), the pre-window exclusion, and the scroll sanity
  check; which flags are diagnostic-only. Existing text kept, not duplicated.

### Task 1.4: Mark the superseded auto-animate paragraph in test-report-b22.md; record audit TOTAL — COMPLETE

- File: MODIFY `W\.ptah\specs\TASK_2026_437_0778\test-report-b22.md` (bullet at :242-250)
- Acceptance criteria:
  1. Keep the original bullet text for the record, prefixed with a bold
     "Superseded by the FU-22d attribution spike" note that says: auto-animate 0.8.4 does not
     call `getAnimations` by name, disabling it saved 31-39 % total but left ~678 ms of
     `getAnimations`; the source-backed candidate is Angular `animate.enter/leave`
     (`determineLongestAnimation` → `el.getAnimations()` per entering element), see
     `fu22d-attribution-spike-report.md` and TASK_2026_453 implementation-plan.md E22-E24.
     Keep lines 101, 114-115, 139 unchanged unless they assert the same superseded claim as fact;
     if so add a one-line pointer to the same note.
  2. Run `npx nx run degradation-audit:lint --skip-nx-cache` once on the untouched product code
     and report the `degradation-audit: TOTAL N` line — this N is the reference for Batches 3-5.
- Verification (Batch 1):
  - `npx nx run-many -t typecheck -p ptah-electron-e2e --parallel=1` (header 1 project)
  - `npx nx run-many -t lint -p ptah-electron-e2e --parallel=1`
  - Skip proof, runner count 0 first: from `W\apps\ptah-electron-e2e`, without `PTAH_PERF_SPECS`:
    `npx playwright test src/specs/chat/tile-open-longtask-budget.perf.spec.ts --config=playwright.config.ts --reporter=list`
    → all tests reported skipped. If the fixture needs a built Electron app first, report that and
    use `--list` plus the skip condition as evidence instead.
  - `npx prettier --check` on the 6 changed files.
  - No product file changed: `git status --short` lists only the 6 files above.

### Batch 1 verification

- Every listed artifact exists and contains the required work (team-leader reads each file)
- typecheck, lint, skip proof, prettier pass; audit TOTAL recorded in this file
- `code-logic-reviewer` and `code-style-reviewer` accepting verdicts
- CodeRabbit 1-3 each visibly fixed at their new locations

### Batch 1 outcome

- Executor: `codex` CLI lane (session `01a0a6fd-c612-7660-962d-b4168f1b0a1c`), base pass + revise
  round 1 (cap used 1 of 2). Report: `b1-codex-report.md`.
- Review chain: `b1-code-logic-review.md` NEEDS_REVISION (serious: `PTAH_PERF_TRACE` could reach
  the gate; marker 30 s timer raced settle; two unpointed superseded passages in
  test-report-b22) → `b1-code-logic-review-delta.md` APPROVED (1 moderate, evidence only).
  `b1-code-style-review.md` APPROVED (serious: spec over 700 lines; 3 minor) →
  `b1-code-style-review-delta.md` APPROVED (2 minor).
- Deviation from the task list: an extra support file `perf-measurement-report.ts` (186 lines)
  holds summarize / assert / persist, so the spec is 602 lines (was 923). Accepted by both
  delta reviews.
- Team-leader verification (2026-09-16, worktree HEAD `01307f73e` + batch diff):
  - CodeRabbit 1: `windowStartMs` recorded before the first click
    (`perf-page-capture.ts:324`); `startTime < windowStartMs` excluded into `preWindowExcluded`
    (`perf-measurement-report.ts:90-110`).
  - CodeRabbit 2: `turnSize = 4 + deltaCount + 2 * toolCount`, `isFinalTurn`
    (`perf-session-fixture.ts:76-77`, marker :97).
  - CodeRabbit 3: `clickTimes.push(performance.now())` before `btn.click()`
    (`perf-page-capture.ts:326-327`).
  - Gate test hard-disables trace (`spec:231`) and rAF attribution (`spec:255`); settle 1,000 ms
    quiet / 10,000 ms cap (`perf-page-capture.ts:234, 250`); budgets 200 / 1,500 unchanged
    (`spec:180, 182`).
  - `npx nx run-many -t typecheck -p ptah-electron-e2e --parallel=1` — success.
  - `npx nx run-many -t lint -p ptah-electron-e2e --parallel=1` — 0 errors, 9 pre-existing
    warnings, none in Batch 1 files. `npx eslint` on the 5 changed `.ts` files — exit 0.
  - `npx prettier --check` — the 5 `.ts` files, e2e `CLAUDE.md`, `test-report-b22.md` and
    `batches.md` pass; the 4 review docs were unformatted (lint-staged formats them at commit).
  - Skip proof, runner count 0, `PTAH_PERF_SPECS` unset:
    `npx nx run ptah-electron-e2e:e2e -- src/specs/chat/tile-open-longtask-budget.perf.spec.ts --reporter=list`
    → `Running 4 tests using 1 worker`, 4 rows, `4 skipped`, exit 0. This closes the logic delta's
    moderate item. The revise-round run that "printed no rows" was most likely a truncated view
    of the long Electron pre-build output: the rows print only after ~230 lines of dependency
    build output.
- **Degradation audit baseline for Batches 3-5**: `npx nx run degradation-audit:lint
--skip-nx-cache` → `degradation-audit: TOTAL 303 unsuppressed site(s)`, no FAIL row,
  `libs/frontend/chat: 11 ok (baseline 11)`, `libs/frontend/core` and `libs/frontend/canvas` absent
  (ceiling 0). Every later batch: TOTAL after == 303.
- Follow-ups (minor, not blocking):
  - Split `assertScrollSanity` out of `perf-measurement-report.ts` before the file gains a ninth
    export (style delta minor 1).
  - No unit coverage for `bucketByTime` / `findRendererMainThread` / `summarizeTraceEvents`; the
    e2e project has no Jest target (logic residual).
  - Diagnostics / `.cpuprofile` write failures only `console.warn` (by design, AC-12); an
    unwritable `PTAH_PERF_OUT_DIR` leaves no artifact. Batch 2 must list the diagnostics JSON
    paths it read, which catches this.
  - `startTraceCapture` has no try/catch around CDP calls; reachable only from diagnostic tests.
  - Style delta minor 2 (`perf-diagnostics.ts` "modified") is not a no-op concern: that file is
    the Task 1.2 change (+123 lines vs HEAD), reviewed in the base pass.

## Batch 2: M0 baseline measurement — COMPLETE

- Recommended executor: Claude `senior-tester` sub-agent
- Fallback executor: none (measurement must be on an idle machine; wait instead)
- Execution mode: sequential
- Rationale: measurement protocol, idle machine, no code.
- Tasks: 1 | Depends on: Batch 1 committed. Build contains NO C1, C2, C3 or C5 change.
- Review: `code-logic-reviewer` on `test-report.md` methodology (runner counts, discarded runs,
  settle flags); team-leader commits the report.

### Task 2.1: M0 run set and FireAnimationFrame verdict — COMPLETE

- File: CREATE `W\.ptah\specs\TASK_2026_453_1eb4\test-report.md`
- Plan reference: implementation-plan.md:500-523; handoff.md §8 rules 1, 4, 5
- Acceptance criteria:
  1. `git log --oneline -1` in the report equals the Batch 1 commit; `git status --short` shows no
     product change.
  2. Runs (runner count 0 before and after each; a discarded run is re-run, never averaged):
     cold 3-tile dev ×3 (asserting test); warm 1-tile ×1; warm 3-tile ×1; production cold ×1;
     `PTAH_PERF_RAF_ATTRIBUTION=1` cold ×1; `PTAH_PERF_TRACE=1` cold at 500 and 2,000 events ×1
     each. Per run: max, total, count, `preWindowExcluded`, `settled`, wall, click buckets, marker
     buckets, DOM counts (replaying and settled), scroll sanity result.
  3. rAF histogram top sites mapped to E11/E17/E23/E26/E27 (P3 table lines); trace
     `FireAnimationFrame` count at 500 vs 2,000 → verdict on A2.
  4. Main-thread trace shares: DOM-volume (Layout/Paint/GPU + DOM-driven rAF) vs event-driven JS.
  5. Optional M0-cv only if cheap (plan :509-516); temporary edit restored byte for byte and
     confirmed with `git status`/`git diff`; never committed.
- Environment: diagnostics to `PTAH_PERF_OUT_DIR` outside the repo; diagnostics JSON paths listed.

### Batch 2 outcome

- Executor: Claude `senior-tester` sub-agent. Report: `test-report.md` (the only file added; no
  product or spec code changed — team-leader confirmed `git status --short` showed only
  `test-report.md` untracked plus the carried-over one-line `batches.md` status edit, and
  `git diff --stat` showed 1 file / 1 insertion / 1 deletion).
- Measured build: HEAD `49b436256` (Batch 1 commit), no product change in it.
- Run set (9 runs, all after the shared-machine idle check first reached 0 at 02:23:47; idle
  `0`/`0` before and after every run; none discarded; none threw "measurement unusable"): cold
  3-tile dev ×3, warm 1-tile, warm 3-tile, production cold, rAF attribution, trace at 500 and at
  2,000 events.

**AC-11 is NOT MET at M0**, in dev and in production:

| Metric               | Budget      | Dev cold (I / J / K)     | Production cold | Gap (production) |
| -------------------- | ----------- | ------------------------ | --------------- | ---------------- |
| Max single long task | <= 200 ms   | 1,926 / 1,326 / 1,062 ms | 1,201 ms        | 6.0× over        |
| Total blocked time   | <= 1,500 ms | 6,941 / 5,463 / 4,077 ms | 4,767 ms        | 3.2× over        |

- The last-clicked tile (TILE_2) carries ~95-98% of each run's blocked time and the budget-busting
  max task — the Batch 22 / FU-22d shape, reconfirmed on this commit.
- **E17 correction (the new finding).** The rAF call-site histogram (1,517 captured calls) puts
  `execution-node.component.ts` `scheduleFrame` (plan evidence E17) at 88.3% of all rAF calls, and
  `FireAnimationFrame` count scales 3.09× for a 4× event increase (448 → 1,386) — so it is a
  per-node/per-chunk cost, not a fixed per-tile-open cost. This **corrects** the FU-22d spike,
  which ruled E17 out by assuming a resumed session takes `scheduleFrame`'s synchronous
  `publishNow` branch; `SessionHistoryReplayer`'s chunked replay actually streams each node, so
  the rAF-gated branch is the one taken. A2 is confirmed, and more specifically than assumed.
  E27 3.5%, E26 2.0%, E11 0.4%; E23 does not appear as a distinct site; 5.4% stays unattributed
  in minified frames.
- **Effect on Stage 1 — recorded, no plan change made here.** Batch order is unchanged (C2/C3 →
  C1 → C5; C5 still needs C1's `historyReplaying` signal). Two consequences the architect must
  rule on **before Batch 4 starts**:
  - C1 as specified does NOT reach the 88.3% rAF source. `scheduleFrame`'s rAF branch is gated
    solely by `isNodeStreaming()` (`execution-node.component.ts:391-398`); `isFinalizing()` drives
    only `exec-fade-in` (:127 etc.) and `flipAnimationDisabled` (:362-364), neither of which is
    the rAF path. Task 4.1 AC 6 also states `execution-node.component.ts` is **unchanged**. So
    `test-report.md`'s claim that C1 gates `scheduleFrame` "by the same `isFinalizing` signal" is
    not supported by the source — see "Not supported by the report" below. Open question: should
    C1's scope widen to gate `scheduleFrame` on `historyReplaying`?
  - **A5 estimate shifts down, C5's expected recovery shifts up.** A5 credited the Angular
    animation gate with an unmeasured 0-15% of the remainder; E17 reallocates most of
    `FireAnimationFrame` (18.9% of wall at 2,000 events) to per-node streaming publishes that the
    animation gate does not touch, so that 0-15% credit should be read at its low end unless C1
    widens. Conversely, C5 cuts mounted execution nodes during replay, and rAF calls here are
    per-node, so C5's recovery should scale with the DOM reduction — E17 makes C5 **more**
    load-bearing for AC-11, consistent with A5's "without C5 it would not".
- **DOM volume**: replaying node count is ~3.5-4.3× the settled count on the 3-tile cases (e.g.
  run I 21,113 / 4,980; run J 20,931 / 5,935; production 20,954 / 6,024). Batch 5 (C5)'s own
  acceptance criterion is <= 2× per tile, so M1 must beat this by roughly half. These are
  whole-canvas totals; C5/M1 needs its own per-tile breakdown.
- **M0-cv skipped**, reason recorded (`test-report.md` "M0-cv"): the only remaining path needs a
  temporary re-add of the `.chat-msg-cv` rule that PR #519 deleted, plus a renderer rebuild before
  and after, which failed the plan's own "only if cheap" test (`implementation-plan.md` :509-516)
  on a contended machine after 9 runs. Left for Stage 2 sizing.
- **Evidence paths**: diagnostics JSON in `D:\projects\ptah-453-perf\m0` — cold
  `ac11-perf-cold-3tile-1789514716165.json` (I), `...-1789514797099.json` (J),
  `...-1789514867049.json` (K); `ac11-perf-warm-1tile-1789514932417.json`;
  `ac11-perf-warm-3tile-1789515004612.json`; production `ac11-perf-cold-3tile-1789515097003.json`;
  rAF `ac11-perf-diagnostic-cold-3tile-2000-1789515190816.json`; trace
  `ac11-perf-diagnostic-cold-3tile-500-1789515270688.json` and
  `...-2000-1789515342074.json`. Console logs `D:\projects\ptah-453-perf\m0-run1.log`, `m0-run2`,
  `m0-run3`, `m0-warm1`, `m0-warm3`, `m0-prod-cold`, `m0-raf-attribution`, `m0-trace-500`,
  `m0-trace-2000`.
- **Not supported by the report** (team-leader check; none invalidates the baseline numbers):
  1. The C1 claim above (`test-report.md` :339-344) contradicts
     `execution-node.component.ts:362-364, 391-398`. Treat as an open architect question, not a
     settled justification.
  2. Layout/Paint/GPU family total at 2,000 events is given as 2,211.70 ms / 33.2%; the seven rows
     sum to **2,271.11 ms / 34.1%** — `HitTest` (59.41) was dropped from the 2,000 total but
     included in the 500 total (which does sum to 1,176.04). Arithmetic only.
  3. "TILE_2 carries 88-95%" understates it: per-run shares are 94.7 / 96.4 / 94.8%, warm 3-tile
     97.6%. No run is at 88%.
  4. "4-4.3×" DOM ratio "every cold/warm 3-tile run" — run J is 3.53× and production 3.48×. The
     range is ~3.5-4.3×.
  5. Task 2.1 AC 2 asks for a **scroll sanity result per run**; the report records none (zero
     occurrences). Marker buckets are given for run I only, and `preWindowExcluded` is omitted from
     the warm and trace tables. The JSON holds all of it; M1 (Task 6.1) must report it.
- Every other number checks out: the histogram sums to 1,517 and its shares are exact; per-tile
  buckets sum to each run's count and total; the 6.0×/3.2× gaps, the 3.09× scaling and every
  share-of-wall percentage recompute correctly; the 9 JSON timestamps are monotonic and all later
  than the 02:23:47 idle transition.
- **Process note**: batches.md scheduled a `code-logic-reviewer` pass on this report's methodology.
  The orchestrator directed a direct commit instead (documentation-only batch, no product code).
  Items 1-5 above are the team-leader verification that ran in its place.

## Batch 3: C3 canvas request queue ∥ C2 replay admission — COMPLETE (commit `b9cc2f193`)

- Recommended executor: CLI lanes `codex` x 2 (Lane A = Task 3.1, Lane B = Task 3.2)
- Fallback executor: Claude `frontend-developer` sub-agent, sequential 3.1 then 3.2
- Execution mode: parallel
- Rationale: file-disjoint (core + canvas + perf spec comments vs chat replayer + chat CLAUDE.md),
  no shared registry, entry point or config, no dependency between them; each is one
  self-contained prompt. Two test runners max = two lanes.
- Tasks: 2 | Depends on: Batch 2 (M0 recorded)
- Review: `code-logic-reviewer` + `code-style-reviewer` over both lanes' diffs → fixes back to the
  owning lane → delta review if non-trivial → team-leader commits once for the batch.

### Task 3.1 (Lane A): Replace the single-slot canvas session request with a FIFO queue — COMPLETE

- Files:
  - MODIFY `W\libs\frontend\core\src\lib\services\app-state.service.ts`
  - MODIFY `W\libs\frontend\core\src\lib\services\app-state.service.spec.ts`
  - MODIFY `W\libs\frontend\canvas\src\lib\orchestra-canvas.component.ts`
  - MODIFY `W\libs\frontend\canvas\src\lib\orchestra-canvas.component.spec.ts`
  - MODIFY (doc comments only) `W\apps\ptah-electron-e2e\src\specs\chat\tile-open-longtask-budget.perf.spec.ts`
    and/or `W\apps\ptah-electron-e2e\src\support\perf-page-capture.ts` — wherever Batch 1 left the
    FU-22a comments (at `51d0d2e1f`: spec :142-154, :525-535, :615-616); find them with
    `grep -n "canvasSessionRequest\|single-slot" apps/ptah-electron-e2e/src -r`
- Plan reference: implementation-plan.md:314-356 (C3), S1-AC1 :481-482
- Pattern to follow: `requestNewCanvasSession` / `newCanvasSessionRequest` in the same service
  (:259, :331, :727-733) for signal + readonly view shape.
- Acceptance criteria:
  1. `_canvasSessionRequest` (:255) → `_canvasSessionRequests = signal<readonly
CanvasSessionRequest[]>([])`; public `canvasSessionRequests` (readonly); `takeCanvasSessionRequests():
readonly CanvasSessionRequest[]` returns the queue and sets `[]` (no write when already empty).
     `requestCanvasSession` (:696) appends. `canvasSessionRequest` (:329) and
     `clearCanvasSessionRequest` (:721-723) are deleted. Doc comments :90, :109-121, :682-695
     updated.
  2. The 5 s timeout resolving `false` removes that exact request from the queue if still present;
     the timer is cleared when the request resolves (no leak).
  3. Canvas effect (:314-329): reads `canvasSessionRequests()`; when non-empty,
     `untracked(() => this.appState.takeCanvasSessionRequests())` and for each request in order
     runs the existing body (`addTileFromSession`, then `switchSession(...).then(resolve(true))
.catch(resolve(false))`, or `resolve(false)` when no tab id). No `await` between requests.
  4. `grep -rn "canvasSessionRequest\b\|clearCanvasSessionRequest" W/libs W/apps` returns only
     the new plural names (spec mocks :210-214, :477-481, :636-640 and spec type :52 updated).
  5. Specs: app-state — two requests before `take` returned in order; `take` empties; a timed-out
     request is removed and resolves `false` (fake timers); resolve `true` path. Canvas — two
     requests queued before one `TestBed.tick()` → two `addTileFromSession` and two
     `switchSession` in order; cap on the second → only the second resolves `false`.
  6. Perf-harness comments reworded: the single-slot bug is fixed by TASK_2026_453 C3; the one-rAF
     yield between clicks stays as the disclosed stress cadence. Comment-only change there.
- Verification: tests `-p @ptah-extension/core @ptah-extension/canvas` (header 2); typecheck and
  lint on `@ptah-extension/core @ptah-extension/canvas ptah-electron-e2e`; audit rows
  `libs/frontend/core` and `libs/frontend/canvas` must not appear as FAIL (ceiling 0).

### Task 3.2 (Lane B): One replay-and-finalize at a time across tabs — COMPLETE

- Files:
  - MODIFY `W\libs\frontend\chat\src\lib\services\chat-store\session-history-replayer.service.ts` (331 lines)
  - CREATE `W\libs\frontend\chat\src\lib\services\chat-store\session-history-replayer.admission.spec.ts`
  - MODIFY `W\libs\frontend\chat\CLAUDE.md` — rule 7 (:70-74): add one bullet **Admission** after
    the Yield bullet (:74)
- Plan reference: implementation-plan.md:261-312 (C2), S1-AC3 :487-489, observability :580-582
- Pattern to follow: post-yield checks in `replay()` :175-186; spec style of
  `session-history-replayer.service.spec.ts`; `yieldToMacrotask` from `@ptah-extension/core`
- Acceptance criteria:
  1. Scope is `replay()` only (chunks + `finalizeSessionHistory` + `closeFence`); `claim`,
     `release`, fence and `session-loader.service.ts` are NOT modified.
  2. FIFO by `replay()` entry. Uncontended (no active replay, no waiter) → admitted synchronously
     with no added `await`/microtask; a ≤250-event replay has written and finalized before the
     returned promise's first `then` can run (same as today).
  3. Contended → waits; on admission re-runs the checks of :176-186 (claim current, tab present →
     `clearPendingUpdates` + `setStatus('loaded')`, tab bound to `sessionId`) and returns
     `'superseded'` identically; a superseded waiter releases the slot immediately.
  4. Release in `finally` on every exit (replayed, superseded, throw, rejected yield). Before the
     next waiter starts: `await yieldToMacrotask()` then a private paint yield = first of
     `requestAnimationFrame` or a 50 ms `setTimeout`, both handles cleared when either fires.
     Helper stays private to the replayer. A rejected `yieldToMacrotask` in the hand-off still
     admits the next waiter (no wedge), without a sentinel catch.
  5. A throw inside `replay()` still propagates with the fence open (doc :150-152 unchanged).
  6. A waiter waiting > 10 s emits one `console.warn` with tab id and queue length (timer cleared
     on admission).
  7. File stays under 700 lines; class doc (:1-30) gains an Admission paragraph.
  8. Spec (fake timers where needed): three chunked replays (> 250 events) on three tabs run
     strictly in sequence — no `processStreamEvent` for B before A's `finalizeSessionHistory`;
     FIFO order; superseded waiter, closed-tab waiter, and throwing active replay each release the
     slot; uncontended ≤250 case finalizes synchronously; fence events of a waiting session are
     delivered after that session's finalize; no timers pending after the last release;
     hidden-window case (rAF never fires) still advances via the 50 ms timer.
  9. Existing `session-history-replayer.service.spec.ts`, `session-loader.service.spec.ts`,
     `session-loader.cli-restore.spec.ts` green. **Corrected at commit**: "unchanged" was
     incompatible with global admission. `session-history-replayer.service.spec.ts` (tests at
     :456-495, :541-569, :571-595, :699-728) and `session-loader.service.spec.ts` (:2326-2356)
     were restructured for scheduling only — they release the older replay before driving the
     newer one, because the admission slot forbids the old same-time schedule. No assertion was
     weakened (fence ownership, finalize order, exact-once delivery, event order, supersession,
     250/10 event counts all still asserted). The loader test at :2288-2323 is additive.
     `session-loader.cli-restore.spec.ts` is unchanged. Evidence: `b3-revise-codex-report.md`
     "Revise round 2" §5; both diffs read by `b3-code-logic-review-delta2.md`.
  10. CLAUDE.md bullet: admission is global FIFO over the replay phase only, released in
      `finally`, paint yield races rAF with a 50 ms timer, `session:load`/`chat:resume` stay
      concurrent; FU-20a (global status may read `loaded` while a later replay waits) noted.
- Verification: tests `-p @ptah-extension/chat` (header 1); typecheck and lint on
  `@ptah-extension/chat`; audit row `libs/frontend/chat` ≤ 11, no FAIL.

### Batch 3 verification

- Both lanes' files exist with real implementations; no stray files (`git status --short`)
- Team-leader runs no tests; checks both lane reports' headers (2 and 1) and audit TOTAL equals
  the Batch 1 reference once both lanes are done (lane-reported TOTALs may include the other
  lane's in-flight edits)
- Grep: no `canvasSessionRequest(` / `clearCanvasSessionRequest` left
- Reviewers accept

### Batch 3 outcome

- **Executors**: CLI lanes `codex` x 2 (Lane A = Task 3.1, Lane B = Task 3.2), then one codex
  revise lane for both rounds. Reports: `b3-lane-a-codex-report.md`, `b3-lane-b-codex-report.md`,
  `b3-revise-codex-report.md`.
- **Review chain** (Claude reviewers, never the implementer):
  - Base: `b3-code-logic-review.md`, `b3-code-style-review.md` — both NEEDS_REVISION.
  - Delta (after revise round 1): `b3-code-logic-review-delta.md` raised a new Serious defect (a
    failed admission hand-off rejected the already-succeeded replay, so the loader ran failure
    recovery on a successful tab) plus Moderates (no real C2 x C3 spec, stale perf-helper prose);
    `b3-code-style-review-delta.md` APPROVED with 2 minors.
  - Delta 2 (after revise round 2): `b3-code-logic-review-delta2.md` APPROVED (1 Moderate = AC 9
    text, reconciled above); `b3-code-style-review-delta2.md` APPROVED.
- **Revise cap**: 2 of 2 used.
- **Evidence (lane-reported, team-leader did not run tests)**: `run-many -t test` header 3
  projects — core 719, chat 1,245 passed + 2 skipped, canvas 121; typecheck 3 projects exit 0;
  lint 4 projects 0 errors; prettier clean; degradation audit TOTAL 303 (= reference).
- **Team-leader verification**: all 12 modified files + new
  `session-history-replayer.admission.spec.ts` exist with real implementations (no
  TODO/PLACEHOLDER/STUB in the product files); `git status --short` has no stray files
  (`macrotask-scheduler.ts` is a 2-line reviewed doc pointer, style delta Minor 2);
  `git grep "canvasSessionRequest(\|clearCanvasSessionRequest"` returns nothing;
  `session-history-replayer.service.ts` is 445 lines (< 700).
- **Also carried in this commit**: `implementation-plan.md` C1 subsection 1a (architect's M0 scope
  decision) and its two `batches.md` amendments (Task 4.1 AC 6 "why" clause, Task 5.1 AC 5 live
  direction case).
- **Follow-ups**: FU-20a (global status may read `loaded` while a later replay waits — noted in
  chat CLAUDE.md, no fix planned); C2 per-tile latency cost measured in Batch 6 (Task 6.1 AC 2).

## Batch 4: C1 replay motion gate — COMPLETE (commit `408ddffb2`)

- Recommended executor: CLI lane `codex` x 1
- Fallback executor: Claude `frontend-developer` sub-agent
- Execution mode: sequential
- Rationale: cross-file signal threading (replayer → chat-view → transcript → bubble → agent
  bubble) with specs; one mind in order.
- Tasks: 1 | Depends on: Batch 3 (replayer file shared with C2)
- Review: `code-logic-reviewer` + `code-style-reviewer` → fixes → delta → commit.

### Task 4.1: Replay-tab signal and `motionSuppressed` gate — COMPLETE

- Files:
  - MODIFY `W\libs\frontend\chat\src\lib\services\chat-store\session-history-replayer.service.ts`
  - MODIFY `W\libs\frontend\chat\src\lib\services\chat-store\session-history-replayer.service.spec.ts`
    (or add cases to `session-history-replayer.admission.spec.ts` if they fit there better — pick
    one file, not both)
  - MODIFY `W\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts` (1,296 lines; add only the injection + one accessor)
  - MODIFY `W\libs\frontend\chat\src\lib\components\templates\chat-view.component.html` (transcript :65-72)
  - MODIFY `W\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.ts` (616 lines)
  - MODIFY `W\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.html` (:22)
  - MODIFY `W\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.html` (:129-130, :159-160)
  - MODIFY `W\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.spec.ts`
  - MODIFY `W\libs\frontend\chat\src\lib\components\organisms\execution\inline-agent-bubble.component.ts` (:449, :517-518)
  - MODIFY `W\libs\frontend\chat\src\lib\components\organisms\execution\inline-agent-bubble.component.spec.ts`
  - CREATE `W\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.replay-motion.spec.ts`
  - MODIFY `W\libs\frontend\chat\CLAUDE.md` — rule 7: add one bullet **Replay-tab signal**
- Plan reference: implementation-plan.md:190-259 (C1), S1-AC2 :483-486, A3/A4 :161-165
- Pattern to follow: chat-view injecting chat-store services (:157-160); transcript inputs;
  `execution-node.component.ts` `[class.exec-fade-in]="!isFinalizing()"` (:127) and
  `flipAnimationDisabled` (:362-364).
- Acceptance criteria:
  1. Replayer: private writable `signal<ReadonlySet<string>>`, public readonly
     `replayingTabIds`, and `isReplaying(tabId: string): boolean` (signal read). Tab id added on
     `replay()` entry before admission and before the first chunk; removed in a `finally` on every
     exit; removal keyed by claim number so an older replay's `finally` never clears a newer
     replay of the same tab (track claim per tab; remove only if the stored claim matches).
     Cleared in the same synchronous task as `finalizeSessionHistory` + `closeFence`.
  2. Flag comes only from the replayer — never from tab `status === 'resuming'` (live continue
     `markResuming`, message-sender :632-633, must keep motion).
  3. `ChatViewComponent` binds `[historyReplaying]="<replayer>.isReplaying(tabId)"` on each
     `<ptah-chat-transcript>` (html :65-72).
  4. Transcript: `historyReplaying = input<boolean>(false)`; `motionSuppressed = computed(() =>
this.historyReplaying() || this.isFinalizingTransition())`; template :22 binds
     `[isFinalizing]="motionSuppressed()"`. `isFinalizingTransition` itself unchanged. No edit to
     scroll methods/CSS; no `content-visibility`.
  5. Bubble html :129-130 and :159-160 → `[animate.enter]="isFinalizing() ? '' : 'bubble-fade-enter'"`
     and `[animate.leave]="isFinalizing() ? '' : 'bubble-fade-leave'"` (value `''`, never `null`).
  6. Inline agent bubble: `[autoAnimateDisabled]="isFinalizing()"` on the `[auto-animate]`
     container (:449); footer :517-518 → bound forms with `'agent-fade-in'` / `'agent-fade-out'`.
     Toast at :413 unchanged. `execution-node.component.ts` unchanged: its `scheduleFrame` rAF
     branch is gated by `isNodeStreaming()` (`:348-350, 385-404`), not by `isFinalizing()`, and is
     recovered in Batch 5 by C5's `streamingBoundary` binding. Task 4.1 must NOT add a second gate
     for it (implementation-plan.md C1 subsection 1a).
  7. Specs: replayer — flag set on entry, cleared on replayed / superseded / throw, claim-keyed
     clear across a superseding replay. `chat-transcript.replay-motion.spec.ts` — with
     `historyReplaying` true bubbles get `isFinalizing = true`; after it turns false and status
     settles, stays true for 300 ms then false (fake timers); first finalized render already
     suppressed (A3). Bubble — `isFinalizing` true: no `bubble-fade-enter` class on the badge and
     no `requestAnimationFrame` call for it; false: class added. Agent bubble — no auto-animate
     controller while `isFinalizing` true.
  8. CLAUDE.md rule 7 bullet: replay-tab set lifecycle (entry → claim-keyed `finally`), consumers
     read it via `isReplaying`, gate = `historyReplaying || isFinalizingTransition`, never key on
     `resuming`.
- Verification: tests `-p @ptah-extension/chat` (header 1; scroll-work specs and Gate A
  `chat-transcript.component.spec.ts:556` green); typecheck and lint `@ptah-extension/chat
ptah-extension-webview`; `npx nx run ptah-extension-webview:build:development` and
  `npx nx run ptah-extension-webview:build:production` both succeed (E25 bound animate form);
  audit TOTAL = reference; `git diff` shows no `content-visibility` and no hunk in `onScroll`,
  `scheduleStickToBottom`, `restoreScrollOnActivation`, `chat-transcript.component.css`;
  `grep -n "isFinalizingTransition()" chat-transcript.component.html` returns nothing.

### Batch 4 outcome

- **Executor**: one CLI lane `codex` session — base implementation, then revise round 1 in the
  same lane. Report: `b4-codex-report.md` (base + "Revise round 1").
- **Review chain** (Claude reviewers, never the implementer):
  - Base: `b4-code-logic-review.md` NEEDS_REVISION (Serious: zoneless gap between the replayer
    clearing its flag and `SessionLoaderService` `setStatus('loaded')`; M3: no per-tab ChatView
    propagation proof); `b4-code-style-review.md` APPROVED.
  - Delta: `b4-code-logic-review-delta.md` APPROVED (1 Moderate carried, M1);
    `b4-code-style-review-delta.md` APPROVED (2 Minors).
- **Revise cap**: 1 of 2 used.
- **Design addition beyond AC 4 (recorded)**: `motionSuppressed` also reads a transcript-local
  falling-edge `replayMotionHold` (300 ms, started when `historyReplaying` goes true → false,
  cancelled by a new replay and on destroy). Why: the replayer clears its flag in its `finally`
  before the loader's await continuation marks the tab `loaded`; under zoneless change detection a
  pass can run in that gap, when neither `historyReplaying` nor `isFinalizingTransition` is true,
  and would re-expose bubble motion. The hold keeps suppression continuous until the normal
  streaming → idle transition takes over. `isFinalizingTransition` itself is unchanged.
- **Recorded deviation**: `chat-view.component.spec.ts` (not in the Files list) gained the
  replayer stub and a per-tab id test, to close logic M3.
- **Evidence (lane-reported, team-leader did not run tests)**: chat tests header 1 project — 77
  suites, 1,255 passed + 2 skipped; typecheck `@ptah-extension/chat ptah-extension-webview` exit
  0; lint same 2 projects 0 errors (17 pre-existing warnings); webview `build:development` and
  `build:production` succeed (production has the existing initial-bundle budget warning);
  degradation audit TOTAL 303 (= reference); prettier clean.
- **Team-leader verification**: `git status --short` holds only Task 4.1 files, the chat-view
  spec, `b4-*.md` and `batches.md`; `execution-node.component.ts`,
  `execution-node.render-throttle.spec.ts`, `chat-transcript.component.css` have no diff;
  `git diff` has no `content-visibility` and no hunk in `onScroll`, `scheduleStickToBottom` or
  `restoreScrollOnActivation`; `grep -n "isFinalizingTransition()" chat-transcript.component.html`
  returns nothing.
- **Follow-ups**:
  - M1 (Moderate): `message-bubble.component.spec.ts` proves the enabled `bubble-fade-enter`
    binding by template string match, not a rendered class (jsdom limitation). Replace with a
    rendered-class assertion when a harness allows it.
  - Style Minor: timer-clear logic in `chat-transcript.component.ts` is partly duplicated between
    the effect and `clearReplayMotionHold()`.
  - Task 5.1: `streamingBoundary` must read raw `historyReplaying()`, never `replayMotionHold` or
    `motionSuppressed` — the hold is motion-only and must not extend the render-window fence.

## Batch 5: C5 replay render-window fence — COMPLETE (commit `b19077d03`)

- Recommended executor: CLI lane `codex` x 1
- Fallback executor: Claude `frontend-developer` sub-agent
- Execution mode: sequential
- Rationale: small change in the two transcript files C1 just edited, plus a behavioural spec.
- Tasks: 1 | Depends on: Batch 4
- Review: `code-logic-reviewer` + `code-style-reviewer` → fixes → delta → commit.

### Task 5.1: Feed the render window a replay-aware streaming boundary — COMPLETE

- Files:
  - MODIFY `W\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.ts`
  - MODIFY `W\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.html` (:21)
  - CREATE `W\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.replay-mount.spec.ts`
- Plan reference: implementation-plan.md:411-475 (C5), S1-AC4 :490-493
- Pattern to follow: `TranscriptViewModel` (:96-112) and `vm` (:399-419); render-window feeding
  effect (:482-491); `transcript-render-window.spec.ts` for observer-driven mount assertions.
- Acceptance criteria:
  1. `TranscriptViewModel` gains `streamingBoundary: number` (default object :106-112 too);
     `vm` sets `streamingBoundary = this.historyReplaying() ? totalCount : finalizedCount`.
  2. Feeding effect passes `view.streamingBoundary` instead of `view.finalizedCount` (:489).
  3. Template :21 → `[isStreaming]="i >= vm().streamingBoundary"`.
  4. `vm().isStreaming` (skeleton :39), `TranscriptRenderWindow`, scroll methods, CSS unchanged;
     no `content-visibility`; spec never references `isAdjusting`.
  5. Spec with a LOCAL fake `IntersectionObserver` (do not edit `chat-transcript.component.spec.ts`):
     while replaying, a 50-message streaming list mounts only the last 6 until the observer
     reports; a slot reported intersecting stays mounted when it leaves the tail (A7); replayed
     bubbles get `isStreaming = false`; with `historyReplaying` false and a live streaming
     message present, the message at index `>= finalizedCount` gets `isStreaming = true` (live
     typing-throttle regression guard, one test of its own — implementation-plan.md C1 subsection
     1a); after replay ends and status settles, a live streaming message is exempt from the
     window again. `execution-node.render-throttle.spec.ts` stays green and unedited.
- Verification: tests `-p @ptah-extension/chat` (header 1; Gate A :556 and scroll specs green);
  typecheck and lint `@ptah-extension/chat`; audit TOTAL = reference; same `content-visibility` /
  scroll-method diff check as Batch 4.

### Batch 5 outcome

- **Executor**: one CLI lane `codex` session — base implementation, then revise round 1 in the
  same lane. Report: `b5-codex-report.md` (base + "Revise round 1").
- **Review chain** (Claude reviewers, never the implementer):
  - Base: `b5-code-logic-review.md` APPROVED; `b5-code-style-review.md` NEEDS_REVISION (Serious 1:
    dead `TranscriptViewModel.finalizedCount`; Serious 2: `syncMessages` parameter still named
    `finalizedCount`; 2 Minors: boundary rationale doc, chat CLAUDE.md contract bullet).
  - Delta: `b5-code-logic-review-delta.md` APPROVED (1 Moderate carried);
    `b5-code-style-review-delta.md` APPROVED.
- **Revise cap**: 1 of 2 used.
- **Recorded scope extension**: `transcript-render-window.ts` and `transcript-render-window.spec.ts`
  (not in the Files list) — parameter rename `finalizedCount` → `streamingBoundary` plus its doc,
  no policy change, to close style Serious 2. `libs/frontend/chat/CLAUDE.md` rule 7 gained one
  **Replay boundary** bullet (style Minor).
- **Evidence (lane-reported, team-leader did not run tests)**: chat tests header 1 project — 78
  suites, 1,259 passed + 2 skipped; typecheck `@ptah-extension/chat ptah-extension-webview` exit
  0; lint chat 0 errors (17 pre-existing warnings); webview `build:production` succeeds (existing
  initial-bundle budget warning); degradation audit TOTAL 303 (= reference); prettier clean.
- **Team-leader verification**: `git status --short` holds only the Task 5.1 files, the two
  render-window files, chat `CLAUDE.md` and `b5-*.md`; no `agent-output-root.md` remains;
  `execution-node.component.ts`, `execution-node.render-throttle.spec.ts`,
  `chat-transcript.component.css` have no diff; `git diff` has no `content-visibility` and no hunk
  in a scroll method; template binds `i >= vm().streamingBoundary`; `streamingBoundary` reads raw
  `historyReplaying()`; new spec has no TODO/PLACEHOLDER/STUB and no `isAdjusting`.
- **Follow-ups**:
  - Moderate (logic, carried): a compaction-targeted reload can race an in-flight replay because
    it skips the up-front `applyResumingSession` reset (`session-loader.service.ts:677-691`). No
    regression test pins the ordering.
  - Logic: a throw mid-replay leaves a short window between the replayer's `finally` clearing the
    flag and the loader applying `applyResumeFailure`. No throw-path state-transition test.
  - Style (accepted): the transcript spec harness is copied three times
    (`chat-transcript.component.spec.ts`, `.replay-motion.spec.ts`, `.replay-mount.spec.ts`).
  - A8 residual: check it in the M1 rAF histogram (Task 6.1).

## Batch 6: M1 measurement and decision point — COMPLETE

- Recommended executor: Claude `senior-tester` sub-agent
- Fallback executor: none (idle machine required)
- Execution mode: sequential
- Tasks: 1 | Depends on: Batches 3, 4, 5 committed (C1, C2, C3, C5 all in the build)
- Review: `code-logic-reviewer` on the report methodology; team-leader commits the report.

### Task 6.1: M1 run set, AC-11 verdict — COMPLETE

- File: MODIFY `W\.ptah\specs\TASK_2026_453_1eb4\test-report.md` (M1 section beside M0)
- Plan reference: implementation-plan.md:523-529, S1-AC4 :490-493
- Acceptance criteria:
  1. Same run set and protocol as Task 2.1, plus the scroll sanity check on every run.
  2. Per-tile wall time (C2 latency cost) and DOM count during replay ≤ 2× the settled count.
  3. AC-11 MET only if all 3 cold dev runs AND the production cold run have `max <= 200` and
     `total <= 1500` with `settled: true`. Otherwise report the remaining gap (max, total), rAF
     histogram, DOM counts, and main-thread trace shares, and return to the orchestrator for the
     Stage 2 user decision ((iii-b) / (ii) / (i), plan :531-555). No Stage 2 code without it.

### Batch 6 outcome

- **Verdict: AC-11 NOT MET.** Every dev cold run fails total blocked time; 2 of 3 also fail max.
  Production cold passes both budgets for the first time in this task.
- **Executor**: Claude `senior-tester` sub-agent on HEAD `0149adef8`, idle machine (0
  `jest-worker` / `run-executor` before and after all 13 attempts). No product or spec code diff.

| Metric                                      | Budget   | M0 dev cold (I/J/K)   | M1 dev cold (1/2/3-retry) | M0 production | M1 production |
| ------------------------------------------- | -------- | --------------------- | ------------------------- | ------------- | ------------- |
| Max long task (ms)                          | <= 200   | 1,926 / 1,326 / 1,062 | 220 / 337 / 185           | 1,201         | 166           |
| Total blocked (ms)                          | <= 1,500 | 6,941 / 5,463 / 4,077 | 3,226 / 4,927 / 2,169     | 4,767         | 985           |
| DOM replaying/settled (whole-canvas)        | <= 2×    | ~3.5-4.3×             | 0.365× / 0.246× / 0.303×  | ~3.5-3.7×     | 0.366×        |
| `scheduleFrame` share of rAF (2,000 events) | —        | 88.3 % (1,339)        | 5.0 % (7)                 | —             | —             |

- **Discarded / retried attempts**: none discarded for idle contamination. Two attempts failed
  scroll sanity before any perf data was written (cold dev run 3, trace 2,000 events). Each was
  retried once, cleanly; the retry supplies that slot. The report discloses that the substitution
  may bias the 3-run sample low (read it as a lower bound on the gap).
- **AC status**: AC 1 COMPLETE; **AC 2 PARTIAL** (per-tile wall time delivered; DOM <= 2× measured
  whole-canvas only, the harness has no per-tile DOM field); AC 3 COMPLETE (verdict logic applied).
- **Scroll-sanity regression (new, blocking, functional)**: 2 of 11 scroll-sanity attempts failed on
  the last-clicked, still-replaying tile — `TILE_1` 132 px and `TILE_2` 31,155 px from bottom
  (budget 120 px). This is the Task 5.1 tail-shift residual risk; it is on committed Batch 5 code.
  **Correction (scroll-regression-analysis.md F5)**: `TILE_1` is the **middle** tile, not the
  last-clicked one. Both failing tiles had their replay queued behind C2 admission. Root cause and
  fix: `scroll-regression-analysis.md` §1 H1 and §2; fix is Batch 7, re-check is Batch 8.
- **Review chain**: `code-logic-reviewer` on methodology — base `b6-m1-methodology-review.md`
  NEEDS_REVISION (5 findings: warm 1-tile `preWindowExcluded`, idle-attempt count, trace
  `preWindowExcluded` column, AC 2 reported as a per-tile pass, undisclosed retry bias); Delta
  (same file) APPROVED, all 5 closed against raw JSON and logs. Revise cap: 1 of 2 used.
- **USER DECISIONS 2026-09-16**:
  1. Stage 2: option **(ii) tail-paged history** is chosen for the remaining AC-11 gap.
  2. Scroll regression: the architect finds the cause, then a codex lane fixes it inside C5 with
     logic + style reviews, then the scroll check is repeated — all before any Stage 2 code.
- **Next**: Stage 2 batches (and the scroll-fix batch) are added to this file after the architect
  design lands in `implementation-plan.md`. No Stage 2 batch exists yet.
- **Follow-ups**: per-tile DOM sampling in `perf-page-capture.ts` (carried from Batch 2 item 5)
  is needed before AC 2 can close; two unattributed minified rAF sites (14.4 %); no `GPUTask` in
  trace.

---

## Scroll-fix validation (Batches 7-8)

Status: PASSED WITH RISKS. Source: `scroll-regression-analysis.md` (architect, read-only analysis
at HEAD `0149adef8`; worktree now `d8951fa03`, docs-only since). Anchors re-checked at
`d8951fa03`: `transcript-render-window.ts` 229 lines (`PLACEHOLDER_FALLBACK_PX` :24,
`syncMessages` :119, `setActive` :138, `isMounted` :143, `handleEntries` :166, `evictAbsent`
:201); `chat-transcript.component.ts` 673 lines (`scrollRafId` :208, `replayMotionHold` :272,
`streamingBoundary` :429, feed effect `setActive` / `syncMessages` :534-537, `onScroll` :562,
`cleanup()` :650); `chat-transcript.replay-mount.spec.ts` 362 lines; chat `CLAUDE.md` Replay
boundary bullet :77. Perf spec tests: cold asserting :191, diagnostic cold :354, warm 3-tile :502.

### Defaults chosen by team-leader (2026-09-16, per orchestrator instruction)

- D5 The fix stays inside C5's files: `transcript-render-window.ts` + spec,
  `chat-transcript.component.ts` (render-window feed effect + `cleanup()` only),
  `chat-transcript.replay-mount.spec.ts`, and the chat `CLAUDE.md` rule 7 **Replay boundary**
  bullet. `chat-transcript.component.html` is expected to have **no** diff (analysis §2.1). The
  common-rules ban stands: no edit to `onScroll`, `scheduleStickToBottom`,
  `restoreScrollOnActivation`, `lastScrollTop` or `chat-transcript.component.css`; no
  `content-visibility`.
- D6 **Accepted trade-off (S1-AC4 / A7 wording change)**: during replay the mount set is the
  monotonic union of synced tails only. Observer-reported slots that were never mounted mount only
  **after** replay ends (retention release). The A7 half (a mounted slot leaving the tail stays
  mounted) still holds, now by retention. The existing `chat-transcript.replay-mount.spec.ts:297-301`
  case ("intersecting report mounts slot 0 while replaying") is **rewritten** to the new rule,
  never deleted. User-visible cost: blank placeholders above the newest six messages while a tile
  replays (typically < 2-4 s) and for a user who scrolls up during replay. S1-AC4 in
  `implementation-plan.md` is NOT edited here (another architect owns that file now); this
  entry is the record until the plan is amended.
- D7 Release timing: one frame after the `historyReplaying` true → false edge, via a private
  `retentionReleaseRafId` separate from `scrollRafId`, **raced with a 50 ms `setTimeout`** (both
  handles cleared when either fires). Why the timer: the Task 3.2 precedent (risk "rAF never fires
  in a hidden window") and, specifically here, a release that never fires in a hidden window would
  leave retention on while later live syncs keep unioning tails into `retained` — an unbounded
  mount set for a long-lived hidden tab. This is a team-leader default, not in the analysis; the
  logic reviewer must confirm the 50 ms path does not reintroduce the H2 same-pass swap (it cannot
  run in the finalize task, because a timer is a later macrotask).
- D8 Batch 7 executor is a `codex` CLI lane (D3), reviews Claude logic + style, revise cap 2.
- D9 Batch 8 re-check runs before any Stage 2 code (user decision 2026-09-16, item 2).

### Open user decision (not in Batch 7)

- **U1 `onScroll` anchoring-aware hardening** (analysis §2.3 last bullet): treat an upward move as
  anchoring when content height changed since the last scroll event. It is the only fix that also
  covers a live stream growing below while a placeholder corrects above. It touches a forbidden
  method, so it needs the user. It becomes a **prerequisite** if the Stage 2 (ii) design lets older
  pages load while a tile is pinned with a live stream (analysis §3), and it is the escalation path
  if Batch 8 shows H1-shaped failures (distance a multiple of ~132 px). Decide together with the
  Stage 2 (ii) batches.

| Risk                                                                                        | Severity       | Mitigation                                                                                                                                 |
| ------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| H1 mis-sized swap above anchor + growth below unpins a replaying tile                       | HIGH           | Task 7.1 retention invariant; Batch 8 23-attempt re-check                                                                                  |
| H2 finalize-pass swap (small distance)                                                      | MEDIUM         | Task 7.1 deferred release; on a small-distance Batch 8 failure apply A4 (release on `replayMotionHold` falling edge), repeat Batch 8       |
| Retention bleeds into the render-window fence (rule 7 says boundary reads raw flag only)    | HIGH           | Task 7.1 AC 5: retention and boundary both read raw `historyReplaying()`; never `replayMotionHold`/`motionSuppressed` unless A4 is applied |
| Pending release fires after destroy or cancels scroll rAF                                   | MEDIUM         | Task 7.1 AC 6-7, own handle, cleared in `cleanup()`                                                                                        |
| Mounted bubbles during replay rise vs C5 today (≤ ~54 vs ~20-40) and move max/total         | MEDIUM         | Batch 8 records max/total per run beside M1; not a new AC-11 verdict                                                                       |
| A never-measured slot swaps once after release, above the anchor, while a live stream grows | LOW (residual) | U1 open decision                                                                                                                           |
| jsdom cannot reproduce the unpin                                                            | MEDIUM         | Specs pin the precondition only; Electron Batch 8 is the proof                                                                             |

Assumptions (analysis §1): A1 user bubbles < 120 px, assistant > 120 px in the fixture —
unverified, optional in Batch 8; A2 finalize changes tail height — unverified, covered by D7;
A4 one frame is enough — verified or refuted by Batch 8.

## Batch 7: C5 scroll retention fix — COMPLETE (commit: `fix(chat): keep replayed transcript mounts monotonic so tiles stay pinned`, the commit after the Stage 2 planning-docs commit)

- Recommended executor: CLI lane `codex` x 1
- Fallback executor: Claude `frontend-developer` sub-agent
- Execution mode: sequential
- Rationale: one policy object plus its one consumer and their specs, tightly coupled (the
  component edge ordering depends on the new window API). One mind, in order.
- Tasks: 1 | Depends on: Batch 6 committed; `scroll-regression-analysis.md` present
- Review: `code-logic-reviewer` + `code-style-reviewer` in parallel → fixes to the same codex lane
  → delta review → team-leader commit. **Revise cap: 2.**
- The lane must NOT edit or stage `implementation-plan.md` (another architect is editing it).

### Task 7.1: Replay mount retention in the render window — COMPLETE

- Files:
  - MODIFY `W\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-render-window.ts`
  - MODIFY `W\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-render-window.spec.ts`
  - MODIFY `W\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.ts`
    (render-window feed effect :527-548 and `cleanup()` :650-673 plus one private field only)
  - MODIFY `W\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.replay-mount.spec.ts`
  - MODIFY `W\libs\frontend\chat\CLAUDE.md` — rule 7 **Replay boundary** bullet (:77): add the
    retention rule
  - NO DIFF expected: `W\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.html`
    (if the lane believes it needs a change, it stops and reports why instead)
- Plan reference: `scroll-regression-analysis.md` §2.1 (design), §2.2 (trade-offs), §2.4 (specs),
  §2.6 (forbidden files); user decision 2026-09-16 item 2; D5-D7 above.
- Pattern to follow: `setActive` (`transcript-render-window.ts:138`) for a pure policy input;
  `sameSet` short-circuits in `syncMessages`; `replayMotionHold` edge handling
  (`chat-transcript.component.ts:460-475`) for edge detection and cancel-on-new-replay; Task 3.2
  admission paint yield (`session-history-replayer.service.ts`) for the rAF + 50 ms timer race;
  local fake `IntersectionObserver` already used in `transcript-render-window.spec.ts`; rAF spy in
  `chat-transcript.replay-mount.spec.ts:267-272`.
- Acceptance criteria:
  1. `TranscriptRenderWindow.setReplayRetention(active: boolean): void`. On → seed a private
     `retained` set (signal-backed, like `tail`/`intersecting`) with every currently mounted id
     (`tail ∪ intersecting`), so the rising edge unmounts nothing. Off → clear `retained`.
     Repeated calls with the same value do not write the signal.
  2. `syncMessages`: while retention is on, union each `nextTail` into `retained` (monotonic).
     `evictAbsent` also prunes ids no longer present from `retained`. Existing `sameSet`
     short-circuits kept, so an unchanged sync writes no signal.
  3. `isMounted`: retention on → `tail.has(id) || retained.has(id)`; an observer-reported id that
     was never mounted is **not** mounted during replay. Retention off → unchanged
     (`tail ∪ intersecting`). The `supported === false` (no `IntersectionObserver`) path still
     mounts everything.
  4. `handleEntries`: `wasMounted` also counts `retained.has(id)`, so each retained bubble's real
     height is recorded from its observer callback; `intersecting` keeps updating as today; the
     inactive early-return (:167) unchanged. After release, off-screen retained ids become
     placeholders at their **measured** height (not `PLACEHOLDER_FALLBACK_PX`); on-screen ids stay
     mounted through `intersecting`.
  5. Component rising edge: the feed effect reads raw `historyReplaying()` (same source as
     `streamingBoundary`, rule 7) and on false → true calls `setReplayRetention(true)` **before**
     `syncMessages` in the same effect run. The edge lives in the feed effect (no ordering
     dependency on effect creation order). Never reads `replayMotionHold` or `motionSuppressed`.
  6. Component falling edge: no release in the same change-detection pass as finalize. Schedule
     release on the next animation frame via a new private `retentionReleaseRafId`, separate from
     `scrollRafId` (never cancels or reuses it), raced with a 50 ms `setTimeout` (D7); whichever
     fires first calls `setReplayRetention(false)` and clears the other handle. A new rising edge
     cancels a pending release (and retention stays on).
  7. `cleanup()` cancels both pending release handles. No handle survives destroy.
  8. No diff in `onScroll`, `scheduleStickToBottom`, `restoreScrollOnActivation`, `lastScrollTop`,
     `chat-transcript.component.css`, `chat-transcript.component.html`; no `content-visibility`;
     no `TODO`/stub; no new `catch { return <literal> }`.
  9. Unit specs, `transcript-render-window.spec.ts` (pure policy, local fake observer):
     (a) retention on, ids leave the tail with no observer callback → still mounted (A7 gap);
     (b) retention on, observer reports a never-mounted id intersecting → `isMounted` false;
     (c) retention on, a retained id reported non-intersecting with height 200 → stays mounted;
     after retention off → unmounted and `placeholderHeight` is 200, not 120;
     (d) rising edge seeds from the mounted set → an intersecting id stays mounted when retention
     turns on;
     (e) `syncMessages` without an id prunes it from `retained`; retention off restores
     `tail ∪ intersecting` exactly; every existing test unchanged and green.
  10. Unit specs, `chat-transcript.replay-mount.spec.ts` (existing harness :256-286):
      (f) **monotonic mount set while replaying** — 50 → 98 → 146 trees with `detectChanges` and
      an interleaved `observer.emit` marking middle slots intersecting: no slot that held a
      `ptah-message-bubble` loses it, and no slot outside the synced tails gains one;
      (g) **deferred release** — flip `historyReplaying` false + `detectChanges`: retained bubbles
      still mounted in that pass; with a queued (not synchronous) rAF spy for this test, flush the
      rAF + `detectChanges` → non-intersecting retained slots are placeholders at the recorded
      height;
      (h) hidden-window release — rAF never fires, advance fake timers 50 ms → released, and no
      timer or rAF handle pending afterwards; destroy with a pending release → both handles
      cancelled;
      (i) rewrite the `:297-301` case to the new rule (observer-reported slot mounts only after
      release) — rewritten, not deleted; A7, `isStreaming=false`, live-throttle and live-exempt
      tests (:288-362) stay green.
      `chat-transcript.component.spec.ts` (Gate A and scroll specs),
      `chat-transcript.replay-motion.spec.ts` and `execution-node.render-throttle.spec.ts` stay
      green and **unedited**.
  11. CLAUDE.md rule 7 Replay boundary bullet gains: during replay the mount set only grows at the
      tail (retention seeded from the mounted set on the rising edge); observer-reported
      never-mounted slots mount after replay; release one frame after the flag clears (rAF raced
      with 50 ms), cancelled by a new replay and on destroy; retention reads the raw flag. One
      bullet extended, not a new duplicate bullet.
- Validation notes: H1/H2 (analysis §1), D6 trade-off, D7 timer, risk table above. jsdom cannot
  show the unpin; specs (f) and (a) are the ones that would have failed against Batch 5 code — the
  lane reports that it confirmed (a) fails without the policy change (e.g. by reasoning over the
  pre-change `isMounted`, not by committing a broken state).
- Verification order (report literal output lines; common rules apply):
  1. `npx nx run-many -t test -p @ptah-extension/chat --parallel=1 --maxWorkers=2` — header
     `Running target test for 1 project`; suite and test counts vs Batch 5 (78 suites, 1,259
     passed + 2 skipped) with the delta explained.
  2. `npx nx run-many -t typecheck -p @ptah-extension/chat ptah-extension-webview --parallel=1`
     (header 2 projects).
  3. `npx nx run-many -t lint -p @ptah-extension/chat --parallel=1` — 0 errors; new warnings
     listed (17 pre-existing).
  4. `npx nx run ptah-extension-webview:build:production` — succeeds (existing initial-bundle
     budget warning allowed).
  5. `npx nx run degradation-audit:lint --skip-nx-cache` — `degradation-audit: TOTAL 303`, no FAIL
     row, `libs/frontend/chat` ≤ 11.
  6. `npx prettier --check` on every changed file.
  7. Diff safeguards: `git status --short` lists only the Task 7.1 files (plus team-leader and
     architect docs); `git diff` has no hunk inside `onScroll`, `scheduleStickToBottom`,
     `restoreScrollOnActivation` or touching `lastScrollTop`; no diff in
     `chat-transcript.component.css`, `chat-transcript.component.html`,
     `chat-transcript.component.spec.ts`, `chat-transcript.replay-motion.spec.ts`,
     `execution-node.component.ts`, `execution-node.render-throttle.spec.ts`;
     `git diff | grep content-visibility` empty; the lane made no change to `implementation-plan.md`.

### Batch 7 verification

- Team-leader reads every file; `retentionReleaseRafId` is distinct from `scrollRafId`; the rising
  edge runs before `syncMessages`; both release handles cleared in `cleanup()`
- Lane-reported verification 1-7 with literal lines; team-leader re-runs step 7 itself
- `code-logic-reviewer` (behaviour: edge ordering, release race, hidden window, destroy, D7 vs H2)
  and `code-style-reviewer` (policy-object shape, naming, CLAUDE.md bullet, spec harness reuse)
  accepting verdicts
- D6 trade-off stated in the commit body

### Batch 7 outcome

- Executor: one codex lane (`b7-codex-report.md`, base + revise round 1). **Revise rounds used: 1
  of 2.**
- Reviews: `b7-code-logic-review.md` APPROVE, Delta APPROVE (HIGH); `b7-code-style-review.md`
  APPROVED, both minors (edge-tracker cross-reference, class doc names retention) closed per the
  logic delta.
- Revise round 1 added two specs to `chat-transcript.replay-mount.spec.ts`: a zero-tree queued
  replay (the F5 trigger shape) and an **H2 effect-order pin** (release strictly after the
  `replayMotionHold` effect starts), plus the feed-effect comment and the extended class doc.
- Carried forward: **F1 (serious, open)** — a live event growing content below during the single
  rAF / 50 ms release window can still recreate the H1 shape at lower probability. Routed to Batch 8
  (23-attempt Electron re-check) and the U1 `onScroll` escalation. Not closed by this batch by
  design (forbidden-file scope).
- Team-leader verification (read on disk, tests not re-run): diff limited to
  `transcript-render-window.ts` + spec, `chat-transcript.component.ts` (700 lines, at the warn
  ceiling), `chat-transcript.replay-mount.spec.ts`, chat `CLAUDE.md`. No diff in
  `chat-transcript.component.html` / `.css`, `onScroll`, `scheduleStickToBottom`,
  `restoreScrollOnActivation`, `lastScrollTop`, execution-node files; no `content-visibility`.
  `retentionReleaseRafId` is distinct from `scrollRafId`; the rising edge runs before
  `syncMessages`; `cleanup()` cancels both release handles.
- Lane evidence (final round): chat, 1 project, 78 suites, 1,271 passed + 2 skipped (Batch 5
  1,259; +12 retention specs); typecheck chat + webview (2 projects) green; lint 0 errors, 17
  pre-existing warnings; `ptah-extension-webview:build:production` succeeded; degradation audit
  TOTAL 303.

### Orchestrator decisions (2026-09-16)

- **V1 retarget accepted**: Task 10.2 edits `SessionRpcHandlers.sanitizeAnchorHint` to keep
  `occurrenceFromEnd`. No architect revision needed; Batch 10's V1 dependency is satisfied.
- **CLI scope: docs only** (decision 4 confirmed). Task 10.3 stays a JSON-RPC schema doc; paging
  goes through `rpc.call`.

## Batch 8: Scroll sanity re-check (Electron) — COMPLETE (commit: `test(electron-e2e): record the TASK_2026_453 scroll re-check after the retention fix`)

- Recommended executor: Claude `senior-tester` sub-agent
- Fallback executor: none (idle machine required; wait instead)
- Execution mode: sequential
- Rationale: measurement protocol on an idle machine, no product code.
- Tasks: 1 | Depends on: Batch 7 committed
- Review: `code-logic-reviewer` on the report methodology; team-leader commits the report.
- **Peer hold protocol** (handoff.md §6 rule 4): before the first run the orchestrator asks the
  peer sessions sharing this machine (the `continue-task` session and any other active one) to
  hold heavy passes, and releases the hold when the last run ends. The report records when the
  hold was requested and released.

### Task 8.1: 23-attempt scroll re-check + M1 correction — COMPLETE

- **Outcome: PASS — 0 scroll-sanity failures in 23 counted attempts** (evidence: `test-report.md`
  "Batch 8 — scroll re-check (post Batch 7)"; review `b8-methodology-review.md` APPROVED).
- 3 of 10 asserting runs met the AC-11 budget (runs 1, 6, 9). Comparison only, not an AC-11
  verdict (AC 4); the verdict belongs to M2 (Batch 15).
- One asserting attempt was discarded: a Playwright worker crash at 0 ms before Electron launched
  (`b8-cold4.log`, code 3221226505, idle `0/0`). It carries no scroll evidence and was re-run as
  cold asserting 4; the 23 count excludes it.
- Review process notes (moderate, do not change the PASS):
  1. Infra anomalies (such as the worker crash) are flagged to the orchestrator before a retry is
     spent, because AC 5 says no retry substitutes for a failed attempt.
  2. Idle-check counts were asserted, not retained as artifacts. **Batch 15 (M2) must persist the
     idle-check stdout before and after every run to a log file** beside the run logs.

- File: MODIFY `W\.ptah\specs\TASK_2026_453_1eb4\test-report.md` (new "Scroll re-check (post
  Batch 7)" section after M1; plus one correction in M1)
- Plan reference: `scroll-regression-analysis.md` §2.5 (protocol), §1 (H1/H2 shapes), F5
- Acceptance criteria:
  1. `git log --oneline -1` equals the Batch 7 commit; `git status --short` shows no product or
     spec change.
  2. Environment: idle command (test-report.md "Environment", `Get-CimInstance ...
jest-worker|run-executor`) returns `0` **before and after every run**; contaminated runs are
     discarded and re-run, never counted. Dev build via the e2e target (`build-dev` +
     `copy-renderer-dev`); `PTAH_PERF_SPECS=1`; `PTAH_PERF_OUT_DIR` outside the repo (e.g.
     `D:\projects\ptah-453-perf\scroll-recheck`).
  3. Runs:
     - **10×** cold asserting test (spec :191). A budget failure after the scroll check is a scroll
       PASS; the `wall=` line is the evidence.
     - **10×** diagnostic cold test (spec :354) with `PTAH_PERF_TRACE=1 PTAH_PERF_EVENTS=2000`.
     - **3×** warm 3-tile (spec :502).
  4. Per attempt: scroll-sanity result per tile (distance from bottom), plus **max, total, count,
     `preWindowExcluded`, `settled`, wall, DOM replaying/settled** — the retention change may move
     max/total, so report them beside M1 in a table. Not a new AC-11 verdict unless the
     orchestrator asks.
  5. Pass: **0 scroll-sanity failures in 23 attempts**. Any failure: record tile, distance, run
     shape; classify — distance a multiple of ~132 px → H1 not closed (escalate U1 to the user);
     distance < 132 px → H2 (recommend the A4 extension: release on the `replayMotionHold` falling
     edge, then repeat this batch). No retry substitutes for a failed attempt in the 23 count.
  6. Optional, if cheap: A1/A2 slot-height readings (analysis §1 "Assumptions to confirm") via a
     throwaway `page.evaluate`; no committed spec change.
  7. **Correction in the M1 section**: test-report.md :502 (and the M1 scroll table row :489 if it
     implies it) says the failing tiles were the "last-clicked/still-replaying tile". `TILE_1` is
     the **middle** tile; `TILE_2` is the last-clicked. Both had replays queued behind C2
     admission. Add the correction in place with a pointer to `scroll-regression-analysis.md` F5;
     keep the original numbers.
  8. List every diagnostics JSON and console log path used.

### Batch 8 verification

- 23 counted attempts, idle `0/0` on each, JSON timestamps monotonic
- Scroll verdict computed from per-tile distances, not from test pass/fail alone
- `code-logic-reviewer` accepts the methodology
- On PASS: scroll regression closed, Stage 2 may start. On FAIL: return to the orchestrator with the
  H1/H2 classification before any Stage 2 batch

## Stage 2 (ii) tail-paged history (Batches 9-17) + post-Stage-2 follow-ups (Batch 18)

Source: `implementation-plan.md` "Stage 2 — (ii) tail-paged history" (C6-C14, (ii).7 ACs, (ii).8
M2). Citations re-checked at `d8951fa03` (no product diff since `0149adef8`; Batch 7 not yet on
disk). **Every Stage 2 batch depends on Batch 8 PASS** (0 scroll-sanity failures in 23 attempts).
Batch 13 (C13) and Batch 15 (M2) also depend on it explicitly, because they edit or re-measure the
transcript scroll path Batch 7 changes.

### User decisions 2026-09-16 (also in implementation-plan.md "Resolved user questions")

1. Initial page: 250 events, whole turns.
2. Load older: button plus auto-load that turns on only after the user scrolls up.
3. Stale cursor: show an error telling the user to reopen the session. No automatic re-open.
4. CLI scope: docs only; paging through `rpc.call` (orchestrator default, recommended; no objection).
5. If M2 meets total but fails the 200 ms max: drop the initial page to 150 events and re-measure
   without asking again. The budget (max <= 200 ms, total <= 1,500 ms) is never loosened.

### Plan validation (Stage 2)

Status: **PASSED WITH RISKS — one blocking-class invalid assumption (V1)**. V1 is contained in
`rpc-handlers` and does not change the architecture, so it is retargeted in Task 10.2. It blocks
Batch 10 only until the orchestrator accepts the retarget; if it does not, send V1 to the architect.
Batch 9 and Batch 11 do not touch it.

| #   | Class                             | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Evidence                                                                                                                                            | Action                                                                                                                                                                                                               |
| --- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | **BLOCKING (invalid assumption)** | The plan assumes the anchor hint is Zod-validated in `session-rpc.schema.ts`. It is not. `SessionRpcHandlers.sanitizeAnchorHint` rebuilds the hint as `{ text, occurrence }`, so a new `occurrenceFromEnd` is **silently dropped** before it reaches the reader. `grep anchorHint libs/backend/rpc-handlers/src/lib/handlers/*.schema.ts` is empty.                                                                                                                                                                                                                                                                                                                                                                                                      | `session-rpc.handlers.ts:247-260`, called `:1044`, `:1112`                                                                                          | Task 10.2 edits `sanitizeAnchorHint` (non-negative integer or absent) + a spec in `session-rpc.handlers.spec.ts`. No schema file is edited for the hint.                                                             |
| V2  | ASSUMPTION (partly invalid)       | A-ii-5 site list is wrong. `message-sender.service.ts:400` is not a `setMessages` site. Actual `[...tab.messages, x]`-style writers: `message-dispatch.service.ts:256, :313`; `message-sender.service.ts:642, :733`; `message-finalization.service.ts:566, :635`; `streaming-handler.service.ts:645`.                                                                                                                                                                                                                                                                                                                                                                                                                                                    | grep                                                                                                                                                | Task 11.1 audits all seven for an `await` between read and write. Any await found is a blocking finding returned before commit.                                                                                      |
| V3  | RISK MEDIUM                       | C8 replaces the `SDK_SESSION_HISTORY_READER` injection in `ChatSessionService` (`:136-137`) but its file list omits the four specs that construct it with that token.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `chat-continue-slash-before-resume.spec.ts`, `chat-session-auth.spec.ts`, `chat-session-mcp-status.spec.ts`, `chat-session-resume-activate.spec.ts` | Task 10.2 lists them; injection-only edits, no assertion weakened.                                                                                                                                                   |
| V4  | RISK MEDIUM (commit hygiene)      | Adding `chat:history-page` to `RpcMethodRegistry` (`rpc.types.ts:645`) and `RPC_METHOD_ENTRIES` (`:3367`, `Record<RpcMethodName, true>`) without `ChatRpcHandlers.METHODS` breaks `rpc-allowlist.spec.ts` (manifest must partition `RPC_METHOD_NAMES` exactly) for the Batch 9 commit.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `rpc-allowlist.spec.ts:1-40`; `manifest.ts:142`                                                                                                     | D10: Batch 9 adds the Params/Result types only; registry + entries + `METHODS` land together in Task 10.2.                                                                                                           |
| V5  | RISK MEDIUM (scroll)              | A tail of <= 250 events replays AND finalizes in one synchronous task (P15, confirmed `session-history-replayer.service.ts:193-227`, fast path `:249-253`). No change-detection pass sees `historyReplaying` true, so C5's replay boundary and Batch 7's retention are **inert for tail pages**. After finalize, ~40 never-measured slots swap after replay. Safe when nothing grows below (analysis §2.1). H1-shaped only for `activate: true` resumes whose held live chunks are delivered in the same task and keep growing. The same holds for older pages (C12 does not mark the tab replaying), so analysis §3's "reuse retention around page-ins" is **not** in the plan. This behaviour already exists today for every session of <= 250 events. | replayer `:193-227`; C12 text                                                                                                                       | Accepted with checks: M2 scroll sanity on every run (non-live); Task 14.2 pinned-prepend case; U1 stays the escalation path (see U1 conclusion). Do not add a second window mechanism.                               |
| V6  | RISK LOW                          | `chat-transcript.component.ts` is 673 lines before Batch 7. Batch 7 adds a field, edge handling and cleanup, so C13's inputs/output/vm field can cross the 700 warn ceiling.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `wc -l`                                                                                                                                             | Superseded 2026-09-16 (user): Task 13.0 dedupes the timer-clear first; Task 13.1 keeps UI logic in the directive and reports the count; if the file is still > 700, Task 13.2 applies the facade rule in this batch. |
| V7  | RISK LOW                          | Transcript and chat-view citations (P19, C13 `:180-198`, chat-view html `:64-72`) shift after Batch 7. Current: transcript inputs `:190-198`; chat-view html transcript binding `:64-72`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | read                                                                                                                                                | Tasks 12.2 and 13.1 re-cite at batch start.                                                                                                                                                                          |
| V8  | RISK MEDIUM                       | The perf mock resolver is a **stringified function evaluated in the renderer** (`perf-session-fixture.ts:200`), so it cannot call `selectHistoryPage`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | fixture `:163-201`                                                                                                                                  | Task 14.1 precomputes, in Node with the shared pager, the tail result and a `cursor → page` map per session, and serialises them into the resolver strings.                                                          |
| V9  | RISK LOW                          | Fixture message ids are `u-${turn}` / `a-${turn}` (`perf-session-fixture.ts:70-71`). They match the cursor charset `[A-Za-z0-9_-]`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | read                                                                                                                                                | Task 9.1 spec includes a `u-12`-style id.                                                                                                                                                                            |
| V10 | RISK LOW                          | Large files: `chat-view.component.ts` 1,302, `session-loader.service.ts` 1,350, `tab-manager.service.ts` 2,615, `session-history-reader.service.ts` 1,086, `chat-session.service.ts` 1,419. All are already past 1,000 lines.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `wc -l`                                                                                                                                             | Additions stay within the plan's line budgets (loader +~5, chat-view +~20); `chat-session.service.ts` must not grow; reviewers check.                                                                                |

Verified (OK): P1 `rpc-chat.types.ts:210, :233`; P2 `rpc.types.ts:645, :3373`; P3 `chat:` in
`ALLOWED_METHOD_PREFIXES` (`rpc-handler.ts:44-46`), so no prefix edit; P4 `METHODS` `:86-94`,
manifest `:142`; P5 `ChatResumeParamsSchema` `:70-75` `.passthrough()`; P6 `:876`, `:901`, `:910`;
P7 `resolveResumeWorkingDirectory` `:778`, `historyReader` used only at `:876`; P8 reader side
effects `:205-208, :271-277, :280-284`; P9 user `messageId = msg.uuid || generateId()`
(`session-replay.service.ts` user branch), `generateId` `history-event-factory.ts:473-475`; P10 the
only root user `message_start` is emitted at `session-replay.service.ts:189`, and the open assistant
message is completed **before** it, so a cut there never splits a message, tool pair or subtree;
P11 `OUTPUT_CURSOR_STALE` `rpc-error-codes.types.ts:20`, loader `:1122-1162`; P14 loader `:702-713`,
`:728`, `:766`, `:782`, `:824`; P15 as V5; P16 `finalizeSessionHistory` `:326-444`, key `:339`;
P21 `buildAnchorHint` `chat-view.component.ts:939-957`; P23 `tab-persistence.ts:105-117`;
compaction cut `session-replay.service.ts:91-104`; `RpcUserError` `vscode-core rpc-types.ts:87`.

### U1 conclusion (onScroll anchoring hardening)

**Not required for Stage 2 (ii). It stays an open escalation path, not a prerequisite.** Why:

- Auto-load arms only after the user scrolls up (decision 2). That same upward scroll already
  unpins the tile through the PR #519 rule (`movedUp && distanceFromBottom > 1`). The button sits
  at the top of the content, so reaching it also means scrolling up. Page-ins therefore land while
  the tile is **unpinned**, which is the case analysis §3 does not flag.
- Pinned page-ins are limited to two cases. (a) The user scrolls back to the bottom (re-pins)
  before the page reply lands. (b) The button is pressed on a transcript that is not scrollable.
  Neither case grows content below unless a live stream is running. Task 14.2 pins case (b)
  without a stream.
- Residual (LOW): a pinned page-in, or an `activate: true` tail finalize (V5), coinciding with
  live-stream growth below. Outcome: the tile stops following the stream until the user scrolls
  to the bottom (the re-pin rule).
- **Escalate U1 to the user if**: M2 scroll sanity fails with an H1-shaped distance (a multiple
  of ~132 px); OR Task 14.2's pinned-prepend case unpins; OR a live-stream unpin is reported.

### Defaults chosen by team-leader (Stage 2)

- D10 Executor per code batch: `codex` CLI lane (D3), one lane per batch. Fallback: the plan's
  Claude agent (backend-developer for C6-C8, frontend-developer for C10-C13, senior-tester for
  C14). Reviews: Claude `code-logic-reviewer` + `code-style-reviewer` in parallel, never the
  implementer; revise cap 2. Measurements: Claude `senior-tester`. Commits: team-leader only.
  Registry/entries for `chat:history-page` move from C6 to Task 10.2 (V4).
- D11 Constants: C6 exports `HISTORY_TAIL_PAGE_EVENTS = 250` (initial page; read only by
  `HistoryPagingService.tailRequest()` and the perf mock), `HISTORY_PAGE_DEFAULT_EVENTS = 250`
  (older pages, server default), and `HISTORY_PAGE_MAX_EVENTS = 2000`. The decision-5 fallback then
  changes one line and leaves older pages at 250.
- D12 C9 is split by owner. The CLI doc goes in Batch 10 (with the contract it describes). The
  chat `CLAUDE.md` Tail-paging bullet goes in Batch 12 (with the behaviour it describes).
- D13 Concurrency: Batch 11 imports nothing from C6 and may run beside Batch 9 or Batch 10. Never
  more than 2 lanes at once (at most 2 test runners). Batches 12-14 are sequential (shared `chat`
  lib, and chat-view ts/html pairs). No `project.json` edits, so no `nx reset`.
- D14 Stale cursor UX (decision 3): `loadOlder` returns `'stale'` and sets the cursor to `null`, so
  the button hides. `ChatViewComponent` shows `showActionError` with text telling the user to
  reopen the session. No `chat:resume` is sent automatically.
- D15 Follow-up folds (user instruction 2026-09-16, source `leftovers-inventory.md` Table B and
  "Recommended grouping (1)"):
  - B3 (compaction reload vs in-flight replay) and B4 (throw-mid-replay window) → Task 12.4.
  - B11 (duplicated timer-clear) → Task 13.0; B12 (700-line file) → Task 13.1 AC 1 count +
    conditional Task 13.2 facade split. This overrides the inventory's "split after M2" and the
    V6 "no split" action.
  - B6 (per-tile DOM sampling), B8 (`startTraceCapture` try/catch), B7 (conditional
    `assertScrollSanity` split) → Task 14.1 ACs 4-6. M2 (Task 15.1) then requires the per-tile
    DOM ratio, so M1 AC 2 PARTIAL closes at M2.
  - B13 (shared transcript spec harness) and B10 (message-bubble rendered-class assertion, if
    feasible) → Batch 18, after Batch 15/17 and before PR #524 leaves draft.
  - B9 (Jest target for e2e perf helpers) needs a `project.json` edit + `nx reset` → NOT on this
    branch; recorded under "Out-of-branch follow-ups" at the end of this file.
  - No change: B1 (Batch 8), B2 (U1 escalation), B5 FU-20a (accepted; re-read in Batch 12
    review), B14 (info; re-check only if M2 fails AC-11).

### Stage 2 common verification (add to the common rules for every Stage 2 code lane)

1. Tests: `npx nx run-many -t test -p <projects> --parallel=1 --maxWorkers=2`; quote the header;
   N must equal the count listed.
2. `npx nx run-many -t typecheck -p <touched projects> ptah-extension-webview ptah-electron
ptah-extension-vscode ptah-cli --parallel=1` (drop any app a batch cannot affect only where
   stated).
3. `npx nx run-many -t lint -p <touched projects> --parallel=1` — 0 errors; list new warnings.
4. Builds where stated: `npx nx run ptah-extension-webview:build:development` and
   `:build:production` (existing initial-bundle budget warning allowed).
5. `npx nx run degradation-audit:lint --skip-nx-cache` — `degradation-audit: TOTAL 303`, no FAIL
   row; quote touched-directory rows.
6. `npx prettier --check <every changed file>`.
7. Diff safeguards: `git status --short` lists only the batch's files; no hunk in `onScroll`,
   `scheduleStickToBottom`, `restoreScrollOnActivation`, `lastScrollTop`; no diff in
   `chat-transcript.component.css`; `git diff | grep content-visibility` empty; no
   `ALLOWED_METHOD_PREFIXES` diff; no TODO/stub; no new `catch { return <literal> }`.

## Batch 9: C6 paged history contract (`libs/shared`) — COMPLETE (commit: `feat(shared): add tail history page contracts and cursor utils`)

- Recommended executor: CLI lane `codex` x 1
- Fallback executor: Claude `backend-developer` sub-agent
- Execution mode: sequential
- Rationale: one pure util + wire types in one lib; the foundation every later batch imports.
- Tasks: 1 | Depends on: Batch 8 PASS
- Review: logic + style in parallel → same lane → delta → commit. Revise cap 2.

### Task 9.1: Page selection, cursor, wire types, error code, anchor hint field — COMPLETE

- Files:
  - CREATE `W\libs\shared\src\lib\utils\history-page.utils.ts`
  - CREATE `W\libs\shared\src\lib\utils\history-page.utils.spec.ts`
  - MODIFY `W\libs\shared\src\lib\utils\index.ts`
  - MODIFY `W\libs\shared\src\lib\types\rpc\rpc-chat.types.ts`
  - MODIFY `W\libs\shared\src\lib\types\rpc\rpc-session.types.ts` (`MessageAnchorHint` `:284-293`)
  - MODIFY `W\libs\shared\src\lib\types\rpc\rpc-error-codes.types.ts` (`:7-20`)
  - MODIFY `W\libs\shared\CLAUDE.md` (`chat:resume` bullet)
  - NOT in this batch: `rpc.types.ts` registry/entries (V4 → Task 10.2)
- Plan reference: implementation-plan.md (ii).3 Contract, (ii).6 C6; D11.
- Pattern to follow: `libs/shared/src/lib/utils/session-id.utils.ts` (small pure util + barrel);
  `session:cli-output-page` types `rpc-session.types.ts:162-177`.
- Acceptance criteria:
  1. `HISTORY_TAIL_PAGE_EVENTS = 250`, `HISTORY_PAGE_DEFAULT_EVENTS = 250`,
     `HISTORY_PAGE_MAX_EVENTS = 2000` (D11).
  2. `selectHistoryPage(events, { endIndex, maxEvents })` exactly as (ii).3 "Selection". The turn
     start is `eventType === 'message_start' && role === 'user' && !parentToolUseId`. Index 0 is
     treated as a start. One oversize turn is returned whole. Empty input returns
     `{ events: [], olderCursor: null }`. O(events).
  3. `encodeHistoryCursor(messageId)` → `h1:<id>`. `decodeHistoryCursor` accepts only
     `/^h1:[A-Za-z0-9_-]{1,512}$/`. `resolveHistoryCursorEndIndex(events, cursor)` returns the index
     of the matching root user `message_start`. Two distinct pure `Error` subclasses:
     `HistoryCursorStaleError` (anchor not found) and `HistoryCursorInvalidError` (malformed). No
     `Buffer`/`btoa`/Node APIs.
  4. `ChatResumeParams.historyPage?: { readonly maxEvents: number }`;
     `ChatResumeResult.historyPage?: { readonly olderCursor: string | null }` with doc comments
     (present only when requested and `success`). `ChatHistoryPageParams` /
     `ChatHistoryPageResult` as (ii).3.
  5. `'HISTORY_CURSOR_STALE'` appended to `RpcUserErrorCode`.
  6. `MessageAnchorHint.occurrenceFromEnd?: number`, with a doc comment that it counts identical
     prompts AFTER the anchor and is preferred when present.
  7. Spec cases (plan C6 seam): tail snaps to root user starts; a tool pair and an agent subtree
     (nested user `message_start` with `parentToolUseId`) are never split; oversize single turn;
     exact `maxEvents` fit; assistant-first transcript (start 0); cursor round trip, including a
     uuid and a `u-12`-style id (V9); malformed cursor → invalid error; anchor missing → stale
     error; older-page `endIndex` chain walks to `olderCursor: null`; pages are index-disjoint and
     their concatenation equals the input. `rpc-chat.types.spec.ts` stays green, unedited.
  8. `libs/shared/CLAUDE.md`: the `chat:resume` bullet says `events` is the tail page when
     `historyPage` is requested, and older pages come through `chat:history-page`.
- Verification: common Stage 2 steps. Tests `-p @ptah-extension/shared` (header 1). Typecheck
  `@ptah-extension/shared @ptah-extension/rpc-handlers @ptah-extension/chat ptah-extension-webview
ptah-electron-e2e ptah-cli`. Lint `@ptah-extension/shared`. No builds.

## Batch 10: C7 events read + C8 paging RPC + CLI doc (backend) — PENDING

- Recommended executor: CLI lane `codex` x 1
- Fallback executor: Claude `backend-developer` sub-agent
- Execution mode: sequential (10.1 → 10.2 → 10.3)
- Rationale: C8 calls C7's new method. Collaborator extraction and DI wiring cross files in one
  chain. It is disjoint from Batch 11.
- Tasks: 3 | Depends on: Batch 8 PASS, Batch 9 committed; **V1 retarget accepted by orchestrator** (accepted 2026-09-16)
- Review: logic (authorization parity, full-events registry, stale/invalid mapping, no side
  effects) + style (facade rule, DI tokens, schema placement). Revise cap 2.

### Task 10.1: `readSessionEvents` + `occurrenceFromEnd` resolution (agent-sdk) — PENDING

- Files: MODIFY `W\libs\backend\agent-sdk\src\lib\session-history-reader.service.ts`; CREATE
  `W\libs\backend\agent-sdk\src\lib\session-history-reader.events-read.spec.ts`
- Plan reference: (ii).6 C7.
- Pattern to follow: `readSessionHistory` `:164-316` (split one private load step: validate → dir
  → main messages → agent sessions → `replayToStreamEvents`); `readHistoryMessages` `:558-614`
  for the "absent → `[]`" shape.
- Acceptance criteria:
  1. `readSessionEvents(sessionId, workspacePath)` shares one private load step with
     `readSessionHistory`. It calls no compaction registry, no `hydrateMissingPricing`, no
     `aggregateUsageStats` and no `seedLiveUsageBaseline`. Invalid id → `SdkError` (as
     `validateSessionId` `:134`). Missing dir/file → `[]`.
  2. `readSessionHistory` behaviour byte-identical (existing `session-history-reader.service.spec.ts`
     green unedited).
  3. `resolveAnchorByPromptText` (`:739-764`): when `occurrenceFromEnd` is a non-negative integer,
     use `matches[matches.length - 1 - occurrenceFromEnd]` (out of range → null, then the existing
     throw). Otherwise the legacy `occurrence` path is unchanged.
  4. Spec: events equal `readSessionHistory` events on the same fixture; the four side-effect
     collaborators are never called; duplicate-prompt resolution with `occurrenceFromEnd` 0/1;
     legacy `occurrence` unchanged.
  5. The file does not grow past +~40 lines; no page selection here.

### Task 10.2: `ChatHistoryReadService`, resume tail, `chat:history-page`, anchor sanitizer — PENDING

- Depends on: Task 10.1
- Files:
  - CREATE `W\libs\backend\rpc-handlers\src\lib\chat\session\chat-history-read.service.ts` + `.spec.ts`
  - CREATE `W\libs\backend\rpc-handlers\src\lib\chat\session\chat-session-history-page.spec.ts`
  - MODIFY `W\libs\backend\rpc-handlers\src\lib\chat\session\chat-session.service.ts`
  - MODIFY `W\libs\backend\rpc-handlers\src\lib\chat\tokens.ts`, `...\chat\di.ts`
  - MODIFY `W\libs\backend\rpc-handlers\src\lib\handlers\chat-rpc.handlers.ts`, `...\chat-rpc.schema.ts`
  - MODIFY `W\libs\backend\rpc-handlers\src\lib\handlers\session-rpc.handlers.ts`
    (`sanitizeAnchorHint` `:247-260` only, V1) + `...\session-rpc.handlers.spec.ts`
  - MODIFY (injection only, V3) `chat-continue-slash-before-resume.spec.ts`,
    `chat-session-auth.spec.ts`, `chat-session-mcp-status.spec.ts`,
    `chat-session-resume-activate.spec.ts` (all in `...\chat\session\`)
  - MODIFY `W\libs\shared\src\lib\types\rpc.types.ts` — registry `:645` + entries `:3367` (V4)
- Plan reference: (ii).3, (ii).6 C8.
- Pattern to follow: `wire(...)` `chat-rpc.handlers.ts:205-240`; paged-read errors
  `session-rpc.handlers.ts:816-858`; `.strict()` schema `session-rpc.schema.ts:65-72`;
  `CHAT_TOKENS` + `registerChatServices` `di.ts:48`.
- Acceptance criteria:
  1. `resolveResumeWorkingDirectory` moves from `chat-session.service.ts:778-819` into
     `ChatHistoryReadService` (deleted from the old file, not copied). `readForResume` wraps
     `readSessionHistory`. `readPage(params)` authorizes the workspace with the same user-safe
     error as resume (`:839-847`), then resolves the dir, calls `readSessionEvents`, resolves the
     cursor, calls `selectHistoryPage` with `maxEvents ?? HISTORY_PAGE_DEFAULT_EVENTS`, and
     returns `getResumableBySession`. It never calls `readSessionHistory`.
  2. `resumeSession`: `registerFromHistoryEvents` and `stats` receive the FULL events. Only when
     `params.historyPage` is set, the reply carries the tail `events` +
     `historyPage.olderCursor`. Without it, the reply has no `historyPage` key and full `events`.
     `chat-session.service.ts` line count does not grow.
  3. `CHAT_TOKENS.HISTORY_READ` registered in `registerChatServices`; `di.spec.ts` green.
  4. `chat:history-page` in `ChatRpcHandlers.METHODS`, `RpcMethodRegistry` and
     `RPC_METHOD_ENTRIES` together. `rpc-allowlist.spec.ts` green. No `ALLOWED_METHOD_PREFIXES`
     diff. No `attachmentGuard` on the page read.
  5. `ChatResumeParamsSchema` gains `historyPage` (`.strict()` inner object, `maxEvents` int
     1..2000). `ChatHistoryPageParamsSchema` `.strict()` as (ii).3. Errors map stale →
     `RpcUserError('Session history changed', 'HISTORY_CURSOR_STALE')` and invalid →
     `'INVALID_PARAMS'`. Any other error is logged and rethrown; no raw `error.message` goes to
     the client.
  6. V1: `sanitizeAnchorHint` keeps `occurrenceFromEnd` when it is a non-negative integer and
     drops it otherwise. Spec: kept, dropped for -1/1.5/"2", legacy `occurrence` unchanged.
  7. Specs per plan C8 seam: resolution parity with the moved code; the page read never calls
     `readSessionHistory`; resume with and without `historyPage`; stale → `HISTORY_CURSOR_STALE`;
     schema rejects `maxEvents` 0 / 2001, unknown keys, a 4,097-char cursor.
     `chat-session-resume-activate.spec.ts` green.

### Task 10.3: CLI JSON-RPC schema doc (decision 4) — PENDING

- Depends on: Task 10.2
- File: MODIFY `W\apps\ptah-cli\docs\jsonrpc-schema.md` (632 lines, §3)
- Acceptance criteria: document `chat:resume` `historyPage` (opt-in; default full), and
  `chat:history-page` via `rpc.call` (params, result, opaque cursor, whole-turn pages, stop at the
  compaction boundary, `HISTORY_CURSOR_STALE` → reopen). State that `session.history` and the
  `session resume` verb are unchanged. No new CLI verb, no CLI code diff.
  `apps/ptah-cli/src/test-utils/packaged-files.spec.ts` green.

### Batch 10 verification

- Common Stage 2 steps. Tests `-p @ptah-extension/shared @ptah-extension/agent-sdk
@ptah-extension/rpc-handlers ptah-cli` (header 4). Typecheck the same plus
  `@ptah-extension/vscode-core ptah-electron ptah-extension-vscode ptah-extension-webview
@ptah-extension/chat`. Lint the four tested projects.
- Team-leader reads: `resolveResumeWorkingDirectory` exists once; `registerFromHistoryEvents`
  receives the unsliced array; the three registration sites carry `chat:history-page`.

## Batch 11: C11 tab history window + C10 history message builder (frontend foundations) — COMPLETE (commit: `feat(chat-streaming): extract history message builder and tab cursor prepend`)

- Recommended executor: CLI lane `codex` x 1
- Fallback executor: Claude `frontend-developer` sub-agent
- Execution mode: sequential (11.1 → 11.2)
- Rationale: two small, file-disjoint foundations. C12 needs both. It imports nothing from C6
  (D13), so it may run beside Batch 9 or 10.
- Tasks: 2 | Depends on: Batch 8 PASS
- Review: logic (atomic prepend, no status/streamingState writes, O(E + M) unchanged, scratch
  cache cleared) + style (facade rule, exports). Revise cap 2.

### Task 11.1: `olderHistoryCursor`, `setOlderHistoryCursor`, `prependHistoryMessages` — COMPLETE

- Files: MODIFY `W\libs\frontend\chat-types\src\lib\chat-types.ts` (`TabState` `:490`); MODIFY
  `W\libs\frontend\chat-state\src\lib\tab-manager.service.ts`; CREATE
  `W\libs\frontend\chat-state\src\lib\tab-manager.history-window.spec.ts`
- Plan reference: (ii).6 C11.
- Pattern to follow: `applyFinalizedHistory` `:1647`; `updateTabInternal` `:1056`;
  `applyResumingSession` `:2107`.
- Acceptance criteria: as C11 (tri-state cursor; one `updateTabInternal` per prepend; drops ids
  already present; never writes `status`/`streamingState`/stats; unknown tab no-op; empty `older`
  still records the cursor; `applyResumingSession` resets to `undefined`; persisted through
  `projectTabForPersist` `tab-persistence.ts:105-117` and restored through `sanitizeRestoredTab`).
  **V2**: the lane reads the seven `setMessages` sites and reports, for each, whether an `await`
  sits between reading `tab.messages` and writing. Any await is reported as blocking. Spec per
  the C11 seam.

### Task 11.2: `HistoryMessageBuilder` with `finalizeSessionHistory` as its facade — COMPLETE

- Files: CREATE `W\libs\frontend\chat-streaming\src\lib\history-message-builder.service.ts` +
  `.spec.ts`; MODIFY `...\message-finalization.service.ts` (loop `:338-443` moves),
  `...\chat-streaming\src\index.ts`, `W\libs\frontend\chat-streaming\CLAUDE.md`
- Plan reference: (ii).6 C10.
- Pattern to follow: `StreamingAccumulatorCore.process` context `accumulator-core.service.ts:62-78`;
  facade rule (root CLAUDE.md, `SkillSynthesisService` / `StageHandlersService`).
- Acceptance criteria: as C10. `finalizeSessionHistory(tabId, resumableSubagents)` keeps its
  signature and behaviour. `message-finalization.session-history.spec.ts` is green **unedited**
  (equivalence oracle + 2 × E visit budget). `message-finalization.service.spec.ts`,
  `.retention.spec.ts`, `streaming-handler.service.spec.ts` green. The page build uses cache key
  `history-page-${tabId}` and clears it in `finally`. Spec: page build equals tail build; no
  `BatchedUpdateService.scheduleUpdate` during a page build (A-ii-3); an agent turn registers
  idempotently in `AgentMonitorStore`/`BackgroundAgentStore` (A-ii-4); a throwing event returns
  no partial list and clears the key.

### Batch 11 verification

- Common Stage 2 steps. Tests `-p @ptah-extension/chat-types @ptah-extension/chat-state
@ptah-extension/chat-streaming @ptah-extension/chat` (header 4; chat because it consumes
  `finalizeSessionHistory`). Typecheck the same plus `ptah-extension-webview`. Lint the first
  three. Webview `build:development`.

## Batch 12: C12 paging orchestration (`chat`) — PENDING

- Recommended executor: CLI lane `codex` x 1
- Fallback executor: Claude `frontend-developer` sub-agent
- Execution mode: sequential (12.1 → 12.2 → 12.3 → 12.4)
- Rationale: async ordering in the replayer (claims, admission, cursor re-checks) plus its two
  call sites. One mind. Task 12.4 edits the same loader, replayer and loader spec as Task 12.1,
  so it cannot be a parallel lane (`leftovers-inventory.md` B3/B4).
- Tasks: 4 | Depends on: Batch 8 PASS, Batches 9 and 11 committed (Batch 10 not required for unit
  specs; required before Batch 14)
- Review: logic (claim/rebind/cursor refusal after admission and each yield, admission released
  in `finally`, no `replayingTabIds` change, in-flight dedup, stale never loops; Task 12.4
  ordering specs prove what they claim and any fix is minimal; FU-20a re-read with
  `replayOlderPage` admission, B5) + style. Revise cap 2.

### Task 12.1: `HistoryPagingService`, `replayOlderPage`, loader tail request — PENDING

- Files: CREATE `W\libs\frontend\chat\src\lib\services\chat-store\history-paging.service.ts` +
  `.spec.ts`; CREATE `...\chat-store\session-history-replayer.older-page.spec.ts`; MODIFY
  `...\session-history-replayer.service.ts`, `...\session-loader.service.ts`,
  `...\session-loader.service.spec.ts`, `...\chat-store\index.ts`
- Plan reference: (ii).6 C12; D11, D14.
- Pattern to follow: `replay()` `session-history-replayer.service.ts:186-228` (admission,
  `canContinueReplay`, `finally`); cli-output-page stale guard `session-loader.service.ts:1122-1162`.
- Acceptance criteria: as C12, plus:
  1. `tailRequest()` returns `{ maxEvents: HISTORY_TAIL_PAGE_EVENTS }` (D11).
  2. Loader: `historyPage: tailRequest()` in the `chat:resume` params (`:702-713`). `recordTail`
     is called beside `applyResumeStats` (`:766`), which runs after the `isCurrent` check `:728`.
     The refresh path `:1286` is untouched. Loader grows by <= ~5 lines.
  3. `replayOlderPage` never adds to `replayingTabIds` (V5 recorded; no retention hook). It is
     refused while a claim is held, after a rebind, or after a cursor change, both after admission
     and after each yield. Admission is released in `finally`.
  4. `loadOlder`: stale → cursor `null` + `'stale'` (D14); failed → cursor kept; `null` or
     `undefined` cursor → `'none'`. Uses the `RpcResult` shape (no literal-return catch).
  5. The replayer stays < 700 lines.
  6. (Batch 11 review carry-over) `HistoryPagingService` MUST wrap `accumulate()` + `build()` in
     ONE outer `try/finally` that calls `HistoryMessageBuilder.clearCache(cacheKey)`.
     `build({ releaseCacheAfterBuild: true })` only releases when `build` is reached; a throw inside
     `accumulate()` happens before it. Also: never hold a `tab.messages` snapshot across an `await`
     before `prependHistoryMessages` — it reads current state at commit time and must stay so.

### Task 12.2: Chat view anchor hint + older-history handler — PENDING

- Depends on: Task 12.1
- Files: MODIFY `W\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts`,
  `...\chat-view.component.spec.ts`
- Acceptance criteria: `buildAnchorHint` (re-cite; now `:939-957`) also returns
  `occurrenceFromEnd` (identical prompts after the anchor in the loaded list).
  `onOlderHistoryRequested(tabId)` calls `loadOlder`. On `'stale'` it shows
  `showActionError(<text telling the user to reopen the session>, tabId)` (decision 3); on
  `'failed'` a retry-able error. There is no automatic resume. The spec covers
  `occurrenceFromEnd`, stale text and failed. The component html is untouched in this batch.

### Task 12.3: chat `CLAUDE.md` rule 7 Tail paging bullet (D12) — PENDING

- Depends on: Task 12.1
- File: MODIFY `W\libs\frontend\chat\CLAUDE.md` — ONE new rule 7 bullet **Tail paging**: tail
  size constant, older pages never touch `streamingState` and are refused under a claim,
  prepends are atomic with dedup by id, stale cursor → user reopens, and tail/older replays of
  <= 250 events are synchronous (so the Replay boundary and retention do not engage for them,
  V5). No edit to the Batch 7 Replay boundary bullet.

### Task 12.4: Resume ordering regression specs — compaction reload vs replay, throw mid-replay — PENDING

- Depends on: Task 12.1 (same files; runs after the tail request lands)
- Source: `leftovers-inventory.md` B3 (`batches.md:775-777`, `b5-code-logic-review-delta.md:196-201`)
  and B4 (`batches.md:778-779`).
- Files: MODIFY `W\libs\frontend\chat\src\lib\services\chat-store\session-loader.service.spec.ts`;
  MODIFY `...\chat-store\session-history-replayer.service.spec.ts` (or the Task 12.1
  `session-history-replayer.older-page.spec.ts` if the throw case belongs with paging; the lane
  says which); MODIFY `...\session-loader.service.ts` and/or `...\session-history-replayer.service.ts`
  **only if** a spec below fails on current code.
- Pattern to follow: loader compaction reload `session-loader.service.ts:677-691` (re-cite after
  Task 12.1); replayer `finally` `session-history-replayer.service.ts:224`; loader `replay(` `:782`,
  `applyResumeFailure` `:797`, `:807` (re-cite).
- Acceptance criteria:
  1. **B3 spec (compaction reload racing an in-flight replay)**: tab T has a replay claim held
     and chunks still pending (install a real `MessageChannel` or a controllable yield so chunk
     boundaries exist). A `switchSession(..., { reason: 'compaction' })` for T starts, which
     skips `applyResumingSession` (`:684`). Assert: the older replay is superseded and writes no
     message, status, stats or streamingState after the new claim; the final tab state equals the
     compaction reload's result; `clearPendingUpdates` ran before any history finalization flush;
     held `chat:chunk` events are delivered once, in order, by the winning claim only.
  2. **B4 spec (throw mid-replay)**: a chunk throws during `replay()`. Record every tab state
     transition (status, `isReplaying(tabId)`, messages length) through the throw. Assert: no
     observable `loaded` status and no finalized/partial transcript between the replayer's
     `finally` clearing the replay flag and the loader's `applyResumeFailure`; the fence releases
     held events once; admission is released; the tab ends in the failure state.
  3. Each spec is shown failing when its guarded behaviour is removed (describe the mutation in
     the report: e.g. drop the supersede check, or apply `loaded` before failure), so it pins the
     ordering rather than passing vacuously.
  4. **Fix only if real**: if a spec fails on the unmodified code, the lane reports the failing
     assertion and the observed stale write/flash, then applies the smallest fix in the loader or
     replayer. Explicit exception to Task 12.1 AC 2's "loader grows by <= ~5 lines" for this fix
     only; the report gives the line delta. The replayer stays < 700 lines. A fix that needs a
     claim-semantics or admission redesign is returned as a blocking finding, not improvised.
  5. If both specs pass on current code: no production diff; the report says "B3/B4 not
     reproducible; pinned by specs" and names the spec titles.
  6. Existing replayer, admission, loader and cli-restore specs green and unedited, except the
     two spec files this task names.

### Batch 12 verification

- Common Stage 2 steps. Tests `-p @ptah-extension/chat` (header 1; report counts vs Batch 7).
  Typecheck `@ptah-extension/chat ptah-extension-webview`. Lint `@ptah-extension/chat`. Webview
  `build:development` + `build:production`. Existing replayer, admission, loader and cli-restore
  specs green.
- Team-leader reads the Task 12.4 specs and, if a production fix landed, confirms the loader line
  delta is reported and the fix is limited to the ordering defect the spec shows.

## Batch 13: C13 "Load earlier" affordance (transcript) — PENDING

- Recommended executor: CLI lane `codex` x 1
- Fallback executor: Claude `frontend-developer` sub-agent
- Execution mode: sequential (13.0 → 13.1 → 13.2 if triggered)
- Rationale: one directive plus the transcript and chat-view template bindings; it touches the
  scroll-sensitive transcript Batch 7 changed. 13.0 and 13.2 edit the same component file as
  13.1, so all three stay in one lane (`leftovers-inventory.md` B11/B12).
- Tasks: 3 (13.2 conditional) | Depends on: **Batch 7 committed and Batch 8 PASS (explicit)**,
  Batch 12 committed
- Review: logic (arming only after an upward move, once per arm, never during replay or on open,
  no scroll writes; 13.0 and 13.2 behaviour-preserving) + style (directive shape vs
  `transcript-slot.directive.ts`, a11y; 13.2 facade rule and nameability). Revise cap 2.

### Task 13.0: Remove the duplicated replay motion hold timer-clear — PENDING

- Source: `leftovers-inventory.md` B11 (`batches.md:707-708`; `b4-code-style-review-delta.md:145`).
- File: MODIFY `W\libs\frontend\chat\src\lib\components\organisms\transcript\chat-transcript.component.ts`
- Acceptance criteria:
  1. Report `wc -l` before (expected 700) and after.
  2. The falling-edge branch of the `historyReplaying` effect (currently `:467-469`,
     `if (this.replayMotionHoldTimeoutId) clearTimeout(...)`) calls `clearReplayMotionHold()`
     (`:693-697`) instead of repeating the clear. Keep the order "clear, then set hold true, then
     arm the 300 ms timer": if `clearReplayMotionHold()` also sets `replayMotionHold` false, that
     is fine because the next line sets it true in the same untracked block (state the helper's
     body in the report). No other effect or timer changes.
  3. No hunk in `onScroll`, `scheduleStickToBottom`, `restoreScrollOnActivation`, `lastScrollTop`,
     the render-window feed effect or `cleanup()` retention code.
  4. `chat-transcript.component.replay-motion.spec.ts`, `.replay-mount.spec.ts` and
     `chat-transcript.component.spec.ts` green and unedited.

### Task 13.1: `TranscriptOlderHistorySentinelDirective` + transcript IO + chat-view binding — PENDING

- Files: CREATE `W\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-older-history-sentinel.directive.ts`;
  CREATE `...\transcript\chat-transcript.older-history.spec.ts`; MODIFY
  `...\transcript\chat-transcript.component.ts`, `...\chat-transcript.component.html`,
  `W\libs\frontend\chat\src\lib\components\templates\chat-view.component.html`
- Plan reference: (ii).6 C13; decision 2.
- Pattern to follow: `transcript-slot.directive.ts`; local fake `IntersectionObserver` in
  `transcript-render-window.spec.ts`.
- Acceptance criteria: as C13, plus:
  1. First step: re-cite transcript and chat-view lines against the Batch 7 commit and Task 13.0
     (V7); report `chat-transcript.component.ts` line count before (after 13.0) and after (V6). All
     logic stays in the directive; the component gains only the inputs/output and the vm field.
     If the after count is > 700, Task 13.2 is triggered.
  2. Auto-load emits only when intersecting AND armed (a `scrollTop` decrease seen by the
     directive's own passive listener) AND scrollable AND not loading AND not
     `historyReplaying`. It disarms after each emit. Never on open. Never during the downward
     stick.
  3. A real `<button>` "Load earlier messages", keyboard-operable with visible focus,
     `aria-busy` while loading, and disabled while loading. Shown only when
     `vm().hasOlderHistory && !historyReplaying()`. Without `IntersectionObserver` the button still
     works and there is no auto-load.
  4. chat-view html binds `[hasOlderHistory]` (tab cursor is a string),
     `[olderHistoryLoading]`, `(olderHistoryRequested)` per tab id.
  5. Diff: no hunk in `onScroll`, `scheduleStickToBottom`, `restoreScrollOnActivation`,
     `lastScrollTop`, the render-window feed effect or `cleanup()` retention code; no CSS diff;
     no scroll writes; no `content-visibility`. `chat-transcript.component.spec.ts` (Gate A,
     scroll specs), `.replay-mount.spec.ts`, `.replay-motion.spec.ts` green and unedited.

### Task 13.2: CONDITIONAL — facade split of the replay hold concern out of the transcript — PENDING

- Runs only if Task 13.1 leaves `chat-transcript.component.ts` > 700 lines. Otherwise mark it
  `CANCELLED (not needed)` with the reported count.
- Depends on: Task 13.1
- Source: `leftovers-inventory.md` B12 (`batches.md:1053`, V6); root `CLAUDE.md` File size /
  facade rule. User instruction 2026-09-16 moves this split into Batch 13 (inventory had it
  after M2).
- Files: CREATE `W\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-replay-hold.service.ts`
  (+ `.spec.ts` only for behaviour the component specs do not already cover); MODIFY
  `...\transcript\chat-transcript.component.ts`
- Collaborator: `TranscriptReplayHoldService` — owns the replay-edge concern: the
  `historyReplaying` rising/falling edge tracking (`wasHistoryReplaying`), the 300 ms
  `replayMotionHold` signal + timer, and the replay mount-retention release timing
  (`retentionReleaseTimeoutId`, rAF raced with 50 ms) and their clears from `cleanup()`.
  Provided in the component's own `providers` (component-scoped, destroyed with it), injected with
  `inject()`. The lane may rename it if the moved code shows a better name; no
  `helpers`/`utils`/`common`/`misc` names.
- Acceptance criteria:
  1. Facade rule: `ChatTranscriptComponent` keeps its selector, inputs, outputs and public members.
     Templates and chat-view bindings are unchanged. The moved logic is a move, not a rewrite:
     same timings (300 ms hold, rAF vs 50 ms release), same ordering, same cancel-on-new-replay
     and cancel-on-destroy behaviour.
  2. Guardrails: the new file is >= ~150 lines of real moved concern. If the extractable concern
     is smaller, the lane does NOT create a fragment: it stops, reports the measured size, and the
     batch records the > 700 warn (warn-level lint, V6). The component constructor/field inject
     count does not pass ~8.
  3. Component after the split is <= 700 lines; report before/after for both files.
  4. Still no hunk in `onScroll`, `scheduleStickToBottom`, `restoreScrollOnActivation`,
     `lastScrollTop`; the render-window feed effect keeps reading raw `historyReplaying()` (never
     the hold), per chat `CLAUDE.md` rule 7 Replay boundary. No CSS diff, no scroll writes.
  5. `chat-transcript.component.spec.ts`, `.replay-mount.spec.ts`, `.replay-motion.spec.ts` and the
     new `chat-transcript.older-history.spec.ts` green and **unedited** (component-scoped provider
     means no TestBed change is needed; if one is needed, that is a finding returned before
     commit, not an edit).
  6. chat `CLAUDE.md` rule 7 Replay-tab signal / Replay boundary bullets: update only the file
     reference to name the collaborator; no rule text changes.

### Batch 13 verification

- Common Stage 2 steps. Tests `-p @ptah-extension/chat` (header 1). Typecheck `@ptah-extension/chat
ptah-extension-webview`. Lint `@ptah-extension/chat` (report the `max-lines` warn state). Webview
  `build:development` + `build:production`. Team-leader re-runs the diff safeguards itself; for
  Task 13.2 it reads the moved code side by side with the removed lines.

## Batch 14: C14 paging-faithful harness + functional e2e — PENDING

- Recommended executor: CLI lane `codex` x 1
- Fallback executor: Claude `senior-tester` sub-agent
- Execution mode: sequential (14.1 → 14.2)
- Rationale: harness only. M2 is valid only if the mock follows the shared pager (R-ii-4).
- Tasks: 2 | Depends on: Batch 8 PASS, Batches 9, 10, 12, 13 committed
- Review: logic (mock parity with backend selection, "measurement unusable" guard, functional
  assertions meaningful) + style. Revise cap 2.
- Playwright runs: node-runner count 0 before the functional run (common rules); no perf run
  in this batch.

### Task 14.1: Mock `chat:resume` paging + `chat:history-page`; per-tile paging diagnostics — PENDING

- Files: MODIFY `W\apps\ptah-electron-e2e\src\support\perf-session-fixture.ts`,
  `W\apps\ptah-electron-e2e\src\specs\chat\tile-open-longtask-budget.perf.spec.ts`,
  `W\apps\ptah-electron-e2e\src\support\perf-page-capture.ts` (B6, B8),
  `W\apps\ptah-electron-e2e\src\support\perf-measurement-report.ts` (only if AC 6 applies);
  CREATE `W\apps\ptah-electron-e2e\src\support\perf-scroll-sanity.ts` (only if AC 6 applies)
- Source for ACs 4-6: `leftovers-inventory.md` B6 (`batches.md:822-823`, `:840-842`), B8
  (`batches.md:342`), B7 (`batches.md:335-336`).
- Acceptance criteria:
  1. V8: in Node, per session, precompute `selectHistoryPage` for `HISTORY_TAIL_PAGE_EVENTS` and
     the full older-page chain (`HISTORY_PAGE_DEFAULT_EVENTS`) keyed by cursor. Serialise them into
     the resolver strings. With `params.historyPage`, `chat:resume` returns the tail +
     `historyPage.olderCursor`; without it, the full list and no key. `chat:history-page` returns
     the page for a known cursor and a `HISTORY_CURSOR_STALE`-shaped error for an unknown one.
     The marker stays in the tail page.
  2. The diagnostics JSON records, per tile, the observed `chat:resume` `historyPage.maxEvents`
     (`ui.getObservedCalls`, `ui-driver.ts:218`) and the replayed event count. The asserting
     tests throw "measurement unusable" if any tile resumed without `historyPage`.
  3. Skip proof: without `PTAH_PERF_SPECS` the perf tests stay skipped.
  4. **B6 per-tile DOM sampling** (closes M1 AC 2 PARTIAL at M2): `openTilesWithinPage`
     (`perf-page-capture.ts:185`) samples DOM node count per tile root (scoped to each tile's
     transcript host, not `document`) at the replaying point and at settle, reusing
     `DomNodeSample` (`:11`) or extending it with a tile id. `OpenTilesResult` carries the per-tile
     samples; the diagnostics JSON records per tile `domReplaying`, `domSettled` and the ratio.
     Whole-canvas samples stay as they are (M1 comparability). The sampler runs outside the
     measured window, or its cost is shown to be excluded from the long-task sum (state which).
     A missing tile root makes the measurement unusable (throw), never a silent 0.
  5. **B8**: `startTraceCapture` (`:130-156`) wraps its CDP calls in `try/catch (error: unknown)`;
     on failure it detaches the CDP session if created, logs one `console.warn` with the narrowed
     message, and returns/throws in the same shape the diagnostic callers already handle (the lane
     states which). `stopTraceCapture` behaviour unchanged. The gate test keeps trace hard-disabled.
  6. **B7 conditional**: if ACs 2 or 4 add an export to `perf-measurement-report.ts` (currently 8
     function exports, `assertScrollSanity` `:153`), first move `assertScrollSanity` to
     `perf-scroll-sanity.ts` and update imports (move only, no behaviour change), then add the new
     export. If no export is added there, no split; report the export count.

### Task 14.2: Functional load-older spec + e2e `CLAUDE.md` note — PENDING

- Depends on: Task 14.1
- Files: CREATE `W\apps\ptah-electron-e2e\src\specs\chat\tile-load-older-history.spec.ts`; MODIFY
  `W\apps\ptah-electron-e2e\CLAUDE.md` ("Perf specs": the mock follows the shared pager)
- Acceptance criteria (not budget-gated; C14 list plus V5):
  1. One tile. Scroll up; one page is prepended. The previously top-visible message keeps its
     viewport offset within 2 px, including the `scrollTop === 0` case (A-ii-2).
  2. No duplicate message ids. The button is gone when the cursor is `null`. An unknown cursor
     shows the reopen-the-session error. A mock without `historyPage` shows no button.
  3. **Pinned prepend (V5 / U1 evidence)**: a short session whose content does not fill the tile
     shows the button while pinned. Click it, wait for 1,000 ms without mutation, then read the
     distance from bottom. Report the value. It passes when <= 120 px (the tile stays pinned). A
     failure is recorded as a U1 escalation trigger, not patched in `onScroll`.
  4. No auto-load on open (observed `chat:history-page` call count 0 before any scroll).
  5. Run once, headed/visible window, after the node-runner idle check; quote the Playwright result.

### Batch 14 verification

- Common Stage 2 steps adapted. No jest projects change. Typecheck + lint `ptah-electron-e2e`.
  Degradation audit TOTAL 303 (e2e not scanned; proves nothing else moved). Prettier. Functional
  spec result quoted.
- Per-tile DOM fields: this batch has no perf run, so they are proven by typecheck and a
  team-leader code read of the sampler and the diagnostics writer. M2 (Task 15.1 AC 4) is the
  first run that populates them; if M2 finds them missing, the M2 run is unusable and Batch 14
  reopens. No `project.json` edit, no `nx reset` (B9 stays out of branch).

## Batch 15: M2 measurement (Electron, AC-11 verdict) — PENDING

- Recommended executor: Claude `senior-tester` sub-agent
- Fallback executor: none (idle machine required; wait instead)
- Execution mode: sequential
- Rationale: measurement protocol on an idle machine; no product or spec code.
- Tasks: 1 | Depends on: **Batch 8 PASS (explicit)**, Batches 9-14 committed
- Review: `code-logic-reviewer` on the report methodology; team-leader commits the report.
- **Peer hold protocol** (handoff.md §6 rule 4): before the first run the orchestrator asks the
  peer sessions on this machine (the `continue-task` session and any other active one) to hold
  heavy passes, and releases the hold after the last run. The report records both times.

### Task 15.1: M2 run set, scroll sanity, load-older e2e, AC-11 verdict — PENDING

- File: MODIFY `W\.ptah\specs\TASK_2026_453_1eb4\test-report.md` (new "M2" section after the
  Batch 8 scroll re-check)
- Plan reference: implementation-plan.md (ii).8, (ii).5; S2ii-AC5; user decision 5.
- Acceptance criteria:
  1. `git log --oneline -1` = the Batch 14 commit; `git status --short` shows no product or spec
     change. Dev build via the e2e target; production build as in M1. `PTAH_PERF_SPECS=1`;
     `PTAH_PERF_OUT_DIR` outside the repo (e.g. `D:\projects\ptah-453-perf\m2`).
  2. Idle command returns `0` before AND after every run. Contaminated runs are discarded and
     re-run, never counted. Retries are reported, never averaged.
  3. Run set = the M1 set: cold 3-tile dev ×3 (asserting); warm 1-tile ×1; warm 3-tile ×1;
     production cold ×1; `PTAH_PERF_RAF_ATTRIBUTION=1` cold ×1; `PTAH_PERF_TRACE=1` cold at
     `PTAH_PERF_EVENTS=500` and `=2000` ×1 each. Scroll sanity on every run that has it. Plus
     `tile-load-older-history.spec.ts` ×1 (functional).
  4. Per run: max, total, count, `preWindowExcluded`, `settled`, wall per tile, DOM
     replaying/settled (whole canvas AND per tile), per-tile `historyPage.maxEvents` and
     replayed-event count (the run is unusable if any tile resumed without paging, or if any tile
     lacks per-tile DOM samples). Table beside M1.
     4a. **AC 2 (per-tile DOM <= 2×) is evaluated per tile from Task 14.1 AC 4 data and must be
     MET or NOT MET — PARTIAL is no longer an allowed verdict** (`leftovers-inventory.md` B6).
     Report each tile's replaying/settled ratio.
  5. Volume independence: the 500 and 2,000 trace totals agree within run noise, and the
     `FireAnimationFrame` count is flat. A materially higher 2,000 total is reported as "renderer
     still pays volume".
  6. Scroll: 0 failures across all runs with the check. Any failure → record tile, distance, run
     shape; classify H1 (multiple of ~132 px → U1 escalation) / H2 (< 132 px).
  7. **AC-11 MET** iff all 3 dev cold runs AND production cold have max <= 200, total <= 1,500,
     `settled: true`, and scroll sanity passing. The budget is never loosened.
  8. **Fallback rule (decision 5)**: if every one of those four runs meets total and `settled`,
     scroll passes, but any max > 200 → verdict "MAX ONLY", and the orchestrator proceeds to
     Batch 16 without asking the user. If total fails anywhere, or scroll fails → report the gap
     (max, total, buckets, rAF histogram, trace shares) and return to the orchestrator for a user
     decision. Batch 16 does not start in that case.
  9. List every diagnostics JSON and console log path used.

## Batch 16: CONDITIONAL — tail page 250 → 150 (decision 5) — PENDING

- Runs only if Batch 15 verdict is "MAX ONLY". Otherwise mark it `CANCELLED (not needed)` in
  this file.
- Recommended executor: CLI lane `codex` x 1
- Fallback executor: Claude `frontend-developer` sub-agent
- Execution mode: sequential
- Tasks: 1 | Depends on: Batch 15 verdict "MAX ONLY"
- Review: logic + style (small; revise cap 2).

### Task 16.1: `HISTORY_TAIL_PAGE_EVENTS = 150` — PENDING

- Files: MODIFY `W\libs\shared\src\lib\utils\history-page.utils.ts` (one constant) and every spec
  whose expected tail size reads the literal (the lane lists them, e.g.
  `history-paging.service.spec.ts`, `session-loader.service.spec.ts`, `history-page.utils.spec.ts`)
- Acceptance criteria: only the tail constant changes (D11). `HISTORY_PAGE_DEFAULT_EVENTS` stays 250. The mock picks it up through the import (no fixture literal). Doc mentions of "250" in
  `libs/frontend/chat/CLAUDE.md` Tail paging bullet, `libs/shared/CLAUDE.md` and
  `jsonrpc-schema.md` are updated where they state the renderer tail size. Tests `-p
@ptah-extension/shared @ptah-extension/chat` (header 2); typecheck/lint those plus
  `ptah-extension-webview ptah-electron-e2e`; webview `build:production`; audit TOTAL 303.

## Batch 17: CONDITIONAL — M2b re-measure at 150 events — PENDING

- Runs only after Batch 16 commits.
- Recommended executor: Claude `senior-tester` sub-agent; fallback none (idle machine)
- Tasks: 1 | Depends on: Batch 16 committed; Batch 8 PASS
- Review: `code-logic-reviewer` on methodology; team-leader commits the report.
- Peer hold protocol as Batch 15.

### Task 17.1: M2b full run set at 150 — PENDING

- File: MODIFY `W\.ptah\specs\TASK_2026_453_1eb4\test-report.md` ("M2b" section)
- Acceptance criteria: Task 15.1 items 1-7 (including 4a) and 9 unchanged, with per-tile `historyPage.maxEvents`
  = 150. AC-11 MET under the same rule. If still not met → report and return to the orchestrator
  for a user decision (next levers are Stage 2 (iii-b) or others). No further automatic
  reduction. The budget is never loosened.

## Batch 18: Post-Stage-2 follow-ups (branch-safe test quality) — PENDING

- Runs after Batch 15 (and after Batch 17 if Batches 16-17 run; after Batch 15 if they are
  `CANCELLED (not needed)`), and before PR #524 leaves draft.
- Source: `leftovers-inventory.md` B13 (`batches.md:780-781`; `b5-code-style-review-delta.md:72`)
  and B10 (`batches.md:704-706`; `b4-code-style-review-delta.md:166`). Only branch-safe items: no
  `project.json` edit, no `nx reset`, no product code change.
- Recommended executor: CLI lane `codex` x 1
- Fallback executor: Claude `senior-tester` sub-agent
- Execution mode: sequential (18.1 → 18.2). The two tasks are file-disjoint, but both run the
  `@ptah-extension/chat` Jest project; one lane keeps it to one test runner (D13).
- Tasks: 2 | Depends on: Batch 15 committed (and Batch 17 committed or Batches 16-17 cancelled);
  Batch 13 committed (18.1 edits the specs Task 13.1 AC 5 froze)
- Review: logic (no assertion weakened or dropped, test count per file unchanged or higher, each
  spec still fails on the mutation it guarded) + style (harness naming, location). Revise cap 2.

### Task 18.1: Shared transcript spec harness — PENDING

- Files: CREATE `W\libs\frontend\chat\src\lib\components\organisms\transcript\testing\transcript-spec-harness.ts`
  (name may follow an existing `testing/` convention in the lib; the lane cites it); MODIFY
  `...\transcript\chat-transcript.component.spec.ts`, `...\chat-transcript.component.replay-motion.spec.ts`,
  `...\chat-transcript.component.replay-mount.spec.ts`, `...\chat-transcript.older-history.spec.ts`
  (and `transcript-render-window.spec.ts` only if it holds the same fake `IntersectionObserver`)
- Acceptance criteria:
  1. The copied stubs (service stubs, TestBed setup, tab/tree fixtures) and the fake
     `IntersectionObserver` live once in the harness; the 3-4 specs import it. The lane first lists
     every duplicated block with file:line and says which ones moved; blocks that differ in
     behaviour stay local or become explicit harness options, never silently unified.
  2. The harness is spec-only: not exported from `src/index.ts`, not imported by production code,
     and matched by the lib's Jest/tsconfig spec globs (not compiled into the library build).
  3. Per spec file, test count before and after is reported and not lower; no `it.skip`/`xit`;
     no assertion text changed except imports and setup calls.
  4. No product file changes. No `project.json`/jest config edit.

### Task 18.2: message-bubble rendered-class assertion (if feasible) — PENDING

- File: MODIFY `W\libs\frontend\chat\src\lib\components\organisms\message-bubble.component.spec.ts`
  (`:280`, template string-match assertion)
- Acceptance criteria:
  1. Feasibility check first: can the current Jest/jsdom setup observe the rendered
     `bubble-fade-enter` class from `animate.enter` (e.g. through Angular's animation test support
     or by inspecting the element after `animate.enter` applies the class synchronously)? The lane
     reports the attempt and the result.
  2. If feasible: replace the template string match with a rendered-class assertion for both the
     enabled and the suppressed (`motionSuppressed`) cases; the string-match assertion is deleted,
     not kept beside it.
  3. If not feasible without a new harness (Playwright `webview-e2e-harness`, a jest config or a
     `project.json` change): no diff; the task is marked `CANCELLED (not feasible on branch)` and
     B10 is added to "Out-of-branch follow-ups" below with the evidence.

### Batch 18 verification

- Common Stage 2 steps. Tests `-p @ptah-extension/chat` (header 1; total test count not lower
  than Batch 15's baseline). Typecheck + lint `@ptah-extension/chat`. No builds (spec-only).
  `git status --short` lists only spec/testing files.

## Out-of-branch follow-ups (not batches; separate task off `main`)

- **B9** Jest target for e2e perf helpers (`bucketByTime`, `findRendererMainThread`,
  `summarizeTraceEvents`, `perf-diagnostics.ts:71`, `:146`, `:172`): needs an
  `apps/ptah-electron-e2e/project.json` target + `nx reset`, which D13 forbids while lanes share
  this worktree (`leftovers-inventory.md` B9). Orchestrator creates a separate task after PR #524
  merges (alternative: move the pure helpers to a lib that already has a Jest target).
- **B10** only if Task 18.2 is cancelled as not feasible.

## Stage 2 edge cases

- Resume without `historyPage` (CLI, harness-builder, loader refresh `:1286`) → full reply — Tasks 10.2, 12.1
- Oversize single turn > 250 events → one chunked page — Tasks 9.1, 12.1 (R-ii-5; not in M2 fixture)
- Anchor id from `generateId` fallback → stale on the next page — Tasks 9.1, 10.2 (R-ii-8)
- Page request while a resume claim is held / tab rebound / cursor changed mid-yield → `'superseded'` — Task 12.1
- Duplicate load clicks → one in-flight request per tab — Task 12.1
- Live append between request and prepend → both kept, no duplicates — Tasks 11.1, 14.2
- Stale cursor → error + button hidden, no loop, no auto re-open — Tasks 12.1, 12.2, 14.2
- `scrollTop === 0` prepend (A-ii-2) — Task 14.2
- Pinned prepend (V5 / U1) — Task 14.2
- Compaction-targeted reload during an in-flight replay (B3) — Task 12.4
- Chunk throws mid-replay; gap between replayer `finally` and `applyResumeFailure` (B4) — Task 12.4
- Transcript past 700 lines after C13 (B12) — Tasks 13.0, 13.1, 13.2
- Missing tile root during per-tile DOM sampling → measurement unusable (B6) — Tasks 14.1, 15.1
- CDP failure in `startTraceCapture` (B8) — Task 14.1
- No `IntersectionObserver` → button only — Task 13.1
- Persisted tab restored with a cursor → `applyResumingSession` resets it on resume — Task 11.1
- Unloaded duplicate prompt for branch/rewind → `occurrenceFromEnd` end-to-end, sanitizer keeps it (V1) — Tasks 9.1, 10.1, 10.2, 12.2
- Paged tab with `stats` null → message-derived totals undercount (R-ii-6, LOW, accepted, not fixed)
