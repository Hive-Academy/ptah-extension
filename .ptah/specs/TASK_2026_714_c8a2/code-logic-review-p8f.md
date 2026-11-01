# Code Logic Review, P8 fix round (8f-1..8f-5) — `TASK_2026_714_c8a2`

Scope: `git diff 020ec6fd8~1..c16226865`. Read in full: `codex-runtime-composition.ts`, `codex-session-binding.ts`,
`codex-binding-registry.ts`, `bootstrap.ts` and `shutdown.ts` diffs, `ipc-bridge.ts` diff, agent-sdk `codex-chat-adapter.ts`,
`codex-chat-turn-stream.ts`, `codex-chat-events.ts`, `codex-chat-approval-sink.ts` diff, `session-runtime-identity-cache.ts`,
rpc-handlers `codex-chat-host-ports.ts`, `codex-chat-event-callbacks.ts`, `codex-session-settings-record.ts`,
`codex-legacy-session-settings.ts`, `chat-session.service.ts` diff, `codex-executable-pin*.ts`, delivery coordinator and broadcaster
(ordering only). Nothing was run. The D1 fix is checked statically only; the live Electron rerun is still pending.

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 7/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 1 (carried over, unowned) |
| Moderate issues     | 7              |
| Failure modes found | 9              |

Why 7: the shutdown, boot, workspace-path and reconciliation defects are really fixed and I could not break them by tracing.
Not 8+: one misleading-terminal defect from the prior review was never scheduled or deferred, the approval-reject path is only
logged, and the new binary-inspection cache turns a transient failure into a permanent one. Not 5-6: no blocker, no data loss.

## Disposition of prior findings

| ID | Status | Evidence |
| -- | ------ | -------- |
| B1 boot aborts on optional binding | FIXED | `bootstrap.ts:541-567`: gated on `createElectronCodexRouting(...).capabilities.nativeCodex`, whole bind in try/catch that logs and continues. `readCodexDevRouteOverride` cannot throw (`codex-dev-route.ts:7-21`). Absent bind leaves SDK null defaults (`agent-sdk/di/register.ts:996-1008`), and every consumer is null-safe. |
| S1 normalized key used as path | FIXED | Raw path kept in `workspacePaths` (`session-runtime-identity-cache.ts:43-45`, `:107`), read by `codex-session-settings-record.ts:~100-106`; native record uses `p.workspaceId` (raw). Missing path throws a coded error. |
| S2 dispose order / abort teardown | FIXED, caveat M-N3 | Scopes close first, then record, then lookup (`createElectronCodexBindingHandle`, composition ~`:540-570`); registry wraps in `Promise.resolve().then` (`codex-binding-registry.ts:26`); `shutdown.ts:293-300` budgets 2 s. |
| S3 reply rejected by router | PARTIAL | `codex-chat-host-ports.ts:335-370`: now logs `approval-response-rejected/failed` and keeps the entry. See M-N4. |
| S4 lost errors | FIXED | `codex-chat-adapter.ts` `failure()` logs the real Error and attaches `cause`; `cleanupOpen` logs; sink catches log the Error (`codex-chat-approval-sink.ts` diff); `verifyBinary` logs the cause (composition `:~345-358`). |
| S5 reconciliation corrupts / races terminal | FIXED, caveat | Callback `result` is a no-op (`codex-chat-event-callbacks.ts:~88`). Replacement only when final text does not extend streamed text (`codex-chat-events.ts` textFinal). `track()`+`settled()` are awaited before the mapped events (incl. `message_complete`) are yielded (`codex-chat-turn-stream.ts:~108-113`). Both paths use the same delivery buffer, so call order is delivery order (`stream-batch-buffer.ts` header). |
| S6 raw resume compare | FIXED | `codex-chat-host-ports.ts:~246-252` compares `normalizeCodexWorkspaceKey` of both; profile keeps raw spelling. |
| S7 sync hash on main thread | FIXED, caveat M-N1 | Async stream hash + async `execFile`, memoised by path/size/mtime (`composition.ts:135-172`). |
| M1 container leak | FIXED | `composition.ts` scope factory catch disposes child container and logs a failure. |
| M2 persist before stage | PARTIAL, deferred (accepted) | `opened()` (can throw on bad effort) now runs before `persistMetadata` (`adapter:~259-262`). Cancel after persist still leaves a row; no rollback API. Accept. |
| M3 broadcast failure leaves approval | FIXED for rejection only | `host-ports.ts:~287-308` declines through the router when `broadcastMessage` rejects. A resolved-but-undelivered send (no live renderer) is still not handled. |
| M4 uncoded native errors | PARTIAL | See M-N5. |
| M5 empty block | FIXED | Empty text skipped (`events.ts` textFinal guard); result publishes nothing. |
| M6 surfaceMode | DEFERRED (accepted for Electron-first) | Native chat started from a surface is published without the flag; gated off by default. Keep on the list. |
| M7 import-time pin parse | FIXED | Lazy parse (`codex-executable-pin.ts`), no manifest JSON. Still win32/x64 only (parity gate bounds exposure). |
| M8 raw ZodError | FIXED | `codex-legacy-session-settings.ts` uses `safeParse` and fixed messages. |
| M9 UUID v7 widening | NOT CHANGED | Low risk, as before. |
| Minor: profiles cleared first | FIXED | Cleared in `finally` after scope close. |
| Minor: lexical bundled-root | FIXED | `realpathSync` on both sides (`composition.ts:~115-123`). |
| Known item 3 legacy auth from current workspace auth | NOT FIXED (arguably correct) | `codex-session-binding.ts:106-110` still `resolveActiveAuthForPath`; legacy sessions have no frozen auth record. Document it. |
| Known item 5 compaction `auto`/`preTokens 0` | NOT FIXED | `codex-chat-event-callbacks.ts:94-107` still publishes `trigger:'auto', preTokens:0`, while `turn-stream.ts:117` also calls `notifyCompaction`; likely two start signals with different data. Moderate. |
| Known item 6 hidden-tab terminal overwrite | NOT FIXED, unowned | See Serious S-N0. Not in 8f scope, not in "deferred". |
| Q5 renderer reload loses pending approval | NOT FIXED, unowned | `host-ports.ts` `pending` map has no re-present path. Moderate. |
| LIVE D1 dev binary root | FIXED (static) | `resolveElectronCodexBundledRoot` walks ancestors from `appPath` to the first `node_modules` (`composition.ts:83-100`); `realpathSync` on root and binary make the junction in a worktree compare equal. Packaged path unchanged. Needs the live rerun. |
| LIVE D2 swallowed cause | FIXED | As S4. |
| LIVE D3 chat:start success after failure | FIXED with caveat M-N5 | `chat-session.service.ts:656-658` throws `RpcUserError`; frontend sets terminal reason (`message-sender.service.ts:508-513`). |
| LIVE D4 global key written on workspace save | DEFERRED (accepted) | Pre-existing, separate PR, user-owned. |

