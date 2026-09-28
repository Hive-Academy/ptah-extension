# Batch 15 executor report — ptah_task_list / ptah_task_check paged, summary by default

Lane A (hub), worktree `task-559-mcp-tool-contract`, base HEAD 6bf956902. Not committed; working tree left dirty.
Paths below are relative to `libs/backend/vscode-lm-tools/src/lib/code-execution/`.

## Changes

`namespace-builders/tasks-namespace.builder.ts`

- :205-209: `TASK_LIST_DEFAULT_LIMIT = 25`, `TASK_LIST_MAX_LIMIT = 200` and `TASK_CHECK_ENTRY_CAP = 50`, exported and reused by the tool descriptions.
- :219-231 `TaskListArgsSchema`: keeps `status`/`type`. Adds `limit` (int, 1..200, default 25), `cursor` (string, 1..1024 chars, optional) and `fields` (`'summary' | 'full'`, default `'summary'`).
- :237-245 `TaskListCursorSchema`: a strict `{ v: 1, c: string|null, id: string(min 1) }`.
- :295-322 `TaskListSummaryRow`: `TaskListPageCommon` (`count` = rows on this page, `total` = all rows that match the filters, `nextCursor?`). `TaskListResult` is a union on `fields`. The error variant gains `code?`.
- :343-362 `TaskCheckResult`: adds `excludedTotal` and `invalidTotal`.
- :405-472: the paging helpers `compareListKeys`, `encodeListCursor`, `decodeListCursor` and `toSummaryRow`.
- :633-693 `list()`: Zod failure → `code: 'INVALID_ARGS'`. The cursor is decoded before any index work, and a bad cursor returns `{ ok:false, code:'INVALID_CURSOR' }`. Only `{status, type}` reach the index. The namespace sorts the rows itself, filters them by the keyset, slices, and projects.
- :695-731 `check()`: the verdict `healthy` is computed on the full lists. Each list is then sliced to 50, with the totals reported.

`mcp-core/tool-description.builder.ts`

- :13-17: imports the three constants.
- :216-262 `buildTaskListTool`: the description now states the order (newest first), the paging (`limit 25 (max 200)`, `total`, `nextCursor`), the default summary rows, and how to get a full row (`ptah_task_get` or `fields:'full'`). The schema adds `limit`, `cursor` and `fields`. The old claim "use it to find the highest existing id" was no longer true for a single default page, so it now reads "find the newest ids" (Decision 4).
- :264-277 `buildTaskCheckTool`: "Names every SKIPPED folder" became false, so the description now says "at most 50 of each, excludedTotal/invalidTotal, healthy judged on the full set".

Specs

- `namespace-builders/tasks-namespace.builder.spec.ts:417-817`: 13 list specs and 3 check specs.
- `mcp-core/tool-description.builder.spec.ts:300-338`: 2 description specs.
- Prettier also reflowed the existing `build()` harness (:58-68), formatting only.

## Summary row (default `fields:'summary'`)

The batch asks only for `description` to be dropped. Dropping only that field does not meet the 8k budget for real rows: the audit measured about 383 chars per row without description, which is about 9.6k for 25 rows. The summary row therefore contains:

- `id`, `status`, `type`, `title`, `labels`, `created`, `updated`.
- `estimate`, `parent` and `executor`, each only when set.
- `dependsOn`, `duplicates` and `relatesTo`, each only when non-empty.
- `frontmatterValid: false`, only when the task has issues.

It drops `description`, `folderName` (always equal to `id`, per `task-spec.types.ts:142`) and `validationIssues`. `fields:'full'` returns the unchanged `TaskSpecSummary`.

## Caller table (`ptah.tasks.list` / `.check`)

