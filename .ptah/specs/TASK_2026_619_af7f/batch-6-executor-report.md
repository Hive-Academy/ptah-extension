# Batch 6 executor report — Ground truth B (relevance PR + commit split, memory seed set, file-tool questions)

Executor: initial run Glm lane (ptah-cli, Ollama Cloud; exit `no-deliverable`); Revision 1 and this report: opencode CLI lane with the `backend-developer` role (agent `0b496e62`, 25 m 21 s).
Worktree: `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark`

## Work completed

### Task 6.1 — Relevance questions with a frozen held-out split + file-tool questions

Two generators, both offline and injectable so CI never calls `gh` or `git` against a remote:

- `tools/mcp-bench/src/ground-truth/relevance-questions.ts` — relevance ground truth for
  `ptah_relevance_rank_files`, built from repository history at the corpus pin
  (`7910f34cf`): merged pull requests whose merge commit is an ancestor of the pin, plus
  non-merge commits reachable from the pin. Each kept question is a query (PR title or
  commit subject) with the eligible source files it changed as truth (sorted,
  workspace-relative, forward slashes, every file existing at the pin). The most recent
  200 kept questions are the held-out `test` split, earlier ones `tune`; below 200 the
  most recent half is `test` and a `deviation` string reports it. The frozen file
  (`method: 'git-history'`, `seed: null`) is committed so CI reads only JSON.
- `tools/mcp-bench/src/ground-truth/file-tool-questions.ts` — file-tool ground truth from
  the pinned corpus tree (a read-only `git archive <pin>` extraction): 100 ast/enrich
  questions (files stratified by line count, truth = top-level declarations from
  `ts.createSourceFile` per file), 100 glob questions (patterns built from real corpus
  directories/extensions, including zero-match patterns; truth = picomatch over the
  corpus file list), and 150 literal + 50 regex text questions (truth = the exact
  `file:line` set from a Node line scan; `rg` is the native baseline, never the truth).

### Task 6.2 — Seeded memory set

- `tools/mcp-bench/src/ground-truth/memory-questions.ts` — 150 synthetic project facts
  from fixed templates (no RNG, no user data) under workspace roots A and B with a
  worktree of A: every fact family exists in both roots under the same subject with
  different values, so a cross-workspace leak is detectable (`expectedLeakCount: 0`);
  every fact is a temporal-update pair (an older value superseded by a newer one, and
  the truth is always the newer row); each fact yields 1 verbatim + 2 lexically
  divergent paraphrase queries; plus 20 abstention queries and the 4 hand-graded
  TASK_2026_473 track-A queries as labelled (`method: 'labelled'`, unscorable) seeds.
  `seedMemory(target, set)` inserts the set through the product's memory store API
  (`insertMemoryWithChunks`, old row before new row) inside the isolated bench host —
  never raw SQL, and it opens no DB itself.

## Revision 1 (relevance source, 2026-10-07)

Reason: the strict PR rule (every changed file must be eligible source, 1-8 files) kept
1 PR of 451 fetched on this repository. Binding user decision in
`context.md` §"User Decision — relevance ground-truth source": PRs **plus** non-merge
commits; a candidate qualifies on its eligible files alone.

`relevance-questions.ts` changes (per the decision and the batch prompt):

1. **Paged GraphQL PR fetch.** `fetchMergedPullRequests(repoRoot)` no longer makes the
   single `gh pr list --limit 1000` call (which failed with truncated JSON and HTTP
   502). It resolves the owner/repo via `gh repo view --json nameWithOwner`, then pages
   `gh api graphql -f query=... [-f cursor=...]`: 25 PRs per page, `states: MERGED`,
   fields `number, title, body, mergedAt, mergeCommit { oid },
   files(first: 100) { totalCount nodes { path } }`, looping on
   `pageInfo.hasNextPage / endCursor`. Each page is attempted up to 3 times — an exec
   error *or* unparseable/truncated stdout counts as a failed attempt. A PR whose
   `files.totalCount` exceeds 100 is skipped (one page cannot hold its file list) and
   counted; the fetch returns `{ prs, skippedLargePrs }`. The first page omits `after`
   entirely (no nullable cursor variable is sent), continuation pages pass the previous
   `endCursor` as the `cursor` form field. Still injectable: CI never calls it, and the
   spec feeds parsed PR data in.
