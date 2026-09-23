# User Checkpoints Reference

This reference documents all user validation checkpoints in the orchestration workflow, including trigger conditions, templates, and error handling patterns.

> **Critical rules**:
>
> 1. All checkpoints are owned by the orchestrator (main agent). Subagents (PM, Architect, Team-Leader, Developers, Reviewers, etc.) CANNOT call `AskUserQuestion` — it is a UI-coupled tool that only works in the main orchestrator's context. If a subagent needs clarification, it MUST return a `## Clarifications Needed` section to the orchestrator, who then runs `AskUserQuestion` and re-invokes the subagent with the answers.
> 2. **Document review checkpoints (1, 1.7, 2) use plain text messages, not `AskUserQuestion`.** PM, Designer and Architect deliverables are files on disk that the user must open and read before responding — a modal choice would force a premature decision. Pre-deliverable choice checkpoints (0, 0.1, 1.5, 3) still use `AskUserQuestion` because they ARE structured option-picks.
> 3. If the `AskUserQuestion` tool is unavailable in this harness, ask the same question in plain text, listing the same options, and wait for the answer before proceeding. The checkpoint itself is never skipped — the presentation may degrade, the question may not.

---

## Checkpoint Types Overview

| Checkpoint | Name                    | When              | Purpose                         | Presentation Mode | Response Expected                            |
| ---------- | ----------------------- | ----------------- | ------------------------------- | ----------------- | -------------------------------------------- |
| **0.1**    | CLI Agent Discovery     | Before any agent  | Discover & enable CLI helpers   | `AskUserQuestion` | yes / no / auto                              |
| **0**      | Scope Clarification     | Before PM         | Clarify ambiguous requests      | `AskUserQuestion` | Answers or "use your judgment"               |
| **1**      | Requirements Validation | After PM          | Review task-description.md      | **Plain message** | "APPROVED" or feedback                       |
| **1.5**    | Technical Clarification | Before Architect  | Technical preferences           | `AskUserQuestion` | Answers or "use your judgment"               |
| **1.7**    | Design Validation       | After design + prototype, before Architect | Approve design and rendered states | **Plain message** | "APPROVED" or revisions |
| **2**      | Architecture Validation | After Architect   | Review implementation-plan.md   | **Plain message** | "APPROVED" or feedback                       |
| **3**      | QA Choice               | After Development | Select QA agents                | `AskUserQuestion` | tester/style/logic/visual/reviewers/all/skip |
| **SR**     | Subagent Return Loop    | Any subagent step | Resolve subagent clarifications | `AskUserQuestion` | Answers re-injected into subagent prompt     |

**Why 1, 1.7 and 2 are plain messages**: they ask the user to review a generated document on disk. Forcing an `AskUserQuestion` modal pre-commits the user to "APPROVED" or "revise" before they've had a chance to actually open and read the file. Plain text gives them room to validate the doc first.

---

## Checkpoint 0.1: CLI Agent Discovery

### When to Present

At the very start of orchestration, before any sub-agent is invoked.

### Trigger Conditions

Run `ptah_agent_list` at orchestration start. Present the checkpoint if at least one lane is spawnable (how to read the rows: the [agent-lanes skill](../../agent-lanes/SKILL.md)).

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

These can take focused sub-tasks from sub-agents (codebase analysis, test scaffolding,
file reviews), run parallel batches, or run whole phases you assign to them.

**Sub-agents and I retain quality ownership** — lane output is verified before it is used.

---

## Would you like to use CLI lanes for this task?

Options:

1. **yes** — Sub-agents delegate focused sub-tasks; batches and phases may run on lanes
2. **no** — Sub-agents work alone (standard mode)
3. **auto** — Lanes are used only where they clearly help

---
```

### Response Handling

| Response | Mode       |
| -------- | ---------- |
| **yes**  | `enabled`  |
| **no**   | `disabled` |
| **auto** | `auto`     |

Record the mode and the discovered rows, and brief sub-agents accordingly: [lane-assignment.md § Gate 0.1 outcome](lane-assignment.md#gate-01-outcome).

---

## Checkpoint 0: Scope Clarification

**Owner**: Orchestrator only. The project-manager subagent CANNOT ask the user — if you skip this checkpoint when ambiguity exists, PM will return a `## Clarifications Needed` section and you'll have to run it anyway.

### Trigger Conditions

**Mandatory** if ANY of these apply (do NOT delegate to PM hoping it will ask):

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

### How to Run

