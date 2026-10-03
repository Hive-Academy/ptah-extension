# Implementation Plan - TASK_2026_595_1c01

Load `ptah_dashboard_propose_spec`, `ptah_surface_update` and `ptah_surface_get_state`
only in the Ptah Apps page chat. All paths are relative to the worktree root
`D:\projects\ptah-extension\.claude-worktrees\task-595-apps-tool-profile`.

## Inputs and constraints

- Requirements used: `.ptah/specs/TASK_2026_595_1c01/context.md` (user decision 2026-10-03), `task.md`.
- Corrections applied: none. There was no `task-description.md`, `research-report.md` or earlier plan in the folder. Nothing was blocked by that.
- Design handoff used: none (no UI change).
- Repository rules applied: `CONVENTIONS.md:103-116` (layer rule: `shared` L0, `agent-sdk` L3, `rpc-handlers` and `vscode-lm-tools` L4). The rule decides where the shared profile type lives.
- Correction to the brief: `sdk-query-runner.service.ts:587` builds the URL for **one-shot** internal queries (curator, wizards, skill synthesis). It is not the Apps chat path. The Apps chat is an interactive `chat:start` session, and its URL is built at `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1804`. The one-shot path keeps the coding profile and does not change.
- Missing decision-critical input: none.

## Codebase evidence

| Evidence | Location | Architectural implication |
| --- | --- | --- |
| The HTTP transport stamps caller identity from the URL only, after deleting body copies of `_caller*` | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-server.handler.ts:368-381` | The profile becomes a 4th transport-owned field, `_callerToolProfile`, read the same way. A body can never set it. |
| URL grammar parsers: `^/session/([^/?]+)` and `^/agent/([^/?]+)` (prefix-anchored), plus a strict terminal workspace regex | `http-server.handler.ts:245-249`, `:271-275`, `:299-307` | A profile segment placed **after** the existing segments leaves the session and agent parsers untouched. Only the workspace regex must accept an optional trailing `/profile/{name}`. |
| The grammar is documented as CLOSED and pinned by specs | `http-server.handler.ts:280-297`, `http-server.handler.spec.ts:468-610` | The grammar comment and the spec block must be extended together. |
| `MCPRequest` carries `_callerSessionId`, `_callerWorkspaceRoot` and `_callerAgentId` | `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/types/mcp-protocol.types.ts:30-51` | Add `_callerToolProfile?: string` here, holding the raw URL value. |
| `resolveMcpCaller` is pure, and a malformed field "can only make the caller LESS specific" | `mcp-core/mcp-caller.ts:43-68` | Same rule for the profile: an unknown value resolves to `coding`, the smaller tool set. It goes in its own resolver, because the profile is not caller identity. |
| `tools/list` → `handleToolsList` → `buildToolSet(caller, deps)`, documented as "the single composition point for per-caller tool sets" | `mcp-core/protocol-dispatcher.ts:355-390` | The profile filter belongs in `buildToolSet`. `buildToolDefinitions` stays the full catalog. |
| The three tools are always on today, with no toggle | `protocol-dispatcher.ts:415-425` | Keep them in `buildToolDefinitions` and filter them per profile. |
| Telemetry builds the set of registered names from the full `buildToolDefinitions` | `protocol-dispatcher.ts:508-515` | Must still contain the three names, which is why the filter goes in `buildToolSet` and not in `buildToolDefinitions`. |
| Eager loading: `markEagerTools` stamps `_meta['anthropic/alwaysLoad']`. The three tools are NOT eager today. | `protocol-dispatcher.ts:520-543`, `:624-641` | The apps profile adds the three names to the eager set (context.md approach item 3). |
| `tools/call` binds an AsyncLocalStorage request context, then dispatches | `protocol-dispatcher.ts:255-270`, `:818-846` | Put the profile in that context. The tools/call gate and `ptah.help()` both read it. |
| Case bodies of the three tools | `protocol-dispatcher.ts:1938-1995` | Not changed. The gate runs before `handleIndividualTool`. |
| `toolErrorResponse` returns an `isError` tool result | `protocol-dispatcher.ts:2372-2381` | Shape of the "Apps page only" refusal. |
| Request context API (`callerSessionId`, `callerWorkspaceRoot`, `callerAgentId` and their getters) | `mcp-core/mcp-request-context.ts:21-80` | Add `callerToolProfile` and `getCallerToolProfile()`, which returns `'coding'` outside a call. |
| Caller context already reaches `execute_code` namespaces through injected getters | `code-execution/ptah-api-builder.service.ts:107-110`, `:959-966`; `workspace-root-resolver.ts:30-32` | `buildHelpMethod` receives `getCallerToolProfile` as a dependency, following the same pattern. |
| Help text names the surface and dashboard tools: overview lines 62-63, topics `dashboard` (67-112) and `surface` (114-142). `buildHelpMethod()` takes no dependencies. | `namespace-builders/system-namespace.builders.ts:49-142`, `:687-704`; wired at `ptah-api-builder.service.ts:882` | Make help aware of the profile. `HELP_DOCS` stays the full catalog. |
| The `execute_code` tool description and server instructions do NOT mention surface or dashboard | `mcp-core/tool-description.builder.ts` (only match is "API surface" at :1758); `mcp-core/server-instructions.ts` (no match) | Only the help text needs gating. `initialize` stays byte-stable (`protocol-dispatcher.ts:316-317`). |
| Interactive chat MCP URL: `http://localhost:${PTAH_MCP_PORT}/session/${enc(routingId)}` | `agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1781-1812`, call site `:1149` | Single writer for chat sessions. It gains an optional profile argument. |
| `build()` receives `sessionConfig: AISessionConfig` | `sdk-query-options-builder.ts:691-697`, `:969-994` | Carry the profile on `AISessionConfig`. No new `QueryOptionsInput` field is needed. |
| The adapter spreads the whole caller config into `sessionConfig` for start and for resume | `agent-sdk/src/lib/sdk-agent-adapter.ts:711-720`, `:737`, `:956-960`, `:983`; executor forwards it at `session-lifecycle/session-query-executor.service.ts:384-387` | A new `AISessionConfig` field reaches the builder with zero adapter edits. |
| `AISessionConfig` is the shared base of the start and resume configs | `libs/shared/src/lib/types/ai-provider.types.ts:149-262`; `agent-adapter.types.ts:175-193` | Add `mcpToolProfile?: McpToolProfile` once. |
| `ChatStartParams` / `ChatContinueParams` carry top-level `surfaceMode` | `libs/shared/src/lib/types/rpc/rpc-chat.types.ts:39-104`, `:117-147` | Add a sibling top-level `mcpToolProfile`. `surfaceMode` cannot be reused because the harness builder also sends it (`libs/frontend/harness-builder/src/lib/services/harness-workflow.service.ts:310,377`). |
| RPC boundary validation, `.passthrough()` schemas | `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts:53-71`; applied at `chat-rpc.handlers.ts:217,225` | Validate the new field as a closed enum here. |
| `chat:start` → `sdkAdapter.startChatSession({... systemPrompt: options?.systemPrompt ...})` | `rpc-handlers/src/lib/chat/session/chat-session.service.ts:555-574` | Thread `mcpToolProfile` here. |
| `chat:continue` on an inactive session → `autoResumeIfInactive` → `sdkAdapter.resumeSession` with a fresh config that drops `systemPrompt` and has no profile | `chat-session.service.ts:684-691`, `:1155-1261`; preflight type `:111-119` | **Rebuilding the URL on resume would silently lose the profile.** `chat:continue` must carry it too. A live session keeps its URL: `:1172-1174` returns before any rebuild. |
| The slash-command follow-up builds a new query with an inline `sessionConfig` | `chat-session/chat-slash-command-router.service.ts:117-132` | Thread the profile here too, or the next query of the Apps session loses the tools. |
| Surface submit sends only to a live record and never rebuilds | `chat/session/surface-submit-turn.service.ts:170-178`, `:298` | No change. |
| Apps page `chat:start` (`surfaceMode: true`, `options.systemPrompt: APPS_SYSTEM_PROMPT`) and `chat:continue` | `libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.ts:237-250`, `:321-326` | The only sender of `mcpToolProfile: 'apps'`. |
| `redactMcpUrl` treats a `profile` QUERY parameter as a secret | `agent-sdk/src/lib/helpers/redact-mcp-url.ts:24-34` | A `?profile=apps` query would be masked in every log line. A path segment stays readable, which is one more reason for the path form. |
| Other Ptah MCP URL writers | `cli-agent-runtime/.../cli-adapters/ptah-mcp-url.ts:46-58` (CLI agent lanes, `ptah-cli-spawn-options.service.ts:230`); `vscode-lm-tools/.../mcp-http/ptah-mcp-slots.ts:241-245` (`.mcp.json` for external clients and SDK subagents); `sdk-query-runner.service.ts:573-590` (one-shots) | None of them carries a profile, so all stay on `coding` without edits. The acceptance bullet "CLI agent lane does not list them" holds by construction. |
| The stdio MCP server has its own tool builders and never lists the three tools | `code-execution/mcp-stdio/*.ts` (no `Surface`/`Dashboard` match outside specs) | The CLI `mcp-serve` path needs no change. |
| Measured definition sizes: `ptah_surface_update` 65,190 chars, `ptah_surface_get_state` 2,141 chars, dashboard tool ≤ 3,000 chars | `mcp-core/surface-tools.spec.ts:55-62`; `dashboard-propose-spec.tool.spec.ts:101-107` | Expected saving is about 70k chars (about 17k tokens) per coding `tools/list`. The measurement step confirms it. |
| The Apps system prompt names the three tools | `libs/frontend/mcp-apps-page/src/lib/apps-system-prompt.ts:13-20` | Unchanged. It is sent only with the apps profile. |

