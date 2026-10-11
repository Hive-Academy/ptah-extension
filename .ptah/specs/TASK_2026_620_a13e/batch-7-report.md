# Batch 7 report — Read-side and retention pure baselines

Branch `feat/task-620-memory-skills-bench`, worktree
`D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench`.
No commit made (per assignment). Files outside this batch's list untouched.

## Task 7.1 — Read-side baselines

**Done.** New file
`D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\baselines\read-side-baselines.ts`
(+ spec). Pure and deterministic: no network, no model, no clock, no
filesystem.

Implemented, each citing its design line in the header comment:

- `noMemoryBaseline()` — design :156/:164/:96, injects nothing.
- `lastNMessagesBaseline(sessions, n = LAST_N_MESSAGES)` — design :164;
  `LAST_N_MESSAGES = 50`. Concatenates the seed sessions in the given order
  (caller passes oldest-first, so the tail is newest) and keeps the tail `n`.
  The timestamp stays metadata, not content — that absence is the
  `mem.temporal` date-visibility contrast (design :157).
- `rawTranscriptGrepNewest(sessions, keywords)` — design :156 (update/temporal
  baseline): newest matching line wins; on equal timestamps the later input
  line wins (same tie-break as Batch 6's `latestChunkWins`).
- `rawTranscriptGrepTopK(sessions, keywords, k = GREP_TOP_K)` — design :164;
  `GREP_TOP_K = 5`. Tie-break in order: keyword hits desc, then newer
  timestamp, then earlier input index. Documented in the header.

Reuse, not redefinition: `TranscriptMessage` is extended (not re-declared)
from Batch 6's `write-side-baselines.ts`; keyword matching uses
`normalizeFactText` from Batch 2's `fact-matcher.ts` (R-M4 normalisation), so
grep hits and matcher hits agree on what a token is. `GrepHit` extends
`MatchableMemoryRow` and its `content` is the whole rendered line
`"<timestamp> <text>"`, so the ISO timestamp reaches the R-M4 matcher — the
design :95/:157 point that makes raw grep the date-visibility baseline.

Edge cases handled (spec-pinned): no keywords ⇒ no match (a grep with no
pattern finds nothing); blank keywords never count; `k <= 0` and `n <= 0`
return empty; fewer than N messages returns all; `keywordHits` counts a
keyword once per line; hits and timestamps equal ⇒ input order.

## Task 7.2 — Retention policies

**Done.** New file
`D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\baselines\retention-policies.ts`
(+ spec). Pure; `nowMs` is always an explicit parameter, never `Date.now()`.

Implemented, per design :190:

- `noLifecyclePolicy` — nothing ever archived, deleted or evicted.
- `ageOnlyPolicy` — the current product decision, re-implemented pure, in the
  product's run order (age-delete, archive, then per-workspace cap eviction,
  mirroring `memory-lifecycle.service.ts:110-191` and the store SQL at
  `memory-lifecycle.store.ts:12-48`): archival rows with
  `archived_at < now - deleteAfterDays·DAY_MS` deleted; recall rows with
  `last_used_at < now - archiveAfterDays·DAY_MS` archived at `nowMs`; cap
  eviction per `workspaceRoot` — total removable rows over `maxPerWorkspace`
  evicted oldest `last_used_at` first from the archival tier (graced by
  `RETENTION_CAP_EVICTION_GRACE_MS`), then from recall when the recall tier
  alone is over the cap. Eviction runs over the state after the age steps, so
  a row archived this step counts toward the cap but sits in the grace — the
  fidelity bug I caught and fixed mid-implementation (first version ran
  eviction over the input rows, letting a just-archived row be evicted as a
  recall row).
- `oracleRetentionPolicy` — design :190, "age-only with useful-by-kind and
  `hits > 0` protected". Reading (documented in the source, flagged as a risk
  below): "useful-by-kind" = the per-row `useful` label design :182 gives each
  seeded row, which the suites break down by kind (design :185); a protected
  row (`useful === true` or `hits > 0`) is treated exactly as the current
  policy treats a pinned row — never archived, deleted or evicted, and not
  counted toward the cap.