## Five logic questions

1. Silent failures. Native binding failure at boot is logged but the app then runs the legacy SDK path for a user who selected
   Codex (`bootstrap.ts:561-566`): visible only in logs. A rejected approval reply is logged only (`host-ports.ts:357-362`).
   A failed turn on a hidden tab can end as "complete" (S-N0).
2. User action. Pressing Stop while a native chat is still opening yields `CodexChatAdapterError('cancelled')`, which
   `chat-session.service.ts:656` shows as "Codex chat could not start." with an api_error terminal. Double-send gives `busy`, same text.
3. Wrong data. A final text that is a strict prefix of streamed text takes the replacement path (correct). A dropped last delta with
   no `textFinal` is no longer repaired by `result.text` (the repair was removed); acceptable given the runtime contract, but unproven.
4. Dependency failure. `--version` timing out (10 s, `composition.ts:169`) on a first cold Windows run is cached as a rejection
   until the binary changes (M-N1). `WORKSPACE_SCOPE_RESOLVER` is conditionally registered (`electron-settings-registration.ts:93-104`);
   if absent the bind throws, is caught and native is disabled with one log line.
5. Missing. A reviewed pin per platform; a retry or re-present for approvals after a renderer reload; coded native RPC errors beyond
   `chat:start`.

## Serious issues

### S-N0. Hidden-tab terminal slot is still overwritten (carried over from known item 6)

- File: `chat-stream-delivery-coordinator.service.ts:232-235` (single `terminal` slot per hidden tab); producers
  `codex-chat-event-callbacks.ts:~72-80` (CHAT_ERROR via `error`, not tracked by `CodexChatEvents.track`) and the broadcaster's
  CHAT_COMPLETE after the yielded `message_complete`.
- Scenario: a native turn fails while its tab is hidden. `error()` stores CHAT_ERROR, then the stream's CHAT_COMPLETE replaces it.
- Impact: the user returns to a tab that says the turn finished normally. Misleading success.
- Fix: keep error over complete in the slot (or hold both), and let the projection track `callbacks.error` so ordering is explicit.
  Needs an owner: it is neither fixed nor in the deferred list.

## Moderate issues

- M-N1. Failed binary inspection is cached for the process lifetime. `inspectElectronCodexBinary` stores the rejected promise under
  `[path,size,mtime]` (`composition.ts:140-161`); `verifyBinary` clears only its local `verified`. A slow first `--version`
  (antivirus scan) or a transient EBUSY makes every later open fail until restart. Evict the entry on rejection.