2. **Commit fetch.** New `fetchCommitCandidates(repoRoot, corpusCommit)` runs
   `git log <pin> --no-merges --format=%x1e%H%x1f%s%x1f%cI --name-only`
   (maxBuffer 256 MiB) and parses one candidate per commit (SHA, subject, committer
   date ISO, changed paths) using `\x1e` record / `\x1f` field separators, which cannot
   appear in a SHA, subject, date or path; the parser tolerates blank lines and stray
   separators. Injectable like the PR fetch.
3. **Qualification rule (PRs and commits).** `filterRelevantPullRequests` /
   new `filterRelevantCommits` apply the decided rule: a PR or commit qualifies when it
   changes 1-8 eligible source files (`isEligibleSourcePath`); its other changed files
   (docs, specs, `.md`, lockfiles, tests) are ignored; the truth (`truthFiles`) is the
   eligible files only. Every truth file must exist at the pin (`fileExistsAtPin`), and
   a PR's merge commit must be an ancestor of the pin (`isAncestor`) — both checks kept.
   Commits are reachable from the pin by construction; additionally excluded: subjects
   starting with `Merge`, commits whose SHA is the merge commit of a kept PR (the squash
   case), and commits whose truth file set is identical to a kept PR's (the PR wins).
4. **Ordering, split, ids, counts.** Questions are ordered by date (PR `mergedAt`,
   commit committer date `%cI`, compared as instants because ISO offsets differ), ties
   by id. The most recent 200 are `test`, the earlier ones `tune`, with the < 200
   half-split `deviation` path kept. `RelevanceQuestion` gains
   `source: 'pr' | 'commit'`; ids are `pr-<number>` / `commit-<12-char sha>`. `counts`
   gains `pr` and `commit`, and the file schema's `superRefine` now also enforces
   `counts.pr + counts.commit === counts.total` (besides test + tune = total and
   total = questions.length).
5. **Orchestrator entry point.** New exported
   `generateRelevanceQuestionFile(repoRoot, corpusCommit, frozenAt)` drives both fetches
   plus the builder and returns `{ file, deviation, skippedLargePrs }`.
6. **Kept names.** `fetchMergedPullRequests`, `filterRelevantPullRequests`,
   `buildRelevanceQuestionFile` (now takes PRs *and* commits), `RELEVANCE_TEST_SPLIT_SIZE`,
   `mergedPullRequestSchema`, `isEligibleSourcePath`, `gitRelevanceDeps`,
   `ELIGIBLE_EXTENSIONS` (still imported by `file-tool-questions.ts`, unchanged).
   One rename: `splitByMergeDate` → `splitByDate`, because it now orders PRs and
   commits by date, not merge dates alone.
7. **Spec updated to the new rule** (`relevance-memory.spec.ts`, relevance cases only —
   the file-tool and memory cases are untouched): PR `src/a.ts` + `package-lock.json` +
   `notes.md` kept with truth `['src/a.ts']`; only-`.md` PR dropped; 9-eligible-file PR
   dropped; orphan (non-ancestor) PR dropped; truth-file-missing-at-pin PR dropped;
   commits merged with PRs into one date-ordered set; split at 200 with `test` = most
   recent; duplicate PR/commit file set keeps the PR; `Merge`-subject commit excluded;
   counts.pr + counts.commit = total asserted and the schema rejecting a mismatch.

Consequence (expected, not acted on): the committed
`tools/mcp-bench/questions/7910f34cf/relevance.json` no longer validates against the
tightened schema (questions lack `source`, `counts` lack `pr`/`commit`). Per scope, the
orchestrator regenerates it via `generateRelevanceQuestionFile`; expected yield on this
repository is ~93 qualifying PRs plus ~1,683 commit candidates with 1-8 eligible files
(context.md finding), i.e. ≥ 200 `test` questions and no deviation. I did not run `gh`
and did not regenerate anything under `tools/mcp-bench/questions/`.

## Frozen-output status

`tools/mcp-bench/questions/7910f34cf/file-tools.json` counts (quoted):

```json
{"ast":100,"astSmall":34,"astMedium":33,"astLarge":33,"glob":100,"globZeroMatch":16,"textLiteral":150,"textRegex":50,"total":400}
```

