# Batch 9 executor report: Tasks 9.1, 9.2 and 9.3 (suite runners, lifecycle scenarios, bench CLI)

Executor: backend-developer subagent. Worktree `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark`
(branch `fix/task-619-tool-benchmark`). Task 9.0 was already committed (ea2f92fd2). Nothing is committed.
No real bench was run: nothing called `withPinnedCorpus` or launched a host on a corpus (see "Ready for smoke").

Status: **ready for smoke.** The code and specs are done and the scoped gate passes.

## Work completed

### Task 9.1: per-tool suites and runner

- `suites/question-sets.ts`: one merged envelope schema for the Batch 5, 6 and 7 question files. It holds the
  Batch 5 question schemas, which were never exported before, and reuses Batch 6's exported schemas. It also
  reads the SCIP files: their `language`, and the `na` record that makes a suite `na` with the record's reason.
  It reads `ts-agreement.json` too. Each question set carries its `groundTruth` identity and the SHA-256 of
  its file, which the scorecard lists as artifacts. A corpus-commit mismatch or an invalid question breaks the
  run; it is never scored.
- `suites/suite-runner.ts` is the generic engine. It runs in two phases:
  - `runNativeBaselines` runs before any host exists, so the baselines do not compete with the host for CPU,
    and rg never sees a spool file a tool wrote into the corpus.
  - `runToolQuestions` asks the questions over MCP through `CallRecorder`.
  - `assembleSuite` scores both sides in the Task 4b.1 shape: `kind: 'retrieval'`, `claim`, `groundTruth`,
    `baselines[]` with `native` as one id, sign-normalised `deltas`, and `cost` with `cost.source`. The
    source is `live` when the suite made calls and `none` when it made none.
  - Scoring rules:
    - A call that fails or returns text the bench cannot parse counts as an error. It scores 0 on every
      metric, including against an abstention truth.
    - A tool that `tools/list` does not show **fails** with "tool not exposed on this host (mechanism:
      none)". It is never `na`. Its native baseline is still measured.
  - Verdict = `fail` when any of these holds:
    - the error rate is over 1 %;
    - the primary metric is below the deciding native baseline by more than the noise margin (0.02, or
      `--noise-margin`);
    - a claim check fails;
    - a lifecycle scenario of the tool fails (`applyLifecycleVerdicts`).
  - Breakdown views are emitted as extra `na` suites with an `arm`. They never decide the verdict.
- `suites/tool-results.ts` reads results, one reader per tool. The formats come from the formatter source:
  - `formatLspLocations`: 0-based lines, shifted to 1-based.
  - `graphFileAnswer`.
  - `SymbolSearchResult`: each hit maps to the truth location its row's `in <rel>:<start>-<end>` range
    covers.
  - `formatSearchFiles`.
  - Memory hits (matched by `content`), `rankFiles`, and symbol-index pages.
  - A budget-cut JSON body is a parse error.
- `suites/tool-suites.ts` defines 13 TS-corpus suites. Each records its `claim` file:line and calls the tool
  with the argument names in `tool-description.builder.ts`:

  | Suite id                    | Tool                      | Claim                       | Primary                           | Natives (Batch 8)                                    |
  | --------------------------- | ------------------------- | --------------------------- | --------------------------------- | ---------------------------------------------------- |
  | symbols-exact               | ptah_code_search_symbols  | prompt :47                  | hit@5                             | `native` symbolsExactBaseline                        |
  | symbols-concept             | ptah_code_search_symbols  | prompt :47                  | hit@5 (file level)                | `native` symbolsConceptBaseline                      |
  | relevance (test split only) | ptah_relevance_rank_files | prompt :52                  | recall@10                         | `native` (rg), `native-git-log` (view, not deciding) |
  | references                  | ptah_lsp_references       | prompt :42                  | recall_all (precision reported)   | `native` referencesBaseline                          |
  | definitions                 | ptah_lsp_definitions      | prompt :43                  | hit@1                             | `native` definitionsBaseline                         |
  | dependents                  | ptah_get_dependents       | prompt :50                  | recall_all                        | `native` dependentsBaseline                          |
  | dependencies                | ptah_get_dependencies     | tool-description :1837      | recall_all                        | `native-read` (cost only)                            |
  | symbol-index                | ptah_get_symbol_index     | prompt :54                  | hit@1 (file level)                | `native` (file level)                                |
  | memory                      | ptah_memory_search        | prompt :51                  | hit@5                             | `native-comparison` (view: comparison, not scored)   |
  | ast-analyze                 | ptah_ast_analyze          | prompt :48                  | recall_all + token ratio ≤ 0.6    | `native` (Read)                                      |
  | context-enrich              | ptah_context_enrich_file  | prompt :49                  | recall_all (token ratio reported) | `native` (Read)                                      |
  | search-files                | ptah_search_files         | prompt :40                  | recall_all                        | `native` (Glob)                                      |
  | search-text                 | ptah_search_text          | tool-description (Batch 33) | recall_all                        | `na` until listed                                    |

  Polyglot suites, one set per SCIP file: `references-python-attrs`, `dependents-python-attrs`,
  `references-go-logrus` and `dependents-go-logrus`. Each records its unfilled strata as a "(ground truth)"
  finding, quoted and not padded.

