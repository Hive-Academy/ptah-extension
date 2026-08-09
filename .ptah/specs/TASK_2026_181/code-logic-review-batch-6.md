# Code Logic Review — TASK_2026_181, Batch 6

**Scope**: uncommitted working-tree diff on top of `c122d2441` (Batches 1–5 committed).
10 modified files + 2 new files (`task-filter.ts`, `task-filter.spec.ts`). File set verified
against the Batch 6 task inventory (6.1–6.5) plus the two disclosed out-of-inventory files
(`router.ts`, `task-index.store.spec.ts`) — nothing foreign staged, nothing missing.

## Review Summary

| Metric          | Value            |
| --------------- | ---------------- |
| Overall Score   | 9/10             |
| Assessment      | **APPROVED**     |
| Critical Issues | 0                |
| Serious Issues  | 0                |
| Moderate Issues | 1 (non-blocking) |
| Minor / Notes   | 2                |

## Tree integrity after the disclosed stash cycles

`git stash list` shows one unrelated stash (`ak/quick-fix-discord: vertical marketing video`)
from a different branch — nothing from this task. `git diff HEAD --stat` shows exactly the
10 modified + 2 new files that map onto Tasks 6.1–6.5 plus the two disclosed out-of-inventory
files. No orphaned hunks, no partial edits, no leftover conflict markers. The three
`stash push`/`pop` cycles the developer disclosed left no trace of data loss.

## FR-C1.5 — exactly ONE filter predicate — verified by search, not by trust

- `libs/backend/task-specs/src/lib/task-index.store.ts` `applyFilters` (diff, lines ~114–148)
  no longer contains any comparison against `task.status` / `task.type`. It calls
  `mergeStatusTypeFacets` then the shared `filterTasks`. Confirmed the SQL is unchanged:
  `grep -n "SELECT \* FROM task_specs"` → still `WHERE workspace_root = ?` only, at both
  `listByWorkspace` call sites (lines 289, 484). No `WHERE status IN` was added anywhere.
- Grepped `tasks-rpc.handlers.ts`, `tasks-rpc.schema.ts`, `rpc-tasks.types.ts`,
  `ptah-spec.ts`/`router.ts` for any independent comparison against `.status`, `.labels`,
  `.estimate`, or a hand-rolled `.filter()` over task fields — none found. The only new
  predicate logic anywhere in the four touched libs is in `task-filter.ts`.
- **MCP `ptah_task_list` path** — confirmed genuinely untouched:
  `git diff HEAD --stat -- libs/backend/vscode-lm-tools/` and
  `libs/backend/vscode-core/src/messaging/rpc-handler.ts` both show zero diff. Traced
  `tasks-namespace.builder.ts` → `context.index.list(...)` → `TaskIndexService` →
  `SqliteTaskIndexStore`/`InMemoryTaskIndexStore` `.applyFilters` → shared `filterTasks`. The
  MCP path inherits the fix for free, exactly as claimed.
- **CLI does not filter** — `ptah-spec.ts`'s `runList` sends `filter` (when active) over
  `tasks:list` and emits `result?.tasks` verbatim (no `.filter()` in the response path). The
  new spec `'does not filter locally — the server result is emitted verbatim'` proves this
  with a scripted response containing a task that would NOT match the requested filter — the
  CLI still echoes it. This is the correct test shape to catch a local-filter regression.
- **BR-1** — confirmed no diff to `rpc-handler.ts`'s `ALLOWED_METHOD_PREFIXES` or
  `host-profile/manifest.ts`; `tasks:list` gained one optional param, no new RPC method.

## The parity test is not a tautology — verified independently

`tasks-rpc.handlers.spec.ts`'s new `runFilterParityContract` block builds a **real**
`TaskScannerService` + `TaskIndexService` + store over a `MockFileSystemProvider` seeded with
eight real YAML task carriers, registers a real `TasksRpcHandlers`, and calls the actual
`tasks:list` handler through `getHandler(rpc, 'tasks:list')(params)`. The client side computes
`filterTasks(allTasks, spec, buildTaskGraph(allTasks))` over the handler's own unfiltered
listing. This exercises the full scan → parse → index → RPC-handler pipeline on the server
side against a direct library call on the client side — not two call sites into the same
function. 19 cases across every facet, plus four more for the legacy-fold semantics, run
against both `InMemoryTaskIndexStore` and `SqliteTaskIndexStore`.

