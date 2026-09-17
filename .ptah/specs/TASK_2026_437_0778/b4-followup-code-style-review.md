# Code Style Review — `TASK_2026_437_0778` (Batch 4 follow-up, fix for Batch 6 stress failures)

## Summary

| Metric          | Value               |
| --------------- | ------------------- |
| Overall score   | 6/10                |
| Assessment      | NEEDS_REVISION      |
| Blocking issues | 0                   |
| Serious issues  | 2                   |
| Minor issues    | 3                   |
| Files reviewed  | 3 (1 impl + 2 spec) |

Scope: `apps/ptah-electron/src/services/git-watcher.service.ts` (+`.spec.ts`),
`apps/ptah-electron/src/services/git-watcher.stress.spec.ts` (untracked, new). Verified in
`D:\projects\ptah-437`: `npx nx lint ptah-electron --skip-nx-cache` — 0 errors, 4 pre-existing
warnings, none in the reviewed files, no `max-lines` warning on `git-watcher.service.ts` despite
its growth to 1196 raw lines (`wc -l`). `npx ts-node tools/degradation-audit/check-degradation.ts`
— `apps/ptah-electron: 4 ok (baseline 4)`, unchanged from Batch 4's own evidence line, exit 0.

## Five style questions

### 1. What breaks in six months?

The new own-refresh-echo and unattributed-change mechanism (`git-watcher.service.ts:177-197`
fields, `:275-291` constants, `:717-799` methods) is embedded directly in `GitWatcherService`
with no deferred-follow-up entry anywhere in `batches.md`. Batch 4 set a precedent for exactly
this situation — FU-4a names the storm-exit-loop duplication by line range and states plainly
"Batch 11's coalescer MUST remove both copies" (`batches.md:287`, `b4-code-style-review.md:118-124`).
This follow-up adds a second git-specific, `fs.watch`-specific mechanism of comparable size
(~90 lines: `mayBeOwnRefreshEcho`, `scheduleUnlessDirectoryEcho`, `noteUnattributedChange`,
`armUnattributedChangeTimer`, `clearUnattributedChange`) without saying what happens to it when
Task 11.1 (`batches.md:577-581`) moves `GitWatcherService` onto `IWorkspaceWatcher`. Task 11.1's
own task line only mentions deleting "the recursive `fs.watch` path, per-event filter and
in-process breaker use" — it does not mention this mechanism because it did not exist when that
line was written. Whether the echo/unattributed logic (a) has no `@parcel/watcher`-backed
equivalent problem and can simply be deleted, (b) belongs in `ElectronWorkspaceWatcher` as a
host-level concern, or (c) is `git status`-specific and must survive as a `GitWatcherService`
collaborator regardless of the transport underneath — is exactly the kind of decision Batch 4
flagged for the _storm_ loop and did not flag here. Six months out, whoever executes Batch 11
either has to rediscover this mechanism from the diff or ports it blind.

### 2. What would a new team member misread?

`onWorkspaceEvent` (`:679-706`) now has a `null`-filename branch that returns from inside the
`switch`-like handling for `record()`, immediately followed by `if (filename.includes('.git'))`
narrowed on the assumption that `filename` is a `string` at that point. A reader has to trace
that all three `record()` outcomes (`'storming'`, `'entered'`, `'normal'`) `return` before falling
through, and that TypeScript's control-flow narrowing (not an explicit guard) is what makes
`filename.includes(...)` on the next line safe. `isIgnoredWorkspaceEvent`'s signature change
(`filename: string | null` → `filename: string`, diff `:584-586`) pushes the null-handling
responsibility one call frame up into `onWorkspaceEvent`, which is the right direction, but there
is no doc comment on `onWorkspaceEvent` itself stating "by the time this line runs, `filename` is
provably non-null" the way the file documents its other non-obvious orderings (e.g. the `.git`
detection preceding the exclusion filter, called out explicitly in Batch 4's own style review as
a case the code got right by writing down the "why").