- The hand-offs, and where each one went:
  - **References.** The Batch 5 TS truth decides the verdict. `arm: 'scip-strict'` is the SCIP view:
    `na`, never the verdict, over the 111 of 148 questions whose SCIP set equals the TS truth (see Deviation
    9). `arm: 'same-name'` is a breakdown over the 51 same-name questions.
  - **Relevance.** Only the `test` split is scored: 200 questions, 8 PRs and 192 commits. The breakdowns
    `source:pr` and `source:commit` quote that composition.
  - **Dependents and dependencies.** The tool is called with
    `file = join(<this run's corpus root>, question.file)`. A relative-path probe runs once per question on
    a separate, unscored call. Its counts are quoted as a "(relative-path probe)" finding: accepted,
    rejected, inconclusive while building, and the first rejection text.
  - **Graph tools.** The retry budget is `GRAPH_RETRY`: 3 retries, each wait at most the 15 s hint.
  - **Native baselines.** They take `corpusRoot` = the pinned corpus and `gitRoot` = the repository. Polyglot
    corpora pass their own clone as `gitRoot`. rg is resolved once per run (`RG_PATH`, then PATH).
  - **Memory.** The seeding runs inside the isolated host: `bench-host.entry.ts` calls `seedMemory(store,
buildMemoryQuestionSet(), roots)` from `afterContainerReady` when `PTAH_BENCH_MEMORY_SEED` names the
    roots (`transport/memory-seed-env.ts`). The roots are created per run in a scratch folder: A is a temp
    git repository, B is a plain directory, and the worktree of A is created with `git worktree add`.
    Questions go to `/workspace/<root>` by scope. Leaks are counted. The 4 track-A questions are unscorable
    and are excluded, with a finding.
  - **Win32 path case.** `normalizePath` now matches the workspace root case-insensitively on win32, beyond
    the drive letter (new `platform` option, with a spec case).
  - **Embedding model download.** I chose to record the download time as a separate cold-start cost. A
    timed `embedder-warmup` call runs before any suite and is recorded as its own lifecycle entry, so the
    download is never inside query latency.
- `--smoke`: 40 questions per suite, seeded (`SMOKE_SEED` 6190901), kept in file order.

### Task 9.2: lifecycle scenarios 1-9

`lifecycle/lifecycle-scenarios.ts`. Every host comes from an injected `HostLauncher`, so the guard modes and
the stop classification apply unchanged. A guard error is never caught; it voids the run.

- **`runCopyScenarios`** runs on a disposable `withLifecycleCorpus` copy, never on the pin. Scenarios:
  - 1 `cold-start`: polls every 5 s, up to 120 s with `--smoke` and 300 s without. It records the states
    seen meanwhile.
  - 2 `edit-then-query-5s` and `-60s`.
  - 3 `add-then-query`.
  - 4 `delete-then-query`. Its precondition is that the added symbol was indexed; otherwise it fails with
    "precondition failed".
  - 5 `large-file-3900-lines` and `large-file-1.5mib`. The second passes on success, or on an honest
    too-large report from the search answer or from `ptah_code_reindex {filePath}`.
  - 6 `index-age-24h`: rows are backdated 25 h in the host's isolated DB (`code_symbols.updated_at`, via
    better-sqlite3 in the runner). The scenario then checks that a lazy refresh started, that it ended, and
    that the probe symbol survived the cap.
  - 8 `transport-restart`: the host is stopped while a call is in flight. The outcome of that call is
    recorded, then a fresh host must answer.
- **`runSessionScenarios`** runs on the main host and changes no corpus file. Scenarios:
  - 7 `two-workspaces-memory-leak`, `worktree-memory-scope`, `worktree-spool-path` and
    `two-workspaces-symbol-scope`. The spool check calls the memory search from the worktree URL with
    `global: true` and 50 hits, a result over the budget, then checks the spool path against the caller's
    root.
  - 8 `transport-idle-gaps`: 200 calls (40 with `--smoke`) with 4-8 s idle gaps on the keep-alive client.
    It counts ECONNRESET and every transport code; this count feeds Batch 35.
  - 9 `worktree-task-tools`: in a temp git repository plus `git worktree add`, both under the run's scratch
    folder, the scenario calls `ptah_task_create` with `workspaceRoot` = the worktree. It then checks the
    worktree's `.ptah/specs`, checks that the main checkout's listing is unchanged, and checks that a root
    outside the repository is refused. Today the argument is stripped (`TaskCreateArgsSchema` is a
    non-strict `z.object`), so the scenario is recorded as a **failure**.
