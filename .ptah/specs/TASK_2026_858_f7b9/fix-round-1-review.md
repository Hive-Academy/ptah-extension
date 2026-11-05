# Phase B fix round 1 review — TASK_2026_858_f7b9

Verdict: **REVISE — 6/10**. Review family: **codex (implementer: claude)**.

The fixes close the validation, byte limit, transport failure, and contract drift findings. Recovery remains unreliable under overlapping attach requests. This is above the earlier 5/10 review because the original overflow dead end has a retry path, but below the 7–8 band because a realistic ordering still strands the view. Scope: the specified `dda41e36c..42c6b8cf5` fix diff and relevant reducer/client paths.

| Finding | Fixed? | Evidence file:line |
| --- | --- | --- |
| L1 baseline union validation | yes | `libs/worker-protocol/src/lib/frames.ts:112-252,268-271,515-520` selects a schema by event type and rejects an invalid baseline as 4400. |
| L2 overflow recovery | partly | `libs/worker-protocol/src/lib/client/session-event-reducer.ts:200-203,245-281,304-328` adds resync, but the two races below remain. |
| L3 throwing send | yes | `libs/worker-protocol/src/lib/client/worker-client.ts:393-401,501-539` rejects the current call, tears down the socket, rejects all others, and reports one close. |
| L4 byte limits | yes | `libs/worker-protocol/src/lib/frames.ts:479-484,498-530,552-586` enforces a caller supplied client phase limit and a default 1 MiB worker limit before parsing. |
| L5 quadratic append | yes | `libs/worker-protocol/src/lib/client/session-event-reducer.ts:70-90,163-175,368-375` appends to a shared log and flattens at the view boundary. Branching copies the prefix when an older log appends. |
| L6 silent tap failure | yes | `libs/backend/cli-engine/src/lib/transport/cli-webview-manager-adapter.ts:41-62,167-179` requires a logger with a tap and logs the error name. |
| L7 throwing ping/close | yes | `libs/worker-protocol/src/lib/client/worker-client.ts:235-249,557-573` catches ping failure, drops the connection, and ignores a throwing close after teardown. |
| L8 untrusted close reason | yes | `libs/worker-protocol/src/lib/client/worker-client.ts:210-228,333-340` maps peer close codes to fixed reasons. |
| S1 registry totality | yes | `libs/shared/src/lib/types/rpc/rpc-machines.types.ts:470-481` proves both `Exclude` directions; `rpc-machines.types.spec.ts:24` asserts it. |
| S2 cross-boundary contract | yes | `libs/worker-protocol/src/lib/shared-machines-contract.spec.ts:8-86` compares duplicated limits, session states, and worker-to-shared result assignability. |
| S3 speculative comment | yes | `libs/worker-protocol/src/lib/client/worker-client.ts:33-35` states host responsibility without a future file name. |

## New defects

1. **Blocking — resync can end before the fresh attach settles.** `libs/worker-protocol/src/lib/client/session-event-reducer.ts:229-231,304-328,183-188`. After overflow at `last=1`, `resyncing=true` and the dropped held frames may include sequences 3–1003. If live sequence 2 arrives before the requested fresh attach's baseline, `drainHeld` sees an empty held list and clears `resyncing`. If that attach then fails, `replay-failed` at lines 200–207 has neither `resyncing` nor `replayFrom` and requests nothing. With no subsequent live frame, the view remains at sequence 2 despite the missing 3–1003. A reconnect also calls `resumeAttachParams` with `afterSeq=2` instead of requesting the fresh baseline. **Fix:** keep resync pending until the fresh attach's baseline or an explicit attach completion; preserve fresh attach semantics on reconnect. Add the overflow → live contiguous frame → attach failure test.

2. **Major — a stale replay failure can launch a duplicate fresh attach.** `libs/worker-protocol/src/lib/client/session-event-reducer.ts:200-203,245-281`. Overflow requests a fresh attach while the earlier gap replay can still be in flight. The action `replay-failed` carries no request identity, so failure of that older replay enters the `resyncing` branch and requests another fresh attach even though the first one is outstanding. The host can then receive two baselines and interleaved event streams, while the reducer cannot associate their completion or failure with its current request. **Fix:** attach a generation token to recovery actions, or cancel and ignore the earlier replay when overflow starts; only retry failure of the current fresh attach. Add an out-of-order replay failure test.

## Five logic questions

1. **Silent failure:** the fresh attach failure after a contiguous live frame requests no retry (`session-event-reducer.ts:200-207,304-328`).
2. **Unexpected user action:** reconnect during that interval resumes from the partial `last` instead of a fresh baseline (`session-event-reducer.ts:183-188`).
3. **Wrong input answer:** malformed baseline members now fail validation (`frames.ts:233-252,515-520`); no new malformed-input defect was located.
4. **Dependency failure:** send and ping failures tear down and clear timers (`worker-client.ts:393-401,501-539,557-573`); overlapping attach failure remains ambiguous because actions have no request identity (`session-event-reducer.ts:118-121,200-203`).
5. **Missing requirement:** recovery needs a completion boundary and ordering rule for concurrent replay and fresh attach (`session-event-reducer.ts:200-203,304-328`).

## Verification

Read the whole reducer and client, relevant frame parser and contract paths, earlier reviews, and regression specs. The permitted `npm run verify -- -t test -p @ptah-extension/worker-protocol` exited before Jest: Nx daemon/plugin worker sockets were denied by the sandbox (`connect EPERM`). Scoped `ptah_get_diagnostics` twice returned unavailable after its 45-second TypeScript timeout. These findings follow directly from reducer transitions; no test pass is claimed.

## Decisions

| Decision | Options and evidence | Reversible? |
| --- | --- | --- |
| Mark L2 partly fixed and request another revision. | The new `resyncing` path fixes the original empty-buffer replay failure, but `drainHeld` clears it on an unrelated contiguous frame and `replay-failed` has no request identity (`session-event-reducer.ts:200-203,304-328`). Accepting the fix would leave silent stale history. | Yes. |
