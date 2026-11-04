# Batch 2 report — O1 WROTE parser and containment helper

Status: implementation complete. Scoped verify did not pass. The new suites passed. Two pre-existing lane-outcomes failures are outside this batch's file list.

Skill: no catalogue skill matches a WROTE parser or path-containment helper. None was loaded.
`ptah_code_search_symbols` index was empty (`symbolCount: 0`); symbol lookup fell back to Read and Grep.
`ptah_get_diagnostics` stayed unavailable (TypeScript check still running after 45s). Project typecheck inside verify passed.

## Tasks

### Task 2.1: `parseWroteLines` — done

`parseWroteLines` scans only the last `WROTE_SCAN_MAX_CHARS` (16384) characters. A hit is a line that, after trim and one leading backtick, starts with case-sensitive `WROTE:`. The path is cut at the first ` — ` (U+2014) and at a closing backtick, then trimmed and stripped of one backtick or quote pair. Empty, NUL, or longer than 1024 is `malformed`. Distinct paths stay in first-seen order. More than 20 is `too-many`. No hit is `none`.

Evidence: `wrote-lines.parser.spec.ts` passed inside the project verify (7.23 s).

### Task 2.2: `wrote-lines.parser.spec.ts` — done

Covers absolute and relative paths, CRLF, em-dash suffix, ASCII hyphen left intact, backticks, double and single quotes, duplicates, `none`, lowercase `wrote:`, 20 accepted, 21 distinct `too-many`, 21 copies of one path kept as one, 1024 accepted, 1025 and NUL and empty `malformed`, and a `WROTE:` line that ends before the scan window ignored.

### Task 2.3: `containedDeliverablePath` and `checkDeliverable` — done

Lexical gate first (`..`, `..${sep}`, absolute relative path, Windows drive or UNC that is not absolute on this platform, drive-relative `C:foo` on POSIX). An absolute entry inside the root is accepted. Then `realpath` of `resolve(root)` and of the lexically contained path, the same relative test on the real paths, and `stat` only of that real path. `outside-root` is returned with no `stat`. Not-found codes `ENOENT`, `ENOTDIR`, `FileNotFound`, `FileNotADirectory` become `{ exists: false, bytes: 0, mtimeMs: null }`. Any other error becomes `{ errorCode }` from the provider `code`, or `UNKNOWN`. Messages are dropped.

### Task 2.4: `deliverable-check.spec.ts` — done

Real `mkdtempSync` directories, removed in `afterEach`. A small `node:fs/promises` adapter implements the `Pick`.

Decision 16 cases:

- root is a checkout that contains `.claude-worktrees/wt/file.txt`, entry is that absolute file: accepted, `bytes: 8`
- root is `<tmp>/repo/.claude-worktrees/wt`, entry is a file in `<tmp>/repo`: `outside-root`, `stat` and `realpath` not called
- sibling worktree, and a `wt-extra` prefix sibling: `outside-root`, no filesystem call

Symlink matrix: in-root link to an in-root target accepted and `stat`'d at the real target; in-root link to an outside target `outside-root` and `stat` not called; dangling link (missing target outside the root) not found and `stat` not called; root itself a symlink uses `realRoot`; the same escape is still `outside-root` when the root is a symlink.

Also: `..`, `../x`, drive entry on POSIX, absolute outside, missing file, `ENOTDIR` through a file parent, each not-found code on both `realpath` and `stat`, and `EACCES` / `EIO` / missing `code` mapped to `errorCode` with the path absent from the JSON result.

Evidence: `deliverable-check.spec.ts` passed inside the project verify (10.038 s). Targeted run before verify: 33 tests, 2 suites, all passed.

### Task 2.5: export the helper — done

`src/index.ts` adds `containedDeliverablePath`, `checkDeliverable`, `DeliverableCheck`, and `DeliverableCheckResult`. The parser is not exported. Typecheck of `@ptah-extension/lane-outcomes` passed.

## Files

Created:

- `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/lane-outcomes/src/lib/wrote-lines.parser.ts`
- `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/lane-outcomes/src/lib/wrote-lines.parser.spec.ts`
- `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/lane-outcomes/src/lib/deliverable-check.ts`
- `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/lane-outcomes/src/lib/deliverable-check.spec.ts`
- `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/.ptah/specs/TASK_2026_879_9809/batch-2-report.md`

Modified:

- `/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps/libs/backend/lane-outcomes/src/index.ts`

Environment, not a batch source file: symlink `…/decision-model-data-gaps/node_modules` → `/home/amun/ptah-extension/node_modules`, the same link sibling worktrees already have. It is gitignored. The worktree had no `node_modules`, so Jest's `marked` mapper pointed at a missing UMD file.

No edits in `libs/backend/lane-routing` or `libs/backend/platform-core`.

## Risks

| Risk | How this batch handled it |
| --- | --- |
| R1 Recorder `fs` typed `stat` only | Not this batch. `checkDeliverable` already takes `Pick<IFileSystemProvider, 'stat' \| 'realpath'>`. Task 7.1 types the recorder argument. |
| R2 Symlink escape stat'd | `realpath` of root and path, containment repeated, `stat` only of the real path. Spec spies prove `stat` is not called for an outside target, for lexical escapes, or for a dangling link. Symlinked root is resolved before the second test. |
| R3 Host-origin from MCP | Later batch (5.1 / 9.1). This helper has no origin field. |
| R4 Host report overrides an explicit report | Later batch (5.2). No store edits here. |
| R5 Path text in logs or payloads | This helper's errors are `outside-root` or a provider code. Specs assert the serialised result does not contain the path. Log allow-lists are Tasks 7.1 and 8.1. |
| R6 Shared worktree | Only lane-outcomes files listed above, plus the gitignored `node_modules` symlink. |
| R7–R13 | Not this batch (figures, watcher, seeder, quota, skill-synthesis). |

