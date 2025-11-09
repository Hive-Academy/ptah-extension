# TASK_FE_001 - Angular Frontend Library Extraction & Modernization

**Task ID**: TASK_FE_001  
**Task Name**: Angular Frontend Library Extraction & Modernization  
**MONSTER Week**: 7-9 (Frontend Libraries & Angular Modernization)  
**Created**: October 11, 2025  
**Updated**: October 11, 2025  
**Priority**: HIGH (Blocks Week 7-9 completion)  
**Estimated Effort**: 15 days (3 weeks)

---

## 📋 User Request (October 11, 2025)

> "I would like to focus now on angular implementation. I think our backend as is, is actually fine, and we need to work next into planning the extractions of our old angular application into dedicated components. Let's re-scan all the frontend requirements from our monster plan and let's analyze our current angular project to create a new task that will be responsible into that critical and important migrations."

---

## 🎯 Business Context

The Ptah extension currently has a **monolithic Angular webview application** (`apps/ptah-extension-webview/`) with all components, services, and features tightly coupled in a single app. This violates the MONSTER plan's modular architecture and prevents:

1. **Code Reusability** - Components cannot be shared across potential future applications
2. **Independent Testing** - Feature libraries cannot be tested in isolation
3. **Team Scalability** - Multiple developers cannot work on isolated features
4. **Modern Angular Patterns** - Current code uses legacy decorators instead of signals
5. **Performance Optimization** - No OnPush change detection, using old control flow syntax

---

## 🏗️ Current Architecture Problems

### Monolithic Structure

All code lives in `apps/ptah-extension-webview/src/app/`:

```
app/
├── features/
│   ├── analytics/     (3 components, ~500 lines)
│   ├── chat/          (13 components, ~3,500 lines)
│   ├── dashboard/     (5 components, ~1,200 lines)
│   ├── providers/     (3 components, ~1,300 lines)
│   └── session/       (3 components, ~1,500 lines)
├── shared/
│   └── components/    (15+ components, ~3,000 lines)
└── core/
    └── services/      (15+ services, ~2,000 lines)
```

**Total**: ~13,000 lines of Angular code in ONE application

### Legacy Angular Patterns

**Codebase Analysis Results (October 11, 2025)**:

- ❌ **0% signal adoption** - All components use `@Input()`, `@Output()` decorators
- ⚠️ **10% modern control flow** - Main app uses `@if`, but 90% of templates use `*ngIf`, `*ngFor`
- ❌ **No OnPush change detection** - Default change detection everywhere
- ❌ **Legacy lifecycle hooks** - `OnInit`, `OnDestroy`, `AfterViewInit` instead of effects
- ❌ **Service-based state** - No signal-based reactive state management
- ❌ **42+ components** with legacy patterns
- ❌ **16+ services** without signal-based state

---

## 🎯 MONSTER Plan Alignment

### Week 7: Angular Signal Migration & Modern Control Flow

**From MONSTER_EXTENSION_REFACTOR_PLAN.md**:

**Required Changes**:

1. Convert all `@Input()` → `input<T>()`
2. Convert all `@Output()` → `output<T>()`
3. Convert all `@ViewChild()` → `viewChild<T>()`
4. Migrate all `*ngIf` → `@if`
5. Migrate all `*ngFor` → `@for`
6. Migrate all `*ngSwitch` → `@switch`
7. Implement OnPush change detection everywhere
8. Signal-based state management in services

**Expected Performance Gains**:

- 30% reduction in change detection cycles
- 40% faster template rendering
- 50% reduction in unnecessary re-renders

### Unified Library Structure

**Required frontend libraries** (from MONSTER plan):

- `libs/frontend/chat/` - Chat components and services
- `libs/frontend/session/` - Session management UI
- `libs/frontend/analytics/` - Analytics dashboard components
- `libs/frontend/dashboard/` - Main dashboard components
- `libs/frontend/providers/` - Provider selection and settings UI
- `libs/frontend/shared-ui/` - Reusable Egyptian-themed components
- `libs/frontend/core/` - Core Angular services

**Current Status**: All libraries exist but are empty (placeholder components only)

---

## 📊 Current Codebase Inventory

### Components Analysis

