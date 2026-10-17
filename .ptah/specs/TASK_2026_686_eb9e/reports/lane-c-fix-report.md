# Lane C fix round

## M1: Reactive projection clock

`command-center-page.controller.ts` now owns a 30-second signal clock and passes its value to `CommandCenterProjectionSource.input`. The clock clears its interval through `DestroyRef`. `runState` receives the clock value explicitly, expires agentless manifests after two minutes, and treats a `startedAt` more than two minutes in the future as unknown.

Specs: `command-center-projection.source.spec.ts` checks fresh, expired, and future timestamps and verifies a computed projection changes from `starting` to `unknown` when only the clock signal advances. `command-center-clock.spec.ts` checks ticking and teardown.

## M3: Tribunal intent

`command-center-tribunal-intent.ts` recognizes the agreed launch verbs, optional article or number, plural moves, and `with`, `via`, or `using` phrases. It excludes a move or `tribunal` immediately followed by the specified compound nouns. `command-center-tribunal-intent.spec.ts` covers the reviewer's positive and negative examples, plus additional phrase forms. Existing controller integration requests use `run council review`, which remains explicit intent.

## Files changed in this round

- `libs/frontend/command-center/src/lib/components/command-center-clock.ts`
- `libs/frontend/command-center/src/lib/components/command-center-clock.spec.ts`
- `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts`
- `libs/frontend/command-center/src/lib/components/command-center-projection.source.ts`
- `libs/frontend/command-center/src/lib/components/command-center-projection.source.spec.ts`
- `libs/frontend/command-center/src/lib/components/command-center-tribunal-intent.ts`
- `libs/frontend/command-center/src/lib/components/command-center-tribunal-intent.spec.ts`

Controller line count: **695** (`(Get-Content ...).Count`; limit 700). `git diff --check` reported no whitespace errors. Tests, type checking, builds, and Nx were not run as instructed.

## Decisions

- Tick every 30 seconds while the page exists. This keeps the clock independent of manifest persistence and bounds expiry delay to one tick.
- Preserve the existing two-minute launch window and `unknown` state for agentless stale runs.
- Keep the intent rule syntactic: a launch phrase or preposition plus a move, or an unqualified `tribunal` word, with the requested immediate compound exclusions.
