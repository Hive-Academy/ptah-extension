# Code Logic Review — Batch 3 (`TASK_2026_437_0778`)

Scope: `libs/backend/vscode-core/src/services/git-info.service.ts`,
`libs/backend/vscode-core/src/services/git-info.service.spec.ts` (Task 3.1: flight
record + `refreshGitInfo`, C4/INV-3).

## Summary

| Metric              | Value                |
| -------------------- | -------------------- |
| Overall score        | 8/10                 |
| Assessment            | APPROVED              |
| Blocking issues       | 0                     |
| Serious issues        | 0                     |
| Moderate issues       | 2                     |
| Failure modes found   | 1 (accepted P1 limit) |

`npx nx run-many -t test -p @ptah-extension/vscode-core` — header confirms 1 project,
36 suites / 554 tests pass, including the 6 new specs in the "single-flight read runs"
block.

## Five logic questions

### 1. How does this fail silently?

Not found. A rejected/timeout run propagates through `running` to every joined caller
(`git-info.service.ts:453-459` `onSettled` never swallows a rejection; the trailing run
is started independently via `.then(trailing.resolve, trailing.reject)`,
`:456-458`). `startFlight`'s try/catch (`:427-431`) converts a synchronous throw into a
rejected promise rather than an uncaught exception — this also prevents the record from
being wedged open forever, which would otherwise be a silent-hang failure mode.

### 2. What user action produces unexpected behaviour?

