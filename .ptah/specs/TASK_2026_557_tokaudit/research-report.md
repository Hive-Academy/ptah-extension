# TASK_2026_557: Token usage audit (Codex, Claude, proxied and lane providers) and Ptah MCP adoption

Window: session files modified on or after 2026-09-21 (analysed 2026-09-25). Evidence folder: `C:/Users/abdal/.ptah-token-audit`
(digests, scripts, `review_*` re-checks). Tokens marked "est." are chars/4 or replay estimates. Savings from different fixes
overlap and **do not add up**.

## 1. Executive summary

- **Almost all usage is context sent again on every request, not generation.** Cached reads are 63% of weighted Claude usage
  (655.9M input-equivalents) and 54.8% of Codex list-price credits. Codex input:output is 188:1. Cache hit is already
  93-99%, so better hit ratios can recover at most about 9-10%. What drives cost is prompt size × request count.
- **RC1: no context budget.** Ptah leaves the Claude auto-compact window null (0 Claude auto-compactions; 89% of main-stream
  input is sent at ≥150k context, peaks at 674-708k). It passes no `model_auto_compact_token_limit` to Codex, which compacts at
  p50 237k. Replays: about -30% main / -18% subagent (Claude, weighted) and -15-17% (Codex credits) (est.).
- **RC2: tool output enters whole and is never evicted.** Re-sent tool output is about 54% of Codex input (est.); visible
  whole-file read dumps alone are 33.5%. On Claude, tool results are 23.5% of every request's context, and Read is 55.7% of that.
- **RC3: orchestration multiplies contexts.** Subagents are 45.9% of Claude tokens. Ptah role lanes are 73% of Codex input.
  Resumed lane tasks carry 40.7% of Codex input, and poll-only wake-ups add 9.6%.
- **RC4: monolithic spec files** (batches.md up to 210,767 chars) are read whole at agent start: 222.5M Claude tokens re-sent
  (about 4.9% weighted), plus about 11% of Codex input.
- **RC5: Ptah MCP is neither the cheapest nor the most discoverable path.** It is 3.7% of Claude tool calls and 15.9% of Codex
  tool actions. The server sends no `instructions`. Codex code mode spends an estimated 7-8% of its input rediscovering ptah tools.
  Flagship tools under-deliver: enrich returned the full file in 36/36 calls, symbol search found 0/7 exact names, and
  diagnostics results are unfiltered and reached 1.08M chars.
- **First actions:** set compaction budgets (Wave 0/3), cap tool output at entry (Wave 0/3), fix the ptah server's
  instructions, diagnostics and enrich (Wave 1), and split spec files and gate lane resumes (Wave 4).

## 2. Measured baseline

### 2.1 Usage by provider (window 09-21..09-25)

| Provider / route | Requests | Tokens | Cache hit | Source |
|---|---|---|---|---|
| Claude models via Ptah SDK (all entrypoint `sdk-ts`) | 19,918 | 4,223M (cache_read 4,103M, create 102.5M, out 17.7M) | 0.976 (main 0.988 / sub 0.962) | claude_digest.md:42, compaction/claude_analysis.txt |
| GLM/Kimi (ollama-cloud / moonshot, Anthropic-native) | 2,034 | 253.0M (corrected; digest says 353M) | 0.927 corrected | cache/claude_cache.py (CE6, CL-5) |
| Codex rollouts (gpt-6-astra 3,280 req, gpt-5.6-sol 274) | 3,554 | 380.7M in (361.0M cached) + 2.0M out (0.42M reasoning) | 0.948 | codex_digest.md:6,41-42 |
| Antigravity lanes (39 sessions, 38 Ptah-spawned) | 3,411 model calls | about 211M input (est.) | n/a | other_digest.md |
| OpenCode lanes (26 sessions) | n/a | 1.70M in + 14.0M cache-read + 239K out ($5.94) | n/a | other_digest.md |
| Memory curator (gpt-5.6-luna via CuratorProxyManager) | 711-854 launches | unlogged; most passes stalled before dispatch | unknown | orch_curator_rl.py, CE7 |
| Copilot / Cursor / Qwen / Gemini | 0 activity since 09-21 | - | - | other_digest.md |

### 2.2 By entrypoint / originator

| Stream | Tokens / input | Share |
|---|---|---|
| Claude main streams | 2,533M (10,646 req, avg ctx 237k) | 54% of Claude |
| Claude subagent (sidechain) streams | 2,045-2,070M (11,306 req, avg ctx 180k) | 45.9% of Claude |
| Codex `codex_sdk_ts/exec` (Ptah lanes) | 324.8M input | 85.3% of Codex |
| Codex Desktop thread + its subagent (user, outside Ptah) | 49.7M input | 13.1% (Ptah adapter fixes cannot reach it) |
| Codex `codex_sdk_ts/subagent` (nested lane subagents) | 6.2M input | 1.6% |

### 2.3 By day (UTC)

| Day | Claude req | Claude tokens | Codex req | Codex input |
|---|---|---|---|---|
| 09-21 | 2,604 | 609M | 595 | 60.3M |
| 09-22 | 5,153 | 1,234M | 1,156 | 129.0M |
| 09-23 | 6,957 | 1,425M | 1,248 | 121.8M |
| 09-24 | 6,280 | 1,152M | 344 | 39.5M |

(claude_digest.md:32-35, codex_digest.md:23-26. Claude 09-22 includes the GLM double count corrected in 2.1.)

### 2.4 Cost structure

- Claude, weighted at list prices (read 0.1x, 5m write 1.25x, 1h write 2x, output 5x): 655.9M input-equivalents =
  reads 63.4%, writes 22.7%, output 13.8%. Real misses are 44.1M tokens (about 9.1%). 86% of the misses are subagent
  idle resumes (cache/claude_cache.py, CE1/CE4).
- Codex at GPT-6 Sol credit rates (50/5/250 per 1M): cached 54.8%, uncached 29.9% (first request 2.07M, new suffix 10.56M,
  misses 6.82M), output 15.3% (cache/codex_cache.py, CE1).
- All subagent cache writes use the 5m TTL (78.9M) and all main writes use the 1h TTL (25.3M). Ptah sets neither TTL (CE4).

### 2.5 Fixed overhead per request (first request, median)

