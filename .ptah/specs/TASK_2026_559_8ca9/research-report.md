# Research Report - TASK_2026_559 (merged)

## Question

- Decision this supports: which fixes team-leader should batch (and in what
  order) to restore every `ptah_*` MCP tool to the token-saving contract the
  shipped prompts (`ptah-core-prompt.ts`, `tool-description.builder.ts`,
  `NATIVE_AGENT_TOOL_POLICY`) already promise, with a regression harness that
  fails CI if it slips again.
- Question: across all 55 tools in the live `tools/list`, which work,
  which are degraded, which are broken; what's the root cause and the
  regressing commit (or "never met") for each; what shared-layer fix closes
  the most tools at once; and what makes the failure repeatable and
  CI-visible.
- Bounds: no production code changed by this report; no raw session logs
  read; five source reports (`research/cross-cutting.md`, `code-intel.md`,
  `workspace-files.md`, `agent-task-harness.md`, `browser.md`) are the only
  inputs besides two spot-checks done here (`surface-tools.ts`,
  `surface-tools.spec.ts`, and `TASK_2026_560_2ae5/task.md`) to close the
  coverage gap the five reports left open.

## Executive summary

55 tools total. **19 broken/degraded, 36 work** (2 of the 36 — the surface
tools — are cost-degraded, not functionally broken). Five root causes explain
almost everything broken:

1. **`code_symbols` SQLite index built once (2026-05-27), never auto-refreshed.**
   Breaks `code_search_symbols`, `lsp_definitions` and (secondarily) the
   description text of `lsp_references`. No MCP tool can trigger a reindex.
2. **No shared result budget at `createToolSuccessResponse`.** Lets
   `get_symbol_index` (663k chars), `task_list` (223k chars), `get_diagnostics`
   (historically 1.08M chars), `agent_read` (p95 496k chars) and browser
   `screenshot`/`evaluate` (unbounded base64/stringified output) all ship
   unbounded through the one choke point every text tool already shares.
3. **No language inference in `context_enrich_file`.** `language` is optional,
   nothing infers it from the extension, so every call with no explicit
   `language` returns the full file — 0% reduction against a "large token
   reduction" contract, since day one (`2b537f44c`, 2026-05-15).
4. **No server `instructions` and no caller identity in `tools/list`.**
   `handleInitialize` returns none; `tools/list` is dispatched outside
   `runWithMcpRequestContext` entirely, so there is no attachment point for a
   per-caller profile even though `_callerAgentId` is already parsed off the
   URL and simply dropped.
5. **`detectNodeProjectType` checks `react` before `@angular/core`.** An
   attempted fix (`e4e2a7bd6`, 2026-09-22) added an `angular.json`-first guard
   that only covers single-app Angular CLI projects, not Nx monorepos with
   dependencies aggregated at the root — the exact shape of this repo, so
   `ptah_workspace_analyze`, mandated "call FIRST," still answers `react` here.

**Why did nobody notice.** The only size-shaped assertion in either
`mcp-core` or `mcp-http`'s 18 existing spec files is one description-length
check (`tool-description.builder.spec.ts:25`). No spec anywhere asserts a
tool's *output* size, a recall rate against a native equivalent, or a token
budget. CI (`nx affected -t test`, `.github/workflows/ci.yml:182`) runs those
18 specs and would pass today even with every P0 in this report live,
because nothing in CI compares a tool's answer to Grep/Read/`git status` on
size or correctness — that comparison only ever happened as a manual, non-CI
audit script (`C:/Users/abdal/.ptah-token-audit/mcp/bench.py`).

## Coverage check

Cross-cutting's inventory lists 55 tools (53 measured in the 2026-09-25 audit
+ `ptah_surface_update` + `ptah_surface_get_state`, added by `cbdf37543`,
2026-09-24, after the audit's baseline). The four sibling reports
(code-intel, workspace-files, agent-task-harness, browser) together cover
exactly the 53-tool baseline — every one of those 53 appears in exactly one
sibling report's summary table (owner-group split confirmed by hand-count:
10 + 12 distinct + 20 + 11 = 53, `ptah_count_tokens` intentionally covered by
both code-intel.md and workspace-files.md, which is overlap, not a gap).

