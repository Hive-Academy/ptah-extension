# Batch 3A report — V15 elapsed arcs

## Files changed

- `libs/frontend/command-center/src/lib/components/command-center-projection.source.ts` and `.spec.ts`
- `libs/frontend/command-center/src/lib/model/work-projection.ts` and `.spec.ts`
- `libs/frontend/command-center/src/lib/model/command-center.store.ts`
- `libs/frontend/command-center/src/lib/scene/command-scene-renderer.ts` and `.spec.ts`

## Acceptance evidence

- `command-center-projection.source.ts:161,190-201,229`: standalone CLI agents carry their monitored `startedAt`; tribunal lane timestamps come only from agents actually bound to each lane. Manifest `startedAt` remains run state/freshness input (`:230-231`). Source spec checks a bound lane, an unbound lane, a run, and a standalone CLI agent (`command-center-projection.source.spec.ts:280,436,465-471`).
- `work-projection.ts:94-101,216,280`: nodes receive `startedAt` only when finite and no later than projection `now`; missing and invalid fields are omitted. Projection spec checks valid, missing, future, infinite, and NaN values (`work-projection.spec.ts:317-352`).
- `command-center.store.ts:34`: optional `CommandWorkNode.startedAt` contract.
- `command-scene-renderer.ts:551-569`: only running nodes with a start draw an opaque `inks.run` arc next to the state arc. The frame timestamp is converted to epoch time and the arc clamps at five minutes. The existing draw schedule is unchanged. Renderer spec checks half/full sweep, nonrunning and missing starts, reduced motion, and frame counts (`command-scene-renderer.spec.ts:381-420`).

## Verification

- Added focused assertions in the three matching spec files. Per batch instruction, no Nx, Jest, TypeScript, lint, build, or manual frame measurement was run.
- Scoped `ptah_get_diagnostics` was attempted on all seven changed files; it returned unavailable after its 45 second TypeScript timeout, with all files unchecked. The orchestrator must run the requested checks.

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Carry a separate `laneStartedAt` map on `OwnedRun` | `PhaseDerivationInput.laneBindings.bound` exposes only `task` and `status` through `PhaseAgent`, while the source has the full bound `MonitoredAgent`. This keeps the change within batch ownership and avoids widening the shared tribunal contract. | Yes |
| Convert the existing rAF `time` with `performance.timeOrigin` | The frame callback already supplies monotonic time; monitored starts are epoch milliseconds. This adds no clock or scheduler. | Yes |
| Leave elapsed DOM text to the later shared detail step | `command-node-detail.component.ts` is outside batch 3A ownership. The Canvas remains `aria-hidden`. | Yes |
