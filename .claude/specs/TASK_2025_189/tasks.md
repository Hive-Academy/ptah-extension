# Development Tasks - TASK_2025_189

**Total Tasks**: 9 | **Batches**: 3 | **Status**: 0/3 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- `LlmService.setProvider(providerName, model)` requires TWO args (providerName + model): VERIFIED at llm.service.ts:178
- `LlmService.getCompletion(systemPrompt, userPrompt)` returns `Result<string, LlmProviderError>`: VERIFIED at llm.service.ts:334
- `CliDetectionService.getAdapter('gemini')` returns `CliAdapter | undefined`: VERIFIED at cli-detection.service.ts:130
- `CliDetectionService.getDetection('gemini')` returns `CliDetectionResult | undefined`: VERIFIED at cli-detection.service.ts:114
- `SdkHandle.onOutput`, `.abort`, `.done` exist: VERIFIED at cli-adapter.interface.ts:56-60
- All PtahAPIBuilder deps already injected: VERIFIED at ptah-api-builder.service.ts:184-198
- `createToolSuccessResponse()` at protocol-handlers.ts:504: VERIFIED
- `json2md` import at mcp-response-formatter.ts:12: VERIFIED
- `MCPToolDefinition` from types.ts: VERIFIED at tool-description.builder.ts:8

### Risks Identified

| Risk                                                                                       | Severity | Mitigation                                                                        |
| ------------------------------------------------------------------------------------------ | -------- | --------------------------------------------------------------------------------- |
| Plan shows `setProvider('vscode-lm')` with 1 arg but API requires 2 (providerName + model) | HIGH     | Task 1.2 must use `configService.getDefaultModel('vscode-lm')` to get model first |
| VS Code LM may not have web search grounding                                               | MED      | Fallback to Gemini CLI provides real web search                                   |
| Gemini CLI spawn overhead 5-15s                                                            | LOW      | VS Code LM is primary path; Gemini is fallback only                               |

### Edge Cases to Handle

- [ ] Both providers unavailable -> clear error message (Task 1.1)
- [ ] VS Code LM returns non-grounded response -> still useful, not an error (Task 1.2)
- [ ] Gemini CLI process leak on timeout -> must call abort (Task 1.3)
- [ ] `webSearch` is undefined at protocol handler call time -> guard check (Task 2.3)

---

## Batch 1: WebSearchService + Types [IMPLEMENTED]

**Developer**: backend-developer
**Tasks**: 4 | **Dependencies**: None