**Uncovered by all five reports: `ptah_surface_update`, `ptah_surface_get_state`.**
Neither sibling report claims them (cross-cutting explicitly marks their
sizes "unmeasured, source-estimated" and assigns no verdict). This report
closes the gap by reading `surface-tools.ts` and `surface-tools.spec.ts`
directly (see Per-tool table, rows 54-55, and Local consequences).

## Per-tool table

Legend: **Broken** = fails its contract now; **Degraded** = works but
unbounded/wrong on cost or a secondary claim; **Works** = contract met.
"Depends on" points at a Shared fix number (below) or another tool row.

| # | Tool | Verdict | Root cause | Regression / never-met (commit) | Fix | Guard | Priority | Depends on |
|---|---|---|---|---|---|---|---|---|
| 1 | `ptah_ast_analyze` | Works | — | — | — | existing spec | — | — |
| 2 | `ptah_context_enrich_file` | **Broken** | No extension→language inference; optional `language` silently falls back to full file | Never met, since introduction `2b537f44c` (2026-05-15) | Infer language from `EXTENSION_LANGUAGE_MAP` at dispatcher/namespace boundary; tag genuine parse failures with `reason:'parse-failed'` | `analysis-namespace.builders.spec.ts`: no-`language` call on `.ts` returns `mode:'structural'` | **P0** | — |
| 3 | `ptah_code_search_symbols` | **Broken** | `code_symbols` built once, never auto-refreshed; `mcp-core` subtree has 0 rows; no MCP tool exposes `reindex()` | Standing gap; `84657c380` (2026-09-15) hardened existing triggers w/o adding an automatic one | Expose `ptah_code_reindex`; governed background reindex on staleness; return freshness fields; exact-name boost | `code-symbol.store.spec.ts` exact-name recall bench (≥90% top-5); staleness check on `MAX(updated_at)` | **P0** | Shared #4 (index freshness) |
| 4 | `ptah_get_symbol_index` | Degraded (unbounded) | No `limit`/`pathPrefix` param on tool or `DependencyGraphService.getSymbolIndex` | Unbounded by design since introduction | Add `pathPrefix`/`limit`, `{truncated,shown,total}` trailer | New case asserting default cap | **P0** | Shared #3 (result budget) |
| 5 | `ptah_get_dependencies` | Works | Cold-start latency only (audit-sourced, not reproduced) | — | Pre-warm graph at server start | Latency assertion post-fix | P2 | — |
| 6 | `ptah_get_dependents` | Works | Same | — | Same | Same | P2 | — |
| 7 | `ptah_lsp_definitions` | **Broken** | Electron's `resolveDeclaration` reads the same stale `code_symbols` table; description falsely claims "VS Code LSP" unconditionally | `e035f08a3` (2026-06-23) rewrote Electron impl without updating description written in `2b537f44c` (2026-05-15) | Fixing #3's index freshness fixes this too; add import-resolution fallback independent of index; fix description text | New `electron-ide-capabilities.spec.ts` case against a seeded fixture index | **P1** | Row 3 |
| 8 | `ptah_lsp_references` | Works | — | — | Fix "VS Code LSP" overclaim (cosmetic, host-dependent) | Shared fixture with row 7 if that fix lands | — | — |
| 9 | `ptah_relevance_rank_files` | Works | Reason-builder doesn't dedupe repeated query terms | Not isolated to a commit | Dedupe matched terms before formatting reasons | Repeated-word query spec | P2 | — |
| 10 | `ptah_count_tokens` | Works | — | — | — | existing coverage | — | — |
| 11 | `ptah_workspace_analyze` | Degraded | `detectNodeProjectType` checks `react` before `@angular/core`; `angular.json`-first guard only covers root-level Angular; `renderDirectoryTree` has no depth/entry cap, `tmp/` unexcluded | `e4e2a7bd6` (2026-09-22, attempted fix, incomplete for Nx monorepos); bug present since `2b537f44c` (2026-05-15), exposed since `ea36c1a72` (2026-06-12) | Gate project-type on `monorepoDetector.detectMonorepo()` first; cap tree depth/entries; drop "Use this FIRST" until fixed | Fixture: root deps span 2 frameworks + no root `angular.json` + real multi-app Nx tree, asserting `projectType !== 'react'`; char-budget spec for a 500-file flat dir | **P1** | — |
| 12 | `ptah_search_files` | Degraded | `formatSearchFiles` prints `files.length` with no truncation flag | Long-standing, none identified | Request `limit+1`, pass `atLimit` into formatter, append notice | Formatter spec: truncation marker when `results.length===limit` | P2 | — |
| 13 | `ptah_get_diagnostics` | Mostly fixed, one open regression | Main-thread blocking + workspace-wide scoping **fixed** (worker offload, per-file scope); a worktree-scoped single-file call still hits the 45s budget for an unconfirmed reason; output has no cap | `e70130bf5` (2026-08-30) fixed scoping/blocking; worktree-scope timeout newly confirmed live, no regressing commit identified | Diagnose worktree timeout with direct worker timing before fixing; cap `formatDiagnosticList` output | Diagnostics-provider contract run against a real second worktree, parity within a fixed budget | **P1** (worktree) / P2 (cap) | Shared #3 (cap only) |
| 14 | `ptah_get_dirty_files` | Works | — | — | — | — | — | — |
| 15 | `ptah_project_detect_monorepo` | Works | — | — | — | — | — | Reference answer for row 11's fix |
| 16 | `ptah_json_validate` | Works | — | — | — | — | — | — |
| 17 | `ptah_memory_search` | Works | — | — | — | — | — | — |
| 18 | `ptah_web_search` | Works | — | — | — | — | — | — |
| 19 | `ptah_git_worktree_add` | Works | — | — | — | — | — | — |
| 20 | `ptah_git_worktree_list` | Works | — | — | — | — | — | — |
| 21 | `ptah_git_worktree_remove` | Works | — | — | — | — | — | — |
| 22 | `execute_code` | Works (`ptah.help` tested; `ptah.ide.actions`/`ptah.memory.*` unverified) | — | — | — | — | — | — |
| 23 | `ptah_dashboard_propose_spec` | Works, cost-degraded | Recursive `z.toJSONSchema` output is 12.5k chars, always-on, undeferred on every Codex lane request | None; size since origin `0277e328e` | Keep always-on; hand-author a minimal `$ref`-free schema + `ptah.help('dashboard')` pointer for detail | Schema char-budget spec (`dashboard-propose-spec.tool.spec.ts`) | **P1** | Shared #3 (`_meta` size hint) |
| 24 | `ptah_agent_spawn` (resume path) | Degraded | `resumeThread` reuses `buildTaskPrompt` unchanged; full system/role prefix resent on every resume | Gap since origin `80d26911d`; TASK_2026_557 RC3 measured 40.7% of Codex input as resumed-task overhead | Skip `systemPrompt`/`projectGuidance`/role when `resumeSessionId` is set | Spec: resumed prompt excludes system-prompt text | **P1** | — |
| 25 | `ptah_agent_status` | Degraded | "ONE-OFF check" contract has no code enforcement | Gap since origin | 60s repeat-status throttle, "unchanged since t" | Spec: 2nd call <60s returns short body | P2 | — |
| 26 | `ptah_agent_read` | **Broken** | No default `tail`; unbounded buffer returned unless caller passes `tail` | Gap since origin `80d26911d`; measured p95 496k chars | Default `tail` (e.g. 200 lines) + `truncated`/`totalLines` | Spec: no-`tail` call on >200-line buffer truncates | **P0** | Shared #3 pattern |
| 27 | `ptah_agent_message` | Works | — | — | — | existing specs | — | — |
| 28 | `ptah_agent_report` | Works | "call once" not enforced but no measured waste | None | Optional: count + downgrade repeats | None proposed | — | — |
| 29 | `ptah_agent_stop` | Works | — | — | — | — | — | — |
| 30 | `ptah_agent_list` | Works (live-verified, 660 chars) | — | — | — | — | — | — |
| 31 | `ptah_task_create` | Works | — | — | — | — | — | — |
| 32 | `ptah_task_update` | Works | — | — | — | — | — | — |
| 33 | `ptah_task_get` | Works (live-verified) | — | — | — | — | — | — |
| 34 | `ptah_task_list` | **Broken** (live-reproduced, 223,297 chars) | No `limit`/`fields`/`cursor`; full `description` text always returned | Gap since origin `f80fa299c`, exposed by growth to 235 tasks | `limit=25` default, `fields:'summary'` default (drop `description`), cursor | Spec: >100 tasks, default call ≤25 rows/≤8k chars | **P0** | Shared #3 pattern |
| 35 | `ptah_task_check` | Unverified | Same unbounded-array shape as row 34, unmeasured | — | Cap `invalid`/`excluded` arrays if measured at scale | None proposed pending data | P2 | Row 34 |
| 36 | `ptah_dashboard_propose_spec` | *(see row 23)* | | | | | | |
| 37 | `ptah_harness_search_skills` | Works (local correct; marketplace ranking external) | skills.sh's own `/search` ranking, not a Ptah defect | — | Optional client-side re-rank/cutoff | None proposed | — | — |
| 38 | `ptah_harness_list_installed_mcp` | Works (live-verified, 10 servers) | — | — | — | — | — | — |
| 39 | `ptah_harness_install_mcp_server` | Unverified, no negative signal | — | — | — | — | — | — |
| 40 | `ptah_harness_propose_config` | Unverified, no negative signal | — | — | — | — | — | — |
| 41 | `ptah_harness_create_skill` | Unverified, no negative signal | — | — | — | — | — | — |
| 42 | `ptah_harness_search_mcp_registry` | Unverified, no negative signal | — | — | — | — | — | — |
| 43 | `approval_prompt` | Works | — | — | — | — | — | — |
| 44 | `ptah_browser_navigate` | Works | — | — | — | — | — | — |
| 45 | `ptah_browser_content` | Works | Already capped (`MAX_TEXT_LENGTH=32KB`) | — | — | `mcp-response-formatter.spec.ts:578` (exists) | — | — |
| 46 | `ptah_browser_screenshot` | Degraded | Shipped with no output cap on the `image` block or the duplicate base64 text path | Never regressed, never capped since `9beb66e4e` (2026-05-24) | Skip inlining when `saveTo` set; auto-offload above a ceiling; default jpeg/quality; drop duplicate `onToolResult` re-encode | New size-assertion cases in formatter + dispatcher specs | **P1** | — |
| 47 | `ptah_browser_evaluate` | Degraded | Result stringification has no size cap; bypasses `content`'s 32KB cap | Never capped since `9beb66e4e` | Apply the same 32KB-style budget to `formatBrowserEvaluate` | Rewrite the test that currently pins unbounded output + add over-cap case | **P1** | — |
| 48 | `ptah_browser_network` | Works | Capped in capability layer (`MAX_NETWORK_ENTRIES=500`) at capture and read time | — | — | — | — | — |
| 49 | `ptah_browser_click` | Works | — | — | — | — | — | — |
| 50 | `ptah_browser_type` | Works | — | — | — | — | — | — |
| 51 | `ptah_browser_status` | Works | — | — | — | — | — | — |
| 52 | `ptah_browser_close` | Works | — | — | — | — | — | — |
| 53 | `ptah_browser_record_start` | Works (by inspection) | — | — | — reference pattern for row 46's fix | — | — | — |
| 54 | `ptah_browser_record_stop` | Works (by inspection) | — | — | — same reference pattern | — | — | — |
| 55 | `ptah_surface_update` | Works, cost-degraded — **UNCOVERED by all 5 reports, verdict added here** | Description is 3,782 source chars (measured directly: `node -e` slice between `description:`/`inputSchema:`, matches cross-cutting's own estimate exactly), always-on, no namespace guard; no char-budget spec exists (`surface-tools.spec.ts` has no length assertion, unlike `tool-description.builder.spec.ts:25`) | None; size since origin `cbdf37543` (2026-09-24, TASK_2026_538) | Same class as row 23: shrink the always-on description/schema or add a namespace toggle for hosts that never use surfaces | Add a char-budget spec to `surface-tools.spec.ts` | P2 | Shared #3/#4 |
| 56* | `ptah_surface_get_state` | Works, self-bounded by design — **UNCOVERED by all 5 reports, verdict added here** | Description 1,573 source chars (measured), always-on; response itself IS bounded in code (`maxStateReadBytes`, truncation marker documented in the description and enforced by the surface-state reader per `surface-state-reader.ts`'s `SURFACE_READER_MIN_STATE_READ_BYTES`) — this tool is the one place in the whole inventory that already ships the pattern shared fix #3 proposes elsewhere | None; size since origin `cbdf37543` | Shrink always-on description size only; no output-cap fix needed (response is already bounded) | Add a char-budget spec for the *description*, keep the existing response-bound behavior as the reference pattern | P2 | Shared #3/#4 |

\* Numbered 56 for clarity in this table only; the true count is 55 tools (row
36 is a duplicate pointer to row 23, not a distinct tool).

## Shared fixes (do these first)

Ordered by dependency. Each closes multiple rows above at once — a
team-leader should NOT let per-tool batches duplicate this work.

1. **Server `instructions`** (no order dependency). Generate from
   `PTAH_MCP_SUBSTITUTION_SECTION` (`ptah-core-prompt.ts:31`), truncated to
   fit Codex's ~512-char read window, returned from `handleInitialize`
   (`protocol-dispatcher.ts:235-253`). Guard: spec pinning the Codex variant
   stays under 512 chars and is derived from, not copied from, the constant.
2. **Fix `get_diagnostics`'s output cap** (row 13) — do this *before* item 3's
   global cap touches this tool, or truncation hides the signal instead of
   explaining it (already partly moot: scoping is fixed at HEAD; only the
   worktree-timeout diagnosis and the missing display cap remain open).
3. **Global result budget** at `createToolSuccessResponse`
   (`protocol-dispatcher.ts:2019-2032`) — the one choke point every text
   response in rows 1-55 already passes through. Default cap (e.g. 8k chars),
   cut at last newline, trailer. Rows 4, 26, 34 (`get_symbol_index`,
   `agent_read`, `task_list`) have no offset/limit param today, so
   "no information loss" requires adding a minimal param to those three
   first, or spooling full output to `.ptah/tmp/mcp-out/<toolCallId>.txt` and
   naming the path in the trailer. Declare the budget in `tools/list` via
   `_meta['anthropic/maxResultSizeChars']`. **Order dependency: land item 2
   for `get_diagnostics` before wrapping it in this cap.**
4. **Per-caller tool profiles.** Add `callerAgentId` to `McpRequestContext`
   (`mcp-request-context.ts:21-32`); thread it the same way
   `_callerSessionId`/`_callerWorkspaceRoot` already are; move `tools/list`
   inside `runWithMcpRequestContext` or otherwise expose caller identity to
   `handleToolsList` (`protocol-dispatcher.ts:196-197`). Build a stable,
   ordered profile table analogous to `SLOT_SPECS`
   (`ptah-mcp-slots.ts:158-175`). **Order dependency: read
   `TASK_2026_560_2ae5` before finalizing `McpRequestContext`'s shape** (see
   Contradictions, below — that task needs the same plumbing and a second,
   incompatible shape means redoing this). Guard: byte-for-byte `tools/list`
   output stability per profile (prompt-cache requirement), and a spec
   proving a malformed/unrecognized caller gets the most restrictive profile.
5. **Index freshness mechanism for `code_symbols`** (closes rows 3, 7, and
   improves row 8's description accuracy). Expose `ptah_code_reindex`
   (wraps the existing `ns.code.reindex()`, `code-namespace.builder.ts:163-195`,
   currently unreachable from MCP); on staleness (empty or
   `MAX(updated_at)` older than a threshold) and app-idle, kick a governed
   background `indexWorkspace(..., {userInitiated:false})`; return
   `indexedFiles`/`indexAgeMs` in `code_search_symbols` responses so a caller
   can tell "stale index" from "genuinely not found." **This is the one
   shared fix with an open numeric-default decision — see Clarifications.**
6. **Deferral/eager set** — no code change; confirmed
   `ALWAYS_EAGER_TOOLS`/`IDE_EAGER_TOOLS`/`SQLITE_EAGER_TOOLS`
   (`protocol-dispatcher.ts:398-417`) and the Codex forced-un-defer
   (`codex-cli.adapter.ts:618-627`) both still match intent. Guard: a spec
   (or a comment) that fails loudly if Codex's
   `tool_search_always_defer_mcp_tools` is ever flipped back to default.
7. **Regression harness** — see dedicated section below. **Order
   dependency: write after items 1-5 land**, or the harness pins today's
   broken behaviour as the new baseline.
8. **Runtime telemetry** — log per-tool result size/latency/success at the
   same choke point item 3 instruments. Land together with item 3. Guard:
   keep at `debug`/metrics channel, not `info` (the file's own history notes
   an `info`-level per-request log became "the highest-volume writer" and had
   to be demoted — `protocol-dispatcher.ts:181-184`).

### Per-tool fixes grouped by file ownership (file-disjoint batches)

- **`context-enrichment.service.ts` + `analysis-namespace.builders.ts`**: row 2 only. No dependency on shared fixes.
- **`code-symbol-indexer.service.ts` + `code-namespace.builder.ts` + `code-symbol.store.ts`**: rows 3, 7 (depends on shared #5).
- **`dependency-graph.service.ts` + `protocol-dispatcher.ts` (symbol-index case)**: row 4 (depends on shared #3).
- **`project-detector.service.ts` + `workspace.service.ts` + `mcp-response-formatter.ts` (`renderDirectoryTree`)**: row 11. Independent.
- **`mcp-response-formatter.ts` (`formatSearchFiles`)**: row 12. Independent.
- **`type-script-diagnostics-provider.ts` + `ts-diagnostics-worker.ts`**: row 13 (diagnose first, see Clarifications; cap depends on shared #3).
- **`cli-adapter.utils.ts` + `codex-cli.adapter.ts`**: row 24. Independent.
- **`agent-process-manager.service.ts`**: row 26. Independent (but should copy shared #3's trailer shape).
- **`tasks-namespace.builder.ts` + `tool-description.builder.ts`**: rows 34, 35. Independent (but should copy shared #3's trailer shape).
- **`dashboard-propose-spec.tool.ts`**: row 23. Independent.
- **`surface-tools.ts`**: rows 55, 56. Independent; small (2 files touched: `surface-tools.ts`, `surface-tools.spec.ts`).
- **`protocol-dispatcher.ts` (browser screenshot/evaluate cases) + `mcp-response-formatter.ts`**: rows 46, 47. Independent of each other's exact fix but share the same size-budget helper — write it once, use twice.
- **`electron-ide-capabilities.ts`**: row 7's fallback-resolution part (independent of the index fix, can land in parallel).

## Regression harness (merged design)

One design, assembled from all five reports' proposals:

- **Home:** new spec files under
  `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/` (or
  sibling owning libs — `memory-curator`, `workspace-intelligence` — for
  tools whose defect is in the service layer, not the dispatcher), run by
  the existing `test` target (`vscode-lm-tools/project.json`) — already
  covered by `nx affected -t test` in `.github/workflows/ci.yml:182`. **No
  new Nx target or CI workflow is needed**, only new spec content.
- **Fixture:** a small, checked-in fixture workspace reproducing at least
  one adversarial case per tool class: a multi-tsconfig diagnostics case
  (row 13), a real second worktree (row 13's specific open defect), an
  exact-symbol-name lookup seeded into `code_symbols` (rows 3, 7), a
  large/flat directory (500+ files) for `workspace_analyze` (row 11) and
  `get_symbol_index` (row 4), a >100-task-folder fixture for `task_list`
  (row 34), and a >200-line agent output buffer for `agent_read` (row 26).
- **Benchmark axes, per tool named in `PTAH_MCP_SUBSTITUTION_SECTION`:**
  size (bytes/tokens vs. the native equivalent — Grep/Read/`git status`) AND
  recall/correctness (does the ptah tool find what the native tool finds,
  at what rank). This mirrors the manual `mcp/bench.py` methodology every
  sibling report cross-checked itself against, formalized into a spec that
  fails, not just logs, on regression.
- **CI wiring:** `nx affected -t test` already triggers these specs on any
  PR touching `mcp-core`, `memory-curator`, or `workspace-intelligence`.
  Must fail the build (not warn) — the missing-size-assertion gap in the
  existing 18 specs is exactly what let every row above ship silently.
- **Runtime telemetry (shared fix #8):** per-tool result size, latency and
  success/error logged at the `createToolSuccessResponse`/`toolErrorResponse`
  choke points, at `debug`/metrics level, so a live regression shows up in
  aggregate without another manual audit pass.
- **Order dependency:** write the harness *after* shared fixes 1-5 land, or
  it locks in today's broken numbers as "correct."

## Contradictions and conflicts

- **`get_diagnostics`'s claimed mechanism.** The researcher brief this task
  handed to `workspace-files.md`'s author described the current state as
  "filters by project only" and implied main-thread blocking
  (citing `core-namespace.builders.ts:207-245` and the generic slow-call
  timing wrapper at `protocol-dispatcher.ts:492-502`). Reading the source
  directly shows this is **stale**: `e70130bf5` (2026-08-30) already moved
  the compile to a `worker_threads` Worker and added per-file scope
  resolution, confirmed independently by a matching prior-session memory hit
  (`type-check-offload-b3`). **Resolved by source read, in favor of
  `workspace-files.md`**: main-thread blocking and unscoped-only compilation
  are both fixed at HEAD. Cross-cutting's own evidence table (line 54,
  citing `e70130bf5`'s CLAUDE.md addition) independently confirms the
  "floor, not filter" design is intentional, which is consistent with, not
  contradictory to, `workspace-files.md`'s finding — both agree `files` *is*
  passed through as a tsconfig-resolution scope, just not as an output
  filter. No real disagreement between the two reports; the brief that fed
  one of them was outdated.
- **Owner-group assignment for `ptah_project_detect_monorepo`.**
  `cross-cutting.md`'s inventory table lists it under the "code-intel" owner
  group; `code-intel.md` explicitly disclaims it ("registered under the same
  `'code'` doc-comment group... but is a workspace-detection tool... left to
  the workspace-owning group"), and `workspace-files.md` is the report that
  actually covers it. **Resolved in favor of `code-intel.md`'s explicit
  disclaimer + `workspace-files.md`'s coverage** — this is a bookkeeping
  correction to `cross-cutting.md`'s table, not a coverage gap (the tool
  itself was verified live, working, exactly once).
- **Tool-count baseline (53 vs 55).** `cross-cutting.md` already flags this
  itself: the prior audit's live measurement (53 tools) predates
  `cbdf37543` (2026-09-24), which added the 2 surface tools. Not a
  disagreement between reports — a time gap, and this report's own read of
  `surface-tools.ts` (rows 55-56 above) closes the resulting coverage hole.
- **Interface `TASK_2026_560_2ae5` needs from shared fix #4.** Read directly
  (`TASK_2026_560_2ae5/task.md`, no `context.md` exists yet): that task must
  let a user toggle each MCP server/skill on or off **per workspace**, with
  Ptah enforcing the effective set at session-build time for Claude SDK,
  proxied, and every CLI-lane adapter, and must show each enabled server's
  token cost. That is the same `McpRequestContext`/caller-identity plumbing
  shared fix #4 proposes building — **560 does not need a second design**,
  it needs 559's per-caller profile table to carry a `workspaceRoot →
  effective tool/namespace set` dimension, not just an `agentId`/`sessionId`
  one, and it needs the `_meta['anthropic/maxResultSizeChars']`-style size
  hint (shared fix #3) so its "show token cost" UI can read a size without
  a live measurement. **Recommendation for whoever designs #4's table:**
  key it on `(callerKind, workspaceRoot, agentId?)` from the start, not just
  `callerKind`, so 560 can layer its on/off list on top without redefining
  the table's shape.

## Clarifications Needed

1. **`code_symbols` reindex trigger mechanism (shared fix #5).** Options:
   (a) file-watcher-triggered incremental reindex on every save-equivalent
   event server-wide (most current, highest background cost); (b) lazy,
   on-demand background reindex on the first `code_search_symbols`/`lsp_definitions`
   call per session when the index is empty or older than a staleness
   threshold, governed to not compete with a live turn (code-intel.md's
   proposal — **Recommended**, reuses the existing governor wiring from
   `84657c380`); (c) manual-only, but expose `ptah_code_reindex` so an agent
   that gets 0 hits can self-heal without a human UI click (minimal, but
   leaves the index stale between calls). What staleness threshold (e.g.
   24h) counts as "needs reindex" is also unset — needs a number.
2. **Global result-budget default size (shared fix #3).** Cross-cutting
   proposes 8k chars as an example, not a decision. Needs a number (or a
   per-tool-class table) and a choice between (a) a cursor/offset param
   added to the 3 currently-unbounded no-arg tools (`get_symbol_index`,
   `task_list`, `agent_read`'s no-`tail` case) vs (b) spooling full output to
   `.ptah/tmp/mcp-out/<toolCallId>.txt` and naming the path in a trailer —
   cross-cutting frames both as zero-information-loss but they have very
   different caller ergonomics. **Recommended:** (a) for tools with a
   natural page unit (task rows, symbol-index entries, agent-output lines),
   (b) only as a fallback for tools where no natural page unit exists.
3. **`ptah_browser_screenshot`'s default transport (row 46).** The proposed
   fix changes default behavior for *all* clients, not just non-vision ones:
   auto-save-and-path-only above a size ceiling, and dropping the duplicate
   `onToolResult` re-encode. Is changing the default output shape (not just
   adding a cap) acceptable under "no quality loss," given vision-capable
   clients currently get the inline image free? **Recommended:** keep
   inlining by default for the model-visible response (preserves vision
   quality), but drop only the duplicate `onToolResult` re-encode (browser.md
   confirms this feeds a frontend-only stream, not the model's context) and
   default `format` to `jpeg`+`quality:60` instead of `png` — smallest change
   that closes the biggest measured cost (Codex avg 117,442 chars/call)
   without touching the vision-client contract.
4. **Editing per-tool description text vs. the three named contract files.**
   The task states "the prompts are correct... do not weaken them" naming
   `ptah-core-prompt.ts`, `tool-description.builder.ts`, and
   `NATIVE_AGENT_TOOL_POLICY`. Several fixes above (rows 7, 8) require
   editing *individual tool description strings inside*
   `tool-description.builder.ts` (the "using VS Code LSP" overclaim) — not
   the shared prompt constants that file also builds. **Is this in scope as
   a bug fix (correcting an overclaim), or does it count as "the contract"
   and need separate sign-off?** Recommended: in scope — the claim is
   already false on the Electron build today, so correcting it closes a gap
   rather than weakening a promise that's currently kept.
5. **`tools/list` moving inside `runWithMcpRequestContext` (shared fix #4).**
   This changes the request lifecycle for every `tools/list` call, not just
   adds a field. Options: (a) move it fully inside the existing context
   wrapper; (b) duplicate just the URL-parsing `handleToolsList` needs
   without changing its dispatch path. (b) is lower-risk/smaller diff but
   creates two code paths that read caller identity differently.
   **Recommended:** (b) first, revisit (a) only if a second consumer (e.g.
   TASK_2026_560) needs more than caller identity inside `tools/list`.

## Installed build vs HEAD

- **`ptah_get_diagnostics` main-thread blocking / unscoped-only compilation
  (row 13).** The task's own framing (and the researcher brief that produced
  the first draft of `workspace-files.md`) described this as a live defect.
  It is **not** — `e70130bf5` (2026-08-30) fixed it well before HEAD
  (`9afac1aa2`, 2026-09-25), and `workspace-files.md`'s live probe against
  the running server (confirmed same-HEAD build, no drift) reproduces the
  *fixed* behavior for the ordinary scoped/unscoped cases. **Do not schedule
  a fix for main-thread blocking or workspace-wide-only scoping — schedule a
  verification only** (re-run the diagnostics contract against HEAD to
  confirm no drift before closing this line item). The genuinely open defect
  is narrower: a worktree-scoped single-file call still hits the 45s wall,
  newly confirmed live, root cause not yet diagnosed — that part is a real,
  schedulable fix (see row 13, Clarification-adjacent: needs a timing repro
  before a fix, not before a verification).
- **`tools/list` tool count (53 vs 55).** The prior audit's 53-tool,
  62,996-char baseline is a build-vs-HEAD artifact, not a bug: it was
  captured before `cbdf37543` (2026-09-24) added the 2 surface tools. **Do
  not schedule a "fix" for the count being wrong — schedule a re-run of
  `mcp/toolslist.py` against a HEAD build** to get a verified 55-tool
  byte size before shared fix #3's budget numbers are finalized.
- **Everything else in this report was reproduced live, on HEAD, in this
  session** (code-intel.md, workspace-files.md, agent-task-harness.md's live
  probes, and browser.md's live probes all state their build/HEAD match
  explicitly) — no other row in the Per-tool table is a stale-build
  artifact.
