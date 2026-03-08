# Task Context: TASK_2025_116

## Task ID

TASK_2025_116

## User Request

Fix all critical and serious issues identified in TASK_2025_114 QA reviews (code-style-reviewer + code-logic-reviewer)

## Task Type

BUGFIX (QA Follow-up)

## Complexity Assessment

**Medium** (Estimated 4-6 hours)

### Complexity Factors:

1. **Multiple Files**: 2 components + 1 service need modifications
2. **Clear Issue List**: QA reviews provide specific actionable items
3. **Backend Integration**: Need to add license verification after checkout
4. **Error Handling**: Multiple async edge cases to handle properly
5. **Code Quality**: Extract duplicate logic, remove debug statements

## Parent Task

TASK_2025_114 - Paddle Subscription Integration

## Strategy Selected

BUGFIX (Streamlined Workflow)

### Planned Agent Sequence:

1. **team-leader MODE 1** - Decompose QA fixes into batches
2. **frontend-developer** - Implement fixes batch-by-batch
3. **team-leader MODE 2/3** - Verify and commit each batch
4. **code-style-reviewer** - Re-verify style fixes
5. **code-logic-reviewer** - Re-verify logic fixes

## Issues to Fix

### Critical Issues (3 from Logic Review)

1. **No Backend Verification After Checkout** - Race condition risk
2. **Loading State Can Stick Forever** - No timeout/cleanup on error
3. **Placeholder Detection Fails Silently** - No user-facing error feedback

### Serious Issues (13 total: 8 style + 5 logic)

**Style Issues:**

1. Console.log in production code (3 files)
2. Direct environment imports vs DI tokens
3. Duplicate placeholder validation logic (2 files)
4. Missing error recovery UI feedback
5. Inline retry logic should be service method
6. Hard-coded retry parameters
7. Paddle type cast should use type guard
8. Loading state management scattered

**Logic Issues:**

1. No duplicate subscription prevention
2. No timeout for stuck checkout overlay
3. No environment config validation at startup
4. Concurrent SDK initialization can race
5. Auth service error loses user email context

## Files Affected

1. `apps/ptah-landing-page/src/app/services/paddle-checkout.service.ts`
2. `apps/ptah-landing-page/src/app/pages/pricing/components/pricing-grid.component.ts`
3. `apps/ptah-landing-page/src/app/pages/pricing/components/plan-card.component.ts`

## Success Criteria

1. Backend license verification after checkout completion
2. Loading state timeout + cleanup on all error paths
3. User-visible error for placeholder price IDs
4. All console.log removed from production code
5. Placeholder validation extracted to shared utility
6. Environment config validated at app startup
7. SDK initialization protected against concurrent calls
8. Checkout overlay has timeout protection
9. Auth errors preserve email context
10. QA re-reviews pass with score >= 8.5/10

## Created

2026-01-24

## Status

IN PROGRESS - Batch 1 assigned to frontend-developer
