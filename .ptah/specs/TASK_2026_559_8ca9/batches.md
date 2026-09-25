# Batches - TASK_2026_559_8ca9

Total tasks: 52 | Batches: 26 | Complete: 1/26

Amended 2026-09-25 (User Decision 7): Batch 2 → 2a-2f (reducer pipeline), Task 20.3 added, Task 21.1 extended.
Order: 1, 2a, 2b, 2c, 2d, 2e, 2f, 3, 4, 5, ..., 21.

Worktree root (every path below lives under it): `D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`
(written `<WT>` below). Branch `fix/task-559-mcp-tool-contract`, base `origin/main` 9afac1aa2.
Never write to the main checkout `D:/projects/ptah-extension`; reading it for a timing comparison (Batch 1) is allowed.

Inputs: task.md, context.md (User Decisions 1-5), research-report.md (merged), research/*.md, and the audit
`D:/projects/ptah-extension/.ptah/specs/TASK_2026_557_tokaudit/research-report.md`. BUGFIX, plan-free.

## Recorded defaults (execution preferences from the orchestrator + user decisions)

- Order: the shared fixes come first (diagnostics display cap → result budget + telemetry → caller identity →
  server instructions → index freshness). Per-tool fixes follow, grouped by file ownership. The two regression
  harness batches come last, so they measure fixed behaviour and do not lock in today's broken numbers
  (research-report.md "Regression harness", order dependency).
- Executors: Claude subagents only. `backend-developer` for server code and `senior-tester` for the two harness
  batches. No CLI lanes for implementation (Gate 0.1).
- Review: every batch gets its shipping-code review from ONE Codex CLI lane (the other execution side, per
  agent-lanes §6). The lane covers both logic and structure. The team-leader does not commit until it approves.
- Mode: every batch is **sequential**. `protocol-dispatcher.ts`, `tool-description.builder.ts` and
  `mcp-response-formatter.ts` are shared hub files that most batches edit, so two batches that touch them
  never run at the same time. The only file-disjoint batches are 5, 12 and 14 (they touch no hub file and no
  file used by any other batch). Batches 2a-2c touch only the new reducer lib and may also run next to 5, 12
  or 14, but never next to each other (shared `index.ts`). The orchestrator MAY run one of them next to a hub-file batch. It must never
  run two batches that share a file at the same time.
- Harness home: no new Nx target and no CI workflow edit. The existing `test` targets run on every PR through
  `nx affected -t test` (`.github/workflows/ci.yml:182`), which is the Nx target the harness uses. A change in
  `workspace-intelligence`, `memory-curator` or `cli-agent-runtime` puts that lib's own guards in the
  affected set. A spec that only logs a number does not count as a guard: every guard must fail the run.
- Contract text: `ptah-core-prompt.ts` constants and `NATIVE_AGENT_TOOL_POLICY` are never edited. Only
  per-tool description strings in `tool-description.builder.ts` whose claim is false today may change (User
  Decision 4). The "Use this FIRST" wording on `ptah_workspace_analyze` stays: Batch 10 makes it true.
- Result budget (User Decision 2, amended by User Decision 7): measured in tokens — 2,000 tokens default (the
  token equivalent of 8,000 chars) with an 8,000-char hard ceiling that `_meta` declares; see the "Batch 2
  amendment" block. Over budget, a deterministic per-content-type reducer runs first, then the cut. Task rows,
  symbol-index entries and agent-output lines get an offset/cursor parameter (Batches 9, 12/13, 15). Whenever the
  returned text differs from the raw, the raw is spooled to `.ptah/tmp/mcp-out/<id>.txt` and the trailer names the
  path and the reducer.
- Screenshot (User Decision 3): the image stays inline, the default becomes jpeg at quality 60, and the duplicate
  `onToolResult` re-encode is removed. No saveTo suppression and no auto-offload.
- Index refresh (User Decision 1): on the first symbol call, a lazy background reindex runs when `code_symbols`
  is empty or older than 24h. It goes through the existing governor (`userInitiated:false`, fire-and-forget).
  `ptah_code_reindex` is also exposed.
- Caller identity (User Decision 5): `tools/list` and `initialize` read the `_caller*` fields the HTTP handler
  already parses from the URL (`http-server.handler.ts:373-381`). `tools/list` does NOT move inside
  `runWithMcpRequestContext`.

## Plan validation

Status: PASSED WITH RISKS

Assumptions:

- `vscode-lm-tools` may import a value from `@ptah-extension/agent-sdk` without a cycle. Verified 2026-09-25
  with `nx graph`: agent-sdk does not reach vscode-lm-tools, and vscode-lm-tools already reaches agent-sdk
  transitively. `PTAH_MCP_SUBSTITUTION_SECTION` is exported from `ptah-core-prompt.ts` but not from the lib
  barrel. Batch 4 adds the barrel export only; the constant itself is unchanged. Task 4.1 re-checks lint
  module boundaries.
- The HTTP handler already sets `_callerSessionId`, `_callerAgentId` and `_callerWorkspaceRoot` from the URL on
  EVERY method, including `initialize` and `tools/list`. Verified at `http-server.handler.ts:373-381`.
  Task 3.1 re-checks this for the stdio/CLI path, which has no URL and should resolve to `anonymous`.
- `CodeSymbolIndexer.indexWorkspace(root, {userInitiated:false})` already waits on the governor
  (`code-symbol-indexer.service.ts:176-190`). Verified by reading the code. Task 6.1 must not await it
  (TASK_2026_437 deadlock, `code-namespace.builder.ts:184-188`).
- `AgentProcessManager.readOutput` has one production caller, `agent-namespace.builder.ts:324`. Verified by
  grep. Task 12.1 re-checks `agent-tool.dispatcher` because the doc comment names it as a consumer.
- `ptah.tasks.list` has one caller, the MCP dispatcher plus `execute_code`. The task board UI does not go
  through it. Verified by grep. Task 15.1 re-checks this before changing defaults.
- Resumed CLI sessions keep the original system/role context for every adapter that resumes natively.
  Unverified. Task 14.1 checks each adapter's resume mechanism and applies the skip only where the history
  really persists.
- The Codex `tool_search_always_defer_mcp_tools:false` guard already exists (`codex-cli.adapter.spec.ts:1277`),
  so shared fix #6 needs no code. Task 14.2 confirms it still fails when the value flips.
- `.ptah/tmp/**` is git-ignored (`.gitignore:131` `.ptah/**`; only `specs/` is re-included). Verified.
- `get_diagnostics` main-thread blocking and workspace-wide-only scoping are fixed at HEAD (`e70130bf5`). This is
  scheduled as verification (Task 1.1), not as a fix.

| Risk | Severity | Mitigation |
| --- | --- | --- |
| A global 8k cap cuts tools that already promise a larger bound (`ptah_browser_content` 32 KB, `ptah_surface_get_state` `maxStateReadBytes`), and silently truncates `get_diagnostics` before its own cap has sorted requested-file entries first | HIGH | Batch 1 lands the diagnostics cap before the budget; Task 2e.2 hints it `preformatted` so no generic reducer re-cuts it. Task 2e.2 adds a per-tool override table (default 8,000; an override only where the tool's own description documents a bound). The same table feeds `_meta['anthropic/maxResultSizeChars']` |
| Single-line JSON results (most `JSON.stringify` tools) have no newline to cut at, so a cut leaves invalid JSON in context | MEDIUM | Task 2e.2 (after the Batch 2b JSON reducer has compacted it): when there is no newline in the last 20% of the window, cut at a char boundary and ALWAYS spool the full text. The trailer states the payload is partial and names the spool path. The paging batches (9, 13, 15) keep the paged tools under budget so they never hit the cut |
| Spool filename collision: JSON-RPC ids restart at 1 per client, so `<toolCallId>.txt` from two sessions overwrites | MEDIUM | Task 2e.2: name the file `<sanitised id>-<epoch ms>-<4 random hex>.txt` under `<caller workspace root or workspace root>/.ptah/tmp/mcp-out/`, fall back to `os.tmpdir()` when there is no root, and keep a bounded directory size (delete files older than 24h on write) |
| A spool write failure (read-only disk, permissions) replaces the tool result | MEDIUM | Task 2e.2: spool errors are caught; the response still returns the capped text with a trailer saying the full text could not be saved. Never an error response. Spec covers it |
| Telemetry at `info` becomes the highest-volume log writer again (`protocol-dispatcher.ts:181-184`) | LOW | Task 2f.1: `debug` only, one line per call, inside `runObserver` |
| A lazy reindex inside a tool call deadlocks against the generating turn (TASK_2026_437) or runs twice concurrently | HIGH | Task 6.1: fire-and-forget with `userInitiated:false`, a per-workspace in-flight latch, and a re-check only after the 24h threshold. The explicit `ptah_code_reindex` full run starts in the background and returns at once (it can take minutes, past client tool timeouts); `filePath` runs are awaited |
| Adding a required method to `ICodeSymbolReader` breaks every test double (agent-sdk, electron, vscode-lm-tools) | MEDIUM | Task 5.1: `getIndexFreshness?` is OPTIONAL on the port; callers treat an absent method as "unknown freshness" and never trigger a reindex on it |
| `dashboard_propose_spec` hand-authored schema drifts from the Zod validator, so models send inputs that fail validation | MEDIUM | Task 16.1: every valid fixture the existing spec accepts must satisfy the advertised schema, and the Zod validator stays the enforcement point. A spec pins both |
| Default `tail` on `readOutput` hides the end of a report an orchestrator needs | MEDIUM | Task 12.1: the window is the LAST 200 lines (the completion report is at the end), plus `totalLines`/`omittedLines` and an `offset` parameter to page earlier lines. The description states the default (Task 13.1) |
| Skipping system context on resume for an adapter whose resume does NOT restore history loses the role and policy | HIGH | Task 14.1: skip per adapter, only where native resume is verified. `NATIVE_AGENT_TOOL_POLICY` and the completion contract are always kept. A spec per adapter class |
| `project-detector` monorepo-first change reclassifies single-app projects | MEDIUM | Task 10.1: existing `project-detector.service.spec.ts` single-signal fixtures must stay green unchanged; new combined Nx fixture added |
| A graph pre-warm at `tools/list` would run a ~5,000-file synchronous tree-sitter parse on the Electron main thread at session start (the B3 freeze class) | HIGH | Not built. Rows 5/6 are "Works". Task 9.2 measures cold first-call latency on this repo and records it; pre-warm stays out of scope unless the measurement shows the client times out |
| The worktree single-file 45s case has no confirmed cause | MEDIUM | RESOLVED at Batch 1 verification (2026-09-25). Task 1.2 (`research/diagnostics-worktree-repro.md`) refutes a worktree-specific cause: isolated main vs worktree runs are 22.7-26.6 s with identical programs. The mechanism is head-of-line blocking: `withBudget` answers at 45 s but keeps the run on the one shared per-compiler worker, so a later scoped call queues behind it (case e: 65 s blocker → 86 s scoped call). Batch 19 is re-scoped to the worker lane (see Batch 19) |
| Cold single-lib scope uses 50-60% of the 45 s budget (23-27 s; lib + spec programs of ~2,300-2,700 files each) | MEDIUM | Recorded, not fixed in 559: no task or user decision covers compile cost. Batch 19 removes the queueing that pushes a scoped call past budget; cold cost stays as measured. Named in the Mode 3 summary as a follow-up |
| Harness pins today's broken numbers | HIGH | Harness batches 20-21 run last, after every fix batch is committed |

Edge cases:

- `context_enrich_file` on an unsupported extension (`.py`, `.md`) → `mode:'full'` with `reason:'unsupported-language'`, never silently the same as a parse failure. Handled in Task 7.1 and Task 7.2
- `context_enrich_file` on `.tsx/.jsx/.mts/.cts/.mjs/.cjs` → inferred language via `EXTENSION_LANGUAGE_MAP`. Handled in Task 7.1
- Explicit `language` that contradicts the extension → the explicit value wins (today's behaviour). Handled in Task 7.1
- `code_search_symbols` on a host with no SQLite (VS Code) → the graceful "unavailable" result stays, and no reindex is attempted. Handled in Task 6.1
- Index empty (0 rows) vs stale (> 24h) vs fresh → only the first two trigger; the response carries `indexedSymbols`, `indexAgeMs` and `reindexStarted` so "stale" and "not found" read differently. Handled in Task 6.1
- `get_symbol_index` with `pathPrefix` matching nothing → `{files:[], count:0, total:0}` rather than an error. Handled in Task 9.1
- `task_list` cursor past the end → empty page, `nextCursor` absent. Handled in Task 15.1
- `agent_read` on a buffer shorter than the window → full buffer, `omittedLines:0`. Handled in Task 12.1
- `agent_status` repeated inside 60s for a now-exited agent → full body (the state changed). Handled in Task 13.2
- Diagnostics for requested files exceeding the cap alone → requested-file entries are never dropped in favour of siblings; siblings are summarised first. Handled in Task 1.3
- `tools/list` from a malformed URL segment → resolves to `anonymous`, never to another caller's identity. Handled in Task 3.1
- `initialize` from Codex and Claude → the same ≤512-char instructions (a single variant, byte-stable). Handled in Task 4.2
- Screenshot error path → `onToolResult` still receives the error text. Handled in Task 17.1
- `browser_evaluate` value `undefined`/`null`/circular → formatter behaviour stays the same below the cap. Handled in Task 18.1

## Interface recorded for TASK_2026_560_2ae5 (out of scope here)

Batch 3 delivers `McpCaller = { kind: 'session' | 'agent' | 'workspace' | 'anonymous'; sessionId?; agentId?;
workspaceRoot? }`, resolved once per request from the URL-parsed `_caller*` fields. It also gives
`handleToolsList` one composition point, `buildToolSet(caller, deps)`, which returns the ordered tool list.
560 layers its per-workspace effective set there, keyed on `(caller.kind, caller.workspaceRoot, caller.agentId?)`
and merged with `deps.disabledMcpNamespaces`, without changing the shape of `McpRequestContext`.
Batch 2e's per-tool budget table (`_meta['anthropic/maxResultSizeChars']`) gives 560's "token cost" UI a declared
result size. The schema size is `JSON.stringify(tool).length` of each entry `buildToolSet` returns. 559 ships NO
per-caller narrowing: no user decision licenses removing a tool from any caller. So "most restrictive profile
for an unknown caller" means `anonymous` gets today's default set, and the guard pins that.

---

## Batch 1: get_diagnostics — HEAD verification, worktree timing repro, output cap — COMPLETE

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation, with this batch's text only
- Execution mode: sequential
- Rationale: the repro must come before any worktree fix, and the display cap must land before Batches 2e/2f wrap this tool in the global budget (research-report.md Shared fix #2 order dependency)
- Review: Codex CLI lane (logic + structure)
- Tasks: 3 | Depends on: none

### Task 1.1: Verify the HEAD fixes for main-thread blocking and scoping — COMPLETE

- File: none modified. Evidence only, in the executor report
- Plan reference: research-report.md:363-376 ("Installed build vs HEAD"); research/workspace-files.md:173-285
- Pattern to follow: `<WT>/libs/backend/platform-core/src/testing/contracts/run-diagnostics-provider-contract.ts`
- Quality requirements: run the existing diagnostics specs and the provider contract self-spec. Confirm that `core-namespace.builders.ts:203-252` passes `files` as a scope and that the compile runs in the worker (`ts-diagnostics-worker.ts`)
- Validation notes: no fix code for blocking/scoping. If either is found broken at HEAD, stop and report. Do not fix
- Implementation details: `nx run-many -t test -p @ptah-extension/workspace-intelligence @ptah-extension/platform-core` (tail). Cite `file:line` for the worker offload and the scope pass-through

### Task 1.2: Timing repro for the worktree-scoped single-file 45s case — COMPLETE

- File: `<WT>/.ptah/specs/TASK_2026_559_8ca9/research/diagnostics-worktree-repro.md` (evidence) and a repro script next to it, `diagnostics-worktree-repro.ts` (not shipped)
- Plan reference: research/workspace-files.md:246-276
- Pattern to follow: `<WT>/libs/backend/workspace-intelligence/src/diagnostics/type-script-diagnostics-provider.ts:150-166` (typescript module resolution against the bound workspaceRoot)
- Quality requirements: time the worker directly for (a) a single file in the main checkout with the provider bound to the main root, (b) the same relative file in this worktree with the provider bound to the main root, (c) the same file with the provider bound to the worktree root. Record programCount, rootNames/config paths, file count and ms for each. The main checkout is READ-ONLY
- Validation notes: this task diagnoses. It does not fix. The conclusion names the mechanism with evidence, or says "not reproduced" with the numbers
- Implementation details: construct `TypeScriptDiagnosticsProvider` / the worker the way `type-script-diagnostics-provider.spec.ts` does, but on the real files; log the resolved tsconfig chain per call

### Task 1.3: Cap the diagnostics display, requested files first — COMPLETE

- Review rounds: r1 REVISE 5/10 (`reviews/batch-01-code-logic-review-r1.md`) → executor revision r1 (backend-developer); r2 REVISE 6/10 (`reviews/batch-01-code-logic-review-r2.md`) → revise cap reached
- Last correction: **orchestrator-authored**, not executor-authored. Per agent-lanes §6, after the revise cap the orchestrator made ONE bounded correction in `mcp-response-formatter.ts` and `mcp-response-formatter.spec.ts` only, for the two r2 defects: (1) `pathIdentity` uses Windows semantics (`path.win32.normalize`, then `\` → `/`, case folding) on a win32 host or for a drive-letter path, POSIX otherwise, with root detection for `/`, `x:/`, `//server/share`, so `D:/repo/../../repo/src/z.ts` keeps its drive and its diagnostic; (2) `RankedDiagnostic.requested` is kept apart from the display group, `requestedCoverage` is counted, the Requested files block names the coverage section instead of claiming clean, and the summary reads `C coverage failure(s) (K in requested files)`, each shown entry counted once. 4 new specs in the "TASK_2026_559 r1" block
- Post-cap independent review: Codex (cross-side to the in-process correction) **APPROVED 8/10**, 0 blocking/serious/moderate (`reviews/batch-01-code-logic-review-r3-postcap.md`). Non-blocking notes: the UNC spec would also pass on the previous normaliser; the POSIX branch was exercised through Node's `path.posix`, not a POSIX runtime
- Team-leader verification (2026-09-25): code read on disk at `mcp-response-formatter.ts` `formatDiagnosticList`/`scopedSummary`/`coverageClause`/`pathIdentity` — real logic, no stub markers; `nx run-many -t test,lint,typecheck -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence @ptah-extension/platform-core` → 9/9 targets successful
- Repro script `research/diagnostics-worktree-repro.ts` is NOT committed (this task says "not shipped"). It stays untracked in the worktree; the committed `research/diagnostics-worktree-repro.md` carries every number and the conclusion

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts` (`formatDiagnostics`/`formatDiagnosticList`, :223-300), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.spec.ts`, `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts` (`ptah_get_diagnostics` case, :692-710), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`
- Revision r1 files (added): `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/core-namespace.builders.ts` (`buildDiagnosticsNamespace`, :203-252), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/core-namespace.builders.spec.ts`, `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts` (`DiagnosticsPayload`, :198-203). 7 files in 1 lib: one over the 6-file cap, accepted because the dispatcher edit is one argument and the scope must be resolved where the root is (the namespace), not guessed in the formatter
- Revision r1 (Codex review REVISE 5/10, `reviews/batch-01-code-logic-review-r1.md`), three defects, each reproduced by a failing spec BEFORE the fix:
  1. BLOCKING — `mcp-response-formatter.ts:449` `pathKey` does not remove dot segments, so `D:/repo/src/../src/z.ts` never matches `D:/repo/src/z.ts`; with 60 earlier-sorting sibling errors the formatter prints "No diagnostics in the requested files" and drops `TARGET`
  2. SERIOUS — `mcp-response-formatter.ts:485` relative suffix match: `src/a.ts` also selects `D:/repo/packages/other/src/a.ts`, inflating the requested count and bypassing the sibling cap. Root cause: `protocol-dispatcher.ts:709` hands the formatter the raw request with no root; the provider resolves relative files with `path.resolve(file)` against the process cwd (`type-script-diagnostics-provider.ts:602`), not the workspace root
  3. SERIOUS — `mcp-response-formatter.ts:361-362` gives config coverage failures (error entries on a `tsconfig*.json`, line 0, produced by `withConfigFailures`, `type-script-diagnostics-provider.ts:628-658`) zero room once 50 requested entries fill the cap, so "NOT CHECKED" is reduced to a filename and a count
- Direction chosen (team-leader): `buildDiagnosticsNamespace` resolves every relative `files` entry against the same root it passes to the provider (`resolveRootPerCall`), passes the resolved absolute scope to the provider, and returns it as `DiagnosticsPayload.requestedFiles`. The formatter reads the scope from the payload only (the dispatcher stops passing `files`) and compares canonical identities: `path.resolve`-equivalent normalisation (dot segments, separators, trailing slash) plus win32 case folding, on BOTH the requested and the diagnostic paths. No suffix matching remains. Coverage failures (tsconfig basename AND line 0 AND severity error) render in their own always-shown section outside the 50-entry cap, are counted in `Shown N of M`, and are named in the summary; an ordinary tsconfig diagnostic with a line > 0 is no longer promoted
- Plan reference: research-report.md:98 (row 13), :156-159; research/workspace-files.md:264-266
- Pattern to follow: the deps/dev-deps "... and N more" cap at `mcp-response-formatter.ts:124-138`
- Quality requirements: pass the requested `files` into the formatter. List every diagnostic in a requested file first, then sibling-file diagnostics up to a total of 50 entries. Close with `Shown N of M (R in requested files, S in sibling files omitted)`. Error/warning totals stay exact. The "sibling files are still reported" contract holds (siblings are counted and named per file, not hidden)
- Validation notes: RISK "global cap cuts diagnostics" is carried here. The output must stay under 8,000 chars for 50 entries at typical message length. Assert that in the spec
- Implementation details: sort by (inRequested desc, severity, file, line). Specs: 200 diagnostics across 3 files with 1 requested → every requested-file entry is present, the summary line is exact, and length ≤ 8,000

### Batch 1 verification

- The Task 1.2 evidence file exists with numbers for all three runs and a stated conclusion
- `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence @ptah-extension/platform-core 2>&1 | tail -40` passes
- The Codex review lane approves
- The requested-files-first and summary edge cases are covered by specs
- Revision r1: specs for dot-segment absolute and relative requests with > 50 earlier-sorting sibling errors, a duplicate relative suffix with enough siblings to show bounded output, and coverage failures with exactly 50 and more than 50 requested entries plus two config failures. Each spec was shown failing on the pre-fix code
- Review file naming: the Codex lane writes the canonical `code-logic-review.md`; the team-leader moves it to `reviews/batch-NN-code-logic-review-rK.md` when it handles the verdict, so each round is kept (applies to Batch 2a onward: `reviews/batch-2a-code-logic-review-rK.md`, and so on)

---

## Batch 2 amendment (User Decision 7, recorded 2026-09-25 after Batch 1 implementation)

Batch 2 is split into 2a-2f. Each sub-batch keeps the cap (at most 6 hand-written files, at most 2 libs, one scoped
verification command). Recorded defaults, decided by the team-leader with the evidence named:

- **Home: a new lib, `libs/backend/tool-output-reducers` (`@ptah-extension/tool-output-reducers`), tags
  `["scope:extension","type:util"]`.** Evidence: `eslint.config.mjs:383-384` lets `type:util` depend only on
  `type:util`, and both future consumers (`vscode-lm-tools`, `agent-sdk` — the audit Wave 3 post-tool hook) are
  `type:feature`, so they may import it. Existing candidates were rejected: `workspace-intelligence` (tree-sitter
  home) is `type:feature` and logs through vscode-core `Logger` (`tree-sitter-parser.service.ts:2,76`), and
  pulling it into agent-sdk would bring the WASM grammars along; `platform-core` (`scope:shared,type:util`) is
  the platform-abstraction layer (interfaces, DI tokens, settings) that every host and the webview-shared scope
  sees, and content reducers are not platform abstraction; `vscode-core` is `type:util` but is the VS Code-bound
  logger/DI lib the amendment excludes. `mcp-core` is excluded by the amendment. Pattern for the lib shape:
  `libs/backend/persistence-sqlite` (`scope:extension,type:util`, targets build/test/lint/typecheck)
- **Dependencies: none new.** `gpt-tokenizer` (`package.json:161`) and `web-tree-sitter` (`package.json:195`) are
  already present. No readability/turndown/linkedom. No LLM
- **Logging:** reducers are pure functions and do not log. The pipeline takes an optional `IOutputChannel`
  (`PLATFORM_TOKENS.OUTPUT_CHANNEL`, `platform-core/src/di/tokens.ts:36`) for one line when a reducer throws. Never
  vscode-core `Logger`
- **Code outline without a feature-lib dependency:** the lib defines a `CodeOutliner` port. The adapter that wraps
  the existing tree-sitter services (`workspace-intelligence` `AstAnalysisService` / `ContextEnrichmentService`
  structural summary) lives in `vscode-lm-tools`, which already depends on workspace-intelligence
  (`vscode-lm-tools/package.json:15`). agent-sdk (Wave 3) supplies its own adapter or none
- **Budget unit: TOKENS.** `DEFAULT_TOOL_RESULT_BUDGET_TOKENS = 2000` — the token equivalent of User Decision 2's
  8,000 chars at ~4 chars/token, so the default is not loosened. Measured with `gpt-tokenizer` `encode` directly,
  not the per-host `ITokenCounter` (`PLATFORM_TOKENS.TOKEN_COUNTER`), so the count is identical on VS Code,
  Electron and CLI and the specs are deterministic. A hard char ceiling stays as a backstop and is what
  `_meta['anthropic/maxResultSizeChars']` declares: `DEFAULT_TOOL_RESULT_BUDGET_CHARS = 8000` (still exported;
  Batch 18 imports it). The returned text satisfies BOTH limits. Per-tool overrides are kept and expressed in both
  units: `ptah_browser_content` (32 KB + header chars; tokens = chars / 4) and `ptah_surface_get_state`
  (`maxStateReadBytes`)
- **When reducers run:** only when the raw text is over the token budget. Under budget → identity, byte-for-byte
  today's output (keeps small results and prompt caches stable). Over budget → detect → reduce → if still over,
  the Task 2e cut
- **Spool:** whenever the returned text differs from the raw text (reduced, cut, or both), the full raw output is
  spooled first, so nothing is lost. Under-budget identity results are not spooled (nothing was withheld). The
  trailer names the spool path, the reducer applied, and raw vs returned tokens:
  `[reduced: <reducer> — showing <t> of <T> tokens — full output: <path>]`
- **Content-type selection:** a per-tool hint table wins; sniffing is the fallback (JSON.parse succeeds → json;
  leading `<!doctype`/`<html`/tag-dense → html; `#`-heading structure → markdown; line-oriented with repeated
  lines or error markers → log; a file extension hint → code). Tools whose formatter already owns a documented
  reduction (`ptah_get_diagnostics` after Batch 1, the paged tools of Batches 9/13/15) are hinted `preformatted`:
  no content reducer, only the cut + spool, so the Batch 1 requested-file guarantee is never undone by a generic
  reducer
- **NOT in scope (not approved):** splitting `ptah_workspace_analyze`, new `ptah_outline` / `ptah_read` tools.
  Batch 10 keeps its original scope

Added risks:

| Risk | Severity | Mitigation |
| --- | --- | --- |
| A generic reducer applied to a formatter's Markdown (json2md output) drops body text a head-cut would have kept | HIGH | Markdown reducer = heading outline PLUS the head of each section in document order until the budget, never the outline alone; `preformatted` hint for tools with their own reduction (2e). Spec: every heading and the first line under each survive |
| JSON reducer changes meaning (dropping an empty field the caller asked about; a table that loses a nested key) | MEDIUM | Drop only `null`, `undefined`, `""`, `[]`, `{}`; a table only for arrays of ≥ 3 flat objects sharing ≥ 50% keys, missing cells rendered empty; nested values stay compact JSON in the cell. Reduction is only applied over budget and the raw is spooled |
| The in-house HTML extractor keeps nav/boilerplate or drops the article | MEDIUM | Strip `script/style/noscript/svg/template/iframe/nav/header/footer/aside/form`, prefer `<main>`/`<article>`/`[role=main]`, else the densest text block; spec on a generated page with nav + article + footer asserts the article text survives and nav links do not |
| Log dedupe hides the error that matters | HIGH | Every line matching the error pattern set (`error`, `Error:`, `FAIL`, `✕`, `failed`, `Exception`, stack frames `at …`, TS `TS\d+`) is kept with ±3 lines of context; dedupe collapses only identical consecutive/non-error lines into `(×N)`; head 40 + tail 80 lines always kept. Spec: a 5,000-line jest log with 3 failures keeps all 3 failure blocks |
| Tree-sitter outline unavailable (unsupported language, WASM load failure, VS Code host without grammars) | MEDIUM | Code reducer falls back to the log/plain head-tail reducer and the trailer names the fallback; never throws |
| Token counting on a large raw (MBs) is slow on the main thread | MEDIUM | Count only after a cheap char pre-check (`raw.length <= budgetTokens * 2` → skip encode, under budget); cap reducer input at 2 MB (spool keeps the rest); spec times a 1 MB input < 500 ms |

## Batch 2a: tool-output-reducers — lib scaffold, content detection, token measurement — PENDING

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: the lib and its contract come first; every reducer batch builds on the types and the token measure
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 1
- Cap note: the Nx generator's config files (project.json, package.json, tsconfig*.json, jest.config.ts, eslint config) are generated scaffolding and are counted as one artifact; hand-written files are ≤ 6

### Task 2a.1: Generate the lib — PENDING

- Files: `<WT>/libs/backend/tool-output-reducers/**` (generated), `<WT>/tsconfig.base.json` (path alias), `<WT>/libs/backend/tool-output-reducers/src/index.ts`
- Plan reference: context.md User Decision 7; the "Batch 2 amendment" block above
- Pattern to follow: `<WT>/libs/backend/persistence-sqlite/project.json` (tags, targets), its `jest.config.ts` and `tsconfig.spec.json`
- Quality requirements: `@ptah-extension/tool-output-reducers`, tags `["scope:extension","type:util"]`, targets build/test/lint/typecheck. Generate with the Nx generator the workspace uses (`nx g @nx/js:library`, jest, no bundler change beyond what persistence-sqlite has), then align with persistence-sqlite
- Validation notes: lint must pass `@nx/enforce-module-boundaries`; the lib imports only `@ptah-extension/platform-core` (type import of `IOutputChannel`), `@ptah-extension/shared` if needed, and `gpt-tokenizer`
- Implementation details: report the exact generator command and every generated file

### Task 2a.2: Reducer contract, content detection, token measure — PENDING

- Files: `<WT>/libs/backend/tool-output-reducers/src/lib/reducer.types.ts`, `<WT>/libs/backend/tool-output-reducers/src/lib/content-detector.ts`, `<WT>/libs/backend/tool-output-reducers/src/lib/content-detector.spec.ts`, `<WT>/libs/backend/tool-output-reducers/src/lib/token-measure.ts`, `<WT>/libs/backend/tool-output-reducers/src/lib/token-measure.spec.ts`
- Depends on: Task 2a.1
- Plan reference: amendment block above (content-type selection, budget unit)
- Pattern to follow: pure-function modules with co-located specs, e.g. `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts`
- Quality requirements: `ContentKind = 'html' | 'json' | 'log' | 'code' | 'markdown' | 'text' | 'preformatted'`; `OutputReducer = (input: string, ctx: ReduceContext) => ReduceResult` with `ReduceContext { budgetTokens; languageHint?; focusSymbol?; }` and `ReduceResult { text; reducer: string; notes?: string[] }`; `detectContentKind(text, hint?)` (hint wins); `countTokens(text)` via `gpt-tokenizer` `encode` with the char pre-check; `fitsBudget(text, {tokens, chars})`
- Validation notes: detection is deterministic; a JSON string that is also valid Markdown resolves to json; an empty string is `text`
- Implementation details: specs — one fixture per kind plus hint override; token count of a fixed string equals a pinned number; pre-check skips `encode` (spy) for short text; 1 MB input counted < 500 ms

### Batch 2a verification

- `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/tool-output-reducers 2>&1 | tail -40` passes
- The Codex review lane approves

---

## Batch 2b: JSON and Markdown reducers — PENDING

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: the two structured-text reducers; independent of parsers
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 2a

### Task 2b.1: JSON compactor — PENDING

- Files: `<WT>/libs/backend/tool-output-reducers/src/lib/reducers/json.reducer.ts`, `<WT>/libs/backend/tool-output-reducers/src/lib/reducers/json.reducer.spec.ts`
- Plan reference: context.md User Decision 7 (JSON → compact, drop empty fields, arrays of objects → table)
- Pattern to follow: Task 2a.2 contract
- Quality requirements: no pretty-print; drop `null`/`undefined`/`""`/`[]`/`{}` recursively; arrays of ≥ 3 flat objects sharing ≥ 50% keys → a pipe table (header = union of keys in first-seen order, missing cells empty, nested values as compact JSON); invalid JSON → returned unchanged with `reducer:'json-invalid'`
- Validation notes: RISK "JSON reducer changes meaning" carried here
- Implementation details: specs on SIZE (a 50 KB pretty-printed array of 300 objects → ≤ 40% of the input tokens) AND PRESERVED CONTENT (every non-empty scalar value of every row is present; `0` and `false` are never dropped)

### Task 2b.2: Markdown heading outline — PENDING

- Files: `<WT>/libs/backend/tool-output-reducers/src/lib/reducers/markdown.reducer.ts`, `<WT>/libs/backend/tool-output-reducers/src/lib/reducers/markdown.reducer.spec.ts`, `<WT>/libs/backend/tool-output-reducers/src/index.ts`
- Plan reference: context.md User Decision 7 (Markdown → heading outline)
- Pattern to follow: Task 2a.2 contract
- Quality requirements: every ATX/setext heading kept in order with its level; then the head of each section in document order until `budgetTokens`; fenced code blocks are never split mid-fence (drop the whole block and note `(code block, N lines, omitted)`)
- Validation notes: RISK "outline drops body" carried here
- Implementation details: specs on SIZE (a 40 KB doc with 30 sections → within budget) AND PRESERVED CONTENT (every heading present; the first non-empty line under each heading present; no unbalanced fence)

### Batch 2b verification

- `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/tool-output-reducers 2>&1 | tail -40` passes
- The Codex review lane approves

---

## Batch 2c: Log and HTML reducers — PENDING

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: the two line/markup reducers with the highest content-loss risk; reviewed together against the preserved-content guards
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 2b (index.ts ordering)

### Task 2c.1: Log / test / diagnostic output reducer — PENDING

- Files: `<WT>/libs/backend/tool-output-reducers/src/lib/reducers/log.reducer.ts`, `<WT>/libs/backend/tool-output-reducers/src/lib/reducers/log.reducer.spec.ts`
- Plan reference: context.md User Decision 7 (dedupe repeated lines, keep errors with context, keep head and tail)
- Pattern to follow: Task 2a.2 contract
- Quality requirements: head 40 + tail 80 lines always kept; every line matching the error pattern set kept with ±3 lines of context; identical repeated non-error lines collapsed to one line + `(×N)`; gaps marked `… N lines omitted …`; ANSI escape codes stripped
- Validation notes: RISK "log dedupe hides the error" carried here
- Implementation details: specs on SIZE (5,000-line jest log → within budget) AND PRESERVED CONTENT (all 3 `●` failure blocks with their assertion and first stack frame; a `TS2345` line; the final summary line in the tail)

### Task 2c.2: In-house HTML main-content extractor — PENDING

- Files: `<WT>/libs/backend/tool-output-reducers/src/lib/reducers/html.reducer.ts`, `<WT>/libs/backend/tool-output-reducers/src/lib/reducers/html.reducer.spec.ts`, `<WT>/libs/backend/tool-output-reducers/src/index.ts`
- Plan reference: context.md User Decision 7 (HTML → main-content text/Markdown, NO new dependencies)
- Pattern to follow: Task 2a.2 contract. No DOM library; a small tokenizer over tags is enough
- Quality requirements: remove `script/style/noscript/svg/template/iframe/nav/header/footer/aside/form` and comments; prefer `<main>`, `<article>`, `[role=main]`, else the block with the highest text density; emit Markdown for `h1-h6`, `p`, `li`, `pre/code`, `a` (text + href), `table` (pipe table); decode the common entities; malformed HTML never throws
- Validation notes: RISK "extractor keeps boilerplate" carried here. `package.json` must show no new dependency
- Implementation details: specs on SIZE (a 200 KB generated page → within budget) AND PRESERVED CONTENT (article headings and paragraphs present, nav link text absent, a `<pre>` block intact, an unclosed `<div>` does not throw)

### Batch 2c verification

- `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/tool-output-reducers 2>&1 | tail -40` passes
- `git diff -- package.json` is empty
- The Codex review lane approves

---

## Batch 2d: Code outline reducer (tree-sitter, existing parser services) — PENDING

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: the only reducer that crosses into workspace-intelligence; the port keeps the reducer lib `type:util`
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 2c (index.ts ordering)

### Task 2d.1: `CodeOutliner` port and the code reducer — PENDING

- Files: `<WT>/libs/backend/tool-output-reducers/src/lib/reducers/code.reducer.ts`, `<WT>/libs/backend/tool-output-reducers/src/lib/reducers/code.reducer.spec.ts`, `<WT>/libs/backend/tool-output-reducers/src/index.ts`
- Plan reference: context.md User Decision 7 (code → tree-sitter outline, reuse existing parser services)
- Pattern to follow: Task 2a.2 contract
- Quality requirements: `interface CodeOutliner { outline(source: string, language: string, focusSymbol?: string): Promise<string | null> }`; the reducer is async-capable (`ReduceResult | Promise<ReduceResult>`, update the contract if needed); when `focusSymbol` is given its full declaration body is kept verbatim in the outline; `null`/throw from the outliner → log-reducer fallback, trailer names it
- Validation notes: RISK "outline unavailable" carried here
- Implementation details: specs with a fake outliner: outline returned; focus symbol body present; outliner null → fallback; outliner throws → fallback, no throw

### Task 2d.2: Tree-sitter adapter in vscode-lm-tools — PENDING

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/code-outliner.adapter.ts`, `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/code-outliner.adapter.spec.ts`, `<WT>/libs/backend/vscode-lm-tools/package.json` (add `@ptah-extension/tool-output-reducers`)
- Depends on: Task 2d.1
- Plan reference: amendment block above (code outline without a feature-lib dependency)
- Pattern to follow: how `ptah_context_enrich_file` reaches `ContextEnrichmentService` / `AstAnalysisService` today (`namespace-builders/analysis-namespace.builders.ts:88-110`); `EXTENSION_LANGUAGE_MAP` for the language
- Quality requirements: implements `CodeOutliner` over the existing services, no new parser instance
- Validation notes: VS Code host without grammars → `null`, not a throw
- Implementation details: spec with the real `TreeSitterParserService` on a 300-line TS fixture: outline ≤ 40% of the source tokens AND every exported symbol name present AND the focus symbol's body present

### Batch 2d verification

- `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/tool-output-reducers @ptah-extension/vscode-lm-tools 2>&1 | tail -40` passes
- The Codex review lane approves

---

## Batch 2e: Reducer pipeline and the tool-result budget helper — PENDING

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: joins detection, reducers, token budget and spool into one call the dispatcher makes; original Task 2.1 now sits on top of the pipeline
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 2d

### Task 2e.1: `reduceOutput` pipeline — PENDING

- Files: `<WT>/libs/backend/tool-output-reducers/src/lib/reduce-output.ts`, `<WT>/libs/backend/tool-output-reducers/src/lib/reduce-output.spec.ts`, `<WT>/libs/backend/tool-output-reducers/src/index.ts`
- Plan reference: amendment block above (when reducers run, content-type selection, logging)
- Pattern to follow: Task 2a.2 contract
- Quality requirements: `reduceOutput(raw, { budgetTokens, budgetChars, hint?, languageHint?, focusSymbol?, outliner?, output?: IOutputChannel })` → `{ text, reducer: string | 'none', rawTokens, returnedTokens, reduced: boolean }`. Under budget → identity, `reducer:'none'`, no tokenizer call beyond the pre-check. Over budget → detect → reduce; `preformatted` skips reduction; a reducer that throws is caught, one line goes to `output`, and the result falls back to the raw for the cut. Reducer input capped at 2 MB. Pure except for the optional log
- Validation notes: RISKS "token counting slow" and "generic reducer undoes a formatter" carried here
- Implementation details: specs — identity under budget (byte-equal); each kind routed to its reducer; hint wins; throwing reducer → fallback + one output line; 1 MB input end-to-end < 1 s

### Task 2e.2: `tool-result-budget.ts` over the pipeline (original Task 2.1) — PENDING

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.ts` (new), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.spec.ts` (new)
- Depends on: Task 2e.1
- Plan reference: research-report.md:160-169; research/cross-cutting.md:259-273; context.md User Decisions 2 and 7
- Pattern to follow: `formatBrowserContent`'s `MAX_TEXT_LENGTH` trailer (`mcp-response-formatter.ts:1142`)
- Quality requirements: export `DEFAULT_TOOL_RESULT_BUDGET_TOKENS = 2000`, `DEFAULT_TOOL_RESULT_BUDGET_CHARS = 8000`, `TOOL_RESULT_BUDGET_OVERRIDES` (tokens + chars; only tools whose description documents a bound: `ptah_browser_content` at its 32 KB plus header, `ptah_surface_get_state` at its `maxStateReadBytes` bound), `TOOL_CONTENT_HINTS` (`ptah_get_diagnostics` and the paged tools → `preformatted`), `getToolResultBudget(name)`, and `applyToolResultBudget({ text, toolName, requestId, spoolRoot, outliner? })` → `{ text, reduced, truncated, reducer, rawTokens, returnedTokens, totalChars, spoolPath? }`. Order: `reduceOutput` → if still over either limit, cut at the last newline inside the window (none in the last 20% → cut at the limit) → spool the RAW whenever returned ≠ raw → trailer `[reduced: <reducer> — showing <t> of <T> tokens — full output: <path>]` (`reduced: none` when only cut), or `... full output could not be saved: <reason>` when the spool failed
- Validation notes: RISKS single-line JSON, spool collision and spool failure are carried here. Filename `<sanitised id>-<epoch ms>-<4 hex>.txt`. Delete spool files older than 24h on write, best effort. Never throw
- Implementation details: `fs.promises` writes; `spoolRoot` = `getCallerWorkspaceRoot()` ?? workspace root ?? `os.tmpdir()`, resolved by the caller. Specs: under budget = identity and no spool; over budget JSON → reduced, spool file byte-equal to raw; over budget single-line non-JSON → cut + spool; spool failure (mock fs rejects); collision (two identical ids → two files); override and hint table lookups; `preformatted` diagnostics text is cut, never reduced

### Batch 2e verification

- `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/tool-output-reducers @ptah-extension/vscode-lm-tools 2>&1 | tail -40` passes
- The Codex review lane approves
- Write-path trace recorded in the report: raw output → spool file → path in the trailer → read by the agent's Read tool. No settings or config write

---

## Batch 2f: Route every success response through the budget; telemetry; declare the budget in tools/list — PENDING

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: one choke point (`createToolSuccessResponse`, `protocol-dispatcher.ts:2019-2032`) covers every text tool. Original Tasks 2.2 and 2.3, unchanged in intent
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 2e

### Task 2f.1: Route every success response through the budget; debug telemetry (original Task 2.2) — PENDING

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`, `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`
- Plan reference: research-report.md:160-169, :200-204; research/cross-cutting.md:319-329
- Pattern to follow: `handleToolsCall`'s `finally` timing wrapper (`protocol-dispatcher.ts:551-573`); `runObserver` (:2040)
- Quality requirements: `createToolSuccessResponse` becomes async and applies `applyToolResultBudget` with the Batch 2d outliner (the tool name is passed in or read from `request.params.name`). `handleExecuteCodeCall` success text is budgeted too. `onToolResult` receives the same text the model gets. `handleToolsCall` logs one `debug` line per call — `{ tool, durationMs, resultChars, rawTokens, returnedTokens, reducer, truncated, isError }` — derived from the returned response, so error paths are covered too
- Validation notes: the telemetry-at-info risk is carried here. The image content block in the screenshot case is NOT budgeted (text only)
- Implementation details: update every `return createToolSuccessResponse(` call to `await`. Specs: a fake tool returning 50k chars of JSON → reduced response within both limits plus the trailer, spool byte-equal to raw; a fake tool returning a 50k-char log → failure lines present; the debug log carries the fields; an error response is logged with `isError:true`

### Task 2f.2: Declare the budget in `tools/list` (original Task 2.3) — PENDING

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts` (`handleToolsList`/`markEagerTools` area), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`
- Depends on: Task 2f.1
- Plan reference: research-report.md:167-168
- Pattern to follow: `markEagerTools` `_meta` stamping (`protocol-dispatcher.ts:486-503`)
- Quality requirements: every tool gets `_meta['anthropic/maxResultSizeChars'] = getToolResultBudget(name).chars`. Existing `_meta` keys are preserved. The `tools/list` output is byte-stable across two calls
- Validation notes: none beyond the Task 2e.2 table
- Implementation details: a spec asserting every listed tool carries the key and that its value matches the table

### Batch 2f verification

- `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/vscode-lm-tools 2>&1 | tail -40` passes
- The Codex review lane approves

---

## Batch 3: Caller identity for tools/list and the request context — PENDING

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: shared plumbing that TASK_2026_560 depends on, and it touches the dispatcher hub. User Decision 5 fixes the approach (URL parsing, no lifecycle move)
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 2f

### Task 3.1: `McpCaller` resolution and `callerAgentId` in the context — PENDING

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-caller.ts` (new), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-caller.spec.ts` (new), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-request-context.ts`, `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-request-context.spec.ts`
- Plan reference: research-report.md:170-181, :290-304; research/cross-cutting.md:275-291; context.md User Decision 5
- Pattern to follow: `getCallerSessionId`/`getCallerWorkspaceRoot` (`mcp-request-context.ts:50-62`)
- Quality requirements: `resolveMcpCaller(request): McpCaller`. Kind precedence: agent > session > workspace > anonymous. Empty or whitespace fields count as absent. `McpRequestContext` gains `callerAgentId` and a `getCallerAgentId()` getter
- Validation notes: confirm the stdio/CLI path (no URL) yields `anonymous`. A malformed field never borrows another caller's identity
- Implementation details: pure function, no I/O. Specs for each kind, precedence, and malformed/empty fields

### Task 3.2: Thread the caller into tools/list, tools/call and telemetry — PENDING

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`, `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`
- Depends on: Task 3.1
- Plan reference: research-report.md:170-181
- Pattern to follow: the `tools/call` `runWithMcpRequestContext` block (`protocol-dispatcher.ts:199-206`)
- Quality requirements: `handleToolsList` resolves the caller and composes the tools through `buildToolSet(caller, deps)`, which has today's order and today's set for every caller kind. `tools/call` context adds `callerAgentId`. The Batch 2f telemetry line adds `callerKind`
- Validation notes: guard that `tools/list` output is byte-identical across all four caller kinds and across repeated calls (prompt-cache stability). `anonymous` gets the default set
- Implementation details: the `ptah_agent_report` case keeps reading `request._callerAgentId` or switches to the context getter; either is fine as long as there is one source. Specs as above

### Batch 3 verification

- `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/vscode-lm-tools 2>&1 | tail -40` passes
- The Codex review lane approves
- The TASK_2026_560 interface above matches what shipped (names and shape); correct this file at verification if not

---

## Batch 4: Server `instructions` derived from the shipped mandate — PENDING

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: small, but it crosses into agent-sdk (barrel export only) and edits the dispatcher hub
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 3

### Task 4.1: Export the substitution section from the agent-sdk barrel — PENDING

- Files: `<WT>/libs/backend/agent-sdk/src/lib/prompt-harness/index.ts`, `<WT>/libs/backend/agent-sdk/src/index.ts`
- Plan reference: research-report.md:151-155; context.md User Decision 4 (constants unchanged)
- Pattern to follow: the existing `PTAH_CORE_SYSTEM_PROMPT` re-export (`agent-sdk/src/index.ts:284-286`)
- Quality requirements: export only. `ptah-core-prompt.ts` stays byte-identical (`git diff` must show no change to it)
- Validation notes: re-check `@nx/enforce-module-boundaries` lint for the new vscode-lm-tools → agent-sdk value import
- Implementation details: add `PTAH_MCP_SUBSTITUTION_SECTION` to both export lists

### Task 4.2: `server-instructions.ts` and `handleInitialize` — PENDING

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/server-instructions.ts` (new), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/server-instructions.spec.ts` (new), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts` (`handleInitialize`, :235-254), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`
- Depends on: Task 4.1
- Plan reference: research-report.md:151-155; research/cross-cutting.md:240-248
- Pattern to follow: the `tool-description.builder.spec.ts:25` length-assertion style
- Quality requirements: `buildServerInstructions()` DERIVES its text from `PTAH_MCP_SUBSTITUTION_SECTION`: it parses the substitution table rows (the "Instead of" → tool mapping) plus the "Fall back to Bash…" line, and never copies prose into a literal. The result is ≤ 512 chars, computed once, and returned as `result.instructions` for every caller
- Validation notes: guards — (a) length ≤ 512; (b) every tool name it lists appears in the constant; (c) a spec that feeds a modified section into the pure builder (export `buildServerInstructionsFrom(section)`) and sees the change reflected, which proves derivation
- Implementation details: when the full mapping does not fit in 512 chars, prioritise the rows in table order and end with `ptah.help()` for the rest

### Batch 4 verification

- `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/vscode-lm-tools @ptah-extension/agent-sdk 2>&1 | tail -40` passes
- `git diff --stat -- libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts` is empty
- The Codex review lane approves

---

## Batch 5: code_symbols freshness and exact-name recall (store layer) — PENDING

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential (file-disjoint from every hub-file batch; MAY run alongside Batches 2a-4)
- Rationale: store and port only. It is the foundation for Batch 6 and the home of the code_search_symbols recall guard
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: none

### Task 5.1: Optional `getIndexFreshness` on the port, implemented by the store — PENDING

- Files: `<WT>/libs/backend/memory-contracts/src/lib/code-symbol-reader.port.ts`, `<WT>/libs/backend/memory-contracts/src/index.ts` (only if a new type is exported), `<WT>/libs/backend/memory-curator/src/lib/code-symbol.store.ts`
- Plan reference: research/code-intel.md:294-313; research-report.md:182-190
- Pattern to follow: `CodeSymbolStore.count(workspaceRoot)` (`code-symbol.store.ts:206`)
- Quality requirements: `getIndexFreshness?(workspaceRoot): Promise<{ symbolCount: number; newestUpdatedAt: number | null }>` — optional on the port. The store implements it with one `COUNT(*), MAX(updated_at)` query scoped to the workspace root
- Validation notes: RISK "required method breaks test doubles" is carried here. Optional only
- Implementation details: prepared statement consistent with the store's existing statement style

### Task 5.2: Exact-name candidate source and the recall benchmark — PENDING

- Files: `<WT>/libs/backend/memory-curator/src/lib/code-symbol.store.ts` (`searchSymbols`, :295-342), `<WT>/libs/backend/memory-curator/src/lib/code-symbol.store.spec.ts`
- Depends on: Task 5.1
- Plan reference: research/code-intel.md:309-325
- Pattern to follow: the existing RRF fusion (`CODE_RRF_K`, `code-symbol.store.ts:107`)
- Quality requirements: add an exact `symbol_name = ?` lookup (case-sensitive, then case-insensitive) as a third candidate list, fused with a weight that puts an exact match at rank 1 whenever the row exists. BM25/vector behaviour for natural-language queries is unchanged
- Validation notes: the guard must FAIL on regression: seed ≥ 12 known symbols, including camelCase names the porter tokenizer would not split (e.g. `handleToolsList`, `createToolSuccessResponse`) → exact-name recall@1 = 100% and recall@5 ≥ 90%; a natural-language query still returns its target in the top 5; `getIndexFreshness` returns count and max timestamp
- Implementation details: real better-sqlite3 in-memory DB, as the existing spec uses

### Batch 5 verification

- `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/memory-curator @ptah-extension/memory-contracts 2>&1 | tail -40` passes
- The Codex review lane approves

---

## Batch 6: Index freshness at the MCP surface — lazy reindex and `ptah_code_reindex` — PENDING

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: governor and in-flight semantics need one executor who holds the whole path in mind
- Review: Codex CLI lane (logic + structure)
- Tasks: 3 | Depends on: Batches 2f, 5

### Task 6.1: `ensureIndexFresh` in the code namespace, and freshness in search results — PENDING

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/code-namespace.builder.ts`, `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/code-namespace.builder.spec.ts`
- Plan reference: context.md User Decision 1; research/code-intel.md:294-308
- Pattern to follow: `reindex()` (`code-namespace.builder.ts:163-195`); the TASK_2026_437 comment at :184-188
- Quality requirements: `ensureIndexFresh()` reads `getIndexFreshness` (skips when it is absent or there is no indexer). When `symbolCount === 0` or age > `CODE_INDEX_STALE_MS = 24h`, it starts `indexer.indexWorkspace(root, {userInitiated:false})` WITHOUT awaiting it. A per-workspace in-flight latch; the latch clears on settle; rejection is logged and swallowed. `searchSymbols` results gain `index: { symbolCount, indexAgeMs, reindexStarted, reindexInFlight }`. `reindex()` with no `filePath` starts a full run in the background (`userInitiated:true`, not awaited) and returns `{ started: true, ...freshness }`; the `filePath` path stays awaited
- Validation notes: RISK "deadlock / double run" is carried here. Specs: a stale index triggers exactly once across 3 concurrent calls; a fresh index never triggers; no freshness method → no trigger; indexer rejection does not surface as a search error; the result shape includes freshness
- Implementation details: inject the clock (`now()`) through deps for tests

### Task 6.2: `ptah_code_reindex` tool and dispatcher wiring — PENDING

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`, `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`, `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`
- Depends on: Task 6.1
- Plan reference: research-report.md:182-190
- Pattern to follow: `buildCodeSearchSymbolsTool` and its dispatcher case (`protocol-dispatcher.ts:1767-1792`)
- Quality requirements: `buildCodeReindexTool()` (optional `filePath`), registered in the `'code'` namespace group after `ptah_code_search_symbols`, and NOT eager. The `ptah_code_search_symbols` and `ptah_lsp_definitions` cases call `ptahAPI.code.ensureIndexFresh()` (fire-and-forget) before answering. The search response surfaces the freshness block
- Validation notes: VS Code (no indexer) → a graceful error result for reindex, and no throw from ensureIndexFresh
- Implementation details: specs for the new case (full → started, file → stats), the ensureIndexFresh call on both cases, and tools/list containing the tool under `code` only

### Task 6.3: Tool description guard — PENDING

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.spec.ts`
- Depends on: Task 6.2
- Plan reference: research-report.md:52-53 (the only existing size assertion)
- Pattern to follow: `tool-description.builder.spec.ts:25`
- Quality requirements: `ptah_code_reindex` description ≤ the same char budget the existing spec applies, with a schema that has only `filePath`
- Validation notes: none
- Implementation details: extend the existing describe block

### Batch 6 verification

- `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/vscode-lm-tools 2>&1 | tail -40` passes
- The Codex review lane approves

---

## Batch 7: ptah_context_enrich_file — infer language, name the fallback reason — PENDING

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: P0, never met since `2b537f44c`. The namespace layer fixes both MCP and `execute_code` at once
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 6 (hub-file ordering only)

### Task 7.1: Extension→language inference in `enrichFile` — PENDING

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.ts` (:88-110), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.spec.ts`, `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts` (`ptah_context_enrich_file` `language` property text: optional, inferred from the extension; tsx/jsx covered)
- Plan reference: research/code-intel.md:194-228; research-report.md:87
- Pattern to follow: `CodeSymbolIndexer.extensionToLanguage` (`code-symbol-indexer.service.ts:138-140`) over `EXTENSION_LANGUAGE_MAP`
- Quality requirements: explicit `language` wins. Otherwise infer from the extension (`.ts/.tsx/.mts/.cts` → typescript, `.js/.jsx/.mjs/.cjs` → javascript, plus whatever else the map supports that the service accepts). Unsupported → pass undefined
- Validation notes: explicit/contradicting-language edge case. Import the map through the workspace-intelligence public barrel; if it is not exported there, export it (that would be a 6th file — note it in the report)
- Implementation details: specs — `.ts` with no language → `mode:'structural'`; `.tsx` → structural; `.py` → full with reason `unsupported-language`; explicit language is forwarded unchanged

### Task 7.2: `reason` on full-content fallbacks — PENDING

- Files: `<WT>/libs/backend/workspace-intelligence/src/context-analysis/context-enrichment.service.ts` (`StructuralSummaryResult` :32, branches :95, :117-121, :129-134, `createFullContentResult` :354), `<WT>/libs/backend/workspace-intelligence/src/context-analysis/context-enrichment.service.spec.ts` (new)
- Plan reference: research/code-intel.md:209-213, :226-228
- Pattern to follow: existing result construction in the same file
- Quality requirements: `reason?: 'unsupported-language' | 'parse-failed' | 'read-failed'` on every `mode:'full'` result; structural results carry none
- Validation notes: "didn't try" and "tried and failed" are never identical
- Implementation details: specs for each branch with mocked file system, AST and token counter

### Batch 7 verification

- `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence 2>&1 | tail -40` passes
- The Codex review lane approves

---

## Batch 8: ptah_lsp_definitions (Electron) — fallback that does not depend on the index; LSP descriptions — PENDING

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: Electron-host resolver plus a correction to a false description (User Decision 4)
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 6

### Task 8.1: Import-resolution fallback in `declarationsFor` — PENDING

- Files: `<WT>/apps/ptah-electron/src/services/electron-ide-capabilities.ts` (:188-294, :534-553), `<WT>/apps/ptah-electron/src/services/electron-ide-capabilities.spec.ts`
- Plan reference: research/code-intel.md:498-519
- Pattern to follow: `resolveImportedModule` (`electron-ide-capabilities.ts:263-294`); the index-independent scan in `getReferences` (:302-415)
- Quality requirements: when the index yields zero candidates, resolve the identifier through the cursor file's own imports (or a same-file declaration) and scan that file for the declaration line. The result is ≥ 1 location for an imported symbol with an EMPTY index
- Validation notes: the guard must not rely on a mock that always returns data. Use a real temp fixture tree (two files, one importing a class from the other) plus a symbol reader returning no hits → the definition is still found. Keep the existing multi-candidate disambiguation behaviour
- Implementation details: bounded work, one resolved file read per call

### Task 8.2: Host-accurate LSP tool descriptions — PENDING

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts` (`ptah_lsp_references` :392-396, `ptah_lsp_definitions` :423-428), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.spec.ts`
- Plan reference: research/code-intel.md:508-512; context.md User Decision 4
- Pattern to follow: existing description style in the same file
- Quality requirements: state the mechanism per host (VS Code language server in the extension; symbol index plus import resolution in the desktop app). Every other claim stays. The shared prompt constants are not touched
- Validation notes: the description length stays within the existing spec budget
- Implementation details: spec asserting neither description claims "VS Code LSP" unconditionally

### Batch 8 verification

- `node_modules/.bin/nx run-many -t test,lint,typecheck -p ptah-electron @ptah-extension/vscode-lm-tools 2>&1 | tail -40` passes
- The Codex review lane approves

---

## Batch 9: ptah_get_symbol_index — pathPrefix/limit/offset; cold-latency measurement — PENDING

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: natural page unit = symbol-index entries (User Decision 2). The service stays untouched; paging is done at the namespace
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 8 (hub-file ordering)

### Task 9.1: Paging and filtering at the namespace and tool — PENDING

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.ts` (`getSymbolIndex` :381-400), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.spec.ts`, `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts` (:1840-1848), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`, `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts` (`buildGetSymbolIndexTool` :1815-1826)
- Plan reference: research/code-intel.md:362-377; research-report.md:89
- Pattern to follow: the response shape `{files, count}` today
- Quality requirements: optional `pathPrefix` (workspace-relative or absolute), `limit` (default 200, max 1000) and `offset`. The response is `{ files, count, total, offset, nextOffset? }`, deterministically ordered by path. The description states the defaults. A default call on a 2,655-file fixture stays ≤ 8,000 chars — if 200 entries do not fit, lower the default until they do, and say so in the report
- Validation notes: pathPrefix-matches-nothing edge case. Backward compatible for execute_code callers passing only `workspaceRoot`
- Implementation details: specs with a synthetic 3,000-entry index: default page size, prefix filter, offset continuation, last page has no nextOffset

### Task 9.2: Cold first-call latency measurement (rows 5/6) — PENDING

- File: none modified. Evidence in the report
- Plan reference: research/code-intel.md:420-438
- Pattern to follow: n/a
- Quality requirements: time `ensureDependencyGraphBuilt` cold on this worktree (script or a focused spec run locally, not committed), and record ms and file count
- Validation notes: RISK "pre-warm on main thread" — no pre-warm code is written in this task
- Implementation details: report the number and whether it exceeds a 60s client timeout

### Batch 9 verification

- `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/vscode-lm-tools 2>&1 | tail -40` passes
- The Codex review lane approves

---

## Batch 10: ptah_workspace_analyze — monorepo-first detection; bounded tree — PENDING

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: detector and renderer fixes together make "call FIRST" true again
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 9 (hub-file ordering)

### Task 10.1: Monorepo-aware project type — PENDING

- Files: `<WT>/libs/backend/workspace-intelligence/src/workspace/workspace.service.ts` (:367-420), `<WT>/libs/backend/workspace-intelligence/src/project-analysis/project-detector.service.ts`, `<WT>/libs/backend/workspace-intelligence/src/project-analysis/project-detector.service.spec.ts`
- Plan reference: research/workspace-files.md:92-117; research-report.md:96 (`e4e2a7bd6` incomplete)
- Pattern to follow: `ptah_project_detect_monorepo`'s detector (reference answer, research-report.md:100)
- Quality requirements: call `detectMonorepo` before `detectProjectType`. When it is a monorepo, report the monorepo type (e.g. `nx-monorepo`) and the per-app frameworks read from the app/package manifests, instead of one framework guessed from the root dependencies. Single-app detection is unchanged
- Validation notes: the existing single-signal specs stay green unchanged. New combined fixture: Nx monorepo, root deps with both react and @angular/core, no root angular.json, apps with their own project.json → never `react`, reports the monorepo plus the app set
- Implementation details: temp-dir fixture built in the spec

### Task 10.2: Tree depth/entry cap and excludes — PENDING

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts` (`renderDirectoryTree` :38-60, caller :169), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.spec.ts`
- Plan reference: research/workspace-files.md:99-106, :115-117
- Pattern to follow: the deps "... and N more" cap (:124-138)
- Quality requirements: max depth (e.g. 3), max entries per directory (e.g. 25, then "... and N more"), and skip `tmp/`, `dist/`, `.claude-worktrees/`, `.ptah/`, `node_modules/`, `.git/`, `coverage/`. A 500-flat-file directory renders under 4,000 chars; the whole analysis on the fixture stays ≤ 8,000
- Validation notes: if the structure walk (not the renderer) also needs excludes, name its file in the report. The renderer cap alone must satisfy the budget
- Implementation details: specs for depth, per-directory cap and excludes

### Batch 10 verification

- `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools 2>&1 | tail -40` passes
- The Codex review lane approves

---

## Batch 11: ptah_search_files truncation notice + ptah_relevance_rank_files reason dedupe — PENDING

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: two small P2 fixes on disjoint service files plus the formatter hub
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 10

### Task 11.1: `limit+1` probe, `atLimit` notice, pattern validation — PENDING

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts` (:682-690), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts` (`formatSearchFiles` :192), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter-extra.spec.ts`, `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`
- Plan reference: research/workspace-files.md:157-166
- Pattern to follow: `missingStringArgResponse` (`protocol-dispatcher.ts:1956`) for the empty pattern
- Quality requirements: request `limit+1`, slice to `limit`, and when more exist append `(showing first N; narrow the pattern or raise limit)`. An empty or non-string pattern is a tool error, not a thrown provider error
- Validation notes: none
- Implementation details: specs for at-limit, under-limit and empty pattern

### Task 11.2: Dedupe matched terms in relevance reasons — PENDING

- Files: `<WT>/libs/backend/workspace-intelligence/src/context-analysis/file-relevance-scorer.service.ts`, `<WT>/libs/backend/workspace-intelligence/src/context-analysis/file-relevance-scorer.service.spec.ts`
- Plan reference: research-report.md:94 (row 9)
- Pattern to follow: existing reason formatting in the file
- Quality requirements: a query with repeated words yields each matched term once in the reasons; scores are unchanged
- Validation notes: confirm the reason builder lives in this file; if not, name the real file in the report
- Implementation details: spec with query "auth auth token"

### Batch 11 verification

- `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence 2>&1 | tail -40` passes
- The Codex review lane approves

---

## Batch 12: ptah_agent_read — bounded default window in the service — PENDING

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential (file-disjoint; MAY run alongside a hub-file batch)
- Rationale: one source of truth for both agent surfaces (research/agent-task-harness.md:134-141). The type lives in `libs/shared`
- Review: Codex CLI lane (logic + structure)
- Tasks: 1 | Depends on: none

### Task 12.1: Default tail 200, `offset`, `totalLines`/`omittedLines` — PENDING

- Files: `<WT>/libs/shared/src/lib/types/agent-process.types.ts` (`AgentOutput` :215), `<WT>/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts` (`readOutput` :896-922), `<WT>/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.spec.ts`
- Plan reference: research/agent-task-harness.md:103-147; context.md User Decision 2
- Pattern to follow: `tailLines` in the same service
- Quality requirements: `readOutput(agentId, tail?, offset?)`. With no tail and no offset → the last `DEFAULT_AGENT_READ_TAIL_LINES = 200` lines per stream. `offset` (0-based line) + `tail` returns a forward window. `AgentOutput` gains `totalLines` and `omittedLines`; `lineCount` keeps meaning "lines returned"; the existing `truncated` (buffer-capacity flag) keeps its meaning
- Validation notes: RISK "default hides the end" — the default window is the TAIL. Re-check `agent-tool.dispatcher` (named in the doc comment) and report whether it is affected
- Implementation details: specs — a 1,000-line buffer with no args → 200 lines and omittedLines 800; offset 0 + tail 100 → the first 100; a short buffer → all lines, omitted 0

### Batch 12 verification

- `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime @ptah-extension/shared 2>&1 | tail -40` passes
- The Codex review lane approves

---

## Batch 13: agent_read / agent_status at the MCP surface — PENDING

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: surface wiring for Batch 12 plus the "ONE-OFF" status contract enforced in code
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batches 11, 12

### Task 13.1: Pass `offset`, render the window, describe the default — PENDING

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts` (:324), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts` (:848-859), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts` (`formatAgentRead` :636-665), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts` (`ptah_agent_read` :653-676)
- Plan reference: research/agent-task-harness.md:134-141
- Pattern to follow: existing `tail` plumbing
- Quality requirements: the formatter prints `Showing lines A-B of N (M omitted; pass offset/tail to page)` when lines were omitted. The description states the 200-line default and the `offset` parameter
- Validation notes: none beyond Batch 12
- Implementation details: covered by the specs in Task 13.2's files

### Task 13.2: 60s repeat-status throttle, and specs for both tasks — PENDING

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts` (:838-846), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`
- Depends on: Task 13.1
- Plan reference: research/agent-task-harness.md:89-95
- Pattern to follow: module-level maps already in the dispatcher (none exists; keep it bounded — prune entries older than 60s on each call)
- Quality requirements: a second status call for the same agentId within 60s whose status is unchanged returns one line: `Status unchanged since <iso> (<status>). Wait for <agent-lane-completed> instead of polling.` A status change or exit returns the full body
- Validation notes: edge case — exited agent → full body. The injected clock makes this testable
- Implementation details: specs — throttled repeat; changed status returns full; agent_read default renders the omitted-lines line; the default call on a 5,000-line buffer is ≤ 8,000 chars (or reports the omission and is within budget)

### Batch 13 verification

- `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/vscode-lm-tools 2>&1 | tail -40` passes
- The Codex review lane approves

---

## Batch 14: ptah_agent_spawn resume — stop resending the system/role prefix — PENDING

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential (file-disjoint; MAY run alongside a hub-file batch; does not share files with Batch 12)
- Rationale: 40.7% of Codex lane input (TASK_2026_557 RC3). One lib
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: none

### Task 14.1: Resume-aware `buildTaskPrompt` — PENDING

- Files: `<WT>/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts` (`buildTaskPrompt` :490-540), `<WT>/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.spec.ts`, plus at most two adapter files among codex/opencode/antigravity/cursor/pi/copilot if one must opt out (`<WT>/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/*.adapter.ts`)
- Plan reference: research/agent-task-harness.md:28-59
- Pattern to follow: `codex-cli.adapter.ts:666-669`
- Quality requirements: when `resumeSessionId` is set AND the adapter's resume restores prior history, omit `systemPrompt`/`projectGuidance` and the role block; keep `NATIVE_AGENT_TOOL_POLICY` (unchanged constant), the task and the completion contract. Adapters whose resume does not restore history keep the full prefix
- Validation notes: RISK "adapter resume without history" is carried here. The report lists each adapter with its evidence (`file:line`) for whether its resume restores history
- Implementation details: an explicit per-adapter flag or option (e.g. `resumeRestoresContext`), not a string check. Specs: resume excludes a 1,000-char system prompt but includes the policy and the completion contract; a fresh spawn is unchanged; a non-restoring adapter keeps the prefix

### Task 14.2: Confirm the Codex deferral guard — PENDING

- Files: `<WT>/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.spec.ts` (only if the existing assertion at :1277 would not fail on a flip)
- Plan reference: research-report.md:191-196
- Pattern to follow: `codex-cli.adapter.spec.ts:1277`
- Quality requirements: show that flipping `tool_search_always_defer_mcp_tools` at `codex-cli.adapter.ts:627` makes a spec fail (run it locally, revert, report). Add an assertion only if none fails
- Validation notes: no production change
- Implementation details: evidence in the report

### Batch 14 verification

- `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime 2>&1 | tail -40` passes
- The Codex review lane approves

---

## Batch 15: ptah_task_list / ptah_task_check — paged, summary by default — PENDING

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: P0, 223,297 chars live. Natural page unit = task rows (User Decision 2)
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 13 (hub-file ordering)

### Task 15.1: `limit`/`cursor`/`fields` on list — PENDING

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/tasks-namespace.builder.ts` (`TaskListArgsSchema` :204-207, `list()` :479-504), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/tasks-namespace.builder.spec.ts`, `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts` (`buildTaskListTool` :207-233)
- Plan reference: research/agent-task-harness.md:307-362
- Pattern to follow: the existing Zod args schemas in the same file
- Quality requirements: `limit` (default 25, max 200), `cursor` (opaque, stable ordering), and `fields: 'summary' | 'full'` (default summary drops `description`). The response adds `total` and `nextCursor?`. Existing status filters are kept. The description tells the agent how to get the full row (`ptah_task_get` or `fields:'full'`)
- Validation notes: re-check that no UI/RPC path uses `ptah.tasks.list` before changing defaults. Edge case: cursor past the end
- Implementation details: specs with 150 tasks: default ≤ 25 rows and ≤ 8,000 chars; cursor continuation covers all 150 with no duplicates; fields full includes description

### Task 15.2: Cap `invalid`/`excluded` in check — PENDING

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/tasks-namespace.builder.ts` (`check()` :506-538), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/tasks-namespace.builder.spec.ts`
- Depends on: Task 15.1
- Plan reference: research/agent-task-harness.md:368-385
- Pattern to follow: Task 15.1's `total` field
- Quality requirements: at most 50 entries each, plus `invalidTotal`/`excludedTotal`. The health verdict is computed on the full set
- Validation notes: none
- Implementation details: spec with 120 invalid folders

### Batch 15 verification

- `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/vscode-lm-tools 2>&1 | tail -40` passes
- The Codex review lane approves

---

## Batch 16: ptah_dashboard_propose_spec advertised schema; always-on description budgets — PENDING

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: always-on cost class (research/cross-cutting.md:129-134). The surface description text is NOT shortened — it is not a false claim, so User Decision 4 does not cover it. Only a growth guard is added
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 15

### Task 16.1: Minimal `$ref`-free advertised schema — PENDING

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/dashboard-propose-spec.tool.ts` (:43-100), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/dashboard-propose-spec.tool.spec.ts`
- Plan reference: research/agent-task-harness.md:394-437; research-report.md:108
- Pattern to follow: other hand-authored `inputSchema` objects in `tool-description.builder.ts`
- Quality requirements: the advertised schema covers the top-level shape and required keys and points to `ptah.help('dashboard')` for detail. The Zod validator stays the enforcement point. The tool definition's JSON is ≤ 3,000 chars (from 12.5k)
- Validation notes: RISK "schema drift" is carried here — every valid fixture in the existing spec validates against the advertised schema (use the repo's JSON-schema validator if present, otherwise a structural check of required keys and types), and every invalid fixture is still rejected by Zod
- Implementation details: char-budget spec on `JSON.stringify(buildDashboardProposeSpecTool())`

### Task 16.2: Growth guard for the surface tool definitions — PENDING

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/surface-tools.spec.ts`
- Plan reference: research-report.md:140-141 (rows 55-56)
- Pattern to follow: `tool-description.builder.spec.ts:25`
- Quality requirements: pin `ptah_surface_update` ≤ its current size + 5% and `ptah_surface_get_state` likewise (measure at HEAD, write the number in the spec with its date)
- Validation notes: no change to `surface-tools.ts`
- Implementation details: spec only

### Batch 16 verification

- `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/vscode-lm-tools 2>&1 | tail -40` passes
- The Codex review lane approves

---

## Batch 17: ptah_browser_screenshot — jpeg q60 default; drop the duplicate re-encode — PENDING

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: User Decision 3, exactly as recorded, nothing more
- Review: Codex CLI lane (logic + structure)
- Tasks: 1 | Depends on: Batch 16

### Task 17.1: Default format and `onToolResult` summary — PENDING

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/browser-namespace.builder.ts` (:276-286), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/browser-namespace.builder.spec.ts`, `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts` (:1152-1225), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`, `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts` (:1038-1058)
- Plan reference: context.md User Decision 3; research/browser.md:130-155
- Pattern to follow: existing screenshot case
- Quality requirements: with no format given → jpeg at quality 60 (an explicit png/webp/quality is honoured). The `image` block stays inline. On the success path, `onToolResult` receives a one-line summary (format, ~KB, saved path if any) instead of the base64 markdown block. The error path is unchanged. The description states the new default
- Validation notes: no saveTo suppression and no auto-offload (not decided)
- Implementation details: specs — default call passes jpeg/60 to capabilities; onToolResult text has no base64 and is < 300 chars; an explicit png is honoured

### Batch 17 verification

- `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/vscode-lm-tools 2>&1 | tail -40` passes
- The Codex review lane approves

---

## Batch 18: ptah_browser_evaluate — cap the stringified result — PENDING

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: closes the bypass around `browser_content`'s 32 KB cap. The test that pins unbounded output gets rewritten
- Review: Codex CLI lane (logic + structure)
- Tasks: 1 | Depends on: Batch 17

### Task 18.1: Budgeted `formatBrowserEvaluate` — PENDING

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts` (`formatBrowserEvaluate` :1058-1087), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter-extra.spec.ts` (:417-424 and a new over-cap case)
- Plan reference: research/browser.md:196-208
- Pattern to follow: `formatBrowserContent` `MAX_TEXT_LENGTH` (:1142)
- Quality requirements: the stringified value is capped at 8,000 chars (the Batch 2e char default `DEFAULT_TOOL_RESULT_BUDGET_CHARS`, imported from `tool-result-budget.ts`), with `[...truncated: N more chars — for page content use ptah_browser_content with a selector]`. Type and value rendering below the cap are unchanged
- Validation notes: edge case — undefined/null/circular values behave as today below the cap
- Implementation details: rewrite the 150-char pinning test to assert no truncation under the cap; add a 100 KB case asserting the trailer and the absence of the raw tail

### Batch 18 verification

- `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/vscode-lm-tools 2>&1 | tail -40` passes
- The Codex review lane approves

---

## Batch 19: get_diagnostics — scoped runs no longer queue behind an abandoned unscoped run; second-checkout guard — PENDING

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: RE-SCOPED at Batch 1 verification (2026-09-25) from the Task 1.2 evidence. The provisional target (`resolveTypescriptModulePath`, `type-script-diagnostics-provider.ts:150-166`) does not hold the mechanism; the worker scheduling does. Worker lifecycle and budget semantics need one executor who holds the whole path in mind
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 1 (evidence), Batch 18 (ordering)

### Task 19.1: Separate worker lane for scoped runs — PENDING

- Files: `<WT>/libs/backend/workspace-intelligence/src/diagnostics/ts-diagnostics-worker.ts` (`run`/`ensureWorker`, the per-`tsModulePath` worker map), `<WT>/libs/backend/workspace-intelligence/src/diagnostics/ts-diagnostics-worker.spec.ts`, `<WT>/libs/backend/workspace-intelligence/src/diagnostics/type-script-diagnostics-provider.ts` (`compute` → `withBudget`, :236-284: pass the lane), `<WT>/libs/backend/workspace-intelligence/src/diagnostics/type-script-diagnostics-provider.spec.ts`
- Plan reference: `.ptah/specs/TASK_2026_559_8ca9/research/diagnostics-worktree-repro.md` ("Results: head-of-line case", "Conclusion"); research/workspace-files.md:246-270
- Pattern to follow: the per-compiler worker map in `ts-diagnostics-worker.ts` (keyed by `tsModulePath`, idle self-termination, awaited `terminate()`, TASK_2026_325 finding 4)
- Direction chosen (team-leader, from the evidence): key workers by `(tsModulePath, lane)` where lane is `scoped | unscoped`, so a scoped run never waits behind an unscoped run on the same compiler. Terminating an abandoned unscoped run was rejected: it contradicts the documented `withBudget` invariant (`type-script-diagnostics-provider.ts:241-249` — the run is kept so a retry shares it or reads its cache, instead of starting a second full compile)
- Quality requirements: a scoped run posted while an unscoped run is still in flight on the same compiler completes in about its isolated time, not isolated + blocker time. Scoped runs still share one lane with each other; unscoped runs still share theirs. `withBudget`'s retain-and-cache behaviour, in-flight de-duplication and the 5 s result cache are unchanged. Each lane keeps the existing lifecycle: `unref` when idle, `ref` while a run is outstanding, idle self-termination, and `dispose()` awaits every lane's termination
- Validation notes: RISK — two lanes on one compiler can hold two typescript programs at once (memory). Bounded by the lane count (2 per compiler) and idle termination; the report states the bound. The worker-containment spec (`ts-diagnostics-worker-containment.spec.ts`) stays green unchanged. Cold single-lib compile cost (23-27 s) is out of scope — do not try to shrink it here
- Implementation details: guard spec with an injected slow worker (or a fake worker source): an unscoped run that holds its lane for a long time, then a scoped run → the scoped run resolves first and within its own time; two scoped runs still serialise on one lane; `dispose()` leaves no thread. Re-run the Task 1.2 case e script locally and put the before/after ms in the report (not committed)

### Task 19.2: Second-worktree case in the provider contract — PENDING

- Files: `<WT>/libs/backend/platform-core/src/testing/contracts/run-diagnostics-provider-contract.ts`, `<WT>/libs/backend/platform-core/src/testing/contracts/run-diagnostics-provider-contract.self.spec.ts`
- Plan reference: research/workspace-files.md:272-276
- Pattern to follow: the existing contract cases
- Quality requirements: a case that runs the provider for a file in a second checkout (a temp copy with its own tsconfig chain, standing in for a `git worktree add`) and asserts the same diagnostics as the primary copy within a fixed budget (10s)
- Validation notes: keep it hermetic — a small temp fixture, not this repo. Per Task 1.2 this case is expected to pass at HEAD; it is a regression guard for the config-chain resolution, not the proof of the Task 19.1 fix (that proof is Task 19.1's lane spec)
- Implementation details: the contract takes a factory for the second root

### Batch 19 verification

- `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/platform-core 2>&1 | tail -40` passes
- The Codex review lane approves

---

## Batch 20: Regression harness H1 — service-level benchmark vs native (size AND recall) — PENDING

- Recommended executor: senior-tester (sub-agent)
- Fallback executor: backend-developer
- Execution mode: sequential
- Rationale: a first-class guard for the mandated tools whose logic lives in `workspace-intelligence`. It runs in that lib's `test` target, which `nx affected -t test` runs in CI
- Review: Codex CLI lane (logic + structure)
- Tasks: 3 | Depends on: Batches 1-19 (including 2a-2f) committed

### Task 20.1: Generated fixture workspace — PENDING

- Files: `<WT>/libs/backend/workspace-intelligence/src/testing/mcp-contract/fixture-workspace.ts` (new; builds a temp tree at test time — no 500 checked-in files)
- Plan reference: research-report.md:222-255
- Pattern to follow: temp-dir fixtures in `project-detector.service.spec.ts`
- Quality requirements: an Nx-shaped monorepo with mixed root deps and no root angular.json; a 500-file flat directory; TS/TSX sources with known exported symbols, import edges and camelCase identifiers; a deterministic seed
- Validation notes: it cleans up after itself
- Implementation details: an exported `createMcpContractFixture()` → `{ root, knownSymbols, knownEdges, cleanup }`

### Task 20.2: Benchmark spec per mandated tool — PENDING

- Files: `<WT>/libs/backend/workspace-intelligence/src/testing/mcp-contract/mcp-contract.bench.spec.ts` (new)
- Depends on: Task 20.1
- Plan reference: research-report.md:240-249; TASK_2026_557 Wave 1.5
- Pattern to follow: n/a (new)
- Quality requirements: for `ptah_ast_analyze` (AstAnalysisService), `ptah_context_enrich_file` (ContextEnrichmentService, no language given), `ptah_get_dependents`/`ptah_get_symbol_index` (DependencyGraphService), `ptah_relevance_rank_files` (FileRelevanceScorer), `ptah_project_detect_monorepo` and the workspace_analyze project type (detectors), and `ptah_count_tokens`: assert (a) SIZE — the result is smaller than the native equivalent (the full file read / a regex grep over the tree) by the promised margin (`context_enrich_file` and `ast_analyze` ≥ 40% reduction on a 300-line file), and (b) RECALL — every known symbol, edge or dependent that the native grep finds is present. The detected project type is never `react` on the Nx fixture
- Validation notes: it FAILS the run on regression; it never only logs. Runtime < 30s so it stays in the normal `test` target
- Implementation details: real services, mocked only at platform boundaries (file system via the real fs on the temp root)

### Task 20.3: Reducer bench — size AND preserved content per content type (User Decision 7) — PENDING

- Files: `<WT>/libs/backend/tool-output-reducers/src/lib/reducers.bench.spec.ts` (new)
- Plan reference: context.md User Decision 7 ("Guards: each reducer gets specs on size AND on preserved content"); the "Batch 2 amendment" block
- Pattern to follow: Task 20.2 (fails on regression, never only logs)
- Quality requirements: one realistic generated input per kind, run through `reduceOutput` at the default budget: HTML page (nav + article + footer, ~200 KB), pretty JSON (~300 objects), jest log (~5,000 lines, 3 failures), a 300-line TS source via a fake outliner and via the no-outliner fallback, a 30-section Markdown doc. Assert (a) SIZE — returned tokens ≤ the default budget and ≤ a pinned reduction ratio per kind (measured at this HEAD, recorded with its date); (b) PRESERVED CONTENT — article headings/paragraphs, every non-empty JSON scalar in the kept rows, all 3 failure blocks and the summary line, the focus symbol's body, every Markdown heading. The lib cannot import workspace-intelligence (`type:util`), so the fixtures are generated in the spec
- Validation notes: runtime < 10 s. A deliberate local break of one reducer (e.g. log reducer dropping context) makes it fail — shown in the report, then restored
- Implementation details: table-driven over the kinds

### Batch 20 verification

- `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/tool-output-reducers 2>&1 | tail -40` passes
- A deliberate local revert of the Batch 7 inference makes the bench fail (shown in the report, then restored)
- The Codex review lane approves

---

## Batch 21: Regression harness H2 — dispatcher contract sweep and mandate manifest — PENDING

- Recommended executor: senior-tester (sub-agent)
- Fallback executor: backend-developer
- Execution mode: sequential
- Rationale: covers every tool in `tools/list` at the choke point, plus a manifest that fails when a prompt-mandated tool has no guard
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 20

### Task 21.1: Budget and size sweep over `tools/list` — PENDING

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-contract.sweep.spec.ts` (new)
- Plan reference: research/cross-cutting.md:271-273, :289-291
- Pattern to follow: `protocol-dispatcher.spec.ts` fake `PtahAPI` setup
- Quality requirements: for EVERY tool returned by `tools/list`, drive `handleMCPRequest` with a fake PtahAPI returning oversized data and assert the text is ≤ its `_meta['anthropic/maxResultSizeChars']` plus the trailer, or the tool's own documented page/cap. Pin the total `tools/list` JSON size (measured at this HEAD, +5% headroom) and byte stability across caller kinds. Every tool description stays within the per-tool char budget. This replaces the live `toolslist.py` re-run with a CI number
- Validation notes: a tool added later without a budget fails the sweep (it iterates the list; no hardcoded tool list)
- Implementation details: table-driven
- Extension (User Decision 7, reduced output): for every tool, the oversized fake payload is driven in each shape the tool can return (JSON, log text, Markdown, HTML where the tool returns page content). Assert: returned tokens ≤ the declared token budget; the trailer names a reducer (`preformatted` tools: `none`) and a spool path; the spool file is byte-equal to the raw payload; and a planted marker (an error line in logs, a heading in Markdown, a key/value in JSON, the article title in HTML) survives in the returned text. `ptah_get_diagnostics` is asserted NOT to be reduced (its Batch 1 requested-file entries survive verbatim up to the cut)

### Task 21.2: Mandate manifest — PENDING

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-mandate-manifest.spec.ts` (new)
- Depends on: Task 21.1
- Plan reference: research-report.md:240-245
- Pattern to follow: n/a
- Quality requirements: parse the tool names from `PTAH_MCP_SUBSTITUTION_SECTION` and require each to map to a named guard: a spec file path plus a test title that exists on disk. Mapping: code_search_symbols → the memory-curator recall bench (Batch 5); lsp_definitions → the electron spec (Batch 8); get_diagnostics → the platform-core contract (Batch 19) and the formatter cap (Batch 1); service tools → Batch 20; formatter tools → Batch 21.1. `ptah_web_search` is `exempt: 'external network'`; `ptah_get_dirty_files` and `ptah_lsp_references` are `exempt: 'host-only (VS Code/Electron runtime)'` unless a host spec covers them. Exemptions are explicit and have a reason
- Validation notes: a new mandated tool with no guard fails CI
- Implementation details: the file-existence and test-title checks use `fs` on the repo root

### Batch 21 verification

- `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/vscode-lm-tools 2>&1 | tail -40` passes
- The Codex review lane approves

---

## Completion notes for Mode 3

- Parity: no surface is replaced, consolidated, rebuilt or redesigned. Tools are fixed in place and `ptah_code_reindex` is added. Mode 3 re-checks this against `tools/list` at the base commit: every tool present at 9afac1aa2 must still be present.
- Visual: no UI change. N/A.
- Write paths: the spool files (Batch 2e) are the only new persisted write. The trace is recorded at Batch 2e verification. No settings or config writes. User-owned files (`~/.codex/config.toml`, `.claude/settings.local.json`) are never touched.
