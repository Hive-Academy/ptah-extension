# Copilot Agent Switching Workflow - Complete Guide

**Status**: ✅ Production Ready  
**Created**: 2025-01-15  
**Purpose**: Define how orchestration works with VS Code Copilot's agent switching mechanism

---

## 🎯 Core Concept: User-Driven Agent Chain

VS Code Copilot **cannot programmatically invoke other agents**. Instead, each agent must:

1. **Complete its work**
2. **Tell the user** what message to send next
3. **User copies and sends** that message to switch agents

This creates a **user-driven agent chain** where each agent hands off to the next by providing the user with the exact message to send.

---

## 🔄 Workflow Pattern

```
User types: /orchestrate "task description"
    ↓
Main Copilot executes orchestrate.prompt.md
    ↓
Main thread analyzes task, creates TASK_ID + context.md
    ↓
Main thread returns: "Send this message to switch to project-manager:"
    ↓
User copies and sends message
    ↓
project-manager agent executes phase1-project-manager.prompt.md
    ↓
project-manager completes work, returns: "Send this message for user validation:"
    ↓
User reviews deliverable and replies "APPROVED ✅"
    ↓
User sends provided message to return to orchestrator
    ↓
Main thread (orchestrator mode) provides next agent message
    ↓
[Loop continues until workflow complete]
```

---

## 📋 Required Changes to Prompts

### 1. Orchestrate.prompt.md Changes

**Current Issue**: Instructs main thread to "invoke" agents using Task tool
**Required Fix**: Main thread should provide user with message to send

#### BEFORE (Current - Incorrect):

```markdown
### Agent to Invoke

**Agent Name**: project-manager

### Prompt for Agent

[Full prompt text...]

### What I Need Back

After invoking project-manager, return results to me.
```

#### AFTER (Correct Pattern):

```markdown
## 📍 NEXT ACTION: SWITCH TO AGENT

### Message for User to Send

**Copy and send this message exactly:**

---

@workspace I need you to act as the project-manager agent for TASK_2025_XXX.

#file:.github/prompts/phase1-project-manager.prompt.md

**Context**:

- Task ID: TASK_2025_XXX
- User Request: "[ORIGINAL REQUEST]"
- Task folder: task-tracking/TASK_2025_XXX/

Follow the phase1-project-manager.prompt.md instructions exactly.

---

**After project-manager completes:**

1. Review the task-description.md they create
2. Reply with "APPROVED ✅" or provide feedback
3. project-manager will then provide you with the next message to send
```

### 2. Phase Prompt Changes (All Phases)

**Current Issue**: Phase prompts end without telling user what to send next
**Required Fix**: Each phase must end with "Message to Send Next"

#### Standard Completion Format:

```markdown
## 📤 PHASE COMPLETE - NEXT STEPS

### My Deliverables

- ✅ [file created]
- ✅ [work completed]

### For User Validation (if PM or Architect)

Please review [deliverable file] and reply:

- "APPROVED ✅" to proceed
- Or provide specific feedback for corrections

### Message to Send After Approval

**Copy and send this message to return to orchestrator:**

---

@workspace Continue orchestration for TASK_2025_XXX.

**Agent Completed**: [agent-name]
**Deliverable Created**: [file-path]
**User Validation**: [APPROVED ✅ | N/A]

**Context**:
#file:task-tracking/TASK_2025_XXX/context.md
#file:task-tracking/TASK_2025_XXX/[deliverable-file]

Please provide next phase guidance.

---
```

---

## 🎨 Complete Example Flow

### Step 1: User Starts Orchestration

**User types:**

```
/orchestrate "Add real-time notifications feature"
```

### Step 2: Main Thread Initializes

**Main thread executes** `orchestrate.prompt.md` and responds:

```markdown
# 🎯 Workflow Orchestration - Initial Analysis

## Task Information

- **Task ID**: TASK_2025_015
- **Type**: FEATURE
- **Complexity**: Complex

## Phase 0: Initialization ✅ COMPLETE

- Task ID generated: TASK_2025_015
- Context file created: task-tracking/TASK_2025_015/context.md

## 📍 NEXT ACTION: SWITCH TO PROJECT-MANAGER

### Message to Send

**Copy and send this message exactly:**

---

@workspace Act as project-manager for TASK_2025_015.

#file:.github/prompts/phase1-project-manager.prompt.md

**Context**:

- Task ID: TASK_2025_015
- User Request: "Add real-time notifications feature"
- Task folder: task-tracking/TASK_2025_015/

Follow phase1-project-manager.prompt.md instructions.

---
```

