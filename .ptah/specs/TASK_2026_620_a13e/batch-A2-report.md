# Batch A2 report — Product provenance taps

Optional read-only dispatch tap on the memory curator and the skill lane runner. With no subscriber, the query is unchanged. Ride-active reports the host's active provider.

## Files changed

- `libs/backend/agent-sdk/src/lib/curator-llm-adapter/model-dispatch-provenance.ts` — tap interface and `Symbol.for('PtahModelDispatchProvenanceTap')`.
- `libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.ts` — optional tap after the curator auth decision, before `execute`.
- `libs/backend/agent-sdk/src/lib/curator-llm-adapter/sdk-internal-query.curator-llm.spec.ts` — seven tap specs.
- `libs/backend/skill-synthesis/src/lib/lanes/model-dispatch-provenance.ts` — the same tap symbol, plus `Symbol.for('SdkAuthManager')`.
- `libs/backend/skill-synthesis/src/lib/lanes/lane-runner.service.ts` — optional tap inside `callOnce`, before `execute`.
- `libs/backend/skill-synthesis/src/lib/lanes/lane-runner.service.spec.ts` — seven tap specs.

## Callback contract

Token (both libraries): `Symbol.for('PtahModelDispatchProvenanceTap')`.

```ts
interface ModelDispatchProvenanceTap {
  onModelDispatched(provenance: {
    resolvedProviderId: string;
    resolvedModelId: string;
    component: 'memory-curator' | 'skill-lane';
    laneId: string;
  }): void;
}
```

Injected with `{ isOptional: true }`, last constructor arguments, so existing positional specs stay valid.

- No tap: `resolveActiveAuth` is not called. `execute` still receives the same `model` and `auth` (`auth` by reference on a lane snapshot).
- Override / lane auth snapshot: `resolvedProviderId` is the configured provider whose snapshot was applied. `resolvedModelId` is the model string passed to `execute`.
- Ride-active (curator: no resolver, resolver `null`, or `ProviderAuthError`; lane: `auth === undefined`): `resolvedProviderId` is `IAuthEnvProvider.resolveActiveAuth().providerId`, not `memory.curatorProvider` or `config.provider`. If that port is absent, the id is `''`.
- Cooling-down and lane stalls (`auth-unresolvable`) do not notify and do not call `execute`.
- A throw from the tap or from the active-provider read is caught. Curator logs `[memory-curator] provenance tap failed`; the lane runner logs `[skill-synthesis] provenance tap failed`. The model call still runs.
- `laneId` is `memory-curator` or `user-action` for the curator, and the skill lane id for the runner. Each `callOnce` notifies once, including a structured-output re-run.

Active provider port: curator injects `AUTH_PROVIDERS_TOKENS.SDK_AUTH_MANAGER` (`Symbol.for('SdkAuthManager')`). The lane runner injects the same symbol via `ACTIVE_AUTH_MANAGER` in its local provenance file. It is read only when a tap is present.

## Checks

- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/curator-llm-adapter --runInBand --forceExit --silent` — pass, 4 suites, 83 tests, exit 0.
- `npx jest -c libs/backend/skill-synthesis/jest.config.ts libs/backend/skill-synthesis/src/lib/lanes --runInBand --forceExit --silent` — pass, 8 suites, 283 tests, exit 0.
- `npx eslint` on the six files — exit 0. One warning, not from this tap: `lane-runner.service.ts:505` `no-useless-assignment` on the pre-existing `let text = ''`.
- `npx prettier --check` on the six files — pass, exit 0.
- `ptah_get_diagnostics` scoped to the four implementation files — 0 errors.

## Decisions

The two `model-dispatch-provenance.ts` files repeat the same interface and the same `Symbol.for('PtahModelDispatchProvenanceTap')`. Skill-synthesis already depends on `@ptah-extension/agent-sdk`, and both libraries depend on `@ptah-extension/platform-core`. A single home in agent-sdk would need a new export from `libs/backend/agent-sdk/src/index.ts`, which this batch does not own. A home in platform-core would edit a third library. One container registration of the shared symbol serves both call sites, so the duplicate was left in place.

`SdkAuthManager` is reused rather than a new active-provider token. It is already registered in product hosts. The lane file repeats `Symbol.for('SdkAuthManager')` because skill-synthesis does not depend on `@ptah-extension/auth-providers-tokens`.

The tap runs after route resolution and before `execute`, so a failed call still has a route, and request bytes are not rewritten. The model id is the string handed to `execute` (a tier alias stays an alias). Quota cooling-down and lane auth stalls are not dispatches.

## Deviations

`component` and `laneId` are on the payload in addition to the two required ids. No other files were edited. The pre-existing eslint warning on `text` was left as it was.

## Round 1 fixes

All three findings are fixed.

1. The tap now fires in `SdkQueryRunner.runOneShot`, immediately before `queryFn`, using `options.model` from `resolveModelId` (the value written onto the SDK options). Callers still choose the provider: an auth snapshot uses that provider id; ride-active uses `resolveActiveAuth().providerId`. They pass `{ resolvedProviderId, component, laneId }` as `dispatch`. The runner adds `resolvedModelId`. A tier alias such as `haiku` stays on the execute request; the tap receives the concrete id (`gpt-5.6-terra` for a codex snapshot, `claude-haiku-4-5` for the active anthropic env in the runner spec).
2. The runner snapshots that payload and calls the subscriber from `queueMicrotask`. Sync throws and rejected promises are logged as `[model-dispatch] provenance tap failed`. The query promise still resolves. The runner spec records `execute` before a tap that busy-waits 40ms, and logs `async tap` for a rejected promise.
3. The contract lives once in `libs/backend/agent-sdk/src/lib/curator-llm-adapter/model-dispatch-provenance.ts` and is exported from `libs/backend/agent-sdk/src/index.ts`. Skill-synthesis imports `ModelDispatchRoute` from `@ptah-extension/agent-sdk`. `lanes/model-dispatch-provenance.ts` is deleted. `ACTIVE_AUTH_MANAGER` remains a local `Symbol.for('SdkAuthManager')` in the lane runner so that library does not depend on auth-providers-tokens. A lane spec asserts the imported token equals `Symbol.for('PtahModelDispatchProvenanceTap')`. One tap instance on the runner receives both the curator and the lane routes.

Pass-through, required so the route reaches the runner: `InternalQueryConfig.dispatch`, `InternalQueryService.execute`, and `IInternalQuery.execute`. No deep import.

### Checks (round 1)

- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/curator-llm-adapter libs/backend/agent-sdk/src/lib/helpers/sdk-query-runner.service.spec.ts --runInBand --forceExit --silent` — pass, 5 suites, 127 tests, exit 0. The runner spec file was passed instead of the whole `helpers` directory.
- `npx jest -c libs/backend/skill-synthesis/jest.config.ts libs/backend/skill-synthesis/src/lib/lanes --runInBand --forceExit --silent` — pass, 8 suites, 283 tests, exit 0.
- `npx tsc -p libs/backend/skill-synthesis/tsconfig.lib.json --noEmit` — exit 0.
- `npx tsc -p libs/backend/agent-sdk/tsconfig.lib.json --noEmit` — exit 0.
- `npx eslint` on the changed files — exit 0. One warning, pre-existing: `lane-runner.service.ts:499` `no-useless-assignment` on `let text = ''`.
- `npx prettier --check` — fail on two files, then `prettier --write` on those two, then `--check` pass.

### Contract after round 1

```ts
interface ModelDispatchRoute {
  resolvedProviderId: string;
  component: 'memory-curator' | 'skill-lane';
  laneId: string;
}
interface ModelDispatchProvenance extends ModelDispatchRoute {
  resolvedModelId: string;
}
interface ModelDispatchProvenanceTap {
  onModelDispatched(provenance: ModelDispatchProvenance): void | Promise<void>;
}
const MODEL_DISPATCH_PROVENANCE_TAP = Symbol.for('PtahModelDispatchProvenanceTap');
```

Injected only on `SdkQueryRunner`, optional. No route or no tap: no notification, and `queryFn` is unchanged.

## Round 2 fixes