## Architecture decision

- **Chosen approach:** a closed MCP **tool profile** carried as a terminal path segment of the Ptah MCP URL: `/session/{id}/profile/apps`. The grammar becomes `[ /session/{id} | /agent/{id} ] [ /workspace/{root} ] [ /profile/{name} ]`, and each part is optional.
  - No segment means `coding`, so every existing URL keeps its meaning byte for byte.
  - The transport stamps `_callerToolProfile`. `resolveMcpToolProfile` maps it onto `'coding' | 'apps'`.
  - `buildToolSet` drops the three tools for `coding`. `markEagerTools` makes them eager for `apps`.
  - `tools/call` for them under `coding` returns an `isError` result saying they are available on the Apps page only.
  - `ptah.help()` hides them under `coding`.
  - The Apps page sends `mcpToolProfile: 'apps'` on `chat:start` and `chat:continue`. The value travels on `AISessionConfig` to the single interactive URL writer.
- **Rationale:**
  - It uses the existing identity channel: URL to transport field to resolver to request context. Evidence: `http-server.handler.ts:368-381`, `mcp-request-context.ts`, `protocol-dispatcher.ts:255-270`.
  - It uses the composition point the dispatcher already reserves for per-caller sets (`protocol-dispatcher.ts:371-390`).
  - It needs no adapter or executor change, because `AISessionConfig` is spread through (`sdk-agent-adapter.ts:713-720`, `:956-960`).
- **Unknown profile segment resolves to `coding` and is not rejected.** The server is localhost and unauthenticated, so the profile is attribution, not authorization (`http-server.handler.ts:264-269`). Rejecting would turn a mis-built URL into a dead MCP server for the whole session. Falling back to `coding` only shrinks the set, which is the rule `resolveMcpCaller` already follows (`mcp-caller.ts:45-50`).
- **Rejected alternatives:**
  1. A query parameter `?profile=apps`. It needs no parser change, but `redactMcpUrl` masks `profile` as a secret (`redact-mcp-url.ts:33`), so every log of the URL would hide the profile. It also departs from the documented path grammar.
  2. Reusing `surfaceMode` as the signal. The harness builder also sets it (`harness-workflow.service.ts:310,377`), so harness sessions would get the Apps tools.
  3. Persisting the profile in session metadata so resume can recover it. That adds a storage shape for one flag. The Apps page already re-sends turn parameters (`surfaceMode`) on every `chat:continue` (`apps-session.service.ts:325`), so carrying `mcpToolProfile` alongside it is the established pattern.
  4. Deferring the tools with tool search in coding sessions. context.md ("Why not tool-search deferral") rejects this, and it would still leave the schemas in CLI-lane listings.