### Step 3: User Switches to Project-Manager

**User copies and sends the message**

**project-manager executes** `phase1-project-manager.prompt.md` and responds:

```markdown
# Project Manager - Phase Complete ✅

## Deliverables Created

- ✅ task-description.md (comprehensive requirements)
- ✅ Registry updated to "🔄 Active (Requirements)"

## For Your Review

I've created comprehensive requirements in:
`task-tracking/TASK_2025_015/task-description.md`

**Please review and respond with:**

- "APPROVED ✅" to proceed to architecture phase
- Or provide specific feedback for corrections

[I'll wait for your validation before providing next steps]
```

### Step 4: User Validates

**User reviews file and responds:**

```
APPROVED ✅
```

### Step 5: Project-Manager Provides Next Message

**project-manager responds:**

```markdown
# ✅ Requirements Approved - Ready for Architecture

### Message to Send Next

**Copy and send this message to continue:**

---

@workspace Continue orchestration for TASK_2025_015.

**Completed Phase**: Phase 1 (project-manager)
**Deliverable**: task-tracking/TASK_2025_015/task-description.md
**User Validation**: APPROVED ✅

**Context**:
#file:task-tracking/TASK_2025_015/context.md
#file:task-tracking/TASK_2025_015/task-description.md

Provide next phase guidance (software-architect recommended).

---
```

### Step 6: User Returns to Orchestrator

**User copies and sends the message**

**Main thread (orchestrator mode) responds:**

```markdown
# 🎯 Workflow Orchestration - Progress Update

## Current Status

- **Task ID**: TASK_2025_015
- **Progress**: 2/10 phases complete
- **Last Agent**: project-manager ✅ COMPLETED (user validated)

## 📍 NEXT ACTION: SWITCH TO SOFTWARE-ARCHITECT

### Message to Send

**Copy and send this message exactly:**

---

@workspace Act as software-architect for TASK_2025_015.

#file:.github/prompts/phase4-software-architect.prompt.md

**Context**:

- Task ID: TASK_2025_015
- Task folder: task-tracking/TASK_2025_015/
- Requirements: #file:task-tracking/TASK_2025_015/task-description.md

Follow phase4-software-architect.prompt.md instructions.

---
```

### Step 7: Loop Continues

**Pattern repeats** until all phases complete:

- User sends message → Agent executes → Agent provides next message → User sends it

---

## 🔧 Implementation Checklist

### For orchestrate.prompt.md:

- [ ] Remove "Use Task tool to invoke agent" instructions
- [ ] Add "Message to Send" format for each NEXT ACTION
- [ ] Include exact message text user should copy/send
- [ ] Add `@workspace` prefix to messages
- [ ] Include `#file` references for prompts and context

### For Each Phase Prompt (phase1-project-manager.prompt.md, etc.):

- [ ] Add "PHASE COMPLETE - NEXT STEPS" section at end
- [ ] For PM/Architect: Include user validation instructions
- [ ] Provide "Message to Send After Approval" with exact text
- [ ] Include context file references in handoff message
- [ ] Use `@workspace` prefix for agent switching

### For Each Chatmode (project-manager.chatmode.md, etc.):

- [ ] Add instructions to provide "next message" at completion
- [ ] Include format for handoff messages
- [ ] Specify when to wait for user validation
- [ ] Define completion signal format

---

## 📝 Template: Phase Prompt Completion Section

**Add this to the end of EVERY phase prompt:**