### 3. What does this cost to maintain?

Four new instance fields, two new static constants, and five new private methods, none of them
facade-rule extracted despite the file now sitting at 1196 raw lines (up from Batch 4's already
1022). The lint gate stays green only because `skipComments: true` — the growth is real, mostly
comment-carried (consistent with Batch 4's own finding that this file's growth is "carried mostly
in the extensive TASK_2026_437 doc comments"), but the two new stateful mechanisms
(`ownRefreshesInFlight`/`ownRefreshEchoUntil` and `unattributedChangeAt`/`unattributedChangeTimer`)
are exactly the kind of independently-testable unit the facade rule exists for: each has its own
constant, its own arm/clear pair, and its own invariant ("exactly one safety refresh per quiet
window," "an echo check runs `stat` only inside the window"). Neither is a `helpers`/`utils` grab
bag — `OwnRefreshEchoGuard` and `UnattributedChangeDebouncer` (or one `WatcherEventFilter`
covering both) would each pass the nameability test on their own. This was not done, and — per
point 1 — may not be worth doing now given Batch 11's imminent rewrite; the same "do not extract,
it is about to move" call Batch 4 made explicitly for the storm loop applies here and should be
made explicitly, not left implicit.

### 4. Where is this inconsistent with the rest of the repository?

The stress spec's perf/mechanism split is inconsistent with the very precedent it cites. Task 6.1
names `off-thread-process-spawner.perf.spec.ts` ("`PTAH_PERF_SPECS=1` split") as the pattern to
follow (`batches.md:407`), and that precedent is a **separate file**: mechanism/relative
assertions always run in `off-thread-process-spawner.spec.ts`, and the absolute-ms assertions live
in a dedicated `*.perf.spec.ts` gated by `describe.skip` vs `describe`
(`off-thread-process-spawner.perf.spec.ts:17-47`). `git-watcher.stress.spec.ts` instead puts both
halves in **one file**, gated per-`it` with `if (PERF) { expect(...) }` inline
(`git-watcher.stress.spec.ts:434-437,484-487`). `test-report-b6.md:65` itself claims this "matches
the `off-thread-process-spawner.perf.spec.ts` precedent already in this repo" — that claim is only
true for the env-gating idea, not the file-split structure, and the difference is not cosmetic: it
is the reason `test-report-b6.md:193-204` had to record a whole extra paragraph explaining why the
perf run produced no ms numbers (the mechanism `expect` throws before the `if (PERF)` block is
reached, in the same `it`). A separate `.perf.spec.ts`, as the cited precedent does, would not have
this failure mode — the perf test would run and report event-loop-delay numbers independently of
whether the mechanism test in the other file also passed.

### 5. What would you have done differently, and why is that better rather than merely other?

I would have added one line to `batches.md`'s Batch 4 outcome (a new `FU-4d`, alongside FU-4a/b/c)
naming the echo/unattributed mechanism and stating explicitly whether Batch 11 must port, replace,
or delete it — the same discipline Batch 4 applied to its own duplication finding. I would also
have split `git-watcher.stress.spec.ts`'s perf assertions into their own `*.perf.spec.ts` file
matching the cited precedent's actual structure, which is a smaller change than it looks (move the
two `if (PERF) {...}` blocks and their `histogram` setup into a second file that imports nothing
new) and would have let the perf run report event-loop-delay numbers even while the mechanism spec
was red — which is precisely the failure test-report-b6.md hit and had to explain away in prose
instead.

## Blocking issues

None.

## Serious issues

### New watcher-filtering mechanism has no Batch 11 migration note

- File: `apps/ptah-electron/src/services/git-watcher.service.ts:177-197` (fields), `:275-291`
  (constants), `:717-799` (`mayBeOwnRefreshEcho`, `scheduleUnlessDirectoryEcho`,
  `noteUnattributedChange`, `armUnattributedChangeTimer`, `clearUnattributedChange`);
  `.ptah/specs/TASK_2026_437_0778/batches.md:577-581` (Task 11.1, unmodified by this follow-up).
- Problem: this follow-up adds a second hand-rolled, git-watcher-specific stateful mechanism of
  comparable size and risk to the one Batch 4 already flagged (FU-4a, the storm-exit loop). Unlike
  FU-4a, this one carries no deferred-follow-up entry, so Task 11.1's existing description ("DELETE
  the recursive `fs.watch` path, per-event filter and in-process breaker use") does not account
  for it — a Batch 11 executor reading `batches.md` alone would not know this logic exists, let
  alone what to do with it.
- Impact: whether this logic survives the port to `IWorkspaceWatcher`/`@parcel/watcher` is a real
  open question, not a formality — `@parcel/watcher`'s event shape and Windows backend (native
  debounce, `ReadDirectoryChangesW` via a different code path, cited in
  `implementation-plan.md:137`) may not reproduce either the NTFS directory-echo behaviour or the
  null-filename overflow markers this mechanism exists to filter. Without a recorded decision,
  Batch 11 either silently drops a real fix (regressing the incident this batch exists to close)
  or blindly ports `fs.watch`-specific logic into a `@parcel/watcher`-backed host where it may be
  dead code.
