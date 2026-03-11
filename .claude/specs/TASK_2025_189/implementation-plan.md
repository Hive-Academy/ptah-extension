# Implementation Plan - TASK_2025_189: `ptah_web_search` MCP Tool

## Codebase Investigation Summary

### Libraries Discovered

- **vscode-lm-tools** (`libs/backend/vscode-lm-tools/`): MCP server implementation with tool registration pattern, protocol handlers, response formatters, and namespace builders.

  - Key exports: `CodeExecutionMCP`, `PtahAPIBuilder`, `PermissionPromptService`
  - Documentation: `libs/backend/vscode-lm-tools/CLAUDE.md`

- **llm-abstraction** (`libs/backend/llm-abstraction/`): Multi-provider LLM abstraction with VS Code LM provider, CLI adapters (Gemini, Codex, Copilot), and CLI detection service.
  - Key exports: `LlmService`, `CliDetectionService`, `AgentProcessManager`, `VsCodeLmProvider`
  - Documentation: `libs/backend/llm-abstraction/CLAUDE.md`

### Patterns Identified

**MCP Tool Registration Pattern** (5 steps, verified from 14 existing tools):

1. Define tool builder function in `tool-description.builder.ts` (returns `MCPToolDefinition`)
2. Import builder in `protocol-handlers.ts` (line 21-36)
3. Add builder call to `handleToolsList()` return array (lines 156-176)
4. Add case to `handleIndividualTool()` switch statement (lines 239-477)
5. Add response formatter in `mcp-response-formatter.ts`

**Evidence**: All 14 tools (`ptah_workspace_analyze`, `ptah_search_files`, `ptah_get_diagnostics`, `ptah_lsp_references`, `ptah_lsp_definitions`, `ptah_get_dirty_files`, `ptah_count_tokens`, `ptah_agent_spawn`, `ptah_agent_status`, `ptah_agent_read`, `ptah_agent_steer`, `ptah_agent_stop`, `ptah_agent_list`, `execute_code`) follow this pattern.

**CLI Adapter Spawn Pattern** (verified from `gemini-cli.adapter.ts`):

- Gemini CLI spawned via `spawnCli()` from `cli-adapter.utils.ts` (line 355)
- Uses `cross-spawn` for Windows `.cmd` handling (line 9, utils)
- JSONL stream parsing via `handleJsonLine()` (line 495)
- `google_web_search` is a native Gemini tool (confirmed at line 652)
- `runSdk()` returns `SdkHandle` with `{ abort, done, onOutput, onSegment }` (lines 482-489)

**VS Code LM API Pattern** (verified from `vscode-lm.provider.ts`):

- `vscode.lm.selectChatModels()` for model discovery (line 68)
- `model.sendRequest(messages, {}, token)` for completions (lines 125-129)
- Streaming response collection via `for await` (lines 133-135)
- No system message support; combined via `_combinePrompts()` (line 291)

**LLM Namespace Pattern** (verified from `llm-namespace.builder.ts`):

- `LlmService.setProvider()` + `LlmService.getCompletion()` for provider-routed completions (lines 60-85)
- `deps.secretsService.hasApiKey(providerName)` for availability check (line 93)
- `deps.configService.getDefaultModel(providerName)` for model selection (line 57)

### Integration Points

- **CliDetectionService.getAdapter('gemini')**: Returns `GeminiCliAdapter | undefined` (line 130)
- **CliDetectionService.getDetection('gemini')**: Returns `CliDetectionResult` with `installed`, `path` (line 114)
- **GeminiCliAdapter.runSdk(options)**: Spawns Gemini CLI process with JSONL streaming (line 240)
- **LlmService.setProvider() + getCompletion()**: VS Code LM API completions (llm-namespace.builder.ts:60-85)
- **PtahAPIBuilder constructor**: Already injects `LlmService`, `LlmConfigurationService`, `CliDetectionService` (ptah-api-builder.service.ts:184-198)
- **ProtocolHandlerDependencies.ptahAPI**: The PtahAPI object passed to all tool handlers (protocol-handlers.ts:69)

---

## Architecture Design

### Design Philosophy

**Chosen Approach**: Standalone service with provider fallback chain, exposed as a first-class MCP tool.

**Rationale**: The web search capability is complex enough to warrant its own service (provider selection, fallback logic, timeout management, output parsing) rather than being inlined in protocol-handlers. This follows the same separation pattern as `PtahAPIBuilder` (standalone service) rather than the simpler pattern of tools like `ptah_get_dirty_files` (inline call).

