# Batches - TASK_2026_619_af7f

Total tasks: 77 | Batches: 41 | Complete: 10/41

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
  - Phase 1, Benchmark: Batches 1-11, including the inserted Batches 4b, 4c and 4d.
  - Phase 2A, Index and coverage: Batches 12-16.
  - Phase 2B, Ranker: Batch 17.
  - Phase 2C, Language-server manager, references, definitions and dependents: Batches 18-28.
  - Phase 2D, Text search: Batches 29-33.
  - Phase 2E, Scope and transport: Batches 34, 34b and 35 (Batch 34b inserted at Batch 5/6 Mode 2).
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

- FALSE (found in Batch 3). The depConstraints have no `type:tool` source tag, and a project whose
  tags match no constraint cannot import any lib (`projectWithoutTagsCannotHaveDependencies`). Batch 1
  imported no lib, so it never tripped. Batch 3 added `scope:cli` to `tools\mcp-bench\project.json` as
  a stopgap. That tag allows `scope:shared | scope:cli | scope:extension` but not `scope:electron`.
  **Decision (team-leader, Batch 3 Mode 2):** the durable fix is a `type:tool` depConstraint in
  `eslint.config.mjs` (`{ sourceTag: 'type:tool', onlyDependOnLibsWithTags: ['*'] }`), so a tool may
  depend on any lib. `scope:cli` is then removed from `mcp-bench`. No lib may depend on a tool: all
  four `type:tool` projects (`mcp-bench`, `di-lint`, `migration`, `degradation-audit`) are
  `projectType: application`, and the boundary rule already rejects imports of applications. The
  bench stays one project; a separate Electron bench project was rejected because it would duplicate
  the transport, guard and scorecard code. The change is carried by Task 4.0, the first task of
  Batch 4, and the `nx lint` of all four tool projects verifies it.
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

## Batch 2: Scorecard model, writers and corpus checkout — COMPLETE (commit 4fc9d147c)

- Recommended executor: CLI lane x 1
- Fallback executor: backend-developer subagent
- Execution mode: sequential
- Rationale: pure data model, writers and a git worktree helper in one tool project.
- Tasks: 2 | Depends on: 1
- Phase: 1 Benchmark | Phase review: code-logic (after Batch 11)

### Task 2.1: Scorecard types, JSON writer and Markdown writer — COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\scorecard.types.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\scorecard-writers.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\scorecard-writers.spec.ts
- Plan reference: research-report.md:196-223 (B8 schema), :173 (delta sign)
- Pattern to follow: the B8 JSON shape verbatim (`schemaVersion: 1`, run, product, corpus, suites[], lifecycle[], eagerSelection)
- Quality requirements: `host` allows `cli-headless | electron | vscode`; each suite carries a `claim` (file:line in ptah-core-prompt.ts), `verdict: pass|fail|na` and `naReason`; Markdown has one table per tool, a lifecycle table and an eager/deferred table.
- Validation notes: `na` is never counted as pass. Validate the schema on read (zod, already a dependency). Carried from Batch 1: compute `callsPerAnswer` (declared at `retrieval-metrics.ts:25`) or remove it from `MetricName`; a suite with no latency samples reports `na`, not the 0 that `cost-metrics.ts:28-33` returns.
- Implementation details: the output goes to `tools/mcp-bench/out/<runId>/` (gitignored) and, for committed baselines, `tools/mcp-bench/baseline/`.

### Task 2.2: Pinned corpus checkout and lifecycle copy — COMPLETE

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

## Batch 3: MCP transport driver and isolated cli-headless bench host — COMPLETE (commit b538e8fb6)

Batch 3 findings recorded at Mode 2 (report:
`D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\.ptah\specs\TASK_2026_619_af7f\batch-3-executor-report.md`):

- Tag deviation: `scope:cli` was added to `tools\mcp-bench\project.json`. This is a stopgap,
  replaced by Task 4.0 (see the Assumptions entry on depConstraints).
- Real-DB guard vs a running desktop Ptah. The user's desktop app writes
  `~/.ptah/state/ptah.sqlite-wal` on its own (report lines 42 and 64), so the guard fails closed on
  any local run that overlaps such a write. This is committed as is (fail-closed is safe). How the
  guard should behave locally is a **user decision pending with the orchestrator**. The decision
  will be passed into a later batch; until then no batch changes the guard semantics in
  `host-launcher.ts:46-118`. Local smoke runs in Batches 4-37 either run with the desktop app
  closed, or report a `RealStateChangedError` trip as an environment failure, not a code failure.
  Resolved at Batch 4: the user decided "watch the bench process" (context.md), implemented by
  Task 4.2 (`hash` / `process-watch` guard modes).
- CLI code-intelligence surface (smoke, report line 65). (a) `ptah_lsp_references` and
  `ptah_lsp_definitions` are not listed on `cli-headless`, because the CLI registers no
  `IDE_CAPABILITIES_TOKEN`. (b) `ptah_code_search_symbols` answers `symbolCount:0`,
  `reindexInFlight:true` with unknown coverage (no boot-time index). (c) `ptah_get_dependents` with a
  relative `filePath` returned a tool error. Batches 5-9 and 13 carry these facts (see their
  validation notes).

- Recommended executor: backend-developer subagent
- Fallback executor: senior-tester subagent
- Execution mode: sequential
- Rationale: child-process lifecycle and state isolation from the user's real `~/.ptah`. This is process- and persistence-sensitive.
- Tasks: 3 | Depends on: 2
- Phase: 1 Benchmark | Phase review: code-logic (after Batch 11)

### Task 3.1: MCP HTTP client and call recorder — COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\mcp-client.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\call-recorder.ts
- Plan reference: research-report.md:175-179 (B5), :183 (error classes)
- Pattern to follow: the request shape served by D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-http\http-server.handler.ts (read it to match the protocol and the `/workspace/{root}` URL segment)
- Quality requirements: wall time measured at the client; classify transport error, `building`, `unavailable`, `unknown` coverage and truncation (budget cut or spool); count calls including retries; keep-alive connection reuse configurable, for scenario 8.
- Validation notes: retries on `building` follow the tool's own retry hint, capped; every retry counts as a call.
- Implementation details: use `@modelcontextprotocol/sdk` client if it matches the server protocol, else a minimal JSON-RPC over HTTP POST.

### Task 3.2: Bench host entry (boots the CLI DI container and the code-execution HTTP MCP) — COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\bench-host.entry.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\project.json (add a `build-host` esbuild target)
- Depends on: Task 3.1
- Plan reference: this file's Risk table, row 1; research-report.md:177
- Pattern to follow: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\apps\ptah-cli\src\cli\commands\mcp-serve.ts:1-60 (withEngine full boot); D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\vscode-core\src\services\subsystem-bringup.ts:67 (`startCodeExecutionMcp`); the `apps\ptah-cli\project.json` build-esbuild target for externals (better-sqlite3 and wasm)
- Quality requirements: workspace root = corpus path; writes `{port}` as one JSON line to stdout once listening; clean shutdown on SIGTERM and stdin EOF; no product source edited.
- Validation notes: verify the assumption that `CODE_EXECUTION_MCP` resolves in the CLI container; if it does not, stop and report (BLOCKER for the transport). Watch for the better-sqlite3 ABI (cli-e2e rebuilds it for Node).
- Implementation details: imports `@ptah-extension/cli-engine` and `@ptah-extension/vscode-core` only; the host label in the scorecard is `cli-headless`.

### Task 3.3: Host launcher with state isolation guard — COMPLETE

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

## Batch 4: Electron host launcher (launch and attach) — COMPLETE (commit d995a1e1a)

Batch 4 findings recorded at Mode 2 (report:
`D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\.ptah\specs\TASK_2026_619_af7f\batch-4-executor-report.md`):

- File-count deviation accepted: 8 files instead of 6. `real-state-guard.ts` and `open-handle-probe.ts`
  were split out because two launchers now share the guard and `host-launcher.ts` would otherwise
  pass the 700-line `max-lines` ceiling. Still one project (`mcp-bench` plus `eslint.config.mjs`) and
  one scoped verification command.
- `HostStopReport.guardBefore`/`guardAfter` became `guard: GuardReport`. No consumer read the old
  fields (verified by grep at Mode 2).
- Serious, carried by Task 4d.1. The `cli-headless` host exits with `0xC0000409` (fail-fast,
  `exitCode=3221226505`) on its graceful stdin-EOF shutdown in about 2 of 3 runs, also with tree
  sampling stubbed out (report line 94). It must be explained, and classified apart from a clean stop
  and from tool errors, before the first recorded scorecard (Batch 11).
- Moderate, carried by Tasks 4b.1 (schema) and 4d.2 (guard). In process-watch mode, handles that
  could not be named are only counted (`real-state-guard.ts:330`, `:368`; the Electron smoke showed
  `unprobed: 1`). The stop report must list the pid and name of each unprobed process, and the
  scorecard must mark the guard as partial when `unprobed > 0`.
- Minor, carried by Task 4d.3. `host-launcher.ts` does not handle the child `'error'` event
  (report line 95), so an unspawnable `process.execPath` surfaces as an unhandled error.
  `electron-host.ts` already handles it.
- `run.guardMode` in the scorecard: the executor proposed Batch 10 or 11. Superseded: the schema field
  lands in Task 4b.1 (orchestrator decision in context.md), and Task 9.3 populates it from the stop
  report.

- Recommended executor: backend-developer subagent
- Fallback executor: devops-engineer subagent
- Execution mode: sequential
- Rationale: drives a real Electron app process and its userData. Process-lifecycle-sensitive.
- Tasks: 3 (Task 4.2 added by the orchestrator from the context.md user decision) | Depends on: 3
- Phase: 1 Benchmark | Phase review: code-logic (after Batch 11)

### Task 4.0: `type:tool` module-boundary constraint; drop the `scope:cli` stopgap — COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\eslint.config.mjs; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\project.json
- Plan reference: this file's Assumptions (the depConstraints entry, marked FALSE, with its decision)
- Pattern to follow: the `scope:e2e` depConstraint and its comment at eslint.config.mjs (around line 330)
- Quality requirements: add `{ sourceTag: 'type:tool', onlyDependOnLibsWithTags: ['*'] }` with a
  comment. The comment says tools are applications, may depend on any lib, and cannot be imported by
  any lib (the rule rejects application imports). Remove `scope:cli` from `mcp-bench` tags, leaving
  `["type:tool"]`. Change no other constraint.
- Validation notes: the change relaxes `di-lint`, `migration` and `degradation-audit` too. They have
  the same tag and no lib imports today, so it cannot introduce an error there. Prove it with lint.
  Prove that `mcp-bench` still lints clean with its `cli-engine`, `vscode-core` and `platform-core`
  imports, and with any `scope:electron` lib Task 4.1 imports.
- Implementation details: do this first, before Task 4.1 adds any Electron-lib import.

