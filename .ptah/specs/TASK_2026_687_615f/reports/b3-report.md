# B3 Command Center page orchestration and dock

`CC/` means `libs/frontend/command-center/src/lib/`.

| Item | Change (`file:line`) | Regression spec |
| --- | --- | --- |
| D M-1/M-2 | `CC/components/command-center-page.controller.ts:158,350`: retains the pre-send pulse sequence for text, voice and Tribunal sends; armed entries carry tab, token and sequence. Voice callback consumes its supplied sequence or the sequence sampled immediately before voice send. | `command-center-page.controller.spec.ts`: pulse during send and existing FIFO/reverse-order cases. |
| D M-3 | `CC/components/command-voice-hud.component.ts:94`: settings appears for microphone denial; unavailable/worklet has a capture retry. | `command-voice-hud.component.spec.ts`: denial and both capture failures. |
| D M-4/E M-4 | `CC/components/command-center-page.controller.ts:226,303`: abort reasons and Stop abandon silently; other failures use the loop's single failure cue. | `command-center-page.controller.spec.ts`: abort reasons and API error; existing failed-turn case. |
| R3-3 | `CC/components/command-center-page.controller.ts:235`: 12-second idle grace uses B1's shared predicate; activity, pulse, rebind, teardown and destroy clear the timer. | `command-center-page.controller.spec.ts`: fake-clock expiry and late pulse; B1 provider specs cover predicate states. |
| F-10 | `CC/components/command-center-page.controller.ts:55,199,288,303,393`: voice session flag follows start, Stop, exit, rebind and destroy. | `command-center-page.controller.spec.ts`: activation and Stop; B2 service/ledger specs. |
| S1 M-B | `CC/model/command-center.store.ts:67`, `CC/components/command-center-roster.provider.ts:448`, `CC/components/command-center-page.component.ts:245`: capped Decline failure exposes a Retry Decline toast action. | `command-center-roster.provider.spec.ts`, `command-center-page.component.spec.ts`. |
| r5 M-2 | `CC/model/session-coordinator.ts:238-281` already retains the pre/post open stale-workspace guard and writes `running` after the binding check. B2's `trackMarkedTabVisibility` owns old-tab registration until settlement. No source change was needed here. | Existing coordinator/binding and B2 turn-status specs. |
| r6 M-1/M-2 | `CC/components/command-center-page.component.ts:429,451`, `command-center-page.controller.ts:377`, `command-center-tribunal.transport.ts:175`: fixed-text initial-open failure; explicit Status reopens before sending; stale Confirm and launch send return without replay. | `command-center-page.component.spec.ts`: initial rejection and explicit Status; existing controller Confirm gate specs. |
| B2 m-2 | `CC/components/command-center-workspace-binding.ts:78`: the rebind `open()` is already wrapped in `untracked` by Wave 1. | Existing binding specs. |
| Visual | `CC/components/command-center-page.component.ts:100,214-277`: compact dock, text controls first on stacked width, fixed toast outside dock flow, recovery dock moved above stage on a stacked failure. `command-voice-hud.component.ts:27-117` and `command-session-controls.component.ts:29-62`: legible disabled controls and base-content focus outlines; native disabled remains. | HUD and page component specs; renderer contrast/layout still needs orchestration review. |

## Preserve-contract checklist

- Public controller fields and method names remain. The roster facade remains one source of Tribunal state and preserves the nonce gate, invalid-Decline gate and click-only Confirm.
- Voice armed entries are FIFO per observed terminal pulse; each carries the original tab and sampled sequence. Stop cancels the active token. No Stop fallback timer was added.
- `session-coordinator.ts` still rejects stale workspace sends before its `running` write. Status is retried only from its button. A Confirm click during rebind initiates readiness and requires another click; launch turns are never replayed.
- Every added timer is cleared on pulse, status/pending change, rebind or destroy. Voice-session activity is cleared on stop, exit, rebind and destroy.
- Controller length: **415 lines**, below the 700-line limit.

## Files changed

- `CC/components/command-center-page.controller.ts` and `.spec.ts`
- `CC/components/command-center-roster.provider.ts` and `.spec.ts`
- `CC/components/command-center-page.component.ts` and `.spec.ts`
- `CC/components/command-center-tribunal.transport.ts`
- `CC/components/command-voice-hud.component.ts` and `.spec.ts`
- `CC/components/command-session-controls.component.ts`
- `CC/model/command-center.store.ts`
- `.ptah/specs/TASK_2026_687_615f/reports/b3-report.md`

## Verification and remaining work

Ptah AST analysis found no parse errors in the edited TypeScript source and specs. Scoped `ptah_get_diagnostics` returned **unavailable after 45 seconds**, with all 11 requested files unchecked. Per the parallel-lane instruction, no Nx, Jest, tsc, build, serve or e2e command was run. The orchestrator needs to run the focused specs and visual contrast/layout review; those results are not claimed here.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep the voice callback's optional sequence and capture the voice send's sequence on the page. | Recompute latest pulse / retain pre-send sample. | B2 callback is optional; recomputation after an awaited send can skip a pulse. | Yes. |
| Treat a stale Confirm as a declined click and require the user to click again after readiness. | Automatically replay / explicit second click. | Amendment A1 explicitly prohibits Confirm or launch replay. | Yes. |
| Move the stacked dock to the top when it contains the HUD's live recovery message. | Duplicate top alert / move existing live region. | The HUD already owns one `role=status` announcement; duplication would announce twice. | Yes. |
| Reuse the existing stale-send ordering in `session-coordinator.ts`. | Rewrite send / preserve guard. | The current `running` write follows the binding check at lines 272-281. | Yes. |
