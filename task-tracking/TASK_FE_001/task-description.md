# Task Description - TASK_FE_001

**Task ID**: TASK_FE_001  
**Task Name**: Angular Frontend Library Extraction & Modernization  
**Created**: October 11, 2025  
**Priority**: HIGH  
**MONSTER Plan**: Weeks 7-9 (Frontend Libraries & Angular Modernization)

---

## User Request

> "I would like to focus now on angular implementation. I think our backend as is, is actually fine, and we need to work next into planning the extractions of our old angular application into dedicated components. Let's re-scan all the frontend requirements from our monster plan and let's analyze our current angular project to create a new task that will be responsible into that critical and important migrations."

**Business Context**: The Ptah extension has a monolithic Angular webview application with 13,000 lines of legacy code using outdated patterns (decorators, structural directives, default change detection). This violates the MONSTER plan's modular architecture and prevents code reusability, independent testing, and modern Angular performance optimizations.

---

## SMART Requirements

### Specific

**What exactly needs to be done**:

1. **Extract 42+ components** from monolithic `apps/ptah-extension-webview/src/app/` to 6 dedicated frontend libraries (`libs/frontend/chat/`, `libs/frontend/session/`, `libs/frontend/analytics/`, `libs/frontend/dashboard/`, `libs/frontend/providers/`, `libs/frontend/shared-ui/`)

2. **Modernize ALL Angular code** to Angular 20+ standards:

   - Convert 42+ components from `@Input()/@Output()` decorators → `input()/output()` signal-based APIs
   - Migrate 90% of templates from `*ngIf/*ngFor` → `@if/@for` modern control flow
   - Implement OnPush change detection on 100% of components
   - Convert 16 services from BehaviorSubject/Observable → signal-based state management

3. **Optimize performance**:

   - Implement performance monitoring system
   - Achieve 30%+ reduction in change detection cycles
   - Achieve 40%+ faster template rendering
   - Reduce bundle size by 50% per feature library

4. **Integrate VS Code theming**:
   - Extract theme tokens from VS Code API
   - Apply design tokens to all components
   - Implement dynamic theme switching

### Measurable

**How to verify completion**:

| Metric                      | Current     | Target                                | Verification Method                                                                |
| --------------------------- | ----------- | ------------------------------------- | ---------------------------------------------------------------------------------- |
| **Components in libraries** | 0           | 42+                                   | `nx graph` shows component dependencies                                            |
| **Signal-based APIs**       | 0% (0/42)   | 100% (42/42)                          | Grep search for `@Input\|@Output` returns 0 matches                                |
| **Modern control flow**     | 10% (~4/42) | 100% (42/42)                          | Grep search for `\*ngIf\|\*ngFor` returns 0 matches in templates                   |
| **OnPush change detection** | 0% (0/42)   | 100% (42/42)                          | All `@Component` decorators have `changeDetection: ChangeDetectionStrategy.OnPush` |
| **Signal-based services**   | 0% (0/16)   | 100% (16/16)                          | All services use `signal()`, `computed()`, `effect()` instead of Subjects          |
| **Performance improvement** | Baseline    | +30% change detection, +40% rendering | Performance monitoring dashboard shows metrics                                     |
| **Bundle size reduction**   | Baseline    | -50% per feature                      | Webpack bundle analyzer shows size comparison                                      |
| **Test coverage**           | Current     | ≥80% maintained                       | Jest coverage report                                                               |

### Achievable

**Is this realistic in scope**:

✅ **YES** - This is achievable in 15 working days because:

1. **Incremental approach**: Library extraction and modernization happen in parallel, one feature at a time
2. **Proven patterns**: Angular 20+ patterns are well-documented (MODERN_ANGULAR_GUIDE.md)
3. **No new functionality**: This is refactoring/modernization, not feature development
4. **Tooling support**: Angular CLI provides automated migration schematics for control flow
5. **Clear scope**: 42 components and 16 services is manageable with focused execution