**Provider Fallback Chain**:

1. **Primary: VS Code LM API** -- Fastest (in-process, no spawn overhead), uses existing Copilot model via `vscode.lm.selectChatModels()`. Sends a search-grounded prompt asking the model to search the web and return results.
2. **Fallback: Gemini CLI** -- Has native `google_web_search` tool. Spawned via existing `GeminiCliAdapter.runSdk()`. Slower (5-15s spawn) but has real web search grounding.

**Evidence**: VS Code LM API is already used in-process (vscode-lm.provider.ts), while Gemini CLI spawn pattern is well-established (gemini-cli.adapter.ts:240-489). Both providers are already available through injected services in PtahAPIBuilder.

---

## Component Specifications

### Component 1: WebSearchService

**Purpose**: Encapsulates web search logic with provider fallback chain. Tries VS Code LM API first, falls back to Gemini CLI if unavailable.

**Pattern**: Standalone service class (not injectable -- created by PtahAPIBuilder at build time with its dependencies). Same pattern as namespace builder functions that create closure-based APIs.

**Evidence**: Similar to how `buildLLMNamespace(deps)` creates a namespace object with closures over `LlmService` (llm-namespace.builder.ts:117-204).

**Responsibilities**:

- Accept a search query and optional timeout
- Try VS Code LM API first (in-process, fast)
- Fall back to Gemini CLI if VS Code LM is unavailable or fails
- Parse and return a plain-text narrative summary
- Handle errors and provider unavailability gracefully

**Implementation Pattern**:

```typescript
// Pattern source: llm-namespace.builder.ts:117 (closure-based service)
// and gemini-cli.adapter.ts:240 (CLI spawn with output collection)

export interface WebSearchDependencies {
  llmService: LlmService;
  configService: LlmConfigurationService;
  cliDetectionService: CliDetectionService;
  logger: Logger;
}

export interface WebSearchResult {
  query: string;
  summary: string;
  provider: 'vscode-lm' | 'gemini-cli';
  durationMs: number;
}

export class WebSearchService {
  constructor(private readonly deps: WebSearchDependencies) {}

  async search(query: string, timeoutMs?: number): Promise<WebSearchResult> {
    const timeout = Math.min(timeoutMs ?? 30000, 60000);
    const start = Date.now();

    // Try VS Code LM API first (in-process, fast)
    try {
      const result = await this.searchViaVsCodeLm(query, timeout);
      if (result) {
        return {
          query,
          summary: result,
          provider: 'vscode-lm',
          durationMs: Date.now() - start,
        };
      }
    } catch (error) {
      this.deps.logger.warn('[WebSearch] VS Code LM failed, trying Gemini CLI', ...);
    }

    // Fallback: Gemini CLI (has native google_web_search)
    try {
      const result = await this.searchViaGeminiCli(query, timeout - (Date.now() - start));
      return {
        query,
        summary: result,
        provider: 'gemini-cli',
        durationMs: Date.now() - start,
      };
    } catch (error) {
      throw new Error(`Web search failed: no provider available. ...`);
    }
  }
}
```

**Quality Requirements**:

- Must not throw if VS Code LM is unavailable -- silently fall back to Gemini CLI
- Must throw a clear error if BOTH providers are unavailable
- Must respect the timeout parameter for both providers
- Must not leak child processes on timeout (Gemini CLI abort pattern)

**Files Affected**:

- `libs/backend/vscode-lm-tools/src/lib/code-execution/services/web-search.service.ts` (CREATE)

---

### Component 2: VS Code LM Search Strategy

**Purpose**: Implements web search via the VS Code LM API by sending a search-optimized prompt to the Copilot model.

**Pattern**: Private method within `WebSearchService`. Uses `LlmService.setProvider('vscode-lm')` + `LlmService.getCompletion()` (verified at llm-namespace.builder.ts:60-85).

**Evidence**: The `buildProviderNamespace()` function (llm-namespace.builder.ts:41-112) shows the exact API for calling VS Code LM via LlmService:

- `deps.llmService.setProvider(providerName, model)` (line 60)
- `deps.llmService.getCompletion(systemPrompt, message)` (line 72)
- Both return `Result<T, Error>` with `.isErr()` / `.value` accessors

**Implementation Pattern**:

