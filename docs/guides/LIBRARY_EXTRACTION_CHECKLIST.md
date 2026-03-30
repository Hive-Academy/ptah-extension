# Library Extraction Checklist

**Purpose**: Step-by-step guide for extracting each feature library from monolithic Angular app  
**Task**: TASK_FE_001 - Angular Frontend Library Extraction & Modernization  
**Created**: October 12, 2025

---

## 📋 Pre-Extraction Preparation

### Before Starting Any Library

- [ ] Read this entire checklist
- [ ] Read `docs/guides/SIGNAL_MIGRATION_GUIDE.md`
- [ ] Read `docs/guides/MODERN_ANGULAR_GUIDE.md`
- [ ] Run `nx graph` to capture baseline dependency graph (save screenshot)
- [ ] Create git branch for library: `git checkout -b feature/TASK_FE_001-extract-{library-name}`
- [ ] Run baseline performance metrics (bundle size, render time)
- [ ] Run full test suite: `nx test ptah-extension-webview` (capture coverage report)

---

## 🔄 Per-Library Extraction Process

Follow this checklist for each library extraction (shared-ui, core, chat, session, analytics, dashboard, providers).

### Phase 1: Component Discovery & Planning (30 minutes)

#### 1.1 Identify Components

- [ ] Open `.ptah/specs/TASK_FE_001/implementation-plan.md`
- [ ] Find section for current library (e.g., "Chat Library")
- [ ] List all components to extract (with current file paths)
- [ ] Note estimated LOC for each component
- [ ] Identify container vs presentational components

#### 1.2 Identify Dependencies

- [ ] List services required by components
- [ ] List shared types required (check `@ptah-extension/shared`)
- [ ] List shared UI components required (for feature libraries)
- [ ] Note any circular dependency risks
- [ ] Document findings in progress.md

---

### Phase 2: Library Structure Setup (15 minutes)

#### 2.1 Create Folder Structure

```bash
# For feature libraries (chat, session, analytics, dashboard, providers)
mkdir -p libs/frontend/{library}/src/lib/components
mkdir -p libs/frontend/{library}/src/lib/containers
mkdir -p libs/frontend/{library}/src/lib/models

# For shared-ui library
mkdir -p libs/frontend/shared-ui/src/lib/forms
mkdir -p libs/frontend/shared-ui/src/lib/ui
mkdir -p libs/frontend/shared-ui/src/lib/layout
mkdir -p libs/frontend/shared-ui/src/lib/overlays

# For core library
mkdir -p libs/frontend/core/src/lib/services
mkdir -p libs/frontend/core/src/lib/models
```

#### 2.2 Verify Library Configuration

- [ ] Check `libs/frontend/{library}/project.json` exists
- [ ] Verify import path in `tsconfig.base.json`: `@ptah-extension/{library}`
- [ ] Confirm `libs/frontend/{library}/src/index.ts` exists (barrel export file)
- [ ] Verify ESLint config exists: `libs/frontend/{library}/eslint.config.mjs`

---

### Phase 3: Component/Service Extraction (2-4 hours per library)

#### 3.1 Copy Files

**For Components:**

```bash
# Copy component files
cp apps/ptah-extension-webview/src/app/features/{feature}/components/{component}.component.ts \
   libs/frontend/{library}/src/lib/components/{component}/

cp apps/ptah-extension-webview/src/app/features/{feature}/components/{component}.component.html \
   libs/frontend/{library}/src/lib/components/{component}/

cp apps/ptah-extension-webview/src/app/features/{feature}/components/{component}.component.css \
   libs/frontend/{library}/src/lib/components/{component}/

cp apps/ptah-extension-webview/src/app/features/{feature}/components/{component}.component.spec.ts \
   libs/frontend/{library}/src/lib/components/{component}/
```

**For Services:**

```bash
# Copy service files
cp apps/ptah-extension-webview/src/app/core/services/{service}.service.ts \
   libs/frontend/core/src/lib/services/

cp apps/ptah-extension-webview/src/app/core/services/{service}.service.spec.ts \
   libs/frontend/core/src/lib/services/
```

- [ ] All component files copied
- [ ] All service files copied (if extracting core library)
- [ ] All test files copied

