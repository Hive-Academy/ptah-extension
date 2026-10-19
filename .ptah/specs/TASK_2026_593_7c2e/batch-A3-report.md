# Batch A3 — bell

## Files changed

- `libs/frontend/notification-center/src/lib/notification-center.store.ts`: replaced ledger-backed bell state with `NotificationService` signals; routed keyed, generation-checked actions through `ATTENTION_ACTION_DISPATCHER`; preserved shell focus routing; paused transient timers and suppressed redundant snackbars while the panel is open; guarded concurrent answers.
- `libs/frontend/notification-center/src/lib/notification-center.types.ts`: `NotificationCenterRow` now denotes `AttentionItem`. Legacy ledger record declarations remain because `notification-ledger.service.ts` still compiles and A5b owns its deletion.
- `libs/frontend/notification-center/src/lib/notification-center.component.ts`: Needs you and Recent notices sections, live-request badge, lane Allow/Deny/Open actions, disabled-action reasons, Clear all enablement, dismiss actions, first enabled row focus, Escape/outside focus restoration, and 44px dismiss targets. Completion and Read all UI removed.
- `libs/frontend/notification-center/src/lib/notification-center.store.spec.ts`, `notification-center.component.spec.ts`, `notification-center.injector.spec.ts`: replaced legacy bell expectations with attention state, dispatch, focus, pause/suppression, and clear behavior coverage.

## Verification

- `npx nx typecheck @ptah-extension/notification-center --parallel=1`: **passed**. Two NG8107 warnings came from `chat-ui`.
- `npx nx test @ptah-extension/notification-center --parallel=1 -- --maxWorkers=2`: **passed**, 5 suites / 20 tests. Jest reported one worker forced exit after passing.
- `npx nx lint @ptah-extension/notification-center --parallel=1`: **passed**.
- No-alpha Jest spec: **passed**, 1 suite / 11 tests.
- Scoped `ptah_get_diagnostics`: no errors in changed source files; two pre-existing BigInt target errors in `libs/shared/src/lib/types/capability-id-codec.ts` were reported as sibling diagnostics.
- Degradation audit: **295 unsuppressed sites**, up from baseline 294. The only new failing directory is `libs/frontend/chat` (12 vs baseline 11), outside A3 ownership. None of the A3 files were flagged. Audit exit code 1.

## Public API for A5

`NotificationCenterStore` now exposes `needsYou`, `recentNotices`, `badgeCount`, `canClearAll`; methods `setPanelOpen`, `clearAll`, `dismissRecent`, `dismissPresentation`, `isSubmitting`, `activate`, and `focus`. The component still provides its store locally and retains the same selector. The shell must provide `ATTENTION_ACTION_DISPATCHER` for Allow/Deny/Open; `NOTIFICATION_FOCUS_ROUTER` remains optional for direct focus. The component controls `NotificationService.pauseAll/resumeAll` and per-key snackbar suppression while open. `NotificationCenterRow` is `AttentionItem`; old ledger record declarations remain until A5b.

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Keep legacy record declarations in the types file while removing their bell usage | Delete now vs retain until A5b. `notification-ledger.service.ts` still imports these declarations and A3 cannot edit that file. | Yes, A5b deletes them. |
| Use the existing shell focus router as an Open fallback when no dispatcher provider is mounted | Always require dispatcher vs retain optional focus. Current shell may mount A3 before A2/A5 integration; the plan explicitly retains shell focus routing. Other actions require the dispatcher. | Yes. |
| Suppress keyed snackbars from a store effect while the panel is open | One-time suppression vs reconcile incoming items. New requests may arrive while the panel stays open; the effect reconciles keys and restores visibility on close. | Yes. |

## Not done

The A4 snackbar/announcer/sound files, A5 shell mounts, and A5b ledger deletion are outside this batch. The degradation audit cannot return to 294 from A3-owned files; the new site is in `libs/frontend/chat` and belongs to its writer.
