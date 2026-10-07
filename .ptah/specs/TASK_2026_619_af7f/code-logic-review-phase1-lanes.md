# Code Logic Review (Phase 1, lane-authored code) — TASK_2026_619_af7f

Scope: `tools/mcp-bench/src/{metrics,scorecard,corpus,ground-truth,baselines}/` at HEAD deb8aaa4b, read in full.
Not reviewed (other reviewer): transport/, suites/, lifecycle/, gate/, main.ts, bench-hosts.ts, generate.ts, bench-data.ts, CI workflow. I read `suites/tool-suites.ts` and `suites/suite-runner.ts` only to see how the baselines are scored.
Checks run: jest on metrics, scorecard and baselines passed (5 suites, 32 tests). I did not run corpus.spec, any bench, `withPinnedCorpus` or Electron. I ran read-only `git` and `node` probes against the committed question files.

## Verdict

- Score: 6/10 (5-6 band: works, with real gaps that bias the benchmark).
- Recommendation: REVISE. No blocking defects. 2 serious, 7 moderate, 4 minor.
- What separates it from 7-8: the native-baseline arm has two correctness gaps. One drops a failure silently. The other scores the baseline against a truth it cannot see (hidden files). Both skew the "tool vs native" verdict toward the tool.
- What separates it from 3-4: the metrics core, the scorecard schema, the protobuf decoder and the corpus owner-pid sweep are correct on the cases I could construct. The ground truth is compiler- or git-derived and mostly well-defined.

## Serious

### S1. `dependentsBaseline` loses a failed first rg call and reports success
- File: `baselines/native-baselines.ts:160-170`, with `rg()` at `:338-364`.
- Scenario: the `-l` static-import search over `libs apps` errors (10 s timeout, exit 2 or spawn error). `second = rg(ctx, [...], first)` runs. On success, `rg()` returns `error: null` and merges `previous.stdout` but ignores `previous.error` (`:348-354`). `toFileResult(second)` then yields `success(...)` with no error.
- Impact: the suite runner only substitutes `ERRORED_ANSWER` when `result.error !== null` (`suites/suite-runner.ts:228`). A native baseline that missed every static import is scored as a clean partial answer. It is not counted in the error rate and not flagged. The dependents verdict compares the tool against a silently crippled baseline.
- Fix: in `rg()`, propagate `previous?.error ?? null` on success. Or in `dependentsBaseline` return early on `first.error`, as `symbolsExactBaseline` and `rankedKeywordFiles` already do.

