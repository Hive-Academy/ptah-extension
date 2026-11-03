# Code Logic Review - TASK_2026_714_c8a2, Batch 9b-1

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVE |
| Blocking issues | 0 |
| Serious issues | 0 (one latent cross-batch risk recorded as Moderate-H, see below) |
| Moderate issues | 2 |
| Failure modes found | 2 |

Scope: whole read of `workspace-provider-profile-resolver.ts` lines 100-305, spec lines 780-963 (new/changed region), and the 4-file diff. Grep of all `resolveExecutionProfile` / `shouldStartNativeCodex` / `nativeCodex` / `RuntimeConsumer` users across the worktree. No checks were run (instructed).

## Five logic questions

1. Silent failure: none introduced. The gateway branch fails closed (`=== true`, so undefined or a truthy non-boolean never opens it); lane is hard-false; the exhaustive `never` switch (resolver.ts:294-297) makes a new `RuntimeConsumer` a compile error rather than a silent default. The `default` branch returns a `never` as boolean, which type-checks.
2. Unexpected user action: a gateway message on a Codex workspace with only `nativeCodex: true` now goes to the Claude path where it was native before. That is the design (P9-1: "capability off = legacy path") and no current caller passes `gateway` (see Q4 caller audit), so no user path changes today.
3. Wrong answer from data: none. Provider lookup is still short-circuited when the capability is false (`capability && ...`), verified by the `readsActiveProvider:false` cases (spec ~ 905-960).
4. Dependency failure: unchanged. `resolveActiveAuthForPath` is only reached when the capability is on, same as before.
5. Missing: resume capability is not consumer-aware (Moderate-H below); `RoutingAgentAdapter` still gates on `nativeCodex` only (expected in a later batch).

## Failure modes

### Gateway resume of a native thread under a gateway-only capability

- Trigger: host sets `nativeCodexGateway: true` with `nativeCodex: false` (the spec itself uses this combination, spec ~883), and a gateway turn resumes a session whose `existingIdentity.runtime === 'codex-app-server'`.
- Symptom: `AuthRequiredError('This session requires a host with native Codex support.')`.
- Evidence: resolver.ts:191-196 checks `hostCapabilities.nativeCodex` regardless of `input.consumer`.
- Current handling: throws. Start path was made consumer-aware (:282-304), resume path was not.
- Recommendation: before 9b-6 (gateway resume), either guarantee `nativeCodexGateway` implies `nativeCodex` in `createElectronCodexRouting` and document it on the type, or make the resume check use the same per-consumer capability. Add a spec for it. Not a regression in this batch (no gateway caller exists) and the task brief says resume must remain unaffected by consumer: confirmed, `startNative = !existingIdentity && ...` (:197) and resume seed behaviour are untouched, and `consumer` only flows into the seed (:260).

### RoutingAgentAdapter disagrees with the resolver until its batch lands

- Trigger: gateway-only capability.
- Evidence: routing-agent-adapter.ts:94,100,112 read `capabilities.nativeCodex` only.
- Symptom: resolver says native, adapter says Claude (or vice versa) for a gateway turn.
- Recommendation: covered by P9-1 (adapter reads consumer); confirm in the later batch, not here.

## Blocking issues

None.

## Serious issues

None attributable to this batch.

## Moderate and minor issues

- Moderate: resume capability check not consumer-aware (above), resolver.ts:192.
- Moderate: `nativeCodexGateway` has no stated relation to `nativeCodex` (session-runtime.types.ts:37-44); the resume throw makes the implied relation load-bearing.
- Minor: `consumer?` on start/resume configs is typed `'chat'|'gateway'` but `ExecutionProfileRequest.consumer` stays a required `RuntimeConsumer` (resolver.ts:122); the chat service passes a literal `'chat'` (chat-runtime-profile.service.ts:134), so absent=chat is not enforced here yet. Later batches must default `?? 'chat'` explicitly.

## Caller audit (behaviour change for existing paths)

