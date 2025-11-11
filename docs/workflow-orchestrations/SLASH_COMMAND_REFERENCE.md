# Slash Command Quick Reference

> **Pattern**: `/[prompt-name] Task ID: TASK_2025_XXX, [context]`

---

## 🚀 Core Commands

### Start Workflow

```
/orchestrate "task description here"
```

### Continue Workflow (after any agent)

```
/orchestrate TASK_2025_XXX
```

---

## 📋 Phase Commands

### Phase 1: Requirements

```
/phase1-project-manager Task ID: TASK_2025_XXX, User Request: "[request]"
```

**Requires**: User validation ✋

---

### Phase 2: Research (Conditional)

```
/phase2-researcher-expert Task ID: TASK_2025_XXX, Research questions from task-description.md
```

---

### Phase 3: UI/UX Design (Conditional)

```
/phase3-ui-ux-designer Task ID: TASK_2025_XXX, Design specifications from task-description.md
```

---

### Phase 4: Architecture

```
/phase4-software-architect Task ID: TASK_2025_XXX, Requirements from task-description.md
```

**Requires**: User validation ✋

---

### Phase 5a: Task Decomposition

```
/phase5a-team-leader-mode1 Task ID: TASK_2025_XXX, Decompose implementation-plan.md
```

---

### Phase 5b: Verify + Assign (Iterative)

```
/phase5b-team-leader-mode2 Task ID: TASK_2025_XXX, Verify Task N and assign next
```

**Called**: Once per task

---

### Phase 5c: Final Verification

```
/phase5c-team-leader-mode3 Task ID: TASK_2025_XXX, Final comprehensive verification
```

---

## 👨‍💻 Developer Commands

### Backend Developer

```
/backend-developer Task ID: TASK_2025_XXX, Execute Task N: [task title]
```

### Frontend Developer

```
/frontend-developer Task ID: TASK_2025_XXX, Execute Task N: [task title]
```

---

## 🧪 QA Commands (User Choice)

### Testing

```
/phase6-qa Task ID: TASK_2025_XXX, Run senior-tester for acceptance testing
```

### Code Review

```
/phase6-code-reviewer Task ID: TASK_2025_XXX, Review code quality and security
```

---

## 🔮 Phase 8: Future Work

```
/phase8-modernization-detector Task ID: TASK_2025_XXX, Consolidate future work
```

---

## 💡 Usage Tips

1. **Copy exactly** - Commands are pre-formatted
2. **Don't modify** - Context is already included
3. **Wait for agent** - Let each phase complete
4. **Validate when asked** - PM & Architect need approval
5. **Follow provided commands** - Each agent gives you the next one

---

## 🔄 Typical Flow

```
User: /orchestrate "Add feature X"
  ↓
Orchestrator: [provides /phase1-project-manager command]
  ↓
User: [executes command]
  ↓
PM: [creates task-description.md, waits for validation]
  ↓
User: "APPROVED ✅"
  ↓
PM: [provides /phase4-software-architect command]
  ↓
User: [executes command]
  ↓
[Pattern continues through all phases]
```

---

## ⚡ Quick Start

1. Type: `/orchestrate "your task description"`
2. Copy and execute each command provided
3. Validate when asked (PM, Architect)
4. Repeat until workflow complete

---

**All commands automatically load the correct prompt and switch to the appropriate agent mode.**