| Caller                                | file:line                                                                                | Affected by the default change?                                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| MCP `ptah_task_list`                  | `mcp-core/protocol-dispatcher.ts:2251-2257`                                              | Yes. This is the intended surface. The dispatcher passes `args` through unchanged, so the default applies.                            |
| MCP `ptah_task_check`                 | `mcp-core/protocol-dispatcher.ts:2260-2266`                                              | Yes, as intended (capped lists).                                                                                                      |
| `execute_code` `ptah.tasks` namespace | `ptah-api-builder.service.ts:811` (injects `buildTasksNamespace`)                        | Yes. An agent script gets the same paged default. It is agent-only, not a UI surface.                                                 |
| RPC `tasks:list`                      | `libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts:625-641`               | No. It calls `TaskIndexService.list` directly and never goes through the namespace.                                                   |
| Webview board                         | `libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts:2358` (`tasks:board`)    | No. It uses `tasks:board`. No frontend file calls `tasks:list` (the only mention is a comment in `task-filter-bar.component.ts:206`). |
| CLI `ptah spec list` / `check`        | `apps/ptah-cli/src/cli/commands/ptah-spec.ts:444` (`tasks:list`), `:465` (`tasks:board`) | No. RPC only.                                                                                                                         |
| Electron e2e allow-list               | `apps/ptah-electron-e2e/src/specs/rpc-new-features.spec.ts:66`                           | No. RPC name only.                                                                                                                    |

No UI or RPC path reaches the namespace, so no caller needed `fields:'full'`. The default change applies only to the MCP / `execute_code` surface.

## Sizes, 150-task fixture (title 72 chars, description 588 chars, 2 labels, 1 dependsOn, ISO dates)

| Call                                     | JSON chars                           |
| ---------------------------------------- | ------------------------------------ |
| Old code, unfiltered (all 150 full rows) | 164,507                              |
| New default (25 summary rows)            | **7,460** (the spec asserts ≤ 8,000) |
| `fields:'full'`, 25 rows                 | 27,597                               |
| `limit:200`, summary                     | 43,347                               |
| `limit:200, fields:'full'`               | 164,535                              |

The first spell of the summary row kept `frontmatterValid: true` on every row. It measured 8,060 chars and failed the budget spec. That is why `frontmatterValid` is now emitted only when false.

## Cursor design

- **Order.** Rows are sorted newest `created` first, undated rows last, ties broken by `id` with a plain code-unit comparison. Because `id` is the unique folder name, this is a total order. The namespace sorts the rows itself, so the order does not depend on the index store's `localeCompare` order.
- **Cursor.** The cursor is `base64url(JSON {v:1, c:<created of last row>, id:<id of last row>})`. It is a keyset: the next page is every row that sorts strictly after the cursor's key. `nextCursor` is present only when more rows remain after the page.
- **Stability.** Rows never repeat within one walk. A row that exists for the whole walk is never skipped, whatever is added or deleted in the meantime; an offset would skip rows after a deletion. A task added mid-walk appears only if it sorts after the cursor. New tasks are normally the newest, so they sort before the cursor and are not shown. One limit: `created` cannot be written through `ptah_task_update`, but hand-editing it mid-walk can move that single row across the cursor.
- **Past the end.** A cursor that points past the last row returns `ok:true`, an empty `tasks`, the current `total`, and no `nextCursor`.
- **Malformed or forged cursors.** Anything that is not base64url JSON, has the wrong shape, has `v≠1`, or has an empty `id` returns `{ok:false, code:'INVALID_CURSOR'}` (a typed tool error, the same pattern as the other task tools, see `protocol-dispatcher.ts:2218-2222`). An empty string or more than 1024 chars returns `INVALID_ARGS`. A bad cursor never falls back to the first page.
- **Filters.** A cursor is not bound to the filters. Reusing it with other filters still gives a keyset continuation within the new filter set.

## Fails-before (specs run against the pre-fix source, HEAD 6bf956902)

- `tasks-namespace.builder.spec.ts`: 15 of the new specs failed (`Tests: 15 failed, 71 passed, 86 total`):
  - all 5 malformed-cursor cases, because the old schema stripped `cursor` and returned the first page;
  - the default ≤25 rows / ≤8k chars spec;
  - the summary-row spec (description dropped);
  - `fields:'full'`;
  - the 150-task cursor walk;
  - `limit` / `limit>200`;
  - the cursor-past-the-end spec;
  - the add/remove stability spec;
  - all 3 check-cap specs.
