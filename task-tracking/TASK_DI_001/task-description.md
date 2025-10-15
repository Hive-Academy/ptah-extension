# Phase 1: Project Manager - Requirements Analysis

## Task Context

**Task ID**: TASK_DI_001  
**User Request**: Fix tsyringe DI issues with proper service registration and injection patterns  
**Scope**: Systematic analysis and fix of dependency injection configuration problems

---

## 📋 Requirements Analysis (SMART Format)

### Specific

- Fix the immediate tsyringe injection error: "this.eventBus.subscribe is not a function"
- Establish consistent dependency injection patterns across all libraries
- Simplify and standardize service registration using tsyringe best practices
- Eliminate circular dependencies and token conflicts

### Measurable

- Extension activates successfully without DI errors
- All services resolve correctly with proper dependencies
- Zero compilation errors related to type mismatches
- Reduce DI registration complexity by 50%
- All tests pass after DI fixes

### Achievable

- Analysis shows the issue is in token mapping and interface mismatches
- TSyringe v4.10.0 has mature patterns we can follow
- Current codebase has good separation of concerns to fix systematically
- No fundamental architecture changes needed

### Relevant

- Critical blocker preventing extension activation
- Affects all library integration and service orchestration
- Required for MONSTER plan completion and production deployment
- Improves maintainability and developer experience

### Time-bound

- **Phase 1** (Requirements): 2 hours
- **Phase 3** (Architecture): 4 hours
- **Phase 4** (Implementation): 8-12 hours
- **Phase 5** (Testing): 2-4 hours
- **Total**: 1-2 days maximum

---

## 🎯 Acceptance Criteria (BDD Format)

### AC1: Extension Activation Success

```gherkin
Given the Ptah extension is installed in VS Code
When I activate the extension (F5 launch or install)
Then the extension should activate without dependency injection errors
And all services should be properly instantiated
And the extension should be fully functional
```

### AC2: Service Resolution Consistency

```gherkin
Given all library services are registered with tsyringe
When a service requests a dependency via @inject
Then the dependency should be resolved with the correct instance
And the injected service should have all its methods available
And no "method is not a function" errors should occur
```

### AC3: Type Safety Compliance

```gherkin
Given all service registrations use Symbol-based tokens
When services are resolved from the DI container
Then TypeScript compilation should pass with strict mode
And no any types should be used in DI configuration
And all injected dependencies should be properly typed
```

### AC4: Library Integration Standards

```gherbon
Given each library has a bootstrap registration function
When the main app calls registerXxxServices(container, tokens)
Then all library services should be registered correctly
And token conflicts should be eliminated
And circular dependencies should be resolved
```

---

## 🔍 Root Cause Analysis

### Primary Issue: EventBus Interface Mismatch

**Error**: `this.eventBus.subscribe is not a function`

**Analysis**:

1. **ProviderManager** expects `EventBus` from vscode-core with `.subscribe()` method
2. **claude-domain** defines `IEventBus` interface with different signature
3. **ai-providers-core** registration uses `TOKENS.EVENT_BUS` but gets wrong type
4. **Token mapping** creates adapter but ProviderManager gets the adapter, not real EventBus

### Secondary Issues

1. **Complex Token Mapping**: Multiple interfaces for same EventBus concept
2. **Registration Order**: Services registered before dependencies available
3. **Circular Dependencies**: Libraries cross-referencing each other's tokens
4. **Interface Duplication**: Same concepts defined in multiple libraries

---

## 📊 Impact Assessment

### High Impact

- **Extension Activation**: Complete failure to start
- **All AI Features**: Non-functional due to ProviderManager failure
- **User Experience**: Extension appears broken to users

### Medium Impact

- **Development Velocity**: Blocks all feature development
- **Testing**: Unable to run integration tests
- **Code Quality**: Workarounds needed for basic functionality

### Low Impact

- **Documentation**: May need updates after fixes
- **Build Performance**: Minimal impact on build times

---

## 🚨 Risk Assessment

### Technical Risks

- **High**: Breaking more services while fixing DI
- **Medium**: Performance impact from DI pattern changes
- **Low**: Compatibility issues with existing VS Code APIs

### Mitigation Strategies

- Use feature branch with comprehensive testing
- Fix services incrementally with validation at each step
- Maintain backward compatibility during transition
- Keep rollback plan available

---

## 📈 Success Metrics

### Functional Metrics

- Extension activates successfully: ✅/❌
- All registered services resolve: ✅/❌
- Zero DI-related runtime errors: ✅/❌
- All existing tests pass: ✅/❌

### Code Quality Metrics

- Lines of DI configuration code: < 200 (currently ~400)
- Number of token definitions: < 20 (currently ~35)
- Circular dependencies: 0 (currently 2-3)
- Interface duplications: 0 (currently 3+ EventBus variants)

### Performance Metrics

- Extension activation time: < 500ms
- Service resolution time: < 10ms per service
- Memory usage: No increase from current baseline

---

## 🔄 Recommended Research Areas

### Required Research (Phase 2)

1. **TSyringe v4.10.0 Best Practices** (2025 patterns)

   - Latest registration patterns and lifecycle management
   - Symbol vs string token recommendations
   - Factory vs singleton vs transient patterns
   - Circular dependency resolution with `delay()`

2. **Interface Standardization Patterns**

   - Single source of truth for shared interfaces
   - Library boundary management
   - Cross-library communication patterns

3. **VS Code Extension DI Patterns**
   - Extension lifecycle integration with DI
   - Context and webview provider patterns
   - Service disposal and cleanup patterns

### Optional Research

- Alternative DI containers (comparison with tsyringe)
- Dependency graph visualization tools
- Automated DI testing patterns

---

## ✅ Phase 1 Deliverables

### Completed

- [x] SMART requirements definition
- [x] BDD acceptance criteria
- [x] Root cause analysis of EventBus interface mismatch
- [x] Risk assessment and mitigation strategies
- [x] Success metrics and measurement criteria
- [x] Research recommendations for Phase 2

### Ready for Validation

This requirements analysis provides a clear roadmap for fixing the tsyringe DI issues systematically. The problem is well-understood and solvable within the estimated timeline.

**Estimated Effort**: 16-22 hours over 1-2 days  
**Confidence Level**: High (90%) - Clear problem, established patterns, good tooling
**Business Value**: Critical - Unblocks extension activation and all AI features

---

## 🎯 Next Phase Trigger

**Validation Gate**: Business Analyst review of requirements  
**Success Criteria**: Confirmed understanding of problem scope and solution approach  
**Next Step**: Phase 2 (Research) or Phase 3 (Architecture) depending on research needs
