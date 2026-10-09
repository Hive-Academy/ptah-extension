# Task Context - TASK_2026_619_af7f

## User Request

"these are heavy false claims , i thought our own ptah tools was measured and could have clear score for codebase indexing and memory searching as well, but it seems like its a degradation of what the agent already has ? how we should be fixing this properly ? and i did asked before to have a clear benchmark that's fact evidence on each performance of our important tools how can we do so as well"

Earlier in the same conversation: "we will need to be intelligent about the tools schema we defer so agent can have the tools that would save them times and context".

## Task Type

BUGFIX (quality regression of the ptah MCP tools against the native Grep/Glob/Read tools)

## Complexity

Complex — code index, relevance ranker, reference and dependency tools, memory search, MCP transport, CI benchmark, eager/deferred tool selection.

## Strategy

BUGFIX, Full depth: researcher-expert (per-tool forensics + benchmark design) → team-leader Mode 1 (plan-free) → implementation batches → QA.

- Phase 1: build the benchmark and record the current scores. The benchmark must fail on today's code where the live tests below show a loss.
- Phase 2: fix each tool against the benchmark until it meets its prompt claim. Then select the eager set (`protocol-dispatcher.ts:609-628`) from the scorecard.

## CLI Lanes

Gate 0.1 (user, 2026-10-06): **Mode: enabled — lanes implement too.** Claude subagents research and own the documents. The team-leader may recommend CLI lanes as batch executors (file-disjoint batches, agent-lanes §8 cap). Reviews run on the opposite execution side from the author (Claude-authored → Codex lane; lane-authored → Claude subagent reviewer).

Roster (`ptah_agent_list`, 2026-10-06):

| Agent | Type | Status |
| ----- | ---- | ------ |
| codex | cli | installed |
| copilot | cli | disabled (installed) |
| cursor | cli | not installed |
| antigravity | cli | installed |
| opencode | cli | installed |
| pi | cli | not installed |
| Glm | ptah-cli | available (Ollama Cloud, ptahCliId pc-355b645d-35af-4974-84cf-9cf961ea0164) |

**Lane choice (user, 2026-10-07, overrides earlier per-batch lane assignments):** from now on use only the **codex** and **grok** CLI lanes for lane work. Do **not** use opencode or Glm until the user says otherwise. grok is installed (`ptah_agent_list`, 2026-10-07). Cross-side review rules are unchanged.

**Lane roles (user, 2026-10-07, later the same day; overrides the line above where they differ):** to save the orchestrator's (Claude) quota, rely on the lanes more:
- **codex = planner and reviewer** (decomposition input, plans, code-logic and code-style reviews).
- **grok = implementor** (batch execution).
- Claude subagents only where no lane can do the work, or as a fallback after a lane fails twice. The orchestrator itself only coordinates, runs the scoped gates and makes bounded corrections.
- Review of grok-authored code by codex is a CLI-to-CLI (same-side, different-family) review. The user pinned it, so it is allowed; it is labelled as such in each review file.
- An author never reviews its own work: codex-authored code (for example the Batch 11 probe fix) is reviewed by grok or a subagent, not by codex.

| Phase | Executor | Deliverable |
| --- | --- | --- |
| Research | researcher-expert subagent (may use lanes for separate aspects) | `research-report.md` |
| Decomposition | team-leader subagent | `batches.md` |
| Implement | per batch: subagent or lane, as `batches.md` recommends | code + batch report |
| Phase review | opposite side of the implementer | `code-logic-review.md` |

## Workspace

All work runs in the worktree `D:\projects\ptah-extension\.claude-worktrees\task-619-tool-benchmark` on branch `fix/task-619-tool-benchmark` (user request, 2026-10-06). The branch was fast-forwarded to `origin/main` 7910f34cf after the research; none of those 20 commits touched the files the research report cites. Every path given to an agent must be under this worktree.

## User Decisions (2026-10-06)

1. **Keep the prompt claims unchanged.** `ptah-core-prompt.ts`, `tool-description.builder.ts`, and the substitution table are the contract. Fix the tools until they meet the claims. Do not weaken a claim. Where a claim cannot be met, report it and ask.
2. **One task, benchmark first.** Phase 1 = benchmark + current scores. Phase 2 = fixes against it.

## User Decisions — Gate SR on research-report.md Clarifications Needed (2026-10-06)