#### 3.2 Update Import Paths

**In copied component/service files:**

```typescript
// ❌ OLD (relative imports from monolithic app)
import { ChatMessage } from '../../../types/common.types';
import { VSCodeService } from '../../../core/services/vscode.service';

// ✅ NEW (library imports)
import { ChatMessage } from '@ptah-extension/shared';
import { VSCodeService } from '@ptah-extension/core';
```

- [ ] All imports updated to use `@ptah-extension/shared` for types
- [ ] All imports updated to use `@ptah-extension/core` for services
- [ ] All imports updated to use `@ptah-extension/shared-ui` for UI components
- [ ] No relative imports remain (verify with grep)

---

### Phase 4: Signal Migration (1-2 hours per library)

#### 4.1 Component Signal Migration

**For each component:**

1. **Convert @Input() to input<T>()**

```typescript
// ❌ BEFORE (decorator)
@Input() message!: ChatMessage;
@Input() isLoading: boolean = false;

// ✅ AFTER (signal)
readonly message = input.required<ChatMessage>();
readonly isLoading = input<boolean>(false);
```

2. **Convert @Output() to output<T>()**

```typescript
// ❌ BEFORE (decorator)
@Output() messageSelected = new EventEmitter<string>();
@Output() actionTriggered = new EventEmitter<void>();

// ✅ AFTER (signal)
readonly messageSelected = output<string>();
readonly actionTriggered = output<void>();
```

3. **Convert @ViewChild() to viewChild<T>()**

```typescript
// ❌ BEFORE (decorator)
@ViewChild('inputElement') inputElement!: ElementRef;

// ✅ AFTER (signal)
readonly inputElement = viewChild.required<ElementRef>('inputElement');
```

4. **Update Template Bindings**

```html
<!-- ❌ BEFORE (property binding) -->
<div>{{ message.content }}</div>
<button [disabled]="isLoading">Click</button>

<!-- ✅ AFTER (signal call) -->
<div>{{ message().content }}</div>
<button [disabled]="isLoading()">Click</button>
```

5. **Update Event Handlers**

```typescript
// ❌ BEFORE (EventEmitter)
onSelect(id: string): void {
  this.messageSelected.emit(id);
}

// ✅ AFTER (OutputEmitterRef)
onSelect(id: string): void {
  this.messageSelected.emit(id); // Same API!
}
```

- [ ] All @Input() converted to input<T>()
- [ ] All @Output() converted to output<T>()
- [ ] All @ViewChild() converted to viewChild<T>()
- [ ] All template bindings updated (add `()` for signals)
- [ ] Verify no decorator imports remain: `grep -r "@Input\|@Output\|@ViewChild" libs/frontend/{library}/`

#### 4.2 Service Signal Migration (Core Library Only)

**For each service:**

1. **Convert BehaviorSubject to signal()**

```typescript
// ❌ BEFORE (BehaviorSubject)
private currentView$ = new BehaviorSubject<ViewType>('chat');
readonly view$ = this.currentView$.asObservable();

setView(view: ViewType): void {
  this.currentView$.next(view);
}

// ✅ AFTER (signal)
private readonly _currentView = signal<ViewType>('chat');
readonly currentView = this._currentView.asReadonly();

setView(view: ViewType): void {
  this._currentView.set(view);
}
```

2. **Convert combineLatest to computed()**

```typescript
// ❌ BEFORE (combineLatest)
readonly viewState$ = combineLatest([this.view$, this.loading$]).pipe(
  map(([view, loading]) => ({ view, loading }))
);

// ✅ AFTER (computed)
readonly viewState = computed(() => ({
  view: this.currentView(),
  loading: this.isLoading(),
}));
```

3. **Convert .subscribe() to effect()**

```typescript
// ❌ BEFORE (.subscribe)
constructor() {
  this.view$.subscribe(view => {
    console.log('View changed:', view);
  });
}

// ✅ AFTER (effect)
constructor() {
  effect(() => {
    console.log('View changed:', this.currentView());
  });
}
```

