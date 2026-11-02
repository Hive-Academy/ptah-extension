# Code Logic Review — `TASK_2026_714_c8a2` — Phase P7 (Chat RPC)

Range: `b7f936961^..cbbb8a337` (7a `b7f936961`, 7c `d9e9956c3`, 7b `cbbb8a337`).
Prefix `R` = `libs/backend/rpc-handlers/src/lib/`.

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 4/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 2              |
| Serious issues      | 2              |
| Moderate issues     | 6              |
| Failure modes found | 10             |

Why 4 and not 5-6: the change has two defects that block it. Each produces a wrong result on a path users take, not an edge case. B2 breaks the Claude default path today: you cannot change model, effort or permission on a tab whose session is not running. B1 resumes a legacy Claude session with a Codex model id and without its isolated provider profile once 8a turns `nativeCodex` on. Why not 3: the native seam itself is sound. Authorization runs before the resolver, the seed carries no credentials, native `/compact` fails closed, and each launch publishes exactly one notice. The fixes are local.

No TODO, PLACEHOLDER or STUB markers, empty bodies or mock data in place of logic (grep of the five source files). Tests were not re-run; the specs mock `prepare()`, so they do not exercise the resolver interplay behind B1.

## Five logic questions

### 1. How does this fail silently?

- B1: a legacy session is resumed after its workspace switched to Codex. The RPC treats the resume as a fresh native start (`R/chat/session/chat-session.service.ts:1668-1672` passes `codexExecution`, which is `undefined` for legacy rows). The legacy SDK then receives `model: seed.model` (a Codex id) and no `providerProfile` (`:1690-1695`). Meanwhile `RoutingAgentAdapter.resumeSession` routes by the stored identity to the legacy adapter (`libs/backend/agent-sdk/src/lib/codex-app-server/routing-agent-adapter.ts:87-91,186-194`). The resume "succeeds" on the shared auth env.
- S1: the RPC and the routing adapter choose the runtime independently. When they disagree, the native adapter gets an unsubstituted model, and 8a is forbidden to publish a notice. The result is a silent substitution, the exact thing R7-4 forbids.
- Save after apply: a model or effort save fails after the live apply succeeded. The RPC reports failure and the frontend rolls its selector back (`libs/frontend/core/src/lib/services/model-state.service.ts:226-234`), but the live session keeps the new value (`R/handlers/config-rpc.handlers.ts:206-212`, `:714-722`).

### 2. What user action produces unexpected behaviour?

- B2: the user opens a chat from history, or uses a tab whose session ended, then changes model, effort or autopilot. The frontend sends that tab's `sessionId` (`libs/frontend/chat/src/lib/components/molecules/chat-input/effort-selector.component.ts:306-314`). `SessionControl` throws `Session not found` (`libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts:494-501,537-544,581-588`). The RPC now rejects and saves nothing, the UI rolls back, and Sentry records an exception for each attempt.
- The user runs native `/compact`. A "Model notice" can be published even though compact changes no model (`R/chat/session/chat-slash-command-router.service.ts:353-368`).

### 3. What input data produces a wrong answer?

- A stored or requested model of `default` (the fallback in every caller, and `config.model ?? 'default'` at `R/chat/session/chat-runtime-profile.service.ts:79`) is not a tier and is not in the Codex catalog. So every native launch without an explicit model publishes `requested "default"; using "gpt-…"` (`libs/backend/auth-providers/src/lib/auth/workspace-provider-profile-resolver.ts:258-275`).
- A legacy row (no `codexExecution`) with a Codex-serving workspace: see B1.

### 4. What happens when a dependency fails?

