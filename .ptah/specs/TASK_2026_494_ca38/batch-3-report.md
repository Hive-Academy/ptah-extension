# Batch 3 report

Completed Task 3.1: renderer contracts, public exports, and pure v1 dashboard view-model builder.

## Files created or modified (absolute paths)

- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\declarative-dashboard\src\lib\surface-view-state.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\declarative-dashboard\src\lib\surface-interaction.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\declarative-dashboard\src\lib\view-model\view-model.types.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\declarative-dashboard\src\lib\view-model\dashboard-view-model.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\declarative-dashboard\src\lib\view-model\dashboard-view-model.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\declarative-dashboard\src\index.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\.ptah\specs\TASK_2026_494_ca38\batch-3-report.md
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\.ptah\specs\TASK_2026_494_ca38\batch-3-format.log
- D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\.ptah\specs\TASK_2026_494_ca38\batch-3-verification.log

The five requested implementation/spec files were created; src/index.ts was modified. This report and the two local evidence logs were created. No git commands were run; no commits were created. batches.md, task.md, context.md, and prototype/ were not edited.

## Requirements and design

- SurfaceRenderable aliases SurfaceContent directly, so the v1/v2 discriminated union cannot drift from the host contract.
- SurfaceViewState holds per-component sort/filter/page/chart-as-table/expanded state and drafts. SURFACE_PAGE_SIZE is 25.
- SurfaceInteractionState models selection, unsynced selection, pending values, issues, action status, and submit disabling. Input, action and selection event types are exported, along with SurfaceActionUiState.
- SurfaceNode is the LayoutNode | InputNode | DisplayNode union. Kind-specific contract fields remain available through discriminated unions. Layout nodes include recursive children and submit actions; input nodes include host value and optional draft error; display nodes retain literal rich-text and display data fields.
- Every node type carries selectable. The v1/shared display mapper sets it true only for an exact dashboard.select declaration; labels and unrelated actions cannot enable selection. Later v2 builders can use the shared mapDisplayNode function.
- buildDashboardViewModel is pure: no DI, Angular, I/O, host calls, or source mutation. It creates new node/children arrays, retains readonly display payloads, and leaves text literal. Runtime shape errors throw TypeError for the planned renderer fallback; this is a projection of already-validated content, not a replacement wire validator.
- V1 nesting counts roots at depth 1 and omits descendants after DASHBOARD_LIMITS.maxTreeDepth (8); no deeper descendants are visited or leaked through source object spreading.
- R4 / D-4 resolved now: src/index.ts exports SurfaceRenderable, SurfaceViewState, SurfaceComponentViewState, SurfaceInteractionState, SurfaceInputCommit, SurfaceActionInvoke, SurfaceSelectionChange, SURFACE_PAGE_SIZE, buildDashboardViewModel, all public view-model types, and mapDisplayNode. Apps-state batches no longer need to wait for the renderer-component batch to obtain these types.
- External imports are limited to the allowed shared package aliases. Internal implementation imports are relative within this library. No dependency or configuration changes, zod imports, any casts, ts-ignore, or catch clauses were added. The library's strict typecheck passes.
- Spec coverage: all five v1 kinds and their fields; exact selectable true/false; ordered nesting at and beyond the maximum; empty tree; opaque data references; invalid envelope/component shapes; frozen source immutability and deterministic output; shared v2 display action-id retention; page size and public barrel imports. 17 tests pass.

## Verification

Command from the worktree root:

```text
npx nx run-many -t lint,typecheck,test -p @ptah-extension/declarative-dashboard --skip-nx-cache --output-style=static
```

Final exit code: 0. Lint, strict typecheck, and 1 test suite / 17 tests passed. The initial run caught recursive conditional type aliases; recursive fields were moved to interfaces and the same scoped command then passed. The final log is batch-3-verification.log.

Last 10 output lines:

```text



 NX   Successfully ran targets lint, typecheck, test for project @ptah-extension/declarative-dashboard


  Run duration:      4.1s
  Cache:             Skipped (--skip-nx-cache)
  Critical path:     3.8s (1 task)
  Recoverable time:  239ms (6% of the run)
```

No outstanding implementation or verification blockers.