Findings 1 and 2 are fixed with one design change. Findings 3–5 stay as they were: the tap still reports `options.model`, still runs from `queueMicrotask`, and still uses the one public contract. Sections above this one describe the earlier drafts. This section is the contract that the code now implements.

Curator and lane runner no longer call `activeProviderId()` or `resolveActiveAuth()`. They pass only inert route metadata:

```ts
interface ModelDispatchRoute {
  component: 'memory-curator' | 'skill-lane';
  laneId: string;
  providerSource: 'override' | 'ride-active';
  overrideProviderId?: string;
}
```

An override sets `providerSource: 'override'` and `overrideProviderId` (curator: the configured provider on the auth decision; lane: `lane.config.provider`). Ride-active sets `providerSource: 'ride-active'` and no provider id. The model argument is still the tier alias. The auth snapshot is still passed by reference. Cooling-down and lane stalls still return before `execute`.

`SdkQueryRunner` calls `scheduleProvenance` at the end of `buildOneShotOptions`, after module load and capability policy, with the same `authEnv` and `resolvedModel` just written onto the SDK options. The first statement returns when `this.provenanceTap` or the route is missing, before any provider derivation. With a tap, an override uses `overrideProviderId`; ride-active uses `getActiveProviderId(authEnv) ?? ANTHROPIC_DIRECT_PROVIDER_ID` (`'anthropic'`). That pair is snapshotted with `component` and `laneId`, then notified from `queueMicrotask`. Sync throws and rejected promises still log `[model-dispatch] provenance tap failed`.

No tap means no extra provider read, no new warning, and no extra await. `getActiveProviderId` inside the identity prompt is the pre-existing one-shot work and is not gated on the tap.

### Tests

- Curator and lane specs: ride-active and override routes are metadata only, and a `resolveActiveAuth` spy that is not injected is never called. Cooling-down and auth-unresolvable still do not execute.
- Runner, both `memory-curator` and `skill-lane`: (a) no tap, ride-active routes, `resolveActiveAuth` not called and no provenance warning; (b) ride-active with a codex placeholder env, tap provider equals `getActiveProviderId` of the env on the SDK options (`openai-codex`); (c) the injected auth env changes inside `getQueryFunction` from Anthropic direct to codex, then to openrouter, and the tap reports those later providers; (d) override routes report `openai-codex` / `gpt-5.6-terra` and `openrouter` / `gpt-router-1` even when the injected auth env is mutated to a different provider during setup. The 40ms blocked tap still records `execute` then `tap`.

### Checks (round 2)

- `npx jest -c libs/backend/agent-sdk/jest.config.ts libs/backend/agent-sdk/src/lib/curator-llm-adapter libs/backend/agent-sdk/src/lib/helpers --runInBand --forceExit --silent` — exit 0. `Test Suites: 1 skipped, 98 passed, 98 of 99 total`. `Tests: 1 skipped, 2097 passed, 2098 total`.
- `npx jest -c libs/backend/skill-synthesis/jest.config.ts libs/backend/skill-synthesis/src/lib/lanes --runInBand --forceExit --silent` — exit 0. `Test Suites: 8 passed, 8 total`. `Tests: 282 passed, 282 total`.
- `npx tsc -p libs/backend/agent-sdk/tsconfig.lib.json --noEmit` — exit 0.
- `npx tsc -p libs/backend/skill-synthesis/tsconfig.lib.json --noEmit` — exit 0.
- `npx eslint` on the changed files — exit 0. One warning, pre-existing: `lane-runner.service.ts:485` `no-useless-assignment` on `let text = ''`.
- `npx prettier --check` failed on `model-dispatch-provenance.ts` and `sdk-query-runner.service.spec.ts`, then `prettier --write` on those two, then `--check` passed.

### Decisions

The provider id is derived only in the runner, from the auth env object spread into `options.env`, and only after the tap check. A change to active auth during `getQueryFunction` or capability-policy resolution is the auth the SDK dials, so it is the auth the tap names. Override does not re-derive. `resolvedModelId` is still `options.model` from `resolveModelId(input.model, input.auth?.env)`.

The lane suite is 282 tests. The spec that expected a throwing `resolveActiveAuth` to be swallowed was removed with that read. The helpers directory was run in full. No bench. No commit.
