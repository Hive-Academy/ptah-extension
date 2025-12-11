# Research Report - TASK_2025_070

## Executive Intelligence Brief

**Research Classification**: CRITICAL BUG ANALYSIS - DEPENDENCY INJECTION VIOLATION
**Confidence Level**: 95% (based on error stack trace, source code analysis, Angular documentation, and git history)
**Key Insight**: The NG0203 error is caused by calling `toObservable()` (which internally uses `inject()`) inside the `setupInputPipeline()` method during `ngOnInit()` lifecycle hook execution, violating Angular's injection context rules.

---

## Root Cause Analysis

### Critical Finding: Injection Context Violation in setupInputPipeline()

**Location**:

- `libs/frontend/chat/src/lib/directives/at-trigger.directive.ts` (line 136)
- `libs/frontend/chat/src/lib/directives/slash-trigger.directive.ts` (line 143)

**Problem**: Both directives call `toObservable(this.dropdownOpen)` inside the `setupInputPipeline()` method, which is invoked from `ngOnInit()`.

**Error Stack Trace Evidence**:

```
main.js:2 Angular Error: A: NG0203
    at i.setupInputPipeline (main.js:7:1209)
    at i.ngOnInit (main.js:7:992)
```

The error occurs twice because both directives are used simultaneously on the same textarea element in `ChatInputComponent`:

```html
<textarea ptahAtTrigger [dropdownOpen]="dropdownOpen()" (atTriggered)="handleAtTriggered($event)" (atClosed)="handleAtClosed()" ptahSlashTrigger [slashDropdownOpen]="dropdownOpen()" (slashTriggered)="handleSlashTriggered($event)" (slashClosed)="handleSlashClosed()"></textarea>
```

---

## Deep Dive Analysis

### 1. Understanding Angular NG0203 Error

