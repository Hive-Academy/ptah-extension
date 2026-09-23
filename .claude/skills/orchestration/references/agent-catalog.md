# Agent Catalog

The specialist subagents, how to pick one, and the one invocation shape they all share. Whether an
agent's work may run on a CLI lane instead is in [lane-assignment.md](lane-assignment.md).

---

## Capability matrix

| Agent                    | Write Code | Design | Review | Plan  | Research | Content | Browser | CLI Delegation |
| ------------------------ | :--------: | :----: | :----: | :---: | :------: | :-----: | :-----: | :------------: |
| project-manager          |     -      |   -    |   -    | **P** |    S     |    -    |    -    |       S        |
| software-architect       |     -      | **P**  |   S    | **P** |    S     |    -    |    -    |       S        |
| team-leader              |     -      |   -    |   S    | **P** |    -     |    -    |    -    |       -        |
| backend-developer        |   **P**    |   S    |   -    |   -   |    -     |    -    |    -    |       S        |
| frontend-developer       |   **P**    |   S    |   -    |   -   |    -     |    -    |    -    |       S        |
| devops-engineer          |   **P**    |   S    |   -    |   -   |    S     |    -    |    -    |       S        |
| senior-tester            |   **P**    |   -    | **P**  |   -   |    -     |    -    |    -    |     **P**      |
| code-style-reviewer      |     -      |   -    | **P**  |   -   |    -     |    -    |    -    |       S        |
| code-logic-reviewer      |     -      |   -    | **P**  |   -   |    -     |    -    |    -    |       S        |
| visual-reviewer          |     -      |   -    | **P**  |   -   |    -     |    -    |  **P**  |       -        |
| researcher-expert        |     -      |   -    |   -    |   -   |  **P**   |    S    |    -    |     **P**      |
| modernization-detector   |     -      |   -    |   S    |   -   |  **P**   |    -    |    -    |       S        |
| ui-ux-designer           |     -      | **P**  |   -    |   S   |    -     |    S    |    -    |       -        |
| technical-content-writer |     -      |   S    |   -    |   -   |    -     |  **P**  |    -    |       S        |
| video-director           |   **P**    | **P**  |   -    |   -   |    -     |    S    |  **P**  |       S        |

**P** = primary, **S** = secondary, **-** = not applicable.

**CLI Delegation**: **P** benefits most from CLI lanes (parallel analysis, per-module tests, multi-file reviews); **S** delegates occasional sub-tasks; **-** never spawns a lane — team-leader (recommends lanes in `batches.md`, never spawns them), visual-reviewer (needs browser tools) and ui-ux-designer (needs interactive discovery). Rules: [lane-assignment.md](lane-assignment.md).

## Selection matrix

| Request        | Agent path                                         |
| -------------- | -------------------------------------------------- |
| Implement X    | project-manager → [designer → prototype → Gate 1.7] → architect → team-leader → dev    |
| Fix bug        | team-leader → dev → test → review                  |
| Research X     | researcher-expert → architect                      |
| Review style   | code-style-reviewer                                |
| Review logic   | code-logic-reviewer                                |
| Review visual  | visual-reviewer                                    |
| Test X         | senior-tester                                      |
| Architecture   | software-architect                                 |
| Landing page   | ui-ux-designer → prototype → Gate 1.7 → technical-content-writer          |
| Brand / visual | ui-ux-designer → prototype → Gate 1.7             |
| Content        | technical-content-writer                           |
| Demo video     | video-director                                     |
| Infrastructure | devops-engineer                                    |

---

## Invocation

Every agent is invoked with one shape. Subagents have no UI channel: an agent not told where to
write may answer inline and skip the file.

```typescript
Task({
  subagent_type: '<agent>',
  description: '<description from the table> for TASK_[ID]',
  prompt: `You are <agent> for TASK_[ID].

