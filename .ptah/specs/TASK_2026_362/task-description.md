# TASK_2026_362 — Task Description: Native Ptah agent loop on pi-ai

Status: requirements. Author: project-manager. Date: 2026-08-31.
Inputs: `context.md`, `research-report.md`, root `CLAUDE.md`,
`libs/backend/agent-sdk/CLAUDE.md`, `libs/shared/src/lib/types/agent-adapter.types.ts`.

## 1. Problem statement and goals

Ptah runs every chat turn through `@anthropic-ai/claude-agent-sdk`, which spawns a
253 MB `claude.exe` per host, owns the transcript in `~/.claude/projects/**`, and
decides the tool preset, the system prompt, compaction, hooks and subagents. Ptah
reaches its own 49 `ptah_*` tools only over an HTTP MCP hop, cannot change the loop,
and pays the binary's startup and event-loop cost in all three hosts. The previous
alternative conductor (`libs/backend/deep-agent-sdk`, deleted 2026-04-23) proved the
`IAgentAdapter` seam works but depended on LangGraph and never reached parity.

The goal is a native conductor that Ptah owns end to end: a turn/step engine on the
`@earendil-works/pi-ai` provider layer (v0.84.4, confirmed on npm 2026-08-28),
exposed as `NativeAgentAdapter` behind the existing `IAgentAdapter` port
(`libs/shared/src/lib/types/agent-adapter.types.ts:190`). Users choose the conductor
per session. The SDK conductor stays for Claude subscription OAuth. The frontend
contract does not change: the loop emits `FlatStreamEventUnion`
(`libs/shared/src/lib/types/execution/stream-background.ts:266-286`, 20 variants).
The distinguishing features are in-process workspace-intelligence tools, memory
injection as a logged event, multi-vendor subagents behind one port, and one loop
that runs unchanged in VS Code, Electron and the CLI.

## 2. Scope

### 2.1 Phase 1 — minimum viable native conductor usable in chat

1. Turn/step engine: one user turn = N model steps; each step is one provider
   request followed by tool execution. Inbox with `steer`, `followUp`, `nextTurn`.
   Max-steps guard per turn. `AbortController` threaded through the stream and
   every tool call.
2. Core tools: `read`, `write`, `edit` (exact-match replace), `bash`, `glob`,
   `grep`. File tools use `PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER`. Same-file
   writes are serialized under parallel tool calls.
3. In-process `ptah_*` tools: the tool list and tool call of
   `libs/backend/vscode-lm-tools` reached through a function call, not HTTP. The
   caller session id that `extractCallerSessionId` derives from the URL today must
   arrive by parameter. The HTTP MCP server stays for external CLIs.
4. Permission gate: the existing `SdkPermissionHandler`
   (`libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts`, `canUseTool` at
   :434) decides every tool call before execution. Same `AgentPermissionLevel`
   enum. Ask/allow/deny outcomes reach the UI through the same pending registry.
5. Session log: append-only event log in `persistence-sqlite` (next migration is
   `0042`). Invariant: anything the model saw was logged. `deriveMessages()`
   rebuilds the provider message list from the log. Session id minted at turn 0 and
   published through `setSessionIdResolvedCallback`.
6. Streaming: pi-ai `text_delta` / `thinking_delta` / `toolcall_delta` / `done` /
   `error` mapped to `FlatStreamEventUnion`. Per turn: `message_start`, deltas,
   `tool_start` → `tool_delta`\* → `tool_result`, `message_complete`, `turn_state`.
   `ResultStatsCallback` fires once per turn with pi-ai usage.
7. Runtime selection per session: `ChatStartParams`
   (`libs/shared/src/lib/types/rpc/rpc-chat.types.ts:37`) gains
   `runtime?: 'sdk' | 'native'`. Omitted means `sdk`. The choice is persisted with
   the session so `chat:resume` and `chat:continue` reach the same conductor.
   Default configurable in `~/.ptah/settings.json`, never in
   `package.json contributes.configuration`.
8. Providers: Anthropic API key via `ProviderProfile.authEnv.ANTHROPIC_API_KEY`
   (`anthropic-messages` wire), and OpenAI-compatible routes (`openai-completions`,
   `openai-responses`) for Ollama, LM Studio, OpenRouter and custom gateways without
   the translation proxies in `auth-providers/src/lib/translation/`.
