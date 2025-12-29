# Implementation Plan - TASK_2025_095: Tool Type System Migration

## Codebase Investigation Summary

### New Type System (VERIFIED)

**Location**: `libs/shared/src/lib/type-guards/tool-input-guards.ts`

**Verified Tool Input Types** (lines 34-324):

- `ReadToolInput`, `WriteToolInput`, `EditToolInput`, `BashToolInput`, `BashOutputToolInput`
- `GrepToolInput`, `GlobToolInput`, `TaskToolInput`, `TaskOutputToolInput`, `KillShellToolInput`
- `WebFetchToolInput`, `WebSearchToolInput`, `TodoWriteToolInput`, `AskUserQuestionToolInput`
- `NotebookEditToolInput`, `ExitPlanModeToolInput`, `ListMcpResourcesToolInput`, `ReadMcpResourceToolInput`, `LSPToolInput`

**Verified Tool Output Types** (lines 330-641):

- `TaskToolOutput`, `BashToolOutput`, `EditToolOutput`, `WriteToolOutput`, `GlobToolOutput`
- `GrepToolOutput` (union: `GrepContentOutput | GrepFilesOutput | GrepCountOutput`)
- `TodoWriteToolOutput`, `WebFetchToolOutput`, `WebSearchToolOutput`, etc.

**Verified Type Guards** (lines 646-1012):

- `isReadToolInput()`, `isWriteToolInput()`, `isBashToolInput()`, `isEditToolInput()`
- `isGrepToolInput()`, `isGlobToolInput()`, `isTaskToolInput()`, `isTodoWriteToolInput()`
- `isWebFetchToolInput()`, `isWebSearchToolInput()`, `isNotebookEditToolInput()`
- Output guards: `isTaskToolOutput()`, `isBashToolOutput()`, `isGrepContentOutput()`, etc.

**Verified Utility Types** (lines 1107-1175):

- `ToolInput` - Union of all tool input types
- `ToolOutput` - Union of all tool output types
- `ToolInputMap`, `ToolOutputMap` - Maps for type-safe lookup by tool name
- `GetToolInput<T>`, `GetToolOutput<T>` - Utility types for conditional typing

---

## File Analysis & Migration Categorization

### CATEGORY A: FILES TO MIGRATE (High Value)

#### 1. `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts`

**Evidence**: Lines 34, 49, 190, 271, 413, 424, 436, 471
**Current Pattern**: Uses `Record<string, unknown>` with bracket notation access
**Migration Value**: HIGH - Permission handler accesses specific tool input properties

**Patterns Found**:

```typescript
// Line 34: Interface uses generic Record
toolInput: Record<string, unknown>;

// Lines 487-518: Uses bracket notation with string literal keys
const command = input['command'];
const filePath = input['file_path'];
const pattern = input['pattern'];
const notebookPath = input['notebook_path'];
```

**Migration Approach**:

- Keep `Record<string, unknown>` in interfaces (intentionally generic for cross-tool handling)
- Use type guards in `generateDescription()` method for type-safe property access
- Replace bracket notation with type-narrowed access after guard checks

**Example Migration**:

```typescript
// Before
switch (toolName) {
  case 'Bash': {
    const command = input['command'];
    if (command && typeof command === 'string') { ... }
  }
}

// After
switch (toolName) {
  case 'Bash': {
    if (isBashToolInput(input)) {
      const command = input.command; // Type-safe!
      if (command) { ... }
    }
  }
}
```

---

#### 2. `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts`

**Evidence**: Lines 83, 1086, 1108
**Current Pattern**: Local `ContentBlock` interface with `Record<string, unknown>`
**Migration Value**: MEDIUM - History reader processes JSONL files with tool blocks

**Patterns Found**:

```typescript
// Lines 77-88: Local ContentBlock interface
interface ContentBlock {
  type: string;
  text?: string;
  // ...
  input?: Record<string, unknown>; // Tool input
}

// Lines 907-918: Task tool extraction with bracket notation
if (block.type === 'tool_use' && block.name === 'Task' && block.id) {
  tasks.push({
    subagentType: (block.input?.['subagent_type'] as string) || 'unknown',
  });
}
```

**Migration Approach**:

- Local `ContentBlock` interface is correct for JSONL parsing (matches raw file format)
- Add type guard checks when accessing specific tool properties
- Use `isTaskToolInput()` for Task tool block processing

**Risk**: LOW - Local types for JSONL parsing should remain, only access patterns change

---

#### 3. `libs/backend/vscode-lm-tools/src/lib/permission/permission-prompt.service.ts`

**Evidence**: Lines 72, 114, 120, 333
**Current Pattern**: Uses `Record<string, unknown>` for generic tool input handling
**Migration Value**: MEDIUM - Permission prompts show tool-specific descriptions

**Patterns Found**:

```typescript
// Line 72-73: Method accepts generic tool input
checkRules(toolName: string, toolInput: Record<string, unknown>): 'allow' | 'deny' | 'ask'

// Lines 336-354: Tool-specific property access with bracket notation
switch (toolName) {
  case 'Bash':
    return `Execute bash command: ${toolInput['command'] ?? 'unknown'}`;
  case 'Write':
    return `Write file: ${toolInput['file_path'] ?? 'unknown'}`;
}
```

**Migration Approach**:

- Keep `Record<string, unknown>` in method signatures (intentionally generic)
- Use type guards inside switch cases for type-safe property access
- Same pattern as sdk-permission-handler.ts

---

### CATEGORY B: FILES TO SKIP (Intentionally Generic)

#### 1. `libs/shared/src/lib/types/execution-node.types.ts`

**Evidence**: Lines 106, 401, 432, 786
**Current Pattern**: `toolInput?: Record<string, unknown>`
**Reason to SKIP**: ExecutionNode is a runtime data structure that stores tool input from ANY tool type. It MUST remain generic to support all current and future tools.

**Rationale**:

- ExecutionNode.toolInput can contain ReadToolInput OR WriteToolInput OR BashToolInput, etc.
- Changing to union type would require updating EVERY place that creates ExecutionNode
- Type narrowing happens at USAGE site, not at storage site
- Pattern: Store generic, narrow on access

---

#### 2. `libs/shared/src/lib/types/permission.types.ts`

**Evidence**: Line 26
**Current Pattern**: `readonly toolInput: Readonly<Record<string, unknown>>`
**Reason to SKIP**: PermissionRequest represents cross-tool permission requests. Same rationale as ExecutionNode.

---

#### 3. `libs/shared/src/lib/types/claude-domain.types.ts`

**Evidence**: Lines 19, 220
**Current Pattern**: `args: Record<string, unknown>` and `toolInput: Record<string, unknown>`
**Reason to SKIP**:

- `ClaudeToolEventStart.args` - Event bus payload for ANY tool type
- `ClaudeAgentActivityEvent.toolInput` - Agent activity tracking for ANY tool
- Both are intentionally generic for cross-tool communication

---

#### 4. `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts`

**Evidence**: Lines 573-594
**Current Pattern**: Uses bracket notation with `'in'` checks for Task tool input
**Reason to SKIP**: Already uses safe property access patterns with type narrowing:

```typescript
// Already correct pattern (lines 580-594)
if (isTaskTool && block.input) {
  agentType = 'subagent_type' in block.input && typeof block.input['subagent_type'] === 'string' ? block.input['subagent_type'] : undefined;
}
```

**Note**: Could be migrated to use `isTaskToolInput()` for cleaner code, but current pattern is type-safe.

---

### CATEGORY C: EXCLUSIONS (Test Files / SDK Bridging)

#### Test Files (`.spec.ts`)

All `as unknown as` casts in test files are for MOCKING purposes:

- `token-counter.service.spec.ts` - Mocking vscode.LanguageModelChat
- `workspace-indexer.service.spec.ts` - Mocking FileSystemService, Jest mocks
- `agent-selection.service.spec.ts` - Mocking ITemplateStorageService
- etc.

**Reason to SKIP**: Test mocking patterns are intentional and necessary.

#### SDK Bridging (`sdk-agent-adapter.ts`)

Lines 681, 798: `sdkQuery as unknown as AsyncIterable<SDKMessage>`
**Reason to SKIP**: Necessary for bridging between SDK types and internal types.

---

## Architecture Design

### Migration Pattern

**Chosen Approach**: Type Guard Narrowing at Access Sites
**Rationale**:

1. Generic storage types (`Record<string, unknown>`) remain for flexibility
2. Type guards narrow to specific types when accessing properties
3. No breaking changes to interfaces
4. Gradual migration possible

### Component Specifications

#### Component 1: SdkPermissionHandler Type-Safe Property Access

**Purpose**: Replace bracket notation with type-guarded access in `generateDescription()`
**Pattern**: Type guard switch-case pattern (verified from tool-input-guards.ts)

**Implementation Pattern**:

```typescript
import {
  isBashToolInput,
  isWriteToolInput,
  isEditToolInput,
  isReadToolInput,
  isGrepToolInput,
  isGlobToolInput,
  isNotebookEditToolInput
} from '@ptah-extension/shared';

private generateDescription(
  toolName: string,
  input: Record<string, unknown>
): string {
  // MCP tools (no specific type guard needed)
  if (isMcpTool(toolName)) { ... }

  switch (toolName) {
    case 'Bash': {
      if (isBashToolInput(input)) {
        const truncated = input.command.length > 100
          ? `${input.command.substring(0, 100)}...`
          : input.command;
        return `Execute bash command: ${truncated}`;
      }
      return 'Execute a bash command';
    }
    // ... similar for other tools
  }
}
```

**Files Affected**:

- `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts` (MODIFY)

**Quality Requirements**:

- All tool-specific property access uses type guards
- No `as string` casts remain
- Fallback strings for unrecognized inputs

---

#### Component 2: SessionHistoryReaderService Type-Safe Task Tool Access

**Purpose**: Replace bracket notation for Task tool input properties
**Pattern**: Use `isTaskToolInput()` for subagent_type, description, prompt access

**Implementation Pattern**:

```typescript
import { isTaskToolInput } from '@ptah-extension/shared';

// In extractTaskToolUses()
for (const block of content as ContentBlock[]) {
  if (block.type === 'tool_use' && block.name === 'Task' && block.id) {
    let subagentType = 'unknown';
    if (block.input && isTaskToolInput(block.input)) {
      subagentType = block.input.subagent_type;
    }
    tasks.push({
      toolUseId: block.id,
      timestamp,
      subagentType,
    });
  }
}
```

**Files Affected**:

- `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts` (MODIFY)

**Quality Requirements**:

- Task tool input access uses `isTaskToolInput()` guard
- Graceful fallback for malformed inputs

---

#### Component 3: PermissionPromptService Type-Safe Description Builder

**Purpose**: Same pattern as SdkPermissionHandler for `buildDescription()`
**Pattern**: Type guard switch-case

**Files Affected**:

- `libs/backend/vscode-lm-tools/src/lib/permission/permission-prompt.service.ts` (MODIFY)

---

### Integration Architecture

#### Import Dependencies

All files will import type guards from the shared library:

```typescript
import { isBashToolInput, isWriteToolInput, isEditToolInput, isReadToolInput, isGrepToolInput, isGlobToolInput, isNotebookEditToolInput, isTaskToolInput } from '@ptah-extension/shared';
```

**Verification**: Exports confirmed at `libs/shared/src/lib/type-guards/tool-input-guards.ts` and re-exported via `libs/shared/src/index.ts`

---

## Quality Requirements

### Functional Requirements

- All migrated files compile without TypeScript errors
- No runtime behavior changes (guards return same boolean as manual checks)
- Fallback handling for unrecognized tool inputs preserved

### Non-Functional Requirements

- **Type Safety**: Eliminate bracket notation with string literal keys
- **Maintainability**: Centralized type definitions in shared library
- **Performance**: Type guards are simple object property checks (negligible overhead)

### Pattern Compliance

- Use type guards from `@ptah-extension/shared` (verified exports)
- Follow switch-case pattern for tool-specific handling
- Maintain generic `Record<string, unknown>` in cross-tool interfaces

---

## Team-Leader Handoff

### Developer Type Recommendation

**Recommended Developer**: backend-developer

**Rationale**:

1. All files are in backend libraries (agent-sdk, vscode-lm-tools)
2. Changes are TypeScript type system improvements
3. No UI/Angular components involved
4. No VS Code extension API changes

### Complexity Assessment

**Complexity**: LOW-MEDIUM
**Estimated Effort**: 2-4 hours

**Breakdown**:

- sdk-permission-handler.ts: 1-1.5 hours (most switch cases)
- session-history-reader.service.ts: 0.5-1 hour (few access points)
- permission-prompt.service.ts: 0.5-1 hour (similar to sdk-permission-handler)
- Testing & verification: 0.5-1 hour

### Files Affected Summary

**MODIFY** (3 files):

- `libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts`
- `libs/backend/agent-sdk/src/lib/session-history-reader.service.ts`
- `libs/backend/vscode-lm-tools/src/lib/permission/permission-prompt.service.ts`

**SKIP** (Intentionally Generic - 4 files):

- `libs/shared/src/lib/types/execution-node.types.ts`
- `libs/shared/src/lib/types/permission.types.ts`
- `libs/shared/src/lib/types/claude-domain.types.ts`
- `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts`

**SKIP** (Test Files / SDK Bridging):

- All `.spec.ts` files with mocking casts
- `sdk-agent-adapter.ts` SDK bridging casts

### Critical Verification Points

**Before Implementation, Developer Must Verify**:

1. **Type guards are exported**:

   - `isBashToolInput` from `libs/shared/src/lib/type-guards/tool-input-guards.ts:692`
   - `isWriteToolInput` from same file:662
   - `isEditToolInput` from same file:676
   - `isReadToolInput` from same file:650
   - `isTaskToolInput` from same file:742

2. **Library exports verified**:

   - Check `libs/shared/src/index.ts` exports type guards

3. **Test after each file migration**:
   - Run `nx lint agent-sdk`
   - Run `nx build agent-sdk`
   - Run `nx typecheck:affected`

### Architecture Delivery Checklist

- [x] All patterns extracted from codebase with evidence
- [x] All type guards verified as exported
- [x] Files categorized (migrate vs skip with rationale)
- [x] Migration approach defined per file
- [x] Quality requirements specified
- [x] Developer type recommended
- [x] Complexity assessed
- [x] Verification points documented
