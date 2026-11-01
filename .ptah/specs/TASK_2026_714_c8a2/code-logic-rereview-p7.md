# Code Logic Re-review — `TASK_2026_714_c8a2` — P7 fix batch 7d

Range: `74d66ede0..f57e381f9` (4a2f15579 7d.1, 6a1ed5cbe 7d.2, f57e381f9 di-lint).
Prefixes: `R` = `libs/backend/rpc-handlers/src/lib/`, `A` = `libs/backend/agent-sdk/src/lib/`.
Findings under review: `code-logic-review-p7.md`. Decisions: `decisions.md:201-208`.

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 7/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 5        |
| Failure modes found | 6        |

Why 7 and not 5-6: both blocking findings are closed on the real code paths. The B1 regression
spec now runs the real `ChatRuntimeProfileService.prepare` and the real
`WorkspaceProviderProfileResolver.resolveExecutionProfile`. The B2 fallback reproduces main's
save-only behaviour for sessions that are not live. On the default path the Claude flow is
unchanged: the router and the routing adapter are null, the `runtime` marker is ignored by
`SdkAgentAdapter`, and notices are gated to `codex-app-server`. Why not 8: five moderate gaps
remain. One is new in 7d: a notice broadcast that fails after a successful launch strands the
stream. The others are an effort divergence after a failed save, which is new against main on
the Claude fallback; message-text matching for "not live"; marker routing that skips the
capability gate; and a native persistence contract that is not yet among 8a's acceptance items.

## Finding status

| Finding | Status | Evidence |
| ------- | ------ | -------- |
| B1 legacy resume/slash inferred native | RESOLVED | `R/chat/session/chat-runtime-profile.service.ts:42-58` builds the same identity as `A/wiring/session-runtime-identity-cache.ts:44-50`, including `claude-cli` and the metadata workspace. Resume passes it at `R/chat/session/chat-session.service.ts:1672-1676` and slash at `R/chat/session/chat-slash-command-router.service.ts:315-319`. So `startNative = !existingIdentity && …` (`libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts:162`) is false for every stored row. Metadata-absent rows also stay on Claude. The spec uses the real path (see below). |
| B2 non-live config rejected | RESOLVED (fragile detection) | `R/handlers/config-runtime-controls.ts:18-28` returns `false` for `SdkError` matching `^session (not found\|query not initialized)(:\|$)`. The messages come from `A/helpers/session-lifecycle/session-control.service.ts:494-501,537-544,581-588`. `saveFallback` (`R/handlers/config-rpc.handlers.ts:705-727`) then saves without rollback. Model `:206-215`, effort `:743-751`, autopilot `:351-380`. |
| S1 runtime chosen twice | RESOLVED, with a gap (Moderate) | Marker at `libs/shared/src/lib/types/agent-adapter.types.ts:178-179`; passed at `R/chat/session/chat-session.service.ts:945`; checked at `A/codex-app-server/routing-agent-adapter.ts:90-102`; coded error at `:12-19`. Gap: when admission returns `undefined` the marker is trusted, and `capabilities.nativeCodex` is not checked (FM-R3). |
| S2 double persistence | RESOLVED for legacy; native deferred to 8a | Bound path: the RPC makes no write (`config-rpc.handlers.ts:206-207,351-355,743-744`). Options reach the port: `A/codex-app-server/session-runtime-router.ts:29-60` and `A/codex-app-server/legacy-session-controls.ts:86-88,100,109-111,123,136-138,151`. Rollback stays inside `commit` (`:182-202`), and the RPC adds nothing after a rejection. |
| M1 live value after failed save | PARTIAL | Model: snapshot `config-rpc.handlers.ts:209`, restore `:213`. Effort: no snapshot (`:746-750`). On a live session the effort is applied, the save fails, and the session keeps the new effort while the RPC rejects (FM-R2). |
| M2 permission rollback | PARTIAL (accepted limit) | The original error is rethrown (`:366-376`). Restore failures are logged (`:371-374`). The live permission is restored from `lifecycle.permissionLevel` (`:357,378`). Still open: `getWithDefault` values are written back as explicit values (`:358-359`), so the scope can drift. This is recorded in `batches.md` 7d open items. |
| R7-4 notice | RESOLVED, one new gap | The notice is published only after the adapter call (`chat-session.service.ts:949-954,1692-1700`; `chat-slash-command-router.service.ts:396-403`). Native `/compact` returns first (`:357-366`). The filter for empty, `default` and unchanged models, and the one-shot WeakSet, are at `chat-runtime-profile.service.ts:62,126-134`. New gap: a broadcast failure strands the stream (FM-R1). |
| di-lint `RUNTIME_HOST_CAPABILITIES` | RESOLVED | A literal `container.register` sits inside the `isRegistered(…, true)` guard (`A/di/register.ts:990-995`). It runs once per container. The provider closes over one `{ nativeCodex: false }` object (`A/wiring/codex-runtime-composition.ts:12-20`), so the `unstable-binding` guard (`:34-43`) and the default-resolution WeakSet (`:46-55`) behave as before. No other caller of the removed helper exists (grep). |

