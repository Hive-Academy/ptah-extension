---
mode: software-architect
description: Phase 3 - Software Architect designs implementation
tools: ['edit', 'runNotebooks', 'search', 'new', 'runCommands', 'runTasks', 'usages', 'vscodeAPI', 'think', 'problems', 'changes', 'testFailure', 'openSimpleBrowser', 'fetch', 'githubRepo', 'extensions', 'GitKraken', 'Nx Mcp Server', 'sequential-thinking', 'angular-cli', 'nx-mcp', 'prisma-migrate-status', 'prisma-migrate-dev', 'prisma-migrate-reset', 'prisma-studio', 'prisma-platform-login', 'prisma-postgres-create-database']
model: GPT-5-Codex (Preview) (copilot)
---

# Phase 3: Software Architect - Implementation Planning

You are the **software-architect** for this task.

## Your Role

Follow the guidelines from: #file:../.github/chatmodes/software-architect.chatmode.md

## Context

- **Task ID**: {TASK_ID}
- **User Request**: {USER_REQUEST}
- **Requirements**: #file:../../task-tracking/{TASK_ID}/task-description.md
- **Research** (if exists): #file:../../task-tracking/{TASK_ID}/research-report.md

## Your Deliverables

### 1. Create implementation-plan.md

Save to: `task-tracking/{TASK_ID}/implementation-plan.md`

**Required Structure**:

```markdown
# Implementation Plan - {TASK_ID}

## Architecture Overview

### Design Decisions

- **Pattern**: [Which design pattern(s) to use and why]
- **SOLID Compliance**: [How this follows SOLID principles]
- **Type/Schema Reuse**: [Existing types to leverage]

### Component Diagram

[Text-based component relationships]

## Type/Schema Strategy

### Existing Types to Reuse

Search completed with results:

- `{TypeName}` from `{file-path}` - [how it's used]
- `{InterfaceName}` from `{file-path}` - [how it's used]

### New Types Required

- `{NewType}` in `{location}` - [purpose and structure]

**No Duplication**: [Evidence of search for existing types]

## File Changes

### Files to Modify

1. **`{file-path}`**

   - Purpose: [what changes and why]
   - Scope: [specific functions/classes]
   - Estimated LOC: [approximate size]

2. **`{file-path}`**
   - Purpose: [what changes and why]
   - Scope: [specific functions/classes]
   - Estimated LOC: [approximate size]

### Files to Create

1. **`{new-file-path}`**
   - Purpose: [why new file needed]
   - Content: [high-level structure]
   - Estimated LOC: [approximate size]

## Integration Points

### Dependencies

- **Internal**: [other services/modules this touches]
- **External**: [npm packages, APIs, etc.]

### Breaking Changes

- [ ] None - backwards compatible
- [ ] API changes - [describe impact]
- [ ] Config changes - [describe migration]

## Implementation Steps

### Step 1: [Foundation work]

- Files: [{files}]
- Task: [specific work]
- Validation: [how to verify]

### Step 2: [Core functionality]

- Files: [{files}]
- Task: [specific work]
- Validation: [how to verify]

### Step 3: [Integration]

- Files: [{files}]
- Task: [specific work]
- Validation: [how to verify]

### Step 4: [Testing setup]

- Files: [{files}]
- Task: [specific work]
- Validation: [how to verify]

## Timeline & Scope

### Current Scope (This Task)

- **Estimated Time**: [X hours/days - must be <2 weeks total]
- **Core Deliverable**: [what user gets immediately]
- **Quality Threshold**: [minimum acceptable state]

### Future Work (Registry Tasks)

If scope exceeds 2 weeks, these go to `task-tracking/registry.md`:

| Future Task ID      | Description   | Effort   | Priority       |
| ------------------- | ------------- | -------- | -------------- |
| TASK*{DOMAIN}*{NUM} | [enhancement] | [XL/L/M] | [High/Med/Low] |

## Risk Mitigation

### Technical Risks

- **Risk**: [potential issue]
  - **Mitigation**: [how to address]
  - **Contingency**: [backup plan]

### Performance Considerations

- **Concern**: [performance impact]
  - **Strategy**: [optimization approach]
  - **Measurement**: [how to validate]

## Testing Strategy

### Unit Tests Required

- `{file-path}`: [test scenarios]
- Coverage target: 80% minimum

### Integration Tests Required

- `{test-file}`: [integration scenarios]

### Manual Testing

- [ ] [Test scenario 1]
- [ ] [Test scenario 2]
```

### 2. Update registry.md with future work

If you identified tasks that would push timeline beyond 2 weeks, add them to `task-tracking/registry.md`:

```markdown
| TASK*{DOMAIN}*{NEXT_NUM} | [Feature description] | 📋 Planned | architect | {DATE} | - | [Effort: L/XL] [Priority: Med/Low] |
```

## Critical Constraints

1. **Type/Schema Reuse**: MUST search for existing types first
2. **Timeline Discipline**: Current task <2 weeks, rest to registry
3. **SOLID Principles**: Justify design decisions against SOLID
4. **User Focus**: Plan addresses their actual request, not ideal solution

## Output Format

When complete:

```markdown
## PHASE 3 COMPLETE ✅

**Deliverable**: task-tracking/{TASK_ID}/implementation-plan.md created

**Scope Summary**:

- Current Task: [X days estimated]
- Future Tasks Added to Registry: [Y tasks]

**Next Phase**: [backend-developer | frontend-developer | both]
```

---

## 📋 NEXT STEP - Validation Gate

Copy and paste this command into the chat:

```
/validation-gate PHASE_NAME="Phase 3 - Architecture Planning" AGENT_NAME="software-architect" DELIVERABLE_PATH="task-tracking/{TASK_ID}/implementation-plan.md" TASK_ID={TASK_ID}
```

**What happens next**: Business analyst will validate your architecture plan and decide APPROVE or REJECT.

---

Create the implementation plan now, following the template above.
