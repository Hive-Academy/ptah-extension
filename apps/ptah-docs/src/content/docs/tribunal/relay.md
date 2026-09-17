---
title: Relay
description: Run orchestration's plan → architect → implement → review pipeline on CLI lanes, with phase artifacts saved to .ptah/specs.
---

# Relay

Relay is **the orchestration pipeline run on CLI lanes, launched from the Tribunal panel for now**. Each phase — plan → architect → implement → review — runs on a CLI lane instead of a sub-agent. The conductor assigns the lanes, runs the approval checkpoints, and verifies their output.

The workflow lives in the `orchestration` skill's lane-assignment reference. The `tribunal` skill routes the current panel launch there. Enable `orchestration`, `tribunal`, and `agent-lanes` from `ptah-core` for that launch. If a required skill is unavailable, the dependent skill names the skill to enable before proceeding. See [skill dependencies](/mcp-and-skills/skills/#skill-dependencies).

## When to use Relay

- You want a plan, architecture, implementation, and review produced by CLI lanes.
- You want to choose a vendor and model for each phase.
- You want each phase's artifacts saved in a `.ptah/specs/TASK_*` folder for review and continuation.

For competing answers to the same prompt, use [Council](/tribunal/council/), [Forge](/tribunal/forge/), or [Race](/tribunal/race/).

## How it runs

1. **Plan** — a lane writes `task-description.md`. You review and approve it.
2. **Architecture** — a lane reads the requirements and writes `implementation-plan.md`. You approve it before implementation.
3. **Implement** — a lane writes code in place on the active branch and reports completion with evidence. The conductor verifies the report and records `batches.md`; the lane does not edit task state.
4. **Review** — a separate lane writes `code-logic-review.md` against the acceptance criteria. The conductor returns evidenced defects for revision and runs the project's typecheck, tests, and lint before presenting the diff.

Each phase receives the previous artifact as an input. The conductor uses the task folder named by the launch, or creates one if none exists. For a risky implementation phase, it can use [Crucible](/tribunal/crucible/)'s executor/judge loop.

## Choosing lanes

Lanes come from `ptah_agent_list`, which reports installed system CLIs and configured Ptah CLI providers. When you pin a vendor and model to a phase, the conductor uses that assignment. If a named lane is missing, it says so rather than substituting silently.

Without a pinned roster, planning and architecture use strong reasoning lanes, implementation uses a coding lane, and review uses a different vendor family. A review lane must never be the implement lane. You may request the same family on another model; the conductor flags that review as a weaker signal. Crucible is stricter and always requires a judge from another family.

## Invoking Relay

From the dashboard, choose **Convene a Tribunal**, then **Relay**. The current wizard shows four role slots — Plan, Architect, Implement, Review — with a vendor and model for each. An identical implement/review lane is blocked; a same-family review is flagged. Launch, then describe your task and acceptance criteria in the conductor chat.

The live panel shows a four-step phase rail with each phase's status, lane assignment, and a link to its deliverable. If no spec folder could be allocated, the progress readout is marked unavailable.

You can also ask in chat:

- "Relay this task across the panel."
- "Orchestrate this with CLI vendors instead of sub-agents."
- "Use this lane to plan, that lane to implement, and a different family to review."

## Verification and recovery

- **Work stays on the active branch** by default. Parallel attempts that could edit the same files need separate worktrees.
- **Lanes do not commit.** The conductor verifies their work and presents the diff before a commit.
- **Conversation resume is conditional.** Only a **CLI Session ID** reported by `ptah_agent_status` can be passed as `resume_session_id` to a new spawn on the same lane. Without one, the conductor spawns fresh with the prior artifacts and context restated.
- **Revision is bounded.** The lane contract allows two revise rounds, then the conductor finishes the work itself or reports the remaining defects.
- **Calls have a cost.** The conductor announces the roster, phase count, and call count before the run. Revisions add calls.
