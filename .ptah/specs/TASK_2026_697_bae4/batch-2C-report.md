# Batch 2C — rich start cards

## Files changed

- `libs/frontend/command-center/src/lib/components/command-center-start.component.ts`
- `libs/frontend/command-center/src/lib/components/command-center-start.component.spec.ts`

## Acceptance evidence

- Known providers use the existing `ProviderMarkComponent`; unknown IDs use `MonogramTileComponent` (`command-center-start.component.ts:105-109`). Test: `command-center-start.component.spec.ts:63`.
- The six static bars encode age from the required shared `now` input, with no card timer or animation. Invalid timestamps omit the bars, while explicit `Updated …` text remains (`command-center-start.component.ts:114-130,196-205`). Test: `command-center-start.component.spec.ts:77`.
- Cards show message count, optional token total including zero, active state, live phase, and history unavailability only when `hasTranscript === false` (`command-center-start.component.ts:132-145,207-217`). Test: `command-center-start.component.spec.ts:97`.
- Each grid card remains one button and has a coherent accessible name containing its session details (`command-center-start.component.ts:98-103,220-233`). Test: `command-center-start.component.spec.ts:97`.

## Verification

- Added three focused acceptance specs at lines 63, 77, and 97 of the start component spec. The existing card behavior specs remain.
- Scoped `ptah_get_diagnostics` was invoked after edits. It twice returned `typescript-compiler — Unavailable` because its check was still running after 45 seconds; both files remained unchecked. No Nx, Jest, tsc, lint, or build command was run, per batch instruction. The orchestrator must run checks.

## Decisions

- Age bands are `<1m`, `<5m`, `<30m`, `<2h`, `<24h`, then older, mapped to 6 through 1 filled bars. The plan specifies six static age bars but no thresholds; these reversible bands keep recent activity distinct without implying volume.
- Token usage sums the existing input, output, cache read, and cache creation fields. Invalid or negative figures omit the total; a present zero remains visible. This follows the shared `MessageTokenUsage` fields and is reversible.
- `hasTranscript === false` adds `History unavailable` without disabling selection, preserving the start view's existing action behavior. Undefined is not treated as expired.
