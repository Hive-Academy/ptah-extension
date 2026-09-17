# Code Logic Review — Batch 12 (C11 git process supervision)

Scope: `libs/backend/vscode-core/src/utils/exec-git.ts` (+ spec),
`libs/backend/vscode-core/src/services/git-info.service.ts` (+ spec), diffed against
`origin/main` in worktree `D:\projects\ptah-437`. Includes the SonarCloud S4822 fix
(`startFlight`'s `new Promise((resolve) => resolve(compute()))`).

## Summary

| Metric              | Value                |
| -------------------- | -------------------- |
| Overall score        | 6/10                 |
| Assessment            | APPROVE_WITH_FIXES   |
| Blocking issues       | 0                     |
| Serious issues        | 3                     |
| Moderate issues       | 2                     |
| Failure modes found   | 5                     |

Evidence base: full diff read (`exec-git.ts` 591 lines, `exec-git.spec.ts` +376 lines,
`git-info.service.ts` diff hunks, `git-info.service.spec.ts` +154 lines),
`implementation-plan.md` component 11 (:575-624), INV-3/INV-4 (:103-104), AC-3 (:790),
`b3-code-logic-review.md` (the P1 gap this batch closes), `research-isolation-options.md`.
`npx nx test @ptah-extension/vscode-core --testPathPattern="exec-git|git-info.service"`:
551/551 tests passed; the 5 failing suites in that run (`tokens-guard.spec.ts` etc.) fail
to compile on `workspace-change-coalescer.ts:179` (`excludeDirNames`), which is Batch 7's
uncommitted work in the shared worktree — unrelated to this batch's files.

## Five logic questions

### 1. How does this fail silently?

- `computeGitInfo`'s blanket `catch` (`git-info.service.ts:560-578`, unchanged by this
  batch but now newly reachable via the cap it adds) turns a
  `GitOutputLimitError` from the `status` call into `{ isGitRepo: true, branch: '',
  files: [] }` — the exact shape of "clean repo, no changes." Nothing in the returned
  `GitInfoResult` distinguishes "nothing changed" from "status too large to read."
  `GitOutputLimitError` is exported specifically so callers "can tell an oversized
  result from a git failure without parsing the message" (`exec-git.ts:38-39`), but grep
  confirms zero call sites check `instanceof GitOutputLimitError` or `.code ===
  'GIT_OUTPUT_LIMIT'` anywhere in the codebase. See Serious #1.
- `runGitChild`'s `onError` handler (`exec-git.ts:547-558`) frees the gate slot after
  `FORCED_KILL_GRACE_MS` (2 s) **without ever calling `child.kill()`** when the error
  fires after a pid is known. If the underlying child is still alive (a lost
  worker-bridge message, per the class doc's own "lost worker message" justification for
  the grace ceiling), the slot goes back to the pool while a live, unmanaged child keeps
  running — the process can then exceed `PTAH_GIT_MAX_CONCURRENT` with no signal that
  this happened. See Serious #2.
- `os.setPriority` failures are swallowed (`exec-git.ts:416-424`) with only a
  degradation-audit marker comment, no counted/logged occurrence — consistent with the
  "best-effort" contract, but combined with the point above, a caller has no way to tell
  "the child is running normally" from "the gate's accounting has drifted."

### 2. What user action produces unexpected behaviour?

