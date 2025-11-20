# TASK_2025_010 - Atomic Task Breakdown

## Workspace Intelligence Commands for Claude CLI

**Status**: 📋 Ready for Assignment
**Total Tasks**: 12
**Estimated Effort**: 14-20 hours

---

## Phase 1: Core Command Registration (6-8 hours)

### Task 1.1: Register `ptah.analyzeWorkspace` Command

**Owner**: Unassigned
**Status**: ⬜ Pending
**Effort**: 1.5 hours
**Files**:

- `apps/ptah-extension-vscode/src/handlers/command-handlers.ts`

**Acceptance Criteria**:

- ✅ Command registered in `registerWorkspaceCommands()` method
- ✅ Calls `workspaceAnalyzer.analyzeWorkspace()`
- ✅ Returns JSON with `{ success, data, error }` format
- ✅ Error handling implemented
- ✅ Manual test in Command Palette passes

---

### Task 1.2: Register `ptah.searchRelevantFiles` Command

**Owner**: Unassigned
**Status**: ⬜ Pending
**Effort**: 1.5 hours
**Files**:

- `apps/ptah-extension-vscode/src/handlers/command-handlers.ts`

**Acceptance Criteria**:

- ✅ Command accepts `{ query, maxResults?, includeImages? }` args
- ✅ Calls `contextManager.searchFiles()`
- ✅ Returns array of file results with relevance scores
- ✅ Handles empty results gracefully
- ✅ Manual test with `--query="test"` passes

---

### Task 1.3: Register `ptah.getTokenEstimate` Command

**Owner**: Unassigned
**Status**: ⬜ Pending
**Effort**: 1.5 hours
**Files**:

- `apps/ptah-extension-vscode/src/handlers/command-handlers.ts`

**Acceptance Criteria**:

- ✅ Command accepts `{ files: string[], useAccurateCounting?: boolean }` args
- ✅ Resolves relative paths to absolute paths
- ✅ Uses `tokenCounter.countTokens()` for accurate counting
- ✅ Returns total tokens + per-file breakdown
- ✅ Handles missing files gracefully

---

### Task 1.4: Register `ptah.optimizeContext` Command

**Owner**: Unassigned
**Status**: ⬜ Pending
**Effort**: 1 hour
**Files**:

- `apps/ptah-extension-vscode/src/handlers/command-handlers.ts`

**Acceptance Criteria**:

- ✅ Calls `contextManager.getOptimizationSuggestions()`
- ✅ Returns current tokens + suggestions array
- ✅ Each suggestion includes type, description, savings, files
- ✅ Manual test in workspace with >80% token usage passes

---

### Task 1.5: Register `ptah.getProjectStructure` Command

**Owner**: Unassigned
**Status**: ⬜ Pending
**Effort**: 1.5 hours
**Files**:

- `apps/ptah-extension-vscode/src/handlers/command-handlers.ts`

**Acceptance Criteria**:

- ✅ Command accepts `{ maxDepth?, excludePatterns? }` args
- ✅ Calls `workspaceAnalyzer.getProjectStructure()`
- ✅ Returns hierarchical directory tree
- ✅ Excludes common patterns (node_modules, dist, .git)
- ✅ Manual test shows max 3 levels deep by default

---

### Task 1.6: Register `ptah.getCurrentContext` Command (Bonus)

**Owner**: Unassigned
**Status**: ⬜ Pending
**Effort**: 1 hour
**Files**:

- `apps/ptah-extension-vscode/src/handlers/command-handlers.ts`

**Acceptance Criteria**:

- ✅ Calls `contextManager.getCurrentContext()`
- ✅ Returns included files, excluded files, token estimate
- ✅ Async token estimation using `getTokenEstimateAsync()`
- ✅ Manual test shows current context state

---

## Phase 2: Shared Infrastructure (1-2 hours)

### Task 2.1: Create Command Response Type & Helper

**Owner**: Unassigned
**Status**: ⬜ Pending
**Effort**: 1 hour
**Files**:

- `apps/ptah-extension-vscode/src/handlers/command-response.types.ts` (new)
- `apps/ptah-extension-vscode/src/handlers/command-helpers.ts` (new)

**Acceptance Criteria**:

- ✅ `CommandResponse<T>` interface defined
- ✅ `createCommandResponse()` helper function
- ✅ All commands use standardized response format
- ✅ TypeScript types are strict (no `any`)

**Code**:

```typescript
// command-response.types.ts
export interface CommandResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  timestamp: number;
}

// command-helpers.ts
export function createCommandResponse<T>(data?: T, error?: Error | string): CommandResponse<T> {
  return {
    success: !error,
    data,
    error: error instanceof Error ? error.message : error,
    timestamp: Date.now(),
  };
}
```

---

### Task 2.2: Wire Up Command Registration in Extension Initialization

**Owner**: Unassigned
**Status**: ⬜ Pending
**Effort**: 0.5 hours
**Files**:

- `apps/ptah-extension-vscode/src/core/ptah-extension.ts`
- `apps/ptah-extension-vscode/src/handlers/command-handlers.ts`

**Acceptance Criteria**:

- ✅ `registerWorkspaceCommands()` method created in CommandHandlers
- ✅ Called from `PtahExtension.registerAll()`
- ✅ All 6 commands registered on extension activation
- ✅ Extension Development Host shows commands in Command Palette

---

## Phase 3: Testing & Validation (3-4 hours)

### Task 3.1: Manual Testing in Extension Development Host

**Owner**: Unassigned
**Status**: ⬜ Pending
**Effort**: 1.5 hours
**Files**: N/A (manual testing)

**Test Checklist**:

- ✅ Launch Extension Development Host (F5)
- ✅ Open Command Palette (Ctrl+Shift+P)
- ✅ Test `ptah.analyzeWorkspace` - verify JSON output
- ✅ Test `ptah.searchRelevantFiles --query="test"` - verify results
- ✅ Test `ptah.getTokenEstimate --files=["src/main.ts"]` - verify tokens
- ✅ Test `ptah.optimizeContext` - verify suggestions
- ✅ Test `ptah.getProjectStructure` - verify tree structure
- ✅ Test `ptah.getCurrentContext` - verify current state
- ✅ Test error scenarios (missing workspace, invalid args)

---

### Task 3.2: Claude CLI Integration Testing

**Owner**: Unassigned
**Status**: ⬜ Pending
**Effort**: 1.5 hours
**Files**: N/A (integration testing)

**Test Checklist**:

- ✅ Launch Claude CLI in VS Code integrated terminal
- ✅ Execute: `@code ptah.analyzeWorkspace`
- ✅ Verify Claude receives and parses JSON response
- ✅ Execute: `@code ptah.searchRelevantFiles --query="auth"`
- ✅ Verify Claude understands file search results
- ✅ Execute: `@code ptah.getTokenEstimate --files=["..."]`
- ✅ Verify token estimation works
- ✅ Test all 6 commands via Claude CLI
- ✅ Verify error handling (invalid args, missing files)

---

### Task 3.3: Create Automated Tests (Optional)

**Owner**: Unassigned
**Status**: ⬜ Pending
**Effort**: 2 hours
**Files**:

- `apps/ptah-extension-vscode/src/handlers/__tests__/workspace-commands.spec.ts` (new)

**Acceptance Criteria**:

- ✅ Test command registration
- ✅ Test `analyzeWorkspace` returns valid JSON
- ✅ Test `searchRelevantFiles` with mock files
- ✅ Test `getTokenEstimate` with sample files
- ✅ Test error handling (missing workspace, invalid args)
- ✅ Coverage >80% for command handlers

---

## Phase 4: Documentation (2-3 hours)

### Task 4.1: Create User Documentation

**Owner**: Unassigned
**Status**: ⬜ Pending
**Effort**: 1.5 hours
**Files**:

- `docs/CLAUDE_CLI_COMMANDS.md` (new)

**Acceptance Criteria**:

- ✅ Document all 6 commands
- ✅ Show command syntax and arguments
- ✅ Include expected output examples (JSON)
- ✅ Provide Claude CLI usage examples
- ✅ Include workflow examples (onboarding, feature dev, context optimization)

---

### Task 4.2: Create Developer Documentation

**Owner**: Unassigned
**Status**: ⬜ Pending
**Effort**: 1 hour
**Files**:

- `apps/ptah-extension-vscode/src/handlers/README_WORKSPACE_COMMANDS.md` (new)

**Acceptance Criteria**:

- ✅ Explain command architecture
- ✅ Document how to add new commands
- ✅ Include testing instructions
- ✅ Link to relevant service documentation

---

### Task 4.3: Update Main README

**Owner**: Unassigned
**Status**: ⬜ Pending
**Effort**: 0.5 hours
**Files**:

- `README.md`

**Acceptance Criteria**:

- ✅ Add section on "Claude CLI Workspace Commands"
- ✅ Link to detailed documentation
- ✅ Include quick usage example
- ✅ Mention unique value proposition

---

## Phase 5: Registry & Cleanup (1 hour)

### Task 5.1: Update Task Registry

**Owner**: Unassigned
**Status**: ⬜ Pending
**Effort**: 0.5 hours
**Files**:

- `task-tracking/registry.md`

**Acceptance Criteria**:

- ✅ Add TASK_2025_010 entry
- ✅ Mark status as "In Progress"
- ✅ Update when completed

---

### Task 5.2: Create Commit & PR

**Owner**: Unassigned
**Status**: ⬜ Pending
**Effort**: 0.5 hours
**Files**: All modified files

**Acceptance Criteria**:

- ✅ Commit follows commitlint format: `feat(vscode): add workspace intelligence commands for claude cli`
- ✅ PR description includes:
  - Summary of 6 new commands
  - Claude CLI usage examples
  - Testing evidence (screenshots/logs)
  - Link to documentation
- ✅ All tests pass
- ✅ PR ready for review

---

## Task Dependencies

```
Task 2.1 (Response Types) ────> Task 1.1-1.6 (All Commands)
                                       │
                                       ↓
                               Task 2.2 (Wire Up)
                                       │
                                       ↓
                               Task 3.1 (Manual Test)
                                       │
                                       ↓
                               Task 3.2 (Claude CLI Test)
                                       │
                                       ↓
                               Task 4.1-4.3 (Documentation)
                                       │
                                       ↓
                               Task 5.1-5.2 (Registry & PR)
```

---

## Success Criteria Summary

- ✅ All 6 commands registered and callable
- ✅ Claude CLI can execute all commands successfully
- ✅ All commands return JSON-serializable data
- ✅ Error handling covers edge cases
- ✅ Manual testing passes in Extension Development Host
- ✅ Integration testing with Claude CLI passes
- ✅ User documentation complete with examples
- ✅ Developer documentation explains architecture
- ✅ Commit follows commitlint rules
- ✅ PR approved and merged

---

## Risk Mitigation

**Risk**: Commands fail in headless mode (Claude CLI)
**Mitigation**: Test all commands without UI interaction

**Risk**: JSON serialization errors for complex objects
**Mitigation**: Use standardized response type, test with complex workspaces

**Risk**: Performance issues with large workspaces
**Mitigation**: Implement maxResults limits, use caching in ContextManager

**Risk**: Path resolution errors (relative vs absolute)
**Mitigation**: Always resolve to absolute paths, handle both formats

---

**Ready for Assignment**: Team Leader can now assign tasks to developers sequentially.
