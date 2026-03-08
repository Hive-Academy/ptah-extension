# Development Tasks - TASK_2025_052

**Task Type**: Backend Bugfix  
**Total Tasks**: 4 | **Batches**: 1 | **Status**: 0/1 complete  
**Batching Strategy**: Single batch (related DI registration bugfix)

---

## Plan Validation Summary

**Validation Status**: PASSED - Clear bugfix with no blockers

### Root Cause Analysis

**Problem**: Extension activation fails at Step 8 when trying to resolve `TOKENS.PRICING_SERVICE`

**Evidence**:

- ✅ Token defined in `libs/backend/vscode-core/src/di/tokens.ts:138`
- ✅ Token used in `apps/ptah-extension-vscode/src/main.ts:75`
- ❌ Service class does NOT exist (no `PricingService` class found)
- ❌ No registration in `apps/ptah-extension-vscode/src/di/container.ts`

**Related Context**:

- `libs/shared/src/lib/utils/pricing.utils.ts` contains pricing utilities
- Functions `updatePricingMap()` and `getPricingMap()` suggest service should manage dynamic pricing
- Comments mention "PricingService after fetch" (line 168)
- SDK integration (`registerSdkServices`) does NOT include pricing service

### Assumptions Verified

1. ✅ Pricing utils exist and are functional (static fallback pricing works)
2. ✅ Token symbol is correctly defined
3. ✅ Extension expects service to have `initialize()` method (main.ts:75-83)

### Risks Identified

| Risk                               | Severity | Mitigation                                             |
| ---------------------------------- | -------- | ------------------------------------------------------ |
| No existing PricingService class   | HIGH     | Create new service implementing expected interface     |
| Unknown LiteLLM fetch requirements | MEDIUM   | Investigate existing fetch logic or use static pricing |

### Edge Cases to Handle

**Batch 1 Verification Requirements**:

- ✅ `PricingService` class exists at `libs/shared/src/lib/services/pricing.service.ts`
- ✅ Service exported from `libs/shared/src/index.ts`
- ✅ Service registered in DI container at correct location
- ✅ Extension activates without DI resolution error
- ✅ One git commit for entire batch
- ✅ Build passes: `npx nx build ptah-extension-vscode`
- ✅ Extension loads in debug mode without activation failure

---

## Batch Execution Protocol

**For This Batch**:

1. Team-leader assigns Batch 1 to backend-developer
2. Developer executes ALL tasks 1.1-1.4 IN ORDER
3. Developer stages files progressively (git add after each task)
4. Developer creates ONE commit for entire batch
5. Developer returns with batch git commit SHA + SDK analysis findings
6. Team-leader verifies entire batch
7. Team-leader marks tasks complete and returns to orchestrator

**Commit Strategy**:

- ONE commit per batch (not per task)
- Commit message format:

  ```
  fix(vscode): register PricingService in DI container

  - Task 1.1: Create PricingService class
  - Task 1.2: Export PricingService from shared library
  - Task 1.3: Register PricingService in DI container
  - Task 1.4: Verify SDK integration compatibility

  Fixes extension activation failure at Step 8

  Co-Authored-By: Claude <noreply@anthropic.com>
  ```

**Completion Criteria**:

- All task statuses are "✅ COMPLETE"
- Batch commit verified
- All files exist
- Extension activation succeeds
- Build passes
