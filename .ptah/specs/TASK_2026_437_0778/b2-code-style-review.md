# Code Style Review — `TASK_2026_437_0778` Batch 2

## Summary

| Metric          | Value                                |
| ---------------- | ------------------------------------ |
| Overall score   | 8/10                                  |
| Assessment      | APPROVED                              |
| Blocking issues | 0                                     |
| Serious issues  | 0                                     |
| Minor issues    | 3                                     |
| Files reviewed  | 10 (4 modified source, 2 new source, 4 spec files) |

## Five style questions

### 1. What breaks in six months?

Nothing structural. The single risk is `NestedRepoRoots`/`nestedRepoRootOf` and
`EventStormBreaker.msUntilNextPoll` shipping with zero production callers
(`libs/shared/src/lib/utils/nested-repo-roots.ts`,
`libs/backend/platform-core/src/utils/event-storm-breaker.ts:196-201`) — verified
by grep, only spec files and barrels reference them today. If Batch 4/8 (the
named future consumers per `implementation-plan.md` component 3 and
`batches.md` Task 4.1) slip or get re-scoped, this becomes dead public API that
a future maintainer has to either wire up from a stale spec or delete without
knowing why it existed.

### 2. What would a new team member misread?

`DEFAULT_WORKSPACE_EXCLUDES`'s spread of `toWorkspaceExcludeGlobs(NESTED_WORKSPACE_PATH_RULES)`
(`libs/backend/workspace-intelligence/src/file-indexing/workspace-default-excludes.ts:41`)
looks like ordinary list maintenance unless the reader also reads the header
comment explaining it is a derivation, not a hand-added entry — the header is
present and correct, so this is mitigated, but the pattern (derive-then-spread
into a flat list) is new to this file and has no drift test failure message
pointing back to `workspace-scan.constants.ts` if someone deletes the spread.

### 3. What does this cost to maintain?

Low. The two new modules are each single-purpose, pure, zero-dependency where
the target layer requires it (`shared`, `platform-core`), and each carries a
table-driven spec that will catch drift. The multi-segment predicate
(`ruleMatchesAt` in `workspace-scan.constants.ts:227-247`) adds real branching
cost to `isExcludedWorkspacePath`, but it is O(segments × rules) as promised
and the existing single-segment call sites are unaffected (rules default to
`[]`).

### 4. Where is this inconsistent with the rest of the repository?

Nowhere structurally. `EventStormBreaker` in `platform-core/src/utils/` follows
the `glob-watch-plan.ts` "pure utility, not a port" precedent the plan cites
(`libs/backend/platform-core/src/utils/glob-watch-plan.ts:1-38`) down to
comment density and the "why this exists" header style. `NestedRepoRoots` in
`libs/shared/src/lib/utils/` matches the file's own bar: pure, no `fs`/`path`
Node module, exported through the existing `utils/index.ts` barrel exactly like
`parseWorktreeList`. `platform-core/src/index.ts`'s new barrel entries
correctly split `export { ... }` for values from `export type { ... }` for
types (`libs/backend/platform-core/src/index.ts:143-156`), matching the
surrounding barrel's convention and the review brief's requirement.

### 5. What would you have done differently, and why is that better rather than merely other?

