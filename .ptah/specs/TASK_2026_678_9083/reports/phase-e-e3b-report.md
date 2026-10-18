## Changes

- `libs/frontend/command-center/src/lib/components/command-work-list.component.ts:70`: added a stable `data-test="work-state-icon"` attribute to the existing end state icon. Visible behavior is unchanged.
- `libs/frontend/command-center/src/lib/components/command-center-projection.source.ts:115-116`: forwarded each owned monitored CLI agent's `displayName` and `task` to the projection model.

## Specs added or changed

- `libs/frontend/command-center/src/lib/components/command-work-list.component.spec.ts:31`: count only the end state icons, so provider marks do not inflate the expected 29.
- `libs/frontend/command-center/src/lib/components/command-center-projection.source.spec.ts:63-80,155-161`: verify a live agent named `Architecture 1` keeps that label and a task-only agent is labelled `Review release plan`.
- All four edited TypeScript files parsed with zero AST errors. Scoped `ptah_get_diagnostics` was attempted for those files but returned unavailable after its 45-second TypeScript timeout.

## Decisions

- Reused the existing optional `OwnedAgent.displayName` and `task` fields in `model/work-projection.ts:27-28`; no model edit was needed. Evidence: `agentLabel` already prefers display name, then task, at `:35-43`. Reversible.
- Added a selector hook to the existing icon instead of relying on `aria-hidden`, which provider marks also use. Reversible.

## Not done

- No Nx, Jest, TypeScript, build, serve, or e2e command was run, as directed. The orchestrator owns the scoped checks.