- One new spec passed on the old code as well: "hands only status/type to the index". It is a guard that keeps the paging arguments away from the index, not a behaviour change. The invalid-row flag spec was added after that run.
- `tool-description.builder.spec.ts`: the old builder was temporarily copied back in place (`git show HEAD:<file> > <file>`), the spec was run, and then the new builder was restored. Both new specs failed (`Tests: 2 failed, 32 passed, 34 total`).
- After the fix: `tasks-namespace` plus `tool-description` gave 120/120 passing, before the invalid-row spec was added.

## Verification (tails)

- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache --parallel=2` gave √ typecheck, √ lint, √ test, "Successfully ran targets test, lint, typecheck". It was re-run after the last edit.
- `nx run-many -t typecheck -p ptah-cli ptah-electron --skip-nx-cache` gave √ ptah-electron:typecheck and √ ptah-cli:typecheck.
- `nx run ptah-electron:validate-deps --skip-nx-cache` gave "Successfully ran target validate-deps". No `from "<word>"` appears in any new string literal.
- `nx run degradation-audit:lint --skip-nx-cache` gave `TOTAL 300 unsuppressed site(s)`, "Successfully ran target lint". The first run gave 301, caused by the new `decodeListCursor` catch. That catch now carries a `// degradation-audit: reported — …` marker, which is honest because the null becomes an `INVALID_CURSOR` tool error. The baseline is untouched.
- `prettier --check` on the 4 changed files gave "All matched files use Prettier code style!".
- `git status --short`:
  - `M` for the 4 source/spec files above.
  - `??` for `code-logic-review.md` and `research/diagnostics-worktree-repro.ts`, which were already untracked before this batch and are not mine.
  - This report.

## Deviations

1. The summary row drops `folderName` and `validationIssues`, omits empty relation arrays, and omits `frontmatterValid` when it is true. This goes beyond "drops description". It was needed to meet the ≤8k budget; the measurements are above.
2. `count` now means rows on this page, and `total` is the full count. Before, `count` was the full count; now `total` carries it.
3. `list` Zod failures now carry `code:'INVALID_ARGS'`. There was no code before.
4. The `ptah_task_list` description's "highest existing id" claim became "newest ids", and "every SKIPPED folder" in the `ptah_task_check` description was corrected. Both changes are under Decision 4.
5. A spec was also added to `mcp-core/tool-description.builder.spec.ts`, which the batch's file list does not name. It is the colocated spec for a file the batch does name.
6. `protocol-dispatcher.ts` is unchanged. It forwards `args` verbatim, and its task cases already return typed `{ok:false}` refusals.

## Out-of-scope observations

- The `ptah_task_update` `labels` description (`tool-description.builder.ts:147`) says "Call ptah_task_list first and reuse an existing label". With paging, one call now shows the labels of 25 rows only. The advice is still usable but no longer complete. This was left unchanged (Decision 4: it is not false).
- `check()` still emits every issue of each of the 50 shown invalid tasks. There is no cap per task, which was not asked for.

## Revision round 1 (r1 REVISE 5/10)

This revision addresses the findings in `reviews/batch-15-code-logic-review-r1.md`. Paths are relative to `libs/backend/vscode-lm-tools/src/lib/code-execution/`. The earlier line numbers in this report are superseded by the ones below.

### Fixes

- **B1 (Blocking), rename between pages**
  - The index guarantees no immutable key: `id` is the folder name (`task-spec.types.ts:142`), and there is no other stable identity. So a rename is not survived; it is detected and refused.
  - A rename keeps `created`, so a renamed row can only move within its own same-instant group. Only the cursor's own group straddles the page boundary.
  - The cursor (now `v:2`) carries `h`: the first 16 hex characters of a sha256 over the ids in that group that sort at or before the cursor. This is the part of the group already handed out.
  - On continuation `h` is recomputed. A mismatch means a task there was renamed, added or removed, or the cursor was altered. The call then returns `INVALID_CURSOR` with "omit cursor to restart", instead of silently skipping or repeating a row.
  - Renames in any other group need no check and continue normally.
  - Code: `namespace-builders/tasks-namespace.builder.ts:244-259` (schema), `:502-524` (`groupFingerprint`), `:798-804` (check).
  - Residual limit: hand-editing `created` mid-walk can still move one row across the cursor. `created` cannot be written through the tool.
