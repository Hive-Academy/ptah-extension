# User Checkpoints Reference

This reference documents all user validation checkpoints in the orchestration workflow, including trigger conditions, templates, and error handling patterns.

---

## Checkpoint Types Overview

| Checkpoint | Name                    | When              | Purpose                        | Response Expected                            |
| ---------- | ----------------------- | ----------------- | ------------------------------ | -------------------------------------------- |
| **0.1**    | CLI Agent Discovery     | Before any agent  | Discover & enable CLI helpers  | yes / no / auto                              |
| **0**      | Scope Clarification     | Before PM         | Clarify ambiguous requests     | Answers or "use your judgment"               |
| **1**      | Requirements Validation | After PM          | Approve task-description.md    | "APPROVED" or feedback                       |
| **1.5**    | Technical Clarification | Before Architect  | Technical preferences          | Answers or "use your judgment"               |
| **2**      | Architecture Validation | After Architect   | Approve implementation-plan.md | "APPROVED" or feedback                       |
| **3**      | QA Choice               | After Development | Select QA agents               | tester/style/logic/visual/reviewers/all/skip |

---

## Checkpoint 0.1: CLI Agent Discovery

### When to Present

At the very start of orchestration, before any sub-agent is invoked.

### Trigger Conditions

Always run `ptah_agent_list` at orchestration start. Present the checkpoint if at least one CLI agent is available.

### Skip Conditions

Skip this checkpoint if:

- `ptah_agent_list` returns no available CLI agents
- User previously set CLI agent preference in project-level settings
- Task is Minimal pattern (single developer or reviewer)

### Template

```markdown
---
CLI AGENT DISCOVERY - TASK_[ID]
---

I discovered the following CLI agents available on your system:

| CLI Agent | Status    |
| --------- | --------- |
| [agent]   | Available |
| [agent]   | Available |

These can be used as **junior helpers** by sub-agents (PM, Architect, Developers, etc.)
to speed up focused sub-tasks like codebase analysis, test scaffolding, and file reviews.

**Sub-agents retain full quality ownership** — CLI agents handle grunt work only.

---

## Would you like sub-agents to utilize CLI agents as junior helpers?

Options:

1. **yes** — Enable CLI delegation for all sub-agents
2. **no** — Sub-agents work alone (standard mode)
3. **auto** — Sub-agents decide on their own when to delegate

---
```

### Response Handling

| Response | Action                                                                                      |
| -------- | ------------------------------------------------------------------------------------------- |
| **yes**  | Store `cli_delegation: enabled` in context.md. Inject CLI block into all sub-agent prompts. |
| **no**   | Store `cli_delegation: disabled` in context.md. No CLI injection.                           |
| **auto** | Store `cli_delegation: auto` in context.md. Inject CLI block with "use your judgment" note. |

### Context.md Entry

When CLI delegation is enabled or auto, add to context.md:

```markdown
## CLI Agent Delegation

**Mode**: [enabled|disabled|auto]
**Available Agents**: [list from ptah_agent_list]
**Selection Priority**: ptah-cli > gemini > codex > copilot
```

---

## Checkpoint 0: Scope Clarification

### Trigger Conditions

Ask if ANY of these apply:

- User request is vague or ambiguous
- Scope could reasonably be interpreted as small OR large
- Multiple valid interpretations exist
- Business context or priority is unclear
- Success criteria are not obvious

### Skip Conditions

Proceed WITHOUT asking if ALL apply:

- User request is extremely specific and unambiguous
- Task is a continuation of previous work with clear context
- User explicitly said "use your judgment" or "just do it"
- Task type is BUGFIX with clear error description

### Template

```markdown
---
SCOPE CLARIFICATION - TASK_[ID]
---

Before I create the requirements, I have a few clarifying questions:

1. **Scope**: [What should be included vs excluded?]
2. **Priority**: [What's the most critical outcome?]
3. **Constraints**: [Any deadlines, technical limits, or dependencies?]
4. **Success**: [How will you know this task is successful?]

---

## Please answer briefly, or say "use your judgment" to skip.
```

### Response Handling

| Response                    | Action                                                |
| --------------------------- | ----------------------------------------------------- |
| User provides answers       | Incorporate into context.md, proceed to PM            |
| "use your judgment"         | Proceed to PM with orchestrator's best interpretation |
| User asks counter-questions | Answer and re-present checkpoint if needed            |

---

## Checkpoint 1: Requirements Validation

### When to Present

After project-manager completes and creates `task-description.md`

### Template

