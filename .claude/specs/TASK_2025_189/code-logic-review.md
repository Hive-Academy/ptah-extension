# Code Logic Review - TASK_2025_189

## Review Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall Score       | 5/10           |
| Assessment          | NEEDS_REVISION |
| Critical Issues     | 2              |
| Serious Issues      | 3              |
| Moderate Issues     | 3              |
| Failure Modes Found | 8              |

## The 5 Paranoid Questions

### 1. How does this fail silently?

**Timer leak in `createTimeout`**: The `setTimeout` inside `createTimeout()` (line 186) is never cleared. When `searchViaVsCodeLm` succeeds before the timeout, the timer still fires after `timeoutMs` and rejects a promise that nobody is listening to. In Node.js this becomes an unhandled promise rejection. The same pattern exists in `searchViaGeminiCli` (line 170) -- if `handle.done` resolves first (success), the `setTimeout` still fires, calls `handle.abort.abort()` unnecessarily, and rejects a promise nobody catches.

**VS Code LM returns empty string**: If `getCompletion` returns `Result.ok('')`, line 128 returns `null` (falsy check on `completionResult.value`), silently discarding the result and falling through to Gemini CLI. This is arguably correct behavior but is not logged -- the user never knows why the fast path was skipped.

### 2. What user action causes unexpected behavior?

**Empty query string**: `search('')` is not validated. An empty string gets sent to both VS Code LM and Gemini CLI. The LLM prompt becomes `"Search the web for: "` which will produce garbage or a refusal. No guard at the MCP handler level either -- `args as { query: string }` trusts the caller.

**Extremely long query**: No query length validation. A 1MB query string would be forwarded verbatim into LLM prompts and CLI process arguments. The Gemini CLI task string embeds the query in double quotes without escaping, so a query containing `"` characters could malform the prompt.

### 3. What data makes this produce wrong results?

**`getCompletion` returns `Result.ok(undefined)`**: Line 128 checks `completionResult.value || null`. If `Result.value` is `undefined` (which the type allows -- `Result<string>` could hold an empty `.value` on err path), this falls through silently to Gemini.

**`getDefaultModel('vscode-lm')` returns empty string**: `LlmConfigurationService.getDefaultModel` has fallbacks, but if all fail and return `''`, `setProvider('vscode-lm', '')` will be called with an empty model string. The behavior depends on the provider registry -- it may error, or it may silently select a wrong model.

### 4. What happens when dependencies fail?

**`setProvider` acquires a mutex lock**: `LlmService.setProvider()` uses `providerMutex.runExclusive()`. If another part of the codebase is concurrently calling `setProvider`, the web search blocks until that lock is released. With a tight timeout budget, this could eat most of the remaining time and then fail.

**`cliDetectionService.getDetection('gemini')` triggers full `detectAll()`**: This scans the system PATH for all CLI binaries. If the filesystem is slow (network drive, large PATH), this detection itself could be slow and is not subject to the timeout.

**Gemini CLI `runSdk` promise rejection**: If `adapter.runSdk()` throws (not rejects -- throws synchronously), the error is caught by the outer try/catch and re-thrown with a generic message, which is fine. But if `runSdk` returns a handle where `handle.done` rejects with a non-Error value, the error message construction at line 84 handles it via `String(error)`.

### 5. What's missing that the requirements didn't mention?

**No cancellation/AbortSignal support**: The `search()` method has no way to be cancelled from outside. If the MCP request is abandoned by the client, the search continues running in the background.

**No query sanitization**: The query is interpolated directly into prompt strings and CLI arguments. While not a security vulnerability per se (the prompts go to LLMs), prompt injection via the query parameter is trivially possible.

**No retry logic**: Both providers are tried once each. If VS Code LM fails with a transient error (rate limit, temporary network blip), no retry is attempted.

**The `webSearch` property on PtahAPI is optional but always set**: The type declares `webSearch?:` (optional), but `PtahAPIBuilder.build()` always creates and assigns it. The null check in `protocol-handlers.ts` line 481 is defensive but will never trigger in practice. This is fine defensively, but the type should arguably not be optional since it is always present.