- **S1 (Serious), page cut by the token budget**
  - `list(args, options?: TaskListOptions)` (`:395`) accepts `fits(text)`. The dispatcher passes the same test the budget step applies: `mcp-core/protocol-dispatcher.ts:2251-2259`, `fitsBudget(text, getToolResultBudget(name))`, the same pattern as `renderSymbolIndexPage`.
  - The page is binary-searched down to the largest run of whole rows that fits (`:840-852`). `nextCursor` is minted at the last row actually returned.
  - A row that does not fit even alone becomes `{ id, oversized: true }` with a `note` pointing to `ptah_task_get`, and paging moves past it.
  - `execute_code` passes no `fits`, so there `limit` alone bounds the page.
  - The default stays 25, as a maximum.
- **M1, cursor validation** (`:526-550`)
  - Length must be 1..512 and the alphabet must be `[A-Za-z0-9_-]`.
  - The cursor must be canonical base64url (it re-encodes to itself), which rejects a corrupted character that Node's decoder would silently skip.
  - The payload is checked by a strict schema: `v:2`, `c` an integer epoch-ms in the Date range or null, `id` passing `TaskIdRefSchema`, and `h` 16 hex characters.
  - Empty and overlong cursors now return `INVALID_CURSOR`, no longer `INVALID_ARGS`.
  - A fabricated, well-shaped key fails the fingerprint check.
- **M2, mixed offsets.** Ordering and the cursor use `Date.parse(created)` instants (`instantOf`, `:477`), with ties broken by id. An unparseable date counts as undated. Rows still show the authored `created` text.
- **M3, help and count semantics**
  - A new `ptah.help('tasks')` topic plus an overview line (`namespace-builders/system-namespace.builders.ts:144-180`, constants imported from the namespace). It covers list and check arguments and results, count vs total, the summary-row sparsity, `INVALID_CURSOR`, oversized rows and the check caps.
  - The `ptah_task_list` description now states "count (rows on this page), total (every match)", that a page can hold fewer rows when the budget is reached, and the `INVALID_CURSOR` restart. It stays within the 1,000-char description budget, which the spec enforces.

### Sizes (150-task fixture)

| Call                               | Rows | Chars | Tokens                                    |
| ---------------------------------- | ---- | ----- | ----------------------------------------- |
| `execute_code` default (no `fits`) | 25   | 7,473 | 2,500                                     |
| MCP default (budget-fitted)        | 19   | 5,733 | 1,929 (budget 2,000 tokens / 8,000 chars) |
| MCP `fields:'full'`                | 6    | 6,812 | 1,892                                     |

### Fails-before (new specs run against the round-0 code)

- **tasks-namespace, protocol-dispatcher and tool-description specs:** 13 failed (12 in the task-filtered run of the tasks-namespace and dispatcher specs, 1 in the tool-description spec).
  - Both rename directions (`tasks-namespace.builder.spec.ts:842-`).
  - All three budget specs: the end-to-end walk through the real `applyToolResultBudget` had its default page truncated; full rows cut; oversized-row stub (`:925-`).
  - The `help('tasks')` topic.
  - Ordering by instant (`:673`).
  - A genuine cursor with one corrupted character (`:661`).
  - Malformed cursors: the fabricated well-shaped key, the empty string and the overlong string.
  - The dispatcher passing `fits` (`mcp-core/protocol-dispatcher.spec.ts:707`).
  - The count/total description spec (`mcp-core/tool-description.builder.spec.ts:328`).
- **Specs that passed before as well** (guards, not behaviour changes): a rename outside the cursor group continues normally, and a fabricated cursor with an extra `h` key (rejected by the strict v1 schema).
- **How the run was done:** the budget specs call `list(args, { fits })`. For the before-run only, they went through a local wrapper typed `(a: unknown, o?: unknown)`, so the file compiled against the old one-argument signature. The wrapper was removed after the fix; the assertions are unchanged.
- The earlier malformed-cursor table now requires exactly `INVALID_CURSOR`.

