# TASK_PERF_001 Context - Performance Monitoring System

**Created**: October 10, 2025  
**MONSTER Week**: 8  
**Parent Plan**: [MONSTER_EXTENSION_REFACTOR_PLAN.md](../../docs/MONSTER_EXTENSION_REFACTOR_PLAN.md)

---

## 🎯 Task Origin

### User Request Alignment

This task implements **Week 8** of the MONSTER plan. From the MONSTER plan:

```markdown
Week 8: Performance Monitoring

Objectives:

- Add observability to all services
- Performance metrics dashboard
- Token usage analytics
- Error tracking and reporting

Estimated Effort: 1 week
```

### Strategic Context

**Sequential Execution After Week 7**:

- ✅ Week 6: workspace-intelligence library (COMPLETE)
- 📋 Weeks 1-6 Deferred: TASK_CORE_001 (infrastructure)
- 📋 Week 7: TASK_SES_001 + TASK_ANLYT_001 (session + analytics)
- **🎯 Week 8: TASK_PERF_001 (THIS TASK) - Performance monitoring**
- ⏳ Week 9: TASK_THEME_001 (theme integration)

**Business Value**:

- **Performance bottleneck detection**: Identify slow operations
- **Real-time monitoring**: Track extension health
- **Proactive alerting**: Detect issues before users report
- **Optimization targets**: Data-driven performance improvements

---

## 📁 Scope Definition

### What This Task IS

**Core Responsibilities**:

1. **Service Observability**

   - Add performance tracking to all existing services
   - Method-level timing instrumentation
   - Resource usage tracking (memory, CPU)

2. **Metrics Dashboard**

   - Angular UI components for performance visualization
   - Real-time charts (response times, token usage)
   - Historical trend analysis

3. **Integration with Analytics**

   - Use @ptah-extension/ptah-analytics for data storage
   - Add performance-specific metrics
   - Dashboard consumes analytics data

4. **Error Tracking**
   - Centralized error reporting
   - Error frequency tracking
   - Stack trace aggregation

---

### What This Task IS NOT

**Out of Scope** (future enhancements):

- ❌ External APM integration (DataDog, NewRelic) - future enhancement
- ❌ Distributed tracing - overkill for single-extension
- ❌ Load testing framework - manual testing sufficient
- ❌ Automated performance regression detection - nice-to-have

---

## 🏗️ Target Library/Component Structure

### Performance Monitoring Components

**Not a separate library** - this is cross-cutting functionality that **enhances** existing libraries.

### Where Components Live

1. **Performance Instrumentation** → Each library adds its own

   - `@ptah-extension/vscode-core` - Add timing decorators
   - `@ptah-extension/workspace-intelligence` - Add performance tracking
   - `@ptah-extension/ptah-session` - Track session operations
   - `@ptah-extension/claude-domain` - Track Claude CLI performance

2. **Dashboard UI** → Angular webview (existing app)

   - `apps/ptah-extension-webview/src/app/features/dashboard/`
   - New performance dashboard components
   - Charts library: Chart.js or ECharts

3. **Central Performance Service** → vscode-core
   - `libs/backend/vscode-core/src/monitoring/performance-monitor.ts`
   - Aggregates metrics from all services
   - Publishes to EventBus for dashboard consumption

---

## 🔗 Integration Points

### Upstream Dependencies

**Libraries This Task Depends On**:

1. **@ptah-extension/vscode-core** (from TASK_CORE_001)

   - EventBus for performance events
   - Logger for performance logging
   - Base PerformanceMonitor service

2. **@ptah-extension/ptah-analytics** (from TASK_ANLYT_001)

   - Analytics storage for performance metrics
   - Metrics aggregation utilities
   - Data export functionality

3. **@ptah-extension/workspace-intelligence** (existing)

   - Already has performance tracking (validated <100ms)
   - Extend with detailed instrumentation

4. **@ptah-extension/ptah-session** (from TASK_SES_001)

   - Session duration tracking
   - Session performance metrics

5. **Angular Webview** (existing)
   - Dashboard components
   - Signal-based reactive charts

**Hard Dependency**: TASK_CORE_001, TASK_ANLYT_001 must complete first

---

### Downstream Integrations

**Who Uses Performance Data**:

1. **Developers** (during development)

   - Performance bottleneck identification
   - Optimization validation

2. **Users** (opt-in dashboard)

   - Extension health overview
   - Token usage trends
   - Response time insights

3. **Future Enhancements**
   - Automated performance alerts
   - Performance-based provider selection
   - Adaptive context window sizing

---

## 📊 Research Context

### Performance Monitoring Best Practices

**Research Questions** (to be answered in research-report.md):

1. **Instrumentation Patterns**:

   - Decorator-based timing (`@measurePerformance`)
   - Manual timing (`performance.now()`)
   - VS Code profiling APIs
   - Performance mark/measure API

2. **Metrics to Track**:

   - **Method Timing**: Service method execution times
   - **Resource Usage**: Memory, CPU (if available)
   - **Token Usage**: Input/output tokens per operation
   - **Error Rates**: Errors per service/method
   - **Latency Distribution**: P50, P90, P99 percentiles

3. **Dashboard Visualization**:

   - Chart libraries for Angular (Chart.js, ECharts, ngx-charts)
   - Real-time vs. historical views
   - Responsive design for webview
   - Drill-down capabilities

4. **Performance Budgets**:
   - Target response times per operation type
   - Token budget enforcement
   - Memory usage limits
   - Alert thresholds

---

### Existing Patterns

**From workspace-intelligence Implementation** (TASK_PRV_005):