- **Assumptions:**
  - A1: The Claude Agent SDK's HTTP MCP client posts to the configured URL path unchanged, including a trailing `/profile/apps`. This is already relied on for `/session/{id}`. Check: after the change, start an Apps session and confirm the log line `[SdkQueryOptionsBuilder] MCP servers ENABLED` shows `.../session/<tab>/profile/apps` (`sdk-query-options-builder.ts:1807-1810`). Then confirm the three tools appear in the Apps chat and are absent in a normal chat.
  - A2: AsyncLocalStorage context reaches `ptah.help()` when it is called inside `execute_code`. The workspace resolver already depends on the same mechanism (`ptah-api-builder.service.ts:959-966`). Check: the dispatcher spec case "execute_code help hides surface under coding" listed below.
- **Effect on existing code:**
  - The always-on decision of TASK_2026_493/538 is replaced. The comments at `protocol-dispatcher.ts:415-425` are rewritten to state the profile rule.
  - Nothing is kept for compatibility. The coding profile simply does not list the tools. There is no flag, no V2 copy and no shim.
  - Out of scope, left as is: `ptah.dashboard` / `ptah.surface` remain callable inside `execute_code` (`ptah-api-builder.service.ts:874-881`). They cost no context, because the help hides them and they are not in `tools/list`. Hard-gating them is a separate decision.
  - SDK subagents of an Apps session reach Ptah through `.mcp.json`, which uses the coding profile (`ptah-mcp-slots.ts:241-245`). They do not get the surface tools, and that is intended.

## Component specifications

### 1. Shared profile contract (`@ptah-extension/shared`)

- Purpose: one closed list of MCP tool profiles, plus the typed fields that carry the profile from the RPC to the SDK session config.
- Responsibilities:
  - In `ai-provider.types.ts`, near `AISessionConfig`:
    ```ts
    /** Ptah MCP tool profile: which tool set a session's MCP URL asks for. */
    export const MCP_TOOL_PROFILES = ['coding', 'apps'] as const;
    export type McpToolProfile = (typeof MCP_TOOL_PROFILES)[number];
    ```
  - `AISessionConfig` gets `readonly mcpToolProfile?: McpToolProfile;`. The doc says: absent means `coding`; `'apps'` is set only by the Apps page; the value is read by `SdkQueryOptionsBuilder.buildMcpServers`.
  - In `rpc-chat.types.ts`: `ChatStartParams.mcpToolProfile?: McpToolProfile` and `ChatContinueParams.mcpToolProfile?: McpToolProfile`. Both are top level, next to `surfaceMode`. Import from `'../ai-provider.types'`, the same file `rpc-chat.types.ts:9` already imports from.
- Verified contracts: `ai-provider.types.ts:149`; `rpc-chat.types.ts:39-104`, `:117-147`; `libs/shared/src/index.ts:2` (`export * from './lib/types/ai-provider.types'`).
- Dependencies: none (L0).
- Integration points: components 2, 3, 4 and 7.
- Failure behaviour: types only. An invalid runtime value is caught at the RPC schema (component 3) and at the URL reader (component 4).
- Quality requirements: the list is closed. Adding a profile is a deliberate edit to one array.
- Verification seam: `typecheck` of the dependent projects. No runtime spec is needed for a type-only edit.
- Files: MODIFY `libs/shared/src/lib/types/ai-provider.types.ts`, MODIFY `libs/shared/src/lib/types/rpc/rpc-chat.types.ts`.

### 2. Interactive MCP URL writer (`agent-sdk`)