**Team Capacity**: 1 developer (frontend-developer agent) working full-time for 3 weeks

**Technical Feasibility**:

- All target libraries already exist with proper nx.json configuration
- Angular 20+ patterns are standard and stable
- No breaking changes to VS Code extension API required
- Backend integration points remain unchanged

### Relevant

**Why this matters**:

1. **Architectural Compliance**: Completes MONSTER plan Weeks 7-9, unblocking final integration (Week 10)
2. **Performance**: Modern control flow and OnPush detection provide 30-40% performance gains
3. **Maintainability**: Modular libraries enable independent testing and development
4. **Future-Proofing**: Angular 20+ patterns are the framework's recommended approach
5. **Developer Experience**: Signal-based APIs provide better type safety and reactivity
6. **Code Reusability**: Components can be shared across future Ptah applications

**Stakeholder Impact**:

- **End Users**: Faster, more responsive UI with 30-40% performance improvements
- **Development Team**: Cleaner architecture enables parallel feature development
- **Business**: Reduced technical debt, lower maintenance costs
- **Quality Assurance**: Isolated libraries are easier to test

### Time-bound

**Estimated timeline**: **15 working days (3 weeks)**

**Week 7 (5 days)**: Library Structure + Signal Migration

- Days 1-2: Create library folder structures, document extraction mapping
- Days 3-5: Migrate all components and services to signal-based APIs

**Week 8 (5 days)**: Control Flow + Performance

- Days 1-3: Migrate all templates to modern control flow syntax
- Days 4-5: Implement OnPush detection, performance monitoring

**Week 9 (5 days)**: Theme Integration + Polish

- Days 1-3: Extract VS Code theme tokens, apply to components
- Days 4-5: Testing, documentation, final validation

**Checkpoint Gates**:

- End of Week 7: All components using signals, zero decorators
- End of Week 8: All templates using modern control flow, performance benchmarks met
- End of Week 9: Theme integration complete, ready for final integration

---

## Acceptance Criteria (BDD Format)

### Scenario 1: Library Structure Creation

**Given** the monolithic Angular app with 42+ components in `apps/ptah-extension-webview/src/app/features/`  
**When** library extraction is executed  
**Then** all 6 frontend libraries have proper folder structure (`src/lib/components/`, `src/lib/services/`, `src/lib/models/`)  
**And** component extraction mapping is documented in `implementation-plan.md`  
**And** service extraction mapping is documented in `implementation-plan.md`  
**And** zero circular dependencies exist (verified by `nx graph`)  
**And** all libraries build successfully (`nx run-many --target=build --all`)

### Scenario 2: Component Signal Migration

**Given** all 42+ components currently using `@Input()`, `@Output()`, `@ViewChild()` decorators  
**When** signal migration is executed on all components  
**Then** 100% of components use `input<T>()` instead of `@Input()`  
**And** 100% of components use `output<T>()` instead of `@Output()`  
**And** 100% of components use `viewChild<T>()` instead of `@ViewChild()`  
**And** grep search for `@Input\(|@Output\(|@ViewChild\(` returns 0 matches in component files  
**And** TypeScript compilation succeeds with strict mode  
**And** all component tests pass

### Scenario 3: Service Signal Migration

**Given** all 16 services currently using BehaviorSubject/Observable for state  
**When** signal-based state migration is executed  
**Then** 100% of services use `signal<T>()` for mutable state  
**And** 100% of services use `computed<T>()` for derived state  
**And** 100% of services use `effect()` for side effects  
**And** zero BehaviorSubject instances remain (verified by grep search)  
**And** all service tests pass  
**And** extension functionality remains intact

### Scenario 4: Control Flow Migration

**Given** 90% of templates using `*ngIf`, `*ngFor`, `*ngSwitch` structural directives  
**When** modern control flow migration is executed  
**Then** 100% of templates use `@if` instead of `*ngIf`  
**And** 100% of templates use `@for` instead of `*ngFor`  
**And** 100% of templates use `@switch` instead of `*ngSwitch`  
**And** grep search for `\*ngIf|\*ngFor|\*ngSwitch` returns 0 matches in HTML files  
**And** all components render correctly in Extension Development Host  
**And** UI/UX remains identical to previous implementation

