# Research Report — Native agent loop to replace the Claude Agent SDK

Date: 2026-08-31. Sources: repository inspection, GitHub API, npm registry,
project docs. Claims marked UNVERIFIED could not be traced to a primary source.

## 1. Verdict

Build the loop on `@earendil-works/pi-ai` (MIT, v0.84.4, published
2026-08-28). It is the provider layer that Pi, OpenClaw and DeepSeek Harness
share:

- Pi coding agent: own loop (`pi-agent-core`) over `pi-ai`.
- OpenClaw: embeds `pi-agent-core` directly.
- DeepSeek Harness (`deepseek-ai/deepseek-harness`, MIT, released 2026-08-13,
  204,784 stars, TypeScript, Cordis plugin kernel): its multi-provider adapter
  `@deepseek-ai/dsh-llm-pi-ai` routes through `pi-ai`. Only the direct DeepSeek
  route has its own adapter.
- OpenCode (v1.18.25, MIT, 202,602 stars): Vercel AI SDK + Effect-TS instead.

Keep `claude-agent-sdk` as a second conductor for Claude subscription OAuth
users. Do not route subscription tokens through an own loop.

## 2. What Ptah consumes from `@anthropic-ai/claude-agent-sdk` today

Runtime imports are three functions:

- `query()` — `libs/backend/agent-sdk/src/lib/helpers/sdk-module-loader.ts:65-78`
- `forkSession()` — `helpers/session-fork.service.ts:71-80`
- `getSubagentMessages()` — `helpers/subagent-message-dispatcher.ts:354-368`
- Types only: `types/sdk-types/claude-sdk.types.ts:11-189` (~130 re-exports,
  ~45 guards)

Options set in `helpers/sdk-query-options-builder.ts:758-848`: `systemPrompt`
`{preset:'claude_code', append}`, `tools` `{preset:'claude_code'}`,
`mcpServers` `{ptah: http}`, `permissionMode`, `canUseTool`, `resume`,
`forkSession`, `hooks` (17 events, `:1315-1408`), `settingSources`
`['user','project','local']`, `thinking`, `effort`, `betas`
`['context-1m-2025-08-07']`, `enableFileCheckpointing`, `maxTurns` 200,
`includePartialMessages`, `forwardSubagentText`, `env`, `stderr`,
`pathToClaudeCodeExecutable`, `extraArgs`, `spawnClaudeCodeProcess`.

Not set anywhere: `allowedTools`, `disallowedTools`, `agents`, `plugins`,
`additionalDirectories`, `appendSystemPrompt`.

`Query` methods used: `interrupt()`, `setPermissionMode()`, `setModel()`,
`supportedModels()`, `rewindFiles()`.

Frontend contract: `FlatStreamEventUnion`,
`libs/shared/src/lib/types/execution/stream-background.ts:214-233`, 19
variants. Transformers in `libs/backend/agent-sdk/src/lib/message-transform/`
(1,686 LOC) produce it from SDK messages.

Size: `libs/backend/agent-sdk` = 211 files, 29,911 LOC without specs (62,867
with). `helpers/` = 16,149 LOC.

## 3. Feature parity: SDK feature → native loop plan

