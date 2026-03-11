# Development Tasks - TASK_2025_095

**Total Tasks**: 6 | **Batches**: 3 | **Status**: 3/3 complete

---

## Plan Validation Summary

**Validation Status**: PASSED

### Assumptions Verified

- [Type guards exported from shared library]: VERIFIED at `libs/shared/src/index.ts:15`
- [All required type guards exist]: VERIFIED - `isBashToolInput`, `isWriteToolInput`, `isEditToolInput`, `isReadToolInput`, `isGrepToolInput`, `isGlobToolInput`, `isNotebookEditToolInput`, `isTaskToolInput`
- [Type guards handle null/undefined]: VERIFIED - All guards check `input !== null`

### Risks Identified

| Risk                               | Severity | Mitigation                                             |
| ---------------------------------- | -------- | ------------------------------------------------------ |
| Type guard may reject valid inputs | LOW      | Guards are permissive (only check required properties) |
| Fallback behavior changes          | LOW      | Keep existing fallback strings verbatim                |

### Edge Cases to Handle

- [ ] Null/undefined input -> Handled by type guards returning false, fallback used
- [ ] Missing optional properties -> Type guards only check required props

---

## Batch 1: SdkPermissionHandler Type Migration - COMPLETE

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: None
**Commit**: 8337a1c

### Task 1.1: Add type guard imports to sdk-permission-handler.ts - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-permission-handler.ts
**Spec Reference**: implementation-plan.md:219-264
**Pattern to Follow**: libs/frontend/chat/src/lib/components/molecules/tool-output-display/tool-output-display.component.ts (already migrated)

**Quality Requirements**:

- Import all 7 required type guards from @ptah-extension/shared
- Import order: alphabetical within import statement

**Implementation Details**:

- Add import statement at line 17 (after existing imports, before interface definitions)
- Import: `isBashToolInput`, `isWriteToolInput`, `isEditToolInput`, `isReadToolInput`, `isGrepToolInput`, `isGlobToolInput`, `isNotebookEditToolInput`

---

### Task 1.2: Migrate generateDescription() method to use type guards - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\sdk-permission-handler.ts
**Spec Reference**: implementation-plan.md:224-264
**Dependencies**: Task 1.1

**Quality Requirements**:

- Replace ALL bracket notation access with type-guarded access
- Maintain exact same fallback strings
- Each case uses pattern: `if (isXToolInput(input)) { ... } else { return fallback; }`
- No `as string` type casts

**Implementation Details**:

- Lines 485-546: Refactor switch cases for Bash, Write, Edit, NotebookEdit, Read, Grep, Glob
- Pattern per case:
  ```typescript
  case 'Bash': {
    if (isBashToolInput(input)) {
      const truncated = input.command.length > 100
        ? `${input.command.substring(0, 100)}...`
        : input.command;
      return `Execute bash command: ${truncated}`;
    }
    return 'Execute a bash command';
  }
  ```

**Current Code to Migrate** (lines 485-546):

- Line 486: `const command = input['command'];` -> type guard
- Line 497: `const filePath = input['file_path'];` -> type guard
- Line 505: `const filePath = input['file_path'];` -> type guard
- Line 513: `const notebookPath = input['notebook_path'];` -> type guard
- Line 521: `const filePath = input['file_path'];` -> type guard
- Line 529: `const pattern = input['pattern'];` -> type guard
- Line 537: `const pattern = input['pattern'];` -> type guard

---

**Batch 1 Verification**:

- [x] All files exist at paths
- [x] Build passes: `npx nx build agent-sdk`
- [x] Type-check passes: `npx nx run agent-sdk:typecheck`
- [x] code-logic-reviewer approved (verified by team-leader)
- [x] No bracket notation remains in generateDescription()
- [x] Git commit: 8337a1c

---

## Batch 2: SessionHistoryReaderService Type Migration - COMPLETE

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 1
**Commit**: 601ee9c

### Task 2.1: Add type guard import to session-history-reader.service.ts - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\session-history-reader.service.ts
**Spec Reference**: implementation-plan.md:267-296

**Quality Requirements**:

- Import `isTaskToolInput` from @ptah-extension/shared
- Place import with existing @ptah-extension/shared imports (line 35)

**Implementation Details**:

- Add `isTaskToolInput` to existing shared imports at lines 24-35

---

### Task 2.2: Migrate extractTaskToolUses() method to use type guard - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\agent-sdk\src\lib\session-history-reader.service.ts
**Spec Reference**: implementation-plan.md:271-296
**Dependencies**: Task 2.1