**Task Folder**: <absolute path to .ptah/specs/TASK_[ID]>
<context lines from the table>
**Deliverable**: Write your output to \`<absolute task folder>/<deliverable>\` with the Write tool. Do NOT return content inline. After writing, reply with \`WROTE: <absolute path>\` plus the one-line headline of your verdict. Nothing else.

<instruction from the table>`,
});
```

| Agent | `description` | Context lines | Deliverable | Instruction |
| --- | --- | --- | --- | --- |
| project-manager | Create requirements | `**User Request**: "<the user's words>"` | `task-description.md` | Analyze the request and write the requirements. |
| software-architect | Design implementation | `**Requirements**: task-description.md in the task folder` | `implementation-plan.md` | Design the technical implementation plan. |
| team-leader | Decompose / verify / complete | `**MODE**: 1 - DECOMPOSITION` (or 2, 3) — see [team-leader-modes.md](team-leader-modes.md) | `batches.md` | Per mode. |
| backend-developer, frontend-developer | Implement Batch N | `**Batch**: Batch N in batches.md (IN_PROGRESS)`<br>`**Plan**: implementation-plan.md` | code + report | Report each task's completion with evidence; do not edit batches.md; the team-leader records state. |
| devops-engineer | Implement infrastructure | `**Plan**: implementation-plan.md` | code + report | Implement the infrastructure changes. |
| senior-tester | Test implementation | `**Changes**: batches.md`<br>`**Plan**: implementation-plan.md` | `test-report.md` | Write and run the tests; record the results. |
| code-style-reviewer | Review code style | `**Changes**: batches.md` | `code-style-review.md` | Review for style, patterns and consistency. |
| code-logic-reviewer | Review code logic | `**Changes**: batches.md`<br>`**Plan**: implementation-plan.md` | `code-logic-review.md` | Review for logic completeness and correctness. |
| visual-reviewer | Visual review | `**Changes**: batches.md (frontend files)`<br>`**Base URL**: <running app URL>` | `visual-review.md` + `screenshots/` | Run the visual review checklist below. |
| researcher-expert | Research X | `**Research Question**: "<the question>"` | `research-report.md` | Compare the options, recommend one. |
| modernization-detector | Analyze future improvements | `**Changes**: batches.md` | `future-enhancements.md` | Find follow-up improvements and tech debt. |
| ui-ux-designer | Create design and prototype | `**Goal**: <what to design>`<br>`**Parity**: parity-inventory.md when required` | `design-spec.md` + `prototype/` | Run niche discovery, build the design system and prototype (README.md + screenshots/); disclose lane-introduced constraints; revise until Gate 1.7 is approved. |
| technical-content-writer | Create content | `**Design System**: DESIGN-SYSTEM.md in your own skill directory`<br>`**Goal**: <what to write>` | `content-specification.md` | Write design-integrated content. |
| video-director | Author showcase scene | `**Goal**: <feature or flow>`<br>`**App**: <what to launch, which URL>` | scene + render | Read the `video-showcase` skill first, then author, capture, render. |

The designer owns `<taskFolder>/prototype/`. FEATURE UI and CREATIVE design flow through
designer → prototype → Gate 1.7 before the architect or next creative phase; hand off the
approved prototype as the visual source of truth. PM (architect when no PM) supplies the
old-code parity inventory before design starts when an existing surface is replaced/redesigned.

**Visual review checklist** (spell it out in the visual-reviewer prompt):

1. Test six viewports: 320, 375, 768, 1024, 1366, 1920.
2. Screenshot each viewport into `screenshots/`.
3. Test hover, focus and active states.
4. Check color contrast ratios.
5. Check touch target sizes.
6. Test responsive behavior between the breakpoints.
7. Compare dark + light theme screenshots with the approved `<taskFolder>/prototype/`; show evidence to the user before merge.

---

## Profiles

| Agent | Invoked when | Reads | Runs alongside |
| --- | --- | --- | --- |
| project-manager | FEATURE / DOCUMENTATION / DEVOPS phase 1, or unclear scope | request, `context.md` | — |
| software-architect | After PM; REFACTORING / DEVOPS start; architectural decision needed | `task-description.md`, research | — |
| team-leader | After architect (Mode 1), after each executor or reviewer (Mode 2), all batches done (Mode 3) | plan, `batches.md`, reports | — |
| backend-developer | A batch of server-side work | `batches.md`, plan, project conventions | frontend-developer on a different batch |
| frontend-developer | A batch of UI work | `batches.md`, plan, design spec | backend-developer on a different batch |
| devops-engineer | DEVOPS implementation; pipelines, containers, publishing | plan, existing pipeline and container files | — |
| senior-tester | Gate 3 `tester` / `all` | `batches.md`, plan, changed files | reviewers |
| code-style-reviewer | Gate 3 `style` / `reviewers` / `all`; DOCUMENTATION final check | changed files, style rules | tester, other reviewers |
| code-logic-reviewer | Gate 3 `logic` / `reviewers` / `all`; team-leader `NEEDS REVIEW` | changed files, plan | tester, other reviewers |
| visual-reviewer | UI batch evidence; Gate 3 `visual` for rendered UI | changed UI files, running app, approved prototype | tester, other reviewers |
| researcher-expert | Technical unknowns, BUGFIX with unknown cause, RESEARCH | question, `context.md`, external docs | — |
| modernization-detector | Final phase, after QA | `batches.md`, changed files | — |
| ui-ux-designer | CREATIVE; FEATURE with added/redesigned UI | brand input, references, `context.md`, parity inventory | — (prototype + Gate 1.7 before architect/content) |
| technical-content-writer | CREATIVE after the design system exists; blogs, docs, scripts | `DESIGN-SYSTEM.md`, brief, source | other content-writer instances |
| video-director | Demo, tour or showcase video | the flow to demo, a runnable app | — (capture owns the app) |

Only the team-leader sets task states in `batches.md`. Specialists never edit `task.md` or `batches.md`.

## Parallel QA

Send parallel invocations in one message.

| Gate 3 choice | Agents |
| --- | --- |
| `reviewers` | code-style-reviewer, code-logic-reviewer, visual-reviewer (rendered UI only) |
| `all` | senior-tester plus the reviewers |

Independent batches (different files, no dependency) may also run in parallel, one developer each.