9. System prompt: own prompt under 2,000 tokens, `PTAH_CORE_SYSTEM_PROMPT` appended.
10. Mid-turn controls: `interruptCurrentTurn`, `interruptSession`,
    `setSessionModel`, `setSessionPermissionLevel`, `setSessionEffort`.
11. Prompt caching: stable prefix order (system, tools, history), pi-ai
    `cacheRetention`; cache reset logged on model or effort change.
12. Dangling tool-call repair on resume (a `tool_use` without a `tool_result` gets
    a synthetic error result before the next request).
13. Registration in all three composition roots (`apps/ptah-extension-vscode/src/di`
    phase-2, `apps/ptah-electron/src/di` phase-2, `cli-engine/src/lib/container.ts`),
    with `expected-resolvable.ts` updated.

### 2.2 Phase 2 — context, subagents, hooks, commands, fork

1. Compaction, three tiers in-loop: prune old tool arguments; spill oversized tool
   results to a file with a locator; LLM summary at 85% of the context window.
   Emits `compaction_start` / `compaction_complete` and fires
   `CompactionStartCallback`. `/compact` command.
2. `ISubagentProvider` port with `fork-in-process` and `vendor-cli` (existing
   `cli-agent-runtime` adapters) providers. Emits `agent_start`, `agent_progress`,
   `agent_status`, `agent_completed`. One subagent failure never cancels siblings.
3. `hooks.json` bridge, Claude Code dialect first: `SessionStart`, `SessionEnd`,
   `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`,
   `PreCompact`, `PostCompact`. Exit code 2 blocks the tool call.
4. Slash commands dispatched without a model turn: `/compact`, `/context`, `/cost`,
   `/model`. User commands from `~/.ptah/user/commands/**` and
   `{ws}/.ptah/commands/**`. Skills and agents read from the same roots.
5. Fork: `session:forkSession` on a native session creates a child session whose
   log points to `parentId` and the fork position.
6. Memory injection: recalled memory from `memory-curator` inserted at pre-step as a
   logged event.
7. One-shot path: `curator-llm-adapter` and `skill-synthesis` can select the native
   loop for headless queries.

### 2.3 Phase 3 — checkpoint, tool search, benchmark

1. File checkpoint per turn and `session:rewindFiles` on native sessions.
2. Tool search / deferred loading: first request carries the core tools plus a
   `tool_search` tool; `ptah_*` tools load on demand through the existing BM25 +
   vector index. Anthropic `defer_loading` + `tool_search_tool_bm25` on Anthropic
   routes only.
3. Terminal-Bench 2.0 adapter in `apps/ptah-cli`: runs one task set against
   `--runtime native` and `--runtime sdk` on one model and writes a results JSON.
4. JSONL export of a native session in the Claude layout so the six transcript
   readers in `agent-sdk` work on native sessions.

### 2.4 Feature-parity checklist (research-report.md section 3)

| SDK / binary feature                                                      | Phase                                                                          |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Agent loop (turn, tool_use, tool_result, stop)                            | 1                                                                              |
| `claude_code` tool preset → own core tools + in-process `ptah_*`          | 1 (WebFetch, WebSearch via existing `ptah_*` tools; NotebookEdit out of scope) |
| `claude_code` system prompt preset → own prompt                           | 1                                                                              |
| Ptah MCP server via HTTP → in-process registry                            | 1; tool search 3                                                               |
| Transcript store `~/.claude/projects/**` → session log                    | 1 (SQLite); JSONL export 3                                                     |
| Session UUID from `system/init` → minted at turn 0                        | 1                                                                              |
| `resume`                                                                  | 1                                                                              |
| `forkSession`                                                             | 2                                                                              |
| `rewindFiles`                                                             | 3                                                                              |
| Auto-compaction, `compact_boundary`, PreCompact/PostCompact               | 2                                                                              |
| `canUseTool` permission callback                                          | 1; wildcard rules 2                                                            |
| `permissionMode` enum                                                     | 1                                                                              |
| 17 hook events → `hooks.json` bridge                                      | 2 (9 events); the other 8 map to loop events only                              |
| Subagents (`Task`, `task_*` messages, `getSubagentMessages`)              | 2                                                                              |
| Skills / agents / commands / output styles from harness dirs              | 2                                                                              |
| Built-in slash commands                                                   | 2                                                                              |
| Plugins (`Options.plugins`)                                               | out of scope (never set today)                                                 |
| Auto-memory subsystem                                                     | out of scope (memory-curator injection replaces it, phase 2)                   |
| `thinking`, `effort`, `model`                                             | 1                                                                              |
| Prompt caching                                                            | 1                                                                              |
| 1M context                                                                | 1 (default on supported models); `token-meter` 2                               |
| `interrupt()`, `setModel()`, `setPermissionMode()`                        | 1                                                                              |
| `includePartialMessages` stream events                                    | 1                                                                              |
| Cost / usage on `result`                                                  | 1 (best effort, labeled as such)                                               |
| Provider switching via translation proxies → pi-ai wire protocols         | 1                                                                              |
| Claude subscription OAuth                                                 | out of scope on the native loop                                                |
| Off-thread spawner, `pathToClaudeCodeExecutable`, detector                | not needed on the native path                                                  |
| File checkpointing                                                        | 3                                                                              |
| Workflows                                                                 | out of scope                                                                   |
| `curator-llm-adapter` one-shot on native loop                             | 2                                                                              |
| Anthropic server-side compaction beta                                     | out of scope (see Q4)                                                          |
| Anthropic context editing, Files API, `memory_20250818`, `code_execution` | out of scope                                                                   |