### Task 4.1: Electron launch/attach adapter — COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\electron-host.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\electron-host.spec.ts
- Plan reference: research-report.md:177-179 (B5)
- Pattern to follow: how D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\apps\ptah-electron-e2e\src\support launches the app; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\apps\ptah-electron\src\activation\wire-runtime.ts:381-416 (MCP port bring-up)
- Quality requirements: launch mode starts a built Electron app with an isolated userData dir and discovers the MCP port; attach mode targets `PTAH_BENCH_ELECTRON_URL`; in attach mode the memory and lifecycle suites are marked `na` (reason: "attach mode never writes to a user DB").
- Validation notes: if the port cannot be discovered from outside the process, read it from the log line or the `.mcp.json` the app writes, and document which. Guard contract: launch mode runs the Task 3.3 real-DB guard unchanged, because its userData is isolated. In attach mode the real DB changes by definition, so the guard is not applied there. Attach mode instead refuses every suite that writes state (memory seeding, lifecycle), as the `na` rule already requires. Do not change `host-launcher.ts` guard semantics: the local-run behaviour with a running desktop app is a pending user decision (see the Batch 3 findings). Launch mode must not reuse the desktop app's MCP port 51820 or its single-instance lock. Use an isolated userData dir, and report a refusal if the app enforces a single instance.
- Implementation details: returns the same `{baseUrl, stop()}` shape as Task 3.3; host label `electron`.

### Task 4.2: Real-DB guard modes `hash` / `process-watch` (orchestrator-added) — COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\real-state-guard.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\open-handle-probe.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\host-launcher.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\host-launcher.spec.ts
- Plan reference: context.md "User Decision — real-DB guard with a running desktop app"; context.md "Orchestrator Decision — shared scorecard schema" (the `-shm` addition)
- Quality requirements: detect a concurrent writer before the spawn (holder probe or a `-wal` pre-sample); `hash` when none, `process-watch` otherwise; `CI=true` always `hash`, and a writer in CI is an environment failure; isolation layers 1-4 unchanged; the mode is exposed for the scorecard run metadata; the hash guard also covers `-shm`.
- Validation notes: a sample that cannot run fails closed; a bench process holding a path under the real `~/.ptah` fails the run.

### Batch 4 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- Every listed artifact exists and contains the required work
- `npx nx run-many -t typecheck,lint,test -p mcp-bench,di-lint,migration,degradation-audit` passes (the `type:tool` constraint change covers all four tool projects)
- `tools\mcp-bench\project.json` tags are exactly `["type:tool"]`
- The attach-mode `na` rule is tested

## Batch 4b: Generic scorecard core (shared with TASK_2026_620_a13e) — COMPLETE (commit 1ae06c824)

Batch 4b findings recorded at Mode 2 (report:
`D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\.ptah\specs\TASK_2026_619_af7f\batch-4b-executor-report.md`,
including "## Revision 1"):

- Revision 1 (orchestrator-requested, for the API TASK_2026_620 builds on), verified on disk:
  `createScorecardSchema(registry)` (`scorecard.types.ts:121`) with `scorecardSchema` bound to
  `defaultSuiteKindRegistry` (`:212`); factory `createSuiteKindRegistry()` (`suite-kinds.ts:55`);
  generic `registerSuiteKind<D>` with a typed `SuiteView<D>` renderer, details re-parsed by the kind's
  schema, no `as` cast in `retrieval-suite-kind.ts`; no exported mutable kinds list
  (`getRegisteredSuiteKinds()` returns a copy, `suite-kinds.ts:82-84`).
- Two schema additions approved for TASK_2026_620 (context.md Addendum 2026-10-06): required
  `cost.source: 'live' | 'cassette' | 'none'` (`scorecard.types.ts:35`), optional
  `suite.projectionSha256` (64 lowercase hex, `:56-59`) and `computeProjectionSha256` over
  key-sorted compact JSON, rejecting non-finite numbers, undefined array items and cycles
  (`suite-kinds.ts:106-155`). Batch 9 must set `cost.source` (see its schema note).
- `run.guardMode` includes `'not-applied'` (Electron attach mode), as recorded below; stated in the
  report.
- Carried from Batch 1, closed: `callsPerAnswer` is computed (`retrieval-metrics.ts:49`, spec
  `retrieval-metrics.spec.ts:112`) and stays in `MetricName`.
- Process note: the orchestrator briefly ran a second lane on the revision items in parallel with the
  Codex lane and stopped it after about 2 minutes. The final files are consistent; the team-leader
  re-ran prettier and the scoped checks on the final tree (below).
- Mode 2 checks (team-leader): `npx prettier --check tools/mcp-bench/src/scorecard` clean;
  `npx nx run-many -t typecheck,lint,test -p mcp-bench --skip-nx-cache` passed (3 targets, 1m 20s);
  grep for `native_metrics`, `delta.quality`, `registeredSuiteKinds` and `interface Scorecard` in
  `tools/mcp-bench/src`: no hits.

Source: context.md "Orchestrator Decision — shared scorecard schema with TASK_2026_620_a13e". The
TASK_2026_620 session branches from this batch's commit SHA, so this batch runs next. 619 stays the
only writer of `scorecard.types.ts` and `scorecard-writers.ts`; 620 registers its own suite kinds in
its own files.

Recorded defaults for this batch:

- `schemaVersion` stays the literal `1`. No baseline is committed yet, so nothing on disk needs a
  migration. Existing fixtures in the spec are rewritten to the new shape, not kept beside it.
- Besides the seven decision items, two run fields land here, because they belong to the same schema
  and 620 should branch from one schema, not two: `run.guard` partial marking (Moderate finding,
  Batch 4) and `run.hostExit` (Serious finding, Batch 4, classification of a crash on shutdown).
- `run.guardMode` also allows `'not-applied'`, because Electron attach mode (Batch 4, already
  committed) applies no guard. The decision text lists `'hash' | 'process-watch'`; a third value is
  additive and does not affect 620's suite kinds. The batch report must state this.

- Recommended executor: CLI lane x 1
- Fallback executor: backend-developer subagent
- Execution mode: sequential
- Rationale: pure zod types, a registry and writers in one tool project; one self-contained prompt.
  The two tasks share `scorecard.types.ts`, so not parallel.
- Tasks: 2 | Depends on: 2, 4
- Phase: 1 Benchmark | Phase review: code-logic (after Batch 11; the schema is in the combined diff)

### Task 4b.1: Generic core schema and suite-kind registry — COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\scorecard.types.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\suite-kinds.ts (new); D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\retrieval-suite-kind.ts (new)
- Plan reference: context.md "Orchestrator Decision — shared scorecard schema" items 1-7; research-report.md:196-223 (B8 schema, which this generalises)
- Pattern to follow: the existing zod schema and `superRefine` na rule in D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\scorecard.types.ts:1-178
- Quality requirements, one item per decision point:
  1. `claim: { source: 'prompt' | 'tool-description' | 'ledger' | 'code'; ref: string; text?: string }`.
     For `source: 'prompt'` the `ref` must still match `ptah-core-prompt.ts:<line>` (the old regex);
     for every source `ref` is non-empty.
  2. Each suite has `kind: string` and `details: unknown`. `suite-kinds.ts` exports
     `registerSuiteKind(kind, detailsSchema, renderMarkdown?)`, `getSuiteKind(kind)` and the list of
     registered kinds. Registering the same kind twice throws. The scorecard schema validates
     `details` against the registered kind's schema; an unregistered kind fails validation with an
     issue naming the kind. `retrieval-suite-kind.ts` registers `retrieval` (side-effect import from
     `scorecard.types.ts` or an explicit `registerBuiltinSuiteKinds()`, executor's choice; the
     registry must be populated before any parse, which a spec proves). Retrieval `details` carries
     `tool`, `questions`, the quality metrics now in `suiteMetricsSchema` (`hit@1`, `hit@5`, `mrr`,
     `recall@10`, `recall_all`, `precision`, `acc_at_k`, `ndcg_at_k`, `truncation_rate`) and
     `failures[]`.
  3. `groundTruth: { id: string; version: string; method: 'generated' | 'labelled' | 'seeded' | 'git-history'; raterCount?: number; frozenAt?: string }` on each suite (`raterCount` a positive int, `frozenAt` an ISO datetime), and `suite.arm?: string`.
  4. `baselines: Array<{ id: string; label: string; metrics: Record<string, number | null> }>` with
     unique ids, and `deltas: Record<baselineId, Record<metric, number | null>>`. Every key of
     `deltas` must name a baseline in the same suite (validation issue otherwise). `native` is one
     baseline id, not a special field: `native_metrics` and `delta` are removed.
  5. `cost: { calls: number; latency_ms: { p50: number | null; p95: number | null }; error_rate: number | null; tokens: { result_p50?: number | null; input?: number | null; output?: number | null; billed?: number | null } }`. Carried from Batch 1: a suite with no latency samples has `p50`/`p95` `null`, never 0; `calls_per_answer` belongs in retrieval details or is computed from `cost.calls` and `questions` — pick one and remove the other from `MetricName` if unused.
  6. `artifacts: Array<{ kind: string; path: string; sha256: string; schemaId: string }>` at the
     scorecard top level; `sha256` is 64 lowercase hex.
  7. `run.guardMode: 'hash' | 'process-watch' | 'not-applied'` (see the recorded default above).
  - Moderate finding (Batch 4): `run.guard: { partial: boolean; unprobed: Array<{ pid: number; name: string; handles: number }> }`.
    Validation: `partial` must be true when `unprobed` is non-empty, and `partial` with
    `guardMode: 'hash'` or `'not-applied'` is invalid.
  - Serious finding (Batch 4): `run.hostExit: { kind: 'clean' | 'crash-on-shutdown' | 'killed' | 'exited-early'; exitCode: number | null; signal: string | null; detail?: string }`.
    A `crash-on-shutdown` is never a tool error and never counted in any suite's `cost.error_rate`;
    it is a run-level fact. Task 4d.1 produces the value; Task 9.3 copies it in.
  - `verdict: pass | fail | na` and the `naReason` rule stay as today; `na` is never counted as pass
    (`summarizeVerdicts` unchanged in meaning).
  - TypeScript types are inferred from the zod schemas (`z.infer`) rather than hand-written twice, so
    the two cannot drift. If a hand-written interface is kept for readability, a type-level equality
    check must pin it to the schema.
- Validation notes: `scorecard.types.ts` today has hand-written interfaces next to the schema
  (`:95-178`); replace, do not accumulate. No `V2` names and no compatibility shim for the old
  `native_metrics` shape (no baseline exists). The registry is module-global state: it must expose a
  test-only way to build an isolated registry, or the spec of 620's kinds cannot run beside 619's.
- Implementation details: zod is already a dependency of `mcp-bench`; use `z.unknown()` for
  `details` plus a `superRefine` that dispatches on `kind`.