- [ ] All BehaviorSubject converted to signal()
- [ ] All Observable getters converted to asReadonly()
- [ ] All combineLatest converted to computed()
- [ ] All .subscribe() converted to effect() (where appropriate)
- [ ] Verify no RxJS state imports remain: `grep -r "BehaviorSubject\|ReplaySubject" libs/frontend/core/`

---

### Phase 5: Modern Control Flow Migration (1 hour per library)

#### 5.1 Template Migration

**For each component template:**

1. **Convert \*ngIf to @if**

```html
<!-- ❌ BEFORE (*ngIf) -->
<div *ngIf="isLoading">Loading...</div>
<div *ngIf="message">{{ message.content }}</div>
<div *ngIf="!error">No error</div>

<!-- ✅ AFTER (@if) -->
@if (isLoading()) {
<div>Loading...</div>
} @if (message()) {
<div>{{ message().content }}</div>
} @if (!error()) {
<div>No error</div>
}
```

2. **Convert \*ngFor to @for**

```html
<!-- ❌ BEFORE (*ngFor) -->
<li *ngFor="let item of items; trackBy: trackFn">{{ item.name }}</li>

<!-- ✅ AFTER (@for with track) -->
@for (item of items(); track item.id) {
<li>{{ item.name }}</li>
}
```

3. **Convert \*ngSwitch to @switch**

```html
<!-- ❌ BEFORE (*ngSwitch) -->
<div [ngSwitch]="status">
  <p *ngSwitchCase="'loading'">Loading...</p>
  <p *ngSwitchCase="'error'">Error occurred</p>
  <p *ngSwitchDefault>Ready</p>
</div>

<!-- ✅ AFTER (@switch) -->
@switch (status()) { @case ('loading') {
<p>Loading...</p>
} @case ('error') {
<p>Error occurred</p>
} @default {
<p>Ready</p>
} }
```

- [ ] All \*ngIf converted to @if
- [ ] All \*ngFor converted to @for (with track)
- [ ] All \*ngSwitch converted to @switch
- [ ] Verify no structural directives remain: `grep -r "\*ngIf\|\*ngFor\|\*ngSwitch" libs/frontend/{library}/`

#### 5.2 Remove Structural Directive Imports

```typescript
// ❌ REMOVE these imports
import { NgIf, NgFor, NgSwitch, NgSwitchCase, NgSwitchDefault } from '@angular/common';

// Component imports array
@Component({
  imports: [
    // NgIf, NgFor, NgSwitch  ❌ REMOVE
    CommonModule, // ✅ Keep for pipes, etc.
  ],
})
```

- [ ] Structural directive imports removed from all components
- [ ] CommonModule retained for pipes/directives still needed

---

### Phase 6: OnPush Change Detection (30 minutes per library)

#### 6.1 Add OnPush to All Components

```typescript
import { Component, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-my-component',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush, // ✅ ADD THIS
  // ...
})
export class MyComponent {}
```

- [ ] OnPush added to all components
- [ ] Verify: `grep -r "changeDetection: ChangeDetectionStrategy.OnPush" libs/frontend/{library}/`
- [ ] Count should match number of components

#### 6.2 Verify Immutability

**Check for object mutations:**

```typescript
// ❌ BAD (mutates input)
updateItem(item: Item): void {
  this.items()[0].name = 'New Name'; // Mutates!
}

// ✅ GOOD (immutable update)
updateItem(item: Item): void {
  this.items.update((current) => current.map((i) => (i.id === item.id ? { ...i, name: 'New Name' } : i)));
}
```

- [ ] No direct object mutations found (grep for `this.{signal}()[{index}].{property} =`)
- [ ] All updates use `.set()` or `.update()`

---

### Phase 7: Test Migration (1 hour per library)

#### 7.1 Update Component Tests

**For each component test:**

1. **Update signal access**

```typescript
// ❌ BEFORE (property access)
component.message = { id: '1', content: 'Hello' };
expect(component.isLoading).toBe(false);

// ✅ AFTER (signal set/get)
component.message.set({ id: '1', content: 'Hello' });
expect(component.isLoading()).toBe(false);
```

2. **Update output testing**

