# Development Tasks - TASK_2025_145

**Total Tasks**: 15 | **Batches**: 5 | **Status**: 5/5 complete

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS

### Assumptions Verified

- `ProjectType`, `Framework`, `MonorepoType` enums confirmed in `libs/backend/workspace-intelligence/src/types/workspace.types.ts` - all lowercase string values (e.g., `'angular'`, `'nestjs'`, `'nx'`)
- `DeepProjectAnalysis` interface confirmed at `libs/backend/agent-generation/src/lib/types/analysis.types.ts` - requires `codeConventions: CodeConventions` (NOT optional)
- Existing `Result<T,E>` class in `libs/shared/src/lib/utils/result.ts` uses `isOk()`/`isErr()` method pattern, NOT `ok: boolean` property pattern
- `StrictMessageType` at line 149 of `message.types.ts` includes `| string` catch-all, but `setup-wizard:scan-progress` not in `MESSAGE_TYPES` constant
- `Options` interface in `claude-sdk.types.ts` does NOT contain `compactionControl` or `allowDangerouslySkipPermissions` as known fields -- `as SdkOptions` cast hides this
- `PTAH_MCP_PORT = 51820` hardcoded, but `CodeExecutionMCP.getPort()` returns dynamic port from `this.port`
- `AgentResponseSchema` and `ProjectAnalysisSchema` are nearly identical Zod schemas in separate files

### Risks Identified

| Risk                                                                                     | Severity | Mitigation                                                   |
| ---------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------ |
| LLM returns capitalized project types ("Angular") but enum expects lowercase ("angular") | HIGH     | Task 1.1: normalizeAgentOutput with case-insensitive mapping |
| codeConventions is optional in Zod but required in DeepProjectAnalysis                   | HIGH     | Task 1.2: Add defaults in Zod schema                         |
| Two copies of Zod schema will drift over time                                            | MEDIUM   | Task 1.3: Extract shared schema                              |
| `compactionControl` not in SDK Options type - cast hides invalid fields                  | HIGH     | Task 2.1: Remove `as SdkOptions` cast                        |
| Phase markers split across stream chunks                                                 | MEDIUM   | Task 3.1: Match against fullText with cursor                 |
| Cancel button doesn't abort backend query                                                | MEDIUM   | Task 4.3: Add cancellation RPC                               |

### Edge Cases to Handle

- [x] LLM returns `"Node.js"` instead of `"node"` for projectType --> normalization handles
- [x] LLM omits `codeConventions` entirely --> Zod defaults fill in
- [x] LLM returns `"NestJS"` instead of `"nestjs"` for frameworks --> case-insensitive mapping
- [x] Agent produces multiple JSON blocks --> match last block
- [x] `[PHASE:disc` + `overy]` split across chunks --> use fullText
- [x] MCP port changes at runtime --> pass from config instead of hardcoding
- [x] User cancels scan but backend keeps running --> abort RPC

---

## Batch 1: Zod Schema Alignment + Normalization Layer [COMPLETE]

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: None
**Issues Addressed**: CRITICAL-1, SERIOUS-1, SERIOUS-7
**Commit**: 57e0386

### Task 1.1: Add normalizeAgentOutput transformation function [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\agentic-analysis.service.ts`
**Spec Reference**: review-report.md CRITICAL-1
**Pattern to Follow**: Enum mapping from `libs/backend/workspace-intelligence/src/types/workspace.types.ts`

**Quality Requirements**:

- Case-insensitive mapping from LLM string to ProjectType enum value
- Case-insensitive mapping from LLM strings to Framework[] enum values
- Case-insensitive mapping from LLM string to MonorepoType enum value
- Sensible defaults for required fields the LLM may omit
- Remove the `as unknown as DeepProjectAnalysis` double-cast at line 574
- Use the normalizer's output to produce a properly typed `DeepProjectAnalysis`

**Validation Notes**:

- ProjectType enum values are all lowercase: 'node', 'react', 'angular', etc.
- But LLM prompt says `"Angular"`, `"React"`, `"Node.js"` (capitalized, sometimes with dots)
- Must handle: "Node.js" -> ProjectType.Node, "Angular" -> ProjectType.Angular, etc.
- Must handle unknown/unmappable values by falling back to ProjectType.General or ProjectType.Unknown
- Framework values: 'nestjs', 'express', 'angular', etc. (all lowercase)
- MonorepoType values: 'nx', 'lerna', 'turborepo', etc. (all lowercase)

**Implementation Details**:

- Import `ProjectType`, `Framework`, `MonorepoType` from `@ptah-extension/workspace-intelligence`
- Create `normalizeAgentOutput(zodData: z.infer<typeof AgentResponseSchema>): DeepProjectAnalysis`
- Build lookup maps: `Object.values(ProjectType)` -> case-insensitive map
- Replace the cast at line 574 with: `return ok(normalizeAgentOutput(validation.data))`
- Handle edge case: "Node.js" -> strip non-alphanumeric -> "nodejs" -> "node" close match

---

### Task 1.2: Fix codeConventions to be required with defaults in Zod schema [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\agentic-analysis.service.ts`
**Spec Reference**: review-report.md SERIOUS-1
**Dependencies**: None (can be done in parallel with Task 1.1)

**Quality Requirements**:

- Change `codeConventions` from `.optional()` to `.default({...})` with sensible defaults
- Defaults: `indentation: 'spaces', indentSize: 2, quoteStyle: 'single', semicolons: true`
- Ensure the Zod output shape matches `CodeConventions` interface from `@ptah-extension/shared`

**Validation Notes**:

- `DeepProjectAnalysis.codeConventions` is typed as `CodeConventions` (NOT optional) at line 171 of `analysis.types.ts`
- If Zod marks it optional and agent omits it, downstream consumers crash on `.codeConventions.indentation`
- The `.default()` must include all REQUIRED fields of the inner schema (indentation, indentSize, quoteStyle, semicolons)

**Implementation Details**:

- At line 135-158, change `.optional()` to `.default({ indentation: 'spaces', indentSize: 2, quoteStyle: 'single', semicolons: true })`
- The nested optional fields (namingConventions, maxLineLength, etc.) remain optional

---

### Task 1.3: Extract shared Zod schema to eliminate duplication [COMPLETE]

**File (create)**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\analysis-schema.ts`
**File (modify)**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\agentic-analysis.service.ts`
**File (modify)**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\setup-rpc.handlers.ts`
**Spec Reference**: review-report.md SERIOUS-7
**Dependencies**: Task 1.2 (schema must have fixed defaults before extraction)

**Quality Requirements**:

- Extract `AgentResponseSchema` into a new file as `ProjectAnalysisZodSchema`
- Import from both `agentic-analysis.service.ts` and `setup-rpc.handlers.ts`
- Delete the duplicate `ProjectAnalysisSchema` from `setup-rpc.handlers.ts`
- Export the schema from the wizard barrel file (`index.ts`)
- Add the schema to the agent-generation library's `src/index.ts` public API

**Validation Notes**:

- The two schemas are nearly identical (compare lines 67-180 in agentic-analysis vs lines 43-171 in setup-rpc.handlers)
- After Task 1.2, codeConventions will have defaults -- the extracted schema should include those
- Both consumers cast the validated result to DeepProjectAnalysis -- the normalization from Task 1.1 should be available to both

**Implementation Details**:

- Create `analysis-schema.ts` exporting `ProjectAnalysisZodSchema`
- Also export the `normalizeAgentOutput` function (from Task 1.1) so setup-rpc.handlers can use it
- In agentic-analysis.service.ts: `import { ProjectAnalysisZodSchema, normalizeAgentOutput } from './analysis-schema'`
- In setup-rpc.handlers.ts: `import { ProjectAnalysisZodSchema, normalizeAgentOutput } from '@ptah-extension/agent-generation'`
- Remove the `as unknown as DeepProjectAnalysis` cast in setup-rpc.handlers.ts line 587 as well
- Update `libs/backend/agent-generation/src/lib/services/wizard/index.ts` with new exports
- Update `libs/backend/agent-generation/src/index.ts` to re-export

---

**Batch 1 Verification**:

- All files exist at paths
- `ProjectAnalysisZodSchema` imported in both consumers
- No `as unknown as DeepProjectAnalysis` casts remain
- `codeConventions` has `.default()` not `.optional()`
- Build passes: `npx nx build agent-generation`
- Build passes: `npx nx build ptah-extension-vscode`
- code-logic-reviewer approved

---

## Batch 2: Remove SdkOptions Type Assertion [COMPLETE]

**Developer**: backend-developer
**Tasks**: 1 | **Dependencies**: None (independent of Batch 1)
**Issues Addressed**: CRITICAL-2, MINOR-4
**Commit**: 48d83fa

### Task 2.1: Remove `as SdkOptions` cast and fix type naturally [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\internal-query\internal-query.service.ts`
**Spec Reference**: review-report.md CRITICAL-2
**Pattern to Follow**: `libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts` Options interface (line 1520-1618)