- Expected failures today, recorded as failures and never as `na`: on cli-headless, cold start and
  edit/add-then-query; scenario 9; and probably the worktree memory scope and the spool path.
- Spec (`lifecycle-scenarios.spec.ts`, 6 cases, fake hosts):
  - an index that stays empty gives the expected failures;
  - a live index passes every copy scenario;
  - a throwing scenario stops the host and rethrows;
  - the session scenarios fail when the task tools ignore `workspaceRoot` (40 ECONNRESETs counted, spool
    outside the worktree);
  - they pass against tools that keep each root apart;
  - the file generators produce 3,900 lines and 1.5 MiB.

### Task 9.3: bench CLI, targets, and the corpus race fix

- `main.ts` holds the CLI. `bench-hosts.ts` starts the hosts and turns their stop reports into the run
  metadata.
  - `run.guardMode` is `process-watch` if any host ran in it, else `hash`, else `not-applied`.
  - `run.guard` is the union of the unprobed processes across hosts, with the largest handle count per pid;
    `partial` is set when that union is non-empty.
  - `run.hostExit` is the main host's exit. Its `detail` also names any other host that did not stop
    cleanly. A `crash-on-shutdown` never touches a suite's error rate.
  - The run also records `product.commit` (`git rev-parse HEAD`) and `corpus.commit`.
  - `artifacts[]` lists every question file used, with its SHA-256.
  - `eagerSelection` is empty and says "not computed in Phase 1; Batch 37".
- `project.json` adds three targets:
  - `build-bench`: an esbuild bundle of `main.ts` to `dist/tools/mcp-bench/bench.mjs`. Third-party packages
    are external, and it depends on `build-host-bundle`, so the host bundle's `deleteOutputPath` runs first.
  - `bench`: `node dist/tools/mcp-bench/bench.mjs bench`, depends on `build-host` and `build-bench`.
  - `generate`: `node dist/tools/mcp-bench/bench.mjs generate`, depends on `build-bench`.
- Exit codes. A non-zero exit means the run itself broke; verdicts never change the exit code.

  | Code | Meaning                                                                                           |
  | ---- | ------------------------------------------------------------------------------------------------- |
  | 0    | Scorecard written                                                                                 |
  | 1    | The run broke                                                                                     |
  | 3    | `RealStateChangedError` or `BenchHeldRealStateError`: the run is void and no scorecard is written |
  | 4    | `ConcurrentWriterError`: environment failure, not retried                                         |

- `corpus.ts` race fix:
  - At checkout, an owner file `<tempRoot>/ptah-mcp-bench-corpus-XXXX.ptah-mcp-bench-owner` (pid, hostname,
    time) is written **before** `git worktree add`. It sits beside the worktree, so no corpus reader sees it.
  - The stale sweep skips a registered corpus worktree whose owner pid is alive (`process.kill(pid, 0)`;
    EPERM counts as alive).
  - A worktree with a dead owner, or with no owner file (a crashed run, or a run from before this change),
    is removed as before. Cleanup removes the owner file too.
  - New option `withPinnedCorpus(config, use, { tempRoot?, isProcessAlive? })`.
- `corpus.spec.ts` uses a private temp root per case and adds two cases:
  - two overlapping checkouts in one process: the inner run leaves the outer corpus alone;
  - a dead owner's worktree is removed while a live owner's is kept.

## Bench CLI usage

```text
node dist/tools/mcp-bench/bench.mjs bench [--host cli-headless|electron] [--electron-mode launch|attach]
     [--suite <id|tool name|lifecycle|polyglot>[,…]] [--smoke] [--out <dir>]
     [--compare <baseline scorecard.json>] [--noise-margin <0..1>]
node dist/tools/mcp-bench/bench.mjs generate [--only ts,file-tools,memory,relevance] [--out <dir>]
     [--scip-index <corpusId>=<index.scip>]
```

- Through Nx, the arguments are forwarded verbatim. Verified with a refused flag, which made no run:
  `npx nx run mcp-bench:bench --smoke --host cli-headless --bogus=1` printed `[bench] the run broke: Error:
unknown flag --bogus` and exited 1.
- `--suite` takes suite ids (for example `symbols-exact`), tool names (for example `ptah_lsp_references`,
  which selects the TS and the polyglot suites), `lifecycle`, and `polyglot`. Without `--suite`, everything
  runs. With `--suite` and no `lifecycle` in it, the lifecycle scenarios are skipped.