| Route | First request | Main components |
|---|---|---|
| Claude main | 52.3k (opus-5-5), 63.4k (opus-5), 74.2k (sonnet-5) | preset + tools; Ptah append 24.5k chars (about 6.1k tok); skill_listing about 21k chars; CLAUDE/nested memory 18-28k chars |
| Claude subagent | 31.5-36.7k | preset, agent body, listings |
| Proxied GLM/Kimi | 83.5k (corrected) | no tool deferral (0/40 streams); davinci-resolve about 28k, firecrawl 13k, shopify 8.5k, ptah 15.9k tokens of schemas |
| Codex lane | 26.4k (max 41.7k) | base prompt 21.4k chars, skills catalog 17.9k, role prompt about 14k, project guidance 12.6k, about 9.5k tok of tool defs |

Sources: first_call_overhead.txt, codex_digest.md:100-110, prompt_assembly.md, cache/proxy_defer.py. Measured as
min(first ctx, ctx), the session-start prefix is 23.6% of Claude main, 19.5% of subagent, 66.5% of proxy and 25.3% of Codex
prompt tokens. This is an upper bound on what trimming can remove (CE2).

### 2.6 Codex weekly limit (limit_id=codex, 10080-min window)

- 16% on 09-21, 100% at 2026-09-22T17:16Z, reset, then 87% by 09-24T10:31Z (codex_digest.md:54-65). The real consumption
  is **about 171 points**, not the 240 "sum of increases": concurrent sessions interleave stale values and produce 73
  decreases (review_cache/rl_check.py).
- 352.7M rollout tokens in the window: about 0.49 points per 1M tokens, so roughly 206M tokens fill one week (est.).
- Hourly regressions disagree by about 2x (0.24/1.56/30 vs 0.44/0.77/46 %/M for cached/uncached/output). **Use list-price
  credit shares, not fitted points.** One session (01a0c855, SDK lane) moved the meter 27 points on its own.
- The curator's effect on the codex bucket is not measurable: 13 lane-idle gaps with 247-409 curator launches moved it +2 points.
  Whether gpt-5.6-luna draws on a separate bucket is untested (CE7).

## 3. Root causes ranked by impact

### RC1: No context budget on any runtime (impact: largest; confidence high on mechanism, medium on size)
- **Evidence.** compaction-config-provider.ts:61 initialises `contextTokenThreshold = null`. auto-compact-control.ts:78-86
  returns `{}`, and Ptah logs show `autoCompact {}` in 88/88 option builds. Claude: 0 auto-compactions; all 16 compactions were
  manual at p50 385k. 36/60 main streams peak above 200k, and subagent streams reach 708.5k (compaction/claude_analysis.txt).
  Codex: codex-cli.adapter.ts:605-638 sets only mcp_servers, `features` (:627) and developer_instructions (:636). 12 real
  compactions ran at p50 237.2k of a 258.4k window, and ~/.codex/config.toml sets no compaction key (CL-2).
- **Mechanism.** Each request re-reads the whole history at the cache-read rate. 89% of Claude main input is sent at ≥150k context.
- **Size (est.).** Claude T=200k replay: main -30% and subagent -18% weighted, after pricing the 1h rewrite (CL-1 corrected).
  Codex 120k limit: -30% raw, -15-17% of credits (CL-2). Rework is under-modelled: after the proxy auto-compactions, 58% of
  Reads re-read earlier files.

### RC2: Tool output is dumped whole and stays in context (confidence high)
- **Codex.** Re-sent tool output is 205M, 53.9% of input (est., bloat/codex_bloat.py). Visible whole-file and multi-file read
  cells account for 1,409 cells, 20.29M chars and 127.4M re-sent (33.5%; review_bloat/chk2.py). Cells that request 2,501-16,000
  max_output_tokens carry 118.1M of the 143.0M shell re-send. No tool_output_token_limit is set anywhere (TOB-1).
- **Claude.** Live tool results are 23.5% of summed context (18.2% main, 29.7% subagent). By tool: Read 587M (55.7%),
  Bash 285M, Grep 78M. 482 Reads of 20k+ chars carry 239M. Only 98 Reads were true re-reads (6.7M), so each read is too big,
  not repeated too often. The env built at sdk-query-options-builder.ts:993-1008 sets no output caps. post-tool-use-hook-handler.ts:63-108
  always returns `{continue:true}`, even though `updatedToolOutput` exists (sdk.d.ts:2576-2583) (TOB-3, TOB-4, CL-3).
- **Age.** 70% of re-sent Claude tool tokens come from results more than 20 requests old. Clearing them saves only 3-6% weighted,
  because each clear rewrites the prefix at 12.5-20x the read rate (compaction/clear_sim.txt).
- Tool-use inputs are also re-sent: Write 95.8M, Edit 56.4M, Bash commands 81.2M (est.). Only compaction reaches these.

### RC3: Orchestration fan-out, resumes and polling multiply contexts (confidence high on volume, medium on addressability)
- **Fan-out.** Subagent streams used 2,070M (45.9% of Claude): frontend-developer 676M, backend-developer 370M, code-logic-reviewer 244M.
  Role lanes used 278M (73% of Codex input). None of the 15 `.claude/agents/*.md` files sets tools, disallowedTools or maxTurns (ORCH-1).
- **Resumes.** 99/314 ptah_agent_spawn calls resume a lane. Later tasks in Ptah lanes used 154.9M (40.7% of Codex input) at 133k
  per request, against 88.5k for first tasks. codex-cli.adapter.ts:666-669 resumes with no size check and re-prepends the guidance
  (cli-adapter.utils.ts:495-498). The addressable part is at most 52M and more likely 25-40M (est., ORCH-2).
- **Claude subagent idle resumes.** 139 rebuilds 5-60 min after the previous request, 34.67M tokens at gap p50 11 min. 115 of them
  were SendMessage resumes (CE4).
- **Polling.** 360 poll-only Codex lane requests used 36.5M (9.6%). Codex clamps exec yield to about 31s: 43 calls that asked for
  120-300s returned at median 31.0s (review_orch/rv_yield.py). On the Claude side, 207 status/sleep-only parent turns caused 46.3M
  of the next request's context (ORCH-3).
- **Budgets are advisory only.** The "40 tool calls per lane" limit is text only (agent-lanes SKILL.md:219). 27.8M of Codex input
  came after request #40 of a task. One OpenCode run looped through 11,722 empty glob calls (ORCH-6).

