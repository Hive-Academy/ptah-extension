# Relay launch

Relay — plan → architect → implement → review, each phase on a CLI lane — is orchestration with every
phase assigned to a lane. The protocol is
[orchestration/references/lane-assignment.md § Assigning phases to lanes](../../orchestration/references/lane-assignment.md#assigning-phases-to-lanes).
Read it before spawning anything; it is the authority for this run.

Mapping a Tribunal UI launch onto it:

| UI framing | Meaning |
| --- | --- |
| `(plan)` / `(architect)` / `(implement)` / `(review)` token | That lane is pinned to that phase |
| `Deliverable: <specFolder>/<file>` | Write that phase's output exactly there |
| `Spec folder: TASK_… (already created …)` | Use it; do not allocate an ID |
| `[tribunal:<laneId>]` | Keep as the literal first line of that lane's task |

The review lane must not be the implement lane. You own every gate: Gate 1 after the plan, Gate 2
after the architecture, before relaying the next phase.
