# Phase 1A: Fix Phase 0 Collateral Damage - TASK_2025_021

**Date**: 2025-11-23
**Purpose**: Fix true blocker errors before RPC implementation
**User Decision**: Remove @ptah-extension/providers library completely (simplify codebase)

---

## Scope

Fix all build errors that RPC implementation CANNOT resolve:

1. esbuild configuration issues
2. Missing ai-providers-core architectural files
3. Provider library frontend dependencies (REMOVE all references)
4. Complete SessionManager/EventBus comment-outs

**Goal**: Achieve clean slate - code compiles with zero errors, ready for RPC implementation

---

## User Decision: Remove Provider UI

**Decision**: Remove all @ptah-extension/providers dependencies from frontend
**Rationale**: Align with purge mission - slim codebase, remove unused UI
**Impact**: Provider selection will be backend-only (no UI visualization)

---

## Task Breakdown for Team-Leader

### Task 1A.1: Fix esbuild Configuration (Backend)

**Objective**: Add 'vscode' to externals in llm-abstraction library

**File**: D:\projects\ptah-extension\libs\backend\llm-abstraction\project.json

**Change Required**:

```json
{
  "targets": {
    "build": {
      "executor": "@nx/esbuild:esbuild",
      "options": {
        "external": ["vscode", "inversify"]
      }
    }
  }
}
```

**Errors Fixed**: 7 errors in llm-abstraction
**Effort**: 5 minutes
**Developer**: backend-developer
**Verification**: `nx build llm-abstraction` passes

---

### Task 1A.2: Restore ai-providers-core Missing Files (Backend)

**Objective**: Restore 5 architectural files incorrectly deleted in Phase 0

**Files to Restore from Git** (commit bc0ca56~1):

1. `libs/backend/ai-providers-core/src/lib/adapters/vscode-lm-adapter.ts`
2. `libs/backend/ai-providers-core/src/lib/types/provider-selection.interface.ts`
3. `libs/backend/ai-providers-core/src/lib/types/provider-state.types.ts`
4. `libs/backend/ai-providers-core/src/lib/services/provider-manager.ts`
5. `libs/backend/ai-providers-core/src/lib/strategies/intelligent-provider-strategy.ts`

**Git Commands**:

```bash
git checkout bc0ca56~1 -- libs/backend/ai-providers-core/src/lib/adapters/vscode-lm-adapter.ts
git checkout bc0ca56~1 -- libs/backend/ai-providers-core/src/lib/types/provider-selection.interface.ts
git checkout bc0ca56~1 -- libs/backend/ai-providers-core/src/lib/types/provider-state.types.ts
git checkout bc0ca56~1 -- libs/backend/ai-providers-core/src/lib/services/provider-manager.ts
git checkout bc0ca56~1 -- libs/backend/ai-providers-core/src/lib/strategies/intelligent-provider-strategy.ts
```

**Errors Fixed**: 7 errors in ai-providers-core
**Effort**: 30 minutes
**Developer**: backend-developer
**Verification**: `nx build ai-providers-core` passes

**Why Restore?**: These files are NOT event-based - they're architectural:

- vscode-lm-adapter: VS Code LM API integration (multi-provider)
- provider-manager: Provider lifecycle management
- provider-selection.interface: Core types

---

### Task 1A.3: Remove Provider Library Dependencies (Frontend)

**Objective**: Remove all imports/references to deleted @ptah-extension/providers library

**Files to Modify** (estimate 15+ files):

**Frontend Components**:

- Remove imports: `import { ProviderService } from '@ptah-extension/providers'`
- Remove component dependencies on ProviderService
- Comment out provider-related UI code

**Expected Files**:

- libs/frontend/core/src/lib/services/\*.ts (remove ProviderService imports)
- apps/ptah-extension-webview/src/app/components/\*_/_.ts (agent components)
- libs/frontend/dashboard/src/lib/components/\*_/_.ts (dashboard components)
- libs/frontend/analytics/src/lib/components/\*_/_.ts (analytics components)

**Fix Pattern**:

```typescript
// Before
import { ProviderService } from '@ptah-extension/providers';
constructor(private providerService: ProviderService) {}

// After
// import { ProviderService } from '@ptah-extension/providers'; // DELETED - provider UI removed
// constructor(private providerService: ProviderService) {} // TODO: Remove provider UI dependencies
```

**Errors Fixed**: 30+ errors in webview
**Effort**: 2 hours
**Developer**: frontend-developer
**Verification**: `nx build ptah-extension-webview` passes

