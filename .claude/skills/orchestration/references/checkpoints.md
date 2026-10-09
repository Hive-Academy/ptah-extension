# User Checkpoints Reference

This reference documents all user validation checkpoints in the orchestration workflow, including trigger conditions, templates, and error handling patterns.

> **Critical rules**:
>
> 1. **Agents decide; the user gets only what is theirs.** Every open decision — yours, a subagent's or a lane's — runs the [decision ladder](#decision-ladder): evidence first, then a cross-side peer, then the user only for a [user-reserved decision](#user-reserved-decisions) or a split the first two steps cannot settle. Every decision the agents take goes in the [decision log](#decision-log) so the user can audit it.
> 2. Only the orchestrator (main agent) talks to the user. `AskUserQuestion` is a UI-coupled tool that works only in your context. Subagents and lanes send open questions to you through messaging, or return `## Clarifications Needed` when no channel exists ([§ Agent questions](#agent-questions)).
> 3. **Document review checkpoints (1, 1.7, 2) use plain text messages, not `AskUserQuestion`.** PM, Designer and Architect deliverables are files on disk that the user must open and read before responding — a modal choice would force a premature decision.
> 4. When you do ask, use one `AskUserQuestion` call with every open user-reserved question bundled, the recommendation first. If the tool is unavailable in this harness, ask the same question in plain text, listing the same options, and wait for the answer.
> 5. **Who approves Gates 1, 1.7 and 2 depends on the approval mode** ([§ Approval mode](#approval-mode)). With CLI lanes installed and enabled, the cross-side reviewer approves and you post a notice; the user is asked only when no lane is available, lanes are disabled, or an escalation applies.

---

## Checkpoint Types Overview

| Checkpoint | Name                    | When              | Purpose                         | Presentation Mode | Response Expected                            |
| ---------- | ----------------------- | ----------------- | ------------------------------- | ----------------- | -------------------------------------------- |
| **0.1**    | CLI Lane Mode           | Before any agent  | Discover & enable CLI lanes     | **Notice**, no wait | User may reply "no lanes" or "gate me"     |
| **0**      | Scope Clarification     | Before PM         | Settle ambiguous requests       | Decision ladder; `AskUserQuestion` only for user-reserved scope | Answers or "use your judgment" |
| **1**      | Requirements Validation | After PM          | Review task-description.md      | **Plain message** | `lane-review`: notice, no wait · `user`: "APPROVED" or feedback |
| **1.5**    | Technical Clarification | Before Architect  | Settle technical choices        | Decision ladder; `AskUserQuestion` only for user-reserved choices | Answers or "use your judgment" |
| **1.7**    | Design Validation       | After design + prototype, before Architect | Approve design and rendered states | **Plain message** | `lane-review`: notice, no wait · `user`: "APPROVED" or revisions |
| **2**      | Architecture Validation | After Architect   | Review implementation-plan.md   | **Plain message** | `lane-review`: notice, no wait · `user`: "APPROVED" or feedback |
| **3**      | QA Selection            | After Development | Select QA agents                | **Notice** (rule-based), no wait | User may add agents                |
| **SR**     | Agent Questions         | Any agent step    | Resolve agent questions         | Decision ladder; `AskUserQuestion` only for user-reserved | Answers sent back to the agent |

**Why 1, 1.7 and 2 are plain messages**: they ask the user to review a generated document on disk. Forcing an `AskUserQuestion` modal pre-commits the user to "APPROVED" or "revise" before they've had a chance to actually open and read the file. Plain text gives them room to validate the doc first.

---

## Decision ladder

Run it for every open decision before anyone asks the user. Stop at the first step that settles it.

1. **Evidence.** Resolve the decision from what exists: the request, `context.md` and the task
   folder, the code and its conventions, project docs (`CLAUDE.md`, `AGENTS.md`),
   `ptah_memory_search` for earlier decisions, and `ptah_web_search` for external facts (library
   versions, API behavior, standards). One defensible answer → decide.
2. **Peer validation.** Two or more defensible options remain, or the choice is costly to undo →
   write the proposed decision with its options and evidence, and send it to an independent reviewer
   on the other execution side (routing per agent-lanes §6; lanes disabled → a fresh subagent).
   Reviewer agrees → decide. Reviewer disagrees → one evidence exchange; still split → step 3.
3. **User.** Ask only for a [user-reserved decision](#user-reserved-decisions), or a split that
   steps 1 and 2 could not settle. Bundle every open question into one `AskUserQuestion` call.

A decision that is settled and not user-reserved is never put to the user. State it and continue.

### User-reserved decisions

These go to the user in every approval mode, even when the evidence and the peer agree:

- Product intent the request leaves open and that changes what is delivered: who it is for, what
  "done" means, what is in or out of scope.
- Removal of an existing capability, or a ban on an existing project component.
- Irreversible or outward-facing actions: commit or merge to `main`, push, publish, release, deploy,
  delete user data, run a migration on shared data, send a message outside the workspace.
- Security, privacy, licensing or legal exposure; credentials and secrets.
- Money: a paid service, a paid plan or a cost increase.
- A breaking change to a public API, a stored-data format or user-visible behavior that the request
  did not ask for.
- An action that contradicts an explicit user instruction.
- Bypass of a commit hook ([git-standards.md](git-standards.md#hook-failure-protocol)).

### Decision log

Record every decision taken at step 1 or 2 in `<taskFolder>/decisions.md`:

```markdown
| # | Decision | Options considered | Evidence (file:line, doc, URL) | Decided by | Validated by | Reversible |
| - | -------- | ------------------ | ------------------------------ | ---------- | ------------ | ---------- |
```

Agents and lanes list their decisions under `## Decisions` in their deliverable; you copy them into
the log. Each gate notice and the completion summary link the log and list the decisions taken since
the last one, so the user can audit them. A user who overturns a decision makes a user-requested
revision: revise, review again, and record the new row.

### Agent questions

Subagents and lanes never contact the user. At a decision point they run ladder step 1 themselves and
record what they decide. A question that stays open, or a user-reserved one, goes to you:

1. The agent sends it with options, evidence and a recommendation — `ptah_agent_report` from a CLI
   lane, `SendMessage` from a Ptah session — and continues with the work that does not depend on it.
2. You run ladder steps 2 and 3, then send the answer back — `ptah_agent_message` to a lane
   (branch on its `mode`, agent-lanes §7), `SendMessage` to a session.
3. No channel (`delivered: false`, `unsupported`, or a subagent without messaging), or nothing is
   left to do without the answer → the agent stops before its artifact and returns
   `## Clarifications Needed`. You run [Checkpoint SR](#checkpoint-sr-agent-questions).

---

## Approval mode

Decide it once at Gate 0.1 and record it in `context.md` under `## CLI Lanes` as `Approval: lane-review` or `Approval: user`.

| Mode          | When                                                                                                      | Gates 1, 1.7 and 2                                                                                     |
| ------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `lane-review` | `ptah_agent_list` shows a spawnable lane **and** Gate 0.1 left lanes `enabled` or `auto`                 | The cross-side reviewer's APPROVED is the gate decision. Post the [lane-review notice](#lane-review-notice) and continue — do not wait |
| `user`        | No spawnable lane, Gate 0.1 `disabled`, or the user asked to approve gates themselves (now or in settings) | Present the gate template and wait for the user's `APPROVED`                                          |

**Escalate to the user** — present the full gate template and wait for `APPROVED`, even in `lane-review` mode — when any of these is true for the reviewed revision:

1. The reviewer still returns REVISE when the revise cap is exhausted.
2. The review was not cross-side (same-side fallback, for any reason) or no independent reviewer could run.
3. The artifact proposes a removal (`remove-proposed` in `parity-inventory.md`, `## Proposed Removals`) or bans an existing project component. Removals always need the user.
4. The reviewer or author returned `## Clarifications Needed` — run Gate SR first, then continue in the current mode.
5. The user asked to see this gate, or sent feedback on this artifact.

Record each gate decision against the reviewed revision in `context.md`: who approved it (`user`, or `lane-review: <reviewer side + lane/agent>`), and any escalation reason.

User feedback that arrives after a lane-review approval is a user-requested revision: pause work that builds on the artifact, revise, run a fresh review, and present the gate to the user (escalation 5).

### Lane-review notice

```markdown
**Gate [1 | 1.7 | 2] approved by cross-side review — TASK_[ID]**
📄 `<taskFolder>/<artifact>` · Written by [side + lane/agent] · Reviewed by [other side + lane/agent]
Verdict: APPROVED after [0–2] revise rounds — 📄 `<taskFolder>/<artifact-stem>-review.md`
Lane-introduced constraints the reviewer accepted: [list, or none]
Agent decisions since the last gate: [count, one line each, or none] — 📄 `<taskFolder>/decisions.md`
Continuing to [next phase]. Reply with feedback or "stop" at any time to revise.
```

---

## Cross-side review protocol

Runs before Gates 1, 1.7 and 2, for initial artifacts and for every revision of them.

1. When the author returns, invoke an independent reviewer on the other execution side
   (routing and fallback: agent-lanes §6; invocation: [agent-catalog.md § Document review](agent-catalog.md#document-review)).
   The initial review is round 0.
2. REVISE → send the numbered findings to the original author, then return the changed artifact to
   the same reviewer. One revise round = one author revision + one reviewer recheck, within the
   agent-lanes §6 revise cap.
3. The review file records author, reviewer, both execution sides, the reviewed revision, the
   completed round count, the verdict and unresolved items. Resume these records; continuation alone
   never resets the count. Record the user's gate decision against that revision in `context.md`.
4. Reviewer APPROVED → in `lane-review` mode with no escalation, post the lane-review notice and
   continue; otherwise present the gate to the user. Still REVISE when the cap is exhausted → stop
   revising and present the gate to the user with the verdict and every open item. In `user` mode the
   reviewer's verdict never counts as user approval. Nothing is implemented while approval is pending.
5. The reviewer checks every `lane-proposed` constraint and states in the review file whether it
   accepts it. A constraint it does not accept is a REVISE item, not a silent pass.
6. A user-requested revision gets a fresh review before the gate is shown again; that review alone
   does not reset the round count. A new automatic budget needs the user's explicit go-ahead or a
   user-requested scope change: keep the prior round history, record the reason, start again at
   round 0. Questions that change nothing need no review.

---

## Checkpoint 0.1: CLI Lane Mode

### When to Present

At the very start of orchestration, before any sub-agent is invoked. This is a notice, not a
question: announce the mode and continue without waiting.

### Trigger Conditions

Run `ptah_agent_list` at orchestration start (how to read the rows: the [agent-lanes skill](../../agent-lanes/SKILL.md)).

| Situation                                               | Lane mode  | Approval      |
| ------------------------------------------------------- | ---------- | ------------- |
| At least one spawnable lane, no recorded preference     | `auto`     | `lane-review` |
| A preference in project settings or `context.md`        | as recorded | as recorded  |
| The request pins lanes ("use codex for …")              | `enabled`  | `lane-review` |
| No spawnable lane                                       | `disabled` | `user`        |

Skip the notice for a Minimal task (single developer or reviewer) — record the mode silently.

### Template

```markdown
**CLI lanes — TASK_[ID]**: [N] available ([lane names]). Mode `auto`: lanes take work where they
clearly help and review across sides. Cross-side reviews approve requirements, design and
architecture, and agents settle technical choices from evidence and peer review — every decision
is logged in `decisions.md`. I stop for you only on decisions that are yours (scope intent,
removals, irreversible or outward actions, security, cost) or open review items.
Reply "no lanes" to work without lanes, or "gate me" to approve each document yourself.
```

### Response Handling

| Later reply      | Lane mode  | Approval |
| ---------------- | ---------- | -------- |
| "no lanes"       | `disabled` | `user`   |
| "gate me"        | unchanged  | `user`   |
| "use lanes more" | `enabled`  | unchanged |

A change applies from the next phase on; work already approved stays approved.

Record the mode, the approval mode and the discovered rows, and brief sub-agents accordingly: [lane-assignment.md § Gate 0.1 outcome](lane-assignment.md#gate-01-outcome).

---

## Checkpoint 0: Scope Clarification

**Owner**: Orchestrator only. The project-manager subagent CANNOT ask the user.

### Trigger Conditions

Run the [decision ladder](#decision-ladder) on the request when ANY of these apply:

- User request is vague or ambiguous
- Scope could reasonably be interpreted as small OR large
- Multiple valid interpretations exist
- Business context or priority is unclear
- Success criteria are not obvious

### How to Run

1. Settle what evidence settles: the code, earlier tasks, project docs and memory often show the
   intended scope. Record each settled point in `decisions.md` and pass it to PM under
   `## Scope Decisions`.
2. Ask the user only about what is still open **and** is product intent (who it is for, what "done"
   means, what is in or out). One `AskUserQuestion` call, 1-4 questions, 2-4 options each, the
   recommended option first with "(Recommended)". Embed the answers in the PM prompt under
   `## Scope Clarification Answers`.
3. The user said "use your judgment" or "just do it" → no question; decide, log, continue.

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

In `lane-review` mode with no [escalation](#approval-mode), post the lane-review notice and continue. Otherwise present as below.

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

- [lane-proposed] [Rule introduced by the lane + source; or none]

## Parity deltas

- [`parity-inventory.md`: kept/moved capabilities, proposed removals needing approval; or not applicable]

## Cross-side review

**Written by**: [side + lane/agent] · **Reviewed by**: [other side + lane/agent, or "same-side — <recorded reason: user pin, lanes disabled at Gate 0.1, or opposite side unavailable>"]
**Reviewer verdict**: [APPROVED | REVISE — automatic revision cap reached] · **Completed revise rounds**: [0–2] · **Reviewed revision**: [revision] — 📄 `<taskFolder>/<artifact-stem>-review.md`

- [Open item the reviewer raised and the author did not resolve, with location; or none]

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

**Owner**: Orchestrator only. The software-architect subagent CANNOT ask the user.

Technical choices are agent decisions by default. The architect settles them from evidence, and a
cross-side peer validates the ones that stay open.

### Trigger Conditions

Run the [decision ladder](#decision-ladder) when ANY of these apply:

- Multiple valid architectural approaches exist (e.g., REST vs GraphQL)
- Integration scope is unclear (standalone vs integrated)
- Design tradeoffs have significant impact (performance vs simplicity)
- External service dependencies need confirmation

No run is needed when the codebase shows a clear established pattern, the task directly extends
existing architecture, or the task is a BUGFIX or simple REFACTORING.

### How to Run

1. Evidence: the codebase patterns, project docs, memory, and `ptah_web_search` for library and
   API facts. Settled → log it and pass it to the architect under `## Technical Decisions`.
2. Peer: still open → send the options and evidence to a cross-side reviewer; agreement settles it.
3. User: only a user-reserved choice (a paid service, a new external vendor with legal or cost
   exposure, a breaking public change, a security trade-off), or a split the peer could not settle.
   One `AskUserQuestion` call, 1-4 questions; embed the answers in the architect prompt under
   `## Technical Clarification Answers`.

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

After `design-spec.md` and `<taskFolder>/prototype/` are ready, before the next phase of the flow
(architect, team-leader, or content writer). **Mandatory whenever a designer ran or any UI surface is added/redesigned.**

In `lane-review` mode with no [escalation](#approval-mode), post the lane-review notice with the
prototype path and screenshot links, and continue. Otherwise present as below.

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

## Project rules applied

- [project-rule] [Applied rule + its source file or doc, from prototype/README.md; or none]

## Lane-introduced constraints

- [lane-proposed] [Rule introduced by the lane + source; or none]

## Parity deltas

- [`parity-inventory.md`: kept/moved capabilities, proposed removals needing approval; or not applicable]

## Cross-side review

**Written by**: [side + lane/agent] · **Reviewed by**: [other side + lane/agent, or "same-side — <recorded reason: user pin, lanes disabled at Gate 0.1, or opposite side unavailable>"]
**Reviewer verdict**: [APPROVED | REVISE — automatic revision cap reached] · **Completed revise rounds**: [0–2] · **Reviewed revision**: [revision] — 📄 `<taskFolder>/<artifact-stem>-review.md`

- [Open item the reviewer raised and the author did not resolve, with location; or none]

---

Please open the spec and prototype above and review the screenshots at your own pace.

When ready, reply:

- **"APPROVED"** — use this prototype as the visual source of truth; proceed to the next phase of the recorded flow (architect, team-leader, or content writer)
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

In `lane-review` mode with no [escalation](#approval-mode), post the lane-review notice and invoke
team-leader MODE 1. Otherwise present as below.

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

- [lane-proposed] [Rule introduced by the lane + source; or none]

## Parity deltas

- [`parity-inventory.md`: kept/moved capabilities, proposed removals needing approval; or not applicable]

## Cross-side review

**Written by**: [side + lane/agent] · **Reviewed by**: [other side + lane/agent, or "same-side — <recorded reason: user pin, lanes disabled at Gate 0.1, or opposite side unavailable>"]
**Reviewer verdict**: [APPROVED | REVISE — automatic revision cap reached] · **Completed revise rounds**: [0–2] · **Reviewed revision**: [revision] — 📄 `<taskFolder>/<artifact-stem>-review.md`

- [Open item the reviewer raised and the author did not resolve, with location; or none]

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

## Checkpoint 3: QA Selection

### When to Present

After team-leader MODE 3 confirms all development complete. This is a notice, not a question: you
select the QA agents by the rule below, announce them and start them. This selection does not waive the
required UI evidence against the approved prototype (or — for a UI change with no added/redesigned
surface and so no prototype — before/after screenshots [dark + light] of the affected screen, the
"before" taken from the base commit before the fix lands) or parity/write-path completion checks.

### Selection rule

| The change …                                                | Add             |
| ----------------------------------------------------------- | --------------- |
| changes rendered UI                                         | visual-reviewer |
| adds a public API, a new library or a new cross-lib contract | code-style-reviewer |
| has acceptance criteria that no test proves yet             | senior-tester   |
| has logic not covered by the required shipping-code review  | code-logic-reviewer |
| none of the above (types, docs, tests only)                 | nothing extra   |

### Template

```markdown
**Development complete — TASK_[ID]**: [N] tasks in [B] batches, [B] commits verified.
QA by rule: [agents and the row that selected each, or "none extra"]. Decisions since the last
gate: [count] — 📄 `<taskFolder>/decisions.md`.
Reply with "tester", "style", "logic", "visual", "reviewers" or "all" to add agents.
```

Parallel invocations: [agent-catalog.md § Parallel QA](agent-catalog.md#parallel-qa).

Gate 3 selects ADDITIONAL QA. It never waives the required shipping-code review (agent-lanes §6),
which runs before batch acceptance, or before completion and git in flows without team-leader.

### Response Handling (user additions)

| Response    | Action                                      |
| ----------- | ------------------------------------------- |
| "tester"    | Invoke senior-tester only                   |
| "style"     | Invoke code-style-reviewer only             |
| "logic"     | Invoke code-logic-reviewer only             |
| "visual"    | Invoke visual-reviewer only                 |
| "reviewers" | Invoke ALL THREE reviewers in parallel      |
| "all"       | Invoke ALL FOUR QA agents in parallel       |
---

## Checkpoint SR: Agent Questions

### When to Run

When an agent sends you a question through messaging ([§ Agent questions](#agent-questions)), when
ANY subagent returns a `## Clarifications Needed` section instead of its expected deliverable, or when
a CLI lane writes one into its deliverable file.

### Why This Exists

Subagents and lanes have no UI channel to the user. Their questions come to you, and you decide who
answers them: the evidence, a peer, or — only when necessary — the user.

### Protocol

1. **Detect**: a messaged question, or a `## Clarifications Needed` heading in a response or deliverable
2. **Parse**: Extract the questions, options, evidence and recommended markers
3. **Run the [decision ladder](#decision-ladder)** on each question. Settled by evidence or a peer →
   log it in `decisions.md`. Only user-reserved or unsettled questions go to the user, in one
   `AskUserQuestion` call that keeps the agent's structure (1-4 questions, 2-4 options each,
   "(Recommended)" markers)
4. **Answer**: an agent still running gets the answers through messaging (`ptah_agent_message` to a
   lane, `SendMessage` to a session). An agent that returned is re-invoked with the same
   `subagent_type` (for a lane: resume or respawn it per the agent-lanes skill), with a
   `## Decisions` section prepended to the prompt — each answer marked with who decided it:

```typescript
Task({
  subagent_type: '[same-agent]',
  description: 'Continue [Agent] for TASK_[ID] with clarifications resolved',
  prompt: `You are [agent-name] for TASK_[ID]. You previously returned clarifications. Here are the decisions:

## Decisions

### 1. [Question 1 topic]
**Selected**: [chosen option] — decided by [evidence | peer: <reviewer> | user]

### 2. [Question 2 topic]
**Selected**: [chosen option] — decided by [evidence | peer: <reviewer> | user]

Now proceed with your primary deliverable. Do not return clarifications again — these decisions are final.

[Original task prompt]`,
});
```

5. **Verify convergence**: The subagent should now produce its deliverable. If it returns clarifications a second time (rare), repeat — but examine whether the questions reveal a deeper scope problem requiring user re-engagement.

### Anti-Patterns

- **Do NOT** ignore the `## Clarifications Needed` section and re-invoke without resolution — the subagent will loop
- **Do NOT** answer a user-reserved question yourself, and do NOT mark a guess as "decided by evidence" — cite the evidence in `decisions.md` or send it to a peer
- **Do NOT** send a question to the user that evidence or a peer settled — that is the friction this ladder removes
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

When user provides feedback instead of "APPROVED" (in `lane-review` mode, also feedback that arrives after the notice):

```
1. Extract specific feedback points from user response
2. Re-invoke the original agent with:
   - Original context
   - Previous output reference
   - User feedback as revision instructions
3. Agent produces revised output
4. Refresh the independent review for the changed artifact (Cross-side review protocol), then
   re-present the checkpoint with its current verdict and open items
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
[Checkpoint 0.1: CLI Lane Mode]  ←─ Notice (no wait)
     │
     v
[Checkpoint 0: Scope Clarification]  ←─ Decision ladder; user only for scope intent
     │
     v
  Project Manager
     │
     v
[Checkpoint 1: Requirements Validation]  ←─ Required (lane-review: reviewer approves; user: APPROVED)
     │
     v
[Checkpoint 1.5: Technical Clarification]  ←─ Decision ladder; user only if reserved
     │
     v
  Designer → design-spec.md + prototype/ (when required)
     │
     v
[Checkpoint 1.7: Design Validation]  ←─ Required if designer ran or UI added/redesigned (approver per approval mode)
     │
     v
  Software Architect
     │
     v
[Checkpoint 2: Architecture Validation]  ←─ Required (lane-review: reviewer approves; user: APPROVED)
     │
     v
  Team-Leader MODE 1 → Development Loop
     │
     v
  Team-Leader MODE 3
     │
     v
[Checkpoint 3: QA Selection]  ←─ Notice (rule-based)
     │
     v
  QA Agents (if selected)
     │
     v
  Workflow Complete
```