Matches the Batch 6 spec exactly: 100 ast/enrich files by size stratum (34 small +
33 medium + 33 large), 100 glob patterns (16 with zero matches), 150 literal + 50
regex text queries — total 400. No difference.

`tools/mcp-bench/questions/7910f34cf/memory.json` counts (quoted):

```json
{"facts":150,"rows":300,"verbatim":150,"paraphrase":300,"worktree":15,"abstention":20,"labelled":4,"total":489}
```

Comparison with the spec ("150 facts x (1 verbatim + 2 paraphrase + 1 temporal pair) +
20 abstention + 4 hand-graded TASK_2026_473 queries"):

- 150 facts x (1 verbatim + 2 paraphrase) = 450 questions — present (`verbatim: 150`,
  `paraphrase: 300`).
- The "1 temporal pair" is realised as 2 seeded rows per fact (`rows: 300` = 150 old +
  150 new), and every fact query expects the newer row; it is not an extra question
  kind, so it adds 0 to `total`.
- 20 abstention + 4 hand-graded TASK_2026_473 labelled queries — present
  (`abstention: 20`, `labelled: 4`).
- The remaining difference (489 vs 474) is the `worktree: 15` block: 15 extra
  worktree-scoped queries (issued from `<worktreeOfA>`, expecting root A's facts),
  required by the batch's "roots A, B and a worktree of A with overlapping facts" leak
  check. 450 + 15 + 20 + 4 = 489. All questions accounted for; no unexplained
  difference.

The relevance frozen output (`questions/7910f34cf/relevance.json`, 282 bytes) currently
holds 0 questions (`counts {"test":0,"tune":0,"total":0}`) and predates this revision;
it is the orchestrator's regeneration step (above).

## Files written

- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\ground-truth\relevance-questions.ts` — revised (PR + commit rule, paged GraphQL fetch, commit fetch, schema, `generateRelevanceQuestionFile`)
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\ground-truth\relevance-memory.spec.ts` — relevance cases updated to the new rule; file-tool and memory cases untouched
- `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\.ptah\specs\TASK_2026_619_af7f\batch-6-executor-report.md` — this report

## Verification

Commands run from the worktree root (scoped to the two changed files only):

- `npx prettier --write tools/mcp-bench/src/ground-truth/relevance-questions.ts tools/mcp-bench/src/ground-truth/relevance-memory.spec.ts`
  → exit 0; final run printed `relevance-questions.ts ... (unchanged)`,
  `relevance-memory.spec.ts ... (unchanged)`.
- `npx eslint tools/mcp-bench/src/ground-truth/relevance-questions.ts tools/mcp-bench/src/ground-truth/relevance-memory.spec.ts`
  → exit 0, no output (clean).
- `npx jest -c tools/mcp-bench/jest.config.ts tools/mcp-bench/src/ground-truth/relevance-memory.spec.ts`
  → `Test Suites: 1 passed, 1 total / Tests: 25 passed, 25 total` (exit 0). Tail:
  relevance: 11 cases; file-tool questions: 6 cases; memory questions: 8 cases — all
  green.

One intermediate failure, for the record: the first jest run failed at TypeScript
compile (TS2345) because two of my split tests passed raw PR/commit fixtures to
`splitByDate`, which takes qualified candidates; fixed by running the filters first.
The final run above is green.

Not run (out of scope for this executor): `npx nx run-many -t typecheck,lint,test -p
mcp-bench` (orchestrator's gate), any `gh` command, and any regeneration of JSON under
`tools/mcp-bench/questions/`.

## Orchestrator verification (2026-10-07)

- `relevance.json` regenerated with `generateRelevanceQuestionFile` (paged GraphQL fetch + `git log`), 12 m 8 s: test 200, tune 1,427, total 1,627 (pr 62, commit 1,565), deviation none, 192 PRs skipped for more than 100 files. The test split holds 8 PRs and 192 commits.
- File-tool truth: all 6,918 truth paths exist at `7910f34cf`; three text truths checked line by line at the pin.
- `relevance-memory.spec.ts` 25/25; `npx prettier --check tools/mcp-bench/src/ground-truth tools/mcp-bench/questions` clean; `npx nx run-many -t typecheck,lint,test -p mcp-bench --skip-nx-cache` passed (1 m 29 s).