```markdown
---
REQUIREMENTS READY FOR REVIEW - TASK_[ID]
---

## Overview

[Summary extracted from task-description.md]

## Key Requirements

- [Requirement 1]
- [Requirement 2]
- [Requirement 3]

## Acceptance Criteria

- [Criterion 1]
- [Criterion 2]
- [Criterion 3]

## Out of Scope

- [Exclusion 1]
- [Exclusion 2]

---

USER VALIDATION CHECKPOINT
Reply "APPROVED" to proceed to architecture phase
OR provide feedback for revision

---
```

### Response Handling

| Response          | Action                                                         |
| ----------------- | -------------------------------------------------------------- |
| "APPROVED"        | Proceed to Checkpoint 1.5 or Architect                         |
| Feedback provided | Re-invoke project-manager with feedback, re-present checkpoint |
| Questions asked   | Answer questions, re-present checkpoint                        |

---

## Checkpoint 1.5: Technical Clarification

### Trigger Conditions

Ask if ANY of these apply:

- Multiple valid architectural approaches exist (e.g., REST vs GraphQL)
- Key technology choices need user preference
- Integration scope is unclear (standalone vs integrated)
- Design tradeoffs have significant impact (performance vs simplicity)
- External service dependencies need confirmation

### Skip Conditions

Proceed WITHOUT asking if ALL apply:

- Codebase investigation shows clear established patterns
- Task is a direct extension of existing architecture
- User explicitly deferred technical decisions
- Task type is BUGFIX or simple REFACTORING

### Template

```markdown
---
TECHNICAL CLARIFICATION - TASK_[ID]
---

Before I create the architecture, I have a few technical questions:

1. **Approach**: [Pattern A vs Pattern B - which do you prefer?]
2. **Integration**: [Should this integrate with X or be standalone?]
3. **Tradeoff**: [Prioritize performance or simplicity?]
4. **Dependencies**: [Use existing library X or implement custom?]

---

## Please answer briefly, or say "use your judgment" to skip.
```

### Response Handling

| Response              | Action                                           |
| --------------------- | ------------------------------------------------ |
| User provides answers | Incorporate into architect prompt, proceed       |
| "use your judgment"   | Proceed with orchestrator's recommended approach |
| User needs more info  | Provide technical context, re-present checkpoint |

---

## Checkpoint 2: Architecture Validation

### When to Present

After software-architect completes and creates `implementation-plan.md`

### Template

```markdown
---
ARCHITECTURE READY FOR REVIEW - TASK_[ID]
---

## Design Summary

[Summary extracted from implementation-plan.md]

## Components

- **[Component 1]**: [purpose and responsibility]
- **[Component 2]**: [purpose and responsibility]

## Key Design Decisions

1. [Decision 1]: [rationale]
2. [Decision 2]: [rationale]

## Files to Create/Modify

| File             | Action | Purpose   |
| ---------------- | ------ | --------- |
| path/to/file1.ts | CREATE | [purpose] |
| path/to/file2.ts | MODIFY | [purpose] |

## Estimated Complexity

[Simple | Medium | Complex] - [N] files, [B] batches expected

---

USER VALIDATION CHECKPOINT
Reply "APPROVED" to proceed to development phase
OR provide feedback for revision

---
```

### Response Handling

| Response          | Action                                                   |
| ----------------- | -------------------------------------------------------- |
| "APPROVED"        | Invoke team-leader MODE 1                                |
| Feedback provided | Re-invoke architect with feedback, re-present checkpoint |
| Questions asked   | Answer questions, re-present checkpoint                  |
| Request changes   | Update requirements if needed, re-invoke architect       |

---

## Checkpoint 3: QA Choice

### When to Present

After team-leader MODE 3 confirms all development complete

### Template

```markdown
---
DEVELOPMENT COMPLETE - TASK_[ID]
---

**Tasks Completed**: [N] tasks in [B] batches
**Git Commits**: [B] commits verified
**Files Implemented**: [N] files

---

QA CHOICE CHECKPOINT

Options:

1. "tester" - senior-tester only (functionality testing)
2. "style" - code-style-reviewer only (coding standards)
3. "logic" - code-logic-reviewer only (business logic)
4. "visual" - visual-reviewer only (UI/UX visual testing, responsive design)
5. "reviewers" - ALL THREE reviewers in parallel (style + logic + visual)
6. "all" - tester + ALL THREE reviewers in parallel
7. "skip" - proceed to completion

## Reply with your choice: tester, style, logic, visual, reviewers, all, or skip
```

### QA Invocation Patterns