### Scenario 5: OnPush Change Detection

**Given** all 42+ components using default change detection strategy  
**When** OnPush change detection is implemented  
**Then** 100% of components have `changeDetection: ChangeDetectionStrategy.OnPush`  
**And** all component inputs are immutable or use signals  
**And** all event handlers properly trigger change detection  
**And** performance monitoring shows 30%+ reduction in change detection cycles  
**And** no visual regressions detected in manual testing

### Scenario 6: Performance Benchmarks

**Given** baseline performance metrics for current implementation  
**When** all modernization changes are complete  
**Then** change detection cycles are reduced by ≥30% (measured via Angular DevTools)  
**And** template rendering is ≥40% faster (measured via Performance API)  
**And** bundle size per feature library is reduced by ≥50% (measured via webpack-bundle-analyzer)  
**And** performance monitoring dashboard displays real-time metrics  
**And** all metrics are documented in `test-report.md`

### Scenario 7: VS Code Theme Integration

**Given** components currently using hardcoded colors and styles  
**When** VS Code theme integration is implemented  
**Then** theme tokens are extracted from VS Code API (`vscode.window.activeColorTheme`)  
**And** all 42+ components use CSS custom properties for colors  
**And** dynamic theme switching works (light ↔ dark)  
**And** all UI elements respect VS Code theme colors  
**And** theme changes are applied without page reload

### Scenario 8: Test Coverage Maintenance

**Given** current test coverage baseline  
**When** all refactoring is complete  
**Then** test coverage remains ≥80% for lines, branches, and functions  
**And** all existing tests pass  
**And** new tests are added for signal-based APIs  
**And** Jest coverage report shows no coverage regression  
**And** all libraries have independent test suites

### Scenario 9: Build and Integration Success

**Given** all code changes are complete  
**When** full workspace build is executed  
**Then** `nx run-many --target=build --all` succeeds with zero errors  
**And** `nx run-many --target=lint --all` passes with zero warnings  
**And** `nx run-many --target=test --all` passes with ≥80% coverage  
**And** extension loads successfully in VS Code Extension Development Host  
**And** all webview features function correctly (chat, session, dashboard, providers, analytics)

### Scenario 10: Error Handling - Incomplete Migration

**Given** signal migration is in progress  
**When** some components still use decorators  
**Then** TypeScript compilation fails with clear error messages  
**And** build process stops before deployment  
**And** progress.md documents which components need completion  
**And** developer receives actionable error guidance

---

## Risk Assessment

### Technical Risks

#### Risk 1: Breaking Changes During Signal Migration

- **Probability**: Medium
- **Impact**: High
- **Description**: Converting decorators to signals may introduce subtle behavioral differences (timing, change detection, lifecycle)
- **Mitigation Strategy**:
  - Migrate one feature library at a time (incremental rollout)
  - Write comprehensive unit tests before migration
  - Use Extension Development Host for manual testing after each feature
  - Maintain rollback capability via git branches
- **Contingency Plan**: If critical issues found, rollback specific feature library while keeping others, complete debugging before proceeding

#### Risk 2: OnPush Change Detection Breaking UI Updates

- **Probability**: High
- **Impact**: Medium
- **Description**: OnPush detection requires immutable inputs; existing code may rely on mutating objects
- **Mitigation Strategy**:
  - Audit all component inputs for mutability before OnPush implementation
  - Use Angular DevTools to verify change detection triggers
  - Implement comprehensive E2E testing for user interactions
  - Document all input immutability requirements
- **Contingency Plan**: Create helper functions for immutable updates, use `ChangeDetectorRef.markForCheck()` where absolutely necessary (documented as tech debt)

#### Risk 3: Circular Dependencies After Library Extraction