- Purpose: emit `/profile/apps` on the chat session URL when the session config asks for it.
- Responsibilities:
  - `buildMcpServers(mcpServerRunning = true, routingSessionId?: string, toolProfile?: McpToolProfile)`:
    ```ts
    const sessionUrl = `http://localhost:${PTAH_MCP_PORT}/session/${encodeURIComponent(routingSessionId)}`;
    url: toolProfile === 'apps' ? `${sessionUrl}/profile/apps` : sessionUrl,
    ```
  - Call site `:1149` passes `sessionConfig.mcpToolProfile`.
  - Extend the JSDoc at `:1748-1780` with one paragraph naming the grammar and the reader (`http-server.handler.ts` `extractCallerToolProfile`).
  - The literal is spelled inline, as `/session/` already is (`sdk-query-runner.service.ts:560-567` explains why agent-sdk cannot import the writers in higher layers).
- Verified contracts: `sdk-query-options-builder.ts:1149`, `:1781-1812`; `sessionConfig` destructured at `:970-973`.
- Dependencies: `@ptah-extension/shared` (type only), downward per `CONVENTIONS.md:103-116`.
- Integration points: the reader in component 4. Logged through `redactMcpUrl`, which leaves path segments intact.
- Failure behaviour: unchanged. A missing routing id still throws `SdkError` (`:1792-1800`). The profile cannot produce a new failure.
- Quality requirements: coding URLs are byte-identical to today's.
- Verification seam: `sdk-query-options-builder.spec.ts`, block `buildMcpServers — caller session segment` (`:1992-2050`). Extend the private `BuilderWithMcp` interface with the third parameter and add these cases:
  - `apps` → URL ends with `/session/tab-abc/profile/apps`.
  - `coding` and `undefined` → URL ends with `/session/tab-abc` (no profile segment).
  - `mcpServerRunning=false` with `apps` → `{}`.
  - Through `build()`: `sessionConfig.mcpToolProfile: 'apps'` gives `options.mcpServers.ptah.url` ending in `/profile/apps`.
- Files: MODIFY `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`, MODIFY `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.spec.ts`.
- Not changed: `sdk-query-runner.service.ts` (one-shot, coding). Its spec at `sdk-query-runner.service.spec.ts:354-378` already pins the bare `/workspace/{cwd}` URL and stays green.

### 3. Chat RPC threading (`rpc-handlers`)

- Purpose: accept the profile at the RPC boundary and carry it into every query the session builds: start, auto-resume and slash follow-up.
- Responsibilities:
  - `chat-rpc.schema.ts`: `mcpToolProfile: z.enum(MCP_TOOL_PROFILES).optional()` in `ChatStartParamsSchema` and `ChatContinueParamsSchema`. Import `MCP_TOOL_PROFILES` from `@ptah-extension/shared`, which the file already imports at `:28`. A value outside the list is rejected with the existing ZodError response (`chat-rpc.schema.ts:15-18`).
  - `chat-session.service.ts` `startSession`: add `...(params.mcpToolProfile ? { mcpToolProfile: params.mcpToolProfile } : {})` to the `startChatSession({...})` literal (`:555-574`).
  - `AutoResumePreflight` (`:111-119`): add `mcpToolProfile?: ChatContinueParams['mcpToolProfile'];`.
  - `autoResumeIfInactive` (`:1249-1261`): add the same conditional spread to the `resumeSession` config. The callers `chat:resume activate` (`:900`) and rewind do not pass it, so they resume on `coding`. That is correct for the main chat.
  - `chat-slash-command-router.service.ts:121-127`: add `...(params.mcpToolProfile ? { mcpToolProfile: params.mcpToolProfile } : {})` to the inline `sessionConfig`.
  - The ptah-cli branch (`:447-463`) and the gateway bridge are not touched. They have no Apps caller.
- Verified contracts: `chat-rpc.handlers.ts:217,225`; `chat-session.service.ts:555-574`, `:684-691`, `:1155-1261`; `sdk-agent-adapter.ts:879-889` (`resumeSession` config is `AISessionConfig & {...}`).
- Dependencies: `shared` (L0) and the `IAgentAdapter` contract. Direction unchanged.
- Integration points: frontend `chat:start` / `chat:continue` → this service → `IAgentAdapter.startChatSession` / `resumeSession` / `executeSlashCommand` → component 2.
- Failure behaviour: an invalid profile fails the RPC with `{ success: false, error }` before any session starts. No profile means coding, the current behaviour.
- Quality requirements: no behaviour change for calls without the field.
- Verification seam:
  - `chat-rpc.schema.spec.ts`: accepts `'apps'`, `'coding'` and absent; rejects `'admin'` and `42` for both schemas.
  - `chat-rpc.handlers.spec.ts` (already asserts `startChatSession` args): `chat:start` with `mcpToolProfile: 'apps'` forwards it; without the field, the forwarded config has no `mcpToolProfile` key.
  - `chat-continue-slash-before-resume.spec.ts` (already inspects `resumeSession` calls): an inactive session resumed through `chat:continue` with `mcpToolProfile: 'apps'` passes it to `resumeSession`. A slash follow-up passes it inside `executeSlashCommand`'s `sessionConfig`.
- Files: MODIFY `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts`, `.../handlers/chat-rpc.schema.spec.ts`, `.../handlers/chat-rpc.handlers.spec.ts`, `.../chat/session/chat-session.service.ts`, `.../chat/session/chat-slash-command-router.service.ts`, `.../chat/session/chat-continue-slash-before-resume.spec.ts`.

### 4. MCP transport: profile segment reader (`vscode-lm-tools/mcp-http`)

- Purpose: parse `/profile/{name}` off the URL as a transport-owned field.
- Responsibilities:
  - `mcp-protocol.types.ts`: add `_callerToolProfile?: string;` with a doc comment. The value is raw (decoded, not validated); it is resolved by `resolveMcpToolProfile`.
  - `http-server.handler.ts`:
    - Grammar comment (`:280-297`): add the optional terminal `/profile/{name}` after the identity and workspace parts.
    - `extractCallerWorkspaceRoot` regex: allow an optional profile tail before the end. Everything else is unchanged, and `/workspace/{root}/extra` is still rejected:
      ```ts
      /^(?:\/session\/[^/?]+|\/agent\/[^/?]+)?\/workspace\/([^/?]+)(?:\/profile\/[^/?]+)?\/?(?:\?.*)?$/
      ```
    - New `extractCallerToolProfile`, which matches the full grammar so a session id that happens to be `profile` cannot be misread:
      ```ts
      /^(?:\/session\/[^/?]+|\/agent\/[^/?]+)?(?:\/workspace\/[^/?]+)?\/profile\/([^/?]+)\/?(?:\?.*)?$/
      ```
      It returns the decoded segment or `undefined`.
    - Body stripping (`:372-377`): add `_callerToolProfile: _ignoredBodyProfile`.
    - Stamp: `mcpRequest._callerToolProfile = extractCallerToolProfile(req.url);`.
  - The session and agent extractors (`:245-275`) are unchanged. They are prefix-anchored, so `/session/{id}/profile/apps` still yields the session id.
- Verified contracts: `http-server.handler.ts:245-307`, `:368-381`; `mcp-protocol.types.ts:17-52`.
- Dependencies: none new.
- Integration points: `onMCPRequest` → `handleMCPRequest` (`http-mcp-server.service.ts:366-388`), which needs no change.
- Failure behaviour: a malformed or unknown segment leaves the field as the raw string or `undefined`. Resolution decides (component 5). A `decodeURIComponent` throw on a bad escape is caught by the existing `try` at `:360-402` and answered with the 400 parse error that session and agent segments already get.
- Quality requirements: localhost only. Attribution, not authentication (`:264-269`).
- Verification seam: `http-server.handler.spec.ts`, URL-grammar block (`:468-610`). New cases:
  - `/session/s1/profile/apps` stamps session `s1` and profile `apps`, with no workspace.
  - `/agent/a1/workspace/D%3A%5Cx/profile/apps` stamps agent, workspace (round-tripped) and profile.
  - `/workspace/w/profile/apps/` (trailing slash) and `...?x=1` are accepted.
  - `/profile/apps` alone stamps only the profile.
  - `/profile/apps/session/s1` stamps no session, because the profile must be terminal.
  - `/session/profile/apps` stamps session `profile` and no profile.
  - `/workspace/w/profile` with no name stamps no profile, and no workspace either (the existing "REJECTS trailing path segments" rule).
  - A body `_callerToolProfile: 'apps'` on `/session/s1` is dropped, so the field is `undefined`.
- Files: MODIFY `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/types/mcp-protocol.types.ts`, `.../mcp-http/http-server.handler.ts`, `.../mcp-http/http-server.handler.spec.ts`.

### 5. Profile resolution, listing and call gate (`vscode-lm-tools/mcp-core`)

- Purpose: one place decides the effective profile, which tools are Apps-only, and how a refused call reads.
- Responsibilities:
  - CREATE `mcp-core/mcp-tool-profile.ts`. It is pure, with no I/O, and sits beside `mcp-caller.ts`:
    ```ts
    import { MCP_TOOL_PROFILES, type McpToolProfile } from '@ptah-extension/shared';
    export const APPS_ONLY_TOOL_NAMES: ReadonlySet<string> = new Set([
      DASHBOARD_PROPOSE_SPEC_TOOL_NAME, SURFACE_UPDATE_TOOL_NAME, SURFACE_GET_STATE_TOOL_NAME,
    ]);
    /** URL-derived profile; anything not in MCP_TOOL_PROFILES (or absent) is 'coding'. */
    export function resolveMcpToolProfile(
      request: Pick<MCPRequest, '_callerToolProfile'>,
    ): McpToolProfile;
    /** The isError text a coding-profile call to an Apps-only tool gets. */
    export function appsOnlyToolMessage(name: string): string;
    ```
    The message names the tool, says it is available on the Ptah Apps page only, and says this session uses the coding tool profile, so the agent should present results as text. Exact wording is free, but it must contain the tool name and the phrase `available on the Apps page only`, because the spec pins both.
  - `mcp-request-context.ts`: add `readonly callerToolProfile?: McpToolProfile;` to `McpRequestContext`, and `export function getCallerToolProfile(): McpToolProfile { return storage.getStore()?.callerToolProfile ?? 'coding'; }`.
  - `protocol-dispatcher.ts`:
    - `handleToolsList` (`:355-369`): `const profile = resolveMcpToolProfile(request); const tools = buildToolSet(resolveMcpCaller(request), profile, deps); markEagerTools(tools, deps, profile);`
    - `buildToolSet(caller, profile, deps)` (`:382-390`): return `profile === 'apps' ? all : all.filter((t) => !APPS_ONLY_TOOL_NAMES.has(t.name))`. Rewrite the doc comment: the per-caller set is now keyed on the profile, coding drops the Apps tools, and the order of `buildToolDefinitions` is kept.
    - `buildToolDefinitions` (`:415-425`): keep the three builders. Replace the "always-on" comments with one comment: listed only under the `apps` profile (TASK_2026_595), and filtered in `buildToolSet`.
    - `markEagerTools(tools, deps, profile)` (`:624-641`): when `profile === 'apps'`, add every name in `APPS_ONLY_TOOL_NAMES` to `eager`. Update the doc comment.
    - `tools/call` branch (`:255-270`): add `callerToolProfile: resolveMcpToolProfile(request)` to the context literal.
    - `dispatchToolsCall` (`:818-846`): after name validation and before `handleIndividualTool`, add:
      ```ts
      if (APPS_ONLY_TOOL_NAMES.has(name) && getCallerToolProfile() !== 'apps') {
        return toolErrorResponse(request, appsOnlyToolMessage(name));
      }
      ```
    - The handler update at `:322-354` lists the Apps-only group under the profile rule.
  - `telemetryToolName` (`:508-515`) is untouched. The three names remain registered.
- Verified contracts: listed in the evidence table. `toolErrorResponse` is at `:2372`. The tool-name constants are imported at `protocol-dispatcher.ts:115-124`.
- Dependencies: `shared` (L0), plus local mcp-core files. `mcp-tool-profile.ts` imports the name constants from `dashboard-propose-spec.tool.ts:33` and `surface-tools.ts:39-40`. No cycle: neither imports the dispatcher.
- Integration points: component 4 (field), component 6 (getter).
- Failure behaviour: a coding-profile call to an Apps-only tool gets an `isError` tool result. The surface or dashboard service is never touched, so there is no state change and no push. Missing or unknown profile means coding.
- Quality requirements: `tools/list` stays byte-stable per profile, which is the prompt-cache property `protocol-dispatcher.ts:375-377` cares about. Coding drops about 70k chars (see Measurement).
- Verification seam:
  - CREATE `mcp-core/mcp-tool-profile.spec.ts`:
    - `resolveMcpToolProfile`: `'apps'` → apps; `'coding'`, `undefined`, `''`, `'APPS'`, `'admin'` and `42 as unknown as string` → coding.
    - `APPS_ONLY_TOOL_NAMES` equals exactly the three constants.
    - `appsOnlyToolMessage` contains the name and the phrase.
  - `mcp-request-context.spec.ts`: `getCallerToolProfile()` is `'coding'` outside a context and with `{}`; inside `{ callerToolProfile: 'apps' }` it is `'apps'`; it survives an `await`.
  - `protocol-dispatcher.spec.ts`, block `protocol-handlers › surface tools` (`:3353+`):
    - Change "lists both tools even when every namespace toggle is off" to send `_callerToolProfile: 'apps'`.
    - New: a default caller (no profile) lists none of the three, both with and without IDE capabilities.
    - New: under apps, the three are listed with `_meta['anthropic/alwaysLoad'] === true`; under coding the remaining tools' `_meta` is unchanged.
    - New: a coding-profile `tools/call` for each of the three returns `isError: true` with the Apps-only text, and the `surface.update` / `dashboard.proposeSpec` mocks are not called.
    - New: an apps-profile call reaches the namespace (existing `callSurface` helper plus `_callerToolProfile: 'apps'`).
    - New: `execute_code` running `return await ptah.help()` under coding does not contain `ptah.surface`, and under apps it does. This uses a real `buildHelpMethod` with `getCallerToolProfile` and confirms A2.
  - Update the existing callers that now need the apps profile:
    - `protocol-dispatcher.spec.ts`: the surface block calls (`:3423-3535`) and the dashboard call at `:3702`.
    - `protocol-dispatcher.surface.spec.ts`: HTTP paths `'/'` → `'/profile/apps'`, `'/workspace/ws-plain'` → `'/workspace/ws-plain/profile/apps'`, `'/session/attacker'` → `'/session/attacker/profile/apps'`, `'/session/victim'` → `'/session/victim/profile/apps'`. In-process `create()` gets `_callerToolProfile: 'apps'`. Add one HTTP case: a forged body `_callerToolProfile: 'apps'` on `/session/victim` is refused with the Apps-only text.
    - `dashboard-propose-spec.tool.spec.ts:757-800`: the `tools/list` cases list under apps. Add "absent under coding". Its tools/call helper (`:801`) gets `_callerToolProfile: 'apps'`.
    - `mcp-contract.sweep.spec.ts`: the coverage matrix (`:1696-1740`) pins 56 / 53 tools "identically across caller kinds". Re-pin as coding 53 / 50 across caller kinds, and apps 56 / 53 = coding + exactly the three Apps-only names. `listAllTools` and the per-tool drivers for the three (`:849-880`, `:1159-1180`) list and call with `_callerToolProfile: 'apps'`. The "every listed tool has a driver" check runs on the apps listing, so the three keep their drivers.
    - `surface-trust-boundary.spec.ts` and `tool-result-budget.spec.ts`: add `_callerToolProfile: 'apps'` where they dispatch through `handleMCPRequest`. Leave them alone where they call namespace or budget functions directly.
- Files: CREATE `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-tool-profile.ts` and `mcp-tool-profile.spec.ts`. MODIFY `mcp-core/mcp-request-context.ts`, `mcp-core/mcp-request-context.spec.ts`, `mcp-core/protocol-dispatcher.ts`, `mcp-core/protocol-dispatcher.spec.ts`, `mcp-core/protocol-dispatcher.surface.spec.ts`, `mcp-core/dashboard-propose-spec.tool.spec.ts`, `mcp-core/mcp-contract.sweep.spec.ts`, `mcp-core/tool-result-budget.spec.ts` (only if it dispatches), `libs/backend/vscode-lm-tools/src/lib/surface/surface-trust-boundary.spec.ts` (only if it dispatches). All of these are under `libs/backend/vscode-lm-tools/src/lib/code-execution/` unless a full path is given.

### 6. Profile-aware `execute_code` help (`vscode-lm-tools/namespace-builders`)

- Purpose: `ptah.help()` mentions the dashboard and surface tools only in the apps profile.
- Responsibilities:
  - `system-namespace.builders.ts`:
    - `HELP_DOCS` stays the full catalog. Existing direct readers stay green: `surface-namespace.builder.spec.ts:444-453` and `vendor-roster-drift.spec.ts:76`.
    - Add `const APPS_ONLY_HELP_TOPICS: ReadonlySet<string> = new Set(['dashboard', 'surface']);`.
    - Add a module-level `CODING_OVERVIEW`, derived once from `HELP_DOCS['overview']` by dropping the `DASHBOARD:` and `SURFACE:` lines (`:62-63`).
    - `buildHelpMethod(deps: { getCallerToolProfile: () => McpToolProfile })`. With `profile !== 'apps'`:
      - no topic → `CODING_OVERVIEW`;
      - topic in `APPS_ONLY_HELP_TOPICS` → `` `ptah.${topic} is available on the Apps page only.` ``;
      - the "not found, Available:" list excludes those topics.
    - With `'apps'`, behaviour is exactly today's.
  - `ptah-api-builder.service.ts:882`: `help: buildHelpMethod({ getCallerToolProfile })`, importing it from `./mcp-core/mcp-request-context` next to the getters at `:107-110`.
- Verified contracts: `system-namespace.builders.ts:49-65`, `:687-704`; `ptah-api-builder.service.ts:882`; `namespace-builders/index.ts:25` re-exports `buildHelpMethod`, and its signature change is internal to the lib (only lib-internal callers, per the earlier grep).
- Dependencies: the injected getter. The namespace builder does not import mcp-core, which keeps today's direction, following `workspace-root-resolver.ts:30-32`.
- Integration points: the `execute_code` sandbox, `ptah.help(...)`.
- Failure behaviour: there is no throw path. An unknown profile is not possible here, because the getter returns the resolved enum.
- Quality requirements: coding help output contains neither `ptah.dashboard` nor `ptah.surface`, nor any of the three tool names.
- Verification seam:
  - `system-namespace.builders.spec.ts`:
    - Existing `buildHelpMethod()` calls (`:324-374`) pass `{ getCallerToolProfile: () => 'coding' }`. The overview assertion `toBe(HELP_DOCS['overview'])` becomes an apps-getter case.
    - New: coding overview has no `DASHBOARD:`/`SURFACE:` lines and still contains `TASKS:`.
    - New: coding `help('surface')` and `help('dashboard')` give the Apps-only line.
    - New: coding unknown-topic list omits both.
    - New: apps `help('surface') === HELP_DOCS['surface']`.
  - `dashboard-propose-spec.tool.spec.ts:445,483` and `tasks-namespace.builder.spec.ts:1007`: pass an apps getter and a coding getter respectively. The dashboard spec reads dashboard help, so it needs `'apps'`.
- Files: MODIFY `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts`, `.../namespace-builders/system-namespace.builders.spec.ts`, `.../namespace-builders/tasks-namespace.builder.spec.ts`, `.../code-execution/ptah-api-builder.service.ts`. `dashboard-propose-spec.tool.spec.ts` is already listed in component 5. It goes to the same executor and needs one edit pass.

### 7. Apps page sends the apps profile (`mcp-apps-page`)

- Purpose: the Apps conversation is the only caller of `'apps'`.
- Responsibilities: in `apps-session.service.ts`:
  - add `mcpToolProfile: 'apps',` to the `chat:start` params, top level next to `surfaceMode: true` (`:244`);
  - add the same to the `chat:continue` params (`:325`).
  - The type comes from the updated `ChatStartParams` / `ChatContinueParams` via `ClaudeRpcService.call`.
- Verified contracts: `apps-session.service.ts:237-250`, `:321-326`.
- Dependencies: `@ptah-extension/shared` types through the RPC map. No new import is needed for a string literal of a union type.
- Integration points: component 3.
- Failure behaviour: unchanged. A rejected start rolls back (`:251-258`).
- Quality requirements: none beyond the existing behaviour.
- Verification seam: `apps-session.service.spec.ts`:
  - `:269-289` add `expect(start.params['mcpToolProfile']).toBe('apps')`;
  - `:748-760` add the same for the `chat:continue` params.
- Files: MODIFY `libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.ts`, `.../services/apps-session.service.spec.ts`.

### 8. Measurement (deliverable `measurement.md`)

- Purpose: put numbers on the `tools/list` cost for coding and apps, before and after.
- Method:
  1. **Baseline, before any edit**, on the unchanged tree. Create a throwaway spec `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-profile.measure.spec.ts` that:
     - calls `handleMCPRequest({ jsonrpc:'2.0', id:1, method:'tools/list' }, deps)` for two host configurations: Electron-like `{ hasIDECapabilities:false, hasSqliteLayer:true }` and VS Code-like `{ hasIDECapabilities:true, hasSqliteLayer:false }`, with the minimal deps shape used by `buildDeps` in `protocol-dispatcher.spec.ts:144`;
     - computes `chars = JSON.stringify(result.tools).length` and `approxTokens = Math.ceil(chars / 4)`, the same chars/4 ratio the budget table uses (`mcp-contract.sweep.spec.ts:1666-1672`);
     - `console.log`s one line per configuration.

     Run it with `npx nx test @ptah-extension/vscode-lm-tools --testPathPattern=tool-profile.measure`. Before the change every caller gets the same list, so the baseline is the "before" number for both coding and apps.
  2. **After**, with all components landed, run the same spec with an added `_callerToolProfile: 'coding'` / `'apps'` request field. Log coding and apps per host configuration, plus the delta and the per-tool `JSON.stringify(tool).length` of the three Apps-only tools.
  3. Optional exact count: pass each JSON string to the `ptah_count_tokens` MCP tool, if it is available in the implementer's session, and record that column next to the chars/4 estimate. Label which is which.
  4. Optional live cross-check against a running build: `curl -s -X POST http://localhost:<port>/session/<uuid> -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | wc -c` versus the same URL with `/profile/apps`.
  5. Write `.ptah/specs/TASK_2026_595_1c01/measurement.md` with: date, HEAD, a table (configuration × {before, after-coding, after-apps} × {chars, ~tokens}), the three per-tool sizes, and a note that the three tools are now eager in apps and absent in coding.
  6. **Delete** `tool-profile.measure.spec.ts`. It is not committed. The permanent regression guard is the coding-vs-apps listing spec in component 5.
