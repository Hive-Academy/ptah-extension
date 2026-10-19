# Batch F2 report - chat-ui: lane stats bar and steer input draft model

## Files changed

- CREATED `libs/frontend/chat-ui/src/lib/molecules/agent-lane-stats/agent-lane-stats.component.ts` -
  `ptah-agent-lane-stats` + exported `AgentLaneStatsView`. Chips: Model (purple tint, display name
  via `ModelStateService`), Context (cyan), Tokens (neutral, `≥ ` when partial, `tokensTitle`
  tooltip), Cost (`undefined` -> `—`, `null`/number -> `ptah-cost-badge`, `≥ ` when partial),
  Cache (only when known). Values use `text-base-content`, labels `text-base-content-muted` (D3).
  `role="group"`, `aria-label="Agent usage"`, single row with `overflow-x-auto`.
- CREATED `.../agent-lane-stats/agent-lane-stats.component.spec.ts` - component 3 seam.
- MODIFIED `libs/frontend/chat-ui/src/lib/molecules/agent-steer-input.component.ts` - `draft` is now
  a public `model('')` (two-way bindable). Existing consumers do not bind it.
- CREATED `libs/frontend/chat-ui/src/lib/molecules/agent-steer-input.component.spec.ts` - no spec
  existed; covers clear-on-submit and a parent clearing a kept draft.
- MODIFIED `libs/frontend/chat-ui/src/index.ts` - exports `AgentLaneStatsComponent` and
  `AgentLaneStatsView` (append next to the steer input export).

## Acceptance

- Component 3 seam: met. Existing steer-input consumers' specs green.

## Checks

- `npx nx test @ptah-extension/chat-ui --parallel=1`: PASS (83 suites, 1471 tests).
- `npx nx typecheck @ptah-extension/chat-ui --parallel=1`: PASS.
- `npx nx lint @ptah-extension/chat-ui --parallel=1`: PASS (0 errors, 6 pre-existing warnings, none in
  the new files).