Use the `AskUserQuestion` tool directly. Ask 1-4 focused questions, each with 2-4 concrete options. Put recommended option first with "(Recommended)" suffix. Embed the answers in the PM invocation prompt under a `## Scope Clarification Answers` heading.

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

After project-manager completes and creates `task-description.md`.

### How to Present — PLAIN MESSAGE, NOT `AskUserQuestion`

Send the checkpoint as a regular text message in the chat. **Do NOT call `AskUserQuestion`.** The user needs to open `task-description.md` and read it before deciding — a modal choice would force a premature answer. Surface the document path prominently, give a short summary so the user can decide whether to dive in now or later, then stop and wait for a free-form reply.

### Template

```markdown
---
REQUIREMENTS READY FOR REVIEW — TASK_[ID]
---

📄 **Document**: `.ptah/specs/TASK_[ID]/task-description.md`

## Overview

[2–4 line summary extracted from task-description.md]

## Key Requirements

- [Requirement 1]
- [Requirement 2]
- [Requirement 3]

## Acceptance Criteria

- [Criterion 1]
- [Criterion 2]

## Out of Scope

- [Exclusion 1]

## Lane-introduced constraints

- [Rule not requested by the user + source; tag rules: user-requested / project-rule / lane-proposed; or none]

## Parity deltas

- [`parity-inventory.md`: kept/moved capabilities, proposed removals needing approval; or not applicable]

---

Please open the document above and review it at your own pace.

When ready, reply:

- **"APPROVED"** — proceed to design and Gate 1.7 if required, then architecture
- **Feedback / questions** — I'll revise and re-present
```

### Response Handling

| Response          | Action                                                         |
| ----------------- | -------------------------------------------------------------- |
| "APPROVED"        | Proceed to required design/Gate 1.7, Checkpoint 1.5 or Architect                         |
| Feedback provided | Re-invoke project-manager with feedback, re-present checkpoint |
| Questions asked   | Answer questions, re-present checkpoint                        |

---

## Checkpoint 1.5: Technical Clarification

**Owner**: Orchestrator only. The software-architect subagent CANNOT ask the user — if you skip this checkpoint when multiple valid approaches exist, the architect will return a `## Clarifications Needed` section and you'll have to run it anyway.

### Trigger Conditions

**Mandatory** if ANY of these apply:

- Multiple valid architectural approaches exist (e.g., REST vs GraphQL)
- Key technology choices need user preference
- Integration scope is unclear (standalone vs integrated)
- Design tradeoffs have significant impact (performance vs simplicity)
- External service dependencies need confirmation

### Skip Conditions

Proceed WITHOUT asking if ALL apply:

- Codebase investigation shows clear established patterns (architect will follow them)
- Task is a direct extension of existing architecture
- User explicitly deferred technical decisions
- Task type is BUGFIX or simple REFACTORING

### How to Run

Use the `AskUserQuestion` tool directly. Ask 1-4 focused questions covering architectural approach, integration scope, design tradeoffs. Embed the answers in the Architect invocation prompt under a `## Technical Clarification Answers` heading.

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

## Checkpoint 1.7: Design Validation

### When to Present

After `design-spec.md` and `<taskFolder>/prototype/` are ready, before the architect (or the
next creative phase). **Mandatory whenever a designer ran or any UI surface is added/redesigned.**

### How to Present — PLAIN MESSAGE, NOT `AskUserQuestion`

Show the spec, prototype and screenshots in a regular chat message. Diff the spec's rules against
the user's request and disclose additions below. Stop and wait for `APPROVED` before proceeding.

### Template

```markdown
---
DESIGN READY FOR REVIEW — TASK_[ID]
---

📄 **Document**: `<taskFolder>/design-spec.md`
**Authored by**: [lane/agent that wrote the spec]
**Prototype**: `<taskFolder>/prototype/`
**How to open**: [exact entry file/instructions from `prototype/README.md`]
**Screenshots**: [links to `prototype/screenshots/`, including dark + light themes]

## Design Summary

[2–4 line summary extracted from design-spec.md]

## Screens and States

- [Screen and its populated, empty, loading, error states; themes and widths from README.md]

## Lane-introduced constraints

- [Rule not requested by the user + source; tag rules: user-requested / project-rule / lane-proposed; or none]

## Parity deltas

- [`parity-inventory.md`: kept/moved capabilities, proposed removals needing approval; or not applicable]

---

Please open the spec and prototype above and review the screenshots at your own pace.

When ready, reply:

- **"APPROVED"** — use this prototype as the visual source of truth; proceed to architect or the next creative phase
- **Revisions / questions** — I'll revise and re-present
```