```typescript
// Pattern source: llm-namespace.builder.ts:52-86
private async searchViaVsCodeLm(query: string, timeoutMs: number): Promise<string | null> {
  const setResult = await this.deps.llmService.setProvider('vscode-lm');
  if (setResult.isErr()) return null; // VS Code LM not available

  const systemPrompt =
    'You are a web search assistant. Search the web for the given query ' +
    'and provide a comprehensive summary of the most relevant and recent results. ' +
    'Include key facts, sources, and URLs when available.';

  const completionResult = await Promise.race([
    this.deps.llmService.getCompletion(systemPrompt, `Search the web for: ${query}`),
    this.createTimeout(timeoutMs),
  ]);

  if (!completionResult || completionResult.isErr()) return null;
  return completionResult.value || null;
}
```

**Quality Requirements**:

- Must return `null` (not throw) when VS Code LM is unavailable, enabling fallback
- Must respect timeout via `Promise.race`
- The search prompt must instruct the model to ground its response in web search results

**Files Affected**:

- `libs/backend/vscode-lm-tools/src/lib/code-execution/services/web-search.service.ts` (same file as Component 1)

---

### Component 3: Gemini CLI Search Strategy

**Purpose**: Implements web search by spawning the Gemini CLI, which has native `google_web_search` tool access.

**Pattern**: Uses `CliDetectionService.getAdapter('gemini')` to get the `GeminiCliAdapter`, then calls `runSdk()` with a search-focused prompt. Collects output via the `SdkHandle.onOutput` callback pattern (verified at gemini-cli.adapter.ts:306-324).

**Evidence**:

- `CliDetectionService.getAdapter('gemini')` returns `CliAdapter | undefined` (cli-detection.service.ts:130)
- `GeminiCliAdapter.runSdk(options)` returns `SdkHandle` (gemini-cli.adapter.ts:240)
- `SdkHandle.onOutput(callback)` emits parsed text (gemini-cli.adapter.ts:306)
- `SdkHandle.abort` for cancellation (gemini-cli.adapter.ts:276)
- `SdkHandle.done` resolves with exit code (gemini-cli.adapter.ts:441)
- Gemini CLI handles `google_web_search` natively (gemini-cli.adapter.ts:652)

**Implementation Pattern**:

```typescript
// Pattern source: gemini-cli.adapter.ts:240-489 (runSdk pattern)
private async searchViaGeminiCli(query: string, timeoutMs: number): Promise<string> {
  const detection = await this.deps.cliDetectionService.getDetection('gemini');
  if (!detection?.installed) {
    throw new Error('Gemini CLI not installed');
  }

  const adapter = this.deps.cliDetectionService.getAdapter('gemini');
  if (!adapter?.runSdk) {
    throw new Error('Gemini CLI adapter does not support SDK mode');
  }

  const handle = await adapter.runSdk({
    task: `Search the web for: "${query}". Use the google_web_search tool to find relevant results. ` +
          `Provide a comprehensive summary of the findings including key facts, sources, and URLs. ` +
          `Do NOT use any other tools. Only search and summarize.`,
    workingDirectory: process.cwd(),
    binaryPath: detection.path,
  });

  // Collect output with timeout
  let output = '';
  handle.onOutput((data) => { output += data; });

  const exitCode = await Promise.race([
    handle.done,
    new Promise<number>((_, reject) =>
      setTimeout(() => {
        handle.abort.abort();
        reject(new Error('Gemini CLI search timed out'));
      }, timeoutMs)
    ),
  ]);

  if (exitCode !== 0 && !output.trim()) {
    throw new Error(`Gemini CLI exited with code ${exitCode}`);
  }

  return output.trim() || 'No results found.';
}
```

**Quality Requirements**:

- Must abort the Gemini CLI process on timeout (prevents leaked processes)
- Must check `detection.installed` before attempting spawn
- Must use `detection.path` as `binaryPath` for reliable Windows spawning
- The task prompt must explicitly instruct Gemini to use `google_web_search` and only search (no file edits)

**Files Affected**:

- `libs/backend/vscode-lm-tools/src/lib/code-execution/services/web-search.service.ts` (same file)

---

### Component 4: MCP Tool Registration

**Purpose**: Register `ptah_web_search` as a first-class MCP tool following the established 5-step pattern.

**Pattern**: Identical to all 14 existing tools. Verified from `tool-description.builder.ts`, `protocol-handlers.ts`, and `mcp-response-formatter.ts`.