## Failure Mode Analysis

### Failure Mode 1: Timer Leak / Unhandled Rejection on Success

- **Trigger**: VS Code LM completes successfully before `timeoutMs`
- **Symptoms**: Unhandled promise rejection warning in console after `timeoutMs` elapses. The `setTimeout` in `createTimeout()` fires its reject callback, and since the `Promise.race` already resolved, nobody catches the rejection.
- **Impact**: CRITICAL -- In Node.js, unhandled rejections can crash the process (configurable). At minimum, noisy error logs.
- **Current Handling**: None. The timer is never cleared.
- **Recommendation**: Use `AbortController` or track the timer ID and `clearTimeout` on success. Alternatively, make the timeout promise resolve (not reject) with a sentinel value, or use a helper that cleans up after itself.

### Failure Mode 2: Gemini CLI Timer Leak / Double Abort

- **Trigger**: Gemini CLI `handle.done` resolves before `timeoutMs`
- **Symptoms**: After Gemini succeeds, the `setTimeout` at line 170 fires, calls `handle.abort.abort()` on an already-completed process, and rejects a promise nobody catches.
- **Impact**: CRITICAL -- Same unhandled rejection issue. Additionally, calling `abort()` on a completed AbortController may throw in some implementations.
- **Current Handling**: None.
- **Recommendation**: Clear the timeout when `handle.done` resolves. Wrap in a helper that handles cleanup.

### Failure Mode 3: LlmService Global State Mutation

- **Trigger**: Calling `setProvider('vscode-lm', model)` at line 102
- **Symptoms**: This is a **global state mutation** on a shared `LlmService` singleton. After `setProvider` is called for web search, the LLM service's active provider is now `vscode-lm` with whatever model was selected. If another part of the codebase was using a different provider/model, their subsequent `getCompletion` calls silently use the wrong provider.
- **Impact**: SERIOUS -- Other features that depend on `LlmService` may produce unexpected results.
- **Current Handling**: None. No save/restore of previous provider state.
- **Recommendation**: Either (a) save and restore the previous provider after the web search call, or (b) create a separate `LlmService` instance for web search, or (c) call `setProvider` with the original provider after the search completes.

### Failure Mode 4: Empty/Missing Query

- **Trigger**: `ptah_web_search` called with `query: ""` or `query: undefined`
- **Symptoms**: Prompt sent to LLM is `"Search the web for: "` which produces meaningless results. No error returned.
- **Impact**: SERIOUS -- User gets garbage results instead of an error.
- **Current Handling**: None. No validation in `WebSearchService.search()` or in the MCP handler.
- **Recommendation**: Add `if (!query || !query.trim())` guard returning an error.

### Failure Mode 5: Timeout Budget Exhaustion Between Providers

- **Trigger**: VS Code LM takes 29.9 seconds of a 30-second timeout, then fails
- **Symptoms**: `remaining` at line 61 is ~100ms. Gemini CLI detection + SDK spawn + search cannot complete in 100ms. The Gemini path immediately fails or times out.
- **Impact**: MODERATE -- The fallback is essentially dead in this scenario. The user sees "both providers failed" when really only the timeout budget was miscalculated.
- **Current Handling**: The `remaining <= 0` check at line 62 handles the zero case, but very small positive remainders still cause issues.
- **Recommendation**: Reserve a minimum budget for the fallback (e.g., at least 5 seconds). If the first provider consumes more than `timeout - 5000`, skip the fallback rather than attempting it with an impossibly small budget.

### Failure Mode 6: `params!` Non-Null Assertion in Protocol Handler

- **Trigger**: MCP client sends a `tools/call` request with no `params`
- **Symptoms**: `params!` at line 195 throws a runtime TypeError
- **Impact**: MODERATE -- Pre-existing issue (not introduced by this task), but the new web search tool inherits this risk. The outer try/catch in `handleMCPRequest` catches it, so it returns an error response rather than crashing.
- **Current Handling**: Caught by outer try/catch, returns JSON-RPC error.
- **Recommendation**: Defensive check instead of `!` assertion.