- Expected order of magnitude: coding drops about 65,190 + 2,141 + ≤3,000 ≈ 70k chars (about 17.5k tokens), from `surface-tools.spec.ts:61-62` and `dashboard-propose-spec.tool.spec.ts:107`.
- Files: CREATE `.ptah/specs/TASK_2026_595_1c01/measurement.md`. The temporary spec is created and deleted.

## Integration architecture

- **Data flow, Apps session:**
  1. `AppsSessionService.start` → `chat:start { ..., surfaceMode: true, mcpToolProfile: 'apps', options.systemPrompt }`.
  2. `ChatStartParamsSchema` validates the enum.
  3. `ChatSessionService.startSession` → `startChatSession({ ..., mcpToolProfile })`.
  4. `SdkAgentAdapter` spreads the config into `sessionConfig`.
  5. `SessionQueryExecutor` → `SdkQueryOptionsBuilder.build`.
  6. `buildMcpServers(..., 'apps')` → `http://localhost:51820/session/{tab}/profile/apps`.
  7. The SDK posts `tools/list` / `tools/call` to that path.
  8. `http-server.handler` stamps `_callerSessionId` and `_callerToolProfile`.
  9. `handleMCPRequest`: `resolveMcpToolProfile` → `buildToolSet` (all), `markEagerTools` (three eager); on `tools/call`, the context carries the profile and the gate passes.
