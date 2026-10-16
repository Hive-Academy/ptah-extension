# Phase E round 3 — voice playback state

## Change

`tts-playback-queue.ts:50-58,79-86,124-158` now exposes pending audio and reports playback start after `play()` succeeds, and end when the final queued clip finishes or playback is stopped. `command-voice-loop.ts:142-153,284-339,510-550` drives `speaking` from that notification, keeps `thinking` during synthesis, and avoids mic-frame or turn-completion resets while audio is pending. Existing barge-in and mute/stop paths cancel the queue; the callback returns to listening only for an active, unmuted, settled loop.

| Moment | Before | After |
| --- | --- | --- |
| Reply enqueued, synthesis pending | `speaking`, then often `listening` | `thinking` |
| Audio starts | Often remains `listening` | `speaking` |
| Mic frames or gap between queued clips | Could reset to `listening` | Remains `speaking` |
| Last clip ends | No reliable state change | `listening` when no turn is pending |
| Barge-in, mute, stop | Playback cancelled | `listening`, `muted`, `stopped` respectively |

## Specs and verification

`tts-playback-queue.spec.ts:72` covers delayed synthesis, playback notification and final queued completion. `command-voice-loop.spec.ts:10-134` covers thinking during synthesis, speaking across mic frames, listening after playback and barge-in, plus mute and stop during playback.

Scoped `ptah_get_diagnostics` first returned no diagnostics in the four touched files; it also reported 17 errors in sibling files outside this lane. A second scoped diagnostics call timed out after 45 seconds and did not produce a new result. Nx, Jest, build, serve, e2e and package commands were not run, per task instruction.

## Files changed

- `libs/frontend/command-center/src/lib/voice/tts-playback-queue.ts`
- `libs/frontend/command-center/src/lib/voice/command-voice-loop.ts`
- `libs/frontend/command-center/src/lib/voice/tts-playback-queue.spec.ts`
- `libs/frontend/command-center/src/lib/voice/command-voice-loop.spec.ts`
- `.ptah/specs/TASK_2026_678_9083/reports/phase-e-r3-voice-report.md`

## Decisions

- Use the queue's `play()` resolution as playback start. The existing `PlaybackHandle` API has no earlier audible-start event. This is reversible if the handle gains a media event later.
- Keep `speaking` across gaps between queued chunks because the reply is still pending; end it when the queue empties. The review requires the state through the last queued chunk. This is reversible.

## Not done

- Automated tests were not run because the task prohibits Nx/Jest and assigns verification to the orchestrator.
- Sibling diagnostic errors were not edited because those files are outside this lane's ownership.