### Verification (tails)

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache --parallel=2`: √ typecheck, √ lint, √ test, "Successfully ran targets".
- The four affected spec files run directly: 398/398 passing.
- `nx run-many -t typecheck -p ptah-cli ptah-electron --skip-nx-cache`: both √.
- `nx run ptah-electron:validate-deps --skip-nx-cache`: "Successfully ran target validate-deps".
- `nx run degradation-audit:lint --skip-nx-cache`: `TOTAL 300 unsuppressed site(s)`, success.
- `prettier --check` on the 7 changed files: "All matched files use Prettier code style!".
  - An over-broad `prettier --write mcp-core/*.ts` reformatted two unrelated specs: `code-outliner.adapter.spec.ts` and `tool-result-budget.spec.ts`. Both were reset to their HEAD content by writing `git show HEAD:<file>` over them, and no longer appear in `git status`.
- `git status --short`:
  - `M` for 7 files: `protocol-dispatcher.ts` and its spec, `tool-description.builder.ts` and its spec, `system-namespace.builders.ts`, and `tasks-namespace.builder.ts` and its spec.
  - `??` for this report and the r1 review, plus the pre-existing untracked `code-logic-review.md` and `research/diagnostics-worktree-repro.ts`.

### Deviations (round 1)

1. **Rename is detected, not tolerated.** No immutable key exists, so a rename touching the cursor's same-instant group returns `INVALID_CURSOR` (restart), never silence. The same applies to an add or delete in the already-seen part of that group.
2. **One code for every bad cursor.** Forged and stale cursors both return `INVALID_CURSOR`: without a signing key they cannot be told apart.
3. **Files outside the batch's list.** `protocol-dispatcher.ts` (hub file, a 7-line change) and `system-namespace.builders.ts` (help topic) are touched, as the r1 fixes require.
4. **The page size depends on the caller.** Through MCP the page is sized by the result budget; through `execute_code` only by `limit`.

## Revision round 2 (r2 REVISE 6/10)

This revision addresses the findings in `reviews/batch-15-code-logic-review-r2.md`. Paths are relative to `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/`.

### Fixes

- **R2-S1 (Serious), a status change invalidated a filtered walk**
  - `list()` now reads the index once, unfiltered (`tasks-namespace.builder.ts:844`). It filters the page itself with the same shared predicate the store runs: `mergeStatusTypeFacets` plus `filterTasks` (`:845-858`). This is one coherent snapshot for both the identity check and the page.
  - The anchor and the group fingerprint are resolved against the UNFILTERED list (`resolveAnchor`, `:564-577`). A returned task that leaves the filter no longer changes anything the cursor depends on, so the walk simply continues after the cursor position.
  - Rename detection is unchanged: a rename, add or delete in the cursor's same-instant group, or a missing anchor, still returns `INVALID_CURSOR`.
- **R2-M1 (Moderate), forged v2 cursor accepted**
  - Cursors are now `v:3` and carry `s`: an HMAC-SHA256 over the other fields, truncated to 22 base64url chars. The key is `randomBytes(32)` per process (`:276`).
  - `decodeListCursor` verifies the signature before anything else (`:579-607`). A fabricated or re-written payload, even one with a correctly recomputed public hash, is refused.
  - Trade-off: a cursor does not survive a host restart. The agent gets `INVALID_CURSOR` and restarts, as documented in `ptah.help('tasks')`.
- **R2-M2 (Moderate), long Unicode ids broke the cursor**
  - The anchor id is carried as a 16-hex hash (`a`), not verbatim. The anchor is found by matching that hash within its instant group.
  - Every cursor field is now fixed width (`c` ≤ 17 digits or null, `a` and `h` 16 hex chars, `s` 22 chars). A minted cursor is therefore about 140 chars whatever the folder name, which the 512-char decoder bound always accepts.
- **Help text.** `ptah.help('tasks')` (`system-namespace.builders.ts`) now says that a status change never invalidates a cursor and a host restart does.

### Fails-before (new specs, `tasks-namespace.builder.spec.ts` "ptah_task_list — r2 cursor contract", run against the round-1 code)

`Tests: 5 failed, 99 skipped` — all five new specs failed:

- A status-filtered walk continues after the anchor task is completed. Round 1 returned `INVALID_CURSOR`.
- A status-filtered walk continues after an earlier, non-anchor returned task is completed. Round 1 returned `INVALID_CURSOR`.
- A genuine cursor re-written as `c:null` with the recomputed empty-group hash is refused. Round 1 accepted it and returned an empty page.
- The reviewer's exact v2 forgery is refused.
- A 255-code-unit id (`TASK_` + 250 × U+6F22) produces a cursor the tool accepts back, and the walk reaches the next row. Round 1 rejected its own 800+ char cursor.

One existing spec changed with the design: "hands only the status/type filters to the index" became "reads the index once, unfiltered, and applies status/type itself". It asserts a single `index.list(ROOT)` call and a filtered total of 50.

### Verification (tails)

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache --parallel=2`: √ typecheck, √ lint, √ test, "Successfully ran targets".
- The four affected spec files run directly: 403/403 passing.
- `nx run-many -t typecheck -p ptah-cli ptah-electron --skip-nx-cache`: both √.
- `nx run ptah-electron:validate-deps --skip-nx-cache`: "Successfully ran target validate-deps".
- `nx run degradation-audit:lint --skip-nx-cache`: `TOTAL 300 unsuppressed site(s)`, success.
- `prettier --check` on the 7 changed files: "All matched files use Prettier code style!".
- `git status --short`: the same 7 modified source/spec files as round 1, plus the untracked report, the review files and the two pre-existing untracked files.

### Deviations and out-of-scope (round 2)

- **Filtering moved into the namespace.** Status/type filtering on the MCP and `execute_code` path now runs in the namespace instead of in the store. It is the same shared function, so there is still one predicate.
  - The comment in `libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts:619-623` says the MCP path "reaches the store with only status/type". That comment is now stale; it is not in this batch's ownership, so I left it untouched.
- **Unused interface parameter.** The `TaskSpecIndexLike.list` `filters` parameter is no longer passed by the namespace. It is kept because it matches the real `TaskIndexService.list` signature.
- **Cursors are per process.** A cursor minted by one host process (for example the Electron app) is refused by another (for example the CLI) or after a restart, with `INVALID_CURSOR`.

## Minor follow-ups (after r3 APPROVE)

Only the three follow-ups in `reviews/batch-15-code-logic-review-r3.md`; nothing else was changed.

1. **Signature check uses `timingSafeEqual`** (`tasks-namespace.builder.ts`, `decodeListCursor`). Both signatures become UTF-8 Buffers. A length mismatch is rejected before `timingSafeEqual` is called, so it never throws. `timingSafeEqual` is added to the `node:crypto` import.
2. **Forgery regression now exercises the HMAC**
   - The spec is "refuses a genuine cursor whose payload was re-written with recomputed public hashes".
   - The extra `id` key is gone. Removing it alone would not isolate the HMAC: the forged `c:null` points at an empty group, so anchor resolution would still refuse the cursor even without a signature check.
   - The forgery therefore keeps the genuine `s` and rewrites `c`, `a` and `h` to values valid for the last row (`TASK_2026_003`): its instant, plus the public sha256 of its id for both `a` and the one-member group fingerprint. Only the HMAC can refuse this cursor; without it, `TASK_2026_002` would be silently skipped.
   - Bypass proof: the check was temporarily replaced with `return true || (…)`, and the spec failed (`Tests: 1 failed, 103 skipped`). The file was then restored from a copy; `grep -c "return true ||"` gives 0.
3. **Stale comment updated** in `libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts` (the `registerList` JSDoc, ~:619-624). It now says the MCP `ptah_task_list` path reads the index unfiltered and applies `status`/`type` through the same `mergeStatusTypeFacets` + `filterTasks` pair.

### Verification (tails)

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache --parallel=2`: √ typecheck, √ lint, √ test, "Successfully ran targets".
- `nx run-many "-t=lint,typecheck" -p @ptah-extension/rpc-handlers --skip-nx-cache`: √ lint, √ typecheck.
- `nx run ptah-electron:validate-deps --skip-nx-cache`: "Successfully ran target validate-deps".
- `nx run degradation-audit:lint --skip-nx-cache`: `TOTAL 300 unsuppressed site(s)`, success.
- `prettier --check` on the 8 changed files: "All matched files use Prettier code style!".
- `git status --short`:
  - `M` for 8 files: the 7 from earlier rounds plus `tasks-rpc.handlers.ts`.
  - `??` for this report and the r1/r2/r3 reviews, plus the pre-existing untracked `code-logic-review.md` and `research/diagnostics-worktree-repro.ts`.
