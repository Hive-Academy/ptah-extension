# TASK_SES_001 Context - Session Library Extraction

**Created**: October 10, 2025  
**MONSTER Week**: 7  
**Parent Plan**: [MONSTER_EXTENSION_REFACTOR_PLAN.md](../../docs/MONSTER_EXTENSION_REFACTOR_PLAN.md)

---

## 🎯 Task Origin

### User Request Alignment

This task directly implements **Week 7** of the MONSTER plan as confirmed by the user:

> "we just finished week 6 and all the previous weeks from the monster plan so week 7 should be our next target"

Week 7 in MONSTER plan (lines 900+):

```markdown
Week 7: Session & Analytics Libraries

- Extract session-manager.ts → ptah-session library
- Extract analytics-data-collector.ts → ptah-analytics library
- Delete from main app (~350 lines)
```

### Strategic Context

**Where We Are**:

- ✅ Week 6 COMPLETE: workspace-intelligence library (3,003 lines, 98% coverage)
- ✅ TASK_PRV_005 delivered 12 services ready for integration
- 📋 TASK_CORE_001 in progress: Infrastructure foundation (Weeks 1-6 deferred work)

**Why Session Library NOW**:

1. **Foundational for Analytics**: Analytics depends on session context
2. **User Experience**: Sessions power chat continuity, workspace memory
3. **Business Logic Layer**: Session is pure business logic (not infrastructure)
4. **Integration Ready**: Once TASK_CORE_001 completes, session can integrate cleanly

---

## 📁 Main App Code Analysis

### Source Files to Extract

**Primary Source**:

```
apps/ptah-extension-vscode/src/services/session-manager.ts (~200 lines)
```

**Current Responsibilities**:

- Session lifecycle (create, resume, end)
- VS Code context/workspace state storage
- Session metadata management
- Token tracking per session
- Multi-workspace session handling

**Dependencies in Main App**:

- `@ptah-extension/shared` types (StrictChatSession, SessionId)
- VS Code APIs (vscode.workspace.getConfiguration, context.workspaceState)
- Logger service (for session lifecycle logging)
- EventBus (for session events)

### Session-Related Message Handlers

**In**: `apps/ptah-extension-vscode/src/services/webview-message-handlers/`

**Handlers to Review**:

- `session-message-handler.ts` - Session CRUD operations
- Message types: `createSession`, `resumeSession`, `endSession`, `listSessions`

**Strategy**: These handlers will use the extracted library services instead of direct SessionManager

---

## 🏗️ Target Library Structure

### Proposed Architecture

```
libs/backend/ptah-session/
├── src/
│   ├── backend/                    # Extension-side session logic
│   │   ├── session-manager.service.ts      # Core session orchestration
│   │   ├── session-storage.service.ts      # VS Code storage abstraction
│   │   ├── session-validator.service.ts    # Session validation logic
│   │   └── session-lifecycle.service.ts    # Lifecycle hooks
│   │
│   ├── shared/                     # Shared session types (reuse @ptah-extension/shared)
│   │   ├── session.types.ts        # Re-export StrictChatSession, SessionId
│   │   ├── session-events.types.ts # Session event types
│   │   └── session-errors.types.ts # Session-specific errors
│   │
│   ├── di/                         # DI registration
│   │   └── register.ts             # registerSessionServices(container)
│   │
│   └── index.ts                    # Public API exports
│
├── project.json                    # Nx project config
├── tsconfig.json                   # TypeScript config
├── tsconfig.lib.json               # Library-specific config
├── jest.config.ts                  # Jest testing config
└── README.md                       # Usage documentation
```

---

## 🔗 Integration Points

### Upstream Dependencies

**Libraries This Task Depends On**:

1. **@ptah-extension/shared** (types)

   - `StrictChatSession`, `SessionId`, `MessageId`
   - Zod schemas for validation
   - Branded types

2. **@ptah-extension/vscode-core** (from TASK_CORE_001)

   - Logger service
   - ErrorHandler service
   - EventBus for session events
   - ConfigManager for session settings

3. **@ptah-extension/workspace-intelligence** (optional integration)
   - Workspace context for session metadata
   - Project type detection for session classification

**Assumption**: TASK_CORE_001 completes BEFORE this task starts (provides vscode-core)

---

### Downstream Integrations

**Libraries That Will Use This**:

1. **@ptah-extension/analytics** (TASK_ANLYT_001)

   - Session duration tracking
   - Session-based metrics aggregation

2. **Main App** (after integration)

   - Chat message handlers use SessionManager
   - Webview UI displays active sessions

3. **Future Libraries** (Week 8-9)
   - Performance monitoring tracks session performance
   - Theme system may use session preferences

---

## 📊 Research Context

### Existing Patterns

**From workspace-intelligence Implementation** (TASK_PRV_005):

- ✅ TSyringe `@injectable()` decorators work well
- ✅ Symbol-based DI tokens prevent circular dependencies
- ✅ Separate service files <200 lines each
- ✅ Comprehensive unit tests (≥80% coverage)
- ✅ Integration with VS Code APIs via direct calls (no abstraction needed yet)

**Lessons Applied**:

- Keep services small and focused
- Use `@injectable()` for all services
- Export via library `index.ts` with clear public API
- Write tests FIRST for TDD approach
- Document integration points in README

---

### Session Management Best Practices

**Research Questions** (to be answered in research-report.md):

1. How do VS Code extensions typically persist session state?

   - Workspace state vs. global state
   - Memento API patterns
   - Storage quotas and limits

2. What's the best pattern for session lifecycle hooks?

   - onCreate, onResume, onEnd, onDestroy
   - Cleanup and resource disposal
   - Error recovery strategies

3. How to handle multi-workspace sessions?

   - Workspace-scoped vs. global sessions
   - Switching between workspaces
   - Conflict resolution

4. Session validation strategies?
   - Zod schemas for session data
   - Migration strategies for schema changes
   - Handling corrupted session data

---

## 🎯 Success Criteria

### Library Complete When

1. **All Services Implemented**:

   - [ ] SessionManager (orchestration)
   - [ ] SessionStorage (VS Code storage abstraction)
   - [ ] SessionValidator (Zod validation)
   - [ ] SessionLifecycle (hooks)

2. **Tests Passing**:

   - [ ] ≥80% coverage (line, branch, function)
   - [ ] All acceptance criteria tested
   - [ ] Edge cases covered

3. **Architecture Validated**:

   - [ ] Zero `any` types
   - [ ] SOLID principles compliance
   - [ ] Zero circular dependencies
   - [ ] Services <200 lines each

4. **Integration Ready**:
   - [ ] Exported from `index.ts`
   - [ ] DI registration helper created
   - [ ] README with usage examples
   - [ ] Migration guide from old SessionManager

---

## 📝 Key Decisions

### Architecture Decisions

**Decision 1: Storage Strategy**

- **Option A**: Direct VS Code Memento API
- **Option B**: Storage abstraction layer
- **CHOSEN**: Option B (SessionStorage service)
- **Rationale**: Easier testing, future flexibility (could swap storage)

**Decision 2: Session Scope**

- **Option A**: Global sessions only
- **Option B**: Workspace-scoped sessions
- **CHOSEN**: Option B with global fallback
- **Rationale**: Aligns with VS Code workspace model, better multi-root support

**Decision 3: Validation Approach**

- **Option A**: Manual validation
- **Option B**: Zod schemas (reuse @ptah-extension/shared)
- **CHOSEN**: Option B
- **Rationale**: Type safety, runtime validation, schema evolution support

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

---

## 🚀 Next Steps After Context Review

1. **Research Phase** (if needed):

   - VS Code session persistence patterns
   - Multi-workspace session handling
   - Session lifecycle best practices
   - Create `research-report.md`

2. **Planning Phase**:

   - Detailed implementation plan
   - Service responsibilities breakdown
   - Testing strategy
   - Create `implementation-plan.md`

3. **Implementation Phase**:

   - TDD approach (tests first)
   - Service-by-service implementation
   - Update `progress.md` every 30 minutes

4. **Validation Phase**:
   - Code review checklist
   - Architecture compliance check
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

**Architecture References**:

- [AGENTS.md](../../AGENTS.md) - Universal agent framework
- [copilot-instructions.md](../../.github/copilot-instructions.md) - Ptah-specific patterns

---

**Context Status**: ✅ Ready for Research/Planning Phase  
**Blocked By**: TASK_CORE_001 (infrastructure) - can start research now, implementation after CORE_001 complete  
**Estimated Timeline**: 3-4 days implementation (after TASK_CORE_001)