## 3. Explicitly out of scope

- Claude subscription OAuth on the native loop. Subscription tokens stay on the SDK
  conductor only.
- Deleting or shrinking the SDK conductor. `agent-sdk` behavior and its specs stay
  as they are.
- Depending on `pi-agent-core`. Copy its shape, import only `@earendil-works/pi-ai`.
- LangGraph, `deepagents`, or any `@langchain/*` package.
- Cordis or any DeepSeek Harness package. Copy design, not packages.
- Bedrock and Vertex routes on the native loop.
- Changes to the frontend beyond a runtime selector control and a session badge.
  No new `FlatStreamEventUnion` variant.
- `NotebookEdit`, `TodoWrite`, `ExitPlanMode` as native tools (the last two exist as
  Ptah services and stay where they are).
- Changing `harness-sync` ownership. `~/.ptah/user/**` remains the base layer.

## 4. Acceptance criteria

Each criterion names what a reviewer opens or runs. "Spec" means a Jest spec that
passes under `npx nx run-many -t test -p <projects>`.

### Phase 1

- P1-1 `package.json` lists `"@earendil-works/pi-ai": "0.84.4"` with no range prefix.
  No `pi-agent-core`, `@langchain/*`, `deepagents` or `cordis` entries appear.
- P1-2 Every new lib has `project.json` with both a `scope:*` and a `type:*` tag
  and `npx nx run-many -t lint -p <new libs>` passes with zero
  `@nx/enforce-module-boundaries` errors.
- P1-3 `NativeAgentAdapter implements IAgentAdapter` compiles under
  `npm run typecheck:all`. A spec constructs it with fakes and calls every method
  of the port. `getCliJsPath()` returns `null`. `preloadSdk()` resolves.
- P1-4 A spec drives `startChatSession` with a fake `ILlmStream` that returns one
  text answer and observes exactly: `message_start` (with `sessionId`),
  `text_delta`+, `message_complete`, `turn_state` with `phase: 'idle'`.
- P1-5 A spec with a fake model that requests `write` observes
  `tool_start` → `tool_delta`\* → `tool_result`. With the permission gate set to
  deny, the `tool_result` carries `isError: true`, the next provider request
  contains the denial text, and the fake file system has no write.
- P1-6 A spec calls `ptah_ast_analyze` through the native registry with the HTTP
  MCP server not started, and asserts the result equals the result of the same
  call through `handleMCPRequest`. The call carries the caller session id.
- P1-7 A spec replays a session with three turns, two tool calls and one model
  switch, and asserts that `deriveMessages()` equals the message list passed to
  the fake provider on every request (model-visible means logged).
- P1-8 A spec calls `interruptCurrentTurn` during a streaming step and asserts the
  provider abort signal fired, a `turn_state` event followed, and
  `isSessionActive` remains `true`. `interruptSession` then returns `false`.
- P1-9 A spec asserts `setSessionModel`, `setSessionPermissionLevel` and
  `setSessionEffort` change the next provider request or the next gate decision.
- P1-10 A spec with a `ProviderProfile` for an OpenAI-compatible base URL asserts
  the provider adapter selects `openai-completions` and no translation proxy
  starts. A profile with `ANTHROPIC_API_KEY` selects `anthropic-messages`.
