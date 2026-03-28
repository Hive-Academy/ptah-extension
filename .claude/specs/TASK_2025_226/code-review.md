# Code Logic Review - TASK_2025_226

## Decouple vscode-lm-tools MCP Server from VS Code

## Review Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall Score       | 7/10     |
| Assessment          | APPROVED |
| Critical Issues     | 1        |
| Serious Issues      | 3        |
| Moderate Issues     | 5        |
| Failure Modes Found | 8        |

---

## The 5 Paranoid Questions

### 1. How does this fail silently?

**FM-1: Electron agents silently get empty results from degraded IDE namespace.**
When Electron code calls `ptah.ide.lsp.getReferences(file, line, col)`, it gets `[]` with zero indication that this operation is unavailable. The AI agent consuming this result has no way to distinguish "no references found" from "this feature is not supported on this platform." This could lead the agent to draw incorrect conclusions (e.g., "this function is unused" when really it just cannot be queried).

**FM-2: `buildPlatformSystemPrompt(false)` relies on exact string matching for section removal.**
If someone edits the `PTAH_SYSTEM_PROMPT` constant and changes whitespace, capitalization, or line breaks in the VS Code-only sections, the `buildPlatformSystemPrompt(false)` function will silently fail to strip those sections. The Electron system prompt would then advertise tools that don't exist on the platform, causing the AI to attempt calling `ptah_lsp_references` which returns empty arrays (see FM-1).

**FM-3: `getDiagnostics()` in Electron silently returns `[]`.**
`ElectronDiagnosticsProvider.getDiagnostics()` returns an empty array. When an AI agent calls `ptah_get_diagnostics`, it gets "no diagnostics found" on Electron, regardless of whether the workspace has compilation errors. The agent has no way to know diagnostics are unavailable vs. the project is clean.

### 2. What user action causes unexpected behavior?

**FM-4: Electron `approval_prompt` auto-allows everything without user consent.**
In Electron mode, `approval_prompt` auto-allows all requests since there's no WebviewManager for the approval UI. This means an AI agent running in Electron can perform ANY tool operation without user approval. While this is an intentional design decision, it represents a fundamental change in the security model. A malicious or misbehaving agent prompt could trigger destructive file operations (writes, deletes) via `execute_code` without the user ever being asked.

**FM-5: An agent might call filtered tools via `execute_code` sandbox.**
The tool filtering in `handleToolsList` excludes `ptah_lsp_references`, `ptah_lsp_definitions`, and `ptah_get_dirty_files` from the `tools/list` response on Electron. However, the `execute_code` tool still exposes the full `ptahAPI` object including `ptah.ide.lsp.getReferences()`. An agent using `execute_code` can still call these methods and get empty degradation stubs.

### 3. What data makes this produce wrong results?