### RC4: Monolithic spec files read whole at agent start (confidence high)
- batches.md averages 90k chars (max 210,767) and implementation-plan.md 65k (max 168,480). Claude read spec files 1,019 times,
  14.43M chars, 222.5M re-sent (about 4.9% weighted). 643 of those reads happen within a stream's first 10 requests.
  Codex spec-read cells: 353 cells, 42M re-sent (11.0% of input) (TOB-2, ORCH-4).
- **Cause.** `.claude/agents/backend-developer.md:37-40` names batches.md as the "primary input"; 15 agent files and
  team-leader.template.md (25 mentions) do the same. Handoff is by folder pointer only (cli-adapter.utils.ts:517-518).
  About 37% of spec chars already come from ranged reads, so a realistic cut is 50-70%.

### RC5: Ptah MCP is not the cheapest or most discoverable path (confidence high)
- **Share.** Claude: 983-1,002 ptah calls, 3.7% of all tool calls (314 are agent_spawn). Code-intel tools are 0.96% of main
  and 0.62% of subagent calls, even though they are eager and mandated (adoption/cc_adopt.out). ptah_search_files was used 46 times,
  against 2,880 Grep, 2,169 shell grep and 214 Glob calls. Codex: 542 calls, 15.9% of tool actions. Antigravity 3.6%; OpenCode 0/12,374.
- **(a) No guidance channel.** handleInitialize returns no `instructions` (protocol-dispatcher.ts:235-253). Lanes get a two-line
  policy (cli-adapter.utils.ts:409-415). Codex sessions with a `## Role:` block used ptah code-intel in 57/59 sessions; sessions
  without one in 3/41. PTAH_SYSTEM_PROMPT (21.5k chars) is exported but never injected (mcp_surface.md).
- **(b) Discovery cost in Codex code mode.** 232 `ALL_TOOLS.filter(/ptah_/)` cells in 87/100 sessions printed 4.83M chars
  (188 printed full descriptions). That is about 26-32M re-read tokens, 7-8% of Codex input (est., ADOPT-2).
- **(c) Tools under-deliver, so agents learn to avoid them.** context_enrich_file returned the full file in 36/36 calls,
  because `language` is not inferred (analysis-namespace.builders.ts:88-93, context-enrichment.service.ts:117); with the language
  set it saves 87-94%. code_search_symbols found 0/7 exact names, yet the prompt makes it MANDATORY before Grep
  (ptah-core-prompt.ts:31,59; tool-description.builder.ts:1710). workspace_analyze says "Use this FIRST" (:321), averages 15.9k
  chars in Codex (96% of it the directory tree) and reports the project as "react". git status is mapped to get_dirty_files
  (ptah-core-prompt.ts:44). lsp_definitions returned 0 results in 2/2 probes (ADOPT-4).
- **(d) Output too large on the tail.** get_diagnostics filters by project only (core-namespace.builders.ts:208-244), with no
  per-file filter or cap. Codex: 116 calls; median 234 chars but max 1.08M (17,501 errors, likely worktree tsconfig resolution);
  up to about 9M model-visible re-read tokens (ADOPT-3, TOB-5). Only formatBrowserContent has a cap
  (mcp-response-formatter.ts:1142). get_symbol_index returns 663k chars, task_list 221k, and agent_read has a p95 of 496k.
- **(e) No primitive for the biggest workloads.** There is no markdown heading outline, section read or content grep
  (search_files is a filename glob), so even a fully compliant agent falls back to Read or cat (ADOPT-1).
- **Deferral is not the main cause for Claude code-intel:** 131/132 ToolSearch calls were exact `select:` loads, mostly agent_*.
  Re-enabling deferral for Codex would cut adoption: codex-cli.adapter.ts:618-626 records that agents then said no ptah tools existed.

### RC6: Surface and fixed-prefix bloat (confidence high for proxied sessions; impact 3-7% upper bound)
- tools/list has 53 tools, 63.0k chars (about 15.7k tokens). dashboard_propose_spec alone is 15.2k chars. There is no per-caller
  profile (protocol-dispatcher.ts:288).
- Proxied sessions lose Claude Code tool search (custom base URL): 40/40 streams had no deferral. `.claude/settings.local.json:2`
  sets `enableAllProjectMcpServers: true`, so davinci-resolve, firecrawl and shopify schemas appear in 38, 39 and 35 of 39 proxy
  files (CE3). A 12-tool profile would save about 11k tokens × 2,034 requests ≈ 22M (est., ADOPT-5).
- Codex lanes inherit 12 desktop plugins plus a 17.9k-char skills catalog. Ptah-CLI lanes append project guidance twice and load
  the 'user' setting source behind proxies (ptah-cli-registry.ts:822; about 1-5k tokens per request, est.).

### RC7: Chat effort overrides the lane effort (confidence high; impact small)
- agent-spawn-environment.service.ts:139-152 returns the UI effort before `codexReasoningEffort` (medium). As a result 2,550/3,554
  Codex requests ran at high effort, all of them Ptah lanes. The effort-attributable output is 0.15-0.6M tokens: about 1% of credits
  at list price, and 3-7% under the noisy regression (CE5, ORCH-5).

### RC8: Background jobs and broken ledgers (confidence medium; hygiene)
- Curator: 711-854 launches in 5 days, each a full claude_code one-shot carrying 53 MCP tools and maxTurns 6
  (sdk-query-runner.service.ts:394-442). It produced 0 memories on 09-24 and 09-25, with 166 "stalled" and 87 "never dispatched"
  log entries, and re-curated one session 27 times in a day. Its codex-bucket impact is not measurable (section 2.6).
- observation_queue stored 46M chars of tool responses on 09-24 (15,940 rows unprocessed). skill_invocation_events over-counts
  2.08x (subagent-metrics-extractor.ts:149-160, no message.id dedupe). The skill budget ignores cache tokens (skill-budget.store.ts:191-194).
