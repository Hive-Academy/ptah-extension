# Batches - TASK_2026_453_1eb4

Total tasks: 10 | Batches: 6 (4 code, 2 measurement) | Complete: 2/6

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

## Batch 3: C3 canvas request queue ∥ C2 replay admission — IN_PROGRESS

- Recommended executor: CLI lanes `codex` x 2 (Lane A = Task 3.1, Lane B = Task 3.2)
- Fallback executor: Claude `frontend-developer` sub-agent, sequential 3.1 then 3.2
- Execution mode: parallel
- Rationale: file-disjoint (core + canvas + perf spec comments vs chat replayer + chat CLAUDE.md),
  no shared registry, entry point or config, no dependency between them; each is one
  self-contained prompt. Two test runners max = two lanes.
- Tasks: 2 | Depends on: Batch 2 (M0 recorded)
- Review: `code-logic-reviewer` + `code-style-reviewer` over both lanes' diffs → fixes back to the
  owning lane → delta review if non-trivial → team-leader commits once for the batch.

### Task 3.1 (Lane A): Replace the single-slot canvas session request with a FIFO queue — IN_PROGRESS

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

### Task 3.2 (Lane B): One replay-and-finalize at a time across tabs — IN_PROGRESS

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
     `session-loader.cli-restore.spec.ts` green unchanged.
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

## Batch 4: C1 replay motion gate — PENDING

- Recommended executor: CLI lane `codex` x 1
- Fallback executor: Claude `frontend-developer` sub-agent
- Execution mode: sequential
- Rationale: cross-file signal threading (replayer → chat-view → transcript → bubble → agent
  bubble) with specs; one mind in order.
- Tasks: 1 | Depends on: Batch 3 (replayer file shared with C2)
- Review: `code-logic-reviewer` + `code-style-reviewer` → fixes → delta → commit.

### Task 4.1: Replay-tab signal and `motionSuppressed` gate — PENDING

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
     Toast at :413 unchanged. `execution-node.component.ts` unchanged.
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

## Batch 5: C5 replay render-window fence — PENDING

- Recommended executor: CLI lane `codex` x 1
- Fallback executor: Claude `frontend-developer` sub-agent
- Execution mode: sequential
- Rationale: small change in the two transcript files C1 just edited, plus a behavioural spec.
- Tasks: 1 | Depends on: Batch 4
- Review: `code-logic-reviewer` + `code-style-reviewer` → fixes → delta → commit.

### Task 5.1: Feed the render window a replay-aware streaming boundary — PENDING

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
     bubbles get `isStreaming = false`; after replay ends and status settles, a live streaming
     message is exempt from the window again.
- Verification: tests `-p @ptah-extension/chat` (header 1; Gate A :556 and scroll specs green);
  typecheck and lint `@ptah-extension/chat`; audit TOTAL = reference; same `content-visibility` /
  scroll-method diff check as Batch 4.

## Batch 6: M1 measurement and decision point — PENDING

- Recommended executor: Claude `senior-tester` sub-agent
- Fallback executor: none (idle machine required)
- Execution mode: sequential
- Tasks: 1 | Depends on: Batches 3, 4, 5 committed (C1, C2, C3, C5 all in the build)
- Review: `code-logic-reviewer` on the report methodology; team-leader commits the report.

### Task 6.1: M1 run set, AC-11 verdict — PENDING

- File: MODIFY `W\.ptah\specs\TASK_2026_453_1eb4\test-report.md` (M1 section beside M0)
- Plan reference: implementation-plan.md:523-529, S1-AC4 :490-493
- Acceptance criteria:
  1. Same run set and protocol as Task 2.1, plus the scroll sanity check on every run.
  2. Per-tile wall time (C2 latency cost) and DOM count during replay ≤ 2× the settled count.
  3. AC-11 MET only if all 3 cold dev runs AND the production cold run have `max <= 200` and
     `total <= 1500` with `settled: true`. Otherwise report the remaining gap (max, total), rAF
     histogram, DOM counts, and main-thread trace shares, and return to the orchestrator for the
     Stage 2 user decision ((iii-b) / (ii) / (i), plan :531-555). No Stage 2 code without it.
     </content>
     </invoke>
