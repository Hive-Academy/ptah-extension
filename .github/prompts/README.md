# Orchestration System - User Guide

## ✅ System Updated (2025-01-08)

All prompt files have been updated to support **user-driven workflow** instead of automated agent invocation.

## 🎯 How It Works

Each phase prompt now ends with a **clear "NEXT STEP" section** showing the exact command to copy/paste into VS Code chat.

### Example Flow

1. **User starts orchestration**:

   ```
   /orchestrate.prompt.md Week 4 Provider Core Infrastructure
   ```

2. **Phase 0 completes**, shows:

   ```
   ## NEXT STEP - Phase 1

   Copy and paste:
   /phase1-project-manager.prompt.md TASK_ID=TASK_PRV_001 USER_REQUEST="Week 4 Provider Core Infrastructure"
   ```

3. **User copies and pastes** that command

4. **Phase 1 completes**, shows next command for validation gate

5. **User runs validation**, which either:

   - ✅ **APPROVES** → Shows command for Phase 2 or 3
   - ❌ **REJECTS** → Shows command to re-run Phase 1 with corrections

6. **Repeat** until Phase 8 complete

## 📁 Updated Files

All phase prompts now have "NEXT STEP" sections:

- ✅ `orchestrate.prompt.md` - Phase 0 initialization
- ✅ `phase1-project-manager.prompt.md` - Requirements
- ✅ `phase2-researcher-expert.prompt.md` - Research (conditional)
- ✅ `phase3-software-architect.prompt.md` - Architecture
- ✅ `phase4-backend-developer.prompt.md` - Backend implementation
- ✅ `phase4-frontend-developer.prompt.md` - Frontend implementation
- ✅ `phase5-senior-tester.prompt.md` - Testing
- ✅ `phase6-code-reviewer.prompt.md` - Code review
- ✅ `phase8-modernization-detector.prompt.md` - Future work
- ✅ `validation-gate.prompt.md` - Validation with routing to next phases

## 🔄 Complete Workflow

### Starting a New Task

```
/orchestrate.prompt.md [your task description]
```

### Example Complete Workflow Commands

```bash
# Phase 0 - Initialization
/orchestrate.prompt.md Week 4 Provider Core Infrastructure

# Phase 1 - Requirements (after Phase 0 completes)
/phase1-project-manager.prompt.md TASK_ID=TASK_PRV_001 USER_REQUEST="Week 4 Provider Core Infrastructure"

# Validation Gate 1
/validation-gate.prompt.md PHASE_NAME="Phase 1 - Requirements Analysis" AGENT_NAME="project-manager" DELIVERABLE_PATH="task-tracking/TASK_PRV_001/task-description.md" TASK_ID=TASK_PRV_001

# Phase 3 - Architecture (assuming research skipped)
/phase3-software-architect.prompt.md TASK_ID=TASK_PRV_001

# Validation Gate 3
/validation-gate.prompt.md PHASE_NAME="Phase 3 - Architecture Planning" AGENT_NAME="software-architect" DELIVERABLE_PATH="task-tracking/TASK_PRV_001/implementation-plan.md" TASK_ID=TASK_PRV_001

# Phase 4 - Backend Development
/phase4-backend-developer.prompt.md TASK_ID=TASK_PRV_001

# ... and so on through all phases
```

## 🎯 Key Points

1. **Manual Transitions**: You must manually run each phase command
2. **Clear Instructions**: Each phase tells you exactly what to run next
3. **Validation Gates**: Business analyst validates after each phase
4. **Conditional Routing**: Validation gate shows different next steps based on approval/rejection
5. **Context Passing**: Task ID and context carry forward through phases

## 📖 Context Variables

Commands use these variables (replace with actual values):

- `{TASK_ID}` - e.g., `TASK_PRV_001`
- `{USER_REQUEST}` - Your original task description
- `{PHASE_NAME}` - e.g., `"Phase 1 - Requirements Analysis"`
- `{AGENT_NAME}` - e.g., `project-manager`
- `{DELIVERABLE_PATH}` - e.g., `task-tracking/TASK_PRV_001/task-description.md`

## 🚀 Quick Start

1. Run: `/orchestrate.prompt.md [task description]`
2. Copy the next command shown
3. Paste and run
4. Repeat until task complete

## ⚠️ Important Notes

- **Don't skip validation gates** - they ensure quality
- **Copy commands exactly** - including all parameters
- **Wait for completion signals** - each phase shows "PHASE X COMPLETE ✅"
- **Follow instructions** - each phase has specific deliverables

## 📚 Additional Resources

- See `docs/MODULAR_ORCHESTRATION_SYSTEM.md` for architecture details
- See `docs/CHATMODE_ORCHESTRATION_GUIDE.md` for technical background
- See `AGENTS.md` for agent roles and responsibilities

---

**System Status**: ✅ Production Ready  
**Last Updated**: 2025-01-08  
**Updated By**: GitHub Copilot + User Collaboration
