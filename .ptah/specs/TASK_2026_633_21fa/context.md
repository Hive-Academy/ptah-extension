# Context: background sub-agent output stays live after the parent turn

## Origin

Carried over from TASK_2026_410 (closed 2026-10-12). TASK_2026_410 only shipped the unblockers
(`0caa52f27`: portable worktree paths, `strict: false` in `responses-request-translator.ts`).
Its UI part ("open a live execution view from the tray chip") is replaced by TASK_2026_629: the
canvas detail row has lane tabs for Sub-agents, CLI lanes and Background, and a click on a card
lane row opens that tab.

This task holds only the data path that TASK_2026_629 needs and does not have. CLI lanes already
work through `AgentMonitorStore`. SDK sub-agents and background agents do not: their output stops
when the parent turn ends.

## Scope

- [ ] Identity reconciliation between the `toolCallId` and the real SDK `agentId`, including the
      pending identity state before the SDK reports the `agentId`.
- [ ] Text, tool calls and tool results keep streaming after the parent `result` and after a new
      parent turn starts.
- [ ] Bounded, agent/session-scoped retention that does not depend on the parent turn. Truncation is
      visible. Errors are distinct from waiting and empty.
- [ ] History backfill for a background run that started before the view subscribed, with a
      snapshot/live merge that keeps order and legitimate repeated deltas (a `Set` of message ids is
      not sufficient).
- [ ] Outside the canvas, the background-agent tray chip opens or focuses the same view.
      Today `onFocus` in `background-agent-tray.component.ts` only calls `tabManager.switchTab`.

## Out of scope

- The canvas cards, detail row and lane tab UI (TASK_2026_629).

## Prior evidence

`../TASK_2026_410/context.md`, `agent-output-root.md` and `worktree-spawn-investigation.md`. Two
earlier proposals: a new `transcriptDelta` push, or reuse of the turn-local `StreamingState`.
Prefer reuse of the forwarded events with retention outside the parent turn. Verify the actual
routing after finalization before adding a new push. Do not add a watcher or polling without proof
of missing delivery. SDK sub-agents and external CLI monitors have different identity contracts.
Share only the presentation.

## Acceptance

- A lane tab (or the tray chip) opens the correct execution at once, also in the pending identity state.
- Two concurrent agents have isolated messages and tools and the correct session attribution.
- Output continues after the parent result and after a new parent turn.
- Close and reopen of the view does not stop collection and does not duplicate output.
- Snapshot/live races keep content and order.
- Regression tests plus interaction harness proof.
