# Batches - TASK_2026_619_af7f

Total tasks: 64 | Batches: 37 | Complete: 1/37

Worktree root (every path below is absolute under it):
`D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark` (branch `fix/task-619-tool-benchmark`).

Flow: BUGFIX, plan-free. Sources: `task.md`, `context.md` (the `## User Decisions — Gate SR …` section
overrides `research-report.md` where they differ), `research-report.md`.

## Recorded defaults (execution preferences from the orchestrator prompt)

- Ordering: Phase 1 (benchmark, no product-behaviour change) first, then Phase 2 in the order of
  research-report.md section D as amended by the Gate SR decisions. The last Phase 2 batch makes the
  eager/deferred selection scorecard-driven (B10).
- Review phases. Phase 2 is split into review phases 2A-2F, so each code-logic review covers one
  coherent diff instead of about 25 batches:
  - Phase 1, Benchmark: Batches 1-11.
  - Phase 2A, Index and coverage: Batches 12-16.
  - Phase 2B, Ranker: Batch 17.
  - Phase 2C, Language-server manager, references, definitions and dependents: Batches 18-28.
  - Phase 2D, Text search: Batches 29-33.
  - Phase 2E, Scope and transport: Batches 34-35.
  - Phase 2F, Rescore and eager selection: Batches 36-37.
- Executors are recommended per batch. "CLI lane" means the orchestrator picks a lane from
  `ptah_agent_list` at spawn time. No vendor is named here.
- Security-, persistence- and process-lifecycle-sensitive batches go to subagents. That covers index
  writes, migrations, child-process language servers, DI registration across hosts and the isolated
  bench host.
- Cap per batch: 6 files or fewer (spec files count), 2 libs or fewer, and one scoped verification
  command.
- Every Phase 2 batch names the scorecard metric it must move. Its verification also runs
  `npx nx run mcp-bench:bench --host cli --suite <suite> --smoke`. The batch report quotes the
  before/after values against the committed baseline at
  `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\baseline\scorecard.json`.
- The prompt claims (`ptah-core-prompt.ts`, `tool-description.builder.ts`, the substitution table)
  are not weakened anywhere. If a claim still cannot be met after its fix batch, the batch reports
  this and the team-leader escalates. The claim is never edited.

## Plan validation

Status: PASSED WITH RISKS

Assumptions:

- The depConstraints have no `type:tool` source tag, so `tools/mcp-bench` (tags `["type:tool"]`, no
  scope tag) may import libs. Verified against
  `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\eslint.config.mjs:256-394`.
  No lib may import `mcp-bench`. Task 1.1 confirms this with `nx lint`.
- The CLI DI container registers `vscode-lm-tools`, which includes `CODE_EXECUTION_MCP`. Verified at
  `libs\backend\cli-engine\src\lib\container.ts:119,825`. A bench-owned process can therefore call
  `startCodeExecutionMcp` (`libs\backend\vscode-core\src\services\subsystem-bringup.ts:67`) and serve
  the real HTTP MCP and protocol-dispatcher over CLI adapters. Unverified at runtime; Task 3.3 checks
  it.
- Most state paths derive from `os.homedir()`. Examples: `platform-cli\src\registration.ts:45`,
  `cli-engine\src\lib\container.ts:390`, `platform-core\src\file-settings-manager.ts:89`. Overriding
  `HOME` and `USERPROFILE` in the bench-host child env therefore isolates `~/.ptah`. This is
  unverified for every path (some code may cache `homedir()` or use other env vars). Task 3.3 checks
  it with an mtime and hash guard on the user's real DB.
- The workspace-watch host pattern is the model for the language-server host process: a supervisor
  in platform-core, forker adapters per platform, and per-app esbuild targets. The pieces are
  `platform-core\src\workspace-watch\workspace-watch-supervisor.ts:71-212`,
  `platform-electron\src\workspace-watch\*`, `platform-cli\src\workspace-watch\*`, and
  `apps\ptah-cli\project.json:190-196`. Verified on disk.
- The platform ports are registered in `libs\backend\platform-{cli,electron,vscode}\src\registration.ts`,
  not in the apps. Verified for platform-cli (`registration.ts:62-105`). The contract-suite pattern is
  `libs\backend\platform-core\src\testing\contracts\run-*-contract.ts` plus `*.self.spec.ts`.
  Verified.
- The CLI does not run `bootThothRuntime`. It has its own boot at
  `libs\backend\cli-engine\src\lib\bootstrap\thoth-runtime.ts`, which reuses pieces of
  `@ptah-extension/thoth-runtime`. Electron calls `bootThothRuntime` from
  `apps\ptah-electron\src\activation\boot-heavy-services.ts:164`. A shared warm-up service must be
  invoked from both. Verified by grep.
- `typescript` is 6.0.3 at the root, `@modelcontextprotocol/sdk` is ^1.29.0, `gpt-tokenizer` is
  ^4.0.0, and `fast-glob` and `better-sqlite3` are present. The following are NOT present:
  `vscode-jsonrpc`, `vscode-languageserver-protocol`, `typescript-language-server` and
  `@vscode/ripgrep`. Verified in root `package.json`. Batches 18 and 29 add them; each addition
  records its license (MIT expected) in the batch report.
- The "coverage" wording inside the `ptah_code_search_symbols` tool description documents the output
  format; it is not a prompt claim. Batch 16 may align that wording with the one-line clean form
  without changing any claim sentence. Unverified; Task 16.1 checks it, and the mandate-manifest spec
  must stay green.
- `ptah_search_text` gets a tool definition and description (its claim lives in the description). It
  gets NO new prompt substitution-table row, because the user ruled the prompt contract unchanged.
  Whether it is eager is decided by B10 (Batch 37). This is recorded for the user in the Mode 3
  summary.
- Worktree memory scope is a read-side mapping: the search covers the worktree root plus the main
  repository root resolved via `git rev-parse --git-common-dir`. Stored `workspace_root` values are
  never rewritten (no write-path change). Task 34.2 checks this.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| The research's transport assumption (B5) is false. `ptah mcp-serve` serves only the 10 agent MVP tools (`libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-stdio\tool-builders.ts:58-69`), and the CLI never starts the code-execution HTTP MCP (`startCodeExecutionMcp` is called only at `apps\ptah-electron\src\activation\wire-runtime.ts:409` and in VS Code `post-init.ts:38`). | HIGH | The bench "cli" host is a bench-owned child process. It boots the CLI DI container and calls `startCodeExecutionMcp`, so the calls exercise the real HTTP transport, the protocol-dispatcher and the CLI adapters with no product change (Tasks 3.2-3.3). The scorecard labels this host `cli-headless`. The Electron host is measured over its real HTTP MCP (Batch 4). The Mode 3 summary reports this finding to the user: CLI agents have no code-intelligence MCP surface today. |
| The benchmark writes to the user's real `~/.ptah` DB: memory seeding or index runs could corrupt the live state. | HIGH | The bench host runs with `HOME`/`USERPROFILE` pointed at a temp dir and an explicit `userDataPath`. A guard hashes and stats the real `~/.ptah/state/ptah.sqlite` before and after every run and fails on change (Task 3.3). Electron attach mode skips the memory and lifecycle suites (Task 4.1). |
| The language server uses about 1.7 GB RSS for TS on this repo (research A3) and can starve the Electron main process. | HIGH | The language servers run under a separate host process with a memory ceiling (`execArgv --max-old-space-size`, the tsserver memory option, and `GOMEMLIMIT` for gopls), plus an RSS sampler that restarts above the ceiling (Tasks 19.1, 20.1). Batch 21's contract suite pins the restart behaviour. |
| Grandchild language servers (pyright, gopls, tsserver) escape the host's own heap ceiling. | MEDIUM | Each recipe sets a server-specific limit, and the supervisor samples the RSS of the whole host process tree (Task 20.1). |
| Raising the 2,000-file cap raises first-run index time and DB size (about 40k rows expected). | MEDIUM | Measured in Batch 11 (first scorecard). The boot run is governed and debounced (Batch 13). Batch 12 reports index time and DB size. |
| Phase 2 tuning overfits the relevance benchmark. | MEDIUM | Batch 6 freezes a held-out PR split. Batch 17 may tune only on the tuning split; the held-out split is scored once per batch. |
| Persisted migrations (run summary, dependency graph) collide with migration numbering on main. | MEDIUM | Each migration batch takes the next free number at execution time and runs the persistence-sqlite migration specs (Batches 15 and 27). The Mode 3 write-path trace covers both. |
| Moving VS Code's inline index and save-reindex logic into a shared service drops behaviour. | MEDIUM | Task 14.1 carries a preserve list: activation run, save-reindex debounce (`wire-runtime.ts:216-246`) and non-fatal error logging. A spec pins each item. |
| The ECONNRESET cause is not reproduced. | LOW | Batch 35 is conditional on the Phase 1 transport scenario (Task 9.2, scenario 8). If no resets are recorded, the batch closes with evidence and no code. |
| The Electron host is unavailable in CI (headless launch). | MEDIUM | Batch 4 supports launch and attach modes. CI runs `cli-headless` on PRs, and Electron runs nightly in the electron-e2e environment or locally. A missing host shows in the scorecard as `na` with a reason, never as a pass. |
| The prompt mandates `ptah_relevance_rank_files` and others while they fail. | LOW | Phase 1 records the failure. Batch 37's manifest check fails when an eager tool fails its suite or a failing tool is MANDATORY, which surfaces it to the user instead of editing the claim. |
| `rg` is not first-party in Phase 1 (only a transitive `@cursor/sdk` copy). | LOW | The bench resolves `rg` from `RG_PATH` or `PATH`, and CI installs ripgrep via apt (Task 8.1). No package.json change happens in Phase 1. |

Edge cases:

- A tool answers `building`, `unavailable` or `unknown` coverage. The bench counts the call, retries
  up to the claim's budget, and scores the result as an error, not a pass. Handled in Task 3.1.
- A result is truncated by the 8,000-char budget or spooled to a file. The bench counts it as
  truncated, and the spool path is checked against the workspace root. Handled in Tasks 3.1 and 9.2.
- An identifier has more than 50 references, or a same-name symbol. These are stratified in the
  ground truth. Handled in Task 5.2.
- A question has no answer (negatives, memory abstention). Hit is defined as an empty or abstaining
  result. Handled in Tasks 5.1 and 6.2.
- A file is deleted while it still has index rows. Handled in Tasks 9.2 (scenario) and 12.1 (purge).
- A file exceeds 1 MiB. Handled in Tasks 9.2 (scenario) and 12.1 (honest `failed:too-large`).
- A toolchain is absent (no `pyright-langserver` or `gopls` on PATH). The answer is labelled
  approximate with a reason. Handled in Tasks 19.2 and 24.1.
