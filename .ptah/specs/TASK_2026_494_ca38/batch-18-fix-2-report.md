# Batch 18 Fix Round 2 Report: Harness Prompt Isolation

## Overview
- **Task**: TASK_2026_494 Batch 18 Fix Round 2 (Final)
- **Worktree Root**: `D:/projects/ptah-extension/.claude-worktrees/feat-task-494-apps-page-98c5a1802772`
- **Status**: COMPLETE

---

## Final Filter Code

In `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.ts`:

```typescript
  protected readonly surfacePermissions = computed(() => {
    this.permissionHandler.routingTargetRevision();
    const surfaceId = this.workflow.surfaceId();
    if (!surfaceId) return [];
    return this.permissionHandler
      .permissionRequests()
      .filter(
        (p) =>
          this.permissionHandler.hasSurfaceTargets(p.id) &&
          this.permissionHandler.targetTabsFor(p.id).includes(surfaceId),
      );
  });

  protected readonly surfaceQuestions = computed(() => {
    this.permissionHandler.routingTargetRevision();
    const surfaceId = this.workflow.surfaceId();
    if (!surfaceId) return [];
    return this.permissionHandler
      .questionRequests()
      .filter(
        (q) =>
          this.permissionHandler.hasSurfaceQuestionTargets(q.id) &&
          this.permissionHandler
            .questionTargetTabsFor(q.id)
            .includes(surfaceId),
      );
  });
```

### Semantics Preserved
1. **Reactivity**: `this.permissionHandler.routingTargetRevision()` is read first in each computed. Any later attachment or update of routing targets reactively invalidates and re-evaluates prompt visibility.
2. **Null check**: `if (!surfaceId) return []` ensures that a null or unset surface ID shows no prompts.
3. **Surface-only check (`hasSurfaceTargets` / `hasSurfaceQuestionTargets`)**: Any prompt that has any live tab in its target list belongs to that chat tab and is excluded from the harness view, preventing duplicate renders or double-answers.
4. **Harness isolation check (`targetTabsFor` / `questionTargetTabsFor`)**: Prompts must explicitly contain this harness instance's `surfaceId` to render.
5. **No shims**: No `typeof` branches or production test-shims exist.

---

## Confirmation of `q-mixed` Fixture Restoration

In `libs/frontend/harness-builder/src/lib/components/harness-builder-view.component.spec.ts` (~line 456-460), the `q-mixed` target array is restored verbatim to:
```typescript
    permissions.handleQuestionRequest(makeQuestionRequest({ id: 'q-mixed' }));
    permissions.attachQuestionTargets('q-mixed', [
      'surface-harness-1',
      'tab-live',
    ]);
```
Its assertions pass unchanged under the real filter:
```typescript
    expect(probe().surfaceQuestions()).toEqual([surfaceQuestion]);
    expect(questionCards().map((c) => c.request.id)).toEqual(['q-mine']);
```
Because `'tab-live'` is a live tab, `hasSurfaceQuestionTargets('q-mixed')` evaluates to `false`, so `q-mixed` is excluded from the harness view despite containing `'surface-harness-1'`.

---

## New Test Names

In `libs/frontend/harness-builder/src/lib/components/harness-builder-view.prompt-isolation.spec.ts`:
1. `does not render a permission prompt targeted at both the harness surface id and a live tab id`
   - Target: `[HARNESS_SURFACE_ID, 'tab-live']`
   - Verifies `surfacePermissions` is empty and 0 cards render in the harness view.
2. `does not render a question prompt targeted at both the harness surface id and a live tab id`
   - Target: `[HARNESS_SURFACE_ID, 'tab-live']`
   - Verifies `surfaceQuestions` is empty and 0 cards render in the harness view.

All prior isolation and delayed-attachment regression tests remain active and passing.

---

## Test Counts & Verification

### Test Counts
- Total Test Suites: 6 passed, 6 total
- Total Tests: 132 passed, 132 total
  - `harness-builder-view.component.spec.ts`: 120 passed
  - `harness-builder-view.prompt-isolation.spec.ts`: 12 passed
  - `harness-builder-state.service.spec.ts`: passed
  - `harness-workflow-message.handler.spec.ts`: passed
  - `setup-hub.component.spec.ts`: passed
  - `harness-builder.spec.ts`: passed

### Verification Output
Command:
```powershell
npx nx run-many -t lint,typecheck,test -p @ptah-extension/harness-builder --skip-nx-cache
```

Last 10 lines of verification output:
```
√  nx run @ptah-extension/harness-builder:test
√  nx run @ptah-extension/harness-builder:lint
√  nx run @ptah-extension/harness-builder:typecheck



 NX   Successfully ran targets lint, typecheck, test for project @ptah-extension/harness-builder


Output of 3 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

  Run duration:      26.9s
  Cache:             Skipped (--skip-nx-cache)
  Critical path:     26.7s (1 task)
  Recoverable time:  194ms (1% of the run)
```