- Output goes to `tools/mcp-bench/out/<runId>/scorecard.json` and `scorecard.md` (gitignored), or to `--out`.
  `--compare` also writes `compare.md`.
- `generate` writes `questions/<pin>/` by default:
  - Without `--only`: `ts` (symbols, references, definitions, dependents), `file-tools` and `memory`.
  - `relevance` runs only when asked (it needs `gh` and the network).
  - SCIP files are written only from an index you pass with `--scip-index`; `generate` does not run the
    indexers.

## Files written (absolute)

Listed in batches.md (8):

- CREATED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\suites\tool-suites.ts
- CREATED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\suites\suite-runner.ts
- CREATED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\lifecycle\lifecycle-scenarios.ts
- CREATED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\lifecycle\lifecycle-scenarios.spec.ts
- CREATED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\main.ts
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\project.json (targets `build-bench`, `bench`, `generate`)
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\corpus\corpus.ts
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\corpus\corpus.spec.ts

Extra (9; see Deviation 1):

- CREATED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\suites\question-sets.ts
- CREATED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\suites\tool-results.ts
- CREATED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\suites\tool-suites.spec.ts
- CREATED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\bench-hosts.ts
- CREATED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\memory-seed-env.ts
- CREATED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\memory-seed-env.spec.ts
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\bench-host.entry.ts
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\metrics\retrieval-metrics.ts
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\metrics\retrieval-metrics.spec.ts

Report: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\.ptah\specs\TASK_2026_619_af7f\batch-9-executor-report.md

No file under `libs/` or `apps/` was changed. `batches.md` already showed as modified before I started; I did
not edit it.

## Verification

All commands were run from the worktree root.

- `npx prettier --check <the 17 paths above>`: "All matched files use Prettier code style!" `npx prettier
--write` was run on every changed file first.
- With `RG_PATH=D:\projects\ptah-extension\node_modules\@cursor\sdk-win32-x64\bin\rg.exe` set:
  `npx nx run-many -t typecheck,lint,test -p mcp-bench --skip-nx-cache --parallel=2 --output-style=static`
  - Result: "Successfully ran targets typecheck, lint, test for project mcp-bench", run duration 1m 45s.
  - Jest: `Test Suites: 17 passed, 17 total`; `Tests: 247 passed, 247 total`.
  - Lint: `✖ 2 problems (0 errors, 2 warnings)`. Both warnings were already there and are in files I did
    not change:
    - `scip-cross-check.ts` `max-lines` 703 (Batch 7, deviation 3);
    - an unused eslint-disable in `bench-host-process.spec.ts` (Task 9.0).

    Every new file is under the 700-line `max-lines` ceiling. The split into `tool-results.ts` and
    `bench-hosts.ts` exists for that reason.
- `npx nx run mcp-bench:build-host --output-style=static`: "Successfully ran target build-host for project
  mcp-bench and 32 tasks it depends on" (28 of 33 tasks from cache; the host bundle and workers were
  rebuilt). `dist/tools/mcp-bench/bench-host.mjs` contains the `PTAH_BENCH_MEMORY_SEED` seeding hook.
- `npx nx run mcp-bench:build-bench --output-style=static`: "Successfully ran target build-bench".
  `dist/tools/mcp-bench/bench.mjs` is 316 KB. `node dist/tools/mcp-bench/bench.mjs help` prints the usage
  and exits 0.
- The first `build-bench` attempt failed with `Could not resolve "vscode"`, because the runner imported the
  seed constant from `bench-host-process.ts`, which pulls in the CLI engine. That is fixed: the constant and
  its parser moved into the dependency-free `transport/memory-seed-env.ts`. `bench-host-process.ts` and its
  spec are back to their committed content.
- The committed question bank is validated by a spec case ("the committed question bank"):
  - every frozen file passes the merged envelope;
  - symbols-exact holds 350 questions;
  - the relevance `test` split holds 200;
  - python-attrs holds 37 reference and 50 dependency questions, go-logrus 41 and 37;
  - with `--smoke`, all 13 TS suites and 4 polyglot suites are built with 40 or fewer questions each.
- Not run, as instructed: `mcp-bench:bench`, `launchBenchHost` on a corpus, and anything that calls
  `withPinnedCorpus`.

## Ready for smoke

Commands, in PowerShell, from `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark`:

```powershell
$env:RG_PATH = 'D:\projects\ptah-extension\node_modules\@cursor\sdk-win32-x64\bin\rg.exe'
# Optional first check (about 6-10 min): one cheap and one index-backed suite; no lifecycle, no polyglot clone
npx nx run mcp-bench:bench --host cli-headless --smoke --suite ptah_search_files,ptah_code_search_symbols
# The batch verification smoke
npx nx run mcp-bench:bench --host cli-headless --smoke
```

Expected duration of the full smoke: about 40-60 min on this machine. This is an estimate; nothing was
timed live.

| Phase | Work                                                                                                                                                                                                             | Estimate        |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| 1     | Native baselines, 40 questions per suite. Relevance alone is several minutes: about 1 M characters of rg output plus 4-6 M of `git log` per question, all tokenised with gpt-tokenizer.                          | about 12-15 min |
| 2     | Main host: boot, memory seeding, warm-up, then 13 suites. The dependents questions wait on `building` (3 × 15 s each) until the graph is built (about 225 s). The relevance tool walks the corpus on every call. | about 10-12 min |
| 2     | Session scenarios, mostly the 40 idle-gap calls.                                                                                                                                                                 | about 5 min     |
| 3     | Two polyglot hosts.                                                                                                                                                                                              | about 4 min     |
| 4     | Lifecycle copy of the corpus, two hosts, and waits of up to 120 s / 60 s / 60 s / 60 s / 120 s.                                                                                                                  | about 10-12 min |

What it writes and where:

- Scorecard: `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\out\<runId>\scorecard.json`
  and `scorecard.md`. The `out/` folder is gitignored. The path is printed as `[bench] wrote …` on stderr.
- Temporary paths, all removed at the end:
  - `%TEMP%\ptah-mcp-bench-corpus-*`: a git worktree of this repository, with its owner file beside it;
  - `%TEMP%\ptah-mcp-bench-run-*`: scratch for the memory roots, the scenario 9 repository and the polyglot
    worktrees;
  - `%TEMP%\ptah-mcp-bench-home-*`: one per host; five hosts in total (main, python-attrs, go-logrus, two
    lifecycle hosts);
  - `%TEMP%\ptah-mcp-bench-lifecycle-*`: the corpus copy.
- Persistent cache: `%LOCALAPPDATA%\ptah-mcp-bench\corpora\python-attrs` and `…\go-logrus`. The first run
  clones them from GitHub, which needs the network.

Coordination notes for the orchestrator:

1. **Corpus prune path.** The owner-liveness fix protects a live corpus only from runs that use the new
   `corpus.ts`. A TASK_2026_620 bench that runs the old `withPinnedCorpus` from its own branch still removes
   every registered `ptah-mcp-bench-corpus-*` worktree at start, ours included. Do not let 620 start a bench
   while this smoke runs, or rebase 620 onto this batch first.
2. **TASK_2026_620 SHA.** This batch changes `bench-host.entry.ts` (bench-host files). Per handoff.md, send
   620 the commit SHA.

What the smoke will probably expose, recorded as data and not as crashes:

- A result shape the readers do not expect counts as a parse error, with the text in `failures[]`.
- `ptah_lsp_*` fails on cli-headless (not listed).
- Symbol search returns unknown coverage (counted as an error).
- The listed lifecycle failures.

A boot failure during memory seeding is a fatal host line (`HostLaunchError`), so the run exits 1. If that
happens, the stderr tail names the cause.

## Deviations

1. **File count.** 17 files instead of the 8 Task 9.1-9.3 files listed (13 with Task 9.0's accepted
   exception). All 17 are in one project and are checked by one scoped command. Why each extra file exists:
   - `question-sets.ts`: the merged envelope module that batches.md asks for ("merge … into one module").
   - `tool-results.ts` and `bench-hosts.ts`: split out so `tool-suites.ts` and `main.ts` stay under the
     700-line `max-lines` ceiling.
   - `tool-suites.spec.ts`: a colocated spec. It covers the readers, the verdict rules, parse errors counted
     as errors, "tool not exposed", `na`, breakdowns, lifecycle verdicts, and the committed bank.
   - `memory-seed-env.ts` and its spec: the seeding request between runner and host, kept free of engine
     imports.
   - `bench-host.entry.ts`: the `afterContainerReady` seeding hook. Task 9.1 needs it, and the entry is the
     only place it can run.
   - `retrieval-metrics.ts` and its spec: the win32 case-insensitive `normalizePath` that Task 9.1 carries
     from Batch 1.
2. **Embedding model download.** I took the second option of the validation note: the download time is a
   separate cold-start cost (the `embedder-warmup` lifecycle entry), not a pre-seeded shared model cache.
   The cache would need a model path the CLI does not expose (`register-thoth-libraries.ts:66` hardcodes
   `~/.ptah/models` under the temp home) and a copy into each temp home.
