# Task Context - TASK_2025_088

## User Intent

Execute the SDK-only migration and simplified architecture purge as documented in:

- `migration-plan.md` - Eliminate SdkSessionStorage, use SDK's native persistence
- `simplified-architecture-proposal.md` - Reduce 8 layers → 4 layers
- `purge-over-engineered-layers.md` - Delete ~2,778 lines of redundant code
- `type-safety-report.md` - Fix 18 type casts, eliminate 7 `any` usages

## Conversation Summary

User confirmed all phases and all priorities (code reduction, type safety, architecture simplification) are critical.

## Technical Context

- Branch: feature/sdk-only-migration
- Created: 2025-12-18
- Type: REFACTORING
- Complexity: Complex

## Execution Strategy

Full purge and simplification across all documented phases.

## Prerequisites Already Complete

- `claude-sdk.types.ts` created with 639 lines of typed definitions and type guards
- `session-metadata-store.ts` created (lightweight metadata storage)
- `sdk-session-storage.ts` deleted (redundant with SDK native persistence)

## Phases to Execute

1. Consolidate SDK types - Use `claude-sdk.types.ts` everywhere
2. Inline helper classes - UserMessageStreamFactory, SdkQueryBuilder
3. Simplify StreamTransformer - Remove redundant storage code
4. Frontend simplification - Reduce ChatStore facade
5. Type safety fixes - Replace casts with type guards
6. Delete dead files and orphaned imports
7. Validation - Build, typecheck, lint
