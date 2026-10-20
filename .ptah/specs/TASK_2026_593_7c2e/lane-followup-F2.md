# Attention follow-ups F2

## Fix 1 — X2 result replay

**Root cause / evidence:** The proposed guard cannot distinguish or suppress a replayed result. `isReplayMessage` requires `msg.type === 'user'` and `isReplay === true` (`libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts:380-381`). The RESULT branch requires `type === 'result'` (`sdk-message-transformer.ts:325`); those predicates are mutually exclusive. The installed SDK declares `isReplay: true` only on `SDKUserMessageReplay` (`node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:5960,6026`), while its result types have no replay marker and its result documentation describes one result per turn (`sdk.d.ts:5413-5418`). The transformer already drops replayed user turns at `sdk-message-transformer.ts:296-302`. There is no supported replayed-result input to test; fabricating one would still fail `isReplayMessage` because its type is `result`.

**Changes:** None. The RESULT branch and transformer specs remain unchanged. Live result handling remains as implemented at `sdk-message-transformer.ts:325-336`.

## Fix 2 — M6 voice error notice keys

**Root cause / evidence:** `voice-provider-error.service.ts` resolved the current notice and included an increasing generation in the key for every error. `NotificationService.upsert` updates an existing entry by key (`libs/frontend/core/src/lib/services/notification.service.ts:74-82,110-112`), and `resolve` ignores a generation older than the current source (`:135-141`). New keys caused repeated notices to restart their presentation.

**Changes:** `libs/frontend/chat/src/lib/services/voice-provider-error.service.ts:43-50` now uses a stable key scoped by workspace and `stt`/`tts`, increments the generation separately, and upserts without resolving the prior notice. At `:94-98`, switch success resolves its captured generation and clears the tracked error only when both the key and generation are still current. `libs/frontend/chat/src/lib/services/voice-provider-error.service.spec.ts:64-84` covers two STT errors using one key and distinct STT/TTS keys. The existing cross-direction M5 race test remains at `:146-160`; `:162-179` adds the same-direction race where the key is shared but the generation has advanced.

## Decisions

1. **X2: make no source or spec change.** Options were adding `isReplayMessage` to the RESULT branch or keeping the SDK's declared result contract. The guard is always false for a result; the latter avoids a misleading regression test and is reversible if the SDK later introduces result replay metadata.
2. **M6: retain one global increasing generation with a stable key per workspace and direction.** This matches `NotificationService` upsert and stale resolve semantics, while preserving the service's existing latest-error action model. Reversible within this service if per-direction action state is later required.

## Verification and projects to check

- No Nx, Jest, build, or test command was run, as requested.
- Scoped `ptah_get_diagnostics` reported no diagnostics in either edited voice file. It reported 255 errors in sibling chat files; those are outside this lane's ownership.
- Project for the orchestrator to check: `@ptah-extension/chat`.

## Revision 1 (M6)

**Root cause / evidence:** `NotificationService.dismissPresentation` stores the current `presentationKey` (`notification.service.ts:163-170`), and `upsert` clears that dismissal only when the presentation key changes (`:82-99`). The stable voice item key had no presentation key, so a later error stayed hidden. The service also kept one global `currentKey` and payload, making older direction and workspace actions stale despite their notices remaining visible.

**Changes:** `libs/frontend/chat/src/lib/services/voice-provider-error.service.ts:26-27,46-52` keeps one action entry per workspace/direction key and assigns each new error generation as its `presentationKey`. `:67-85` dispatches against that entry's generation and returns a clear unavailable reason when the notice belongs to another active workspace; it does not apply a provider change in the wrong workspace. `:89-107` uses the entry's direction and removes only the matching generation after success, retaining the M5 same-key race guard. `latestError`, `switchError`, and `isSwitching` remain public signals. `libs/frontend/chat/src/lib/services/voice-provider-error.service.spec.ts:29-40,68-76,91-125,231-263` covers distinct presentations, both direction actions, prior-workspace unavailability, dismissal revival with the real `NotificationService`, and no replay for a same-generation upsert. Existing M5 race specs remain.

### Decisions

1. **Keep the workspace requirement for action execution.** Options were to apply the action from any workspace or report it unavailable while another workspace is active. The RPC has no workspace parameter and uses active context, so the latter avoids changing the wrong workspace; the user can return to the original workspace and retry. Reversible if the RPC gains an explicit workspace parameter.
2. **Keep one global in-flight switch signal.** The existing public `isSwitching` signal represents one RPC sequence at a time. Per-key action state lets both notices work sequentially without changing that contract. Reversible if concurrent switches become a product requirement.

**Verification / project to check:** No Nx, Jest, build, or test command was run. Scoped `ptah_get_diagnostics` found no errors in the two edited files; it reported 253 errors in sibling chat files. Orchestrator project: `@ptah-extension/chat`.