```typescript
// ❌ BEFORE (EventEmitter spy)
const emitSpy = jest.spyOn(component.messageSelected, 'emit');

// ✅ AFTER (OutputEmitterRef spy)
const emitSpy = jest.spyOn(component.messageSelected, 'emit');
// Same API! No changes needed for output testing
```

3. **Test computed values**

```typescript
it('should compute displayText correctly', () => {
  component.data.set({ items: [{ id: '1', title: 'Test' }] });
  expect(component.displayText()).toBe('Test'); // Call computed as function
});
```

- [ ] All test signal access updated (use `.set()`, `.update()`, call with `()`)
- [ ] All computed value tests updated (call as functions)
- [ ] All tests pass: `nx test frontend-{library}`
- [ ] Coverage ≥80%: Check coverage report

#### 7.2 Update Service Tests (Core Library Only)

**For each service test:**

```typescript
it('should update state signal', () => {
  service.setView('analytics');
  expect(service.currentView()).toBe('analytics'); // Call signal as function
});

it('should compute derived state', () => {
  service.setLoading(false);
  expect(service.isActive()).toBe(true); // Call computed as function
});
```

- [ ] All service tests updated for signal APIs
- [ ] All tests pass: `nx test frontend-core`
- [ ] Coverage ≥80%

---

### Phase 8: Library Export Configuration (15 minutes)

#### 8.1 Update Barrel Export (index.ts)

**For feature libraries:**

```typescript
// libs/frontend/{library}/src/index.ts

// Export all components
export * from './lib/components/my-component/my-component.component';
export * from './lib/containers/my-container/my-container.component';

// Export all models
export * from './lib/models/my-component.models';
```

**For shared-ui library:**

```typescript
// libs/frontend/shared-ui/src/index.ts

// Export by category
export * from './lib/forms/input/input.component';
export * from './lib/forms/dropdown/dropdown.component';
export * from './lib/ui/loading-spinner/loading-spinner.component';
export * from './lib/layout/simple-header/simple-header.component';
export * from './lib/overlays/permission-popup/permission-popup.component';
```

**For core library:**

```typescript
// libs/frontend/core/src/index.ts

// Export all services
export * from './lib/services/app-state.service';
export * from './lib/services/vscode.service';
export * from './lib/services/provider.service';

// Export all models
export * from './lib/models/performance.models';
```

- [ ] All components exported
- [ ] All services exported (core library)
- [ ] All models/interfaces exported
- [ ] Verify exports: `cat libs/frontend/{library}/src/index.ts`

---

### Phase 9: Build Validation (30 minutes)

#### 9.1 Build Library

```bash
# Build single library
nx build frontend-{library}

# Expected output: "Successfully ran target build"
```

- [ ] Library builds successfully
- [ ] No TypeScript errors
- [ ] No circular dependency warnings
- [ ] Check `dist/libs/frontend/{library}/` exists

#### 9.2 Run Linting

```bash
# Lint library
nx lint frontend-{library}

# Expected output: "All files pass linting."
```

- [ ] Linting passes with zero warnings
- [ ] Fix any linting issues before proceeding

#### 9.3 Run Tests

```bash
# Test library
nx test frontend-{library}

# Expected output: All tests passing, coverage ≥80%
```

- [ ] All tests pass
- [ ] Coverage ≥80% for lines, branches, functions, statements
- [ ] Check coverage report: `coverage/libs/frontend/{library}/index.html`

---

### Phase 10: Main App Integration (1 hour per library)

#### 10.1 Update Main App Imports

**In main app files that use extracted components:**

```typescript
// ❌ BEFORE (local imports from monolithic app)
import { ChatHeaderComponent } from './features/chat/components/chat-header.component';

// ✅ AFTER (library imports)
import { ChatHeaderComponent } from '@ptah-extension/chat';
```

- [ ] All component imports updated in main app
- [ ] All service imports updated (if core library)
- [ ] No relative imports to old component locations remain

#### 10.2 Update Routes (if applicable)

**For feature libraries with routes:**

```typescript
// apps/ptah-extension-webview/src/app/app.config.ts

const routes: Routes = [
  {
    path: 'chat',
    loadComponent: () => import('@ptah-extension/chat').then((m) => m.ChatComponent),
  },
  // ...
];
```

