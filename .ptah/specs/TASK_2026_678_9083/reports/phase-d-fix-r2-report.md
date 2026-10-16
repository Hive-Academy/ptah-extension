# Phase D correction, round 2

## N1 — pending input priority

- `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts:81`: `shownInput` computes one priority order: marked tab permission, pending roster, ordinary question. The effect at `:213` is the sole `setPendingInput` writer. The request ID set at `:51` and prompt effect at `:224` speak each displayed request once.
- `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts:112` and `libs/frontend/command-center/src/lib/components/command-center-page.component.ts:125`: pass a proposal to the card only while its roster question is shown. Permission responses remain card actions through `answerPermission` and `handlePermissionResponse`; speech cannot approve or deny.
- Specs: `libs/frontend/command-center/src/lib/components/command-center-page.controller.spec.ts:476` (`keeps approval shown when a roster arrives and shows roster after permission resolves`, including permission reappearance and one prompt per ID); `:526` (`restores approval after declining a roster while permission remains current and speaks its id once`). The component harness reads `shownProposal` at `libs/frontend/command-center/src/lib/components/command-center-page.component.spec.ts:60`.

## N2 — queued typed turn

- `libs/frontend/command-center/src/lib/voice/command-voice-loop.ts:415`: a typed send queues while a voice boundary is pending. At `:427`, the current token settles before the next queued typed token is armed. The queue clears on release at `:547`.
- `libs/frontend/command-center/src/lib/components/command-center-page.controller.ts:49`, `:136`, and `:233`: each armed token has its own pulse baseline. A successful pulse shifts exactly one token; the following token cannot consume that same pulse.
- Specs: `libs/frontend/command-center/src/lib/voice/command-voice-loop.spec.ts:42` (`queues a typed turn behind a voice boundary and arms token 2 after token 1`); `libs/frontend/command-center/src/lib/components/command-center-page.controller.spec.ts:262` (`settles voice pulse 5 before typed pulse 6 with separate turn tokens`). Existing inactive voice test remains at `:234`.

## Verification

- Final Jest: `Test Suites: 30 passed, 30 total`; `Tests: 193 passed, 193 total`. Includes `integration/*.spec.ts`.
- `npx tsc -p libs/frontend/command-center/tsconfig.lib.json --noEmit` filtered for `command-center/src`: no matching diagnostics.
- ESLint: passed on all six changed source/spec files. Prettier `--write` then `--check`: all matched files use Prettier code style.

## Decisions

- A roster can remain pending behind a permission; removing the permission reveals it. A returning permission takes priority without repeating its spoken prompt.
- No other files changed. Nothing left undone.
