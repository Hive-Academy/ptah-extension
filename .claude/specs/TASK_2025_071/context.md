# Task Context - TASK_2025_071

## User Intent

Organize a fix that addresses 4 required changes to standardize DI registration:

1. Rename `registration.ts` → `register.ts` in llm-abstraction and template-generation
2. Refactor registration functions to accept `(container, logger)` parameters instead of global imports
3. Add imports and calls for llm-abstraction and template-generation in main container.ts
4. Encapsulate ALL service registration inside libraries - container.ts should only call library registration functions

## Conversation Summary

Investigation revealed critical inconsistencies in DI registration mechanisms:

### Current State Analysis

| Library             | File Name         | Function Name                                        | Container Access | Called in container.ts |
| ------------------- | ----------------- | ---------------------------------------------------- | ---------------- | ---------------------- |
| agent-sdk           | `register.ts`     | `registerSdkServices(container, context, logger)`    | Parameter        | YES                    |
| agent-generation    | `register.ts`     | `registerAgentGenerationServices(container, logger)` | Parameter        | YES                    |
| llm-abstraction     | `registration.ts` | `registerLlmAbstraction()`                           | Global import    | NO                     |
| template-generation | `registration.ts` | `registerTemplateGeneration()`                       | Global import    | NO                     |

### Key Issues Identified

1. **File naming inconsistency**: `register.ts` vs `registration.ts`
2. **Function signature inconsistency**: Some use parameter injection, others use global container
3. **Missing registrations**: llm-abstraction and template-generation are NEVER called in container.ts
4. **Logging inconsistency**: Some use logger injection, others use console.log or no logging
5. **Container.ts has direct service registrations** that should be encapsulated in libraries

### Target Architecture

All libraries should follow the agent-sdk pattern:

- File: `libs/backend/<library>/src/lib/di/register.ts`
- Function: `register<LibraryName>Services(container, logger)`
- Container.ts: Only call library registration functions, no direct service registrations

## Technical Context

- Branch: feature/sdk-only-migration
- Created: 2025-12-14
- Type: REFACTORING
- Complexity: Medium (4 libraries + container.ts changes)

## Execution Strategy

REFACTORING strategy - software-architect first, then team-leader decomposition

## Files to Modify

### Libraries

- `libs/backend/llm-abstraction/src/lib/di/registration.ts` → rename to `register.ts`
- `libs/backend/template-generation/src/lib/di/registration.ts` → rename to `register.ts`
- Both index.ts files for export updates

### Main Application

- `apps/ptah-extension-vscode/src/di/container.ts` - refactor to call library registrations

### Potentially affected

- `libs/backend/workspace-intelligence/` - check if needs encapsulation
- `libs/backend/vscode-lm-tools/` - check if needs encapsulation