- The chat/completions translator emits the whole prompt in message_start (response-translator.ts:200-203). Consumers that sum
  or max every line double-count (about 100M in this audit's first pass).

## 4. Fix plan

Each item lists files, expected saving (est. unless noted) and how to measure it with the scripts in section 5.

### Wave 0: config-only quick wins (no code; do this week)

| # | Where | Exact key / value | Expected saving | Measure |
|---|---|---|---|---|
| 0.1 | `C:/Users/abdal/.codex/config.toml` | `model_auto_compact_token_limit = 120000` | Desktop thread (49.7M) -35-40%. If SDK lanes read the same CODEX_HOME (verify), most of CL-2's -15-17% | comp_codex.py: compaction pre-token p50 < 130k |
| 0.2 | same file | `tool_output_token_limit = 2500` (about 10k chars); verify it truncates code-mode exec cells | up to 26.6% of Codex input (upper bound) | codex_bloat.py: read-cell share 33.5% → < 15% |
| 0.3 | same file | `model_reasoning_effort = "medium"`, `web_search = "disabled"` if unused; disable unused desktop plugins (slack, calendar, pdf, presentations) | small (prefix and output) | codex_digest §4 first-request median < 22k |
| 0.4 | Ptah setting `ptah.compaction.threshold` (VS Code settings / Electron settings) | `200000` (the runtime accepts 100k-1M) | Claude main -30% weighted (CL-1); subagents unverified | log line shows autoCompact not `{}`; claude_analysis.txt auto-compactions > 0 |
| 0.5 | `D:/projects/ptah-extension/.claude/settings.local.json:2` (user-owned; the user edits it) | `"enableAllProjectMcpServers": false` and `"enabledMcpjsonServers": ["ptah"]` | proxied first request 83.5k → about 55k (est., the three extra schemas are about 49k tokens) | proxy_defer.py first-request median |
| 0.6 | `~/.ptah/settings.json` | pause the memory curator (or point `curatorProvider` at a non-subscription model) until Wave 4.6 lands; 0 memories on 09-24/25 | 711+ one-shots/5 days of stalled work | Ptah log: curator launches/day |
| 0.7 | Workaround until Wave 2.3 | before lane-heavy orchestration, set the chat effort to medium (it overrides `agentOrchestration.codexReasoningEffort`) | about 1% of Codex credits | codex_digest by-effort table |

Do NOT set a 6k-token Read cap (`CLAUDE_CODE_FILE_READ_MAX_OUTPUT_TOKENS`): 369 reads over 24k chars would each cost a retry
at about 85k context, offsetting about 43% of the saving (TOB-4 review). Do NOT re-enable Codex MCP deferral (RC5).

### Wave 1: Ptah MCP server (so agents rely on it, and it is cheaper than the shell)

1. **Server `instructions` plus Codex call snippets.** Return `instructions` from handleInitialize (protocol-dispatcher.ts:235-253),
   self-contained in the first 512 chars (Codex truncates there). Name 5-6 tools with one-line when-to-use rules, and say to use the
   shell for tests, builds and git. For Codex lanes, append exact `await tools.mcp__ptah__ptah_X({...})` snippets to
   NATIVE_AGENT_TOOL_POLICY (cli-adapter.utils.ts:409-415), including role-less spawns.
   Saving: most of the 26-32M ALL_TOOLS discovery re-read (7-8% of Codex input). Measure: adoption/cx_alltools.py cells from 232 to under 20.
2. **Global result budget.** In the tools/call response path (protocol-dispatcher.ts about :1026-1128), cap text at 8k chars by
   default, cut at a line boundary, with a trailer `[truncated: N more lines; call again with offset=… or narrower filter]`.
   Declare `_meta["anthropic/maxResultSizeChars"]` in tools/list. Saving: diagnostics re-send drops from 19.0M to 1.6M by the
   result-size measure (about 9M model-visible), plus agent_read, task_list and get_symbol_index tails. Measure: codex_bloat.py ptah class share from 9.1% to under 3%.
3. **get_diagnostics.** Filter to the `files` passed (core-namespace.builders.ts:207-245), with `includeProject:true` to opt out.
   Default to errors only, at most 50 entries, as compact `relpath:line:col code msg` lines with a summary line. Above 1,000 errors,
   return a one-line "tsconfig/path resolution likely broken in this worktree" hint. Move the type-check off the main thread
   (protocol-dispatcher.ts:492-502) to a worker with an incremental program (current median 29-32s). Investigate the 17,501-error
   worktree payload. Measure: max result under 8k; p90 latency under the 45s shell p90.
4. **Make the existing tools deliver.** Infer the enrich language from the extension (.ts/.tsx/.js/.jsx/.mjs/.cjs) and return an
   error instead of the full file when parsing fails (analysis-namespace.builders.ts:88-101; context-enrichment.service.ts:117-134):
   87-94% smaller. Give exact identifiers a boost or name-index lookup in code_search_symbols. workspace_analyze: tree off by default,
   fix the project-type detection, drop "Use this FIRST" (tool-description.builder.ts:321). Correct the "40-60%" claim (:1603).
   Default agent_read to a 4k tail. Measure: mcp/bench.py cases.
5. **Remove false routing** until a benchmark passes: the MANDATORY header and symbol-lookup rule (ptah-core-prompt.ts:31,59),
   "Prefer this over Grep" (tool-description.builder.ts:1710), and the git status → get_dirty_files and count_tokens rows
   (ptah-core-prompt.ts:44-45). Add a CI spec that runs the mcp/bench.py cases on a fixture and fails if a tool named in
   PTAH_MCP_SUBSTITUTION_SECTION loses to its native counterpart on size or recall.
6. **New primitives for the biggest workloads.** `ptah_outline {file}` (TS/JS via tree-sitter, Markdown via a heading tree; one
   line per node with start-end lines and a size) and `ptah_read {file, heading|symbol|lines, maxChars=8000}`. Optionally
   `ptah_grep {pattern, glob, limit=50}` with a `shown X of N` footer. Register them in protocol-dispatcher.ts (list :283-385,
   eager set :398-417); build them next to analysis-namespace.builders.ts. On its own this moves Claude little (built-ins win
   at 0.96%), so pair it with Wave 3.3, which rewrites oversized Reads into an outline that points at ptah_read.
   Saving: 30-60M Claude carried tokens (est., ADOPT-1 corrected).
7. **Per-caller profiles.** In handleToolsList (protocol-dispatcher.ts:288), choose the tool set from the URL slot
   (ptah-mcp-slots.ts:20-24). `/agent/{id}`: outline, read, grep, diagnostics, memory_search, agent_report, task_get/update.
   `/session/{id}`: that set plus agent_* and browser. dashboard, harness, approval_prompt and symbol_index only on explicit opt-in.
   Shrink dashboard_propose_spec to a minimal schema plus `ptah.help('dashboard')`. Keep the order byte-stable.
   Saving: about 22M on proxied sessions plus curator one-shots (est.), and shorter ALL_TOOLS printouts.
8. **Orchestration tools.** Add a repeat-status throttle on ptah_agent_status (a repeat call for the same id within 60s returns
   one line "unchanged since t"). Cut ptah_agent_report to a start and an end report (163 calls; lane-reporting-contract.ts).

### Wave 2: proxy and prompt assembly

1. **Proxied sessions (localhost/ollama/moonshot base URL):** use the existing disabledMcpServers path
   (sdk-query-options-builder.ts:376-397), or `strictMcpConfig: true` (sdk.d.ts:2200) at :967-992, to allow only ptah (with the
   `/agent` profile). Saving: up to about 28-33k tokens per proxy request (est.). Measure: proxy_defer.py.
2. **Codex lane prefix.** Keep `tool_search_always_defer_mcp_tools: false` (:627). Add an `enabled_tools` allowlist for the ptah
   server, and run lanes with an isolated CODEX_HOME or no desktop plugins. On resume, skip systemPrompt, projectGuidance and
   NATIVE_AGENT_TOOL_POLICY in buildTaskPrompt (cli-adapter.utils.ts:495-498; agent-process-manager.service.ts:345-346): about 4M.
   Measure: first-request median from 26.4k to under 18k; resumed first request.
3. **Effort precedence.** Make `agentOrchestration.<cli>ReasoningEffort` win when set, with 'inherit' opting into the chat effort
   (agent-spawn-environment.service.ts:117-153). Add an optional `effort` to the ptah_agent_spawn schema, with medium as the
   default for reviewers and testers. Log the effective effort at spawn. Saving: about 1% (up to 3-7% by regression).
4. **Responses translator.** Send the system prompt once (responses-request-translator.ts:132-136,150 sends it as both
   `instructions` and a developer item). Set a stable `prompt_cache_key` = session id (:145-159). Log terminal input and cached
   tokens at INFO (translation-proxy-base.ts:845-880). Volume in the window is low (16 calls), so this is insurance.
5. **Usage accounting.** Emit `input_tokens:0` (or the final split) in message_start (response-translator.ts:187-207). Dedupe by
   message.id with the last line winning in subagent-metrics-extractor.ts:149-160. Count cache tokens in skill-budget.store.ts:191-194.
   Record a weighted cost per request in session-usage-ledger.ts:188-232 (read ×0.1, 5m write ×1.25, 1h write ×2, output ×5).
6. **Trim injected text** (upper bound 3-5% combined, est.): skill_listing (about 21k chars × 394 injections), agent_listing_delta
   (11k), the duplicated Ptah-CLI project guidance (ptah-cli-registry.ts:822, which also loads the 'user' setting source behind a proxy),
   and the lane preambles (Antigravity median 21.6k chars, OpenCode 12.4k).

### Wave 3: Ptah-owned compaction layer (design)

Design rules, from the data: (1) cost = prompt size × request count, and hit ratio is already 93-99%. (2) Any edit to history
below the prefix forces a rewrite at 12.5x (5m) or 20x (1h) the read price, so per-result clearing nets only 0-6% (clear_sim.txt).
(3) So the layer is **budgeted threshold compaction + entry-time capping + session rotation**. It is not clear_tool_uses, and it
is not a translation-proxy stub pass (GLM/Kimi bypass the proxy: local-native.strategy.ts:6-8,149,217; provider-registry.ts:200).

1. **Budget resolver (Claude).** When the user has not set a window, default `autoCompactWindow: 200000` via the flag tier.
   Files: compaction-config-provider.ts:57-81, auto-compact-control.ts:78-86, sdk-query-options-builder.ts:373-411 and 883-887,
   package.json:218-231 (default and description), ptah-cli-spawn-options.service.ts:236-263. Add `precomputeCompactionEnabled: true`
   (sdk.d.ts:8818). Verify with one Task subagent that the window applies; if not, set `CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000`
   in build-safe-env.ts (the string exists in claude.exe). Log the resolved window at session start.
   Saving: main -30% and subagent -18% weighted (est.). Validate on one live session before rollout, because the flag has never been exercised (88/88 builds sent `{}`).
2. **Budget resolver (Codex).** Set `config['model_auto_compact_token_limit'] = 120000` in runSdk (codex-cli.adapter.ts:605-638);
   it also covers resumeThread (:667). Read it from a new setting `agentOrchestration.codexAutoCompactTokens` (0 = runtime default).
   Offer the same key for ~/.codex/config.toml through harness-sync (codex-toml-mcp-facet.ts). Saving: -15-17% of credits (est.).
3. **Entry-time capper (Claude).** In PostToolUseHookHandler (post-tool-use-hook-handler.ts:55-108), return
   `hookSpecificOutput.updatedToolOutput` in the same turn (no extra request, unlike a PreToolUse deny, which would cost about 55M, est.):
   - Bash/PowerShell/Grep/MCP results over 8k chars: head 60 lines + tail 40 lines + `full output: .ptah/tmp/tool-out/<id>.txt (N chars)`.
   - Whole-file Read of a .md over 15k chars or a .ts over 600 lines: return the outline (Wave 1.6) + "use ptah_read {heading|symbol} or Read offset/limit".
   Saving: 3.7% main / 9.8% subagent raw input (upper bound; rework not modelled). Measure: claude_bloat.py Read share and share of 20k+ results.
4. **Entry-time capper (Codex).** Set tool_output_token_limit (Wave 0.2) in the adapter config as well, and per-tool
   `output_token_limit` where the Codex version supports it.
5. **Subagent budget.** There is no subagent window knob (buildFlagSettings), so: (a) hand off and spawn fresh at about 150k
   context; (b) resume policy: if a subagent has been idle more than 5 min and its context is over 100k, spawn fresh with a 2-5k
   handoff instead of SendMessage (about 3-4%, est.); (c) set `subagentPromptCacheTtl: '1h'` only for sessions that use resumable
   subagents (about 1% net; a blanket 1h TTL costs 1.6x on writes). Files: sdk-query-options-builder.ts:375-410,
   build-safe-env.ts:30-44, .claude/skills/orchestration/SKILL.md, agent-lanes skill.
6. **Session rotation.** The top 10 of 60 main streams carry 54% of main input. Offer "rotate session from spec + summary" at about
   300k context, or when an orchestration phase ends.
7. **Guardrails.** Coalesce the curator PreCompact trigger (memory-trigger-config.ts:74-76) behind a per-session watermark, since
   compactions will be about 5x more frequent. Do not raise the GLM/Kimi window: CL-4 fix 1 increases tokens.

### Wave 4: orchestration and background jobs

1. **Spec format + lane brief.** In libs/backend/task-specs, write `batches/batch-N.md` plus a batches.md index of at most 3k chars,
   and move review follow-ups into separate files. ptah_agent_spawn (orchestration-namespace.builder.ts) inlines a lane brief of at
   most 8-12k chars: the batch tasks, acceptance criteria and only the plan sections they reference. Update the Inputs sections in
   .claude/agents/*.md (backend-developer.md:37-40), .opencode/agent/*.md and agent-generation/templates/agents/*.template.md.
   Saving: 50-70% of 222.5M Claude re-send and of 42M Codex (est.). Measure: spec-read chars per agent start (orch_claude.py, codex_bloat.py).
2. **Resume gate.** Before resuming a lane (codex-cli.adapter.ts:666-669; agent-process-manager.service.ts), use the request count
   or the last token_usage_record. Do not use the turn.completed sum (:1104-1121), which covers every request in the turn.
   If the context is over 60k or the lane has been idle more than 10 min, spawn fresh with the numbered defects (file:line),
   `git diff --stat` and the file list. Update agent-lanes SKILL.md:130,171. Saving: 25-40M (est.).
3. **Blocking waits.** Add `ptah_agent_wait {agentIds, timeoutSec≤900}` and `ptah_run_check {project, targets}`, both returning
   compact summaries with full logs stored under .ptah/tmp. Set `tool_timeout_sec` for mcp_servers.ptah
   (codex-cli.adapter.ts:607-615), otherwise a blocking tool hits Codex's default MCP timeout. Yield-time guidance cannot work,
   because Codex clamps it to about 31s. Saving: 50-70% of 36.5M Codex poll input, plus part of 46M Claude.
4. **Enforced budgets.** In AgentProcessManager, count tool-call segments per run: steer at N=40 via ptah_agent_message and stop
   at 1.5N. Add a repeat detector (20 identical tool+args calls per message stops the lane). Block free models known to loop
   (mimo-v2.6-flash-free) for lanes. Forbid nested Codex spawn_agent in lanes (6.2M).
5. **Agent definitions.** Add `tools`/`disallowedTools`/`maxTurns` frontmatter to .claude/agents/*.md, keeping the ptah read tools
   for reviewers. Review the 6 opus pins (team-leader and project-manager could run on sonnet). Give reviewers an output-size contract
   (reviews reach 57,565 bytes; 120 review-file reads = 1.55M chars). Scale the cross-side review mandate (agent-lanes SKILL.md:159-176)
   to task size. Saving: 40-80M (est.; the style-review merge is capped at 87M and only applies when the user picks it).
6. **Curator diet.** Add a transcript-offset watermark, skip after 3 zero-yield passes, and cap at 3 passes per session per day.
   Run the one-shot with `tools: []`, `mcpServers: {}` (or only the memory tools), `settingSources: []`, `maxTurns: 1` with
   structured output, and a short system prompt (sdk-query-runner.service.ts:394-442; sdk-internal-query.curator-llm.ts:204,417-429;
   memory-trigger-config.ts:74-79). Store only previews in observation_queue.

## 5. Measurement plan

**Per-session metrics** (record in session-usage-ledger.ts using the last usage line per message.id; show them in the session stats UI):

| Metric | Baseline | Target after Waves 0-3 |
|---|---|---|
| Weighted cost per request (Claude) / credits per request (Codex) | 655.9M / 21,952 req; 3,294k credits / 3,554 req | -25% |
| Context per request p50 / p95 / max | Claude avg 211k, max 708k; Codex mean 107k, p95 205k | Claude p95 < 200k; Codex p95 < 125k |
| Auto-compactions and pre-compaction tokens | Claude 0 auto; Codex p50 237k | Claude about 200k; Codex about 120k |
| First-request prefix by route | 52-74k main, 31-37k sub, 83.5k proxy, 26.4k Codex | 45k / 28k / 55k / 18k |
| Tool-result chars by tool; count of results over 20k | Read 41.6M chars; 482 Reads over 20k | 20k+ results -80% |
| Codex re-sent tool-output share | 53.9% (est.) | < 30% |
| Ptah share: code-intel vs built-in reads/searches | Claude 0.96% main; Codex 196 vs 3,472 | Claude > 10%; Codex > 1:4 |
| ALL_TOOLS discovery cells per Codex session | 2.3 | < 0.2 |
| Largest ptah result / diagnostics p90 latency | 1.08M chars / 45s | < 8k chars / < 20s |
| Spec-read chars per agent start | 14.4M Claude / 6.2M Codex visible | -60% |
| Resumes: first-request context | p50 114.3k | < 40k (fresh handoff) |
| Poll-only requests per lane | 360 / 98 lanes | -60% |
| Effective effort per lane request | 72% high | matches setting |
| Curator passes, memories written, tokens | 711-854 launches, 0 memories on 09-24 | ≤ 3 passes/session/day, tokens logged |
| Codex weekly used% per 1M rollout tokens | about 0.49 (est.) | trend only; use credit shares |

**Re-running the audit.** `C:/Python314/python C:/Users/abdal/.ptah-token-audit/rerun.py --since YYYY-MM-DD [--only core|all] [--dry-run]`.
It copies the core scripts (extract_claude, extract_codex, render_codex_md, cache/*, bloat/*, adoption/*) and, with `all`, also
compaction/* and orch_*. It patches the hard-coded 2026-09-21 cutoff and the audit path, runs each copy from
`runs/<since>_<stamp>/`, and writes `<script>.out` files. The baseline stays untouched, and stdout is only a one-line status per
script. Compare `runs/*/claude_digest.md` and `codex_digest.md` against this report's tables. Rules to keep: last usage line per
message.id; list-price credit shares, not rate-limit fits; model-visible exec output (not McpToolCall.result) for Codex sizes.
Suggested cadence: a run the day after each wave lands, with the same 4-day window length.

## 6. Appendix

### 6.1 Refuted or dropped findings
- **CL-6 (Codex translation proxy blinds auto-compaction):** refuted. The zero-usage evidence is from 09-09..09-11, before commit
  4f806f210 (09-10). 0 of 16 in-window gpt messages had zero final usage. What remains is minor: register windows for gpt-*/luna.
- **Claude digest H2 (proxy cache failure, hit 0.53-0.77, 118.5M uncached):** dropped. It was an extractor double count; the
  corrected figures are 18.6M uncached and hit 0.927 (CE6, CL-5).
- **Digest "251 cache busts / 46.4M":** mostly context growth from new tool output. Real misses under 5 min are 9 events, 1.33M (CE1).
- **Curator as a major Codex drain (7-38M/day, ≥68M):** not supported. Most passes stalled before dispatch, and no measurable
  movement of the codex bucket was seen (CE7, ORCH-7). It is kept as a hygiene item.
- **"147 of 240 weekly points from cached input", "22-34 points from effort", and similar point attributions:** the base is inflated
  (real use is about 171 points) and the fits disagree by 2x. They were replaced with list-price shares.
- **TOB-3 proxy stub pass for GLM/Kimi:** wrong route (those requests are Anthropic-native), so it saves about 0.
- **CE2 lever "re-enable Codex MCP deferral":** conflicts with codex-cli.adapter.ts:618-626 and would lower adoption; replaced by an allowlist.
- **ORCH-3 / TOB-6 `yield_time_ms ≥ 300000` guidance:** Codex clamps yield to about 31s (43 calls), so this has no effect.
- **TOB-4 "stop sed/cat reads":** the 1,001 sed -n calls average 3.0k chars and are already ranged, so this saves about 0.
- **mcp-surface H5 (53 schemas ride every Codex request):** contradicted. The Codex first request carries only about 9.5k tokens
  of tool definitions, and code mode reaches ptah through ALL_TOOLS.
- **ADOPT-3 "diagnostics is 70% of ptah output":** 70% of results, but only 29% of model-visible exec output (1.28M of about 4.4M chars).
- **CL-4 fix 1 (raise the GLM window):** increases tokens; dropped.

### 6.2 Open questions
- Does `tool_output_token_limit` truncate per exec cell in Codex code mode? Do SDK lanes read ~/.codex/config.toml?
- Does the flag-tier `autoCompactWindow` apply to 1M-context models and to Task subagents? Does the native CLI binary honour
  BASH_MAX_OUTPUT_LENGTH and MAX_MCP_OUTPUT_TOKENS?
- Does gpt-5.6-luna (curator) count against limit_id=codex, or a separate bucket?
- What causes 38 Codex misses under 5 min (2.99M uncached, cached share p50 0.21)? Candidates are ptah MCP list instability,
  list_changed events and dynamic developer instructions.
- Why do worktree lanes produce 17,501-error diagnostics? Is the symbol index stale for vscode-lm-tools? Is there an
  lsp_definitions position bug?
- Would a merged logic+style reviewer, or fewer agents, finish the same work with fewer tokens? (The link between fan-out and task size is unproven.)

### 6.3 Data gaps
- Ptah does not persist lane transcripts (agent-output-buffer.service.ts), so lane counts come from vendor logs only.
  Antigravity tokens are chars/4 estimates.
- Curator and proxy token usage is logged at debug only (translation-proxy-base.ts:845-880). The curator's cost is inferred.
- GLM token counts use a different tokenizer and are not comparable 1:1 with Claude. ollama-cloud billing was not checked.
- The Codex used% is an integer, and concurrent sessions interleave stale values. Credit weights use GPT-6 Sol list rates as a
  stand-in for gpt-6-astra.
- Replays do not model rework after compaction or capping, so treat every replay saving as an upper bound.

## Delta vs TASK_PROMPT_EFFICIENCY (PR #571)

PR #571 (merge 37345719f, 2026-09-22T17:23Z; commits 5bb0de1d7, 316fd6bb1, f4aba49ff, 3e98461f0) against audit.md R1-R11. Data:
`C:/Users/abdal/.ptah-token-audit/runs/delta_pr571/` (codex_delta.py, codex_fmt.py, codex_split.py, claude_delta.py; aggregates only).

### D.1 R1-R11 status (7 shipped, 2 partial, 2 not shipped)

| R | Status | Evidence (HEAD) |
|---|---|---|
| R1 preamble | shipped, since regrown | `## Working rules` in all 15 `.claude/agents/*.md`. Corpus 201,464 B → 154,582 B at the merge → 172,002 B now (backend-developer 11,200 → 12,719 B; later role-rule commits ecdb446fc, 12e42c9d3 and others) |
| R2 shell-output policy | shipped (text only) | cli-adapter.utils.ts:411-413 (`NATIVE_AGENT_TOOL_POLICY`), ptah-core-prompt.ts:80-86 |
| R3 long-command policy | shipped (text only) | cli-adapter.utils.ts:414 |
| R4 polling rewrite | shipped | ptah-core-prompt.ts:97-99, agent-lanes SKILL.md:112, fleet-orchestration SKILL.md:150-153, team-leader.md:14,378 |
| R5 guidance cap | **partial (bypassed)** | Cap at enhanced-prompts.service.ts:74,86,776. The spawn path passes `systemPrompt` = uncapped `getEnhancedPromptContent` (:703-712; ptah-api-builder.service.ts:650-657; agent-namespace.builder.ts:290-313), and `systemPrompt \|\| projectGuidance` prefers it (cli-adapter.utils.ts:495). Measured: guidance median 12.4k chars in post-PR lanes, and 0 truncation notices in any session |
| R6 scoped `-p` verification | shipped (text) | cli-adapter.utils.ts:412, agent-lanes SKILL.md:180, orchestration SKILL.md:99, team-leader.md:103-104, 8 agent files |
| R7 trim ptah-system-prompt | not shipped | ptah-system-prompt.constant.ts still 24,269 B and not touched by the PR. RC5 finds `PTAH_SYSTEM_PROMPT` is never injected, so it is dead code and trimming it saves nothing |
| R8 MCP table dedupe | shipped | one `PTAH_MCP_SUBSTITUTION_SECTION` (ptah-core-prompt.ts:31), used at :138 and :279 |
| R9 batch cap | shipped (text) | team-leader.md:103, fleet-orchestration SKILL.md:72, lane-assignment.md |
| R10 cost model / ceiling / timeout | partial | Text only: agent-lanes SKILL.md:48 (20 min advice) and :214-219 (40-call ceiling). The code default is still 60 min (agent-process-manager-helpers.ts:51), and the ceiling is not enforced (RC3: 27.8M input after request #40) |
| R11 plugin skill copy | not shipped (deferred) | 54 tracked files under apps/ptah-extension-vscode/assets/plugins/ptah-core/skills |

### D.2 Before vs after (Codex Ptah lanes, originator codex_sdk_ts)

The before window reproduces the OLD baseline. From 09-14 to the merge there were 177 sessions, 65.4 requests per session, a 113.5k average context
and 28.5% `wait` calls (OLD: 159 / 68 / 115k / 29%). A date split is misleading, though, so the sessions are split into three cohorts:
- **Codex CLI upgrade.** The CLI moved from 0.147.0 to 0.155.1 on 09-21, before the merge. The new version adds token_usage_record, clock.sleep and a yield clamp of about 31s.
- **PR #555.** The lane completion signal was merged on 09-21 at 17:48Z.
- **Build pickup.** The running Ptah build picked up #571 only on 09-23. On 09-22, 0 of 23 lanes carried the new cost-policy text; after that, 49 of 51 did.

The cohorts below are therefore split on the CLI version and on the presence of the PR's prompt text.

| Metric | C1: CLI 0.147, old prompts (136) | C2: CLI 0.155, old prompts (41) | C3: CLI 0.155, PR #571 prompts (49) | C2→C3 |
|---|---|---|---|---|
| Requests / session (median) | 73.4 (51) | 39.0 (25) | 32.3 (26) | -17% (median +1) |
| Context / request avg / p95 | 114.5k / 208.2k | 107.0k / 197.5k | 101.0k / 205.2k | -6% / +4% |
| Poll calls / request (`wait`) | 33.0% (32.6%) | 10.1% (3.2%) | 12.0% (6.3%) | +1.9 pt |
| Tool output per session / per request | 383k / 5.2k chars | 313k / 8.0k | 321k / 9.9k | +3% / +24% |
| Outputs > 40k chars per session | 2.11 | 1.00 | 1.67 | up |
| First-request input p50 | 26.9k | 27.4k | 26.0k | -1.4k (-5%) |
| Cache ratio (cached / input) | 0.974 | 0.959 | 0.936 | -2.3 pt |
| Input per session | 8.4M | 4.2M | 3.3M | -21% |

For sessions with a role block only (29 vs 29): requests per session went from 44.9 to 38.8, average context from 113.9k to 115.5k, p95 from 203.8k to 211.3k, first
request from 27.6k to 26.4k, and tool output per session from 362k to 425k. Both counting methods (token_usage_record and token_count) agree within 1% on 92 sessions that log both.

Claude (sdk-ts). Streams are split on the first request before or after the merge; C is cache_read over all input.
- Main streams (168 → 38): requests per stream 83.2 → 107.1, average context 242.8k → 218.4k, p95 516.8k → 445.8k, poll calls per request 5.0% → 1.2%,
  Bash output per stream 71k → 67k, first request p50 66.2k → 79.2k, C 0.944 → 0.945.
- Subagent streams (338 → 215): requests per stream 37.7 → 49.3, average context 193.9k → 177.2k, p95 497.8k → 401.0k, poll calls 1.4% → 0.5%,
  Bash output 48k → 49k, first request p50 46.5k → 36.5k (sonnet-5: 47.5k → 37.3k), C 0.960 → 0.961.

**What the data cannot separate.**
1. The polling collapse (33% → 10%) and the halving of requests per session both happened between C1 and C2. That was the CLI
   upgrade plus PR #555, before #571 reached any lane. PR #571 itself (C2→C3) shows no polling or output reduction.
2. Between C2 and C3 the samples are small (41 vs 49 sessions over 1-2 days each) and the task mix changes (09-23 was dominated by short
   reviewer lanes). The -17% requests and -6% context fall within that noise, and role lanes alone go the other way.
3. Only the first-request drop of about 1.4k tokens matches a mechanism (R1 and R8), and the later agent-file growth has already eroded part of it.
4. On Claude, transcripts do not log the system prompt, so no marker is available. The model mix changed (opus-5-5 subagents appear only after
   the merge) and the Claude Code version is not controlled. The 10k drop in the subagent first request is about 12x the agent-file cut (about 0.8k
   tokens per role), so it cannot be credited to #571.
5. The cache ratio fell from C2 to C3 on the same CLI; the cause is unexplained (see the open questions in 6.2).

### D.3 NEW fix items classified: (a) new, (b) recommended in OLD and not shipped, (c) shipped in OLD without a measured effect, (d) shipped and working

| NEW item | Class | Note |
|---|---|---|
| W0.1, W3.2 Codex compaction limit; W0.4, W3.1 Claude autoCompactWindow | a | OLD named "no early compaction" (driver 3) but made no recommendation for it |
| W0.2, W3.4 Codex tool_output_token_limit; W3.3 PostToolUse capper | c | These enforce what R2 only states. After #571, output per request rose from 8.0k to 9.9k |
| W1.8 agent_status throttle; W4.3 ptah_agent_wait / ptah_run_check | c | These enforce R3/R4. Polling fell before #571 (CLI and #555); #571 added nothing (10.1% → 12.0%) |
| W4.4 enforced tool-call budget and repeat detector | c / b | The R10 ceiling is text only (c). The R10 default timeout was never shipped (b) |
| W2.2 Codex lane prefix (allowlist, isolated CODEX_HOME, skip guidance on resume) | c + a | R1 and R5 moved the first request by only -1.4k. The resume skip is new |
| (delta) apply the 4,000-byte cap to the `systemPrompt` spawn branch | c | R5 is bypassed (D.1). Guidance is still about 12.4k chars (about 3.1k tokens) per lane |
| W2.6 trim injected text | c + a | The lane-preamble part repeats R1, which regrew by 17 KB. skill_listing, agent_listing and the duplicate ptah-cli guidance are new |
| Delete dead `PTAH_SYSTEM_PROMPT` / `buildPlatformSystemPrompt` (mcp_surface.md) | b | R7, not shipped. The fix is now deletion, not trimming |
| W1.4, W1.5 fix enrich/symbol search and remove false routing | a | PR #571 added lines that send agents to `ptah_context_enrich_file` (ptah-core-prompt.ts:86, cli-adapter.utils.ts:415), which returns the full file (36/36). Until W1.4 lands, that rule costs tokens |
| W0.3, W0.5, W0.6, W0.7, W1.1-1.3, W1.6, W1.7, W2.1, W2.3-2.5, W3.5-3.7, W4.1, W4.2, W4.5, W4.6 | a | No OLD counterpart. R9 capped batch size, not spec size, so W4.1 is new |
| R11 plugin skill copy | b | Not re-raised by NEW; still open, and a repository-hygiene item rather than a token item |
| R8 MCP table dedupe; the push completion signal (#555) | d | Shipped and in place. Polling dropped 33% → 10-12%, credited to #555 and CLI 0.155, not to #571 |
