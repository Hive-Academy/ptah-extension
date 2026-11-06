# Frontend review fixes, round 2

## Changes and regression tests

| Item | Fix (source) | Regression test |
| --- | --- | --- |
| N1 | Send the combined text before cancelling the earlier queued receipt; refusal leaves the old receipt and new draft intact. `libs/frontend/chat-ui/src/lib/molecules/lane-composer.component.ts:239-284` | `lane-composer.component.spec.ts`: refused combined send keeps draft and never calls cancel; accepted send cancels afterward. |
| N2 | Track a computed primitive of status and delivery modes, so unrelated agent-map updates do not trigger the effect. `lane-composer.component.ts:105,140-147` | `lane-composer.component.spec.ts`: ten unrelated updates issue no preview RPCs; one status change issues queue and now previews. |
| #9 | Use `displayName` for the lane thread label, falling back to CLI. `libs/frontend/chat/src/lib/components/organisms/transcript/lane-transcript.component.ts:103` | `lane-transcript.component.spec.ts`: report thread shows the display name. |
| #14 | Remove cached previews for agent IDs that leave the store. `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:1879-1886` | `agent-monitor.store.spec.ts`: clearing a completed agent removes its preview. |
| N3 | Attribute unmatched user-role spawn prompts to the parent. `libs/frontend/chat/src/lib/components/organisms/transcript/lane-thread.ts:32` | `lane-thread.spec.ts`: unmatched prompt says Parent agent; receipt-backed user entry says You. |
| N4 | Keep install status and show Error or Initializing as an instance subline badge. `libs/frontend/chat/src/lib/settings/ptah-ai/cli-matrix-rows.ts:125,431`; `ptah-cli-instances.component.ts:169-171` | `cli-matrix-rows.spec.ts`: both runtime statuses remain distinct from Installed. |
| N5 | Keep user message bubbles in the transcript. `lane-transcript.component.ts:52-78` | `lane-transcript.component.spec.ts`: prompt bubble stays visible with the communication thread. |
| N6 | Clear stale focus state on mount or missing focus target; close the menu after confirmation. `lane-composer.component.ts:137,154-158,212-216` | `lane-composer.component.spec.ts`: confirmation closes the menu; existing Escape focus test remains. |
| N7 | Keep one queued Edit action with a Pencil icon and descriptive accessible name. `lane-composer.component.ts:68-73` | `lane-composer.component.spec.ts`: one distinct Edit action and no duplicate Cancel. |
| Verify repair | Correct the failed completion event kind used by its border styling. `libs/frontend/chat/src/lib/components/molecules/lane-event/lane-event-row.component.html:60` | Angular template typecheck in the required verify run. |
| Test alignment | Update matrix expectations to the reviewed install status and give the wrapper-component mock the composer status signal and receipt API. `libs/frontend/chat/src/lib/settings/ptah-ai/cli-orchestration-matrix.component.spec.ts:499-506,1286-1339`; `agent-continue-input.component.spec.ts:28-37,79-130` | Both suites pass in isolation: 68 tests. |

## Decisions

- Retained the queued Edit action because it returns queued text to the draft, matching its actual behavior. Removing the duplicate Cancel action is reversible.
- Preserved the separate communication thread and restored in-place user bubbles, as the re-review requests. This is reversible.

## Verification

- `npm run verify -- -p @ptah-extension/chat-streaming,@ptah-extension/chat-ui,@ptah-extension/chat,@ptah-extension/canvas -- --output-style=static`: exit 0. Lint and Angular typecheck passed for all four projects (warnings only).
- Tests: chat-streaming 34 suites / 841 passed / 1 skipped; chat-ui 111 suites / 1905 passed; chat 343 suites / 6110 passed / 2 skipped; canvas 28 suites / 590 passed. The chat run warned that one worker required forced teardown after all tests passed.
- First verify run exposed a prior-round template kind mismatch and stale matrix and wrapper-component tests; all were corrected. Focused rerun of the two failing suites: 68 passed.
- Scoped Ptah diagnostics timed out twice while TypeScript checked; the required verify run's Angular typechecks completed without errors.
- Browser screenshot: unavailable because this lane may not run build, serve, or dev targets.

## Remaining limits

- No failing checks. Browser screenshot was unavailable because this lane was prohibited from running build, serve, or dev targets.