### Task 4b.2: Writers and specs for the generic core — COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\scorecard-writers.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\scorecard-writers.spec.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\suite-kinds.spec.ts (new)
- Depends on: Task 4b.1
- Plan reference: context.md "Orchestrator Decision — shared scorecard schema" item 2 (a kind may supply a Markdown renderer)
- Pattern to follow: the current `readScorecard` / `writeScorecardJson` / `renderScorecardMarkdown` in scorecard-writers.ts:1-159
- Quality requirements: JSON write and read validate through the schema (unknown kind rejected on both); the Markdown writer prints the run header including `guardMode`, guard partial (with the unprobed pid/name list) and `hostExit.kind`; then per suite the kind's renderer when it supplied one, else a generic table (claim source and ref, ground-truth id/method, each baseline's metrics and its delta, cost, verdict, naReason); the retrieval kind supplies a renderer equivalent to today's per-tool table; lifecycle and eager tables unchanged.
- Spec cases (minimum): round trip of a retrieval suite with two baselines; unknown kind rejected; duplicate registration throws; a `deltas` key with no baseline rejected; `partial: true` required when `unprobed` is non-empty; `partial` with `guardMode: 'hash'` rejected; `claim.source: 'prompt'` with a non-matching ref rejected; `na` without `naReason` rejected; a suite with no latency samples renders `na`/null, not 0; a kind without a renderer uses the generic table; `hostExit.kind: 'crash-on-shutdown'` renders in the header and leaves suite error rates untouched.
- Validation notes: `npx prettier --check` on every changed path (the commit hook does not check `tools/`).
- Implementation details: none beyond the above.

### Batch 4b verification

- `npx prettier --check <every path the batch changed>` passes
- Every listed artifact exists; no `native_metrics`, `delta.quality` or hand-written duplicate type remains (grep)
- `npx nx run-many -t typecheck,lint,test -p mcp-bench` passes (tail the output)
- The commit SHA is reported to the orchestrator for the TASK_2026_620 session

## Batch 4c: Shared bench-host boot helper and bench data folder (shared with TASK_2026_620_a13e) — COMPLETE (commit d716e0e8f)

Batch 4c findings recorded at Mode 2 (report:
`D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\.ptah\specs\TASK_2026_619_af7f\batch-4c-executor-report.md`):

- Orchestrator correction (test-only, no logic change), committed with this batch:
  `jest.setTimeout(60_000)` plus a two-line comment at the top of
  `tools\mcp-bench\src\corpus\corpus.spec.ts`. The Batch 2 case "removes only registered stale corpus
  worktrees at startup" exceeded Jest's 5 s default (real git processes, about 10 s per case on
  Windows) and turned `mcp-bench:test` red.
- Accepted deviations: the shared path rule (`isPathInside` / `isSamePath`) lives in `bench-data.ts`
  and `bench-host-boot.ts` imports it (one rule, no engine load in the runner parent);
  `assertIsolatedEnvironment` takes an optional `{ homedir?, platform? }` probe; boot step `'options'`
  rejects a relative `workspace`.
- Intentional behaviour change: a boot failure inside the engine (missing token, null port) now tears
  the engine down before the entry exits 1, with the same message. Previously it called
  `process.exit(1)` inside the `withEngine` callback and skipped the teardown.
- Minor, carried by Task 4d.4: `bench-data.ts` compares resolved paths but does not follow junctions
  or symlinks (no `realpath`), so a data folder that is a junction into the real `~/.ptah` passes
  `resolveBenchDataDir()`. The process-watch guard already resolves junctions
  (`real-state-guard.ts` `realPtahDirs`).
- Minor, carried by Task 4d.1 (executor observation): `host-launcher.ts` keeps its own `samePath`;
  import `isSamePath` from `bench-data.ts` when 4d edits the launcher.
- Mode 2 checks (team-leader): `npx prettier --check tools/mcp-bench/src` clean; grep of
  `bench-host.entry.ts` finds no `readIsolation`, `withEngine(` or `startCodeExecutionMcp(` call;
  `npx nx run-many -t typecheck,lint,test -p mcp-bench` passed (3 targets, 0/3 cache hits, 1m 40s).
  `build-host` and the `launchBenchHost` smoke (58 tools, `ptah_code_search_symbols` listed, clean
  exit 0, guard `process-watch` passed, same report shape) are from the executor report.

Source: context.md "Addendum (2026-10-06) — second round of TASK_2026_620 requests", bullet 2. Split
from the former Batch 4c (now 4d) because the combined batch would have reached 10 files against the
6-file cap. This part runs first because TASK_2026_620 waits for it: its memory-skills host boots
through the same helper, and its runner keeps private snapshots in the bench data folder. The commit
SHA is reported to the orchestrator for the TASK_2026_620 session, as for Batch 4b.

Recorded defaults for this batch:

- Helper module name: `tools\mcp-bench\src\transport\bench-host-boot.ts` (the addendum says only "a
  helper module next to `bench-host.entry.ts`").
- Behaviour of the `cli-headless` host is unchanged by this batch: same isolation refusals, same wire
  lines, same `withEngine` options, same port-0 config write, same exit codes. The shutdown crash
  (`0xC0000409`) is not touched here; it is Task 4d.1, which will then fix the teardown order inside
  this helper rather than in the entry.
- Hook order: `assertIsolatedEnvironment()` → `beforeEngineBoot` → `withEngine` boot →
  `afterContainerReady(container)` → `startCodeExecutionMcp`. `afterContainerReady` runs before the
  MCP server listens, so a caller (620) can seed or register without any call racing it.

- Recommended executor: backend-developer subagent
- Fallback executor: senior-tester subagent
- Execution mode: sequential
- Rationale: refactors the isolated host's boot path and its isolation refusals, and adds a path
  guard against the real `~/.ptah`. Isolation- and process-lifecycle-sensitive, so a subagent per the
  recorded defaults. Task 4c.2 is independent of 4c.1 but is small; one executor, in order.
- Tasks: 2 | Depends on: 3, 4b
- Phase: 1 Benchmark | Phase review: code-logic (after Batch 11)

### Task 4c.1: `bench-host-boot.ts` — `assertIsolatedEnvironment()` and `bootCodeExecutionHost()`; the entry uses it — COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\bench-host-boot.ts (new); D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\bench-host-boot.spec.ts (new); D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\bench-host.entry.ts
- Plan reference: context.md "Addendum (2026-10-06)" bullet 2; this file's Risk table, rows 1 and 2
- Pattern to follow: the current boot in D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\bench-host.entry.ts:84-193 (`readIsolation`, the `withEngine` callback, `startCodeExecutionMcp`, the drain timeout); the env the launcher sets in D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\host-launcher.ts:116-126
- Quality requirements:
  - `assertIsolatedEnvironment(env = process.env)` returns `{ home, userDataPath, dbPath }` and
    throws a typed error (not `process.exit`) with today's refusal messages when
    `PTAH_BENCH_ISOLATED_HOME`, `PTAH_CONFIG_PATH` or `PTAH_DB_PATH` is missing, when `os.homedir()`
    is not the isolated home, or when the config or DB path is not inside it. The win32
    case-insensitive `isInside`/`samePath` comparison moves with it unchanged.
  - `bootCodeExecutionHost({ workspace, beforeEngineBoot?, afterContainerReady? })` asserts isolation
    first, then runs the hooks in the recorded order, boots with today's `withEngine` arguments
    (`mode: 'full'`, `requireSdk: false`, `thoth: 'oneshot'`), fails when `TOKENS.CODE_EXECUTION_MCP`
    is not registered, writes `ptah.mcpPort = 0` to the isolated config, starts the MCP and fails when
    `getPort()` is null. It resolves with a handle that carries at least `port`, `workspaceRoot`,
    the isolation paths and the container, plus `stop(): Promise<void>` that disposes the MCP under
    the existing drain timeout and resolves only after the `withEngine` teardown has finished.
  - A hook or boot step that throws rejects `bootCodeExecutionHost` after the engine is torn down; it
    never leaves the engine running, and never calls `process.exit` itself (exit codes stay the
    entry's job).
  - Hook parameter types are exported so a caller outside `transport/` (620's
    `tools/mcp-bench/src/memory-skills/`) can type its hooks without reaching into cli-engine types it
    does not otherwise need.
  - `bench-host.entry.ts` keeps only argument parsing, the wire lines, the shutdown signals, the
    forced-exit timer, the `exit` flush handler and the exit codes, and boots through the helper. The
    wire contract in its header comment is unchanged.
- Validation notes: the spec covers each isolation refusal (missing var, homedir mismatch, path
  outside the home, win32 case folding) with an injected env, and the hook order plus
  teardown-on-throw with `@ptah-extension/cli-engine` and `@ptah-extension/vscode-core` mocked (a
  real engine boot is the smoke, not the spec). No product source is edited.
- Implementation details: `stop()` releases a deferred that the `withEngine` callback awaits, so the
  engine teardown stays inside `withEngine`.

### Task 4c.2: `bench-data.ts` — `resolveBenchDataDir()` for `PTAH_MCP_BENCH_DATA_DIR` — COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\bench-data.ts (new); D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\bench-data.spec.ts (new)
- Plan reference: context.md "Addendum (2026-10-06)" bullets 2 and 4
- Pattern to follow: the real-home handling in D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\real-state-guard.ts (the guard takes the real home explicitly instead of trusting `os.homedir()` inside the child)
- Quality requirements: `PTAH_MCP_BENCH_DATA_DIR` when set (must be absolute); otherwise
  `%LOCALAPPDATA%\ptah-mcp-bench` on win32 and `~/.cache/ptah-mcp-bench` elsewhere. Reject, with an
  error naming the path and the rule, a directory that is the real `~/.ptah` or lies under it, or that
  is the repository root or lies inside it. Comparisons resolve the path and fold case on win32,
  matching the `isInside` rule of Task 4c.1. The function returns the path; it does not create it
  unless the caller asks (`{ create: true }`, recursive mkdir).
- Validation notes: the bench host child runs with `HOME`, `USERPROFILE` and `LOCALAPPDATA` pointed
  at its temp home, so `resolveBenchDataDir()` is meant for the runner parent. Accept injected
  `env`, `realHome` and `repoRoot` (defaults: `process.env`, `os.homedir()`, the repository root
  found by walking up to `nx.json`), and document that a child must receive the resolved path from
  its parent rather than resolve it. "Repository" also covers the main checkout when running from a
  git worktree (the worktrees live under the main repo root, so the main root's subtree contains
  them). Spec: env override, both platform defaults, a relative override rejected, a path under the
  real `.ptah` rejected, a path inside the repo rejected, win32 case folding.
- Implementation details: no I/O beyond the optional mkdir and the `nx.json` walk.

### Batch 4c verification

- `npx prettier --check <every path the batch changed>` passes
- Every listed artifact exists and contains the required work; `bench-host.entry.ts` no longer
  contains `readIsolation` or a direct `withEngine`/`startCodeExecutionMcp` call (grep)
- `npx nx run-many -t typecheck,lint,test -p mcp-bench` passes, and `npx nx run mcp-bench:build-host`
  builds
- Smoke: launch the `cli-headless` host on the corpus through `launchBenchHost`, call `tools/list`,
  confirm `ptah_code_search_symbols` is listed, then stop it; the guard report is unchanged in shape.
  A shutdown exit code of 3221226505 is the known Task 4d.1 issue, reported, not a failure of this
  batch.
- The commit SHA is reported to the orchestrator for the TASK_2026_620 session

## Batch 4d: Bench host shutdown classification, guard partial report, spawn errors — COMPLETE (commit f22b604fe)

Batch 4d findings recorded at Mode 2 (report:
`D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\.ptah\specs\TASK_2026_619_af7f\batch-4d-executor-report.md`):

- Task 4d.1 outcome: the cause is a product fault. The bench-host shutdown order is not the cause.
  `SqliteConnectionService.close()` dies with 0xC0000409 inside `wal_checkpoint(TRUNCATE)`
  (`libs\backend\persistence-sqlite\src\lib\sqlite-connection.service.ts:526`), and only after vectors
  were written to `vec0`. Evidence is in the report's bisect table: `no-sqlite-vec` 0/10, corrected
  `no-embedder` 0/9, baseline 7/10, and the `trace` last marker is `wal_checkpoint(TRUNCATE) begins`.
  No bench-side fix exists. The refuted worker-join candidate was removed.
- **The product finding is filed as its own task, TASK_2026_622_2d05** (main checkout `.ptah\specs`,
  backlog, BUGFIX, with the evidence; filed by the orchestrator). It is a persistence-layer defect,
  not a tool claim, so it is **not** a 619 Phase 2 task. **No 619 batch depends on it or waits for
  it.** The 619 bench reports these exits as `run.hostExit.kind: 'crash-on-shutdown'`, a run-level
  fact that never counts as a tool error (Task 4b.1; Task 9.3 copies it in). The executor's two
  out-of-scope observations belong with TASK_2026_622 or a later 619 batch, not here: one boot-time
  0xC0000409 (1/10, before ready, classified `exited-early`), and the embedding model downloaded on
  every run into the temp home. The second is carried by Task 9.1 (validation note).
- Smoke (executor): 20 shutdowns through `launchBenchHost` gave crash-on-shutdown 16 and clean 4.
  Every stop was classified, `stop()` never threw, and the guard was `process-watch` with
  partial=false and passed every time.
- Accepted deviations:
  - (1) `bench-host-boot.spec.ts` was changed, though it is not in the file list (9 files). It is
    the colocated spec for the new bisect flags, and the change is additive.
  - (2) `HostStopReport` and `ElectronStopReport` drop `.exitCode`/`.killed` for `.exit: HostExit`.
    This is internal to `mcp-bench`: grep finds no consumer outside `transport/`, and TASK_2026_620
    does not use the Electron host.
  - (3) The `bench-host-boot.ts` API stays additive (`BENCH_BISECT_ENV`, `BenchBisectFlag`,
    `readBisectFlags()`). An unknown flag rejects at step `'options'`. With the variable unset, the
    `withEngine` arguments are byte-identical, and the existing spec asserts this.
  - (4) A failed Electron launch is not wrapped in `HostLaunchError`, which is within the batch
    limit on `electron-host.ts`.
- Mapping for Task 9.3: the guard's `unprobedProcesses` maps onto scorecard `run.guard.unprobed`
  (`scorecard.types.ts:133`, `:191`), and the guard's `partial` maps onto `run.guard.partial`.
- Mode 2 checks (team-leader): `npx prettier --check tools/mcp-bench/src` is clean. `npx nx run-many -t
  typecheck,lint,test -p mcp-bench --skip-nx-cache` passed (3 targets, 1m 13s). `git diff -- libs
  apps` is empty. `build-host` and the 20-shutdown smoke come from the executor report.

- Recommended executor: backend-developer subagent
- Fallback executor: senior-tester subagent
- Execution mode: sequential
- Rationale: native-addon teardown forensics in a child process, plus the guard's process probe.
  Process-lifecycle-sensitive and needs judgement mid-flight (fix here vs product finding).
- Tasks: 4 (Task 4d.4 added at Batch 4c Mode 2) | Depends on: 4, 4b (uses the `hostExit` kinds and
  `run.guard` shape named in Task 4b.1), 4c (the boot and teardown now live in `bench-host-boot.ts`)
- File-count deviation (recorded at Batch 4c Mode 2): 8 files instead of 6, because Task 4d.4 adds
  `bench-data.ts` and `bench-data.spec.ts`. No later batch touches `bench-data.ts`, the change is
  small, and it stays one project (`mcp-bench`) with one scoped verification command (precedent:
  Batch 4).
- Must land before Batch 10 (the first recorded scorecard is Batch 11)
- Phase: 1 Benchmark | Phase review: code-logic (after Batch 11)
- Note (Batch 4c split): after Batch 4c the boot and teardown live in `bench-host-boot.ts`, so Task
  4d.1 edits the helper instead of `bench-host.entry.ts` (bisect flags and any shutdown-order fix go
  there). The batch stays at 6 files: `bench-host-boot.ts`, `host-launcher.ts`,
  `host-launcher.spec.ts`, `electron-host.ts`, `real-state-guard.ts`, `open-handle-probe.ts`. If the
  entry itself must change, report it and the team-leader records the deviation.

### Task 4d.1: Find the `0xC0000409` on graceful shutdown; fix or record; classify every stop — COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\bench-host-boot.ts (from Batch 4c; replaces `bench-host.entry.ts` in this list); D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\host-launcher.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\host-launcher.spec.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\electron-host.ts (stop-report classification only)
- Plan reference: batch-4-executor-report.md line 94; this batch's Batch 4 findings (Serious)
- Pattern to follow: the CLI's own shutdown order in D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\apps\ptah-cli\src\cli\commands\mcp-serve.ts and the `withEngine` teardown it uses; the workspace-watch supervisor's exit handling in D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\platform-core\src\workspace-watch\workspace-watch-supervisor.ts
- Quality requirements:
  - Find the cause. Suspects, in this order: better-sqlite3 `close()` racing an open statement or a
    worker; the sqlite-vec extension unload; the embedder worker's onnxruntime session (a worker
    thread still alive at `process.exit`); tree-sitter wasm teardown. Bisect by disabling one subsystem
    at a time in the bench host only (env flags in `bench-host-boot.ts`, never product edits), with at
    least 10 shutdowns per variant, and quote the crash rate per variant in the report.
  - If the cause is bench-host shutdown order (for example `process.exit` before the engine's
    disposers and worker terminations finish), fix it in `bench-host-boot.ts` (`stop()` and the
    `withEngine` teardown; the entry's final `process.exit` only if unavoidable): await the engine's
    dispose, terminate workers, close the DB, then exit; prove 0 crashes in 20 shutdowns.
  - If the cause is in product code, do not edit product code (Phase 1 changes no product behaviour).
    Record it as a product finding in the batch report with the evidence (variant rates, the
    subsystem, file:line of the teardown), and the team-leader carries it into a named Phase 2 task.
  - In every case, classify each stop: `HostStopReport.exit` (and the Electron stop report) carries
    `{ kind: 'clean' | 'crash-on-shutdown' | 'killed' | 'exited-early'; exitCode; signal; detail? }`
    with the exact kind names from Task 4b.1. `crash-on-shutdown` = non-zero exit or a fail-fast code
    (`0xC0000409` = 3221226505, `0xC0000005`, POSIX `SIGSEGV`/`SIGABRT`) after the graceful stop
    began; `killed` = the tree kill fired; `exited-early` = the host ended before `stop()`. A crash on
    shutdown never throws from `stop()` and never turns into a tool error; it is reported.
  - On win32 Electron `killed` is always true today (`taskkill /T /F`); the classification must say so
    in `detail` rather than calling it a crash.
- Validation notes: spec cases with a fixture host that exits 0, exits with 3221226505 after stdin
  EOF, ignores EOF (killed), and exits before `stop()`. Keep `host-launcher.ts` under the 700-line
  `max-lines` ceiling. Carried from Batch 4c (Minor): replace the launcher's private `samePath` with
  `isSamePath` from `tools\mcp-bench\src\bench-data.ts` (one path rule; behaviour unchanged).
  Since Batch 4c, a boot failure inside the engine tears the engine down before the entry exits 1;
  classify that as `exited-early` (it ends before `stop()`), not as a crash.
- Implementation details: the report quotes the bisect table and the final per-variant rates.

### Task 4d.2: List unprobed processes and mark the guard partial (Moderate) — COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\real-state-guard.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\open-handle-probe.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\host-launcher.spec.ts (shared with Task 4d.1)
- Depends on: Task 4d.1 (same spec file)
- Plan reference: this batch's Batch 4 findings (Moderate); real-state-guard.ts:330, :368
- Pattern to follow: the current `unprobed` max in real-state-guard.ts:368 and the win32 handle walk in open-handle-probe.ts
- Quality requirements: `TreeOpenPathsResult` reports unprobed handles per pid; the process-watch
  `GuardReport` carries `partial: boolean` and `unprobedProcesses: Array<{ pid; name; handles }>`
  (union across samples, max handles per pid), matching `run.guard` in Task 4b.1; `partial` is true
  exactly when that list is non-empty; the stop report and any error message name each pid and
  process name. A partial guard does not fail the run (it is reported); a held real path and a failed
  sample still fail it.
- Validation notes: the linux `/proc` probe reports an fd whose link cannot be read as unprobed for
  that pid, so the spec can run on CI.
- Implementation details: none beyond the above.

### Task 4d.3: Handle the child `'error'` event in the CLI launcher (Minor) — COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\host-launcher.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\host-launcher.spec.ts
- Depends on: Task 4d.2
- Plan reference: batch-4-executor-report.md line 95
- Pattern to follow: the `'error'` handling in D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\electron-host.ts
- Quality requirements: a spawn failure rejects `launchBenchHost` with a clear error naming the
  script and `process.execPath`, runs the guard (a guard failure still outranks it), removes the temp
  home, and leaves no unhandled error; spec case with a nonexistent host script path or executable.
- Validation notes: none.
- Implementation details: none beyond the above.

### Task 4d.4: Follow junctions and symlinks in `resolveBenchDataDir()` (Minor, from Batch 4c) — COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\bench-data.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\bench-data.spec.ts
- Depends on: none inside the batch (independent files; run last)
- Plan reference: Batch 4c findings (Minor, junction); Task 4c.2 quality requirements
- Pattern to follow: `realPtahDirs` in D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\real-state-guard.ts (how the guard resolves junctions of the real `~/.ptah`)
- Quality requirements: the forbidden roots (real `~/.ptah`, repository root) and the candidate data
  dir are compared both lexically (today's rule) and after `realpath`. For a candidate that does not
  exist yet, resolve its nearest existing ancestor with `realpath` and re-append the missing tail.
  Reject when either comparison puts the candidate at or under a forbidden root; the error names the
  path, its real path and the rule. A `realpath` failure other than ENOENT fails closed (reject). The
  path the function returns stays the lexical resolved path. `isPathInside` / `isSamePath` stay pure
  (no I/O), because `bench-host-boot.ts` and the launcher use them for lexical checks.
- Validation notes: spec cases with a real temp directory: a junction (win32, `fs.symlinkSync(..., 'junction')`)
  or a dir symlink (POSIX) pointing into a fake real home's `.ptah` is rejected; a link pointing into
  the fake repo root is rejected; a not-yet-existing child of such a link is rejected; a plain
  directory outside both passes. Skip a link case only when the OS refuses to create the link, and
  say so in the test name.
- Implementation details: inject the realpath function (default `fs.realpathSync.native`) next to the
  existing `env`, `realHome`, `repoRoot` and `platform` options, so the error path can be specced.

### Batch 4d verification

- `npx prettier --check <every path the batch changed>` passes
- Every listed artifact exists and contains the required work
- `npx nx run-many -t typecheck,lint,test -p mcp-bench` passes, and `npx nx run mcp-bench:build-host` builds
- Smoke: 20 graceful shutdowns of the `cli-headless` host, each stop classified; the report quotes the
  count per `exit.kind`. If any `crash-on-shutdown` remains, a product finding with evidence is in the
  report.
- The junction/symlink cases of Task 4d.4 pass (or are skipped with a stated reason where the OS
  refuses to create the link)

## Batches 5 and 6 run in parallel (recorded at Batch 4d Mode 2)

Source: context.md "User Requests (2026-10-07)" item 2. That item assigns one lane per batch and
runs the two together if they are file-disjoint. Lane choice is in context.md, not here.

File-disjointness check (team-leader):

- Batch 5 writes these files under `tools\mcp-bench\src\ground-truth\`: `ts-program.ts`,
  `symbol-questions.ts`, `graph-questions.ts` and `ground-truth.spec.ts`. It also writes
  `tools\mcp-bench\questions\7910f34cf\` `symbols-exact.json`, `symbols-concept.json`,
  `references.json`, `definitions.json` and `dependents.json`.
- Batch 6 writes these files under `tools\mcp-bench\src\ground-truth\`: `relevance-questions.ts`,
  `file-tool-questions.ts`, `memory-questions.ts` and `relevance-memory.spec.ts`. It also writes
  `tools\mcp-bench\questions\7910f34cf\` `relevance.json`, `file-tools.json` and `memory.json`.
- No file is shared. `tools\mcp-bench\src` has no index or barrel file, and neither batch creates
  one. Neither batch edits `project.json`, because the `generate` target is Task 9.3. Neither
  edits `jest.config.ts`, `tsconfig.json`, `corpus.config.json`, `package.json` or `.gitignore`.
  Both may import Batch 1-4d modules (`metrics\`, `corpus\`, `bench-data.ts`) but must not edit
  them.

Couplings that are not shared files, and the rule for each:

1. **One Nx project.** Each lane's `typecheck`, `lint` and `test` of `mcp-bench` also sees the other
   lane's unfinished files. While working, each lane checks its own files only (jest on its spec
   file, eslint on its files). At the end it runs the full scoped command once. A failure that
   lies only in the other batch's files is reported as foreign; the lane does not fix it and does
   not edit that file. The team-leader re-runs the full command at Mode 2 on the combined tree,
   and that run is the gate. Each batch gets its own commit.
2. **Corpus prune race** (`corpus.ts:30`, `:116-129`; fix carried by Task 9.3). Neither lane calls
   `withPinnedCorpus` to produce its frozen output. Each lane extracts the pin read-only into its own
   temp folder: `git archive 7910f34cf | tar -x -C %TEMP%\mcp-bench-b5-corpus` (or `-b6-`). Every
   generator takes the corpus root as a parameter, so Batch 9 can drive it through
   `withPinnedCorpus` later.
3. **Question-file envelope.** Both batches write the same envelope, which mirrors the scorecard's
   `groundTruth` (Task 4b.1):
   `{ id, version: '1', method: 'generated' | 'labelled' | 'seeded' | 'git-history', raterCount?, frozenAt, corpusCommit: '7910f34cf', generator, seed: number | null, counts, questions }`.
   Each batch defines its own zod schema next to its generator. Task 9.1 merges the two envelope
   schemas into one module when it reads them; this is recorded as an accepted short-lived
   duplication.
4. **No shared helper.** Batch 6 does not import `ts-program.ts`. Its ast/enrich truth uses
   `ts.createSourceFile` per file. Batch 5 owns the seeded RNG. Batch 6 needs none: the split is by
   merge date, and the memory facts come from fixed templates.

## Batch 5: Ground truth A — TS compiler (symbols, references, definitions, dependents) — COMPLETE (commit 7e1572272)

Batch 5 findings recorded at Mode 2 (report:
`D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\.ptah\specs\TASK_2026_619_af7f\batch-5-executor-report.md`):

- Lane evidence: codex. Initial run wrote the code and the spec, but every command was killed at
  30 s, so the corpus extraction and the generator never ran and the five question files were empty
  envelopes. Revision 1 fixed 7 defects found in the orchestrator review (declaration kinds admitted
  to truth, overload collapse plus `truthCount`, `export` on variable statements, thin concept
  queries, reference sampling and same-name strata, definition shuffling and `query`, dependents
  strata). The orchestrator then made 2 corrections outside the lane: (1) `containsIdentifierToken`
  did not split camelCase inside backticks (the lane's own spec case failed on it); (2) 22 of 150
  definition truths pointed at the import line of an unresolved external package, so definitions of
  kind `alias` are now skipped, with a spec case. Extraction and generation were run by the
  orchestrator (extract 36 s; load 53-66 s, 6,346 files, heap 3.4 GB, peak RSS 6.5 GB, 963 s total).
- Frozen counts verified on disk at Mode 2 (`tools\mcp-bench\questions\7910f34cf\`, every envelope
  `method: 'generated'`, `corpusCommit: '7910f34cf'`): symbols-exact 350 (small 100, large 100,
  largest-lib 100, negative 50); symbols-concept 200; references 150 (under-5 50, 5-50 50,
  over-50-same-name 25, over-50-other 25); definitions 150 call sites; dependents 100 (zero 34, 1-10
  33, over-10 33). Every stratum the Batch 5 spec names is met. The dependents strata (0 / 1-10 /
  over 10) are the executor's choice; the spec named only the total of 100. Accepted.
- Accepted deviation: the references over-50 stratum is reported as two count keys
  (`over-50-same-name`, `over-50-other`) instead of one key with a sub-count. Same 50 questions; Task
  9.1 reads both keys.
- Hand-off to Task 9.1: dependents questions declare `pathForms: ['relative', 'absolute']`. The
  absolute form must be joined to that run's fresh corpus root (not the generation-time temp root).
- Mode 2 checks (team-leader, combined tree with Batch 6): `npx prettier --check
  tools/mcp-bench/src/ground-truth tools/mcp-bench/questions` clean; `npx nx run-many -t
  typecheck,lint,test -p mcp-bench --skip-nx-cache` passed (3 targets, 1m 26s; Nx flagged `lint`
  as flaky from history, and it passed this run); `git diff -- libs apps` empty; no TODO, FIXME,
  PLACEHOLDER or STUB markers under `ground-truth\`.

- Recommended executor: CLI lane x 1 (lane per context.md User Requests 2026-10-07)
- Fallback executor: backend-developer subagent
- Execution mode: parallel (runs at the same time as Batch 6 on a second lane; the tasks inside the
  batch stay sequential)
- Rationale: pure offline generators over the pinned corpus, file-disjoint from Batch 6 (see the
  check above). The shared program loader keeps Tasks 5.1 and 5.2 in one lane.
- Tasks: 2 | Depends on: 2
- Phase: 1 Benchmark | Phase review: code-logic (after Batch 11)

### Task 5.1: Program loader and symbol-search questions (exact, concept, negatives) — COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\ground-truth\ts-program.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\ground-truth\symbol-questions.ts
- Plan reference: research-report.md:147-150, :160 (B3)
- Pattern to follow: `ts.createLanguageService` with `tsconfig.base.json` paths (research-report.md:32 scratch measurement)
- Quality requirements: 300 exact questions stratified (100 small files, 100 files over 1,000 lines, 100 from the largest lib) plus 50 negatives; 200 concept questions from the JSDoc first sentence with identifier tokens removed; seeded RNG; output frozen to `tools/mcp-bench/questions/<commit>/*.json`.
- Validation notes: exclude test files; index.ts and `*.module.ts` are kept in the truth set (the indexer's skip is a finding, not a truth exclusion). Carried from Batch 3: on `cli-headless`, `ptah_code_search_symbols` answers `symbolCount:0` with unknown coverage today. The truth is host-agnostic and must not be trimmed to what the tool can answer.
- Implementation details: the program is loaded once per run; memory is reported in the generator log.

### Task 5.2: References, definitions and dependents questions — COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\ground-truth\graph-questions.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\ground-truth\ground-truth.spec.ts
- Depends on: Task 5.1
- Plan reference: research-report.md:151-153 (B3)
- Pattern to follow: Task 5.1's loader
- Quality requirements: 150 reference identifiers (50 with fewer than 5 refs, 50 with 5-50, 50 with more than 50, of which 25 share a name with another symbol); 150 definition call sites; 100 dependents/dependencies files via `ts.resolveModuleName` (static, `export from`, literal dynamic `import()`).
- Validation notes: same-name strata are mandatory (the rename-safe claim). The spec runs on a tiny fixture program. Carried from Batch 3: `ptah_lsp_references` and `ptah_lsp_definitions` are not listed on `cli-headless` (no `IDE_CAPABILITIES_TOKEN`). Generate the truth anyway, because it is scored on `electron` now and on `cli-headless` after Batch 25. Each dependents/dependencies question records the file both workspace-relative and absolute, because `ptah_get_dependents` returned a tool error for a relative `filePath` in the smoke.
- Implementation details: truths are `file:line` sets, workspace-relative.

### Batch 5 verification

- `npx prettier --check <every path the batch changed>` passes (lanes skipped formatting in Batches 1-2, and the commit hook does not check `tools/`)
- Every listed artifact exists and contains the required work
- `npx nx run-many -t typecheck,lint,test -p mcp-bench` passes
- Question files are generated for the pinned commit (counts quoted in the report)

## Batch 6: Ground truth B — relevance PR split, memory seed set, file-tool questions — COMPLETE (commit 629e4f719)

Batch 6 findings recorded at Mode 2 (report:
`D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\.ptah\specs\TASK_2026_619_af7f\batch-6-executor-report.md`):

- Lane evidence: initial run on Glm (ptah-cli) ended `no-deliverable` after 18 m 47 s ($6.13). It
  generated `file-tools.json` and `memory.json`, wrote no report, and got stuck waiting on a
  background `gh` retry after `gh pr list --limit 1000` failed (truncated JSON, then HTTP 502).
  Revision 1 (relevance source only) ran on opencode per the orchestrator: about 25 min, scoped
  prettier, eslint and jest (25/25) clean in the lane. Resolved at Batch 7 Mode 2: the report's
  executor line now reads opencode CLI lane with the `backend-developer` role (agent `0b496e62`,
  25 m 21 s); the earlier "backend-developer subagent" wording named the role, not the executor.
- **Relevance source changed by user decision (2026-10-07, context.md "User Decision — relevance
  ground-truth source"): PRs + commits.** The strict PR-only rule kept 1 PR. Now a PR or a non-merge
  commit qualifies when it changes 1-8 eligible source files; its other files are ignored and the
  truth is the eligible files; each question records `source: 'pr' | 'commit'`; method stays
  `git-history`; the `gh` fetch is paged GraphQL (25 per page, 3 attempts per page); CI reads only the
  frozen JSON. Regenerated by the orchestrator in 12 m 8 s.
- Frozen counts verified on disk at Mode 2 (`tools\mcp-bench\questions\7910f34cf\`):
  relevance 1,627 (`test` 200, `tune` 1,427; pr 62, commit 1,565; no deviation; 192 PRs skipped for
  more than 100 files; the `test` split holds 8 PRs and 192 commits); file-tools 400 (ast 100 = 34
  small + 33 medium + 33 large, glob 100 of which 16 zero-match, text literal 150, regex 50);
  memory 489 (150 facts, 300 seeded rows, verbatim 150, paraphrase 300, worktree 15, abstention 20,
  labelled 4). All 6,918 file-tool truth paths exist at the pin (orchestrator check).
- Accepted deviations:
  - (1) Memory total 489 instead of 474: the 15 extra questions are the worktree-of-A queries that
    the batch's "worktree of A" leak check needs. The temporal-update pair is two seeded rows per
    fact (truth = the newer row), not an extra question kind.
  - (2) `seedMemory(target, set, roots)`: a third `roots: MemoryRoots` argument maps the root
    placeholders to the real isolated roots at seed time. `target` is still
    `Pick<MemoryStore, 'insertMemoryWithChunks'>`, as recorded at Batch 4d Mode 2. It opens no DB.
  - (3) `splitByMergeDate` renamed `splitByDate` (it now orders PRs and commits).
- Observation for Batch 11 and the user (not a defect): the held-out `test` split is 96% commits
  (192 of 200), because few PRs change 1-8 source files. Commit subjects are terser than PR titles;
  quote the split composition next to the relevance score.
- Hand-off to Task 9.1: score relevance on the `test` split only (Batch 36 scores it once); read the
  `source` field and report recall@10 per source as well as overall; the two envelope zod schemas
  (Batch 5 and Batch 6) are merged there, as recorded above.
- Mode 2 checks: the same combined-tree run as Batch 5 (prettier clean; scoped nx typecheck, lint,
  test passed, 1m 26s; `git diff -- libs apps` empty; no marker strings).

- Recommended executor: CLI lane x 1 (lane per context.md User Requests 2026-10-07)
- Fallback executor: backend-developer subagent
- Execution mode: parallel (runs at the same time as Batch 5 on a second lane; the tasks inside the
  batch stay sequential)
- Rationale: offline generators, file-disjoint from Batch 5 (see the check above Batch 5).
- Tasks: 2 | Depends on: 2
- Recorded default (Batch 4d Mode 2), replacing `seedMemory(dbPath)` in Task 6.2: the signature is
  `seedMemory(target, set)`, where `target` is
  `Pick<MemoryStore, 'insertMemoryWithChunks'>` (`libs\backend\memory-curator\src\lib\memory.store.ts:195`).
  Batch 9 calls it from the `afterContainerReady` hook of `bootCodeExecutionHost`
  (`bench-host-boot.ts:109`), inside the isolated host. There the real store, embedder and isolated
  DB are wired, and no call can race the seeding. Opening a DB by path in the runner parent would
  need the DI container, the embedder and the vec status there. Keeping the seeding inside the
  isolated host leaves isolation in one place.
- Phase: 1 Benchmark | Phase review: code-logic (after Batch 11)

### Task 6.1: Relevance questions with a frozen held-out split — COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\ground-truth\relevance-questions.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\ground-truth\file-tool-questions.ts
- Plan reference: research-report.md:154, :156-158, :160 (held-out split)
- Pattern to follow: `gh pr list --state merged --json title,body,files,mergeCommit`
- Quality requirements: PRs before the pin, 1-8 changed non-test, non-lockfile source files; the most recent 200 are `test`, earlier ones are `tune`, frozen to JSON so CI needs no `gh`; file-tool questions: 100 ast/enrich files by size stratum, 100 glob patterns, 150 literal plus 50 regex text queries.
  - **Changed by user decision 2026-10-07** (context.md "User Decision — relevance ground-truth
    source"; the text above is kept as the original plan): the source is PRs + non-merge commits. A
    PR or commit qualifies when it changes 1-8 eligible source files; its other changed files (docs,
    specs, lockfiles, tests) are ignored and the truth is the eligible files. Commits (subject =
    query) fill the set; the most recent 200 are `test`, the rest `tune`. Each question records
    `source: 'pr' | 'commit'`; method stays `git-history`; the `gh` fetch is paged (GraphQL, 25 per
    page). Result: 200 `test` / 1,427 `tune`.
- Validation notes: CI must not call `gh`; the frozen JSON is committed. Carried from Batch 3: the `cli-headless` index is empty at boot (`symbolCount:0`, unknown coverage). Any question whose tool depends on the symbol index is still generated; the empty index is a scored finding, not a reason to drop questions.
- Implementation details: also adds the 4 TASK_2026_473 track-A memory queries as a labelled hand-graded seed in Task 6.2.

### Task 6.2: Seeded memory set (verbatim, paraphrase, temporal update, abstention, two workspaces plus worktree) — COMPLETE

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

## Batch 7: Polyglot corpus and SCIP cross-check ground truth — COMPLETE (commit: the `feat: batch 7` commit after 629e4f719; SHA filled in after the commit)

Batch 7 findings recorded at Mode 2 (report:
`D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\.ptah\specs\TASK_2026_619_af7f\batch-7-executor-report.md`):

- Lane evidence: opencode CLI lane with the `backend-developer` role (agent `70a3b1f8`), code and
  spec only, as recommended at Batch 5/6 Mode 2. Hand-written protobuf decoder for the pinned
  `scip.proto` subset (no new dependency; `@scip-code/scip` not used); 11 spec cases with a
  spec-only encoder; scoped jest and eslint clean in the lane. The orchestrator ran the indexers and
  the generation outside the lane, and made 1 correction: scip-typescript on win32 writes `\` in
  `relative_path`, so `compareWithTsTruth` matched 0 of 150; `parseDocument` now normalizes to `/`,
  with a new spec case (12/12).
- Indexers (user decision 2026-10-07, context.md "User Decision — SCIP indexers"; global user tools,
  repository `package.json` unchanged): scip-typescript 0.4.0 (Windows, 6,346 documents, 2 m 12 s,
  268 MB index); scip-go 0.2.7 (Windows, 37 documents); scip-python 0.6.6 (WSL Ubuntu-24.04 only,
  64 documents). SCIP stays ground truth only; nothing outside `tools/mcp-bench` imports the module.
- Corpora pinned in `corpus.config.json` under a new `polyglot` key (the corpus reader's non-strict
  `z.object` strips it, so existing flows are unchanged): `python-attrs` (attrs 25.4.0,
  `9a98e00a7c078360add417c5d62db820d4645ab1`, MIT) and `go-logrus` (logrus v1.9.4,
  `b61f268f75b6ff134a62cd62aee1095fa12e8d2e`, MIT).
- Frozen outputs verified on disk (`tools\mcp-bench\questions\scip\`):
  - `python-attrs.json`, seed 6190701: 37 reference questions (under-5 17, 5-50 17, over-50 3 of 16)
    and 50 dependency questions.
  - `go-logrus.json`, seed 6190702: 41 reference questions (under-5 17, 5-50 17, over-50 7 of 16)
    and 37 dependency questions.
  - `ts-agreement.json`: 148 of 150 Batch 5 reference questions compared, 2 unmatched, mean Jaccard
    0.877, exact rate 0.750.
- Accepted deviations:
  - (1) Python references 37 of 50 and Go references 41 of 50; Go dependencies 37 of 50. The pinned
    corpora are small (attrs has few symbols with more than 50 references; logrus has 37 documents).
    The unfilled strata are recorded in `counts` (`-target` keys, `unfilled-strata: 1`) and not
    refilled from other strata, the same rule as Batch 5 references.
  - (2) Envelope adds `language`; `naRecord` uses `id` = language, `corpusCommit: ''`. Reference
    targets 17/17/16; dependency questions are a seeded shuffle without strata (the spec stratifies
    references only). The `compareWithTsTruth` fixture has 3 questions instead of 2 (exact, partial,
    unmatched).
  - (3) Minor, recorded, not fixed: `scip-cross-check.ts` now draws a `max-lines` **warning** (703
    counted lines of 849 physical, limit 700; the rule is `warn`, so lint passes and the gate is not
    blocked). The lane left it at 700; the orchestrator's path-normalization correction added 3.
    The next change to this file splits the protobuf decoder into its own module (named for the
    Phase 1 code-logic review after Batch 11).
- **Agreement analysis and its consequence for Batch 9.** In all 37 non-exact questions `onlyScip`
  is 0: SCIP never finds a reference the TS truth misses. All 1,477 extra TS locations are interface
  or inherited members in the over-50 stratum (`dispose`, `getDiagnostics`, `name`, `readFile`):
  the TS language service `findReferences` returns a member together with its implementations, as
  the editor's "Find All References" does, while SCIP keeps each symbol separate. So the Batch 5 TS
  truth is the editor-semantics view, which is what the `ptah_lsp_references` claim names. Batch 9
  scores references against the TS truth (primary) and reports the SCIP-strict set as a second view
  (carried into Task 9.1).
- Mode 2 checks (team-leader): `npx nx run-many -t typecheck,lint,test -p mcp-bench
  --skip-nx-cache` passed (3 targets, 1m 30s; one `max-lines` warning, see deviation 3); `npx prettier --check` on the batch's files clean;
  `git diff -- libs apps` empty.

- Recommended executor: CLI lane x 1
- Fallback executor: backend-developer subagent
- Execution mode: sequential
- Rationale: offline, optional-tool generator; isolated files.
- Lane re-check (Batch 5/6 Mode 2; the orchestrator decides): context.md plans opencode. Evidence:
  opencode finished a pure-code revision (Batch 6 rev 1) in about 25 min with clean scoped checks;
  it has no messaging, so no mid-run steering. Batch 7 is pure code plus long-running generation:
  choosing and pinning two MIT-licensed repos (network, license check), running `scip-typescript`
  over 6,346 files (the TS program load alone took 53-66 s and 3.4 GB heap in Batch 5) and the
  50+50 Python/Go question sets. **Recommendation: keep opencode for the code and spec
  (`scip-cross-check.ts`, the spec with a fixture SCIP index and the `na`-when-absent path), with
  the two corpus pins (repo URL, commit SHA, license) written into the lane prompt by the
  orchestrator, so the lane makes no choice it cannot be steered on. The orchestrator (or a
  backend-developer subagent) runs the SCIP indexers, the generation and the nx gate outside the
  lane with a long timeout, as in Batches 5 and 6.** Do not use codex (30 s command kill). If the
  SCIP indexers are not installed on this machine, the frozen output is the `na` record and that is
  an acceptable Batch 7 result, recorded in the report.
- Tasks: 1 | Depends on: 5
- Phase: 1 Benchmark | Phase review: code-logic (after Batch 11)

### Task 7.1: Pinned Python and Go corpora and SCIP cross-check — COMPLETE

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\ground-truth\scip-cross-check.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\ground-truth\scip-cross-check.spec.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\corpus.config.json (add pinned small MIT-licensed Python and Go repos)
- Plan reference: context.md:58-61 (Gate SR decisions 1 and 4: SCIP as benchmark ground truth only); research-report.md:302
- Pattern to follow: Task 5.2's truth format
- Quality requirements: when `scip-typescript`, `scip-python` or `scip-go` are on PATH, generate reference, definition and dependents truth and compare the TS truth with Task 5.2 (agreement rate reported); when absent, the suite is `na` with a reason; Python and Go reference/dependents question sets (50 each) come from SCIP truth.
- Validation notes: SCIP is never a runtime backend. Record the license of each pinned corpus repo. Carried from Batch 3: the reference/definition truth targets tools that are absent on `cli-headless` (no `ptah_lsp_references`/`ptah_lsp_definitions`). Dependents truth records absolute and workspace-relative paths (a relative `filePath` errored in the smoke).
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
- Lane re-check (Batch 5/6 Mode 2; the orchestrator decides): context.md plans Glm. Evidence: Glm's
  one run (Batch 6) ended `no-deliverable` after 18 m 47 s; it stalled on a network retry (`gh`) it
  had put in the background, and wrote no report. Batch 8 needs no network and no long generation:
  three files, unit-testable with a fixture corpus, and its gate is the scoped nx command the
  orchestrator re-runs. **Recommendation: keep Glm, so the per-lane table gets a second, fair data
  point on a pure-code batch, with guardrails in the prompt: no background commands; no `gh`, no
  network; write the batch report before running the full nx command; a 30 min time box, after
  which the orchestrator stops the lane and takes what is on disk. Fallback: opencode (proven on
  pure code), then backend-developer subagent.** Do not use codex for its verification (30 s
  command kill); the `rg --json` Windows-path spec cases are short and fit any lane.
- Tasks: 1 | Depends on: 5, 6
- Phase: 1 Benchmark | Phase review: code-logic (after Batch 11)

### Task 8.1: rg/Glob/Read and `git log --grep` baselines per suite — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\baselines\rg-runner.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\baselines\native-baselines.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\baselines\native-baselines.spec.ts
- Plan reference: research-report.md:162-173 (B4)
- Pattern to follow: the B4 command list verbatim
- Quality requirements: same metrics and tokenizer as the tools; calls per answer = commands needed; references baseline has no cap and reports both recall and precision; `rg` resolved from `RG_PATH` then `PATH`, else the run fails with a clear message.
- Validation notes: no package.json change in Phase 1. The `rg --json` parse handles Windows paths. Carried from Batch 3: native baselines exist for every suite, including references and definitions. On `cli-headless` those suites have no tool, so the native baseline is the only measured side there.
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
- Tasks: 4 (Task 9.0 added at Batch 7 Mode 2) | Depends on: 3, 4, 4b, 4c, 4d, 7, 8
- Phase: 1 Benchmark | Phase review: code-logic (after Batch 11)
- Schema note (Batch 4 Mode 2): every suite is written in the Task 4b.1 generic shape — `kind:
  'retrieval'`, `claim {source, ref}`, `groundTruth`, `baselines[]` with `native` as one baseline id,
  `deltas`, `cost`, `details`. The `tool_metrics` / `native_metrics` / `delta` wording in the tasks
  below predates it and maps onto those fields. Added at Batch 4b Mode 2: `cost.source` is required
  (`'live'` for suites measured over the MCP transport, `'none'` for an `na` suite that made no
  call); `suite.projectionSha256` is optional and, when set, comes from `computeProjectionSha256`
  (`suite-kinds.ts:106`), never a hand-rolled hash.
- Added at Batch 7 Mode 2: Task 9.0 (TASK_2026_620 requests, handoff.md, accepted by the
  orchestrator) runs first. **File-count deviation:** Task 9.0 adds 5 files to Batch 9's 8 (13
  total, one project `mcp-bench`, one scoped command; precedent Batches 4 and 4d). The requests
  cannot fold into Tasks 9.1-9.3 within the cap, and the coordinator asked for them in Batch 9.
  Because TASK_2026_620 waits on these exports, the team-leader may commit Task 9.0 on its own as
  `batch 9 part 1` once its scoped checks pass, and send that SHA to the TASK_2026_620 session
  (handoff.md: send 620 the SHA of any commit that changes `scorecard/` or the bench-host files).
- Added at Batch 7 Mode 2: Batch 9 also reads `tools\mcp-bench\questions\scip\*.json` (Batch 7):
  the Python and Go reference and dependents question sets, and `ts-agreement.json`. References
  scoring follows the Batch 7 agreement analysis (see Task 9.1).

### Task 9.0: Exports and an explicit env option for TASK_2026_620 — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\scorecard\scorecard.types.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\host-launcher.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\host-launcher.spec.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\bench-host.entry.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\transport\bench-host-process.ts (new)
- Plan reference: handoff.md "TASK_2026_620 requests (2026-10-07)" items 1, 2 and 4 (item 3 was
  answered: `guard: { ci: true }` is correct for the 620 Linux CI job; no work)
- Pattern to follow: the registry-aware factory `createScorecardSchema(registry)` at
  scorecard.types.ts:121; `isolatedEnv(tempHome, parent)` at host-launcher.ts:248
- Quality requirements:
  - (1) Export the core per-suite zod schema from `scorecard.types.ts` (the suite object and its
    refinements that `createScorecardSchema` uses today, as a registry-aware factory plus the
    default-registry instance), so TASK_2026_620 can validate one suite without a whole scorecard.
    `createScorecardSchema` uses the exported schema; no change in what validates.
  - (2) `HostLaunchOptions.env?: Record<string, string>` on `launchBenchHost`, merged **after**
    `isolatedEnv(tempHome)`. Any key that isolation sets (`HOME`, `USERPROFILE`, `APPDATA`,
    `LOCALAPPDATA`, the four `XDG_*`, `PTAH_BENCH_ISOLATED_HOME`, `PTAH_CONFIG_PATH`,
    `PTAH_DB_PATH`; compare case-insensitively on win32) is refused: `launchBenchHost` rejects
    before spawning, the error names each refused key, and no temp home is left behind. Derive the
    refused list from `isolatedEnv`'s output, not a second hand-written list.
  - (4) Move the bench-host argument and shutdown helpers (`readWorkspaceArg`, `shutdownRequested`,
    `describeFailure`, and `FORCED_EXIT_AFTER_MS`) out of `bench-host.entry.ts` into the new
    `bench-host-process.ts` and export them; the entry imports them. Importing the new module must
    not start a host (the entry's `main()` stays in the entry). `readWorkspaceArg` returns or throws
    a typed error instead of calling `process.exit` inside the helper; the entry keeps its fatal
    line and exit code byte-identical.
- Validation notes: spec cases for (2): an allowed extra key reaches the child; each refused key
  (and a win32 case variant) rejects before spawn with no temp home left. The scorecard-writers and
  suite-kinds specs pass unchanged. Send the commit SHA to TASK_2026_620.
- Implementation details: keep `host-launcher.ts` under the 700-line `max-lines` ceiling.

### Task 9.1: Per-tool suite adapters and runner — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\suites\tool-suites.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\suites\suite-runner.ts
- Plan reference: research-report.md:147-158, :181-183; prompt claims at research-report.md:46-55
- Pattern to follow: each tool's input schema in D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\tool-description.builder.ts
- Quality requirements: suites for `ptah_code_search_symbols` (exact and concept), `ptah_relevance_rank_files`, `ptah_lsp_references`, `ptah_lsp_definitions`, `ptah_get_dependents`, `ptah_get_dependencies`, `ptah_get_symbol_index`, `ptah_memory_search`, `ptah_ast_analyze`, `ptah_context_enrich_file` (token ratio per size stratum), `ptah_search_files`, and `ptah_search_text` (`na` until the tool exists); each suite records its `claim` file:line; verdict = fail when the primary quality metric is below native by more than the noise margin, error rate is over 1%, or a lifecycle scenario fails.
- Validation notes: tool results are parsed tolerantly (text content). Parse failures count as errors, not as zero hits. Carried from Batch 3 (smoke, report line 65). (a) Read `tools/list` per host. A suite whose tool is not listed (today `ptah_lsp_references` and `ptah_lsp_definitions` on `cli-headless`) is `fail` with `mechanism: none` and the reason "tool not exposed on this host". It is never `na` and never a pass, because the prompt mandates these tools on every host. (b) `ptah_code_search_symbols` answering `symbolCount:0` with unknown coverage is scored through the Task 3.1 `unknown-coverage` class (error), with retries per the claim budget. (c) The `ptah_get_dependents` adapter must use the tool's real input schema from `tool-description.builder.ts`: try the absolute path, and record whether a relative `filePath` is rejected. A rejected relative path is a finding quoted in the report; the adapter may not hide it by always sending absolute paths without recording it. Carried from Batch 1: on win32, workspace-root relativisation in `normalizePath` (`retrieval-metrics.ts:50-67`) must be case-insensitive beyond the drive letter; add a spec case.
  Carried from Batch 4d: today every run downloads the embedding model again into the per-run temp
  home (`~/.ptah/models`, `register-thoth-libraries.ts:66`), which makes each cold search take about
  11.5 s and depend on the network. The runner passes in a shared, pre-seeded model cache under
  `resolveBenchDataDir()`, read-only to the host and never under the real `~/.ptah`, or it records
  the download time as a separate cold-start cost. It must not leave the download hidden inside
  query latency.
- Implementation details: `--smoke` takes 40 seeded questions per suite.
- Carried from Batches 5-7 (team-leader, Mode 2):
  - Read `tools\mcp-bench\questions\7910f34cf\*.json` and `tools\mcp-bench\questions\scip\*.json`;
    merge the Batch 5, 6 and 7 envelope zod schemas into one module (accepted short-lived
    duplication until here). The SCIP envelopes add `language`; an `na` record yields `verdict: na`
    with its reason.
  - References scoring (Batch 7 agreement analysis): the primary truth for `ptah_lsp_references` on
    the TS corpus is the Batch 5 TS language-service truth (editor "Find All References"
    semantics, the claim's meaning). Report the SCIP-strict set (each symbol separate, no
    implementations) as a second view next to it, never as the verdict. Python and Go references
    and dependents are scored against the SCIP sets in `python-attrs.json` / `go-logrus.json`; their
    unfilled strata are quoted, not padded.
  - Dependents questions (Batch 5 and the SCIP sets) carry `pathForms: ['relative','absolute']`:
    join the absolute form to this run's fresh corpus root.
  - Relevance: score the `test` split only; report recall@10 per `source` (pr, commit) and overall;
    quote the split composition (8 PRs, 192 commits).
  - Memory: call `seedMemory(target, set, roots)` from `afterContainerReady` with the isolated roots.

### Task 9.2: Lifecycle scenarios 1-8 — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\lifecycle\lifecycle-scenarios.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\lifecycle\lifecycle-scenarios.spec.ts
- Depends on: Task 9.1
- Plan reference: research-report.md:185-194 (B7); context.md:93
- Pattern to follow: Task 2.2's corpus copy
- Quality requirements: cold start, edit then query (5 s and 60 s), add then query, delete then query, large file (3,900 lines and 1.5 MiB), index age beyond 24 h (backdated rows in the isolated DB), two workspaces plus a worktree (memory leak count, spool path under the caller's root, symbol scope), transport (200 calls with 4-8 s idle gaps, one server restart, ECONNRESET count).
- Validation notes: never mutate the pinned corpus. Scenario 8's reset count feeds Batch 35's go/no-go. Carried from Batch 3: on `cli-headless`, cold start and edit/add-then-query are expected to fail today (no boot-time index, `symbolCount:0`, `reindexInFlight:true`); record them as failures, not `na`. With a running desktop Ptah the guard runs in `process-watch` mode (Task 4.2). A `ConcurrentWriterError` (CI, or no probe) is an environment failure of the run: report it, never retry it silently, and never weaken the guard. A `BenchHeldRealStateError` is an isolation failure: the run is void.
- Implementation details: each scenario is a scored case in `lifecycle[]`.
- Added at Batch 5/6 Mode 2 (context.md "Workspace hygiene", user request 2026-10-07), scenario 9,
  task tools in a worktree: in a temp git repository created for the scenario (`git init`, one
  commit, `git worktree add`, both under the scenario's temp folder, never the real repository),
  call `ptah_task_create` with `workspaceRoot` = the worktree path; assert the task folder lands
  under the worktree's `.ptah/specs` and the main checkout's `.ptah/specs` listing is unchanged; also
  assert a `workspaceRoot` outside the repository is rejected. Today the tools have no such argument,
  so the scenario is recorded as a failure (not `na`); Batch 34b must turn it to pass. No file-count
  change (same two files).

### Task 9.3: Bench CLI entry and targets — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\src\main.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\mcp-bench\project.json (targets `bench`, `generate`)
- Depends on: Task 9.2
- Plan reference: research-report.md:196-223
- Pattern to follow: the `nx:run-commands` targets in D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\tools\di-lint\project.json
- Quality requirements: flags `--host cli-headless|electron`, `--suite`, `--smoke`, `--out`, `--compare <baseline>`; writes the JSON and Markdown scorecards.
- Validation notes: a non-zero exit only when the run itself breaks; gate decisions belong to Batch 10.
  The run metadata is filled from the host's stop report: `run.guardMode` (from `guardMode`),
  `run.guard` (partial and the unprobed pid/name list, Task 4d.2) and `run.hostExit` (Task 4d.1). A
  `crash-on-shutdown` is recorded there and never added to a suite's error rate.
  Carried from Batch 5/6 planning (team-leader, MEDIUM): `withPinnedCorpus` force-removes every
  registered `ptah-mcp-bench-corpus-*` worktree under tmpdir at start (`corpus.ts:30`, `:116-129`),
  and it does not check whether that worktree is still in use. `git worktree list` is shared by
  every worktree of the repository, so a concurrent bench run deletes a live corpus. That includes
  a TASK_2026_620 run from its own worktree, and a second 619 run. The fix: only remove a corpus
  worktree whose owner is dead. For example, write a `.ptah-mcp-bench-owner` pid file at checkout
  and skip the worktree when that pid is alive. Add a spec case with two overlapping checkouts.
  This adds `corpus.ts` and `corpus.spec.ts` to this task (2 files; record the count deviation).
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
- Validation notes: boot must not wait on the run; failures are non-fatal and logged once. Respect the governor. Carried from Batch 3: the Phase 1 smoke showed `ptah_code_search_symbols` on `cli-headless` answering `symbolCount:0`, `reindexInFlight:true` with unknown coverage, about 11.6 s after a cold boot. The batch report quotes the same call before and after this change. It must show a non-zero `symbolCount` and a coverage state other than `census?` once the boot run completes.
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

## Batch 34b: Worktree-aware task tools (Fix 7 addendum, user request 2026-10-07) — PENDING

Added at Batch 5/6 Mode 2 from context.md "Workspace hygiene". Placement: a separate batch right
after Batch 34, not a third task inside it. Batch 34 already has 4 files (`protocol-dispatcher.ts`
and its spec, `memory-namespace.builder.ts` and its spec); this item adds at least 4 more
(`tasks-namespace.builder.ts` and its spec, `tool-description.builder.ts`, a root validator), which
breaks the 6-file cap. It also edits `protocol-dispatcher.ts` and its spec after Task 34.1, so it must
run after Batch 34, not in parallel with it.

- Recommended executor: backend-developer subagent
- Fallback executor: none (re-run with the same subagent type)
- Execution mode: sequential
- Rationale: a boundary check on a path argument that decides where files are written (a path
  outside the repository must never be accepted), plus a child-process `git` call. Security- and
  persistence-sensitive, so a subagent per the recorded defaults.
- Scorecard metric it must move: lifecycle scenario 9 (Task 9.2), task tools in a worktree, from
  fail to pass; no change in any other suite.
- Tasks: 2 | Depends on: 34 (same root-resolution area; shares `protocol-dispatcher.ts`)
- Phase: 2E Scope and transport | Phase review: code-logic (after Batch 35)

### Task 34b.1: Validated `workspaceRoot` in the tasks namespace — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\tasks-namespace.builder.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\tasks-namespace.builder.spec.ts; D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\vscode-lm-tools\src\lib\code-execution\namespace-builders\task-workspace-root.ts (new: the validator)
- Plan reference: context.md "Workspace hygiene (2026-10-07)", third bullet
- Pattern to follow: `deps.getWorkspaceRoot()` at tasks-namespace.builder.ts:677 (today's default);
  the `git worktree list --porcelain` parse in D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\task-specs\src\lib\git-task-folder-visibility.service.ts:141 and `NestedRepoRoots.fromWorktreeList` in D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\shared\src\lib\utils\nested-repo-roots.ts (reuse an exported parser if one exists; do not write a third one)
- Quality requirements: the five operations (create, update, get, list, check) accept an optional
  `workspaceRoot`. Absent → the session root exactly as today (byte-identical behaviour). Present →
  accepted only when, after resolving and comparing case-insensitively on win32, it equals the main
  checkout of the session root's repository or one of its registered worktrees from `git worktree
  list --porcelain` (run with an argument array, `cwd` = the session root, a timeout); otherwise the
  call fails with a clear error naming the path and the rule, and nothing is written. A `git`
  failure or timeout rejects a supplied `workspaceRoot` (fail closed) and never affects calls
  without one.
- Validation notes: spec cases: absent root (unchanged), the main checkout, a registered worktree, an
  unregistered sibling folder, a path outside the repository, a relative path, `git` failing. The
  default resolver chain (`ptah-api-builder.service.ts:992-1018`) is not changed.
- Implementation details: the validated root replaces `deps.getWorkspaceRoot()` for that call only.

### Task 34b.2: Tool schemas and dispatcher pass `workspaceRoot` through — PENDING

- File: D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\tool-description.builder.ts (the five `ptah_task_*` definitions from :94); D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\protocol-dispatcher.ts (:2475-2525); D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-core\protocol-dispatcher.spec.ts
- Depends on: Task 34b.1
- Plan reference: context.md "Workspace hygiene (2026-10-07)"
- Pattern to follow: the existing optional-argument shape of the `ptah_task_list` schema
- Quality requirements: each of the five schemas gains an optional `workspaceRoot` string, described
  as "absolute path of this repository's main checkout or one of its git worktrees; default: the
  session's workspace". `ptah_task_check`, which calls `tasks.check()` with no arguments today,
  forwards it too. No existing description text or claim is removed or weakened (recorded default:
  the prompt claims are not edited; adding an optional argument is not a claim change).
- Validation notes: `mcp-contract.sweep.spec.ts` must still pass unchanged; if it pins the schema
  shape, report it rather than editing it (the batch stays at 6 files).
- Implementation details: none.

### Batch 34b verification

- `npx prettier --check <every path the batch changed>` passes
- `npx nx run-many -t typecheck,lint,test -p @ptah-extension/vscode-lm-tools` passes
- `npx nx run mcp-bench:bench --host cli --suite lifecycle --smoke`: scenario 9 passes (before/after
  quoted against the baseline)

## Batch 35: HTTP keep-alive and timeouts (Fix 8, conditional on the Phase 1 scenario 8 evidence) — PENDING

- Recommended executor: CLI lane x 1
- Fallback executor: backend-developer subagent
- Execution mode: sequential
- Rationale: a small, isolated server-config change with a spec.
- Scorecard metric it must move: transport error rate (scenario 8 ECONNRESET count reaches 0)
- Tasks: 1 | Depends on: 34b
- Phase: 2E Scope and transport | Phase review: code-logic (this is the last batch of Phase 2E; review Batches 34, 34b and 35)

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
  store purge and transactional replace (Batch 12); memory scope is read-only (Batch 34); task
  folder writes may target a validated git worktree root (Batch 34b; default unchanged).
- Rendered visual evidence: N/A (no UI change).
- Findings to surface to the user:
  - The CLI exposes no code-intelligence MCP surface today (Risk row 1).
  - `ptah_search_text` has no prompt row (Assumptions).
  - Any suite still failing after Batch 36, with its claim line.