### Failure Mode 7: Gemini CLI Output Accumulation Without Limit

- **Trigger**: Gemini CLI produces very large output (e.g., dumps entire web pages)
- **Symptoms**: `output += data` at line 163 accumulates unbounded string data in memory.
- **Impact**: MODERATE -- Memory pressure if Gemini returns very verbose results.
- **Current Handling**: None. No output size cap.
- **Recommendation**: Cap `output` at a reasonable size (e.g., 500KB) and stop accumulating after that.

### Failure Mode 8: Race Between Provider Availability and Detection

- **Trigger**: VS Code LM becomes unavailable between `setProvider` returning OK and `getCompletion` being called
- **Symptoms**: `getCompletion` fails, `searchViaVsCodeLm` catches the error and falls through to Gemini. Minor latency impact.
- **Impact**: LOW -- The fallback handles this correctly.
- **Current Handling**: Caught by the try/catch in `search()`, falls through to Gemini.

## Critical Issues

### Issue 1: setTimeout never cleared in Promise.race patterns -- leaked timers and unhandled rejections

- **File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\services\web-search.service.ts:119-125, 167-175, 184-188`
- **Scenario**: Any time the primary promise in `Promise.race` resolves before the timeout
- **Impact**: Unhandled promise rejection (the reject callback fires into the void). Node.js may log warnings or crash depending on configuration. The timer continues consuming resources.
- **Evidence**:

  ```typescript
  // Line 119-125: VS Code LM path
  const completionResult = await Promise.race([
    this.deps.llmService.getCompletion(systemPrompt, `Search the web for: ${query}`),
    this.createTimeout<never>(timeoutMs),  // <-- timer never cleared
  ]);

  // Line 184-188: createTimeout creates a reject-only promise with no cleanup
  private createTimeout<T>(ms: number): Promise<T> {
    return new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('Search timed out')), ms)
    );
  }
  ```

- **Fix**: Return the timer ID from `createTimeout` and clear it on resolution. Or use a pattern like:
  ```typescript
  private raceWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Search timed out')), ms);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
  }
  ```

### Issue 2: `setProvider` mutates shared LlmService state

- **File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\services\web-search.service.ts:102-105`
- **Scenario**: Web search triggers `setProvider('vscode-lm', model)` on a singleton `LlmService` that other features also use
- **Impact**: Any concurrent or subsequent LLM usage by other parts of the system silently uses the provider set by web search. If the previous provider was different, those other features break.
- **Evidence**:
  ```typescript
  const setResult = await this.deps.llmService.setProvider('vscode-lm', model);
  ```
  `LlmService` is a singleton (injected via `TOKENS.LLM_SERVICE`). `setProvider` replaces `this.currentProvider` permanently.
- **Fix**: Save the current provider state before and restore it after, or better yet, use a separate `LlmService` instance for web search, or check if the current provider is already `vscode-lm` before switching.

## Serious Issues

### Issue 3: No query validation

- **File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\services\web-search.service.ts:25` and `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\mcp-handlers\protocol-handlers.ts:480`
- **Scenario**: Empty string, whitespace-only, or extremely long query
- **Impact**: Meaningless LLM results or excessive resource consumption
- **Evidence**: No `if (!query?.trim())` check exists anywhere in the chain
- **Fix**: Add validation in `search()` method: throw if query is empty/whitespace. Add max length check (e.g., 10KB).

### Issue 4: Gemini CLI timeout callback fires after success -- double-abort and unhandled rejection

- **File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\services\web-search.service.ts:167-175`
- **Scenario**: Gemini CLI completes successfully in 5 seconds, but the setTimeout fires at `timeoutMs`
- **Impact**: Calls `handle.abort.abort()` on a completed process + unhandled rejection
- **Evidence**:
  ```typescript
  const exitCode = await Promise.race([
    handle.done,
    new Promise<number>((_, reject) =>
      setTimeout(() => {
        handle.abort.abort(); // fires even after success
        reject(new Error('Gemini CLI search timed out'));
      }, timeoutMs)
    ),
  ]);
  ```