- `prepare()` and resolver failures surface. Start throws to each caller's result shaping (`chat-session.service.ts:645-657`), resume is caught at `:1704-1720`, and slash is caught at `chat-slash-command-router.service.ts:401-421`, which maps `AuthRequiredError`. This part is correct.
- A failed notice broadcast propagates and aborts the launch (`chat-runtime-profile.service.ts:127-132`). That is acceptable under R7-4: no silent launch.
- If the restore writes themselves fail during the permission partial-write rollback, they mask the original error (`config-rpc.handlers.ts:368-375`).
- When the start fails after the notice is published (adapter `busy`, `runtime-failed`, auth), the notice stays in the chat for a launch that never happened (`chat-session.service.ts:925-936`).

### 5. What is missing that the requirements never mentioned?

- The difference between "no live session to apply to" and "the live apply failed" (B2).
- A single owner for the runtime decision at start (S1), and a single owner for settings persistence once `LegacySessionControls` is bound (S2).
- Cancel during `prepare()`: nothing observes `chat:abort` between prepare and launch. This is pre-existing for legacy, and new for the notice.

## Failure modes

### FM1 — Legacy session resumed as native

- Trigger: `nativeCodex: true` (8a, DS1 dev route), a legacy or Claude session, and a workspace whose provider is now `openai-codex`. The path is resume (`chat-session.service.ts:1668-1695`) or slash relaunch (`chat-slash-command-router.service.ts:312-316,370-396`).
- Symptom: the session is resumed on the legacy SDK with a Codex model id, no isolated provider profile, and a spurious notice.
- Evidence: the resolver has `startNative = !existingIdentity && shouldStartNativeCodex` (`workspace-provider-profile-resolver.ts:162`). The RPC passes `metadata.codexExecution`, which is `undefined` for legacy rows. The identity cache synthesizes a `claude-sdk` identity for those rows (`libs/backend/agent-sdk/src/lib/wiring/session-runtime-identity-cache.ts:44-50`), so the router sends the call to legacy. The plan says to never infer the runtime from the current provider (`implementation-plan.md:78`).
- Current handling: none. The specs mock `prepare` (`chat-session.native.spec.ts:141-165`).
- Recommendation: pass the session's resolved identity. When the metadata exists and has no `codexExecution`, pass `{ runtime: 'claude-sdk', providerId, workspaceId, ... }` as in the identity cache, so the resolver takes the legacy branch. Add a spec with a real resolver.

### FM2 — Config change on a non-live session rejected

- Trigger: `config:model-switch`, `config:effort-set` or `config:autopilot-toggle` with the `sessionId` of an idle, history or ended session.
- Symptom: the RPC throws `Session not found`, nothing is saved, the UI rolls back, and Sentry receives noise.
- Evidence: `config-rpc.handlers.ts:206-212,348-353`, and the effort hunk at `:714-722`. In the spec diff, "swallows session-sync failures so the config write still succeeds" became "rejects live apply failures before persisting", with `'session not found'`.
- Current handling: reject.
- Recommendation: when no live session exists (check `isSessionActive`, or map `SdkError` "not found" / `LegacySessionControlError('session-unavailable')`), persist only. Reject only when a real apply fails.

### FM3 — Split runtime decision at start

- Trigger: the RPC resolver (`resolveActiveAuthForPath(config.workspaceId)`) and `admission.servingProviderId(config)` (`routing-agent-adapter.ts:82-85`) disagree.
- Symptom: either the legacy adapter gets a Codex model and no profile, or the native adapter gets a Claude `providerProfile` and an unsubstituted model, with no notice.
- Evidence: the two decisions have no shared state. `config` carries no runtime marker (`chat-session.service.ts:931-936`).
- Recommendation: put the prepared runtime on the start config (or make the admission port read it), and fail on a mismatch.

### FM4 — Double persistence and scope drift once the router is bound