A plain `getGitInfo` RPC read (not through `refreshGitInfo`) that lands while another
`getGitInfo`/`refreshGitInfo` for the same workspace is running, and an unrelated
invalidation (e.g. a stage/commit from another tab) fires in between, now waits for a
**second** sequential `git status` pipeline instead of joining the one already running.
Before this diff, `getGitInfo` used plain `coalesce` with no staleness check, so any
concurrent caller got the in-flight result immediately (`git-info.service.ts` diff,
old `coalesce`). This is a real latency regression for that interleaving, not a
correctness bug — every consumer still receives status that is at least as fresh as the
one they asked for. It is also a deviation the executor called out explicitly ("`getGitInfo`
routes to the queued rerun instead of joining a stale run"), but it reads as a divergence
from the plan's stated intent ("`getGitInfo` keeps 'join whatever is running' semantics for
RPC reads", `implementation-plan.md:316`). Flagging as Moderate — see below.

### 3. What input data produces a wrong answer?

None found for this diff's scope. Traced the generation bookkeeping for cross-workspace
interference (a hunt-list item): `generationOf(ws)` is `max(invalidatedAllAt,
invalidatedAt.get(ws))` (`:374-379`), and `invalidatedAt` is an exact-match `Map<string,
number>` keyed by the literal `workspacePath` string — not the `key.includes(suffix)`
substring test `readCache`/older code used. Two workspace roots where one path is a
prefix of the other (`D:\a` vs `D:\ab`) cannot collide here because `Map` lookup is exact
equality, not substring containment; that hunt-list risk applies to the
`readCache`/`invalidatedAt`-adjacent `suffix` loop at `:349-352`, which is unchanged
pre-existing code, not new in this diff, and was already exact enough (`|D:\a|` cannot
match inside `|D:\ab|remote` because the character after `a` must be `b`, not `|`).

Walked the generation math by hand for interleaved cross-workspace invalidation
(A running at gen 0, B invalidated to gen 1, A invalidated to gen 2) — confirms A's
flight is correctly judged fresh after B's invalidation and correctly judged stale only
after A's own. Matches the "refreshing one workspace does not queue a rerun for
another" spec (`git-info.service.spec.ts:1780-1802`).

### 4. What happens when a dependency fails?

`exec-git`'s 10 s timeout rejects `computeGitInfo`, which itself maps that error to an
empty `GitInfoResult` internally (comment at `implementation-plan.md:316-346` cross-
references `:415-433` in the pre-diff file) — so `running` still resolves, `onSettled`
fires, and the queued trailing run starts on schedule. This is pinned by the "timed-out
git status" spec (`git-info.service.spec.ts:1817-1849`), which also documents the
accepted P1 gap: the hung child from the timed-out run is not confirmed dead before the
trailing run spawns a second one (deferred to P2 per the executor report and
`implementation-plan.md:319-321`, "acceptable until P2 holds the slot to child exit").
That gap is disclosed, not hidden, and out of Batch 3's stated scope.

### 5. What is missing that the requirements never mentioned?

- `invalidatedAt` (`:325-330`) accumulates one entry per distinct `workspacePath` ever
  invalidated for the lifetime of the singleton, with no eviction. In practice this is
  bounded by the number of folders a workspace ever opens across a session — not a
  practical leak, but nothing in the plan or the diff comments says so explicitly.
- No normalization of `workspacePath` casing/separators before it is used as a `Map`
  key in `invalidatedAt`/`flights`. If a caller ever passes the same root with different
  casing or trailing-slash conventions (Windows is case-insensitive), the generation
  bookkeeping would silently treat it as a different workspace and an invalidation
  could fail to mark a running flight for "the same" root as stale. I did not find a
  caller in this batch's diff that does this — `refreshGitInfo`/`getGitInfo` are always
  called with whatever string the watcher/RPC layer already normalized upstream — so
  this is pre-existing risk inherited from the surrounding file, not introduced here.

## Failure modes

### Hung child survives a timed-out run (accepted P1 gap)

- Trigger: `git status` exceeds `exec-git`'s timeout while a trailing run is queued.
- Symptom: two `status` children briefly alive at once (`maxLive` can exceed 1 for the
  short window before the first child's process actually exits) — the acceptance
  criterion documented as P2 work.
- Evidence: `git-info.service.spec.ts:1839-1848` asserts this exact shape and comments
  it as intentional.
- Current handling: the flight settles on timeout (not on child exit), so waiters are
  never stranded; the slot is freed immediately rather than held to child exit.
- Recommendation: none for Batch 3 — this is explicitly P2 scope per
  `implementation-plan.md:319-321`. Confirm the P2 batch exists and is not dropped.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

- **Moderate** — `getGitInfo` no longer always joins an in-flight run; it now applies the
  same staleness check as `cachedRead`, so a concurrent RPC caller can be routed to a
  second sequential `git status` pipeline when an unrelated invalidation lands mid-run.
  This is a latency change from the plan's stated semantics ("keeps 'join whatever is
  running' semantics for RPC reads", `implementation-plan.md:316`), self-disclosed by the
  executor as a deviation. Not incorrect (results are never stale), but the team-leader
  should explicitly accept this deviation against the plan rather than let it pass
  silently, since a different design ("always join, never generation-check `getGitInfo`")
  was written down as the requirement. `git-info.service.ts:481-484`.
- **Minor** — `invalidatedAt` (`:330`) has no bound or eviction policy; document the
  assumption (bounded by distinct workspace roots opened this session) or add a note
  next to the field, matching the doc-comment discipline the rest of the file already
  uses.
- **Minor** — no explicit path-normalization contract for `workspacePath` as a `Map` key
  is stated near `invalidatedAt`/`flights`, unlike `readCache`'s substring-match comment
  which at least explains its own risk. Inherited from the surrounding file, but worth a
  one-line note given this diff adds two new exact-match maps keyed the same way.

## Data flow

1. Caller invokes `getGitInfo`/`refreshGitInfo`/one of the five `cachedRead` methods —
   OK, all pass `workspacePath` through to `singleFlight`.
2. `refreshGitInfo` invalidates first (bumps `cacheGeneration`, records
   `invalidatedAt`), then calls `getGitInfo` — OK, the just-bumped generation makes any
   fresh `startFlight` immediately "current" by construction (verified by hand-trace).
3. `singleFlight` looks up the per-key flight: no flight → `startFlight`; flight fresh
   (started at/after current generation) → join `flight.running`; flight stale → join or
   create the single `flight.trailing` — OK, matches INV-3 ("never two runs per key"),
   pinned by five specs.
4. `startFlight` runs `compute()`, registers `onSettled` on both branches (resolve and
   reject) — OK, no unhandled-rejection risk since `.then(resolve, reject)` chains
   downstream, and no stranded caller on rejection/timeout (spec-proven).
5. On settle, `onSettled` checks identity (`flights.get(key) === flight && flight.running
   === running`) before mutating — OK, this guard is unreachable in practice since Node
   is single-threaded and no `await` occurs inside the critical section, but it is a
   correct defensive measure if that invariant is ever broken by a future edit.
6. `cachedRead`'s wrapped compute captures `startedAt` synchronously at actual run start
   (not at call time) and writes back to `readCache` only if `startedAt >=
   generationOf(workspacePath)` — OK, prevents the stale-write-back this batch exists to
   fix, proven by the "cached read invalidated mid-run" spec.
7. `invalidateReadCache` drops only settled `readCache` entries, never touches `flights`
   — OK, matches the doc comment and INV-3; the git watcher's own adoption of
   `refreshGitInfo` (replacing its separate `invalidateReadCache` + `getGitInfo` calls at
   `apps/ptah-electron/src/services/git-watcher.service.ts:667,671`) is Batch 4 scope,
   confirmed still using the old two-call pattern in the current tree — expected, not a
   Batch 3 defect, since Batch 4 depends on Batch 3 landing first.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Flight record `{running, startedAtGeneration, trailing?}` replaces `coalesce` in place | COMPLETE | none |
| `invalidateReadCache` bumps generation, drops settled cache only, never deletes in-flight | COMPLETE | none |
| `refreshGitInfo(workspacePath)` public API, joins/starts a run begun after the call | COMPLETE | none |
| Never two runs per key (INV-3) | COMPLETE | proven by 5 spawns-counting specs |
| A rejection settles waiters and the queued trailing run still starts | COMPLETE | proven by dedicated spec |
| All `cachedRead` call sites updated with `workspacePath` (R-P4) | COMPLETE | 5 call sites (branches, stash, tags, remotes, lastCommit) all pass `workspacePath` |
| `getGitInfo` keeps "join whatever is running" semantics for RPC reads | PARTIAL | now generation-checked like every other read; see Moderate finding above |
| No timers; O(1) map ops | COMPLETE | confirmed — no `setTimeout`/`setInterval` added |

Implicit requirements not addressed: none material found beyond the two Minor notes
above.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Concurrent identical `cachedRead` calls, no invalidation | YES | join `flight.running` | none |
| Invalidation mid-run, single follower | YES | creates `flight.trailing`, starts on settle | none |
| Invalidation mid-run, 5 followers | YES | all 5 share the one `flight.trailing.promise` | none |
| Two workspaces invalidated independently | YES | `invalidatedAt` per-root plus `invalidatedAllAt` Math.max | none |
| Global invalidation (no `workspacePath`) | YES | `invalidatedAllAt` folds into every `generationOf` via Math.max | none |
| Compute rejects | YES | `running` rejects, waiters reject, trailing still starts | none |
| Compute times out (exec-git 10s) | YES | timeout maps to empty result upstream, flight settles | hung child may outlive settle (documented P2 gap) |
| Synchronous throw from `compute()` | YES | caught, converted to `Promise.reject`, flight still clears | none |
| Same-instant `getGitInfo` join during a fresh (non-stale) run | YES | joins `flight.running` | none |
| `getGitInfo` join during a stale run | CHANGED | routed to trailing instead of the old "always join" | see Moderate finding — latency, not correctness |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: the `getGitInfo` semantics deviation (always-join → generation-checked) is
  correct and tested but diverges from the plan's literal wording; if a downstream
  consumer depends on the old "never wait twice" latency characteristic for RPC polling,
  it will regress silently unless the team-leader explicitly signs off on the deviation.
- What a robust implementation would add: a one-line doc note on `invalidatedAt`'s
  growth bound, and either a normalization step or an explicit comment on the
  case/separator assumption for `workspacePath` as a `Map` key (shared with the rest of
  the file, not unique to this diff).
