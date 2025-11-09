# TASK_CORE_001 Context

**Created**: October 10, 2025  
**User Request**: "can we target them ( make sure we have all work done until phase 7 ) all in a new task please and lets scan our old application code for reference"

---

## 🎯 Task Origin

User correctly identified that we've deferred significant infrastructure work from MONSTER Weeks 1-6 while completing Week 6 (workspace-intelligence library). Before proceeding to Week 7 (Session & Analytics), we need to complete ALL deferred work to establish a solid foundation.

---

## 📊 Main App Code Scan Results

**Total Infrastructure Files Found**: 32 TypeScript files

**Breakdown by Category**:

### Core Infrastructure (→ vscode-core): ~1,788 lines

- service-registry.ts (188 lines) - Custom DI → TSyringe
- logger.ts (~80 lines)
- error-handler.ts (~100 lines)
- ptah-config.service.ts (~200 lines)
- command-registry.ts (~150 lines)
- webview-registry.ts (~120 lines)
- event-registry.ts (~100 lines) - Already have EventBus!
- command-handlers.ts (~200 lines)
- angular-webview.provider.ts (~300 lines)
- webview-html-generator.ts (~120 lines)
- webview-diagnostic.ts (~80 lines)
- validation/ (~150 lines)

### AI Provider System (→ ai-providers-core): ~980 lines

- provider-manager.ts (~200 lines)
- provider-factory.ts (~150 lines)
- base-ai-provider.ts (~100 lines)
- vscode-lm-provider.ts (~200 lines)
- claude-cli-provider-adapter.ts (~150 lines)
- context-manager.ts (~180 lines)

### Claude Domain (→ claude-domain): ~750 lines

- claude-cli.service.ts (~500 lines)
- claude-cli-detector.service.ts (~100 lines)
- command-builder.service.ts (~150 lines)

### Session Management (→ Week 7): ~200 lines

- session-manager.ts (~200 lines) - DEFER to TASK_PRV_007

### Analytics (→ Week 7): ~150 lines

- analytics-data-collector.ts (~150 lines) - DEFER to TASK_PRV_008

### Already Extracted: 460 lines

- workspace-manager.ts - Replaced by workspace-intelligence ✅

---

## 🎯 Scope Decision

**Include in TASK_CORE_001**:

1. ✅ vscode-core library (Weeks 2-3 work)
2. ✅ ai-providers-core library completion (Week 4 work)
3. ✅ claude-domain library extraction (Week 5 work)

**DEFER to Week 7**:

1. ❌ Session management (TASK_PRV_007)
2. ❌ Analytics (TASK_PRV_008)

**Rationale**:

- vscode-core, ai-providers-core, claude-domain are INFRASTRUCTURE
- Session and Analytics are BUSINESS LOGIC
- Infrastructure should be complete before business logic libraries
- Aligns with MONSTER plan sequencing

---

## 🚀 Next Steps

1. Review and approve task-description.md
2. Create implementation-plan.md with detailed architecture
3. Begin Phase 1 (DI & Core Infrastructure)
4. Track progress in progress.md

---

**Task Status**: Ready for implementation planning