### S2. Truth includes hidden-directory files; the native glob and text baselines cannot see them
- Files: truth is `ground-truth/file-tool-questions.ts:88-104` (`listCorpusFiles` skips only `.git`/`node_modules`) and `:407` (`picomatch(..., { dot: true })`). Baselines are `baselines/native-baselines.ts:239-242` (`fastGlob` with default `dot:false`) and `:250-269` (rg without `--hidden`; `RG_EXCLUDES` only adds `questions/**` and `node_modules`).
- Evidence, from the committed `questions/7910f34cf/file-tools.json`: 60 of 200 text questions have truth lines under dot-directories (330 of 2,553 truth lines; the pin carries 4,595 tracked files under `.ptah/`, `.claude/` and `.github/`). 18 of 100 glob questions have dot-path truth.
- Impact: both suites use `recall_all` as the primary metric. rg and fast-glob can never reach full recall on those questions, however correct they are. Whether the MCP tool sees hidden files is unspecified. If it does, the "tool beats native" delta is inflated. If it does not, the tool is penalised by the same truth. Either way the truth and the arms disagree on visibility, and nothing records that.
- Fix: pick one visibility rule and apply it to all three. Either generate truth with the same rule as the arms (skip dot-dirs, and mirror the tool's workspace excludes), or pass `--hidden` and `dot:true` to the natives and make sure the tool is configured the same way. Add a spec asserting every truth path passes the arm's visibility rule.

## Moderate

### M1. `parseLineOutput` regex is greedy and corrupts file:line keys
- File: `baselines/native-baselines.ts:430`. `/^(.*):(\d+):(.*)$/` takes the last `:\d+:` in the line, not the first.
- Repro: `./libs/a.ts:10:  const t = '10:30:45';` parses to path `./libs/a.ts:10:  const t = '10`, line `30`. (Confirmed with node.)
- Prevalence: about 2,100 lines in the pin contain `:\d+:`. Any matching hit becomes a bogus location, so the true hit is lost and a false positive is added. This affects `references`, `symbols-exact`, `definitions`, `text-literal` and `text-regex`.
- Fix: `/^(.*?):(\d+):/`. rg runs with relative paths, so there is no drive-letter colon to worry about.

### M2. rg result order is nondeterministic, but `symbolsExactBaseline` is order-scored (hit@5)
- Files: `baselines/rg-runner.ts:43-106` passes no `--sort path` and no `-j1`. `baselines/native-baselines.ts:104-119` returns rg order.
- Impact: for names with more than 5 declaration hits, the baseline's hit@5 varies between runs. This feeds the noise margin and the recorded-failure gate. `definitionsBaseline` and `rankedKeywordFiles` sort explicitly, so only some arms are deterministic.
- Fix: add `--sort path` to `RG_EXCLUDES`, or sort in `toLineResult`.

### M3. Scorecard schema accepts internally inconsistent suites
- File: `scorecard/scorecard.types.ts:52-105`, `scorecard/retrieval-suite-kind.ts:4-41`. These constraints are not enforced:
  - a `pass` or `fail` suite whose `details.primaryMetric` is absent or null;
  - `decidingBaseline` not present in `baselines`;
  - `questions: 0`;
  - `deltas[id][metric]` that is not tool minus baseline;
  - `deltas` metric keys not present in `details.metrics` or `baseline.metrics`;
  - `pass` with zero baselines.
- Impact: a gate-readable scorecard with a verdict that does not follow from its numbers passes validation and is written by `writeScorecardJson`.
- Fix: add superRefine checks (primaryMetric/decidingBaseline resolve and are non-null for pass/fail; delta recomputation within epsilon). Move them into the retrieval kind's `detailsSchema` where they belong.

### M4. Retrieval markdown drops the tool's metrics when a suite has no baselines
- File: `scorecard/retrieval-suite-kind.ts:49-53`. The tool-metric rows are emitted inside `for baseline of suite.baselines`. With zero baselines (or an all-`na` suite) the tool's own metrics never reach `scorecard.md`.
- Fix: emit one row per metric, with `na` baseline cells when no baseline exists.

### M5. Empty-input reads as best result in cost metrics
- File: `metrics/cost-metrics.ts:42-48`, `metrics/retrieval-metrics.ts:55-61`. `errorRate([])`, `truncationRate([])` and `callsPerAnswer(_, 0)` return `0`, and lower is better (`LOWER_IS_BETTER`). A suite that made no calls looks perfect. `p50Latency` correctly returns `undefined`.
- Mitigated if callers only call these with non-empty input; I did not verify every call site (outside my scope). Returning `undefined` would match the percentile functions.

### M6. Corpus sweep can miss stale worktrees when `tmpdir()` is an 8.3 short path (environment-dependent, not reproduced here)
- File: `corpus/corpus.ts:247-257`. `isTemporaryCorpusWorktree` folds case only. `git worktree list` can report the long form (`C:/Users/Abdallah/...`) while `os.tmpdir()` returns `C:\Users\ABDALL~1\...`. Then `relative()` starts with `..`, the worktree is never recognised, and a crashed run's full checkout is never reclaimed.
- Consequence is disk leak only, not deletion. This machine's temp path (`abdal`) is not affected.
- Fix: compare `realpathSync.native` of both sides.

### M7. Orphan temp dirs and PID reuse in the corpus cleanup
- File: `corpus/corpus.ts:98-102, 196-215`. The sweep only walks registered worktrees.
  - If a run dies between `mkdtemp`/owner write and `worktree add` (or `worktree add` fails after partially registering), the directory and owner file are only removed by that run's own `finally`. A hard kill leaves them forever.
  - A dead owner whose PID is later reused by an unrelated process is treated as alive, so its worktree is never swept.
  - `hostname` is written but never compared, so a shared temp root would trust another host's PID.
- The failure mode is leak only. The live-run corpus on this machine has an owner file, so there is no cross-run deletion risk today.
- Fix: also sweep `ptah-mcp-bench-corpus-*` directories (not just registered ones) by owner liveness. Treat an owner file older than a threshold as dead, and compare the hostname.

### M8. Relevance generator treats every git failure as "not an ancestor / file missing"
- File: `ground-truth/relevance-questions.ts:92-122`. A bare `catch { return false }` conflates `merge-base --is-ancestor` exit 1 and `cat-file -e` exit 1 with real failures (exit 128: bad repo, missing object, git not found).
- Impact: PRs and commits are silently dropped, and the only signal is the `<200` deviation message. An empty frozen file is still schema-valid, since the questions array has no `.min(1)`.
- Fix: swallow only exit status 1; rethrow others. Require `questions.length > 0`.

## Minor

- m1. `baselines/rg-runner.ts:171-183` `hasExplicitSearchPath` counts `--glob` values (`!tools/...`) as positional args, so it would not append `.` if a caller omitted the path. All current callers pass `.` or paths, so there is no live effect.
- m2. `textLiteralBaseline` and `referencesBaseline` pass a raw query as a positional arg (`native-baselines.ts:128-136, 250-258`) without `-e` or `--`. A query starting with `-` is parsed as an rg flag and the baseline errors. Current questions start with a letter, so this is latent.
- m3. `memoryBaseline` sets `abstained: question.abstain ?? ...` (`native-baselines.ts:290`), so it reads the ground-truth abstain flag. Harmless today because the memory native arm is `{decides:false, scored:false}` (`tool-suites.ts:578`), but it would be a leak if that arm were ever scored.
- m4. `relevanceGitLogBaseline` greps history that includes the question's own commit message (the query is that subject). I measured the effect on 30 commit-sourced test questions with the real keyword and counting logic: mean recall@10 was 0.06, so no oracle effect materialises. The arm is `decides:false`.
- m5. `extractTopLevelDeclarations` always parses as `question.ts` (`file-tool-questions.ts:155`). JSX in `.tsx` would parse as type assertions. The 3 `.tsx`/`.js` AST questions committed currently agree with the per-extension parse (checked).
- m6. `generateGraphQuestions` and `generateSymbolQuestions` do not assert the target stratum counts (50/50/25/25, 100 deps, 150 defs). A short stratum is only visible in `counts`. SCIP quotes unfilled strata explicitly; the TS side does not.
- m7. Dependents truth omits test-file importers (`graph-questions.ts:383-388`) while references truth keeps them. Not a recall problem because `recall_all` decides, but precision against a graph that lists spec importers is understated.
- m8. Markdown tables are not escaped for `|` or newlines in lifecycle `detail` or claim text (`scorecard-writers.ts:101`).

## Five logic questions

1. Silent failure: S1 (partial native result reported as success). M4 (tool metrics missing from the markdown). M8 (git failure becomes an empty question set). The runner's `ERRORED_ANSWER` (`abstained:false`) correctly stops an errored native or tool call from being read as a correct abstention.
2. Unexpected user action: running a second bench or worktree concurrently is safe (owner file). Ctrl-C during a run leaves a worktree that the next run reclaims, but only if it is registered and the temp path compares equal (M6, M7).
3. Wrong answer rather than error: M1 (corrupted location keys), S2 (truth not visible to baselines), M2 (order jitter in hit@5).
4. Dependency failure: rg timeout or exit 2 rejects the whole call, which is the correct loud behaviour except for S1. `gh` retries 3 times with no backoff (`relevance-questions.ts:229-248`; low impact). `git` failures are swallowed in M8.
5. Missing: the scorecard has no verdict-versus-data consistency check (M3). Nothing reconciles the truth's file visibility with the arms (S2). Nothing asserts the generated counts hit their strata targets (m6).

## Verified correct

- `metrics/retrieval-metrics.ts`:
  - Abstention: both abstain scores 1; an answer that abstains against a non-empty truth, or a non-abstaining answer against an abstain truth, scores 0.
  - Empty truth without abstain scores 0 and is not read as a pass.
  - Duplicates are collapsed before scoring.
  - nDCG ideal-DCG uses `min(k, |truth|)`.
  - `k=Infinity` works.
  - win32 root stripping is case-insensitive, and the drive-letter and slash normalisation is correct for `D:\x` and `d:/x`.
  - Paths outside the workspace pass through unmatched.
- `percentile` is nearest-rank and returns `undefined` on empty input.
- `resultTokens` does not throw on special-token text (`disallowedSpecial: new Set()`).
- `scorecard`: `naReason` is allowed only on `na` suites. Duplicate baseline ids and deltas for unknown baselines are rejected. The guard partial/mode consistency check works. `finite()` rejects NaN and Infinity. `scorecardOutputDirectory` uses `basename(runId)`, so there is no path traversal. The canonical JSON projection hash rejects cycles, undefined array members and non-finite numbers.
- `corpus`:
  - The owner file is written before the worktree is registered, so a concurrent cleaner never sees an ownerless live worktree.
  - `process.kill(pid,0)` with EPERM treated as alive is correct.
  - Cleanup errors are aggregated and the primary error is preserved.
  - A live run's owner file exists on this machine (checked read-only: `ptah-mcp-bench-corpus-bQAnTG.ptah-mcp-bench-owner`).
- `ground-truth`:
  - Symbols: overload collapse by symbol, negative names verified absent from corpus text, JSDoc identifier-token stripping, and compiler truth restricted to corpus files.
  - Definitions: alias definitions (unresolved externals) excluded; truth is the name span line.
  - Relevance: PRs are validated as ancestors of the pin and truth files exist at the pin; commit and PR duplicates are dropped by merge SHA and file set; date ordering compares instants rather than strings; the test split is held out by date.
  - Memory: all 150 fact contents are unique across roots and families (checked value ranges), so the content-to-row map cannot collide. Truth is always the newer row.
  - SCIP: the hand-written protobuf decoder matches `scip.proto` fields (Document 1-4, Occurrence 1-3, SymbolInformation 1). Lines are 0-based converted to 1-based. Truncation, group and varint-length errors throw. Windows path separators are normalised.
- `baselines`: errored natives become `ERRORED_ANSWER` in the runner. `rankedKeywordFiles` returns early on error. `rankedKeywordFiles` and `definitionsBaseline` sort deterministically. rg timeout and output cap reject and kill the child. The `questions/**` exclude is moot because the pin has no `tools/mcp-bench`.

## Data flow

| Step | Status |
| --- | --- |
| Question files, generated and frozen at pin 7910f34cf | OK (counts not asserted, m6) |
| Truth normalised via `normalizePath` | OK |
| Native arms via rg, fast-glob and git | S1, S2, M1, M2 |
| Answer scored through metrics (abstain, dedupe, k) | OK |
| Cost metrics (empty input) | M5 |
| Scorecard schema validation and write | M3, M4 |
| Corpus lifecycle (checkout, sweep, cleanup) | OK for correctness; M6 and M7 are leaks |

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Metrics (hit, MRR, recall, nDCG, abstention, win32 paths) | COMPLETE | M5 |
| Scorecard model and validation | PARTIAL | M3, M4 |
| Corpus pinning and safe cleanup across concurrent runs | COMPLETE | M6, M7 (leaks only) |
| Compiler, git, memory and SCIP ground truth | COMPLETE | S2 (visibility), M8, m6 |
| Fair native baselines | PARTIAL | S1, S2, M1, M2 |

## Edge cases

| Case | Handled | Concern |
| --- | --- | --- |
| Empty answer vs empty truth (abstain) | YES | none |
| Errored baseline or tool on an abstain question | YES | not read as a pass |
| Line content containing `:\d+:` | NO | M1 |
| Hidden-directory files in truth | NO | S2 |
| First of two chained rg calls fails | NO | S1 |
| Crashed run's worktree, owner dead | YES | M6 if the temp path is an 8.3 form |
| Git failure in the relevance generator | NO | M8 |

## Re-review (round 1)

Read the uncommitted diff for `baselines/`, `metrics/`, `scorecard/`, `corpus/`, `ground-truth/relevance-questions.ts` and `suites/suite-runner.ts` (`deltasFor`). I ran only read-only probes: `git cat-file`, `git merge-base` and timed `rg` against the worktree. I ran no bench, Electron or `withPinnedCorpus`.

### Status of each item

| Item | Status | Evidence |
| --- | --- | --- |
| S1 | FIXED | `native-baselines.ts` `dependentsBaseline` returns on `first.error`. `rg()` now carries `previous?.error ?? null`. |
| S2 | FIXED | `RG_EXCLUDES` adds `--hidden` and `--glob '!.git'`. `globBaseline` uses `dot:true` with `.git` and `node_modules` ignored. Truth was left unchanged by decision. Whether the MCP tool itself follows the same rule is not checked here. |
| M1 | FIXED | `parseLineOutput` is now `/^(.*?):(\d+):/`. |
| M2 | FIXED | `--sort path` is in `RG_EXCLUDES`, so rg order is deterministic. See N3 for the cost. |
| M3 | PARTIAL | The delta check matches `deltasFor`; see "M3 delta check" below. A `pass` verdict with a null primary metric is still accepted, and a tied comparison accepts any delta. |
| M4 | FIXED | `retrieval-suite-kind.ts` emits tool rows when there are no baselines. `cell()` escapes pipes and newlines in both writers. |
| M5 | FIXED | `errorRate`, `truncationRate` and `callsPerAnswer` return `undefined` on empty input. |
| M6 | FIXED | `isTemporaryCorpusWorktree` and the orphan sweep compare `realpathSync.native` paths. |
| M7 | FIXED, with caveat N2 | The orphan sweep, `processStartedAt` reuse detection and the hostname check are all present. |
| M8 | FIXED, but it introduced N1 | Only exit status 1 is swallowed, and `counts.total` is now positive. |
| `-`-prefixed query | FIXED | `-e` for regexes, `-F --` for the literal baseline. |

### M3 delta check against `suite-runner.ts` `deltasFor`

- **Sign:** `deltasFor` uses `lowerIsBetter=false` for every quality metric. The schema takes direction from `LOWER_IS_BETTER` for the same eight metric names, and all eight are `false`, so the signs agree.
- **Rounding:** the runner computes `round(tool - base)` from already-rounded values to 4 decimals. The schema recomputes that with a `1e-4 + 1e-9` tolerance, so there is no false rejection.
- **Null sides:** the runner emits null when either side is null or undefined. The schema requires null when either side is `== null`. These agree. A baseline that omits the key is treated as null on both sides.
- **Cost-only and extra keys:** `result_tokens_p50`, `calls_per_answer`, `latency_ms_p50` and `extraDeltas` keys are not in the metric map, so they are skipped rather than false-rejected.
- **Unscored baselines:** `scored=false` produces no quality delta keys, so nothing is checked.
- **Remaining gap (minor):** `expected !== 0 &&` means any delta, including a fabricated non-zero one, passes when the true difference is 0. A wrong zero delta is still caught.
- **Remaining gap (minor):** the `pass`/`fail` verdict is not checked against the metrics. A `pass` with a null tool primary metric or `questions: 0` still validates.

### Corpus orphan sweep: can it delete a live run's folder?

Short answer: not while the owner is alive, with one exception (N2, age override). Case by case:
- A registered worktree is skipped (`registered.has(canonicalPath(folder))`).
- A folder that is not yet registered, with a live owner file, is skipped. The owner file is written before `git worktree add`, and the owner check is `isOwnerLive`.
- A folder with no owner file is only reclaimed after `ORPHAN_GRACE_MS` (10 minutes) by folder mtime. A live run writes its owner file immediately after `mkdtemp`.
- An owner file whose folder still exists is skipped.
- Another host's owner is treated as live until 12 hours.
- If the start-time probe fails or returns null, the owner is treated as live.
- The legacy owner format (no `processStartedAt`) is treated as live while the pid runs. That is the format of the run currently in progress.
- `rm` failures are swallowed, so this is leak-only cleanup.

### New defects

- **N1 (Serious, regression from the M8 fix): `fileExistsAtPin` now throws on a deleted file.**
  - File: `ground-truth/relevance-questions.ts:111-125` (`exitCode(error) === 1`).
  - `git cat-file -e <pin>:<missing path>` exits **128** ("fatal: path ... does not exist"), not 1. I confirmed this with `git cat-file -e 7910f34cf:nonexistent/file.ts`. `merge-base --is-ancestor` does exit 1 for "not an ancestor", so `isAncestor` is correct.
  - Effect: the first merged PR or commit that touched a file since deleted or renamed will crash `generateRelevanceQuestionFile`. Before the fix it was dropped silently.
  - Fix: for `cat-file`, distinguish a missing path from a real failure. For example, use `git cat-file -e` with `--batch-check` and read the "missing" output, or `git ls-tree <pin> -- <path>` (empty output means absent), or check stderr for "does not exist in". Only rethrow other failures.
- **N2 (Moderate): the 12-hour age limit overrides a verified-live owner.**
  - File: `corpus/corpus.ts` `isOwnerLive`: `now - createdAt > OWNER_MAX_AGE_MS` returns false before the pid and start-time checks.
  - A run longer than 12 hours (a hung or slow bench) whose pid and start time still match has its checkout removed by the next run's sweep.
  - Apply the age limit only when the start time is missing or cannot be read, since the start-time check already handles pid reuse.
- **N3 (Minor): `--sort path` makes every rg call single-threaded.**
  - Measured on this worktree (12.8k files): about 1.0 s without the flag against about 2.1-2.4 s with it for one query, and a cold run took 6.6 s.
  - That is closer to `RG_TIMEOUT_MS` (10 s) than before. Under load from a concurrent bench, a timeout becomes a native error. The relevance and memory baselines run several sequential rg calls per question.
  - Native latency figures are also inflated by the flag. Consider sorting results in `toLineResult` instead, or raising the timeout.

### Updated verdict

- Recommendation: **REVISE (narrow)**. N1 is a real regression and a small fix. Score moves to 7/10.
- All of S1, S2, M1, M2, M4-M8 and the `-`-prefix item are fixed. M3 is mostly fixed; its two gaps are minor.
- With N1 fixed, and N2 tightened or accepted by the coordinator, this lane code is approvable.

## Re-review (orchestrator correction)

Read the complete changed implementations and the added specs. Diagnostics were clean for the three source files. No benchmark, Electron, `withPinnedCorpus`, build, or test command was run.

| Item | Status | Evidence |
| --- | --- | --- |
| N1 | NOT FIXED | `ground-truth/relevance-questions.ts:115-123` correctly makes a missing ASCII path empty and propagates a bad revision, but it reads quoteable, line-delimited `ls-tree` output and compares `line === path`. Git applies `core.quotePath` to non-ASCII/control paths unless `-z` is used; a tracked `src/café.ts` with `core.quotePath=true` is emitted quoted/escaped and is reported absent. `relevance-memory.spec.ts:123-135` covers only ASCII paths. |
| N2 | FIXED | `corpus/corpus.ts:152-170` verifies a same-host pid and matching recorded start time before applying the 12-hour fallback. A running long benchmark therefore remains protected, while an unverifiable owner with a valid old `createdAt` is reclaimed. `corpus.spec.ts:393-421` covers both branches. |
| N3 | FIXED | `native-baselines.ts:442-472` removes ripgrep's serialising sort and sorts line results by code-unit path then numeric line, and file results by the same path comparator. `toLineResult`/`toFileResult` apply them at `380-409`; later baseline-specific ranking is unchanged. `native-baselines.spec.ts:323-346` covers the resulting path/line order. |

### New defect

1. **Serious** — `tools/mcp-bench/src/ground-truth/relevance-questions.ts:115-123`: With Git's `core.quotePath=true`, a valid non-ASCII (or control-character) tracked candidate such as `src/café.ts` is output quoted/escaped by `git ls-tree --name-only`. The exact comparison returns false, so relevance generation silently discards valid ground truth and can emit an incomplete benchmark. Use `ls-tree -z --name-only`, NUL-delimited parsing, and a non-ASCII regression case (under both quotePath settings).

### Verdict

**REVISE.** N2 and N3 are correct, but N1 still has a silent false negative for valid Git paths.

## Re-review (N1 -z fix)

Read the uncommitted diff and the complete affected `fileExistsAtPin` implementation and real-Git regression case. No benchmark, Electron, `withPinnedCorpus`, build, or test command was run.

| Item | Status | Evidence |
| --- | --- | --- |
| N1 | FIXED | `ground-truth/relevance-questions.ts:115-133` invokes `git ls-tree -z --name-only <pin> -- <path>` and compares NUL-split names exactly. NUL mode suppresses Git's `core.quotePath` display quoting while retaining spaces and UTF-8 names. `relevance-memory.spec.ts:123-137` creates, commits, and queries `src/naïve file.ts` as well as an absent path in a real repository. |
| N2 | FIXED, unchanged | `corpus/corpus.ts:152-170` is unchanged from the prior review: matching live pid/start-time owners are retained irrespective of age; unverifiable old owners are reclaimed. |
| N3 | FIXED, unchanged | `native-baselines.ts:442-472` is unchanged from the prior review: no ripgrep `--sort`, with deterministic code-unit path then numeric-line parser sorting. |

### Final verdict

**APPROVED.** The NUL-delimited Git boundary removes the prior quotePath false negative, and the N2/N3 corrections remain intact.
