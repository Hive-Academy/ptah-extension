# Phase E round 1: voice provider chip

## Changed

- `libs/frontend/command-center/src/lib/model/command-center.store.ts:49`: provider state now carries per-direction provider ID, label, model or voice label, readiness, and status; `setProvider` at line 245 preserves details when the voice loop updates the existing transcription and synthesis readiness flags.
- `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts:37`: maps the existing `voice:getProviderConfig` response to Settings-compatible Local and ElevenLabs labels and statuses. `open()` at line 507 clears details on RPC failure so the page shows Voice unavailable. No voice-list RPC is added.
- `libs/frontend/command-center/src/lib/components/command-center-page.component.ts:122`: compact clickable header chip with readiness dot, truncated visible label, full title and aria-label, and visible keyboard focus ring. Computed labels are at line 322.

## Specs added

- `libs/frontend/command-center/src/lib/model/command-center.store.spec.ts:80`: provider details and readiness updates.
- `libs/frontend/command-center/src/lib/components/command-center-page.controller.spec.ts:163`: local labels and download status; ElevenLabs labels and missing-key status at line 177; degraded RPC state at line 191.
- `libs/frontend/command-center/src/lib/components/command-center-page.component.spec.ts:120`: chip text, accessibility label, dot and settings click; mixed providers at line 137.

## Decisions

- Keep `transcription` and `synthesis` as the existing readiness readers and add optional `stt`/`tts` details in the same state. Other voice-loop callers pass only readiness; this preserves their calls and details. Reversible.
- Show `ElevenLabs voice` when a voice name is unavailable. The config DTO has a voice ID but no name, and this task forbids a voice-list call. Reversible.
- Refresh on page open. The routed page calls `open()` in its constructor, and no cheap settings-return subscription was identified in the assigned surface. Reversible.

## Not done

- No Nx, Jest, build, serve, e2e or package commands were run, per lane instruction. Scoped `ptah_get_diagnostics` found no errors in assigned files; it reported 17 errors in sibling files outside this lane's ownership (integration and tribunal specs, and shared capability-id-codec).
- There is no in-place refresh while the page remains mounted; provider state refreshes when the page opens.