- **Probability**: Medium
- **Impact**: High
- **Description**: Extracting components to libraries may expose hidden circular dependencies
- **Mitigation Strategy**:
  - Run `nx graph` before extraction to identify potential issues
  - Design library boundaries following domain-driven design principles
  - Use shared-ui library for truly shared components
  - Implement strict linting rules against circular imports
- **Contingency Plan**: Refactor component composition, create adapter components in higher-level libraries, move shared logic to core library

#### Risk 4: Performance Regression Despite Optimizations

- **Probability**: Low
- **Impact**: High
- **Description**: Refactoring may inadvertently introduce performance issues (e.g., over-use of effects, incorrect change detection)
- **Mitigation Strategy**:
  - Establish baseline performance metrics before starting
  - Implement performance monitoring from Day 1
  - Run Chrome DevTools performance profiling after each major change
  - Use Angular DevTools profiler to catch change detection issues
- **Contingency Plan**: Profile to identify bottlenecks, optimize hot paths, consider lazy loading for heavy components

### Scope Risks

#### Risk 5: Scope Creep - Adding New Features

- **Probability**: Medium
- **Impact**: Medium
- **Description**: Temptation to add new features or improvements during refactoring
- **Mitigation Strategy**:
  - Strict adherence to "refactoring only, no new features" rule
  - Document improvement ideas in `future-enhancements.md` instead of implementing
  - Business analyst validation gates after each phase
  - Track scope changes in progress.md
- **Contingency Plan**: Move new features to future tasks in registry, defer to post-Week 9 timeline

#### Risk 6: Underestimated Complexity in Legacy Code

- **Probability**: Medium
- **Impact**: Medium
- **Description**: Legacy code may have hidden complexity (magic strings, implicit dependencies, undocumented behaviors)
- **Mitigation Strategy**:
  - Allocate 20% buffer time for unexpected issues
  - Document all discovered legacy patterns in progress.md
  - Prioritize high-risk components for early migration
  - Conduct code reviews before and after each feature migration
- **Contingency Plan**: Extend timeline by 2-3 days if critical issues found, escalate to user for priority decisions

### Dependency Risks

#### Risk 7: Angular Version Compatibility Issues

- **Probability**: Low
- **Impact**: Medium
- **Description**: Angular 20+ patterns may have edge cases or bugs in specific scenarios
- **Mitigation Strategy**:
  - Verify Angular version is ≥20.0.0 before starting
  - Check Angular GitHub issues for known signal-related bugs
  - Test all new patterns in isolated components first
  - Maintain comprehensive test coverage
- **Contingency Plan**: Report issues to Angular team, implement temporary workarounds, document in technical debt

#### Risk 8: VS Code API Changes

- **Probability**: Low
- **Impact**: Low
- **Description**: VS Code theme API may change, affecting theme integration
- **Mitigation Strategy**:
  - Use stable VS Code APIs only (avoid proposed APIs)
  - Document VS Code version compatibility
  - Implement graceful fallback for missing theme tokens
  - Test against multiple VS Code versions
- **Contingency Plan**: Fallback to default theme colors, add warning in extension logs

### Quality Risks

#### Risk 9: Test Coverage Regression

- **Probability**: Medium
- **Impact**: High
- **Description**: Refactoring may break existing tests or reduce coverage
- **Mitigation Strategy**:
  - Run tests before and after each component migration
  - Update tests to work with signal-based APIs
  - Add new tests for edge cases discovered during migration
  - Require ≥80% coverage gate before phase completion
- **Contingency Plan**: Pause migration, restore test coverage, add missing tests before proceeding

#### Risk 10: Documentation Drift

- **Probability**: High
- **Impact**: Low
- **Description**: Code changes may not be reflected in documentation
- **Mitigation Strategy**:
  - Update README.md for each library during extraction
  - Document signal patterns in MODERN_ANGULAR_GUIDE.md
  - Update copilot-instructions.md with new import paths
  - Create migration guide for future developers
