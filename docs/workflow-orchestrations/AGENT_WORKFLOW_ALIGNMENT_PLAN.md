# Agent Workflow Alignment Plan

**Status**: 🔄 In Progress  
**Created**: 2025-01-15  
**Purpose**: Align chatmodes and prompts with VS Code Copilot's agent switching mechanism

---

## 🎯 Core Problem

**Current State**: Prompts instruct the main thread to "invoke" agents programmatically  
**Reality**: VS Code Copilot cannot programmatically invoke agents  
**Solution**: User-driven agent chain where each agent provides the next message to send

---

## ✅ The Correct Pattern

### How It Works

1. **User types command**: `/orchestrate "task description"`
2. **Orchestrator analyzes**: Creates TASK_ID, context.md, analyzes task type
3. **Orchestrator provides slash command**: Gives user command like `/phase1-project-manager Task ID: TASK_2025_XXX, ...`
4. **User copies/sends command**: VS Code Copilot automatically loads prompt and switches to agent mode
5. **Project-manager executes**: Creates task-description.md
6. **Project-manager waits**: User validates deliverable
7. **Project-manager provides slash command**: Gives next command to user
8. **Loop continues**: Until all phases complete

### Key Principle

**Each agent ends by providing a slash command for the user to execute next**

---

## 📝 Required Changes

### 1. Update `orchestrate.prompt.md`

#### Current Problem

The prompt tries to "invoke" agents programmatically.

#### Required Fix

Provide slash commands in this format:

```markdown
## 📍 NEXT STEP: Switch to Project Manager

**Copy and send this command:**
```

/phase1-project-manager Task ID: TASK_2025_XXX, User Request: "Add notifications"

```

```

The `/phase1-project-manager` part tells VS Code Copilot to load that prompt file automatically.

---

### 2. Update ALL Phase Prompts

Add this section to **every** phase prompt file:

```markdown
---
## 📤 PHASE COMPLETE - HANDOFF PROTOCOL

### My Work Summary
- ✅ [Deliverable created]
- ✅ [Work completed]
---

### USER VALIDATION (if PM or Architect only)

Please review `task-tracking/{TASK_ID}/[deliverable].md` and respond:

- "APPROVED ✅" to proceed
- Or provide specific feedback

[Wait for user response]

---

### 📨 MESSAGE TO SEND NEXT

**Copy and send this message to continue:**

---

@workspace Continue orchestration for {TASK_ID}.

**Completed Phase**: [agent-name]
**Deliverable**: task-tracking/{TASK_ID}/[file.md]
**User Validation**: [APPROVED ✅ | N/A]

**Context**:
#file:task-tracking/{TASK_ID}/context.md
#file:task-tracking/{TASK_ID}/[deliverable.md]

Provide next phase guidance.

---
```

---

### 3. Update Chatmodes

Add instructions to each chatmode about providing handoff messages:

```markdown
## Completion Protocol

When you complete your work:

1. **Summarize deliverables** created
2. **If PM or Architect**: Wait for user validation
3. **Provide handoff message**: Give user exact text to send to continue workflow

### Handoff Message Format
```

@workspace Continue orchestration for {TASK_ID}.

**Completed Phase**: [your-agent-name]
**Deliverable**: [file-path]
**User Validation**: [APPROVED ✅ | N/A]

**Context**:

# file:[relevant-context-files]

Provide next phase guidance.

```

```

---

## 🔧 Implementation Steps

### Phase 1: Update Core Orchestrator

- [ ] Update `orchestrate.prompt.md`:
  - [ ] Replace all "invoke agent" instructions
  - [ ] Add "MESSAGE TO SEND" format for each NEXT ACTION
  - [ ] Include `@workspace` prefix
  - [ ] Add `#file` references

### Phase 2: Update All Phase Prompts

- [ ] `phase1-project-manager.prompt.md`

  - [ ] Add HANDOFF PROTOCOL section
  - [ ] Include validation pause
  - [ ] Provide return message

- [ ] `phase2-researcher-expert.prompt.md`

  - [ ] Add HANDOFF PROTOCOL section
  - [ ] Provide return message (no validation)

- [ ] `phase3-ui-ux-designer.prompt.md`

  - [ ] Add HANDOFF PROTOCOL section
  - [ ] Provide return message (no validation)

- [ ] `phase4-software-architect.prompt.md`

  - [ ] Add HANDOFF PROTOCOL section
  - [ ] Include validation pause
  - [ ] Provide return message

- [ ] `phase5a-team-leader-mode1.prompt.md`

  - [ ] Add HANDOFF PROTOCOL section
  - [ ] Provide message to invoke developer

- [ ] `phase5b-team-leader-mode2.prompt.md`

  - [ ] Add HANDOFF PROTOCOL section
  - [ ] Provide message for next iteration or completion