- P1-11 `chat:start` with `runtime: 'native'` returns a `sessionId`; `session:list`
  reports `runtime: 'native'` for it; `chat:continue` on it reaches the native
  adapter (spec on the chat session service with two adapter fakes).
- P1-12 `chat:start` without `runtime`, and every existing `agent-sdk` and
  `rpc-handlers` spec, behaves as before. `npx nx run-many -t test -p
@ptah-extension/agent-sdk @ptah-extension/rpc-handlers` passes.
- P1-13 The VS Code and Electron composition-root smoke specs resolve the native
  adapter token. `cli-engine` registers it. `ptah session start --runtime native`
  (or the equivalent JSON-RPC param) streams a reply in a manual check.
- P1-14 A spec counts the assembled system prompt with `PLATFORM_TOKENS.TOKEN_COUNTER`
  and asserts under 2,000 tokens before `PTAH_CORE_SYSTEM_PROMPT` is appended.
- P1-15 A spec with a fake model that always calls a tool ends the turn at the
  max-steps cap and emits `turn_state` with a non-null `terminalReason`.
- P1-16 A spec issues two parallel `edit` calls on one file and asserts both
  results apply in order. Two calls on different files run concurrently.
- P1-17 A spec resumes a log whose last event is a `tool_use` with no
  `tool_result` and asserts the next request contains a synthetic error result.
- P1-18 A spec asserts the cache-stable prefix: two consecutive requests share an
  identical system and tools segment, and a model change logs a cache-reset event.
- P1-19 Every `catch` in new code is `catch (error: unknown)`. Every RPC param,
  settings value, `hooks.json` file and tool argument crosses a Zod schema.
  A reviewer greps the new libs for `@ts-ignore` and finds none.

### Phase 2

- P2-1 Compaction spec: a log above the threshold produces
  `compaction_start`, then `compaction_complete`, `CompactionStartCallback` fires
  with `preTokens`, and the next request is below the threshold. Tool results
  above the spill size are replaced by a locator and the file exists.
- P2-2 `/compact` on a native session runs compaction with no provider text turn.
- P2-3 Subagent spec: a `Task` tool call through `fork-in-process` emits
  `agent_start` … `agent_completed`. Two siblings, one throwing: the other
  completes and the parent turn continues.
- P2-4 A `vendor-cli` subagent spec uses a fake `cli-agent-runtime` adapter and
  observes the same event sequence as P2-3.
- P2-5 `hooks.json` spec: a `PreToolUse` hook that exits 2 blocks the tool and the
  model receives the hook's stderr. All nine bridged events fire in order for one
  turn with one tool call.
- P2-6 Slash-command spec: `/model`, `/cost`, `/context` return output with zero
  provider requests. A user command from `{ws}/.ptah/commands` expands into the
  next user message.
- P2-7 `session:forkSession` on a native session returns a new id; the log of the
  child references `parentId` and the fork event index; `chat:continue` on the
  child works.
- P2-8 Memory spec: a recall hit appears in the log as a pre-step event and in the
  provider request.
- P2-9 `InternalQueryService` (or its native counterpart) runs one headless query
  on the native loop with `persistSession: false` and returns text.

### Phase 3

- P3-1 Rewind spec: two turns, each writes a file; `session:rewindFiles` to turn 1
  restores the first content.
- P3-2 Tool-search spec: first request has the core tools plus `tool_search`; a
  search for "ast" makes `ptah_ast_analyze` available in the next request.
- P3-3 `ptah bench tb2 --runtime native --model <id>` and `--runtime sdk` each
  write a results JSON with per-task pass/fail and token counts. The command
  exists in `apps/ptah-cli/src/cli/router.ts` help output.
- P3-4 JSONL export spec: `JsonlReaderService` reads an exported native session
  and returns the same turn count as the SQLite log.

## 5. Non-functional constraints

- Hexagonal rule: new backend libs import `@ptah-extension/platform-core` ports
  only. No import of `platform-vscode`, `platform-electron` or `platform-cli`.
  The `ide-capabilities.vscode.ts` file in `vscode-lm-tools` stays behind
  `IIDECapabilities` and must not be pulled into the native tool registry.
- Nx tags: contracts lib `scope:extension` + `type:core`; provider, loop, tools,
  session and adapter libs `scope:extension` + `type:feature`. `type:core` may
  depend only on `type:core|util`. `cli-engine` (`scope:cli`) may depend on them.
