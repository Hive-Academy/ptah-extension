# Batch A3 review fixes

- `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.component.ts:72,98,229,258`: Failed, timeout, and stopped lanes now show a warning-toned status word in the header and a Status fact in details. A guard stop reason remains alongside the status word. Completed lanes retain the Worked label without status metadata.
- `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.component.ts:193,241`: Resolve `AgentMonitorTreeBuilderService` through `Injector` only when the flat presentation reads the lane tree. Card presentation no longer instantiates it eagerly.
- `libs/frontend/chat/src/lib/components/organisms/agent-monitor-panel.component.spec.ts:534`: Complete the selected-agent store mock with `agentsById`, used by the tree builder effect if a flat lane is rendered.
- `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.component.ts:257`: Omit zero token metadata. Mark an input/output sum as partial with `≥` when `usageTotals.totalTokens` is absent, even when `usageTotals` exists.
- `libs/frontend/chat/src/lib/components/molecules/execution-header/execution-header.component.ts:10,29`: Expose the required kind on the host as `data-kind` and give the details region an accessible name.

Specs added or extended:

- `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card-flat-header.spec.ts:44,55,77,91,104,112,120`: Completed status omission and detail fact; failed, timeout, and stopped warning metadata and facts; guard reason preservation; zero and partial token cases; lazy tree builder construction.
- `libs/frontend/chat/src/lib/components/molecules/execution-header/execution-header.component.spec.ts:26,38`: Host kind and details region name.

## Decisions

- Kept `kind` because the binding plan requires it and exposed it as a host attribute. Reversible: yes.
- Used human-readable status facts (`Timed out` for `timeout`) so the detail view and header agree. Reversible: yes.
- Treated a token sum without `totalTokens` as a lower bound, including a structured usage object, per the review. Reversible: yes.

No tests, typecheck, lint, or build commands were run, per the handoff. Scoped `ptah_get_diagnostics` reported no diagnostics in the five requested files; it reported errors in sibling files outside A3 scope.