1. **References for languages other than TS/JS:** build one generic, host-neutral language-server manager (Node, `vscode-jsonrpc` / `vscode-languageserver-protocol`), with per-language recipes borrowed from Serena SolidLSP (MIT part only; Serena's application is GPL — do not copy it) and microsoft/multilspy, and install recipes informed by mason-registry. **In this task: TS/JS, Python (pyright) and Go (gopls).** A server starts only for a language present in the workspace and uses the user's toolchain; when a toolchain is absent the answer is labelled approximate. Rust, C/C++, Java/Kotlin, C#, Ruby and PHP go to a follow-up task that reuses the same manager.
2. **Cold start ("faster"):** warm the language service at session start in a separate process with a memory ceiling, so most calls use the warm path.
3. **Coverage ("far cheaper in context"):** one coverage line when clean; the full block only when coverage is not clean.
4. **Dependents ("blast radius") for other languages:** derive from the same language-server manager for live answers; TS/JS use exact module resolution. Use SCIP indexers (scip-typescript, scip-python, scip-go) as cross-check ground truth in the benchmark, not as a runtime backend (no incremental mode). Do not build on GitHub stack-graphs (archived 2025-09-09). Languages without a running server are reported as partial with coverage.

## Evidence (live tests, 2026-10-06, this repository, Electron/desktop host)

| # | Question | ptah result | Native result |
|---|---|---|---|
| 1 | Which task spec fixed the ptah tools? | `ptah_relevance_rank_files`: 10 wrong files, every reason "Filename contains …", all scores 48, `.md` files tagged "Test file matches query context" | Grep + `git log --grep` found TASK_2026_559 |
| 2 | Definition of `markEagerTools` (`protocol-dispatcher.ts:710`, 4 months old) | `ptah_code_search_symbols`: not found | Grep: exact line |
| 3 | Definition of `applyToolResultBudget` (`tool-result-budget.ts`) | not found; filePath filter on both files returns zero hits, while a filter on another file works | Grep: exact line |
| 4 | Concept "character budget of a tool result" | wrong area (frontend constants) | Grep `\w*Budget\w*` finds `getToolResultBudget` |
| 5 | References of `getToolResultBudget` | `ptah_lsp_references`: mechanism `text-scan`, capped at 50 | Grep: 53 in 14 files |
| 6 | Dependents of `protocol-dispatcher.ts` | `ptah_get_dependents`: `building` 3 times (6912 files) | Grep: 12 files |
| 7 | Find `tool-description.builder.ts` | `ptah_search_files`: correct | Glob: correct |
| 8 | Structure of `tool-result-budget.ts` | `ptah_ast_analyze`: correct, compact | Read: whole file |
| 9 | Past decision recall | `ptah_memory_search`: works; spill path was `D:\projects\seshat\.ptah\tmp\…` (workspace scope to verify) | — |

Other observations: the code-search coverage block is all `null` / `census?` (about 350 tokens per call); one `ECONNRESET` on `ptah_code_search_symbols`; index age about 19.8 h.

## Why earlier measurements missed this

- `libs/backend/workspace-intelligence/src/testing/mcp-contract/mcp-contract.bench.spec.ts` (TASK_2026_559 batch 20.2): small synthetic fixture, in-process services, no index lifecycle, no transport. Its relevance test (`:817`) uses 3 files whose names contain the query words, so a filename-only ranker passes.
- `ptah_code_search_symbols` and `ptah_memory_search` are not in that benchmark.
- TASK_2026_473 track A memory measurement: 4 hand-graded queries, one run, not in CI.
- `scripts/build-eval-harness.ts`: self-consistency proxy (a stored chunk queries itself).
- TASK_2026_559 research report rated `ptah_relevance_rank_files` "Works" (P2 only).

## Benchmark requirements (Phase 1)

- Pinned commit of this repository (real sizes; `protocol-dispatcher.ts` has 3,940 lines).
- Independent ground truth, generated, not hand-graded where possible: TS compiler API declarations (symbol search, ast/enrich recall), JSDoc first sentence → owning symbol (concept search), TS language service `findReferences` (references), TS module resolution (dependents), merged-PR title → changed non-test files (relevance recall@10), seeded memory facts + paraphrases in a clean DB + two-workspace isolation (memory).
- A scripted native baseline (rg / Glob / Read) for every question, same metrics. Score = delta to native.
- Metrics: hit@1, hit@5, MRR, recall@10, precision, result tokens (gpt-tokenizer), calls per answer, p50/p95 latency, error rate.
- Lifecycle scenarios: cold start, edit a file then query, add a file then query, large file, two workspaces.
- Calls through the real MCP transport (stdio or HTTP), not only in-process.
- Output: `scorecard.json` + Markdown table per run, kept per release. CI gate: a tool that scores below its native baseline fails.

## Phase 2 fix scope

1. Code index: why changed/large files lose their symbols; truthful coverage.
2. `ptah_relevance_rank_files`: content BM25 + symbol index, not file names.
3. `ptah_lsp_references` / `ptah_get_dependents`: real TS language service on Electron/CLI; warm the dependency graph at session start.
4. New `ptah_search_text` (ranked ripgrep, compact output) to close the text-search gap.
5. `ptah_memory_search`: workspace scope and recall.
6. Eager/deferred selection from the scorecard (`protocol-dispatcher.ts:609-628`).

## User Decision — real-DB guard with a running desktop app (2026-10-06)

Problem (Batch 3 report lines 42, 64): the user's running Ptah desktop app writes `~/.ptah/state/ptah.sqlite-wal` about once a minute, so the hash guard fails every overlapping local run even when the bench wrote nothing.

Decision: **watch the bench process.**
- Before the run, detect a concurrent writer (another process holds the real DB, or the `-wal` changes during a short pre-sample).
- No concurrent writer → guard mode `hash` (unchanged: SHA-256 + mtime + size before and after).
- Concurrent writer → guard mode `process-watch`: no hash comparison; during the run and at the end, sample the open file handles of the bench host process tree, and fail if any bench process holds a path under the real `~/.ptah`. Isolation layers 1-4 stay mandatory.
- CI (`CI=true`) always uses `hash`; a concurrent writer in CI is an environment failure.
- The guard mode is recorded in the scorecard run metadata.

## Orchestrator Decision — shared scorecard schema with TASK_2026_620_a13e (2026-10-06)

Request from the TASK_2026_620 session (memory + skills benchmark). Decision: 619 adds a generic core to `tools/mcp-bench/src/scorecard/` in ONE small batch inserted right after Batch 4, still `schemaVersion: 1` (no baseline committed yet):
1. `claim: { source: 'prompt' | 'tool-description' | 'ledger' | 'code'; ref: string; text?: string }`.
2. `suite.kind: string` + `suite.details`, validated by a registry `registerSuiteKind(kind, zodSchema)`; 619 registers `retrieval`; unknown kinds fail validation; a kind may supply a Markdown renderer.
3. `groundTruth: { id; version; method: 'generated' | 'labelled' | 'seeded' | 'git-history'; raterCount?; frozenAt? }` and `suite.arm?: string`.
4. `baselines: Array<{ id; label; metrics }>` and `deltas: Record<baselineId, Record<metric, number | null>>`; `native` is one baseline id.
5. `cost: { calls; latency_ms: { p50; p95 }; error_rate; tokens: { result_p50?; input?; output?; billed? } }`.
6. `artifacts: Array<{ kind; path; sha256; schemaId }>`.
7. `run.guardMode: 'hash' | 'process-watch'`.
619 is the only writer of `scorecard.types.ts` and `scorecard-writers.ts`; 620 registers its own kinds (curation, rubric/agreement) in its own files and branches from the SHA of that batch. Also: `-shm` added to the hash guard (Task 4.2).

### Addendum (2026-10-06) — second round of TASK_2026_620 requests

- Batch 4b revision 1 also adds `cost.source: 'live' | 'cassette' | 'none'` (required) and an optional `suite.projectionSha256` (64 hex) with a core helper `computeProjectionSha256(projection)` (SHA-256 over canonical JSON).
- Batch 4c adds: a helper module next to `bench-host.entry.ts` exporting `assertIsolatedEnvironment()` and `bootCodeExecutionHost({ workspace, beforeEngineBoot?, afterContainerReady? })`, which the entry itself uses; and `tools/mcp-bench/src/bench-data.ts` with `resolveBenchDataDir()` for `PTAH_MCP_BENCH_DATA_DIR` (default `%LOCALAPPDATA%\ptah-mcp-bench`, `~/.cache/ptah-mcp-bench` elsewhere), rejecting a path under the real `~/.ptah` or inside the repository.
- 620 code lives in `tools/mcp-bench/src/memory-skills/`; 620 may add only the targets `build-host-memory-skills` and `bench-memory-skills` to `tools/mcp-bench/project.json`. Committed fixtures in `tools/mcp-bench/fixtures/memory-skills/` must hold no user data; private snapshots stay in the bench data folder.
- Pure offline computation in the runner parent is allowed if it reads only committed repo files and the bench data folder, never the real `~/.ptah`.

## User Requests (2026-10-07)

1. **Open a PR when the task finishes** (base `main`, branch `fix/task-619-tool-benchmark`). Never merge it.
2. **Use the other lanes, not only Codex.** Until Batch 4d every lane batch ran on Codex (the "strongest coding lane" default, with no evidence for it in this repository). From Batch 5 on, the orchestrator assigns lanes by role and records lane evidence (revision rounds, review defects, duration, checks) for a final per-lane table:
   - Batch 5 → codex; Batch 6 → Glm (ptah-cli), in parallel with 5 if the two are file-disjoint (team-leader confirms; otherwise a separate worktree).
   - Batch 7 → opencode (self-contained; opencode has no messaging, so no `ptah_agent_report` and no mid-run steering).
   - Batch 8 → Glm.
   - Phase 1 code-logic review: subagent reviewers for lane-authored code (1, 2, 4b, 5-8); a lane reviewer (antigravity, which authored nothing) for subagent-authored code (3, 4, 4c, 4d, 9-11).

## User Decision — relevance ground-truth source (2026-10-07)

Finding (Batch 6 finish): the paged GraphQL fetch returned 643 merged PRs before the pin. 192 change more than 100 files, 195 change no source file, and only 93 change 1-8 eligible source files. The strict rule in `relevance-questions.ts` (every changed file must be eligible source) keeps 1. Non-merge commits reachable from the pin give 1,683 candidates with 1-8 eligible source files.

Decision: **PRs + commits.** A PR qualifies when it changes 1-8 eligible source files; its other changed files (docs, specs, lockfiles) are ignored, and the truth is the eligible files. Non-merge commits (subject = query, same file rule) fill the set to the most recent 200 `test` questions, the rest `tune`. Each question records `source: 'pr' | 'commit'`. Method stays `git-history`. The `gh` fetch is paged (GraphQL, 25 per page); CI still reads only the frozen JSON.

## User Decision — SCIP indexers (2026-10-07)

Install `scip-typescript`, `scip-python` and `scip-go` as global user tools; the repository `package.json` stays unchanged. `scip-python` runs only in WSL Ubuntu-24.04 (nvm Node 22 under `/root/.nvm`), because it crashes on Windows. SCIP stays benchmark ground truth only (Gate SR decisions 1 and 4).

## Workspace hygiene (2026-10-07)

- `ptah_task_create` writes to the Ptah MCP server's workspace root, which is the MAIN checkout, not this worktree. The orchestrator created TASK_2026_622_2d05 that way and then moved it into this worktree at the user's request. Include `.ptah/specs/TASK_2026_622_2d05/` in the next commit on this branch.
- Rule for the rest of this task: no agent or lane writes anything in `D:\projects\ptah-extension` outside `.claude-worktrees\task-619-tool-benchmark`. After any `ptah_task_create`, move the new folder into this worktree at once.
- **New Phase 2 item (user request, 2026-10-07): worktree-aware task tools.** `ptah_task_create/update/get/list/check` resolve their root through `deps.getWorkspaceRoot()` (`libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/tasks-namespace.builder.ts:677`), the session-aware resolver (declared URL root → caller session → active session → provider root; `ptah-api-builder.service.ts:992-1018`). The resolver works as designed — this session's root is the main checkout — but no task tool can target a git worktree, so a session that works in a worktree writes its task folders to the main checkout. Fix: an optional `workspaceRoot` argument on the five task tools, validated at the boundary to be the repository's main checkout or one of its registered git worktrees (`git worktree list --porcelain`), else rejected; the default stays the session root. Add a benchmark lifecycle check: create a task with a worktree root, assert the folder lands in the worktree and nothing changes in the main checkout. Place it with Fix 7 (session-aware spool root, Batch 34), which touches the same root-resolution area. The team-leader adds it to batches.md at its next Mode 2.

## User Decision — no full "before" baseline (2026-10-07, fourth session)

- The Batch 11 full runs never completed (attempt 1 voided by the PID-reuse guard false positive; attempt 2 got `^C` at 93 min in the cli-headless relevance phase, Electron never started).
- User decision: do not restart them. The pre-fix product is "mostly broken any way". The only full run is the one in Batch 36 (full rescore, after the fixes). The Batch 11 smoke scorecards and `tools/mcp-bench/baseline/gate-baseline.json` (all rows `recorded-failure`, commit 285ce9855) stay the only "before" evidence.
- Effect: the per-batch bench smoke checks deferred "until the full runs end" can run again, one at a time. TASK_2026_620 was told that "619 Batch 11 runs done" will not come.

## Conversation Summary

- 2026-10-06: the user opened a second session (`ptah-ptah-extension-skills-trajectory-an-10a89600005aw2q23htdi0c`) to apply the same benchmark-first method to memory curation and the skills trajectory. Boundary: this task owns `ptah_memory_search` as a retrieval tool (scope, isolation, worktree scope, spill root, recall@k via MCP). That session owns curation/extraction quality and the skills trajectory. `tools/mcp-bench` metrics and the scorecard schema are shared; that session must ask before it changes them.

- The user observed that agents seldom use more than one or two ptah tools despite the prompt rules.
- A side-by-side test in this session scored native tools 6, ptah 2, equal 1.
- The user wants fact-based evidence of each important tool's performance, and an intelligent eager/deferred tool split that saves time and context.