- Fix: add an FU-4d (or equivalent) line to `batches.md`'s Batch 4 outcome naming both new fields'
  purpose and stating the Batch 11 disposition — port into `ElectronWorkspaceWatcher`, keep as a
  `GitWatcherService`-only guard independent of the transport, or confirm-and-delete once the new
  host is proven not to need it.

### Perf/mechanism split does not match its own cited precedent

- File: `apps/ptah-electron/src/services/git-watcher.stress.spec.ts:69,79-89,434-437,484-487`
  (`if (PERF) { expect(...) }` inline inside the same `it` as the mechanism assertions), versus
  `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.perf.spec.ts:17-47` (a wholly
  separate file, `describe`/`describe.skip` gated), which `batches.md:407` names as the pattern to
  follow.
- Tradeoff: the single-file, single-`it` structure means a mechanism failure (as happened in
  `test-report-b6.md:193-204`, the exact defect this follow-up fixes) makes the perf assertions
  unreachable — Jest's synchronous `expect` throw skips the `if (PERF)` block entirely, so a perf
  run produces no event-loop-delay numbers even though the histogram was captured. The precedent's
  file split avoids this by construction: the perf file's assertions do not share a control-flow
  path with the mechanism file's assertions.
- Recommendation: extract the two `if (PERF) { expect(delay...) }` blocks (and the
  `monitorEventLoopDelay` plumbing they depend on) into a sibling `git-watcher.stress.perf.spec.ts`
  gated the same way the cited precedent is, so a future mechanism regression does not also blank
  out the perf signal. Not blocking for this follow-up (the mechanism fix is the priority and perf
  numbers are explicitly out of scope per `test-report-b6.md:229-231`), but worth doing before this
  file is relied on again for a real perf run.

## Minor issues

- `git-watcher.service.ts:180-186` attributes a specific empirical figure — "0.1-0.6 s after the
  storm-exit refresh started" — to "Batch 6 ST-1b" in a doc comment, but `test-report-b6.md` (the
  only Batch 6 evidence document in the task folder) records leak _counts_ and `spawner.calls`
  sequences, never a millisecond timing window for the echo event. Either this number comes from a
  diagnostic run this follow-up performed but did not record anywhere, or it is an approximation
  mislabeled as measured evidence — both are a problem in a task folder where every other
  quantitative claim (`batches.md`, `test-report-b6.md`) is backed by a literal command output or
  file:line. Worth either citing the actual source (a new diagnostic-log excerpt) or softening the
  claim to "observed, not independently re-verified here."