#### 4a: Tool Description Builder

**File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/tool-description.builder.ts`

**Action**: ADD new function `buildWebSearchTool()` after `buildAgentStopTool()` (after line 455).

**Pattern source**: `buildSearchFilesTool()` (line 100-122) -- simple tool with required string param + optional params.

```typescript
// Pattern source: tool-description.builder.ts:100-122 (buildSearchFilesTool)
export function buildWebSearchTool(): MCPToolDefinition {
  return {
    name: 'ptah_web_search',
    description: 'Search the web for information using available LLM providers. ' + 'Returns a narrative summary of search results. ' + 'Uses VS Code LM API (Copilot) as primary provider, falls back to Gemini CLI. ' + 'Use this when you need current information from the internet.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query. Be specific for better results.',
        },
        timeout: {
          type: 'number',
          description: 'Search timeout in milliseconds (default: 30000, max: 60000)',
        },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  };
}
```

#### 4b: Protocol Handler Registration

**File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/protocol-handlers.ts`

**Actions**:

1. ADD import of `buildWebSearchTool` to the import block (after line 35):

   ```typescript
   buildAgentListTool,
   buildAgentStopTool,
   buildWebSearchTool,  // ADD
   ```

2. ADD import of `formatWebSearch` to the formatter import block (after line 52):

   ```typescript
   formatAgentList,
   formatWebSearch,  // ADD
   ```

3. ADD `buildWebSearchTool()` to `handleToolsList()` return array (after line 171, before power-user tools):

   ```typescript
   buildAgentListTool(),
   // Web search tool (TASK_2025_189)
   buildWebSearchTool(),
   // Power-user tools
   ```

4. ADD case to `handleIndividualTool()` switch statement (after `ptah_agent_list` case, before `default`, around line 473):
   ```typescript
   case 'ptah_web_search': {
     const { query, timeout } = args as { query: string; timeout?: number };
     if (!deps.ptahAPI.webSearch) {
       return {
         jsonrpc: '2.0',
         id: request.id,
         result: {
           content: [{ type: 'text' as const, text: 'Web search service not available.' }],
           isError: true,
         },
       };
     }
     const result = await deps.ptahAPI.webSearch.search(query, timeout);
     return createToolSuccessResponse(request, formatWebSearch(result), deps);
   }
   ```

#### 4c: Response Formatter

**File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/mcp-response-formatter.ts`

**Action**: ADD `formatWebSearch()` function after the Agent Orchestration Tools section (after line 634):

```typescript
// Pattern source: formatTokenCount (lines 414-426) -- simple formatting
export function formatWebSearch(result: { query: string; summary: string; provider: string; durationMs: number }): string {
  try {
    return json2md([
      { h2: 'Web Search Results' },
      {
        p: [`**Query:** ${result.query}`, `**Provider:** ${result.provider}`, `**Duration:** ${(result.durationMs / 1000).toFixed(1)}s`].join('  \n'),
      },
      { h3: 'Summary' },
      { p: result.summary },
    ]);
  } catch {
    return fallbackJson(result);
  }
}
```

**Files Affected**:

- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/tool-description.builder.ts` (MODIFY -- add `buildWebSearchTool`)
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/protocol-handlers.ts` (MODIFY -- add imports, tool list entry, switch case)
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/mcp-response-formatter.ts` (MODIFY -- add `formatWebSearch`)

---

### Component 5: PtahAPI Integration

**Purpose**: Wire the `WebSearchService` into the `PtahAPI` object so protocol handlers can access it.

**Pattern**: Same as all other namespace integrations in `PtahAPIBuilder.build()` (ptah-api-builder.service.ts:206-427).

#### 5a: Type Definition

**File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts`

**Action**: ADD `webSearch` property to `PtahAPI` interface (after `agent` namespace, around line 62):

```typescript
// Web search namespace (TASK_2025_189)
webSearch?: {
  search(query: string, timeoutMs?: number): Promise<{
    query: string;
    summary: string;
    provider: 'vscode-lm' | 'gemini-cli';
    durationMs: number;
  }>;
};
```

Note: `webSearch` is optional (`?`) because `WebSearchService` depends on `LlmService` and `CliDetectionService` which are always injected, but the tool itself may not initialize properly. The protocol handler checks `deps.ptahAPI.webSearch` before calling.

#### 5b: PtahAPIBuilder Wiring

**File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts`