- **Follow-up turn:**
  - Live session: the URL is unchanged and nothing is rebuilt (`chat-session.service.ts:1172-1174`).
  - Inactive session: `chat:continue { mcpToolProfile: 'apps' }` → `resumeSession({ ..., mcpToolProfile })` → same URL.
  - Slash command: router `sessionConfig.mcpToolProfile` → same URL.
- **Data flow, every other caller:** main chat, CLI agent lanes, `.mcp.json` external clients and subagents, one-shots, CLI. No `/profile/` segment → `coding` → the three tools are absent from `tools/list`; a call returns the Apps-only error; help hides them.
- State or persistence: none. The profile lives only in the URL, which belongs to the SDK query for the life of that query, and in the per-call AsyncLocalStorage context. Nothing is stored.
- External boundaries:
  - RPC input is validated as a closed enum (`chat-rpc.schema.ts`).
  - The URL segment is decoded and mapped onto the closed enum, with unknown resolving to coding.
  - A body copy is discarded by the transport.
  - The profile is attribution, not authorization: a same-user process can still request `/profile/apps`, the same as `/session/{id}` today (`http-server.handler.ts:264-269`). The surface tools also scope state by session id.
- Failure and rollback:
  - Profile lost, for example on a resume path that does not send it: the session silently runs coding, and the agent gets the explicit Apps-only error on its first surface call, so it is visible, not a silent corruption.
  - Wrong RPC value: rejected before any session starts.
  - Rollback: revert the commit. There is no data migration.
