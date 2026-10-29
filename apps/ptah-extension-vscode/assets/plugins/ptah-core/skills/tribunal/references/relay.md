# Relay launch

Relay — plan → architect → implement → review, each phase on a CLI lane — is orchestration with every
phase assigned to a lane. The protocol is
[orchestration/references/lane-assignment.md § Assigning phases to lanes](../../orchestration/references/lane-assignment.md#assigning-phases-to-lanes).
Read it before spawning anything; it is the authority for this run.

Plain-text phase pins from the user map to orchestration:

| User says | Meaning |
| --- | --- |
| A lane for plan, architect, implement or review | Pin that lane to the named phase |
| A model for a phase | Resolve that model against `ptah_agent_list` before spawning |
| A task folder or deliverable path | Use the named path as given |

Keep each pin with its named phase and run phases in orchestration order. Report unavailable
or AT LIMIT pins without
substitution. Present the resolved lanes, phases and expected paid call count; get
confirmation before any `ptah_agent_spawn`.

The review lane must not be the implement lane. You own every gate: Gate 1 after the plan, Gate 2
after the architecture, before relaying the next phase. The recorded approval mode decides each gate
(orchestration `checkpoints.md` § Approval mode): with `Approval: lane-review` and no escalation, an
approving cross-side review passes it. With `Approval: user`, or when an escalation applies (REVISE
after the cap, a review that is not cross-side, a proposed removal or a ban of an existing project
component, user feedback), the user approves.
