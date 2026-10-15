# Mode 2 - Wave 5b (batch R9s) - TASK_2026_629_c0b3

Verdict: R9s ACCEPTED and committed as `2365151a8`. All five scoped checks are green.

## Inputs

- batches-rail-r9.md `## Batch R9s` (Wave 5), `## Execution rules`
- lane-R9s-report.md (writer), code-logic-review-R9s.md (APPROVED 8/10, Blocking 0 / Serious 0 /
  Moderate 0 / Minor 3, no fix round)
- decisions.md row 92 (orchestrator one-line correction in `restoredViewMode`)

## On-disk verification

- `tab-persistence.ts`: `LEGACY_COMPACT_TALL_HEIGHT_UNITS`, `LEGACY_COMPACT_HEIGHT_UNITS`,
  `isPositiveInteger` and `restoredCompactView` are deleted. `restoredViewMode` keeps only the
  `'compact-tall'` -> `'compact'` migration. `sanitizeRestoredTab` builds a fresh copy and runs
  `delete sanitized.compactHeightUnits`, so the field no longer goes back into memory or a later
  save. This closes R9r review Minor 2.
- Row 92 is present at `tab-persistence.ts:171`:
  `const storedMode: string | undefined = tab.viewMode;` (the HEAD widening). The chat-state
  typecheck below is clean, so the TS2367 that W5a found is fixed.
- `chat-types.ts`: the `TabState.compactHeightUnits` field and both doc-comment references are
  removed. `TabViewMode` and `isCompactViewMode` are unchanged.
- `tab-persistence.backoff.spec.ts`: not modified (git status). It was not included in the commit.

### Step 1 - `compactHeightUnits` sweep (libs + apps, .ts/.html)

Matches are limited to the expected places:

- `chat-state/src/lib/tab-persistence.ts:234` (the strip-copy type), `:264` (comment),
  `:267` (`delete`)
- `chat-state/src/lib/tab-restore-sanitize.spec.ts:224-258` (the old-payload fixture and its
  assertions)

There are no matches for `LEGACY_COMPACT_(TALL_)?HEIGHT_UNITS|restoredCompactView` anywhere in
libs/apps, so no consumer of the removed exports is left.

## Step 2 - Scoped checks (serial, through `.ptah/tmp/check-run.mjs`)

| Label        | Command                                                   | Result |
| ------------ | --------------------------------------------------------- | ------ |
| w5b-cs-full  | nx test @ptah-extension/chat-state (maxWorkers=2, no cache) | exit 0; `Test Suites: 24 passed, 24 total`; `Tests: 554 passed, 554 total` |
| w5b-cs-tc    | nx typecheck @ptah-extension/chat-state                   | exit 0; no `error TS` lines; "Successfully ran target typecheck" |
| w5b-cs-lint  | nx lint @ptah-extension/chat-state                        | exit 0; `2 problems (0 errors, 2 warnings)` |
| w5b-ct-tc    | nx typecheck @ptah-extension/chat-types                   | exit 0; no `error TS` lines (waited 10s for lock) |
| w5b-ct-lint  | nx lint @ptah-extension/chat-types                        | exit 0; no problems |

Both chat-state lint warnings are in files R9s does not touch, so neither is an R9s finding:

- `tab-manager.cross-workspace.spec.ts:115:29` no-non-null-assertion
- `tab-manager.service.ts:1417:1` max-lines (1522)

No check failure was found in R9f/R9t canvas files. Canvas was not in this wave's scope and was
not checked.

## Step 3 - Commit

- `2365151a8 refactor(chat-state,chat-types): batch R9s - drop compactHeightUnits`
- Staged by explicit path only: `libs/frontend/chat-state/src/lib/tab-persistence.ts`,
  `libs/frontend/chat-state/src/lib/tab-restore-sanitize.spec.ts`,
  `libs/frontend/chat-types/src/lib/chat-types.ts` (3 files, +47 / -96).
- The commit ran in the foreground and the hooks passed (no `--no-verify`). The body mentions
  the row-92 correction and ends with the Co-Authored-By trailer.
- After the commit, git status still shows the R9f and R9t canvas files and the `.ptah/**` docs
  as modified and unstaged. None of them were staged, reverted or committed. Nothing was pushed.
- batches-rail-r9.md: the R9s heading and Task R9s.1 are marked COMPLETE (2365151a8). The docs
  are not committed.

## Minors recorded (not fixed; no fix round)

1. `tab-restore-sanitize.spec.ts:257-259`: the claim "next save cannot write it back" is checked
   with `projectTabForPersist(tab)`, not by reading the persisted localStorage bytes after a save.
   Candidate follow-up: assert on the stored JSON.
2. `tab-persistence.ts:111-126`: the guarantee that the key does not come back on save depends
   only on the restore strip, because `projectTabForPersist` does not drop the key. No writer
   exists today. Optional hardening: a pointer comment or a save-side drop.
3. `tab-persistence.ts:170-174` (pre-existing from HEAD): an unknown `viewMode` string passes
   through unvalidated, and the docstring says "validated" when it means "migrated". Optional
   rewording.

### Next action: run the remaining Wave 5/6 batches (R9f, then R9t) through Mode 2 once their lanes report.