- [ ] All feature routes updated to lazy load from libraries
- [ ] Route imports point to library paths

#### 10.3 Test Extension in Development Host

```bash
# Build everything
npm run build:all

# Launch Extension Development Host (F5 in VS Code)
```

- [ ] Extension loads without errors
- [ ] Navigate to feature using extracted components
- [ ] All UI elements render correctly
- [ ] All user interactions work
- [ ] No console errors
- [ ] Theme switching works

---

### Phase 11: Performance Validation (30 minutes)

#### 11.1 Measure Bundle Size

```bash
# Build with webpack-bundle-analyzer
npm run build:webview -- --stats-json

# Analyze bundle
npx webpack-bundle-analyzer dist/apps/ptah-extension-webview/stats.json
```

- [ ] Measure bundle size for extracted library
- [ ] Document in progress.md
- [ ] Compare to baseline (target: -50% per feature library)

#### 11.2 Measure Change Detection

**Use Angular DevTools:**

1. Open Extension Development Host
2. Open Angular DevTools
3. Enable "Profiler"
4. Interact with extracted feature
5. Check change detection cycle count

- [ ] Measure change detection cycles
- [ ] Document in progress.md
- [ ] Compare to baseline (target: -30%)

#### 11.3 Measure Render Time

**Use Chrome DevTools:**

1. Open Extension Development Host
2. Open Chrome DevTools
3. Go to Performance tab
4. Record interaction with feature
5. Check render time

- [ ] Measure render time
- [ ] Document in progress.md
- [ ] Compare to baseline (target: -40%)

---

### Phase 12: Documentation & Cleanup (30 minutes)

#### 12.1 Update Progress Document

**In `.ptah/specs/TASK_FE_001/progress.md`:**

```markdown
### Step 2: {Library Name} Library Migration (Days X-Y) ✅

**Completed**: October 12, 2025

**Components Extracted**:

- [x] ComponentName1 (file path) - LOC: ~200
- [x] ComponentName2 (file path) - LOC: ~150

**Services Extracted** (if core library):

- [x] ServiceName1 (file path)

**Migration Statistics**:

- Signal inputs: 12/12 converted
- Signal outputs: 8/8 converted
- Modern control flow: 10/10 templates converted
- OnPush detection: 10/10 components
- Test coverage: 85% (above 80% threshold)

**Performance Metrics**:

- Bundle size: Reduced by 55% (baseline: 500KB, current: 225KB)
- Change detection: Reduced by 35% (baseline: 100 cycles, current: 65 cycles)
- Render time: Improved by 42% (baseline: 200ms, current: 116ms)

**Build Validation**:

- [x] `nx build frontend-{library}` succeeds
- [x] `nx lint frontend-{library}` passes
- [x] `nx test frontend-{library}` passes (coverage ≥80%)
- [x] Extension loads in Development Host
- [x] All features functional

**Files Modified**:

- Created: libs/frontend/{library}/src/lib/... (15 files)
- Updated: apps/ptah-extension-webview/src/app/... (3 files)
- Updated: .ptah/specs/TASK_FE_001/progress.md
```

- [ ] Progress document updated with all statistics
- [ ] All checklists marked complete

#### 12.2 Update Library README

**Update `libs/frontend/{library}/README.md`:**

- [ ] Change status from "🔄 Pending" to "✅ Complete"
- [ ] Update component/service count
- [ ] Add migration completion date

#### 12.3 Delete Old Component Files (After Validation!)

**Only after main app integration is validated:**

```bash
# Delete old component files from monolithic app
rm -rf apps/ptah-extension-webview/src/app/features/{feature}/components/{component}.*
```

- [ ] Old component files deleted from monolithic app
- [ ] Old service files deleted (if core library)
- [ ] Main app still builds and functions

---

### Phase 13: Git Commit & Push (15 minutes)

#### 13.1 Commit Changes