- Trigger: 8a binds `LEGACY_SESSION_CONTROL_PORTS`, so `SESSION_RUNTIME_ROUTER` becomes non-null.
- Symptom: the model is saved twice. `LegacySessionControls.commit` saves through `persistence.saveModel(sessionId, model)` with no `applyTo` (`legacy-session-controls.ts:29-33,109-114`). The RPC then saves again with `applyTo` (`config-rpc.handlers.ts:212`). A default-scope `set` can clear the more specific scope (see the comment at `config-rpc.handlers.ts:282-288`). The controls' save rollback is also bypassed by the second write.
- Recommendation: give persistence one owner. Either pass `applyTo` into the controls' persistence port and drop the RPC save, or bind the legacy persistence port as a no-op and keep the RPC save. Write the chosen contract into batches.md for 8a.

### FM5 — Live value left applied after a failed save

- Trigger: `selectedModel.set` or `effort.set` rejects (full disk, lock).
- Symptom: the UI shows the old value while the session runs the new one.
- Evidence: `config-rpc.handlers.ts:206-212`.
- Judgement: acceptable as a temporary state only for the null-router fallback, where the RPC cannot read the previous live value. It is not acceptable once controls are bound, because `LegacySessionControls` already does apply, save and rollback (`legacy-session-controls.ts:166-186`). Folding persistence into the controls (FM4) fixes both.

### FM6 — Permission rollback fragility

- Evidence: `config-rpc.handlers.ts:354-376`.
- Gaps: a failed restore replaces the original error. `getWithDefault` values are written back as explicit values, which can change the scope. The live permission applied at `:349-352` is not rolled back. `permissionHandler` ordering is correct (it updates only after the save).

### FM7 — Notice for a launch that did not happen, or a spurious notice

- Evidence: the notice is published before `startChatSession` (`chat-session.service.ts:925-936`), before `resumeSession` (`:1681-1695`), and before native compact (`chat-slash-command-router.service.ts:353-368`). It also fires for `default` (Q3).
- Recommendation: publish only when the model actually used differs from the session's current model, and skip it for `/compact`. Map `default` to the Codex default tier in the resolver (P6 owner) without a notice.

### FM8 — Notice `message_complete` reaches the frontend queue logic

- Evidence: `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:508-519`. A top-level `message_complete` with no `stopReason` returns `queuedContent` for dispatch. If a tab holds queued content when a relaunch publishes the notice, the queue may be sent before the real stream starts.
- Residual uncertainty: not reproduced. Verify in 8a, or give the notice its own event type.

### FM9 — #826 merge loses its ordering invariant