- DI: tokens `UPPER_SNAKE` as `Symbol.for(...)` in a per-lib `tokens.ts`,
  registered in `register.ts`. Constructors under ~8 injected dependencies.
- Zod 4.3.6 at boundaries: RPC params, settings, `hooks.json`, provider responses,
  tool arguments from the model. No re-validation inside the loop.
- `max-lines` soft ceiling 700 per file. The engine, the tool registry and the
  adapter are the likely offenders; split by the facade rule, not into `utils`.
- Three hosts: the same lib code runs in VS Code, Electron and the CLI. No
  `import 'vscode'` outside `platform-vscode`. Node `child_process` for `bash`.
- Frontend: no new `[innerHTML]`. Tool output renders through
  `libs/frontend/markdown`.
- Pin `@earendil-works/pi-ai` to the exact version. Every pi-ai type stays inside
  the provider lib; the rest of the code sees only `ILlmStream`.
- RPC: prefer new params on existing `chat:*` and `session:*` methods. A new
  namespace needs both `rpc.types.ts` and `ALLOWED_METHOD_PREFIXES`.
- Marketplace scanner: no trademarked AI product names in new non-JS files that
  ship in the VSIX. Lib `CLAUDE.md` files are excluded by `.vscodeignore`.
- Tests: `npx nx run-many -t test -p <projects>`, never `nx test a b c`.
- Testing rule: `senior-tester` gates each phase. Execution mode is CLI agents
  only (user instruction in `context.md`).

## 6. Risks and mitigations

| Risk                                     | Evidence                                                                                                                                                                                                                               | Mitigation                                                                                                                                               |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime selection is bypassed            | Five `rpc-handlers` files inject `SDK_TOKENS.SDK_AGENT_ADAPTER` directly (`auth-rpc`, `config-rpc`, `provider-rpc`, `session-rpc`, `chat-ptah-cli`); `session:forkSession` and `session:rewindFiles` live in `session-rpc.handlers.ts` | Route session-scoped calls through `TOKENS.AGENT_ADAPTER`; keep SDK-only concerns (CLI detection, SDK models) on the concrete token. Spec P1-11          |
| Permission gate drags the monolith       | `SdkPermissionHandler` lives in `agent-sdk` (211 files, external `@anthropic-ai/claude-agent-sdk`)                                                                                                                                     | Define a permission port in the contracts lib; `SdkPermissionHandler` satisfies it; host registers the alias. Native libs never import `agent-sdk`       |
| `vscode-lm-tools` is VS Code-flavored    | Tag `domain:vscode`; `ide-capabilities.vscode.ts` imports `vscode`; `protocol-dispatcher.ts` takes `WebviewManager`                                                                                                                    | In-process registry consumes `PtahAPI` + a `tools/call` function; `IIDECapabilities` stays optional. Spec P1-6 in a host with no `vscode`                |
| Provider profile is Anthropic-shaped     | `ProviderProfileAuthEnv` has only `ANTHROPIC_*` keys                                                                                                                                                                                   | Extend `ProviderProfile` with an optional wire-protocol field and matching Zod schema; SDK path ignores it                                               |
| Session identity rule conflict           | `agent-sdk/CLAUDE.md`: "Never mint a Ptah-side sessionId"                                                                                                                                                                              | Rule is scoped to the SDK conductor. Native mints once at turn 0 and publishes via `setSessionIdResolvedCallback`; a tabId is never reused as session id |
| Six JSONL readers see no native sessions | `jsonl-reader`, `session-replay`, `agent-correlation`, `session-history-reader`, `sdk-transcript-reader`, `session-importer`                                                                                                           | Phase 3 JSONL export; until then `skill-synthesis` and `memory-curator` skip native sessions by `runtime`                                                |
| pi-ai 0.x churn                          | Scope renamed once; 0.84.4                                                                                                                                                                                                             | Exact pin; one provider lib owns the import; `ILlmStream` contract spec                                                                                  |
| Cost figures are best effort             | pi-ai author statement                                                                                                                                                                                                                 | Label as estimate in `ResultStatsPayload` consumers; no billing use                                                                                      |
| Parallel writes corrupt files            | Pi needed `withFileMutationQueue()`                                                                                                                                                                                                    | Per-path mutex in the tool executor. Spec P1-16                                                                                                          |
| Subagent failure cascades                | Deep Agents #694                                                                                                                                                                                                                       | Isolated promise per subagent. Spec P2-3                                                                                                                 |
| Cache invalidation mid-session           | Model or effort change resets prefix                                                                                                                                                                                                   | Log a cache-reset event; keep prefix order fixed. Spec P1-18                                                                                             |
| Loop growth past `max-lines`             | `agent-sdk/helpers` is 16,149 LOC                                                                                                                                                                                                      | Facade rule; 2–3 collaborators per concern; review at each batch                                                                                         |
| Tool count drift                         | Grep finds 49 `ptah_*` names; report says 51                                                                                                                                                                                           | Registry spec asserts the in-process list equals the HTTP `tools/list`                                                                                   |
| Composition-root drift                   | `expected-resolvable.ts` in two apps                                                                                                                                                                                                   | Update both manifests in the same batch as registration                                                                                                  |

