# Task Context for TASK_2025_023

## User Intent

Fix template-generation build errors by resolving FileSystemService API mismatch with workspace-intelligence

## Problem Analysis

The `@ptah-extension/template-generation` library (migrated from RooCode in TASK_2025_015) has 20 build errors due to incompatible FileSystemService usage:

**Root Causes**:

1. **Missing DI Token**: Code references `TOKENS.FILE_SYSTEM` but actual token is `TOKENS.FILE_SYSTEM_SERVICE`
2. **API Mismatch**: workspace-intelligence's FileSystemService expects VS Code Uri objects, not string paths
3. **Missing Methods**: workspace-intelligence's FileSystemService lacks:
   - `createDirectory(path: string)` - needed for template directory creation
   - `writeFile(path: string, content: string)` - needed for template writing
   - `copyDirectoryRecursive(src: string, dest: string)` - needed for template copying
4. **Error Handling Pattern**: workspace-intelligence throws errors, but template-generation expects `Result<T, Error>` returns

**Current State**:

- workspace-intelligence FileSystemService has: `readFile(uri)`, `readDirectory(uri)`, `stat(uri)`, `exists(uri)`
- template-generation needs: String-based paths + write operations + Result-based error handling

**Error Count**: 20 TypeScript errors blocking build

## Technical Context

- Branch: feature/TASK_2025_010 (current active branch)
- Created: 2025-11-24
- Task Type: BUGFIX
- Complexity: Medium
- Estimated Duration: 2-3 hours

## Execution Strategy

**Strategy 2: BUGFIX (Streamlined)** - Skip PM/Architect, requirements clear from error analysis

1. Phase 1: team-leader MODE 1 (DECOMPOSITION) - Break down fix into atomic tasks
2. Phase 2a-c: team-leader MODE 2/3 (ITERATIVE ASSIGNMENT + COMPLETION) - Implement fixes
3. Phase 3: USER CHOICE - QA (tester/reviewer/both/skip)
4. Phase 4: Git operations
5. Phase 5: modernization-detector

**Implementation Approach Options**:
A. Extend workspace-intelligence FileSystemService with missing methods
B. Create FileSystemAdapter wrapper in template-generation that bridges the APIs
C. Refactor template-generation to use Uri-based APIs directly

**Recommended**: Option B (Adapter pattern) - Least invasive, maintains separation of concerns