- A user working in a very large or monorepo-scale checkout with git status output
  over 32 MiB (rare but the code's own doc names it: "a status past this size is a
  repository nobody can review anyway", `exec-git.ts:14-18`) sees the git panel go
  permanently blank/clean on every refresh, with no error toast, no retry affordance,
  and no distinguishing log line surfaced to the user layer (only `logger.error`).
- A user who runs `git worktree add`/`remove` (300 s timeout,
  `WORKTREE_GIT_TIMEOUT_MS`) while other git reads are in flight can now have that
  single long-running child occupy 1 of the process-wide 4 slots for up to 5 minutes.
  Before this batch, git children were **unbounded** — a slow worktree op never blocked
  anything else. After this batch, under load (the editor's own ~10-way startup fan-out,
  or a second worktree op), the remaining 2-3 slots can back up interactive `git status`
  reads for the same duration. There is no separate lane or priority boost for
  interactive/foreground reads vs. long-running worktree commands. See Serious #3.

### 3. What input data produces a wrong answer?

- Same as Q1: any git command whose combined stdout+stderr exceeds its cap (32 MiB for
  status, 64 MiB default for everything else — `getRemotes`, `getTags`,
  `getLastCommit`, `readNumstat`, etc., all newly capped by this batch since no cap
  existed before) resolves through each method's own blanket catch to that method's
  "nothing" shape (empty array, empty result) — a wrong answer, not a visible failure.
  This is a new, batch-wide side effect of adding a *default* cap under an existing
  swallow-everything catch pattern, not limited to the `status` call this batch's
  acceptance criteria specifically target.

### 4. What happens when a dependency fails?

- Spawn failure with a pid (synchronous throw from `spawnGitChild`): correctly caught,
  slot released once, rethrown — verified by spec ("frees the slot when spawning throws
  synchronously").
- Spawn failure with no pid (`error` before `whenSpawned` resolves a pid): correctly
  releases at once — verified by spec.
- Spawn failure **with** a pid, no explicit kill anywhere in that path: not verified by
  any spec (grep of `exec-git.spec.ts` confirms the only `emit('error', ...)` test uses
  `makeHeldChild(null)`, i.e. no pid). This is exactly the gap in Q1/Serious #2.
- `os.setPriority` throwing (`ESRCH`/`EACCES`): swallowed, call still resolves —
  verified by spec ("does not fail the git call when setPriority is refused").

### 5. What is missing that the requirements never mentioned?

- No cancellation/abort path for a caller that stops waiting on a still-queued
  `acquire()` — the queued waiter still spawns a child and runs to completion when its
  turn comes, even if nobody reads the result. Consistent with the rest of `exec-git.ts`
  (no `AbortSignal` anywhere today), so not a regression, but worth naming since the
  gate makes queue residency a new, potentially multi-second-to-minutes wait.
- No distinct observability for "gate slot released via the no-kill grace ceiling"
  (Q1) vs. the normal "child closed" release — both paths look identical from the
  outside, which will make the failure mode in Serious #2 very hard to diagnose in the
  field if it ever fires.
- No lane separation between interactive (`getGitInfo`, checkout, worktree commands)
  and background (`refreshGitInfo`) callers for the process-wide semaphore beyond the OS
  priority hint, despite `research-isolation-options.md` and the plan discussing exactly
  this contention class.

## Failure modes

### Oversized git output reads as "no changes" (silent, wrong answer)

- Trigger: any `execGit`/`execGitBuffer` call whose output exceeds its `maxOutputBytes`
  cap (32 MiB for status, 64 MiB default elsewhere).
- Symptom: the git panel/RPC caller receives a normal, successful, empty-looking result.
- Evidence: `exec-git.ts:41-51` (`GitOutputLimitError` defined, `code: 'GIT_OUTPUT_LIMIT'`),
  `git-info.service.ts:521-525` (status call passes `GIT_STATUS_MAX_OUTPUT_BYTES`),
  `git-info.service.ts:560-578` (blanket catch, no `instanceof` check); confirmed by
  grep — zero consumers of `GitOutputLimitError` outside `exec-git.ts` itself.
- Current handling: logged via `logger.error` with the error's `.message` only; returned
  value is indistinguishable from a genuinely clean repo.
- Recommendation: in `computeGitInfo` (and ideally in every other `cachedRead`-backed
  method touched by this batch's default cap), special-case
  `error instanceof GitOutputLimitError` to return a result shape the UI can render as
  "status too large" rather than "clean," or at minimum a distinct RPC degradation
  signal (the repo already has a degradation-source union per D2/Task 7.3 in this same
  task).

### Gate slot freed without confirming the child is dead

- Trigger: `child.onError` fires after `whenSpawned` resolved a real pid, and the child
  does not emit `close` within the 2 s grace window.
- Symptom: the process-wide concurrency cap can be silently exceeded; no log
  distinguishes this from a normal release.
- Evidence: `exec-git.ts:547-558` — `armReleaseGrace()` called with no `onExpiry`, so no
  `child.kill()` is ever attempted on this path (contrast with `abort()` at
  `exec-git.ts:500-513`, which always kills before arming grace).
- Current handling: none; the FORCED_KILL_GRACE_MS doc comment (`exec-git.ts:23-28`)
  pre-emptively excuses this as covering "a lost worker message," but that is a
  post-hoc justification, not a mitigation — the accounting still drifts.
- Recommendation: attempt `child.kill('SIGTERM')` (and the same tree-kill path `abort()`
  uses) in `onError` whenever a pid is known, before arming the grace timer; or at
  minimum, log a `[GitProcessGate] released without confirmed exit` warning so the
  drift is observable.

### Long-running worktree command can starve interactive git reads

- Trigger: `git worktree add`/`remove` (`WORKTREE_GIT_TIMEOUT_MS` = 300 000 ms) runs
  concurrently with the editor's normal git-read fan-out.
- Symptom: interactive `getGitInfo`/status refresh calls queue behind the worktree op
  for up to 5 minutes under contention, a regression against the pre-batch behaviour of
  unbounded concurrency (where a slow op never blocked anything else).
- Evidence: `exec-git.ts:8` (`WORKTREE_GIT_TIMEOUT_MS`), `exec-git.ts:76-153`
  (`GitProcessGate`, one shared FIFO/round-robin queue for every caller,
  `DEFAULT_GIT_MAX_CONCURRENT = 4`).
- Current handling: none — the gate treats a worktree op and a status read identically.
- Recommendation: reserve at least one slot for non-worktree calls, or give worktree
  commands their own smaller-capacity queue, per the "separate lane" question this
  review was asked to hunt for. At minimum, name this as an accepted risk in the plan
  (it is not currently called out anywhere in `implementation-plan.md` component 11).

### `os.setPriority` on a since-exited or reused pid

- Trigger: the child exits (or its pid is recycled by the OS) in the narrow window
  between `whenSpawned` resolving and `lowerProcessPriority` executing.
- Symptom: an unrelated OS process could have its priority silently lowered.
- Evidence: `exec-git.ts:415-425` — no liveness check (`child.isKilled()`) before
  calling `os.setPriority(pid, ...)`.
- Current handling: none; caught generically (`ESRCH`/`EACCES` both swallowed the same
  way as a genuine refusal).
- Recommendation: low priority given the narrow window (pid resolves essentially
  synchronously after spawn on all three code paths), but worth a one-line
  `child.isKilled()` guard for cheap defense-in-depth.

### Trailing-run priority determined by first queuer, not by call intent

- Trigger: a user-driven `getGitInfo` and a watcher-driven `refreshGitInfo` both land
  during the same in-flight run and both need a trailing rerun.
- Symptom: whichever call queues the trailing run first fixes its `compute` (and thus
  its OS priority) for every later joiner — `singleFlight`'s trailing branch
  (`git-info.service.ts:422-431`) only ever installs the *first* caller's `compute`, so
  the intended per-call priority argument silently loses in a race.
- Evidence: `git-info.service.ts:410-432`.
- Current handling: none; not covered by the new "background priority" or "normal
  priority" specs, which each exercise a single call in isolation.
- Recommendation: acceptable as documented for the "watcher joins nobody-waiting" case
  (`git-info.service.ts:386-388`), but the reverse (a watcher-queued trailing run
  silently downgrading a later foreground caller's own status read to background OS
  priority) is undocumented and untested. Worth a one-line doc note and a test pinning
  the chosen behaviour either way.

## Blocking issues

None found.

## Serious issues

### 1. `GitOutputLimitError` has no consumer

- File: `libs/backend/vscode-core/src/services/git-info.service.ts:560-578` (and every
  other `catch` block in the file that now sits behind the new default 64 MiB cap).
- Scenario: any git output over its cap.
- Impact: user-visible git state silently becomes wrong (reads as "no changes") with no
  error surfaced anywhere past a debug log line.
- Fix: see Failure modes above.

### 2. `onError` grace path never kills the child

- File: `libs/backend/vscode-core/src/utils/exec-git.ts:547-558`.
- Scenario: a post-spawn `error` event with a known pid and no subsequent `close`.
- Impact: the process-wide concurrency cap (INV-3, this batch's own stated purpose) can
  be silently exceeded.
- Fix: kill before arming grace, matching the `abort()` path; or log the ungoverned
  release.

### 3. No priority lane for interactive reads vs. long worktree commands

- File: `libs/backend/vscode-core/src/utils/exec-git.ts:76-172` (single shared gate for
  every caller).
- Scenario: a `git worktree add`/`remove` overlapping normal status reads under load.
- Impact: up to a 5-minute UI stall for git status that did not exist before this batch
  (concurrency was previously unbounded).
- Fix: reserve capacity for interactive calls, or explicitly accept and document the
  risk in the plan.

## Moderate and minor issues

- `os.setPriority` pid-reuse race, no liveness check —
  `libs/backend/vscode-core/src/utils/exec-git.ts:415-425` (Moderate, low likelihood).
- Trailing-run priority race between `getGitInfo` and `refreshGitInfo` —
  `libs/backend/vscode-core/src/services/git-info.service.ts:410-432` (Moderate,
  undocumented/untested edge, not necessarily wrong).
- No cancellation for a queued `acquire()` whose caller gave up —
  `libs/backend/vscode-core/src/utils/exec-git.ts:106-117` (Minor, consistent with the
  rest of the module's lack of `AbortSignal` support; flagged for completeness only).

## Data flow

1. Caller invokes `execGit`/`execGitBuffer` → `gitProcessGate().acquire(cwd)` — OK,
   never rejects, FIFO/round-robin verified by spec.
2. Slot granted → `runGitChild` spawns the child, arms the per-call timeout (clock
   starts at spawn, verified by the "starts the timeout clock at spawn" spec) — OK.
3. `stdout`/`stderr` accumulate; `outputBytes` checked per chunk against
   `maxOutputBytes` — OK, single `Buffer.concat` at the end avoids O(n²) growth.
4. Normal exit → `onClose` clears any grace timer, releases the slot, resolves — OK.
5. Timeout/output-cap → `abort()` kills (SIGTERM + tree-kill), arms a 2 s grace with a
   SIGKILL escalation, rejects — OK, slot held until real exit or grace ceiling.
6. Post-spawn `error` with no antecedent kill → grace armed with **no** kill attempt —
   gap (Serious #2).
7. `GitInfoService.computeGitInfo` consumes the rejection generically — gap
   (Serious #1): a typed, purpose-built error is discarded by an untyped catch.
8. `refreshGitInfo`/`getGitInfo` route through `singleFlight`; a caller arriving after
   an invalidation gets the queued trailing run, whose `compute` (and thus priority) is
   fixed by whichever caller queued it first — documented for one direction, silent for
   the other (Moderate).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Process-wide semaphore, default 4, `PTAH_GIT_MAX_CONCURRENT` | COMPLETE | — |
| FIFO per workspace, round-robin across workspaces | COMPLETE | pinned by spec |
| Never rejects for saturation | COMPLETE | pinned by spec |
| Timeout clock starts at spawn | COMPLETE | pinned by spec |
| Slot held to `close`, or 2 s after forced kill | PARTIAL | true for the timeout/output-cap kill path; the `onError`-with-pid path frees the slot without ever killing (Serious #2) |
| Output cap kills + rejects `GitOutputLimitError` | PARTIAL | the kill/reject mechanics are correct; the typed error is never consumed by any caller (Serious #1) |
| Untracked numstat cap: first 200 files, ≤ 1 MiB | COMPLETE | pinned by spec, boundary-correct |
| `refreshGitInfo` background priority; `getGitInfo` normal | COMPLETE for the single-caller case | trailing-run race not covered (Moderate) |
| Saturation warn ≤ 1/min | COMPLETE | pinned by spec |
| S4822 fix (`startFlight` executor) | COMPLETE | semantically equivalent to the prior try/catch, verified by the existing single-flight suite plus the new "synchronous throw" spec |

Implicit requirements not addressed: a way for a UI/RPC caller to distinguish "clean
repo" from "status unreadable due to size"; observability for a slot released without a
confirmed child exit; a stated position on interactive-vs-worktree contention for the
same gate.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| 10 concurrent calls, cap 4 | YES | spec: exactly 4 live, 6 queued, never exceeds 4 | — |
| Timeout while queued | YES | spec: clock starts at spawn, not enqueue | — |
| Timeout, child never closes | YES | spec: SIGKILL + release at 2 s | — |
| Output cap hit mid-stream | YES | spec: kill + typed rejection, slot held to close | consumer never reads the type (Serious #1) |
| Spawn error, no pid | YES | spec: slot freed at once | — |
| Spawn error, pid known, no close | NO | — | untested; no kill attempted (Serious #2) |
| Synchronous spawn throw | YES | spec: slot freed, error rethrown | — |
| Background priority applied to every child of a run | YES | spec: 4/4 `setPriority` calls for a full `refreshGitInfo` run | — |
| `setPriority` refused | YES | spec: call still resolves | pid-reuse race not covered (Moderate) |
| Untracked file over 1 MiB | YES | spec against real temp files | — |
| 250 untracked files | YES | spec: exactly 200 read, rest `null` | — |
| Two concurrent worktree ops holding slots | NO | — | not tested; contributes to Serious #3 |

## Verdict

- Recommendation: APPROVE_WITH_FIXES
- Confidence: HIGH
- Top risk: an oversized git output (or a post-spawn spawner error) degrades silently
  into a successful-looking, wrong result — the exact "swallowed error" pattern this
  review is built to catch, and it sits directly behind this batch's own new default
  output cap.
- What a robust implementation would add: `GitOutputLimitError` handling distinct from
  the generic catch in every affected `GitInfoService` method (or at least the `status`
  path); a kill attempt (or a loud warning) before the `onError` grace ceiling frees a
  slot; and an explicit, documented position on interactive-vs-background contention for
  the shared gate, since the gate itself is new and changes the pre-existing
  "unbounded but never blocking" behaviour into "bounded but occasionally blocking."

---

## Delta review (review fixes)

Scope: current code on `D:\projects\ptah-437` (worktree HEAD, Batch 12 committed) for
`libs/backend/vscode-core/src/utils/exec-git.ts` (+spec),
`libs/backend/vscode-core/src/services/git-info.service.ts` (+spec),
`libs/backend/vscode-core/src/index.ts`, `libs/backend/vscode-core/CLAUDE.md`,
`libs/shared/src/lib/types/rpc/rpc-git.types.ts`. Diffed against `HEAD` (the fixes
commit) and read whole for the touched functions. Frontend consumers checked via grep
of `libs/frontend/git-ui`. `npx nx run-many -t test -p @ptah-extension/vscode-core
--testPathPattern="exec-git|git-info.service"`: 37 suites, 599/599 passed.

### 1. `GitOutputLimitError` → `statusUnavailable: 'output-too-large'`

Fixed at the type/backend layer, still an open loop at the frontend.

- `computeGitInfo`'s catch now special-cases `GitOutputLimitError`
  (`git-info.service.ts:582-598`): warns once per workspace via
  `outputLimitLogged` (`:309-312`, `:588-592`), and returns
  `{ isGitRepo: true, branch: { branch: '', upstream: null, ahead: 0, behind: 0 },
  files: [], statusUnavailable: 'output-too-large' }`. `GitInfoResult.statusUnavailable`
  is a new optional field (`libs/shared/src/lib/types/rpc/rpc-git.types.ts:111-116`).
  This resolves the base review's Serious #1 at the point where the error is caught —
  the typed error is now consumed and a real signal exists in the wire type.
- The signal dies at the frontend boundary. `GitStatusService.applyGitInfo`
  (`libs/frontend/git-ui/src/lib/services/git-status.service.ts:259-282`) destructures
  only `data.branch`, `data.files`, `data.isGitRepo` into both the active-workspace
  signals and the `_workspaceGitState` cache entry (`:274-280`) — `statusUnavailable`
  is dropped on the floor at the one place `GitInfoResult` crosses into UI state.
  `fetchGitInfo` (`:288-309`) gates on `result.data?.branch && result.data.files`, both
  of which are present (empty string / empty array are still truthy-ish: `''` is
  falsy, so a fresh RPC response with `branch: ''` would actually be **dropped** by
  this guard entirely — `applyGitInfo` never runs for the RPC-fetch path, only for a
  watcher push, per the git-watcher's own push channel). Either way, nothing downstream
  reads the field. `hasChanges` is `computed(() => this._files().length > 0)`
  (`git-status.service.ts:121`) and `changedFileCount` is `this._files().length`
  (`:118`) — both read 0. Repo-wide grep confirms zero references to
  `statusUnavailable` outside `rpc-git.types.ts`, `git-info.service.ts`, and the two
  spec files that pin the backend shape (`git-info.service.spec.ts:2048`).
- **What the user sees today**: identical to the pre-fix behaviour the base review
  flagged — a blank/empty-looking git panel (0 changed files, no branch name), with no
  banner, no tooltip, no log reaching the renderer. The one-per-workspace `logger.warn`
  (`git-info.service.ts:590-592`) only reaches the host's own log file/output channel,
  not the UI. The fix moved the "swallowed" boundary from the service's catch block to
  the frontend adapter; it did not close it.
- **Smallest frontend change**: two edits close the loop —
  1. `git-status.service.ts:259-282` (`applyGitInfo`) and the `WorkspaceGitState`
     shape it writes into `_workspaceGitState` need a `statusUnavailable` field carried
     through, plus a new exposed signal (e.g. `readonly statusUnavailable =
     computed(() => ...)`), mirroring how `isGitRepo`/`branch`/`files` are already
     exposed as readonly signals (`:105-112`).
  2. Also fix the `fetchGitInfo` truthiness guard at `:304` (`result.data?.branch &&
     result.data.files`) — `branch: ''` is falsy, so it silently no-ops on-demand
     fetches of an unavailable-status result too; should check for `result.data`
     presence, not truthiness of its fields.
  3. Whatever component renders `hasChanges`/`changedFileCount` (not itself part of
     this batch's file list) needs one conditional branch reading the new signal to
     show "status unavailable — repository output too large" instead of "no changes."
  This is a genuine gap outside the five files under review, but it is the direct,
  necessary continuation of this batch's own fix — the typed signal this batch adds
  has no consumer, same shape of finding as the original Serious #1, one layer up.

- **Caching / re-hit-the-cap under watcher churn**: `computeGitInfo` itself is not
  cached — only concurrent callers of the same key are deduped by `singleFlight`
  (`git-info.service.ts:420-462`); each new `refreshGitInfo` call after an
  `invalidateReadCache` recomputes from scratch and re-runs the same oversized `git
  status`, re-hitting `GIT_STATUS_MAX_OUTPUT_BYTES` (32 MiB) again. This is **not** an
  unbounded busy loop: the only caller wired to the watcher,
  `apps/ptah-electron/src/services/git-watcher.service.ts:975-1002`
  (`scheduleUpdate`/`debounceTimer`), coalesces a burst of filesystem events into one
  `refreshGitInfo` per debounce window (`:1037`), so the cap is re-hit at most once per
  debounce interval, not once per file event. Under continuous churn on a huge repo,
  though, every debounce window still pays a full spawn-buffer-abort cycle against the
  gate (the child runs to `outputBytes > maxOutputBytes`, gets tree-killed, and the
  slot is held through `FORCED_KILL_GRACE_MS` if it doesn't close promptly) purely to
  rediscover the same "too large" answer — a real, bounded-but-recurring cost, not
  measured here (no fixture reproduces a 32 MiB status locally), and not something this
  batch's fix set out to address. Worth a note, not a blocker.

### 2. `onError` grace path now kills before arming grace — VERIFIED FIXED

`exec-git.ts` restructured the settle path: `terminate()` (`:565-579`) is now called
from both the timeout/output-cap `abort()` path and from `onError`
(`:646-654`) whenever `whenSpawned` resolves a pid and the child has not already
closed (`exited` flag, set only in `onClose`). `terminate()` sends `SIGTERM`, tree-kills
via `whenSpawned.then(pid => { if (!exited) killProcessTree(pid) })`
(`:568-570`), and only then arms the release grace with a SIGKILL escalation
(`armReleaseGrace`, `:558-564`, called from `terminate` at `:572-575`). A concurrent
`onClose` still wins the race cleanly: it sets `exited = true`, clears any pending
grace timer, and calls `release()` unconditionally (`:614-618`) before checking
`settled` — so a child that manages to close between `onError` firing and the grace
timer expiring releases immediately rather than waiting out the full 2 s. `release()`
itself is idempotent via the `released` flag closed over in `GitProcessGate.admit`
(`exec-git.ts:214-222`), so no double-release is possible across the two paths. This
closes base-review Serious #2. Confirmed by the existing "spawn error, pid known, no
close" gap the base review flagged as untested — spec coverage: grep of
`exec-git.spec.ts` for `onError`/`emit('error'` shows both the no-pid and pid-known
cases now exercised (the "does not fail the git call when setPriority is refused" and
adjacent describe blocks); full suite green (599/599).

### 3. Two-lane gate: starvation, max=1 edge case, FIFO, abandoned callers

- **Starvation of the background lane under constant interactive load**: by
  construction the background lane is only ever considered when
  `backgroundLive < Math.max(1, maxConcurrent - 1)`
  (`exec-git.ts:236-239`) and is skipped entirely inside `dispatch()`'s loop whenever
  an interactive waiter is also queued and enqueued no later than the background head
  (`:240-244`, "when both lanes wait, longest-waiting first" — ties resolve to
  interactive via `<=`). Under a constant stream of interactive callers, a background
  waiter can wait indefinitely as long as an interactive waiter is always available to
  win every tie and every earlier-enqueued comparison. This is the mirror image of the
  problem the gate exists to solve and is not tested (no spec drives "background never
  admitted while interactive keeps arriving"). Acceptable as a design tradeoff — a
  watcher refresh that never runs is lower-impact than blocking a user's interactive
  status read — but it is an *undocumented* one; `GitProcessGate`'s class doc
  (`:76-98`) describes lane behaviour only in terms of the background cap and FIFO
  ordering, not this starvation possibility. Moderate, not blocking.
- **`max=1` edge case — reintroduces the pre-fix starvation, and it is silent about
  it**: `Math.max(1, this.maxConcurrent - 1)` (`:237`) evaluates to `1` when
  `maxConcurrent === 1`, not `0`. That means at `PTAH_GIT_MAX_CONCURRENT=1` the
  background lane is **not** capped below the total — it can take the one and only
  slot exactly as before this batch, and a subsequent interactive waiter then queues
  behind it for as long as the background call runs (up to `WORKTREE_GIT_TIMEOUT_MS` =
  300 000 ms for a worktree op). The class doc's own parenthetical — "(at 1 when `max`
  is 1, where no reservation is possible)" (`:97-98`) — names this outcome but calls it
  an unavoidable consequence of `max=1` rather than the specific failure mode
  (interactive blocked by a hung/slow background call) this whole batch exists to
  prevent at the default `max=4`. The task's own hunt list asked to "decide if max<2
  should reserve nothing or be forbidden" — the code silently chooses "reserve
  nothing," and the CLAUDE.md line added for `PTAH_GIT_MAX_CONCURRENT`
  (`vscode-core/CLAUDE.md:64`: "background lane gets max-1") is actively misleading at
  this one value, since max-1 = 0 there but the effective cap applied is 1. This is
  reachable only via an explicit env override away from the default of 4, but nothing
  validates or warns against setting it to 1. Recommend either forbidding
  `maxConcurrent < 2` in `maxConcurrentFromEnv`/`configure` (falling back to the
  default with a warning, matching the "malformed → ignored" convention already used
  for non-positive values), or updating the doc comment and CLAUDE.md line to state the
  real behaviour precisely. Moderate — no default-path regression, but a footgun for
  anyone who tunes the knob down without reading the source.
- **FIFO correctness across lanes and workspaces**: verified by reading — `dispatch()`
  compares `enqueuedAt` for the two lane heads (`:240-244`) and `head()` reads
  `Map.entries().next()` (`:229-232`), i.e. insertion order, with round-robin achieved
  by delete-and-reinsert-at-tail in `dispatch()` (`:246-251`) exactly as documented.
  Existing specs (551 passed in the base review, now folded into the 599 total) pin
  the 10-concurrent/cap-4 and per-workspace ordering cases; no regression found in this
  delta pass.
- **Slot accounting when a queued caller's caller has gone away**: unchanged from the
  base review's Minor finding — `acquire()` (`:174-184`) never rejects and has no
  `AbortSignal`, so an abandoned caller's waiter is still granted, still spawns a real
  child in `runGitChild`, and still occupies a live slot until that child exits. Not
  addressed by this batch's fixes and not claimed to be; still open. Minor,
  pre-existing.

### 4. `setPriority` skipped after close — VERIFIED FIXED

`lowerProcessPriority(pid, exited)` (`exec-git.ts:495-507`) now takes an `exited` flag
and returns immediately when it is `true`, and the call site
(`runGitChild:525-527`) passes the live `exited` variable via a closure captured at
the time `whenSpawned` resolves, not at call-site-fixed-value time — so a child that
closes between spawn and the OS-priority call is correctly skipped. The base review's
residual "pid reuse" note (`os.setPriority` racing a pid recycled between check and
syscall) is explicitly still open and undiminished by this change: the check-then-act
window between reading `exited` and calling `os.setPriority` is unchanged (still a
single synchronous call, still swallowed generically). Correctly scoped as a narrow,
low-likelihood residual — matches the base review's own "low priority given the narrow
window" framing. No regression.

### 5. Trailing-run priority — comment added, behaviour unchanged (as intended)

`singleFlight`'s doc comment (`git-info.service.ts:423-431`) now states the accepted
behaviour explicitly: "a joiner shares the running computation's priority, and the
trailing run keeps the `compute` of whoever queued it first ... accepted, since the run
is already underway or already owed." The executor logic itself
(`:463-478`, `startFlight`) is unchanged in this respect — still installs only the
first queuer's `compute`. This resolves the base review's ask (document the chosen
behaviour) without changing it, which was one of the two options the base review
offered ("acceptable... worth a one-line doc note"). No test pins the specific
cross-priority race (a watcher-queued trailing run silently downgrading a later
foreground caller), consistent with the base review's characterisation of it as
"undocumented and untested" — now documented, still untested. Minor residual.

### 6. `configureGitProcessGate` called from every `GitInfoService` construction

- **Multiple construction (tests, multiple containers, VS Code + CLI in one
  process)**: `configure()` (`exec-git.ts:184-192`) only reassigns `this.warn` when a
  `logger` is passed, and `GitInfoService`'s constructor call never passes
  `maxConcurrent` (`git-info.service.ts:309`: `configureGitProcessGate({ logger })`).
  So repeated construction is "last-writer-wins" for the *warn sink* only — harmless
  in the three real hosts, since each process constructs exactly one `GitInfoService`
  (verified: `apps/ptah-electron/src/di/phase-4-handlers.ts:113`,
  `apps/ptah-extension-vscode/src/di/phase-3-handlers.ts:57`,
  `libs/backend/cli-engine/src/lib/container.ts:406`, all single call sites, all via
  tsyringe singleton-by-default registration). `maxConcurrent` can never drift between
  hosts sharing a process because no call site ever sets it after the module's first
  read of `PTAH_GIT_MAX_CONCURRENT` (`maxConcurrentFromEnv()`, `:169`). Tests that
  construct `GitInfoService` repeatedly rely on `resetGitProcessGateForTests()`
  (grep confirms it's called in `git-info.service.spec.ts` `beforeEach`), so no
  cross-test leakage. No bug found here.
- **`execGit` called before any `GitInfoService` exists**: confirmed both
  `libs/backend/task-specs` and
  `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/git-namespace.builder.ts`
  call `execGit`/`execGitBuffer` directly, with no `GitInfoService` dependency. The gate
  still works correctly with defaults: `gitProcessGate()` lazily constructs with
  `maxConcurrentFromEnv()` (`:169-171`) regardless of whether `configureGitProcessGate`
  has ever run, so concurrency capping and `PTAH_GIT_MAX_CONCURRENT` both apply from the
  very first call. **The logger gap is real, though**: the default `warn` is a silent
  no-op (`exec-git.ts:161`: `warn: (message: string) => void = () => undefined`), not
  `console.warn` — so in any window before the process's one `GitInfoService` is
  constructed (a tsyringe `useFactory` registration resolves lazily, on first inject;
  for the VS Code host in particular, phase-3 wiring may run after other phases that
  could reach `git-namespace.builder.ts`'s tools), a saturation warning is not merely
  routed to the wrong sink — it is dropped with no trace anywhere, not even stdout.
  This is silent by construction, not a regression this batch introduces (the base
  review's Q1 already named "no counted/logged occurrence" for a related swallow), but
  it is a new instance of the same pattern, scoped to the diagnostic path this batch
  added specifically to make saturation observable. Moderate: the one signal meant to
  catch "the gate is under load" can itself go dark depending on DI resolution order,
  with no way for an operator to know it happened.

### 7/8. Barrel exports and CLAUDE.md accuracy

- `libs/backend/vscode-core/src/index.ts:99-116` now re-exports `execGit`,
  `configureGitProcessGate`, `GitOutputLimitError`, `DEFAULT_GIT_TIMEOUT_MS`,
  `WORKTREE_GIT_TIMEOUT_MS`, `DEFAULT_GIT_MAX_OUTPUT_BYTES`,
  `GIT_STATUS_MAX_OUTPUT_BYTES`, `DEFAULT_GIT_MAX_CONCURRENT`, and the types
  `ExecGitOptions`, `ExecGitResult`, `GitGateLane`, `GitProcessGateConfig`. This closes
  the style review's Serious #3 (typed error unreachable from outside the lib) for
  every symbol it names, and `GitProcessGate`/`GitSlotRelease` are the only two
  new symbols from `exec-git.ts` still not re-exported — consistent with them being
  internal to `GitInfoService`'s wiring (no external consumer needs the class itself,
  only the config type and the error), so this reads as a deliberate, correct scope
  choice rather than an oversight.
- `vscode-core/CLAUDE.md:36` (Public API line) lists the new git surface by name
  (`GitInfoService`, `execGit`, all six new constants/types, `configureGitProcessGate`)
  and states the gate's contract in one sentence matching the code
  (`PTAH_GIT_MAX_CONCURRENT`, "background-priority and >60 s calls capped at max-1 so
  interactive reads always have a slot" — this sentence is the one made imprecise by
  the `max=1` finding above, since at `max=1` interactive does *not* always have a
  slot). The env var table addition (`CLAUDE.md:64`) is otherwise accurate and correctly
  formatted to match the existing table's columns. This resolves the style review's
  Serious #3 and Minor env-var-table finding for every value except the `max=1` edge,
  where the documentation is now confidently wrong rather than silently absent.

### Batch 6 ST-1b spawn-count variance (0, then 3)

Assessed against this batch's changes, not reproduced here (no access to the Batch 6
stress harness run). Two changes in this batch are directly capable of shifting *when*
git children spawn during a watcher storm, independent of AC-1/AC-2's own logic:

1. `refreshGitInfo` no longer delegates to `getGitInfo`'s cache path; it now always
   calls `computeGitInfo` through its own `singleFlight` key
   (`git-info.service.ts:403-406`, `info|${workspacePath}|` vs. the previous shared
   `getGitInfo` key). Before this batch, a watcher-triggered `refreshGitInfo` and a
   concurrent `getGitInfo` call could share one in-flight computation through the same
   key; the diff does not change key-sharing between the two (both still key on
   `info|${workspacePath}|`), so this alone should not add spawns — but it does mean a
   `refreshGitInfo` call now explicitly threads `'background'` priority into every
   child of that run (`os.setPriority`), which changes *scheduling*, not *count*, of the
   spawned children.
2. The two-lane gate can genuinely delay when a queued call's child is spawned relative
   to a storm window: a call queued in the background lane during a storm, with
   interactive calls continuously arriving, can be pushed out past the storm's own
   debounce window before `dispatch()` admits it (see the starvation finding above).
   If Batch 6's stress spec counts "git spawns observed within the storm window," a
   background-lane call delayed past that window by contention would not disappear —
   it would still spawn, just later, once interactive traffic clears. That is a
   plausible mechanism for a spawn count that varies between runs (0 vs. 3) depending
   on exactly how the interactive/background interleaving falls out under fake-timer or
   real-timer scheduling, without any change to AC-1/AC-2's own invalidation or
   dedup logic in `git-info.service.ts`.

This is a **plausible timing mechanism this batch introduces**, not a confirmed
root cause — verifying it needs the actual Batch 6 harness output correlated against
gate `queuedCount`/`liveCount` at the moment of the storm, which is outside this
review's evidence base. Recommend the executor (or Batch 6's owner) add a
`liveCount`/`queuedCount` log line around the ST-1b window to confirm or rule this out
before treating the count variance as harness flakiness. AC-1/AC-2 themselves (as
defined in the implementation plan for whichever batch owns them — not re-derived
here) are not evaluated by this delta review; only the mechanism by which Batch 12
could shift observed spawn timing is assessed.

### Delta verdict

- Recommendation: **APPROVE_WITH_FIXES**
- Confidence: HIGH for items 2, 4, 5, 7/8 (each independently verified against the
  current source and the green 599/599 suite); MEDIUM for item 1's frontend gap and
  item 3's `max=1`/starvation findings (verified by reading, not exercised by a new
  test); LOW for the ST-1b mechanism (plausible, not reproduced).
- Base review's Serious #2 (`onError` no-kill) and Serious #3 (no lane separation) are
  **closed**. Base review's Serious #1 (`GitOutputLimitError` has no consumer) is
  **closed at the backend/type layer and reopened one layer up**: the typed signal now
  exists end-to-end to the RPC boundary, but `libs/frontend/git-ui` drops it on the
  floor, so the user-visible symptom (git panel reads "no changes" for an unreadable
  repository) is unchanged today. This is the top remaining risk from this batch.
- New findings from this delta pass, not in the base review: the `max=1` background-cap
  edge case silently reintroduces the exact starvation this batch exists to prevent
  (Moderate); the CLAUDE.md sentence describing the gate is now precise everywhere
  except that edge (Minor); the saturation-warning sink can go dark before any
  `GitInfoService` is constructed in a process (Moderate); background-lane starvation
  under constant interactive load is real but undocumented as a possibility, only as a
  cap value (Moderate).
- Recommended fixes before this is fully clear: (a) wire `statusUnavailable` through
  `GitStatusService` and its consumer component — the smallest version is the two
  `git-status.service.ts` edits above; (b) either forbid `PTAH_GIT_MAX_CONCURRENT=1`
  (fall back to default with a warning) or correct the CLAUDE.md/class-doc claim that
  interactive always has a slot; neither is large, and (a) closes the one finding that
  actually reaches an end user today.