```markdown
---
## 📤 PHASE COMPLETE - HANDOFF PROTOCOL

### My Work Summary
- ✅ [Deliverable 1 created]
- ✅ [Deliverable 2 completed]
- ✅ [Quality check passed]
---

### USER VALIDATION REQUIRED (if PM or Architect)

**Deliverable to Review**: `task-tracking/{TASK_ID}/[file-name.md]`

Please review this deliverable and respond:

- Reply **"APPROVED ✅"** if satisfied and ready to proceed
- Or provide **specific feedback** for corrections

[I'll wait for your response before providing next steps]

---

### FOR OTHER AGENTS (no validation needed)

Proceed directly with handoff message below.

---

### 📨 MESSAGE TO SEND NEXT

After [validation if needed], **copy and send this message** to continue the workflow:

---

@workspace Continue orchestration for {TASK_ID}.

**Completed Phase**: [Phase Name] ([agent-name])
**Deliverable**: task-tracking/{TASK_ID}/[deliverable-file.md]
**User Validation**: [APPROVED ✅ | N/A]
**Status**: ✅ PHASE COMPLETE

**Context Files**:
#file:task-tracking/{TASK_ID}/context.md
#file:task-tracking/{TASK_ID}/[deliverable-file.md]

Please analyze completion and provide guidance for next phase.

---

**Copy the message above and send it to continue the orchestration workflow.**
```

---

## 📝 Template: Orchestrator Next Action Format

**Use this format in orchestrate.prompt.md for EVERY agent recommendation:**

```markdown
## 📍 NEXT ACTION: SWITCH TO AGENT

### Agent Recommendation

**Agent**: [agent-name]
**Phase**: [Phase N: Description]
**Purpose**: [What this agent will do]

---

### 📨 MESSAGE TO SEND

**Copy and send this message to switch to [agent-name]:**

---

@workspace Act as [agent-name] for {TASK_ID}.

#file:.github/prompts/[phase-prompt-file.prompt.md]

**Task Context**:

- Task ID: {TASK_ID}
- Task Type: [type]
- User Request: "[original request]"
- Task Folder: task-tracking/{TASK_ID}/

**Previous Phase Context** (if applicable):
#file:task-tracking/{TASK_ID}/[previous-deliverable.md]

**Your Mission**:
Follow the [phase-prompt-file.prompt.md] instructions to [describe what to create].

Execute your phase protocol now.

---

**After sending this message**, [agent-name] will [describe expected behavior].
```

---

## 🚨 Critical Rules

### Rule 1: No Programmatic Invocation

**NEVER** instruct main thread to "invoke" or "call" agents using tools. Always provide message text.

### Rule 2: Explicit Message Text

**ALWAYS** provide the **exact** message text user should copy/send, not instructions to "formulate a message".

### Rule 3: @workspace Prefix

**ALWAYS** start agent-switching messages with `@workspace` to indicate workspace context.

### Rule 4: #file References

**ALWAYS** include `#file` references for prompt files and context documents.

### Rule 5: Completion Handoff

**EVERY** agent must provide the next message to send at completion (or after validation).

### Rule 6: User Validation Stops

**ONLY** PM and Architect require user validation. All other agents proceed immediately.

### Rule 7: Context Preservation

**ALWAYS** include all relevant context files in handoff messages so next agent has full picture.

---

## 🎯 Benefits of This Pattern

1. **Works with VS Code Copilot**: No attempt to programmatically invoke agents
2. **User Control**: User sees and controls each agent transition
3. **Context Preservation**: Each message includes all necessary context
4. **Validation Points**: Clear points where user validates deliverables
5. **Traceable**: User can see exact workflow progression
6. **Debuggable**: If something breaks, user knows exactly where in chain
7. **Flexible**: User can modify messages if needed before sending

---

## 📋 Next Steps for Implementation

1. **Update orchestrate.prompt.md**:
   - Replace "invoke agent" instructions with "message to send" format
   - Add message templates for each NEXT ACTION
2. **Update all phase prompts**:
   - Add "PHASE COMPLETE - HANDOFF PROTOCOL" section
   - Include validation instructions for PM/Architect
   - Provide exact handoff message text
3. **Update chatmodes**:
   - Add instructions for providing handoff messages
   - Define completion signal formats
4. **Test the workflow**:
   - Run through complete orchestration
   - Verify each handoff message works
   - Ensure context flows correctly

---

## ✅ Validation Checklist

Before deployment, verify:

- [ ] orchestrate.prompt.md never uses "invoke" language
- [ ] All phase prompts end with handoff message
- [ ] PM and Architect prompts include validation pause
- [ ] All messages include `@workspace` prefix
- [ ] All messages include necessary `#file` references
- [ ] Handoff messages include completion status
- [ ] Context files are properly referenced
- [ ] User knows what to do at each step

---

**This pattern enables seamless agent orchestration within VS Code Copilot's constraints while maintaining full user control and context preservation.**
