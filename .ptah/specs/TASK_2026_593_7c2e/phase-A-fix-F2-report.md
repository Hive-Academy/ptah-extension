# Phase A fix F2 report

| Finding | Fix | File:line | Covering spec |
| --- | --- | --- | --- |
| S1 | Shell-started projection drains terminal pulses, emits only failed turns with `c:` keys, fixed failure text plus session title, and retains no pulse payload. Core recent notices bound retained items. | `libs/frontend/chat/src/lib/services/chat-failed-turn-attention.service.ts:7`; `app-shell.component.ts:189`; `electron-shell.component.ts:401` | `chat-failed-turn-attention.service.spec.ts`; both `*.notification-center.spec.ts` |
| S4 | Typed bell `viewChild` and `openPanel()` replace DOM selector/click and mutation observers. Overflow trigger stops the originating click. | `notification-center.component.ts:159`; `notification-snackbar.component.ts:76`; `app-shell.component.ts:193`; `electron-shell.component.ts:400` | `notification-center.component.spec.ts`, `notification-snackbar.component.spec.ts`, both shell notification specs |
| S5 | Sound effect tracks cue sequence, ignores a cue present at construction, and reads mute untracked. Both shells eagerly inject the root service. | `notification-sound.service.ts:24`; `app-shell.component.ts:190`; `electron-shell.component.ts:402` | `notification-sound.service.spec.ts`; both shell notification specs |
| Moderate 5, 7 | Announcer prunes resolved identities, queues notices with one released timer, clears the live region before repeated text, and caps queued messages at 100. | `notification-announcer.component.ts:30` | `notification-announcer.component.spec.ts` |
| Moderate 8 | Removed Dismiss from Needs you rows. | `notification-center.component.ts:55` | `notification-center.component.spec.ts` |
| Minor 11 | Submission state is a signal so OnPush buttons update on completion. | `notification-center.store.ts:18` | `notification-center.component.spec.ts` |
| Minor 12 | Deleted obsolete completion and pending ledger types and their exports. | `notification-center.types.ts:1`; `src/index.ts:4` | Reference search found no consumers; notification-center suite |
| F1 `dispatchOutcome` | Bell and snackbar show “Already answered” for stale, display and disable unavailable actions with the returned reason, and keep completed behavior. Failure Open uses the focus router. | `notification-center.store.ts:90`; `notification-snackbar.component.ts:177` | `notification-center.store.spec.ts`, `notification-snackbar.component.spec.ts` |

## Verification

- `npx nx test @ptah-extension/notification-center --parallel=1 -- --maxWorkers=2`: 6 suites, 26 tests passed. Subsequent focused component and announcer specs passed after the final spec/queue edits (5 and 1 tests).
- Targeted chat command: 21 suites, 223 tests passed.
- Webview `no-alpha-base-content.spec.ts`: 11 tests passed.
- Degradation audit: **294** unsuppressed sites.
- `ptah_get_diagnostics` was called on the edited TypeScript files, but the compiler service returned unavailable after 45 seconds on each attempt. The orchestrator's typecheck remains the outstanding verification gate.

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Project failed turns through `attentionConditionKey` and retain no local ledger | The shared core key helper already emits `c:` keys; `NotificationService` bounds recent notices at 75; pulses include assistant text and raw reasons, which the projection does not copy. | Yes |
| Use direct focus for failure Open | F1 `dispatchOutcome` owns request actions; failed turns are condition items and have no dispatcher request. The existing focus router accepts their session and tab target. | Yes |
| Start the failed-turn projection only where model refresh control exists | `TabManagerService` requires `MODEL_REFRESH_CONTROL`; existing shell test harnesses omit that provider or use partial tab mocks. Production composition supplies it. | Yes |
| Keep the announcer queue finite | One timer processes messages in order; capping at 100 prevents an unbounded backlog during unusually large bursts. | Yes |

## Not done

- No files outside F2 ownership were edited. Scoped compiler diagnostics were unavailable; the orchestrator should run the planned typecheck.