- **Fix**: Clear the timeout when `handle.done` resolves:
  ```typescript
  let timer: NodeJS.Timeout;
  const exitCode = await Promise.race([
    handle.done.then(code => { clearTimeout(timer); return code; }),
    new Promise<number>((_, reject) => {
      timer = setTimeout(() => { handle.abort.abort(); reject(...); }, timeoutMs);
    }),
  ]);
  ```

### Issue 5: `exitCode !== 0 && !output.trim()` allows non-zero exit with partial output

- **File**: `D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\code-execution\services\web-search.service.ts:177-178`
- **Scenario**: Gemini CLI exits with code 1 (error) but has partial garbage output
- **Impact**: Returns partial/corrupt output as if it were a valid search result
- **Current Handling**: Only throws if BOTH exit code is non-zero AND output is empty
- **Recommendation**: At minimum, log a warning when exit code is non-zero but output exists. Consider adding a quality check or returning the output with a degraded-quality indicator.

## Data Flow Analysis

```
MCP Client
  |
  v
handleMCPRequest() -- protocol-handlers.ts
  |
  v
handleIndividualTool() -- case 'ptah_web_search'
  |
  +-- Null check: deps.ptahAPI.webSearch exists? [SAFE - always set by builder]
  +-- Type cast: args as { query: string; timeout?: number } [GAP: no validation]
  |
  v
WebSearchService.search(query, timeout)
  |
  +-- No query validation [GAP: empty/long queries pass through]
  +-- Timeout clamped: min(timeout ?? 30000, 60000) [OK]
  |
  v
searchViaVsCodeLm(query, timeout)
  |
  +-- configService.getDefaultModel('vscode-lm') [OK - has fallbacks]
  +-- llmService.setProvider('vscode-lm', model) [GAP: mutates global state]
  +-- Promise.race(getCompletion, createTimeout) [GAP: timer leak]
  +-- Return null if provider unavailable [OK]
  +-- Return null if completion is err or empty [OK but not logged for empty]
  |
  v (on failure/null)
searchViaGeminiCli(query, remaining)
  |
  +-- cliDetectionService.getDetection('gemini') [OK]
  +-- cliDetectionService.getAdapter('gemini') [OK]
  +-- adapter.runSdk({task: ...}) [OK]
  +-- handle.onOutput accumulates output [GAP: no size limit]
  +-- Promise.race(handle.done, timeout) [GAP: timer leak + double abort]
  +-- exitCode check [GAP: partial corrupt output accepted]
  |
  v
formatWebSearch(result) -- mcp-response-formatter.ts
  |
  +-- Markdown formatting [OK - has try/catch with fallback]
  |
  v
createToolSuccessResponse() -> MCP Client
```

### Gap Points Identified:

1. Query passes through without validation from MCP handler to service
2. `setProvider` mutates global LlmService state without restore
3. Timer leaks in both Promise.race patterns
4. Gemini CLI output accumulated without size limit
5. Non-zero exit code with partial output treated as success

## Requirements Fulfillment

| Requirement                    | Status   | Concern                                                      |
| ------------------------------ | -------- | ------------------------------------------------------------ |
| VS Code LM as primary provider | COMPLETE | Global state mutation side effect                            |
| Gemini CLI as fallback         | COMPLETE | Timer leak on success path                                   |
| Timeout handling               | PARTIAL  | Timer not cleared on success; no minimum budget for fallback |
| Error handling when both fail  | COMPLETE | Error message is informative                                 |
| MCP tool definition            | COMPLETE | Proper schema and annotations                                |
| MCP tool handler               | COMPLETE | Defensive null check on webSearch                            |
| Response formatting            | COMPLETE | Clean markdown output                                        |
| Type definitions               | COMPLETE | Optional webSearch on PtahAPI                                |
| PtahAPI builder integration    | COMPLETE | WebSearchService properly constructed                        |