- Observability:
  - Existing `[SdkQueryOptionsBuilder] MCP servers ENABLED { mcpUrl }` (`sdk-query-options-builder.ts:1807-1810`) shows the `/profile/apps` segment. `redactMcpUrl` keeps paths.
  - The `[MCP] tool result` debug telemetry (`protocol-dispatcher.ts:733-739`) records `isError: true` for gated calls. No new log line is required.

## Architecture-level quality requirements

- Functional:
  - (a) A request with no profile segment lists 53 tools on an IDE host and 50 without, and none of the three.
  - (b) `/profile/apps` lists today's 56 / 53, with the three tools carrying `anthropic/alwaysLoad`.
  - (c) A coding-profile `tools/call` for any of the three returns `isError` containing `available on the Apps page only` and causes no namespace call.
  - (d) An Apps page start, resume and slash follow-up all carry `/profile/apps`.
  - (e) Coding `ptah.help()` never names the dashboard or surface namespaces or tools.
- Performance: coding `tools/list` shrinks by the measured delta, about 70k chars. Listing cost goes up by one `Set.has` per tool.
- Security: no new trust decision is based on the profile. Body forging of `_callerToolProfile` is impossible (transport strips it). The RPC enum is validated.
- Maintainability:
  - The grammar comment in `http-server.handler.ts` and the writer JSDoc in `sdk-query-options-builder.ts` name each other.
  - The profile list lives in exactly one place (`MCP_TOOL_PROFILES`).
  - The Apps-only tool list lives in exactly one place (`APPS_ONLY_TOOL_NAMES`).
  - The layer rule holds (`CONVENTIONS.md:103-116`).
