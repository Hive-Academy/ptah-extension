# Task Context - TASK_2025_095

## User Intent

Migrate all remaining unsafe type patterns to use the new comprehensive tool type system. The patterns to migrate are:

1. `as unknown as` type casts for tool inputs/outputs
2. Bracket notation access like `toolInput?.['file_path']`
3. `Record<string, unknown>` for tool inputs that should use specific tool input types

## Prior Work (TASK_2025_094)

The comprehensive tool type system was created in `libs/shared/src/lib/type-guards/tool-input-guards.ts` with:

- 19 Tool Input Types (Read, Write, Edit, Bash, Grep, Glob, Task, TodoWrite, AskUserQuestion, etc.)
- 17 Tool Output Types (TaskToolOutput, BashToolOutput, GrepToolOutput, etc.)
- Type Guards for runtime narrowing (isReadToolInput, isBashToolOutput, etc.)
- Type Maps for lookup (ToolInputMap, ToolOutputMap, GetToolInput<T>, GetToolOutput<T>)

3 frontend components were already migrated:

- tool-output-display.component.ts
- code-output.component.ts
- tool-input-display.component.ts

## Files to Migrate (from grep analysis)

### Backend SDK (HIGH PRIORITY)

- `sdk-agent-adapter.ts` - `as unknown as AsyncIterable<SDKMessage>`
- `sdk-permission-handler.ts` - `Record<string, unknown>` for tool inputs
- `session-history-reader.service.ts` - `Record<string, unknown>` for inputs

### Backend vscode-core

- `message-validator.service.ts` - `as unknown as` for validation results
- `permission-prompt.service.ts` - `Record<string, unknown>` for tool inputs

### Shared Types (STRUCTURAL)

- `execution-node.types.ts` - `toolInput?: Record<string, unknown>`
- `permission.types.ts` - `toolInput: Readonly<Record<string, unknown>>`
- `claude-domain.types.ts` - `toolInput: Record<string, unknown>`

### Exclusions (Test files, SDK bridging - acceptable patterns)

- Test files using `as unknown as` for mocking
- SDK adapter bridging to external SDK types

## Technical Context

- Branch: feature/sdk-only-migration
- Created: 2025-12-29
- Type: REFACTORING
- Complexity: Medium (multiple files, established patterns to follow)

## Execution Strategy

REFACTORING strategy: software-architect → team-leader 3-mode loop → QA