- `git-watcher.service.spec.ts:1041-1042` replaces the removed null-filename `isIgnored` assertion
  with a comment pointing at "the TASK_2026_437 block" rather than a line reference — every other
  cross-reference comment in this same spec file (e.g. the new `// ---- Unattributed (null-filename)
changes — Batch 6 ST-1 finding ----` section headers) names the batch/finding precisely; this one
  is vaguer than its neighbours in the same diff.
- `scheduleUnlessDirectoryEcho`'s catch block (`git-watcher.service.ts:751-756`) is the kind of
  swallowed-failure site `degradation-audit` is built to catch, and it is _not_ flagged (confirmed
  by a live run: `apps/ptah-electron: 4 ok (baseline 4)`) only because the block has no `return`
  statement for the tool's `catch-return-sentinel` check to match — `isDirectory` simply stays
  `false` and execution falls through. The inline comment ("Gone already (or unreadable): not
  provably an echo, so schedule it.") is exactly the reasoning a `degradation-audit:
optional-capability` marker exists to carry; it passes the tool today by the tool's own
  construction (no literal return), not because the block is exempt from the pattern the marker
  convention targets. Not required by the gate as written, but worth a marker anyway so the next
  reader (and the next revision of the detector, which already grew a Zone 2/3 widening pass once)
  does not have to reconstruct why this swallow is intentional.

## File-by-file

### git-watcher.service.ts

Score 6/10 — 0 blocking, 2 serious (no Batch 11 migration note; shared with the stress-spec
structure finding is separate), 2 minor (unsourced timing figure, degradation-audit marker gap).
The core fix is correct and well-targeted: routing a `null` filename through
`EventStormBreaker.record` (`:684-696`) instead of `isIgnoredWorkspaceEvent` returning `false` for
it is exactly the "smallest fix" `test-report-b6.md:244-246` recommended, and the storm-vs-normal
branching mirrors the existing `.git`-marker handling shape already in this file. The own-refresh
echo guard (`mayBeOwnRefreshEcho`/`scheduleUnlessDirectoryEcho`) is narrowly scoped (a `stat` only
inside the echo window, never on the hot path) and well-commented on its own terms. The concerns
above are about what happens to this code next, not about its correctness today.

### git-watcher.service.spec.ts

Score 8/10 — 0 blocking, 0 serious, 1 minor (vague cross-reference). The new `describe` blocks
("Unattributed (null-filename) changes", "OWN-REFRESH ECHO") follow the file's existing
`describe`/`it` naming style, assert on real timer advancement via `jest.advanceTimersByTime` for
the debounce logic and real temp directories + real timers for the echo logic (a deliberate,
commented choice — `:838` "Real temp directories and real timers: the echo check `stat`s the
path"), matching the file's established pattern of using fakes for pure-debounce tests and real I/O
where a real filesystem call is exercised.

### git-watcher.stress.spec.ts

Score 6/10 — 0 blocking, 1 serious (perf/mechanism split diverges from its cited precedent), 0
minor. Temp-dir lifecycle is sound: `beforeEach` creates via `fs.mkdtempSync` under `os.tmpdir()`
(never under the repo, matching `test-report-b6.md:50`'s stated intent), `afterEach` best-effort
`svc.stop()` and `fs.rmSync(..., { recursive: true, force: true })` inside try/catch so one
assertion failure does not orphan the temp tree or skip cleanup — consistent with the file's own
stated risk register (`test-report-b6.md:257-263` notes a `git.exe` child leak on the _spawner_
side, not the temp-dir side, and that gap is unchanged by this follow-up: `CountingProcessSpawner`
still has no explicit kill-on-teardown path for in-flight children, which is a real gap but a
logic/resource-leak concern, not a style one — noted here for the logic reviewer's attention).
`console.log` usage for diagnostic reporting (`reportEventLoopDelay`, `reportMechanism`) matches
the one existing `console.log` precedent in this app's test suite
(`plugin-activation.spec.ts:378`, itself mocking `console.log` rather than using it directly for
output — a lighter but not contradictory precedent) and is explicitly justified in the file's own
header comment ("logged BEFORE any assertion, so a mechanism failure still reports the perf
numbers"). `jest.setTimeout(PERF ? 420_000 : 90_000)` is proportionate to the tree sizes involved
and documented. The QUIET_BASELINE gate (`:244-252`) is a thoughtful, well-commented answer to a
real flakiness source (Windows metadata-flush trail after writing thousands of files) that has no
exact precedent elsewhere in the repo but does not need one — it is justified inline and scoped to
this spec only.

## Pattern compliance

| Repository rule or nearby convention                                        | Status                        | Evidence                                                                                |
| --------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------- |
| `max-lines` 700 (comments/blanks excluded)                                  | PASS                          | live `nx lint` run, 0 warnings on `git-watcher.service.ts` at 1196 raw lines            |
| Facade-rule extraction for new stateful mechanism                           | FAIL (advisory)               | no collaborator extracted for echo/unattributed logic; see Serious + Q3 above           |
| Deferred-follow-up documentation for new watcher-specific mechanism         | FAIL                          | no `batches.md` entry naming the echo/unattributed mechanism's Batch 11 disposition     |
| `catch (error: unknown)` / narrow before `.message`                         | PASS                          | no new `.message` access; new catch block does not need narrowing (no error read)       |
| Static constant naming (`UPPER_SNAKE`, `readonly static`)                   | PASS                          | `UNATTRIBUTED_QUIET_MS`, `OWN_REFRESH_ECHO_MS` match `MAX_PENDING_CONTENT_PATHS` et al. |
| degradation-audit marker on new swallow site                                | PASS (tool), gap (convention) | tool run shows 4 ok/4 baseline; see Minor above on why it isn't flagged                 |
| Perf-spec file-split precedent (`*.perf.spec.ts`, env-gated `describe`)     | FAIL                          | `git-watcher.stress.spec.ts` inlines perf assertions instead of a sibling perf file     |
| Real-service integration testing over mocks (this task's established style) | PASS                          | stress spec uses real `GitWatcherService`, `GitInfoService`, real `git.exe` via spawner |

## Maintenance debt

- Introduced: two new stateful sub-mechanisms inside `GitWatcherService` (own-refresh echo
  tracking, unattributed-change safety refresh), ~90 lines, neither extracted nor flagged for a
  Batch 11 migration decision the way the file's existing duplication (FU-4a) was.
- Retired: the "any non-string filename is unconditionally unexcluded" gap that let a bounded but
  real `git status` leak through on every mass-delete under an excluded tree (the AC-1/AC-2
  failures `test-report-b6.md` pinned).
- Net: positive — the fix closes a reproduced, evidence-backed defect with a narrowly-scoped
  mechanism and real test coverage for both the debounce and the echo paths. The debt is the
  missing paper trail for what happens to this mechanism next, which is cheap to close (one
  `batches.md` line) and costs real time to reconstruct later if left as-is.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Key concern: a second hand-rolled, `GitWatcherService`-specific mechanism has landed without the
  same "here is what Batch 11 must do with this" note Batch 4 gave its own duplication finding —
  that gap is cheap to close now and expensive to reconstruct once Batch 8-11 are underway.
- What a 10/10 version would do differently: add the `batches.md` FU-4d line naming the Batch 11
  disposition of the echo/unattributed logic; split `git-watcher.stress.spec.ts`'s perf assertions
  into a sibling `*.perf.spec.ts` matching the cited `off-thread-process-spawner.perf.spec.ts`
  structure so a mechanism failure never again blanks out the perf signal; and either cite a real
  source for the "0.1-0.6 s" timing figure or soften it to an observation rather than a measured
  fact.
