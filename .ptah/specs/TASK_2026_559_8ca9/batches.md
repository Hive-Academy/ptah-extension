# Batches - TASK_2026_559_8ca9

Total tasks: 111 | Batches: 60 | Complete: 32/60 (Batch 11b, a follow-up round of Batch 11, is COMPLETE and not counted separately; Batch 20 is COMPLETE with known issues R5-01..R5-03 carried to Batch 24d (User Decision 22). Language batches 22-38 added 2026-09-26 under User Decisions 18-19: 31 batches, 55 tasks, 5 complete — 28a, 28b, 22, 23a, 24a)

Counter as of 2026-09-27 handoff (verified with git at task-branch HEAD ec6ad9bc8): COMPLETE on the task branch 32/60
(unchanged). COMMITTED on Lane H only, not merged, not counted: 4 — 24r, 24b, 23b, 22c (54e9c4b08, efea46119,
41ed73395, eec17be89; 23a's 4af7d3eba is already merged). UNCOMMITTED: Batch 21 (Lane A, IN_PROGRESS), Batch 21p
(Lane A, implemented + reviewed), Batch 25a (Lane H, implemented, unreviewed). Unplanned batches 20.2p/20.2q/21p/21q/24r/22c
are not in the 60. See "RESUME POINT" below.

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

## RESUME POINT 2 (2026-09-27 evening, session handoff) — START HERE

Supersedes the earlier RESUME POINT below (kept for history).

**Branch state (verified at handoff).** Task branch `fix/task-559-mcp-tool-contract` HEAD e6c155260, worktree
`D:/projects/ptah-extension/.claude-worktrees/task-559-mcp-tool-contract`. COMPLETE and on the task branch: Batches 1-31 except
30k and 32a+ (i.e. 21/21p/21q/21r, 22-28b, 29a1, 29a2, 29b, 30, 31), 37a and 37b1a-37b3 (Lane K merged da21c936c), the O2/O3
gate docs (O2 updated to the shipped design, 69862ba6f). Lanes H, J, K are fully merged (their worktrees can be removed).
Lane G2 (`fix/task-559-lane-g2`, worktree `.claude-worktrees/task-559-lane-g2`, node_modules junction present): 32a committed
a5632f1bb on the lane, NOT merged. Nothing uncommitted except the never-staged `code-logic-review.md` and
`research/diagnostics-worktree-repro.ts`.

**Process (User Decisions 24-26 in context.md).** One review round per batch; the author fixes once; the NEXT review in the same
lane verifies those fixes; a Blocking still open after that verification goes to the user (AskUserQuestion). Moderate/Minor may
be carried. Run independent batches in parallel lanes (≤ 3 CLI lanes). The last batch of a lane gets a closing review.
Reviewer assignment (user-approved): Codex for every correctness- or security-critical batch and every closing review;
Antigravity only for low-risk batches (pure moves, text, fixtures) — it approved all Lane K batches 9-10/10 while the Codex
closing review found 4 real Blockings, so never rely on it alone. Reviewer sessions to resume: Codex Lane A
`01a0e07a-ef19-7cb0-a0bf-a911f6d10a51` (knows Batches 21-31); Codex Lane G2 `01a0e469-fdae-7413-84b2-c994388f25d3` (32a);
Codex Lane K closing `01a0e3f3-d098-7582-83a5-572204bababd`; Antigravity `429a13d0-3970-4005-9769-e2c7d32c8b47`. Codex
reviewers write `code-logic-review.md` as well as the deliverable (role contract) — that file is never staged.

**Next steps, in order.**

1. Lane A (task worktree): **Batch 30k** (Kotlin grammar; O3 gate satisfied by User Decision 25 — attestation + npm hash + ABI-14
   load test are enough). Its Codex review (resume the Lane A session) must VERIFY the Batch 31 fix round (e6c155260; notes
   "## Fix round (review r1)" in batch-31-executor-report.md), including the two Batch 30 findings closed there (R30-02
   same-line declarations keyed by name position; R30-03 Rust `{{`/escape decoding) and the platform-core compactCoverage change
   (clean answers keep approximations; worst case ≤ 1,000 chars).
2. Lane G2 in parallel: **Batch 32b** (resolver seam) on top of a5632f1bb. It carries: the re-export graph edge (Blocking from the
   26b closing review — `export { X } from` adds no edge, so ptah_get_dependents misses barrel consumers; the 32a contract already
   records re-exports as exports with isReExport + source) and the empty `export {} from` dependency gap (32a review). Its Codex
   review (resume the G2 session) verifies the 32a fix round (Rust nested comments, byte-exact identifiers, isStatic for C#/Java).
   Merge Lane G2 into the task branch after 32b (or earlier if 30k needs it), then 32c / 33 (carries Python per-member aliases from
   the 32a review) → 34 → 35 → 36a → 36b → 36c (36a also needs 31).
3. **Batch 38 completion gate** — add these carried items: (a) the protocol-dispatcher "slow empty build" test is flaky under
   parallel load (fix it); (b) Lane K Moderate: real `_test` package unmapped attribution (lane-k-closing-review.md); (c) Minor:
   37b1d wiring specs leave mkdtemp dirs (close the logger stream, then remove); (d) run the tests of EVERY project that depends on
   the changed libs, not only owned ones (a 24c export once broke rpc-handlers/VS Code test mocks unseen) — the full set is
   platform-core, platform-cli, platform-electron, workspace-intelligence, vscode-lm-tools, agent-sdk, rpc-handlers, shared,
   vscode-core, chat, cli-engine, memory-contracts, memory-curator, tool-output-reducers, ptah-cli, ptah-electron,
   ptah-extension-vscode; (e) the real-Go hostile integration spec (`go-vet-hostile.integration.spec.ts`) has never run — Go is
   not installed on this machine; run it on CI or ask the user; (f) Mode 3 notes must replace "Visual: no UI change" — Batch 37b2
   added the Electron go vet card; approved screenshots are untracked in
   `.claude-worktrees/task-559-lane-k/.ptah/specs/TASK_2026_559_8ca9/screenshots/37b2/` (r1, r2, r3) with
   `visual-review-37b2.md` (committed); show them to the user before the PR.
4. Then Mode 3 completion, rebase onto main, PR (never commit to main; no --no-verify).

**Standing rules and lessons.** Commit only in quiet windows (the stash stack is shared; the lint-staged hook hides unstaged
changes, so never commit a worktree while an agent edits it). Before every commit, check the FULL `git status` — batches also
change `scripts/` (grammar manifest, copy-wasm) and `.ptah/`; one 29b commit missed them. Tell executors never to run a
formatter over files they did not change (one Lane K fix reformatted 16 unrelated files; a backup of that noise is in
`%TEMP%/lane-k-format-noise.patch`). Degradation audit TOTAL 300 (never raise the baseline; an early `return` inside a `catch`
is flagged). validate-deps `from "x"` / `import "x"` / `require("x")` fixture rule. Description budgets: the tool descriptions use
a compact language list; ptah_code_search_symbols 668/702, reindex 519/536 — never raise a pin without a recorded reason.
Known flakes: rpc-handlers harness-skill-selection (because `%TEMP%/.ptah/harness/state.json` exists; the user has not deleted
it), Electron stress bundle (missing dist workspace-watch-host.mjs), protocol-dispatcher "slow empty build". Nx Cloud for this
workspace is disabled (FREE plan exceeded) — local runs are unaffected. The `husky - command not found` hook error seen once was
transient; a plain retry passed.

## RESUME POINT (2026-09-27, session handoff)

**Progress 2026-09-27 (afternoon), supersedes steps 1-3 below:**

- Step 1 DONE: 5678513f4 (21p/21q/21r product) + 6fac0a695 (21 harness + User Decision 24). R4-01..03 fixed once;
  the Batch 24d review verifies them plus two carried limits (see the Batch 21 section).
- Step 2 DONE: 25a+25b 4c9a8aefa (25a: 4 reviews, post-cap APPROVE 7; census graph-reuse deviation accepted by the
  team leader; R4-M1 carried and fixed in 25b; 25b r3 APPROVE 8), 26a ea46dc9ad (one review, fix round; verified by the
  26b review).
- Step 3 DONE: merge 7d908f79f (Lane H 24r, 24b, 23b, 22c, 25a+25b, 26a), fallout folded in — report
  `merge-lane-h-report.md`. Team-leader rulings: R1 compactCoverage names ≤ 3 failure reasons + `other` (compact worst
  case 994 ≤ 1,000, Decision 21; the full typed shape is pinned at 1,028); R2 24b's two descriptions re-pinned
  (ptah_code_search_symbols 1,021, ptah_code_reindex 997), 24c owns their final size.
- Lane H: 26b implemented; review r1 REVISE 4 (6 Blocking, 3 Moderate) → one fix round in progress; verified by the next
  Lane H review.
- Next: 24d (Lane A) ‖ 24c (new Lane J from the task tip; also carries 26a R26A-m1: execute_code help lists the LSP
  report methods) ‖ 26b fix; then 27 after 24c + 26b merge.

Verified on disk at handoff: task branch `fix/task-559-mcp-tool-contract` HEAD ec6ad9bc8 (Batches 1-19, 11b,
20.1/20.2/20.2p/20.2q/20.3, 22, 23a, 24a, 28a, 28b COMPLETE). Lanes B, C, D, I, P fully merged (no commits ahead).
`git log --oneline fix/task-559-mcp-tool-contract..fix/task-559-lane-h` = 4 commits, committed on Lane H ONLY, not
merged: 54e9c4b08 (24r), efea46119 (24b), 41ed73395 (23b), eec17be89 (22c). (23a's 4af7d3eba is already an
ancestor of the task branch — merged 130b9453d.)

Uncommitted work (do not lose; the pre-commit hook stashes and restores unstaged `libs/` changes):

- Lane A (this worktree): Batch 21 — new `mcp-contract.sweep.spec.ts`, `mcp-mandate-manifest.spec.ts` (revision
  round 2 done: 57 tests, 6 intentionally failing — they expose a product defect: the stdio agent handlers apply no
  result budget except `agent_read`); Batch 21p — `browser_content` HTML extractor path in `tool-result-budget.ts`,
  `protocol-dispatcher.ts` (+ `protocol-dispatcher.spec.ts`); reviewed in r2, no defect. Reviews:
  `reviews/batch-21-code-logic-review-r1.md` (REVISE 3), `reviews/batch-21-code-logic-review-r2.md` (REVISE 4).
  Reports: `batch-21-executor-report.md`, `batch-21p-executor-report.md`. Untracked and never staged:
  `research/diagnostics-worktree-repro.ts`, `code-logic-review.md`.
- Lane H (`task-559-lane-h`): Batch 25a — diagnostics contract + `LanguageAwareDiagnosticsProvider` + carried
  R5-B1/R5-M1 fixes (platform-core, platform-cli, platform-electron, workspace-intelligence); report
  `batch-25a-executor-report.md` in the lane's task folder. Not reviewed. The author says 25a merges together with 25b.

Reviewer CLI sessions (Codex) to resume; if resume fails in a new session, spawn fresh with the context restated:
Batch 21 reviewer 01a0e07a-ef19-7cb0-a0bf-a911f6d10a51; Lane H graph/diagnostics reviewer
01a0df19-7fdf-70d0-88b4-d4acfc2fa47d; Lane H contract/index reviewer 01a0df86-4fd3-7ab1-9e37-e51cd1d7fcc8.

1. Next steps Lane A
   a. New product batch **21q — stdio agent tool handlers apply the result budget**. The 6 failing Batch 21 sweep
   tests are its fails-before. Executor: backend-developer. Do not weaken the tests.
   b. Batch 21 + 21p + 21q review r3 (Codex, cross-side). Batch 21 has used 2 revise rounds, so a REVISE leads to
   one bounded correction + a post-cap review, then ask the user.
   c. Team-leader commits 21p, 21q, 21 (separate commits, in that order).
2. Next steps Lane H
   a. Batch 25a Codex review r1 — it carries R5-B1/R5-M1 from User Decision 23; verify both with the r5 probes.
   b. Batch 25b.
   c. Commit 25a + 25b.
3. Merge Lane H into the task branch AFTER Lane A's Batch 21 commit: combine the two platform-core coverage changes
   (24r `clean` + `reasons`, 22c compact serializer, and 20.2q's `unsupported-syntax` reason); re-measure the 22c
   size pins and the Batch 20.2 SIZE benchmarks; convert every test named "pending Batch 24r: …" into a real test —
   today `workspace-intelligence/src/testing/mcp-contract/mcp-contract.bench.spec.ts:416` (`it.todo`) and
   `vscode-lm-tools/.../mcp-core/mcp-contract.sweep.spec.ts:1582`; full scoped verification of every touched project.
4. Then the remaining language batches in dependency order (check each entry's "Depends on"): 24d (carries
   R5-01..03 from Decision 22), 24c (incl. the 24a M2 ast sub-operation honesty), 26a, 26b, 27 (polyglot harness,
   needs 21 merged), 28 done, 29a1 → 29a2 → 29b, 30, 31, 30k (O3 provenance gate), 32a-c, 33-35, 36a-c (required
   by Decision 19 Q4), 37a (O2 consent gate) / 37b (split three ways per the o2 doc), 38 completion gate. Then
   Mode 3 completion, rebase onto main, PR.
5. Standing rules: User Decisions 1-23 in context.md; review bar = cross-side review, 2 revise rounds, bounded
   correction + post-cap review, then ask the user; ≤ 3 CLI lanes at once; commit only in quiet windows (the stash
   stack is shared across worktrees); no `--no-verify`; degradation audit TOTAL 300; validate-deps `from "<word>"`
   rule; specs spool into `mkdtemp` roots; known flakes: Electron stress bundle, entry/worker-host watcher timeouts,
   vscode-lm-tools real-port HTTP spec, rpc-handlers harness-skill-selection (because of `%TEMP%/.ptah`),
   platform-core perf smoke under load; the user has not deleted `%TEMP%\.ptah`.

## Parallel lanes (User Decision 17) — status 2026-09-27 (handoff)

| Lane | Worktree                                | Batches                                                                                    | State                                                                                         |
| ---- | --------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| A    | `task-559-mcp-tool-contract` (this one) | 11 → 11b → 16 → 17 → 18 → 15 → 13 → 20.2 → 21 (+21p, 21q)                                  | through 20.2 COMPLETE; 21 IN_PROGRESS, 21p uncommitted; 21q next                              |
| B    | `.claude-worktrees/task-559-lane-b`     | 12 → 14                                                                                    | done (12, 14 merged)                                                                          |
| C    | `.claude-worktrees/task-559-lane-c`     | 19                                                                                         | done (19 merged)                                                                              |
| D    | `.claude-worktrees/task-559-lane-d`     | 20.1, 20.3 (20a)                                                                           | done (20a merged 1c2ad2f92)                                                                   |
| H    | `.claude-worktrees/task-559-lane-h`     | 22 → 23a → 24a ‖13‖ 24b → 23b → 25a → 25b → 26a ‖21‖ 24c ‖29a2‖ 29b ‖32b‖ 32c ‖37a+27‖ 37b | 22, 23a merged; 24r, 24b, 23b, 22c committed on lane, not merged; 25a uncommitted, unreviewed |
| I    | `.claude-worktrees/task-559-lane-i`     | 24a                                                                                        | done (24a merged de6f56118)                                                                   |
| P    | `.claude-worktrees/task-559-lane-p`     | 28a → 28b                                                                                  | done (28a, 28b merged)                                                                        |
| E    | `.claude-worktrees/task-559-lane-e`     | 26b                                                                                        | waits for 26a merge                                                                           |
| K    | `.claude-worktrees/task-559-lane-k`     | 37a                                                                                        | waits for O2 amendment + 25a merge                                                            |
| T    | `.claude-worktrees/task-559-lane-t`     | 27, 38                                                                                     | 27 waits for 26b, 24c, Lane A 21                                                              |
| G    | `.claude-worktrees/task-559-lane-g`     | 29a1 → 29a2, then 30 → 31 → 30k                                                            | 29a1 waits for 27 + 28a; 30k also on O3                                                       |
| G2   | `.claude-worktrees/task-559-lane-g2`    | 32a → 32b → 33 → 34 → 35 → 36a → 36b → 36c                                                 | 32a waits for 29b + 30                                                                        |

Language support (Decisions 18-19): approved plan `implementation-plan-languages.md`; Batches 22-38 are in the
section "Language support (User Decisions 18-19) — Batches 22-38" below, with lane authors/reviewers, gates and the
decomposition notes D1-D10. Lane A's 13 is COMPLETE (7d92f9f77) and 20.2 is COMPLETE with known issues carried to 24d (01f3daa8b, f926423a2,
ac441f780; User Decision 22); Lane A is on 21 (see RESUME POINT above). Lane H: 24r, 24b, 23b, 22c committed on
the lane, 25a uncommitted (see RESUME POINT above; the remainder of this paragraph is the 2026-09-26 record).
**22, 23a (H)** are merged (96f9a5553, 130b9453d; 23a under User Decision 20); Lane H's branch is fast-forwarded to
this branch's tip and runs next **24b → 23b → 25a → 25b → 26a**. **24a (I)** is merged (de6f56118; its
`AstCodeInsights` hunk in `types.ts` merged cleanly with 13). **P** is done (28a merged e3578b2ca, 28b merged 44336de6a).
Batch 37b will split three ways per `o2-go-vet-consent-surface.md`; it is decomposed when reached. The Lane A 13 gate
on hub batches 24b, 23b, 25b, 26a is met; 24c and 27 wait for Lane A 21 (D1, D2). At most 3 CLI lanes at once,
reviews included.

Only the team-leader merges lanes into this branch; lane executors never run git across worktrees. Batch
states for lanes stay as recorded below until their merge.

---

## Batch 11: ptah_search_files truncation notice + ptah_relevance_rank_files reason dedupe — COMPLETE (commit fc54a7307)

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
- Committed 6 code paths + 3 task-spec docs as **fc54a7307** with hooks active: pre-commit and commitlint passed
  (also checked with `npx commitlint` beforehand)

### Batch 11b — COMPLETE (commit 9d2637d37)

- Review history: r1 (`reviews/batch-11b-code-logic-review-r1.md`) APPROVE 8/10, no findings. Details:
  `batch-11b-executor-report.md`
- M1: `ptah_search_files` `limit` schema and handler validator agree (integer, bounded), with an agreement regression
- M2: project-detector inspection-cap spec moved to an in-memory fs — runtime 5,146 → 41 ms
- Minor: dispatcher-level specs pin the truncation notice through the result budget (reduction and plain cut)
- Team-leader verification (2026-09-26): `nx run-many "-t=test,lint,typecheck"` vscode-lm-tools + workspace-intelligence
  `--skip-nx-cache` → 6 tasks pass; `ptah-cli`/`ptah-electron` typecheck pass; `ptah-electron:validate-deps` pass;
  `degradation-audit:lint` TOTAL 300. Hooks active, commitlint checked first

#### Batch 11b r1 findings (source of the batch)

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

## Batch 12: ptah_agent_read — bounded default window in the service — COMPLETE (commit 7bbf72ba4, merged 176aab381)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential (file-disjoint; MAY run alongside a hub-file batch)
- Rationale: one source of truth for both agent surfaces (research/agent-task-harness.md:134-141). The type lives in `libs/shared`
- Review: Codex CLI lane (logic + structure)
- Tasks: 1 | Depends on: none

### Task 12.1: Default tail 200, `offset`, `totalLines`/`omittedLines` — COMPLETE

- Files: `<WT>/libs/shared/src/lib/types/agent-process.types.ts` (`AgentOutput` :215), `<WT>/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.ts` (`readOutput` :896-922), `<WT>/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-process-manager.service.spec.ts`
- Plan reference: research/agent-task-harness.md:103-147; context.md User Decision 2
- Pattern to follow: `tailLines` in the same service
- Quality requirements: `readOutput(agentId, tail?, offset?)`. With no tail and no offset → the last `DEFAULT_AGENT_READ_TAIL_LINES = 200` lines per stream. `offset` (0-based line) + `tail` returns a forward window. `AgentOutput` gains `totalLines` and `omittedLines`; `lineCount` keeps meaning "lines returned"; the existing `truncated` (buffer-capacity flag) keeps its meaning
- Validation notes: RISK "default hides the end" — the default window is the TAIL. Re-check `agent-tool.dispatcher` (named in the doc comment) and report whether it is affected
- Implementation details: specs — a 1,000-line buffer with no args → 200 lines and omittedLines 800; offset 0 + tail 100 → the first 100; a short buffer → all lines, omitted 0

### Batch 12 verification

- [x] `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime @ptah-extension/shared 2>&1 | tail -40` passes
- [x] The review lane approves (r2 APPROVE 8/10)

### Batch 12 review history

- Executed in Lane B (`fix/task-559-lane-b`, base 685edbc24) by a Codex CLI lane; reviewed cross-side by a Claude
  code-logic-reviewer subagent. Details: `batch-12-executor-report.md` (initial + revision round 1)
- r1 (`reviews/batch-12-code-logic-review-r1.md`): REVISE 6/10. B1 (Blocking): `AgentOutput` fixtures in
  `mcp-response-formatter.spec.ts` lacked `totalLines`/`omittedLines`, breaking `vscode-lm-tools:test` compile →
  fixed in revision 1. M2 (Moderate): callers do not surface the new counters → deferred to Batch 13
- r2 (`reviews/batch-12-code-logic-review-r2.md`): APPROVE 8/10, 0 blocking, 0 serious

### Batch 12 deviations (accepted)

1. Tail/offset edge rules: finite values are floored and clamped to ≥ 0; NaN/±Infinity become 0. Offset without
   tail returns a forward window of at most 200 lines per stream; offset at/after a stream's end → empty stream
   (streams evaluated independently). Counts are summed across stdout + stderr after adapter parsing
2. A zero or non-finite tail yields empty output (with or without offset) instead of the old `tail && tail > 0`
   bypass that returned the whole buffer
3. Trailing-newline fix: a final partial line counts as one line and a trailing newline no longer costs a line, so
   an explicit tail N on newline-terminated output returns exactly N lines (was N−1). Fixed locally in `readOutput`;
   the shared `tailLines` helper is unchanged
4. Two legacy buffer-capacity specs now request an explicit 2048-line tail so the new default does not mask them;
   `mcp-response-formatter.spec.ts` fixtures gained the two new fields (r1 B1)

### Batch 12 team-leader verification (Mode 2, 2026-09-26)

- Production diff read on disk (`agent-process-manager.service.ts` `readOutput`, `agent-process.types.ts`
  `AgentOutput`); Prettier `--check` clean on all 4 changed code files
- Lane B: `nx run-many "-t=test,lint,typecheck" -p @ptah-extension/cli-agent-runtime @ptah-extension/shared
@ptah-extension/vscode-lm-tools --skip-nx-cache` → 9 tasks pass; `ptah-cli`/`ptah-electron` typecheck pass;
  `ptah-electron:validate-deps` pass; `degradation-audit:lint` → TOTAL 300
- Committed on the lane as **7bbf72ba4** (4 code files + executor report + r1/r2 reviews; `code-logic-review.md`
  not staged; hooks active, commitlint checked first)
- Merged into `fix/task-559-mcp-tool-contract` as **176aab381** (`--no-ff`, no conflicts). Post-merge:
  `nx run-many "-t=test,lint,typecheck"` for cli-agent-runtime, shared, vscode-lm-tools, workspace-intelligence →
  4 projects pass; `ptah-cli`/`ptah-electron` typecheck pass; validate-deps pass; degradation-audit TOTAL 300

### Deferred to Batch 13

- Callers show `totalLines`/`omittedLines` (r1 M2): `agent-tool.dispatcher.ts` structured response and the MCP
  response formatter; offset plumbing through `agent-namespace.builder.ts` / `protocol-dispatcher.ts` and the
  `ptah_agent_read` schema

---

## Batch 13: agent_read / agent_status at the MCP surface — COMPLETE with known issue KI-13-1 (commit 7d92f9f77)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: surface wiring for Batch 12 plus the "ONE-OFF" status contract enforced in code
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batches 11, 12

### Task 13.1: Pass `offset`, render the window, describe the default — COMPLETE

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/agent-namespace.builder.ts` (:324), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts` (:848-859), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts` (`formatAgentRead` :636-665), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts` (`ptah_agent_read` :653-676)
- Plan reference: research/agent-task-harness.md:134-141
- Pattern to follow: existing `tail` plumbing
- Quality requirements: the formatter prints `Showing lines A-B of N (M omitted; pass offset/tail to page)` when lines were omitted. The description states the 200-line default and the `offset` parameter
- Validation notes: none beyond Batch 12
- Implementation details: covered by the specs in Task 13.2's files

### Task 13.2: 60s repeat-status throttle, and specs for both tasks — COMPLETE

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts` (:838-846), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`
- Depends on: Task 13.1
- Plan reference: research/agent-task-harness.md:89-95
- Pattern to follow: module-level maps already in the dispatcher (none exists; keep it bounded — prune entries older than 60s on each call)
- Quality requirements: a second status call for the same agentId within 60s whose status is unchanged returns one line: `Status unchanged since <iso> (<status>). Wait for <agent-lane-completed> instead of polling.` A status change or exit returns the full body
- Validation notes: edge case — exited agent → full body. The injected clock makes this testable
- Implementation details: specs — throttled repeat; changed status returns full; agent_read default renders the omitted-lines line; the default call on a 5,000-line buffer is ≤ 8,000 chars (or reports the omission and is within budget)

### Batch 13 verification

- [x] `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/vscode-lm-tools 2>&1 | tail -40` passes
- [x] The review lane approves (r3 APPROVE 7/10)

### Batch 13 review history

- Executed in Lane A (this worktree) by a backend-developer subagent; reviewed by a code-logic-reviewer lane.
  Details: `batch-13-executor-report.md` (initial + revision rounds 1-2)
- r1 (`reviews/batch-13-code-logic-review-r1.md`): REVISE 4/10. F1 (Blocking): the generic budget cut kept the oldest
  lines of the default window and dropped the newest while the range claimed them; F2: stdio `agent_status`
  unthrottled; F3: combined stdout+stderr counts shown as one contiguous range; F4: stdio `agent_read` unbudgeted →
  all fixed in round 1
- r2 (`reviews/batch-13-code-logic-review-r2.md`): REVISE 6/10. R2-S1: the omitted middle of a partially rendered long
  line was unrecoverable; R2-S2: a huge peer stream clipped an otherwise fitting final line → fixed in round 2
- r3 (`reviews/batch-13-code-logic-review-r3.md`): APPROVE 7/10, 0 blocking, 0 serious, 1 moderate (R3-M1 → KI-13-1)

### Batch 13 deviations (accepted)

1. `mcp-stdio/agent-tool.dispatcher.ts` changed (not in the 13.1 list; named in Batch 12's deferral): its strict schema
   would reject the advertised `offset`; stdio `agent_read`/`agent_status` now share the HTTP view and throttle
2. New `mcp-core/agent-read.view.ts` (+ spec) and `mcp-core/agent-status-throttle.ts`: one renderer and one throttle
   policy for HTTP and stdio. The read is a budget-sized per-stream tail window that always keeps each stream's end;
   a narrowed stream's full returned window is spooled per Decision 7 and named in the result
3. Batch 12's files touched again: `readOutput` reports per-stream totals (cli-agent-runtime) and `AgentOutput` gains
   per-stream fields (libs/shared), so each stream's range is exact (r1 F3)
4. HTTP `ptah_agent_read` arguments are zod-validated: malformed or negative `tail`/`offset` now error instead of a
   silent 0. Anonymous/workspace-only HTTP callers are not throttled (no stable identity)
5. Coordinated handoff honoured: `AstCodeInsights` in `types.ts` untouched (Lane I 24a owns it; merged cleanly)

### Batch 13 known issues

- **KI-13-1** (= r3 R3-M1, Moderate): a very long host root (reproduced at 4,334 chars) makes the spool locators alone
  exceed the 8,000-char / 2,000-token stdio result budget (9,010 chars, zero lines shown). Recovery still works (not
  silent loss). Same class as KI-18-1. Fix: reserve bounded locator metadata before selecting content, use a short
  recoverable locator, and budget-check the zero-content fallback; add a long-root regression. Carried to
  TASK_2026_561_9e57 Track B
- Spool storage has age-only cleanup (no dedup/quota) — r3 top risk; carried to TASK_2026_561_9e57 Track B

### Batch 13 team-leader verification (Mode 2, 2026-09-26)

- Production diff verified on disk (17 files); `nx run-many "-t=test,lint,typecheck"` for vscode-lm-tools,
  cli-agent-runtime, shared (`--skip-nx-cache`) → 9 tasks pass; `ptah-cli`/`ptah-electron` typecheck pass;
  `ptah-electron:validate-deps` pass; `degradation-audit:lint` → TOTAL 300
- Committed as **7d92f9f77** (code only; commitlint checked first; hooks active)

---

## Batch 14: ptah_agent_spawn resume — stop resending the system/role prefix — COMPLETE (lane commit 93037daed, merged 6b7f9a255)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential (file-disjoint; MAY run alongside a hub-file batch; does not share files with Batch 12)
- Rationale: 40.7% of Codex lane input (TASK_2026_557 RC3). One lib
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: none

### Task 14.1: Resume-aware `buildTaskPrompt` — COMPLETE

- Files: `<WT>/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts` (`buildTaskPrompt` :490-540), `<WT>/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.spec.ts`, plus at most two adapter files among codex/opencode/antigravity/cursor/pi/copilot if one must opt out (`<WT>/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/*.adapter.ts`)
- Plan reference: research/agent-task-harness.md:28-59
- Pattern to follow: `codex-cli.adapter.ts:666-669`
- Quality requirements: when `resumeSessionId` is set AND the adapter's resume restores prior history, omit `systemPrompt`/`projectGuidance` and the role block; keep `NATIVE_AGENT_TOOL_POLICY` (unchanged constant), the task and the completion contract. Adapters whose resume does not restore history keep the full prefix
- Validation notes: RISK "adapter resume without history" is carried here. The report lists each adapter with its evidence (`file:line`) for whether its resume restores history
- Implementation details: an explicit per-adapter flag or option (e.g. `resumeRestoresContext`), not a string check. Specs: resume excludes a 1,000-char system prompt but includes the policy and the completion contract; a fresh spawn is unchanged; a non-restoring adapter keeps the prefix

### Task 14.2: Confirm the Codex deferral guard — COMPLETE

- Files: `<WT>/libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/codex-cli.adapter.spec.ts` (only if the existing assertion at :1277 would not fail on a flip)
- Plan reference: research-report.md:191-196
- Pattern to follow: `codex-cli.adapter.spec.ts:1277`
- Quality requirements: show that flipping `tool_search_always_defer_mcp_tools` at `codex-cli.adapter.ts:627` makes a spec fail (run it locally, revert, report). Add an assertion only if none fails
- Validation notes: no production change
- Implementation details: evidence in the report

### Batch 14 verification

- [x] `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime 2>&1 | tail -40` passes
- [x] The review lane approves (r1 APPROVE 8/10)

### Batch 14 record (Lane B)

- Tasks 14.1 and 14.2 COMPLETE. Executed in Lane B; details in `batch-14-executor-report.md`; review
  `reviews/batch-14-code-logic-review-r1.md` APPROVE 8/10
- Adapter table: Codex (`codex-cli.adapter.ts:666` `resumeThread`) and Cursor (`cursor-cli.adapter.ts:345`
  `Agent.resume`) restore history and opt in with an explicit `resumeRestoresContext: true`; OpenCode, Antigravity,
  Pi and Copilot are unverified and keep the full prefix (default `false`)
- Moderate doc gap: `codex-cli.adapter.ts:669` — Codex still resends the role on its `developer_instructions`
  channel on resume; not documented at the call site → TASK_2026_561 Track B
- 14.2: the Codex deferral guard spec already fails on a flip; no spec change
- Lane commit **93037daed**; merged `--no-ff` as **6b7f9a255** (no conflicts); integration verification below
  (Batch 19 record)

---

## Batch 15: ptah_task_list / ptah_task_check — paged, summary by default — COMPLETE (commit ce6ba2c00)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: P0, 223,297 chars live. Natural page unit = task rows (User Decision 2)
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 13 (hub-file ordering)

### Task 15.1: `limit`/`cursor`/`fields` on list — COMPLETE

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/tasks-namespace.builder.ts` (`TaskListArgsSchema` :204-207, `list()` :479-504), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/tasks-namespace.builder.spec.ts`, `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts` (`buildTaskListTool` :207-233)
- Plan reference: research/agent-task-harness.md:307-362
- Pattern to follow: the existing Zod args schemas in the same file
- Quality requirements: `limit` (default 25, max 200), `cursor` (opaque, stable ordering), and `fields: 'summary' | 'full'` (default summary drops `description`). The response adds `total` and `nextCursor?`. Existing status filters are kept. The description tells the agent how to get the full row (`ptah_task_get` or `fields:'full'`)
- Validation notes: re-check that no UI/RPC path uses `ptah.tasks.list` before changing defaults. Edge case: cursor past the end
- Implementation details: specs with 150 tasks: default ≤ 25 rows and ≤ 8,000 chars; cursor continuation covers all 150 with no duplicates; fields full includes description

### Task 15.2: Cap `invalid`/`excluded` in check — COMPLETE

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/tasks-namespace.builder.ts` (`check()` :506-538), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/tasks-namespace.builder.spec.ts`
- Depends on: Task 15.1
- Plan reference: research/agent-task-harness.md:368-385
- Pattern to follow: Task 15.1's `total` field
- Quality requirements: at most 50 entries each, plus `invalidTotal`/`excludedTotal`. The health verdict is computed on the full set
- Validation notes: none
- Implementation details: spec with 120 invalid folders

### Batch 15 verification

- [x] `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/vscode-lm-tools 2>&1 | tail -40` passes
- [x] The Codex review lane approves (r3 APPROVE 8/10)

### Batch 15 record (Lane A)

- Tasks 15.1 and 15.2 COMPLETE; details in `batch-15-executor-report.md` (initial, revision rounds 1-2, minor
  follow-ups after r3)
- Why: `ptah_task_list` returned every row with its description (164,507 chars for 150 tasks). It now returns
  token-fitted pages of whole rows with a signed cursor that never silently skips or repeats a row; `ptah_task_check`
  caps `invalid`/`excluded` at 50 each with `invalidTotal`/`excludedTotal`, verdict computed on the full set
- Review history: r1 REVISE 5/10 (page not cut by the token budget; rename/filter cursor holes) → r2 REVISE 6/10
  (a status change invalidated a filtered walk; forged v2 cursor accepted; long Unicode ids broke the cursor) → r3
  APPROVE 8/10, 0 Blocking/Serious. The three r3 minors were applied after approval exactly as specified
  (`timingSafeEqual` signature check; a forgery regression that only the HMAC can refuse, bypass-proven; the stale
  `registerList` JSDoc in `tasks-rpc.handlers.ts`); no further review
- Deviations (accepted):
  - The MCP default page is token-fitted, not a fixed 25: the dispatcher passes `fitsBudget(text,
getToolResultBudget(name))`, so the 150-task fixture yields 19 whole summary rows (5,733 chars, 1,929 of 2,000
    tokens). `limit` (default 25, max 200) still bounds the page; through `execute_code` only `limit` applies
  - `count` now means rows on this page; `total` carries every match (previously `count`)
  - Summary rows also drop `folderName`/`validationIssues`, omit empty relation arrays and emit `frontmatterValid`
    only when false (needed for the size budget); `fields:'full'` returns the unchanged row
  - Cursor is `v:3`, fixed width (~140 chars), with an HMAC-SHA256 signature under a per-process `randomBytes(32)`
    key. Trade-off: a cursor does not survive a host restart or cross hosts (Electron ↔ CLI); the agent gets
    `INVALID_CURSOR` and restarts, as documented in `ptah.help('tasks')`. A rename/add/delete in the cursor's
    same-instant group also returns `INVALID_CURSOR` (detected, never silent)
  - `list()` reads the index once unfiltered and applies status/type with the shared `mergeStatusTypeFacets` +
    `filterTasks` pair, so a status change never invalidates a filtered walk
  - Files beyond the batch list: `protocol-dispatcher.ts` (+spec; budget `fits` hook), `system-namespace.builders.ts`
    (help topic), `tool-description.builder.spec.ts`, and the `tasks-rpc.handlers.ts` comment
- Pre-commit verification (2026-09-26, `--skip-nx-cache`): vscode-lm-tools test/lint/typecheck pass; rpc-handlers
  lint/typecheck pass, test 1 failure in `harness/selection/harness-skill-selection-rpc.service.spec.ts:113`
  ("never writes state.json") — environmental and unrelated: the precondition fails because the machine's `%TEMP%`
  carries a stray `.ptah` directory, so the workspace root resolves above the fixture; deterministic in isolation (8/9),
  and the file is outside Batch 15. `ptah-cli`/`ptah-electron` typecheck pass; validate-deps pass; degradation-audit
  TOTAL 300
- Commit **ce6ba2c00**

---

## Batch 16: ptah_dashboard_propose_spec advertised schema; always-on description budgets — COMPLETE (commit 2152a3305)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: always-on cost class (research/cross-cutting.md:129-134). The surface description text is NOT shortened — it is not a false claim, so User Decision 4 does not cover it. Only a growth guard is added
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 15

### Task 16.1: Minimal `$ref`-free advertised schema — COMPLETE

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/dashboard-propose-spec.tool.ts` (:43-100), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/dashboard-propose-spec.tool.spec.ts`
- Plan reference: research/agent-task-harness.md:394-437; research-report.md:108
- Pattern to follow: other hand-authored `inputSchema` objects in `tool-description.builder.ts`
- Quality requirements: the advertised schema covers the top-level shape and required keys and points to `ptah.help('dashboard')` for detail. The Zod validator stays the enforcement point. The tool definition's JSON is ≤ 3,000 chars (from 12.5k)
- Validation notes: RISK "schema drift" is carried here — every valid fixture in the existing spec validates against the advertised schema (use the repo's JSON-schema validator if present, otherwise a structural check of required keys and types), and every invalid fixture is still rejected by Zod
- Implementation details: char-budget spec on `JSON.stringify(buildDashboardProposeSpecTool())`

### Task 16.2: Growth guard for the surface tool definitions — COMPLETE

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/surface-tools.spec.ts`
- Plan reference: research-report.md:140-141 (rows 55-56)
- Pattern to follow: `tool-description.builder.spec.ts:25`
- Quality requirements: pin `ptah_surface_update` ≤ its current size + 5% and `ptah_surface_get_state` likewise (measure at HEAD, write the number in the spec with its date)
- Validation notes: no change to `surface-tools.ts`
- Implementation details: spec only

### Batch 16 verification

- [x] `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/vscode-lm-tools 2>&1 | tail -40` passes
- [x] The review lane approves (r2 APPROVE 8/10)

### Batch 16 record (Lane A)

- Tasks 16.1 and 16.2 COMPLETE; details in `batch-16-executor-report.md`
- Review history: r1 REVISE 6/10 (S1: `ptah.help('dashboard')` omitted the Zod rules; M1: prototype keys) → r2
  APPROVE 8/10 (`reviews/batch-16-code-logic-review-r{1,2}.md`)
- `ptah_dashboard_propose_spec` tool definition JSON: 15,183 → 1,539 chars (budget 3,000; the $ref schema alone was
  12,567). The full contract in `ptah.help('dashboard')` is generated from the Zod contract constants; Zod
  (`DashboardProposeSpecInputSchema`) stays the enforcement point
- Surface growth guard: `ptah_surface_update` 65,190 (ceiling 68,449), `ptah_surface_get_state` 2,141 (ceiling
  2,248), measured 2026-09-26; `surface-tools.ts` unchanged
- Deviations (accepted): `namespace-builders/system-namespace.builders.ts` edited (help text carries the detail
  removed from the description); new `namespace-builders/dashboard-contract-help.ts`; two specs that pinned the old
  design removed (byte-equal `z.toJSONSchema` and named-definition-plus-`$ref`)
- Pre-commit verification (2026-09-26): vscode-lm-tools test/lint/typecheck `--skip-nx-cache` pass; `ptah-cli` /
  `ptah-electron` typecheck pass; `ptah-electron:validate-deps` pass; `degradation-audit:lint` TOTAL 300
- Commit **2152a3305**

---

## Batch 17: ptah_browser_screenshot — jpeg q60 default; drop the duplicate re-encode — COMPLETE (commit 3f45c6483)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: User Decision 3, exactly as recorded, nothing more
- Review: Codex CLI lane (logic + structure)
- Tasks: 1 | Depends on: Batch 16

### Task 17.1: Default format and `onToolResult` summary — COMPLETE

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/browser-namespace.builder.ts` (:276-286), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/browser-namespace.builder.spec.ts`, `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts` (:1152-1225), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`, `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts` (:1038-1058)
- Plan reference: context.md User Decision 3; research/browser.md:130-155
- Pattern to follow: existing screenshot case
- Quality requirements: with no format given → jpeg at quality 60 (an explicit png/webp/quality is honoured). The `image` block stays inline. On the success path, `onToolResult` receives a one-line summary (format, ~KB, saved path if any) instead of the base64 markdown block. The error path is unchanged. The description states the new default
- Validation notes: no saveTo suppression and no auto-offload (not decided)
- Implementation details: specs — default call passes jpeg/60 to capabilities; onToolResult text has no base64 and is < 300 chars; an explicit png is honoured

### Batch 17 verification

- [x] `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/vscode-lm-tools 2>&1 | tail -40` passes
- [x] The review lane approves (r2 APPROVE 8/10; reviewer reassigned, see below)

### Batch 17 record (Lane A)

- Task 17.1 COMPLETE; details in `batch-17-executor-report.md` (initial + revision round 1)
- Default capture is jpeg at quality 60, still returned inline as an `image` block (no saveTo suppression, no
  auto-offload). An explicit png/webp/quality is honoured; png drops any quality unchecked; jpeg/webp quality must be
  an integer 0-100. On success `onToolResult` receives a one-line summary of at most 299 chars (format, ~KB, saved
  path with a middle ellipsis when long, control characters replaced) instead of the base64 markdown block
- Also fixed: a host that registers a browser placeholder without the capability methods (the CLI) now gets the
  not-available namespace instead of a TypeError
- Deviation (accepted by r1): when no format is given, a `saveTo` extension (`.png`, `.jpg`/`.jpeg`, `.webp`) selects
  the format so the bytes match the file name; otherwise jpeg/60 applies
- Review history: r1 Codex REVISE 6/10 (S1: png + quality was rejected; M1: the summary could reach 389 chars) → r2
  APPROVE 8/10 (`reviews/batch-17-code-logic-review-r{1,2}.md`). r2 was first sent to the r1 Codex session, which
  failed twice with "Codex SDK Error: Failed to parse item" (a Codex adapter defect on large or special-character
  command output); under the lane rules it was reassigned to an Antigravity CLI lane (same CLI side, different model
  family), which produced the r2 verdict. The adapter defect is recorded as TASK_2026_562_4b1d Wave 4 item 6
- Minor carried forward: R2-MIN-1, the browser capability check is all-or-nothing (a host with a partial method set
  loses every browser tool); recorded in TASK_2026_561_9e57 Track B (B6)
- Pre-commit verification (2026-09-26): vscode-lm-tools test/lint/typecheck `--skip-nx-cache` pass; `ptah-cli` /
  `ptah-electron` typecheck pass; `ptah-electron:validate-deps` pass; `degradation-audit:lint` TOTAL 300
- Commit **3f45c6483**

---

## Batch 18: ptah_browser_evaluate — cap the stringified result — COMPLETE (commit 31760e716)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: closes the bypass around `browser_content`'s 32 KB cap. The test that pins unbounded output gets rewritten
- Review: Codex CLI lane (logic + structure)
- Tasks: 1 | Depends on: Batch 17

### Task 18.1: Budgeted `formatBrowserEvaluate` — COMPLETE

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter.ts` (`formatBrowserEvaluate` :1058-1087), `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-response-formatter-extra.spec.ts` (:417-424 and a new over-cap case)
- Plan reference: research/browser.md:196-208
- Pattern to follow: `formatBrowserContent` `MAX_TEXT_LENGTH` (:1142)
- Quality requirements: the stringified value is capped at 8,000 chars (the Batch 2e char default `DEFAULT_TOOL_RESULT_BUDGET_CHARS`, imported from `tool-result-budget.ts`), with `[...truncated: N more chars — for page content use ptah_browser_content with a selector]`. Type and value rendering below the cap are unchanged
- Validation notes: edge case — undefined/null/circular values behave as today below the cap
- Implementation details: rewrite the 150-char pinning test to assert no truncation under the cap; add a 100 KB case asserting the trailer and the absence of the raw tail

### Batch 18 verification

- [x] `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/vscode-lm-tools 2>&1 | tail -40` passes
- [x] The Codex review lane approves (r1 APPROVE 8/10)

### Batch 18 record (Lane A)

- Task 18.1 COMPLETE; details in `batch-18-executor-report.md` (initial + "Orchestrator correction (Decision 7 spool
  - visible trailer)")
- Deviation (orchestrator correction, supersedes the fixed 8,000-char cap above): `formatBrowserEvaluate` takes the
  tool's `TextBudget` and a spool callback (the Batch 9 `renderSymbolIndexPage` pattern). An answer that fits is
  rendered byte-for-byte as before and nothing is spooled. Otherwise the **full** stringified value is spooled per
  Decision 7 and the value is cut to the longest surrogate-safe prefix that keeps header + prefix + trailer within
  both limits; the trailer names the dropped char count and the spool path (or the save failure's errno). The
  correction also touched `protocol-dispatcher.ts` (evaluate case passes `getToolResultBudget(name)` and the
  host-owned spool root, same rules as `ptah_get_symbol_index`) and `protocol-dispatcher.spec.ts`, beyond the batch
  file list, as the correction allowed
- Fails-before: `-t formatBrowserEvaluate` 7 failed / 7 passed before → 14 passed after
- Review: r1 Codex APPROVE 8/10 (`reviews/batch-18-code-logic-review-r1.md`); 0 Blocking, 0 Serious, 1 Moderate
- Known issue **KI-18-1** (Moderate, carried forward): with an unusually long host spool root (~1,329 chars, e.g. a
  deeply nested Unicode workspace) the trailer alone exceeds the 2,000-token budget, so the shared budget step cuts
  again and spools a second time; the evaluate-specific inline hint is lost, though the generic reduction notice
  remains and the raw value is still recoverable from the first spool. Fix direction: a bounded/relative locator
  (the budget layer's `tool-result-budget.ts:386` strategy). Recorded in TASK_2026_561_9e57 Track B (B6)
- Pre-commit verification (2026-09-26): vscode-lm-tools test/lint/typecheck `--skip-nx-cache` pass; `ptah-cli` /
  `ptah-electron` typecheck pass; `ptah-electron:validate-deps` pass; `degradation-audit:lint` TOTAL 300
- Commit **31760e716**

---

## Batch 19: get_diagnostics — scoped runs no longer queue behind an abandoned unscoped run; second-checkout guard — COMPLETE (lane commit 43358c04d, merged c1edc68a6)

- Recommended executor: backend-developer (sub-agent)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: RE-SCOPED at Batch 1 verification (2026-09-25) from the Task 1.2 evidence. The provisional target (`resolveTypescriptModulePath`, `type-script-diagnostics-provider.ts:150-166`) does not hold the mechanism; the worker scheduling does. Worker lifecycle and budget semantics need one executor who holds the whole path in mind
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 1 (evidence), Batch 18 (ordering)

### Task 19.1: Separate worker lane for scoped runs — COMPLETE

- Files: `<WT>/libs/backend/workspace-intelligence/src/diagnostics/ts-diagnostics-worker.ts` (`run`/`ensureWorker`, the per-`tsModulePath` worker map), `<WT>/libs/backend/workspace-intelligence/src/diagnostics/ts-diagnostics-worker.spec.ts`, `<WT>/libs/backend/workspace-intelligence/src/diagnostics/type-script-diagnostics-provider.ts` (`compute` → `withBudget`, :236-284: pass the lane), `<WT>/libs/backend/workspace-intelligence/src/diagnostics/type-script-diagnostics-provider.spec.ts`
- Plan reference: `.ptah/specs/TASK_2026_559_8ca9/research/diagnostics-worktree-repro.md` ("Results: head-of-line case", "Conclusion"); research/workspace-files.md:246-270
- Pattern to follow: the per-compiler worker map in `ts-diagnostics-worker.ts` (keyed by `tsModulePath`, idle self-termination, awaited `terminate()`, TASK_2026_325 finding 4)
- Direction chosen (team-leader, from the evidence): key workers by `(tsModulePath, lane)` where lane is `scoped | unscoped`, so a scoped run never waits behind an unscoped run on the same compiler. Terminating an abandoned unscoped run was rejected: it contradicts the documented `withBudget` invariant (`type-script-diagnostics-provider.ts:241-249` — the run is kept so a retry shares it or reads its cache, instead of starting a second full compile)
- Quality requirements: a scoped run posted while an unscoped run is still in flight on the same compiler completes in about its isolated time, not isolated + blocker time. Scoped runs still share one lane with each other; unscoped runs still share theirs. `withBudget`'s retain-and-cache behaviour, in-flight de-duplication and the 5 s result cache are unchanged. Each lane keeps the existing lifecycle: `unref` when idle, `ref` while a run is outstanding, idle self-termination, and `dispose()` awaits every lane's termination
- Validation notes: RISK — two lanes on one compiler can hold two typescript programs at once (memory). Bounded by the lane count (2 per compiler) and idle termination; the report states the bound. The worker-containment spec (`ts-diagnostics-worker-containment.spec.ts`) stays green unchanged. Cold single-lib compile cost (23-27 s) is out of scope — do not try to shrink it here
- Implementation details: guard spec with an injected slow worker (or a fake worker source): an unscoped run that holds its lane for a long time, then a scoped run → the scoped run resolves first and within its own time; two scoped runs still serialise on one lane; `dispose()` leaves no thread. Re-run the Task 1.2 case e script locally and put the before/after ms in the report (not committed)

### Task 19.2: Second-worktree case in the provider contract — COMPLETE

- Files: `<WT>/libs/backend/platform-core/src/testing/contracts/run-diagnostics-provider-contract.ts`, `<WT>/libs/backend/platform-core/src/testing/contracts/run-diagnostics-provider-contract.self.spec.ts`
- Plan reference: research/workspace-files.md:272-276
- Pattern to follow: the existing contract cases
- Quality requirements: a case that runs the provider for a file in a second checkout (a temp copy with its own tsconfig chain, standing in for a `git worktree add`) and asserts the same diagnostics as the primary copy within a fixed budget (10s)
- Validation notes: keep it hermetic — a small temp fixture, not this repo. Per Task 1.2 this case is expected to pass at HEAD; it is a regression guard for the config-chain resolution, not the proof of the Task 19.1 fix (that proof is Task 19.1's lane spec)
- Implementation details: the contract takes a factory for the second root

### Batch 19 verification

- [x] `node_modules/.bin/nx run-many -t test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/platform-core 2>&1 | tail -40` passes
- [x] The review lane approves (r3 APPROVE 8/10)

### Batch 19 record (Lane C)

- Tasks 19.1 and 19.2 COMPLETE. Executed in Lane C (base 685edbc24); details in `batch-19-executor-report.md`
- Review history: r1 REVISE 6/10 → r2 REVISE 6/10 → r3 APPROVE 8/10 (`reviews/batch-19-code-logic-review-r{1,2,3}.md`)
- Task 1.2 case e (scoped run behind an abandoned unscoped run): 178,904 → 29,077 ms
- Memory bound: at most 2 typescript programs per compiler (one per lane), released by idle termination
- Pre-existing slow specs noted (not introduced here): `platform-core` `file-settings-manager.bench.spec.ts:86`
  30 s timeout under load → TASK_2026_561 Track B
- Lane commit **43358c04d**; merged `--no-ff` as **c1edc68a6** (no conflicts)
- Integration verification after both lane merges (2026-09-26): `nx run-many "-t=test,lint,typecheck"` for
  vscode-lm-tools, workspace-intelligence, cli-agent-runtime, shared, platform-core `--skip-nx-cache` → "Successfully
  ran targets test, lint, typecheck for 5 projects" (first run, no timeouts); `ptah-cli`/`ptah-electron` typecheck
  pass; `ptah-electron:validate-deps` pass; `degradation-audit:lint` TOTAL 300

---

## Batch 20: Regression harness H1 — service-level benchmark vs native (size AND recall) — COMPLETE with known issues R5-01..R5-03 carried to Batch 24d (20.1, 20.3 via lane commit db52fa759, merged 1c2ad2f92; 20.2 via 01f3daa8b, f926423a2, ac441f780)

- Recommended executor: senior-tester (sub-agent)
- Fallback executor: backend-developer
- Execution mode: sequential
- Rationale: a first-class guard for the mandated tools whose logic lives in `workspace-intelligence`. It runs in that lib's `test` target, which `nx affected -t test` runs in CI
- Review: Codex CLI lane (logic + structure)
- Tasks: 3 | Depends on: Batches 1-19 (including 2a-2f) committed

### Task 20.1: Generated fixture workspace — COMPLETE

- Files: `<WT>/libs/backend/workspace-intelligence/src/testing/mcp-contract/fixture-workspace.ts` (new; builds a temp tree at test time — no 500 checked-in files)
- Plan reference: research-report.md:222-255
- Pattern to follow: temp-dir fixtures in `project-detector.service.spec.ts`
- Quality requirements: an Nx-shaped monorepo with mixed root deps and no root angular.json; a 500-file flat directory; TS/TSX sources with known exported symbols, import edges and camelCase identifiers; a deterministic seed
- Validation notes: it cleans up after itself
- Implementation details: an exported `createMcpContractFixture()` → `{ root, knownSymbols, knownEdges, cleanup }`

### Task 20.2: Benchmark spec per mandated tool — COMPLETE with known issues (User Decision 22)

- Files: `<WT>/libs/backend/workspace-intelligence/src/testing/mcp-contract/mcp-contract.bench.spec.ts` (new)
- Depends on: Task 20.1
- Plan reference: research-report.md:240-249; TASK_2026_557 Wave 1.5
- Pattern to follow: n/a (new)
- Quality requirements: for `ptah_ast_analyze` (AstAnalysisService), `ptah_context_enrich_file` (ContextEnrichmentService, no language given), `ptah_get_dependents`/`ptah_get_symbol_index` (DependencyGraphService), `ptah_relevance_rank_files` (FileRelevanceScorer), `ptah_project_detect_monorepo` and the workspace_analyze project type (detectors), and `ptah_count_tokens`: assert (a) SIZE — the result is smaller than the native equivalent (the full file read / a regex grep over the tree) by the promised margin (`context_enrich_file` and `ast_analyze` ≥ 40% reduction on a 300-line file), and (b) RECALL — every known symbol, edge or dependent that the native grep finds is present. The detected project type is never `react` on the Nx fixture
- Validation notes: it FAILS the run on regression; it never only logs. Runtime < 30s so it stays in the normal `test` target
- Implementation details: real services, mocked only at platform boundaries (file system via the real fs on the temp root)

### Task 20.3: Reducer bench — size AND preserved content per content type (User Decision 7) — COMPLETE

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

### Batch 20a record (Lane D — Tasks 20.1 and 20.3)

- Author: Antigravity CLI lane; details in `batch-20a-executor-report.md`
- Review history: r1 REVISE 7/10 → r2 REVISE 8/10 → r3 APPROVE 9/10 (`reviews/batch-20a-code-logic-review-r{1,2,3}.md`)
- Files: `workspace-intelligence/src/testing/mcp-contract/fixture-workspace.ts` + `.spec.ts`,
  `tool-output-reducers/src/lib/reducers.bench.spec.ts`, `workspace-intelligence/tsconfig.lib.json` (exclude)
- Deliberate-break evidence (report §5, reverted): log reducer with context disabled fails the 3-failure-block
  assertions; a fixture-workspace break fails its spec
- The bench's `DEFAULT_BUDGET` (2000 tokens / 8000 chars) is a local constant (`type:util` boundary forbids
  importing the production default). The production default `DEFAULT_TOOL_RESULT_BUDGET_TOKENS` is guarded by Task
  21.1, which must pin the numeric value
- The Batch 7 deliberate-revert item above belongs to Task 20.2 and is still open
- Lane commit **db52fa759**; merged `--no-ff` as **1c2ad2f92** (no conflicts)
- Integration verification after the merge (2026-09-26): `nx run-many "-t=test,lint,typecheck"` for vscode-lm-tools,
  workspace-intelligence, tool-output-reducers `--skip-nx-cache` → "Successfully ran targets test, lint, typecheck
  for 3 projects" (first run, no timeouts); `ptah-cli`/`ptah-electron` typecheck pass;
  `ptah-electron:validate-deps` pass; `degradation-audit:lint` TOTAL 300

### Batch 20.2 record (Lane A — Task 20.2 with sub-batches 20.2p, 20.2q)

- Reports: `batch-20b-executor-report.md` (harness: rounds 1-2, bounded correction, User Decision 21 realistic
  fan-in), `batch-20p-executor-report.md` (ast_analyze lossless table), `batch-20q-executor-report.md` (export
  extraction + User Decision 22 narrow fix; platform-core coverage vocabulary gains `unsupported-syntax`)
- Review history (`reviews/batch-20b-code-logic-review-*.md`): r1 REVISE 3/10 → r2 REVISE 6/10 → r3 REVISE 4/10
  (found the export-extraction recall loss → 20.2q and Batch 24d) → r4-postcap REVISE 6/10 (R4-01 Serious, R4-02
  Blocking) → r5-final REVISE 6/10 (R4-01/R4-02 original cases fixed; R5-01, R5-02 Blocking, R5-03 Moderate)
- User Decision 21: `get_dependents` SIZE guard measured on a realistic fan-in (fixture hub with 12 real
  dependents), not the fixture's ≤2-dependent answers; compact coverage moved to Batch 22c
- User Decision 22: commit after r5 with its defects recorded as known issues and carried into Batch 24d (see
  "Carried acceptance criteria (User Decision 22)" there). r5 stays REVISE; this is not an approval
- Deliberate-break proofs (final round, all reverted, suite green after): (1) Batch 7 language-inference spy fails
  the `context_enrich_file` SIZE test; (2) 20.2p table-format spy fails the `ast_analyze` SIZE test; (3)
  `extractExportsFromMatches` dropping `interface` records fails both the `ast_analyze` and `get_symbol_index`
  exact-recall tests
- Commits: **01f3daa8b** 20.2p (ast_analyze table formatter + specs; 26% → 46-48% saving on the fixture, 78-88% on
  real files); **f926423a2** 20.2q (export-extraction, parser/ast/namespace decoders, platform-core vocabulary,
  specs; `ast-analyze-result.spec.ts` carries both 20.2p and 20.2q tests and lands here); **ac441f780** 20.2 harness
  (bench, fixture + spec, `resolveEnrichLanguage` extraction and its call site; `analysis-namespace.builders.ts` +
  spec also carry the 20.2q `exportSymbolNames` call and land here). `workspace-intelligence/src/index.ts` was split
  by line across the three commits
- One pending test by design: `mcp-contract.bench.spec.ts:416` "pending Batch 24r: preserved coverage survives
  reduction" — converted into a real test after the Lane H merge (see Batch 22c)
- Verification (2026-09-27): `platform-core:test --skip-nx-cache` isolated → 44 suites, 851 passed, 4 todo (the r5
  failure did not reproduce; Nx flags the task flaky); `nx run-many "-t=test,lint,typecheck"` for
  workspace-intelligence, vscode-lm-tools, platform-core `--skip-nx-cache` → success for 3 projects; `ptah-cli` /
  `ptah-electron` typecheck pass; `ptah-electron:validate-deps` pass; `degradation-audit:lint` TOTAL 300; no
  TODO/FIXME/PLACEHOLDER/STUB in changed source

---

## Batch 21: Regression harness H2 — dispatcher contract sweep and mandate manifest — COMPLETE (21p/21q/21r product commit + 21 harness commit, 2026-09-27)

- History: r1 REVISE 3, r2 REVISE 4, r3 (21 REVISE 5, 21p APPROVE 8, 21q REVISE 5), bounded correction, r4-postcap
  (21 REVISE 7: R4-01; 21q REVISE 6: R4-02; 21r REVISE 4: R4-03 Blocking). R4-01..03 fixed once under User Decision 24
  (`batch-21-r4-fix-report.md`); verification rolls forward to the Batch 24d review, together with two carried limits:
  (a) a composed `markdown-outline+prefix` result reports `truncated: false` when it fits; (b) the R4-01 AST proof does not
  catch `setup.createSecondCheckout = undefined` assigned before `return setup`.
- Batch 21p (unplanned): `browser_content` HTML extractor path. Report `batch-21p-executor-report.md`.
- Batch 21q (unplanned): stdio agent tools apply the result budget; `ptah_agent_*` are `preformatted`; bounded stdio
  `structuredContent` (`mcp-stdio/bounded-structured-content.ts`); stdio `tools/list` advertises
  `maxResultSizeChars` (agents 8,000; `session_submit` 1,048,576, pinned against the app's `AGGREGATE_BUFFER_CAP`).
- Batch 21r (unplanned): the Markdown outline no longer drops the body — outline first, then a labelled leading prefix of
  the full text (`markdown-outline+prefix`). Report `batch-21r-executor-report.md`.
- Commits are grouped (product, then harness) because 21p/21q/21r share hunks in `tool-result-budget.ts` and
  `protocol-dispatcher.*`.

- Recommended executor: senior-tester (sub-agent)
- Fallback executor: backend-developer
- Execution mode: sequential
- Rationale: covers every tool in `tools/list` at the choke point, plus a manifest that fails when a prompt-mandated tool has no guard
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: Batch 20
- Test hygiene (added after Batch 13): every spec that makes the budget layer spool injects a `mkdtemp` spool root and
  removes it in `afterEach`; no spec writes into `os.tmpdir()/.ptah` or the repo's `.ptah`

### Task 21.1: Budget and size sweep over `tools/list` — IN_PROGRESS

- Files: `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-contract.sweep.spec.ts` (new)
- Plan reference: research/cross-cutting.md:271-273, :289-291
- Pattern to follow: `protocol-dispatcher.spec.ts` fake `PtahAPI` setup
- Quality requirements: for EVERY tool returned by `tools/list`, drive `handleMCPRequest` with a fake PtahAPI returning oversized data and assert the text is ≤ its `_meta['anthropic/maxResultSizeChars']` plus the trailer, or the tool's own documented page/cap. Pin the total `tools/list` JSON size (measured at this HEAD, +5% headroom) and byte stability across caller kinds. Every tool description stays within the per-tool char budget. This replaces the live `toolslist.py` re-run with a CI number
- Validation notes: a tool added later without a budget fails the sweep (it iterates the list; no hardcoded tool list)
- Implementation details: table-driven
- Extension (User Decision 7, reduced output): for every tool, the oversized fake payload is driven in each shape the tool can return (JSON, log text, Markdown, HTML where the tool returns page content). Assert: returned tokens ≤ the declared token budget; the trailer names a reducer (`preformatted` tools: `none`) and a spool path; the spool file is byte-equal to the raw payload; and a planted marker (an error line in logs, a heading in Markdown, a key/value in JSON, the article title in HTML) survives in the returned text. `ptah_get_diagnostics` is asserted NOT to be reduced (its Batch 1 requested-file entries survive verbatim up to the cut)

### Task 21.2: Mandate manifest — IN_PROGRESS

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

## Language support (User Decisions 18-19) — Batches 22-38

Added 2026-09-26 (team-leader Mode 1, append-only). Source of truth: `implementation-plan-languages.md` (revision 2 +
r3 edits, approved by User Decision 19) and its three design reviews (`implementation-plan-languages-review.md`,
`-review-r2.md`, `-review-r3.md`). 31 batches (the plan's 29, with 36 split into 36a/36b/36c — see decomposition note
D5). Same review bar as Decision 17: cross-side review, 2 revise rounds, one bounded correction + a post-cap review,
then the user. Every fix and every review finding gets a regression spec that fails before the fix (FB).

Path prefixes used below (all absolute under `<WT>`):
`PC` = `<WT>/libs/backend/platform-core/src`, `WI` = `<WT>/libs/backend/workspace-intelligence/src`,
`MCP` = `<WT>/libs/backend/vscode-lm-tools/src/lib/code-execution`, `WIT` = `<WT>/libs/backend/workspace-intelligence/src/testing/mcp-contract`.

### Common checks for every language batch

- The batch's scoped command: `node_modules/.bin/nx run-many -t=test,lint,typecheck -p <owned projects> --skip-nx-cache 2>&1 | tail -40`
- `node_modules/.bin/nx run-many -t=typecheck -p ptah-cli ptah-electron --skip-nx-cache`
- `node_modules/.bin/nx run ptah-electron:validate-deps --skip-nx-cache` → "All external imports are covered". Tree-sitter
  query text, messages and fixtures that contain `from "x"`, `import("x")`, bare `import "x"` or `require("x")` shapes
  are built by concatenation (or lane D's `${FROM}`, `fixture-workspace.ts:88`) — see the Batch 9 note. This bites
  Go (`import "fmt"`), Python (`from . import`), PHP (`require('x.php')`) and Ruby (`require 'x'`) queries and fixtures
- `node_modules/.bin/nx run degradation-audit:lint --skip-nx-cache` → TOTAL 300 (per-lib baselines unchanged)
- `ptah-core-prompt.ts` (`libs/backend/agent-sdk/src/lib/prompt-harness/`) and `NATIVE_AGENT_TOOL_POLICY`
  (`cli-adapter.utils.ts`) unchanged vs the batch base (Decision 4)
- The FB spec is shown failing on the batch base (its last listed dependency merged into the integration branch) and
  passing after; the evidence goes in the executor report
- Budget rule (Decisions 2, 15): `coverage` goes after the Batch 9 status fields (`count`, `incomplete`,
  `graphedFiles`, `discoveredFiles`) and before `file`, lists and hits

### Lane plan (Decision 17 amended for Decisions 18-19)

Worktrees live under `D:/projects/ptah-extension/.claude-worktrees/`. Each lane branch is `fix/task-559-lane-<x>`. Only
the team-leader creates worktrees, merges and commits; lane executors never run git.

Per-batch integration rule (needed for the FB-base definition): each approved batch is committed on its lane branch
and merged `--no-ff` into `fix/task-559-mcp-tool-contract` in a quiet window, followed by the post-merge re-run
(scoped test/lint/typecheck of every project the merge touched, ptah-cli/ptah-electron typecheck, validate-deps,
degradation audit TOTAL 300). Before the next batch in the same lane starts, the team-leader merges the integration
branch into the lane branch, so every batch starts on a base that has its dependencies.

| Lane          | Worktree           | Batches (in order)                                                                                                                                                          | Author                                                          | Reviewer (other side)                 | Starts after                                                                                                  |
| ------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| H (hub)       | `task-559-lane-h`  | 22 → 23a → 24a → ‖ Lane A 13 merged ‖ → 24b → 23b → 25a → 25b → 26a → ‖ Lane A 21 merged ‖ → 24c → ‖ 29a2 merged ‖ → 29b → ‖ 32b merged ‖ → 32c → ‖ 37a + 27 merged ‖ → 37b | Claude `backend-developer` subagent                             | Codex CLI lane                        | now (base = integration tip, a44e1ec04 or the Batch 17 commit if it lands first; 22 is file-disjoint from 17) |
| P (packaging) | `task-559-lane-p`  | 28a → 28b                                                                                                                                                                   | Codex CLI lane                                                  | Claude `code-logic-reviewer` subagent | now (same base)                                                                                               |
| E (Electron)  | `task-559-lane-e`  | 26b                                                                                                                                                                         | Antigravity CLI lane                                            | Claude `code-logic-reviewer` subagent | 26a merged (includes 23b)                                                                                     |
| K (checker)   | `task-559-lane-k`  | 37a                                                                                                                                                                         | Claude `backend-developer` subagent                             | Codex CLI lane                        | O2 amendment reviewed AND 25a merged                                                                          |
| T (harness)   | `task-559-lane-t`  | 27 → … → 38                                                                                                                                                                 | Claude `senior-tester` subagent                                 | Codex CLI lane                        | 27: 26b and 24c merged (whole honesty chain) and Lane A 21 merged; 38: every gate dependency merged           |
| G (grammars)  | `task-559-lane-g`  | 29a1 → 29a2, later 30 → 31 → 30k (G1)                                                                                                                                       | Codex CLI lane (29a1, 29a2); Antigravity CLI lane (30, 31, 30k) | Claude `code-logic-reviewer` subagent | 29a1: 27 and 28a merged; 30: 29b merged; 30k: 31 merged AND Kotlin provenance record (O3) reviewer-checked    |
| G2 (graphs)   | `task-559-lane-g2` | 32a → 32b → 33 → 34 → 35 → 36a → 36b → 36c                                                                                                                                  | Codex CLI lane                                                  | Claude `code-logic-reviewer` subagent | 32a: 29b AND 30 merged (note D3); 34: 30 merged (handoff of `java.language.ts`); 36a-c: 31 merged             |

Concurrency (Decision 17, at most 3 CLI lanes at once; a Codex review lane counts): the orchestrator queues CLI work
so the count never passes 3. Expected peaks and how they stay at 3:

- Now: Lane A 17 Codex review (1) + P 28a Codex author (2) + H 22 Codex review when 22 returns (3). Lane A 18 → 15 →
  13 reviews queue behind whichever Codex lane frees first.
- After 26a: E 26b Antigravity (1) + H 24c Codex review (2) + K 37a Codex review (3); Lane A 20.2/21 reviews queue.
- After 29b: G 30 Antigravity (1) + G2 32a Codex (2) + one Codex review (3). H 32c and K/H 37a/37b queue.

Ownership handoffs (plan "Lanes"): G1 hands `java.language.ts` and `rust.language.ts` to G2 at the 30 merge and
`php`/`ruby`/`cpp.language.ts` at the 31 merge; after a handoff G1 never edits those files. The grammar manifest
`scripts/tree-sitter-grammars.json` `active` flags are edited only by H (29b) and G1 (30, 31, 30k), one batch at a time.
`WIT/matrix/required-keys.ts` is written once (27); every activating batch **creates** its own
`WIT/matrix/activations/<batch>.ts`.

### Decomposition notes (stress test of the plan's batch list)

- **D1 — Lane A hub overlap (resolved sequential).** Lane A's tail 17 → 18 → 15 → 13 edits `protocol-dispatcher.ts`
  (17, 13), `mcp-response-formatter.ts` (18, 13) and `tool-description.builder.ts` (17, 15, 13); 17 is uncommitted in
  this worktree right now. Language batches that touch those files — **23b, 25b, 26a** (dispatcher/formatter) and
  **24c** (descriptions) — run in lane H only after Lane A's **13** is merged. **24b** also waits for 13: Batch 13's
  `offset` plumbing needs `AgentNamespace.read` in `MCP/types.ts` (`types.ts:259`), which 24b also edits. Only
  22 → 23a → 24a (no Lane A file) run in H before 13. The plan's H order (22 → 23a → 23b → 24a → 24b → …) is
  re-sequenced to 22 → 23a → 24a → 24b → 23b → …; 24a and 24b depend only on 22, so no dependency is violated.
  If 24a turns out to need `MCP/types.ts` (`AstNamespace` return types, `types.ts:1041`), it too waits for 13.
- **D2 — Batch 21 pins vs 24c/27 (resolved sequential).** Lane A still owes 20.2 and 21 after 13. 21's sweep pins
  the total `tools/list` JSON size (+5%) and per-tool description budgets, which 24c changes. 24c starts only after
  21 merges and updates the sweep pin in the same batch when the regenerated descriptions exceed it (the sweep file is
  then listed in 24c). 27 also starts only after 21 merges and carries the plan's "+H rows" (new shapes into the
  sweep, new guards into the mandate manifest) itself: Lane A has finished by then, so there is no concurrent owner.
- **D3 — 32a under-declared (resolved sequential; footprint corrected).** 32a's FB ("two inline Rust modules keep
  separate scopePath") and its required fixtures (Rust inline modules, Java nested/static imports, C# nested
  namespaces) need the Rust and Java grammars from 30, and the plan puts `declarationQuery`/`extractImports` in each
  language module. 32a therefore depends on **30** as well as 29b, and its file list adds the five language modules
  it extends (`python`, `go`, `csharp`, `java`, `rust`) — 9 files, 1 lib. `java`/`rust` are G2-owned after the 30
  handoff, so there is no overlap with G1's 31.
- **D4 — 37b needs the matrix (resolved sequential).** 37b creates `activations/b37b.ts`, which is only meaningful
  (⊆ required keys, unique) once 27 has written `required-keys.ts`. 37b depends on 27 as well as 37a.
- **D5 — 36 split (≤ 6 files where possible).** Plan 36 is 10 files. Each resolver is independent (resolver + spec +
  language module + fragment = 4 files), so it becomes 36a PHP, 36b Ruby, 36c C/C++ in G2, each with its own fragment
  (`b36a.ts`, `b36b.ts`, `b36c.ts`). Gate 38 requires all three. `required-keys.ts` is unchanged (owners are not
  encoded in it). Other oversize batches keep the plan's justification: 24a (7; one field end to end), 29a1 (9; pure
  move), 29b (12; exhaustive union + outliner record must land together, r2-4), 30 (9), 31 (10), 30k (10), 37b (≥ 6
  - O2 files).
- **D6 — 27 FB base.** The plan says "on base 22 the honesty keys fail", but 27's base is its last dependency (26b /
  24c / 21), where the honesty fixes already exist, and 27 creates the harness. 27's FB is therefore a deliberate
  local revert (the 20.x precedent): revert one honesty fix (e.g. 23b's unsupported answer, 25b's clean-answer rule)
  and show the matching `honesty:<tool>` key failing, then restore. Evidence in the report.
- **D7 — vendored-asset path.** The plan names `assets/tree-sitter/tree-sitter-kotlin.wasm`; no `assets/` directory
  exists at `<WT>`. 28a's manifest must support a `vendored` row (repo-relative path + sha256 + licence file) and
  `copy-wasm.js` must sha256-check it (plan "Security notes"), proven by a `--self-test` negative even though no
  vendored row is active until 30k. 30k places the files at the path 28a's manifest defines.
- **D8 — 22 barrels.** 22 owns the `PC/index.ts` and `WI/index.ts` barrel edits; later batches that add exported
  symbols to the same barrels (23a `graph-coverage`, 25a provider, 37a runner) are all sequential behind 22 in
  H/K, never concurrent with another barrel edit. Stated per batch.
- **D9 — Hub-file disjointness check (parallel-marked pairs).** `tree-sitter.config.ts`: 22 (H) then 29a1 (G), serial.
  `dependency-graph.service.ts`: 23a (H) then 32b (G2), serial via 29b. `ast.types.ts` + `languages/index.ts` +
  `code-outliner.adapter.ts` + manifest: 29b (H) → 30 → 31 → 30k (G1), serial. `ast-analysis.service.ts`: 24a (H) then
  32a (G2), serial. `tree-sitter-parser.service.ts`: 24a then 29a2, serial. `analysis-namespace.builders.ts`: 23b, 29b,
  32c, all H. `register.ts` / `language-aware-diagnostics-provider.ts`: 25a then 37b, both H. Packaging scripts: P only
  (28a, 28b); 30k touches the manifest only. Concurrent pairs that remain (G1 30/31/30k ‖ G2 32a-36c ‖ H 32c/37b ‖ K 37a
  ‖ E 26b ‖ H 24c) were checked file by file and share no file.
- **D10 — Open gates are not batches.** O2 (go vet enable/revoke surfaces for Electron and the CLI, their files and
  tests) and O3 (Kotlin provenance: source URL, version, sha256, LICENSE text, load record) have no owner in the plan;
  the orchestrator must assign them (see "Orchestrator decisions").

### Plan validation (language batches)

Status: PASSED WITH RISKS

Assumptions:

- The analysis namespace deps lack `fileSystemProvider`; 23b adds it through `ptah-api-builder.service.ts` —
  unverified; Task 23b.1 checks the builder before editing (plan "Bounds")
- All six `@vscode/tree-sitter-wasm` 0.3.1 grammars load in `web-tree-sitter` 0.27.0 — verified by two probes (plan
  Summary 3); each grammar batch re-proves it in its real-grammar integration spec
- The Kotlin WASM load probe is not reproducible from this checkout — unverified; gate O3 on 30k
- `code-symbol-indexer.service.ts` is the sole writer of `code_symbols` (`:416`, `:482`) — verified by the plan;
  24b re-checks with a grep and records it
- Node names in the plan's query table are design, not proof — every grammar batch confirms them against the shipped
  WASM (C# precedent `tree-sitter.config.ts:236-240`)

| Risk                                                          | Severity | Mitigation                                                                       |
| ------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| Hub contention with Lane A (17 → 18 → 15 → 13, then 20.2, 21) | HIGH     | D1/D2 ordering; per-batch merge windows; post-merge re-run                       |
| Grammar memory (cpp ~20 MB, C# ~16 MB RSS)                    | HIGH     | 29a2 lazy per-language loading lands before any activation (30+)                 |
| Large synchronous parse                                       | HIGH     | 29a2 1 MiB `too-large` refusal                                                   |
| Polyglot graph build time / quadratic edges                   | HIGH     | 23a fair cap + limits; 32b per-import 200 / aggregate 250,000, disclosed         |
| Approximate graph used as proof of absence                    | HIGH     | 26b per-query narrowing gate with its eight tests                                |
| Wrong node names in queries                                   | HIGH     | real-grammar integration spec per grammar batch; fixed-key recall in fragments   |
| Coverage lost at a boundary                                   | HIGH     | 25b e2e, 27 dispatcher coverage spec                                             |
| Tier 1 trust (`go vet`)                                       | HIGH     | O2 gate, fail-closed consent, allowlisted env, hostile real-binary fixture (37a) |
| validate-deps false MISSING from query/fixture strings        | MEDIUM   | common check; concatenation rule                                                 |
| Index coverage vs live rows                                   | MEDIUM   | 24b live states + same-file overlap and 2,001st-update tests                     |
| Installed size +11.5 MB (+3.4 MB Kotlin)                      | MEDIUM   | 28a/28b record real artifact deltas                                              |
| CLI lane cap (3) exceeded at peaks                            | MEDIUM   | queueing table above                                                             |

Edge cases (carried by the named task):

- `.py` file in `ptah_get_dependents` → `unsupported-language`, not `count:0` — Task 23b.2
- File outside the graph → `fileInGraph:false` + coverage — Task 23b.2
- Vendor tree larger than the census limit sorted before real code → code still discovered — Task 23b.1
- `.kt` reindex → `UnsupportedLanguageAnswer`, no delete, no count (until 30k activates Kotlin `codeIndex`) — Task 24b.2
- Search during a run → `updating`; after an abort → `incomplete`; new host session → `census:'unknown'` — Task 24b.1
- Scoped diagnostics with 51 syntax-only files → 1 `omittedByCap`; unscoped Python → `unchecked` — Task 25a.2
- Mixed TS/Python repo never prints a bare "No issues found" — Task 25b.1
- No-host LSP → `mechanism:'none'`, "not available on this host" — Task 26a.1
- `.c`/`.h` → `cpp` with `c:parsed-as-cpp` approximation — Task 31.3, 36c
- `getStorageForWorkspace(root)` → `undefined` → consent denied, no fallback — Task 37a.1 / 37b.2
- Multi-root merge with a `null` count → `null` sum; `census`/`state` take the worst — Task 23b.2

### Orchestrator decisions

- O2 (gates 37a): assign an author for the short consent-surface amendment (software-architect is the natural
  owner) and a cross-side reviewer. It can run any time before 25a merges so 37a is not idle-blocked
- O3 (gates 30k): assign someone to produce the Kotlin provenance record (researcher-expert) before 31 completes
- Defaults recorded here (execution preferences from the plan): lanes as in the table above; D1-D5 ordering; 36
  split. If the orchestrator prefers the plan's literal 36 as one batch, merge 36a-c back and keep the single fragment
  `b36.ts`; nothing else changes
- **Decided by the orchestrator (2026-09-26):** keep the 36a/36b/36c split. O2 (consent-surface amendment) and O3
  (Kotlin provenance record) are both written by the **software-architect** as prerequisite documents: O2 before 37a
  starts, O3 before 30k starts. Each is cross-side reviewed before the batch it gates begins

---

## Batch 22: Coverage contract + language registry — COMPLETE (lane commit 186ba8cde, merged 96f9a5553)

- Recommended executor: backend-developer (sub-agent), Lane H (`task-559-lane-h`)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: type-only contract plus a registry with separate capabilities; two libs, six files, no hub file shared with Lane A
- Review: Codex CLI lane (logic + structure)
- Tasks: 2 | Depends on: none (base: integration tip; file-disjoint from uncommitted Batch 17)

### Task 22.1: `LanguageCoverage` contract and barrel — COMPLETE

- Files: `PC/interfaces/language-coverage.interface.ts` (new), `PC/index.ts`
- Plan reference: implementation-plan-languages.md "Coverage contract (Batch 22)", "Closed vocabularies", "Size", "Clean answer rule"
- Pattern to follow: `PC/interfaces/diagnostics-provider.interface.ts` (type-only interface + barrel export)
- Quality requirements: `Count`, `LanguageCoverage`, `UnsupportedLanguageAnswer`, `LanguageId` (12 ids; no `c`), `RecognisedLanguageId` (9), `FailureReason` (5), `Approximation` (priority-ordered), saturation constant 9,999,999, and a pure `isCleanAnswer(coverage)` helper implementing the five-condition rule. Type-only apart from constants and that pure helper (platform-core is `scope:shared,type:util`)
- Validation notes: RISK size — worst case asserted ≤ 1,000 chars; the serialised worst-case fixture is committed and its measured length recorded (r3 finding 2: 920 measured, not a universal max). Approximation overflow keeps four by priority and discloses the rest via `approximationsOmitted`
- Implementation details: one exported priority array drives the overflow rule; `unknown` census never clean

### Task 22.2: Language registry with separate capabilities — COMPLETE

- Depends on: Task 22.1
- Files: `WI/ast/language-registry.ts` (new), `WI/ast/language-registry.spec.ts` (new), `WI/ast/tree-sitter.config.ts`, `WI/index.ts`
- Plan reference: "Coverage contract" → "Registry"
- Pattern to follow: `WI/ast/tree-sitter.config.ts:4-15` (`EXTENSION_LANGUAGE_MAP`)
- Quality requirements: each language `{ id, extensions, grammarFile | null, capabilities }` with `parse`, `outline`, `enrichSummary`, `codeIndex`, `publicSymbols`, `graphEdges`, `definitionFallback`, `syntaxDiagnostics` kept separate. Initial values: `codeIndex` js/ts/py/go/cs; `publicSymbols`/`graphEdges` js/ts only; `syntaxDiagnostics` py/go/cs. Recognised-unsupported extensions (swift, scala, dart, elixir, lua, haskell, clojure, objc, r) map to `RecognisedLanguageId`
- Validation notes: FB — `language-registry.spec.ts` "worst-case coverage ≤ 1,000 chars" and "codeIndex and publicSymbols are separate" fail on the base (files absent / no registry). No behaviour change for existing callers
- Implementation details: registry derives from the config maps so existing specs stay green unchanged; WI barrel exports the registry

### Batch 22 verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/platform-core @ptah-extension/workspace-intelligence --skip-nx-cache 2>&1 | tail -40` passes
- `nx run ptah-electron:validate-deps --skip-nx-cache` passes; `nx run degradation-audit:lint --skip-nx-cache` → TOTAL 300; other common checks
- FB evidence in the report; the Codex review lane approves

### Batch 22 record (Lane H)

- Tasks 22.1 and 22.2 COMPLETE; details in `batch-22-executor-report.md` (initial, revision rounds 1-2, orchestrator
  ruling, bounded post-cap correction). Lane commit **186ba8cde**, merged into this branch as **96f9a5553** (no
  conflicts)
- Review history: r1 REVISE 6/10 (common source extensions disappeared; grammar guard compared the wrong mapping) →
  r2 REVISE 6/10 (`.mdx`, `CMakeLists.txt` misclassified as non-source) → r3 REVISE 6/10 (artefacts and checksum files
  landed in `unrecognised`) → r4-postcap APPROVE 8/10 (`reviews/batch-22-code-logic-review-r1..r3.md`,
  `-r4-postcap.md`)
- Orchestrator rulings: unknown/`null` is never clean (`isCleanAnswer` requires `unrecognised === 0`; a census tool
  always sets a number; unknown extensions default to `unrecognised`); non-source files never qualify an answer, via
  a new disjoint `nonSource` bucket (deviation from the ruling's "excluded" wording, accepted); ordinary artefacts
  (pdf, archives/packages, compiled binaries/bytecode, `.wasm`, `.map`) and lock/checksum files (`go.sum`,
  `go.work.sum`, `*.lock`, `package-lock.json`, `pnpm-lock.yaml`) are `nonSource`; SVG stays unrecognised (can embed
  `<script>`); `.mdx` stays unrecognised; code base names (`CMakeLists.txt`, `build.xml`) outrank extensions
- Size: worst-case serialised coverage pinned at 965 chars (≤ 1,000)
- Integration verification after merge (2026-09-26, `--skip-nx-cache`): vscode-lm-tools, workspace-intelligence,
  platform-core test/lint/typecheck pass; ptah-extension-vscode/ptah-electron/ptah-cli lint/typecheck pass;
  validate-deps pass; degradation-audit TOTAL 300

---

## Batch 23a: Graph accounting, bounds, atomic publish — COMPLETE with known issues carried to 23b (lane commit 4af7d3eba, merged 130b9453d)

- Batch 24r (unplanned; coverage verdicts `clean` + `reasons` survive reduction): COMMITTED on Lane H, not merged (54e9c4b08)

- Recommended executor: backend-developer (sub-agent), Lane H
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: graph coverage must publish atomically with the graph under the generation guard; one lib, four files
- Review: Codex CLI lane
- Tasks: 2 | Depends on: Batch 22

### Task 23a.1: `graph-coverage` accounting module — COMPLETE

- Files: `WI/ast/graph-coverage.ts` (new), `WI/ast/graph-coverage.spec.ts` (new)
- Plan reference: "Dependency graphs" → "Bounds"; "Coverage contract" → "Multi-root merge"
- Pattern to follow: pure helpers in `WI/ast/tree-sitter.config.ts`
- Quality requirements: eligible-only parse cap 5,000 round-robin per language in stable path order (`omittedByCap`); resolution counts (`external`, `unresolvedInternal`, `truncatedImports`, `edgeCapHit`, `context`); saturating sums; multi-root merge (null-poisoning, worst `census`/`state`, unions, OR/partial)
- Validation notes: FB "cap does not starve the second language"
- Implementation details: WI barrel export added only if a consumer outside `ast/` needs it (D8)

### Task 23a.2: Publish coverage with the graph — COMPLETE

- Depends on: Task 23a.1
- Files: `WI/ast/dependency-graph.service.ts`, `WI/ast/dependency-graph.service.spec.ts`
- Plan reference: "Atomicity"; codebase evidence `dependency-graph.service.ts:231, :238, :339-344, :435-451`
- Pattern to follow: existing `publish()` generation guard
- Quality requirements: aggregate edge cap 250,000 → `edgeCapHit:true` and linking stops; a superseded build publishes neither graph nor coverage; parse failures counted by reason; Batch 9/9b field meanings unchanged
- Validation notes: FB "edge cap is disclosed", "superseded build publishes neither". Batch 9b background-build specs stay green unchanged
- Implementation details: coverage stored beside the graph; getter returns both from one generation

### Batch 23a verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence --skip-nx-cache 2>&1 | tail -40` passes
- validate-deps passes; degradation audit TOTAL 300; other common checks
- FB evidence; Codex review approves (not reached — committed under User Decision 20, see below)

### Batch 23a review history and outcome

- Executed in Lane H (`fix/task-559-lane-h`); details: `batch-23a-executor-report.md` (initial, rounds 1-2, bounded
  post-cap correction)
- r1 REVISE 5/10 (invalidation left clean coverage; a supplied `paths` object certified resolution) → fixed;
  r2 REVISE 6/10 (R2-B1 cached ancestor graphs missed by invalidation) → fixed; r3 REVISE 6/10 (R3-B1 lexical
  containment misses equivalent Windows/linked paths) → bounded post-cap correction (one path identity);
  r4-postcap REVISE 6/10 (`reviews/batch-23a-code-logic-review-r1.md` … `-r4-postcap.md`)
- User Decision 20 (context.md): commit 23a now; R4-B1 (case-variant query path returns `[]` with clean coverage) and
  R4-M1 (root realpath failure drops junction identity silently) are acceptance criteria of Batch 23b — see
  "Batch 23b carried acceptance criteria"
- Lane commit **4af7d3eba**; merged into this branch as **130b9453d** (`--no-ff`, no conflicts). Post-merge
  integration: see Batch 24a

---

## Batch 24a: Parse status; ast sub-operations — COMPLETE with known issue KI-24a-1 (lane commit a45cdd96d, merged de6f56118)

- Recommended executor: backend-developer (sub-agent), Lane H
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: one field (`parseStatus`) carried end to end from the parser to the MCP namespace; 7 files / 2 libs justified by the plan. Runs before Lane A 13 (no Lane A file) unless it needs `MCP/types.ts` (D1)
- Review: Codex CLI lane
- Tasks: 2 | Depends on: Batch 22

### Task 24a.1: `parseStatus` in the parser and analysis service — COMPLETE

- Files: `WI/ast/ast-analysis.interfaces.ts`, `WI/ast/tree-sitter-parser.service.ts`, `WI/ast/tree-sitter-parser.service.spec.ts`, `WI/ast/ast-analysis.service.ts`, `WI/ast/ast-analysis.service.spec.ts`
- Plan reference: Inventory rows `ptah_ast_analyze`; "Extraction contract" (the 24a parse fields)
- Pattern to follow: existing `CodeInsights` fields
- Quality requirements: a tree with ERROR/MISSING nodes → `recovered` (never reported clean); clean → `ok`; counts of error nodes bounded
- Validation notes: FB "recovered parse not reported clean" (a `.tsx` file with JSX parsed by the TS grammar)
- Implementation details: status computed once per parse

### Task 24a.2: `queryExports` without `publicSymbols` errors — COMPLETE

- Depends on: Task 24a.1
- Files: `MCP/namespace-builders/ast-namespace.builder.ts`, `MCP/namespace-builders/ast-namespace.builder.spec.ts`
- Plan reference: codebase evidence `ast-namespace.builder.ts:170-183, :223-231`
- Pattern to follow: the existing unsupported-language error at `ast-namespace.builder.ts:223-231`
- Quality requirements: `ast.queryExports` on a language whose registry entry lacks `publicSymbols` returns an error naming the language and the supported set, not `[]`; `parseStatus` surfaced in the analyze result
- Validation notes: FB "python queryExports is not a silent []". If the return type change needs `MCP/types.ts` (`AstNamespace`), stop and report: the batch then waits for Lane A 13 (D1)
- Implementation details: capability read from the registry, not a hand list

### Batch 24a verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache 2>&1 | tail -40` passes
- validate-deps passes; degradation audit TOTAL 300; other common checks
- FB evidence; Codex review approves

### Batch 24a review history and integration

- Executed in Lane I (`fix/task-559-lane-i`) by a Codex CLI author; reviewed by a Claude code-logic-reviewer:
  r1 APPROVE 8/10 (`reviews/batch-24a-code-logic-review-r1.md`). Details: `batch-24a-executor-report.md`
- Coordinated handoff: its only `types.ts` change is the `AstCodeInsights` hunk; it auto-merged with Batch 13's
  `types.ts` changes (no conflict)
- Lane commit **a45cdd96d**; merged as **de6f56118** (`--no-ff`). Post-merge integration (after 13, 23a, 24a):
  `nx run-many "-t=test,lint,typecheck"` for vscode-lm-tools, workspace-intelligence, platform-core,
  cli-agent-runtime, shared (`--skip-nx-cache`) → 15 tasks pass; `ptah-cli`/`ptah-electron` typecheck pass;
  validate-deps pass; degradation-audit TOTAL 300
- **KI-24a-1** (r1 Moderate): `parseQuality` (`tree-sitter-parser.service.ts:70-79`) checks the 20-error cap only
  between pops, so one ERROR node with a very wide flat child list enqueues all children in one generation. Fix: check
  the cap inside the child-push loop
- r1 M2 "parse/queryFunctions/queryClasses/queryImports carry no honesty signal on recovered parses" → acceptance
  criterion of Batch 24c and on the Batch 38 gate list

---

## Batch 24b: Code index live coverage — COMMITTED on Lane H, not merged (efea46119)

- Recommended executor: backend-developer (sub-agent), Lane H
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: live state (`updating`/`current`/`incomplete`) instead of a last-run snapshot (r2-9, r3 edit 6). **Gate: Lane A Batch 13 merged** (shared `MCP/types.ts`, D1)
- Review: Codex CLI lane
- Tasks: 2 | Depends on: Batch 22, Lane A Batch 13 merged

### Task 24b.1: Indexer accounting and live state — PENDING

- Files: `WI/services/code-symbol-indexer.service.ts`, `WI/services/code-symbol-indexer.service.spec.ts`
- Plan reference: "Code symbol tools (24b)"
- Pattern to follow: existing run loop `code-symbol-indexer.service.ts:203-234`
- Quality requirements: extensions from `codeIndex`; vendor + skip filters before the eligible-only 2,000 stop; buckets `analyzed`/`failed` by reason/`unsupported`/`omittedByCap`; `beginRun(root)` synchronous before any write (including from `startBackgroundRun`); success → `current`; abort/failure → `incomplete` until a successful run; per-file writes during a run folded into that run's accounting or the run ends `incomplete`; outside a run a per-file record (`Map<file,bucket>`, ≤ 2,000) never promotes `unknown`/`incomplete`; past 2,000 → `truncated`, disclosed; new host session → `census:'unknown'`, no `state`
- Validation notes: FB "search during a run reports updating". Required tests: same-file overlap (per-file reindex racing a full-run write), 2,001st distinct per-file update, search after abort → `incomplete`. Re-verify by grep that the indexer is the only `code_symbols` writer and record it
- Implementation details: no SQLite snapshot claim

### Task 24b.2: Namespace shapes and unsupported answers — PENDING

- Depends on: Task 24b.1
- Files: `MCP/namespace-builders/code-namespace.builder.ts`, `MCP/namespace-builders/code-namespace.builder.spec.ts`, `MCP/types.ts`
- Plan reference: "Code symbol tools" → "Shapes"
- Pattern to follow: Batch 6 lazy-reindex fields in `code-namespace.builder.ts:184-220`
- Quality requirements: search → `{ index, coverage, bm25Only, hits }` with coverage before hits; search with a `filePath` in an unsupported language or a reindex of an unsupported file → `UnsupportedLanguageAnswer`, no delete, no count; Python stays searchable while Python `queryExports` errors
- Validation notes: FB "kt reindex is not filesScanned 1". Batch 6 fire-and-forget rule (no await of the full run) unchanged
- Implementation details: `beginRun` called before `startBackgroundRun` returns

### Batch 24b verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache 2>&1 | tail -40` passes
- validate-deps passes; degradation audit TOTAL 300; other common checks
- FB evidence; Codex review approves

---

## Batch 23b: Graph tools answer honestly; bounded discovery — COMMITTED on Lane H, not merged (41ed73395; R5-B1/R5-M1 carried to 25a, User Decision 23)

- Recommended executor: backend-developer (sub-agent), Lane H
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: dispatcher hub batch. **Gate: Lane A Batch 13 merged** (D1: `protocol-dispatcher.ts`)
- Review: Codex CLI lane
- Tasks: 2 | Depends on: Batch 23a, Batch 24b (lane order), Lane A Batch 13 merged

### Task 23b.1: `discoverSourceFiles` with vendor excludes inside the walk — PENDING

- Files: `MCP/namespace-builders/analysis-namespace.builders.ts`, `MCP/namespace-builders/analysis-namespace.builders.spec.ts`, `MCP/types.ts`, `MCP/ptah-api-builder.service.ts`
- Plan reference: "Bounds" (Discovery row); codebase evidence `core-namespace.builders.ts:149-159`, `file-system-provider.interface.ts:106-113`
- Pattern to follow: `core-namespace.builders.ts:149-159` `findFiles` call
- Quality requirements: `ptah.dependencies.discoverSourceFiles(root, limit)` → `findFiles(glob, [...DEFAULT_WORKSPACE_EXCLUDES, ...GRAPH_VENDOR_EXCLUDES], 50_001, root)`; the nine vendor globs; `census:'truncated'` at 50,001; `excluded:null`
- Validation notes: ASSUMPTION — check `ptah-api-builder.service.ts` for `fileSystemProvider` in the analysis deps before editing. FB "vendor tree does not exhaust discovery"
- Implementation details: recognised-unsupported extensions counted through the same bounded call

### Task 23b.2: Dispatcher answers with coverage — PENDING

- Depends on: Task 23b.1
- Files: `MCP/mcp-core/protocol-dispatcher.ts`, `MCP/mcp-core/protocol-dispatcher.spec.ts`
- Plan reference: Inventory rows `ptah_get_dependents`/`_dependencies`/`ptah_get_symbol_index`; "Placement"; "Multi-root merge"
- Pattern to follow: Batch 9 field order at `protocol-dispatcher.ts:2005-2012`; `building`/`failed` handling `:2731-2761`
- Quality requirements: `.py` (unsupported) → `unsupported-language` answer; `fileInGraph`; `coverage` after the Batch 9 status fields and before `file`/lists; symbol-index paginator carries coverage in its header; multi-root merge; discovery glob `:2679-2693` replaced by `discoverSourceFiles`
- Validation notes: FB "dependents of a python file is not a silent empty list"; a very long path + oversized list keeps `coverage` inside the budget cut (Decision 15 pattern). No `from "<word>"` in messages
- Implementation details: `building` stays success, `failed` stays error

### Batch 23b carried acceptance criteria (User Decision 20)

- R4-B1 (from `reviews/batch-23a-code-logic-review-r4-postcap.md`, pre-existing Batch 9b follow-up): graph queries
  (`ptah_get_dependents`, `ptah_get_dependencies`, `ptah_get_symbol_index` `pathPrefix`) resolve relative and absolute
  query paths through the Batch 23a canonical path identity, so a Windows case-variant spelling returns the same
  answer as the matching-case spelling — never `[]` with clean coverage. Spec: the r4 case-variant probe (fails before)
- R4-M1: a root `realpath` failure (e.g. EIO) that drops the junction identity is disclosed in coverage (not clean),
  never silent. Spec: the r4 injected-EIO probe (fails before)
- The 23b review verifies both with the r4 probes

### Batch 23b verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/vscode-lm-tools --skip-nx-cache 2>&1 | tail -40` passes
- validate-deps passes; degradation audit TOTAL 300; other common checks
- FB evidence; Codex review approves

---

## Batch 25a: Diagnostics contract + language-aware provider — implemented on Lane H, unreviewed, uncommitted

- Recommended executor: backend-developer (sub-agent), Lane H
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: Tier 0 syntax-only checks behind the floor-rule amendment; wraps the TS provider once at the registration point
- Review: Codex CLI lane
- Tasks: 2 | Depends on: Batches 22, 23a, 23b (bounded `discoverSourceFiles`)

### Task 25a.1: Contract amendment — PENDING

- Files: `PC/interfaces/diagnostics-provider.interface.ts`, `PC/testing/contracts/run-diagnostics-provider-contract.ts`
- Plan reference: "Diagnostics" → "25a contract"
- Pattern to follow: Batch 19 contract case in the same file
- Quality requirements: `coverage` on both arms; floor rule governs type-check claims only; syntax-only languages named in `checks`/`approximations`; contract case "syntax-only is not a type-check claim"
- Validation notes: FB is that contract case (fails on base: no syntax-only concept)
- Implementation details: existing providers remain contract-compliant (coverage optional where the provider cannot know)

### Task 25a.2: `LanguageAwareDiagnosticsProvider` — PENDING

- Depends on: Task 25a.1
- Files: `WI/diagnostics/language-aware-diagnostics-provider.ts` (new), `WI/diagnostics/language-aware-diagnostics-provider.spec.ts` (new), `WI/di/register.ts`
- Plan reference: "25a provider"; codebase evidence `register.ts:80-93`, `type-script-diagnostics-provider.ts:504-508`
- Pattern to follow: registration at `WI/di/register.ts:80-93` (function name kept)
- Quality requirements: scoped TS/JS → TS provider (`analyzed:null`, type-check); other grammar languages → syntax check ≤ 50 files (51+ `omittedByCap`), ≤ 1 MiB/file, ≤ 20 ERROR/MISSING per file; unscoped → no syntax scan, syntax-capable files `unchecked` with "pass files", others `unsupported`; census from the graph build if present else one bounded `discoverSourceFiles`, cached per root and dropped by `invalidate`; no tsconfig → `unavailable` with coverage
- Validation notes: edge cases 51 files → 1 omitted; unscoped Python → `unchecked`. Batch 19 lanes and `withBudget` behaviour untouched. WI barrel export only if needed (D8)
- Implementation details: nothing spawned (Tier 0)

### Batch 25a carried acceptance criteria (User Decision 23)

- R5-B1 (from `reviews/batch-23b-code-logic-review-r5-final.md` in Lane H, pre-existing): an UNLIMITED `findFiles`
  bypasses the 23b root validation — `indexWorkspace` (and any unlimited caller) with a missing/unreadable root
  returns a successful zero-file result. Apply the same root check to the unlimited path in both adapters (CLI,
  Electron) and make the census unknown/never clean. Spec: the r5 probe (fails before)
- R5-M1: a root renamed between `stat` and `opendir` suppresses the root ENOENT and publishes a clean graph — treat a
  root-level ENOENT during the walk as a root failure (unknown, never clean). Spec: the r5 rename-race probe
- The 25a review verifies both with the r5 probes

### Batch 25a verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/platform-core @ptah-extension/workspace-intelligence --skip-nx-cache 2>&1 | tail -40` passes
- validate-deps passes; degradation audit TOTAL 300; other common checks
- FB evidence; Codex review approves

---

## Batch 25b: Diagnostics forwarding + end-to-end — PENDING

- Recommended executor: backend-developer (sub-agent), Lane H
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: formatter hub (D1: after Lane A 13); the e2e spec proves coverage survives every boundary
- Review: Codex CLI lane
- Tasks: 2 | Depends on: Batch 25a

### Task 25b.1: Forward coverage; clean-answer rendering — PENDING

- Files: `MCP/namespace-builders/core-namespace.builders.ts`, `MCP/namespace-builders/core-namespace.builders.spec.ts`, `MCP/types.ts`, `MCP/mcp-core/mcp-response-formatter.ts`, `MCP/mcp-core/mcp-response-formatter.spec.ts`
- Plan reference: "25b forwarding and rendering"; codebase evidence `core-namespace.builders.ts:225-231, :254-259`, `mcp-response-formatter.ts:515-520`
- Pattern to follow: Batch 1 requested-file ordering in the formatter
- Quality requirements: `DiagnosticsPayload.coverage` forwarded on both arms; bare "No issues found" only under the clean-answer rule; VS Code `provider-defined`, `analyzed:null`
- Validation notes: FB "mixed repo never prints a bare No issues found". Diagnostics stay `preformatted` (not reduced; Batch 2e)
- Implementation details: qualifier text names the qualifier

### Task 25b.2: End-to-end spec — PENDING

- Depends on: Task 25b.1
- Files: `MCP/mcp-core/diagnostics-coverage.e2e.spec.ts` (new)
- Plan reference: "25b" end-to-end spec
- Pattern to follow: `protocol-dispatcher.spec.ts` fake `PtahAPI` setup
- Quality requirements: real provider (fake inner TS provider) → real namespace → real dispatcher → formatter on a mixed TS/Python workspace; cases empty, non-empty, `getErrors`, long result through the budget, Batch 1 requested-file order
- Validation notes: builds fixtures without `import "x"` shapes (validate-deps)
- Implementation details: temp-dir fixture, cleaned up

### Batch 25b verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/vscode-lm-tools --skip-nx-cache 2>&1 | tail -40` passes
- validate-deps passes; degradation audit TOTAL 300; other common checks
- FB evidence; Codex review approves

---

## Batch 26a: LSP report contract + forwarding — PENDING

- Recommended executor: backend-developer (sub-agent), Lane H
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: dispatcher + formatter hub (D1); gives 26b the report shape to implement
- Review: Codex CLI lane
- Tasks: 2 | Depends on: Batch 25b

### Task 26a.1: Report methods on the IDE capability contract — PENDING

- Files: `MCP/namespace-builders/ide-namespace.builder.ts`, `MCP/namespace-builders/ide-namespace.builder.spec.ts`, `MCP/types.ts`
- Plan reference: "LSP honesty" → 26a; codebase evidence `ide-namespace.builder.ts:42-56, :214-222, :345-352`
- Pattern to follow: existing optional capability methods
- Quality requirements: optional `getDefinitionReport?`/`getReferencesReport?` → `{ locations, mechanism, language, languageSupported, approximations, truncated? }`; `LSPNamespace` forwards both, preferring the report; array APIs stay; no host → `mechanism:'none'`
- Validation notes: FB "no-host definitions are not Found: 0"
- Implementation details: none beyond the plan

### Task 26a.2: Dispatcher and formatter rendering — PENDING

- Depends on: Task 26a.1
- Files: `MCP/mcp-core/protocol-dispatcher.ts`, `MCP/mcp-core/protocol-dispatcher.spec.ts`, `MCP/mcp-core/mcp-response-formatter.ts`
- Plan reference: 26a
- Pattern to follow: Batch 8 LSP rendering
- Quality requirements: `mechanism:'none'` renders "not available on this host"; mechanism and approximations shown before locations
- Validation notes: no `from "<word>"` in messages
- Implementation details: specs in `protocol-dispatcher.spec.ts`

### Batch 26a verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/vscode-lm-tools --skip-nx-cache 2>&1 | tail -40` passes
- validate-deps passes; degradation audit TOTAL 300; other common checks
- FB evidence; Codex review approves

---

## Batch 26b: Electron report, C# fallback, narrowing gate — PENDING

- Recommended executor: Antigravity CLI lane, Lane E (`task-559-lane-e`, branched after 26a merges)
- Fallback executor: backend-developer (sub-agent)
- Execution mode: sequential (one app file + its spec; runs concurrently with H 24c and K 37a — no shared file)
- Rationale: one Electron file with a self-contained contract from 26a; good fit for a single CLI lane prompt
- Review: Claude `code-logic-reviewer` subagent
- Tasks: 2 | Depends on: Batches 26a, 23b

### Task 26b.1: Report methods; scan extensions; C# fallback — PENDING

- Files: `<WT>/apps/ptah-electron/src/services/electron-ide-capabilities.ts`, `<WT>/apps/ptah-electron/src/services/electron-ide-capabilities.spec.ts`
- Plan reference: "LSP honesty" → 26b; codebase evidence `Electron:72-93, :153, :459-460, :632-667, :683-685`
- Pattern to follow: Batch 8 fallback in the same file
- Quality requirements: implement both report methods; scan extensions from all recognised source extensions (registry); C# `DECLARATION_QUERIES`/`COMMENT_STRING_QUERIES`; `definitionFallback` for C# set only when the real-grammar spec passes; brute-scan caps reported as `truncated`
- Validation notes: node names proven against the shipped C# WASM
- Implementation details: none beyond the plan

### Task 26b.2: Per-query narrowing gate — PENDING

- Depends on: Task 26b.1
- Files: same two files
- Plan reference: 26b "Narrowing gate"
- Pattern to follow: n/a
- Quality requirements: narrow only when every census language has `referenceScopeComplete:true`, graph coverage passes the clean-answer rule incl. `resolution`, and the declaration files are in the graph; otherwise brute scan with `text-scan`
- Validation notes: FB "complete-census graph with edgeCapHit is not used to narrow". Required tests: complete census with `edgeCapHit`; TS declaration imported by a Python file; vendor tree beyond the census limit sorted first; C# same-namespace references; Java same-package references; capped graph; Kotlin scan; no-host CLI
- Implementation details: none beyond the plan

### Batch 26b verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p ptah-electron --skip-nx-cache 2>&1 | tail -40` passes
- validate-deps passes; degradation audit TOTAL 300; other common checks
- FB evidence; the Claude reviewer approves

---

## Batch 22c: Compact coverage block — COMMITTED on Lane H, not merged (eec17be89) (added 2026-09-27, User Decision 21)

- Recommended executor: backend-developer (sub-agent), Lane H after Batch 23b; review: Codex CLI lane
- Rationale: the coverage block (Batch 22 / 24r, up to ~1,000 chars) made small `get_dependents` answers larger than a
  fair grep (Batch 20.2 bounded correction: ~370-380 vs ~316-322 tokens on a 4-dependent answer)
- Depends on: Batch 24r (contract with `clean` + `reasons`), Batch 23b
- Files: platform-core coverage contract + its specs; the serializers/formatters of the language-bound tools only if
  they build the block themselves (prefer one serializer in the contract)
- Quality requirements: a clean answer serialises as `{clean: true, analyzed: N}` only; a qualified answer as
  `clean: false`, `reasons`, and only the non-zero buckets — zero/empty buckets omitted, `null` (unknown) buckets
  always kept (unknown must stay visible); `isCleanAnswer` semantics unchanged; Batch 24r `preserveKeys` still
  keeps the block verbatim; the worst case stays ≤ 1,000 chars; a small-answer spec asserts the coverage overhead of
  a clean answer ≤ a fixed cap (e.g. 40 tokens) and of a typical qualified answer ≤ a fixed cap (e.g. 120 tokens),
  measured with the real tokenizer; every consumer spec that pinned the old full shape is updated, not weakened
- Verification: scoped test/lint/typecheck (platform-core, workspace-intelligence, vscode-lm-tools,
  tool-output-reducers), validate-deps, degradation-audit TOTAL 300; re-run the Batch 20.2 bench after merge
- Lane H merge: the platform-core coverage contract has two changes to combine — 24r (`clean` + `reasons`) and
  20.2q (`unsupported-syntax` reason); after the merge convert the pending test "pending Batch 24r: preserved
  coverage survives reduction" (`mcp-contract.bench.spec.ts:416`) into a real test. Per the r5 merge note: a clean
  parse with `unextractedExports` must map to `clean: false` plus the reason; reconcile the 994-char old-shape pin
  (`language-registry.spec.ts:153`) with the compact shape rather than picking a side; rerun the dependents /
  symbol-index SIZE guards on the merged envelopes

---

## Batch 24d: Code index records every TS/JS export kind — PENDING (added 2026-09-27, orchestrator)

- Recommended executor: backend-developer (sub-agent); review: Codex CLI lane
- Rationale: the Batch 20.2 r3 review (`reviews/batch-20b-code-logic-review-r3.md`) measured that the code-symbol
  index reads only functions and classes, so `code_search_symbols` misses interfaces, type aliases, enums, variable
  exports, default exports and re-exports that a native grep finds — a recall loss against the task's contract.
  Batch 20.2q fixes the shared export query and the ast/symbol-index decoders but deliberately does not touch the
  indexer (Lane H changed it in Batch 24b)
- Depends on: Batch 20.2q committed and Lane H (24b) merged into the task branch
- Files: the code-symbol indexer / sink (workspace-intelligence `workspace-indexer.service.ts` and the code-symbol
  extraction it uses; memory-curator `code-symbol.store` only if the kind column needs new values) + specs
- Quality requirements: the index records every export kind 20.2q extracts (kind column preserved; exact-name recall
  of Batch 5 unchanged; coverage/freshness of Batch 24b unchanged); spec: index the fixture and the three real files
  from the r3 review, then `code_search_symbols` finds every exported name an independent grep census finds; the
  spec fails before the change. Also check the Batch 2d code-outline reducer's separate queries for the same export
  kinds and fix them in this batch if they miss any (the outline must not hide exported interfaces/types)
- Verification: scoped test/lint/typecheck (workspace-intelligence, memory-curator if touched, vscode-lm-tools),
  validate-deps, degradation-audit TOTAL 300

### Carried acceptance criteria (User Decision 22)

From `reviews/batch-20b-code-logic-review-r5-final.md` (Batch 20.2 committed with these open; `WI` =
`libs/backend/workspace-intelligence/src`, `LM` = `libs/backend/vscode-lm-tools/src/lib`):

- **R5-01 (Blocking)** — graph, symbol-index and `queryExports` discard `unextractedExports`: a file with
  `exports[key] = 1` vanishes from the symbol index and the graph counts it analyzed/clean. Sites:
  `WI/ast/dependency-graph.service.ts:599-609,439-443,842`; `LM/code-execution/namespace-builders/ast-namespace.builder.ts:208`;
  `LM/code-execution/namespace-builders/analysis-namespace.builders.ts:339-350`;
  `LM/code-execution/mcp-core/protocol-dispatcher.ts:2219-2242,2842`. Carry the disclosure (reason
  `unsupported-syntax`) through graph publication and coverage into symbol-index responses, including empty pages;
  `queryExports` must not return an unqualified array for a partial extraction. Test empty and mixed files after 24r
- **R5-02 (Blocking)** — `module["exports"].x = 1` evades the CommonJS gap detector; `ast_analyze` answers
  clean-empty. Sites: `WI/ast/tree-sitter.config.ts:218-269`; `WI/ast/export-extraction.ts:275-287`;
  `LM/code-execution/namespace-builders/ast-namespace.builder.ts:228-254`. Recognise constant-string bracket access
  (or disclose it as unsupported); real TS and JS tests assert it never yields clean-empty
- **R5-03 (Moderate)** — quoted-alias escapes stay source text: `export {a as "x-y"}` yields `x-y`, not
  `x-y`. Site: `WI/ast/export-extraction.ts:301-310` (`nameOf`). Decode string-literal escapes (or qualify the
  form); cover escaped aliases and `Object.defineProperty` names
- The 24d review verifies them with the r5 probes (r5 "Independent probe evidence" table)

---

## Batch 24c: Registry-generated descriptions — PENDING

- Recommended executor: backend-developer (sub-agent), Lane H
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: `tool-description.builder.ts` hub (D1); **gate: Lane A Batch 21 merged** (D2: sweep pins)
- Review: Codex CLI lane
- Tasks: 1 | Depends on: Batch 26a, Lane A Batches 13 and 21 merged

### Task 24c.1: `languagesNote(capability)` in per-tool descriptions — PENDING

- Files: `MCP/mcp-core/tool-description.builder.ts`, `MCP/mcp-core/tool-description.builder.spec.ts`; conditional: `MCP/mcp-core/mcp-contract.sweep.spec.ts` (only to re-measure the pinned `tools/list` size, with date, if the new text exceeds it)
- Plan reference: "Descriptions (24c)"
- Pattern to follow: Batch 16 growth guard; `tool-description.builder.spec.ts:25`
- Quality requirements: each language-bound tool's language list is generated from the registry; descriptions distinguish the SQLite code index from the graph export index and name the host mechanisms. Per-tool descriptions only (Decision 4)
- Validation notes: FB "description language list equals registry". Shared prompt constants unchanged
- Implementation details: per-tool description budgets from 21.1 still hold

### Batch 24c carried acceptance criterion (from Batch 24a r1 M2)

- `ast.parse`, `ast.queryFunctions`, `ast.queryClasses` and `ast.queryImports` carry the parse honesty signal
  (`parseStatus`/coverage, as `analyze` does since 24a) on a recovered parse — never a clean-looking result. Adds
  `MCP/namespace-builders/ast-namespace.builder.ts` + spec (and the parser service only if a signal is missing there).
  Spec: a `.tsx` JSX file parsed by the TS grammar reports `recovered` on each of the four operations (fails before).
  Placed here, not 24b, because 24b is already at 5 files and this keeps both batches within the 6-file cap. The 24c
  review verifies it

### Batch 24c verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/vscode-lm-tools --skip-nx-cache 2>&1 | tail -40` passes
- validate-deps passes; degradation audit TOTAL 300; other common checks
- FB evidence; Codex review approves

---

## Batch 27: Harness H3 — polyglot fixtures, fixed keys, honesty contract — PENDING

- Recommended executor: senior-tester (sub-agent), Lane T (`task-559-lane-t`)
- Fallback executor: backend-developer
- Execution mode: sequential
- Rationale: the fixed Decision 18/19 key set and the honesty keys; later batches only add fragment files. Plan "+H rows" for 21's specs carried here (D2)
- Review: Codex CLI lane
- Tasks: 3 | Depends on: Batch 20.1 (merged), the whole honesty chain 22, 23a, 23b, 24a, 24b, 24c, 25a, 25b, 26a, 26b; Lane A Batch 21 merged

### Task 27.1: Polyglot fixtures — PENDING

- Files: `WIT/polyglot-fixtures.ts` (new)
- Plan reference: "Harness" → "Fixtures"
- Pattern to follow: `WIT/fixture-workspace.ts` (lane D API; not edited)
- Quality requirements: `PolyglotKnownEdge extends KnownEdge { granularity }`; sets python-app, go-csharp, java-rust (+ Kotlin files for 30k), ts-python-monorepo, no-grammar (`.ex`, `.swift`), php-ruby-cpp (real `.c` and `.h` that `#include` each other + a `.cpp`); bounds fixtures: 300-file namespace, 80 manifests, vendor tree beyond the census limit, superseded build; deterministic; cleans up
- Validation notes: import/require shapes built by concatenation
- Implementation details: none beyond the plan

### Task 27.2: Required keys, baseline fragment, honesty contract spec — PENDING

- Depends on: Task 27.1
- Files: `WIT/matrix/required-keys.ts` (new), `WIT/matrix/activations/b27-baseline.ts` (new), `WIT/language-honesty.contract.spec.ts` (new)
- Plan reference: "Fixed keys", "Activation fragments", "Required keys" table
- Pattern to follow: n/a
- Quality requirements: every key enumerated; `SELECTED_OPTIONS = { kotlin: 'vendored', c: 'via-cpp', checkers: 'go-vet-opt-in', buildCheckers: 'none', extraGraphs: 'include' }`; exact key count + sorted snapshot (ten literal honesty keys, no `graphEdges:kotlin`); fragments discovered via `fs`; asserts fragment ⊆ required, no key in two fragments, 100% recall with declared approximations only, registry grants each activated capability, non-activated keys meet the tool's unsupported contract, any empty answer without coverage fails. Baseline fragment activates the ten honesty keys and `syntaxDiagnostics` python/go/csharp
- Validation notes: FB per D6 — deliberate local revert of one honesty fix fails its key (shown, then restored)
- Implementation details: each honesty key asserted against that tool's own contract (ast error; enrich full content + reason)

### Task 27.3: Dispatcher coverage spec; 21 reconciliation — PENDING

- Depends on: Task 27.2
- Files: `MCP/mcp-core/mcp-language-coverage.spec.ts` (new), `MCP/mcp-core/mcp-contract.sweep.spec.ts`, `MCP/mcp-core/mcp-mandate-manifest.spec.ts`
- Plan reference: "Dispatcher spec"; "H reconciles 21.1/21.2"
- Pattern to follow: 21.1 sweep setup
- Quality requirements: new shapes through the reducer/budget path with raw spool equality; `building`, `failed` and partial shapes stay ordered; new shapes in the sweep; new guards in the mandate manifest; 26b becomes the host guard for `ptah_lsp_references` (its exemption removed)
- Validation notes: 21's pins are only extended, not loosened
- Implementation details: none beyond the plan

### Batch 27 verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache 2>&1 | tail -40` passes
- validate-deps passes; degradation audit TOTAL 300; other common checks
- FB (D6) evidence; Codex review approves

---

## Batch 28a: Grammar manifest — COMPLETE (lane commit cf6ec11af, merged e3578b2ca)

- Recommended executor: Codex CLI lane, Lane P (`task-559-lane-p`)
- Fallback executor: devops-engineer (sub-agent)
- Execution mode: sequential (runs now, in parallel with H and Lane A: packaging scripts only, no source file)
- Rationale: one manifest replaces three hand lists; activates nothing
- Review: Claude `code-logic-reviewer` subagent
- Tasks: 2 | Depends on: none

### Task 28a.1: Manifest and `copy-wasm.js` — COMPLETE

- Files: `<WT>/scripts/tree-sitter-grammars.json` (new), `<WT>/scripts/copy-wasm.js`
- Plan reference: codebase evidence "Packaging lists"; "Security notes"; "Grammar sources"
- Pattern to follow: `scripts/copy-wasm.js:38-65`
- Quality requirements: runtime row + grammar rows with `active`; the five current grammars active; tsx/java/rust/php/ruby/cpp rows present, inactive; a `vendored` row kind (repo-relative path, sha256, licence file) with sha256 check that fails the build on mismatch (D7); `--self-test` negatives
- Validation notes: output of `copy-wasm.js` for Electron and VSIX unchanged for active rows (compare the copied file list before/after)
- Implementation details: no new dependency

### Task 28a.2: Packed verifiers and CI self-test — COMPLETE

- Depends on: Task 28a.1
- Files: `<WT>/apps/ptah-electron/scripts/verify-packed-wasm.js`, `<WT>/apps/ptah-cli/scripts/verify-packed-wasm.cjs`, `<WT>/.github/workflows/publish-cli.yml`
- Plan reference: codebase evidence (Electron verify `:31-36` lacks py/go; CLI verify `:37-44`; `publish-cli.yml:362-363, :381`)
- Pattern to follow: existing verifier structure
- Quality requirements: both verifiers read the manifest's active rows; `--self-test` negatives run in CI
- Validation notes: FB "Electron asar without python passes today" (shown with the old verifier on a crafted fixture)
- Implementation details: none beyond the plan

### Batch 28a verification

- `node scripts/copy-wasm.js --self-test`, `node apps/ptah-electron/scripts/verify-packed-wasm.js --self-test`, `node apps/ptah-cli/scripts/verify-packed-wasm.cjs --self-test` pass (tail only)
- `node_modules/.bin/nx run-many -t=lint,typecheck -p ptah-electron ptah-cli --skip-nx-cache 2>&1 | tail -40` passes
- [x] validate-deps passes; degradation audit TOTAL 300; other common checks
- [x] FB evidence; the Claude reviewer approves

### Batch 28a record (Lane P)

- Tasks 28a.1 and 28a.2 COMPLETE; details in `batch-28a-executor-report.md`. Author: Codex CLI lane; reviewer:
  Claude `code-logic-reviewer`, r1 APPROVE 8/10 (`reviews/batch-28a-code-logic-review-r1.md`); 0 Blocking,
  0 Serious, 1 Moderate, 1 Minor
- `scripts/tree-sitter-grammars.json` is the single source of which WASM assets ship; `copy-wasm.js`, both
  `verify-packed-wasm` scripts and `publish-cli.yml` derive from its active rows (CI now checks each file is
  non-empty, `-s`, instead of only present). Nothing is activated
- Parity evidence: the reviewer's independent probe copied with the new `copy-wasm.js` and with HEAD's copier into
  separate temp dirs — sha256 of all 6 output files byte-identical, for all 3 hosts; the active set is unchanged
  (runtime + 5 grammars)
- Known issues (Moderate, never a false pass — a bad manifest still fails packaging, with a less precise message):
  **KI-28a-1** `apps/ptah-electron/scripts/verify-packed-wasm.js:46-62` and **KI-28a-2**
  `apps/ptah-cli/scripts/verify-packed-wasm.cjs:31-47` each duplicate a weaker inline manifest check instead of
  reusing `copy-wasm.js` `validateManifest`. Recorded in TASK_2026_561_9e57 Track B (B7). Minor, not carried: the
  copy loop does not roll back on a post-copy size mismatch (filesystem race only)
- Integration verification after merge (2026-09-26): vscode-lm-tools test/lint/typecheck, `ptah-electron`/`ptah-cli`
  lint+typecheck `--skip-nx-cache` pass; the three `--self-test` runs PASS; `ptah-electron:validate-deps` pass;
  `degradation-audit:lint` TOTAL 300
- Lane commit **cf6ec11af**, merge **e3578b2ca** (no conflicts)

---

## Batch 28b: VSIX packed check — COMPLETE (lane commit 5d19d8971, merged 44336de6a)

- Recommended executor: Codex CLI lane, Lane P
- Fallback executor: devops-engineer (sub-agent)
- Execution mode: sequential
- Rationale: the VSIX has no packed-grammar check today
- Review: Claude `code-logic-reviewer` subagent
- Tasks: 1 | Depends on: Batch 28a

### Task 28b.1: `verify-packed-wasm.cjs` after `package` — COMPLETE

- Files: `<WT>/apps/ptah-extension-vscode/scripts/verify-packed-wasm.cjs` (new; the `scripts/` dir does not exist yet), `<WT>/apps/ptah-extension-vscode/project.json`
- Plan reference: codebase evidence `apps/ptah-extension-vscode/project.json:118-122`
- Pattern to follow: `apps/ptah-cli/scripts/verify-packed-wasm.cjs`
- Quality requirements: runs after `package` on the real `.vsix` (zip listing), checks every manifest-active grammar; `--self-test`
- Validation notes: FB "missing grammar in .vsix passes today"
- Implementation details: real artifact size delta recorded in the report

### Batch 28b verification

- `node apps/ptah-extension-vscode/scripts/verify-packed-wasm.cjs --self-test` passes; one real `nx run ptah-extension-vscode:package` + verify run recorded (tail only)
- `node_modules/.bin/nx run-many -t=lint -p ptah-extension-vscode --skip-nx-cache 2>&1 | tail -40` passes
- validate-deps passes; degradation audit TOTAL 300; other common checks
- The Claude reviewer approves

### Batch 28b record (Lane P)

- Task 28b.1 COMPLETE; details in `batch-28b-executor-report.md`. Author: Codex CLI lane; reviewer: Claude
  `code-logic-reviewer`, r1 APPROVE 8/10 (`reviews/batch-28b-code-logic-review-r1.md`)
- `apps/ptah-extension-vscode/scripts/verify-packed-wasm.cjs` (new) runs after VSCE packaging on the exact
  name/version `.vsix` and fails on any missing or empty manifest-active grammar; `project.json` package target runs
  self-test → VSCE package → verify. FB: a real VSCE-built VSIX with Python omitted packaged successfully before and
  is rejected (exit 1) after
- Real artifact: `ptah-coding-orchestra-0.2.43.vsix` 11,415,494 bytes before/after, 0-byte delta, 40 entries
  hash-identical (executor-measured). Caveat: the reviewer did not re-run the full VSCE build (~4 min); that number is
  trusted from the executor's report, with the self-test's ZIP path exercised by the reviewer
- Lane commit **5d19d8971**, merged into this branch as **44336de6a** (no conflicts). Post-merge `--self-test` PASS

---

## Batch 29a1: Language modules (pure move) — PENDING

- Recommended executor: Codex CLI lane, Lane G (`task-559-lane-g`)
- Fallback executor: backend-developer (sub-agent)
- Execution mode: sequential
- Rationale: 9 files / 1 lib, justified as a pure move; existing specs green unchanged
- Review: Claude `code-logic-reviewer` subagent
- Tasks: 1 | Depends on: Batches 27, 28a

### Task 29a1.1: Move entries and queries to `languages/<id>.language.ts` — PENDING

- Files: `WI/ast/languages/typescript.language.ts`, `…/javascript.language.ts`, `…/python.language.ts`, `…/go.language.ts`, `…/csharp.language.ts`, `…/index.ts`, `…/types.ts` (all new under `WI/ast/languages/`), `WI/ast/tree-sitter.config.ts`, `WI/ast/language-registry.ts`
- Plan reference: "Grammars and queries" → 29a1
- Pattern to follow: current entries in `tree-sitter.config.ts:365-398`
- Quality requirements: byte-identical queries; `tree-sitter.config.ts` becomes the assembly; the registry reads the modules
- Validation notes: FB n/a (refactor) — existing specs green unchanged is the proof; show `git diff --stat` of spec files is empty
- Implementation details: query strings keep validate-deps-safe shapes

### Batch 29a1 verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence --skip-nx-cache 2>&1 | tail -40` passes
- validate-deps passes; degradation audit TOTAL 300; other common checks
- The Claude reviewer approves

---

## Batch 29a2: Lazy isolated grammar loading — PENDING

- Recommended executor: Codex CLI lane, Lane G
- Fallback executor: backend-developer (sub-agent)
- Execution mode: sequential
- Rationale: memory and isolation must precede any activation (risk table)
- Review: Claude `code-logic-reviewer` subagent
- Tasks: 2 | Depends on: Batch 29a1

### Task 29a2.1: Per-language latch; too-large refusal — PENDING

- Files: `WI/ast/tree-sitter-parser.service.ts`, `WI/ast/tree-sitter-parser.service.spec.ts`
- Plan reference: 29a2; codebase evidence `tree-sitter-parser.service.ts:113-149`
- Pattern to follow: existing `initialize()`
- Quality requirements: runtime at `initialize()`; each grammar on first use behind a per-language latch; failure → `failed.grammar-unavailable` for that language only; > 1 MiB → `failed.too-large`
- Validation notes: FB "a failing grammar does not disable the others". 24a `parseStatus` behaviour unchanged
- Implementation details: concurrent first uses share one load

### Task 29a2.2: Manifest ↔ registry spec — PENDING

- Depends on: Task 29a2.1
- Files: `WI/ast/grammar-manifest.spec.ts` (new)
- Plan reference: 29a2
- Pattern to follow: `fs` reads in lane D specs
- Quality requirements: registry grammars equal the manifest's `active` grammar rows
- Validation notes: reads `<WT>/scripts/tree-sitter-grammars.json` via `fs`
- Implementation details: none

### Batch 29a2 verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence --skip-nx-cache 2>&1 | tail -40` passes
- validate-deps passes; degradation audit TOTAL 300; other common checks
- FB evidence; the Claude reviewer approves

---

## Batch 29b: tsx, atomic — PENDING

- Recommended executor: backend-developer (sub-agent), Lane H
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: 12 files / 2 libs justified (r2-4): exhaustive union + outliner record + enrichment + namespace + manifest + fragment must land in one commit
- Review: Codex CLI lane
- Tasks: 2 | Depends on: Batch 29a2

### Task 29b.1: `tsx` id, module, outliner, manifest, fragment — PENDING

- Files: `WI/ast/ast.types.ts`, `WI/ast/languages/tsx.language.ts` (new), `WI/ast/languages/index.ts`, `WI/ast/tsx-grammar.integration.spec.ts` (new), `MCP/mcp-core/code-outliner.adapter.ts`, `MCP/mcp-core/code-outliner.adapter.spec.ts`, `<WT>/scripts/tree-sitter-grammars.json`, `WIT/matrix/activations/b29b.ts` (new)
- Plan reference: 29b; "Required keys" (parse/outline/codeIndex/enrichSummary: tsx)
- Pattern to follow: `WI/ast/csharp-grammar.integration.spec.ts`
- Quality requirements: `SupportedLanguage` gains `tsx`; `OUTLINE_QUERIES.tsx`; manifest `active:true`; fragment lists only keys proven here
- Validation notes: FB "tsx outline not refused"; new keys fail on base 29a2. Host typechecks (ptah-cli, ptah-electron) green in the same commit
- Implementation details: none beyond the plan

### Task 29b.2: Enrichment gate and namespace alias removal — PENDING

- Depends on: Task 29b.1
- Files: `WI/context-analysis/context-enrichment.service.ts`, `WI/context-analysis/context-enrichment.service.spec.ts`, `MCP/namespace-builders/analysis-namespace.builders.ts`, `MCP/namespace-builders/analysis-namespace.builders.spec.ts`
- Plan reference: 29b; codebase evidence `context-enrichment.service.ts:155-159`, `analysis-namespace.builders.ts:84-137`
- Pattern to follow: Batch 7 refusals (Decision 13)
- Quality requirements: gate reads `enrichSummary`; `.tsx` alias/refusal deleted; Decision 13 refusals kept; TSX declaration-only file summarises; TSX with JSX runtime falls back with its reason; explicit and inferred language agree; MCP enrich/outline via the real dispatcher
- Validation notes: FB "tsx declaration file summarises"
- Implementation details: none beyond the plan

### Batch 29b verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache 2>&1 | tail -40` passes
- validate-deps passes; degradation audit TOTAL 300; other common checks
- FB evidence; Codex review approves

---

## Batch 30: Java + Rust grammars — PENDING

- Recommended executor: Antigravity CLI lane, Lane G (G1 phase)
- Fallback executor: backend-developer (sub-agent)
- Execution mode: sequential
- Rationale: activation unit, 9 files / 2 libs justified (union + outliner record)
- Review: Claude `code-logic-reviewer` subagent
- Tasks: 2 | Depends on: Batch 29b

### Task 30.1: Java — PENDING

- Files: `WI/ast/ast.types.ts`, `WI/ast/languages/java.language.ts` (new), `WI/ast/languages/index.ts`, `WI/ast/java-rust-grammar.integration.spec.ts` (new), `MCP/mcp-core/code-outliner.adapter.ts`, `MCP/mcp-core/code-outliner.adapter.spec.ts`, `<WT>/scripts/tree-sitter-grammars.json`
- Plan reference: query table (java row); "Required keys" (parse/outline/codeIndex/syntaxDiagnostics: java)
- Pattern to follow: `WI/ast/languages/tsx.language.ts` (29b)
- Quality requirements: node names proven against the shipped WASM
- Validation notes: new keys fail on base 29b
- Implementation details: `graphEdges`/`publicSymbols` stay off (34 owns them)

### Task 30.2: Rust and the fragment — PENDING

- Depends on: Task 30.1
- Files: `WI/ast/languages/rust.language.ts` (new), same shared files as 30.1, `WIT/matrix/activations/b30.ts` (new)
- Plan reference: query table (rust row)
- Pattern to follow: Task 30.1
- Quality requirements: fragment lists parse/outline/codeIndex/syntaxDiagnostics for java and rust only
- Validation notes: after merge, `java.language.ts` and `rust.language.ts` are handed to G2
- Implementation details: none

### Batch 30 verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache 2>&1 | tail -40` passes
- validate-deps passes; degradation audit TOTAL 300; other common checks
- FB evidence; the Claude reviewer approves

---

## Batch 31: PHP, Ruby, C++ grammars (`.c/.h` via cpp) — PENDING

- Recommended executor: Antigravity CLI lane, Lane G (G1)
- Fallback executor: backend-developer (sub-agent)
- Execution mode: sequential
- Rationale: as 30; 10 files / 2 libs justified
- Review: Claude `code-logic-reviewer` subagent
- Tasks: 3 | Depends on: Batch 30

### Task 31.1: PHP — PENDING

- Files: `WI/ast/ast.types.ts`, `WI/ast/languages/php.language.ts` (new), `WI/ast/languages/index.ts`, `WI/ast/php-ruby-cpp-grammar.integration.spec.ts` (new), `MCP/mcp-core/code-outliner.adapter.ts`, `MCP/mcp-core/code-outliner.adapter.spec.ts`, `<WT>/scripts/tree-sitter-grammars.json`
- Plan reference: query table (php row)
- Pattern to follow: Batch 30
- Quality requirements: include/require queries validate-deps safe
- Validation notes: keys fail on base 30
- Implementation details: none

### Task 31.2: Ruby — PENDING

- Depends on: Task 31.1
- Files: `WI/ast/languages/ruby.language.ts` (new) + the shared files of 31.1
- Plan reference: query table (ruby row; `#match?` on `require`/`require_relative`)
- Pattern to follow: Task 31.1
- Quality requirements: predicate text contains no `require("` shape
- Validation notes: none
- Implementation details: none

### Task 31.3: C++ with `.c`/`.h`, and the fragment — PENDING

- Depends on: Task 31.2
- Files: `WI/ast/languages/cpp.language.ts` (new) + the shared files of 31.1, `WIT/matrix/activations/b31.ts` (new)
- Plan reference: query table (cpp row); Decision 19 (`c:parsed-as-cpp`)
- Pattern to follow: Task 31.1
- Quality requirements: `.c`, `.h`, `.cpp` extensions → `cpp`; `c:parsed-as-cpp` approximation; cpp keys proven on real `.c`, `.h` and `.cpp` fixtures; C that fails to parse → `failed.parse`
- Validation notes: after merge, php/ruby/cpp modules are handed to G2
- Implementation details: none

### Batch 31 verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache 2>&1 | tail -40` passes
- validate-deps passes; degradation audit TOTAL 300; other common checks
- FB evidence; the Claude reviewer approves

---

## Batch 30k: Kotlin grammar (vendored, required) — COMPLETE (fixes verified by the Lane A closing review)

- Recommended executor: Antigravity CLI lane, Lane G (G1)
- Fallback executor: backend-developer (sub-agent)
- Execution mode: sequential
- Rationale: required by Decision 19. **Batch gate (O3): the Kotlin provenance record — source URL, version (`@tree-sitter-grammars/tree-sitter-kotlin` 1.1.0), sha256, LICENSE text, load record — is attached to the task folder and re-checked by the reviewer BEFORE the batch starts**
- Review: Claude `code-logic-reviewer` subagent
- Tasks: 2 | Depends on: Batch 31, O3 provenance gate

### Task 30k.1: Vendored asset + manifest row — PENDING

- Files: `<WT>/assets/tree-sitter/tree-sitter-kotlin.wasm` (new; path per the 28a manifest, D7), `<WT>/assets/tree-sitter/LICENSE-tree-sitter-kotlin` (new), `<WT>/scripts/tree-sitter-grammars.json`
- Plan reference: "Grammar sources" (Kotlin row); "Security notes"
- Pattern to follow: the 28a `vendored` row kind
- Quality requirements: sha256 in the manifest equals the provenance record; `copy-wasm.js` verifies it; mismatch fails the build
- Validation notes: the file is binary — confirm `.gitattributes` treats `.wasm` as binary
- Implementation details: real artifact delta (+~3.4 MB raw) recorded

### Task 30k.2: Module, outliner, integration spec, fragment — PENDING

- Depends on: Task 30k.1
- Files: `WI/ast/ast.types.ts`, `WI/ast/languages/kotlin.language.ts` (new), `WI/ast/languages/index.ts`, `WI/ast/kotlin-grammar.integration.spec.ts` (new), `MCP/mcp-core/code-outliner.adapter.ts`, `MCP/mcp-core/code-outliner.adapter.spec.ts`, `WIT/matrix/activations/b30k.ts` (new)
- Plan reference: query table (kotlin row); "Required keys" (parse/outline/codeIndex/syntaxDiagnostics: kotlin; no graph key)
- Pattern to follow: Batch 30
- Quality requirements: loads under web-tree-sitter 0.27 (ABI 14); node names proven
- Validation notes: kotlin keys fail on base 31; 24b's `.kt` unsupported answer becomes a real index answer (24b spec updated to a still-unsupported extension)
- Implementation details: none

### Batch 30k verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache 2>&1 | tail -40` passes; `node scripts/copy-wasm.js --self-test` passes
- validate-deps passes; degradation audit TOTAL 300; other common checks
- Provenance re-checked by the reviewer; FB evidence; the Claude reviewer approves

### Batch 30k review history (User Decision 24)

- Author: backend-developer subagent. Reviewer: Codex (Lane A session), cross-side.
- r1 (`reviews/batch-30k-code-logic-review-r1.md`): REVISE 6/10 — R30K-01 Serious (packed verifiers accepted a
  same-length corrupted Kotlin WASM), R30K-02 Serious (valid Kotlin served as a syntax error without disclosure),
  R30K-03 Moderate (a block comment hid a Kotlin import). Provenance re-checked independently (SHA-256, npm
  integrity, `gh attestation verify`, ABI 14) — Decision 25 gate met. The same review verified the Batch 31 fix
  round: R31-01..05 (incl. R30-02, R30-03 and the compactCoverage change, worst case 994) all CLOSED.
- One fix round (report "## Fix round (review r1)"): packed verifiers hash the WASM via `copy-wasm.js
--list-vendored`; unlocated Kotlin recoveries report "not validated" with the new approximation
  `kotlin:grammar-limit` (platform-core change); comment-safe Kotlin import extraction. The Lane A closing review
  verifies them.
- Team-leader verification (2026-09-28): workspace-intelligence, vscode-lm-tools, platform-core, ptah-electron
  test/lint/typecheck pass except the known protocol-dispatcher "slow empty build" flake (passed alone 298/298);
  ptah-cli typecheck, copy-wasm and the three packed-verifier self-tests, validate-deps pass; audit TOTAL 300;
  description pins unchanged (671/702, 522/536).
- Carried to Batch 38 / follow-up: Electron `.kt` reference search counts comment/string matches (pre-existing);
  the Nx `ptah-cli:copy-wasm` target lacks the manifest and `assets/tree-sitter/**` as cache inputs.
- Committed bb54f328b. Lane A closing review (`reviews/lane-a-closing-review-30k.md`, Codex): APPROVE 9/10 —
  R30K-01..03 CLOSED; the Lane G2 merge 082a0c15b conflict resolution approved; no new findings. Lane A closed.

---

## Batch 32a: Extraction contract — COMPLETE (commit a5632f1bb)

- Recommended executor: Codex CLI lane, Lane G2 (`task-559-lane-g2`)
- Fallback executor: backend-developer (sub-agent)
- Execution mode: sequential
- Rationale: `ImportInfo`/`declarations` contract with range-containment `scopePath`. Footprint corrected per D3 (9 files / 1 lib)
- Review: Claude `code-logic-reviewer` subagent
- Tasks: 2 | Depends on: Batches 29b, 30 (D3)

### Task 32a.1: Contract and service — PENDING

- Files: `WI/ast/ast-analysis.interfaces.ts`, `WI/ast/ast-analysis.service.ts`, `WI/ast/ast-analysis.service.spec.ts`, `WI/ast/languages/types.ts`
- Plan reference: "Extraction contract (32a)"; codebase evidence `ast-analysis.service.ts:83-95, :300-301, :320-420`
- Pattern to follow: existing `queryMulti` entry list
- Quality requirements: `ImportInfo.kind` (9 kinds), `relativeLevel`, `alias`, full `importedSymbols`, `line`, `scopePath`; `CodeInsights.declarations`; `declarationQuery` runs as an extra entry of the same `queryMulti` call; TS/JS output byte-identical
- Validation notes: existing TS/JS specs unchanged
- Implementation details: C# nested namespaces concatenate; Rust inline modules nest; file-scoped namespaces cover the rest of the file

### Task 32a.2: Per-language declaration queries and fixtures — PENDING

- Depends on: Task 32a.1
- Files: `WI/ast/languages/python.language.ts`, `…/go.language.ts`, `…/csharp.language.ts`, `…/java.language.ts`, `…/rust.language.ts` (all G2-owned after the 30 handoff)
- Plan reference: "Required fixtures"
- Pattern to follow: Task 32a.1
- Quality requirements: fixtures — Rust two inline modules with different `self::`/`super::` resolution; nested C# namespaces, `using static`, alias, `global using`; Java nested-type and static imports; Python multi-name and multi-level relative; Go grouped and raw-string; Rust grouped `use {a, b::c}`
- Validation notes: FB "two inline Rust modules keep separate scopePath". Go/Python fixture strings built by concatenation (validate-deps)
- Implementation details: capabilities flags unchanged here (33-36 set them)

### Batch 32a verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence --skip-nx-cache 2>&1 | tail -40` passes
- validate-deps passes; degradation audit TOTAL 300; other common checks
- FB evidence; the Claude reviewer approves

---

## Batch 32b: Resolver seam, context, bounds — COMPLETE (fixes verified by the Batch 33 review)

- Recommended executor: Codex CLI lane, Lane G2
- Fallback executor: backend-developer (sub-agent)
- Execution mode: sequential
- Rationale: resolver dispatch on the importing file's language; per-import and aggregate limits
- Review: Claude `code-logic-reviewer` subagent
- Tasks: 2 | Depends on: Batch 32a

### Task 32b.1: `ImportResolver` seam and TS/JS resolver — PENDING

- Files: `WI/ast/import-resolution/import-resolver.ts` (new), `WI/ast/import-resolution/ts-js-import-resolver.ts` (new)
- Plan reference: "Resolver dispatch (32b)"; TS/JS resolution row
- Pattern to follow: current resolution at `dependency-graph.service.ts:406-414, :815-841`
- Quality requirements: `resolve(imp, fromFile, ctx) → { kind, targets, truncated? }`; TS/JS today's behaviour + tsconfig `paths` from the root `tsconfig*.json`
- Validation notes: FB "tsconfig alias resolves on the MCP path"
- Implementation details: case rule (exact first; unique case-fold → `case-folded`; ambiguous → `unresolved-internal`)

### Task 32b.2: `ResolverContext`, bounds, graph dispatch — PENDING

- Depends on: Task 32b.1
- Files: `WI/ast/import-resolution/resolver-context.ts` (new), `WI/ast/import-resolution/resolver-context.spec.ts` (new), `WI/ast/dependency-graph.service.ts`, `WI/ast/dependency-graph.service.spec.ts`
- Plan reference: "Bounds" table (manifests, per-import 200, aggregate 250,000)
- Pattern to follow: 23a generation guard
- Quality requirements: context built once per build, generation checks, yields between reads; manifests ≤ 64 files, ≤ 256 KiB each, ≤ 2 MiB total, realpath inside root, text only → else `context:'partial'`; linking yields and re-checks generation inside multi-target expansion
- Validation notes: cancellation mid-expansion test; limits disclosed
- Implementation details: none beyond the plan

### Batch 32b verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence --skip-nx-cache 2>&1 | tail -40` passes
- validate-deps passes; degradation audit TOTAL 300; other common checks
- FB evidence; the Claude reviewer approves

### Batch 32b review history (User Decision 24)

- Author: backend-developer subagent. Reviewer: Codex (G2 session), cross-side.
- r1 (`reviews/batch-32b-code-logic-review-r1.md`): REVISE 4/10 — R32B-01..03 Blocking (tsconfig extends/override,
  `file:`/`link:`/`workspace:` deps certified external, manifest check/open race), R32B-04 Serious (physical read
  bounds), R32B-05/06 Moderate (escaped re-export specifiers, cancellation before read). The same review verified the
  32a fix round: R32A-01, -02, -03, -05 CLOSED; R32A-04 (Python per-member aliases) carried to Batch 33.
- One fix round (report "## Fix round (review r1)"): all six fixed with regressions. The Batch 33 review verifies them.
- Team-leader verification (2026-09-28): workspace-intelligence test/lint/typecheck and vscode-lm-tools
  test/typecheck pass (`--skip-nx-cache`), validate-deps pass, degradation audit TOTAL 300.
  `context-enrichment.service.spec.ts` timed out once under parallel load and passed alone (70/70) — load flake,
  carried to Batch 38.
- Carried (Moderate): a local package's `main`/`exports` entry is not read; a miss is unresolved-internal.

---

## Batch 32c: Drop the dead tsconfig parameter — COMPLETE

- Recommended executor: backend-developer (sub-agent), Lane H
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: the resolver context reads tsconfig itself now; H owns the namespace builder
- Review: Codex CLI lane
- Tasks: 1 | Depends on: Batch 32b

### Task 32c.1: Remove the unused parameter — PENDING

- Files: `MCP/namespace-builders/analysis-namespace.builders.ts`, `MCP/namespace-builders/analysis-namespace.builders.spec.ts`
- Plan reference: codebase evidence `analysis-namespace.builders.ts:453`
- Pattern to follow: n/a
- Quality requirements: no behaviour change; `ptah_lsp_references` on graph callers still gets tsconfig aliases via 32b
- Validation notes: FB n/a; use `ptah_lsp_references` before the removal (Working rules)
- Implementation details: none

### Batch 32c verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/vscode-lm-tools --skip-nx-cache 2>&1 | tail -40` passes
- validate-deps passes; degradation audit TOTAL 300; other common checks
- Codex review approves

### Batch 32c review history

- Author: backend-developer subagent. Reviewer: opencode (`opencode-go/glm-5.3`, user-pinned 2026-09-28 for
  low-risk batches in place of Antigravity), cross-side. The reviewer changed from Codex because the batch is a pure
  parameter removal.
- r1 (`reviews/batch-32c-code-logic-review-r1.md`): APPROVE 9/10, 3 Minor — R32C-01 duplicated temp-root scaffolding
  in the namespace spec, R32C-02 the new spec does not pin `context`/clean, R32C-03 the removed caller-rule precedence
  row (informational). Carried as Minor; no fix round.
- Footprint grew from 2 to 10 files (positional parameter: service signature, `callerPaths` option and every spec call
  site) — see `batch-32c-executor-report.md`.
- Team-leader verification (2026-09-28): workspace-intelligence, vscode-lm-tools, ptah-electron test/lint/typecheck
  pass; ptah-cli typecheck, validate-deps pass; audit TOTAL 300; no production `callerPaths` caller left.

---

## Batch 33: Python + Go graphs — COMPLETE (fixes verified by the Batch 34.1 review)

- Recommended executor: Codex CLI lane, Lane G2
- Fallback executor: backend-developer (sub-agent)
- Execution mode: sequential
- Rationale: first non-JS resolvers; 7 files / 1 lib
- Review: Claude `code-logic-reviewer` subagent
- Tasks: 2 | Depends on: Batches 32b, 27

### Task 33.1: Python resolver — PENDING

- Files: `WI/ast/import-resolution/python-import-resolver.ts` (new), `…/python-import-resolver.spec.ts` (new), `WI/ast/languages/python.language.ts`
- Plan reference: resolution table (Python row)
- Pattern to follow: `ts-js-import-resolver.ts`
- Quality requirements: relative (`relativeLevel`-1 up), source roots (root, `src/`, pyproject package-dir/packages), `a/b.py` / `a/b/__init__.py`, `from a.b import c` preference, first-segment miss → external; `graphEdges { granularity:'file', referenceScopeComplete:false }`, `publicSymbols` on
- Validation notes: keys fail on base 32b
- Implementation details: pyproject read text-only, bounded

### Task 33.2: Go resolver and the fragment — PENDING

- Depends on: Task 33.1
- Files: `WI/ast/import-resolution/go-import-resolver.ts` (new), `…/go-import-resolver.spec.ts` (new), `WI/ast/languages/go.language.ts`, `WIT/matrix/activations/b33.ts` (new)
- Plan reference: resolution table (Go row)
- Pattern to follow: Task 33.1
- Quality requirements: `go.mod` module prefix; `go.work` `use`; local `replace` only; package edges to every non-`_test.go` file; `go:package-edges`
- Validation notes: Go fixture `import "x"` shapes by concatenation
- Implementation details: fragment: publicSymbols/graphEdges python, go

### Batch 33 verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence --skip-nx-cache 2>&1 | tail -40` passes
- validate-deps passes; degradation audit TOTAL 300; other common checks
- FB evidence; the Claude reviewer approves

### Batch 33 review history (User Decisions 24, 27, 28)

- Author: backend-developer subagent. Reviewer: Codex (G2 session), cross-side.
- r1 (`reviews/batch-33-code-logic-review-r1.md`): REVISE 4/10 — Blocking R33-01 (Python namespace/regular-package
  roots), R33-02 (Poetry/PEP 508 local deps certified external), R33-04 (Go replace precedence/version/absolute),
  R33-10 (= R32B-01 still open: overlapping independent tsconfig paths); Serious R33-05 (Unicode Go exports),
  R33-06 (Python `__all__`/conditional public symbols), R33-07 (= R32B-04 still open: bytes lost on read/close
  errors), R33-08 (exponential tsconfig DAG); Moderate R33-03 (top-level case rule), R33-09 (Go escaped paths).
  32b verification: R32B-02, -03, -05, -06 CLOSED; R32B-01 and R32B-04 STILL OPEN → R32B-01 escalated to the user →
  User Decision 28 (conservative rule). R32A-04 (Python aliases) CLOSED.
- One fix round (report "## Fix round (review r1)"): all ten fixed; uncertain cases disclosed (`module-selection-unknown`,
  `unresolvedMembers`, `conflicting-configs`, incomplete public-symbol files). resolver-context.ts split under the
  facade rule (go-context.ts, python-context.ts; 597 lines). Four description pins raised +12 chars each for ", python,
  go" (recorded reason: registry language lists); ptah_get_symbol_index at 996/1000 → handled in 34.1.
- Team-leader verification (2026-09-28): workspace-intelligence, vscode-lm-tools, ptah-electron lint/typecheck pass;
  tests pass except the protocol-dispatcher "slow empty build" flake (298/298 alone twice; fixed on the task branch
  by 38a 751c7bd78); electron-ide-capabilities 110/110; validate-deps pass; audit TOTAL 300.

---

## Batch 34: C# + Java graphs — 34.1 COMPLETE (fixes verified by the Batch 38 closing review); 34.2 DEFERRED (User Decision 27)

### Batch 34.1 review history — Lane G2 closing (User Decisions 24, 29)

- Author: backend-developer subagent. Codex hit its usage limit (until 2026-10-03) on the first attempt, so two
  independent closing reviewers ran (Decision 29): Claude `code-logic-reviewer` (`reviews/batch-34-lane-g2-closing-review-claude.md`)
  APPROVE 8/10, and opencode `opencode-go/glm-5.3` (`reviews/batch-34-lane-g2-closing-review-glm.md`) REVISE 6/10.
- Both verified the Batch 33 fix round: R33-01..R33-10 all CLOSED (R33-10 under User Decision 28 → R32B-01 closed;
  R33-07 → R32B-04 closed). Both approved the merge d72fbbc06.
- Findings: R34G-01 Blocking (Directory.Build.props `<Using>` dropped for files outside every `.csproj`, clean),
  R34G-02 Serious (`$(…)` usings dropped silently), R34G-03 Serious (NOT adopted: a C# using-namespace-directive does
  not import nested namespaces; the example was a fully qualified reference, already disclosed by
  `referenceScopeComplete: false` — rationale in the resolver comment), R34G-04 Minor (global-namespace fallback edge),
  R34C-01 Moderate (tally-once invariant). R34C-02, R34C-03 Minor carried.
- One fix round (report "## Fix round (closing reviews)"): R34G-01/02/04 and R34C-01 fixed with regressions; new gap
  `msbuild-using-not-evaluated`. The Batch 38 closing review verifies them.
- Description pins: symbol index 975/1000, search 680/702, reindex 522/536 (no raise).
- Team-leader verification (2026-09-28): workspace-intelligence, vscode-lm-tools, ptah-electron, platform-core
  test/lint/typecheck pass; ptah-cli typecheck, validate-deps pass; audit TOTAL 300.

- Recommended executor: Codex CLI lane, Lane G2
- Fallback executor: backend-developer (sub-agent)
- Execution mode: sequential
- Rationale: namespace / package edges with declared approximations
- Review: Claude `code-logic-reviewer` subagent
- Tasks: 2 | Depends on: Batches 33, 30

### Task 34.1: C# resolver — PENDING

- Files: `WI/ast/import-resolution/csharp-import-resolver.ts` (new), `…/csharp-import-resolver.spec.ts` (new), `WI/ast/languages/csharp.language.ts`
- Plan reference: resolution table (C# row)
- Pattern to follow: Batch 33
- Quality requirements: `using N` / `using static` / alias / `global using` → files declaring namespace N (nested composed); `csharp:namespace-edges`; per-import 200 → `truncatedImports` (300-file namespace fixture)
- Validation notes: keys fail on base 33
- Implementation details: none

### Task 34.2: Java resolver and the fragment — PENDING

- Depends on: Task 34.1
- Files: `WI/ast/import-resolution/jvm-import-resolver.ts` (new), `…/jvm-import-resolver.spec.ts` (new), `WI/ast/languages/java.language.ts`, `WIT/matrix/activations/b34.ts` (new)
- Plan reference: resolution table (Java row)
- Pattern to follow: Task 34.1
- Quality requirements: FQN → unique file declaring package + top-level type; nested → outer file; wildcard/ambiguous → package dir files with `java:package-wildcard`
- Validation notes: none
- Implementation details: fragment: publicSymbols/graphEdges csharp, java

### Batch 34 verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence --skip-nx-cache 2>&1 | tail -40` passes
- validate-deps passes; degradation audit TOTAL 300; other common checks
- FB evidence; the Claude reviewer approves

---

## Batch 35: Rust graph — DEFERRED (User Decision 27, follow-up task)

- Recommended executor: Codex CLI lane, Lane G2
- Fallback executor: backend-developer (sub-agent)
- Execution mode: sequential
- Rationale: module resolution from `scopePath` (32a) and Cargo manifests
- Review: Claude `code-logic-reviewer` subagent
- Tasks: 1 | Depends on: Batch 34

### Task 35.1: Rust resolver, Cargo context, fragment — PENDING

- Files: `WI/ast/import-resolution/rust-import-resolver.ts` (new), `…/rust-import-resolver.spec.ts` (new), `WI/ast/languages/rust.language.ts`, `WI/ast/import-resolution/resolver-context.ts`, `WIT/matrix/activations/b35.ts` (new)
- Plan reference: resolution table (Rust row)
- Pattern to follow: Batch 34
- Quality requirements: crate roots (`src/lib.rs`, `src/main.rs`, `[lib] path`, `[[bin]] path`), workspace `members`; `mod x;` → `x.rs` / `x/mod.rs`; `crate::`/`self::`/`super::` from `scopePath`; longest module prefix; other workspace crates by package name
- Validation notes: tests: inline modules, grouped use, Cargo workspace; keys fail on base 34
- Implementation details: Cargo read via the bounded manifest reader

### Batch 35 verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence --skip-nx-cache 2>&1 | tail -40` passes
- validate-deps passes; degradation audit TOTAL 300; other common checks
- FB evidence; the Claude reviewer approves

---

## Batch 36a: PHP graph (required, Decision 19) — DEFERRED (User Decision 27, follow-up task)

- Recommended executor: Codex CLI lane, Lane G2
- Fallback executor: backend-developer (sub-agent)
- Execution mode: sequential
- Rationale: plan Batch 36 split per D5
- Review: Claude `code-logic-reviewer` subagent
- Tasks: 1 | Depends on: Batches 35, 31

### Task 36a.1: PHP resolver and fragment — PENDING

- Files: `WI/ast/import-resolution/php-import-resolver.ts` (new), `…/php-import-resolver.spec.ts` (new), `WI/ast/languages/php.language.ts`, `WIT/matrix/activations/b36a.ts` (new); `resolver-context.ts` only if composer reading is not already generic (then 5 files)
- Plan reference: resolution table (PHP row)
- Pattern to follow: Batch 35
- Quality requirements: composer `autoload.psr-4` prefix → dir + class path; literal include/require → relative file
- Validation notes: PHP keys fail on base 35; fixture strings validate-deps safe
- Implementation details: none

### Batch 36a verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence --skip-nx-cache 2>&1 | tail -40` passes
- validate-deps passes; degradation audit TOTAL 300; other common checks
- FB evidence; the Claude reviewer approves

---

## Batch 36b: Ruby graph (required) — DEFERRED (User Decision 27, follow-up task)

- Recommended executor: Codex CLI lane, Lane G2
- Fallback executor: backend-developer (sub-agent)
- Execution mode: sequential
- Rationale: D5
- Review: Claude `code-logic-reviewer` subagent
- Tasks: 1 | Depends on: Batch 36a

### Task 36b.1: Ruby resolver and fragment — PENDING

- Files: `WI/ast/import-resolution/ruby-import-resolver.ts` (new), `…/ruby-import-resolver.spec.ts` (new), `WI/ast/languages/ruby.language.ts`, `WIT/matrix/activations/b36b.ts` (new)
- Plan reference: resolution table (Ruby row)
- Pattern to follow: Batch 36a
- Quality requirements: `require_relative` → file; `require` → `lib/` then root
- Validation notes: Ruby keys fail on base 36a
- Implementation details: none

### Batch 36b verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence --skip-nx-cache 2>&1 | tail -40` passes
- validate-deps passes; degradation audit TOTAL 300; other common checks
- FB evidence; the Claude reviewer approves

---

## Batch 36c: C/C++ graph (required; proven on `.c`/`.h`) — DEFERRED (User Decision 27, follow-up task)

- Recommended executor: Codex CLI lane, Lane G2
- Fallback executor: backend-developer (sub-agent)
- Execution mode: sequential
- Rationale: D5
- Review: Claude `code-logic-reviewer` subagent
- Tasks: 1 | Depends on: Batch 36b

### Task 36c.1: C/C++ resolver and fragment — PENDING

- Files: `WI/ast/import-resolution/cpp-import-resolver.ts` (new), `…/cpp-import-resolver.spec.ts` (new), `WI/ast/languages/cpp.language.ts`, `WIT/matrix/activations/b36c.ts` (new); `resolver-context.ts` only if `compile_commands.json` reading is added there
- Plan reference: resolution table (C/C++ row)
- Pattern to follow: Batch 36a
- Quality requirements: `#include "x"` → file dir, then `-I` dirs from `compile_commands.json` (read-only, `-I` only); `<x>` → external; graph proven on real `.c`/`.h` includes
- Validation notes: cpp keys fail on base 36b
- Implementation details: none

### Batch 36c verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence --skip-nx-cache 2>&1 | tail -40` passes
- validate-deps passes; degradation audit TOTAL 300; other common checks
- FB evidence; the Claude reviewer approves

---

## Batch 37a: `go vet` checker (required) — PENDING

- Recommended executor: backend-developer (sub-agent), Lane K (`task-559-lane-k`)
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: Tier 1 execution trust; Claude author with Codex review. **Batch gate (O2): a short reviewed amendment naming the Electron and CLI enable/revoke surfaces, their files and tests exists BEFORE the batch starts**
- Review: Codex CLI lane
- Tasks: 2 | Depends on: O2 amendment reviewed, Batch 25a

### Task 37a.1: Checker runner — PENDING

- Files: `WI/diagnostics/external-checkers/checker-runner.ts` (new), `WI/diagnostics/external-checkers/checker-runner.spec.ts` (new)
- Plan reference: "Tier 1" (Binary, Environment, Execution, Isolation, Consent)
- Pattern to follow: `PC/interfaces/process-spawner.interface.ts:26-28` (NOT `toolchain-probe.ts:115`, which spreads env)
- Quality requirements: canonical realpath from a sanitised PATH (absolute entries, none inside the workspace, symlinks into the workspace rejected); allowlisted env (never spread); 45 s budget; tree kill; 2 MiB cap; consent read fail-closed (`getStorageForWorkspace(root)` → `undefined` → denied; no fallback)
- Validation notes: fake-spawner tests: hostile PATH/env, delayed spawn then timeout, overflow, non-zero exit, cancellation, partial success. No paths or raw error text logged
- Implementation details: FB "hostile PATH entry rejected"

### Task 37a.2: `go vet` checker and hostile fixture — PENDING

- Depends on: Task 37a.1
- Files: `WI/diagnostics/external-checkers/go-vet-checker.ts` (new), `…/go-vet-checker.spec.ts` (new), `…/go-vet-hostile.integration.spec.ts` (new)
- Plan reference: "Fixed invocation", Go env, "Honest not checked", hostile real-binary tests
- Pattern to follow: Task 37a.1
- Quality requirements: `go vet -json <validated package patterns>` only; no caller flags; missing deps / unsupported configs / failed runs → `failed`/`unchecked` with reason; hostile fixture proves no generator, no toolchain switch, no network, no cgo — each by its own observable evidence (skipped with a printed reason when `go` is absent)
- Validation notes: a cgo failure alone never counts as exercising the later cases
- Implementation details: none beyond the plan

### Batch 37a verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence --skip-nx-cache 2>&1 | tail -40` passes (report whether the hostile spec ran or was skipped, with reason)
- validate-deps passes; degradation audit TOTAL 300; other common checks
- FB evidence; Codex review approves

---

## Batch 37b: Checker host wiring + consent surfaces — PENDING (split into 37b1 / 37b2 / 37b3, 2026-09-27)

Decomposed from O2 (`o2-go-vet-consent-surface.md`, current text incl. "Revision (review r1)"; §8 splits 37b three
ways: backend, Electron card, CLI). O2's backend part (37b-i) names ~14 files across 6 projects, which exceeds the
per-batch limit (≤ 6 files, ≤ 2 libs/apps, one scoped command), so 37b1 runs as four ordered units 37b1a-37b1d.
37b2 and 37b3 match O2 37b-ii and 37b-iii. Batch 37b is COMPLETE only when all six units are COMPLETE.

- Lane: K (`task-559-lane-k`, branch `fix/task-559-lane-k`), all units sequential, on top of 37a (fe3648eff)
- Depends on: Batches 37a (committed fe3648eff), 27 (D4)
- Review rule (User Decision 24): one review per unit; fixes from one review are verified by the next review in Lane K
- Consent-end rule (User Decision 25): consent ends when the Go binary changes (`stale/go-changed`); every surface
  shows `stale` with its reason and never treats it as `on`
- `WIT` = `WI/testing/mcp-contract`; `FE` = `libs/frontend/chat/src/lib/settings`; `RH` = `libs/backend/rpc-handlers/src/lib`
- **Real Go not exercised on this machine.** Go is not installed here; `go-vet-hostile.integration.spec.ts` (8 cases,
  incl. the r1 `//line` fixture) is SKIPPED with a printed reason. It must be run once on CI or by the user on a
  machine with Go before the PR opens; 38 / Mode 3 records the result
- **Mode 3 note:** 37b2 adds a rendered Electron card, so the "Visual: no UI change. N/A" completion note no longer
  holds for this task; visual-reviewer evidence (dark + light) for the card is required at completion

### Batch 37b1a: Runner kill fix + provider wiring (WI) — PENDING

- Recommended executor: backend-developer (sub-agent), Lane K
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: first unit touching `checker-runner.ts`; provider and registration are one rollback boundary in one lib
- Review: Codex CLI lane (fallback: Claude `code-logic-reviewer`)
- Tasks: 2 | Depends on: Batch 37a

#### Task 37b1a.1: Runner cleanup-failure fix (37a r1 Moderate, finding 4) — PENDING

- Files: `WI/diagnostics/external-checkers/checker-runner.ts`, `…/checker-runner.spec.ts`
- Plan reference: `reviews/batch-37a-code-logic-review-r1.md` finding 4 (Lane K worktree); O2 §4.3 "Limits"
- Quality requirements: a rejected `killTree` still calls `handle.kill` (fallback in `finally`); the default reaper
  passes an error callback to `killProcessTree` (`PC/utils/process-tree-reaper.ts:63`) so a taskkill failure is
  observed; result text distinguishes "stop requested" from verified termination (`go-vet-checker.ts` "stopped"
  text, fixed wording only)
- FB spec: rejecting terminator → `handle.kill` called once (fails on fe3648eff); default-helper failure reaches the
  observer (fails on fe3648eff)

#### Task 37b1a.2: Attach the checker to the language-aware provider — PENDING

- Depends on: Task 37b1a.1
- Files: `WI/diagnostics/language-aware-diagnostics-provider.ts`, `…/language-aware-diagnostics-provider.spec.ts`,
  `WI/di/register.ts`; `PC/interfaces/diagnostics-provider.interface.ts` only if `unmappedFindings` /
  `diagnosticsTruncated` cannot be carried by the existing coverage/`NotCheckedFiles` fields (then 6 files, 2 libs)
- Plan reference: O2 §2 "DI timing" (store built at registration; spawner as lazy getter), §4.3 "Honest failure",
  §5.4; executor report "For 37b"
- Pattern to follow: Batch 25a registration
- Quality requirements: denied by default; `GoVetConsentStore(WORKSPACE_STATE_STORAGE, { userDataPath })` — confirm
  `PLATFORM_INFO.globalStoragePath` equals the host `userDataPath` (O2 §1.2 assumption) or pass it explicitly;
  merge `GO_VET_COVERAGE` (syntax-only) and keep Tier 0 syntax for every Go file; one failing checker leaves other
  languages intact; forward every 37a reason code (§6 codes, the executor-report extras, and the r1 six:
  `root-unresolvable`, `outside-root`, `build-constraints`, `ignored-name`, `unverifiable`, `unmapped-findings`),
  `notChecked`, `diagnosticsTruncated` and `unmappedFindings`. Uses 37a's `go-file-membership.ts` and
  `go-vet-output.ts` through the checker only; a result with `unmappedFindings > 0` or `reason: unmapped-findings`
  is never surfaced as a clean/"No issues" answer
- FB spec: "checker does not run without consent" (0 spawns, Go `unchecked` + reason); `unmapped-findings` result →
  provider answer not clean; Go checker throw → TS results intact
- Review checklist (verifies the 37a fix round, Decision 24): (1) analysed-files-only credit — missing, build-tagged,
  `_`-prefixed, GOOS/GOARCH-suffixed and cgo files are never in `checkedFiles`; (2) link resolution inside the
  consented root — outward junction to another module spawns nothing / never uses it as `cwd`, cwd is the real
  root; (3) unmapped findings counted — outside-root `posn` gives `findings` + `unmapped-findings`, never `ok`;
  plus the runner Moderate above

#### Batch 37b1a verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence --skip-nx-cache 2>&1 | tail -40`
  (add `@ptah-extension/platform-core` only if the interface file is touched)
- validate-deps; degradation audit TOTAL 300; hostile spec reported as skipped with reason; FB evidence; review approves

### Batch 37b1b: Formatter rendering + spawner adapter proof — PENDING

- Recommended executor: backend-developer (sub-agent), Lane K
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: leaf changes in two libs with no shared files; the formatter consumes 37b1a's provider output
- Review: Codex CLI lane (fallback: Claude `code-logic-reviewer`)
- Tasks: 2 | Depends on: Batch 37b1a

#### Task 37b1b.1: Render Go vet outcomes honestly — PENDING

- Files: `MCP/mcp-core/mcp-response-formatter.ts`, `MCP/mcp-core/mcp-response-formatter.spec.ts`
- Plan reference: O2 §5.4 (consent-off and stale lines, exact text; no quoted token after "from"), §6 reason codes
- Quality requirements: consent off/stale line per state; `unmapped-findings`, `diagnosticsTruncated` and each new
  reason code render as named limitations; Go vet is never labelled type-checked; no VS Code-only wording change
- FB spec: payload with `unmappedFindings: 2` and no diagnostics renders a non-clean answer (fails before)

#### Task 37b1b.2: Spawner adapter proof — PENDING

- Files: `libs/backend/agent-sdk/src/lib/helpers/off-thread-process-spawner.spec.ts`
- Plan reference: O2 §4.1 "Through the spawner adapter", §7.3
- Quality requirements: absolute `…\go.exe` + `['vet','-json','./a']` on win32 → same command/args, no `cmd.exe`,
  no `/d /s /c`, `windowsVerbatimArguments` false

#### Batch 37b1b verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/vscode-lm-tools @ptah-extension/agent-sdk --skip-nx-cache 2>&1 | tail -40`
- validate-deps (Electron bundle scanner: no `from "<x>"` in strings); degradation audit TOTAL 300; review approves

### Batch 37b1c: `diagnosticsConsent` RPC family — PENDING

- Recommended executor: backend-developer (sub-agent), Lane K
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: types, capability, manifest and handler form one contract; 6 files, 2 libs
- Review: Codex CLI lane (fallback: Claude `code-logic-reviewer`)
- Tasks: 1 | Depends on: Batch 37b1a

#### Task 37b1c.1: GET/SET handler, capability and manifest — PENDING

- Files: `libs/shared/src/lib/types/rpc.types.ts`, `RH/host-profile/capabilities.ts`, `RH/host-profile/host-profile.ts`,
  `RH/host-profile/manifest.ts`, `RH/handlers/diagnostics-consent-rpc.handlers.ts` (new), `…/diagnostics-consent-rpc.handlers.spec.ts` (new)
- Plan reference: O2 §3 (GET/SET shapes, error union, check order 1-7), §6 consent audit line, §7.3 handler cases 1-11
- Quality requirements: capability `goVetDiagnostics` appended to `RPC_CAPABILITIES` and `ALL_DISABLED`; strict zod
  params; stale-UI guard `workspace-changed` before any write; success only after read-back; `stale` + `staleReason`
  (incl. `go-changed`, Decision 25) returned by GET; audit only after read-back
- FB spec: handler cases 1-11 against real `WorkspaceAwareStateStorage` + `CliStateStorage` in a temp user-data dir

#### Batch 37b1c verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/shared @ptah-extension/rpc-handlers --skip-nx-cache 2>&1 | tail -40`
- validate-deps; degradation audit TOTAL 300; review approves

### Batch 37b1d: Host profiles and DI wiring (Electron + cli-engine) — PENDING

- Recommended executor: backend-developer (sub-agent), Lane K
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: both hosts enable the capability and pass the lazy spawner getter; wiring specs must fail if missing
- Review: Codex CLI lane (fallback: Claude `code-logic-reviewer`)
- Tasks: 1 | Depends on: Batches 37b1a, 37b1c

#### Task 37b1d.1: Enable the capability and attach the checker in both hosts — PENDING

- Files: `apps/ptah-electron/src/rpc-host-profile.ts`, `apps/ptah-electron/src/di/phase-2-libraries.ts`,
  `apps/ptah-electron/src/di/rpc-surface.spec.ts` (extend, or `phase-2-diagnostics-override.spec.ts`),
  `libs/backend/cli-engine/src/lib/rpc/cli-host-profile.ts`, `libs/backend/cli-engine/src/lib/container.ts`,
  `libs/backend/cli-engine/src/lib/rpc/rpc-surface.spec.ts` (extend, or `container-diagnostics-override.spec.ts`)
- Plan reference: O2 §2 "DI timing" (spawner `SDK_PROCESS_SPAWNER` registered after WI → lazy getter), §3, §7.3 "Host wiring"
- Quality requirements: capability `true` in Electron and CLI profiles, `false` in VS Code; GET answers
  `supported:true`; checker attached; `supported:false` does not satisfy the spec
- FB spec: remove the wiring → both wiring specs fail
- Validation notes: `apps/ptah-cli/src/test-utils/manifest-parity.spec.ts`, if it enumerates methods, is updated in 37b3

#### Batch 37b1d verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p ptah-electron @ptah-extension/cli-engine --skip-nx-cache 2>&1 | tail -40`
- `nx run ptah-electron:validate-deps`; degradation audit TOTAL 300; review approves

### Batch 37b2: Electron consent card (O2 37b-ii) — PENDING

- Recommended executor: frontend-developer (sub-agent), Lane K
- Fallback executor: frontend-developer, fresh invocation
- Execution mode: sequential
- Rationale: one Angular card plus its two host edits; single project
- Review: Codex CLI lane (logic) + visual-reviewer (rendered card, dark + light)
- Tasks: 1 | Depends on: Batches 37b1c, 37b1d

#### Task 37b2.1: "Run `go vet` for this workspace" card — PENDING

- Files: `FE/ptah-ai/go-vet-consent-config.component.ts` (new), `FE/ptah-ai/go-vet-consent-config.component.spec.ts` (new),
  `FE/settings.component.ts`, `FE/settings.component.html` (inside the Electron-only `tools` block)
- Plan reference: O2 §5.1, §7.3 card spec list
- Pattern to follow: `FE/ptah-ai/voice-config.component.ts` + spec (optimistic toggle reverted on failure)
- Quality requirements: GET on init and on `scopeKey()` change via `effect`; stale-response discard; toggle disabled
  while in flight; SET sends the displayed root, `source:'settings-ui'`; fixed message per error; `workspace-changed`
  refetches; `stale` shows its reason; hidden on `supported:false`; timers cleared via `DestroyRef`
- FB spec: the §7.3 card cases

#### Batch 37b2 verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/chat --skip-nx-cache 2>&1 | tail -40`
- Visual-reviewer screenshots (dark + light) of Settings → Tools with the card in off/on/stale; review approves

### Batch 37b3: CLI `ptah config go-vet` + fragment (O2 37b-iii) — PENDING

- Recommended executor: backend-developer (sub-agent), Lane K
- Fallback executor: backend-developer, fresh invocation
- Execution mode: sequential
- Rationale: CLI command group and the matrix fragment; the fragment lands last, once every surface exists
- Review: Codex CLI lane (fallback: Claude `code-logic-reviewer`)
- Tasks: 2 | Depends on: Batches 37b1d, 37b2

#### Task 37b3.1: `ptah config go-vet <status|on|off>` — PENDING

- Files: `apps/ptah-cli/src/cli/commands/config.ts`, `apps/ptah-cli/src/cli/router.ts`, `apps/ptah-cli/src/cli/commands/config.spec.ts`,
  `apps/ptah-cli/src/test-utils/manifest-parity.spec.ts` (only if it enumerates methods)
- Plan reference: O2 §5.2, §7.3 CLI cases
- Pattern to follow: `config autopilot` (`config.ts:398-432`, `router.ts:325-345`), but never exit `0` on a failed change
- Quality requirements: notification `config.goVet`; exit `0` success; `1` on `supported:false` or `success:false`
  (one fixed stderr line); `2` bad sub-command; `5` transport failure; `on`/`off` send GET's root
- FB spec: `success:false` → exit `1`, no success notification

#### Task 37b3.2: Matrix fragment — PENDING (deferred to the integration branch, 2026-09-27)

- Depends on: Task 37b3.1; Lane K merged into `fix/task-559-mcp-tool-contract` (the orchestrator decides and runs the
  merge; executors never run git)
- Why deferred: Lane K (HEAD d61fc1d2b) does not contain the Batch 27 harness (`WIT/activation-fragment.ts`,
  `WIT/required-keys.ts`, `WIT/language-honesty.contract.spec.ts`); a fragment written in Lane K cannot be
  verified there, and unverified code is not accepted
- Files: `WIT/matrix/activations/b37b.ts` (new), `WIT/language-honesty.contract.spec.ts` (add the
  `HONESTY_CHECKS['typeCheck:go']` entry; without it "every activated, locally-owned key has an entry" fails)
- Quality requirements: activates `typeCheck:go` only; fails on the base before the merge. The honesty check asserts
  what 37b1a/37b1b guarantee: Go answers carry `checks:'syntax-only'` / `go:syntax-only` and are never labelled
  type-checked; consent off/stale → Go `unchecked` with the reason; `unmapped-findings` never renders clean
- Verification: `nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence --skip-nx-cache` on
  the integration branch after the merge

#### Batch 37b3 verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p ptah-cli --skip-nx-cache 2>&1 | tail -40` (37b3.1 in
  Lane K); 37b3.2 verifies separately on the integration branch as stated above
- validate-deps; degradation audit TOTAL 300; FB evidence; review approves; hostile real-Go spec still pending a CI/user run

---

## Batch 38: Completion gate — PENDING

- Recommended executor: senior-tester (sub-agent), Lane T
- Fallback executor: backend-developer
- Execution mode: sequential
- Rationale: fails until every enumerated required key is active and every mandatory batch has landed
- Review: Codex CLI lane
- Tasks: 1 | Depends on: Batch 21 (21.1, 21.2), 27, 28b, 29b, 30, 30k, 31, 33, 34 (34.1 C# only), 37b (all required).
  User Decision 27: 34.2 (Java graph), 35, 36a, 36b, 36c are DEFERRED to a follow-up task — the gate's required
  keys drop the java/rust/php/ruby/cpp graph keys and instead assert those languages are disclosed as unsupported
  by ptah_get_dependents / ptah_get_dependencies (never a clean empty answer)

### Task 38.1: Activated keys == required keys, exactly — PENDING

- Files: `WIT/language-honesty.contract.spec.ts`
- Plan reference: "Harness (27, 38)"; "Required keys" table
- Pattern to follow: Task 27.2
- Quality requirements: the union of all fragments equals the enumerated required keys exactly, including the ten honesty keys, kotlin keys, php/ruby/cpp graph keys and `typeCheck:go`
- Validation notes: fails on any earlier base (shown by removing one fragment locally, then restored)
- Implementation details: none
- Gate list additions: Batch 24a r1 M2 — `ast.parse`/`queryFunctions`/`queryClasses`/`queryImports` report the parse
  honesty signal on recovered parses (landed in 24c); the gate fails if any of the four returns a clean-looking result
  for a recovered parse

### Batch 38a: carried fixes before the gate — COMPLETE

- RESUME POINT 2 step 3 items (a), (b), (c). Author: backend-developer subagent. Report `batch-38a-executor-report.md`.
- (a) protocol-dispatcher "slow empty build" flake: raced real filesystem I/O in the graph build; the spec now awaits
  the build promise, with a slowed-realpath pin (5 sequential + 10 parallel runs clean; suite `--maxWorkers=1`).
- (b) Lane K finding 5: `packageDirForId` → `packageDirsForId`; `[pkg.test]` ids map exactly; an ambiguous bare
  `foo_test` id disqualifies both candidates (no credit on a guess).
- (c) 37b1d Minor: Electron and cli-engine wiring specs dispose the logger channel, wait for close/error, then remove
  the temp dir in `finally`. 175 `ptah-*-govet-*` dirs from earlier runs remain in `%TEMP%` (outside the repo; not
  deleted without user approval).
- Review r1 (`reviews/batch-38a-code-logic-review-r1.md`, Codex, resumed Lane K session): REVISE 7/10 — Lane K
  finding 5 CLOSED; R38A-01 Moderate (teardown skipped cleanup on a failed channel/stream). One bounded correction
  (unconditional teardown + regression); no further review per the reviewer and Decision 24.
- Team-leader verification (2026-09-28): ptah-electron, cli-engine, workspace-intelligence, vscode-lm-tools
  test/lint/typecheck pass; audit TOTAL 300.

### Batch 38 verification

- `node_modules/.bin/nx run-many -t=test,lint,typecheck -p @ptah-extension/workspace-intelligence @ptah-extension/vscode-lm-tools --skip-nx-cache 2>&1 | tail -40` passes
- validate-deps passes; degradation audit TOTAL 300; other common checks
- FB evidence; Codex review approves

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
