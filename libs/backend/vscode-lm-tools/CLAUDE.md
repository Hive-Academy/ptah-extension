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

**Internal**: `@ptah-extension/platform-core`, `@ptah-extension/vscode-core`, `@ptah-extension/shared`, `@ptah-extension/memory-contracts`, `@ptah-extension/workspace-intelligence`, `@ptah-extension/agent-sdk`
**External**: `chrome-launcher`, `chrome-remote-interface`, `exa-js`, `@tavily/core`, `json2md`, `minimatch`, `jpeg-js`, `gifenc`, `cross-spawn`, `tsyringe`

## Guidelines

- The platform-agnostic surface MUST NOT import `vscode`. VS Code-specific `VscodeIDECapabilities` is at the `/vscode` subpath only — bundlers (Electron) drop that subpath at build time.
- Capabilities are injected via `IDE_CAPABILITIES_TOKEN` / `BROWSER_CAPABILITIES_TOKEN` — host apps register their own implementations.
- Web search providers all implement `IWebSearchProvider`; selection happens via `WebSearchProviderType` setting.
- Permission prompts route through `IUserInteraction` (platform-core) via the prompt service.
- `catch (error: unknown)`.

## Cross-Lib Rules

Consumed by `rpc-handlers` and app layers. Forbidden imports: `platform-*` adapters.
