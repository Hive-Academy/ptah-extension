# Batch 6 report — Write-side pure baselines

## Task 6.1: Extraction and merge baselines

Done. `baselines/write-side-baselines.ts` implements the four pure policies the
design names, each documented with the benchmark-design.md line it implements:

- `extractAllBaseline` (design :128): every user and assistant message line
  becomes a row. "Message line" is read as one transcript message (a JSONL
  transcript carries one message per line); system and tool messages and blank
  texts produce no row; the subject is the message's first non-empty line and
  the content the full text.
- `byteEqualSubjectMerge` (design :139, the pre-563 path): byte-equal,
  case-sensitive, whitespace-significant subject equality.
- `neverMerge` (design :139): no pair ever merges.
- `tier1CaseFoldedMerge` (design :139, the case-folded subject window):
  case-folded subject equality, with the fold key mirroring tier 1's
  `TRIM(LOWER(m.subject))` subject key (`libs/backend/memory-curator/src/lib/memory.store.ts:413`,
  verified in source before use).
- `latestChunkWins` (design :156): among the rows flagged as matching the slot,
  keep the newest chunk by ISO timestamp; ties broken by later input order;
  `null` when nothing matches.
- `appendOnlySeed` (design :99): a reseed appends its rows and never supersedes;
  every existing row survives, even one with the same subject as a reseed row.

Evidence: `write-side-baselines.spec.ts` covers all of the above with hand
fixtures (15 tests total across the two Batch 6 specs, all passing), including
the edge cases below.

## Task 6.2: Pinned OR query builder

Done. `baselines/fts-or-query.ts` re-implements `escapeFtsQuery` exactly as it
stood before the 473 fix:

- Pinned commit found with read-only git commands only:
  `git log --oneline --follow -- libs/backend/memory-curator/src/lib/fts-query.util.ts`
  showed two revisions: the fix commit `12865f539` ("fix(memory-curator): make
  retrieval and merge reach the whole corpus", the TASK_2026_473 change) and its
  parent `51f235a1e`. The pre-473 source was read with
  `git show 51f235a1e:libs/backend/memory-curator/src/lib/fts-query.util.ts`
  and re-implemented verbatim (tokens joined with `OR`, no stopword filter, no
  apostrophe split, no AND form, no fallback plan).
- The file header cites the pinned commit `51f235a1e`, the fix commit
  `12865f539`, the source path and the read command, and labels the code as
  baseline code that must not be modernised (design :85, :159).
- `fts-or-query.spec.ts` pins the builder's output for five queries and pins the
  not-modernised properties on them: filler tokens survive (`"what" OR "did" OR
  "we" OR "decide" OR "about" OR "the" ...`), apostrophes stay inside the token
  (`"user's"`), FTS5 keywords are dropped, single-character tokens are dropped,
  metacharacters are stripped, and only the last surviving token is
  prefix-matched. One pin was corrected during verification: the
  single-character token `x` in pin 5 is dropped by the pre-473 length filter,
  so the correct output is `"judge" OR "threshold"*` (the first hand-computed
  pin had wrongly kept it; the code matched the pinned source, the pin did not).

## Risks and edge cases handled

- All six baseline functions are pure: no network, no model, no clock, no
  filesystem; ISO timestamps compare as strings so ordering stays deterministic.
- `extractAllBaseline` skips blank messages, non-user/assistant roles, and
  returns `[]` for empty input.
- `latestChunkWins` returns `null` for empty input and for input where nothing
  matches the slot; equal timestamps are broken deterministically.
- `appendOnlySeed` keeps duplicate subjects on purpose: that is the
  never-supersedes behaviour the `mem.update.seed` invariant measures against.
- The OR builder keeps the pre-473 security posture verbatim (metacharacter
  strip, keyword drop, bound-parameter note); it was not modernised with the
  473 stopword list or AND form, because that would break the baseline's purpose.
- No rates are computed in this batch (policies return rows and booleans), so
  the `value === num/den` rule had nothing to apply to; the Batch 1 `Rate`
  conventions were left untouched.
- No file outside the Batch 6 list was changed; the real `~/.ptah` was not
  touched; no git writes were run (git use was read-only `log`/`show`).

## Changed files

- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\baselines\write-side-baselines.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\baselines\write-side-baselines.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\baselines\fts-or-query.ts`
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\tools\mcp-bench\src\memory-skills\baselines\fts-or-query.spec.ts`

## Verification

- `npx prettier --check --ignore-unknown <the 4 files above>`
  - `All matched files use Prettier code style!` (files were written through
    `prettier --write` first, then re-checked)
- `npx jest -c tools/mcp-bench/jest.config.ts <the 2 Batch 6 spec paths>`
  - `Tests:       15 passed, 15 total`
  - `Test Suites: 2 passed, 2 total`
- `npx nx run-many -t typecheck,test,lint -p mcp-bench`
  - Typecheck and lint succeeded (reported as the 2 successful tasks).
  - `mcp-bench:test` failed, but not on Batch 6 files: the full
    `tools/mcp-bench` jest run shows `corpus.spec.ts` failing 2 tests
    ("uses a detached pinned worktree and removes it after a disposable
    lifecycle copy", "removes only registered stale corpus worktrees at
    startup"), with `Tests: 2 failed, 197 passed, 199 total`. `corpus.spec.ts`
    is Batch 2's file and was not touched by this batch; the failure is
    pre-existing in this worktree and is left for the Batch 2 owner.

## Not done

Nothing in Batch 6's task list. The `corpus.spec.ts` failures described above
are outside this batch's file list and were not investigated or fixed.