### Response Handling

| Response          | Action                                                         |
| ----------------- | -------------------------------------------------------------- |
| "APPROVED"        | Record approval and any approved parity removals; proceed       |
| Revisions provided | Re-invoke designer with feedback, re-present spec and prototype |
| Questions asked   | Answer questions, re-present checkpoint                         |

---

## Checkpoint 2: Architecture Validation

### When to Present

After software-architect completes and creates `implementation-plan.md`.

### How to Present — PLAIN MESSAGE, NOT `AskUserQuestion`

Send the checkpoint as a regular text message in the chat. **Do NOT call `AskUserQuestion`.** The implementation plan is a document the user needs to open and review carefully — locking them into a modal choice rushes that. Surface the document path prominently, give a short summary, then stop and wait for a free-form reply.

### Template

```markdown
---
ARCHITECTURE READY FOR REVIEW — TASK_[ID]
---

📄 **Document**: `.ptah/specs/TASK_[ID]/implementation-plan.md`

## Design Summary

[2–4 line summary extracted from implementation-plan.md]

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

## Lane-introduced constraints

- [Rule not requested by the user + source; tag rules: user-requested / project-rule / lane-proposed; or none]

## Parity deltas

- [`parity-inventory.md`: kept/moved capabilities, proposed removals needing approval; or not applicable]

## Estimated Complexity

[Simple | Medium | Complex] — [N] files, [B] batches expected

---

Please open the document above and review it at your own pace.

When ready, reply:

- **"APPROVED"** — proceed to development phase
- **Feedback / questions** — I'll revise and re-present
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

After team-leader MODE 3 confirms all development complete. This choice does not waive the
required UI evidence against the approved prototype or parity/write-path completion checks.

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

Parallel invocations for `reviewers` and `all`: [agent-catalog.md § Parallel QA](agent-catalog.md#parallel-qa).

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

## Checkpoint SR: Subagent Return Loop

### When to Run

When ANY subagent returns a response containing a `## Clarifications Needed` section instead of its expected deliverable, or a CLI lane writes one into its deliverable file.

### Why This Exists

Subagents run in a headless `Task` context with no UI channel back to the user — they cannot call `AskUserQuestion`. When a subagent encounters ambiguity, it returns structured questions to the orchestrator (you) for resolution.

### Protocol

1. **Detect**: Scan the subagent's response for a `## Clarifications Needed` heading
2. **Parse**: Extract the questions, options, and recommended markers
3. **Ask user via `AskUserQuestion`**: Preserve the subagent's question structure (1-4 questions, 2-4 options each, "(Recommended)" markers)
4. **Re-invoke**: call `Task` again with the same `subagent_type` (for a lane: resume or respawn it per the agent-lanes skill), with a `## User Decisions` section prepended to the prompt:

```typescript
Task({
  subagent_type: '[same-agent]',
  description: 'Continue [Agent] for TASK_[ID] with clarifications resolved',
  prompt: `You are [agent-name] for TASK_[ID]. You previously returned clarifications. Here are the user's decisions:

## User Decisions

### 1. [Question 1 topic]
**Selected**: [User's chosen option]

### 2. [Question 2 topic]
**Selected**: [User's chosen option]

Now proceed with your primary deliverable. Do not return clarifications again — these decisions are final.

[Original task prompt]`,
});
```

5. **Verify convergence**: The subagent should now produce its deliverable. If it returns clarifications a second time (rare), repeat — but examine whether the questions reveal a deeper scope problem requiring user re-engagement.

### Anti-Patterns

- **Do NOT** ignore the `## Clarifications Needed` section and re-invoke without resolution — the subagent will loop
- **Do NOT** invent answers on the user's behalf — the subagent specifically returned because it cannot proceed without user input
- **Do NOT** call `AskUserQuestion` from inside another subagent — only YOU (the orchestrator) can

### Detection Snippet

When parsing a subagent response, check for these markers:

- Heading `## Clarifications Needed` (canonical)
- Heading `## Questions for User`
- Phrase "I need clarification on" / "Please clarify"
- Numbered question list with `(Recommended)` option markers

If detected → run Checkpoint SR. Do NOT proceed to the next workflow phase.

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

### Commit Hook Failure

Present the three-option choice in [git-standards.md § Hook Failure Protocol](git-standards.md#hook-failure-protocol). Never bypass a hook on your own.

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
  Designer → design-spec.md + prototype/ (when required)
     │
     v
[Checkpoint 1.7: Design Validation]  ←─ Required if designer ran or UI added/redesigned
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
