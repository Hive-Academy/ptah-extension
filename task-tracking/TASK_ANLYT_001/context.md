# TASK_ANLYT_001 Context - Analytics Library Extraction

**Created**: October 10, 2025  
**MONSTER Week**: 7  
**Parent Plan**: [MONSTER_EXTENSION_REFACTOR_PLAN.md](../../docs/MONSTER_EXTENSION_REFACTOR_PLAN.md)

---

## 🎯 Task Origin

### User Request Alignment

This task implements the **second half of Week 7** in the MONSTER plan:

> "we just finished week 6 and all the previous weeks from the monster plan so week 7 should be our next target"

Week 7 in MONSTER plan (lines 900+):

```markdown
Week 7: Session & Analytics Libraries

- Extract session-manager.ts → ptah-session library
- Extract analytics-data-collector.ts → ptah-analytics library
- Delete from main app (~350 lines)
```

### Strategic Context

**Parallel Execution with TASK_SES_001**:

- Both tasks implement Week 7
- Can run in parallel (minimal dependency)
- Analytics uses session context, but doesn't block on it
- Total Week 7 duration: 3-4 days (if parallel)

**Business Value**:

- **Token usage analytics**: Track cost patterns, optimize spend
- **Performance metrics**: Response times, streaming latency
- **User behavior insights**: Feature usage, workflow patterns
- **Quality metrics**: Error rates, success rates

---

## 📁 Main App Code Analysis

### Source Files to Extract

**Primary Source**:

```text
apps/ptah-extension-vscode/src/services/analytics-data-collector.ts (~150 lines)
```

**Current Responsibilities**:

- Event collection (chat messages, provider switches, errors)
- Metrics aggregation (token counts, response times)
- Privacy-aware telemetry (no sensitive data)
- Periodic reporting (daily summaries)
- Data export (JSON format for analysis)

**Dependencies in Main App**:

- `@ptah-extension/shared` types (ChatMessage, ProviderEvent)
- VS Code APIs (vscode.env.machineId for anonymous tracking)
- Logger service (for analytics system logging)
- EventBus (for analytics events)

### Analytics-Related Message Handlers

**In**: `apps/ptah-extension-vscode/src/services/webview-message-handlers/`

**Handlers to Review**:

- `analytics-message-handler.ts` - Analytics queries
- Message types: `getAnalytics`, `exportAnalytics`, `clearAnalytics`

**Strategy**: These handlers will use the extracted library services

---

## 🏗️ Target Library Structure

### Proposed Architecture

```text
libs/backend/ptah-analytics/
├── src/
│   ├── backend/                           # Extension-side analytics logic
│   │   ├── analytics-collector.service.ts # Event collection
│   │   ├── metrics-aggregator.service.ts  # Metrics calculation
│   │   ├── telemetry-exporter.service.ts  # Export functionality
│   │   └── privacy-filter.service.ts      # PII filtering
│   │
│   ├── shared/                            # Shared analytics types
│   │   ├── analytics-events.types.ts      # Event types
│   │   ├── metrics.types.ts               # Metric definitions
│   │   └── telemetry.types.ts             # Telemetry data structures
│   │
│   ├── di/                                # DI registration
│   │   └── register.ts                    # registerAnalyticsServices(container)
│   │
│   └── index.ts                           # Public API exports
│
├── project.json                           # Nx project config
├── tsconfig.json                          # TypeScript config
├── tsconfig.lib.json                      # Library-specific config
├── jest.config.ts                         # Jest testing config
└── README.md                              # Usage documentation
```

---

## 🔗 Integration Points

### Upstream Dependencies

**Libraries This Task Depends On**:

1. **@ptah-extension/shared** (types)

   - Event types, message types
   - Zod schemas for validation
   - Branded types

2. **@ptah-extension/vscode-core** (from TASK_CORE_001)

   - Logger service
   - ErrorHandler service
   - EventBus for analytics events
   - ConfigManager for analytics settings (opt-in/opt-out)

3. **@ptah-extension/workspace-intelligence** (optional integration)

   - Workspace metrics (file counts, project type, etc.)
   - Context size tracking

4. **@ptah-extension/ptah-session** (TASK_SES_001 - optional)
   - Session duration metrics
   - Session-based aggregation
   - Can work without it (graceful degradation)

**Assumption**: TASK_CORE_001 completes BEFORE this task starts (provides vscode-core)

---

### Downstream Integrations

**Libraries That Will Use This**:

1. **Main App** (after integration)

   - Analytics dashboard UI
   - Export functionality
   - User settings for analytics opt-in/opt-out

2. **Future Libraries** (Week 8)
   - Performance monitoring uses analytics for baseline metrics
   - Dashboard visualizations consume analytics data

---

## 📊 Research Context

### Analytics Best Practices

**Research Questions** (to be answered in research-report.md):

1. **Privacy-First Analytics**:

   - How to track usage without PII?
   - Anonymous user IDs (VS Code machineId)
   - Data minimization principles
   - GDPR/privacy compliance

2. **Metrics to Track**:

   - **Token Usage**: Input/output tokens per provider
   - **Performance**: Response times, streaming latency
   - **User Behavior**: Feature usage frequency
   - **Quality**: Success/error rates
   - **Cost**: Estimated provider costs

3. **Storage Strategy**:

   - Local-only vs. opt-in telemetry server
   - Data retention policies
   - Storage quotas (VS Code limits)
   - Periodic cleanup

