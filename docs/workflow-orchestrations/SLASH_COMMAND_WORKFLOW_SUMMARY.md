# Slash Command Workflow - Implementation Summary

**Status**: ✅ Complete  
**Date**: 2025-01-15  
**Pattern**: User-driven agent chain with VS Code slash commands

---

## 🎯 The Pattern

VS Code Copilot's **slash command system** allows automatic prompt loading and agent mode switching:

```
/[prompt-filename-without-extension] [context and instructions]
```

When user types this, Copilot:

1. Automatically loads `.github/prompts/[prompt-filename].prompt.md`
2. Switches to the agent mode specified in the prompt's frontmatter
3. Executes with the provided context

---

## ✅ Files Updated

### Core Orchestrator

- ✅ `.github/prompts/orchestrate.prompt.md`
  - Removed "invoke agent" language
  - Added slash command format for all NEXT ACTION types
  - Provides copy-paste ready commands

### Phase Prompts (All Updated)

- ✅ `.github/prompts/phase1-project-manager.prompt.md`

  - Added HANDOFF PROTOCOL section
  - Includes user validation pause
  - Provides next slash command after approval

- ✅ `.github/prompts/phase4-software-architect.prompt.md`

  - Added HANDOFF PROTOCOL section
  - Includes user validation pause
  - Provides next slash command after approval

- ✅ `.github/prompts/phase5a-team-leader-mode1.prompt.md`

  - Added HANDOFF PROTOCOL section
  - Provides developer invocation commands
  - Includes MODE 2 invocation guidance

- ✅ `.github/prompts/phase5b-team-leader-mode2.prompt.md`

  - Added HANDOFF PROTOCOL section
  - Provides next developer or MODE 3 commands
  - Handles iterative assignment cycle

- ✅ `.github/prompts/phase5c-team-leader-mode3.prompt.md`

  - Added HANDOFF PROTOCOL section
  - Provides return to orchestrator command
  - Signals QA decision point

- ✅ `.github/prompts/phase6-qa.prompt.md`

  - Added HANDOFF PROTOCOL section
  - Provides return to orchestrator command

- ✅ `.github/prompts/phase8-modernization-detector.prompt.md`
  - Added HANDOFF PROTOCOL section
  - Provides final return to orchestrator command

---

## 📋 Slash Command Format

### Standard Format

```
/[prompt-name] Task ID: TASK_2025_XXX, [specific context]
```

### Examples

**Start orchestration:**

```
/orchestrate "Add real-time notifications feature"
```

**Switch to project manager:**

```
/phase1-project-manager Task ID: TASK_2025_015, User Request: "Add notifications"
```

**Switch to architect:**

```
/phase4-software-architect Task ID: TASK_2025_015, Requirements from task-description.md
```

**Decompose into tasks:**

```
/phase5a-team-leader-mode1 Task ID: TASK_2025_015, Decompose implementation-plan.md
```

**Verify and assign:**

```
/phase5b-team-leader-mode2 Task ID: TASK_2025_015, Verify Task 1 and assign Task 2
```

**Return to orchestrator:**

```
/orchestrate TASK_2025_015
```

---

## 🔄 Complete Workflow Example

### 1. User Starts

```
/orchestrate "Add dark mode toggle to settings"
```

### 2. Orchestrator Responds

```markdown
# 🎯 Workflow Orchestration - Initial Analysis

## Task Information

- **Task ID**: TASK_2025_020
- **Type**: FEATURE
- **Complexity**: Medium

## Phase 0 Complete ✅

- context.md created

## 📍 NEXT STEP: Switch to Project Manager

**Copy and send this command:**
```

/phase1-project-manager Task ID: TASK_2025_020, User Request: "Add dark mode toggle"

```

```

### 3. User Executes Command

User copies and pastes:

```
/phase1-project-manager Task ID: TASK_2025_020, User Request: "Add dark mode toggle"
```

### 4. Project Manager Responds

```markdown
# Project Manager - Phase Complete

## Deliverables Created

- ✅ task-description.md

## For Your Review

Please review: `task-tracking/TASK_2025_020/task-description.md`

Reply with "APPROVED ✅" or provide feedback.
```

### 5. User Validates

```
APPROVED ✅
```

### 6. Project Manager Provides Next Command

```markdown
## 📍 Next Step: Architecture Planning

**Copy and send this command:**
```

/phase4-software-architect Task ID: TASK_2025_020, Requirements from task-description.md

```

```