```bash
# Stage all changes
git add .

# Commit with descriptive message
git commit -m "feat(TASK_FE_001): Extract {library} library with signal migration

- Migrated {count} components to libs/frontend/{library}
- Converted all @Input/@Output to signal-based APIs
- Migrated all templates to modern control flow (@if, @for, @switch)
- Implemented OnPush change detection on all components
- Updated main app imports to use library
- Test coverage: {coverage}% (≥80% threshold)
- Performance: Bundle -55%, Change detection -35%, Render -42%

Closes: Step {X} of TASK_FE_001 implementation plan"

# Push to remote
git push origin feature/TASK_FE_001-extract-{library}
```

- [ ] All changes committed
- [ ] Commit message follows conventional commits format
- [ ] Changes pushed to remote

---

## 🎯 Library Extraction Order

**Follow this order** (from implementation plan):

1. **Week 1 (Days 1-5)**: Foundation + Shared UI
   - Days 1-2: Foundation setup (this checklist, documentation)
   - Days 3-5: **Shared UI Library** (13 components)

2. **Week 2 (Days 6-10)**: Core + Chat (start)
   - Days 6-8: **Core Library** (11 services)
   - Days 9-10: **Chat Library** (13 components + 5 services) - start

3. **Week 3 (Days 11-15)**: Chat (finish) + Providers + Session + Analytics + Dashboard + Performance + Theme
   - Day 11: **Chat Library** (finish) + **Providers Library** (3 components)
   - Day 12: **Session Library** (3 components) + **Analytics Library** (4 components)
   - Day 13: **Dashboard Library** (5 components) + integration testing
   - Days 14-15: Performance monitoring + theme integration

---

## ✅ Completion Criteria

Before marking library extraction complete:

- [ ] All components extracted and modernized
- [ ] All services extracted and modernized (if core library)
- [ ] Zero `@Input()`, `@Output()`, `@ViewChild()` decorators
- [ ] Zero `*ngIf`, `*ngFor`, `*ngSwitch` directives
- [ ] 100% OnPush change detection
- [ ] Library builds successfully
- [ ] Linting passes
- [ ] Tests pass with ≥80% coverage
- [ ] Main app integration working
- [ ] Performance metrics documented
- [ ] Progress.md updated
- [ ] Git committed and pushed

---

## 🚨 Common Issues & Solutions

### Issue: Circular Dependency Detected

**Symptom**: Build fails with "Circular dependency detected" error

**Solution**:

1. Run `nx graph` to visualize dependencies
2. Check if feature library imports another feature library (violation!)
3. Move shared logic to `@ptah-extension/shared-ui` or `@ptah-extension/core`
4. Refactor component composition to eliminate cycle

### Issue: Test Coverage Below 80%

**Symptom**: Coverage report shows <80% for lines/branches/functions

**Solution**:

1. Run `nx test frontend-{library} --coverage --verbose`
2. Check coverage report: `coverage/libs/frontend/{library}/index.html`
3. Identify uncovered lines (highlighted in red)
4. Add missing test cases for uncovered branches
5. Test computed values and edge cases

### Issue: OnPush Not Triggering Updates

**Symptom**: UI not updating when data changes

**Solution**:

1. Verify all inputs are signals (not plain properties)
2. Check for object mutations (should use `.update()` instead)
3. Ensure parent component passes signals, not plain objects
4. Use `ChangeDetectorRef.markForCheck()` as last resort (document as tech debt)

### Issue: Import Path Not Found

**Symptom**: `Cannot find module '@ptah-extension/{library}'`

**Solution**:

1. Check `tsconfig.base.json` has library path mapping
2. Verify `libs/frontend/{library}/src/index.ts` exports component
3. Restart TypeScript server in VS Code (`Cmd+Shift+P` → "Restart TS Server")
4. Rebuild library: `nx build frontend-{library}`

---

## 📚 Related Documentation

- **Signal Migration Guide**: `docs/guides/SIGNAL_MIGRATION_GUIDE.md`
- **Modern Angular Guide**: `docs/guides/MODERN_ANGULAR_GUIDE.md`
- **Implementation Plan**: `.ptah/specs/TASK_FE_001/implementation-plan.md`
- **Task Description**: `.ptah/specs/TASK_FE_001/task-description.md`

---

**Last Updated**: October 12, 2025  
**Status**: Foundation documentation complete, ready for library extraction  
**Next Step**: Extract Shared UI Library (Days 3-5)