3. **Lifecycle on Electron is not run.** Scenarios 6, 7 and 9 need the cli-headless isolated DB path and the
   seeding hook. The CLI logs this, and the scorecard has no lifecycle rows for that run, because the
   lifecycle schema has no `na`.
   - Electron launch: memory is `na` ("memory seeding runs only in the cli-headless host …").
   - Electron attach: memory is `na` with `ATTACH_MODE_NA_REASON`.

   Electron itself was not exercised.

4. **Noise margin.** A constant 0.02 until Batch 10 measures it from three baseline runs; it can be
   overridden with `--noise-margin`.
5. **Symbol-search line matching.** Indexer rows carry no exact line, only `in <rel>:<start>-<end>` in their
   text. A hit counts for a truth location when that location falls in the range, either line base (end
   - 1). The concept suite scores both sides at file level, because the native concept baseline answers
     files.
6. **`ptah_get_dependencies`.** Batch 8 has no native baseline for it. It is compared against a cost-only
   Read (`native-read`, not scored, not deciding), so its verdict rests on the error rate.
7. **Polyglot dependents.** Batch 8's native dependents baseline is a TS import pattern over `libs` and
   `apps`, so on the Python and Go corpora it is reported but does not decide the verdict.
8. **`ptah_get_symbol_index`.** It has no question set of its own. It is scored on the symbols-exact positive
   questions at file level (`pathPrefix` = the truth file); the 50 negatives are excluded.
9. **SCIP-strict view.** `ts-agreement.json` freezes only per-question agreement statistics, not the SCIP
   reference sets. The view is therefore the tool scored on the 111 questions whose SCIP set equals the TS
   truth (Jaccard 1). It is labelled with the indexer, the exact count, and the mean Jaccard, and it is `na`
   (never the verdict).
10. **Memory claim checks.** No native baseline exists for memory (only the comparison view), so the suite
    fails on these checks instead:
    - any cross-workspace leak;
    - worktree-of-A queries finding A's fact in the top 5 for less than 1 − margin of them;
    - the usual error-rate check.

    Abstention questions are scored strictly: any hit for an abstention query scores 0.

11. **Spool-path check (scenario 7).** It uses `ptah_memory_search` with `global: true` and 50 hits, to
    force a result over the budget from the worktree URL. It is labelled with that tool, so a spool defect
    fails the memory suite. The defect is in the shared `resolveSpoolRoot`, as research A6 says.
12. **Breakdowns.** Every breakdown is emitted as an `na` suite with an `arm`: scip-strict and same-name
    for references, `source:pr` and `source:commit` for relevance. A per-stratum breakdown for
    symbols-exact was dropped to stay under `max-lines`.
13. **Extra lifecycle entry.** `embedder-warmup` was added (see Deviation 2). It is not one of the B7
    scenarios.
14. **Owner file location.** The owner file sits beside the corpus worktree
    (`<worktree>.ptah-mcp-bench-owner`), not inside it, so the corpus content and rg see nothing extra.
15. **`generate`.** It drives the existing generators. It does not run SCIP indexers; you pass an index
    with `--scip-index`, and the seed is read from the existing frozen file.
16. **`ptah_get_dependents` argument name.** The real input schema names the argument `file`, not
    `filePath` as in the batches.md wording; the adapter uses `file`.

## Out-of-scope observations

- `bench-host-process.spec.ts:42` has an unused `eslint-disable` (Task 9.0). Not touched.
- `scip-cross-check.ts` `max-lines` 703 (Batch 7, deviation 3). Not touched.
- Nx Cloud printed "organization disabled (exceeding the FREE plan)" during the builds. The builds still
  succeeded locally.

## Smoke round 1

### Fixes after the orchestrator's run

The orchestrator's run 2 lasted 34 m 33 s. It completed the main host, then the next host died with `HostLaunchError` 0xC0000409 before it was ready, and the run wrote no scorecard.

1. **A failed host no longer discards the run.** `main.ts` now catches a failure per host, per baseline and per scenario, and the scorecard is always written.
   - A host that never starts fails its suites with the reason, the exit kind, the exit code and the stderr tail. This uses the new `failure` option of `assembleSuite`, so the reason is not "tool not exposed".
   - A baseline that throws fails its suite with "native baseline broke: …".
   - A polyglot checkout that fails fails its suites.
   - Scenarios that could not run are recorded as failed rows "not run: <reason>". This uses `unscoredScenarios`, `COPY_SCENARIOS` and `SESSION_SCENARIOS`. Both runners now take a sink array, so results scored before a throw are kept.
   - Exit codes: **2** when the scorecard was written but a host, baseline or scenario failed to run; 0 when nothing failed to run, whatever the verdicts. A guard error (`RealStateChangedError`, `BenchHeldRealStateError`, `ConcurrentWriterError`) still voids the run: exit 3 or 4, with no scorecard, per batches.md.