Assumptions A3 (`cwd` is the session root) and A4 (subagent rows bucket under `SUBAGENT_FAMILY`) are not inputs to these two modules. They belong to the producer and matrix batches.

## Verification

Command (worktree root, one run):

`npm run verify -- -p @ptah-extension/lane-outcomes`

Nx header names one project:

```
NX   Running targets lint, test, typecheck for project @ptah-extension/lane-outcomes:

- @ptah-extension/lane-outcomes
```

Lint passed. Typecheck passed. Test failed. The script logged `exit code 1` (`lock released after 848.4s`).

Final summary:

```
Test Suites: 4 failed, 15 passed, 19 total
Tests:       2 failed, 281 passed, 283 total
Time:        552.743 s

NX   Running targets lint, test, typecheck for project @ptah-extension/lane-outcomes failed

Failed tasks:

- @ptah-extension/lane-outcomes:test

Run duration:      13m 42s
Cache:             0/2 hit (0%)
```

`wrote-lines.parser.spec.ts` and `deliverable-check.spec.ts` both passed in that run.

The four red suites do not import the new modules:

- `subagent-stop.integration.spec.ts` and `di/start.spec.ts` failed to load `marked` because the worktree had no `node_modules`. After the symlink, an isolated re-run passed both suites.
- `sqlite-lane-outcome.store.spec.ts` expected 497 held reports and got 1 while the full suite was loaded. Isolated re-run passed. `holdReport` deletes rows with `expires_at <= Date.now()`, and `heldReport` sets `expiresAt` to `now + 1000`. A slow 500-insert loop expires the rows the assertion still counts.
- `key-value-lane-outcome.store.spec.ts` failed the same assertion in the full run and again alone (183 s suite, received 1). Each key-value hold JSON-serialises the snapshot, so 500 holds take longer than that 1 s TTL even without other suites. The file is not in Batch 2's list, so it was not changed.

## Decisions

1. A single malformed path refuses the whole message as `malformed`, including when the distinct count would also exceed 20. The return type is one result. Options: malformed-first, or too-many-first. Evidence: `{ paths } | { refusal }`. Reversible.
2. The scan window is the raw last 16384 characters. A line that ends before that slice is ignored. A slice that starts mid-line is parsed as the text in the slice. Options: drop a partial first line. Evidence: the plan says scan the last N characters; legitimate `WROTE:` lines are short and at the end. Reversible.
3. Lexical escape and a real path outside the real root both use `errorCode: 'outside-root'`. Lexical escape makes no filesystem call. Evidence: one code for "not inside the root", and the plan's name for the symlink case. Reversible.
4. `checkDeliverable` realpaths `resolve(root)` and the lexically contained absolute path, not a relative entry against the process cwd. Evidence: `realpath` of a relative path would leave the session root. Reversible.
5. Dangling symlink, including a link whose missing target sits outside the root, is not found. `realpath` fails with a not-found code before a target exists to test. An existing outside target is `outside-root` and is not stat'ed. Evidence: plan text for dangling links and for the not-found set. Reversible.
6. Not-found codes map to a missing check; every other failure uses the provider `code` string, or `UNKNOWN`. `error.message` is never copied. Evidence: R5 and `outcome-report.tool.ts` logging only the code. Reversible.
7. Package `index.ts` exports the containment functions and `DeliverableCheck` / `DeliverableCheckResult` only. `parseWroteLines` stays a same-library module until a later batch imports it. Evidence: Task 2.5. Reversible.
8. Both functions take `(root, entry)`. `entry` may be absolute or root-relative. Evidence: `path` would shadow `node:path`; the producer passes the same string to both. Reversible.
9. Worktree cases use ordinary containment. `.claude-worktrees/<name>/` is inside the checkout root and outside a worktree root or a sibling. No special-case prefix. Evidence: decisions.md row 16, and `relative` already rejects `../` and `wt` vs `wt-extra`. Reversible.

## Fix round 1

The containment helper is unchanged. `pathFromWroteBody` now ends an unwrapped path at the first whitespace, then strips one trailing run of `. , ; : ! ? )`. Backtick and quote wrappers still keep interior spaces. The em-dash cut still runs first.

Spec additions, all passing in `wrote-lines.parser.spec.ts` (10 tests, one suite, not `npm run verify`):

- `WROTE: /abs/path/batches.md. Verdict: DECOMPOSITION COMPLETE, ...` → `/abs/path/batches.md`
- `WROTE: /abs/a.md + one-line verdict` → `/abs/a.md`
- `WROTE: /abs/a.md - 5 components` → `/abs/a.md`
- `WROTE: /abs/a.md (revised)` → `/abs/a.md`
- `` WROTE: `/abs/My Folder/a.md` — ok `` → `/abs/My Folder/a.md`

The old pin `WROTE: /abs/file.md - stays` → `/abs/file.md - stays` now expects `/abs/file.md`. That expectation contradicted the whitespace rule. The key-value hold-TTL spec was not edited. Verify was not run.
