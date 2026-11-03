# Code Logic Review P5b (Batch DS1) - TASK_2026_714_c8a2

Range: 22f44920a..0541f372b. Score 8/10. Verdict: APPROVED. Blocking 0, Serious 0, Moderate 2, Minor 1.

No TODO/PLACEHOLDER/STUB markers, empty bodies, mock data or log-only implementations found. I did not rerun tests (the report shows 17 suites / 784 tests passing under the verify lock).

## R7-1 packaged-build leakage: holds in this lib

- `codex-dev-route.ts:9-14`: returns null unless `isPackaged === false` (strict `!== false`, so `undefined`, `null`, `0` and a missing field at runtime all return null) and `env['PTAH_CODEX_RUNTIME_DEV'] === '1'` exactly. No trimming or truthiness. The result is frozen (`:16`).
- The module has no imports, no `process` access and no I/O. The env snapshot is whatever the host passes, so it cannot be mutated after the read. Timing is the host's call.
- `codex-dev-route.spec.ts:16-40` covers packaged with 7 switch values, and unpackaged with 6 non-matching values. It does not test `isPackaged: undefined` through a cast (Minor, M1).
- Host differences: nothing in `apps` or `libs` calls the reader yet (grep shows only the barrel export). So no host can enable the override today, and VS Code, CLI and TUI cannot enable it by accident. Hosts that never pass `devRoute` register a null factory (`registration.ts:51-60`).
- Residual risk (M2): the safety of a real host depends on Batch 8a passing the true `app.isPackaged`. A non-Electron host that hardcodes `isPackaged: false` would enable it. 8a must pass `app.isPackaged` verbatim and only the Electron composition may call the reader. Re-review at 8a.

## R7-2 gateway and lane stay blocked: holds

- `registration.ts:116-125`: with the gate disabled, the override is resolved only when `consumer === 'chat'`, and it requires `devRoute?.consumer === 'chat'`. Gateway and lane get `null` and throw the original error. The gate is never mutated.
- `codex-parity-gate.ts:187,216`: `enabled: false` is still a literal type and value.
- `codex-gateway-adapter.ts:55` checks `new CodexParityGate().isEnabled('gateway', ...)` before it registers or resolves anything, and `:59` calls the resolver with `'gateway'`. Spreading a `devRoute` in the ports cannot reach it. The extra `devRoute` property that reaches `new CodexRuntime(ports)` is ignored.
- `registration.spec.ts` asserts `enabled:false` for all three consumers, gateway and lane throwing before and after the chat resolve, and no spawn.

## WeakSet warning

- `registration.ts:105,126-131`: the module-level `WeakSet<DependencyContainer>` is keyed by the container, so each container warns exactly once and disposed containers are not retained. The warning is added after the `warn` call, so a throwing logger would retry next time. That is acceptable.
- The warning is per container, not per runtime. A child container registers its own override and warns once. This matches the stated requirement.

## Optional port

- `registration.ts:51-60`: `ports.devRoute ?? null` means omitted or null registers `() => null`, so chat is blocked. The explicit branches avoid the tsyringe TS2769 overload error. OK.

## Findings

- M1 (Moderate, test gap): `codex-dev-route.spec.ts` does not cover `isPackaged` undefined or missing, which is the exact R7-1 failure mode. The implementation is correct. Add a case that casts `{ env: { PTAH_CODEX_RUNTIME_DEV: '1' } } as never` and expects null.
- M2 (Moderate, deferred to 8a): no host wiring exists yet, so the "never in a packaged build" guarantee is only proven at the reader boundary. Verify in 8a review that the Electron composition passes `app.isPackaged` and that no other host passes `devRoute`.
- m1 (Minor): the `container.resolve` generic for `DevRouteOverride` at `registration.ts:118-122` trusts the registration. If a host registers the runtime without `registerCodexRuntime`, resolution throws a tsyringe error instead of the gate error. This is fail-closed, so it is acceptable.

## Five questions (short)

1. Silent failure: none. A disabled switch throws the gate error, and an enabled switch logs a warning.
2. Unexpected user action: setting `PTAH_CODEX_RUNTIME_DEV=1` in a packaged app has no effect. `true`, `1 ` and `0` are rejected.
3. Wrong-answer input: none found.
4. Dependency failure: a missing logger or override token throws, which fails closed.
5. Missing: the `undefined` isPackaged test and the host wiring checks (M1, M2).