## 7. Open questions for the architect

1. Session log format. Recommendation: SQLite append-only table in
   `persistence-sqlite` (migration `0042`) behind an `ISessionLog` port, with
   `deriveMessages()` as the only read path the loop uses. JSONL export in the
   Claude layout is Phase 3. Reason: one store, one invariant, no dual writes.
2. Hook events in v1. Recommendation: none as `hooks.json` in Phase 1; the loop
   emits internal waterfall events only. Phase 2 bridges nine events (section
   2.2.3). `TaskCreated`, `TaskCompleted`, `TeammateIdle`, `UserPromptExpansion`,
   `StopFailure`, `SubagentStart`, `SubagentStop`, `WorktreeCreate`,
   `WorktreeRemove` map to loop events and stream events only.
3. File checkpoint and rewind. Recommendation: defer to Phase 3. Implement as a
   copy-on-write snapshot of files a turn touches, under
   `~/.ptah/checkpoints/<sessionId>/<turn>/`, not `git stash`, so it works in
   non-git folders and never touches the user's index.
4. Compaction v1. Recommendation: in-loop three tiers only. The Anthropic
   server-side compaction beta is out of scope because it changes behavior per
   provider and the log invariant needs the summary as a logged event.
5. Harness source. Recommendation: the native loop reads `~/.ptah/user/**` and
   `{ws}/.ptah/**` directly and never reads `.claude/**`. `harness-sync` is
   unchanged; Ptah is already the origin.
6. Selector shape. Recommendation: an `AgentRuntimeSelector implements IAgentAdapter`
   bound to `TOKENS.AGENT_ADAPTER`, delegating by a session → runtime map, with
   `SdkAgentAdapter` and `NativeAgentAdapter` on their own tokens. Handlers that
   need SDK-only features keep `SDK_AGENT_ADAPTER`.
7. Permission port. Recommendation: `IToolPermissionGate` in the contracts lib,
   with `SdkPermissionHandler` as the Phase 1 implementation registered by the
   host. Extraction of the permission code into its own lib is a later task.
8. Tool schema format. Recommendation: `IAgentTool` carries JSON Schema
   (`tool-description.builder.ts` already does). Core tools define Zod schemas
   and convert with Zod 4 `toJSONSchema`. pi-ai TypeBox types stay inside the
   provider lib.
9. In-process tool call surface. Recommendation: extract a `tools/list` and
   `tools/call` function from `protocol-dispatcher.ts:151` that both the HTTP
   handler and the native registry call, with the caller session id as a
   parameter. No synthetic JSON-RPC envelopes in the loop.
10. `bash` tool. Recommendation: Node `child_process` with timeout, output cap and
    cwd from `IWorkspaceProvider`. `PTY_HOST` is for the terminal UI, not tools.
11. Default runtime. Recommendation: `sdk` stays the default. A
    `~/.ptah/settings.json` key sets the default; `chat:start.runtime` overrides
    per session. Native is opt-in until Phase 3 benchmark results exist.
12. Lib set. Recommendation: the seven libs in research-report.md section 7, but
    the architect may merge `agent-context` into `agent-loop` for Phase 1 and
    split it in Phase 2 when compaction lands. No lib under ~150 lines.
13. Phase 1 session list. Question: do `session:list` and the Kanban read the
    SQLite log, or does the native adapter also write `SessionMetadataStore`
    entries? Recommendation: write metadata entries as today, so the UI list
    needs no change.