**Quality Requirements**:

- Remove `as SdkOptions` cast at line 266
- Change return type of `buildOptions()` to return `Partial<SdkOptions>` or a custom type that extends Options
- For fields NOT in `Options` interface (`compactionControl`, `allowDangerouslySkipPermissions`): check if they actually exist in the SDK Options type (line 1520-1618) and handle accordingly
- `allowDangerouslySkipPermissions` IS in the Options interface (line 1585) - confirmed
- `compactionControl` is NOT in the Options interface - should be removed or handled via extra args

**Validation Notes**:

- The `Options` interface is at lines 1520-1618 in `claude-sdk.types.ts`
- Valid fields in the return object: `abortController`, `cwd`, `model`, `systemPrompt`, `tools`, `mcpServers`, `permissionMode`, `allowDangerouslySkipPermissions`, `maxTurns`, `includePartialMessages`, `persistSession`, `env`, `settingSources`, `stderr`, `hooks`
- `compactionControl` is NOT a valid Options field -- needs to be handled (either remove it or check if it's actually used by the SDK at runtime despite missing from types)
- The `settingSources` field IS valid (line 1597)

**Implementation Details**:

- Change `buildOptions` return type from `Promise<SdkOptions>` to `Promise<Options>` (use the same import)
- Remove `as SdkOptions` at the end of the return object (line 266)
- For `compactionControl`: Comment it out or move to `extraArgs` if the SDK supports it there, otherwise remove. Add a TODO noting this should be checked when SDK types are updated
- TypeScript compiler will now catch any mismatches
- Also fix MINOR-4 while here: remove redundant `as Record<string, string | undefined>` from `env: process.env` (line 246)

---

**Batch 2 Verification**:

- No `as SdkOptions` cast in internal-query.service.ts
- Return type of `buildOptions()` satisfies `Options` naturally
- `compactionControl` handled (removed or properly typed)
- `env: process.env` has no redundant cast
- Build passes: `npx nx build agent-sdk`
- code-logic-reviewer approved

---

## Batch 3: Fix Stream Chunk Handling [COMPLETE]

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: None (independent of Batches 1-2)
**Issues Addressed**: SERIOUS-2, SERIOUS-3
**Commit**: c2de068

### Task 3.1: Fix phase marker extraction to use accumulated fullText [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\agentic-analysis.service.ts`
**Spec Reference**: review-report.md SERIOUS-2
**Pattern to Follow**: N/A (stream processing logic)

**Quality Requirements**:

- Run phase marker regex against `fullText` (accumulated), NOT individual `text` chunks
- Use a position cursor (e.g., `lastPhaseCheckPos`) to avoid re-processing already-matched markers
- Same fix for detection markers `[DETECTED:...]` -- use fullText with cursor
- Preserve existing behavior: broadcast progress updates when phases change

**Validation Notes**:

- Current code at line 454: `const phaseMatch = text.match(/\[PHASE:(\w+)\]/);` uses chunk `text`
- `[PHASE:discovery]` could be split as `[PHASE:disc` + `overy]` in streaming
- Same issue at line 472 for `[DETECTED:...]` markers
- fullText is accumulated at line 451: `fullText += text;`

**Implementation Details**:

- Add `let lastPhaseCheckPos = 0;` and `let lastDetectionCheckPos = 0;` before the for-await loop
- After `fullText += text;` (line 451):
  - Extract phase: `const phaseMatch = fullText.substring(lastPhaseCheckPos).match(/\[PHASE:(\w+)\]/);`
  - If matched, update `lastPhaseCheckPos = fullText.indexOf(phaseMatch[0], lastPhaseCheckPos) + phaseMatch[0].length;`
  - Extract detections: Use `fullText.substring(lastDetectionCheckPos).matchAll(...)` and update cursor similarly
- Keep the broadcast logic unchanged

---

### Task 3.2: Fix JSON parsing to use last code block instead of first [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\agentic-analysis.service.ts`
**Spec Reference**: review-report.md SERIOUS-3
**Dependencies**: None

**Quality Requirements**:

- Use `matchAll()` with the `g` flag and take the LAST match
- Apply to both ` ```json ` blocks and generic ` ``` ` blocks
- Fallback (brace-based) parsing already uses `lastIndexOf` so it's correct

**Validation Notes**:

- Current code at line 539: lazy regex matches FIRST block
- Agent may produce intermediate reasoning JSON followed by the final answer JSON
- Only the last JSON block should be parsed as the analysis result

**Implementation Details**:

- Line 539: Replace `fullText.match(...)` with:
  ````typescript
  const jsonMatches = [...fullText.matchAll(/```json\s*\n([\s\S]*?)\n```/g)];
  const jsonBlockMatch = jsonMatches.length > 0 ? jsonMatches[jsonMatches.length - 1] : null;
  ````
- Line 545: Same for generic code blocks:
  ````typescript
  const codeMatches = [...fullText.matchAll(/```\s*\n([\s\S]*?)\n```/g)];
  const codeBlockMatch = codeMatches.length > 0 ? codeMatches[codeMatches.length - 1] : null;
  ````

---

**Batch 3 Verification**:

- Phase markers extracted from fullText with cursor
- Detection markers extracted from fullText with cursor
- JSON parsing uses last code block
- Build passes: `npx nx build agent-generation`
- code-logic-reviewer approved

---

## Batch 4: Result Type + MCP Port + Cancellation [COMPLETE]

**Developer**: backend-developer
**Tasks**: 3 | **Dependencies**: Batch 1 (normalizeAgentOutput export needed for setup-rpc.handlers changes)
**Issues Addressed**: SERIOUS-4, SERIOUS-5, SERIOUS-6
**Commit**: 142c1e4

### Task 4.1: Align Result type with existing codebase pattern [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\agentic-analysis.service.ts`
**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\setup-rpc.handlers.ts`
**Spec Reference**: review-report.md SERIOUS-4
**Pattern to Follow**: `libs/shared/src/lib/utils/result.ts` -- class-based Result with `isOk()`/`isErr()` methods

**Quality Requirements**:

- Replace the local `type Result<T, E>` / `ok()` / `err()` pattern with the existing `Result` class from `@ptah-extension/shared`
- Update `analyzeWorkspace()` and `processStream()` return types
- Update `validateJson()` and `parseAnalysisResponse()` return types
- Update `setup-rpc.handlers.ts` to check `agenticResult.isOk()` instead of `agenticResult.ok`

**Validation Notes**:

- Existing pattern: `Result.ok(value)` and `Result.err(error)` (static factory methods)
- Existing checks: `result.isOk()` / `result.isErr()` (methods, not properties)
- Access: `result.value` / `result.error` (getters)
- Import: `import { Result } from '@ptah-extension/shared'`
- In setup-rpc.handlers.ts line 437: `agenticResult.ok` needs to become `agenticResult.isOk()`

**Implementation Details**:

- Remove the local `type Result<T, E>`, `function ok()`, `function err()` (lines 53-61)
- Add `import { Result } from '@ptah-extension/shared';`
- Replace all `ok(value)` with `Result.ok(value)`
- Replace all `err(error)` with `Result.err(error)`
- Update return types: `Result<DeepProjectAnalysis, Error>` stays the same syntactically but now refers to the class
- In setup-rpc.handlers.ts: change `agenticResult.ok && agenticResult.value` to `agenticResult.isOk() && agenticResult.value`

---

### Task 4.2: Pass MCP port through config instead of hardcoding [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\internal-query\internal-query.service.ts`
**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\internal-query\internal-query.types.ts`
**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\setup-rpc.handlers.ts`
**Spec Reference**: review-report.md SERIOUS-5

**Quality Requirements**:

- Add optional `mcpPort?: number` field to `InternalQueryConfig`
- Use `config.mcpPort` in `buildMcpServers()` instead of `PTAH_MCP_PORT` constant
- Keep `PTAH_MCP_PORT = 51820` as the default fallback value
- Pass the actual port from `codeExecutionMcp.getPort()` in setup-rpc.handlers.ts

**Validation Notes**:

- `CodeExecutionMCP.getPort()` returns `number | null`
- setup-rpc.handlers.ts already calls `codeExecutionMcp.getPort()` at line 400
- Currently only checks if port is non-null, doesn't pass the value
- The `analyzeWorkspace()` options don't include mcpPort currently

**Implementation Details**:

- In `internal-query.types.ts`: Add `mcpPort?: number;` to `InternalQueryConfig`
- In `internal-query.service.ts`:
  - In `buildMcpServers()`: Use `const port = config.mcpPort ?? PTAH_MCP_PORT;`
  - But `buildMcpServers` doesn't have access to config -- need to pass port parameter
  - Change signature: `buildMcpServers(isPremium, mcpServerRunning, mcpPort?)`
  - In `buildOptions()`: call `this.buildMcpServers(config.isPremium, config.mcpServerRunning, config.mcpPort)`
- In `agentic-analysis.service.ts`: Add `mcpPort` to the options passed to `internalQueryService.execute()`
- In `setup-rpc.handlers.ts`:
  - Store the port: `const mcpPort = codeExecutionMcp.getPort();`
  - `mcpServerRunning = mcpPort !== null;`
  - Pass to `analyzeWorkspace()`: `{ isPremium, mcpServerRunning, mcpPort: mcpPort ?? undefined }`
- In `agentic-analysis.service.ts`: Add `mcpPort?: number` to the options parameter and forward it

---

### Task 4.3: Add cancellation RPC for wizard analysis [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\agentic-analysis.service.ts`
**File**: `D:\projects\ptah-extension\apps\ptah-extension-vscode\src\services\rpc\handlers\setup-rpc.handlers.ts`
**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.ts`
**File**: `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\services\wizard-rpc.service.ts`
**Spec Reference**: review-report.md SERIOUS-6

**Quality Requirements**:

- Store the AbortController in the service so it can be triggered externally
- Add a `cancelAnalysis()` method to `AgenticAnalysisService`
- Register a `wizard:cancel-analysis` RPC method in setup-rpc.handlers.ts
- Add `cancelAnalysis()` to `WizardRpcService` on the frontend
- Call the cancel RPC from `onConfirmCancellation()` in scan-progress.component.ts

**Validation Notes**:

- Current AbortController is local to `analyzeWorkspace()` -- not accessible externally
- Cancellation currently only resets frontend state via `wizardState.reset()` (line 379)
- SDK query can run up to 90 seconds after "cancel" is clicked
- Need to handle race condition: cancel arrives after analysis completes

**Implementation Details**:

- In `agentic-analysis.service.ts`:
  - Add `private activeAbortController: AbortController | null = null;`
  - In `analyzeWorkspace()`: `this.activeAbortController = abortController;` and clear on completion
  - Add `cancelAnalysis(): void { this.activeAbortController?.abort(); this.activeAbortController = null; }`
- In `setup-rpc.handlers.ts`:
  - Register `wizard:cancel-analysis` RPC method that resolves AgenticAnalysisService and calls `cancelAnalysis()`
- In `wizard-rpc.service.ts`:
  - Add `async cancelAnalysis(): Promise<void>` that calls `this.rpc.callExtension('wizard:cancel-analysis')`
- In `scan-progress.component.ts`:
  - In `onConfirmCancellation()`: call `this.wizardRpc.cancelAnalysis()` before `this.wizardState.reset()`

---

**Batch 4 Verification**:

- No local Result type in agentic-analysis.service.ts
- Result import from @ptah-extension/shared
- setup-rpc.handlers.ts uses `isOk()` not `.ok`
- PTAH_MCP_PORT used only as default fallback
- `wizard:cancel-analysis` RPC method registered
- Frontend cancel button triggers backend abort
- Build passes for all affected projects
- code-logic-reviewer approved

---

## Batch 5: Minor Fixes [COMPLETE]

**Developer**: backend-developer
**Tasks**: 6 | **Dependencies**: Batch 2 (MINOR-4 already addressed there), Batch 1 (MINOR-2 needs the service)
**Issues Addressed**: MINOR-1, MINOR-2, MINOR-3, MINOR-4, MINOR-5, MINOR-6
**Commit**: 9c3716c

### Task 5.1: Log errors in empty catch block instead of swallowing [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\internal-query\internal-query.service.ts`
**Spec Reference**: review-report.md MINOR-1

**Quality Requirements**:

- Replace empty catch block at line 165 with debug-level logging

**Implementation Details**:

- Change `catch { /* Already closed */ }` to `catch (e) { this.logger.debug(\`${SERVICE_TAG} Failed to close conversation\`, { error: e instanceof Error ? e.message : String(e) }); }`

---

### Task 5.2: Register setup-wizard:scan-progress in MESSAGE_TYPES [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\shared\src\lib\types\message.types.ts`
**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\agentic-analysis.service.ts`
**Spec Reference**: review-report.md MINOR-2

**Quality Requirements**:

- Add `SETUP_WIZARD_SCAN_PROGRESS: 'setup-wizard:scan-progress'` to `MESSAGE_TYPES` constant
- Add `| 'setup-wizard:scan-progress'` to the `StrictMessageType` union (before the `| string` catch-all)
- Remove the `as Parameters<typeof this.webviewManager.broadcastMessage>[0]` cast in agentic-analysis.service.ts

**Validation Notes**:

- `StrictMessageType` already has `| string` catch-all at line 149, so the cast was always unnecessary
- But registering properly enables discoverability and documentation
- The MESSAGE_TYPES constant has a "Setup Wizard Messages" section at line 311

**Implementation Details**:

- In message.types.ts: Add to StrictMessageType union (near line 148, before `| string`)
- In message.types.ts: Add to MESSAGE_TYPES constant (near line 313)
- In agentic-analysis.service.ts: Remove the `as Parameters<...>[0]` cast from `broadcastMessage` call

---

### Task 5.3: Add note about process.env access pattern [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\internal-query\internal-query.service.ts`
**Spec Reference**: review-report.md MINOR-3

**Quality Requirements**:

- Add a JSDoc comment acknowledging the direct `process.env` access pattern
- Note that this follows the same pattern as `SdkQueryOptionsBuilder` (pre-existing concern)
- Do NOT refactor the pattern (out of scope -- existing tech debt, not new)

**Implementation Details**:

- Add comment to `buildIdentityPrompt()` method (line 341): `// Note: Direct process.env access follows the same pattern as SdkQueryOptionsBuilder. Centralizing env access into DI is tracked as future tech debt.`

---

### Task 5.4: Remove redundant process.env type cast [SKIPPED]

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\internal-query\internal-query.service.ts`
**Spec Reference**: review-report.md MINOR-4

**Quality Requirements**:

- Remove `as Record<string, string | undefined>` from `env: process.env` at line 246
- `process.env` is already typed as `NodeJS.ProcessEnv` which satisfies `Record<string, string | undefined>`

**Validation Notes**:

- NOTE: If this was already addressed in Batch 2 (Task 2.1), skip this task

**Implementation Details**:

- Change `env: process.env as Record<string, string | undefined>` to `env: process.env`

---

### Task 5.5: Fix inconsistent import type style [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\agentic-analysis.service.ts`
**Spec Reference**: review-report.md MINOR-5

**Quality Requirements**:

- Use consistent import-level `import type { ... }` style (the dominant convention: 12 occurrences vs 1)
- NOT the inline `import { type ... }` style

**Implementation Details**:

- Line 26: Change `import { type AnalysisPhase } from '@ptah-extension/shared';` to `import type { AnalysisPhase } from '@ptah-extension/shared';`
- Note: `scan-progress.component.ts` line 11 already uses the correct `import type { AnalysisPhase }` style

---

### Task 5.6: Generate transient sessionId for compaction hooks [COMPLETE]

**File**: `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\internal-query\internal-query.service.ts`
**Spec Reference**: review-report.md MINOR-6

**Quality Requirements**:

- Replace empty string `''` with a descriptive transient session ID
- Format: `internal-query-${Date.now()}`

**Implementation Details**:

- Line 417: Change `this.compactionHookHandler.createHooks('')` to `this.compactionHookHandler.createHooks(\`internal-query-${Date.now()}\`)`

---

**Batch 5 Verification**:

- No empty catch blocks
- `setup-wizard:scan-progress` in MESSAGE_TYPES and StrictMessageType
- No `as Parameters<...>` cast in broadcastMessage call
- process.env comment added to buildIdentityPrompt
- No redundant type cast on process.env
- Consistent `import type { ... }` style
- Compaction hooks use descriptive sessionId
- Build passes for all affected projects
- code-logic-reviewer approved

---

## QA Fix Round [COMPLETE]

**Developer**: backend-developer
**Issues Fixed**: 11 (2 SERIOUS, 3 MODERATE, 6 MINOR)
**Commit**: ae3f048

### Files Created

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\analysis-schema.spec.ts` (NEW - 35 unit tests)

### Files Modified

- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\agentic-analysis.service.ts`
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\lib\services\wizard\analysis-schema.ts`
- `D:\projects\ptah-extension\libs\backend\agent-generation\src\index.ts`
- `D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\internal-query\internal-query.service.ts`
- `D:\projects\ptah-extension\libs\frontend\setup-wizard\src\lib\components\scan-progress.component.ts`

### Issues Resolved

1. SERIOUS: Race condition in AbortController finally block guarded
2. SERIOUS: 35 unit tests added for normalizeAgentOutput() and ProjectAnalysisZodSchema
3. MODERATE: trailingComma triple-default consolidated to single .default('es5')
4. MODERATE: Debug logging when enum normalization falls back to defaults
5. MODERATE: MESSAGE_TYPES.SETUP_WIZARD_SCAN_PROGRESS constant used
6. MINOR: Duplicate exports removed from src/index.ts
7. MINOR: Detection cursor set to end of last match after loop
8. MINOR: Comment on dead fileCount/languages Zod fields
9. MINOR: void operator on fire-and-forget cancelAnalysis()
10. MINOR: Renamed Options as SdkQueryOptions
11. MINOR: Removed redundant as const assertions
