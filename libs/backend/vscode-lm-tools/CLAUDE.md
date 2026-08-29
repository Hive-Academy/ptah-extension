# @ptah-extension/vscode-lm-tools

[Back to Main](../../../CLAUDE.md)

## Purpose

Hosts the **Code Execution MCP server** and Ptah API surface (`PtahAPI`) exposed to AI agents — IDE capabilities, browser automation, web search providers, permission prompts, and the platform system prompt.

## Boundaries

**Belongs here**:

- `CodeExecutionMCP` server + `PtahAPIBuilder`
- IDE/browser capability ports (`IIDECapabilities`, `IBrowserCapabilities`)
- Permission prompt service
- Web search provider implementations (Tavily, Serper, Exa)
- Chrome-launcher browser capability + screen recorder
- Platform system prompt assembly

**Does NOT belong**:

- Direct `vscode` imports in the platform-agnostic surface (VS Code impl is gated behind the `/vscode` subpath)
- Persistence, memory, RPC handlers

## Public API

Code execution: `PtahAPIBuilder` (+ `IDE_CAPABILITIES_TOKEN`, `BROWSER_CAPABILITIES_TOKEN`), `CodeExecutionMCP`. Types: `PtahAPI`, `BrowserRecordStartResult`, `BrowserRecordStopResult`, `ToolResultCallback`.
Capabilities: `IIDECapabilities`, `IBrowserCapabilities`, `BrowserSessionOptions`, `ChromeLauncherBrowserCapabilities`.
System prompt: `PTAH_SYSTEM_PROMPT`, `PTAH_SYSTEM_PROMPT_TOKENS`, `buildPlatformSystemPrompt`.
Web search: `TavilySearchProvider`, `SerperSearchProvider`, `ExaSearchProvider`, `WebSearchProviderType`, `IWebSearchProvider`.
Other: `PermissionPromptService`, `ScreenRecorderService`, `registerVsCodeLmToolsServices`.
Note: `VscodeIDECapabilities` lives at the `'@ptah-extension/vscode-lm-tools/vscode'` subpath (excluded from Electron bundling).

## Internal Structure

- `src/lib/code-execution/` — MCP server + `PtahAPIBuilder` + namespace builders (IDE, browser)
- `src/lib/code-execution/services/providers/` — web search provider impls
- `src/lib/code-execution/services/chrome-launcher-browser-capabilities.ts` — Chrome via `chrome-launcher` + CDP
- `src/lib/code-execution/services/screen-recorder.service.ts` — TASK_2025_254
- `src/lib/code-execution/ptah-system-prompt.constant.ts` — system prompt + platform-aware builder
- `src/lib/permission/permission-prompt.service.ts`
- `src/lib/di/` — `registerVsCodeLmToolsServices`

## Dependencies

**Internal**: `@ptah-extension/platform-core`, `@ptah-extension/vscode-core`, `@ptah-extension/shared`, `@ptah-extension/memory-contracts`, `@ptah-extension/workspace-intelligence`, `@ptah-extension/agent-sdk`, `@ptah-extension/cli-agent-runtime` (public barrel only — MCP registry sources + `McpInstallService` backing `ptah.harness.*`)
**External**: `chrome-launcher`, `chrome-remote-interface`, `exa-js`, `@tavily/core`, `json2md`, `minimatch`, `jpeg-js`, `gifenc`, `cross-spawn`, `tsyringe`

## Guidelines