**FM-6: The `VscodeIDECapabilities.lsp.getReferences()` throws on failure instead of returning empty.**
In VS Code, if an LSP command fails (e.g., language server is busy, file doesn't exist on disk), `VscodeIDECapabilities` wraps the error and re-throws it. But the graceful degradation stubs in Electron return `[]`. This creates an inconsistency: on VS Code, a failed reference lookup is an error; on Electron, it's an empty result. Code that handles both platforms needs to handle both patterns.

**FM-7: `getConfiguredPort` double-defaults with `?? 51820`.**
In `http-server.handler.ts:46`, `getConfiguredPort` does:

```typescript
return workspaceProvider.getConfiguration<number>('ptah', 'mcpPort', 51820) ?? 51820;
```

The `getConfiguration` already takes `51820` as the default value. The `?? 51820` is redundant unless `getConfiguration` can return `null` even with a default. If the Electron `IWorkspaceProvider.getConfiguration()` implementation returns `null` instead of `undefined` for missing values, this would still work, but it indicates uncertainty about the contract.

### 4. What happens when dependencies fail?

**FM-8: `VscodeIDECapabilities` is exported from library index.ts, causing bundler inclusion in Electron.**
The library's `index.ts` (line 17) does `export { VscodeIDECapabilities } from './lib/code-execution/namespace-builders/ide-capabilities.vscode'`. This means the Electron bundler must resolve `ide-capabilities.vscode.ts`, which does `import * as vscode from 'vscode'`. This only works because the Electron tsconfig maps `vscode` to `vscode-shim.ts`. However, the shim does NOT provide `Position`, `Range`, `DiagnosticSeverity`, or `languages`. If any code path ever instantiates `VscodeIDECapabilities` in Electron (even accidentally, e.g., in a test), it will crash at runtime when trying to use `new vscode.Position(line, col)` because the shim's Position is undefined.

This is not a current runtime issue (the class is never instantiated in Electron), but it's a latent trap. A future developer could accidentally register `VscodeIDECapabilities` in the Electron container and get cryptic runtime errors.

### 5. What's missing that the requirements didn't mention?

1. **No platform detection in `ptah.ide.*` stub responses.** The graceful degradation stubs return empty arrays without any indication that the feature is unavailable. A `platformUnavailable: true` flag or an `unsupported` error type would let AI agents make informed decisions.

2. **No runtime validation that ElectronDiagnosticsProvider is actually registered.** `PtahAPIBuilder` injects `IDiagnosticsProvider` via `@inject(PLATFORM_TOKENS.DIAGNOSTICS_PROVIDER)`. If the Electron registration is missed, this crashes at construction time with an opaque DI error, not a descriptive one.

3. **No telemetry for auto-allowed approvals.** When Electron auto-allows approval prompts, there's a log message but no way to audit what was auto-approved after the fact. Premium users on Electron have no visibility into what the agent did without manual log review.

4. **Testing namespace always returns stubs, even on VS Code.** `buildTestingNamespace()` always returns empty stubs on both platforms. This is documented but means VS Code users also get no testing integration through the MCP tools, which may be surprising.

---

## Failure Mode Analysis

### Failure Mode 1: Silent IDE Degradation Misleads Agents

- **Trigger**: AI agent calls `ptah.ide.lsp.getReferences('auth.ts', 10, 5)` in Electron
- **Symptoms**: Returns `[]` - agent concludes "no references found"
- **Impact**: MODERATE - Agent makes incorrect code analysis decisions (e.g., marks function as dead code)
- **Current Handling**: Returns empty array, no indication of platform limitation
- **Recommendation**: Return a structured response like `{ results: [], platformNote: "LSP not available in standalone mode" }` or add a `ptah.platform.capabilities()` method

### Failure Mode 2: System Prompt String Replacement Brittleness

- **Trigger**: Developer edits PTAH_SYSTEM_PROMPT, changing format of VS Code-only sections
- **Symptoms**: Electron system prompt includes VS Code-only tools, agent calls them, gets empty results
- **Impact**: LOW-MODERATE - Agent wastes tokens calling unsupported tools
- **Current Handling**: Three fallback replace attempts (section+'\n\n', section+'\n', section alone)
- **Recommendation**: Use structured data (object array with platform flags) rather than string manipulation to build the prompt. Or add a runtime assertion/test that `buildPlatformSystemPrompt(false)` does not contain "(VS Code only)".

### Failure Mode 3: Auto-Allow Security Model Change

- **Trigger**: Premium user runs Electron app, agent uses `approval_prompt` tool
- **Symptoms**: All operations auto-approved without user interaction
- **Impact**: SERIOUS - Agent can perform destructive operations without consent
- **Current Handling**: Logs the auto-approval, returns `{ behavior: 'allow' }`
- **Recommendation**: Document this prominently in the Electron app's security model. Consider adding a configuration option for Electron users to set a whitelist/blacklist. At minimum, log at WARN level, not INFO.

### Failure Mode 4: VscodeIDECapabilities Exported to Electron Bundle

- **Trigger**: Library index.ts exports VscodeIDECapabilities, Electron bundler resolves it
- **Symptoms**: No immediate crash (shim handles the import), but instantiation would crash
- **Impact**: LOW currently, SERIOUS if future code accidentally instantiates it
- **Current Handling**: vscode-shim.ts provides stub module, class never instantiated in Electron
- **Recommendation**: Use a dynamic `import()` or separate the export so the Electron bundle never includes ide-capabilities.vscode.ts. Or add a guard in the class constructor that checks the platform.

### Failure Mode 5: DI Race Between PtahAPIBuilder Construction and IDE_CAPABILITIES_TOKEN Registration

- **Trigger**: `registerVsCodeLmToolsServices` runs before `IDE_CAPABILITIES_TOKEN` is registered
- **Symptoms**: `PtahAPIBuilder.resolveIDECapabilities()` returns undefined (correct in Electron, wrong timing in VS Code)
- **Impact**: LOW - VS Code container.ts registers IDE_CAPABILITIES_TOKEN immediately after `registerVsCodeLmToolsServices`
- **Current Handling**: `resolveIDECapabilities()` is called from `build()` which is called from `CodeExecutionMCP` constructor. Since `CodeExecutionMCP` is a singleton resolved lazily, by the time it's resolved, IDE_CAPABILITIES_TOKEN is already registered.
- **Recommendation**: Add a comment in VS Code container.ts emphasizing that IDE_CAPABILITIES_TOKEN MUST be registered before CodeExecutionMCP is first resolved.

### Failure Mode 6: `hasIDECapabilities !== false` Check is Truthy-Biased

- **Trigger**: `ProtocolHandlerDependencies.hasIDECapabilities` is `undefined` (the type allows it since the field is optional)
- **Symptoms**: Tool filtering logic at `protocol-handlers.ts:180` uses `deps.hasIDECapabilities !== false`, which means `undefined` evaluates to `true`, including VS Code-only tools even when capabilities may not exist
- **Impact**: MODERATE - On a platform where IDE capabilities are genuinely unknown, VS Code-only tools would be listed but return empty results
- **Current Handling**: The field defaults to `undefined` in the interface, and the check treats undefined as "has capabilities"
- **Recommendation**: Change to `deps.hasIDECapabilities === true` for explicit opt-in, or make the field required (not optional)

### Failure Mode 7: constructor() Side Effects in CodeExecutionMCP

- **Trigger**: `CodeExecutionMCP` constructor calls `this.apiBuilder.build()` synchronously at line 98
- **Symptoms**: If any namespace builder throws during construction, the entire MCP server fails to initialize
- **Impact**: MODERATE - One failing namespace builder takes down all MCP tools
- **Current Handling**: No try-catch around `this.apiBuilder.build()`
- **Recommendation**: Wrap `build()` in try-catch and provide a degraded API, or defer build to `start()`

### Failure Mode 8: stopHttpServer Promise Never Rejects

- **Trigger**: `server.close()` callback might never fire if the server is in a bad state
- **Symptoms**: `stop()` hangs forever
- **Impact**: LOW - Only affects shutdown sequence
- **Current Handling**: No timeout on `server.close()`
- **Recommendation**: Add a timeout to the close operation (e.g., force-close after 5 seconds)

---

## Critical Issues

### Issue 1: Auto-Allow Approval Prompt in Electron Bypasses All Security Controls

- **File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/protocol-handlers.ts:240-265`
- **File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/approval-prompt.handler.ts:47-66`
- **Scenario**: Any agent running in Electron gets auto-approval for all tool operations
- **Impact**: An AI agent can perform file writes, deletes, code execution, and any other tool operation without the user ever being prompted. This fundamentally changes the security model for Electron premium users.
- **Evidence**:
  ```typescript
  // protocol-handlers.ts:242-264
  if (!deps.webviewManager) {
    const approvalParams = args as unknown as ApprovalPromptParams;
    deps.logger.info('approval_prompt auto-allowed (no WebviewManager -- Electron mode)', { tool: approvalParams.tool_name });
    return {
      jsonrpc: '2.0',
      id: request.id,
      result: {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              behavior: 'allow',
              updatedInput: approvalParams.input,
            }),
          },
        ],
      },
    };
  }
  ```
- **Fix**: Consider implementing an Electron-native approval dialog (e.g., `dialog.showMessageBox()`) for high-risk operations. At minimum, log at WARN level and document this in user-facing Electron security documentation. Add a configuration flag to control auto-allow behavior.

---

## Serious Issues

### Issue 1: `hasIDECapabilities` Optional Field Creates Truthy-Bias in Tool Filtering

- **File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/protocol-handlers.ts:83,180`
- **Scenario**: If `hasIDECapabilities` is `undefined` (the default for an optional field), the check `deps.hasIDECapabilities !== false` evaluates to `true`, including VS Code-only tools.
- **Impact**: A new platform that doesn't explicitly set `hasIDECapabilities: false` would advertise tools it cannot support.
- **Evidence**:

  ```typescript
  // Line 83: Optional field
  hasIDECapabilities?: boolean;

  // Line 180: Truthy-biased check
  ...(deps.hasIDECapabilities !== false
    ? [buildLspReferencesTool(), buildLspDefinitionsTool(), buildGetDirtyFilesTool()]
    : []),
  ```

- **Fix**: Change to `deps.hasIDECapabilities === true` (explicit opt-in) or make the field required in `ProtocolHandlerDependencies`.

### Issue 2: VscodeIDECapabilities Exported from Library Barrel Creates Latent Electron Risk

- **File**: `libs/backend/vscode-lm-tools/src/index.ts:17`
- **File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/index.ts:42`
- **Scenario**: The library's barrel export includes `VscodeIDECapabilities`, which imports `vscode`. The Electron build resolves this via `vscode-shim.ts`, but the shim does not provide `Position`, `Range`, or `languages` (constructors/namespaces used in method bodies). If accidentally instantiated in Electron, methods crash.
- **Impact**: No current runtime issue, but a maintenance hazard. A future developer adding `VscodeIDECapabilities` to the Electron DI container would get cryptic runtime errors like `vscode.Position is not a constructor`.
- **Fix**: Consider separating the VS Code-only export into a subpath export (e.g., `@ptah-extension/vscode-lm-tools/vscode`) that Electron never imports. Or add `Position` and `Range` constructors to the vscode-shim.

### Issue 3: PtahAPIBuilder.build() Called in Constructor Without Error Handling

- **File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/code-execution-mcp.service.ts:98`
- **Scenario**: `this.ptahAPI = this.apiBuilder.build()` is called in the constructor. If any namespace builder throws (e.g., a workspace-intelligence service fails to initialize), the entire CodeExecutionMCP singleton construction fails.
- **Impact**: All 16 MCP tools become unavailable because one namespace builder failed. tsyringe will throw a DI resolution error for all subsequent attempts to resolve CodeExecutionMCP.
- **Evidence**:
  ```typescript
  constructor(...) {
    // ...
    this.ptahAPI = this.apiBuilder.build(); // No try-catch
  }
  ```
- **Fix**: Wrap `build()` in try-catch, log the error, and either retry lazily or provide a degraded PtahAPI that reports the failure.

---

## Moderate Issues

### Issue 1: Double-Default in getConfiguredPort

- **File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-handlers/http-server.handler.ts:44-48`
- **Concern**: `getConfiguration<number>('ptah', 'mcpPort', 51820) ?? 51820` double-defaults. If `getConfiguration` returns `null` (not `undefined`), the nullish coalescing catches it. But the intent is unclear and makes the contract ambiguous.
- **Impact**: No functional issue, but indicates uncertainty about `IWorkspaceProvider.getConfiguration()` contract.

### Issue 2: IDE_NOT_AVAILABLE_MSG Declared But Never Used in Stub Responses

- **File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/ide-namespace.builder.ts:168`
- **Concern**: The constant `IDE_NOT_AVAILABLE_MSG` is defined and exported, but the graceful degradation stubs don't include it in their responses. The stubs silently return empty arrays/null/false.
- **Impact**: Missed opportunity to inform callers/agents that the feature is unavailable.

### Issue 3: Duplicated Auto-Allow Logic in Two Files

- **File**: `protocol-handlers.ts:240-264` and `approval-prompt.handler.ts:47-65`
- **Concern**: The auto-allow logic for absent WebviewManager is implemented in both files. The `protocol-handlers.ts` short-circuits before calling `handleApprovalPrompt`, and `approval-prompt.handler.ts` has a defensive duplicate. If the response format needs to change, both must be updated.
- **Impact**: Maintenance risk. The comment in approval-prompt.handler.ts acknowledges this is defensive.

### Issue 4: VscodeDiagnosticsProvider Line Numbers Are 0-Indexed

- **File**: `libs/backend/platform-vscode/src/implementations/vscode-diagnostics-provider.ts:39`
- **Concern**: `line: d.range.start.line` uses VS Code's 0-indexed line numbers. The `IDiagnosticsProvider` interface does not specify whether `line` is 0-indexed or 1-indexed. If a future Electron implementation (e.g., `tsc --noEmit` parser) uses 1-indexed lines, the results would be inconsistent.
- **Impact**: Potential cross-platform inconsistency in future diagnostics implementations.

### Issue 5: No Input Validation in Graceful Degradation Stubs

- **File**: `libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/ide-namespace.builder.ts:352-432`
- **Concern**: The graceful LSP/Editor/Actions stubs don't validate input (e.g., `getDefinition` ignores all parameters). The capability-backed versions validate file paths and positions. An agent that accidentally passes bad data to the stubs gets `[]`/`false` instead of a validation error, potentially masking bugs.
- **Impact**: Low - stubs are intentionally permissive, but inconsistent error behavior between platforms could confuse debugging.

---

## Data Flow Analysis

```
                        VS Code Host                    Electron Host
                        ===========                     =============
                              |                               |
     [IDE_CAPABILITIES_TOKEN] |                               | (not registered)
     VscodeIDECapabilities    |                               |
              |               |                               |
              v               v                               v
    PtahAPIBuilder.resolveIDECapabilities()    PtahAPIBuilder.resolveIDECapabilities()
              |  returns IIDECapabilities            | returns undefined
              v                                      v
    buildIDENamespace(capabilities)           buildIDENamespace(undefined)
              |  delegates to capabilities           | returns graceful stubs
              v                                      v
    ptahAPI.ide = { lsp: real LSP,            ptahAPI.ide = { lsp: empty[],
                    editor: real state,                        editor: null,
                    actions: real actions }                    actions: false }
              |                                      |
              v                                      v
    CodeExecutionMCP.constructor()             CodeExecutionMCP.constructor()
     hasIDECapabilities = true                  hasIDECapabilities = false
              |                                      |
              v                                      v
    handleToolsList: 16 tools                  handleToolsList: 13 tools
                                                (3 IDE tools excluded)
              |                                      |
              v                                      v
    handleToolsCall: all tools work             handleToolsCall: IDE tools
                                                 return stubs via ptahAPI
```

### Gap Points Identified:

1. **execute_code bypass**: The tool filtering only affects `tools/list`. The `execute_code` sandbox exposes the full `ptahAPI` including degraded IDE stubs. An agent can still call them.
2. **System prompt sync**: `buildPlatformSystemPrompt(false)` must be manually kept in sync with `PTAH_SYSTEM_PROMPT`. A mismatch means the prompt advertises tools that the tool list filters out (or vice versa).
3. **Container ordering**: `IDE_CAPABILITIES_TOKEN` registration in VS Code's container.ts happens AFTER `registerVsCodeLmToolsServices`. The lazy resolution pattern (`container.isRegistered` at `build()` time) handles this, but the ordering dependency is implicit.

---

## Requirements Fulfillment

| Requirement                                                           | Status   | Concern                                                        |
| --------------------------------------------------------------------- | -------- | -------------------------------------------------------------- |
| Remove all direct `import * as vscode` from library (except one file) | COMPLETE | VscodeIDECapabilities is the one exception, correctly isolated |
| MCP server works in Electron                                          | COMPLETE | 13/16 tools functional, registration verified                  |
| Graceful degradation for VS Code-only features                        | COMPLETE | Stubs return empty/null/false, no crashes                      |
| IDiagnosticsProvider abstraction                                      | COMPLETE | Interface, VS Code impl, Electron impl all present             |
| IIDECapabilities interface                                            | COMPLETE | Well-designed interface with 3 sub-namespaces                  |
| Tool filtering on Electron                                            | COMPLETE | 3 VS Code-only tools excluded from tools/list                  |
| Platform-aware system prompt                                          | COMPLETE | `buildPlatformSystemPrompt()` strips VS Code sections          |
| Electron DI registration (real lib, not shim)                         | COMPLETE | Shim deleted, real `registerVsCodeLmToolsServices` called      |
| Auto-allow approval_prompt on Electron                                | COMPLETE | Implemented with defensive fallback                            |
| WebviewManager made optional                                          | COMPLETE | `container.isRegistered()` pattern used                        |

### Implicit Requirements NOT Addressed:

1. Agent-facing indication that IDE features are unavailable (not just empty results)
2. Electron-native approval UI alternative (auto-allow is a placeholder, not a solution)
3. Test coverage for the new platform abstraction paths
4. Line number convention (0-indexed vs 1-indexed) in IDiagnosticsProvider contract

---

## Edge Case Analysis

| Edge Case                                                        | Handled | How                                                                      | Concern                          |
| ---------------------------------------------------------------- | ------- | ------------------------------------------------------------------------ | -------------------------------- |
| Null/undefined capabilities                                      | YES     | `resolveIDECapabilities()` returns undefined, `buildIDENamespace` checks | Clean                            |
| Electron calls filtered tools directly via `tools/call`          | YES     | Tool handlers execute against degradation stubs                          | Returns empty, not error         |
| Electron calls filtered tools via `execute_code`                 | PARTIAL | Stubs work but agent can't tell feature is unavailable                   | Silent degradation               |
| IDE capabilities throw during resolution                         | YES     | `resolveIDECapabilities()` catches and returns undefined                 | Good pattern                     |
| WebviewManager absent for approval_prompt                        | YES     | Auto-allows in both protocol-handlers.ts and approval-prompt.handler.ts  | Duplicated but safe              |
| `getConfiguration` returns null vs undefined                     | YES     | `?? 51820` handles both                                                  | Redundant but safe               |
| VscodeIDECapabilities method throws on VS Code                   | YES     | Re-throws with context message                                           | Inconsistent with Electron stubs |
| System prompt modification breaks filtering                      | NO      | String replacement with no validation                                    | Brittle                          |
| Multiple platforms calling `container.isRegistered` concurrently | N/A     | Registration is synchronous, `isRegistered` is read-only                 | No race                          |

---

## Integration Risk Assessment

| Integration                                     | Failure Probability | Impact                    | Mitigation                                      |
| ----------------------------------------------- | ------------------- | ------------------------- | ----------------------------------------------- |
| ElectronDiagnosticsProvider -> PtahAPIBuilder   | LOW                 | LOW (returns [])          | Registered in Phase 0 of Electron DI            |
| IDE_CAPABILITIES_TOKEN -> PtahAPIBuilder        | LOW                 | MODERATE (stubs vs crash) | Lazy resolution with try-catch                  |
| WebviewManager -> CodeExecutionMCP              | LOW                 | MODERATE (auto-allow)     | container.isRegistered() check                  |
| vscode-shim -> ide-capabilities.vscode.ts       | LOW                 | HIGH if instantiated      | Class never instantiated in Electron (verified) |
| PTAH_SYSTEM_PROMPT -> buildPlatformSystemPrompt | MEDIUM              | LOW (wrong prompt)        | String matching with no test coverage           |

---

## Per-File Verdict

### Batch 1 Files

| File                                                  | Verdict | Notes                                                                                                    |
| ----------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------- |
| `platform-core/.../diagnostics-provider.interface.ts` | PASS    | Clean interface, well-documented                                                                         |
| `platform-core/.../tokens.ts`                         | PASS    | Token added correctly with Symbol.for()                                                                  |
| `vscode-lm-tools/.../http-server.handler.ts`          | PASS    | Clean replacement of vscode.workspace.getConfiguration. Double-default is minor.                         |
| `vscode-lm-tools/.../code-execution-mcp.service.ts`   | WARNING | build() in constructor lacks error handling. hasIDECapabilities detection is correct but fragile timing. |

### Batch 2 Files

| File                                                     | Verdict | Notes                                                         |
| -------------------------------------------------------- | ------- | ------------------------------------------------------------- |
| `vscode-lm-tools/.../core-namespace.builders.ts`         | PASS    | Clean use of IDiagnosticsProvider                             |
| `vscode-lm-tools/.../ptah-api-builder.service.ts`        | PASS    | Lazy resolution pattern is correct, matches existing patterns |
| `platform-vscode/.../vscode-diagnostics-provider.ts`     | PASS    | Correct VS Code API usage, severity conversion is complete    |
| `platform-electron/.../electron-diagnostics-provider.ts` | PASS    | Minimal stub, documented future enhancement                   |

### Batch 3 Files

| File                                             | Verdict | Notes                                                             |
| ------------------------------------------------ | ------- | ----------------------------------------------------------------- |
| `vscode-lm-tools/.../ide-namespace.builder.ts`   | WARNING | IDE_NOT_AVAILABLE_MSG unused in stubs, stubs don't validate input |
| `vscode-lm-tools/.../ide-capabilities.vscode.ts` | PASS    | Well-structured, comprehensive error handling, input validation   |

### Batch 4 Files

| File                                                | Verdict | Notes                                                      |
| --------------------------------------------------- | ------- | ---------------------------------------------------------- |
| `vscode-lm-tools/.../code-execution-mcp.service.ts` | WARNING | See Batch 1 notes                                          |
| `vscode-lm-tools/.../protocol-handlers.ts`          | WARNING | hasIDECapabilities truthy-bias, duplicated auto-allow      |
| `vscode-lm-tools/.../approval-prompt.handler.ts`    | WARNING | Defensive auto-allow is good practice but duplicates logic |
| `apps/ptah-extension-vscode/.../container.ts`       | PASS    | IDE_CAPABILITIES_TOKEN registered correctly                |
| `apps/ptah-electron/.../container.ts`               | PASS    | Real library registered, shim removed. Detailed comments.  |

### Batch 5 Files

| File                                                 | Verdict | Notes                                                           |
| ---------------------------------------------------- | ------- | --------------------------------------------------------------- |
| `vscode-lm-tools/.../protocol-handlers.ts`           | WARNING | See above                                                       |
| `vscode-lm-tools/.../ptah-system-prompt.constant.ts` | WARNING | String replacement is brittle, no test coverage for correctness |

---

## Verdict

**Recommendation**: APPROVED
**Confidence**: MEDIUM-HIGH
**Top Risk**: Auto-allow approval prompt in Electron fundamentally changes the security model without an alternative consent mechanism.

The refactoring is architecturally sound and achieves its core goal: making the MCP server work on both VS Code and Electron with 81% tool coverage. The platform abstraction patterns (IDiagnosticsProvider, IIDECapabilities, optional WebviewManager) are well-designed and consistent with existing codebase patterns.

The critical issue (auto-allow) is an intentional design trade-off, not a bug, but it should be tracked for a proper Electron-native approval UI in a future task. The serious issues (truthy-bias in tool filtering, barrel export hazard, constructor error handling) are real risks but unlikely to cause production incidents in the current codebase state.

---

## What Robust Implementation Would Include

The current implementation is good for a refactoring task. A truly bulletproof version would add:

1. **Platform capability reporting**: A `ptah.platform.capabilities()` method that agents can call to discover what features are available, rather than relying on empty results.

2. **Electron-native approval dialog**: Use `electron.dialog.showMessageBox()` for high-risk operations instead of blanket auto-allow.

3. **Structured system prompt generation**: Build the prompt from a data structure (array of tool definitions with platform flags) rather than string manipulation of a large constant.

4. **Explicit opt-in tool filtering**: Change `hasIDECapabilities?: boolean` to `hasIDECapabilities: boolean` (required) with `=== true` check.

5. **Constructor resilience**: Defer `apiBuilder.build()` to first use with lazy initialization, or wrap in try-catch with degraded mode.

6. **Subpath exports**: Export `VscodeIDECapabilities` from `@ptah-extension/vscode-lm-tools/vscode` instead of the main barrel, preventing Electron from ever bundling the VS Code-specific code.

7. **Test coverage**: Unit tests for `buildPlatformSystemPrompt(false)` verifying that "(VS Code only)" does not appear in output, and integration tests for the Electron degradation paths.