- Testability: every behaviour in "Functional" has a named spec case in components 2-7. The URL writer and reader are pinned on both sides.

## Team-leader handoff

- Recommended executors:
  - Components 1-6: backend-developer. They are server-side TypeScript in shared, agent-sdk, rpc-handlers and vscode-lm-tools.
  - Component 7: frontend-developer, or the same backend-developer, since it is two literal fields and two assertions.
  - Component 8: backend-developer, or senior-tester for the numbers.
- Complexity: MEDIUM. The production edits are small, but the spec churn in `mcp-contract.sweep.spec.ts`, `protocol-dispatcher*.spec.ts` and `dashboard-propose-spec.tool.spec.ts` is wide and must re-pin counts deliberately.
- Dependencies and ordering:
  - Run Component 8, step 1 (baseline) before any production edit.
  - Component 1 comes before 2, 3, 5 and 7, because they import `McpToolProfile` / `MCP_TOOL_PROFILES`.
  - Component 4 comes before or alongside 5. They are in the same lib, and 5 reads `_callerToolProfile`.
  - Component 6 depends on 5 for `getCallerToolProfile`.
  - Component 8, steps 2-6, run after 4-6.
- Parallel-safe work, after component 1 lands, as file-disjoint groups:
  1. Component 2: agent-sdk files only.
  2. Component 3: rpc-handlers files only.
  3. Components 4 + 5 + 6: vscode-lm-tools files. Keep them as one group, because `dashboard-propose-spec.tool.spec.ts` and `protocol-dispatcher.spec.ts` are touched by both 5 and 6.
  4. Component 7: mcp-apps-page files only.
- Files affected:
  - CREATE:
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-tool-profile.ts`
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-tool-profile.spec.ts`
    - `.ptah/specs/TASK_2026_595_1c01/measurement.md`
    - Temporary, deleted before commit: `.../mcp-core/tool-profile.measure.spec.ts`
  - MODIFY:
    - `libs/shared/src/lib/types/ai-provider.types.ts`
    - `libs/shared/src/lib/types/rpc/rpc-chat.types.ts`
    - `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts`
    - `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.spec.ts`
    - `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts`
    - `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.spec.ts`
    - `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.spec.ts`
    - `libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts`
    - `libs/backend/rpc-handlers/src/lib/chat/session/chat-slash-command-router.service.ts`
    - `libs/backend/rpc-handlers/src/lib/chat/session/chat-continue-slash-before-resume.spec.ts`
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/types/mcp-protocol.types.ts`
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-server.handler.ts`
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-server.handler.spec.ts`
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-request-context.ts`
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-request-context.spec.ts`
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.spec.ts`
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.surface.spec.ts`
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/dashboard-propose-spec.tool.spec.ts`
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-contract.sweep.spec.ts`
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-result-budget.spec.ts` (only if it dispatches the three)
    - `libs/backend/vscode-lm-tools/src/lib/surface/surface-trust-boundary.spec.ts` (only if it dispatches through `handleMCPRequest`)
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.ts`
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/system-namespace.builders.spec.ts`
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/tasks-namespace.builder.spec.ts`
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts`
    - `libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.ts`
    - `libs/frontend/mcp-apps-page/src/lib/services/apps-session.service.spec.ts`
  - REWRITE: none.
  - Confirmed NO change needed:
    - `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/ptah-mcp-url.ts` (lanes stay coding)
    - `libs/backend/cli-agent-runtime/src/lib/ptah-cli/helpers/ptah-cli-spawn-options.service.ts`
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/ptah-mcp-slots.ts`
    - `libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.ts`
    - `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts`
    - `.../session-lifecycle/session-query-executor.service.ts`
    - `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.ts`
    - the `mcp-stdio/*` files
    - `apps/ptah-cli`, `apps/ptah-electron`, `apps/ptah-extension-vscode`
    - `libs/backend/gateway-chat-bridge`
    - `libs/frontend/mcp-apps-page/src/lib/apps-system-prompt.ts`
    - `libs/frontend/harness-builder`
- Verification points:
  - Confirm A1 in a running build: the Apps chat lists the three tools and a normal chat does not. Confirm A2 with the `execute_code` help spec.
  - Confirm the surface create, patch and read path still works from the Apps page (context.md acceptance). This needs a manual run, or the existing `apps-submit-flow.spec.ts` / surface specs staying green.
  - Commands that must pass:
    - `npx nx run-many -t test,typecheck -p @ptah-extension/shared @ptah-extension/vscode-lm-tools @ptah-extension/agent-sdk @ptah-extension/rpc-handlers @ptah-extension/mcp-apps-page @ptah-extension/cli-agent-runtime`
    - `cli-agent-runtime` has no edits; it is run to prove the lanes are untouched, per the context.md acceptance.
    - `npx nx run-many -t lint -p @ptah-extension/vscode-lm-tools @ptah-extension/agent-sdk @ptah-extension/rpc-handlers @ptah-extension/mcp-apps-page @ptah-extension/shared`
  - `measurement.md` exists with before, after-coding and after-apps numbers per host configuration, and the temporary measurement spec is deleted.
