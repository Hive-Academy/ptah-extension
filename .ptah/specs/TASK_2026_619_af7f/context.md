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

## Conversation Summary

- 2026-10-06: the user opened a second session (`ptah-ptah-extension-skills-trajectory-an-10a89600005aw2q23htdi0c`) to apply the same benchmark-first method to memory curation and the skills trajectory. Boundary: this task owns `ptah_memory_search` as a retrieval tool (scope, isolation, worktree scope, spill root, recall@k via MCP). That session owns curation/extraction quality and the skills trajectory. `tools/mcp-bench` metrics and the scorecard schema are shared; that session must ask before it changes them.

- The user observed that agents seldom use more than one or two ptah tools despite the prompt rules.
- A side-by-side test in this session scored native tools 6, ptah 2, equal 1.
- The user wants fact-based evidence of each important tool's performance, and an intelligent eager/deferred tool split that saves time and context.
