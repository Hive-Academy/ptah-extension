# TASK_2025_073: LLM Abstraction Remediation & Phase 5 Completion

## Task Overview

**Created**: 2025-12-14
**Status**: PLANNED
**Priority**: HIGH
**Prerequisite**: TASK_2025_071 (LLM Abstraction Implementation - Phases 1-4 complete)

## Background

TASK_2025_071 implemented the LLM abstraction layer with:
- Secondary entry points for tree-shaking (Phases 1-2)
- Dynamic imports and webpack configuration (Phase 3)
- MCP namespace integration via `ptah.llm` (Phase 4)

Code reviews (both style and logic) scored the implementation **6.5/10** with assessment **NEEDS_REVISION**.

This task addresses:
1. All critical/serious issues identified by reviewers
2. Phase 5: RPC handlers for webview API key management (deferred from TASK_2025_071)

## Review Findings Summary

### Code Style Review Findings

| Issue Type | Count |
|------------|-------|
| Blocking   | 3     |
| Serious    | 7     |
| Minor      | 5     |

**Blocking Issues:**
1. Dynamic import path fragility - no compile-time safety
2. Nullable `currentProvider` state management
3. Type definition coupling - `LlmProviderName` in wrong file

### Code Logic Review Findings

| Issue Type | Count |
|------------|-------|
| Critical   | 2     |
| Serious    | 4     |
| Moderate   | 3     |

**Critical Issues:**
1. Provider switching race condition - no async lock
2. Dynamic import export paths unverified in package.json

## Scope

### In Scope
- Fix all critical and serious issues from code reviews
- Implement Phase 5: RPC handlers for API key management
- Add timeout protection for provider creation
- Centralize type definitions
- Add async locking for provider switching
- Verify/add package.json exports for dynamic imports

### Out of Scope
- Additional LLM providers beyond existing 5
- Changes to MCP namespace API surface
- UI components for API key management (separate task)

## Success Criteria

1. All critical review findings resolved
2. All serious review findings resolved
3. Phase 5 RPC handlers implemented and functional
4. Build passes with no new warnings
5. Extension activates without errors
6. Provider switching is thread-safe
7. Dynamic imports have compile-time verification

## Files Affected (Estimated)

**Primary Files:**
- `libs/backend/llm-abstraction/src/lib/services/llm.service.ts`
- `libs/backend/llm-abstraction/src/lib/registry/provider-registry.ts`
- `libs/backend/llm-abstraction/src/lib/services/llm-secrets.service.ts`
- `libs/backend/llm-abstraction/src/lib/services/llm-configuration.service.ts`
- `libs/backend/llm-abstraction/package.json`

**New Files:**
- `libs/backend/llm-abstraction/src/lib/types/provider-types.ts`
- `libs/backend/vscode-core/src/rpc/llm-rpc-handlers.ts`

## Related Tasks

- **TASK_2025_071**: LLM Abstraction Implementation (predecessor)
- **TASK_2025_072**: Landing Page Design (unrelated, parallel)