```typescript
// Option: "tester" - single agent
Task({ subagent_type: 'senior-tester', prompt: `Test TASK_[ID]...` });

// Option: "style" - single agent
Task({ subagent_type: 'code-style-reviewer', prompt: `Review TASK_[ID] for patterns...` });

// Option: "logic" - single agent
Task({ subagent_type: 'code-logic-reviewer', prompt: `Review TASK_[ID] for completeness...` });

// Option: "visual" - single agent
Task({ subagent_type: 'visual-reviewer', prompt: `Visual review TASK_[ID]...` });

// Option: "reviewers" - parallel (ALL THREE in single message)
Task({ subagent_type: 'code-style-reviewer', prompt: `...` });
Task({ subagent_type: 'code-logic-reviewer', prompt: `...` });
Task({ subagent_type: 'visual-reviewer', prompt: `...` });

// Option: "all" - parallel (FOUR in single message)
Task({ subagent_type: 'senior-tester', prompt: `...` });
Task({ subagent_type: 'code-style-reviewer', prompt: `...` });
Task({ subagent_type: 'code-logic-reviewer', prompt: `...` });
Task({ subagent_type: 'visual-reviewer', prompt: `...` });

// Option: "skip" - no QA agents invoked
// Proceed directly to workflow completion
```

### Response Handling

| Response    | Action                                      |
| ----------- | ------------------------------------------- |
| "tester"    | Invoke senior-tester only                   |
| "style"     | Invoke code-style-reviewer only             |
| "logic"     | Invoke code-logic-reviewer only             |
| "visual"    | Invoke visual-reviewer only                 |
| "reviewers" | Invoke ALL THREE reviewers in parallel      |
| "all"       | Invoke ALL FOUR QA agents in parallel       |
| "skip"      | Skip QA, proceed to git operations guidance |

---

## Error Handling

### Validation Rejection Handling

When user provides feedback instead of "APPROVED":

```
1. Extract specific feedback points from user response
2. Re-invoke the original agent with:
   - Original context
   - Previous output reference
   - User feedback as revision instructions
3. Agent produces revised output
4. Re-present validation checkpoint with new output
5. Repeat until "APPROVED" or user requests different approach
```

### Verification Failure Handling

When team-leader MODE 2 rejects a batch:

```
1. Extract rejection reasons from team-leader response
2. Re-invoke developer with:
   - Original task assignment
   - List of issues found
   - Clear fix instructions
3. Developer produces fixes
4. Re-invoke team-leader MODE 2 for re-verification
5. Repeat until batch passes verification
```

### Commit Hook Failure Handling

When git commit fails due to pre-commit hooks:

```markdown
---
Pre-commit hook failed: [specific error message]
---

Please choose how to proceed:

1. **Fix Issue** - I'll fix the issue if it's related to current work
   (Use for: lint errors, type errors, commit message format issues)

2. **Bypass Hook** - Commit with --no-verify flag
   (Use for: Unrelated errors in other files, blocking issues outside scope)

3. **Stop & Report** - Mark as blocker and escalate
   (Use for: Critical infrastructure issues, complex errors)

## Which option would you like? (1/2/3)
```

**Option Handling**:

| Choice            | Action                                                              |
| ----------------- | ------------------------------------------------------------------- |
| 1 (Fix Issue)     | Identify and fix the specific issue, retry commit                   |
| 2 (Bypass Hook)   | Execute `git commit --no-verify -m "message"`, document in tasks.md |
| 3 (Stop & Report) | Mark task as BLOCKED, create detailed error report                  |

**Critical Rules**:

- NEVER automatically bypass hooks with --no-verify
- NEVER automatically fix issues without user consent
- NEVER proceed with alternative approaches without user decision
- ALWAYS present the 3 options and wait for user choice
- Document chosen option in task tracking if option 2 or 3 selected

---

## Checkpoint Flow Summary

```
New Task Start
     │
     v
[Checkpoint 0.1: CLI Agent Discovery]  ←─ Auto (if agents available)
     │
     v
[Checkpoint 0: Scope Clarification]  ←─ Optional
     │
     v
  Project Manager
     │
     v
[Checkpoint 1: Requirements Validation]  ←─ Required
     │
     v
[Checkpoint 1.5: Technical Clarification]  ←─ Optional
     │
     v
  Software Architect
     │
     v
[Checkpoint 2: Architecture Validation]  ←─ Required
     │
     v
  Team-Leader MODE 1 → Development Loop
     │
     v
  Team-Leader MODE 3
     │
     v
[Checkpoint 3: QA Choice]  ←─ Required
     │
     v
  QA Agents (if selected)
     │
     v
  Workflow Complete
```

---

## Integration with Other References

- **SKILL.md**: Checkpoint logic embedded in core orchestration loop
- **strategies.md**: Different strategies may skip certain checkpoints
- **agent-catalog.md**: QA agents invoked from Checkpoint 3
- **team-leader-modes.md**: MODE transitions trigger checkpoints
- **git-standards.md**: Hook failure protocol at commit time
- **cli-agent-delegation.md**: CLI agent discovery, delegation patterns, prompt injection