---

### Task 1A.4: Complete SessionManager Comment-Outs (Backend)

**Objective**: Finish commenting out SessionManager/EventBus references (started in Batch 1)

**Remaining Files** (from build-errors.md):

- claude-cli-launcher.ts (SessionManager import - may already be done)
- claude-cli.service.ts (3 DI token injections - may already be done)
- claude-code-endpoints.ts (EndpointType import)
- command.service.ts (SessionManager usage)

**Fix Pattern**:

```typescript
// import { SessionManager } from '../session/session-manager'; // DELETED - Phase 2 RPC will replace
// @inject(TOKENS.SESSION_MANAGER) private sessionManager: SessionManager, // TODO: Phase 2 RPC
```

**Errors Fixed**: Remaining SessionManager/EventBus errors
**Effort**: 30 minutes
**Developer**: backend-developer
**Verification**: No SessionManager import errors remain

---

### Task 1A.5: Remove Frontend Service Exports (Frontend)

**Objective**: Clean up index.ts exports for deleted services

**File**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\index.ts

**Changes**:

```typescript
// Comment out deleted service exports
// export { ChatValidationService } from './chat-validation.service'; // DELETED
// export { ClaudeMessageTransformerService } from './claude-message-transformer.service'; // DELETED
// export { MessageProcessingService } from './message-processing.service'; // DELETED
// export { ProviderService } from './provider.service'; // DELETED
```

**Errors Fixed**: 4 errors in frontend/core
**Effort**: 10 minutes
**Developer**: frontend-developer
**Verification**: No export errors remain

---

### Task 1A.6: Fix chat-state.service.ts Import (Frontend)

**Objective**: Remove ClaudeMessageTransformerService import

**File**: D:\projects\ptah-extension\libs\frontend\core\src\lib\services\chat-state.service.ts

**Changes**:

```typescript
// import { ClaudeMessageTransformerService, ProcessedClaudeMessage } from './claude-message-transformer.service'; // DELETED
type ProcessedClaudeMessage = any; // TODO: Phase 2 RPC - restore proper type
```

**Errors Fixed**: 1 error in chat-state.service.ts
**Effort**: 5 minutes
**Developer**: frontend-developer
**Verification**: File compiles without import errors

---

## Phase 1B: Verify Clean Slate

### Task 1B.1: Run Full Build Verification

**Objective**: Verify all libraries build with zero errors

**Commands**:

```bash
npm run build:all
```

**Success Criteria**:

- ✅ Exit code: 0
- ✅ All libraries build successfully
- ✅ Zero TypeScript compilation errors
- ✅ Zero esbuild errors
- ✅ No blocked dependencies

**Note**: Extension may not LAUNCH yet (expected - Phase 2 RPC will fix runtime)

**Effort**: 5 minutes
**Developer**: backend-developer (runs command)
**Verification**: Build output shows "Build completed successfully"

---

## Commit Strategy

**Phase 1A Commit**:

```
fix(vscode): repair phase 0 collateral damage

- fix esbuild config: add vscode to externals in llm-abstraction
- restore ai-providers-core files: vscode-lm-adapter, provider-manager, etc
- remove provider library dependencies from frontend (30+ files)
- complete sessionmanager and eventbus comment-outs
- remove deleted service exports from frontend index

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

**Phase 1B Commit** (if verification changes needed):

```
test(vscode): verify clean slate build passes

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude <noreply@anthropic.com>
```

---

## Effort Estimate

- Task 1A.1: 5 minutes (esbuild config)
- Task 1A.2: 30 minutes (restore files)
- Task 1A.3: 2 hours (remove provider UI)
- Task 1A.4: 30 minutes (SessionManager)
- Task 1A.5: 10 minutes (exports)
- Task 1A.6: 5 minutes (chat-state)
- Task 1B.1: 5 minutes (verification)

**Total**: ~3.5 hours

---

## Success Criteria

**Phase 1A Complete**:

- ✅ esbuild config fixed
- ✅ 5 ai-providers-core files restored
- ✅ All @ptah-extension/providers references removed
- ✅ All SessionManager/EventBus references commented out
- ✅ All deleted service exports removed

**Phase 1B Complete**:

- ✅ `npm run build:all` passes with exit code 0
- ✅ Zero compilation errors
- ✅ Clean slate achieved

**Ready for Batch 2**: RPC implementation can now proceed on solid foundation

---

**Next Action**: Invoke team-leader to create atomic tasks from this scope