- M-N2. `--version` executes the binary before its digest is compared with the pin (`composition.ts:155-157`, compare happens later in
  the runtime registration). Low exposure (bundle path is guarded), but verify the hash first.
- M-N3. If the 2 s budget expires (`shutdown.ts:95,293-300`) the scope closes keep running while SQLite closes and the final flush runs;
  `markInactive` writes then land after the flush or on a closed DB, leaving threads `active`. Same symptom as S2 under slow close.
- M-N4. Rejected approval reply (S3 remainder). The renderer has already dismissed the prompt, so "keeps the prompt pending so the
  user can retry" (`host-ports.ts:~364`) cannot happen; the entry and the host attention notice stay until the session closes, and the
  IPC bridge falls through to the Claude handler for the same id. Settle and decline when `respond` returns false for a request
  the router no longer knows.
- M-N5. `chat-session.service.ts:656-658` maps every `CodexChatAdapterError` (busy, cancelled, unsupported, identity-mismatch) to
  `SESSION_ENDED`, a code about ended sessions, and matches by `error.name` string because the class is no longer exported from the barrel.
  Only `chat:start` is covered; resume/continue paths (`:710`, `:803`) still return the old shape. Add dedicated codes to
  `rpc-error-codes.types.ts` and map `cancelled` to a non-error.
- M-N6. Compaction double signal and wrong metadata (known item 5) — see table.
- M-N7. Renderer reload loses pending approvals (Q5) — see table. Minor: the `tabId` fallback to the session id (deferred, accepted).

## Failure modes

- Transient `--version` failure becomes permanent (M-N1). Trigger: slow first run. Symptom: every native open fails, generic text.
- Hidden-tab failed turn shown as complete (S-N0).
- Slow close at quit leaves threads `active` (M-N3).
- Approval reply rejected leaves orphan notice (M-N4).
- Cancel during open surfaces as a start failure (M-N5).
- Native binding disabled at boot, user silently on legacy path (`bootstrap.ts:561`). Recommendation: surface a one-time notice.
- Double compaction banner (M-N6).
- Renderer reload loses approval (M-N7).
- Packaged guard: not broken. `createElectronCodexExecutable` compares `realpath` of the packaged `app.asar.unpacked/node_modules`
  and the resolved binary; the resolver tries the packaged path first (`codex-native-binary-path.ts` order step 1). If the unpacked
  package is missing, `realpathSync(bundledRoot)` throws ENOENT, which `verifyBinary` logs and reports as "verification failed"
  (fail closed, no global fallback). Residual uncertainty: not exercised against a real installer build.

## Data flow (turn, final text)

1. Runtime event -> `CodexChatEvents.map` (identity and sequence filter) — OK.
2. `textFinal` extends streamed text -> delta event only; otherwise `content` replacement tracked — OK.
3. `terminal` -> `track(result)`, `message_complete` returned — OK.
4. `await projection.settled()` before any yield — OK; a rejected tracked promise fails the whole turn after terminal (stats throw),
   same as before.
5. Broadcaster pushes to the shared delivery buffer in call order, then CHAT_COMPLETE — OK except the hidden-tab slot (S-N0).

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Optional Codex binding cannot take the app down | COMPLETE | silent degrade to legacy, log only |
| Clean shutdown marks threads inactive | PARTIAL | budget expiry (M-N3) |
| Approval reply never lost | PARTIAL | M-N4 |
| Workspace identity raw vs normalized | COMPLETE | |
| Final text reconciled before terminal | COMPLETE | |
| Dev build can open native chat | COMPLETE (static) | live rerun pending |
| Packaged executable guard | COMPLETE (static) | no installer run |
| Coded errors for native failures | PARTIAL | M-N5 |

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Windows path casing on resume | YES | normalized compare | |
| Closed session settings on Windows | YES | raw path from thread row | rows without `codexThread` throw coded error |
| Concurrent opens, same binary | YES | shared inspection promise | cached failure (M-N1) |
| Quit with live native session | YES/PARTIAL | order fixed, 2 s budget | M-N3 |
| Delta-only turn | YES | no republish | lost-delta repair removed |
| Stop during open | NO | surfaces as start failure | M-N5 |

## Verdict

- Recommendation: REVISE (small, targeted)
- Confidence: HIGH on boot, shutdown order, path handling and reconciliation order; MEDIUM on dev root and packaged guard (static only).
- Top risk: a failed native turn on a hidden tab is reported to the user as complete.
- Add: error-over-complete terminal precedence; evict rejected binary inspections; settle an approval the router rejects; dedicated
  RPC codes and a `cancelled` mapping; run the live scenarios a-f once on the fixed build.