- **Contingency Plan**: Dedicate final day of Week 9 to documentation updates

---

## Next Phase Recommendation

### Recommended Path: ✅ **software-architect**

**Reason**: Requirements are clear and well-understood. This is a refactoring/modernization task with established patterns (Angular 20+ signals, modern control flow, OnPush detection). No new technology or research required.

**Skip research phase because**:

1. ✅ Angular 20+ patterns are well-documented in official Angular docs and project's MODERN_ANGULAR_GUIDE.md
2. ✅ Component extraction is a standard Nx monorepo operation with known best practices
3. ✅ Performance optimization techniques are established (OnPush, bundle optimization, lazy loading)
4. ✅ VS Code theme API is stable and documented
5. ✅ Comprehensive codebase analysis already completed (42 components, 16 services inventoried)

**Architecture phase should deliver**:

- Detailed component-to-library mapping (which components go where)
- Service extraction strategy (shared vs. feature-specific)
- Import path migration plan (update all imports after extraction)
- Testing strategy (maintain 80%+ coverage during refactoring)
- Performance monitoring implementation design
- Theme token extraction architecture
- Build configuration updates (nx.json, webpack config)
- Rollback strategy (git branching, incremental deployment)

---

## Dependencies

### Upstream (Must be complete before starting)

- ✅ **TASK_PRV_005** - Workspace Intelligence Library (COMPLETE)
- ✅ **MAIN_APP_CLEANUP** - EventBus Architecture Migration (COMPLETE)
- ✅ **MONSTER Weeks 1-6** - Backend infrastructure (COMPLETE)

### Downstream (Blocked by this task)

- 📋 **TASK_INT_001** - Final Library Integration (Week 10)
- 📋 **Future frontend features** - Cannot build on modular architecture until complete

---

## Success Metrics Summary

| Metric                       | Current  | Target | Priority      |
| ---------------------------- | -------- | ------ | ------------- |
| Components in libraries      | 0/42     | 42/42  | P0 - Critical |
| Signal-based APIs            | 0/42     | 42/42  | P0 - Critical |
| Modern control flow          | ~4/42    | 42/42  | P0 - Critical |
| OnPush detection             | 0/42     | 42/42  | P1 - High     |
| Signal-based services        | 0/16     | 16/16  | P0 - Critical |
| Change detection improvement | Baseline | +30%   | P1 - High     |
| Rendering performance        | Baseline | +40%   | P1 - High     |
| Bundle size reduction        | Baseline | -50%   | P2 - Medium   |
| Test coverage                | Current  | ≥80%   | P0 - Critical |
| Theme integration            | 0%       | 100%   | P2 - Medium   |

---

## Quality Gates

Before marking this task complete, ALL of the following must be TRUE:

- [ ] All 42+ components extracted to appropriate libraries
- [ ] All 16 services extracted to appropriate libraries
- [ ] Zero `@Input()`, `@Output()`, `@ViewChild()` decorators remain
- [ ] Zero `*ngIf`, `*ngFor`, `*ngSwitch` directives remain
- [ ] 100% of components use OnPush change detection
- [ ] Performance benchmarks show ≥30% change detection improvement
- [ ] Performance benchmarks show ≥40% rendering improvement
- [ ] Bundle size reduced by ≥50% per feature library
- [ ] Test coverage maintained at ≥80%
- [ ] VS Code theme integration working
- [ ] `nx run-many --target=build --all` succeeds
- [ ] `nx run-many --target=lint --all` passes
- [ ] `nx run-many --target=test --all` passes
- [ ] Extension loads successfully in Extension Development Host
- [ ] All webview features function correctly
- [ ] Documentation updated (README.md, MODERN_ANGULAR_GUIDE.md, copilot-instructions.md)
- [ ] Code review approved by code-reviewer agent

---

**Status**: ✅ Requirements Complete - Ready for Architecture Phase  
**Next Agent**: software-architect  
**Deliverable**: implementation-plan.md with detailed migration strategy