- [ ] `phase5c-team-leader-mode3.prompt.md`

  - [ ] Add HANDOFF PROTOCOL section
  - [ ] Provide message to ask user for QA choice

- [ ] `phase6-qa.prompt.md`

  - [ ] Add HANDOFF PROTOCOL section
  - [ ] Provide return message

- [ ] `phase6-code-reviewer.prompt.md`

  - [ ] Add HANDOFF PROTOCOL section
  - [ ] Provide return message

- [ ] `phase8-modernization-detector.prompt.md`
  - [ ] Add HANDOFF PROTOCOL section
  - [ ] Signal workflow complete

### Phase 3: Update Chatmodes

- [ ] `workflow-orchestrator.chatmode.md`
  - [ ] Add instructions for providing next messages
- [ ] `product-manager.chatmode.md`
  - [ ] Add handoff message instructions
- [ ] `software-architect.chatmode.md`
  - [ ] Add handoff message instructions
- [ ] `team-leader.chatmode.md`
  - [ ] Add handoff message instructions for all 3 modes
- [ ] `backend-developer.chatmode.md`
  - [ ] Add completion report format
- [ ] `frontend-developer.chatmode.md`
  - [ ] Add completion report format
- [ ] All other chatmodes
  - [ ] Add handoff message instructions

### Phase 4: Testing

- [ ] Test complete feature workflow (PM → Architect → Dev → QA)
- [ ] Test bugfix workflow (Dev → QA)
- [ ] Test refactoring workflow (Architect → Dev)
- [ ] Verify user validation pauses work (PM, Architect)
- [ ] Verify context flows correctly through handoffs

---

## 📋 Message Format Standards

### For Switching TO an Agent

```text
@workspace Act as [agent-name] for {TASK_ID}.

#file:.github/prompts/[phase-prompt.prompt.md]

**Context**:
- Task ID: {TASK_ID}
- [Additional context...]

**Previous Work**:
#file:task-tracking/{TASK_ID}/[previous-deliverable.md]

Follow the phase prompt instructions.
```

### For Returning TO Orchestrator

```text
@workspace Continue orchestration for {TASK_ID}.

**Completed Phase**: [agent-name]
**Deliverable**: task-tracking/{TASK_ID}/[file.md]
**User Validation**: [APPROVED ✅ | N/A]

**Context**:
#file:task-tracking/{TASK_ID}/context.md
#file:task-tracking/{TASK_ID}/[new-deliverable.md]

Provide next phase guidance.
```

### For Developer Completion Reports

```text
@workspace Continue orchestration for {TASK_ID}.

**Developer Report** (team-leader MODE 2 verification):
- Task: Task X from tasks.md
- Status: ✅ COMPLETE
- Commit: [SHA]
- Files: [list modified files]

**Context**:
#file:task-tracking/{TASK_ID}/tasks.md

Verify and assign next task.
```

---

## 🎯 Key Benefits

1. **Works with Copilot**: No programmatic invocation attempts
2. **User Control**: User sees and approves each transition
3. **Context Preservation**: All context flows through messages
4. **Clear Handoffs**: No ambiguity about what to do next
5. **Debuggable**: User can see exactly where in workflow
6. **Flexible**: User can modify messages if needed

---

## 🚨 Critical Rules

### Rule 1: Every Agent Provides Next Message

**EVERY** agent must end with exact message text for user to send.

### Rule 2: No "Invoke" Language

**NEVER** say "invoke", "call", or "execute" another agent. Always "send this message".

### Rule 3: Exact Message Text

Provide the **exact** message to send, not instructions to formulate one.

### Rule 4: Validation Pauses

**ONLY** PM and Architect pause for user validation. Others proceed immediately.

### Rule 5: @workspace Prefix

**ALWAYS** start agent-switching messages with `@workspace`.

### Rule 6: #file References

**ALWAYS** include `#file` references for prompts and context files.

---

## 📖 Complete Reference

See `COPILOT_AGENT_SWITCHING_WORKFLOW.md` for:

- Complete example flow
- Detailed implementation guide
- Message templates
- Anti-patterns to avoid
- Testing checklist

---

## ✅ Success Criteria

Workflow is correctly aligned when:

- [ ] User can complete entire orchestration by copy/pasting provided messages
- [ ] No agent attempts programmatic invocation
- [ ] All context flows correctly through handoffs
- [ ] User validation pauses work (PM, Architect)
- [ ] Team-leader iterative pattern works (MODE 2 loop)
- [ ] QA choice mechanism works (user decides)
- [ ] Workflow completes with all deliverables created

---

**This alignment enables seamless orchestrated workflows within VS Code Copilot's actual capabilities.**