| Feature   | Components | Lines      | Using Signals | Modern CF | OnPush   | Status              |
| --------- | ---------- | ---------- | ------------- | --------- | -------- | ------------------- |
| Chat      | 13         | 3,500      | ❌ 0%         | ❌ 10%    | ❌ 0%    | In monolithic app   |
| Session   | 3          | 1,500      | ❌ 0%         | ❌ 10%    | ❌ 0%    | In monolithic app   |
| Dashboard | 5          | 1,200      | ❌ 0%         | ❌ 10%    | ❌ 0%    | In monolithic app   |
| Providers | 3          | 1,300      | ❌ 0%         | ❌ 10%    | ❌ 0%    | In monolithic app   |
| Analytics | 3          | 500        | ❌ 0%         | ❌ 10%    | ❌ 0%    | In monolithic app   |
| Shared UI | 15+        | 3,000      | ❌ 0%         | ❌ 10%    | ❌ 0%    | In monolithic app   |
| **TOTAL** | **42+**    | **13,000** | **0/42**      | **~4/42** | **0/42** | **Needs migration** |

### Services Analysis

| Category       | Services | Lines     | Signal State | Status              |
| -------------- | -------- | --------- | ------------ | ------------------- |
| Chat           | 5        | 800       | ❌ 0%        | In monolithic app   |
| State Mgmt     | 3        | 600       | ❌ 0%        | In monolithic app   |
| VS Code Bridge | 4        | 500       | ❌ 0%        | In monolithic app   |
| Analytics      | 1        | 200       | ❌ 0%        | In monolithic app   |
| Utilities      | 3        | 400       | ❌ 0%        | In monolithic app   |
| **TOTAL**      | **16**   | **2,500** | **0/16**     | **Needs migration** |

---

## 🚨 Critical Scope

This task encompasses **THREE major workstreams**:

### 1. Library Extraction (Structural)

- Move components from `apps/ptah-extension-webview/src/app/features/` to `libs/frontend/`
- Move shared components to `libs/frontend/shared-ui/`
- Move core services to `libs/frontend/core/`
- Update all imports and module structures
- Ensure zero circular dependencies

### 2. Angular Modernization (Technical Debt)

- Convert 42+ components from decorators to signals
- Migrate 90% of templates to modern control flow
- Implement OnPush change detection on all components
- Convert services to signal-based state management
- Update all lifecycle hooks to effects

### 3. Performance Optimization (Quality)

- Implement performance monitoring
- Measure change detection improvements
- Optimize bundle sizes per library
- Add performance budgets to nx.json

---

## 🎯 Success Criteria

### Phase 1: Library Structure (Week 7, Days 1-2)

- [ ] All 6 frontend libraries have proper folder structure
- [ ] Component extraction mapping documented
- [ ] Service extraction mapping documented
- [ ] Import path migration strategy defined

### Phase 2: Signal Migration (Week 7, Days 3-5)

- [ ] 100% components using `input()`, `output()`
- [ ] 100% services using signal-based state
- [ ] Zero `@Input()`, `@Output()` decorators remaining
- [ ] All ViewChild/ContentChild migrated

### Phase 3: Control Flow Migration (Week 8, Days 1-3)

- [ ] 100% templates using `@if`, `@for`, `@switch`
- [ ] Zero `*ngIf`, `*ngFor`, `*ngSwitch` remaining
- [ ] Performance benchmarks showing 30%+ improvement

### Phase 4: OnPush & Optimization (Week 8, Days 4-5)

- [ ] 100% components using OnPush change detection
- [ ] Performance monitoring implemented
- [ ] Bundle size reduced by 50% per feature

### Phase 5: Theme Integration (Week 9, Days 1-5)

- [ ] VS Code theme tokens extracted
- [ ] All components using design tokens
- [ ] Dynamic theme switching implemented

---

## 📅 Timeline

**Total Effort**: 15 working days (3 weeks)

**Week 7 (5 days)**: Library extraction + Signal migration  
**Week 8 (5 days)**: Control flow migration + Performance  
**Week 9 (5 days)**: Theme integration + Testing

---

## 🔗 Dependencies

### Completed (Backend)

- ✅ TASK_PRV_005 - Workspace Intelligence Library
- ✅ MAIN_APP_CLEANUP - EventBus Architecture Migration
- ✅ Weeks 1-6 backend infrastructure

### Blocks

- 📋 TASK_INT_001 - Final Library Integration (needs frontend complete)

---

## 📚 Reference Documents

- `docs/MONSTER_EXTENSION_REFACTOR_PLAN.md` (Week 7-9 requirements)
- `docs/guides/MODERN_ANGULAR_GUIDE.md` (Angular 20+ best practices)
- `.github/copilot-instructions.md` (Project standards)
- `AGENTS.md` (Quality gates)

---

**Next Step**: Create `task-description.md` with SMART requirements and BDD acceptance criteria
