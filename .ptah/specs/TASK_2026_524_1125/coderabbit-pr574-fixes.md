# CodeRabbit PR #574 Review Findings Fix Report

**Branch:** `refactor/task-524-batch2-surface-active`  
**Worktree:** `D:/projects/ptah-extension/.claude-worktrees/task-524-batch2-surface-active`  
**Deliverable File:** `.ptah/specs/TASK_2026_524_1125/coderabbit-pr574-fixes.md`

---

## Executive Summary

This report documents the resolution and verification of three CodeRabbit review findings on PR #574:

1. **Finding 1 (Major):** Fixed non-origin gate leak in `flushSync(originTabId)` in `BatchedUpdateService`, where non-origin pending updates that became unflushable after scheduling were force-flushed to `TabManager`. Added regression test confirming failure without fix and pass with fix.
2. **Finding 2 (Major):** Corrected stale Angular peer dependencies (`21.2.6` -> `22.1.7`) in `libs/frontend/core/package.json` and `libs/frontend/tribunal-panel/package.json`. Verified with `@nx/dependency-checks` linting.
3. **Finding 3 (Minor):** Corrected factual inaccuracies in `.ptah/specs/TASK_2026_524_1125/batch2-surface-active-report.md` regarding `libs/shared/src/angular/index.ts` and non-optional injection in webview consumers.

---

## Finding 1 (Major) — Non-Origin Tab Visibility Gate Leak in `BatchedUpdateService.flushSync`

### Location

- File: `libs/frontend/chat-streaming/src/lib/batched-update.service.ts`
- Lines: 224–226 (doc comment), 257–265 (logic)

### Problem Description

`flushSync(originTabId)` previously checked visibility only for entries already in `this.deferredTabUpdates`. It then called `this.flushPendingUpdates(true)` with `force=true`, which skipped `canFlush(tabId)` for _every_ entry in `this.pendingTabUpdates`.

If a non-origin tab was flushable when `scheduleUpdate` queued it into `this.pendingTabUpdates`, but subsequent state changes made it unflushable before the next animation frame (such as switching tabs or the document becoming hidden), an unrelated tab's `agent_start` calling `flushSync(originTabId)` force-flushed the non-origin tab to `TabManager`. This violated the contract guarantee: _"only the ORIGIN tab escapes the visibility gate."_

### Changes Made

1. **`batched-update.service.ts`**:
   - Before calling `flushPendingUpdates(true)`, when `originTabId !== undefined`, we iterate through `pendingTabUpdates`. For any tab `t !== originTabId` where `!this.canFlush(t)`, the update is moved from `pendingTabUpdates` to `deferredTabUpdates` and added to `pendingFlush`.
   - The no-argument `flushSync()` path (called by `MessageFinalizationService` for turn-end finalization) remains completely unchanged as an unconditional drain to prevent resurrecting stale streaming state over finalized messages.
   - Updated the doc comment on `flushSync` to explicitly note that non-origin pending updates that became inactivated/hidden are also moved to deferred.

```typescript
if (originTabId !== undefined) {
  for (const [tabId, state] of [...this.pendingTabUpdates]) {
    if (tabId !== originTabId && !this.canFlush(tabId)) {
      this.pendingTabUpdates.delete(tabId);
      this.deferredTabUpdates.set(tabId, state);
      this.pendingFlush.add(tabId);
    }
  }
}
```

2. **Regression Test (`batched-update.visibility.spec.ts`)**:
   - Added test: `'flushSync(origin) moves non-origin pending updates that became non-flushable to deferred'` at line 250.
   - Scenario:
     - `tab-bystander` is active when scheduled with `scheduleUpdate`, entering `pendingTabUpdates`.
     - Before rAF runs, active tab switches to `tab-origin`, making `canFlush('tab-bystander')` return `false`.
     - Origin tab triggers `flushSync('tab-origin')`.
     - Verified `tabManager.setStreamingState` is NOT called with `'tab-bystander'`, and `hasPendingUpdates('tab-bystander')` remains `true`.
     - When switching back to `tab-bystander` and running rAF, it safely drains to `tabManager.setStreamingState`.

### Proof of Failure Without Fix (Unpatched Run)

Command run against unpatched code:

```
npx nx run-many -t test --skip-nx-cache -p @ptah-extension/chat-streaming
```

Output:

```
Summary of all failing tests
FAIL src/lib/batched-update.visibility.spec.ts
  ● BatchedUpdateService — visibility gating (Batch B) › flushSync(origin) moves non-origin pending updates that became non-flushable to deferred

    expect(received).not.toContain(expected) // indexOf

    Expected value: not "tab-bystander"
    Received array:     ["tab-bystander"]

      262 |
      263 |     const tabIds = tabManager.setStreamingState.mock.calls.map((c) => c[0]);
    > 264 |     expect(tabIds).not.toContain('tab-bystander');
          |                        ^
      265 |     expect(service.hasPendingUpdates('tab-bystander')).toBe(true);
      266 |
      267 |     // Later, when tab-bystander becomes flushable again, it drains through normal paths

      at src/lib/batched-update.visibility.spec.ts:264:24

Test Suites: 1 failed, 23 passed, 24 total
Tests:       1 failed, 1 skipped, 505 passed, 507 total
Snapshots:   0 total
Time:        11.378 s, estimated 27 s
Ran all test suites.

 NX   Running target test for project @ptah-extension/chat-streaming failed
```

### Proof of Pass With Fix

Command run after applying fix:

```
npx nx run-many -t test --skip-nx-cache -p @ptah-extension/chat-streaming
```

Output:

```
 NX   Running target test for project @ptah-extension/chat-streaming:

- @ptah-extension/chat-streaming

√  nx run @ptah-extension/chat-streaming:test

 NX   Successfully ran target test for project @ptah-extension/chat-streaming

  Run duration:      14.9s
  Cache:             Skipped (--skip-nx-cache)
  Critical path:     14.8s (1 task)
```

