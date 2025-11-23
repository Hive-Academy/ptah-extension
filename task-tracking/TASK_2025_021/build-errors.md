# Build Compilation Errors - TASK_2025_021

**Date**: 2025-11-23
**Build Command**: `npm run build:all`
**Exit Code**: 130 (build failure)
**Phase**: After Phase 0 Event Purge

---

## Summary

**Total Libraries Failed**: 3 out of 10
**Total Errors**: 11 unique compilation errors

**Failed Libraries**:

1. @ptah-extension/claude-domain (backend)
2. @ptah-extension/llm-abstraction (backend)
3. ptah-extension-webview (frontend)

**Blocked Libraries** (dependencies failed):

- @ptah-extension/template-generation
- @ptah-extension/ai-providers-core
- ptah-extension-vscode
- ptah-extension-vscode:build-webpack:production
- ptah-extension-vscode:post-build-copy

---

## Error Categorization

### Type A: Missing Imports (SessionManager)

**Root Cause**: SessionManager and SessionProxy were deleted in Phase 0 purge (commit bc0ca56)

**Fix Strategy**: Remove import statements, comment out usage with `// TODO: Phase 2 RPC`

#### Error A1: claude-cli-launcher.ts Missing SessionManager Import

**File**: `libs\backend\claude-domain\src\cli\claude-cli-launcher.ts`
**Line**: 16:32
**Error Code**: TS2307
**Error Message**: Cannot find module '../session/session-manager' or its corresponding type declarations.

**Source Line**:

```typescript
import { SessionManager } from '../session/session-manager';
```

**Fix**: Remove import statement

---

#### Error A2: claude-cli.service.ts Missing SessionManager Import

**File**: `libs\backend\claude-domain\src\cli\claude-cli.service.ts`
**Line**: 26:32
**Error Code**: TS2307
**Error Message**: Cannot find module '../session/session-manager' or its corresponding type declarations.

**Source Line**:

```typescript
import { SessionManager } from '../session/session-manager';
```

**Fix**: Remove import statement

---

### Type B: Missing DI Tokens

**Root Cause**: DI tokens SESSION_MANAGER, CLAUDE_DOMAIN_EVENT_PUBLISHER, CLAUDE_ORCHESTRATOR deleted in Phase 0 purge

**Fix Strategy**: Comment out DI injection parameters with `// TODO: Phase 2 RPC`

#### Error B1: claude-cli.service.ts Missing SESSION_MANAGER Token

**File**: `libs\backend\claude-domain\src\cli\claude-cli.service.ts`
**Line**: 45:20
**Error Code**: TS2339
**Error Message**: Property 'SESSION_MANAGER' does not exist on type '{ readonly EXTENSION_CONTEXT: unique symbol; readonly WEBVIEW_PROVIDER: unique symbol; ... }'.

**Source Line**:

```typescript
@inject(TOKENS.SESSION_MANAGER)
private readonly sessionManager: SessionManager,
```

**Fix**: Comment out entire constructor parameter

---

#### Error B2: claude-cli.service.ts Missing CLAUDE_DOMAIN_EVENT_PUBLISHER Token

**File**: `libs\backend\claude-domain\src\cli\claude-cli.service.ts`
**Line**: 51:20
**Error Code**: TS2339
**Error Message**: Property 'CLAUDE_DOMAIN_EVENT_PUBLISHER' does not exist on type '{ readonly EXTENSION_CONTEXT: unique symbol; ... }'.

**Source Line**:

```typescript
@inject(TOKENS.CLAUDE_DOMAIN_EVENT_PUBLISHER)
private readonly eventPublisher: ClaudeDomainEventPublisher,
```

**Fix**: Comment out entire constructor parameter

---

#### Error B3: claude-cli.service.ts Missing CLAUDE_ORCHESTRATOR Token

**File**: `libs\backend\claude-domain\src\cli\claude-cli.service.ts`
**Line**: 53:20
**Error Code**: TS2339
**Error Message**: Property 'CLAUDE_ORCHESTRATOR' does not exist on type '{ readonly EXTENSION_CONTEXT: unique symbol; ... }'.

**Source Line**:

```typescript
@inject(TOKENS.CLAUDE_ORCHESTRATOR)
private readonly orchestrator: ClaudeOrchestrator,
```

**Fix**: Comment out entire constructor parameter

---

### Type C: Missing Service Files (Deleted in Phase 0)

**Root Cause**: Frontend service files deleted in Phase 0 purge, but still exported from index.ts

**Fix Strategy**: Remove export statements from index.ts

#### Error C1: Missing chat-validation.service.ts

**File**: `libs\frontend\core\src\lib\services\index.ts`
**Line**: 21:38
**Error Code**: TS2307
**Error Message**: Cannot find module './chat-validation.service' or its corresponding type declarations.

**Source Line**:

```typescript
export { ChatValidationService } from './chat-validation.service';
```

**Fix**: Remove export statement

---

#### Error C2: Missing claude-message-transformer.service.ts