Ran independently:

- `npx nx run-many -t typecheck,test,lint -p shared task-specs rpc-handlers ptah-cli
--skip-nx-cache` → **0 typecheck errors, 0 lint errors** (121 pre-existing warnings, none in
  a Batch 6 file), rpc-handlers **1548 passed / 30 skipped** (SQLite blocks self-skip under
  plain Node, exactly BR-13's documented behaviour).
- `npm run test:native -- rpc-handlers --testNamePattern="tasks:list filter parity"` →
  **52 passed, 0 failed** — the SQLite half of the parity block genuinely executes and agrees.
- `npm run test:native -- task-specs --testNamePattern="filter"` → **5 passed** — the new
  `task-index.store.spec.ts` filter cases (both `InMemoryTaskIndexStore` and
  `SqliteTaskIndexStore`, via the shared `runContract`) pass against real SQL.

## Predicate semantics — constructed and verified directly, not read off the tests

- **AND across facets, OR within a facet**: confirmed in `filterTasks`'s body — the loop is a
  sequence of independent `if (facetActive && !facetMatches) return false;` guards (AND), each
  guard itself uses `.includes`/`.some` (OR). Constructed an unlisted case:
  `{ statuses: ['backlog','done'], types: ['BUGFIX'] }` over three tasks with a `null` type —
  correctly restricts to done+BUGFIX only (matches the spec test at line 185).
- **Labels ANY vs ALL**: `matchesLabels` — `mode === 'all' ? selected.every(...) :
selected.some(...)`, both against a `Set` built from `task.labels.map(labelKey)`. Tests
  assert ANY is a strict superset of ALL over the same two labels. Correct.
- **`unestimated` is its own predicate**, not a falsy check: `filter.estimates.includes(task
.estimate)` requires `task.estimate !== undefined` explicitly before the `.includes` call —
  an empty-string or falsy estimate value could never accidentally satisfy `unestimated`
  because the type itself only ever holds a `TaskEstimate` enum value or is absent.
- **BR-10 / free text**: grepped the entire diff for `RegExp`, `.match(`, `.replace(` with a
  dynamic pattern — only two static, non-input `.replace(/\\/g, '/')` calls in test fixture
  path normalization. `includesFold` is `haystack.toLowerCase().includes(needle)`, needle
  case-folded and trimmed, never compiled. The three adversarial cases (`.*`, `Licensing (`,
  `(a+)+$`) are asserted **both** in the unit spec and in the parity block (`'free text that is
regex syntax, matching nothing on both sides'`), and a companion case proves a literal needle
  that is _also_ valid regex syntax still matches when the haystack contains it literally —
  which a compiled-regex implementation would get wrong in the opposite direction. Confirmed
  correct.
- **Label matching reuses `labelKey`**: `task-filter.ts` imports `labelKey` from
  `./task-graph` rather than re-deriving `.trim().toLowerCase()` locally. Confirmed by
  direct import statement (line 33) and by the R9 test class (`Licensing`/`licensing `/`
LICENSING` all resolve to the same match).
- **Sort stability / tie-break by id**: `sortTasks`'s comparator falls through to
  `compareText(a.id, b.id)` on every equal or absent-value case, ascending in both directions
  (intentional, documented, and tested — `'keeps the id tie-break ASCENDING in both
directions'`). Estimate sort uses `tupleIndex(TASK_ESTIMATES, ...)` — grepped the whole diff
  for any numeric estimate mapping (`{XS:0,...}`-shaped object, `.indexOf` against a hand-built
  array, `parseInt` on an estimate) — none exists; `TASK_ESTIMATES`' declared tuple order is
  the only source of truth.

## Developer decisions — adjudicated

1. **`mergeStatusTypeFacets` returning `TaskFilterSpec | null`.** Reasoning verified against
   the code: an empty `statuses` array is the "inactive" sentinel for the whole module
   (`EMPTY_TASK_FILTER.statuses = []`, and `isTaskFilterActive` treats `.length > 0` as the
   activity test everywhere). Writing an empty intersection back as `[]` would therefore silently
   mean "no constraint," which is the wrong answer for two contradictory inputs. `null` →
   "nothing qualifies," and the one caller (`task-index.store.ts` `applyFilters`) maps it to
   `return [];` explicitly with a comment citing the same reasoning. Both sides pinned by test
   (`'returns null — not an empty facet — when the two disagree entirely'` in the shared spec,
   `'returns nothing when the spec and the legacy list contradict'` in the parity block, and
   `'returns nothing when the two disagree entirely'` in `task-index.store.spec.ts`). Correct
   and safe — **agree with the developer**.

2. **Label limits deliberately not applied to the read-path filter.** `TaskFilterSpecSchema`'s
   `labels` field caps only on count (`MAX_TASK_FILTER_VALUES`) and a generous length
   (`MAX_TASK_FILTER_TEXT_LENGTH` = 200), never `MAX_LABELS_PER_TASK`/32-char write caps.
   Commented in the schema and tested (`'accepts a label longer than the write-path cap'`).
   The rationale — a hand-authored carrier with an over-long label still reaches the board, so
   filtering it out would hide the exact task the validation warning exists to surface —
   is sound and consistent with NFR-11 (present-but-malformed data degrades, never
   disappears). **Agree.**

3. **Sorting: absence before direction sign; ordinal-on-lowercase instead of
   `localeCompare`.** `hasSortValue`/`sortTasks` rank absence via `if (aHas !== bHas) return
aHas ? -1 : 1` — unconditional on `sign`, so an unsized task cannot be promoted to "biggest"
   by flipping to descending. Tested in both directions. `compareText` uses
   `.toLowerCase()` + `<`/`>`, never `localeCompare` — the rationale (ICU collation differs
   between the extension host and the webview, and a board that reorders itself between hosts
   reads as a data bug) is real and specific to this codebase's split-runtime architecture.
   **Non-ASCII caveat, not a defect**: ordinal comparison on code points means accented
   characters (e.g. `é`, U+00E9) sort after the entire ASCII alphabet rather than near their
   base letter, unlike a locale-aware collator. This is a known, accepted trade-off of the
   documented rationale rather than an oversight, but **no test exercises a non-ASCII title**,
   so the trade-off is asserted only in a comment, not pinned by a test. Recorded as the one
   moderate, non-blocking finding below.

4. **`TaskFilterSpec`'s shape derived from FR-C1.1, not copied from the plan.** Confirmed
   `implementation-plan.md` never defines `TaskFilterSpec`'s fields — grepped for
   `TaskFilterSpec` across the plan; every hit is either the file-inventory line (§1, row C)
   or a _usage_ of the type in `tasks-store.service.ts`'s planned store shape (§6.1), never a
   field-by-field sketch. Cross-checked `task-description.md` FR-C1.1's nine bullet axes
   (status, type, labels, estimate, executor, parentage, relations [2 sub-values], validity,
   free text) against the eleven fields on `TaskFilterSpec` (`text, statuses, types, labels,
labelsMode, estimates, unestimated, executors, parentage, relations,
hasValidationIssues`) — every axis is represented exactly once, `labelsMode` is the
   ANY/ALL toggle FR-C1.1 calls for, `unestimated` is the "explicit unestimated value" FR-C1.1
   asks for, and nothing unrequested was added. **Agree the derivation is complete and
   disciplined.**

5. **Out-of-inventory files.** `apps/ptah-cli/src/cli/router.ts` — confirmed the two
   `.option()` lines (`--label`, `--estimate`) are load-bearing: without them commander has no
   flag declaration and `SpecOptions.label`/`.estimate` would always be `undefined` regardless
   of what `ptah-spec.ts` does with them — legitimate, not scope creep.
   `task-index.store.spec.ts` — six new cases run through the shared `runContract` against
   **both** `InMemoryTaskIndexStore` and `SqliteTaskIndexStore`; without them, adding the
   `filter` parameter to `TaskIndexFilters` and threading it through `applyFilters` would ship
   with the SQL path for that parameter never executed under any suite — precisely the BR-13 /
   G1 failure shape. Both additions are legitimate and directly serve binding-rule compliance
   rather than expanding scope.

## The pre-existing `rpc-handlers` failure under `test:native` — verified independently

Reproduced exactly as diagnosed. `tasks-rpc.handlers.spec.ts:500-509` (a block untouched by
this diff — confirmed via the diff hunks, which only touch the import block and everything
after line 1121) seeds a `:memory:` database with **only** migration 0029:

```
db.exec(MIGRATIONS.find((m) => m.version === 29)?.sql ?? '');
```

`SqliteTaskIndexStore.insertSql()` (Batch 1, unmodified by Batch 6) has referenced the five
0031 columns (`labels`, `estimate`, `parent`, `duplicates`, `relates_to`) since `3e93069fd`.

```
npm run test:native -- rpc-handlers --testNamePattern="tasks:board exclusions"
```

fails exactly as described — the handler returns an **empty** excluded-folder array instead of
the expected 6 rows, because every seeded insert against the 0029-shaped table throws and is
evidently swallowed upstream. Confirmed this block is invisible under the standard gate two
ways: (a) `npx nx test rpc-handlers` self-skips it (Node ABI 137 vs. the addon's ABI 143,
exactly G1's shape) and reports **1548 passed / 30 skipped**, fully green; (b) `rpc-handlers`
is not in `test:native`'s `DEFAULT_PROJECTS` (`['persistence-sqlite', 'task-specs']`), so a
plain `npm run test:native` (no args) never touches it either — it only surfaces when someone
explicitly runs `npm run test:native -- rpc-handlers`.

This is **G1's exact shape, in a project G1's discharge never covered** — correct diagnosis.

**On the remedy**: the one-line fix (`for (const version of [29, 31])`, matching the sibling
spec's already-applied fix at `task-index.store.spec.ts:42-43`) is correct — verified the
sibling file already does exactly this and passes under `test:native`. **On leaving it
unrepaired**: the developer's own new parity block, in the same file, right below this one,
independently seeds `[29, 31]` correctly (`tasks-rpc.handlers.spec.ts:1556-1557`) and passes.
So Batch 6's own evidence is **not actually blocked** — the "SqliteTaskIndexStore filter
parity" cases pass cleanly under `test:native -- rpc-handlers`; what's blocked is a _clean full
run_ of `rpc-handlers` under `test:native` (1 failure, unrelated to this batch's diff). Citing
NFR-15 ("stop and report... rather than repairing... SHALL NEVER bypass hooks") to leave a
one-line, well-precedented, out-of-scope fix unrepaired is defensible and matches how
`batches.md` itself already treats the `ptah-cli` `NO_COLOR` failure (report, don't fix, same
citation). Recommend the team-leader open a fast-follow tracking item rather than silently
letting it recur — noted as moderate/non-blocking below, not a rejection ground.

## The pre-existing `ptah-cli` `NO_COLOR` failure — reported correctly, verified independently

Not set in the ambient shell by default, so the standard gate run is green. Forced it:

```
NO_COLOR=1 npx nx test ptah-cli --skip-nx-cache
```

fails at `apps/ptah-cli/src/cli/output/formatter.spec.ts:100` (`expect(text).toMatch(/\x1b\[/)`
— asserts ANSI escape codes are present "by default," but `NO_COLOR` correctly suppresses them,
so the assertion is simply wrong under that env var). `formatter.spec.ts` carries **zero diff**
in this batch (confirmed via `git diff HEAD --stat`) and has not been touched by any commit
since `84e8f90ef`, well before this task. Genuinely pre-existing, genuinely unrelated, and
correctly reported rather than silently fixed (NFR-15, matching the batches.md directive
verbatim).

## Binding-rule compliance

| Rule                                                                             | Status                                                                                                                                                                                                             |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| BR-1 (no `ALLOWED_METHOD_PREFIXES`/manifest edit, no new method)                 | ✅ zero diff to `rpc-handler.ts`/`manifest.ts`; `tasks:list` unchanged as a method                                                                                                                                 |
| BR-5 (`renderFrontmatterBlock` untouched)                                        | ✅ not in this batch's diff at all                                                                                                                                                                                 |
| BR-6 (read-path only, no writes/normalization)                                   | ✅ `applyFilters`/`filterTasks` are pure; no write call anywhere in the diff                                                                                                                                       |
| BR-7 (no per-task filename literals / banned path strings)                       | ✅ all fixtures `TASK_2026_3xx`/`TASK_2026_0xx`; grepped for the banned strings — none                                                                                                                             |
| BR-10 (case-insensitive `String.includes`, never `RegExp`)                       | ✅ verified above                                                                                                                                                                                                  |
| BR-13 (`npm run test:native` quoted for SQLite work)                             | ✅ run and quoted above                                                                                                                                                                                            |
| BR-14 / P1 (shared schemas imported, plan §5.1 sketches not copied)              | ✅ N/A — §5.1 concerns the metadata-patch guard from Batch 4; Batch 6 imports `TaskFilterSpecSchema` from `libs/shared` everywhere rather than restating it (`tasks-rpc.schema.ts` comment states this explicitly) |
| TS 5.9 strict / `catch (error: unknown)` / no `any` / no `@ts-ignore` / no stubs | ✅ grepped the full diff — none found; no new `catch` blocks introduced at all                                                                                                                                     |
| Zod 4 at boundaries                                                              | ✅ `TaskFilterSpecSchema` at the RPC boundary; compile-time `z.infer` cross-check against the hand-written interface                                                                                               |

## Findings

### Moderate (non-blocking)

**M1 — No test exercises non-ASCII title sorting under the ordinal comparator.**

- File: `libs/shared/src/lib/types/task-filter.ts:526-531` (`compareText`)
- Scenario: two task titles differing only by an accented character (e.g. `"Ábaco"` vs.
  `"Zebra"`) will sort in raw code-point order under `.toLowerCase()`, placing `Ábaco` after
  `Zebra` — defensible given the documented cross-host determinism rationale, but unverified by
  any test, so a future change to `compareText` could silently produce codepoint-order
  regressions with nothing to catch it.
- Fix: not required to land this batch, but a follow-up spec case (e.g. `it('compares
accented titles by code point, not locale')`) would pin the trade-off the same way every
  other design decision in this module already is pinned.

### Minor / notes (informational, no action required this batch)

**N1 — The pre-existing `rpc-handlers` SQLite failure (line 500-509 of
`tasks-rpc.handlers.spec.ts`) is left unrepaired under NFR-15, correctly reported, but it is a
one-line, already-precedented fix** (`task-index.store.spec.ts:42-43` already does it). Not a
rejection ground — NFR-15 explicitly directs "report, don't repair" for out-of-scope failures,
and Batch 6's own new tests do not depend on this block. Recommend a fast-follow ticket so it
does not resurface as a surprise in a later batch's `test:native -- rpc-handlers` run.

**N2 — `buildListFilter` in `ptah-spec.ts` does not pre-validate `--label` count/length
against `TaskFilterSpecSchema`'s bounds** (`MAX_TASK_FILTER_VALUES` = 64,
`MAX_TASK_FILTER_TEXT_LENGTH` = 200 chars). A caller supplying more than 64 comma-separated
labels gets a generic RPC `INVALID_PARAMS` `Error` thrown from `callRpc` rather than the
CLI's usual `usageError(...)` formatting used for `--status`/`--type`/`--estimate`. This is
consistent with how every other server-validated CLI parameter in this file already behaves
(none of them pre-validate against the Zod bounds either), so it is not a regression this
batch introduces — noted for completeness only.

## Verdict

**APPROVED.** FR-C1.5's single-predicate claim holds under direct search, not just under the
provided test suite: no second implementation was found anywhere in the four touched libs, the
MCP path is verified untouched-and-inherits-correctly, and the CLI verifiably does not filter
locally. The parity test is a genuine end-to-end exercise of the real scan/parse/index/RPC
pipeline against a direct library call, not a comparison of a function with itself. All five
developer decisions under adjudication are sound and each is backed by a specific, readable
test. Both pre-existing failures (the `rpc-handlers` SQLite seed gap and the `ptah-cli`
`NO_COLOR` test) were independently reproduced and confirmed pre-existing/unrelated, and both
are reported rather than silently repaired, matching NFR-15 as already applied elsewhere in
this task. Binding rules BR-1, BR-5, BR-6, BR-7, BR-10, BR-13, and BR-14/P1 all hold.

**Confidence**: HIGH — every claim in the batch's own report was independently re-derived from
the diff, the source tree, or a live test run rather than taken on trust.