- The language-server host crashes or exceeds the ceiling mid-query. The query fails honestly, the
  host is restarted under the restart budget, and the answer falls back to the text scan labelled
  approximate. Handled in Tasks 20.1 and 24.1.
- Two workspaces plus a worktree. Covers memory leak count, spool path and symbol scope. Handled in
  Tasks 6.2, 9.2 and 34.x.
- A branch switch fires a reindex storm. Debounced. Handled in Task 13.1.
- The `rg` binary is missing at runtime. The Node-scan fallback is reported in the answer. Handled in
  Task 30.1.
- Windows paths and case. Every path comparison in metrics normalises separators and drive-letter
  case. Handled in Task 1.2.

---

## Batch 1: mcp-bench scaffold and retrieval metrics — COMPLETE (commit 122a9dd7b)

Batch 1 Minor findings (recorded, not fixed in a fix round; each is carried by a named later task):

- `tools\mcp-bench\src\metrics\retrieval-metrics.ts:25,42` declares `callsPerAnswer` in `MetricName`
  and `LOWER_IS_BETTER`, but no function computes it. Carried by Task 2.1 (the scorecard must compute
  it from the recorder's call counts, or drop it from `MetricName`) and Task 8.1 (native commands
  per answer).
- `normalizePath` (`retrieval-metrics.ts:50-67`) lower-cases only the drive letter, so on win32 a root
  whose case differs elsewhere (`D:/Projects` vs `d:/projects`) does not relativise. Carried by Task
  9.1: compare case-insensitively on win32 (or pass the tool's own root casing) and add a spec case.
- `percentile` in `cost-metrics.ts:28-33` returns 0 for an empty sample, which reads as a perfect
  latency. Carried by Task 2.1: a suite with no latency samples reports `na`, never 0.
- commitlint `scope-enum` (`.commitlintrc.json`) has no `mcp-bench` scope, so Batch 1 was committed
  without a scope. Carried by Task 10.2 (add `mcp-bench` to `scope-enum` with the CI workflow).

- Recommended executor: CLI lane x 1
- Fallback executor: backend-developer subagent
- Execution mode: sequential
- Rationale: new isolated tool project with pure functions and no product code; one self-contained prompt.
- Tasks: 2 | Depends on: none
- Phase: 1 Benchmark | Phase review: code-logic (after Batch 11)

### Task 1.1: Create the `mcp-bench` Nx project — COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\project.json; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\tsconfig.json; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\jest.config.ts
- Plan reference: research-report.md:134-138 (B1); context.md:87-95
- Pattern to follow: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\di-lint\project.json:1-30. Use the jest, typecheck and lint target shapes from D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-core\project.json.
- Quality requirements: name `mcp-bench`, `projectType: application`, tags `["type:tool"]`, targets `typecheck`, `lint`, `test`; not shipped and not imported by any lib.
- Validation notes: confirm `nx lint mcp-bench` passes under the depConstraints. If the boundary rule blocks lib imports, report it (do not edit `eslint.config.mjs` in this batch).
- Implementation details: the tsconfig extends `tsconfig.base.json` with `module`/`moduleResolution` matching the backend libs; the jest config uses `jest.preset.js`.

### Task 1.2: Retrieval and cost metrics — COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\metrics\retrieval-metrics.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\metrics\retrieval-metrics.spec.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\metrics\cost-metrics.ts
- Depends on: Task 1.1
- Plan reference: research-report.md:181-183 (B6), :300 (LocAgent Acc@k, NDCG@k)
- Pattern to follow: pure functions; the `gpt-tokenizer` usage in D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\workspace-intelligence\src\testing\mcp-contract\mcp-contract.bench.spec.ts
- Quality requirements: hit@1, hit@5, MRR, recall@k, recall@all, precision, Acc@k (strict), NDCG@k; tokens via `gpt-tokenizer`; p50/p95; error and truncation rates. Unit tests with hand-computed expectations, including empty sets and abstention.
- Validation notes: path normalisation (separators, drive-letter case, workspace-relative) lives here and is used by every suite.
- Implementation details: an `Answer = {ranked: string[]; abstained: boolean}` vs `Truth = {items: string[]; abstain?: boolean}` model; a lower-is-better sign convention is exported for the scorecard.

### Batch 1 verification

- Every listed artifact exists and contains the required work
- `npx nx run-many -t typecheck,lint,test -p mcp-bench` passes (tail the output)
- No per-batch review; the Phase 1 review covers it
- The path-normalisation edge case is tested

## Batch 2: Scorecard model, writers and corpus checkout — IN_PROGRESS

- Recommended executor: CLI lane x 1
- Fallback executor: backend-developer subagent
- Execution mode: sequential
- Rationale: pure data model, writers and a git worktree helper in one tool project.
- Tasks: 2 | Depends on: 1
- Phase: 1 Benchmark | Phase review: code-logic (after Batch 11)

### Task 2.1: Scorecard types, JSON writer and Markdown writer — IMPLEMENTED

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\scorecard.types.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\scorecard-writers.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\scorecard-writers.spec.ts
- Plan reference: research-report.md:196-223 (B8 schema), :173 (delta sign)
- Pattern to follow: the B8 JSON shape verbatim (`schemaVersion: 1`, run, product, corpus, suites[], lifecycle[], eagerSelection)
- Quality requirements: `host` allows `cli-headless | electron | vscode`; each suite carries a `claim` (file:line in ptah-core-prompt.ts), `verdict: pass|fail|na` and `naReason`; Markdown has one table per tool, a lifecycle table and an eager/deferred table.
- Validation notes: `na` is never counted as pass. Validate the schema on read (zod, already a dependency). Carried from Batch 1: compute `callsPerAnswer` (declared at `retrieval-metrics.ts:25`) or remove it from `MetricName`; a suite with no latency samples reports `na`, not the 0 that `cost-metrics.ts:28-33` returns.
- Implementation details: the output goes to `tools/mcp-bench/out/<runId>/` (gitignored) and, for committed baselines, `tools/mcp-bench/baseline/`.

### Task 2.2: Pinned corpus checkout and lifecycle copy — IMPLEMENTED

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\corpus\corpus.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\corpus\corpus.spec.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\corpus.config.json
- Plan reference: research-report.md:140-143 (B2)
- Pattern to follow: none in repo. Use `git worktree add --detach <tmp> <commit>` and remove it in a `finally`.
- Quality requirements: the corpus commit is pinned in `corpus.config.json`; the pin is never the live working tree; lifecycle scenarios get a disposable copy; eligible-file count recorded.
- Validation notes: a stale temp worktree from a crashed run is pruned at start (`git worktree prune`). Never `git stash`.
- Implementation details: the pinned commit initially = `7910f34cf` (current base). The spec uses a tiny temp git repo.

### Batch 2 verification

- Every listed artifact exists and contains the required work
- `npx nx run-many -t typecheck,lint,test -p mcp-bench` passes (tail the output)
- The `na`-is-never-pass rule is tested

## Batch 3: MCP transport driver and isolated cli-headless bench host — PENDING

- Recommended executor: backend-developer subagent
- Fallback executor: senior-tester subagent
- Execution mode: sequential
- Rationale: child-process lifecycle and state isolation from the user's real `~/.ptah`. This is process- and persistence-sensitive.
- Tasks: 3 | Depends on: 2
- Phase: 1 Benchmark | Phase review: code-logic (after Batch 11)

### Task 3.1: MCP HTTP client and call recorder — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\mcp-client.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\call-recorder.ts
- Plan reference: research-report.md:175-179 (B5), :183 (error classes)
- Pattern to follow: the request shape served by D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-http\http-server.handler.ts (read it to match the protocol and the `/workspace/{root}` URL segment)
- Quality requirements: wall time measured at the client; classify transport error, `building`, `unavailable`, `unknown` coverage and truncation (budget cut or spool); count calls including retries; keep-alive connection reuse configurable, for scenario 8.
- Validation notes: retries on `building` follow the tool's own retry hint, capped; every retry counts as a call.
- Implementation details: use `@modelcontextprotocol/sdk` client if it matches the server protocol, else a minimal JSON-RPC over HTTP POST.

### Task 3.2: Bench host entry (boots the CLI DI container and the code-execution HTTP MCP) — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\bench-host.entry.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\project.json (add a `build-host` esbuild target)
- Depends on: Task 3.1
- Plan reference: this file's Risk table, row 1; research-report.md:177
- Pattern to follow: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\apps\ptah-cli\src\cli\commands\mcp-serve.ts:1-60 (withEngine full boot); D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\vscode-core\src\services\subsystem-bringup.ts:67 (`startCodeExecutionMcp`); the `apps\ptah-cli\project.json` build-esbuild target for externals (better-sqlite3 and wasm)
- Quality requirements: workspace root = corpus path; writes `{port}` as one JSON line to stdout once listening; clean shutdown on SIGTERM and stdin EOF; no product source edited.
- Validation notes: verify the assumption that `CODE_EXECUTION_MCP` resolves in the CLI container; if it does not, stop and report (BLOCKER for the transport). Watch for the better-sqlite3 ABI (cli-e2e rebuilds it for Node).
- Implementation details: imports `@ptah-extension/cli-engine` and `@ptah-extension/vscode-core` only; the host label in the scorecard is `cli-headless`.

### Task 3.3: Host launcher with state isolation guard — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\host-launcher.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\host-launcher.spec.ts
- Depends on: Task 3.2
- Plan reference: this file's Risk table, row 2
- Pattern to follow: the spawn and teardown in D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-core\src\workspace-watch\workspace-watch-supervisor.ts (fail-fast on exit, kill on timeout)
- Quality requirements: the child env sets `HOME` and `USERPROFILE` to a fresh temp dir, plus an explicit userDataPath; before and after each run, stat and hash the real `<os.homedir()>/.ptah/state/ptah.sqlite` (plus -wal) and fail the run on any change; kill the process tree on timeout.
- Validation notes: the spec proves the guard trips on a simulated write and that the child never sees the real home.
- Implementation details: returns `{baseUrl, stop()}`; a cold start is timed from spawn to first successful `tools/list`.

### Batch 3 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- Every listed artifact exists and contains the required work
- `npx nx run-many -t typecheck,lint,test -p mcp-bench` passes, and `npx nx run mcp-bench:build-host` builds
- Manual smoke: launch the host on the corpus, call `tools/list`, confirm `ptah_code_search_symbols` is listed and the real DB guard is unchanged

## Batch 4: Electron host launcher (launch and attach) — PENDING

- Recommended executor: backend-developer subagent
- Fallback executor: devops-engineer subagent
- Execution mode: sequential
- Rationale: drives a real Electron app process and its userData. Process-lifecycle-sensitive.
- Tasks: 1 | Depends on: 3
- Phase: 1 Benchmark | Phase review: code-logic (after Batch 11)

### Task 4.1: Electron launch/attach adapter — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\electron-host.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\electron-host.spec.ts
- Plan reference: research-report.md:177-179 (B5)
- Pattern to follow: how D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\apps\ptah-electron-e2e\src\support launches the app; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\apps\ptah-electron\src\activation\wire-runtime.ts:381-416 (MCP port bring-up)
- Quality requirements: launch mode starts a built Electron app with an isolated userData dir and discovers the MCP port; attach mode targets `PTAH_BENCH_ELECTRON_URL`; in attach mode the memory and lifecycle suites are marked `na` (reason: "attach mode never writes to a user DB").
- Validation notes: if the port cannot be discovered from outside the process, read it from the log line or the `.mcp.json` the app writes, and document which.
- Implementation details: returns the same `{baseUrl, stop()}` shape as Task 3.3; host label `electron`.

### Batch 4 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- Every listed artifact exists and contains the required work
- `npx nx run-many -t typecheck,lint,test -p mcp-bench` passes
- The attach-mode `na` rule is tested

## Batch 5: Ground truth A — TS compiler (symbols, references, definitions, dependents) — PENDING

- Recommended executor: CLI lane x 1
- Fallback executor: backend-developer subagent
- Execution mode: sequential
- Rationale: pure offline generators over the pinned corpus. One shared program loader means one lane, not parallel.
- Tasks: 2 | Depends on: 2
- Phase: 1 Benchmark | Phase review: code-logic (after Batch 11)

### Task 5.1: Program loader and symbol-search questions (exact, concept, negatives) — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\ground-truth\ts-program.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\ground-truth\symbol-questions.ts
- Plan reference: research-report.md:147-150, :160 (B3)
- Pattern to follow: `ts.createLanguageService` with `tsconfig.base.json` paths (research-report.md:32 scratch measurement)
- Quality requirements: 300 exact questions stratified (100 small files, 100 files over 1,000 lines, 100 from the largest lib) plus 50 negatives; 200 concept questions from the JSDoc first sentence with identifier tokens removed; seeded RNG; output frozen to `tools/mcp-bench/questions/<commit>/*.json`.
- Validation notes: exclude test files; index.ts and `*.module.ts` are kept in the truth set (the indexer's skip is a finding, not a truth exclusion).
- Implementation details: the program is loaded once per run; memory is reported in the generator log.

### Task 5.2: References, definitions and dependents questions — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\ground-truth\graph-questions.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\ground-truth\ground-truth.spec.ts
- Depends on: Task 5.1
- Plan reference: research-report.md:151-153 (B3)
- Pattern to follow: Task 5.1's loader
- Quality requirements: 150 reference identifiers (50 with fewer than 5 refs, 50 with 5-50, 50 with more than 50, of which 25 share a name with another symbol); 150 definition call sites; 100 dependents/dependencies files via `ts.resolveModuleName` (static, `export from`, literal dynamic `import()`).
- Validation notes: same-name strata are mandatory (the rename-safe claim). The spec runs on a tiny fixture program.
- Implementation details: truths are `file:line` sets, workspace-relative.

### Batch 5 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- Every listed artifact exists and contains the required work
- `npx nx run-many -t typecheck,lint,test -p mcp-bench` passes
- Question files are generated for the pinned commit (counts quoted in the report)

## Batch 6: Ground truth B — relevance PR split, memory seed set, file-tool questions — PENDING

- Recommended executor: CLI lane x 1
- Fallback executor: backend-developer subagent
- Execution mode: sequential
- Rationale: offline generators, file-disjoint from Batch 5.
- Tasks: 2 | Depends on: 2
- Phase: 1 Benchmark | Phase review: code-logic (after Batch 11)

### Task 6.1: Relevance questions with a frozen held-out split — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\ground-truth\relevance-questions.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\ground-truth\file-tool-questions.ts
- Plan reference: research-report.md:154, :156-158, :160 (held-out split)
- Pattern to follow: `gh pr list --state merged --json title,body,files,mergeCommit`
- Quality requirements: PRs before the pin, 1-8 changed non-test, non-lockfile source files; the most recent 200 are `test`, earlier ones are `tune`, frozen to JSON so CI needs no `gh`; file-tool questions: 100 ast/enrich files by size stratum, 100 glob patterns, 150 literal plus 50 regex text queries.
- Validation notes: CI must not call `gh`; the frozen JSON is committed.
- Implementation details: also adds the 4 TASK_2026_473 track-A memory queries as a labelled hand-graded seed in Task 6.2.

### Task 6.2: Seeded memory set (verbatim, paraphrase, temporal update, abstention, two workspaces plus worktree) — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\ground-truth\memory-questions.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\ground-truth\relevance-memory.spec.ts
- Depends on: Task 6.1
- Plan reference: research-report.md:155, :301 (LongMemEval taxonomy)
- Pattern to follow: the `memories` table shape in D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\persistence-sqlite\src\lib\migrations\0002_memory.ts and D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\memory-curator\src\lib\memory.store.ts
- Quality requirements: 150 facts, each with 1 verbatim and 2 paraphrase queries and 1 temporal-update pair, plus 20 abstention queries; roots A, B and a worktree of A with overlapping facts; truth includes the expected leak count 0.
- Validation notes: seeding happens only into the isolated DB of Task 3.3. Seeding through the product's memory store API (not raw SQL) is preferred so embeddings and FTS rows are real.
- Implementation details: exports `seedMemory(dbPath)` and the question set.

### Batch 6 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- Every listed artifact exists and contains the required work
- `npx nx run-many -t typecheck,lint,test -p mcp-bench` passes
- The held-out split file is committed and its size quoted

## Batch 7: Polyglot corpus and SCIP cross-check ground truth — PENDING

- Recommended executor: CLI lane x 1
- Fallback executor: backend-developer subagent
- Execution mode: sequential
- Rationale: offline, optional-tool generator; isolated files.
- Tasks: 1 | Depends on: 5
- Phase: 1 Benchmark | Phase review: code-logic (after Batch 11)

### Task 7.1: Pinned Python and Go corpora and SCIP cross-check — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\ground-truth\scip-cross-check.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\ground-truth\scip-cross-check.spec.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\corpus.config.json (add pinned small MIT-licensed Python and Go repos)
- Plan reference: context.md:58-61 (Gate SR decisions 1 and 4: SCIP as benchmark ground truth only); research-report.md:302
- Pattern to follow: Task 5.2's truth format
- Quality requirements: when `scip-typescript`, `scip-python` or `scip-go` are on PATH, generate reference, definition and dependents truth and compare the TS truth with Task 5.2 (agreement rate reported); when absent, the suite is `na` with a reason; Python and Go reference/dependents question sets (50 each) come from SCIP truth.
- Validation notes: SCIP is never a runtime backend. Record the license of each pinned corpus repo.
- Implementation details: the `@scip-code/scip` reader is ESM-only; use dynamic import or parse the protobuf in the generator.

### Batch 7 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- Every listed artifact exists and contains the required work
- `npx nx run-many -t typecheck,lint,test -p mcp-bench` passes
- The `na`-when-absent path is tested

## Batch 8: Native baselines — PENDING

- Recommended executor: CLI lane x 1
- Fallback executor: backend-developer subagent
- Execution mode: sequential
- Rationale: scripted `rg`/glob/read baselines; self-contained.
- Tasks: 1 | Depends on: 5, 6
- Phase: 1 Benchmark | Phase review: code-logic (after Batch 11)

### Task 8.1: rg/Glob/Read and `git log --grep` baselines per suite — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\baselines\rg-runner.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\baselines\native-baselines.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\baselines\native-baselines.spec.ts
- Plan reference: research-report.md:162-173 (B4)
- Pattern to follow: the B4 command list verbatim
- Quality requirements: same metrics and tokenizer as the tools; calls per answer = commands needed; references baseline has no cap and reports both recall and precision; `rg` resolved from `RG_PATH` then `PATH`, else the run fails with a clear message.
- Validation notes: no package.json change in Phase 1. The `rg --json` parse handles Windows paths.
- Implementation details: memory baseline = `rg` over `.ptah/specs` plus `git log --grep`.

### Batch 8 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- Every listed artifact exists and contains the required work
- `npx nx run-many -t typecheck,lint,test -p mcp-bench` passes

## Batch 9: Suite runners, lifecycle scenarios and the bench CLI — PENDING

- Recommended executor: backend-developer subagent
- Fallback executor: senior-tester subagent
- Execution mode: sequential
- Rationale: integrates the transport, ground truth and baselines; lifecycle scenarios mutate a corpus copy and restart hosts.
- Tasks: 3 | Depends on: 3, 4, 7, 8
- Phase: 1 Benchmark | Phase review: code-logic (after Batch 11)

### Task 9.1: Per-tool suite adapters and runner — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\suites\tool-suites.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\suites\suite-runner.ts
- Plan reference: research-report.md:147-158, :181-183; prompt claims at research-report.md:46-55
- Pattern to follow: each tool's input schema in D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\tool-description.builder.ts
- Quality requirements: suites for `ptah_code_search_symbols` (exact and concept), `ptah_relevance_rank_files`, `ptah_lsp_references`, `ptah_lsp_definitions`, `ptah_get_dependents`, `ptah_get_dependencies`, `ptah_get_symbol_index`, `ptah_memory_search`, `ptah_ast_analyze`, `ptah_context_enrich_file` (token ratio per size stratum), `ptah_search_files`, and `ptah_search_text` (`na` until the tool exists); each suite records its `claim` file:line; verdict = fail when the primary quality metric is below native by more than the noise margin, error rate is over 1%, or a lifecycle scenario fails.
- Validation notes: tool results are parsed tolerantly (text content). Parse failures count as errors, not as zero hits. Carried from Batch 1: on win32, workspace-root relativisation in `normalizePath` (`retrieval-metrics.ts:50-67`) must be case-insensitive beyond the drive letter; add a spec case.
- Implementation details: `--smoke` takes 40 seeded questions per suite.

### Task 9.2: Lifecycle scenarios 1-8 — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\lifecycle\lifecycle-scenarios.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\lifecycle\lifecycle-scenarios.spec.ts
- Depends on: Task 9.1
- Plan reference: research-report.md:185-194 (B7); context.md:93
- Pattern to follow: Task 2.2's corpus copy
- Quality requirements: cold start, edit then query (5 s and 60 s), add then query, delete then query, large file (3,900 lines and 1.5 MiB), index age beyond 24 h (backdated rows in the isolated DB), two workspaces plus a worktree (memory leak count, spool path under the caller's root, symbol scope), transport (200 calls with 4-8 s idle gaps, one server restart, ECONNRESET count).
- Validation notes: never mutate the pinned corpus. Scenario 8's reset count feeds Batch 35's go/no-go.
- Implementation details: each scenario is a scored case in `lifecycle[]`.

### Task 9.3: Bench CLI entry and targets — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\main.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\project.json (targets `bench`, `generate`)
- Depends on: Task 9.2
- Plan reference: research-report.md:196-223
- Pattern to follow: the `nx:run-commands` targets in D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\di-lint\project.json
- Quality requirements: flags `--host cli-headless|electron`, `--suite`, `--smoke`, `--out`, `--compare <baseline>`; writes the JSON and Markdown scorecards.
- Validation notes: a non-zero exit only when the run itself breaks; gate decisions belong to Batch 10.
- Implementation details: the run records `product.commit` and `corpus.commit`.

### Batch 9 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- Every listed artifact exists and contains the required work
- `npx nx run-many -t typecheck,lint,test -p mcp-bench` passes
- `npx nx run mcp-bench:bench --host cli-headless --smoke` completes and writes the scorecard (tail it)

## Batch 10: Recorded-failure gate and CI workflow — PENDING

- Recommended executor: devops-engineer subagent
- Fallback executor: backend-developer subagent
- Execution mode: sequential
- Rationale: a new GitHub workflow plus a gate script.
- Tasks: 2 | Depends on: 9
- Phase: 1 Benchmark | Phase review: code-logic (after Batch 11)

### Task 10.1: Gate script (recorded-failure mode and claim mode) — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\gate\gate.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\gate\gate.spec.ts
- Plan reference: research-report.md:225-229 (B9)
- Pattern to follow: Task 2.1's schema reader
- Quality requirements: recorded-failure mode passes only when the current scorecard equals the committed baseline within noise (2 standard deviations from three baseline runs; the margins are stored in the baseline); claim mode fails any suite below native or over 1% errors or failing a lifecycle scenario; the per-suite mode is set in the baseline so Phase 2 can tighten suite by suite.
- Validation notes: an improvement beyond noise in recorded-failure mode is reported as "baseline out of date", not a failure.
- Implementation details: target `gate` in project.json.

### Task 10.2: `.github/workflows/mcp-bench.yml` — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\.github\workflows\mcp-bench.yml
- Depends on: Task 10.1
- Plan reference: research-report.md:225-229
- Pattern to follow: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\.github\workflows\cli-e2e.yml (Node 24, npm ci, better-sqlite3 rebuild for the Node ABI, `NX_TUI: 'false'`)
- Quality requirements: PRs run the smoke subset on `cli-headless`, ubuntu-latest, under 10 minutes; nightly and release run the full set (Windows and Linux; Electron where available) under 45 minutes; apt install ripgrep; optional pyright/gopls/SCIP in nightly; upload the scorecard as an artifact; `ci.yml` untouched.
- Validation notes: cache the isolated SQLite DB and the graph keyed by corpus commit if indexing exceeds the budget; measure first. Carried from Batch 1: add `mcp-bench` to `scope-enum` in `.commitlintrc.json` (file count for this batch rises by one; still under the cap).
- Implementation details: `permissions: contents: read`; concurrency group per ref.

### Batch 10 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- Every listed artifact exists and contains the required work
- `npx nx run-many -t typecheck,lint,test -p mcp-bench` passes; `actionlint` (if available) or a YAML parse of the workflow passes

## Batch 11: First recorded scorecard and mandate-manifest link — PENDING

- Recommended executor: senior-tester subagent
- Fallback executor: backend-developer subagent
- Execution mode: sequential
- Rationale: runs the benchmark end to end and records evidence; touches one product spec.
- Tasks: 2 | Depends on: 10
- Phase: 1 Benchmark | Phase review: code-logic (this is the last batch of Phase 1; review the combined diff of Batches 1-11)

### Task 11.1: Record the baseline scorecards (cli-headless and electron) — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\baseline\scorecard.json; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\baseline\scorecard.md
- Plan reference: research-report.md:256 (expected failures); context.md:21 ("must fail on today's code")
- Pattern to follow: Task 9.3 output
- Quality requirements: three full runs per host to set the noise margins; the committed baseline holds verdicts per suite; the report quotes index time, DB size and eligible-file count (research unknowns at research-report.md:329-335), and the scenario 8 reset count.
- Validation notes: the scorecard must show failures where context.md's evidence table shows losses (symbol search, relevance, references precision, dependents `building`, edit then query, spool path). If any of these passes, report it explicitly: either the benchmark is wrong or the evidence was. Carried from Batch 2 (Minor): `countEligibleFiles` (`tools\mcp-bench\src\corpus\corpus.ts:98-115`) counts every `.ts/.tsx/.js/.jsx` file except under `.git` and `node_modules`. It applies no gitignore rules and none of the indexer's skip rules, so its number is not the product's "eligible files" (the research measured 3,860 under the indexer's rules). Before quoting the eligible-file count and the `omittedByCap` reference that Batch 12 must bring to 0, make the count use the indexer's rules: reuse its discovery predicate, or label the raw number as a raw source count and quote the indexer census next to it. Adding `corpus.ts` and its spec raises this batch's file count to 5, still under the cap.
- Implementation details: Electron is recorded in launch mode if available, else `na` with a reason.

### Task 11.2: Link each MANDATORY claim to a scorecard suite — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\mcp-mandate-manifest.spec.ts
- Depends on: Task 11.1
- Plan reference: research-report.md:236, :258
- Pattern to follow: the existing `MANDATE_MAP` at mcp-mandate-manifest.spec.ts:792-830
- Quality requirements: a `CLAIM_SUITE` map; the spec fails when a mandated tool has no suite in the committed baseline (read via `fs`, never imported from `tools/`).
- Validation notes: the lib must not import `mcp-bench` (boundary).
- Implementation details: none beyond the map and one `it`.

### Batch 11 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- Both baseline files exist; their verdicts match the Task 11.1 expectations or deviations are explained
- `npx nx run-many -t typecheck,lint,test -p mcp-bench,@ptah-extension/vscode-lm-tools` passes
- `npx nx run mcp-bench:gate` passes in recorded-failure mode against the new baseline

---

## Batch 12: Index completeness — cap, order, purge, transactional write (Fix 1) — PENDING

- Recommended executor: backend-developer subagent
- Fallback executor: senior-tester subagent (tests), then a backend-developer retry
- Execution mode: sequential
- Rationale: SQLite index writes and deletes. Persistence-sensitive.
- Scorecard metric it must move: `ptah_code_search_symbols` hit@5 and recall@10 (exact and concept); lifecycle delete-then-query; the `omittedByCap` count reaches 0 on the corpus
- Tasks: 2 | Depends on: 11
- Phase: 2A Index and coverage | Phase review: code-logic (after Batch 16)

### Task 12.1: Remove the 2,000-file cap and sort discovery in the indexer — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\workspace-intelligence\src\services\code-symbol-indexer.service.ts; its existing spec next to it (extend)
- Plan reference: research-report.md:57-73 (A1, fix design items 1, 3, 5), :264
- Pattern to follow: code-symbol-indexer.service.ts:103, :749, :769-772, :1051, :1182-1196
- Quality requirements: index every eligible file, or raise to a measured bound reported truthfully as `omittedByCap`; deterministic order (source roots first, `.ptah/` and `.github/skills` last); purge rows for paths absent from disk at the end of a complete run; per-file delete and insert in one transaction, so a failed insert keeps the old rows; files over 1 MiB stay `failed:too-large`.
- Validation notes: purge only after a complete (not truncated, not cancelled) run, or a partial run would erase valid rows. Two runs over the same tree must select the same files.
- Implementation details: reuse the governor yields already in the run loop.

### Task 12.2: Store-side purge and transactional replace — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\memory-curator\src\lib\code-symbol.store.ts; its spec (extend or create `code-symbol.store.spec.ts`)
- Depends on: Task 12.1
- Plan reference: research-report.md:63-64
- Pattern to follow: existing transaction usage in D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\memory-curator\src\lib\memory.store.ts
- Quality requirements: `replaceFileSymbols(root, file, rows)` is atomic; `purgeMissing(root, presentPaths)` runs in batches; both are scoped by `workspace_root`.
- Validation notes: the purge never crosses workspace roots. The write-path trace for Mode 3 is recorded in the batch report.
- Implementation details: FTS and vector rows are deleted with their symbol rows.

### Batch 12 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- `npx nx run-many -t typecheck,lint,test -p @ptah-extension/workspace-intelligence,@ptah-extension/memory-curator` passes
- The symbol suite smoke run shows hit@5 up from baseline; the report quotes index time and DB size

## Batch 13: Shared boot-time index and watcher reindex for Electron and CLI (Fix 2a) — PENDING

- Recommended executor: backend-developer subagent
- Fallback executor: none (re-run with the same subagent type)
- Execution mode: sequential
- Rationale: host boot sequencing and watcher subscriptions across Electron and CLI. Lifecycle-sensitive.
- Scorecard metric it must move: lifecycle cold-start (time to first correct symbol answer), edit-then-query and add-then-query pass on `cli-headless` and `electron`
- Tasks: 2 | Depends on: 12
- Phase: 2A Index and coverage | Phase review: code-logic (after Batch 16)

### Task 13.1: `WorkspaceIndexLifecycleService` in thoth-runtime — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\thoth-runtime\src\lib\workspace-index-lifecycle.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\thoth-runtime\src\lib\workspace-index-lifecycle.spec.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\thoth-runtime\src\lib\boot-thoth-runtime.ts (call it)
- Plan reference: research-report.md:65, :70, :265
- Pattern to follow: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\apps\ptah-extension-vscode\src\activation\wire-runtime.ts:199-251 (activation run, debounced save reindex)
- Quality requirements: a governed background full run at boot; per-file `reindexFile` on `IWorkspaceWatcher` events with debounce and storm coalescing (a branch switch triggers one full run, not N reindexes); delete events remove rows; idempotent `dispose()`.
- Validation notes: boot must not wait on the run; failures are non-fatal and logged once. Respect the governor.
- Implementation details: depends only on the indexer and the `IWorkspaceWatcher` port (platform-core).

### Task 13.2: Invoke the lifecycle service from the CLI boot — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\cli-engine\src\lib\bootstrap\thoth-runtime.ts
- Depends on: Task 13.1
- Plan reference: this file's Assumptions (the CLI does not run `bootThothRuntime`)
- Pattern to follow: how the file already wires `@ptah-extension/thoth-runtime` jobs
- Quality requirements: started in `full` mode only (not for one-shot commands that exit immediately); disposed on shutdown.
- Validation notes: the `ptah mcp-serve` / interact startup latency must not regress (no await).
- Implementation details: exported through the thoth-runtime barrel (check the barrel stays at 150 lines or fewer).

### Batch 13 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- `npx nx run-many -t typecheck,lint,test -p @ptah-extension/thoth-runtime,@ptah-extension/cli-engine` passes
- Lifecycle smoke: edit-then-query and add-then-query on `cli-headless` pass

## Batch 14: VS Code switches to the shared lifecycle service (Fix 2a, VS Code host) — PENDING

- Recommended executor: backend-developer subagent
- Fallback executor: none (re-run with the same subagent type)
- Execution mode: sequential
- Rationale: removes duplicated host logic; behaviour must be preserved.
- Scorecard metric it must move: none on CLI/Electron. VS Code parity is pinned by spec (the VS Code bench runs nightly in vscode-e2e).
- Tasks: 1 | Depends on: 13
- Phase: 2A Index and coverage | Phase review: code-logic (after Batch 16)

### Task 14.1: Replace the inline index logic in VS Code `wire-runtime.ts` — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\apps\ptah-extension-vscode\src\activation\wire-runtime.ts; its spec (extend or create)
- Plan reference: research-report.md:70, :318
- Pattern to follow: Task 13.1 API
- Quality requirements: preserve list (each item pinned by a spec): activation full run, save-triggered reindex with the existing debounce, non-fatal error logging, disposal on deactivate. The old inline code is deleted, not kept.
- Validation notes: VS Code save events vs `IWorkspaceWatcher` events: do not double-reindex.
- Implementation details: none beyond swapping the call site.

### Batch 14 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- `npx nx run-many -t typecheck,lint,test -p ptah-extension-vscode` passes
- The preserve list is quoted in the report, item by item, with its spec name

## Batch 15: Persisted index run summary (Fix 2b) — PENDING

- Recommended executor: backend-developer subagent
- Fallback executor: none (re-run with the same subagent type)
- Execution mode: sequential
- Rationale: a new SQLite migration and a writer. Persistence-sensitive.
- Scorecard metric it must move: `unknown`-coverage rate on a fresh session reaches 0 (the cold-start scenario)
- Tasks: 2 | Depends on: 13
- Phase: 2A Index and coverage | Phase review: code-logic (after Batch 16)

### Task 15.1: Migration for `code_index_runs` — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\persistence-sqlite\src\lib\migrations\<next-number>_code_index_runs.ts; the migrations registry file that lists migrations (extend)
- Plan reference: research-report.md:66, :72
- Pattern to follow: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\persistence-sqlite\src\lib\migrations\0046_memory_merge_subject_index.ts
- Quality requirements: columns are root, finishedAt, census, counts (indexed, failed, omittedByCap, skipped), state (`complete`/`incomplete`); the number is the next free one at execution time.
- Validation notes: the migration is additive only.
- Implementation details: none.

### Task 15.2: Indexer writes the summary and `getCoverage` reads it — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\workspace-intelligence\src\services\code-symbol-indexer.service.ts; its spec
- Depends on: Task 15.1
- Plan reference: research-report.md:66, :72 (code-symbol-indexer.service.ts:384, :505-509)
- Pattern to follow: existing run-record shape in the same file
- Quality requirements: a new process reports `current` or `incomplete` from the persisted summary instead of `unknown`; staleness compares file mtimes against `finishedAt` cheaply (no full walk per call).
- Validation notes: write-path trace: key `code_index_runs.root`, read by `getCoverage`, written at the run end only.
- Implementation details: none.

### Batch 15 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- `npx nx run-many -t typecheck,lint,test -p @ptah-extension/persistence-sqlite,@ptah-extension/workspace-intelligence` passes
- Cold-start smoke: coverage is not `unknown`

## Batch 16: One-line coverage when clean (Fix 2c) — PENDING

- Recommended executor: CLI lane x 1
- Fallback executor: backend-developer subagent
- Execution mode: sequential
- Rationale: a formatting change in one lib with a clear spec.
- Scorecard metric it must move: `ptah_code_search_symbols` tokens_p50 (down by about 350 tokens per call when clean)
- Tasks: 1 | Depends on: 15
- Phase: 2A Index and coverage | Phase review: code-logic (this is the last batch of Phase 2A; review Batches 12-16)

### Task 16.1: Compact coverage rendering — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\code-namespace.builder.ts; its spec; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\tool-description.builder.ts (only if its coverage-format wording contradicts the new output; no claim sentence edited)
- Plan reference: context.md:60 (Gate SR decision 3); research-report.md:72
- Pattern to follow: the existing coverage object in code-namespace.builder.ts:239-326
- Quality requirements: a single `coverage: clean (N files, indexed <age>)` line when clean; the full block only when not clean.
- Validation notes: `mcp-mandate-manifest.spec.ts` and `protocol-dispatcher.surface.spec.ts` stay green.
- Implementation details: none.

### Batch 16 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- `npx nx run-many -t typecheck,lint,test -p @ptah-extension/vscode-lm-tools` passes
- Symbol-suite smoke shows tokens_p50 down

---

## Batch 17: Relevance ranker — BM25 over symbols and content, classifier fix (Fix 3) — PENDING

- Recommended executor: CLI lane x 1
- Fallback executor: backend-developer subagent
- Execution mode: sequential
- Rationale: an algorithmic change behind an unchanged output shape; no persistence or process work.
- Scorecard metric it must move: `ptah_relevance_rank_files` recall@10 and MRR on the held-out split (tuning only on the `tune` split)
- Tasks: 2 | Depends on: 16
- Phase: 2B Ranker | Phase review: code-logic (after this batch)

### Task 17.1: Classifier requires a code extension for `spec`/`specs` test dirs — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\workspace-intelligence\src\context-analysis\file-type-classifier.service.ts; its spec
- Plan reference: research-report.md:79, :81
- Pattern to follow: file-type-classifier.service.ts:208-215
- Quality requirements: `.ptah/specs/**/*.md` is not `FileType.Test`; real `*.spec.ts` stays Test.
- Validation notes: the classifier feeds indexer outputs; run all workspace-intelligence specs.
- Implementation details: none.

### Task 17.2: Scorer on BM25 (symbols plus content) with path and import-graph priors — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\workspace-intelligence\src\context-analysis\file-relevance-scorer.service.ts; its spec; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\analysis-namespace.builders.ts
- Depends on: Task 17.1
- Plan reference: research-report.md:75-81 (A2), :303 (Aider PageRank, test against BM25 alone first)
- Pattern to follow: file-relevance-scorer.service.ts:57-135, :403-417; analysis-namespace.builders.ts:323-342
- Quality requirements: output `{file, score 0-100, reasons}` unchanged; reasons name the matching symbol or line; BM25 over code_symbols FTS plus bounded content chunks of candidate files; a cached file list from `WorkspaceFileIndexService` (no re-walk per call); the graph prior is kept only if it beats BM25 alone on the tune split.
- Validation notes: no filename-only scoring path remains. Equal-score ties are resolved by path.
- Implementation details: pass the symbol index and cached files from the namespace builder.

### Batch 17 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- `npx nx run-many -t typecheck,lint,test -p @ptah-extension/workspace-intelligence,@ptah-extension/vscode-lm-tools` passes
- Relevance smoke on the held-out split: recall@10 and MRR quoted against the baseline and native

---

## Batch 18: Language-server host port, protocol and dependencies (Fix 4a) — PENDING

- Recommended executor: backend-developer subagent
- Fallback executor: none (re-run with the same subagent type)
- Execution mode: sequential
- Rationale: a new hexagonal port plus new runtime dependencies (shared lockfile).
- Scorecard metric it must move: none yet (an enabling batch); Batch 24 moves references and definitions
- Tasks: 2 | Depends on: 17
- Phase: 2C Language servers | Phase review: code-logic + style (new public port API), after Batch 28

### Task 18.1: Add dependencies — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\package.json; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\package-lock.json
- Plan reference: context.md:58 (Gate SR decision 1)
- Pattern to follow: existing dependency pins
- Quality requirements: `vscode-jsonrpc`, `vscode-languageserver-protocol`, `typescript-language-server` (runs on the bundled TypeScript 6.0.3); licenses recorded in the report; no Serena GPL code; pyright and gopls are NOT bundled (the user's toolchain).
- Validation notes: `npm ci` still resolves with npm 11 (Node 24). Electron `validate-deps` still passes.
- Implementation details: none.

### Task 18.2: `ILanguageServerHost` port and wire protocol — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-core\src\interfaces\language-server-host.interface.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-core\src\language-server\language-server-protocol.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-core\src\language-server\language-server-protocol.spec.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-core\src\index.ts (export)
- Depends on: Task 18.1
- Plan reference: context.md:58-59 (generic host-neutral manager, separate process, memory ceiling)
- Pattern to follow: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-core\src\interfaces\workspace-watcher.interface.ts and D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-core\src\workspace-watch\workspace-watch-protocol.ts
- Quality requirements: port operations `warm(root, languages)`, `references(file, pos)`, `definitions(file, pos)`, `documentSymbols(file)`, `status()` (per language: `ready | starting | unavailable(reason) | approximate(reason)`), `dispose()`; message validation on both sides; a `PLATFORM_TOKENS` entry using `Symbol.for`.
- Validation notes: the barrel stays at 150 lines or fewer.
- Implementation details: the host-forker interface mirrors `WorkspaceWatchHostForker`.

### Batch 18 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- `npx nx run-many -t typecheck,lint,test -p @ptah-extension/platform-core` passes

## Batch 19: Language-server host core and recipes TS/JS, Python, Go (Fix 4b) — PENDING

- Recommended executor: backend-developer subagent
- Fallback executor: none (re-run with the same subagent type)
- Execution mode: sequential
- Rationale: spawns real language servers as child processes. Process-lifecycle-sensitive.
- Scorecard metric it must move: none yet (an enabling batch)
- Tasks: 2 | Depends on: 18
- Phase: 2C Language servers | Phase review: code-logic + style, after Batch 28

### Task 19.1: Host core (runs inside the host process) — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-core\src\language-server\language-server-host-core.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-core\src\language-server\language-server-host-core.spec.ts
- Plan reference: context.md:58-59; research-report.md:89
- Pattern to follow: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-core\src\workspace-watch\workspace-watch-host-core.ts
- Quality requirements: a `vscode-jsonrpc` stdio connection per server; initialize, didOpen on demand, references and definition, shutdown/exit on dispose; one server per language present in the workspace; per-server memory limit (tsserver memory option, pyright `--max-old-space-size` via `NODE_OPTIONS`, `GOMEMLIMIT` for gopls); request timeouts.
- Validation notes: a server crash yields an `unavailable` status for that language, not a host crash. The spec uses a fake LSP server script.
- Implementation details: no vscode import; Node only.

### Task 19.2: Per-language recipes and toolchain detection — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-core\src\language-server\language-server-recipes.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-core\src\language-server\language-server-recipes.spec.ts
- Depends on: Task 19.1
- Plan reference: context.md:58 (recipes from the SolidLSP MIT part and multilspy; install hints from mason-registry; TS/JS, Python and Go only)
- Pattern to follow: none in repo; attribute borrowed recipe details in comments with the source license.
- Quality requirements: TS/JS uses the bundled `typescript-language-server`; Python uses `pyright-langserver --stdio` from PATH; Go uses `gopls` from PATH; detection reports absent toolchains as `approximate(reason: '<binary> not found')` with a mason-style install hint; language presence by file census.
- Validation notes: never auto-install a toolchain; never shell out through a shell (no injection via paths).
- Implementation details: a recipe registry keyed by language id, so the follow-up task adds Rust, C/C++ and others by recipe only.

### Batch 19 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- `npx nx run-many -t typecheck,lint,test -p @ptah-extension/platform-core` passes

## Batch 20: Supervisor with warm start, memory ceiling and restart budget (Fix 4c) — PENDING

- Recommended executor: backend-developer subagent
- Fallback executor: none (re-run with the same subagent type)
- Execution mode: sequential
- Rationale: process supervision. Lifecycle-sensitive.
- Scorecard metric it must move: none yet (an enabling batch)
- Tasks: 1 | Depends on: 19
- Phase: 2C Language servers | Phase review: code-logic + style, after Batch 28

### Task 20.1: `LanguageServerSupervisor` implements `ILanguageServerHost` — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-core\src\language-server\language-server-supervisor.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-core\src\language-server\language-server-supervisor.spec.ts
- Plan reference: context.md:59 (warm at session start, separate process, memory ceiling); research-report.md:277
- Pattern to follow: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-core\src\workspace-watch\workspace-watch-supervisor.ts (fork, failure budget, idle stop) and D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-electron\src\workspace-watch\workspace-watch-host-rss-sampler.js
- Quality requirements: `warm()` forks eagerly; the heap ceiling via execArgv; process-tree RSS sampling with a restart above the ceiling; a restart budget, after which the status is `unavailable(reason)`; in-flight queries fail fast on host exit; idempotent dispose.
- Validation notes: a query during warm-up returns `starting`. The caller falls back to the scan, labelled approximate (Task 24.1).
- Implementation details: none.

### Batch 20 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- `npx nx run-many -t typecheck,lint,test -p @ptah-extension/platform-core` passes

## Batch 21: Shared contract suite for `ILanguageServerHost` (Fix 4c) — PENDING

- Recommended executor: senior-tester subagent
- Fallback executor: backend-developer subagent
- Execution mode: sequential
- Rationale: test-only batch that pins port behaviour for all three adapters.
- Scorecard metric it must move: none (a contract)
- Tasks: 1 | Depends on: 20
- Phase: 2C Language servers | Phase review: code-logic + style, after Batch 28

### Task 21.1: `runLanguageServerHostContract` — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-core\src\testing\contracts\run-language-server-host-contract.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-core\src\testing\contracts\run-language-server-host-contract.self.spec.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-core\src\testing\contracts\index.ts
- Plan reference: hexagonal rule (a new port needs all three adapters and the shared contract suite)
- Pattern to follow: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-core\src\testing\contracts\run-workspace-watcher-contract.ts and its `.self.spec.ts`
- Quality requirements: covers warm and ready, references and definitions on a fixture, a missing toolchain giving approximate, a host crash with restart, the ceiling giving restart, the budget being exhausted giving unavailable, and idempotent dispose.
- Validation notes: the fixture uses the fake LSP server from Task 19.1, so the contract runs in CI without pyright or gopls.
- Implementation details: none.

### Batch 21 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- `npx nx run-many -t typecheck,lint,test -p @ptah-extension/platform-core` passes

## Batch 22: Electron and CLI adapters for the language-server host (Fix 4d) — PENDING

- Recommended executor: backend-developer subagent
- Fallback executor: none (re-run with the same subagent type)
- Execution mode: sequential
- Rationale: `utilityProcess` and `child_process.fork` forkers plus DI registration in two platform libs.
- Scorecard metric it must move: none yet (an enabling batch)
- Tasks: 2 | Depends on: 21
- Phase: 2C Language servers | Phase review: code-logic + style, after Batch 28

### Task 22.1: Electron forker, host entry and registration — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-electron\src\language-server\electron-language-server-host.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-electron\src\language-server\language-server-host.entry.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-electron\src\registration.ts
- Plan reference: context.md:59
- Pattern to follow: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-electron\src\workspace-watch\electron-workspace-watcher.ts and workspace-watch-host.entry.ts
- Quality requirements: `utilityProcess` with the heap ceiling; the contract suite runs against the adapter (spec added in Task 22.2's file budget or here when within the cap).
- Validation notes: the Electron main process never loads a language server in-process.
- Implementation details: registers `PLATFORM_TOKENS.LANGUAGE_SERVER_HOST`.

### Task 22.2: CLI forker, host entry, registration and contract spec — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-cli\src\language-server\cli-language-server-host.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-cli\src\language-server\language-server-host.entry.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-cli\src\registration.ts
- Depends on: Task 22.1
- Plan reference: context.md:59
- Pattern to follow: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-cli\src\workspace-watch\workspace-watch-host.entry.ts
- Quality requirements: `child_process.fork` with `--max-old-space-size`; contract specs for both adapters (one spec file per lib; keep the batch at 6 files or fewer by placing the Electron contract spec here only if within the cap, otherwise report the overflow before writing).
- Validation notes: the file cap is tight; the executor reports the final file list.
- Implementation details: registers the same token.

### Batch 22 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- `npx nx run-many -t typecheck,lint,test -p @ptah-extension/platform-electron,@ptah-extension/platform-cli` passes, including the contract suite against both adapters

## Batch 23: VS Code adapter and host-entry build targets (Fix 4e) — PENDING

- Recommended executor: devops-engineer subagent (build targets and packaging) with a backend-developer subagent for the adapter, run sequentially
- Fallback executor: backend-developer subagent for both
- Execution mode: sequential
- Rationale: the third adapter plus esbuild targets and Electron packaging for the host entries.
- Scorecard metric it must move: none yet (an enabling batch)
- Tasks: 2 | Depends on: 22
- Phase: 2C Language servers | Phase review: code-logic + style, after Batch 28

### Task 23.1: VS Code adapter, entry, registration and contract spec — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-vscode\src\implementations\vscode-language-server-host.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-vscode\src\implementations\vscode-language-server-host.spec.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-vscode\src\registration.ts
- Plan reference: hexagonal rule; context.md:58
- Pattern to follow: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-vscode\src\implementations\vscode-workspace-watcher.ts (if present) or the CLI adapter from Task 22.2
- Quality requirements: `child_process.fork` from the extension host; contract suite green. VS Code keeps answering `ptah_lsp_references` through VS Code's own language features; this adapter serves the Python/Go dependents and parity.
- Validation notes: no `vscode` import in platform-core.
- Implementation details: the host entry is reused from platform-cli (same Node runtime) if bundling allows; otherwise a thin entry.

### Task 23.2: Build targets and packaging for `language-server-host.mjs` — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\apps\ptah-electron\project.json; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\apps\ptah-cli\project.json; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\apps\ptah-extension-vscode\project.json
- Depends on: Task 23.1
- Plan reference: this file's Assumptions (workspace-watch host build pattern)
- Pattern to follow: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\apps\ptah-cli\project.json:190-196 (`build-workspace-watch-host`); D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\apps\ptah-electron\electron-builder.yml (asarUnpack, if `typescript-language-server` must be unpacked)
- Quality requirements: each app builds `language-server-host.mjs` and ships `typescript-language-server` resolvable at runtime; `build` depends on the new target.
- Validation notes: Electron `validate-deps` and `verify-packed-native` still pass.
- Implementation details: none.

### Batch 23 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- `npx nx run-many -t typecheck,lint,test -p @ptah-extension/platform-vscode` passes
- `npx nx run-many -t build-language-server-host -p ptah-electron,ptah-cli,ptah-extension-vscode` builds

## Batch 24: Language-server query service and Electron IDE capabilities (Fix 4f) — PENDING

- Recommended executor: backend-developer subagent
- Fallback executor: none (re-run with the same subagent type)
- Execution mode: sequential
- Rationale: switches the Electron references and definitions path; cross-file.
- Scorecard metric it must move: `ptah_lsp_references` precision and recall@all (TS/JS, plus Python/Go where a toolchain exists), `ptah_lsp_definitions` hit@1, references p95 latency on the warm path, on `electron`
- Tasks: 2 | Depends on: 23
- Phase: 2C Language servers | Phase review: code-logic + style, after Batch 28

### Task 24.1: `LanguageServerQueryService` in workspace-intelligence — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\workspace-intelligence\src\services\language-server-query.service.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\workspace-intelligence\src\services\language-server-query.service.spec.ts
- Plan reference: research-report.md:89-90 (A3), :94-95 (A4); context.md:58
- Pattern to follow: workspace-intelligence DI registration in its `register…Services`
- Quality requirements: maps file extension to language; `ready` gives an exact answer with `mechanism: 'language-server'`; `starting`, `unavailable` or `approximate` gives the existing scan, labelled `approximate` with the reason; no silent fallback.
- Validation notes: the result shape stays compatible with the existing references/definitions tool output.
- Implementation details: injects `PLATFORM_TOKENS.LANGUAGE_SERVER_HOST`.

### Task 24.2: `ElectronIDECapabilities` uses the query service for TS/JS/Python/Go — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\apps\ptah-electron\src\services\electron-ide-capabilities.ts; its spec
- Depends on: Task 24.1
- Plan reference: research-report.md:86, :90 (electron-ide-capabilities.ts:105-118, :836-886)
- Pattern to follow: the existing mechanism labels in the same file
- Quality requirements: the language server first for the four languages; the scan stays for other languages; the 500-match cap reported as truncation.
- Validation notes: same-name symbols must no longer be merged.
- Implementation details: none.

### Batch 24 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- `npx nx run-many -t typecheck,lint,test -p @ptah-extension/workspace-intelligence,ptah-electron` passes
- References/definitions smoke on `electron` (or `cli-headless` after Batch 25) quoted against the baseline

## Batch 25: CLI IDE capabilities (Fix 4g) — PENDING

- Recommended executor: backend-developer subagent
- Fallback executor: none (re-run with the same subagent type)
- Execution mode: sequential
- Rationale: new DI registration in the CLI host. Sensitive to host wiring.
- Scorecard metric it must move: `ptah_lsp_references` and `ptah_lsp_definitions` on `cli-headless` (from `mechanism: none` to exact)
- Tasks: 1 | Depends on: 24
- Phase: 2C Language servers | Phase review: code-logic + style, after Batch 28

### Task 25.1: `CliIDECapabilities` and registration — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\cli-engine\src\lib\adapters\cli-ide-capabilities.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\cli-engine\src\lib\adapters\cli-ide-capabilities.spec.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\cli-engine\src\lib\container.ts
- Plan reference: research-report.md:86, :94 (CLI `mechanism: none`); system-namespace.builders.ts:260-275
- Pattern to follow: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\apps\ptah-electron\src\di\phase-3-storage.ts:189 (`IDE_CAPABILITIES_TOKEN` registration)
- Quality requirements: implements only the reference, definition and document-symbol parts of `IIDECapabilities`; other members report unavailable honestly (no dirty-files fake).
- Validation notes: `ptah_get_dirty_files` must not become eager on the CLI because of this (check `markEagerTools`' IDE detection at protocol-dispatcher.ts:710).
- Implementation details: none.

### Batch 25 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- `npx nx run-many -t typecheck,lint,test -p @ptah-extension/cli-engine` passes
- References smoke on `cli-headless` quoted

## Batch 26: Warm the language servers at session start (Fix 4h) — PENDING

- Recommended executor: backend-developer subagent
- Fallback executor: none (re-run with the same subagent type)
- Execution mode: sequential
- Rationale: boot sequencing. Lifecycle-sensitive.
- Scorecard metric it must move: references and definitions p95 latency (the warm-path share), the cold-start scenario for references
- Tasks: 1 | Depends on: 25
- Phase: 2C Language servers | Phase review: code-logic + style, after Batch 28

### Task 26.1: Add the language-server warm-up to `WorkspaceIndexLifecycleService` — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\thoth-runtime\src\lib\workspace-index-lifecycle.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\thoth-runtime\src\lib\workspace-index-lifecycle.spec.ts
- Plan reference: context.md:59 (Gate SR decision 2)
- Pattern to follow: Task 13.1
- Quality requirements: `warm(root, presentLanguages)` after the boot index kicks off, without awaiting; re-warm on a workspace switch; dispose stops the host.
- Validation notes: on a low-memory machine the ceiling holds (the RSS sampler from Task 20.1). Report the measured RSS.
- Implementation details: Electron, CLI and VS Code all get it through the shared service (Batches 13 and 14).

### Batch 26 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- `npx nx run-many -t typecheck,lint,test -p @ptah-extension/thoth-runtime` passes
- The scorecard references p95 on `cli-headless` quoted

## Batch 27: Dependency graph — exact TS/JS resolution and persistence (Fix 5a) — PENDING

- Recommended executor: backend-developer subagent
- Fallback executor: none (re-run with the same subagent type)
- Execution mode: sequential
- Rationale: a new migration and graph store. Persistence-sensitive.
- Scorecard metric it must move: `ptah_get_dependents` and `ptah_get_dependencies` recall@all and precision (TS/JS); restart cold-start time
- Tasks: 2 | Depends on: 26
- Phase: 2C Language servers | Phase review: code-logic + style, after Batch 28

### Task 27.1: Migration and graph edge store — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\persistence-sqlite\src\lib\migrations\<next-number>_dependency_edges.ts; the migrations registry file (extend)
- Plan reference: research-report.md:102 (fix item 2: edges keyed by file mtime and size)
- Pattern to follow: Task 15.1
- Quality requirements: rows are (root, fromFile, toFile, kind, fromMtime, fromSize); additive migration; next free number.
- Validation notes: write-path trace recorded for Mode 3.
- Implementation details: none.

### Task 27.2: `DependencyGraphService` uses TS module resolution for TS/JS and loads persisted edges — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\workspace-intelligence\src\ast\dependency-graph.service.ts; its spec
- Depends on: Task 27.1
- Plan reference: context.md:61 (TS/JS exact module resolution); research-report.md:97-102 (A5)
- Pattern to follow: dependency-graph.service.ts background parse loop (around :640-665)
- Quality requirements: `ts.resolveModuleName` with `tsconfig.base.json` paths for static, `export from` and literal dynamic imports; restart reads persisted edges and reparses only files whose mtime or size changed; watcher events update single files.
- Validation notes: tsconfig paths resolution is cached per root. Non-TS languages are untouched here (Batch 28).
- Implementation details: none.

### Batch 27 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- `npx nx run-many -t typecheck,lint,test -p @ptah-extension/persistence-sqlite,@ptah-extension/workspace-intelligence` passes
- Dependents smoke: recall@all quoted

## Batch 28: Partial answers, Python/Go dependents via the language servers, graph warm-up (Fix 5b) — PENDING

- Recommended executor: backend-developer subagent
- Fallback executor: none (re-run with the same subagent type)
- Execution mode: sequential
- Rationale: the dispatcher graph job and boot warm-up. Lifecycle-sensitive.
- Scorecard metric it must move: `ptah_get_dependents` `building` rate reaches 0; Python/Go dependents recall (where a toolchain exists, else `partial` with coverage)
- Tasks: 2 | Depends on: 27
- Phase: 2C Language servers | Phase review: code-logic + style (this is the last batch of Phase 2C; review Batches 18-28)

### Task 28.1: The dispatcher answers partial with coverage instead of `building`, and Python/Go use the language servers — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\protocol-dispatcher.ts (graph job :2670-3050); D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\protocol-dispatcher.spec.ts
- Plan reference: research-report.md:102 (item 5); context.md:61 (other languages from the same language-server manager, partial with coverage when no server)
- Pattern to follow: the existing `settledWithin(job.settled, GRAPH_BUILD_WAIT_MS)` flow
- Quality requirements: while building, return the partial graph with a coverage line (`partial: N/M files`); Python/Go dependents come from the query service (the file's document symbols, then references aggregated by file, bounded and labelled partial when truncated).
- Validation notes: never return an empty `building` answer when any edges are known.
- Implementation details: none.

### Task 28.2: Warm the graph at session start — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\thoth-runtime\src\lib\workspace-index-lifecycle.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\thoth-runtime\src\lib\workspace-index-lifecycle.spec.ts
- Depends on: Task 28.1
- Plan reference: research-report.md:102 (item 1)
- Pattern to follow: Task 26.1
- Quality requirements: start the graph build in the background at boot; the dispatcher's on-demand build reuses the same job (no duplicate builds).
- Validation notes: the governor still yields; boot is not blocked.
- Implementation details: none.

### Batch 28 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- `npx nx run-many -t typecheck,lint,test -p @ptah-extension/vscode-lm-tools,@ptah-extension/thoth-runtime` passes
- Dependents smoke: `building` rate is 0

---

## Batch 29: `ITextSearchProvider` port, contract suite and ripgrep dependency (Fix 6a) — PENDING

- Recommended executor: backend-developer subagent
- Fallback executor: none (re-run with the same subagent type)
- Execution mode: sequential
- Rationale: a new port and a new runtime dependency (shared lockfile).
- Scorecard metric it must move: none yet (an enabling batch)
- Tasks: 2 | Depends on: 28
- Phase: 2D Text search | Phase review: code-logic + style (new port and new tool), after Batch 33

### Task 29.1: Add `@vscode/ripgrep` — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\package.json; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\package-lock.json
- Plan reference: research-report.md:247, :306
- Pattern to follow: Task 18.1
- Quality requirements: license recorded (MIT); per-platform optional deps resolve on Windows and Linux.
- Validation notes: `npm ci` with npm 11.
- Implementation details: none.

### Task 29.2: Port and contract suite — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-core\src\interfaces\text-search-provider.interface.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-core\src\testing\contracts\run-text-search-provider-contract.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-core\src\testing\contracts\run-text-search-provider-contract.self.spec.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-core\src\index.ts
- Depends on: Task 29.1
- Plan reference: research-report.md:248 (C, hexagonal placement)
- Pattern to follow: Task 21.1 and D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-core\src\testing\contracts\run-file-system-contract.ts
- Quality requirements: `search({root, pattern, literal|regex, caseSensitive, globs, maxMatchesPerFile, maxFiles})` returns per-file matches plus `{engine: 'ripgrep'|'node-scan', truncated}`; the contract covers gitignore respect, regex vs literal, caps, a missing binary giving node-scan, and Windows paths.
- Validation notes: the `PLATFORM_TOKENS` entry uses `Symbol.for`.
- Implementation details: none.

### Batch 29 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- `npx nx run-many -t typecheck,lint,test -p @ptah-extension/platform-core` passes

## Batch 30: Shared ripgrep engine and the VS Code adapter (Fix 6b) — PENDING

- Recommended executor: backend-developer subagent
- Fallback executor: none (re-run with the same subagent type)
- Execution mode: sequential
- Rationale: spawns the `rg` binary; process-sensitive.
- Scorecard metric it must move: none yet (an enabling batch)
- Tasks: 2 | Depends on: 29
- Phase: 2D Text search | Phase review: code-logic + style, after Batch 33

### Task 30.1: Ripgrep engine with a Node-scan fallback (platform-core) — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-core\src\text-search\ripgrep-text-search.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-core\src\text-search\ripgrep-text-search.spec.ts
- Plan reference: research-report.md:246-248
- Pattern to follow: `IFileSystemProvider.findFiles`/`readFile` for the fallback
- Quality requirements: `rg --json` with argument arrays (no shell); timeouts; binary path injected by the adapter; the fallback is reported.
- Validation notes: query strings never reach a shell; `--` precedes the pattern.
- Implementation details: none.

### Task 30.2: VS Code adapter and registration — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-vscode\src\implementations\vscode-text-search-provider.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-vscode\src\implementations\vscode-text-search-provider.spec.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-vscode\src\registration.ts
- Depends on: Task 30.1
- Plan reference: research-report.md:248 (use the packaged `@vscode/ripgrep`, not VS Code's internal path)
- Pattern to follow: Task 23.1
- Quality requirements: contract suite green.
- Validation notes: none.
- Implementation details: none.

### Batch 30 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- `npx nx run-many -t typecheck,lint,test -p @ptah-extension/platform-core,@ptah-extension/platform-vscode` passes

## Batch 31: Electron and CLI text-search adapters (Fix 6b) — PENDING

- Recommended executor: CLI lane x 1
- Fallback executor: backend-developer subagent
- Execution mode: sequential
- Rationale: thin adapters over the shared engine, with a contract suite to verify.
- Scorecard metric it must move: none yet (an enabling batch)
- Tasks: 2 | Depends on: 30
- Phase: 2D Text search | Phase review: code-logic + style, after Batch 33

### Task 31.1: Electron adapter, registration and contract spec — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-electron\src\implementations\electron-text-search-provider.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-electron\src\implementations\electron-text-search-provider.spec.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-electron\src\registration.ts
- Plan reference: research-report.md:248
- Pattern to follow: Task 30.2
- Quality requirements: the binary path resolves inside `app.asar.unpacked`.
- Validation notes: none.
- Implementation details: none.

### Task 31.2: CLI adapter, registration and contract spec — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-cli\src\implementations\cli-text-search-provider.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-cli\src\implementations\cli-text-search-provider.spec.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-cli\src\registration.ts
- Depends on: Task 31.1
- Plan reference: research-report.md:248
- Pattern to follow: Task 30.2
- Quality requirements: contract suite green.
- Validation notes: none.
- Implementation details: none.

### Batch 31 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- `npx nx run-many -t typecheck,lint,test -p @ptah-extension/platform-electron,@ptah-extension/platform-cli` passes

## Batch 32: Ripgrep packaging for Electron and CLI (Fix 6b) — PENDING

- Recommended executor: devops-engineer subagent
- Fallback executor: backend-developer subagent
- Execution mode: sequential
- Rationale: packaging and externals configuration only.
- Scorecard metric it must move: none (packaging)
- Tasks: 1 | Depends on: 31
- Phase: 2D Text search | Phase review: code-logic + style, after Batch 33

### Task 32.1: Ship the `rg` binary — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\apps\ptah-electron\electron-builder.yml; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\apps\ptah-electron\project.json; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\apps\ptah-cli\project.json; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\apps\ptah-extension-vscode\project.json (externals/copy only where needed)
- Plan reference: research-report.md:247, :291
- Pattern to follow: existing native-module externals and asarUnpack entries
- Quality requirements: `@vscode/ripgrep` external and unpacked; `validate-deps` and `verify-packed-native` pass.
- Validation notes: none.
- Implementation details: none.

### Batch 32 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- `npx nx run-many -t typecheck,lint -p ptah-electron,ptah-cli,ptah-extension-vscode` passes; `npx nx run ptah-electron:validate-deps` passes

## Batch 33: `ptah_search_text` service and tool (Fix 6c) — PENDING

- Recommended executor: backend-developer subagent
- Fallback executor: CLI lane x 1
- Execution mode: sequential
- Rationale: a new tool in the dispatcher and the builder; the cross-file contract.
- Scorecard metric it must move: `ptah_search_text` recall@all vs `rg` (equal), tokens per answer no higher than `rg -n`, 1 call per answer, p95 under 500 ms (the suite moves from `na` to scored)
- Tasks: 2 | Depends on: 32
- Phase: 2D Text search | Phase review: code-logic + style (this is the last batch of Phase 2D; review Batches 29-33)

### Task 33.1: `TextSearchService` (rank and compact format) — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\workspace-intelligence\src\services\text-search.service.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\workspace-intelligence\src\services\text-search.service.spec.ts
- Plan reference: research-report.md:240-245 (C: output and ranking)
- Pattern to follow: Task 24.1 DI registration
- Quality requirements: per-file BM25, a declaration-line boost from the symbol index, a test/generated penalty, ties by path; output is `file (N matches)`, up to 3 lines at 160 chars or less, 40 files at most, and a single trailer `files: X, matches: Y, truncated: bool`; no coverage block.
- Validation notes: when the fallback engine is used, the trailer names it.
- Implementation details: none.

### Task 33.2: Tool definition and dispatcher case — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\tool-description.builder.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\protocol-dispatcher.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\protocol-dispatcher.spec.ts
- Depends on: Task 33.1
- Plan reference: research-report.md:243 (the claim in the description); this file's Assumptions (no prompt row)
- Pattern to follow: the `ptah_search_files` definition and case
- Quality requirements: zod-validated args; the result budget respected; a deferred-by-default entry (Batch 37 decides eager); the surface/parity specs updated.
- Validation notes: `mcp-mandate-manifest.spec.ts` stays green (no prompt row).
- Implementation details: none.

### Batch 33 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- `npx nx run-many -t typecheck,lint,test -p @ptah-extension/workspace-intelligence,@ptah-extension/vscode-lm-tools` passes
- Text-suite smoke quoted (all four metrics)

---

## Batch 34: Session-aware spool root and worktree memory scope (Fix 7) — PENDING

- Recommended executor: backend-developer subagent
- Fallback executor: none (re-run with the same subagent type)
- Execution mode: sequential
- Rationale: cross-workspace data scoping. Security- and persistence-sensitive.
- Scorecard metric it must move: lifecycle two-workspace scenario (spool path under the caller's root; memory leak count 0; worktree session sees the main repo's memories)
- Tasks: 2 | Depends on: 33
- Phase: 2E Scope and transport | Phase review: code-logic (after Batch 35)

### Task 34.1: `resolveSpoolRoot` uses the session-aware resolver — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\protocol-dispatcher.ts (:3434-3451); D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\protocol-dispatcher.spec.ts
- Plan reference: research-report.md:108, :110 (A6)
- Pattern to follow: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts:992-1018
- Quality requirements: the order is declared URL root, then caller session, then active session, then provider root; `known[0]` only when nothing resolves; temp dir last.
- Validation notes: the spool file never lands in another project.
- Implementation details: none.

### Task 34.2: Worktree-to-repository memory read scope — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\memory-namespace.builder.ts; its spec
- Depends on: Task 34.1
- Plan reference: research-report.md:109-110
- Pattern to follow: memory-namespace.builder.ts:104-180 (scope resolution)
- Quality requirements: a worktree root resolves its main repo via `git rev-parse --git-common-dir` (argument array, cached per root, timeout); the search covers both roots; an unrelated workspace is never included; stored `workspace_root` values are not rewritten.
- Validation notes: a git failure falls back to the single root with no error to the user; no write-path change (confirm in the report).
- Implementation details: none.

### Batch 34 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- `npx nx run-many -t typecheck,lint,test -p @ptah-extension/vscode-lm-tools` passes
- Two-workspace lifecycle scenario passes

## Batch 35: HTTP keep-alive and timeouts (Fix 8, conditional on the Phase 1 scenario 8 evidence) — PENDING

- Recommended executor: CLI lane x 1
- Fallback executor: backend-developer subagent
- Execution mode: sequential
- Rationale: a small, isolated server-config change with a spec.
- Scorecard metric it must move: transport error rate (scenario 8 ECONNRESET count reaches 0)
- Tasks: 1 | Depends on: 34
- Phase: 2E Scope and transport | Phase review: code-logic (this is the last batch of Phase 2E; review Batches 34-35)

### Task 35.1: Server keep-alive settings — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-http\http-server.handler.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-http\http-server.handler.spec.ts
- Plan reference: research-report.md:121-124 (A9)
- Pattern to follow: none
- Quality requirements: `keepAliveTimeout` above the client idle time, `headersTimeout` above `keepAliveTimeout`, a `Keep-Alive: timeout` header.
- Validation notes: if Batch 11's scenario 8 recorded 0 resets, do not change code. The team-leader closes this batch with the scorecard evidence and no commit (recorded in the batch header).
- Implementation details: none.

### Batch 35 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- `npx nx run-many -t typecheck,lint,test -p @ptah-extension/vscode-lm-tools` passes
- Scenario 8 reset count quoted

---

## Batch 36: Full rescore and claim-mode gate — PENDING

- Recommended executor: senior-tester subagent
- Fallback executor: devops-engineer subagent
- Execution mode: sequential
- Rationale: measurement plus baseline update; no product code.
- Scorecard metric it must move: every suite, recorded. Suites that now pass switch to claim mode in the gate.
- Tasks: 1 | Depends on: 35
- Phase: 2F Rescore and eager selection | Phase review: code-logic (after Batch 37)

### Task 36.1: Rerun the full scorecard on both hosts and tighten the gate — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\baseline\scorecard.json; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\baseline\scorecard.md
- Plan reference: research-report.md:228 ("as each Phase 2 fix lands, the baseline tightens to the claim")
- Pattern to follow: Task 11.1
- Quality requirements: three runs per host; per-suite gate mode = `claim` for each suite whose verdict is pass; any suite still failing is listed with its claim line for escalation to the user (claims are not edited).
- Validation notes: the held-out relevance split is scored once.
- Implementation details: none.

### Batch 36 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- `npx nx run mcp-bench:gate` passes in the mixed mode
- `npx nx run-many -t typecheck,lint,test -p mcp-bench` passes

## Batch 37: Scorecard-driven eager/deferred selection (B10) — PENDING

- Recommended executor: backend-developer subagent
- Fallback executor: none (re-run with the same subagent type)
- Execution mode: sequential
- Rationale: changes which tools agents get eagerly on every host. Product behaviour.
- Scorecard metric it must move: `eagerSelection` in the scorecard equals the dispatcher's runtime eager set per host; calls per answer (the online track, when run)
- Tasks: 2 | Depends on: 36
- Phase: 2F Rescore and eager selection | Phase review: code-logic (this is the last batch of the run; review Batches 36-37)

### Task 37.1: Eager-selection generator — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\eager\eager-selection.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\eager\eager-selection.spec.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\eager-tools.json (generated, committed)
- Plan reference: research-report.md:231-238 (B10)
- Pattern to follow: Task 2.1 schema reader
- Quality requirements: eager on a host iff verdict pass, quality delta above 0, and either at least 1 call saved or at least 20% fewer tokens than native; the tool-search deferral cost is counted; the output is per host (`cli-headless`, `electron`, `vscode`).
- Validation notes: the generated JSON is deterministic (sorted).
- Implementation details: target `eager` in mcp-bench project.json.

### Task 37.2: The dispatcher reads `eager-tools.json`, and the manifest enforces it — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\protocol-dispatcher.ts (:609-628, `markEagerTools` :710); D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\mcp-mandate-manifest.spec.ts
- Depends on: Task 37.1
- Plan reference: research-report.md:233-236
- Pattern to follow: the existing `ALWAYS_EAGER_TOOLS` / `IDE_EAGER_TOOLS` / `SQLITE_EAGER_TOOLS` call sites
- Quality requirements: the hand-written sets are deleted and replaced by the JSON (imported, bundled); host detection unchanged; the manifest spec fails when an eager tool has a failing verdict or a failing tool is named MANDATORY in the prompt.
- Validation notes: a failing MANDATORY tool makes the spec fail. That is intended, and the team-leader escalates it rather than suppressing it.
- Implementation details: none.

### Batch 37 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- `npx nx run-many -t typecheck,lint,test -p mcp-bench,@ptah-extension/vscode-lm-tools` passes
- The eager set per host is quoted against the scorecard

---

## Mode 3 obligations recorded now

- Parity: no user-facing surface is removed. VS Code's index wiring is moved (preserve list in Task
  14.1); the ranker's output shape is preserved (Task 17.2). The eager-set change in Batch 37 is a
  rule outcome, not a removal; deferred tools stay callable via tool search.
- Write-path trace: migrations `code_index_runs` (Batch 15) and `dependency_edges` (Batch 27); symbol
  store purge and transactional replace (Batch 12); memory scope is read-only (Batch 34).
- Rendered visual evidence: N/A (no UI change).
- Findings to surface to the user:
  - The CLI exposes no code-intelligence MCP surface today (Risk row 1).
  - `ptah_search_text` has no prompt row (Assumptions).
  - Any suite still failing after Batch 36, with its claim line.