### Spec realism

- B1: `R/chat/session/chat-session.native.spec.ts:218-256` builds a real `ChatRuntimeProfileService` over a `WorkspaceProviderProfileResolver` prototype. It sets `resolveActiveAuthForPath → openai-codex` and `nativeCodex: true`, and stubs only `resolveProviderProfileForWorkspace`. It asserts the claude identity, the provider profile, the Claude model and that nothing is broadcast. This would have caught B1. The same pattern is used in the slash spec (`chat-slash-command-router.native.spec.ts:234`).
- B2: the specs throw a real `SdkError` but write the message text themselves (`config-rpc.handlers.spec.ts:737,1215-1216`; `config-runtime-controls.spec.ts` "query not initialized"). They do not drive the real `SessionControl`. If `SessionControl`'s wording changes, B2 regresses silently and these specs still pass. The negative case, a plain `Error` with the same text that must still reject, is covered.
- S2 bound: `config-runtime-controls.spec.ts` "writes each setting exactly once (bound=true)" uses a runtime mock that performs the write itself. That proves the RPC does not write; it does not prove an end-to-end single write. The legacy-controls spec (`legacy-session-controls.spec.ts`, "owns scoped persistence exactly once") covers the other half against the real `LegacySessionControls`. No spec combines the real router, the real legacy controls and the RPC. That is acceptable until 8a supplies a real persistence port.

## Task answers

**2. B2 equivalence with main.** On main (`74d66ede0~4`, `config-rpc.handlers.ts:203-215,353-377,725-740`) the handler saved first, then applied live and swallowed every sync error. Now, for a session that is not live, the apply returns `false` before any call to the query, and the save is identical: same values, same `applyTo`, same two autopilot keys. `permissionHandler.setPermissionLevel` still runs after success (`:381`). So history and ended tabs save exactly as on main. This change is deliberate: a real failure to apply on a live session now rejects without saving, where main saved. This follows P7 fix 2.
Fragility: `SdkError` has no code (`A/errors/sdk.error.ts:15-30`). The match relies on the message prefix that seven throw sites share. Typed options are available. (a) The RPC already holds `this.lifecycle` (`config-rpc.handlers.ts:100`): `this.lifecycle?.find(id)?.query` is the same probe the bound controls use (`legacy-session-controls.ts:86`). (b) Better: add `SessionUnavailableError extends SdkError` with `code: 'session-unavailable'` in `session-control.service.ts`, and match the class.

**3. S1 marker.** The Claude default path does not need the marker. `ROUTING_AGENT_ADAPTER` is null unless identities, native and admission are all bound (`A/di/register.ts:1048-1058`). `SdkAgentAdapter.startChatSession` reads only named fields, so `runtime` is inert. A mismatch throws `runtime-admission-mismatch` before either adapter starts (spec `routing-agent-adapter.spec.ts`, "rejects prepared … conflicting"). When a prepared runtime is present and admission returns no provider, the marker decides with no check (`routing-agent-adapter.ts:97`). For `claude-sdk` that matches the old default. For `codex-app-server` it routes native even if `this.capabilities.nativeCodex` is false. Today both sides read the same token, so this cannot happen. But it removes a gate the old branch had (`:105-107`). See FM-R3.

**4. S2.** Bound: exactly one write, through the port, with `{ applyTo }` for model and effort and `{ applyTo: 'global', autopilot: { enabled, permissionLevel } }` for permission. Spec: "preserves a disabled autopilot selection". The non-live bound path saves only (`legacy-session-controls.ts:86-88`). A rejected save propagates from `commit` after the controls' own rollback, and the RPC does nothing after that. Unbound: one write through `saveFallback`. Calls without options (slash) keep the strict `session-unavailable` contract.

**5. di-lint.** Resolved; see the table. The registration is guarded, it is single, and the default is unchanged.

**6. Regressions added by 7d.** Claude default path: no behavioural change except the deliberate one in Q2. Native-only (off until 8a): FM-R1. Claude fallback: FM-R2. That one is new against main, where a failed save never applied the live value. 7c introduced the apply-first order and 7d kept it.