- ✅ Performance benchmarks validated (<100ms for 1000 files)
- ✅ Tests include performance assertions
- ✅ Token counting already instrumented
- ✅ Can extend with more detailed metrics

**From Angular Webview**:

- ✅ Signal-based reactivity (zoneless change detection)
- ✅ OnPush change detection (performance optimized)
- ✅ Standalone components (lightweight)

**Lessons Applied**:

- Use existing performance assertions as baseline
- Extend workspace-intelligence with detailed instrumentation
- Build on analytics library for storage
- Angular signals for reactive dashboards

---

## 🎯 Success Criteria

### Performance Monitoring Complete When

1. **Instrumentation Added**:

   - [ ] All services have performance tracking
   - [ ] Method-level timing available
   - [ ] Token usage tracked per operation
   - [ ] Error rates tracked

2. **Dashboard Implemented**:

   - [ ] Performance overview component (Angular)
   - [ ] Real-time charts for key metrics
   - [ ] Historical trend analysis
   - [ ] Drill-down to service/method level

3. **Integration with Analytics**:

   - [ ] Performance metrics stored in analytics
   - [ ] Dashboard consumes analytics data
   - [ ] Export functionality works

4. **Tests Passing**:

   - [ ] Performance tracking doesn't degrade performance
   - [ ] Dashboard components render correctly
   - [ ] Metrics accuracy validated

5. **Documentation Complete**:
   - [ ] Performance monitoring guide
   - [ ] Dashboard usage documentation
   - [ ] Performance budget definitions
   - [ ] Optimization recommendations

---

## 📝 Key Decisions

### Architecture Decisions

**Decision 1: Instrumentation Approach**

- **Option A**: Decorator-based (`@measurePerformance`)
- **Option B**: Manual timing in each method
- **Option C**: Aspect-oriented programming
- **CHOSEN**: Option A (decorators)
- **Rationale**: Clean, reusable, minimal code changes

**Decision 2: Dashboard Technology**

- **Option A**: Chart.js (simple, lightweight)
- **Option B**: ECharts (feature-rich, complex)
- **Option C**: ngx-charts (Angular-native)
- **CHOSEN**: Option A (Chart.js)
- **Rationale**: Simple needs, lightweight, well-documented

**Decision 3: Real-time vs. Polling**

- **Option A**: Real-time updates via EventBus
- **Option B**: Polling analytics service
- **CHOSEN**: Option A
- **Rationale**: EventBus already exists, real-time is better UX

**Decision 4: Performance Budget Enforcement**

- **Option A**: Hard limits (throw errors)
- **Option B**: Soft limits (log warnings)
- **Option C**: No enforcement (monitoring only)
- **CHOSEN**: Option B initially, Option A for critical paths
- **Rationale**: Start lenient, enforce where critical

---

### Implementation Decisions

**Decision 5: Where to Add Instrumentation?**

- **Option A**: Modify existing libraries (add decorators)
- **Option B**: Wrapper services (non-invasive)
- **CHOSEN**: Option A (modify libraries)
- **Rationale**: Cleaner, more accurate, libraries are in our control

**Decision 6: Dashboard Placement**

- **Option A**: Separate view container
- **Option B**: Sidebar panel
- **Option C**: Command palette → modal
- **CHOSEN**: Option A (dedicated view)
- **Rationale**: Rich visualization needs space, not sidebar-friendly

---

## 🚀 Next Steps After Context Review

1. **Research Phase**:

   - Performance monitoring patterns for VS Code extensions
   - Chart.js integration with Angular signals
   - Decorator-based instrumentation best practices
   - Create `research-report.md`

2. **Planning Phase**:

   - Detailed implementation plan
   - Service-by-service instrumentation plan
   - Dashboard component architecture
   - Create `implementation-plan.md`

3. **Implementation Phase** (3 sub-phases):

   - **Phase 1**: Add PerformanceMonitor to vscode-core
   - **Phase 2**: Instrument all existing services
   - **Phase 3**: Build Angular dashboard components

4. **Validation Phase**:
   - Performance overhead validation (instrumentation <5% overhead)
   - Dashboard usability testing
   - Create `completion-report.md`

---

## 📚 Related Documentation

**MONSTER Plan Context**:

- [MONSTER_EXTENSION_REFACTOR_PLAN.md](../../docs/MONSTER_EXTENSION_REFACTOR_PLAN.md) - Week 8 section
- [MONSTER_PROGRESS_TRACKER.md](../MONSTER_PROGRESS_TRACKER.md) - Week 8 section

**Previous Task Context**:

- [TASK_CORE_001](../TASK_CORE_001/) - Infrastructure (provides EventBus, Logger)
- [TASK_ANLYT_001](../TASK_ANLYT_001/) - Analytics library (provides metrics storage)
- [TASK_PRV_005](../TASK_PRV_005/) - workspace-intelligence (has performance benchmarks)

**Architecture References**:

- [AGENTS.md](../../AGENTS.md) - Universal agent framework
- [copilot-instructions.md](../../.github/copilot-instructions.md) - Ptah-specific patterns
- [MODERN_ANGULAR_GUIDE.md](../../docs/guides/MODERN_ANGULAR_GUIDE.md) - Angular signal patterns

---

**Context Status**: ✅ Ready for Research/Planning Phase  
**Blocked By**: TASK_CORE_001 (infrastructure), TASK_ANLYT_001 (analytics library)  
**Can Start**: After Week 7 tasks complete (TASK_SES_001 + TASK_ANLYT_001)  
**Estimated Timeline**: 5 days implementation