| SDK / binary feature                                                                                                                                                                                                                                                 | Ptah use today                                                                                                                                                                                                                                      | Native loop plan                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------- |
| Agent loop (turn, tool_use, tool_result, stop)                                                                                                                                                                                                                       | binary                                                                                                                                                                                                                                              | Own engine: turn = steps; inbox with `steer` / `followUp` / `nextTurn`; max-steps guard                                                                                                                                                                                            |
| `claude_code` tool preset (Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch, Task, AskUserQuestion, ExitPlanMode, TodoWrite, NotebookEdit)                                                                                                                   | preset                                                                                                                                                                                                                                              | Own `agent-tools`: read/write/edit(exact match)/bash/glob/grep + webfetch. `ptah_*` (51) in-process. AskUserQuestion / ExitPlanMode already exist as Ptah services (`permission/ask-user-question.service.ts`, `permission/exit-plan-mode.service.ts`)                             |
| `claude_code` system prompt preset                                                                                                                                                                                                                                   | preset + `PTAH_CORE_SYSTEM_PROMPT` appended                                                                                                                                                                                                         | Own prompt. Target under 2k tokens (Pi under 1k; Deep Agents cut base prompt, tokens fell ~65%)                                                                                                                                                                                    |
| Ptah MCP server via `mcpServers` HTTP                                                                                                                                                                                                                                | HTTP hop per call                                                                                                                                                                                                                                   | In-process `IToolRegistry` for native loop. HTTP MCP stays for external CLIs. Tool search / deferred loading over the registry (Anthropic `defer_loading` + `tool_search_tool_bm25` on Anthropic routes)                                                                           |
| Transcript store `~/.claude/projects/**/*.jsonl`                                                                                                                                                                                                                     | Ptah stores no history; 6 readers depend on layout (`jsonl-reader.service.ts`, `session-replay.service.ts`, `agent-correlation.service.ts`, `session-history-reader.service.ts`, `sdk-transcript-reader.adapter.ts`, `session-importer.service.ts`) | Append-only session event log in `persistence-sqlite`. Invariant: model-visible means logged. `deriveMessages()` projection. `ISessionLog` adapter for existing readers, or JSONL export in Claude layout                                                                          |
| Session UUID from `system/init`                                                                                                                                                                                                                                      | canonical id                                                                                                                                                                                                                                        | Loop mints id at turn 0, emits same `message_start` shape                                                                                                                                                                                                                          |
| `resume` / `forkSession` / `rewindFiles`                                                                                                                                                                                                                             | yes                                                                                                                                                                                                                                                 | Fork by `parentId` in log (Pi tree). Rewind: git-stash snapshot per turn, or defer to v2                                                                                                                                                                                           |
| Auto-compaction + `compact_boundary` + `PreCompact`/`PostCompact` hooks                                                                                                                                                                                              | observed only (`compaction-config-provider.ts:9`)                                                                                                                                                                                                   | Three tiers: prune old tool args; spill oversized results to file with locator (DeepSeek `spill`); LLM summary at 85% of window (Deep Agents). Optional Anthropic `compact-2026-01-12` beta on Anthropic routes. `/compact` command                                                |
| `canUseTool` permission callback                                                                                                                                                                                                                                     | `sdk-permission-handler.ts`, classifier, rule store, pending registry                                                                                                                                                                               | Reuse unchanged behind `tools/pre-execute`. Add OpenCode wildcard rules (`mymcp_*: deny`, last rule wins)                                                                                                                                                                          |
| `permissionMode` default / acceptEdits / plan / bypass                                                                                                                                                                                                               | yes                                                                                                                                                                                                                                                 | Same enum in loop policy                                                                                                                                                                                                                                                           |
| 17 hook events (PreCompact, PostCompact, PostToolUse, PostToolUseFailure, SessionStart, SessionEnd, Stop, StopFailure, SubagentStart, SubagentStop, TaskCreated, TaskCompleted, TeammateIdle, UserPromptSubmit, UserPromptExpansion, WorktreeCreate, WorktreeRemove) | one handler file each in `helpers/`                                                                                                                                                                                                                 | Loop waterfalls: `agent/pre-step`, `agent/request`, `llm/stream`, `tools/pre-execute`, `tools/execute`, `tools/post-execute`, `agent/turn-stopping`, plus session/turn/step durable events. Bridge `hooks.json` (Claude Code and Codex dialects) like DeepSeek `hooks-claude-code` |
| Subagents: `Task` tool, `task_*` messages, `forwardSubagentText`, `getSubagentMessages`                                                                                                                                                                              | binary                                                                                                                                                                                                                                              | `ISubagentProvider` port: `fork-in-process`, `spawn-in-process`, `vendor-cli` (existing `cli-agent-runtime` adapters: Codex, Copilot, Cursor, OpenCode, Pi, Antigravity), `tribunal`. Isolate failures per subagent (Deep Agents #694 trap)                                        |
| Skills / agents / commands / output styles from `.claude/**` via `settingSources`                                                                                                                                                                                    | free from binary; `harness-sync` writes them                                                                                                                                                                                                        | Loop reads `~/.ptah/user/**` and `{ws}/.ptah/**` directly. `output-styles` already resolves flag-vs-inject. Slash commands parsed in loop (`slash-command-interceptor.ts` exists)                                                                                                  |
| Built-in slash commands `/compact`, `/context`, `/cost`, `/model`                                                                                                                                                                                                    | binary                                                                                                                                                                                                                                              | Command registry, dispatch without model turn (DeepSeek `ctx.commands`)                                                                                                                                                                                                            |
| Plugins (`Options.plugins`)                                                                                                                                                                                                                                          | never set; Ptah has `plugin-marketplace` + `plugin-loader.service.ts`                                                                                                                                                                               | Unchanged                                                                                                                                                                                                                                                                          |
| Auto-memory subsystem (`~/.claude/projects/<cwd>/memory/`)                                                                                                                                                                                                           | disabled via `PTAH_DISABLE_SDK_AUTO_MEMORY` (redundant with `memory-curator`)                                                                                                                                                                       | Not needed. Inject recalled memory at `agent/pre-step` as a logged event                                                                                                                                                                                                           |
| `thinking`, `effort`, `betas`, `model`                                                                                                                                                                                                                               | passed through                                                                                                                                                                                                                                      | pi-ai `thinkingLevel`; `thinking: {type:'adaptive'}` on Fable 5 / Opus 5 / Sonnet 5 (`budget_tokens` returns 400). Interleaved thinking auto on 4.6+                                                                                                                               |
| Prompt caching                                                                                                                                                                                                                                                       | binary                                                                                                                                                                                                                                              | pi-ai `sessionId` + `cacheRetention: 'short'                                                                                                                                                                                                                                       | 'long' | 'none'`. Stable prefix order: system, tools, history. Cache invalidates on model or effort change |
| 1M context (`context-1m-2025-08-07`)                                                                                                                                                                                                                                 | beta header                                                                                                                                                                                                                                         | Default on Fable 5 / Opus 5 / Sonnet 5. `token-meter` from log                                                                                                                                                                                                                     |
| `interrupt()`, `setModel()`, `setPermissionMode()`                                                                                                                                                                                                                   | `session-control.service.ts`                                                                                                                                                                                                                        | `AbortController` through stream and tool calls (Pi); inbox commands                                                                                                                                                                                                               |
| `includePartialMessages` stream events                                                                                                                                                                                                                               | `stream-event.transformer.ts`                                                                                                                                                                                                                       | pi-ai `text_delta` / `thinking_delta` / `toolcall_delta` (partial JSON) / `done` / `error` with `contentIndex`, mapped straight to `FlatStreamEventUnion`                                                                                                                          |
| Cost / usage on `result`                                                                                                                                                                                                                                             | `stream-transformer.ts`                                                                                                                                                                                                                             | pi-ai `usage` `{input, output, cacheReadTokens, cacheWriteTokens, cost}`; author says best-effort, not billing grade                                                                                                                                                               |
| Provider switching via translation proxies (~3,100 LOC in `auth-providers/src/lib/translation/`)                                                                                                                                                                     | Anthropic → OpenAI Chat / Responses                                                                                                                                                                                                                 | pi-ai wire protocols: `anthropic-messages`, `openai-completions`, `openai-responses`, `google-generative-ai`. `createProvider({id, auth, models, api})` for Copilot, OpenRouter, Ollama, LM Studio, custom gateways. Proxies stay only for the SDK conductor                       |
| Claude subscription OAuth                                                                                                                                                                                                                                            | `oauth-proxy` strategy + binary                                                                                                                                                                                                                     | SDK conductor only                                                                                                                                                                                                                                                                 |
| Off-thread spawner, `pathToClaudeCodeExecutable`, 227 MB `claude.exe` per host                                                                                                                                                                                       | `sdk-query-runner.service.ts:195-199`, `detector/` (977 LOC)                                                                                                                                                                                        | Not needed for native path                                                                                                                                                                                                                                                         |
| File checkpointing (`enableFileCheckpointing`)                                                                                                                                                                                                                       | yes                                                                                                                                                                                                                                                 | v2 unless PM marks required                                                                                                                                                                                                                                                        |
| Workflows / `CLAUDE_CODE_DISABLE_WORKFLOWS`                                                                                                                                                                                                                          | disabled                                                                                                                                                                                                                                            | Not needed                                                                                                                                                                                                                                                                         |
| `curator-llm-adapter` (memory-curator LLM via `InternalQueryService`)                                                                                                                                                                                                | one-shot SDK queries, `persistSession:false`                                                                                                                                                                                                        | One-shot path on native loop, cheaper (no binary spawn)                                                                                                                                                                                                                            |

## 4. How OpenCode, Pi and DeepSeek Harness build the loop

| Aspect           | OpenCode                                                                                               | Pi                                                                                                                               | DeepSeek Harness                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider layer   | Vercel AI SDK + 12 `@ai-sdk/*`                                                                         | `pi-ai` 4 wire protocols                                                                                                         | `pi-ai` via `dsh-llm-pi-ai` + `llm-deepseek`                                                                                                                                                  |
| Loop             | `streamText` multi-step, `MAX_STEPS_PROMPT`, stops on `finish_reason` (fragile: issues #13577, #11153) | `Agent` class, events `agent_start` / `turn_start` / `message_update` / `tool_execution_*` / `agent_end`; no max-steps by design | `core/agent-loop` plugin, swappable. Turn = steps. Waterfalls `agent/pre-step`, `agent/request`, `llm/stream`, `tools/pre-execute` / `execute` / `post-execute`; serial `agent/turn-stopping` |
| Tool schema      | Zod                                                                                                    | TypeBox                                                                                                                          | own registry `ctx.tools`                                                                                                                                                                      |
| Tool concurrency | UNVERIFIED                                                                                             | parallel default; `withFileMutationQueue()`                                                                                      | not verified                                                                                                                                                                                  |
| Steering         | `AbortController` + Effect interrupt                                                                   | `steer()` / `followUp()`; modes one-at-a-time / all-at-once                                                                      | one inbox; `agent/cancel-requested`                                                                                                                                                           |
| Session store    | SQLite (Drizzle)                                                                                       | JSONL tree (`id` / `parentId`) + SQLite backend                                                                                  | append-only `SessionEvent` log; JSONL and SQLite backends; "model-visible means logged"                                                                                                       |
| Compaction       | `isOverflow()` token-based; keep last ~40k tool output, prune past ~20k                                | `session_before_compact` hook, cache-prefix aware                                                                                | `compaction-basic` + `tool-result-pruner` + `spill` + `token-meter`                                                                                                                           |
| Permissions      | ask / allow / deny, wildcard, last wins                                                                | none; `tool_call` hook; `gondolin` sandbox                                                                                       | `user-approval`, `permission-presets`, `sandbox` (bwrap / Landlock / Seatbelt / Windows ACL)                                                                                                  |
| Subagents        | Task tool; Build / Plan / General / Explore / Scout                                                    | none                                                                                                                             | `subagent-claude-code`, `subagent-codex`, `subagent-acp`, `subagent-dsh-sdk`, `subagent-fork-in-process`                                                                                      |
| Hooks            | plugins                                                                                                | ~30 lifecycle events                                                                                                             | `hooks-claude-code`, `hooks-codex` bridges over shared `hook-protocol`                                                                                                                        |
| MCP              | `@modelcontextprotocol/sdk` client                                                                     | extension only                                                                                                                   | `mcp-client` plugin                                                                                                                                                                           |
| Embed            | `@opencode-ai/sdk`, HTTP server                                                                        | npm packages                                                                                                                     | JSON-RPC stdio SDK (TS + Python), ACP server                                                                                                                                                  |

DeepSeek Harness design rules worth copying: capability seams (Service
Definition / Provider / Consumer; "extension plugins depend on Service
Definitions, never concrete providers"), the Goal → Round → Turn → Step
hierarchy with a 256-round cap and armed/disarmed activation, `guard/`
(repeat-tool reminder, timeout policy), `spill/`.

## 5. LangChain Deep Agents (JS `deepagents@1.13.2`, Python 0.7.11, MIT)

Middleware over LangGraph's ReAct loop via LangChain 1.x `createAgent`.
Verified middleware: `FilesystemMiddleware` (ls/read/write/edit/delete/glob/
grep/execute over `BackendProtocol`: State, Filesystem, Store, Composite,
sandboxes), `SubAgentMiddleware` (`task`), `AsyncSubAgentMiddleware` (needs
LangGraph server), `SummarizationMiddleware` (trigger 0.85 × window, keep 10%;
fallback 170k / keep 6), `SummarizationToolMiddleware` (cheap pass, truncate old
tool args after 20 messages), `PatchToolCallsMiddleware` (repair dangling tool
calls on resume), `MemoryMiddleware` (AGENTS.md), `SkillsMiddleware`
(SKILL.md), `HumanInTheLoopMiddleware`, `AnthropicPromptCachingMiddleware`
(from `langchain_anthropic`), `TodoListMiddleware` (opt-in since 0.7.0).

v0.7.0 (2026-07-29): removed `write_todos` from defaults after evals showed
better reward and lower cost without it; deleted the base system prompt (base
tokens ~6k to ~2k per turn).

Pain points (open issues): `DeltaChannel` O(N²) checkpoint fix Python-only
(deepagentsjs#788); one subagent failure cancels siblings (#694); eager MCP
schema loading (#5528); subagent interrupt resume fragile (#725); five pinned
`@langchain/langgraph*` peer deps. No public benchmark.

Take: backend-ported file tools; `SubAgent` spec `{name, description,
systemPrompt, tools, model}`; two-tier context passes; dangling tool-call
repair; AGENTS.md-always vs SKILL.md-on-demand; eval-first feature removal.
Leave: LangGraph runtime, checkpointer, graph-state file store, Agent Protocol
server.

Ptah history: `libs/backend/deep-agent-sdk` (3,802 LOC) with
`AgentRuntimeSelector` (`ptah.runtime = auto | claude-sdk | deep-agent`),
`DeepAgentAdapter implements IAgentAdapter`, `ToolBridgeService` (MCP
`tools/list` over HTTP), `JsonFileCheckpointer`, `StreamAdapterService`,
`PTAH_SUBAGENTS`. Deleted 2026-04-23 (`91397c571`, `31b59e0af`,
`2bfbe2c4d`). It did not support slash commands, worktree or compaction. The
`IAgentAdapter` seam remains.

## 6. Distinguishing features to design the loop around

1. Workspace intelligence tools in-process (LSP, symbol index, AST,
   dependents, diagnostics, memory, browser). Others ship read/grep/bash.
2. Progressive tool disclosure over the tool registry using the existing
   BM25+vector index; 8 core tools exposed, rest deferred.
3. Memory injected at `pre-step` as a logged event (`memory-curator`,
   `persistence-sqlite`, sqlite-vec).
4. Multi-vendor subagents (6 CLI adapters + tribunal) behind one provider port.
5. `.ptah/specs` as durable goal state (file-native, human-visible).
6. One loop in three hosts via `platform-core` ports; no 227 MB binary.
7. Ptah as the origin harness; `harness-sync` fans out to other vendors.

## 7. Proposed libs

| Lib                               | Owns                                                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `agent-loop-contracts` (zero-dep) | `ILlmStream`, `IAgentTool`, `IToolRegistry`, `ISessionLog`, `ICompactor`, `ISubagentProvider`, loop event union |
| `llm-providers`                   | pi-ai behind `ILlmStream`; provider routes                                                                      |
| `agent-loop`                      | turn/step engine, inbox, waterfalls, guards, tool-call repair, cache-stable prefix                              |
| `agent-context`                   | prune → spill → summarize; optional server compaction                                                           |
| `agent-tools`                     | core file/shell tools + in-process `ptah_*` registry + tool search                                              |
| `agent-session`                   | append-only log in `persistence-sqlite`, `deriveMessages()`, fork, JSONL export                                 |
| `NativeAgentAdapter`              | `IAgentAdapter`; emits `FlatStreamEventUnion`                                                                   |

## 8. Benchmarks and comparison path

- Terminal-Bench 2.0 (llm-stats, 2026-08-31): GPT-5.5 0.827, Claude Mythos
  Preview 0.820, Sonnet 5 0.804. Model-only.
- SWE-bench Verified (vals.ai, 2026-08-26): Opus 5 97.0%, DeepSeek V4 Pro
  96.4%, Kimi K3 93.4%. Saturated.
- No harness-level score exists for DeepSeek Harness, OpenCode, Pi or Deep
  Agents. Pi author's method: fixed model, swap harness. DeepSeek Harness ships
  Minimal mode (bash + editor) for benchmarking.
- Plan: Terminal-Bench 2.0 adapter in `ptah-cli`; run native conductor, SDK
  conductor, Pi, DeepSeek Harness minimal on one model.

## 9. Anthropic API features the loop must handle (2026)

Prompt caching (4 breakpoints, `cache_read_input_tokens`); adaptive thinking
(`budget_tokens` removed on Fable 5 / Opus 5 / Sonnet 5); interleaved thinking
auto on 4.6+; `tool_search_tool_regex_20251119` / `_bm25_20251119` +
`defer_loading`; context editing beta `context-management-2025-06-27`;
server compaction beta `compact-2026-01-12` (echo full `response.content`
back); 1M context default; `output_config.format` structured outputs; Files
API GA; `memory_20250818` tool; `code_execution_20260521`; MCP connector needs
`mcp_servers` + `mcp_toolset` + beta `mcp-client-2025-11-20`.

## 10. Risks

- pi-ai 0.x churn; scope renamed once. Pin exact; port-wrap.
- Claude subscription OAuth stays on the SDK conductor.
- Six readers of Claude JSONL need an `ISessionLog` adapter.
- Serialize same-file writes under parallel tool calls; isolate subagent
  failures.
- Cache invalidation on model or effort change mid-session.
- DeepSeek Harness is a 6-week-old developer preview; copy design, not
  packages.
