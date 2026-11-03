# CodeRabbit findings on PR #909

## Findings

1. **Valid — idle compaction logging.** The `armed`, `released`, `fire skipped`, and `firing` info calls could throw inside the session pipeline or before a send. Added `safeInfo` with an `optional-capability` degradation-audit suppression. Added a regression test where every info call throws and the fire still sends.
2. **Valid — query release logging.** The debug call preceded release callbacks after setting `released`. Guarded that call so cleanup continues if logging fails. Added a stream-end regression test asserting idle ownership is released when debug throws.
3. **Valid — background active tab.** Removal left the stored active ID pointing to the removed tab. Select the tab at the same index, the previous tab when removing the last one, or `null` when empty. Added a workspace switch regression test for adjacent and empty cases.
4. **Valid — queued command identity.** Content prefix matching could settle another listener with the same command text. Exposed the current queue-head handle from `ConversationService`, captured it before queue clearing, and settled only that handle. Added a same-text two-listener regression test.
5. **Valid — held hand-off listener.** A held command that became the queue head had no flush outcome listener. Extracted the existing callback into `watchQueuedCommand` and registered it after successful held release. Added a test where the preceding text sends and the hand-off flush fails, asserting the claim is released.
6. **Valid — direct hand-off banner.** `wrapUpSent` ignored a `fired` claim when the send was direct and had no queued handle. It now includes `autoHandoff.entry(sessionId)?.state === 'fired'`. Added a direct-send regression assertion and an assertion after queued delivery.

## Verification

- `npm run verify -- -p agent-sdk,chat,chat-state`: exit 1 before checks; Nx plugin child-process spawning failed with `EPERM`.
- Direct Jest, `agent-sdk` two touched specs with `--runInBand --coverage=false`: **2 suites, 36 tests passed**.
- Direct Jest, `chat` three touched specs: `--maxWorkers=2` failed spawning a Jest worker (`EPERM`); `--runInBand` failed before tests because esbuild worker spawn returned `EPERM`.
- Direct Jest, `chat-state` touched spec with `--runInBand`: failed before tests because esbuild worker spawn returned `EPERM`.
- Scoped `ptah_get_diagnostics` after edits: TypeScript compiler still running after its 45-second timeout; no diagnostic result was available.

## Decisions

- Used the existing `ConversationService` queue-head identity as the flush key. Alternatives were matching content or adding another token. The existing queue-head map already distinguishes identical commands and is reversible.
- Preserved the claim store's `fired` state as the banner's sent signal. The claim API already exposes `entry`; this is an additive computed-state check and is reversible.