### Task 1.1: Create WebSearchService class with interfaces and constructor [IMPLEMENTED]

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\services\web-search.service.ts` (CREATE)
**Spec Reference**: implementation-plan.md Components 1-3

**Quality Requirements**:

- Export `WebSearchDependencies` interface and `WebSearchResult` interface
- Export `WebSearchService` class
- Include `createTimeout` private helper method
- Must log provider selection and fallback events

**Implementation Details**:

Create new file with:

```typescript
import type { LlmService, LlmConfigurationService, CliDetectionService } from '@ptah-extension/llm-abstraction';
import type { Logger } from '@ptah-extension/vscode-core';

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
    // Clamp timeout: default 30s, max 60s
    const timeout = Math.min(timeoutMs ?? 30000, 60000);
    const start = Date.now();

    // Try VS Code LM API first (in-process, fast)
    try {
      const result = await this.searchViaVsCodeLm(query, timeout);
      if (result) {
        this.deps.logger.info('[WebSearch] Completed via VS Code LM', 'WebSearchService', {
          query: query.substring(0, 80),
          durationMs: Date.now() - start,
        });
        return { query, summary: result, provider: 'vscode-lm', durationMs: Date.now() - start };
      }
    } catch (error) {
      this.deps.logger.warn('[WebSearch] VS Code LM failed, trying Gemini CLI', 'WebSearchService', { error: error instanceof Error ? error.message : String(error) });
    }

    // Fallback: Gemini CLI
    try {
      const remaining = timeout - (Date.now() - start);
      if (remaining <= 0) throw new Error('Timeout exhausted after VS Code LM attempt');
      const result = await this.searchViaGeminiCli(query, remaining);
      this.deps.logger.info('[WebSearch] Completed via Gemini CLI', 'WebSearchService', {
        query: query.substring(0, 80),
        durationMs: Date.now() - start,
      });
      return { query, summary: result, provider: 'gemini-cli', durationMs: Date.now() - start };
    } catch (error) {
      throw new Error(`Web search failed: no provider available. ` + `VS Code LM and Gemini CLI both failed. ` + `Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Private methods in subsequent tasks (1.2 and 1.3)
  // Placeholder signatures to be filled:
  private async searchViaVsCodeLm(_query: string, _timeoutMs: number): Promise<string | null> {
    return null;
  }
  private async searchViaGeminiCli(_query: string, _timeoutMs: number): Promise<string> {
    throw new Error('Not implemented');
  }

  private createTimeout<T>(ms: number): Promise<T> {
    return new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Search timed out')), ms));
  }
}
```

Note: The placeholder private methods will be replaced in Tasks 1.2 and 1.3. The developer MUST implement all three tasks before moving on.

---

### Task 1.2: Implement searchViaVsCodeLm private method [IMPLEMENTED]

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\services\web-search.service.ts` (MODIFY)
**Dependencies**: Task 1.1
**Pattern to Follow**: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/llm-namespace.builder.ts` lines 52-86

**Quality Requirements**:

- Must return `null` (not throw) when VS Code LM is unavailable, enabling fallback
- Must respect timeout via `Promise.race`
- CRITICAL: `setProvider` requires TWO args: providerName AND model. Use `this.deps.configService.getDefaultModel('vscode-lm')` to get model name

**Validation Notes**:

- The plan's code shows `setProvider('vscode-lm')` with 1 arg, but the actual API at llm.service.ts:178 requires `setProvider(providerName: LlmProviderName, model: string)`. The developer MUST call `this.deps.configService.getDefaultModel('vscode-lm')` first.

**Implementation Details**:

Replace the placeholder `searchViaVsCodeLm` method with:

```typescript
private async searchViaVsCodeLm(query: string, timeoutMs: number): Promise<string | null> {
  // Get default model for vscode-lm provider
  const model = this.deps.configService.getDefaultModel('vscode-lm');
  const setResult = await this.deps.llmService.setProvider('vscode-lm', model);
  if (setResult.isErr()) {
    this.deps.logger.debug('[WebSearch] VS Code LM not available', 'WebSearchService');
    return null;
  }

  const systemPrompt =
    'You are a web search assistant. Search the web for the given query ' +
    'and provide a comprehensive summary of the most relevant and recent results. ' +
    'Include key facts, sources, and URLs when available.';

  const completionResult = await Promise.race([
    this.deps.llmService.getCompletion(systemPrompt, `Search the web for: ${query}`),
    this.createTimeout<never>(timeoutMs),
  ]);

  if (!completionResult || completionResult.isErr()) return null;
  return completionResult.value || null;
}
```

---

### Task 1.3: Implement searchViaGeminiCli private method [IMPLEMENTED]

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\services\web-search.service.ts` (MODIFY)
**Dependencies**: Task 1.1
**Pattern to Follow**: `libs/backend/llm-abstraction/src/lib/services/cli-adapters/gemini-cli.adapter.ts` lines 240-489

**Quality Requirements**:

- Must abort the Gemini CLI process on timeout (prevents leaked processes)
- Must check `detection.installed` before attempting spawn
- Must use `detection.path` as `binaryPath`
- Task prompt must explicitly instruct Gemini to use `google_web_search` and only search

**Validation Notes**:

- `SdkHandle.onOutput` signature: `(callback: (data: string) => void) => void` (cli-adapter.interface.ts:62)
- `SdkHandle.abort` is `AbortController` (cli-adapter.interface.ts:58)
- `SdkHandle.done` resolves with exit code number (cli-adapter.interface.ts:60)
- `adapter.runSdk` is optional on CliAdapter interface (cli-adapter.interface.ts:123) - must check before calling

**Implementation Details**:

Replace the placeholder `searchViaGeminiCli` method with:

```typescript
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

---

### Task 1.4: Add webSearch property to PtahAPI interface [IMPLEMENTED]

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\types.ts` (MODIFY)
**Dependencies**: None (can be done in parallel with 1.1-1.3)

**Quality Requirements**:

- Property must be optional (`?`) since the service may not initialize
- Must match WebSearchResult shape from Task 1.1

**Implementation Details**:

After line 67 (`dependencies: DependenciesNamespace;`) and before line 69 (`/** * Get help documentation...`), add:

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

The exact insertion point is between:

- `dependencies: DependenciesNamespace;` (line 67)
- `/**` (line 69, the help method JSDoc)

---

**Batch 1 Verification**:

- `web-search.service.ts` exists with complete implementation (no stubs)
- `types.ts` has `webSearch?` property on `PtahAPI` interface
- Build passes: `npx nx build vscode-lm-tools`
- code-logic-reviewer approved
- Edge cases from validation handled

---

## Batch 2: MCP Tool Registration [IMPLEMENTED]

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 1

### Task 2.1: Add buildWebSearchTool to tool-description.builder.ts [IMPLEMENTED]

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\tool-description.builder.ts` (MODIFY)
**Pattern to Follow**: `buildSearchFilesTool()` at lines 100-122 in the same file

**Quality Requirements**:

- Must follow `MCPToolDefinition` interface
- Must include `annotations: { readOnlyHint: true, openWorldHint: true }`
- Must have `query` as required param, `timeout` as optional

**Implementation Details**:

After line 455 (end of `buildAgentStopTool`), before line 457 (start of `buildExecuteCodeDescription`), add:

```typescript
// ========================================
// Web Search MCP Tool (TASK_2025_189)
// ========================================

/**
 * Build the ptah_web_search tool definition
 * Web search via LLM providers with fallback chain
 */
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

---

### Task 2.2: Add formatWebSearch to mcp-response-formatter.ts [IMPLEMENTED]

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\mcp-response-formatter.ts` (MODIFY)
**Pattern to Follow**: `formatTokenCount` at lines 414-426 in the same file

**Quality Requirements**:

- Must use `json2md` for formatting
- Must use try/catch with `fallbackJson` fallback
- Must display query, provider, duration, and summary

**Implementation Details**:

After line 634 (end of `formatAgentSteer` function), before line 636 (the `// Fallback` comment), add:

```typescript
// ============================================================
// Web Search Tools (TASK_2025_189)
// ============================================================

/**
 * Format ptah_web_search result
 */
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

---

### Task 2.3: Register ptah_web_search in protocol-handlers.ts [IMPLEMENTED]

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\protocol-handlers.ts` (MODIFY)
**Dependencies**: Tasks 2.1, 2.2

**Quality Requirements**:

- Must add import for `buildWebSearchTool`
- Must add import for `formatWebSearch`
- Must add to `handleToolsList()` return array
- Must add switch case in `handleIndividualTool()`
- Must guard against `deps.ptahAPI.webSearch` being undefined

**Implementation Details**:

**Change 1**: Add `buildWebSearchTool` to the builder import block. At line 35-36, change:

```
  buildAgentStopTool,
} from './tool-description.builder';
```

to:

```
  buildAgentStopTool,
  buildWebSearchTool,
} from './tool-description.builder';
```

**Change 2**: Add `formatWebSearch` to the formatter import block. At line 52-53, change:

```
  formatAgentList,
} from './mcp-response-formatter';
```

to:

```
  formatAgentList,
  formatWebSearch,
} from './mcp-response-formatter';
```

**Change 3**: Add `buildWebSearchTool()` to the tools array in `handleToolsList()`. At line 171, after `buildAgentListTool(),`, add:

```typescript
        // Web search tool (TASK_2025_189)
        buildWebSearchTool(),
```

So the array becomes:

```
        buildAgentListTool(),
        // Web search tool (TASK_2025_189)
        buildWebSearchTool(),
        // Power-user tools
        buildExecuteCodeTool(),
```

**Change 4**: Add switch case in `handleIndividualTool()`. After the `ptah_agent_list` case (line 473, before `default: return null;`), add:

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

---

**Batch 2 Verification**:

- `buildWebSearchTool` exported from tool-description.builder.ts
- `formatWebSearch` exported from mcp-response-formatter.ts
- `ptah_web_search` appears in tools/list response
- Switch case handles `ptah_web_search` with undefined guard
- Build passes: `npx nx build vscode-lm-tools`
- code-logic-reviewer approved

---

## Batch 3: PtahAPI Wiring [PENDING]

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 1

### Task 3.1: Import and wire WebSearchService in ptah-api-builder.service.ts [PENDING]

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\ptah-api-builder.service.ts` (MODIFY)

**Quality Requirements**:

- Must import `WebSearchService` from relative path
- Must instantiate with correct dependency mapping
- All four deps (llmService, configService, cliDetectionService, logger) already available on `this`

**Implementation Details**:

**Change 1**: Add import. After line 81 (`} from './namespace-builders';`), before line 82 (`import {`), add:

```typescript
import { WebSearchService } from './services/web-search.service';
```

**Change 2**: Add `webSearch` to the return object in `build()` method. After line 425 (`help: buildHelpMethod(),`) and before line 426 (`};`), add:

```typescript

      // Web search service (TASK_2025_189)
      webSearch: new WebSearchService({
        llmService: this.llmService,
        configService: this.llmConfigService,
        cliDetectionService: this.cliDetectionService,
        logger: this.logger,
      }),
```

---

### Task 3.2: Verify library barrel export (if needed) [PENDING]

**File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\index.ts` (VERIFY/MODIFY)

**Quality Requirements**:

- WebSearchService is internal to the library (used only by PtahAPIBuilder) so it does NOT need to be exported from the barrel
- WebSearchResult type is internal
- VERIFY that `index.ts` does NOT need changes

**Implementation Details**:

Read `libs/backend/vscode-lm-tools/src/index.ts` to confirm no export is needed. The `WebSearchService` is consumed internally by `PtahAPIBuilder.build()` only. No public API change required.

If for some reason `types.ts` re-exports are affected, ensure the `PtahAPI` interface (which now has `webSearch?`) is still properly exported.

This task is primarily a verification step -- no code changes expected.

---

**Batch 3 Verification**:

- `PtahAPIBuilder.build()` returns object with `webSearch` property
- WebSearchService instantiated with correct deps
- No circular dependency issues
- Build passes: `npx nx build vscode-lm-tools`
- code-logic-reviewer approved

---

## Status Icons Reference

| Status        | Meaning                         | Who Sets              |
| ------------- | ------------------------------- | --------------------- |
| [PENDING]     | Not started                     | team-leader (initial) |
| [IN PROGRESS] | Assigned to developer           | team-leader           |
| [IMPLEMENTED] | Developer done, awaiting verify | developer             |
| [COMPLETE]    | Verified and committed          | team-leader           |
| [FAILED]      | Verification failed             | team-leader           |