**File**: `libs\frontend\core\src\lib\services\index.ts`
**Line**: 22:48
**Error Code**: TS2307
**Error Message**: Cannot find module './claude-message-transformer.service' or its corresponding type declarations.

**Source Line**:

```typescript
export { ClaudeMessageTransformerService } from './claude-message-transformer.service';
```

**Fix**: Remove export statement

---

#### Error C3: Missing message-processing.service.ts

**File**: `libs\frontend\core\src\lib\services\index.ts`
**Line**: 23:41
**Error Code**: TS2307
**Error Message**: Cannot find module './message-processing.service' or its corresponding type declarations.

**Source Line**:

```typescript
export { MessageProcessingService } from './message-processing.service';
```

**Fix**: Remove export statement

---

#### Error C4: Missing provider.service.ts

**File**: `libs\frontend\core\src\lib\services\index.ts`
**Line**: 34:7
**Error Code**: TS2307
**Error Message**: Cannot find module './provider.service' or its corresponding type declarations.

**Source Line**:

```typescript
export {
  ProviderService,
  // ...
} from './provider.service';
```

**Fix**: Remove export block

---

### Type D: Missing Service Imports (Dependencies on Deleted Files)

**Root Cause**: Other files importing services deleted in Phase 0

**Fix Strategy**: Remove import statements or comment out usage

#### Error D1: chat-state.service.ts Missing claude-message-transformer.service

**File**: `libs\frontend\core\src\lib\services\chat-state.service.ts`
**Line**: 7:44
**Error Code**: TS2307 (esbuild error)
**Error Message**: Could not resolve "./claude-message-transformer.service"

**Source Line**:

```typescript
import { ClaudeMessageTransformerService, ProcessedClaudeMessage } from './claude-message-transformer.service';
```

**Fix**: Remove import statement, replace `ProcessedClaudeMessage` type with `any` or remove usage

---

#### Error D2: llm-abstraction Library Missing Endpoint Types

**File**: `libs\backend\llm-abstraction\src\lib\prompts\chat\claude-code-endpoints.ts`
**Line**: 4:45
**Error Code**: TS2307
**Error Message**: Cannot find module '../../../../../shared/src/lib/message-types/endpoint-types' or its corresponding type declarations.

**Source Line**:

```typescript
import { EndpointType } from '../../../../../shared/src/lib/message-types/endpoint-types';
```

**Fix**: Remove import statement or replace EndpointType with string literal

**Note**: endpoint-types.ts was likely deleted in Phase 0 purge as part of message-types cleanup

---

## Execution Plan

### Task 1.2: Fix Backend Compilation Errors

**Files to Modify** (7 errors):

1. D:\projects\ptah-extension\libs\backend\claude-domain\src\cli\claude-cli-launcher.ts

   - Remove: Line 16 SessionManager import

2. D:\projects\ptah-extension\libs\backend\claude-domain\src\cli\claude-cli.service.ts

   - Remove: Line 26 SessionManager import
   - Comment out: Line 45-46 @inject(TOKENS.SESSION_MANAGER) parameter
   - Comment out: Line 51-52 @inject(TOKENS.CLAUDE_DOMAIN_EVENT_PUBLISHER) parameter
   - Comment out: Line 53-54 @inject(TOKENS.CLAUDE_ORCHESTRATOR) parameter

3. D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\prompts\chat\claude-code-endpoints.ts
   - Remove: Line 4 EndpointType import
   - Replace EndpointType usage with string literal

### Task 1.2: Fix Frontend Compilation Errors

**Files to Modify** (4 errors):

1. D:\projects\ptah-extension\libs\frontend\core\src\lib\services\index.ts

   - Remove: Line 21 ChatValidationService export
   - Remove: Line 22 ClaudeMessageTransformerService export
   - Remove: Line 23 MessageProcessingService export
   - Remove: Lines 34+ ProviderService export block

2. D:\projects\ptah-extension\libs\frontend\core\src\lib\services\chat-state.service.ts
   - Remove: Line 7 ClaudeMessageTransformerService import
   - Replace ProcessedClaudeMessage type with appropriate type or remove usage

---

## Expected Outcome After Task 1.2

**Build Status**: `npm run build:all` should complete with exit code 0
**Libraries Fixed**: 3/3 (claude-domain, llm-abstraction, webview)
**Blocked Libraries**: Should now build successfully (dependencies resolved)

---

## Notes

- Extension will NOT launch after these fixes (expected)
- Frontend components may have broken UI (expected - fixed in Phase 2)
- Backend services will have commented-out dependencies (restored in Phase 2 via RPC)
- All fixes are temporary - proper implementation in Phase 2 RPC creation

---

## Verification Checklist

After Task 1.2 completion:

- [ ] All 11 errors resolved
- [ ] `npm run build:all` exits with code 0
- [ ] No new TypeScript errors introduced
- [ ] All TODO comments reference "Phase 2 RPC"
- [ ] Files staged for git commit