**Quality Requirements**:

- Replace bracket notation `block.input?.['subagent_type']` with type guard
- Graceful fallback to 'unknown' for malformed inputs
- No `as string` type casts

**Implementation Details**:

- Lines 907-918: Refactor task tool extraction
- Pattern:
  ```typescript
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
  ```

**Current Code to Migrate** (line 912-913):

- `subagentType: (block.input?.['subagent_type'] as string) || 'unknown'`

**Additional Migration Point** (line 1119):

- `agentType: (input['subagent_type'] as string) || 'unknown'`
- Also needs type guard pattern

---

**Batch 2 Verification**:

- [x] All files exist at paths
- [x] Build passes: `npx nx build agent-sdk`
- [x] Type-check passes: `npx nx run agent-sdk:typecheck`
- [x] code-logic-reviewer approved (verified by team-leader)
- [x] No bracket notation for subagent_type access
- [x] Git commit: 601ee9c

---

## Batch 3: PermissionPromptService Type Migration - COMPLETE

**Developer**: backend-developer
**Tasks**: 2 | **Dependencies**: Batch 2
**Commit**: e5eb6cd

### Task 3.1: Add type guard imports to permission-prompt.service.ts - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\permission\permission-prompt.service.ts
**Spec Reference**: implementation-plan.md:300-306

**Quality Requirements**:

- Import required type guards from @ptah-extension/shared
- Place import with existing @ptah-extension/shared imports (lines 19-23)

**Implementation Details**:

- Add imports: `isBashToolInput`, `isWriteToolInput`, `isEditToolInput`, `isReadToolInput`, `isGrepToolInput`, `isGlobToolInput`

---

### Task 3.2: Migrate buildDescription() method to use type guards - COMPLETE

**File**: D:\projects\ptah-extension\libs\backend\vscode-lm-tools\src\lib\permission\permission-prompt.service.ts
**Spec Reference**: implementation-plan.md:300-306
**Dependencies**: Task 3.1

**Quality Requirements**:

- Replace ALL bracket notation access with type-guarded access
- Maintain exact same fallback strings
- Same pattern as sdk-permission-handler.ts migration
- No `as string` type casts

**Implementation Details**:

- Lines 331-355: Refactor switch cases for Bash, Write, Read, Edit, Glob, Grep
- Pattern per case:
  ```typescript
  case 'Bash':
    if (isBashToolInput(toolInput)) {
      return `Execute bash command: ${toolInput.command}`;
    }
    return `Execute bash command: unknown`;
  ```

**Current Code to Migrate** (lines 336-354):

- Line 338: `${toolInput['command'] ?? 'unknown'}` -> type guard
- Line 340: `${toolInput['file_path'] ?? 'unknown'}` -> type guard
- Line 342: `${toolInput['file_path'] ?? 'unknown'}` -> type guard
- Line 344: `${toolInput['file_path'] ?? 'unknown'}` -> type guard
- Line 346: `${toolInput['pattern'] ?? 'unknown'}` -> type guard
- Line 348: `${toolInput['pattern'] ?? 'unknown'}` -> type guard

---

**Batch 3 Verification**:

- [x] All files exist at paths
- [x] Build passes: `npx nx build vscode-lm-tools`
- [x] Type-check passes: `npx nx run vscode-lm-tools:typecheck`
- [x] code-logic-reviewer approved (verified by team-leader)
- [x] No bracket notation remains in buildDescription()
- [x] Git commit: e5eb6cd

---

## Status Icons Reference

| Status      | Meaning                         |
| ----------- | ------------------------------- |
| PENDING     | Not started                     |
| IN PROGRESS | Assigned to developer           |
| IMPLEMENTED | Developer done, awaiting verify |
| COMPLETE    | Verified and committed          |
| FAILED      | Verification failed             |

---

## Notes

**Build Commands**:

```bash
# Build affected libraries
npx nx build agent-sdk
npx nx build vscode-lm-tools

# Type-check affected libraries
npx nx run agent-sdk:typecheck
npx nx run vscode-lm-tools:typecheck

# Lint affected libraries
npx nx lint agent-sdk
npx nx lint vscode-lm-tools
```

**Type Guard Import Pattern**:

```typescript
import { isBashToolInput, isWriteToolInput, isEditToolInput, isReadToolInput, isGrepToolInput, isGlobToolInput, isNotebookEditToolInput, isTaskToolInput } from '@ptah-extension/shared';
```
