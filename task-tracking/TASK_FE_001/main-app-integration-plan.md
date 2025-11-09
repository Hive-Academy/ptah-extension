# Main App Integration & Cleanup Plan

**Task ID**: TASK_FE_001 (Step 7 - Integration)  
**Created**: January 15, 2025  
**Status**: Planning  
**Priority**: HIGH - Required before Step 6 (Performance & Theme)

---

## 🎯 Objective

Clean up the monolithic webview app and integrate all migrated libraries:

- Update main app to import from migrated libraries (`@ptah-extension/*`)
- Remove old component files from `apps/ptah-extension-webview/src/app/features/`
- Update all service imports to use library paths
- Test all functionality in Extension Development Host
- Validate no regressions introduced

---

## 📊 Current State Analysis

### Main App Dependencies (app.ts)

**Current Imports** (OLD - from monolithic app):

```typescript
import { AppStateManager } from './core/services/app-state.service';
import { ViewManagerService } from './core/services/view-manager.service';
import { VSCodeService } from './core/services/vscode.service';
import { WebviewNavigationService } from './core/services/webview-navigation.service';
import { VSCodeChatComponent } from './features/chat/containers/chat.component';
import { AnalyticsComponent } from './features/analytics/containers/analytics.component';
import { VSCodeLoadingSpinnerComponent } from './shared/components/ui/loading-spinner.component';
```

**Target Imports** (NEW - from libraries):

```typescript
// Core services from @ptah-extension/core
import { AppStateManager, ViewManagerService, VSCodeService, WebviewNavigationService } from '@ptah-extension/core';

// Chat container from @ptah-extension/chat
import { ChatComponent } from '@ptah-extension/chat';

// Analytics container from @ptah-extension/analytics
import { AnalyticsComponent } from '@ptah-extension/analytics';

// Loading spinner from @ptah-extension/shared-ui
import { LoadingSpinnerComponent } from '@ptah-extension/shared-ui';
```

### Template Selector Updates (app.html)

**Current Selectors**:

- `<vscode-loading-spinner>` → `<ptah-loading-spinner>`
- `<vscode-chat>` → `<ptah-chat>` (container)
- `<vscode-analytics>` → `<ptah-analytics>` (container)

---

## 🗂️ Files to Update

### Phase 1: Delete Old Code First (15 min) ⚡ **START HERE**

**Why Delete First?**

- Forces TypeScript to show us EVERY import that needs fixing
- No ambiguity about which code to use
- Immediate validation - build fails = we have work to do
- Prevents accidentally using old code paths

### Phase 1a: Delete Old Feature Directories

**Directories to Remove**:

```bash
# Chat feature - ALL components migrated to @ptah-extension/chat
apps/ptah-extension-webview/src/app/features/chat/

# Session feature - ALL components migrated to @ptah-extension/session
apps/ptah-extension-webview/src/app/features/session/

# Analytics feature - ALL components migrated to @ptah-extension/analytics
apps/ptah-extension-webview/src/app/features/analytics/

# Dashboard feature - ALL components migrated to @ptah-extension/dashboard
apps/ptah-extension-webview/src/app/features/dashboard/

# Providers feature - ALL components migrated to @ptah-extension/providers
apps/ptah-extension-webview/src/app/features/providers/
```

**Verification Before Deletion**:

- [x] All 13 chat components confirmed in `libs/frontend/chat/`
- [x] All 3 session components confirmed in `libs/frontend/session/`
- [x] All 4 analytics components confirmed in `libs/frontend/analytics/`
- [x] All 5 dashboard components confirmed in `libs/frontend/dashboard/`
- [x] All 3 provider components confirmed in `libs/frontend/providers/`

**Command**:

```bash
# DO NOT run yet - manual verification first
rm -rf apps/ptah-extension-webview/src/app/features/chat/
rm -rf apps/ptah-extension-webview/src/app/features/session/
rm -rf apps/ptah-extension-webview/src/app/features/analytics/
rm -rf apps/ptah-extension-webview/src/app/features/dashboard/
rm -rf apps/ptah-extension-webview/src/app/features/providers/
```

---

### Phase 1b: Delete Old Shared Components (5 min)

**Directory to Remove**:

```bash
# Shared UI components - ALL migrated to @ptah-extension/shared-ui
apps/ptah-extension-webview/src/app/shared/components/
```

**Verification**:

- [x] All 13 shared-ui components confirmed in `libs/frontend/shared-ui/`
- [x] No other components importing from this directory

**Command**:

```bash
# DO NOT run yet - manual verification first
rm -rf apps/ptah-extension-webview/src/app/shared/components/
```

---

### Phase 1c: Delete Old Core Services (5 min)

**Directory to Remove**:

```bash
# Core services - ALL migrated to @ptah-extension/core
apps/ptah-extension-webview/src/app/core/services/
```

**Verification**:

- [x] All 16 services confirmed in `libs/frontend/core/`
- [x] Main app updated to import from `@ptah-extension/core`

**Keep**:

```bash
# Keep core directory but only with models/types if any remain
apps/ptah-extension-webview/src/app/core/
```

**Command**:

```bash
# DO NOT run yet - manual verification first
rm -rf apps/ptah-extension-webview/src/app/core/services/
```

---

### Phase 2: Fix Build Errors (45 min) 🔧 **COMPILER-DRIVEN**

**Strategy**: Let TypeScript tell us what to fix!

**Step 1: Run Build to See All Errors**

```bash
npm run build:webview
```

**Expected Errors**: ~10-20 TypeScript compilation errors showing:

- Missing imports in `app.ts`
- Missing component selectors
- Any other files still using old paths

**Step 2: Fix Main App Component**

**File**: `apps/ptah-extension-webview/src/app/app.ts`

**Changes**:

1. ✅ Update service imports from `./core/services/*` → `@ptah-extension/core`
2. ✅ Update chat import from `./features/chat/*` → `@ptah-extension/chat`
3. ✅ Update analytics import from `./features/analytics/*` → `@ptah-extension/analytics`
4. ✅ Update loading spinner import from `./shared/components/ui/*` → `@ptah-extension/shared-ui`
5. ✅ Update component names in imports array

**File**: `apps/ptah-extension-webview/src/app/app.html`

**Changes**:

1. ✅ Update `<vscode-loading-spinner>` → `<ptah-loading-spinner>`
2. ✅ Update `<vscode-chat>` → `<ptah-chat>`
3. ✅ Update `<vscode-analytics>` → `<ptah-analytics>`

**Step 3: Fix Any Other Files With Errors**

Review build output and fix remaining import errors one by one.

---

### Phase 3: Update app.config.ts (if needed) (15 min)

**File**: `apps/ptah-extension-webview/src/app/app.config.ts`

**Check**:

- Are there route configurations that need library imports?
- Are there providers that need to be updated?

**Update**:

- Import any necessary services from `@ptah-extension/core`
- Update route lazy loading to use library paths

---

## ✅ Validation Checklist

### Build Validation

- [ ] `npm run build:webview` completes successfully (zero errors)
- [ ] `npm run lint:webview` passes with zero errors
- [ ] `npm run typecheck:webview` passes with zero TypeScript errors
- [ ] Bundle size is reduced (check dist/ folder)

### Functional Testing

- [ ] Extension Development Host (F5) launches successfully
- [ ] Ptah webview opens without errors
- [ ] **Chat View**:
  - [ ] Chat interface renders correctly
  - [ ] Can send messages
  - [ ] Messages display properly
  - [ ] Streaming works
  - [ ] File attachments work
  - [ ] Token usage displays
- [ ] **Analytics View**:
  - [ ] Analytics dashboard renders
  - [ ] Metrics display correctly
  - [ ] Charts/graphs render
- [ ] **View Switching**:
  - [ ] Can switch between chat and analytics
  - [ ] State persists when switching views
  - [ ] No console errors during navigation

### Component Library Testing

- [ ] `nx run chat:build` succeeds
- [ ] `nx run session:build` succeeds
- [ ] `nx run analytics:build` succeeds
- [ ] `nx run dashboard:build` succeeds
- [ ] `nx run providers:build` succeeds
- [ ] `nx run shared-ui:build` succeeds
- [ ] `nx run core:build` succeeds

### Import Validation

- [ ] Zero imports from `./features/*` in main app
- [ ] Zero imports from `./shared/components/*` in main app
- [ ] Zero imports from `./core/services/*` in main app (except models if kept)
- [ ] All imports use `@ptah-extension/*` aliases

---

## 🚨 Rollback Plan

If integration causes critical issues:

1. **Git Stash Changes**:

   ```bash
   git stash save "Integration attempt - rolling back"
   ```

2. **Return to Previous Commit**:

   ```bash
   git reset --hard HEAD~1
   ```

3. **Document Issues**:
   - Create issue in main-app-integration-issues.md
   - Identify specific breaking imports
   - Fix issues before re-attempting

---

## 📈 Success Metrics

**Before Integration**:

- Monolithic app: ~13,000 lines in features/
- Monolithic app: ~2,500 lines in core/services/
- Monolithic app: ~3,000 lines in shared/components/

**After Integration**:

- Main app: <500 lines (routing shell only)
- Libraries: ~18,500 lines (modular, testable)
- Bundle size: Reduced by lazy loading

**Quality**:

- Zero TypeScript errors
- Zero lint warnings
- All functionality working
- No regressions

---

## 🎯 Timeline

**Total Estimated Time**: 2-3 hours

**Breakdown**:

- Phase 1a (Delete features): 5 min
- Phase 1b (Delete shared): 3 min
- Phase 1c (Delete core): 3 min
- Phase 2 (Fix build errors): 45 min
- Phase 3 (Config updates): 15 min
- Build validation: 15 min
- Functional testing: 45 min
- Buffer for fixes: 30 min

---

**Next Action**: Begin Phase 1a - Delete old feature directories (forces TypeScript to show us what to fix)