### Implicit Requirements NOT Addressed:

1. Query validation (empty, too long)
2. Cleanup of Promise.race timers
3. LlmService state preservation around setProvider calls
4. Output size limits for Gemini CLI accumulation
5. Cancellation support (AbortSignal propagation from MCP layer)

## Edge Case Analysis

| Edge Case                        | Handled | How                                  | Concern                                      |
| -------------------------------- | ------- | ------------------------------------ | -------------------------------------------- |
| Empty query                      | NO      | Not validated                        | Garbage LLM results                          |
| Very long query (>100KB)         | NO      | Passed through                       | Memory + prompt bloat                        |
| Both providers unavailable       | YES     | Throws with clear message            | None                                         |
| VS Code LM returns empty string  | YES     | Falls through to Gemini              | Not logged                                   |
| Gemini CLI not installed         | YES     | Throws, caught by outer handler      | None                                         |
| Gemini adapter has no runSdk     | YES     | Throws with clear message            | None                                         |
| Timeout = 0                      | YES     | Clamped to min(0, 60000) = 0         | Immediate timeout, but works                 |
| Timeout = negative               | PARTIAL | Math.min(negative, 60000) = negative | setTimeout with negative = fires immediately |
| Concurrent web searches          | NO      | Both mutate shared LlmService        | Provider state corruption                    |
| Query with special characters    | NO      | Embedded in double-quoted string     | Prompt injection possible                    |
| Gemini output > available memory | NO      | Unbounded accumulation               | OOM risk                                     |
| `params` is null in MCP handler  | PARTIAL | Pre-existing `!` assertion           | Caught by outer try/catch                    |

## Integration Risk Assessment

| Integration                      | Failure Probability              | Impact                            | Mitigation                             |
| -------------------------------- | -------------------------------- | --------------------------------- | -------------------------------------- |
| LlmService.setProvider           | MED                              | HIGH (global state mutation)      | Need save/restore or separate instance |
| LlmService.getCompletion         | LOW                              | LOW (graceful fallback)           | Falls through to Gemini                |
| CliDetectionService.getDetection | LOW                              | LOW (clean error)                 | Throws, caught properly                |
| adapter.runSdk                   | LOW                              | MED (process leak if abort fails) | Abort called on timeout                |
| Promise.race timers              | HIGH (always happens on success) | HIGH (unhandled rejections)       | Need cleanup                           |

## Stubs/Placeholders/TODOs Check

- No TODO comments found
- No placeholder returns found
- No console.log stubs found
- No "not implemented" markers found
- All methods have real implementations

## Verdict

**Recommendation**: NEEDS_REVISION
**Confidence**: HIGH
**Top Risk**: Timer leaks in Promise.race patterns causing unhandled promise rejections in production

The core business logic is sound -- the fallback chain, provider detection, and MCP integration are all correctly wired. However, the Promise.race patterns have a well-known pitfall where losing promises (the timeout) are never cleaned up, leading to unhandled rejections. Combined with the global LlmService state mutation, these issues need to be addressed before this is production-ready.

## What Robust Implementation Would Include

1. **Timer cleanup in Promise.race**: Use `.finally(() => clearTimeout(timer))` pattern or a dedicated `raceWithTimeout` helper that handles cleanup
2. **LlmService state isolation**: Either save/restore provider state, use a scoped LlmService instance, or check if already on the correct provider before switching
3. **Input validation**: Query length and emptiness checks at the service entry point
4. **Output size cap**: Limit Gemini CLI output accumulation to a reasonable maximum (e.g., 500KB)
5. **Minimum fallback budget**: Reserve at least 5 seconds for the Gemini CLI fallback; skip it if remaining time is too short
6. **Cancellation propagation**: Accept an optional AbortSignal to allow the caller to cancel in-flight searches
7. **Negative/zero timeout guard**: Clamp to a minimum of e.g., 5000ms, not just a maximum
