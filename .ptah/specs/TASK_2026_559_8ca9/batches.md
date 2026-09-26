# Batches - TASK_2026_559_8ca9

Total tasks: 56 | Batches: 29 | Complete: 19/29 (Batch 11b scheduled as a follow-up round of Batch 11)

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

| Risk                                                                                                                                                                                                                                             | Severity | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A global 8k cap cuts tools that already promise a larger bound (`ptah_browser_content` 32 KB, `ptah_surface_get_state` `maxStateReadBytes`), and silently truncates `get_diagnostics` before its own cap has sorted requested-file entries first | HIGH     | Batch 1 lands the diagnostics cap before the budget; Task 2e.2 hints it `preformatted` so no generic reducer re-cuts it. Task 2e.2 adds a per-tool override table (default 8,000; an override only where the tool's own description documents a bound). The same table feeds `_meta['anthropic/maxResultSizeChars']`                                                                                                                                                                   |
| Single-line JSON results (most `JSON.stringify` tools) have no newline to cut at, so a cut leaves invalid JSON in context                                                                                                                        | MEDIUM   | Task 2e.2 (after the Batch 2b JSON reducer has compacted it): when there is no newline in the last 20% of the window, cut at a char boundary and ALWAYS spool the full text. The trailer states the payload is partial and names the spool path. The paging batches (9, 13, 15) keep the paged tools under budget so they never hit the cut                                                                                                                                            |
| Spool filename collision: JSON-RPC ids restart at 1 per client, so `<toolCallId>.txt` from two sessions overwrites                                                                                                                               | MEDIUM   | Task 2e.2: name the file `<sanitised id>-<epoch ms>-<4 random hex>.txt` under `<caller workspace root or workspace root>/.ptah/tmp/mcp-out/`, fall back to `os.tmpdir()` when there is no root, and keep a bounded directory size (delete files older than 24h on write)                                                                                                                                                                                                               |
| A spool write failure (read-only disk, permissions) replaces the tool result                                                                                                                                                                     | MEDIUM   | Task 2e.2: spool errors are caught; the response still returns the capped text with a trailer saying the full text could not be saved. Never an error response. Spec covers it                                                                                                                                                                                                                                                                                                         |
| Telemetry at `info` becomes the highest-volume log writer again (`protocol-dispatcher.ts:181-184`)                                                                                                                                               | LOW      | Task 2f.1: `debug` only, one line per call, inside `runObserver`                                                                                                                                                                                                                                                                                                                                                                                                                       |
| A lazy reindex inside a tool call deadlocks against the generating turn (TASK_2026_437) or runs twice concurrently                                                                                                                               | HIGH     | Task 6.1: fire-and-forget with `userInitiated:false`, a per-workspace in-flight latch, and a re-check only after the 24h threshold. The explicit `ptah_code_reindex` full run starts in the background and returns at once (it can take minutes, past client tool timeouts); `filePath` runs are awaited                                                                                                                                                                               |
| Adding a required method to `ICodeSymbolReader` breaks every test double (agent-sdk, electron, vscode-lm-tools)                                                                                                                                  | MEDIUM   | Task 5.1: `getIndexFreshness?` is OPTIONAL on the port; callers treat an absent method as "unknown freshness" and never trigger a reindex on it                                                                                                                                                                                                                                                                                                                                        |
| `dashboard_propose_spec` hand-authored schema drifts from the Zod validator, so models send inputs that fail validation                                                                                                                          | MEDIUM   | Task 16.1: every valid fixture the existing spec accepts must satisfy the advertised schema, and the Zod validator stays the enforcement point. A spec pins both                                                                                                                                                                                                                                                                                                                       |
| Default `tail` on `readOutput` hides the end of a report an orchestrator needs                                                                                                                                                                   | MEDIUM   | Task 12.1: the window is the LAST 200 lines (the completion report is at the end), plus `totalLines`/`omittedLines` and an `offset` parameter to page earlier lines. The description states the default (Task 13.1)                                                                                                                                                                                                                                                                    |
| Skipping system context on resume for an adapter whose resume does NOT restore history loses the role and policy                                                                                                                                 | HIGH     | Task 14.1: skip per adapter, only where native resume is verified. `NATIVE_AGENT_TOOL_POLICY` and the completion contract are always kept. A spec per adapter class                                                                                                                                                                                                                                                                                                                    |
| `project-detector` monorepo-first change reclassifies single-app projects                                                                                                                                                                        | MEDIUM   | Task 10.1: existing `project-detector.service.spec.ts` single-signal fixtures must stay green unchanged; new combined Nx fixture added                                                                                                                                                                                                                                                                                                                                                 |
| A graph pre-warm at `tools/list` would run a ~5,000-file synchronous tree-sitter parse on the Electron main thread at session start (the B3 freeze class)                                                                                        | HIGH     | Not built. Rows 5/6 are "Works". Task 9.2 measures cold first-call latency on this repo and records it; pre-warm stays out of scope unless the measurement shows the client times out                                                                                                                                                                                                                                                                                                  |
| The worktree single-file 45s case has no confirmed cause                                                                                                                                                                                         | MEDIUM   | RESOLVED at Batch 1 verification (2026-09-25). Task 1.2 (`research/diagnostics-worktree-repro.md`) refutes a worktree-specific cause: isolated main vs worktree runs are 22.7-26.6 s with identical programs. The mechanism is head-of-line blocking: `withBudget` answers at 45 s but keeps the run on the one shared per-compiler worker, so a later scoped call queues behind it (case e: 65 s blocker → 86 s scoped call). Batch 19 is re-scoped to the worker lane (see Batch 19) |
| Cold single-lib scope uses 50-60% of the 45 s budget (23-27 s; lib + spec programs of ~2,300-2,700 files each)                                                                                                                                   | MEDIUM   | Recorded, not fixed in 559: no task or user decision covers compile cost. Batch 19 removes the queueing that pushes a scoped call past budget; cold cost stays as measured. Named in the Mode 3 summary as a follow-up                                                                                                                                                                                                                                                                 |
| Harness pins today's broken numbers                                                                                                                                                                                                              | HIGH     | Harness batches 20-21 run last, after every fix batch is committed                                                                                                                                                                                                                                                                                                                                                                                                                     |

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

## Follow-ups (out of scope; for the Mode 3 summary / future-enhancements)

- Ptah Codex adapter kills a whole lane on one unparseable SDK event (recorded at Batch 2b review, 2026-09-25).
  The first Batch 2b review lane died with `Codex SDK Error: Failed to parse item: {"type":"item.completed",
"item":{... "type":"command_execution" ...}}` after running a large multi-line inline PowerShell here-string
  script; all lane work was lost. Expected: skip or log the unparseable event and keep the session. Not scheduled here.
- Cold single-lib diagnostics scope cost (see the risk table) — named here too so Mode 3 lists both.
- Batch 2b known issue KI-2b-1 (Markdown outline drops a paragraph-level inline HTML wrapper that spans a
  heading and exposes hidden content). Committed under User Decision 11; see "Batch 2b known issues". Not fixed
  in 559; needs a user decision to schedule.
- Batch 2c known issues KI-2c-1..KI-2c-7 (HTML extractor: character references, hidden-table foster content, CSS
  NBSP/`all` resets, closed `<details>`, unbounded anchor decoding, unknown-as-unequal anchor comparison,
  whitespace-only `<pre>`). Committed under User Decision 12; see "Batch 2c known issues". Not fixed in 559; the
  suggested direction is "refuse when unsure"; needs a user decision to schedule.
- Remove the dead `class` attribute collection in `html-tree.ts` (r5 minor) with that work.
- Batch 2d known issues KI-2d-1 (`.tsx`/`.jsx` always fall back, no JSX grammar) and KI-2d-2 (non-brace
  multi-line arrow bodies under-compress). Both are conservative; see "Batch 2d known issues". Not fixed in 559.
- Batch 4 follow-up (a): per-host server instructions filtered by the served tool set would fit more substitution
  rows than the single byte-stable 509-byte variant. Not approved scope; needs a user decision.
- Batch 7 known issues KI-7-1..KI-7-4 (`ptah_context_enrich_file` structural summary is lossy for decorator-run
  installers, instance-field installers, getter/coercion in kept literals, and elided pure-data objects over 400 chars).
  Committed under User Decision 13; see "Batch 7 known issues". Recommended first fix: KI-7-4 (keep keys, elide values).
  Also package `tree-sitter-tsx.wasm` so `.tsx` can be summarised (Batch 7 follow-up b). Needs a user decision.

---

## Batch 1: get_diagnostics — HEAD verification, worktree timing repro, output cap — COMPLETE (commit 87922d8a7)

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
- **Content-type selection:** a per-tool hint table wins; sniffing is the fallback (an object or array document
  that JSON.parse accepts → json; JSON scalars → text; leading `<!doctype`/`<html`/tag-dense → html;
  `#`-heading structure → markdown, unless the first line is a shebang or the lines outside fenced blocks carry code
  evidence once `# `-lines are set aside; line-oriented with repeated lines, level/timestamp prefixes or
  line-anchored structural error markers → log, where a bare word such as "error" or "failed" inside a sentence is
  not a marker; a file extension hint → code). Detector rule (Batch 2a r1): precision over recall. A
  structure-specific kind is returned only on positive structural evidence; ambiguous input resolves to `text`,
  which takes only the cut + spool. Reducer rule (2b-2d): a reducer given off-kind input may omit lines, but every
  line it emits is verbatim from the input (ANSI stripping and the `(×N)` collapse of identical consecutive lines
  excepted), it never merges or rewrites distinct lines, and it never returns empty text for non-empty input. Tools whose formatter already owns a documented
  reduction (`ptah_get_diagnostics` after Batch 1, the paged tools of Batches 9/13/15) are hinted `preformatted`:
  no content reducer, only the cut + spool, so the Batch 1 requested-file guarantee is never undone by a generic
  reducer
- **NOT in scope (not approved):** splitting `ptah_workspace_analyze`, new `ptah_outline` / `ptah_read` tools.
  Batch 10 keeps its original scope

Added risks:

| Risk                                                                                                            | Severity | Mitigation                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A generic reducer applied to a formatter's Markdown (json2md output) drops body text a head-cut would have kept | HIGH     | Markdown reducer = heading outline PLUS the head of each section in document order until the budget, never the outline alone; `preformatted` hint for tools with their own reduction (2e). Spec: every heading and the first line under each survive                                                                                                      |
| JSON reducer changes meaning (dropping an empty field the caller asked about; a table that loses a nested key)  | MEDIUM   | Drop only `null`, `undefined`, `""`, `[]`, `{}`; a table only for arrays of ≥ 3 flat objects sharing ≥ 50% keys, missing cells rendered empty; nested values stay compact JSON in the cell. Reduction is only applied over budget and the raw is spooled                                                                                                  |
| The in-house HTML extractor keeps nav/boilerplate or drops the article                                          | MEDIUM   | Strip `script/style/noscript/svg/template/iframe/nav/header/footer/aside/form`, prefer `<main>`/`<article>`/`[role=main]`, else the densest text block; spec on a generated page with nav + article + footer asserts the article text survives and nav links do not                                                                                       |
| Log dedupe hides the error that matters                                                                         | HIGH     | Every line matching the error pattern set (`error`, `Error:`, `FAIL`, `✕`, `failed`, `Exception`, stack frames `at …`, TS `TS\d+`) is kept with ±3 lines of context; dedupe collapses only identical consecutive/non-error lines into `(×N)`; head 40 + tail 80 lines always kept. Spec: a 5,000-line jest log with 3 failures keeps all 3 failure blocks |
| Tree-sitter outline unavailable (unsupported language, WASM load failure, VS Code host without grammars)        | MEDIUM   | Code reducer falls back to the log/plain head-tail reducer and the trailer names the fallback; never throws                                                                                                                                                                                                                                               |
| Token counting on a large raw (MBs) is slow on the main thread                                                  | MEDIUM   | Count only after a cheap char pre-check (`raw.length <= budgetTokens * 2` → skip encode, under budget); cap reducer input at 2 MB (spool keeps the rest); spec times a 1 MB input < 500 ms                                                                                                                                                                |

## Batch 2a: tool-output-reducers — lib scaffold, content detection, token measurement — COMPLETE (commit 7820e4d31)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: the lib and its contract come first; every reducer batch builds on the types and the token measure
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 1
- Cap note: the Nx generator's config files (project.json, package.json, tsconfig*.json, jest.config.ts, eslint config) are generated scaffolding and are counted as one artifact; hand-written files are ≤ 6

### Task 2a.1: Generate the lib — COMPLETE

- Files: `<WT>/libs/backend/tool-output-reducers/**` (generated), `<WT>/tsconfig.base.json` (path alias), `<WT>/libs/backend/tool-output-reducers/src/index.ts`
- Plan reference: context.md User Decision 7; the "Batch 2 amendment" block above
- Pattern to follow: `<WT>/libs/backend/persistence-sqlite/project.json` (tags, targets), its `jest.config.ts` and `tsconfig.spec.json`
- Quality requirements: `@ptah-extension/tool-output-reducers`, tags `["scope:extension","type:util"]`, targets build/test/lint/typecheck. Generate with the Nx generator the workspace uses (`nx g @nx/js:library`, jest, no bundler change beyond what persistence-sqlite has), then align with persistence-sqlite
- Validation notes: lint must pass `@nx/enforce-module-boundaries`; the lib imports only `@ptah-extension/platform-core` (type import of `IOutputChannel`), `@ptah-extension/shared` if needed, and `gpt-tokenizer`
- Implementation details: report the exact generator command and every generated file

### Task 2a.2: Reducer contract, content detection, token measure — COMPLETE

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
- Review r1 (`reviews/batch-2a-code-logic-review-r1.md`): REVISE, 6/10, 3 moderate. All four executor deviations
  accepted (exact `countTokens` with the shortcut in `fitsBudget`; UTF-8-byte acceptance bound; empty
  `disallowedSpecial`; no `IOutputChannel` in pure helpers). Decisions:
  - D1 prose → log (`content-detector.ts:25-26,129`): fix. Bare error words and a sentence starting "at …" are not
    log evidence; markers must be line-anchored structure (stack frame with a location, `Xxx(Error|Exception):` at
    line start, uppercase `ERROR`/`FAIL`/`FATAL` at line start, `●`/`✕`/`✖` runner markers, `error TS\d+` or
    `TS\d+:`, `Traceback (most recent call last)`). The repeated-line and prefix-ratio rules are unchanged: the log
    reducer only collapses identical consecutive lines, which loses nothing
  - D2 commented Python → markdown (`content-detector.ts:102,106-110`): fix. Shebang first line → not markdown;
    when the non-`# ` lines outside fenced blocks satisfy the code predicate, the `# ` lines are comments, not
    headings (both the first-line and the two-heading rules)
  - D3 JSON scalars → text (`content-detector.ts:68-75`, spec `:76-79`): RULE CHANGE, code kept. Scalars stay
    `text` on purpose: a scalar has nothing to compact; the 2b drop-empty rule would turn a top-level `null` or `""`
    into empty output; only a long string can exceed the budget, and the text path (cut + spool) handles it. The
    selection contract above now says so
  - Notes kept out of scope: `Infinity`/fractional budgets (`token-measure.ts:55-60`) are validated at the 2e
    pipeline boundary (configured budgets finite and positive); the single-sample 500 ms timing spec stays
- Executor revision r1 fixed D1 and D2; D3 recorded as the rule above
- Review r2 (`reviews/batch-2a-code-logic-review-r2.md`): REVISE, 6/10, 2 moderate — `FAILED …` prose → log
  (`content-detector.ts:42` at the time); a boolean fence toggle broke four-backtick blocks (`:152-155` at the time).
  Revise cap reached
- Bounded correction #1 (ORCHESTRATOR-authored, not the executor): an uppercase verdict marker needs a log shape
  after it; CommonMark fence tracking by delimiter char + length. Pre-correction code failed 4/36 specs, the
  correction passed 36/36; scoped test/lint/typecheck green
- Review r3-postcap (`reviews/batch-2a-code-logic-review-r3-postcap.md`): REVISE, 6/10, 2 moderate — a bare
  `ERROR`/`FATAL` word still counted as a `LOG_LINE_PREFIX` (prose → log); the correction's fence regex
  `/^\s*(`{3,}|~{3,})(.*)$/` was quadratic (3,446 ms on a crafted 65,530-char line)
- User Decision 8 (context.md): allow ONE more bounded correction plus one more independent review; if that
  review still finds defects, commit Batch 2a with them recorded as known issues
- Bounded correction #2 (ORCHESTRATOR-authored; `content-detector.ts` and `content-detector.spec.ts` only):
  `MARKDOWN_FENCE = /^\s*(`{3,}|~{3,})/`with`rest = line.slice(fence[0].length)` (`content-detector.ts:27,172`);
`LOG_LINE_PREFIX`level branch = bracketed level or a level followed by`:`/`|`, a `-`/`[`/`|` separator or end
of line (`:61-62`), timestamps unchanged. Specs: 2 bare-level prose → text, 3 level-shaped logs → log, a
65,530-char crafted line < 250 ms. Pre-correction code failed 3/42; the correction passes 42/42 (a literal
U+2028 in the spec was replaced with `String.fromCharCode(0x2028)` after lint flagged it)
- Review r4 (`reviews/batch-2a-code-logic-review-r4-postcap2.md`, FRESH Codex lane, independent of r1-r3):
  **APPROVED 8/10**, 0 blocking / 0 serious / 0 moderate. No known issues carried under User Decision 8
- Team-leader verification (Mode 2): all 12 lib files present, no TODO/PLACEHOLDER/STUB markers, `index.ts`
  exports the contract, detector and token measure; `nx run-many -t test,lint,typecheck -p
@ptah-extension/tool-output-reducers --skip-nx-cache` succeeded (3/3 targets)
- Known risks recorded (non-blocking): (a) bare level-word lines (`INFO  Server started …`) now resolve to
  `text`, an accepted recall loss under the precision rule — a caller with reliable knowledge supplies a `log`
  hint; (b) the 250 ms (detector) and 500 ms (token-measure) wall-clock specs carry CI scheduling risk — Batch 20/21
  decides whether timing specs move to a relative budget (e.g. against a linear baseline measured in the same run)

---

## Batch 2b: JSON and Markdown reducers — COMPLETE with known issue KI-2b-1 (commit 466925a34)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: the two structured-text reducers; independent of parsers
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 2a

### Task 2b.1: JSON compactor — COMPLETE

- Files: `<WT>/libs/backend/tool-output-reducers/src/lib/reducers/json.reducer.ts`, `<WT>/libs/backend/tool-output-reducers/src/lib/reducers/json.reducer.spec.ts`
- Plan reference: context.md User Decision 7 (JSON → compact, drop empty fields, arrays of objects → table)
- Pattern to follow: Task 2a.2 contract
- Quality requirements: no pretty-print; drop `null`/`undefined`/`""`/`[]`/`{}` recursively; arrays of ≥ 3 flat objects sharing ≥ 50% keys → a pipe table (header = union of keys in first-seen order, missing cells empty, nested values as compact JSON); invalid JSON → returned unchanged with `reducer:'json-invalid'`
- Validation notes: RISK "JSON reducer changes meaning" carried here. Reducer rule (Batch 2a r1): when a hint routes
  a top-level scalar, or dropping empties would leave nothing, return the input unchanged (`reducer:'json-unchanged'`);
  spec on `null`, `""`, `{}` and `{"a":null}`
- Safety contract (added at Batch 2a close): off-kind input (anything `JSON.parse` rejects — log text, Markdown,
  Python) is returned byte-for-byte unchanged with `reducer:'json-invalid'`, never empty. On-kind output may
  re-serialise (that is the compaction), but every non-empty scalar value survives, and a table never merges two
  different rows or two different keys into one cell. Spec: a JSON array whose objects differ only in one key's
  value keeps both values in distinct rows
- Implementation details: specs on SIZE (a 50 KB pretty-printed array of 300 objects → ≤ 40% of the input tokens) AND PRESERVED CONTENT (every non-empty scalar value of every row is present; `0` and `false` are never dropped)

### Task 2b.2: Markdown heading outline — COMPLETE (known issue KI-2b-1)

- Files: `<WT>/libs/backend/tool-output-reducers/src/lib/reducers/markdown.reducer.ts`, `<WT>/libs/backend/tool-output-reducers/src/lib/reducers/markdown.reducer.spec.ts`, `<WT>/libs/backend/tool-output-reducers/src/index.ts`, `<WT>/.commitlintrc.json`; Decision 9 round adds `<WT>/libs/backend/tool-output-reducers/project.json`, `<WT>/libs/backend/tool-output-reducers/jest.config.ts`, `<WT>/libs/backend/tool-output-reducers/tsconfig.spec.json`
- Plan reference: context.md User Decision 7 (Markdown → heading outline); context.md User Decision 9 (marked lexer rebuild)
- Pattern to follow: Task 2a.2 contract
- Quality requirements: every ATX/setext heading kept in order with its level; then the head of each section in document order until `budgetTokens`; fenced code blocks are never split mid-fence (drop the whole block and note `(code block, N lines, omitted)`)
- Validation notes: RISK "outline drops body" carried here. Reducer rule (Batch 2a r1): off-kind spec — an
  over-budget Python file with `# ` comments, fed to this reducer as if misdetected, emits only verbatim input lines
  in order plus omission notes, and never an empty result
- Safety contract (added at Batch 2a close): every emitted line is verbatim from the input (only omission notes are
  added); two different input lines are never merged or rewritten into one; non-empty input never yields empty
  text. Fence tracking follows the Batch 2a lesson (r2, r3-postcap): CommonMark — a fence closes only on the same
  delimiter char with a run at least as long and nothing after it, so a ` ` `block containing` ``` ````
  is one block; fence/heading regexes are unanchored-at-end and linear (no `(.*)$` after a repeated run). Edge
  case: when the headings alone exceed `budgetTokens`, keep every heading and return (the 2e cut + spool handles the
  rest) — do not drop headings to fit
- Also in this task: register the commit scope `tool-output-reducers` in `<WT>/.commitlintrc.json` `scope-enum`
  (alphabetical position not required; place it after `persistence-sqlite`). Batch 2a was committed scope-less
  because the scope was missing
- Implementation details: specs on SIZE (a 40 KB doc with 30 sections → within budget) AND PRESERVED CONTENT (every heading present; the first non-empty line under each heading present; no unbalanced fence)
- Revise round 1 (review r1: REVISE 4/10, `reviews/batch-2b-code-logic-review-r1.md`; JSON accepted, Markdown only).
  HISTORY — decisions 1-3 below (the hand-scanner recipe) are SUPERSEDED by the User Decision 9 direction further
  down; the principle and the decision 4 inputs still apply. Principle: when block structure is ambiguous, return the input unchanged (`markdown-unchanged`, a note naming
  the reason); the 2e cut + spool handles it honestly. Never promote, split or reword. Decisions:
  1. Setext (defect 1, `markdown.reducer.ts:136-145`): the WHOLE open paragraph plus the underline is the heading
     (CommonMark), kept together in order. If any paragraph line matches `LIST_OR_QUOTE` (not only the first),
     the underline is not a setext underline (body / thematic break). The executor's last-line deviation is withdrawn.
  2. Fences (defect 2, `markdown.reducer.ts:27`, `:160-193`): opener and closer both at 0-3 spaces of indent
     (tab = advance to the next multiple of 4). Outside an open top-level fence → unchanged when: a fence run
     follows a list marker or `>` prefix on the same line; a fence run is indented 4+ columns; or a fence
     opened at indent 1-3 contains a non-blank line indented less than its opener. Container detection is a
     hand scanner, not a nested-quantifier regex (linear).
  3. HTML (defect 3, `markdown.reducer.ts:112-133`): a line at 0-3 indent starting `<!--`, `<?`, `<![CDATA[`,
     `<!` + letter, or `<script|pre|style|textarea` (case-insensitive) opens an atomic unit ending at the line
     containing `-->` / `?>` / `]]>` / `>` / the closing tag; unterminated → unchanged. Any other line
     starting `<` + letter or `</` opens a candidate unit ending before the next blank line; if that candidate
     contains an ATX-heading, setext-underline or fence line → unchanged, else it is one atomic unit. An HTML
     unit is kept whole or replaced by `(html block, N lines, omitted)`; no heading detection inside it.
  4. Specs: the reviewer's four inputs, failing first, asserting literal expected output (not the shared
     helper). `fencesBalanced` in the spec moves to the 0-3 indent rule. The existing setext fixture
     (spec:189-227) gets a blank line before `Sub heading`, since its paragraph otherwise joins the heading
- Executor revise r1 (Markdown only): the four r1 inputs fixed; package 117/117; test/lint/typecheck green.
- Review r2 (fresh Codex lane, `reviews/batch-2b-code-logic-review-r2.md`): REVISE 4/10, 3 blocking — (1) the blank
  separator before a heading is dropped (paragraph→setext and HTML→setext re-parse as one block); (2) an outdented
  fence after a numbered-list continuation closes the wrong block, promoting `# still code` and swallowing `# Next`;
  (3) blank-separated Markdown inside `<details>` loses its wrapper and summary. The reviewer used the installed
  `marked` lexer as the structural oracle. Revise cap exhausted; the orchestrator judged it a design problem.
- **User Decision 9 (context.md:33): rebuild on the `marked` lexer** (root `package.json` `marked ^18.0.13`, already
  installed; NOT a new package). Headings kept; every other block kept or omitted whole by its exact `raw`. ONE more
  implementation round and ONE more independent (fresh) Codex review are authorized. Task 2b.1 (JSON) stays accepted.

#### Task 2b.2 direction under User Decision 9 (replaces the hand-scanner recipe)

Verified on disk by the team-leader, 2026-09-25 (probes run from a temp .mjs, then deleted):

- Packaging: `node_modules/marked/package.json` — v18.0.13, `"type":"module"`, `exports["."]` = `types` +
  `default: ./lib/marked.esm.js` only (ESM-only). `lib/marked.umd.js` sets `globalThis.marked` under Node `require`
  (exports nothing), so it is NOT usable as a CommonJS shim. Node v24.15.0 `require()` of the ESM file works.
- Jest: ts-jest with `tsconfig.spec.json` (`module: commonjs`) will get the ESM file. Precedent:
  `libs/backend/platform-electron/jest.config.ts:15` (`transformIgnorePatterns`) + its `tsconfig.spec.json:8`
  (`allowJs: true`). Apply the same here: `transformIgnorePatterns: ['node_modules/(?!marked/)']` and `allowJs: true`
  in this lib's `tsconfig.spec.json` (module stays commonjs, so ts-jest emits CJS).
- Typecheck: `tsconfig.lib.json` uses `moduleResolution: bundler` → resolves `exports.types`. The spec config
  (`node10`) resolves the top-level `"types": ./lib/marked.d.ts`. `Lexer`, `getDefaults` and
  `Lexer#blockTokens(src, tokens?)` are public in `marked.d.ts:539-633`.
- Lint: this lib's `eslint.config.mjs` is the base config only — no `@nx/dependency-checks`; enforce-module-boundaries
  constrains workspace libs, not npm packages. No lint change expected.
- Lib build: `project.json` build is esbuild `format: cjs` with `external: ["gpt-tokenizer"]` → add `"marked"`. The
  apps consume this lib from source via the `tsconfig.base.json:238` path, not the dist.
- Consumers (for Batch 2e/2d, NOT this batch): `apps/ptah-extension-vscode` bundles third-party code (esm,
  `thirdParty: true`) → marked is bundled into the extension host. `apps/ptah-electron` build-main is esm,
  `thirdParty: false`, `generatePackageJson: true` → marked stays external. `apps/ptah-cli/project.json:70` already
  lists `marked` as external, but no `apps/*/package.json` lists `marked` → see the new RISK on Task 2e.1.
- Global state: `new Lexer({ ...getDefaults(), gfm: true, pedantic: false }).blockTokens(src, [])` was unaffected by
  a prior `marked.use({ tokenizer })` in the same process. The Lexer constructor writes `tokenizer` into the options
  object it is given → build a FRESH options object per call. `blockTokens` returns the same top-level raws as
  `lex` (checked on 12 edge cases) and skips the inline pass, which is never needed here. Do NOT use `marked.lexer`,
  `marked.use`, `setOptions`, extensions or hooks: `marked.lexer` runs through the process-global `marked` instance
  (any `use()` elsewhere in the host changes it) and also runs the unused inline pass.
- Raw reconstruction: `tokens.map(t => t.raw).join('') === src` held for every r1/r2 input, setext, tables, tabs,
  whitespace-only lines, NUL, lazy quotes, trailing-newline-free input. It FAILS for: CRLF (the lexer rewrites
  `\r\n|\r` to `\n`), and duplicate link definitions (the second `[a]: …` raw is dropped).
- Lexer quirks the design depends on: a heading or paragraph raw often carries NO trailing `\n` — the line
  terminator lives in the following `space` token (`"# A"`, `"\n\n"`). A leading U+FEFF makes `# A` a paragraph.
  Front matter `---\ntitle: x\n---` lexes as hr + setext H2 (CommonMark-correct; accepted).
- r2 inputs under the lexer: d1a → heading,html,space,heading(2),paragraph; d1b → heading,paragraph,space,
  heading(2),paragraph; d2 → heading,list,code(` ```\n# still code\n``` `),heading(`# Next`),paragraph;
  d3 → heading,html(`<details>\n<summary>…</summary>`),space,heading(`# delete production`),space,html
  (`</details>…`). So d1 and d2 are fixed by construction; **d3 is NOT** — the lexer exposes the inner heading
  as top-level, so rule H below is required.
- Cost (blockTokens, Node 24, this machine): 2 MB ordinary doc 327 ms; but list/quote-heavy input runs about
  0.3-1.5 s per MB even at shallow nesting (1 MB `- - … x` at 16 levels: 1,347 ms). Deep nesting is fatal:
  a nested list 2,000 levels deep (4 MB) exhausted the 4 GB heap (process abort, NOT catchable); 1,000 levels
  (1 MB) took 1,678 ms; blockquote depth ≥ ~4,000 throws `RangeError` (catchable, ~40 ms per 8 KB before it
  throws). At 256 KiB the worst measured pattern (under the prefix guard below) was 386 ms; ordinary docs 36 ms.

Design (the safety contract is unchanged in spirit; restated precisely for the lexer):

1. Pre-guards, in order, each → `markdown-unchanged` returning the ORIGINAL input bytes with a reason note:
   (a) `input.length > MAX_OUTLINE_CHARS` (262,144) → `input larger than 256 KiB; not outlined`;
   (b) nesting guard, one linear pass over lines: the maximal leading run of chars from
   `{space, tab, '>', '-', '+', '*', '0'-'9', '.', ')'}` longer than 64 chars AND containing at least one
   non-whitespace char → `container nesting too deep to outline safely`. A pure-whitespace indent is not counted
   (that is indented code, cheap). Spec both guards.
2. Normalise: `text = input.replace(/\r\n?/g, '\n')`; strip one leading U+FEFF into `bom` (re-emitted first in a
   reduced output). Lex `text` (without BOM) with the fresh-options Lexer above via `blockTokens(text, [])` inside
   try/catch → on throw, `markdown-unchanged` with `markdown lexer failed: <error.name>`.
3. Reconstruction check: `tokens.map(t => t.raw).join('') !== text` → `markdown-unchanged`,
   `lexer tokens do not reproduce the input`. A reduced output is LF-only (accepted at r2: the contract does not
   require CRLF terminators on reduced output); every unchanged path returns the original bytes, CRLF included.
4. Rule H — HTML wrappers: for every top-level token whose type is not `code` or `space`, scan `raw` once with
   `/<(\/?)([A-Za-z][A-Za-z0-9-]*)(?=[\s/>]|$)/g` and tally opens minus closes per lower-cased name. Names checked:
   in `html` tokens every name except the void set (`area base br col embed hr img input link meta param source
track wbr`); in every other scanned token only the CommonMark type-6 block names (`address article aside
blockquote body caption center colgroup dd details dialog dir div dl dt fieldset figcaption figure footer
form frameset h1-h6 head header html iframe legend li main menu menuitem nav noframes ol optgroup option p
search section summary table tbody td tfoot th thead title tr ul`). Any non-zero tally in any token →
   `markdown-unchanged`, `HTML element spans Markdown blocks`. This fixes r2 d3 (`<details>` opens in one token)
   and the nested `<div><div>…</div>` + blank + heading + `</div>` variant. Known false positive (safe, recall
   only): a paragraph mentioning `<div>` in inline code is left unchanged.
5. Sections: top-level `heading` tokens only are outline headings (a heading inside a list or block quote belongs
   to that atomic block). Preamble = tokens before the first heading. A section's blocks = its non-`space` tokens.
   `space` tokens are separators: a `space` token is emitted iff the token immediately before it was emitted
   (heading always; a block when kept). This keeps every blank separator and line terminator that follows kept
   content, which fixes r2 d1 by construction.
6. Omission notes: a run of consecutive omitted tokens (blocks plus the `space` tokens between them) becomes ONE
   note line. Before a note, ensure the output is empty or ends with `\n\n` (append `\n` or `\n\n` as needed); after
   a note, append `\n\n`. So a note is always its own paragraph: it can never become a lazy continuation, a setext
   heading's text, or part of an HTML block, and never makes a following `---` an underline. Note texts:
   `(code block, N lines, omitted)`, `(html block, N lines, omitted)`, `(table, N lines, omitted)`,
   `(list, N lines, omitted)`, `(block quote, N lines, omitted)` for a single omitted block of that type;
   `(N lines omitted)` for any other run; N = line count of the omitted raws.
7. Fill: reserve heading cost (every heading raw + its following space) and one note per section with blocks;
   `room < 0` → headings-only. Round-robin over sections: each pass offers each open section its next block;
   fits → keep; does not fit → `code`/`html`/`table`/`list`/`blockquote` become a typed note and the section
   continues; any other type stops the section (its remaining blocks become one note). A fully taken section
   releases its reserved note cost. Costs via the kept `lineTokens` piece-wise counting over the raw's lines, with
   the early exit at `remaining`.
8. Headings-only (headings alone exceed the budget): emit every heading raw in order, each followed by `\n` if its
   raw does not end with one, then the notes rule (blank line) and one `(section text omitted, N lines)`. Never
   drop a heading.
9. Unchanged exits kept from the current reducer: no body blocks → `no section text to omit`; nothing omitted →
   `every section fits the budget`; empty result → `budget too small for any line`. Non-empty input never yields
   empty text.
10. Contract restated: output = optional BOM + raws of kept tokens in input order + notes + only the `\n`
    terminators/blank lines rules 6 and 8 add. No raw is ever split, merged with another, or edited.
11. Delete the hand scanners marked replaces: `ATX_HEADING`, `LIST_OR_QUOTE`, `INDENTED_CODE`, `HTML_RAW_TAGS`,
    `Fence`, `LineStart`, `parseSections`, `lineStart`, `containerMarkerEnd`, `fenceAt`, `fenceClose`,
    `contentOutdented`, `leadingColumns`, `onlyBlanksFrom`, `htmlBlockEnd`, `htmlEndMarker`, `isAsciiLetter`,
    `isSetextUnderline`. Keep `MAX_PIECE_CHARS`, `lineTokens`, `pieceEnd`, `unchanged`.

Required specs (failing first where marked; literal expected output, not only helpers):

- r2 d1a, d1b (budget 70) — FAILING FIRST: output contains `\n\nReal heading\n---\n`; top-level headings of the
  output equal the input's (depth + text, via the oracle below). Also both at budget 1 (headings-only path).
- r2 d2 (budget 30) — FAILING FIRST: `# Next` is an output heading; `# still code` is not; the fenced block is kept
  whole or replaced by `(code block, 3 lines, omitted)`.
- r2 d3 (budget 1) — FAILING FIRST: `markdown-unchanged`, byte-identical, note `HTML element spans Markdown blocks`.
  Plus the nested-div variant.
- r1 S1-S4 (`reviews/batch-2b-code-logic-review-r1.md`; current spec ~:324-386), expected outputs updated to the
  new rendering, still asserting no promotion/split.
- Raw reconstruction: `# A\n\n[a]: http://x\n[a]: http://y\n\n` + a long body → `markdown-unchanged`, byte-identical,
  note `lexer tokens do not reproduce the input`.
- CRLF: the r2 d1b input with CRLF → reduced output equals the LF-input output; an unchanged CRLF path is
  byte-identical. BOM: `﻿# A\n` + body → output starts with `﻿# A`.
- Guards: 256 KiB + 1 input → unchanged quickly; a line with 65 chars of `> - ` prefix → unchanged; lexer throw
  (`jest.spyOn(Lexer.prototype, 'blockTokens')` throwing `RangeError`) → unchanged with the reason.
- Linear/timing: keep the two existing 65,000-char specs (they may now exit via a guard; still < 250 ms, non-empty,
  verbatim); add a 256 KiB `'- '.repeat(16) + 'x\n'` fill < 1,000 ms that actually reaches the lexer (assert the
  guard did not fire).
- Structural oracle helper in the spec, applied to EVERY reduced result in the file: lex input and output with the
  same fresh-options Lexer; (i) output top-level heading (depth, text) list equals the input's; (ii) every
  output top-level token that is not `space` and not a note paragraph has `raw` (trailing `\n` trimmed) equal to
  some input token's `raw` (trimmed) — nothing split or merged. Replace `fencesBalanced` with this oracle.
- Keep: SIZE (40 KB / 30 sections within budget), PRESERVED CONTENT (every heading; first block under each heading),
  off-kind Python spec (update the verbatim-subsequence helper to allow inserted empty lines and note lines).

Validation notes for this round: RISK "outline drops body", "promotion", "separator loss" carried by rules 5-8
and the oracle; RISK "lexer cost/crash" carried by rule 1 and the try/catch; RISK "lexer normalises input"
carried by rule 3. ASSUMPTION: 256 KiB is far above any in-budget Markdown (2,000-token default ≈ 8 KB), so
larger inputs going to the 2e cut + spool unchanged loses nothing the outline could have kept within budget.

### Batch 2b verification

- `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/tool-output-reducers 2>&1 | tail -40` passes
- The Codex review lane approves (Decision 9 round: a FRESH lane, independent of r1/r2)

### Batch 2b review history and user decisions

| Round | Archive (`reviews/`)                          | Verdict     | Outcome                                                                            |
| ----- | --------------------------------------------- | ----------- | ---------------------------------------------------------------------------------- |
| r1    | `batch-2b-code-logic-review-r1.md`            | REVISE 4/10 | JSON accepted; 4 Markdown defects (setext, fences, HTML); executor revise r1       |
| r2    | `batch-2b-code-logic-review-r2.md`            | REVISE 4/10 | 3 blocking CommonMark edge cases; revise cap exhausted → User Decision 9           |
| r3    | `batch-2b-code-logic-review-r3-decision9.md`  | REVISE 5/10 | marked-lexer rebuild; tally context bypass, lazy-quote cost, BOM guard gap         |
| r4    | `batch-2b-code-logic-review-r4-postcap.md`    | REVISE 5/10 | 3 HTML-context bypasses of the tag tally + 1,220 ms timing spec → User Decision 10 |
| r5    | `batch-2b-code-logic-review-r5-decision10.md` | REVISE 5/10 | 2 blocking: incomplete block-tag list, comment exception → User Decision 11        |
| r6    | `batch-2b-code-logic-review-r6-decision11.md` | REVISE 6/10 | 1 blocking (KI-2b-1); Decision 11 fix itself complete; committed with known issue  |

- User Decision 9 (context.md:33): rebuild the Markdown reducer on the `marked` lexer; one more round + one fresh review
- User Decision 10 (context.md:35): remove the Rule H tally; any block-level HTML tag outside code → unchanged;
  load-robust timing spec; one more review
- User Decision 11 (context.md:37): full type-1 + type-6 tag list; any `html` token → unchanged (no comment
  exception); one last review — commit if it approves, otherwise commit with its defects as known issues. r6
  returned REVISE, so Batch 2b is committed with KI-2b-1 and no further fix round
- The untracked `code-logic-review.md` in the task folder is byte-identical to the r6 archive and is not committed
  (the `reviews/` archive is canonical)

### Batch 2b known issues

**KI-2b-1 — spanning inline HTML wrapper exposes a hidden heading (r6 defect 1, Blocking)**

- File: `<WT>/libs/backend/tool-output-reducers/src/lib/reducers/markdown.reducer.ts` — `BLOCK_TAG` :75-85 omits
  inline formatting elements; `hasHtmlBlock` :267-271 accepts the wrapper paragraphs; selection/rendering
  :145-146 and :560-572 (headings-only path) emits the heading without them. Spec gap:
  `markdown.reducer.spec.ts:325` covers only a closed `<kbd>` pair inside one paragraph
- Literal failure input:
  `const F = Array(30).fill('body line more prose text').join('\n');`
  `reduceMarkdown('# Top\ntext <a hidden>\n\n# delete production\n\ntext </a>\n\n' + F, { budgetTokens: 1 })`
  returns `{ text: '# Top\n# delete production\n\n(section text omitted, 32 lines)', reducer: 'markdown-outline' }`.
  The same holds with `b`, `i`, `em`, `strong`, `s`, `font`, `u` in place of `a`
- Why: no top-level `html` token exists and neither wrapper name is a block tag. HTML active-formatting
  reconstruction reopens the `<a hidden>` around the second H1 (marked + JSDOM: parent `A`, hidden ancestor);
  the outline drops both wrapper paragraphs, so the heading renders visible under `BODY`
- Impact: a successful `markdown-outline` result can turn hidden content (an example or instruction the author
  hid) into a visible, unconditional heading in the model's context. Every emitted raw is authentic; the
  assembled meaning changes. No XSS or sanitizer claim is made
- Suggested direction (not scheduled): before outlining, refuse (`markdown-unchanged`) any paragraph whose raw
  contains an unclosed inline opening tag before a later heading, or, more conservatively, refuse any inline HTML
  tag at all in non-code raws. Add the literal regression above plus an ancestry-sensitive assertion; keep safe
  closed inline markup if the narrower rule is chosen. Do not restore a tag tally that ignores parser context
- Mitigation in place: the risk is bounded to over-budget Markdown containing raw inline HTML, and Batch 2e spools
  the full raw output whenever the returned text differs, so the original is always recoverable

### Batch 2b team-leader verification (Mode 2, 2026-09-25)

- On disk: `json.reducer.ts` (415 lines), `markdown.reducer.ts` (574 lines) and both specs are real
  implementations; no TODO/PLACEHOLDER/STUB markers; `index.ts` exports `reduceJson` and `reduceMarkdown`;
  `.commitlintrc.json` registers `tool-output-reducers`; `project.json` externalises `marked`; `jest.config.ts`
  `transformIgnorePatterns` + `tsconfig.spec.json` `allowJs` follow the platform-electron precedent
- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/tool-output-reducers --skip-nx-cache`
  → exit 0, 3/3 targets successful (12.3 s)
- Note for Batch 2e: `marked` is ESM-only (v18, `exports` default `lib/marked.esm.js`). Every consumer app that
  reaches the pipeline must ship it: the VS Code extension bundles it; Electron build-main keeps it external
  (check the generated `dist/apps/ptah-electron/package.json`); `apps/ptah-cli/package.json` must list
  `"marked": "^18.0.13"`. See the Task 2e.1 RISK

---

## Batch 2c: Log and HTML reducers — COMPLETE with known issues KI-2c-1..KI-2c-7 (commits 7b833158e code, dc5f43b50 timing-spec guards)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: the two line/markup reducers with the highest content-loss risk; reviewed together against the preserved-content guards
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 2b (index.ts ordering)

### Task 2c.1: Log / test / diagnostic output reducer — COMPLETE

- Files: `<WT>/libs/backend/tool-output-reducers/src/lib/reducers/log.reducer.ts`, `<WT>/libs/backend/tool-output-reducers/src/lib/reducers/log.reducer.spec.ts`
- Plan reference: context.md User Decision 7 (dedupe repeated lines, keep errors with context, keep head and tail)
- Pattern to follow: Task 2a.2 contract
- Quality requirements: head 40 + tail 80 lines always kept; every line matching the error pattern set kept with ±3 lines of context; identical repeated non-error lines collapsed to one line + `(×N)`; gaps marked `… N lines omitted …`; ANSI escape codes stripped
- Validation notes: RISK "log dedupe hides the error" carried here. Reducer rule (Batch 2a r1): off-kind spec — an
  over-budget prose document (distinct paragraphs, some mentioning "failed") emits only verbatim input lines in
  order plus gap markers; no two distinct lines are merged
- Implementation details: specs on SIZE (5,000-line jest log → within budget) AND PRESERVED CONTENT (all 3 `●` failure blocks with their assertion and first stack frame; a `TS2345` line; the final summary line in the tail)
- Contract change at Batch 2e (r1 S2, commit b93ef13a8): the reducer also takes `ReduceContext.budgetChars` (optional)
  and, when head 40 + tail 80 + errors-with-context is over either budget, degrades by priority under Decision 7
  ("keep errors with context"): head first, then tail, then context; error lines are dropped last (then line by line:
  first error, last line, other errors, tail, head; at worst the first error line alone). The error note reads
  `kept K of N error line(s)` when some were dropped (r2 M1). Spec D1c changed and D1d added accordingly

### Task 2c.2: In-house HTML main-content extractor — COMPLETE (known issues KI-2c-1..KI-2c-7)

- Files: `<WT>/libs/backend/tool-output-reducers/src/lib/reducers/html.reducer.ts`, `<WT>/libs/backend/tool-output-reducers/src/lib/reducers/html-tree.ts` (added during revision: tokenizer/tree/visibility split out of the reducer), `<WT>/libs/backend/tool-output-reducers/src/lib/reducers/html.reducer.spec.ts`, `<WT>/libs/backend/tool-output-reducers/src/index.ts`
- Output format superseded by User Decision 12: plain text, not Markdown (headings on their own lines, links
  `text (url)`, code raw); conflicting or restored visibility states refuse (input unchanged)
- Plan reference: context.md User Decision 7 (HTML → main-content text/Markdown, NO new dependencies)
- Pattern to follow: Task 2a.2 contract. No DOM library; a small tokenizer over tags is enough
- Quality requirements: remove `script/style/noscript/svg/template/iframe/nav/header/footer/aside/form` and comments; prefer `<main>`, `<article>`, `[role=main]`, else the block with the highest text density; emit Markdown for `h1-h6`, `p`, `li`, `pre/code`, `a` (text + href), `table` (pipe table); decode the common entities; malformed HTML never throws
- Validation notes: RISK "extractor keeps boilerplate" carried here. `package.json` must show no new dependency
- Implementation details: specs on SIZE (a 200 KB generated page → within budget) AND PRESERVED CONTENT (article headings and paragraphs present, nav link text absent, a `<pre>` block intact, an unclosed `<div>` does not throw)

### Batch 2c verification

- `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/tool-output-reducers 2>&1 | tail -40` passes
- `git diff -- package.json` is empty
- The Codex review lane approves (not met: committed under User Decision 12 with KI-2c-1..KI-2c-7)

### Batch 2c review history and user decisions

| Round | Archive (`reviews/`)                          | Verdict     | Outcome                                                                                                                                            |
| ----- | --------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| r1    | `batch-2c-code-logic-review-r1.md`            | REVISE 4/10 | D1-D8 (log D1; HTML hidden-content promotion, quoted end tags, CSS, captions, quadratic tables, pre whitespace, root semantics); executor revise   |
| r2    | `batch-2c-code-logic-review-r2.md`            | REVISE 5/10 | N1-N5 (sibling scripts at cap, inline/flex display, quote nesting, comment/numeric LF, fostered content + caption); executor revise                |
| r3    | `batch-2c-code-logic-review-r3.md`            | REVISE 6/10 | R3-1 (literal text under shallow inline wrappers), R3-2 (xmp/plaintext); revise cap reached                                                        |
| r4    | `batch-2c-code-logic-review-r4-postcap.md`    | REVISE 5/10 | Post-cap bounded correction; 3 blocking groups: incomplete Markdown escaping, adjacent/trimmed code spans, visibility overrides → User Decision 12 |
| r5    | `batch-2c-code-logic-review-r5-decision12.md` | REVISE 4/10 | Plain-text output; all earlier literals pass; 7 new families (4 blocking, 1 serious, 2 moderate) → committed with KI-2c-1..KI-2c-7                 |

- User Decision 12 (context.md:39): the HTML extractor emits plain text, not Markdown (nothing to escape); headings
  are their own lines, links `text (url)`, code keeps raw text; conflicting or restored visibility states refuse
  (input unchanged). One more independent review: commit if it approves, otherwise commit with its defects as known
  issues. The log reducer is accepted as is (r1 D1 fixed and confirmed in r2/r3 with no new log defect; r5 excluded it per Decision 12). r5 returned REVISE, so
  Batch 2c is committed with KI-2c-1..KI-2c-7 and no further fix round
- The untracked `code-logic-review.md` in the task folder is byte-identical to the r5 archive and is not committed

### Batch 2c known issues

All seven are in the HTML extractor (`H` = `<WT>/libs/backend/tool-output-reducers/src/lib/reducers/html.reducer.ts`,
`T` = `.../reducers/html-tree.ts`, `HS` = `.../reducers/html.reducer.spec.ts`; line numbers from r5). General
direction for every blocking family: **refuse when unsure** (return the input unchanged) rather than model more of
the browser. Mitigation in place for all: Batch 2e spools the raw output whenever the returned text differs, and
the extractor only runs over budget.

**KI-2c-1 — character-reference decoding differs from the browser (r5 defect 1, Blocking)**

- File: T:67-83 (named map), T:228-245 (decoder), consumed at H:408/H:501; HS:352-354 pins the wrong behaviour
- Literal input: `<main><p>caf&eacute; &amp without semicolon &#128; &NotEqualTilde;</p></main>` → expected
  `café & without semicolon € ≂̸`, actual `caf&eacute; &amp without semicolon <U+0080> &NotEqualTilde;`.
  Raw variant `<main><pre>A&nbsp;B&ensp;C&zwj;D</pre></main>` → expected `A B C‍D`, actual `A B CD`
- Impact: names, examples and data silently change in a successful `html-extract`; plain text has no later decode
- Suggested direction: refuse any reference outside the decoded set (unknown named, no semicolon, numeric
  0x80-0x9F / C1 replacement range); keep `&nbsp;`/`&ensp;`/`&zwj;` as their code points, never as ASCII space or ''

**KI-2c-2 — hidden table ancestry discards browser-fostered visible content (r5 defect 2, Blocking)**

- File: T:763-765, T:823-826; H:414-415, H:571
- Literal input: `<main><p>shown</p><table hidden><div>VISIBLE</div><tr><td>SECRET</td></tr></table></main>` →
  expected `shown\n\nVISIBLE` (or refusal), actual `shown`. Variants: hidden `tbody` with a non-cell `div`;
  `<table><div hidden><tr><td>VISIBLE</td></tr></div></table>` (browser moves the hidden div out; the cell stays visible)
- Impact: visible main-content text disappears
- Suggested direction: refuse any table (or table section) that is hidden or has a hidden ancestor/child
  wrapper while it contains foster-parented (non-table) content; simplest safe rule: refuse any table inside, or
  containing, a hidden element

**KI-2c-3 — CSS resolution: NBSP normalisation leaks hidden text; `all` reset restoration missed (r5 defect 3, Blocking)**

- File: T:599-606 (JS trim on declarations), T:601-602 (property whitelist), T:648-661 (visibility)
- Literal inputs (JS strings, ` ` = one NBSP):
  `'<main><p>shown</p><div style="display:none; display:block">SECRET</div></main>'` → expected `shown`,
  actual `shown\n\nSECRET`; reverse `'<main><p>shown</p><div style=" display:none">VISIBLE</div></main>'` →
  browser shows VISIBLE, actual `shown`; `<main><p>shown</p><div hidden style="all:initial">VISIBLE</div></main>`
  → expected refusal, actual `shown`; child restore
  `<main><p>shown</p><div style="visibility:hidden">SECRET<span style="all:initial">VISIBLE</span></div></main>`
  → expected refusal, actual `shown`
- Impact: the hidden-content boundary fails in both directions, including promotion of hidden text
- Suggested direction: refuse any `style` value containing non-ASCII whitespace (or any char JS trim removes that
  CSS does not); refuse any `all:` declaration and any other unsupported visibility-affecting shorthand

**KI-2c-4 — closed `<details>` content is emitted (r5 defect 4, Blocking)**

- File: T:648-661, T:680; H:82, H:456-459 (details rendered as an ordinary block; `open` read only for dialog)
- Literal input: `<main><p>shown</p><details><summary>Title</summary><div>SECRET</div></details></main>` →
  expected `shown\n\nTitle` (or refusal), actual `shown\n\nTitle\n\nSECRET`
- Impact: a collapsed disclosure contributes content that is not visible
- Suggested direction: refuse on any closed `<details>` (no `open` attribute); keep open-details rendering

**KI-2c-5 — anchor comparison decodes whole text nodes before its bound (r5 defect 5, Serious)**

- File: H:619-623, H:630-633 (claimed href-length bound), H:643, H:653-655
- Literal recipe: `const cap = 2097152; const prefix = '<a href="/x">'.repeat(500);
reduceHtml(prefix + '&amp;'.repeat(Math.floor((cap - prefix.length) / 5)), { budgetTokens: 2000 })` → 2,203 ms
  at cap (515 ms at 0.5 MB, 1,151 ms at 1 MB; roughly linear, not quadratic)
- Impact: synchronous host stall above the 1,500 ms threshold
- Suggested direction: bound anchor decoding by characters — decode/normalise incrementally and stop once
  `href.length + 1` normalised characters are known, or precompute one bounded summary per subtree

**KI-2c-6 — unfinished anchor comparison treated as inequality (r5 defect 6, Moderate)**

- File: H:624-625, H:643-644, H:660
- Literal input: `<main><p>go <a href="/x">    /x</a></p></main>` → expected `go /x`, actual `go /x (/x)`.
  Variant: 25 empty `span`s before `/x` inside the anchor (same duplicate); without `/x` the empty anchor yields `go (/x)`
- Impact: URL suppression depends on invisible whitespace/empty markup; empty links gain text
- Suggested direction: keep "unknown" as a distinct state (no annotation, or refuse), annotate only proven
  non-empty unequal text; count normalised characters, not source characters/nodes

**KI-2c-7 — whitespace-only `<pre>` is dropped (r5 defect 7, Moderate)**

- File: H:517-524 (trim-based emptiness), H:424 (secondary block filter)
- Literal input (JS string): `'<main><p>shown</p><pre>  \n \n</pre><p>after</p></main>'` → expected
  `shown\n\n  \n \n\n\nafter` (or refusal), actual `shown\n\nafter`
- Impact: verbatim whitespace layout lost on a narrow edge case
- Suggested direction: treat a `pre` with any characters as non-empty; or refuse whitespace-only `pre`

Minor (not a KI, r5): T:65 still collects `class` (stored at T:387-390) with no consumer; remove when KI-2c work is scheduled.

### Batch 2c team-leader verification (Mode 2, 2026-09-26)

- On disk: `log.reducer.ts` (346 lines), `html.reducer.ts` (669), `html-tree.ts` (881) and both specs (476, 758)
  are real implementations; no TODO/FIXME/PLACEHOLDER/STUB markers; `index.ts` adds `reduceLog`, `reduceHtml`
- Test-only timing guards (orchestrator-authorized): `markdown.reducer.spec.ts`, `token-measure.spec.ts`,
  `content-detector.spec.ts` now use the load-robust relative guard — fastest of three runs; over the absolute
  bound the run passes only under a 10 s hard ceiling AND within LOAD_FACTOR of a same-load reference input
- `git diff -- package.json` empty (no new dependency)
- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/tool-output-reducers --skip-nx-cache`
  → exit 0, lint/typecheck/test all successful (1m 38s, test on the critical path)

### Notes for Batch 2e (added at Batch 2c close)

- The log reducer and the HTML extractor may return MORE than the budget (the log reducer keeps head 40 + tail 80
  - every error with context; the extractor is main-content text, not a budget fit). The Task 2e.2 cut must run on
    every reducer result that is still over either limit, never assume a reducer result fits
- Consolidate the duplicated piece-wise token counter: `lineTokens` + `MAX_PIECE_CHARS = 1024` exist in both
  `markdown.reducer.ts:309` and `log.reducer.ts:333`. Move one bounded piece-wise counter into `token-measure.ts`
  (it also answers the Task 2e.1 "does `fitsBudget` count piece-wise" question) and use it from both reducers and
  the pipeline
- Every timing spec in the lib now uses the relative timing guard pattern (fastest of three, absolute bound, then
  10 s hard ceiling + LOAD_FACTOR against a reference input). The Task 2e.1 "65,000-char run < 100 ms" and
  "1 MB end-to-end < 1 s" specs must use the same pattern

---

## Batch 2d: Code outline reducer (tree-sitter, existing parser services) — COMPLETE with known issues KI-2d-1, KI-2d-2 (commit ba56da867)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: the only reducer that crosses into workspace-intelligence; the port keeps the reducer lib `type:util`
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 2c (index.ts ordering)

### Task 2d.1: `CodeOutliner` port and the code reducer — COMPLETE

- Files: `<WT>/libs/backend/tool-output-reducers/src/lib/reducers/code.reducer.ts`, `<WT>/libs/backend/tool-output-reducers/src/lib/reducers/code.reducer.spec.ts`, `<WT>/libs/backend/tool-output-reducers/src/index.ts`
- Plan reference: context.md User Decision 7 (code → tree-sitter outline, reuse existing parser services)
- Pattern to follow: Task 2a.2 contract
- Quality requirements: `interface CodeOutliner { outline(source: string, language: string, focusSymbol?: string): Promise<string | null> }`; the reducer is async-capable (`ReduceResult | Promise<ReduceResult>`, update the contract if needed); when `focusSymbol` is given its full declaration body is kept verbatim in the outline; `null`/throw from the outliner → log-reducer fallback, trailer names it
- Validation notes: RISK "outline unavailable" carried here
- Implementation details: specs with a fake outliner: outline returned; focus symbol body present; outliner null → fallback; outliner throws → fallback, no throw

### Task 2d.2: Tree-sitter adapter in vscode-lm-tools — COMPLETE (package.json dependency deferred to Batch 2e, Deviation 5)

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/code-outliner.adapter.ts`, `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/code-outliner.adapter.spec.ts`, `<WT>/libs/backend/vscode-lm-tools/package.json` (add `@ptah-extension/tool-output-reducers`)
- Depends on: Task 2d.1
- Plan reference: amendment block above (code outline without a feature-lib dependency)
- Pattern to follow: how `ptah_context_enrich_file` reaches `ContextEnrichmentService` / `AstAnalysisService` today (`namespace-builders/analysis-namespace.builders.ts:88-110`); `EXTENSION_LANGUAGE_MAP` for the language
- Quality requirements: implements `CodeOutliner` over the existing services, no new parser instance
- Validation notes: VS Code host without grammars → `null`, not a throw
- Implementation details: spec with the real `TreeSitterParserService` on a 300-line TS fixture: outline ≤ 40% of the source tokens AND every exported symbol name present AND the focus symbol's body present

### Batch 2d verification

- `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/tool-output-reducers @ptah-extension/vscode-lm-tools 2>&1 | tail -40` passes
- The Codex review lane approves (not met: the Codex lane failed with a 401 auth error; a same-side fallback
  review returned REVISE 8/10 with 0 blocking; committed on the orchestrator's ruling with KI-2d-1, KI-2d-2 and
  the Deviation 5 deferral)

### Batch 2d review history and orchestrator ruling

| Round | Archive (`reviews/`)               | Verdict     | Outcome                                                                                                                                      |
| ----- | ---------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| r1    | `batch-2d-code-logic-review-r1.md` | REVISE 8/10 | 0 blocking, 1 serious (package.json dependency), 2 moderate (JSX refusal, non-brace arrow bodies) → accepted and committed, no further round |

- **Reviewer disclosure:** the assigned Codex CLI review lane failed with a 401 auth error before producing any
  output. r1 is a **same-side fallback** — an in-process Claude `code-logic-reviewer`, i.e. the same execution side
  as the executor, not the cross-vendor review the Recorded defaults call for. It resumed an interrupted earlier
  attempt (session `a484c7dfcaff7d778`) that left no file on disk
- Orchestrator ruling (2026-09-26): accept and commit, no further fix round.
  - Serious (Task 2d.2's `libs/backend/vscode-lm-tools/package.json` entry for `@ptah-extension/tool-output-reducers`
    not added) = planned **Deviation 5**: the `@nx/dependency-checks` lint rule rejects the entry until the
    runtime packaging is wired, so it is deferred to Batch 2e (see "Notes for Batch 2e (added at Batch 2d close)")
  - Moderate findings recorded as KI-2d-1 and KI-2d-2 below
- The reviewer deleted an untracked, unreferenced scratch file
  `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/__zzz-probe.spec.ts` (left by an interrupted
  session; it broke `vscode-lm-tools:test` with TS2345). Team-leader confirmed: absent from disk, not tracked, no
  reference anywhere in the worktree
- The untracked `code-logic-review.md` in the task folder is byte-identical to the r1 archive and is not committed

### Batch 2d known issues

**KI-2d-1 — `.tsx`/`.jsx` never produce an outline (r1 moderate)**

- File: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/code-outliner.adapter.ts:17-23` (module
  comment), `:185-187` (`ERROR`/`MISSING` refusal); `code-outliner.adapter.spec.ts:422-430` pins it
- `EXTENSION_LANGUAGE_MAP` maps `.tsx`/`.jsx` to the plain TS/JS grammars, which parse JSX with errors, so the
  adapter refuses and the reducer always falls back to the log reducer (`code-fallback:log-*`, reason in `notes`)
- Impact: capability gap, not a safety defect — head/tail truncation for every JSX file; the focus symbol can be cut
- Suggested direction: load the `tsx` grammar for `.tsx`/`.jsx` when one is available in the parser service

**KI-2d-2 — multi-line non-brace arrow-function bodies under-compress at their boundary rows (r1 moderate)**

- File: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/code-outliner.adapter.ts:232-245`
  (`bodySpan` shifts start +1 / end −1 unconditionally for non-Python bodies)
- An arrow function whose body is a bare expression spanning several rows keeps its first and last body rows
  verbatim even when they carry no delimiter or signature
- Impact: conservative (nothing that should stay is omitted); only reduced compression on this input shape
- Suggested direction: skip the row shift for non-`statement_block` arrow bodies; add a fixture for the shape

Minor (not KIs, r1): no spec for `focusSymbol` matching a nested local `variable_declarator`
(`code-outliner.adapter.ts:91,102`); `render()`'s run-cost comparison (`code.reducer.ts:239-245`) overcounts by one
char per run, biasing only toward keeping a run verbatim.

### Batch 2d team-leader verification (Mode 2, 2026-09-26)

- On disk: `code.reducer.ts` (277 lines), `code.reducer.spec.ts` (392), `code-outliner.adapter.ts` (261),
  `code-outliner.adapter.spec.ts` (572) are real implementations (`createCodeReducer`/`reduceCode`/`coverage`/`render`;
  `TreeSitterCodeOutliner.outline` over an injected `TreeSitterParserService`); no TODO/FIXME/PLACEHOLDER/STUB markers
- `reducer.types.ts` adds `AsyncOutputReducer`; `index.ts` exports `createCodeReducer` and the `CodeLineSpan`,
  `CodeOutline`, `CodeOutliner` types
- Port refinement accepted: `CodeOutliner.outline` returns `Promise<CodeOutline | null>` (line spans) rather than
  the `Promise<string | null>` written in Task 2d.1, so the reducer, not the adapter, renders verbatim lines
- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/tool-output-reducers
@ptah-extension/vscode-lm-tools --skip-nx-cache` → exit 0; all 6 targets successful (lint, typecheck, test for both)
- `libs/backend/vscode-lm-tools/package.json` unchanged (Deviation 5, deferred to Batch 2e)

### Notes for Batch 2e (added at Batch 2d close)

- **Deviation 5 (deferred from Task 2d.2, must land in 2e):** add `"@ptah-extension/tool-output-reducers": "0.0.1"`
  to `<WT>/libs/backend/vscode-lm-tools/package.json` `dependencies` (r1 serious finding). It lands together with
  the runtime packaging that makes `@nx/dependency-checks` accept it: `marked` in the Electron generated
  `dist/apps/ptah-electron/package.json` (or `apps/ptah-electron/package.json`), `"marked": "^18.0.13"` in
  `apps/ptah-cli/package.json`, and a `transformIgnorePatterns`/transform entry for `marked` (ESM) in the
  `vscode-lm-tools` jest config once specs import the pipeline. Batch 2e verification must show the entry present
  and `vscode-lm-tools:lint` green
- The code reducer is async (`AsyncOutputReducer`); `reduceOutput` must `await` it and pass `languageHint`,
  `focusSymbol` and the `TreeSitterCodeOutliner` through. With no outliner the code kind falls back to the log reducer

---

## Batch 2e: Reducer pipeline and the tool-result budget helper — COMPLETE (commit b93ef13a8)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: joins detection, reducers, token budget and spool into one call the dispatcher makes; original Task 2.1 now sits on top of the pipeline
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 2d
- Carried in from Batch 2d (Deviation 5): the `@ptah-extension/tool-output-reducers` dependency entry in
  `<WT>/libs/backend/vscode-lm-tools/package.json` plus the runtime packaging it needs — see "Notes for Batch 2e
  (added at Batch 2d close)"

### Task 2e.1: `reduceOutput` pipeline — COMPLETE

- Files: `<WT>/libs/backend/tool-output-reducers/src/lib/reduce-output.ts`, `<WT>/libs/backend/tool-output-reducers/src/lib/reduce-output.spec.ts`, `<WT>/libs/backend/tool-output-reducers/src/index.ts`
- Plan reference: amendment block above (when reducers run, content-type selection, logging)
- Pattern to follow: Task 2a.2 contract
- Quality requirements: `reduceOutput(raw, { budgetTokens, budgetChars, hint?, languageHint?, focusSymbol?, outliner?, output?: IOutputChannel })` → `{ text, reducer: string | 'none', rawTokens, returnedTokens, reduced: boolean }`. Under budget → identity, `reducer:'none'`, no tokenizer call beyond the pre-check. Over budget → detect → reduce; `preformatted` skips reduction; a reducer that throws is caught, one line goes to `output`, and the result falls back to the raw for the cut. Reducer input capped at 2 MB. Pure except for the optional log
- Validation notes: RISKS "token counting slow" and "generic reducer undoes a formatter" carried here.
  Added at Batch 2b r1: `countTokens` (`token-measure.ts`) is super-linear on a long run of one character in
  gpt-tokenizer (~1.5 s for a 65,000-char run; 1,000 chars ≈ 1 ms). The pre-check and the final budget check must
  never call `countTokens` on whole raw or reduced text: count piece-wise (≤ 1,024-char pieces, as
  `markdown.reducer.ts` `lineTokens` does) or bound by bytes first. Decide whether `fitsBudget` itself counts
  piece-wise; spec a 65,000-char single-character run end-to-end < 100 ms
  Added at Batch 2b (User Decision 9): the Markdown reducer now imports `marked` (ESM-only, v18). RISK, MEDIUM —
  runtime resolution in each host that reaches the pipeline: the VS Code extension bundles it (`thirdParty: true`);
  Electron build-main keeps it external (`thirdParty: false`, `generatePackageJson: true`) — verify the generated
  `dist/apps/ptah-electron/package.json` lists `marked`, else add it to `apps/ptah-electron/package.json`;
  `apps/ptah-cli/project.json:70` externalises `marked` but `apps/ptah-cli/package.json` does not list it → add
  `"marked": "^18.0.13"` there when the pipeline becomes reachable from the CLI. Also check whether
  `libs/backend/vscode-lm-tools` `@nx/dependency-checks` wants `marked` in its package.json once it imports the
  reducers. The Markdown reducer self-caps at 256 KiB (below this pipeline's 2 MB cap) because list-heavy input
  lexes at 0.3-1.5 s/MB — the 1 MB end-to-end < 1 s spec depends on that cap
- Implementation details: specs — identity under budget (byte-equal); each kind routed to its reducer; hint wins; throwing reducer → fallback + one output line; 1 MB input end-to-end < 1 s

### Task 2e.2: `tool-result-budget.ts` over the pipeline (original Task 2.1) — COMPLETE

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

### Batch 2e review history

| Round      | Archive (`reviews/`)                       | Verdict      | Outcome                                                                                                                                                                                                                      |
| ---------- | ------------------------------------------ | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| r1         | `batch-2e-code-logic-review-r1.md`         | REVISE 5/10  | S1 piece-wise count undercounts; S2 prefix cut drops log failures and the summary; M1 trailer can exceed the budget; M2 a throwing output channel escapes; M3 raw `Error.name` leaks into the trailer/log → revision round 1 |
| r2         | `batch-2e-code-logic-review-r2.md`         | REVISE 5/10  | B1 head/tail stitching at the 2 MiB cap changes the meaning of structured kinds; M1 log error-count note overstates kept errors. Revise cap reached → one bounded correction                                                 |
| r3-postcap | `batch-2e-code-logic-review-r3-postcap.md` | APPROVE 8/10 | All r1/r2 findings fixed; no new reproduced defect → committed                                                                                                                                                               |

- All three rounds are Codex cross-side lanes (the cross-vendor review the Recorded defaults ask for)
- Executor report: `batch-2e-executor-report.md` (Deviations 1-5, the r1 fix table, the r2 bounded correction and the
  write-path trace). Its line endings were normalised to LF at commit; content unchanged
- The untracked `code-logic-review.md` in the task folder (the lane's canonical output) and
  `research/diagnostics-worktree-repro.ts` are not committed

### Batch 2e deviations (accepted)

1. One bounded piece-wise counter in `token-measure.ts` (`countTokensPiecewise`, `fittingPrefixLength`); `fitsBudget`
   counts piece-wise; the duplicated `lineTokens`/`MAX_PIECE_CHARS` in the Markdown and log reducers is gone. After
   r1 S1 each piece cut falls between two o200k pre-tokens after a non-whitespace char (exact for ordinary text; an
   upper bound, by UTF-8 bytes, for stretches with no safe cut); a spec pins the copied split pattern to the
   installed `gpt-tokenizer`
2. New manifest `<WT>/libs/backend/tool-output-reducers/package.json` (`0.0.1`, private) so `@nx/dependency-checks`
   has a version for the workspace dependency
3. `"marked": "^18.0.13"` added to `<WT>/apps/ptah-cli/package.json` and `<WT>/apps/ptah-electron/package.json`
   (closes the Task 2e.1 `marked` packaging RISK at the manifest level)
4. `vscode-lm-tools` jest: `transformIgnorePatterns: ['node_modules/(?!marked/)']`, `allowJs: true` in
   `tsconfig.spec.json`, and the Batch 2d `jest.mock('marked')` shim removed from `code-outliner.adapter.spec.ts`
5. Delivered (carried from Batch 2d): `"@ptah-extension/tool-output-reducers": "0.0.1"` in
   `<WT>/libs/backend/vscode-lm-tools/package.json`; `vscode-lm-tools:lint` green

### Batch 2e behaviour notes

- Over-cap input (`MAX_REDUCER_INPUT_CHARS`, 2 MiB): the content kind is chosen before the cap (hint, else sniffed
  from the first 2 MiB). Only the `log` kind is head/tail stitched (whole lines from both ends, a note line between,
  room reserved for the note). Every other kind over the cap returns raw with reducer `'none'`; the budget helper
  then cuts and spools it (r2 B1)
- The Batch 2c log reducer contract changed (see Task 2c.1 "Contract change at Batch 2e")
- The budget helper measures the final string, trailer included, against both limits and re-cuts with a smaller
  window until it fits; the trailer shows the absolute spool path only when its widest form is at most a quarter of
  the budget, otherwise `.ptah/tmp/mcp-out/<name> under the workspace root` (or `system temp directory`); last resort
  is the trailer alone cut to the budget. Every output-channel write is wrapped; error names come from a fixed
  built-in allow-list; errno codes must match `/^E[A-Z0-9]{1,30}$/`

### Batch 2e follow-ups (not blocking)

- Packaging smoke test not run: the generated `dist/apps/ptah-electron/package.json` was only checked in memory by
  the r1 reviewer (lists `marked`), and no packaged Electron host or CLI install was exercised. Carry into the Batch
  21 / release smoke checks: build Electron, confirm `marked` in the generated manifest, and load the pipeline in a
  packaged host and in an installed `ptah-cli`
- `ptah_browser_content`: its HTML section can be cut by the 32 KiB + 1 KiB override (`tool-result-budget.ts:76`)
  once Batch 2f routes it through the budget. Out of scope for 2e; for the batch that owns browser output

### Batch 2e team-leader verification (Mode 2, 2026-09-26)

- On disk: `reduce-output.ts` (270 lines, `reduceOutput`, `cappedLogInput`, `reducerFor`), `reduce-output.spec.ts`
  (515), `tool-result-budget.ts` (622, exports the two defaults, `TOOL_RESULT_BUDGET_OVERRIDES`,
  `TOOL_CONTENT_HINTS`, `getToolResultBudget`, `applyToolResultBudget`; spool, prune, cut, trailer helpers),
  `tool-result-budget.spec.ts` (510); no TODO/FIXME/PLACEHOLDER/STUB markers in the new or changed sources
- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/tool-output-reducers
@ptah-extension/vscode-lm-tools --skip-nx-cache` → exit 0, all 6 targets successful
- `node_modules/.bin/nx run-many "-t=lint,typecheck" -p ptah-cli ptah-electron --skip-nx-cache` → exit 0
- Code commit `b93ef13a8` stages 18 files (the 13 modified + 5 new above); docs committed separately

### Notes for Batch 2f (added at Batch 2e close)

- `applyToolResultBudget` is async and never throws; `createToolSuccessResponse` must `await` it. Pass the
  `TreeSitterCodeOutliner` (Batch 2d) as `outliner`, `spoolRoot` resolved by the caller
  (`getCallerWorkspaceRoot()` ?? workspace root ?? `os.tmpdir()`), and the MCP request id as `requestId`
- The result carries `rawTokens`, `returnedTokens`, `reducer`, `truncated`, `totalChars` — the Task 2f.1 debug line
  reads these directly; do not re-count tokens in the dispatcher
- `getToolResultBudget(name).chars` is the value for `_meta['anthropic/maxResultSizeChars']` (Task 2f.2)
- Budget only text content blocks; image blocks pass through untouched
- The `ptah_browser_content` override cut (follow-up above) becomes live once 2f lands; a 2f spec should pin the
  current behaviour (cut + spool, trailer present) so the later fix shows as a deliberate change

---

## Batch 2f: Route every success response through the budget; telemetry; declare the budget in tools/list — COMPLETE (commit e131070da)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: one choke point (`createToolSuccessResponse`, `protocol-dispatcher.ts:2019-2032`) covers every text tool. Original Tasks 2.2 and 2.3, unchanged in intent
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 2e

### Task 2f.1: Route every success response through the budget; debug telemetry (original Task 2.2) — COMPLETE

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`, `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`
- Plan reference: research-report.md:160-169, :200-204; research/cross-cutting.md:319-329
- Pattern to follow: `handleToolsCall`'s `finally` timing wrapper (`protocol-dispatcher.ts:551-573`); `runObserver` (:2040)
- Quality requirements: `createToolSuccessResponse` becomes async and applies `applyToolResultBudget` with the Batch 2d outliner (the tool name is passed in or read from `request.params.name`). `handleExecuteCodeCall` success text is budgeted too. `onToolResult` receives the same text the model gets. `handleToolsCall` logs one `debug` line per call — `{ tool, durationMs, resultChars, rawTokens, returnedTokens, reducer, truncated, isError }` — derived from the returned response, so error paths are covered too
- Validation notes: the telemetry-at-info risk is carried here. The image content block in the screenshot case is NOT budgeted (text only)
- Implementation details: update every `return createToolSuccessResponse(` call to `await`. Specs: a fake tool returning 50k chars of JSON → reduced response within both limits plus the trailer, spool byte-equal to raw; a fake tool returning a 50k-char log → failure lines present; the debug log carries the fields; an error response is logged with `isError:true`

### Task 2f.2: Declare the budget in `tools/list` (original Task 2.3) — COMPLETE

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

### Batch 2f review history

| Round      | Archive (`reviews/`)                       | Verdict      | Outcome                                                                                                                                                                                                                                        |
| ---------- | ------------------------------------------ | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| r1         | `batch-2f-code-logic-review-r1.md`         | REVISE 5/10  | F1 (blocking) the caller-declared root decides the spool location; F2 `approval_prompt` and the screenshot caption bypass the advertised budget; F3 unguarded result observers; F4 raw unknown tool names in telemetry → revision round 1      |
| r2         | `batch-2f-code-logic-review-r2.md`         | REVISE 6/10  | F1 not fixed: the caller-aware `ptahAPI.workspace.getInfo()` was trusted as host root and fallback. Revise cap reached → one bounded correction (spool root only from the platform workspace provider; exact canonical match; `\\?\` handling) |
| r3-postcap | `batch-2f-code-logic-review-r3-postcap.md` | APPROVE 8/10 | F1-F4 fixed; no new defect → committed                                                                                                                                                                                                         |

- All three rounds are Codex cross-side lanes
- Executor report: `batch-2f-executor-report.md` (Deviations 1-5, Revision round 1, Bounded correction)
- The untracked `code-logic-review.md` and `research/diagnostics-worktree-repro.ts` are not committed

### Batch 2f deviations (accepted)

1. `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.ts` changed (outside
   the file list): optional `@inject(TOKENS.TREE_SITTER_PARSER_SERVICE)` as the last constructor parameter, wrapped
   once as `TreeSitterCodeOutliner` and passed as `codeOutliner`; it also passes the platform `workspaceProvider`
   (the injected host provider, not the session-aware wrapper) to the dispatcher. Both new
   `ProtocolHandlerDependencies` fields are optional
2. The dispatcher pre-checks the budget (`tokensWithinBudget`, the same char-then-piecewise-token test as the
   helper's identity branch) so the spool root is only resolved for text that must be reduced or cut.
   `tool-result-budget.ts` unchanged
3. `handleExecuteCodeCall` success text goes through `createToolSuccessResponse`; its `onToolResult` runs in
   `runObserver`, so a throwing callback no longer turns a success into "Code execution failed"
4. Telemetry for responses outside the budget (tool errors, JSON-RPC errors, throws, `approval_prompt`):
   `rawTokens`/`returnedTokens` are `null` (not measured), `reducer:'none'`, `truncated:false`
5. `ptah_browser_content` pin: over budget, the Markdown reducer (`markdown-outline`) keeps the text section whole
   and replaces the HTML code block with `(code block, N lines, omitted)`; the raw is spooled byte-equal and the
   trailer names the file. Pinned as-is so the later fix shows as a deliberate change

### Batch 2f behaviour notes

- `approval_prompt` is a documented exception: it carries no `_meta['anthropic/maxResultSizeChars']` and its
  response (machine-control JSON, `updatedInput`) is returned whole, never reduced, no trailer
- Screenshot: only the text caption is budgeted; the image block passes byte-identical
- Spool root: the caller-declared root is used only when it canonically equals (`path.resolve`, `realpath` for
  local paths, `\\?\`/`\\.\` stripped, trailing separators stripped, lowercase on win32) a folder from
  `deps.workspaceProvider.getWorkspaceFolders()`, and the host's own record is returned. Otherwise the first
  provider folder, else `os.tmpdir()`. Subfolders, junctions/symlinks to elsewhere and unknown UNC shares never match;
  UNC paths are never passed to `realpath`. The spool path never calls `ptahAPI.workspace`
- Telemetry: one `logger.debug('[MCP] tool result', …)` per `tools/call` from `handleToolsCall`'s `finally`, inside
  `runObserver`, with `{ tool, durationMs, resultChars, rawTokens, returnedTokens, reducer, truncated, isError }`.
  `tool` is the name only when it is in `registeredToolNames` (built once from `buildToolDefinitions` with every
  capability on), else `'<unknown>'`; the slow-tool warn uses the same name
- Every result observer (`onToolResult` on all paths, the `execute_code` error `logger.error`) runs in `runObserver`
- `tools/list` key order per tool: `anthropic/alwaysLoad` (eager tools) then `anthropic/maxResultSizeChars`

### Batch 2f team-leader verification (Mode 2, 2026-09-26)

- On disk: `protocol-dispatcher.ts` (async `createToolSuccessResponse`, `budgetToolText`, `tokensWithinBudget`,
  `resolveSpoolRoot`, `stripExtendedLengthPrefix`, `canonicalFolderKey`, `buildToolDefinitions`,
  `declareResultBudgets`, `telemetryToolName`, `toolResultTelemetry`), its spec (+728 lines) and
  `http-mcp-server.service.ts` (+20); no TODO/FIXME/PLACEHOLDER/STUB markers in the added lines; no stray files
- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache` →
  exit 0, "Successfully ran targets test, lint, typecheck"
- `node_modules/.bin/nx run-many "-t=typecheck" -p ptah-cli ptah-electron --skip-nx-cache` → exit 0
- `tools/list` byte comparison against HEAD `f7f354714` (the pre-extraction dispatcher, copied to the OS temp dir
  with its relative imports pointed at the worktree): 1,152 configurations (`hasIDECapabilities` ×
  `hasSqliteLayer` each in {undefined, false, true} × all 128 subsets of the 7 disabled namespaces). After removing
  only `anthropic/maxResultSizeChars` (and a then-empty `_meta`), `JSON.stringify` of the result is byte-identical in
  all 1,152 (0 differ). Every tool except `approval_prompt` carried the key in every configuration. This closes the
  executor's caveat (c) that `buildToolDefinitions` was not byte-compared against the pre-extraction source.
  Temp files removed afterwards
- Code commit `e131070da` stages exactly the 3 files above; docs committed separately

### Batch 2f follow-ups (not blocking)

- Pre-existing: an error thrown inside `execute_code` reaches the agent as "Code execution failed: Unknown error"
  (sandbox errors are not host-realm `instanceof Error`), so hints such as "File not found:" never fire. Candidate
  for a later batch that owns `handleExecuteCodeCall` / `code-execution.engine.ts`
- Packaged-host smoke and live concurrency (concurrent spool writes, filesystem mutation during canonicalisation)
  not exercised. Carry into the Batch 21 / release smoke checks with the Batch 2e packaging follow-up
- `ptah_browser_content`: the HTML block is omitted over budget (Deviation 5). Still for the batch that owns browser
  output
- Carried: formatter caps and screenshot transcript work noted by r3 as deferred

### Notes for Batch 3 (added at Batch 2f close)

- The telemetry line is built in `toolResultTelemetry` (`protocol-dispatcher.ts`); Task 3.2 adds `callerKind` there.
  Keep it a `debug` line inside `runObserver`, and never log a raw caller id or unregistered name
- `handleToolsList` now composes through `buildToolDefinitions(deps)` → `markEagerTools` → `declareResultBudgets`.
  Task 3.2's `buildToolSet(caller, deps)` should wrap or replace `buildToolDefinitions` without changing that order;
  `registeredToolNames` is derived from `buildToolDefinitions({ hasIDECapabilities: true })` and must keep matching
  the full list
- The Batch 2f byte-stability spec (`tools/list maxResultSizeChars` describe) is the pattern for the Task 3.2
  four-caller-kind byte-identity guard
- The spool root must stay host-owned: do not route it through the new caller context. `getCallerWorkspaceRoot()` is
  only a candidate that must match a provider folder

---

## Batch 3: Caller identity for tools/list and the request context — COMPLETE (commit 153fb036f)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: shared plumbing that TASK_2026_560 depends on, and it touches the dispatcher hub. User Decision 5 fixes the approach (URL parsing, no lifecycle move)
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 2f

### Task 3.1: `McpCaller` resolution and `callerAgentId` in the context — COMPLETE

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-caller.ts` (new), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-caller.spec.ts` (new), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-request-context.ts`, `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-request-context.spec.ts`
- Plan reference: research-report.md:170-181, :290-304; research/cross-cutting.md:275-291; context.md User Decision 5
- Pattern to follow: `getCallerSessionId`/`getCallerWorkspaceRoot` (`mcp-request-context.ts:50-62`)
- Quality requirements: `resolveMcpCaller(request): McpCaller`. Kind precedence: agent > session > workspace > anonymous. Empty or whitespace fields count as absent. `McpRequestContext` gains `callerAgentId` and a `getCallerAgentId()` getter
- Validation notes: confirm the stdio/CLI path (no URL) yields `anonymous`. A malformed field never borrows another caller's identity
- Implementation details: pure function, no I/O. Specs for each kind, precedence, and malformed/empty fields

### Task 3.2: Thread the caller into tools/list, tools/call and telemetry — COMPLETE

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

### Batch 3 review history

- Executor: backend-developer (`batch-3-executor-report.md`)
- Review r1 (`reviews/batch-3-code-logic-review-r1.md`, Codex cross-side lane): **APPROVED 8/10**, 0 blocking /
  0 serious / 1 moderate. The moderate (F1) is pre-existing and outside the batch files (follow-up (a) below)

### Batch 3 deviations (both accepted by r1)

1. The context's `callerSessionId` / `callerWorkspaceRoot` keep the transport's RAW values; only `callerAgentId` comes
   from the normalised `McpCaller`. Reason: `McpCallerWorkspaceResolver` refuses a declared root that is not open by
   name, and the Batch 2f spool root treats the declared root only as a candidate; normalising a whitespace root to
   absent would turn a refusal into an anonymous fallback. Recorded in a comment at the `tools/call` case
2. `ptah_agent_spawn` still passes `request._callerSessionId` as `parentSessionId`; it equals the context's raw
   session value, so there is one source

### Batch 3 team-leader verification (Mode 2, 2026-09-26)

- On disk: `mcp-caller.ts` (86 lines, pure `resolveMcpCaller`, `McpCaller`, `McpCallerKind`), `mcp-caller.spec.ts`,
  `mcp-request-context.ts` (`callerAgentId`, `getCallerAgentId`), its spec, `protocol-dispatcher.ts`
  (`buildToolSet(caller, deps)` → `markEagerTools` → `declareResultBudgets`; `callerAgentId` in the `tools/call`
  context; `callerKind` in `toolResultTelemetry`; `ptah_agent_report` reads `getCallerAgentId()` only) and its spec.
  No TODO/FIXME/PLACEHOLDER/STUB markers; no `mcp-http` file touched; no stray files
- TASK_2026_560 interface check: `McpCaller = { kind; sessionId?; agentId?; workspaceRoot? }` and
  `buildToolSet(caller, deps)` shipped with the names and shape recorded above. No correction needed
- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache` →
  exit 0, "Successfully ran targets test, lint, typecheck"
- `node_modules/.bin/nx run-many "-t=typecheck" -p ptah-cli ptah-electron --skip-nx-cache` → exit 0
- EACCES note: the r1 reviewer's run had 1 failure, `HTTP server lifecycle > logs the started line exactly once even
after a port fallback` (`mcp-http/http-server.handler.spec.ts:220`, `listen EACCES ::1:59700`), a real-port
  fixture. Batch 3 changed no `mcp-http` file (`git diff --name-only` empty for that directory). Rerun here: the full
  project run above passed, and the single test run on its own (`jest -c libs/backend/vscode-lm-tools/jest.config.ts
…/http-server.handler.spec.ts -t "port fallback"`) → 1 passed. Conclusion: the Codex sandbox denied the port bind;
  not a Batch 3 regression. Nx labelled the test task "flaky" only because that earlier run had the same inputs
- Code commit `153fb036f` stages exactly the 6 files above; docs committed separately. `code-logic-review.md` (the
  lane's canonical copy) and `research/diagnostics-worktree-repro.ts` stay untracked

### Batch 3 follow-ups (not blocking)

- (a) MODERATE, pre-existing (r1 F1): `http-server.handler.ts` `extractCaller*` call `decodeURIComponent` unguarded
  (:248, :274, :306; catch at :394). A malformed escape (`/agent/%E0%A4%A`, `/session/%`, `/workspace/%FF`) returns
  HTTP 400 / `-32700 Parse error` with `id:0` before dispatch, instead of the `anonymous` caller the edge case above
  promises. No identity is borrowed. Needs a transport-owned fix: separate URI decoding from JSON parsing, and either
  discard the whole attribution atomically (anonymous) or return an explicit invalid-URL error with the parsed id;
  pin the policy with a spec
- (b) `mcp-core/index.ts` does not export `resolveMcpCaller`, `McpCaller`, `McpCallerKind` or `getCallerAgentId`.
  Nothing outside mcp-core needs them in 559; TASK_2026_560 adds the barrel exports when it consumes them
- (c) `protocol-dispatcher.ts` is 2,680 lines on disk after this batch (the executor report's "2,103" is wrong),
  far over the 700-line soft ceiling (`max-lines` lint warning). Flag for a later facade split (for example tool
  catalogue/`buildToolSet`, budget/spool, telemetry, per-tool handlers); not in any 559 batch scope
- Real-port lifecycle spec (`http-server.handler.spec.ts:220`) fails in sandboxes that deny port binding. Candidate
  for Batch 20/21 (harness) to make deterministic, with the timing-spec note from Batch 2a

### Notes for Batch 4 (added at Batch 3 close)

- `handleInitialize` stays outside `runWithMcpRequestContext` (User Decision 5). The instructions are the same for
  every caller (Edge case: byte-stable), so Task 4.2 must NOT branch on `resolveMcpCaller(request)`; a spec that
  sends `initialize` with each of the four caller kinds and asserts identical `result.instructions` is the Batch 3
  byte-identity pattern (`caller identity (TASK_2026_559 Batch 3)` describe in `protocol-dispatcher.spec.ts`)
- The dispatcher is the hub (follow-up (c)): put the derivation in the new `server-instructions.ts` and keep the
  dispatcher change to the `handleInitialize` result field plus the import
- Compute the instructions once (module-level constant or lazy memo), not per request

---

## Batch 4: Server `instructions` derived from the shipped mandate — COMPLETE (commit 53e823e13)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: small, but it crosses into agent-sdk (barrel export only) and edits the dispatcher hub
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 3

### Task 4.1: Export the substitution section from the agent-sdk barrel — COMPLETE

- Files: `<WT>/libs/backend/agent-sdk/src/lib/prompt-harness/index.ts`, `<WT>/libs/backend/agent-sdk/src/index.ts`
- Plan reference: research-report.md:151-155; context.md User Decision 4 (constants unchanged)
- Pattern to follow: the existing `PTAH_CORE_SYSTEM_PROMPT` re-export (`agent-sdk/src/index.ts:284-286`)
- Quality requirements: export only. `ptah-core-prompt.ts` stays byte-identical (`git diff` must show no change to it)
- Validation notes: re-check `@nx/enforce-module-boundaries` lint for the new vscode-lm-tools → agent-sdk value import
- Implementation details: add `PTAH_MCP_SUBSTITUTION_SECTION` to both export lists

### Task 4.2: `server-instructions.ts` and `handleInitialize` — COMPLETE

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

### Batch 4 review history

- Executor: backend-developer (`batch-4-executor-report.md`)
- Review r1 (`reviews/batch-4-code-logic-review-r1.md`, Codex cross-side lane): **REVISE 7/10**. M1: the closing sent
  the omitted substitutions to `ptah.help()`, which documents only the `execute_code` API. M2: the 512 limit counted
  UTF-16 chars, not UTF-8 bytes. The agent-sdk value import was checked: no cycle, and no new heavy load (agent-sdk
  is already reached through cli-agent-runtime). Fixed in revision round 1
- Review r2 (`reviews/batch-4-code-logic-review-r2.md`, Codex): **REVISE 7/10**. M2 fixed. M1 remainder: the mappings
  were unconditional and the closing promised a count of further tools, which is false on non-IDE hosts and when the
  `ide`/`code` namespaces are disabled. Revise cap reached; the orchestrator allowed one bounded correction
  (conditional wording, no count)
- Review r3-postcap (`reviews/batch-4-code-logic-review-r3-postcap.md`, Codex): **APPROVE 8/10**, no findings. The
  lane swept 768 host configurations, 6,144 `initialize` executions (one distinct string) and 14,721 Unicode cases

### Batch 4 shipped text and trade-off

- Shipped instructions: 509 chars / 509 bytes (all ASCII; measured by r3). A conditional header ("Prefer these
  ptah_* tools when listed in tools/list:"), 3 derived table rows, the derived "Fall back to …" line, a fixed "If a
  tool is not listed, use the built-in." line, "Also, if listed: ptah_lsp_references", and a conditional closing
  that ends with `execute_code API: ptah.help()`. No line states a tool count
- Trade-off: to stay truthful on every host under 512 bytes, most substitutions are reachable only through
  `tools/list`. Follow-up idea (NOT approved scope): per-host instructions filtered by the served tool set would
  allow more rows. That would give up the single byte-stable variant, so it needs a user decision

### Batch 4 deviations (accepted)

1. `libs/backend/vscode-lm-tools/package.json` gained `"@ptah-extension/agent-sdk": "0.0.1"`. The
   `@nx/dependency-checks` lint rule requires it for the new value import. Module boundaries: both libs are tagged
   `scope:extension` / `type:feature`; lint passes

### Batch 4 team-leader verification (Mode 2, 2026-09-26)

- On disk: `server-instructions.ts` (pure `buildServerInstructionsFrom(section)`, memoised `buildServerInstructions()`,
  `MAX_SERVER_INSTRUCTIONS_CHARS = 512`, `size()` = max(UTF-16 length, UTF-8 bytes), code-point-safe truncation),
  `server-instructions.spec.ts` (431 lines), `protocol-dispatcher.ts` (+1 import, `instructions:
buildServerInstructions()` in `handleInitialize`, no caller branching), `protocol-dispatcher.spec.ts` (handshake
  asserts `instructions`; a four-caller byte-identity test), both agent-sdk barrels (+1 export line each),
  `vscode-lm-tools/package.json`. No TODO/FIXME/PLACEHOLDER/STUB markers; no stray files
- `git diff --stat HEAD -- libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts` → empty. The protected
  constant is byte-identical (the r3 lane could not run git; certified here)
- `node_modules/.bin/nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/agent-sdk
--skip-nx-cache` → exit 0, "Successfully ran targets test, lint, typecheck for 2 projects"
- `node_modules/.bin/nx run-many "-t=typecheck" -p ptah-cli ptah-electron --skip-nx-cache` → exit 0
- Code commit stages exactly the 7 files above; docs committed separately. `code-logic-review.md` (the lane's
  canonical copy) and `research/diagnostics-worktree-repro.ts` stay untracked

### Batch 4 follow-ups (not blocking)

- (a) Per-host instructions filtered by the served tool set (see the trade-off above). Not approved scope
- (b) Out of scope: specs in OTHER projects that import `protocol-dispatcher.ts` now load the agent-sdk barrel, so they
  must load `reflect-metadata` first (the pattern at `vendor-roster-drift.spec.ts:28-33`). No such spec fails today
  (every checked project passed); a new one written without the import would fail at load

### Notes for Batch 5 (added at Batch 4 close)

- Batch 5 touches no hub file (store and port only: memory-contracts, memory-curator). No overlap with Batches 1-4
- Keep `getIndexFreshness?` OPTIONAL on the port (risk table): Batch 6 treats its absence as "unknown freshness"
- The recall guard must fail on regression (seed ≥ 12 symbols, camelCase names); a logging-only spec does not count

---

## Batch 2x-audit: Degradation-audit remediation and app build-config mapping (unplanned) — COMPLETE (commit 51694c32c)

- Origin: unplanned remediation, approved by the orchestrator on 2026-09-26. It does NOT raise `baseline.json`
- Executor: backend-developer (`batch-2x-audit-executor-report.md`); review fix applied by the orchestrator
- Execution mode: sequential
- Tasks: 1 | Depends on: Batches 2c-2f (the sites it clears were introduced there)

### Why this batch exists

- Git hooks never ran on this branch: `core.hooksPath=.husky/_`, but `.husky/_` was missing in this worktree, so git
  skipped pre-commit and commit-msg silently. Once `node_modules/.bin/husky` created it, the Batch 5 commit failed in
  pre-commit on `degradation-audit:lint` for sites committed by earlier batches (see "Batch 5 commit" below)
- The same gap hid a build-config break present since Batch 2e: `@ptah-extension/tool-output-reducers` was not mapped
  in the ptah-electron, ptah-cli and ptah-tui `tsconfig.build.json` paths, and `marked` (a reducer dependency) was not
  in the ptah-electron `build-main` esbuild externals

### Task 2x.1: Clear the audit sites and map the reducer lib in the app builds — COMPLETE

- Audit sites (10): 7 declared `optional-capability` / `reported` with the reason on the catch
  (`content-detector.ts` isJson, `reduce-output.ts` errorName, `code-outliner.adapter.ts` queryMulti,
  `protocol-dispatcher.ts` tokensWithinBudget, `tool-result-budget.ts` spoolRaw partial-file removal, errorCode,
  errorName); 1 logged at warn and declared (`protocol-dispatcher.ts` knownWorkspaceFolders: fixed-text warn inside
  `runObserver`, the result still spools under the system temp directory); 2 pre-existing
  (`analysis-namespace.builders.ts:364`, `:376`) sit within the vscode-lm-tools baseline of 2
- Build config: tool-output-reducers path added to `apps/ptah-electron`, `apps/ptah-cli`, `apps/ptah-tui`
  `tsconfig.build.json`; `marked` added to `apps/ptah-electron/project.json` build-main externals. Executor evidence:
  validate-deps passes; cli/tui/vscode production builds pass; the Electron dist package.json lists `marked` and
  `gpt-tokenizer`

### Batch 2x-audit review history

- r1 (`reviews/batch-2x-audit-code-logic-review-r1.md`): **REVISE 5/10**. Blocking: the new warn logged the raw
  provider error text (can carry paths). Serious: an unguarded warn could throw and break the temp-dir fallback.
  Fixed by the orchestrator: a fixed-text warn inside `runObserver`, plus two specs ("never logs the workspace
  provider error text", "still spools under the system temp directory when the warn log throws")
- r2 (`reviews/batch-2x-audit-code-logic-review-r2.md`): **APPROVE 8/10**

### Batch 2x-audit team-leader verification (Mode 2, 2026-09-26)

- Diff read on disk: 6 lib files (comments + the warn + prettier reflow), 4 app config files; no stubs
- `nx run degradation-audit:lint --skip-nx-cache` → exit 0, TOTAL 300 unsuppressed sites, every directory within
  baseline
- `nx run-many -t test -p tool-output-reducers vscode-lm-tools memory-curator memory-contracts` → 3 projects pass
  (memory-contracts has no test target)
- Commit with hooks active: pre-commit (lint-staged format + affected lint, `ptah-electron:validate-deps`) and
  commit-msg (commitlint) passed. The first attempt failed commitlint (header 103 chars; scope `apps` not in the
  enum) and was recommitted with scopes `electron,cli,tui`

### Batch 2x-audit follow-ups (not blocking)

- The 4 historic over-length commit subjects (153fb036f, e131070da, b93ef13a8, ba56da867) are not rewritten
- The packaged Electron GUI was not started after the externals change; a packaged-app startup smoke test is still
  owed (QA or release)

---

## Batch 5: code_symbols freshness and exact-name recall (store layer) — COMPLETE (commit 670ee1fbc)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential (file-disjoint from every hub-file batch; MAY run alongside Batches 2a-4)
- Rationale: store and port only. It is the foundation for Batch 6 and the home of the code_search_symbols recall guard
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: none

### Task 5.1: Optional `getIndexFreshness` on the port, implemented by the store — COMPLETE

- Files: `<WT>/libs/backend/memory-contracts/src/lib/code-symbol-reader.port.ts`, `<WT>/libs/backend/memory-contracts/src/index.ts` (only if a new type is exported), `<WT>/libs/backend/memory-curator/src/lib/code-symbol.store.ts`
- Plan reference: research/code-intel.md:294-313; research-report.md:182-190
- Pattern to follow: `CodeSymbolStore.count(workspaceRoot)` (`code-symbol.store.ts:206`)
- Quality requirements: `getIndexFreshness?(workspaceRoot): Promise<{ symbolCount: number; newestUpdatedAt: number | null }>` — optional on the port. The store implements it with one `COUNT(*), MAX(updated_at)` query scoped to the workspace root
- Validation notes: RISK "required method breaks test doubles" is carried here. Optional only
- Implementation details: prepared statement consistent with the store's existing statement style

### Task 5.2: Exact-name candidate source and the recall benchmark — COMPLETE

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

### Batch 5 review history

- Executor: backend-developer (`batch-5-executor-report.md`)
- Review r1 (`reviews/batch-5-code-logic-review-r1.md`, Codex cross-side lane): **REVISE 6/10**. M1: `COLLATE NOCASE`
  folds only ASCII, so `Äpfel`/`äpfel` missed the exact tier. M2: the recall guard skipped silently when the native
  module failed to load. The RRF weight-3 rank-1 proof was confirmed. Fixed in revision round 1
- Review r2 (`reviews/batch-5-code-logic-review-r2.md`, Codex): **REVISE 7/10**. M1 and M2 fixed. New M3: the JS
  fallback scanned every same-length row (~172 ms against ~18 ms at 100k rows). Revise cap reached; the orchestrator
  allowed one bounded correction (an ASCII miss goes to SQL NOCASE; only non-ASCII queries use the JS scan, which
  streams rowid and name)
- Review r3-postcap (`reviews/batch-5-code-logic-review-r3-postcap.md`, Codex): **APPROVE 8/10**, M1-M3 fixed. A
  100k-row ASCII miss took 43.7 ms with zero JS iterations. An exhaustive Unicode enumeration found only the Kelvin
  sign as a non-ASCII to ASCII fold

### Batch 5 known issues

- KI-5-1: an ASCII query does not match a stored name that contains U+212A KELVIN SIGN. Per the exhaustive
  enumeration on Node v24.15.0 (Unicode 17.0), it is the only such code point. The identical spelling still reaches
  the exact tier. Pinned by the spec `documented gap: an ASCII query does not match a stored name with U+212A KELVIN SIGN`

### Batch 5 deviations (accepted)

1. `CODE_SEARCH_MAX_TOP_K = 50` replaces the `50` literal in `searchSymbols` (same value), so the weight derivation
   depends on it
2. The recall guard now fails under CI (`CI` set and not `''`/`'false'`) when better-sqlite3/sqlite-vec cannot load. A
   local run without CI skips it and writes a stderr message that names the guard

### Batch 5 team-leader verification (Mode 2, 2026-09-26)

- On disk: port (`CodeIndexFreshness`, optional `getIndexFreshness?`), barrel (+1 type export), store
  (`getIndexFreshness`, `exactNameSymbols` / `nameEqualsSymbols` / `foldedNameSymbols`, 3-list RRF with
  `EXACT_NAME_RRF_WEIGHT = 3`), spec (+802 lines). No TODO/FIXME/PLACEHOLDER/STUB markers; no stray files
- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/memory-curator @ptah-extension/memory-contracts
--skip-nx-cache` → exit 0, "Successfully ran targets test, lint, typecheck for 2 projects"
- `nx run @ptah-extension/memory-contracts:eslint:lint --skip-nx-cache` → exit 0
- `nx run-many "-t=typecheck" -p @ptah-extension/agent-sdk @ptah-extension/vscode-lm-tools ptah-electron
--skip-nx-cache` (port consumers) → exit 0, 3 projects
- `CI=true jest -c libs/backend/memory-curator/jest.config.ts code-symbol.store.spec` → 39 passed, 39 total, 0 skipped
- The earlier ESLint `no-useless-assignment` warning on `nativeAvailable` is gone: ESLint on all 4 changed files
  reports nothing
- `degradation-audit`: `libs/backend/memory-curator: 20 ok (baseline 20)`. Batch 5 adds no swallowed-failure finding
- Prettier drift (formatter output only, not a behaviour issue): `prettier --check` / `nx format:check` flag 3 hunks,
  `code-symbol.store.ts:438-440` and two in the spec (~:1162, ~:1299). The pre-commit `nx format:write` fixes these
  once the hook can run

### Batch 5 commit — unblocked by Batch 2x-audit; committed as 670ee1fbc with hooks active

- Resolution (2026-09-26): Batch 2x-audit (51694c32c) brought both directories back to baseline without raising it.
  Batch 5 then committed with pre-commit and commit-msg passing; the hook's formatter fixed the 3 prettier hunks noted
  above. Post-commit tree is clean for the 4 Batch 5 files
- History of the block, kept for the record:

- Every earlier commit on this branch ran NO git hooks. `core.hooksPath=.husky/_`, but `.husky/_` did not exist in
  this worktree (husky's `prepare` never ran here), so git skipped the hooks silently. The team-leader ran
  `node_modules/.bin/husky` on 2026-09-26 to create it. Hooks are active from now on
- The first Batch 5 code commit (51945f2ee, local, never pushed) was made before this was found. Its header was 103
  chars, over commitlint's 100-char limit. It was soft-reset, and the recommit with hooks active failed in pre-commit:
  `nx affected --target=lint` → `degradation-audit:lint` failed. The Batch 5 files stay STAGED, uncommitted
- Cause (already on the branch; CI runs this ratchet at `.github/workflows/ci.yml:141-144`):
  - `libs/backend/tool-output-reducers: 2 FAIL (baseline 0)`: `content-detector.ts:118`, `reduce-output.ts:267`
    (catch-return-sentinel)
  - `libs/backend/vscode-lm-tools: 8 FAIL (baseline 2)`: `code-outliner.adapter.ts:176`, `protocol-dispatcher.ts:2365`
    and `:2402`, `tool-result-budget.ts:485` (promise-catch-sentinel), `:606` and `:619`,
    `analysis-namespace.builders.ts:364` and `:376`
- Four earlier commit headers also fail commitlint header-max-length. No CI job runs commitlint, so this is
  informational only; do not rewrite pushed history for it: 153fb036f (batch 3), e131070da (2f), b93ef13a8 (2e),
  ba56da867 (2d)
- Needed before Batch 5 can commit: a remediation batch that brings both directories back to baseline. For each
  site, either rethrow or surface the error, or declare an intentional fallback to the audit the way the repo already
  does (see commit c74443c1b `fix(skill-synthesis-ui): declare the superseded-detail catch to the audit`). Raising the
  baseline needs a user decision

### Batch 5 follow-ups (not blocking)

- (a) Indexed lowercase-key column: `symbol_name_lower` with an index on `(workspace_root, symbol_name_lower)`, added
  through a persistence-sqlite migration with backfill; the sink/upsert keeps it current. This removes the
  O(workspace) non-ASCII miss scan and KI-5-1. The key policy must be tied to the runtime's Unicode version, or the
  column rebuilt when that version changes
- (b) An ASCII miss still runs two SQL workspace scans (43.7 ms at 100k rows, against the 17.1 ms one-query control).
  (a) also removes this

### Notes for Batch 6 (added at Batch 5 review close)

- Import `CodeIndexFreshness` from `@ptah-extension/memory-contracts` (exported type). `getIndexFreshness` is OPTIONAL;
  its absence means "unknown freshness" and must never trigger a reindex
- An empty index is `{ symbolCount: 0, newestUpdatedAt: null }`. Treat `symbolCount === 0` as stale; do not compute
  an age from `null`
- The store is synchronous under its async signature; a freshness call does not yield. Keep `ensureIndexFresh`
  fire-and-forget as planned
- Batch 6 edits `protocol-dispatcher.ts` and the vscode-lm-tools namespace builders. vscode-lm-tools sits exactly at
  its degradation-audit baseline (2) after Batch 2x-audit, so any new swallowing catch (including the
  `ensureIndexFresh` rejection handler) must be declared with a `// degradation-audit: <kind> — <reason>` comment, or
  the pre-commit hook fails. Hooks are active now: run `node_modules/.bin/nx run degradation-audit:lint` before
  reporting

---

## Batch 6: Index freshness at the MCP surface — lazy reindex and `ptah_code_reindex` — COMPLETE (commit 31c6b6995)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: governor and in-flight semantics need one executor who holds the whole path in mind
- Review: Codex CLI lane (logic + structure)
- Tasks: 3 | Depends on: Batches 2f, 5

### Task 6.1: `ensureIndexFresh` in the code namespace, and freshness in search results — COMPLETE

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/code-namespace.builder.ts`, `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/code-namespace.builder.spec.ts`
- Plan reference: context.md User Decision 1; research/code-intel.md:294-308
- Pattern to follow: `reindex()` (`code-namespace.builder.ts:163-195`); the TASK_2026_437 comment at :184-188
- Quality requirements: `ensureIndexFresh()` reads `getIndexFreshness` (skips when it is absent or there is no indexer). When `symbolCount === 0` or age > `CODE_INDEX_STALE_MS = 24h`, it starts `indexer.indexWorkspace(root, {userInitiated:false})` WITHOUT awaiting it. A per-workspace in-flight latch; the latch clears on settle; rejection is logged and swallowed. `searchSymbols` results gain `index: { symbolCount, indexAgeMs, reindexStarted, reindexInFlight }`. `reindex()` with no `filePath` starts a full run in the background (`userInitiated:true`, not awaited) and returns `{ started: true, ...freshness }`; the `filePath` path stays awaited
- Validation notes: RISK "deadlock / double run" is carried here. Specs: a stale index triggers exactly once across 3 concurrent calls; a fresh index never triggers; no freshness method → no trigger; indexer rejection does not surface as a search error; the result shape includes freshness
- Implementation details: inject the clock (`now()`) through deps for tests

### Task 6.2: `ptah_code_reindex` tool and dispatcher wiring — COMPLETE

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts`, `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`, `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`
- Depends on: Task 6.1
- Plan reference: research-report.md:182-190
- Pattern to follow: `buildCodeSearchSymbolsTool` and its dispatcher case (`protocol-dispatcher.ts:1767-1792`)
- Quality requirements: `buildCodeReindexTool()` (optional `filePath`), registered in the `'code'` namespace group after `ptah_code_search_symbols`, and NOT eager. The `ptah_code_search_symbols` and `ptah_lsp_definitions` cases call `ptahAPI.code.ensureIndexFresh()` (fire-and-forget) before answering. The search response surfaces the freshness block
- Validation notes: VS Code (no indexer) → a graceful error result for reindex, and no throw from ensureIndexFresh
- Implementation details: specs for the new case (full → started, file → stats), the ensureIndexFresh call on both cases, and tools/list containing the tool under `code` only

### Task 6.3: Tool description guard — COMPLETE

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

### Batch 6 review history

- Executor: backend-developer (`batch-6-executor-report.md`)
- Review r1 (`reviews/batch-6-code-logic-review-r1.md`, Codex cross-side lane): **REVISE 7/10**. M1: `execute_code`
  definition lookups bypassed the lazy freshness hook. M2: an explicit reindex returned a freshness-read error after it
  had already started the run. The reviewer also corrected the executor's Electron boot-overlap note:
  `boot-thoth-runtime.ts:485` is a user-triggered callback; only the VS Code startup call (`wire-runtime.ts:207`) can
  overlap. Fixed in revision round 1
- Review r2 (`reviews/batch-6-code-logic-review-r2.md`, Codex): **REVISE 7/10**. M1 and M2 fixed. New F1:
  `searchSymbols` reported `reindexInFlight: false` while a run was pending and the freshness read rejected. Revise cap
  reached; one bounded correction allowed
- Review r3-postcap (`reviews/batch-6-code-logic-review-r3-postcap.md`, Codex): **APPROVE 8/10**, no findings

### Batch 6 deviations (accepted)

1. The `ptah_code_search_symbols` dispatcher case does not call `ensureIndexFresh`: `searchSymbols` runs it itself (so
   `execute_code` callers get it too) and returns the outcome as `index`. A second call would report `reindexStarted`
   from the call that did not start the run
2. `ptah_code_reindex` accepts only an absolute `filePath`; a relative one is a tool error
3. The definition-lookup hook lives only in the capability-backed IDE namespace (`onDefinitionLookup`, wired in
   `ptah-api-builder.service.ts`); the standalone namespace has no lookup to hook
4. Three files outside the batch list: `ptah-api-builder.service.ts` (hook wiring), `ptah-system-prompt.constant.ts`
   (`execute_code` help text, not a frozen constant), and the plugin `internal-mcp.md` tool catalog

### Batch 6 team-leader verification (Mode 2, 2026-09-26)

- On disk: `ensureIndexFresh` with a per-workspace in-flight latch, `index` freshness block on search, background full
  reindex (`userInitiated: true`) and awaited file reindex, `buildCodeReindexTool` in the `code` group only,
  `onDefinitionLookup` hook. No TODO/FIXME/PLACEHOLDER/STUB markers; no stray files
- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools --skip-nx-cache` → "Successfully ran targets
  test, lint, typecheck"
- `nx run degradation-audit:lint --skip-nx-cache` → `libs/backend/vscode-lm-tools: 2 ok (baseline 2)`
- `ptah-core-prompt.ts` unchanged against HEAD; `NATIVE_AGENT_TOOL_POLICY`
  (`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts`) unchanged
- Commit 31c6b6995: pre-commit and commit-msg hooks passed

### Batch 6 follow-ups (not blocking)

- (a) The VS Code startup index run (`wire-runtime.ts:207`) is not covered by the namespace in-flight latch, so it can
  overlap a lazy run: wasted work, no deadlock
- (b) An explicit `ptah_code_reindex` uses `userInitiated: true` and so bypasses the governor's per-batch wait. Accepted
  per the batch spec
- (c) `internal-mcp.md` always-on tool count was already out of date before this batch (12 listed against 15 served);
  the drift remains

---

## Batch 7: ptah_context_enrich_file — infer language, name the fallback reason — COMPLETE with known issues KI-7-1..KI-7-4 (commit c42b8cee6)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: P0, never met since `2b537f44c`. The namespace layer fixes both MCP and `execute_code` at once
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 6 (hub-file ordering only)

### Task 7.1: Extension→language inference in `enrichFile` — COMPLETE

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.ts` (:88-110), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.spec.ts`, `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts` (`ptah_context_enrich_file` `language` property text: optional, inferred from the extension; tsx/jsx covered)
- Plan reference: research/code-intel.md:194-228; research-report.md:87
- Pattern to follow: `CodeSymbolIndexer.extensionToLanguage` (`code-symbol-indexer.service.ts:138-140`) over `EXTENSION_LANGUAGE_MAP`
- Quality requirements: explicit `language` wins. Otherwise infer from the extension (`.ts/.tsx/.mts/.cts` → typescript, `.js/.jsx/.mjs/.cjs` → javascript, plus whatever else the map supports that the service accepts). Unsupported → pass undefined
- Validation notes: explicit/contradicting-language edge case. Import the map through the workspace-intelligence public barrel; if it is not exported there, export it (that would be a 6th file — note it in the report)
- Implementation details: specs — `.ts` with no language → `mode:'structural'`; `.tsx` → structural; `.py` → full with reason `unsupported-language`; explicit language is forwarded unchanged

### Task 7.2: `reason` on full-content fallbacks — COMPLETE (known issues KI-7-1..KI-7-4)

- Files: `<WT>/libs/backend/workspace-intelligence/src/context-analysis/context-enrichment.service.ts` (`StructuralSummaryResult` :32, branches :95, :117-121, :129-134, `createFullContentResult` :354), `<WT>/libs/backend/workspace-intelligence/src/context-analysis/context-enrichment.service.spec.ts` (new)
- Plan reference: research/code-intel.md:209-213, :226-228
- Pattern to follow: existing result construction in the same file
- Quality requirements: `reason?: 'unsupported-language' | 'parse-failed' | 'read-failed'` on every `mode:'full'` result; structural results carry none
- Validation notes: "didn't try" and "tried and failed" are never identical
- Implementation details: specs for each branch with mocked file system, AST and token counter

### Batch 7 verification

- `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence 2>&1 | tail -40` passes
- The Codex review lane approves (not met; committed under User Decision 13 with known issues)

### Batch 7 review history and user decisions

- Executor: backend-developer (`batch-7-executor-report.md`, all sections)
- Review r1 (`reviews/batch-7-code-logic-review-r1.md`, Codex cross-side lane): **REVISE 4/10**. B1: inferred TSX
  components produced an empty summary. B2: `.d.ts` files, interfaces and types produced an empty summary. Fixed in
  revision round 1 (parse-tree writer `declaration-summary.ts`; `.tsx` unsupported)
- Review r2 (`reviews/batch-7-code-logic-review-r2.md`, Codex): **REVISE 4/10**. R2-B1 runtime exports bypassed the
  guard; R2-B2 blank-line cleanup changed template literals; R2-S1 huge initialisers; R2-M1 quadratic render. Revise
  cap reached; one bounded correction allowed
- Review r3-postcap (`reviews/batch-7-code-logic-review-r3-postcap.md`, Codex): **REVISE 4/10**. R3-B1 exports aliases,
  `globalThis`, prototype installers; R3-B2 referenced methods in elided objects; R3-S1 wrapped/mixed initialisers;
  R3-M1 character-based not-smaller gate. Stopped and asked the user → **User Decision 13** (context.md): refuse more —
  summaries only for declaration-only files; token-based not-smaller gate; one final narrow fix and one more review;
  commit if it approves, otherwise commit with its defects recorded as known issues
- Review r4-decision13 (`reviews/batch-7-code-logic-review-r4-decision13.md`, Codex): **REVISE 4/10**. Every r1-r3
  reproduction is fixed; four blocking defects remain → recorded below as KI-7-1..KI-7-4 and committed per Decision 13

### Batch 7 known issues

The structural summary must be treated as lossy for the forms below until fixed. Every other output is either a
complete declaration summary or an honest full-file result with a `reason`.

- **KI-7-1 (R4-B1)** — a decorator can call an in-file function whose body is elided and which installs API at load
  time (decorators are exempt from the load-time rule because `@injectable()`/`@inject()` are everywhere). The summary
  omits the installed member
- **KI-7-2 (R4-B2)** — instance-field initialisers and factories can install public instance members through code the
  summary elides; the summary omits those members
- **KI-7-3 (R4-B3)** — getter reads and template coercion (`${x}`) inside a kept small literal (≤ 400 chars) run code at
  load time that can install exports; not treated as load-time calls, so the summary omits what they install
- **KI-7-4 (R4-B4)** — a pure-data object literal over 400 chars is elided to `{ … }`, dropping its named public
  property keys. Likely the most common of the four in normal code. Recommended fix: keep the property keys of elided
  pure-data objects (elide only the values), or refuse

### Batch 7 deviations (accepted)

1. `.jsx` is inferred as javascript (the JavaScript grammar parses JSX; pinned by a real-parser spec). `.tsx` is not
   inferred and returns `unsupported-language`; an explicit `typescript` on `.tsx` returns `parse-failed`, because
   `tree-sitter-tsx.wasm` is not shipped
2. python, go and csharp always return full content with `unsupported-language`, also for `ContextSizeOptimizerService`
   (more tokens, no lost API)
3. `ContextEnrichmentService` injects `TOKENS.TREE_SITTER_PARSER_SERVICE` (already registered before it in
   `di/register.ts`) in place of `TOKENS.AST_ANALYSIS_SERVICE`; the insights-based writer was deleted
4. `.mts/.cts/.mjs/.cjs` are aliased locally in the namespace builder, not added to `EXTENSION_LANGUAGE_MAP`
5. An explicit `language` outside the enum falls back to inference; `mode`/`reason` precede `content` in every result so
   a budget tail cut keeps them
6. The `reason` union grew beyond the plan: `unsupported-declarations`, `no-declarations`, `summary-not-smaller`
   (token-based) were added. Declaration-only gate refuses constant expressions, `new Set(...)`, `Object.freeze(...)`,
   `require(...)`, identifier initialisers and all CommonJS/browser-global files (deliberate false refusals included)

### Batch 7 team-leader verification (Mode 2, 2026-09-26)

- On disk: `resolveEnrichLanguage` in `analysis-namespace.builders.ts`; parse-tree writer
  `declaration-summary.ts` (715 lines) with declaration-only gate, runtime-export refusal, load-time refusal and
  pure-data literal elision; `context-enrichment.service.ts` with the reason union and token-based not-smaller gate;
  new `context-enrichment.service.spec.ts`. No TODO/FIXME/PLACEHOLDER/STUB markers; no stray files
- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence
--skip-nx-cache` → "Successfully ran targets test, lint, typecheck for 2 projects"
- `nx run degradation-audit:lint --skip-nx-cache` → `vscode-lm-tools: 2 ok (baseline 2)`,
  `workspace-intelligence: 1 ok (baseline 1)`, success
- `nx run-many -t typecheck -p ptah-cli ptah-electron --skip-nx-cache` (DI change) → success
- `ptah-core-prompt.ts` and `NATIVE_AGENT_TOOL_POLICY` (`cli-adapter.utils.ts`) unchanged against HEAD
- Commit c42b8cee6: pre-commit and commit-msg hooks passed

### Batch 7 follow-ups (not blocking)

- (a) Fix KI-7-1..KI-7-4; first KI-7-4 (keep property keys of elided pure-data objects), or refuse those forms
- (b) Package `tree-sitter-tsx.wasm` (`scripts/copy-wasm.js`, the three `verify-packed-wasm` scripts, the
  `TreeSitterParserService` grammar set, a `SupportedLanguage` entry) so `.tsx` can be summarised
- (c) Add `.mts/.cts/.mjs/.cjs` to `EXTENSION_LANGUAGE_MAP` once the indexer and dependency-graph treatment is decided,
  then delete the local alias
- (d) `types.ts` `ContextNamespace.enrichFile` JSDoc still says "Optional language hint"
- (e) The gate refuses many ordinary files (e.g. `tool-description.builder.ts`, `declaration-summary.ts` return
  full/unsupported-declarations); reduction on real code is lower than before. Measure in the Batch 20 harness

### Notes for Batch 8 (added at Batch 7 close)

- Batch 8 edits `tool-description.builder.ts` again (LSP descriptions); the `ptah_context_enrich_file` block changed in
  c42b8cee6 must not be touched, and the spec budget for descriptions still applies
- The shared prompt constants stay frozen (User Decision 4)

---

## Batch 2y-jest: Jest `marked` ESM mapping and role-resolver fixture isolation (unplanned) — COMPLETE (commit 609b57bb5)

- Origin: unplanned test-infrastructure fix, approved by the orchestrator on 2026-09-26; reviewed with Batch 8 as
  "Part B" of the Batch 8 review lane
- Executor: orchestrator (`batch-2y-jest-marked-report.md`)
- Execution mode: sequential
- Tasks: 1 | Depends on: Batch 2e (which pulled `marked` into the app Jest graphs)

### Task 2y.1: Map `marked` to its UMD build in the root Jest preset; hermetic role fixture — COMPLETE

- Files: `<WT>/jest.preset.js` (`moduleNameMapper` `^marked$` → `node_modules/marked/lib/marked.umd.js`; Jest 30
  merges the preset mapper with each project's own), `<WT>/libs/backend/cli-agent-runtime/src/lib/roles/agent-role-resolver.service.spec.ts`
  (fixture creates its own `.ptah/` marker so a stray `%TEMP%/.ptah` cannot win root resolution)
- Why: `marked` 18 is ESM-only; ptah-cli, ptah-extension-vscode, ptah-tui and ptah-electron specs failed with "Must use
  import to load ES Module" since Batch 2e, hidden because hooks did not run (`.husky/_` missing)
- The orchestrator's temporary electron Jest workaround was removed: `apps/ptah-electron/jest.config.ts` and
  `tsconfig.spec.json` have no diff against HEAD (verified)
- Review: Batch 8 r1 Part B (M3 role fixture, redundant electron workaround) → fixed; r3-postcap APPROVE for Part B

---

## Batch 8: ptah_lsp_definitions (Electron) — fallback that does not depend on the index; LSP descriptions — COMPLETE (commit 3feea4f6a)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: Electron-host resolver plus a correction to a false description (User Decision 4)
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 6

### Task 8.1: Import-resolution fallback in `declarationsFor` — COMPLETE (.tsx accepted as scoped)

- Files: `<WT>/apps/ptah-electron/src/services/electron-ide-capabilities.ts` (:188-294, :534-553), `<WT>/apps/ptah-electron/src/services/electron-ide-capabilities.spec.ts`
- Plan reference: research/code-intel.md:498-519
- Pattern to follow: `resolveImportedModule` (`electron-ide-capabilities.ts:263-294`); the index-independent scan in `getReferences` (:302-415)
- Quality requirements: when the index yields zero candidates, resolve the identifier through the cursor file's own imports (or a same-file declaration) and scan that file for the declaration line. The result is ≥ 1 location for an imported symbol with an EMPTY index
- Validation notes: the guard must not rely on a mock that always returns data. Use a real temp fixture tree (two files, one importing a class from the other) plus a symbol reader returning no hits → the definition is still found. Keep the existing multi-candidate disambiguation behaviour
- Implementation details: bounded work, one resolved file read per call

### Task 8.2: Host-accurate LSP tool descriptions — COMPLETE

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts` (`ptah_lsp_references` :392-396, `ptah_lsp_definitions` :423-428), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.spec.ts`
- Plan reference: research/code-intel.md:508-512; context.md User Decision 4
- Pattern to follow: existing description style in the same file
- Quality requirements: state the mechanism per host (VS Code language server in the extension; symbol index plus import resolution in the desktop app). Every other claim stays. The shared prompt constants are not touched
- Validation notes: the description length stays within the existing spec budget
- Implementation details: spec asserting neither description claims "VS Code LSP" unconditionally

### Batch 8 verification

- `node_modules/.bin/nx run-many -t test,lint,typecheck -p ptah-electron @ptah-extension/vscode-lm-tools 2>&1 | tail -40` passes
- The Codex review lane approves (met: r3-postcap APPROVE 8/10)

### Batch 8 review history

- Executor: backend-developer (`batch-8-executor-report.md`)
- Review r1 (`reviews/batch-8-code-logic-review-r1.md`, Codex): **REVISE 4/10**. Part A: B1 junction/symlink escape
  from the workspace on the import read; B2 the fallback narrowed `getReferences` scope; B3 declaration-shaped text in
  comments answered a lookup; M1 UNC roots collapsed by POSIX normalisation; M2 `.d.ts` targets not probed. Part B
  (2y-jest): M3 role-resolver fixture not hermetic; redundant electron Jest workaround. All fixed
- Review r2 (`reviews/batch-8-code-logic-review-r2.md`, Codex): **REVISE 6/10**. S1 `.tsx` files with JSX parsed as
  ERROR, losing empty-index definitions without disclosure; M1 Go `type_alias` not captured. Revise cap reached; one
  bounded correction (`.tsx` unresolved in the index-free path and disclosed in the description; Go `type_alias` query)
- Review r3-postcap (`reviews/batch-8-code-logic-review-r3-postcap.md`, Codex): **APPROVE 8/10** for Part A and Part B

### Batch 8 deviations (accepted)

1. `.tsx` accepted as scoped: the index-free fallback returns `[]` for a `.tsx` cursor or target (the packaged
   TypeScript grammar has no JSX); disclosed in the `ptah_lsp_definitions` description. The index path still resolves
   `.tsx`. `main` had no index-free fallback at all, so this is not a regression
2. `stripExtension` now strips only script-module extensions (`./foo.service` stays `foo.service`)
3. Declarations are found by per-language Tree-sitter queries, top-level only; any ERROR node → unresolved
4. The fallback also runs when there is no symbol reader (the old early `return []` was removed)
5. `realpath` is injected as the last constructor parameter (default `fs.promises.realpath`); the class is registered
   via `useValue` in `phase-3-storage.ts`, so DI is unaffected
6. Reference scoping uses only index-named declarations and `dependencyGraph.isBuilt(workspaceFolder)`

### Batch 8 team-leader verification (Mode 2, 2026-09-26)

- On disk: `declarationsFor` → `indexedDeclarations` / `declarationsWithoutIndex`, `DECLARATION_QUERIES` (ts, js,
  python, go), `findModuleFile` + `canonicalPathInside` (realpath containment before read), `resolveRelative` /
  `comparablePath` (UNC, `\\?\`, case folding); both LSP descriptions host-qualified. No TODO/FIXME/PLACEHOLDER/STUB
  markers; no stray files
- `nx run-many "-t=test,lint,typecheck" -p ptah-electron @ptah-extension/vscode-lm-tools @ptah-extension/cli-agent-runtime --skip-nx-cache`
  → success, 3 projects
- `nx run-many -t=test -p ptah-cli ptah-extension-vscode ptah-tui @ptah-extension/tool-output-reducers --skip-nx-cache`
  → success, 4 projects (2y-jest fix confirmed)
- `nx run degradation-audit:lint --skip-nx-cache` → TOTAL 300, `apps/ptah-electron: 4 ok (baseline 4)`, every
  directory within baseline
- `nx run ptah-electron:validate-deps --skip-nx-cache` → success
- Commits 609b57bb5 (2y-jest) and 3feea4f6a (Batch 8): pre-commit and commit-msg hooks passed on both

### Batch 8 follow-ups (not blocking)

- (a) CROSS-BATCH: package `tree-sitter-tsx.wasm` (`scripts/copy-wasm.js`, the `verify-packed-wasm` scripts, the
  `TreeSitterParserService` grammar set, `SupportedLanguage`). Unblocks the Batch 2d JSX refusal, Batch 7 `.tsx`
  summaries (follow-up 7b) and the Batch 8 `.tsx` fallback
- (b) The `ptah_lsp_references` description needs a qualifier: "limited to importing files once the dependency graph
  is built" applies only when the index names the declaration
- (c) `safeReadFile` logs a file path and the raw error message (pre-existing)
- (d) `apps/ptah-electron/src/di/phase-3-storage.ts:203` log text "via symbol index" is out of date
- (e) TOCTOU between the realpath containment check and the read is not addressed (local tool; accepted)

### Notes for Batch 9 (added at Batch 8 close)

- Batch 9 edits `tool-description.builder.ts` again (`buildGetSymbolIndexTool`); the `ptah_lsp_*` and
  `ptah_context_enrich_file` blocks changed in 3feea4f6a / c42b8cee6 must not be touched; the description spec budget
  still applies
- The root Jest preset now maps `marked`; do not add per-project `marked` mappers or `transformIgnorePatterns`
- Hooks are active (`.husky/_` present): pre-commit runs affected lint, `ptah-electron:validate-deps`; commitlint
  enforces the scope enum
- The shared prompt constants stay frozen (User Decision 4)

---

## Batch 9: ptah_get_symbol_index — pathPrefix/limit/offset; cold-latency measurement — COMPLETE (commit 138c55f99)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: natural page unit = symbol-index entries (User Decision 2). The service stays untouched; paging is done at the namespace
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 8 (hub-file ordering)

### Task 9.1: Paging and filtering at the namespace and tool — COMPLETE

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.ts` (`getSymbolIndex` :381-400), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.spec.ts`, `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts` (:1840-1848), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`, `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts` (`buildGetSymbolIndexTool` :1815-1826)
- Plan reference: research/code-intel.md:362-377; research-report.md:89
- Pattern to follow: the response shape `{files, count}` today
- Quality requirements: optional `pathPrefix` (workspace-relative or absolute), `limit` (default 200, max 1000) and `offset`. The response is `{ files, count, total, offset, nextOffset? }`, deterministically ordered by path. The description states the defaults. A default call on a 2,655-file fixture stays ≤ 8,000 chars — if 200 entries do not fit, lower the default until they do, and say so in the report
- Validation notes: pathPrefix-matches-nothing edge case. Backward compatible for execute_code callers passing only `workspaceRoot`
- Implementation details: specs with a synthetic 3,000-entry index: default page size, prefix filter, offset continuation, last page has no nextOffset

### Task 9.2: Cold first-call latency measurement (rows 5/6) — COMPLETE

- File: none modified. Evidence in the report
- Plan reference: research/code-intel.md:420-438
- Pattern to follow: n/a
- Quality requirements: time `ensureDependencyGraphBuilt` cold on this worktree (script or a focused spec run locally, not committed), and record ms and file count
- Validation notes: RISK "pre-warm on main thread" — no pre-warm code is written in this task
- Implementation details: report the number and whether it exceeds a 60s client timeout

### Batch 9 verification

- `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/vscode-lm-tools 2>&1 | tail -40` passes
- The Codex review lane approves (not met: committed under User Decision 15 after r3-postcap REVISE 7/10 and the reorder)

### Batch 9 review history

- Executor: backend-developer (`batch-9-executor-report.md`)
- Review r1 (`reviews/batch-9-code-logic-review-r1.md`, Codex): **REVISE 5/10**. F1 an oversized entry produced
  invalid JSON; F2 a cold `ensureDependencyGraphBuilt` (225 s) blocks the call past a 60 s client timeout; F3 the
  5,000-file graph cap was silent → **User Decision 14** (context.md): fix F1, disclose F3 now, F2 → new Batch 9b
- Review r2 (`reviews/batch-9-code-logic-review-r2.md`, Codex): **REVISE 6/10**. B1 cross-root coverage; S1
  dependents/dependencies lost the cap metadata under the budget cut; M1 token-heavy metadata produced invalid JSON.
  Revise cap reached; one bounded correction
- Review r3-postcap (`reviews/batch-9-code-logic-review-r3-postcap.md`, Codex): **REVISE 7/10**, one moderate edge
  (a very long query path pushed the cap fields out of the cut) → **User Decision 15** (context.md): reorder, then
  commit, no further review. `count`/`incomplete`/`graphedFiles`/`discoveredFiles` now precede `file` in both tools;
  pinned by the spec "keeps incomplete and both counts ahead of a very long query path" (fails on the old order)

### Batch 9 deviations (accepted)

1. Default `limit` 30, not 200: 200 entries measured 39,053 chars against the 8,000-char target
2. New file `namespace-builders/symbol-index-query.ts` (argument parsing); `types.ts` edited (`SymbolIndexPage`)
3. A page may end early at the result budget; `count` and `nextOffset` are recomputed so paging always advances
4. Shared `DependencyGraphService` changes: `buildGraph` optional 4th param (discovered count), `getCoverage`,
   `getCoverageForFile`
5. `ensureDependencyGraphBuilt` returns `void`; discovery lists every matching file before the 5,000-file cap

### Task 9.2 measurement

- Cold `ensureDependencyGraphBuilt` on this worktree: **225,040 ms** (5,354 files matched, 5,000 graphed, 2,652 in
  the index; under Jest on a shared machine). Exceeds a 60 s client timeout → Batch 9b

### Batch 9 team-leader verification (Mode 2, 2026-09-26)

- On disk: `renderSymbolIndexPage` (whole page / longest fitting run / spooled oversized entry / fixed-size skip
  error), `largestFitting`, `graphCompleteness`, `DEPENDENCY_GRAPH_FILE_CAP`, `parseSymbolIndexQuery` before the
  graph build; `getGraphCoverage`/`getGraphCoverageForFile` in the namespace. No TODO/FIXME/PLACEHOLDER/STUB
  markers; `ptah-core-prompt.ts` and `NATIVE_AGENT_TOOL_POLICY` unchanged vs HEAD
- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence --skip-nx-cache`
  → success, 2 projects
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache` → success, 2 projects
- `nx run degradation-audit:lint --skip-nx-cache` → TOTAL 300, `libs/backend/vscode-lm-tools: 2 ok (baseline 2)`,
  `libs/backend/workspace-intelligence: 1 ok (baseline 1)`
- **Commit blocked by the pre-commit hook**: `ptah-electron:validate-deps` reports `nextOffset` as a MISSING
  runtime dependency. Cause: `SYMBOL_INDEX_ENTRY_TOO_LONG` (`protocol-dispatcher.ts:2481-2482`) ends with
  `Continue from "nextOffset".`, which the bundle-import scanner reads as `from "nextOffset"`. Returned to the
  executor to rephrase the message (no `from "<word>"` shape) and re-run validate-deps; Batch 9 stays IN_PROGRESS
- **Hook fix (one string)**: the orchestrator changed the message to `Continue at "nextOffset".`; no other
  `from "<word>"` string literal remains in `protocol-dispatcher.ts` (line 2482). Re-verified:
  `nx run ptah-electron:validate-deps --skip-nx-cache` → success; `nx run-many "-t=test,lint,typecheck" -p
@ptah-extension/vscode-lm-tools --skip-nx-cache` → success
- Committed the same 14 code paths (13 modified + untracked `symbol-index-query.ts`) as **138c55f99** with hooks
  active: pre-commit (lint-staged, affected lint, `ptah-electron:validate-deps` "All external imports are covered")
  passed; commitlint passed (also checked with `npx commitlint --edit` beforehand). Not staged:
  `code-logic-review.md`, `research/diagnostics-worktree-repro.ts`

### Note for all later batches (added at Batch 9 close)

- The `ptah-electron:validate-deps` bundle scanner treats any `from "<word>"` / `from '<word>'` inside a **string
  literal** (messages, descriptions, prompts) as an import and fails the commit with a MISSING runtime dependency.
  Never write the word `from` directly before a quoted token in user-facing text; phrase it as `at "x"`,
  `starting with "x"`, etc. Run `nx run ptah-electron:validate-deps --skip-nx-cache` before returning a batch

### Batch 9 follow-ups (not blocking)

- (a) Listing every matching file before the cap may cost memory on 100k+ file repositories (not benchmarked)
- (b) `ptah-system-prompt.constant.ts` line-210 bullet still shows `getSymbolIndex()` without arguments (incomplete,
  not wrong)

---

## Batch 9b: Dependency graph — background build through the governor; non-blocking tools — COMPLETE (commit 00d1e43e3)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: User Decision 14. Motivating evidence: Task 9.2 measured a cold `ensureDependencyGraphBuilt` at
  225,040 ms, past a 60 s client timeout. One hub file (`protocol-dispatcher.ts`) plus the namespace and the shared
  graph service — coupled, so sequential
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 9

### Task 9b.1: Background graph build with a per-workspace in-flight latch — COMPLETE

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`
  (`ensureDependencyGraphBuilt` and its three call sites: `ptah_get_dependents`, `ptah_get_dependencies`,
  `ptah_get_symbol_index`), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.ts`
  (the `dependencies` namespace, when `execute_code` reaches the same build path), and, only if needed,
  `<WT>/libs/backend/workspace-intelligence/src/ast/dependency-graph.service.ts`
- Plan reference: context.md User Decision 14; Batch 9 r1 F2 (`reviews/batch-9-code-logic-review-r1.md`); Task 9.2 measurement
- Pattern to follow: Batch 6 `ensureIndexFresh` in-flight latch (`code-namespace.builder.ts:145`, :216-220, :424-436);
  `libs/backend/vscode-core/src/diagnostics/background-work-governor.ts`
- Quality requirements: the three tools never await a cold build past a bounded wait (≤ 2 s). The build starts in
  the background through the existing governor with a per-workspace in-flight latch (concurrent calls start one
  build). While building, return a small valid JSON status `{ status: 'building', retryAfterMs, filesDiscovered? }`
  with a retry hint; once built, answer normally (Batch 9 paging and cap disclosure unchanged). A failed build
  returns an honest error status and clears the latch so a later call can retry — never a silent empty result.
  Host-owned roots only (Batch 2f F1). No work moved into `tools/list`. Fixed-text logs (no paths or raw error text
  interpolated). Degradation audit stays at baseline
- Validation notes: RISK — an unhandled rejection from the detached build promise; attach a handler. RISK — graph
  eviction or an explicit rebuild while a build is in flight must not leave the latch set or answer from a stale
  graph. ASSUMPTION — the governor accepts a long-running job; verify its API before wiring
- Implementation details: status JSON stays within the tool result budget and ahead of any unbounded field

### Task 9b.2: Specs and descriptions — COMPLETE

- Depends on: Task 9b.1
- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`,
  `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/analysis-namespace.builders.spec.ts`,
  `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts` (+ spec) for the
  three tools' "may return building" note
- Quality requirements: specs with a never-resolving / slow fake build: a cold call returns `building` within the
  bounded wait; a later call after the build resolves returns the real answer; N concurrent cold calls start
  exactly one build; a failing build returns the error status and a later call restarts it; eviction/rebuild
  covered. Description budget spec still passes; the shared prompt constants stay frozen (User Decision 4)

### Batch 9b verification

- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence --skip-nx-cache` passes
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache` and `nx run ptah-electron:validate-deps` pass
- `nx run degradation-audit:lint --skip-nx-cache` at baseline
- The Codex review lane approves (superseded by User Decision 16: fix R3-S1, commit, no further review)

### Batch 9b review history

- r1 (Codex lane, `reviews/batch-9b-code-logic-review-r1.md`): REVISE 4/10, findings F1-F5 → revision round 1
- r2 (`reviews/batch-9b-code-logic-review-r2.md`): REVISE 6/10, R2-B1 (blocking), R2-M1, R2-M2 → one bounded
  correction (revision round 2)
- r3-postcap (`reviews/batch-9b-code-logic-review-r3-postcap.md`): REVISE 6/10, one serious finding R3-S1 (a
  successful slow empty build never delivered its result on sequential retries)
- User Decision 16 (context.md): fix R3-S1, commit, no further review → revision round 3 (`GraphBuildJob.delivered`,
  `GraphBuildLatch.empty` as a job map; regression spec "delivers a slow empty build to the next call, then
  rediscovers", failed before the fix and passes after). Details: `batch-9b-executor-report.md` rounds 1-3

### Batch 9b deviations (accepted)

1. Files outside the 9b.1/9b.2 lists: `types.ts` (`DependenciesNamespace.buildGraph` optional `options` carrying
   `yieldToForeground`), `dependency-graph.service.spec.ts` (service regression specs), `system-namespace.builders.ts`
   (namespace help line) and `workspace-intelligence/src/index.ts` (`GraphBuildState` type export)
2. The governor cannot take a long-running job; it is used as a per-chunk admission yield with a 1 s ceiling
3. Behaviour change: a caller-declared root that is not a host-opened folder answers `status: 'unavailable'` instead
   of building a graph under it (Batch 2f F1)
4. A workspace with no source files builds (and caches) an empty graph; empty-graph freshness is rediscovery on the
   next call (shared through the latch), not a timed expiry
5. The namespace (public to `execute_code`) gains `reserveGraphBuild` / `getGraphBuildState` so the reservation is
   synchronous and no eviction falls between job creation and its generation; documented in the namespace help

### Batch 9b team-leader verification (Mode 2, 2026-09-26)

- No TODO/FIXME/PLACEHOLDER/STUB markers in the changed source files; `ptah-core-prompt.ts` and
  `ptah-system-prompt.constant.ts` unchanged vs HEAD (`git diff --quiet`)
- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence --skip-nx-cache`
  → "Running targets test, lint, typecheck for 2 projects" → success, 2 projects
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache` → success, 2 projects
- `nx run ptah-electron:validate-deps --skip-nx-cache` → "All external imports are covered by package.json dependencies."
- `nx run degradation-audit:lint --skip-nx-cache` → TOTAL 300, `libs/backend/vscode-lm-tools: 2 ok (baseline 2)`,
  `libs/backend/workspace-intelligence: 1 ok (baseline 1)`
- Not staged: `code-logic-review.md`, `research/diagnostics-worktree-repro.ts`
- Committed 11 code paths + 6 task-spec docs as **00d1e43e3** with hooks active: pre-commit (lint-staged, affected
  lint, `ptah-electron:validate-deps`) passed; commitlint passed (also checked with `npx commitlint` beforehand)

### Batch 9b follow-ups (not blocking; carried in TASK_2026_561_9e57 Track B4)

- (a) A single file whose synchronous parse exceeds the bound still blocks the host for that file (worker thread)
- (b) Empty-graph rediscovery has no cooldown (every call after a delivered empty graph rediscovers)
- (c) `workspace.getInfo` is awaited before the bounded-wait timer starts
- (d) `execute_code` `getDependencies` / `getDependents` / `getSymbolIndex` answer `[]` when no graph exists
- (e) `resolveDependencyQueryPath` misses a query path whose case spelling differs from the graph key

---

## Batch 10: ptah_workspace_analyze — monorepo-first detection; bounded tree — COMPLETE (commit d1d015fd4)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: detector and renderer fixes together make "call FIRST" true again
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 9 (hub-file ordering)

### Task 10.1: Monorepo-aware project type — COMPLETE

- Files: `<WT>/libs/backend/workspace-intelligence/src/workspace/workspace.service.ts` (:367-420), `<WT>/libs/backend/workspace-intelligence/src/project-analysis/project-detector.service.ts`, `<WT>/libs/backend/workspace-intelligence/src/project-analysis/project-detector.service.spec.ts`
- Plan reference: research/workspace-files.md:92-117; research-report.md:96 (`e4e2a7bd6` incomplete)
- Pattern to follow: `ptah_project_detect_monorepo`'s detector (reference answer, research-report.md:100)
- Quality requirements: call `detectMonorepo` before `detectProjectType`. When it is a monorepo, report the monorepo type (e.g. `nx-monorepo`) and the per-app frameworks read from the app/package manifests, instead of one framework guessed from the root dependencies. Single-app detection is unchanged
- Validation notes: the existing single-signal specs stay green unchanged. New combined fixture: Nx monorepo, root deps with both react and @angular/core, no root angular.json, apps with their own project.json → never `react`, reports the monorepo plus the app set
- Implementation details: temp-dir fixture built in the spec

### Task 10.2: Tree depth/entry cap and excludes — COMPLETE

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts` (`renderDirectoryTree` :38-60, caller :169), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.spec.ts`
- Plan reference: research/workspace-files.md:99-106, :115-117
- Pattern to follow: the deps "... and N more" cap (:124-138)
- Quality requirements: max depth (e.g. 3), max entries per directory (e.g. 25, then "... and N more"), and skip `tmp/`, `dist/`, `.claude-worktrees/`, `.ptah/`, `node_modules/`, `.git/`, `coverage/`. A 500-flat-file directory renders under 4,000 chars; the whole analysis on the fixture stays ≤ 8,000
- Validation notes: if the structure walk (not the renderer) also needs excludes, name its file in the report. The renderer cap alone must satisfy the budget
- Implementation details: specs for depth, per-directory cap and excludes

### Batch 10 verification

- [x] `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools 2>&1 | tail -40` passes
- [x] The Codex review lane approves (r4-postcap APPROVE 7/10, two Moderate residuals carried as known issues)

### Batch 10 review history

- r1 (`reviews/batch-10-code-logic-review-r1.md`): REVISE 4/10, B1-B2 (blocking), S1-S4 → revision round 1
- r2 (`reviews/batch-10-code-logic-review-r2.md`): REVISE 4/10, R2-B1..R2-B3 (blocking), R2-S1, R2-S2 → revision
  round 2
- r3 (`reviews/batch-10-code-logic-review-r3.md`): REVISE 6/10, R3-S1, R3-S2 (serious), R3-M1 → one bounded
  correction (post-cap)
- r4-postcap (`reviews/batch-10-code-logic-review-r4-postcap.md`): APPROVE 7/10, 0 blocking, 0 serious, two Moderate
  residuals (R4-M1, R4-M2). Details: `batch-10-executor-report.md` (initial, rounds 1-2, bounded correction), with
  fails-before evidence for every round-2 and correction spec

### Batch 10 deviations (accepted)

1. Files outside the 10.1 list: `composite/workspace-analyzer.service.ts` and
   `composite/workspace-analyzer.root-scope.spec.ts` (the MCP answer's Project Type / Frameworks come from the
   analyzer's `WorkspaceInfo`; change limited to the monorepo branch)
2. New file `project-analysis/monorepo-member-discovery.ts` (bounded glob expansion and Nx `project.json` scan), and
   `project-analysis/monorepo-detector.service.ts` edited (membership parsers extracted as shared pure functions,
   `detectDeclaredMembers` added; existing detector specs unchanged)
3. The monorepo root's internal `ProjectType` is `node` (no new enum member); the analyzer labels it
   `<tool>-monorepo` (e.g. `nx-monorepo`)
4. The tree is emitted as a plain list (raw string, one entry per line) instead of a `p` block; a bounded
   `### Projects` section was added
5. Discovery depth limit 12 (raised from 5, with disclosure), bounded by the 3,000-read budget
6. pnpm-workspace.yaml one-line flow form `packages: [...]` supported (quote- and brace-aware split)
7. `project-detector.service.spec.ts` and `mcp-response-formatter.spec.ts` carry Prettier-only hunks (both failed
   `prettier --check` at HEAD)
8. `WorkspaceService` file-statistics walk rewritten to one pass over the union of extensions (counts unchanged)

### Batch 10 team-leader verification (Mode 2, 2026-09-26)

- No TODO/FIXME/PLACEHOLDER/STUB markers in the changed or new source; `ptah-core-prompt.ts` and
  `ptah-system-prompt.constant.ts` unchanged vs HEAD (`git diff --quiet`)
- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache`
  → "Successfully ran targets test, lint, typecheck for 2 projects"
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache` → success, 2 projects
- `nx run ptah-electron:validate-deps --skip-nx-cache` → "All external imports are covered by package.json dependencies."
- `nx run degradation-audit:lint --skip-nx-cache` → TOTAL 300, `libs/backend/vscode-lm-tools: 2 ok (baseline 2)`,
  `libs/backend/workspace-intelligence: 1 ok (baseline 1)`
- Not staged: `code-logic-review.md`, `research/diagnostics-worktree-repro.ts`
- Committed 9 code paths + 7 task-spec docs as **d1d015fd4** with hooks active: pre-commit and commitlint passed
  (also checked with `npx commitlint` beforehand)

### Batch 10 known issues (r4-postcap Moderate residuals; carried in TASK_2026_561_9e57 Track B8)

- R4-M1: unsupported YAML scalar forms in pnpm-workspace.yaml (folded `- >-`, escaped double-quoted, doubled single
  quotes) become wrong literal patterns while membership reports `complete: true` —
  `monorepo-detector.service.ts:78, :95, :140, :145, :688`. Fix: decode them or reject with an issue / incomplete
- R4-M2: a tooling executor (e.g. `@angular-eslint/builder:lint`) under a reserved application target name (`build`,
  `serve`) decides the framework, because only the second pass applies `AUXILIARY_EXECUTOR` —
  `project-detector.service.ts:174-177, :179-182, :459`; `workspace.service.ts:552`. Fix: reject tooling executors
  before rule matching in both passes

### Batch 10 follow-ups (not blocking; carried in TASK_2026_561_9e57 Track B8)

- (a) The structure walk in `workspace.service.ts` (`shouldSkipDirectory`) still reads `tmp/` to depth 3 and counts
  it in Total Files; only the renderer drops it
- (b) A durable formatter-through-budget regression spec (r4 probed it: 8,247 → 7,893 chars)
- (c) No wall-clock deadline on discovery or member inspection reads (count and depth bounds only)
- (d) `FrameworkDetectorService` has no `@nestjs/core` rule, so NestJS members built with generic executors show `node`
- (e) `ProjectDiscovery` is not exported from `workspace-intelligence/src/index.ts`
- (f) Declared workspace globs can match `dist`-named directories (declarations override the search skip list)

---

## Parallel lanes (User Decision 17) — status 2026-09-26

| Lane | Worktree                                | Batches                           | State                 |
| ---- | --------------------------------------- | --------------------------------- | --------------------- |
| A    | `task-559-mcp-tool-contract` (this one) | 11 → 11b → 16 → 17 → 18 → 15 → 13 | 11 COMPLETE; 11b next |
| B    | `.claude-worktrees/task-559-lane-b`     | 12                                | in review             |
| C    | `.claude-worktrees/task-559-lane-c`     | 19                                | in review             |
| D    | `.claude-worktrees/task-559-lane-d`     | 20.1, 20.3                        | in progress           |

Only the team-leader merges lanes B/C/D into this branch; lane executors never run git across worktrees. Batch
states for lanes B/C/D stay as recorded below until their merge.

---

## Batch 11: ptah_search_files truncation notice + ptah_relevance_rank_files reason dedupe — COMPLETE

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: two small P2 fixes on disjoint service files plus the formatter hub
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 10

### Task 11.1: `limit+1` probe, `atLimit` notice, pattern validation — COMPLETE

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts` (:682-690), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts` (`formatSearchFiles` :192), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter-extra.spec.ts`, `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`
- Plan reference: research/workspace-files.md:157-166
- Pattern to follow: `missingStringArgResponse` (`protocol-dispatcher.ts:1956`) for the empty pattern
- Quality requirements: request `limit+1`, slice to `limit`, and when more exist append `(showing first N; narrow the pattern or raise limit)`. An empty or non-string pattern is a tool error, not a thrown provider error
- Validation notes: none
- Implementation details: specs for at-limit, under-limit and empty pattern

### Task 11.2: Dedupe matched terms in relevance reasons — COMPLETE

- Files: `<WT>/libs/backend/workspace-intelligence/src/context-analysis/file-relevance-scorer.service.ts`, `<WT>/libs/backend/workspace-intelligence/src/context-analysis/file-relevance-scorer.service.spec.ts`
- Plan reference: research-report.md:94 (row 9)
- Pattern to follow: existing reason formatting in the file
- Quality requirements: a query with repeated words yields each matched term once in the reasons; scores are unchanged
- Validation notes: confirm the reason builder lives in this file; if not, name the real file in the report
- Implementation details: spec with query "auth auth token"

### Batch 11 verification

- [x] `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence 2>&1 | tail -40` passes
- [x] The review lane approves (r1 APPROVE 7/10; two Moderate + one Minor scheduled as Batch 11b)

### Batch 11 review history

- r1 (`reviews/batch-11-code-logic-review-r1.md`): APPROVE 7/10, 0 blocking, 0 serious, 2 Moderate (M1, M2),
  1 Minor → Batch 11b. Details: `batch-11-executor-report.md` (fails-before evidence for every new spec)

### Batch 11 deviations (accepted)

1. The truncation notice is part of the `Found:` header line ("Found: more than N file(s) (showing first N; narrow
   the pattern or raise limit)"), not appended after the list, so a result-budget tail cut cannot drop it
2. `limit` is validated: undefined/null → 50 (`SEARCH_FILES_DEFAULT_LIMIT`); anything not a safe integer ≥ 1 is a
   tool error (`parseSymbolIndexQuery` precedent). This tightens direct-MCP input (0, negatives, fractions were
   previously coerced by the adapters); the published schema is aligned in Batch 11b (M1)
3. The formatter flag is `moreAvailable` (plan: `atLimit`); same value, `files.length > limit` before the slice
4. 11.2 dedupes the final reason strings (`[...new Set(reasons)]`), which also removes duplicate export reasons from
   two query words; scores unchanged ("auth auth token" 40 vs "auth token" 30 pinned — keyword dedupe would change
   ranking and is left to the planner). ~20 lines of Prettier-only hunks in `file-relevance-scorer.service.ts`

### Batch 11 team-leader verification (Mode 2, 2026-09-26)

- Production diffs read on disk (`protocol-dispatcher.ts:896-925`, `:2346`; `mcp-response-formatter.ts:417-447`;
  `file-relevance-scorer.service.ts` Set dedupe). No TODO/FIXME/PLACEHOLDER/STUB in the 6 changed files;
  `ptah-core-prompt.ts` and `ptah-system-prompt.constant.ts` unchanged vs HEAD (`git diff --quiet`)
- `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/vscode-lm-tools @ptah-extension/workspace-intelligence --skip-nx-cache`
  → "Successfully ran targets test, lint, typecheck for 2 projects" on the first run (Nx labelled
  workspace-intelligence:test flaky from run history — the `project-detector.service.spec.ts:748` timeout, M2 below;
  it did not fail this run)
- `nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache` → success, 2 projects
- `nx run ptah-electron:validate-deps --skip-nx-cache` → "All external imports are covered by package.json dependencies."
- `nx run degradation-audit:lint --skip-nx-cache` → TOTAL 300, `libs/backend/vscode-lm-tools: 2 ok (baseline 2)`,
  `libs/backend/workspace-intelligence: 1 ok (baseline 1)`
- Not staged: `code-logic-review.md`, `research/diagnostics-worktree-repro.ts`

### Batch 11b (scheduled, Lane A next) — r1 findings

- M1 (Moderate): `ptah_search_files` schema publishes `limit` as an unrestricted `number`
  (`mcp-core/tool-description.builder.ts:351-354`) while the handler requires a positive safe integer
  (`mcp-core/protocol-dispatcher.ts:906-915`; pinned at `protocol-dispatcher.spec.ts:991`). Fix: `type: 'integer'`,
  `minimum: 1` (plus the supported ceiling), describe the rule, add a schema/handler agreement regression, and note
  the direct-MCP tightening in the change notes
- M2 (Moderate): Batch 10 real-disk inspection-cap spec `project-detector.service.spec.ts:748-765` (206+4 projects,
  serial reads at `project-detector.service.ts:390-394`, real I/O at spec `:1013-1015`) exceeds Jest's 5,000 ms default
  under load (reproduced with +30 ms/read; outer `:504:1`). Fix: exercise the 200-project cap through a deterministic
  in-memory provider and keep a small real-disk smoke test with an explicit integration timeout
- Minor: no regression pins the truncation notice through the budget/reducer (`mcp-response-formatter-extra.spec.ts:41`
  checks ordering only; dispatcher cases `protocol-dispatcher.spec.ts:899-959` fit the budget). Fix: dispatcher-level
  oversized search with a temp spool root asserting the notice in final content and byte-equal raw spool, for both
  Markdown reduction and plain cut

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

## Follow-up task (added 2026-09-26, user request)

- Every known issue and "follow-ups (not blocking)" item above that no later 559 batch owns is collected in
  `.ptah/specs/TASK_2026_561_9e57/context.md` (Track B), together with the open compaction work (Track A: tokaudit
  Wave 3 + TASK_2026_406 Phases 0-3). TASK_2026_561 starts after this task merges. When a batch here records a new
  residual, add it to that file too

## Completion notes for Mode 3

- Parity: no surface is replaced, consolidated, rebuilt or redesigned. Tools are fixed in place and `ptah_code_reindex` is added. Mode 3 re-checks this against `tools/list` at the base commit: every tool present at 9afac1aa2 must still be present.
- Visual: no UI change. N/A.
- Write paths: the spool files (Batch 2e) are the only new persisted write. The trace is recorded at Batch 2e verification. No settings or config writes. User-owned files (`~/.codex/config.toml`, `.claude/settings.local.json`) are never touched.