Defaults are imported, not copied: `MEMORY_LIFECYCLE_DEFAULTS` (30/60/25,000)
from `memory-lifecycle-config.ts` and `DAY_MS` +
`RETENTION_CAP_EVICTION_GRACE_MS` from `memory-retention-config.ts`. The
import is a deep relative path to the two leaf modules because the
`@ptah-extension/memory-curator` barrel drags the whole lib runtime graph
(DI registration, better-sqlite3) into a pure baseline and this jest project
maps no `@ptah-extension` alias at runtime (existing spec imports of the
aliases are all type-only). Documented in the source header.

Edge cases handled (spec-pinned): boundary timestamps (`<`, not `<=`, both
thresholds); pinned and core rows never touched; an archival row with
`archived_at` null behaves like SQL NULL (never selected); custom settings
override the defaults; eviction ties fall back to input order (stable sort);
workspaces evict independently; protected rows do not inflate the cap;
determinism (same rows + `nowMs` ⇒ same decision).

Not modelled, documented in the file header: `quarantined_at` and
corpus-linked-row guards (no such rows exist in the seeded DB, design :182)
and run budgets (a pure policy has no batch limits). Rates: this batch emits
id lists; the `value === num/den` rule lives in Batch 1's `rate()`, which the
suites will apply — nothing here computes a rate.

## Absolute paths changed

- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\baselines\read-side-baselines.ts` (new)
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\baselines\read-side-baselines.spec.ts` (new)
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\baselines\retention-policies.ts` (new)
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\baselines\retention-policies.spec.ts` (new)

## Risks handled

1. **"useful-by-kind" ambiguity (design :190).** Read as the per-row `useful`
   label (design :182) carried with the row's `kind`; protection applies to
   labelled-useful rows of every kind plus `hits > 0`. The row keeps `kind` so
   suites group metrics by kind (design :185). If the phase review reads
   "useful-by-kind" as a per-kind protected-kind set instead, the change is
   one predicate in `oracleRetentionPolicy`.
2. **Eviction-over-post-archive state.** First draft evicted over the input
   rows; a just-archived row would have counted as recall and been the first
   evicted. Fixed: eviction sees deleted rows gone and just-archived rows as
   archival with `archived_at = nowMs`.
3. **Barrel import rejected.** Importing `MEMORY_LIFECYCLE_DEFAULTS` from
   `@ptah-extension/memory-curator` would load the lib's DI graph and native
   sqlite into a pure baseline's jest run; the deep leaf-module import keeps
   the baseline's runtime footprint at two small config constants.
4. **Batch 4 dependency avoided.** The seeded session generator (Batch 4) is
   not committed; read-side inputs reuse Batch 6's `TranscriptMessage` extended
   with an ISO timestamp instead of waiting on Batch 4's types. No task was
   blocked.

## Verification output

- `npx jest -c tools/mcp-bench/jest.config.ts <the two new spec paths> --runInBand`:
  `Test Suites: 2 passed, 2 total` / `Tests: 36 passed, 36 total`
- `npx prettier --check --ignore-unknown <the 4 new paths>`:
  `All matched files use Prettier code style!`
- `npx nx run mcp-bench:typecheck`: completed, `Run duration: 29.6s`, no task
  failures.
- `npx nx run mcp-bench:lint`: completed, `Run duration: 4.3s`, no task
  failures.

## Not done

- Nothing from Batch 7's task list. The full
  `npx nx run-many -t typecheck,test,lint -p mcp-bench` from batches.md was
  not run as one command: the worktree concurrently carries uncommitted files
  from Batches 4, 8, 9 and 11, so a project-wide `test` would run their
  in-flight specs too. The equivalent scoped checks (typecheck, lint, the
  batch's own specs, prettier) all ran and passed, as listed above.
- No commit (per assignment); status after Batch 7 stays `NEEDS REVIEW` for
  Phase 3.1, to be returned by the team-leader.