**Action 1**: ADD import for WebSearchService (after line 81):

```typescript
import { WebSearchService } from './services/web-search.service';
```

**Action 2**: ADD `webSearch` to the return object in `build()` method (after `help: buildHelpMethod()`, around line 425):

```typescript
// Web search service (TASK_2025_189)
webSearch: new WebSearchService({
  llmService: this.llmService,
  configService: this.llmConfigService,
  cliDetectionService: this.cliDetectionService,
  logger: this.logger,
}),
```

All required dependencies (`llmService`, `llmConfigService`, `cliDetectionService`, `logger`) are already injected into `PtahAPIBuilder` constructor (verified at lines 184-198).

**Files Affected**:

- `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts` (MODIFY -- add `webSearch` to PtahAPI)
- `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts` (MODIFY -- import + wire WebSearchService)

---

## Integration Architecture

### Data Flow

```
MCP Client (Claude CLI / any model)
  |
  v
HTTP Server (localhost:51820)
  |
  v
protocol-handlers.ts :: handleIndividualTool()
  |  case 'ptah_web_search'
  v
deps.ptahAPI.webSearch.search(query, timeout)
  |
  v
WebSearchService
  |
  ├─ [Primary] VS Code LM API
  |    LlmService.setProvider('vscode-lm')
  |    LlmService.getCompletion(systemPrompt, searchQuery)
  |    └─ Returns narrative text summary
  |
  └─ [Fallback] Gemini CLI
       CliDetectionService.getAdapter('gemini')
       adapter.runSdk({ task: searchPrompt, ... })
       └─ Gemini uses native google_web_search tool
       └─ Collects JSONL output -> text summary
  |
  v
mcp-response-formatter.ts :: formatWebSearch(result)
  |
  v
MCP JSON-RPC response -> Client
```

### Dependency Chain

```
WebSearchService
  ├── LlmService (already injected in PtahAPIBuilder:184)
  ├── LlmConfigurationService (already injected:188)
  ├── CliDetectionService (already injected:198)
  └── Logger (already injected:139)
```

No new DI registrations needed. All dependencies are already available in `PtahAPIBuilder`.

---

## Quality Requirements

### Functional Requirements

- The `ptah_web_search` tool must be discoverable via `tools/list` MCP protocol method
- The tool must accept a `query` string (required) and optional `timeout` number
- The tool must return a plain-text narrative summary of web search results
- The tool must try VS Code LM API first, then fall back to Gemini CLI
- The tool must return a clear error if no provider is available
- The result must include metadata: query, provider used, duration

### Non-Functional Requirements

- **Performance**: VS Code LM path should complete in 2-10 seconds. Gemini CLI fallback in 5-30 seconds.
- **Timeout**: Default 30s, max 60s, configurable per call
- **Reliability**: Never leave leaked child processes (Gemini CLI abort on timeout)
- **Security**: No new API keys required. Uses only existing integrations.
- **Logging**: Log provider selection, fallback events, and errors

### Pattern Compliance

- Must follow the 5-step MCP tool registration pattern (verified from 14 existing tools)
- Must use `createToolSuccessResponse()` for response creation (protocol-handlers.ts:504)
- Must use `json2md` for response formatting (mcp-response-formatter.ts:12)
- Must use `MCPToolDefinition` interface for tool description (types.ts:635)
- Must include `annotations` in tool definition (readOnlyHint + openWorldHint)

---

## Risk Assessment

### Low Risk

- **Tool registration**: Mechanical 5-step pattern, identical to 14 existing tools. No ambiguity.
- **Response formatting**: Simple `json2md` blocks, same as `formatTokenCount`.
- **PtahAPI wiring**: All dependencies already injected, just adding one property.

### Medium Risk

- **VS Code LM search quality**: The Copilot model may not have web search grounding. If the model just responds from its training data (no real-time search), results may be stale. **Mitigation**: The search prompt explicitly asks for web search. If results look like general knowledge rather than search results, the Gemini CLI fallback provides real grounding.
- **Gemini CLI spawn overhead**: 5-15 seconds per search is slow. **Mitigation**: VS Code LM is the primary path (2-10s in-process). Gemini CLI is only fallback.

### High Risk

- **None identified**. All patterns are well-established and verified. No new dependencies, no backward compatibility concerns, no cross-library pollution.

### Assumptions (Require Validation)

