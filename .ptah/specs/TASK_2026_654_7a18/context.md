# TASK_2026_654_7a18 — context

> **Moved into TASK_2026_629_c0b3 R9 item 7 (user decision, 2026-10-13; 629 decisions.md row 70).** This task is
> cancelled. The notes below are kept as input for the 629 R9 plan.

Source: user request on 2026-10-13, during the Electron test of TASK_2026_629_c0b3 (Rail board). Not a 629
regression: no earlier task recorded this decision (checked 629, 628 and memory).

## Request

Stop rendering nested sub-agent streaming inside the main chat transcript. Show each sub-agent as one compact tile,
like the background-agent tile. When the user clicks the tile, show the full transcript in the main view.

## Proposed direction (to validate in the PM / design phases)

- Main transcript: each sub-agent (`Task` tool call) renders as one compact tile — kind icon, name, status, last
  activity line, tool count, duration — instead of the nested stream. This also cuts renderer work (TASK_2026_628
  goal).
- Click target per host:
  - Canvas Rail: open that sub-agent's lane tab in the focus area (exists in TASK_2026_629, `canvas-lane-tabs`).
  - Canvas Grid: open the detail panel on that lane.
  - Single chat view: open the full transcript in the main view with a "back to the orchestrator" control.
- Live data: tile and full view read one live stream. Today the sub-agent transcript viewer is a one-shot RPC
  snapshot with manual refresh, and its shared message type drops tool noise (memory
  `background-agent-live-transcript`). A live view needs a backend push contract — plan together with
  TASK_2026_633_21fa (keep background sub-agent output live after the parent turn).

## Known constraints

- Parity: the nested view's capabilities (tool calls, permissions inside sub-agents, errors) must stay reachable from
  the full view — write `parity-inventory.md` from the old code before design.
- A UI surface is redesigned → designer, prototype, Gate 1.7.
- Ownership: use strict session ownership for agents (see TASK_2026_629 decisions row 69).