**Official Definition** (from [Angular Documentation](https://angular.dev/errors/NG0203)):

The NG0203 error occurs when you try to use the `inject()` function outside of the allowed **injection context**. The injection context is only available during class construction and initialization.

**Allowed Injection Contexts**:

- ✅ Constructor of a class being instantiated by DI (`constructor() { ... }`)
- ✅ Field initializers of such classes (`private readonly service = inject(Service)`)
- ✅ Factory functions (`useFactory: () => inject(Service)`)
- ✅ Function used with `runInInjectionContext()`

**Forbidden Contexts**:

- ❌ Lifecycle hooks (`ngOnInit`, `ngAfterViewInit`, etc.)
- ❌ Methods called from lifecycle hooks
- ❌ Event handlers
- ❌ Async callbacks (setTimeout, promises, observables)

### 2. Why toObservable() Causes This Error

The `toObservable()` function from `@angular/core/rxjs-interop` internally uses `inject()` to access Angular's reactive context. This is documented in Angular's source code:

```typescript
// From @angular/core/rxjs-interop
export function toObservable<T>(source: Signal<T>): Observable<T> {
  const injector = inject(Injector); // ← Calls inject() internally
  // ... rest of implementation
}
```

When you call `toObservable()` inside `ngOnInit()` or any method called from `ngOnInit()`, it attempts to call `inject()` outside the allowed injection context, triggering **NG0203**.

### 3. Code Analysis: Before vs After Bug Introduction

**Working Code** (at-trigger.directive.ts - lines 84-86):

```typescript
// CORRECT: toObservable() called in field initializer (injection context)
private readonly enabled$ = toObservable(this.enabled);

ngOnInit(): void {
  this.setupInputPipeline();
}
```

**Broken Code** (at-trigger.directive.ts - line 136 inside setupInputPipeline):

```typescript
private setupInputPipeline(): void {
  const textarea = this.elementRef.nativeElement;

  // ... other code ...

  // Combined stream that respects enabled state AND dropdown open state
  const triggerState$ = combineLatest([
    inputState$,
    this.enabled$,
    toObservable(this.dropdownOpen), // ❌ VIOLATION: Called inside ngOnInit context
  ]).pipe(
    filter(([, enabled, dropdownOpen]) => enabled && !dropdownOpen),
    map(([state]) => state),
    takeUntilDestroyed(this.destroyRef)
  );
}
```

**Key Difference**:

- ✅ `enabled$` is created in field initializer → Works
- ❌ `toObservable(this.dropdownOpen)` is called inside `setupInputPipeline()` → Fails

---

## Git History Analysis

### When Was the Bug Introduced?

**Evidence from Git Diff** (e719313..HEAD):

The refactoring changed the directive from using `@HostListener` to an RxJS pipeline approach:

**Before Refactoring** (working):

- Simple `@HostListener('input')` event handler
- No RxJS observables
- No `toObservable()` calls in lifecycle hooks

**After Refactoring** (broken):

- Sophisticated RxJS pipeline in `setupInputPipeline()`
- Added `toObservable(this.dropdownOpen)` inside the method
- Called from `ngOnInit()` → **injection context violation**

**Related Commits**:

- `e719313` - "fix(webview): prevent slash trigger interference with at trigger"
  - Introduced the RxJS pipeline refactoring
  - Added dropdown state tracking
- `6d69df5` - "feat(vscode): add setup wizard integration with agent status widget" (TASK_2025_069)
  - This is when the integration was merged to main branch
- `9de083c` - "fix(vscode,webview): resolve critical issues in TASK_2025_069 agent setup widget"
  - Fixed other issues but **did not catch this NG0203 violation**

---

## Production Impact Analysis

### Severity: HIGH

**User Impact**:

- Error occurs every time ChatInputComponent initializes
- Happens twice (once per directive)
- Does not crash the application (Angular error handler catches it)
- **May cause dropdown functionality to fail silently**

**Observable Symptoms**:

1. Console errors appear on every chat view load
2. Dropdown state tracking may not work correctly
3. User may experience autocomplete dropdown issues

**Frequency**:

- Occurs on every session: 100% reproduction rate
- Triggered during component initialization

---

## Fix Strategy Recommendations

### Recommended Solution 1: Move toObservable to Field Initializer ✅ PREFERRED

**Rationale**: Follows Angular best practices and matches the pattern already used for `enabled$`.

**Implementation**:

**at-trigger.directive.ts** (lines 82-86):

```typescript
// Inputs
readonly enabled = input(true);
readonly dropdownOpen = input(false);

// Convert signals to observables in field initializers (injection context)
private readonly enabled$ = toObservable(this.enabled);
private readonly dropdownOpen$ = toObservable(this.dropdownOpen); // ← ADD THIS
```

**at-trigger.directive.ts** (line 136):

```typescript
// Combined stream that respects enabled state AND dropdown open state
const triggerState$ = combineLatest([
  inputState$,
  this.enabled$,
  this.dropdownOpen$, // ← CHANGE: Use field reference instead of inline call
]).pipe(
  filter(([, enabled, dropdownOpen]) => enabled && !dropdownOpen),
  map(([state]) => state),
  takeUntilDestroyed(this.destroyRef)
);
```

**slash-trigger.directive.ts** - Apply identical changes:

```typescript
// Field initializer (lines 73-78)
readonly enabled = input(true);
readonly slashDropdownOpen = input(false);

private readonly enabled$ = toObservable(this.enabled);
private readonly slashDropdownOpen$ = toObservable(this.slashDropdownOpen); // ← ADD THIS

// Inside setupInputPipeline (line 143)
const triggerState$ = combineLatest([
  inputState$,
  this.enabled$,
  this.slashDropdownOpen$, // ← CHANGE: Use field reference
]).pipe(
  // ... rest of pipeline
);
```

**Benefits**:

- ✅ Minimal code change (2 files, 2 lines added, 2 lines modified)
- ✅ Consistent with existing `enabled$` pattern
- ✅ No architectural changes required
- ✅ Follows Angular injection context rules
- ✅ Easy to test and verify

**Estimated Effort**: 15 minutes

---

### Alternative Solution 2: Use runInInjectionContext ❌ NOT RECOMMENDED

**Implementation**:

```typescript
import { runInInjectionContext, Injector } from '@angular/core';

export class AtTriggerDirective implements OnInit {
  private readonly injector = inject(Injector);

  private setupInputPipeline(): void {
    const textarea = this.elementRef.nativeElement;

    runInInjectionContext(this.injector, () => {
      // Now toObservable() calls are allowed
      const triggerState$ = combineLatest([
        inputState$,
        this.enabled$,
        toObservable(this.dropdownOpen), // ← Now allowed
      ]).pipe(/* ... */);
    });
  }
}
```

**Why Not Recommended**:

- ❌ More complex and verbose
- ❌ Requires injecting `Injector`
- ❌ Unusual pattern that may confuse future maintainers
- ❌ Solution 1 is simpler and more idiomatic

---

### Alternative Solution 3: Revert to @HostListener Pattern ❌ NOT RECOMMENDED

**Rationale**: Go back to the pre-refactoring approach without RxJS pipelines.

**Why Not Recommended**:

- ❌ Loses performance benefits of RxJS debouncing
- ❌ Loses cleaner reactive programming model
- ❌ Regression to less maintainable code
- ❌ Technical debt accumulation

---

## Testing Strategy

### Test Plan for Fix Verification

**1. Unit Tests** (Jest):

```typescript
describe('AtTriggerDirective - NG0203 Fix', () => {
  it('should not throw NG0203 error during initialization', () => {
    const fixture = TestBed.createComponent(TestHostComponent);

    // Should not throw during change detection
    expect(() => fixture.detectChanges()).not.toThrow();
  });

  it('should create dropdownOpen$ observable in field initializer', () => {
    const fixture = TestBed.createComponent(TestHostComponent);
    const directive = fixture.debugElement.query(By.directive(AtTriggerDirective)).injector.get(AtTriggerDirective);

    // Access private field via type assertion (for testing)
    expect((directive as any).dropdownOpen$).toBeDefined();
    expect((directive as any).dropdownOpen$).toBeInstanceOf(Observable);
  });
});
```

**2. Integration Tests** (E2E):

```typescript
it('should open dropdown on @ trigger without console errors', async () => {
  // Listen for console errors
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  // Open chat, type @ trigger
  await page.goto('vscode-webview://...');
  await page.type('textarea', '@file');

  // Wait for dropdown
  await page.waitForSelector('.suggestions-dropdown', { timeout: 2000 });

  // Verify no NG0203 errors
  expect(errors).not.toContain(jasmine.stringContaining('NG0203'));
});
```

**3. Manual Testing Checklist**:

- [ ] Open chat interface
- [ ] Check browser console for NG0203 errors (should be **0 errors**)
- [ ] Type `@` in input to trigger file autocomplete
- [ ] Verify dropdown appears and filters correctly
- [ ] Type `/` to trigger command autocomplete
- [ ] Verify dropdown appears and filters correctly
- [ ] Switch between @ and / triggers multiple times
- [ ] Verify no console errors throughout interaction

---

## Risk Analysis & Mitigation

### Critical Risks Identified

**1. Risk**: Fix might break dropdown functionality

- **Probability**: 10% (low)
- **Impact**: HIGH
- **Mitigation**: Field initializer pattern is identical to working `enabled$` implementation
- **Fallback**: Revert commit and use Solution 2 (runInInjectionContext)

**2. Risk**: Other directives may have same issue

- **Probability**: 30% (medium)
- **Impact**: MEDIUM
- **Mitigation**: Run codebase-wide search for `toObservable()` calls inside methods
- **Action**: Execute search before implementing fix

**3. Risk**: Future refactorings may reintroduce the issue

- **Probability**: 20% (low-medium)
- **Impact**: MEDIUM
- **Mitigation**: Add ESLint rule to detect `toObservable()` in lifecycle hooks
- **Action**: Document pattern in CLAUDE.md

---

## Dependency Chain Analysis

### Component Interaction Flow

```
ChatInputComponent (chat-input.component.ts)
  └─> Textarea Element
      ├─> AtTriggerDirective
      │   ├─> dropdownOpen input signal ← Provided by ChatInputComponent
      │   ├─> toObservable(dropdownOpen) ❌ Called in ngOnInit context
      │   └─> setupInputPipeline() → NG0203 ERROR
      │
      └─> SlashTriggerDirective
          ├─> slashDropdownOpen input signal ← Provided by ChatInputComponent
          ├─> toObservable(slashDropdownOpen) ❌ Called in ngOnInit context
          └─> setupInputPipeline() → NG0203 ERROR
```

### Signal/Observable Lifecycle

```
Component Initialization Phase:
1. ChatInputComponent constructor executes
2. ChatInputComponent fields initialized (✅ injection context available)
3. Change detection runs
4. AtTriggerDirective constructor executes
5. AtTriggerDirective fields initialized (✅ injection context available)
   - enabled$ = toObservable(this.enabled) ← WORKS
6. AtTriggerDirective.ngOnInit() called (❌ injection context NOT available)
   - setupInputPipeline() called
   - toObservable(this.dropdownOpen) ← FAILS with NG0203
7. SlashTriggerDirective.ngOnInit() called (❌ injection context NOT available)
   - setupInputPipeline() called
   - toObservable(this.slashDropdownOpen) ← FAILS with NG0203
```

**Key Insight**: The injection context is only available during phases 1-5. Once `ngOnInit()` executes (phase 6-7), the injection context is closed.

---

## Knowledge Graph

### Core Concepts Map

```
[Angular Dependency Injection]
    ├── Injection Context (constructor + field initializers only)
    ├── inject() function
    │   ├── Used internally by toObservable()
    │   ├── Only allowed in injection context
    │   └── Throws NG0203 outside context
    │
    ├── Lifecycle Hooks
    │   ├── ngOnInit (❌ no injection context)
    │   ├── ngAfterViewInit (❌ no injection context)
    │   └── constructor (✅ has injection context)
    │
    └── Signal-to-Observable Conversion
        ├── toObservable() from @angular/core/rxjs-interop
        ├── Requires injection context (uses inject() internally)
        └── Must be called in field initializer or constructor
```

---

## Expert Insights

### Pattern Recognition Across Angular Codebase

**Common Anti-Pattern Identified**:

```typescript
// ❌ WRONG: toObservable in lifecycle hook
ngOnInit() {
  const value$ = toObservable(this.signal); // NG0203 error
}

// ✅ CORRECT: toObservable in field initializer
private readonly value$ = toObservable(this.signal);

ngOnInit() {
  this.value$.subscribe(/* ... */);
}
```

**Why This Pattern Matters**:

1. Angular signals are **synchronous** - value is available immediately
2. Converting to Observable in field initializer has **zero performance cost**
3. Field initializers run **during construction** (injection context available)
4. Lifecycle hooks run **after construction** (injection context closed)

**Best Practice Rule**:

> "Always convert signals to observables in field initializers, never in lifecycle hooks or methods"

---

## Curated Learning Path

### For Team Understanding of NG0203 Issues

**1. Fundamentals** (30 minutes):

- [Official Angular NG0203 Documentation](https://angular.dev/errors/NG0203)
- [Angular Injection Context Guide](https://angular.dev/guide/di/dependency-injection-context)

**2. Hands-on Tutorial** (45 minutes):

- [Troubleshooting NG0203 Article](https://www.fradev.io/articles/react/angular-troubleshooting-ng0203-inject-must-be-called-from-an-injection-context/)
- [Testing Code Using inject()](https://medium.com/ngconf/how-do-i-test-code-using-inject-e1278283f47c)

**3. Advanced Patterns** (1 hour):

- [Understanding runInInjectionContext()](https://angular.dev/guide/di/dependency-injection-context#running-within-an-injection-context)
- GitHub Issues: [#54147](https://github.com/angular/angular/issues/54147), [#27122](https://github.com/angular/angular-cli/issues/27122)

**4. Code Review Checklist** (reference):

```markdown
## NG0203 Prevention Checklist

- [ ] All `inject()` calls are in constructors or field initializers
- [ ] All `toObservable()` calls are in field initializers
- [ ] No `inject()` or `toObservable()` in lifecycle hooks
- [ ] No `inject()` or `toObservable()` in event handlers
- [ ] If needed in methods, use `runInInjectionContext()`
```

---

## Decision Support Dashboard

**GO Recommendation**: ✅ PROCEED WITH SOLUTION 1 (Field Initializer Pattern)

**Technical Feasibility**: ⭐⭐⭐⭐⭐ (5/5)

- Simple code change
- Consistent with existing patterns
- No architectural changes

**Business Alignment**: ⭐⭐⭐⭐⭐ (5/5)

- Fixes critical console error
- Improves user experience
- Prevents potential dropdown failures

**Risk Level**: ⭐ (1/5 - Very Low)

- Minimal code change
- Well-understood solution
- Easy to test and verify

**ROI Projection**: Immediate

- **Time to Fix**: 30 minutes (coding + testing)
- **Time to Review**: 15 minutes
- **Value**: Eliminates 2 console errors per chat view load
- **User Impact**: Improved reliability and polish

---

## Research Artifacts

### Primary Sources

1. [Angular NG0203 Official Documentation](https://angular.dev/errors/NG0203) - Official error reference
2. [Angular Injection Context Guide](https://angular.dev/guide/di/dependency-injection-context) - Core DI concepts
3. [Angular v17 NG0203 Reference](https://v17.angular.io/errors/NG0203) - Version-specific details

### Secondary Sources

1. [RuneBook Angular NG0203 Article](https://runebook.dev/en/articles/angular/errors/ng0203) - Detailed troubleshooting
2. [FraDev NG0203 Troubleshooting](https://www.fradev.io/articles/react/angular-troubleshooting-ng0203-inject-must-be-called-from-an-injection-context/) - Practical examples
3. [Medium: Testing Code Using inject()](https://medium.com/ngconf/how-do-i-test-code-using-inject-e1278283f47c) - Testing patterns

### Raw Data

**Error Log Evidence**:

- Log file: `vscode-app-1764005778940.log`
- Error lines: 200-210, 213-223
- Stack trace: `setupInputPipeline → ngOnInit`

**Source Code Analysis**:

- Affected files:
  - `libs/frontend/chat/src/lib/directives/at-trigger.directive.ts` (line 136)
  - `libs/frontend/chat/src/lib/directives/slash-trigger.directive.ts` (line 143)
- Parent component: `libs/frontend/chat/src/lib/components/molecules/chat-input.component.ts`

**Git History**:

- Bug introduced: Commit `e719313` (refactoring branch `ak/fix-chat-streaming`)
- Merged in: Commit `6d69df5` (TASK_2025_069)
- Not caught by: Commit `9de083c` (TASK_2025_069 fixes)

---

## Summary

### RESEARCH SYNTHESIS COMPLETE

**Research Depth**: COMPREHENSIVE
**Sources Analyzed**: 3 primary (Angular docs), 6 secondary (tutorials/articles), git history analysis
**Confidence Level**: 95%
**Key Recommendation**: Implement Solution 1 (Field Initializer Pattern) immediately

**Strategic Insights**:

1. **Game Changer**: The bug is a textbook Angular injection context violation - simple to fix with existing patterns
2. **Hidden Risk**: Other directives in codebase may have similar issues if they call `toObservable()` in lifecycle hooks
3. **Opportunity**: Document this pattern in CLAUDE.md to prevent future occurrences

**Knowledge Gaps Remaining**:

- Codebase-wide audit for other `toObservable()` violations (run search before implementing fix)
- ESLint rule to prevent future violations (future enhancement)

**Recommended Next Steps**:

1. **Immediate**: Run codebase search for `toObservable()` calls in methods (not field initializers)
2. **Implementation**: Apply Solution 1 to both directives (30 minutes)
3. **Testing**: Verify fix with manual testing checklist (15 minutes)
4. **Prevention**: Add code review checklist item for NG0203 prevention

**Output**: `task-tracking/TASK_2025_070/research-report.md`
**Next Agent**: `team-leader` (MODE 1: DECOMPOSITION)
**Implementation Focus**:

- Fix at-trigger.directive.ts (add dropdownOpen$ field)
- Fix slash-trigger.directive.ts (add slashDropdownOpen$ field)
- Add unit tests for NG0203 prevention
- Manual QA verification

---

## Sources

- [NG0203: inject() must be called from an injection context • Angular](https://angular.dev/errors/NG0203)
- [Understanding and Resolving the NG0203 Error in Angular](https://runebook.dev/en/articles/angular/errors/ng0203)
- [Angular Injection Context Guide](https://angular.dev/guide/di/dependency-injection-context)
- [NG0203 v17 Documentation](https://v17.angular.io/errors/NG0203)
- [Troubleshooting NG0203 - FraDev](https://www.fradev.io/articles/react/angular-troubleshooting-ng0203-inject-must-be-called-from-an-injection-context/)
- [How do I test code using inject? | Medium](https://medium.com/ngconf/how-do-i-test-code-using-inject-e1278283f47c)