### 7. Pattern Continues

This pattern repeats through all phases:

- User executes slash command
- Agent completes work
- If validation needed, agent waits
- Agent provides next slash command
- User executes it
- Repeat until complete

---

## 🎯 Key Benefits

### 1. Automatic Prompt Loading

No need for `#file` references - slash command loads prompt automatically

### 2. Clean Command Syntax

```
/phase1-project-manager Task ID: TASK_2025_020, context
```

vs old verbose message with @workspace and #file references

### 3. Agent Mode Switching

Frontmatter `mode:` field automatically switches to correct agent mode

### 4. User Control

User sees and executes each transition explicitly

### 5. Context Preservation

Task-specific context passed in command parameters

### 6. Copy-Paste Ready

All commands are formatted for immediate copy/paste

---

## 📨 Handoff Protocol Pattern

### Standard Handoff (No Validation)

```markdown
## 📍 Next Step: [Phase Name]

**Copy and send this command:**
```

/[prompt-name] Task ID: {TASK_ID}, [context]

```

```

### Handoff with User Validation (PM, Architect)

```markdown
## For Your Review

Please review: `task-tracking/{TASK_ID}/[deliverable].md`

Reply with "APPROVED ✅" or provide feedback.

[After user approval]

## 📍 Next Step: [Phase Name]

**Copy and send this command:**
```

/[prompt-name] Task ID: {TASK_ID}, [context]

```

```

### Return to Orchestrator

```markdown
## 📍 Next Step: Return to Orchestrator

**Copy and send this command:**
```

/orchestrate TASK*2025*{XXX}

```

**Tell orchestrator**: "[completion message]"
```

---

## 🚀 Available Slash Commands

| Command                          | Purpose                 | When to Use                       |
| -------------------------------- | ----------------------- | --------------------------------- |
| `/orchestrate [description]`     | Start new workflow      | Initial task request              |
| `/orchestrate TASK_2025_XXX`     | Continue workflow       | Return after agent completion     |
| `/phase1-project-manager`        | Requirements analysis   | After orchestrator recommendation |
| `/phase2-researcher-expert`      | Technical research      | When unknowns exist               |
| `/phase3-ui-ux-designer`         | Visual design           | UI/UX work needed                 |
| `/phase4-software-architect`     | Architecture planning   | After requirements                |
| `/phase5a-team-leader-mode1`     | Task decomposition      | After architecture                |
| `/phase5b-team-leader-mode2`     | Verify + assign         | After each developer task         |
| `/phase5c-team-leader-mode3`     | Final verification      | All tasks complete                |
| `/backend-developer`             | Backend implementation  | Task assignment                   |
| `/frontend-developer`            | Frontend implementation | Task assignment                   |
| `/phase6-qa`                     | Quality assurance       | User QA choice                    |
| `/phase6-code-reviewer`          | Code review             | User QA choice                    |
| `/phase8-modernization-detector` | Future work             | Final phase                       |

---

## 🎓 Usage Guidelines

### For Users

1. **Copy exactly**: Copy the entire command provided
2. **Don't modify**: Commands are pre-formatted with correct context
3. **Wait for completion**: Let each agent finish before proceeding
4. **Validate when asked**: PM and Architect need your approval
5. **Follow the flow**: Each agent provides the next command

### For Agents (Prompt Authors)

1. **Always provide next command**: Never leave user hanging
2. **Use correct slash command**: Match prompt filename exactly
3. **Include task context**: Add Task ID and relevant info
4. **Format for copy-paste**: Wrap in code fence for easy copying
5. **Wait at validation points**: PM and Architect must pause for user

---

## ✅ Validation Checklist

Workflow is correctly implemented when:

- [ ] `/orchestrate` starts workflow and provides first command
- [ ] Each phase prompt provides next slash command
- [ ] PM and Architect wait for user validation
- [ ] Team-leader MODE 2 iterates correctly (one verification per task)
- [ ] All agents return to orchestrator with results
- [ ] User can complete full workflow by copy/pasting commands
- [ ] No agent tries to "invoke" another agent programmatically
- [ ] Context flows correctly through command parameters

---

## 🎉 Result

**User-driven orchestrated workflows** that:

- Work within VS Code Copilot's actual capabilities
- Provide clear, copy-paste ready commands
- Maintain full user control and visibility
- Preserve context through all phases
- Enable seamless agent-to-agent transitions

---

**This slash command pattern is now the standard for all Ptah extension orchestrated workflows.**