- **ASSUMPTION**: VS Code LM API (Copilot model) will attempt to ground responses in web search when prompted to "search the web". This depends on the model's capabilities and whether Copilot exposes web search grounding through the VS Code LM API.
  - **Mitigation**: If VS Code LM returns non-grounded responses, it still provides useful LLM knowledge. The Gemini CLI fallback provides real web search grounding.
  - **VALIDATION**: Test with Copilot model to see if responses include real URLs and current information.

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**:

- All work is in backend libraries (vscode-lm-tools, llm-abstraction interfaces)
- Involves TypeScript service creation, not UI components
- Requires understanding of MCP protocol, CLI adapter patterns, and LLM service integration
- No Angular/frontend work

### Complexity Assessment

**Complexity**: MEDIUM
**Estimated Effort**: 3-5 hours

**Breakdown**:

- WebSearchService creation: ~2 hours (VS Code LM strategy + Gemini CLI strategy + fallback logic)
- MCP tool registration (4 files): ~1 hour (mechanical pattern following)
- PtahAPI wiring (2 files): ~30 minutes
- Testing and verification: ~1 hour

### Files Affected Summary

**CREATE**:

- `libs/backend/vscode-lm-tools/src/lib/code-execution/services/web-search.service.ts`

**MODIFY**:

- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/tool-description.builder.ts` (add `buildWebSearchTool`)
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/protocol-handlers.ts` (add imports, tool list, switch case)
- `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/mcp-response-formatter.ts` (add `formatWebSearch`)
- `libs/backend/vscode-lm-tools/src/lib/code-execution/types.ts` (add `webSearch` to PtahAPI)
- `libs/backend/vscode-lm-tools/src/lib/code-execution/ptah-api-builder.service.ts` (import + wire WebSearchService)

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **All imports exist in codebase**:

   - `LlmService` from `@ptah-extension/llm-abstraction` (index.ts:51)
   - `LlmConfigurationService` from `@ptah-extension/llm-abstraction` (index.ts:59)
   - `CliDetectionService` from `@ptah-extension/llm-abstraction` (index.ts:71)
   - `Logger` from `@ptah-extension/vscode-core` (ptah-api-builder.service.ts:34)
   - `MCPToolDefinition` from `../types` (tool-description.builder.ts:8)
   - `json2md` from `json2md` (mcp-response-formatter.ts:12)

2. **All patterns verified from examples**:

   - Tool registration: 14 existing tools in tool-description.builder.ts
   - Protocol handler switch: protocol-handlers.ts:239-477
   - Response formatter: mcp-response-formatter.ts:62-646
   - LLM service usage: llm-namespace.builder.ts:52-86
   - CLI adapter spawn: gemini-cli.adapter.ts:240-489

3. **Library documentation consulted**:

   - `libs/backend/vscode-lm-tools/CLAUDE.md`
   - `libs/backend/llm-abstraction/CLAUDE.md`

4. **No hallucinated APIs**:
   - `LlmService.setProvider()`: verified at llm-namespace.builder.ts:60
   - `LlmService.getCompletion()`: verified at llm-namespace.builder.ts:72
   - `CliDetectionService.getAdapter()`: verified at cli-detection.service.ts:130
   - `CliDetectionService.getDetection()`: verified at cli-detection.service.ts:114
   - `GeminiCliAdapter.runSdk()`: verified at gemini-cli.adapter.ts:240
   - `SdkHandle.onOutput()`: verified at cli-adapter.interface.ts:62
   - `SdkHandle.abort`: verified at cli-adapter.interface.ts:58
   - `SdkHandle.done`: verified at cli-adapter.interface.ts:60
   - `MCPToolDefinition.annotations`: verified at types.ts:649-658
   - `createToolSuccessResponse()`: verified at protocol-handlers.ts:504

### Architecture Delivery Checklist

- [x] All components specified with evidence
- [x] All patterns verified from codebase (14 tool registrations, LLM namespace, CLI adapter)
- [x] All imports/decorators verified as existing
- [x] Quality requirements defined (functional + non-functional)
- [x] Integration points documented (data flow, dependency chain)
- [x] Files affected list complete (1 CREATE, 5 MODIFY)
- [x] Developer type recommended (backend-developer)
- [x] Complexity assessed (MEDIUM, 3-5 hours)
- [x] Risk assessment complete (no high risks)
- [x] No step-by-step implementation (team-leader decomposes into tasks)
