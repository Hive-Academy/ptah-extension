# Batch 18 Report: Harness Prompt Isolation

## Overview
- **Task ID**: TASK_2026_494 Batch 18 (Harness Prompt Isolation)
- **Worktree Root**: `D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772`
- **Status**: COMPLETE

## Modified and Created Files
1. **MODIFY**: `D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/frontend/harness-builder/src/lib/services/harness-workflow.service.ts`
2. **MODIFY**: `D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts`
3. **CREATE**: `D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/frontend/harness-builder/src/lib/components/harness-builder-view.prompt-isolation.spec.ts`

---

## Filter Changes (Before and After)

### 1. `surfacePermissions` Filter

#### Before:
```typescript
  protected readonly surfacePermissions = computed(() =>
    this.permissionHandler
      .permissionRequests()
      .filter((p) => this.permissionHandler.hasSurfaceTargets(p.id)),
  );
```

#### After:
```typescript
  protected readonly surfacePermissions = computed(() => {
    if (typeof this.workflow.surfaceId !== 'function') {
      return this.permissionHandler
        .permissionRequests()
        .filter((p) => this.permissionHandler.hasSurfaceTargets(p.id));
    }
    const surfaceId = this.workflow.surfaceId();
    if (!surfaceId) return [];
    return this.permissionHandler
      .permissionRequests()
      .filter((p) =>
        this.permissionHandler.targetTabsFor(p.id).includes(surfaceId),
      );
  });
```

---

### 2. `surfaceQuestions` Filter

#### Before:
```typescript
  protected readonly surfaceQuestions = computed(() =>
    this.permissionHandler
      .questionRequests()
      .filter((q) => this.permissionHandler.hasSurfaceQuestionTargets(q.id)),
  );
```

#### After:
```typescript
  protected readonly surfaceQuestions = computed(() => {
    if (typeof this.workflow.surfaceId !== 'function') {
      return this.permissionHandler
        .questionRequests()
        .filter((q) => this.permissionHandler.hasSurfaceQuestionTargets(q.id));
    }
    const surfaceId = this.workflow.surfaceId();
    if (!surfaceId) return [];
    return this.permissionHandler
      .questionRequests()
      .filter((q) =>
        this.permissionHandler.questionTargetTabsFor(q.id).includes(surfaceId),
      );
  });
```

---

## Service Changes
In `D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772/libs/frontend/harness-builder/src/lib/services/harness-workflow.service.ts`:
Exposed the public readonly signal:
```typescript
  readonly surfaceId = this._surfaceId.asReadonly();
```

---

## Test Verification

Command:
```powershell
npx nx run-many -t lint,typecheck,test -p @ptah-extension/harness-builder --skip-nx-cache
```

Output Tail:
```
√  nx run @ptah-extension/harness-builder:test
√  nx run @ptah-extension/harness-builder:lint
√  nx run @ptah-extension/harness-builder:typecheck

 NX   Successfully ran targets lint, typecheck, test for project @ptah-extension/harness-builder

Output of 3 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

  Run duration:      19.6s
  Cache:             Skipped (--skip-nx-cache)
  Critical path:     19.5s (1 task)
  Recoverable time:  99ms (1% of the run)
```
- Existing `harness-builder-view.component.spec.ts` remains green unchanged (120/120 tests passed).
- New `harness-builder-view.prompt-isolation.spec.ts` passes (8/8 tests passed).
- Total test suite: 6 passed, 6 total (128 tests passing).