2. **One retry of a host that dies before ready, recorded.**
   - `bench-hosts.ts` `startHost` retries a `HostLaunchError` of kind `exited-early` once. Each attempt gets a fresh temp home from the launcher.
   - Every failed attempt is kept on the host record: attempt number, exit kind and code, message with the stderr tail, and time to death.
   - Failed attempts appear in two places: in `run.hostExit.detail` (`<host> launch attempt N: exited-early, exit 3221226505 after X ms: …`), and as a lifecycle row `host-launch:<host>` with tool `bench-host`. That row passes when the retry started the host and fails when the host never started.
   - Errors that are not launch failures are not retried.
3. **A start line per host:** `[host] <name> starting on <corpus>`, with `(retry 1)` on a retry.

The crash that broke run 2 came from the **python-attrs polyglot host**. It was the first host started after `[host] main stopped: clean`, and the stack points to the polyglot phase in `runBench`. The host died before its ready line with empty stderr.

- It is not a stale temp home: every launch gets its own `mkdtemp` home, and the main host's stop had been awaited and classified clean before this host was spawned.
- It is consistent with the TASK_2026_622 class. That task's context.md records one 0xC0000409 at about 1.7 s during boot, and Batch 4d recorded 1 in 10 boot-time fail-fasts classified `exited-early`. Both are native fail-fast, outside bench code.
- I cannot prove the cause from an empty stderr. It did not recur in round 2, where no retry was needed.
- No product code was changed.

`cost-metrics.ts` keeps the orchestrator's `disallowedSpecial: new Set()` fix.

Files added in this round:

- `tools/mcp-bench/src/generate.ts`: the `generate` command moved out of `main.ts` to keep it under `max-lines`.
- `tools/mcp-bench/src/bench-hosts.spec.ts`: 3 cases covering a retry that succeeds, a retry that dies again and is recorded, and no retry for errors that are not launch failures.

Spec cases added to existing specs:

- `unscoredScenarios`, in `lifecycle-scenarios.spec.ts`;
- `assembleSuite` with a run failure, in `tool-suites.spec.ts`.

`startHost` takes an injectable CLI launcher for the spec.

### Verification