**7. Deferred items and 8a contracts.** The deferrals are defensible: cancel during prepare (pre-existing), FM8, uncoded refusals, `mcpServersOverride` hygiene, and the #826 merge rules. The native persistence gap is safe today, because `NATIVE_SESSION_CONTROLS` defaults to null, so `SESSION_RUNTIME_ROUTER` is null (`A/di/register.ts:1001-1034`). Once 8a binds it, the RPC writes nothing for native sessions (`config-rpc.handlers.ts:206-207`). If 8a binds the raw native setters, model, effort and autopilot changes for native tabs save nothing and report success. The contract is written in `batch-7d-b-report.md` ("8a persistence contract") and in the 7d open items of `batches.md`. It is not in Batch 8a's Details or Acceptance list. No production `LegacySettingsPersistence` exists yet either (grep: only the interface and the composition type).

**8. Markers.** None found in the diff: no TODO, PLACEHOLDER or STUB, no empty bodies, and no logging standing in for logic. The only "warn instead of act" is the documented effort/unknown-snapshot case in `saveFallback` (`:722`). There the RPC still rejects; it does not report success.

## Five logic questions

### 1. How does this fail silently?

- After 8a, if native controls are bound without persistence, a native tab's model, effort or autopilot change returns success and saves nothing (`config-rpc.handlers.ts:206-207,351-355,743-744`; contract only in reports).
- If `SessionControl`'s "Session not found" wording changes, non-live saves start rejecting. That one is not silent, but the specs would not catch it (they write the text themselves).

### 2. What user action produces unexpected behaviour?

- The user changes effort on a live Claude tab while the settings write fails. The selector rolls back, and the session keeps the new effort (`config-rpc.handlers.ts:746-750`). On main the live value was never applied in that case.

### 3. What input data produces a wrong answer?

- A prepared `codex-app-server` marker with admission `undefined` and `nativeCodex: false` routes native (`routing-agent-adapter.ts:97-102`). It is unreachable while both sides read one token.
- Permission restore writes resolved defaults as explicit values (`config-rpc.handlers.ts:358-359,368-369`), so the scope can drift (accepted M2 limit).

### 4. What happens when a dependency fails?

- A notice broadcast that rejects after `startChatSession`, `resumeSession` or `executeSlashCommand` succeeded: the error propagates and `streamEventsToWebview` is never called. A native thread is now open with no consumer, and the next launch on that tab is refused as `busy` (`chat-session.service.ts:943-960,1686-1706`; `chat-slash-command-router.service.ts:368-404`).
- A failed restore write: it is logged, and the original error is kept (`config-rpc.handlers.ts:367-375,717-719`). Correct.

### 5. What is missing that the requirements never mentioned?

- A typed "session unavailable" signal from `SessionControl`.
- An 8a acceptance check that native config changes persist exactly once.
- A capability check on the marker branch.

## Failure modes

### FM-R1 — Stream stranded when the notice broadcast fails (new in 7d)

- Trigger: native launch with a substitution; `webviewManager.broadcastMessage` rejects.
- Symptom: the RPC reports an error; the thread runs unconsumed; retries are refused as `busy`.
- Evidence: `chat-session.service.ts:949-960`, `:1692-1706`; `chat-slash-command-router.service.ts:396-404`; the broadcast awaits at `chat-runtime-profile.service.ts:158-163`.
- Current handling: none. Native is off by default, so the risk is in 8a.
- Recommendation: attach the stream regardless. Wrap the publish in try/catch and log it, or publish in a `finally` after `streamEventsToWebview`.

### FM-R2 — Live effort diverges after a failed save on the Claude fallback

- Trigger: `config:effort-set` on a live session; `reasoningSettings.effort.set` rejects.
- Symptom: the UI rolls back and the session keeps the new effort.
- Evidence: `config-rpc.handlers.ts:746-750`, `:720-723`.
- Recommendation: for effort in the fallback, save first and then apply. On a real apply failure, restore the persisted previous value (read with `reasoningSettings.effort.get` before the save). Alternatively track live effort in `SessionControl`.

### FM-R3 — Marker routing bypasses the capability gate

- Evidence: `routing-agent-adapter.ts:90-102`.
- Recommendation: throw `ChatRuntimeAdmissionError` when `preparedRuntime === 'codex-app-server'` and either `!this.capabilities.nativeCodex` or `provider === undefined`, so a native launch fails closed. A `claude-sdk` marker with `undefined` may keep routing to legacy.

### FM-R4 — "Not live" detection relies on message text

- Evidence: `config-runtime-controls.ts:24`.
- Recommendation: use a typed `SessionUnavailableError`, or probe `this.lifecycle?.find(id)?.query`. Add one spec that drives the real `SessionControl`.

### FM-R5 — Native persistence contract not in 8a acceptance

