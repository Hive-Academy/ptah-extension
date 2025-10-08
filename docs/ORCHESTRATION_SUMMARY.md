# ChatMode & Prompt Orchestration - Executive Summary

## 🎯 TL;DR

Your `orchestrate.prompt.md` **cannot directly call/switch** chat modes in VS Code. Instead, it must **guide the conversation** through different agent roles by loading their instructions and having the AI adopt each persona sequentially.

## ❌ What Doesn't Work

```bash
# This is pseudocode - VS Code can't execute this
Use the Task tool to invoke the project-manager agent:
```

VS Code doesn't have programmatic mode-switching APIs yet.

## ✅ What Actually Works

### Approach 1: Instruction-Based Role Adoption (Recommended)

```markdown
## Phase 1: Requirements Analysis

**Current Agent Role**: Project Manager  
**Instructions**: #file:.github/chatmodes/product-manager.chatmode.md

**Your Task**:

1. Read the project-manager instructions above
2. Create task-description.md following those guidelines
3. Signal completion by typing "READY FOR VALIDATION"

---

[AI adopts product-manager role and does the work]

---

## Phase 1.2: Validation

**Current Agent Role**: Business Analyst
**Instructions**: #file:.github/chatmodes/business-analyst.chatmode.md

**Your Task**:

1. Review task-description.md
2. Validate against criteria
3. Type "APPROVE" or "REJECT: [reason]"
```

### How It Works

1. **User runs**: `/orchestrate add login feature`
2. **Prompt loads**: Phase 1 instructions + product-manager chatmode via #file
3. **AI adopts**: Product manager persona and completes work
4. **Workflow continues**: to validation phase automatically
5. **AI adopts**: Business analyst persona and validates
6. **Repeat**: for each phase in your workflow

## 🔧 Implementation Changes Needed

### 1. Update `orchestrate.prompt.md`

Change from:

```markdown
Use the Task tool to invoke the project-manager agent:
```

To:

```markdown
**Current Role**: Project Manager  
**Instructions**: #file:.github/chatmodes/product-manager.chatmode.md  
**Task**: [specific deliverable]
```

### 2. Ensure Chat Modes Are Self-Contained

Each `.chatmode.md` should have:

- Clear role description
- Specific responsibilities
- Output format requirements
- Tool configuration

### 3. Add Phase Markers

Make transitions explicit:

```markdown
---
## Phase 2: Research Analysis
---
```

## 📊 Current Architecture vs. Proposed

| Aspect              | Current (Pseudocode)  | Proposed (Instruction-Based)      |
| ------------------- | --------------------- | --------------------------------- |
| **Mode Switching**  | Fake "invoke" calls   | #file references + role adoption  |
| **Git Commands**    | Bash pseudocode       | Use `terminal` tool in agent mode |
| **Validation**      | Conceptual            | Actual AI decision points         |
| **Workflow Flow**   | Sequential "calls"    | Guided conversation phases        |
| **User Experience** | Manual interpretation | AI follows instructions           |

## 🚀 Quick Win: Immediate Improvements

### Step 1: Test Single-Phase Orchestration

Create a simplified version first:

```markdown
---
mode: agent
tools: ['codebase', 'terminal']
---

# Simple Orchestration Test

## User Request

{captured from /orchestrate argument}

## Phase 1: Requirements

**Your Role**: Project Manager
**Instructions**: #file:.github/chatmodes/product-manager.chatmode.md

Create task-description.md with requirements.

Type "DONE" when complete.
```

### Step 2: Add One Validation Phase

Once Phase 1 works, add:

```markdown
## Phase 2: Validation

**Your Role**: Business Analyst  
**Instructions**: #file:.github/chatmodes/business-analyst.chatmode.md

Review task-description.md and type APPROVE or REJECT.
```

### Step 3: Expand to Full Workflow

Add remaining phases incrementally.

## 🎓 Key Insights from VS Code Docs

1. **Chat Modes**: Specialist AI agents with specific tools and instructions
2. **Prompt Files**: Executable workflows invoked with `/command`
3. **Agent Mode**: Can use built-in tools like `terminal`, `codebase`, `search`
4. **No Direct Mode Switching**: Must guide AI through role changes via instructions
5. **#file References**: Load content from files as context

## 🔗 Reference Documentation

- **Full Guide**: `docs/CHATMODE_ORCHESTRATION_GUIDE.md`
- **VS Code Chat Modes**: <https://code.visualstudio.com/docs/copilot/customization/custom-chat-modes>
- **Agent Mode**: <https://code.visualstudio.com/docs/copilot/chat/chat-agent-mode>
- **Prompt Files**: <https://code.visualstudio.com/docs/copilot/customization/prompt-files>

## ✨ Next Steps

1. **Read**: Full guide in `docs/CHATMODE_ORCHESTRATION_GUIDE.md`
2. **Review**: Your current chat modes in `.github/chatmodes/`
3. **Refactor**: `orchestrate.prompt.md` using instruction-based approach
4. **Test**: Start with simple 2-phase workflow
5. **Expand**: Add remaining phases incrementally
6. **Validate**: Run through complete workflow with real task

---

**Questions?** See the full guide for detailed examples, best practices, and migration strategies.