| Check                                                                                | Result                                                                                                                                                                   |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npx nx run-many -t typecheck,lint,test -p mcp-bench --skip-nx-cache` with `RG_PATH` | Passed in 2m 31s. 18 test suites, 252 tests. 0 lint errors; 2 warnings, both pre-existing (`scip-cross-check.ts` max-lines, `bench-host-process.spec.ts` unused disable) |
| prettier                                                                             | Clean on every changed file                                                                                                                                              |

### Smoke result

- **Command:** `$env:RG_PATH=…; npx nx run mcp-bench:bench --host cli-headless --smoke --skip-nx-cache`
- **Outcome:** exit 0. Run 03:30:47Z to 04:20:23Z (about 49.5 min, builds included).
- **Hosts:** main, python-attrs, go-logrus and two lifecycle hosts. All stopped `clean`, with no launch retry.
- **Guard:** `process-watch`, `partial: true`. Unprobed processes: codex.exe 7792, node.exe 18848, cmd.exe 46444. These are other sessions' processes in the tree sample; reported, not failed.
- **Scorecard:** `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\out\2026-10-07T03-30-47-793Z-cli-headless\scorecard.json` (and `scorecard.md`).

| Suite                   | Tool                      | Primary metric |   Tool |                       Native | Verdict | Main reason                                                          |
| ----------------------- | ------------------------- | -------------- | -----: | ---------------------------: | ------- | -------------------------------------------------------------------- |
| symbols-exact           | ptah_code_search_symbols  | hit@5          |      0 |                        0.875 | fail    | error rate 1 (every answer has unknown coverage; no boot-time index) |
| symbols-concept         | ptah_code_search_symbols  | hit@5 (file)   |      0 |                         0.45 | fail    | error rate 1                                                         |
| relevance (test)        | ptah_relevance_rank_files | recall@10      | 0.2125 |                        0.225 | fail    | error rate 0.05                                                      |
| references              | ptah_lsp_references       | recall_all     |     na |                          1.0 | fail    | not exposed on cli-headless                                          |
| definitions             | ptah_lsp_definitions      | hit@1          |     na |                        0.375 | fail    | not exposed on cli-headless                                          |
| dependents              | ptah_get_dependents       | recall_all     |   0.30 |                       0.6263 | fail    | error rate 0.55 (`building`)                                         |
| dependencies            | ptah_get_dependencies     | recall_all     | 0.7003 |                    cost only | fail    | error rate 0.05                                                      |
| symbol-index            | ptah_get_symbol_index     | hit@1 (file)   |  0.175 |                        0.675 | fail    | below native                                                         |
| memory                  | ptah_memory_search        | hit@5          |   0.80 |              comparison view | fail    | worktree-memory-scope lifecycle fail (0 of 15)                       |
| ast-analyze             | ptah_ast_analyze          | recall_all     | 0.7201 |                          1.0 | fail    | declaration recall below Read                                        |
| context-enrich          | ptah_context_enrich_file  | recall_all     | 0.8818 |                          1.0 | fail    | below Read                                                           |
| search-files            | ptah_search_files         | recall_all     | 0.9556 |                       0.9944 | fail    | below Glob by more than 0.02                                         |
| search-text             | ptah_search_text          | recall_all     |     na |                        0.925 | na      | tool not implemented yet (Batch 33)                                  |
| references-python-attrs | ptah_lsp_references       | recall_all     |     na |                       0.9471 | fail    | not exposed                                                          |
| dependents-python-attrs | ptah_get_dependents       | recall_all     | 0.6875 | 0 (TS pattern, not deciding) | pass    | —                                                                    |
| references-go-logrus    | ptah_lsp_references       | recall_all     |     na |                       0.8548 | fail    | not exposed                                                          |
| dependents-go-logrus    | ptah_get_dependents       | recall_all     | 0.3679 | 0 (TS pattern, not deciding) | pass    | —                                                                    |

Breakdown views, all `na`:

- references: `scip-strict` and `same-name`;
- relevance by source: PR 0.25 vs 0.25 (1 question in the smoke sample), commit 0.2115 vs 0.2244.

Lifecycle: 16 rows, 5 pass, 11 fail.

| Result                  | Scenarios                                                                                                                                                                                                                                                                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pass                    | `embedder-warmup` (87 ms; host boot 19.8 s), `two-workspaces-memory-leak` (0 leaks), `transport-idle-gaps` (40 calls, ECONNRESET 0), `large-file-1.5mib` (reported as too large), `transport-restart` (the in-flight call got ECONNRESET during stop; the fresh host answered)                                                                     |
| Fail, as expected today | `worktree-memory-scope` (0 of 15), `worktree-spool-path` (spooled under the corpus root, not the worktree), `worktree-task-tools` (the task landed in the main checkout as TASK_2026_001_f3d0; the outside root was accepted), cold-start, edit-then-query 5 s and 60 s, add-then-query, delete-then-query (precondition), `large-file-3900-lines` |
| Fail, unexpected        | `two-workspaces-symbol-scope` (unknown coverage from workspace B), `index-age-24h` (see the caveat below)                                                                                                                                                                                                                                          |

Caveat: `index-age-24h` backdated 13,575 rows while the cold-start reindex of the copy was still writing. The first answer therefore showed `indexAgeMs 151`, and the probe symbol was missing after the refresh. That verdict mixes two effects: the scenario's lazy-refresh check and the ongoing cap and coverage loss. A cleaner measure would wait for `reindexInFlight: false` before backdating. That is a bench change; I have not made it, so the orchestrator can decide.

Every suite and lifecycle verdict above is a recorded Phase 1 finding, not a run failure. The gate decision belongs to Batch 10.

### Follow-up: index-age-24h waits for a settled index (orchestrator request)

- `indexAgeScenario` in `lifecycle-scenarios.ts` now polls `ptah_code_search_symbols` every 5 s until `reindexInFlight: false` **before** it backdates any rows. The wait is bounded by the refresh limit: 120 s under `--smoke`, 300 s otherwise.
- The wait time is recorded in the detail (`index settled after N ms; …`).
- If the wait times out, the scenario fails with "the index never settled: reindexInFlight still true after N s, so rows were not backdated (a fresh index would be measured instead)" plus the states it saw. It never backdates a reindex that is still running.
- Spec (`lifecycle-scenarios.spec.ts`, 7 cases):
  - the empty-index case now asserts the "never settled" reason and that `backdateCodeSymbols` was not called;
  - the live-index case asserts the "index settled after" detail.
- No smoke was run; Batch 11 records the first scorecard.
- Verification:
  - `npx nx run-many -t typecheck,lint,test -p mcp-bench --skip-nx-cache` with `RG_PATH`: passed in 1m 29s. 18 test suites, 252 tests, 0 lint errors, the same 2 pre-existing warnings.
  - `npx prettier --check` is clean on the changed files.