- `resolveExecutionProfile` non-spec callers: only `chat-runtime-profile.service.ts:129`, passing `consumer: 'chat'` with `hostCapabilities` (:107, :135). Chat uses `nativeCodex` exactly as before. Result: main chat unchanged.
- `shouldStartNativeCodex` is private; sole caller is resolver.ts:197.
- Lane: codex-lane-profile.ts does not use the resolver (per brief; grep found no other consumer of the resolver in cli-agent-runtime). No path relied on gateway/lane being native via `nativeCodex`.
- Claude behaviour: the Claude result branch (:269-279) is untouched.
- Other test doubles construct `{ nativeCodex: ... }` only; the new field is optional so all compile.

## Circular import

`agent-adapter.types.ts:22` imports type-only from `./session-runtime.types`. Grep of `libs/shared/src/lib/types` shows session-runtime.types.ts does not import agent-adapter.types (only payload-map.ts and session-runtime.schemas.ts touch session-runtime). No cycle; the import is `import type`, so it is erased at runtime anyway.

## Spec coverage after the narrowing

The parameterized test (spec :847) now covers `['chat']` only, with the full credential-free assertions (no buildProfile/acquire/configureAuthentication, env unchanged). The dropped cases are replaced:

- gateway native seed with `{nativeCodex:false, nativeCodexGateway:true}`: spec :877-899, full seed `toEqual` including `consumer:'gateway'`. Equivalent to the dropped gateway expectation, and stronger (proves it is not driven by `nativeCodex`). It does not repeat the "no materialization / env unchanged" assertions that the dropped gateway row had; minor gap, acceptable since the same code branch is exercised.
- gateway stays Claude with only chat capability (:904-909 case 1), chat stays Claude with only gateway capability (case 2), lane stays Claude with both capabilities on (case 3, replaces the dropped lane-native expectation), gateway on non-Codex provider (case 4). Each asserts exact Claude result, legacy resolver call, and whether the active provider was read.
- Not covered: gateway with capability absent entirely (`hostCapabilities: {nativeCodex:true}` covers it, since `nativeCodexGateway` is undefined there: yes covered by case 1). `nativeCodexGateway:false` explicit is equivalent. Resume with gateway consumer is not covered (see failure mode 1).

Coverage was not weakened; the lane "never native" invariant is asserted.

## Data flow

1. Caller passes consumer + hostCapabilities: OK (only chat today).
2. Resume check (:191-196): consumer-blind, see Moderate.
3. startNative gate (:197, :282-304): OK, fail-closed, short-circuits provider lookup.
4. Seed carries `consumer` (:260): OK.
5. Claude fallback (:269-279): unchanged.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| consumer on start/resume configs, absent=chat | COMPLETE (types) | default not enforced anywhere yet, later batches |
| nativeCodexGateway optional, absent=false | COMPLETE | |
| chat->nativeCodex, gateway->gateway flag, lane->false | COMPLETE | |
| Resume unaffected by consumer | COMPLETE (start gate), PARTIAL for capability check | :192 consumer-blind |
| Main chat / Claude unchanged | COMPLETE | |

Implicit requirements not addressed: relation between the two capability flags; routing adapter parity (later batch).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| gateway flag undefined | YES | `=== true` | none |
| both flags, lane | YES | hard false | none |
| gateway, non-Codex provider | YES | provider check retained | none |
| new RuntimeConsumer value | YES | `never` exhaustiveness | none |
| gateway resume native with gateway-only flag | NO | throws AuthRequiredError | fix before 9b-6 |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH (small diff, full callers audited; unverified by execution per instructions)
- Top risk: gateway-only capability makes resume of a native thread throw because the resume guard reads `nativeCodex` only (resolver.ts:192).
- What a robust implementation would add: make the resume guard consumer-aware or document/enforce `nativeCodexGateway => nativeCodex`, plus a resume spec for the gateway consumer; an explicit `?? 'chat'` default at the config-to-request boundary.
