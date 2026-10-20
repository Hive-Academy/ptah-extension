# A4 snackbar and sound report

## Files changed

- `libs/frontend/notification-center/src/lib/notification-snackbar.component.ts` — new standalone, OnPush snackbar host rendering `NotificationService.snackbars()`; direct actions use `ATTENTION_ACTION_DISPATCHER`; presentation dismiss does not answer a request. Three cards normally, one at viewport width 900px or less or height 620px or less, with a `+N more` bell trigger. Hover and focus use the core remaining-time clock; bell-open state hides cards and pauses all transient clocks. Host has no live role. Native buttons provide accessible labels and 44px dismiss target with a 24px icon. Reduced motion disables entry animation.
- `libs/frontend/notification-center/src/lib/notification-snackbar.component.spec.ts` — action/dismiss, hover and focus remaining-time fake timers, narrow and short viewport, and bell-open pause coverage.
- `libs/frontend/notification-center/src/lib/notification-announcer.component.ts` — removes ledger import; announces each core request/warning lifecycle politely and each failure lifecycle assertively. No finished-turn announcement.
- `libs/frontend/notification-center/src/lib/notification-sound.service.ts` — observes `NotificationService.soundCue()`; legacy `playBurst()` calls without a cue are silent, so the still-present ledger cannot play finished-turn audio. Keeps persisted mute, audio gate and cooldown; removes debug logging and releases gesture listeners on destroy.
- `libs/frontend/notification-center/src/lib/notification-sound.service.spec.ts` — cue-only audio, cooldown, suspended-context, mute and audio gate coverage.

## A5 mount contract

Export `NotificationSnackbarComponent` from `libs/frontend/notification-center/src/index.ts` in A5. Selector: `ptah-notification-snackbar`; class: `NotificationSnackbarComponent`. Input: `panelOpen` (boolean, default false). Output: `openNotifications` (`void`) to open the bell. Mount once per active shell beside the bell and announcer. The host's top position can be adjusted with `--ptah-snackbar-top` (default `4rem`). Keep the ledger export in `index.ts` until A5b.

## Decisions

| Decision | Options and evidence | Reversible |
| --- | --- | --- |
| Use the core pause/resume clock from DOM hover/focus events | Local timer vs core clock. A1 already implements remaining-time expiry and one shared expiry timer; using it preserves elapsed time and avoids a timer per card. | Yes |
| Treat 620px or less as short vertical space | No numeric threshold in design; three 348px cards can obscure a short viewport. The component switches to one card at this height. | Yes |
| Keep `playBurst()` callable but silent outside a sound-cue effect | The ledger still calls it until A5b and is outside A4 ownership. Guarding the call meets the no-finished-turn-sound requirement without touching that file. | Yes |

## Verification and remaining work

No Nx, Jest, TSC, build, or e2e command was run, per the single-check-slot instruction. A scoped `ptah_get_diagnostics` run reported no diagnostics in the five A4 files; it reported two existing BigInt target errors in `libs/shared/src/lib/types/capability-id-codec.ts`, outside batch ownership. A subsequent scoped diagnostic call timed out before returning a new result. The orchestrator should run notification-center checks after lane integration. A5 must export and mount the host and connect `panelOpen`/`openNotifications`. A5b owns ledger removal and its index export.
