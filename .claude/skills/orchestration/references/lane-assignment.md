# Lane Assignment

When orchestration work runs on CLI lanes instead of (or under) subagents: who may spawn, what each
role hands off, what never goes to a lane, and how to run phases — up to a whole task — on lanes.
How to run any lane (discovery, addressing, prompts, resume, review, revise cap) is the
[agent-lanes skill](../../agent-lanes/SKILL.md); nothing here repeats it.

---

## Who spawns

| Actor | May spawn |
| --- | --- |
| **Orchestrator** | Every subagent, every batch executor (subagent or lane), every lane a phase is assigned to |
| **Team-leader** | Nothing. It recommends executors in `batches.md`; you act on them |
| **Other subagents** | CLI lanes for their own sub-tasks, when Gate 0.1 left lanes `enabled` or `auto` and the role is not on the never list below. They own what their lanes return |

## Gate 0.1 outcome

Record it in `context.md` under `## CLI Lanes`: the mode (`enabled` / `auto` / `disabled`) and the
`ptah_agent_list` rows verbatim. Then, for `enabled` or `auto`, add this block to every subagent
prompt except team-leader:

```markdown
## CLI Lanes
Mode: <enabled — delegate focused sub-tasks | auto — delegate when it clearly helps>
Discovered lanes: <the ptah_agent_list rows>
Run lanes per the agent-lanes skill. You own the synthesis: verify lane output before it enters your deliverable.
```

For `disabled`, add nothing and never spawn a lane.

## Batches on lanes

Team-leader marks a batch `parallel` with lanes as the executor only when its tasks are
independent and file-disjoint. You spawn and merge them: [team-leader-modes.md](team-leader-modes.md#spawning-a-batch-executor).

## What each role hands off

| Role | Hands to a lane | A task line that works |
| --- | --- | --- |
| project-manager | Codebase surveys, dependency and file-structure analysis | "List every component under `<dir>` grouped by feature. Markdown table: name, path, inputs." |
| software-architect | Pattern analysis in named modules, dependency checks, spikes | "In `<dir>`, list every DI token, its type, and where it is provided. Flag circular-dependency risks." |
| backend-developer, frontend-developer | Test scaffolding, boilerplate inside the batch | "Create unit-test scaffolding for `<Class>` in `<absolute path>`: one describe per public method." |
| devops-engineer | Config and script generation | "Write a multi-stage container file that installs with `npm ci`, builds, and ships a minimal image." |
| senior-tester | One lane per module for test generation | "Write unit tests for `<file>`: happy path and error cases for every public method." |
| code-style-reviewer, code-logic-reviewer | One lane per file across many files | "Review `<file>` for naming, error handling and type precision. Numbered issues with line references." |
| researcher-expert | Separate aspects of one question in parallel | One lane on the external API surface, one on how this codebase already uses it. |
| modernization-detector | One lane per module | "Analyze `<dir>` for deprecated APIs and outdated patterns. Prioritized list." |
| technical-content-writer | Feature research and section drafts | "Read `<dir>` and summarize its capabilities and integration points for developer docs." |

## Never on a lane

- Requirements and plans the user approves (`task-description.md`, `implementation-plan.md`) as a
  subagent's *own* deliverable — lanes may gather inputs, the subagent writes and owns the document.
  A phase assigned wholly to a lane (below) is the exception, and still passes Gate 1 / Gate 2.
- Git commits, and anything that asks the user.
- visual-reviewer work — it needs browser tools lanes do not have.
- ui-ux-designer work — it needs interactive discovery with the user.
- Security-critical review decisions and cross-cutting architecture judgement.

---

## Assigning phases to lanes

Any phase can run on a lane instead of a subagent: PM, architect, a batch, a review. When every
phase is a lane, the whole task runs on external vendors with no subagents — a relay. A whole-phase
lane still respects the batch cap (≤6 files, ≤2 libs, one scoped verification per batch) and the
per-lane tool-call ceiling (agent-lanes §8): an implement phase larger than one batch is spawned as
several sequential lanes, each with its own file list, not one long lane.

| Phase | Deliverable | Default lane when the user names none |
| --- | --- | --- |
| Plan | `task-description.md` | A strong-reasoning lane |
| Architecture | `implementation-plan.md` | A strong-reasoning lane |
| Implement | code in place + a report with evidence per task; **you** record `batches.md` after verifying it | The strongest coding lane listed |
| Review | `code-logic-review.md` | A lane from a **different family** than the implementer |

### The roster

- **Pinned** ("codex plans, Claude architects, Ollama GLM implements, codex on another model
  reviews") → resolve each name against `ptah_agent_list` and spawn exactly that, including the same
  family twice on different models. A named lane that is not listed → stop and ask.
- **Not pinned** → assign by role fit, not by family spread.
- Record `phase → lane → model` in `context.md` and announce it as a table before spending.

Worked example (vendor names are illustrations):

| Phase | Lane | spawn args | Deliverable |
| --- | --- | --- | --- |
| Plan | Codex | `{ cli: 'codex' }` | `task-description.md` |
| Architecture | Claude provider | `{ ptahCliId: '<listed id>', modelTier: 'opus' }` | `implementation-plan.md` |
| Implement | Ollama Cloud GLM | `{ ptahCliId: '<listed id>', model: '<listed glm id>' }` | code + report |
| Review | Codex, another model | `{ cli: 'codex', model: '<another listed id>' }` | `code-logic-review.md` |

The review lane did not implement, and GPT reviews GLM, so independence holds by family.

### Constraints that survive pinning

1. The review lane is never the implement lane — review independence per agent-lanes §6.
2. Every gate stays with you: Gate 1 after the plan, Gate 2 after the architecture, `APPROVED`
   before the next phase. A lane returning `## Clarifications Needed` goes through Gate SR.
3. A phase you write in-process, because no suitable lane exists, is labelled as not an outside
   opinion in the summary.

### Flow

1. Create the task folder ([task-tracking.md](task-tracking.md#new-task)), or use the one the
   prompt says already exists.
2. Announce the roster, phase count and call count; get the go-ahead — this writes code.
3. For each phase in order: spawn with the prior phase's artifact as an absolute input path, run
   the gate, then pass the new artifact on.
4. Implement runs in place on the active branch. Use a worktree only if you fan one phase out to
   several lanes; say so and the added cost.
5. When the implement phase is the risky one, run implement + review as the `tribunal` skill's
   Crucible loop instead of a single review pass.
6. Verify with the project's typecheck, tests and lint; if review found a real defect, send it back
   per agent-lanes §6. Summarize which lane produced what, link every artifact, present the diff.
   Never commit without the user.