I would have held `msUntilNextPoll` back until Batch 4 needs it (or landed it
in the same commit as its first caller), consistent with the general "no
unused public surface" bias document reviewers apply elsewhere in this repo.
It is well tested and cheap, so this is a style preference, not a defect —
`readEventStormBreakerOptionsFromEnv` and `stats()` are both pre-committed by
name in the plan/risk table (R-P5, component 2 "Exposes counters for the log
line"), so only `msUntilNextPoll` lacks that explicit backing.

## Blocking issues

None.

## Serious issues

None.

## Minor issues

- `libs/backend/platform-core/src/utils/event-storm-breaker.ts:196-201` —
  `msUntilNextPoll` has no plan citation (component 2's responsibilities list
  `record`, `poll`, and "counters for the log line") and no current caller.
  Low cost since it is pure and tested, but it is public API surface ahead of
  its consumer. Not blocking; flag for Batch 4 review to confirm it is used as
  designed (precise timer arming) rather than left orphaned.
- `libs/shared/src/lib/utils/nested-repo-roots.ts` (whole file) — `NestedRepoRoots`
  and `nestedRepoRootOf` are unconsumed until Batch 4/11 per the plan's own
  component 3 and component 10 file lists. Justified by the plan (this is
  explicitly "the dynamic half" of D4's fix, batched here because Task 2.2
  names these exact files), but it means Batch 2 ships two files whose only
  current callers are their own spec files — worth a one-line note in the
  batch outcome (mirroring how Batch 3's outcome documented its accepted
  deviations) so a later reviewer does not mistake it for orphaned code.
- `libs/backend/workspace-intelligence/src/file-indexing/workspace-default-excludes.ts:6-15`
  — the header says the drift is "pinned by `workspace-default-excludes.spec.ts`"
  but does not name which invariant (INV-2) is violated if someone reorders or
  removes the spread; the spec itself carries that framing
  (`workspace-default-excludes.spec.ts:1-5`) so this is a minor redundancy, not
  a gap.

## File-by-file

### `libs/shared/src/lib/constants/workspace-scan.constants.ts`

Score 9/10 — 0/0/0. Adds `AGENT_WORKTREE_DIR`, `NESTED_WORKSPACE_PATH_RULES`,
`toWorkspaceExcludeGlobs`, and multi-segment matching to
`isExcludedWorkspacePath` without changing the existing single-segment call
contract (`rules` defaults to `[]`, `:113-131`). Zero-dep maintained (no new
imports). The `git check-ignore -v` evidence embedded in the header
(`:96-104`) follows the file's own established precedent for `.angular`. Case
sensitivity is documented and tested against the derived globs.

### `libs/shared/src/lib/constants/workspace-scan.constants.spec.ts`

Score 9/10 — 0/0/0. Table-driven (`TABLE` array, `:190-224`), covers both
Windows and POSIX separators, negative cases (`.claude/worktrees-old`,
`my.claude/worktrees`), and a drift check that regenerates a RegExp from the
derived globs rather than trusting them (`globToRegExp`, `:296-315`) — a
deliberate zero-dep choice consistent with `shared`'s "no `fs`, no DOM"
guideline, since `picomatch` is not a `shared` dependency.

### `libs/shared/src/lib/utils/nested-repo-roots.ts`

Score 8/10 — 0/0/1 (unconsumed API, see Minor issues). Pure, zero-dep, correct
case-folding logic gated on a Windows-absolute-path regex rather than
`process.platform` (correct — `shared` must stay platform-branch-free per root
`CLAUDE.md`'s environment-branching guidance). `findRoot` is O(depth) as
documented. Imports `GitWorktreeInfo` from a sibling `shared` type module,
which is the allowed internal shape (guideline 2's ban is on re-exporting
*another* `@ptah-extension/*` lib, not on internal cross-references).

### `libs/shared/src/lib/utils/nested-repo-roots.spec.ts`

Score 9/10 — 0/0/0. Covers Windows/POSIX/UNC roots, case sensitivity split by
platform, `..`-climbing rejection, idempotency across spellings, and the
`nestedRepoRootOf` → `NestedRepoRoots.add` handoff the doc comment promises.

### `libs/backend/platform-core/src/utils/event-storm-breaker.ts`

Score 8/10 — 0/0/1 (`msUntilNextPoll`, see Minor issues). Matches the
`glob-watch-plan.ts` precedent in both category (pure utility, not a port) and
comment style. `readEventStormBreakerOptionsFromEnv` correctly takes an env
*map* parameter rather than reading `process.env` directly
(`:266-281`) — this keeps the module `process`-free, which matters because
`platform-core` is compiled into every host including workers; the caller
(a future Batch 4/8 site) is responsible for passing `process.env`. This is
the right shape for a lib whose own `CLAUDE.md` lists no exception for reading
environment variables directly.

### `libs/backend/platform-core/src/utils/event-storm-breaker.spec.ts`

Score 9/10 — 0/0/0. Fake-clock driven throughout, covers sliding-window
boundary straddling, backwards-clock handling, forced-exit re-arming, and
config clamping for NaN/zero/negative/Infinity — a materially harder test
matrix than the plan's minimum ("enter, sustain, exit after quiet, forced
refresh, re-entry").

### `libs/backend/platform-core/src/index.ts`

Score 9/10 — 0/0/0. New exports correctly split value exports from
`export type` re-exports, matching the surrounding barrel and the review
brief's explicit check. Alphabetical-ish grouping preserved.

### `libs/backend/workspace-intelligence/src/file-indexing/workspace-default-excludes.ts`

Score 8/10 — 0/0/1 (redundant header phrasing, see Minor issues). Correctly
imports from `@ptah-extension/shared` (allowed for a normal backend lib) and
derives rather than hand-lists the nested-checkout globs, which is exactly D4's
"single source of truth" fix. No duplicate-entry risk: `.claude-worktrees` and
`.claude/worktrees` were not previously hand-listed, confirmed by reading the
full pre-spread array.

### `libs/backend/workspace-intelligence/src/file-indexing/workspace-default-excludes.spec.ts`

Score 9/10 — 0/0/0. Uses `picomatch` with the same options
(`{ dot: true }`) the real consumer (`WorkspaceFileIndexService`) uses per the
file's own doc comment, so the spec proves the glob behaves the way the
service will actually invoke it, not an idealized match.

### `libs/backend/vscode-core/src/utils/worktree-path.ts` / `libs/backend/agent-sdk/src/lib/helpers/worktree-hook-handler.ts`

Score 9/10 — 0/0/0 (combined, trivial diffs). Both replace a duplicated
`'.claude-worktrees'` literal with the shared `AGENT_WORKTREE_DIR` constant,
exactly as D-evidence in the plan's "Codebase evidence" table specified
(`implementation-plan.md:131`). No behavior change; grep confirms no remaining
`'.claude-worktrees'` string literal outside `workspace-scan.constants.ts` in
the reviewed file set.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| `shared` stays zero-dependency, no `fs`/`path`/Angular/VS Code | PASS | `nested-repo-roots.ts` uses only `RegExp`/string ops; `workspace-scan.constants.ts` unchanged in this respect |
| `platform-core` imports nothing from `@ptah-extension/*` | PASS | `event-storm-breaker.ts` has zero imports |
| `platform-core` exports split `export type` from value exports | PASS | `platform-core/src/index.ts:143-156` |
| No backend lib imports an adapter (`platform-{cli,electron,vscode}`) | PASS | All Batch 2 backend imports are `@ptah-extension/shared` or `@ptah-extension/platform-core` |
| `kebab-case.ts` file naming | PASS | `event-storm-breaker.ts`, `nested-repo-roots.ts` |
| Env vars read via injected map, not `process.env` inline (platform-core) | PASS | `readEventStormBreakerOptionsFromEnv(env)` takes `env` as a parameter |
| Single source of truth for the nested-checkout exclusion list (D4) | PASS | `DEFAULT_WORKSPACE_EXCLUDES` derives from `NESTED_WORKSPACE_PATH_RULES` via `toWorkspaceExcludeGlobs`, pinned by a drift spec |
| Public API surface additions match a named plan/risk-table need | PARTIAL | `stats()`, `readEventStormBreakerOptionsFromEnv`, `nestedRepoRootOf`, `NestedRepoRoots` all trace to named future consumers; `msUntilNextPoll` does not |

## Maintenance debt

- Introduced: one shared exclusion-policy module (`workspace-scan.constants.ts`)
  now answers both the segment-set question and the nested-checkout-rule
  question; one pure storm-breaker in `platform-core`; one pure nested-repo-root
  value type in `shared`. All three are single-purpose and independently
  testable.
- Retired: nothing yet — the duplicated `'.claude-worktrees'` literal is
  retired from its two known sites (`worktree-path.ts`, `worktree-hook-handler.ts`);
  the hand-listed nested-checkout globs never existed in
  `workspace-default-excludes.ts`, so there was nothing to retire there beyond
  future drift risk.
- Net: reduces future drift risk (one rule set feeds four consumers per D4);
  adds a small amount of not-yet-exercised public surface that later batches
  are expected to consume.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Key concern: `NestedRepoRoots`, `nestedRepoRootOf`, and
  `EventStormBreaker.msUntilNextPoll` ship without a production caller in this
  batch; all but `msUntilNextPoll` are explicitly named in the plan's file
  lists for Batch 4/8/11, so this is intentional sequencing rather than scope
  creep, but the team-leader should confirm at Batch 4 that these are actually
  wired up rather than quietly abandoned.
- What a 10/10 version would do differently: land `msUntilNextPoll` in the
  same commit as its first caller (or add one line to the plan/batch record
  naming its consumer now); add a one-line "consumed starting Batch 4" note to
  the doc comments of `NestedRepoRoots` and `nestedRepoRootOf` so a reviewer
  encountering them in isolation does not need to cross-reference
  `batches.md`.
