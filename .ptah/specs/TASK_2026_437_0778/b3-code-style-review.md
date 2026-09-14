# Code Style Review — `TASK_2026_437_0778` (Batch 3)

Scope: `libs/backend/vscode-core/src/services/git-info.service.ts`,
`libs/backend/vscode-core/src/services/git-info.service.spec.ts` (Task 3.1 —
single-flight with trailing rerun, C4/INV-3/AC-3 P1).

## Summary

| Metric          | Value                |
| --------------- | --------------------- |
| Overall score   | 8/10                  |
| Assessment      | APPROVED               |
| Blocking issues | 0                      |
| Serious issues  | 0                      |
| Minor issues    | 3                      |
| Files reviewed  | 2                      |

Verified independently: `npx nx run-many -t typecheck,lint -p @ptah-extension/vscode-core`
(0 errors, 11 pre-existing warnings, none new — confirmed by line number: the only warning
inside the diff's hunks is the pre-existing `max-lines` warning at `git-info.service.ts:1110`
and a pre-existing non-null-assertion at `:2354`, both outside the changed lines); and
`npx nx run-many -t test -p @ptah-extension/vscode-core` (554/554 passed, including the 6 new
specs).

## Five style questions

### 1. What breaks in six months?

Nothing in the mechanism itself — the flight/trailing state machine is self-contained and the
new specs pin the exact case that broke production (`git-info.service.spec.ts:99-131`). The
real six-month risk is size: `git-info.service.ts` was already flagged by the lint
`max-lines` rule before this batch (`:1110`, 1877 lines by the rule's count), and this batch
adds a second independent concern (flight coordination, `:235-250`, `:349-508`) on top of git
query logic that already spans the file. A future contributor adding a seventh `cachedRead`
call site, or a P2 change to `startFlight`'s settle logic, has to read through ~2700 lines of
unrelated git-command parsing to find the ~160 lines that matter.

### 2. What would a new team member misread?

The dual counters `invalidatedAllAt` / `invalidatedAt` (`git-info.service.ts:353-361`) are easy
to misread as redundant with `cacheGeneration`. They are not — `generationOf(workspacePath)`
(`:410-416`) is what makes a `getBranches('/a')` run immune to an invalidation of `/b`, which is
the R-P4 risk the plan called out. The class doc comment above `flights` (`:326-336`) explains
this well; a newcomer who skips straight to `singleFlight`/`startFlight` without reading it could
plausibly "simplify" `generationOf` back to a single scalar and silently reintroduce
cross-workspace staleness.

### 3. What does this cost to maintain?

Two new private methods (`singleFlight`, `startFlight`) plus a new interface (`ReadFlight`) sit
between the old `coalesce`/`cachedRead` pair and 6 unchanged call sites
(`git-info.service.ts:558,2005,2199,2249,2314,2384` — `getGitInfo`, `getBranches`, `stashList`,
`getTags`, `getRemotes`, `getLastCommit`). The replacement is a clean in-place swap (the plan's
own requirement, "`coalesce` REPLACED in place, no parallel helper" — batches.md:218) and every
caller keeps its shape, so the diff cost to future readers is contained to the ~90-line block at
`:349-508`. The `Promise<unknown>` typing on `ReadFlight` and `startFlight` is inherited directly
from the pre-existing `inFlight: Map<string, Promise<unknown>>` — not a new precision loss this
batch introduces.

### 4. Where is this inconsistent with the rest of the repository?

Nowhere structurally. `catch (error: unknown)` is used correctly at the one new catch site
(`:476-479`, guarding a synchronous throw from `compute()`). The generation-bump/conditional
write-back idiom is explicitly reused from `auth:getAuthStatus` (TASK_2026_342) per the class doc
comment (`:346-350`), matching the root `CLAUDE.md` instruction to follow existing idioms rather
than invent a new one. `refreshGitInfo` (`:363-372`) reads like its siblings (`getGitInfo`,
`getBranches`, ...): verb + noun, JSDoc above, `Promise<T>` return. No lint suppression was
added (confirmed by diff inspection — the file's two existing `eslint-disable` lines are outside
the changed hunks).

### 5. What would you have done differently, and why is that better rather than merely other?

I would extract `ReadFlight` + `singleFlight` + `startFlight` + `generationOf` (plus the three
generation fields) into a small collaborator — e.g. `ReadFlightCoordinator` — injected into
`GitInfoService`, keeping `cachedRead`/`getGitInfo`/`refreshGitInfo` as thin call-throughs per the
repo's facade rule (root `CLAUDE.md`, "File size"). That is better than the current placement
only in the sense of the six-month cost in Q1 — the collaborator passes the nameability test (not
`helpers`/`utils`), is well above the ~150-line floor the rule sets, and would not touch any of
the six call sites' signatures. It is not clearly warranted **for this batch**: the file was
already 2.5x over the soft ceiling before Task 3.1, the mechanism is proven correct by 6 new
specs, and this is explicitly a P1 hotfix batch (batches.md:210, "no CLAUDE lane — subtle
concurrency"). Recommending the split as follow-up work, not demanding it here, matches the
review brief.

## Blocking issues

None.

## Serious issues

None. The one candidate — file-size growth on an already-oversized file — is downgraded to
Minor below because the batch did not cross a new threshold (it was already ~2.7x over 700
lines) and the added code is the isolated, well-tested mechanism the plan asked for, not sprawl
into unrelated concerns.

## Minor issues

- `git-info.service.ts:349-508` — the single-flight/trailing-rerun mechanism (`ReadFlight`,
  `singleFlight`, `startFlight`, `generationOf`, plus the three generation fields at `:337-361`)
  is a self-contained, nameable collaborator living inside an already 2725-line file. Recommend
  extracting it as a facade-rule collaborator (e.g. `ReadFlightCoordinator`) in a follow-up batch,
  not this one — see Q5.
- `git-info.service.spec.ts:1588` — the new `describe('GitInfoService — single-flight read runs
  (TASK_2026_437)', ...)` block is not added to the file's top-of-file "Coverage matrix" comment
  (`:1-34`), which every prior addition (`TASK_2026_173`, `TASK_2026_204/205`) recorded. Not
  load-bearing, but the convention exists specifically so a reader can scan one comment instead of
  six `describe` blocks; worth a one-line addition.
- `git-info.service.ts:467-487` (`startFlight`) — `const flight: ReadFlight = this.flights.get(key)
  ?? { running, startedAtGeneration };` followed immediately by unconditionally overwriting both
  `flight.running` and `flight.startedAtGeneration` two lines later makes the `??` fallback
  object's initial field values dead on the reuse path. Harmless (both branches converge on the
  same values), but reads as if the existing record's `trailing` were being preserved through a
  merge, when actually the whole point is that `trailing` is preserved by object identity, not by
  field copy. A comment or a straight `this.flights.get(key)?.trailing` extraction would remove
  the need to explain this on the next read.

## File-by-file

### git-info.service.ts

Score 8/10 — 0 blocking, 0 serious, 2 minor. The rewrite matches the plan's contract exactly
(per-key flight record, generation-checked join/queue, in-place `coalesce` replacement, no new
timers), keeps every existing call site's signature, and adds the one new public method the
watcher (Batch 4) needs. The only real cost is size, on a file that was already the outlier long
before this batch — see Minor issues and Q5.

### git-info.service.spec.ts

Score 8/10 — 0 blocking, 0 serious, 1 minor. Six new specs directly exercise the production
defect (C8: invalidate-then-`getGitInfo` racing a running computation), including a rejection
path and a real fake-timer timeout path that a superficial mock could have skipped. The
`makeCountingSpawner` helper is scoped to the new `describe` block rather than hoisted, which is
appropriate since no other block needs it. Only gap is the missing coverage-matrix entry noted
above.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| `catch (error: unknown)` | PASS | `git-info.service.ts:476` |
| No new `@ts-ignore` / unexplained `@ts-expect-error` | PASS | grep of the diff found none |
| No new lint suppressions | PASS | both existing `eslint-disable` lines predate this diff (spec `:73`, `:1469`); confirmed lint run shows 0 new warnings inside changed hunks |
| Public method naming matches siblings (`get*`/`refresh*` verbs, JSDoc above) | PASS | `git-info.service.ts:363-372` |
| `coalesce` replaced in place, no parallel helper (batches.md Task 3.1 requirement) | PASS | `coalesce` is fully removed; `singleFlight`/`startFlight` are the only replacement path |
| File size soft ceiling (700 lines, facade rule on split) | FAIL (pre-existing, not newly triggered) | lint `max-lines` warning at `git-info.service.ts:1110` (1877 by the rule's count); this batch adds ~160 lines to an already-over file — see Minor issues |
| Test describe-block naming matches sibling blocks | PASS | `git-info.service.spec.ts:1588` matches `:1507` |
| Zero-allocation / O(1) map-op quality bar for this component (plan Q4) | PASS | `singleFlight`/`startFlight`/`generationOf` are all O(1) map lookups; no timers introduced |

## Maintenance debt

- Introduced: a per-key flight-coordination mechanism (`ReadFlight`, `singleFlight`,
  `startFlight`, `generationOf`) plus a new public `refreshGitInfo` API, all inside
  `GitInfoService`.
- Retired: the two-map `coalesce`/`inFlight` scheme, which deleted in-flight entries on
  invalidation and was the direct cause of C8 (races between a watcher invalidation and the run it
  raced).
- Net: behaviourally strictly better (proven by 6 new specs covering join, queue, rejection and
  timeout paths) at the cost of ~160 more lines in a file that was already the repo's largest
  single-responsibility violation before this batch. Net structural debt is flat-to-slightly-worse
  on file size, clearly better on correctness and testability.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: the new mechanism is correct, idiomatic, and matches the plan's contract exactly;
  the only real cost is that it lands inside an already oversized file rather than as its own
  collaborator — worth a follow-up extraction, not worth blocking a P1 hotfix batch on.
- What a 10/10 version would do differently: extract `ReadFlight`/`singleFlight`/`startFlight`/
  `generationOf` into an injected `ReadFlightCoordinator` collaborator (facade rule: `GitInfoService`
  keeps its name, token and method signatures); add the new `describe` block to the spec file's
  coverage-matrix comment; replace the `?? { running, startedAtGeneration }` fallback-then-overwrite
  in `startFlight` with an explicit `existing?.trailing` read so the identity-preservation intent
  is visible without tracing both branches.