4. **Aggregation Patterns**:
   - Daily/weekly/monthly rollups
   - Session-based aggregation
   - Provider-based aggregation
   - Workspace-based aggregation

---

### Existing Patterns

**From workspace-intelligence Implementation** (TASK_PRV_005):

- ✅ TSyringe `@injectable()` decorators work well
- ✅ Symbol-based DI tokens prevent circular dependencies
- ✅ Separate service files <200 lines each
- ✅ Comprehensive unit tests (≥80% coverage)

**Lessons Applied**:

- Keep services small and focused
- Use `@injectable()` for all services
- Export via library `index.ts` with clear public API
- Write tests FIRST for TDD approach
- Document privacy considerations in README

---

## 🎯 Success Criteria

### Library Complete When

1. **All Services Implemented**:

   - [ ] AnalyticsCollector (event collection)
   - [ ] MetricsAggregator (metrics calculation)
   - [ ] TelemetryExporter (export functionality)
   - [ ] PrivacyFilter (PII filtering)

2. **Tests Passing**:

   - [ ] ≥80% coverage (line, branch, function)
   - [ ] All acceptance criteria tested
   - [ ] Privacy validation tests
   - [ ] Edge cases covered

3. **Architecture Validated**:

   - [ ] Zero `any` types
   - [ ] SOLID principles compliance
   - [ ] Zero circular dependencies
   - [ ] Services <200 lines each

4. **Privacy Validated**:

   - [ ] No PII in telemetry data
   - [ ] Anonymous user tracking only
   - [ ] Opt-in/opt-out support
   - [ ] Data minimization principles applied

5. **Integration Ready**:
   - [ ] Exported from `index.ts`
   - [ ] DI registration helper created
   - [ ] README with privacy policy
   - [ ] Migration guide from old AnalyticsDataCollector

---

## 📝 Key Decisions

### Architecture Decisions

**Decision 1: Storage Strategy**

- **Option A**: In-memory only (ephemeral)
- **Option B**: VS Code workspace state (persistent)
- **Option C**: External telemetry service
- **CHOSEN**: Option B with opt-in for C
- **Rationale**: Local storage by default, opt-in telemetry server for advanced users

**Decision 2: Privacy Approach**

- **Option A**: No analytics (user privacy first)
- **Option B**: Local-only analytics
- **Option C**: Opt-in telemetry to server
- **CHOSEN**: Option B + C (local by default, opt-in for cloud)
- **Rationale**: Respect user privacy, provide value through local insights

**Decision 3: Metrics Granularity**

- **Option A**: Aggregate only (daily summaries)
- **Option B**: Event-level storage (detailed)
- **CHOSEN**: Option B with periodic aggregation
- **Rationale**: Detailed data enables richer insights, aggregation saves storage

---

### Integration Decisions

**Decision 4: When to Integrate?**

- **Option A**: Integrate immediately after library creation
- **Option B**: Defer until TASK_INT_001 (after all libraries created)
- **CHOSEN**: Option B (defer integration)
- **Rationale**:
  - Main app keeps working during Week 7-9
  - All libraries integrate together in clean sweep
  - Less risk of breaking changes
  - Follows MONSTER plan principle: "Don't touch main app until Week 9"

**Decision 5: Dependency on TASK_SES_001**

- **Option A**: Hard dependency (block until session library complete)
- **Option B**: Soft dependency (graceful degradation)
- **CHOSEN**: Option B
- **Rationale**: Analytics can work without session context, just less rich data

---

## 🚀 Next Steps After Context Review

1. **Research Phase** (if needed):

   - Privacy-first analytics patterns
   - VS Code telemetry best practices
   - Metrics aggregation strategies
   - Create `research-report.md`

2. **Planning Phase**:

   - Detailed implementation plan
   - Service responsibilities breakdown
   - Privacy compliance checklist
   - Create `implementation-plan.md`

3. **Implementation Phase**:

   - TDD approach (tests first)
   - Service-by-service implementation
   - Privacy validation tests
   - Update `progress.md` every 30 minutes

4. **Validation Phase**:
   - Code review checklist
   - Privacy compliance check
   - Performance validation
   - Create `completion-report.md`

---

## 📚 Related Documentation

**MONSTER Plan Context**:

- [MONSTER_EXTENSION_REFACTOR_PLAN.md](../../docs/MONSTER_EXTENSION_REFACTOR_PLAN.md) - Lines 900+ (Week 7)
- [MONSTER_PROGRESS_TRACKER.md](../MONSTER_PROGRESS_TRACKER.md) - Week 7 section

**Previous Task Context**:

- [TASK_PRV_005](../TASK_PRV_005/) - workspace-intelligence library (reference implementation)
- [TASK_CORE_001](../TASK_CORE_001/) - Infrastructure foundation (dependency)
- [TASK_SES_001](../TASK_SES_001/) - Session library (soft dependency)

**Architecture References**:

- [AGENTS.md](../../AGENTS.md) - Universal agent framework
- [copilot-instructions.md](../../.github/copilot-instructions.md) - Ptah-specific patterns

---

**Context Status**: ✅ Ready for Research/Planning Phase  
**Blocked By**: TASK_CORE_001 (infrastructure) - can start research now, implementation after CORE_001 complete  
**Soft Dependency**: TASK_SES_001 (session library) - can work without it  
**Estimated Timeline**: 3-4 days implementation (after TASK_CORE_001)