---

## Finding 2 (Major) — Angular Peer Dependencies Mismatch

### Location

- `libs/frontend/core/package.json` (lines 22–25)
- `libs/frontend/tribunal-panel/package.json` (lines 14–17)

### Problem Description

Both `libs/frontend/core/package.json` and `libs/frontend/tribunal-panel/package.json` declared peer dependencies:

```json
  "peerDependencies": {
    "@angular/core": "21.2.6",
    "@angular/common": "21.2.6"
  }
```

The workspace runs Angular `22.1.7` (as declared in `libs/frontend/markdown/package.json` and `libs/frontend/ui/package.json`). Core now re-exports `SURFACE_ACTIVE` from `@ptah-extension/shared/angular`, whose optional peer dependency is `22.1.7`. The stale `21.2.6` peer declarations produced version mismatches.

### Changes Made

Updated both `package.json` files to `"22.1.7"`:

```json
  "peerDependencies": {
    "@angular/core": "22.1.7",
    "@angular/common": "22.1.7"
  }
```

Verified via `@nx/dependency-checks` under ESLint across `@ptah-extension/core`, `@ptah-extension/tribunal-panel`, and `@ptah-extension/shared`.

---

## Finding 3 (Minor) — Inaccuracies in `batch2-surface-active-report.md`

### Location

- `.ptah/specs/TASK_2026_524_1125/batch2-surface-active-report.md` (lines 7, 31–35)

### Problem Description

The document contained statements from a pre-commit draft that contradicted the actually committed code:

1. It claimed that `libs/shared/src/angular/index.ts`, its package export, and path mapping were removed, whereas all three are present and actively used in the codebase.
2. It claimed that webview consumers used optional injection (`inject(SURFACE_ACTIVE, { optional: true }) ?? signal(true)`), whereas all webview consumers inject the token non-optionally.

### Changes Made

Updated lines 7 and 31–35 to accurately state the shipped design:

- `libs/shared/src/angular/index.ts` is an Angular-only secondary entry point defining `SURFACE_ACTIVE = new InjectionToken<Signal<boolean>>('SURFACE_ACTIVE')`.
- `libs/shared/package.json` exposes it via `./angular` export with `@angular/core: "22.1.7"` in `peerDependencies` and marked optional in `peerDependenciesMeta`, preventing Node/CLI/server runtimes from resolving Angular.
- `tsconfig.base.json` maps `@ptah-extension/shared/angular` (omitted from application `tsconfig.build.json` files for Node runtimes).
- `libs/frontend/core/src/lib/routing/surface-active.ts` is a pure re-export (`export { SURFACE_ACTIVE } from '@ptah-extension/shared/angular';`), ensuring a single token instance.
- Markdown performs no injection: `SurfaceMarkdownPipe.transform(raw, active)` accepts activity as a pipe argument, and `MarkdownBlockComponent` accepts `active = input(true)`.
- Every `scope:webview` consumer injects `SURFACE_ACTIVE` non-optionally (`inject(SURFACE_ACTIVE)`). Missing providers fail loudly at construction rather than silently falling back to active. Tests bind using `provideSurfaceActiveTesting()`.

---

## Verification Commands and Real Output

### 1. Multi-Project Test Suite (4 Projects)

```powershell
$env:NX_DAEMON="false"; npx nx run-many -t test --skip-nx-cache -p @ptah-extension/chat-streaming @ptah-extension/core @ptah-extension/chat @ptah-extension/chat-routing
```

**Exact Output:**

```
 NX   --skip-nx-cache disables the connection to Nx Cloud for the current run.

The remote cache will not be read from or written to during this run.


 NX   Running target test for 4 projects:

- @ptah-extension/chat-streaming
- @ptah-extension/core
- @ptah-extension/chat
- @ptah-extension/chat-routing


√  nx run @ptah-extension/chat-streaming:test
√  nx run @ptah-extension/core:test
√  nx run @ptah-extension/chat-routing:test
√  nx run @ptah-extension/chat:test



 NX   Successfully ran target test for 4 projects


Output of 4 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

  Run duration:      58.2s
  Cache:             Skipped (--skip-nx-cache)
  Critical path:     35.4s (1 task)
  Recoverable time:  22.7s (39% of the run)
```

Header confirmed: **"Running target test for 4 projects"** (4 passed, 0 failed).

---

### 2. Multi-Project Lint Suite (4 Projects)

```powershell
$env:NX_DAEMON="false"; npx nx run-many -t lint --skip-nx-cache -p @ptah-extension/chat-streaming @ptah-extension/core @ptah-extension/tribunal-panel @ptah-extension/shared
```

**Exact Output:**

```
 NX   --skip-nx-cache disables the connection to Nx Cloud for the current run.

The remote cache will not be read from or written to during this run.


 NX   Running target lint for 4 projects:

- @ptah-extension/chat-streaming
- @ptah-extension/core
- @ptah-extension/tribunal-panel
- @ptah-extension/shared


√  nx run @ptah-extension/core:lint
√  nx run @ptah-extension/shared:lint
√  nx run @ptah-extension/tribunal-panel:lint
√  nx run @ptah-extension/chat-streaming:lint



 NX   Successfully ran target lint for 4 projects


Output of 4 successful tasks were not shown. Run with --verbose or --output-style=static to see it.

  Run duration:      15.1s
  Cache:             Skipped (--skip-nx-cache)
  Critical path:     8.8s (1 task)
  Recoverable time:  6.3s (42% of the run)
```

Header confirmed: **"Running target lint for 4 projects"** (4 passed, 0 failed, `@nx/dependency-checks` clean).