- The platform-agnostic surface MUST NOT import `vscode`. VS Code-specific `VscodeIDECapabilities` is at the `/vscode` subpath only — bundlers (Electron) drop that subpath at build time.
- Capabilities are injected via `IDE_CAPABILITIES_TOKEN` / `BROWSER_CAPABILITIES_TOKEN` — host apps register their own implementations. Use a DI token ONLY when the implementation genuinely differs per host (VS Code LSP, Electron CDP). Host-agnostic collaborators (MCP registries, `McpInstallService`) are wired directly in `PtahAPIBuilder` — there is exactly one construction site and all three hosts share it via `registerVsCodeLmToolsServices`.
- `ptah.harness.*` collaborators are declared as narrow structural interfaces in `harness-namespace.builder.ts` (`HarnessMcpRegistrySource`, `HarnessSkillsDirectory`, `HarnessMcpInstaller`) so the builder stays unit-testable; each is optional and degrades to a clear error.
- **`createSkill` takes a real `scope`, and the two scopes share one plugin id.** `user` (default) writes `~/.ptah/plugins`; `workspace` writes `{ws}/.ptah/plugins` via the shared `workspacePluginsDir` — never a hand-rolled join, since the plugin loader scans the same path. A name already taken in the other scope is REFUSED: the loader resolves a clash workspace-wins, so the second write would silently stop the first from loading.
- **A harness search reports THREE states, never two.** `searchSkills` and `searchMcpRegistry` return `{ …, status: 'ok' | 'degraded', sources: HarnessSourceReport[] }`, and the dispatcher turns `degraded` into an MCP tool error. Never map a caught upstream failure to an empty result set: `{ skills: [], count: 0 }` is indistinguishable from "the marketplace has nothing", and an agent that read one as the other told the user no Three.js skills existed and authored replacements for four that already did. `unavailable` (no client wired on this host) is deliberately distinct from `failed` (the source threw) and does not degrade the call. All six harness methods are exposed BOTH on `ptah.harness.*` and as `ptah_harness_*` MCP tools — a method reachable from only one of the two surfaces is a bug, and `proposeConfig` was exactly that.
- **`CodeExecutionMCP` owns one `.mcp.json` entry per OPEN workspace folder, not one for the active root.** It used to track a single `registeredMcpJsonPath` resolved through `getWorkspaceRoot()`, and on Electron `setActiveFolder()` fires `onDidChangeWorkspaceFolders` — which `workspace:switch` calls on every tab switch. So switching between two folders that were BOTH already open unregistered from one and registered in the other: a write into a file inside the user's version-controlled repository, six times in one session, for a change nothing could observe (TASK_2026_354). Ownership is now the folder SET (`registrations: Map<path, port>`, reconciled against `getWorkspaceFolders()`), so a switch is a no-op, an added folder gets an entry, and only a folder that LEFT the workspace loses one. `registerInMcpJson` is additionally read-COMPARE-write: an entry already equal to the desired one is left byte-for-byte alone and logs nothing. Per-path records also make a failed removal safe to leave outstanding — it can no longer be overwritten by a write elsewhere — so the TASK_2026_332 rule that coupled the two mutations is gone, and refusing to register the folder the user is working in because an unrelated CLOSED folder's file was contended would have been a false `mcpServerRunning: false`.
- **Every `.mcp.json` ownership mutation goes through `CodeExecutionMCP`'s operation queue, and `withMcpConfigLock` is not a substitute for it.** The lock is `harness-sync`'s and is keyed per FILE; the races here span DIFFERENT files. A user switching workspace A → B → C produces two reconciles that both read the registration record as {A} and then write B and C independently, stranding a live `ptah` entry in B for a folder that is no longer open; a `stop()` right after a switch unregisters A while an outstanding event writes B back with a port that is about to die. So `mcpOpQueue` serializes the OPERATION (a job reads `registrations` only after the previous job finished updating it) and `repointGeneration` makes the newest request win (a superseded re-point is dropped before it touches disk). `stop()` bumps the generation and sets `stopped`, which is what cancels an in-flight or late-arriving re-point. Both halves are needed and both are pinned by `http-mcp-server.service.spec.ts` section 6 — with a DELIBERATELY DEFERRED lock, because the straight-through lock stub completes each mutation inside one microtask and neither race is reachable without it. The real-lock, real-`fs` half lives in `http-mcp-server.service.concurrency.spec.ts` (TASK_2026_332).
- **`startHttpServer` attempts every candidate port against ONE `http.Server`, so `tryListen` must remove its `'listening'` listener on failure too.** A one-time listener is only consumed when it FIRES; a candidate refused with `EADDRINUSE` leaves its listener attached and the next candidate's single `'listening'` event reaches both, logging the started line and writing `ptah.mcp.port` once per ATTEMPTED port (TASK_2026_354). The fallback also emits exactly one warning, after the outcome is known, naming the likely holder (another Ptah instance for `EADDRINUSE`, an OS-reserved range for `EACCES`) and the port actually chosen.
- **`ensureRegisteredForSubagents()` returns an outcome, and every caller must AND it into the `mcpServerRunning` it passes to the session.** It resolves with `{ registered, reason }` (`McpSubagentRegistration`), never rejects, and `registered: false` is a normal answer — the config file was contended (`lock-timeout`) or the write failed (`write-failed`). It used to resolve with `undefined` whatever happened, because both mutation helpers swallowed every failure into a warn, so a caller that awaited it and then reported `mcpServerRunning: true` was making a **false assurance**: the subagent spawns believing it has Ptah tools and finds no `ptah` key in `.mcp.json`. That is worse than the lost update the lock prevents, not better. Rejecting was considered and rejected as the shape — three of the six callers have no local catch and would abort a whole chat session over a two-second contention, whereas `mcpServerRunning: false` is a degraded mode the SDK path already supports. `lock-timeout` is deliberately distinct from `write-failed` (via `isFileLockTimeoutError`, its one production consumer): the first is transient by construction and retryable, the second is likely to repeat. A failed REMOVAL is also never followed by a write into a different file — that would leave a live entry in two repositories and destroy the record of the stale one (TASK_2026_332).
- Web search providers all implement `IWebSearchProvider`; selection happens via `WebSearchProviderType` setting.
- Permission prompts route through `IUserInteraction` (platform-core) via the prompt service.
- `catch (error: unknown)`.

## Cross-Lib Rules

Consumed by `rpc-handlers` and app layers. Forbidden imports: `platform-*` adapters.