- Evidence: #826 computes `currentModel` "after the last await before the profile read". In 7b, `currentModel` sits at `chat-session.service.ts:884`, before the `buildMcpServersOverride` and `outputStyle` awaits and before `prepare` at `:915`. For resume it sits at `:1636`, before the `outputStyle` await at `:1643`.
- Also: `resolveStoredModel` checks the workspace's current provider (#826 resolver hunk), not the session's stored identity. For a native resume after a provider switch, that check is wrong, although harmless because the native resolver always maps to a catalog model.
- Recommendation: when merging, compute `resolveStoredModel` immediately before building `config` in all three places, and apply it only on the legacy branch (or move it into `resolveExecutionProfile`'s legacy branch).

### FM10 — Cancel or concurrent launch during prepare

- Concurrent start and resume on one tab: each publishes its own notice, then the native adapter rejects the second open as `busy` (`codex-chat-adapter.ts:208-209`), and that error surfaces. So the user sees two notices and one error.
- Cancel during `prepare()`: nothing observes it, and the launch proceeds. This is pre-existing for legacy (the old resolver awaited too).

## Blocking issues

### B1 — Legacy session resume and slash infer the native runtime from the current provider

- File: `R/chat/session/chat-session.service.ts:1668-1672`, `R/chat/session/chat-slash-command-router.service.ts:312-316`
- Scenario: FM1.
- Impact: once 8a enables `nativeCodex`, every legacy session in a workspace now served by Codex resumes with a Codex model id, without its provider profile, on the shared auth env. This breaks the P5 rule that a resumed session keeps its stored identity.
- Fix: FM1 recommendation. Spec: a legacy row with no `codexExecution`, workspace provider `openai-codex`, `nativeCodex: true`, and a real `WorkspaceProviderProfileResolver`. Expect the `claude-sdk` branch and `providerProfile` passed.

### B2 — Config RPC rejects model, effort and permission changes for non-live sessions (Claude default path regression)

- File: `R/handlers/config-rpc.handlers.ts:206-212`, `:348-353`, effort hunk `:714-722`
- Scenario: FM2.
- Impact: today, on every host, the user cannot change model or effort from a history tab or an ended tab. The selection silently reverts, and the setting for the next launch is not saved. The requirement that the Claude default path stay unchanged is not met.
- Fix: FM2 recommendation. Restore the "not live → persist only" spec and keep "live apply failed → reject".

## Serious issues

### S1 — Runtime chosen twice at start, with no agreement check

- File: `R/chat/session/chat-session.service.ts:915-936`; `libs/backend/agent-sdk/src/lib/codex-app-server/routing-agent-adapter.ts:82-85`
- Scenario: FM3.
- Impact: a wrong-runtime launch, or a silent model substitution (an R7-4 breach).
- Fix: carry the prepared runtime in the start config, or make the admission port read it; throw on a mismatch.

### S2 — 7c persistence conflicts with the `LegacySessionControls` persistence contract

- File: `R/handlers/config-rpc.handlers.ts:212,362-367`; `libs/backend/agent-sdk/src/lib/codex-app-server/legacy-session-controls.ts:29-33,59,90-95,109-114`
- Scenario: FM4.
- Impact: duplicate writes, wrong-scope persistence, and the controls' rollback is defeated when 8a binds the ports.
- Fix: FM4 recommendation.

## Moderate and minor issues

- M1 FM5: the live value stays applied after a failed save (`config-rpc.handlers.ts:206-212`).
- M2 FM6: permission rollback fragility (`config-rpc.handlers.ts:368-375`).
- M3 FM7: notices published before the launch, on native compact, and for `default` (`chat-session.service.ts:925-936`; `chat-slash-command-router.service.ts:353-359`; `workspace-provider-profile-resolver.ts:258-275`).
- M4 FM8: the notice's `message_complete` versus the queued-content dispatch (`streaming-handler.service.ts:508-519`).
- M5 FM9: #826 merge placement and the stored-model provider check on the native path.
- M6 FM10: concurrent launch and cancel during prepare.
- Minor: when `this.metadata` is absent in the slash router, the identity is `undefined` and a native session is treated as a new start (`chat-slash-command-router.service.ts:315`).
- Minor: `prepare()` refusals are plain `Error`s with no RPC error code (`chat-runtime-profile.service.ts:143-149`), so the frontend cannot tell an authorization refusal from other failures.
- Minor: `chat:start` with no caller path now also requires the host-default root to be inside `getWorkspaceFolders()` (`chat-runtime-profile.service.ts:139-141`, versus the old conditional check at `chat-session.service.ts:538-546`). Low risk on Electron and CLI (`activeFolder ?? folders[0]`).
- Minor: `ResolvedChatExecution.config` carries `mcpServersOverride`, which can hold MCP auth headers. It is not part of the seed, but 8a must not log or fingerprint it.

## Data flow

1. RPC entry (`startSession` / `autoResumeIfInactive` / `routeFollowUpSlashCommand`): authorized folder (resume uses `resolveSessionFolder`). OK.
2. `currentModel`: `params.model || selected || 'default'`. GAP: `default` triggers a notice on native (M3), and the #826 placement (M5).
3. Identity: resume and slash read `metadata.codexExecution`. GAP: legacy rows yield `undefined` (B1).
4. `prepare()`: `authorize(workspacePath)` and `authorize(cwd)` run before `resolveExecutionProfile`. OK (`chat-runtime-profile.service.ts:75-77`).
5. Resolver: the native seed has no credentials, proxy or auth-env work. OK (`workspace-provider-profile-resolver.ts:218-232`). The legacy branch calls the unchanged `resolveProviderProfileForWorkspace`. OK.
6. Notice: exactly one `publishModelSubstitution` per launch (`chat-session.service.ts:929`, `:1685`; `chat-slash-command-router.service.ts:355`). GAP: it is published before the launch succeeds, and on compact (M3).
7. Adapter call: native passes `model: seed.model` and no `providerProfile`; legacy passes `providerProfile`. GAP: the routing adapter decides the runtime again (S1).
8. Native compact: `runtimeControls.compact`; missing controls throw; the reservation is released in `finally`. OK (`chat-slash-command-router.service.ts:360-368,422-438`).
9. Config RPC: apply then save. GAP: non-live session (B2), double persistence (S2), live value left applied (M1).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| R7-4 one visible notice per launch (start, resume, slash) | PARTIAL | Exactly one call per launch path. Spurious notices on compact and `default`, a notice for failed launches, and S1 can produce a silent substitution. "8a must not publish" is a comment only (`chat-runtime-profile.service.ts:88-93`). |
| Resume keeps the stored identity after a provider switch | PARTIAL | Correct for native rows. Wrong for legacy rows (B1). |
| Native `/compact` through `SessionRuntimeControls.compact`, no SDK fallback, explicit error | COMPLETE | `chat-slash-command-router.service.ts:360-368` |
| Workspace and cwd authorization before the resolver; seed without credentials | COMPLETE | `chat-runtime-profile.service.ts:75-77`; resolver `:223-231` |
| Claude default path unchanged | PARTIAL | B2 regression. Resolver inputs are the same. The legacy constructor fallback is kept. The output-style order change is documented. |
| 7c apply-before-save, rollback, null-router delegation | PARTIAL | Delegation is correct. B2, S2 and M1 remain. |
| yolo/default and max/xhigh mapping | COMPLETE | Verified. `PERMISSION_MODE_MAP` has `yolo→'default'` and `LEVEL_FROM_SDK_MODE` has `yolo→'yolo'` (`permission-mode-map.ts`), the same as the old `bypassPermissions` route. When autopilot is off, `ask→'default'/'ask'` is the same as the old `'default'`. `setSessionEffort` maps `max→'xhigh'` (`session-control.service.ts:590-591`), with unchanged input. |
| prepare() errors surface | COMPLETE | Q4 |
| Room for #826 `resolveStoredModel` | PARTIAL | There is a clear place (`currentModel` before `config`), but see M5. |

Implicit requirements not addressed: persist-only when no live session exists (B2); a single runtime decision per launch (S1).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Legacy row, Codex workspace, native on | NO | — | B1 |
| Config change on idle or history tab | NO | rejects | B2 |
| Native controls unbound, `/compact` | YES | explicit throw, result shaped | — |
| Preparation refusal | YES | no adapter call, no notice | plain Error, no code |
| Notice broadcast fails | YES | launch aborted | — |
| Concurrent start and resume on one tab | PARTIAL | native adapter `busy` | two notices |
| Cancel during prepare | NO | — | pre-existing |
| Requested model `default` on native | NO | substitution notice | M3 |
| Permission save partial failure | PARTIAL | restore both keys | restore error masks original; live not rolled back |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH for B1, B2, S2 and the mapping verification. MEDIUM for S1, which depends on the 8a admission binding, and for M4.
- Top risk: config changes on any non-running tab now fail and are lost on every host (B2). Once 8a ships, legacy sessions in Codex-served workspaces resume with a Codex model and without their provider profile (B1).
- What a robust implementation would add: a resolved session identity, synthesized `claude-sdk` for legacy rows; persist-only handling when no live session exists; one owner for the runtime decision and one for persistence; the notice published only when the model actually changes and the launch succeeds; a resolver-backed spec for the legacy-row resume.