- Evidence: `batches.md` Batch 8a lists no config-persistence check; the contract lives in `batch-7d-b-report.md` and the 7d open items.
- Recommendation: add to 8a's acceptance list: native and legacy config changes persist exactly once, including non-live save-only; and `LegacySettingsPersistence` honours `applyTo` and the autopilot pair and restores partial writes.

### FM-R6 — Permission restore scope drift (carried M2)

- Evidence: `config-rpc.handlers.ts:358-359`. Accepted and recorded; no new action in 7d.

## Blocking issues

None.

## Serious issues

None. FM-R1 leaks a resource, but only when a webview broadcast fails, which is improbable, and only on a native path that is off until 8a. It is therefore rated Moderate.

## Moderate and minor issues

- Moderate FM-R1: `chat-session.service.ts:949-960,1692-1706`; `chat-slash-command-router.service.ts:396-404`.
- Moderate FM-R2: `config-rpc.handlers.ts:746-750`.
- Moderate FM-R3: `routing-agent-adapter.ts:97-102`.
- Moderate FM-R4: `config-runtime-controls.ts:24`.
- Moderate FM-R5: `batches.md` Batch 8a.
- Minor: `runtime-admission-mismatch` is not in `libs/shared/src/lib/types/rpc/rpc-error-codes.types.ts`. The chat start surfaces it as message text only.
- Minor: the model rollback snapshot (`config-rpc.handlers.ts:209`) is read without serialization. Two overlapping switches where the second save fails can restore the first switch's predecessor. The bound controls serialize this (`legacy-session-controls.ts:204-218`).

## Data flow

1. Config RPC → `parseApplyTo` → bound? The router and identity choose the controls, and the controls apply, save once and roll back themselves: OK (legacy); native pending in 8a (FM-R5).
2. Unbound → `configRuntimeControls(null)`: not live → `false` → one save: OK (FM-R4 fragility). Live → apply → save → rollback: model OK, permission OK, effort gap (FM-R2).
3. Chat start → `prepare` → marker → routing adapter checks admission → adapter: OK (FM-R3 gap) → publish (FM-R1) → stream attach.
4. Resume/slash → `storedChatRuntimeIdentity` → `prepare` (Claude branch for every stored non-native row): OK → adapter → publish (FM-R1) → stream.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| P7 fix 1 (B1) | COMPLETE | — |
| P7 fix 2 (B2) | COMPLETE | detection by message text |
| P7 fix 3 (S1) | COMPLETE | capability/undefined fail-open on codex marker |
| P7 fix 4 (S2) | COMPLETE (legacy) | native persistence owned by 8a, not in 8a acceptance |
| P7 fix 5 (notice) | COMPLETE | broadcast failure strands stream |
| P7 fix 6 (permission rollback) | COMPLETE | scope drift (accepted) |
| P7 fix 7 (moderates listed) | COMPLETE | — |
| P7 fix 8 (#826 rules recorded) | COMPLETE | — |
| Claude default path unchanged | COMPLETE | deliberate reject-on-real-live-failure; effort FM-R2 |

Implicit requirements not addressed: a typed session-unavailable error; an RPC code for the admission mismatch.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| History tab model/effort/autopilot | YES | `SdkError` → save-only | text match |
| Idle record without query | YES | "query not initialized" → save-only | — |
| Record with dead query | NO (rejects) | real apply failure | per P7 fix 2; main saved |
| Metadata absent on resume/slash | YES | `claude-cli` identity | — |
| Admission undefined + codex marker | PARTIAL | marker trusted | FM-R3 |
| Busy second launch | YES | adapter rejects before publish | — |
| Broadcast failure post-launch | NO | — | FM-R1 |
| Effort save failure live | NO | warn + reject | FM-R2 |
| Bound legacy non-live | YES | save-only with options | — |
| Bound native | DEFERRED | 8a | FM-R5 |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for B1, B2, S2 and di-lint (code read in full and the real-path specs checked); MEDIUM for the notice and admission edges (not executed).
- Top risk: 8a binds native controls without persistence, and native config changes then report success while saving nothing.
- What a robust implementation would add: a typed `SessionUnavailableError`; a capability check and fail-closed handling of `undefined` admission for the codex marker; stream attach that does not depend on the notice broadcast; save-first ordering for effort in the fallback; an explicit 8a acceptance item for exactly-once native and legacy persistence; one spec over the real `SessionControl`.

## Decisions

- Rated FM-R1 Moderate rather than Serious. Options: Serious (leaked resource) or Moderate. Evidence: native is off by default (`A/di/register.ts:1001-1034`), and a failed webview broadcast is an improbable trigger. Reversible: yes, and 8a should fix it before it enables native.
- Rated FM-R2 Moderate. It is a divergence from main on the Claude path, but only when a settings write fails (full disk or a lock).
