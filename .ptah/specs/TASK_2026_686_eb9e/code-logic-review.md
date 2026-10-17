# Code Logic Review — `TASK_2026_686_eb9e`

Review family: Anthropic (reviewer); implementers: codex lanes (plus two one-line spec corrections by the orchestrator).

Scope: the uncommitted working-tree diff in `D:/projects/ptah-extension/.claude-worktrees/command-center-review` (21 files), plus the new `command-center-tribunal-intent.ts` and its spec. I read each changed source file, the touched specs, and the surrounding code: `CommandCenterSendLockService`, `sendQueuedMessage`/`sendOrQueueMessage`, `TribunalRunCoordinator.confirmEntry`, `summarizeVoiceProviders`, and the projection computed. I ran no Nx, Jest or tsc, as instructed.

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 6/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 1              |
| Moderate issues     | 4              |
| Failure modes found | 7              |

Per item: A1, A2, A4, B2, C1, C2 and C4 close their findings with no regression found. A3 closes its finding, with a minor ordering caveat. B3 and C5 close theirs, each with a moderate edge. C3 closes the quoted example ("fix the race condition") but is still imprecise in both directions. B1 closes the finding but introduces a new defect (S1).

Why 6 and not 7-8: B1 is a straight regression. The new `aboveSince` retention is unbounded, so onset no longer requires contiguous energy, and the new specs only cover a dip lasting a single frame. Why not 4-5: the other eleven items are sound, and the single serious defect is local and cheap to fix.

## Five logic questions

### 1. How does this fail silently?

- VAD (`vad.ts:73`): after an utterance ends in a room whose RMS never drops below `noiseFloor` (0.008), `aboveSince` stays set forever. The next single loud frame fires `'start'` immediately, with a stale `speechSince`. No error is raised; the user simply gets phantom utterances or false barge-ins.
- Intent routing (`command-center-tribunal-intent.ts:3-9`): a genuine Tribunal request that does not match, for example "have a council review this" or "race codex against claude", falls through to an ordinary `coordinator.send`. The root model receives it with no roster-request tag, so no proposal card appears. Nothing tells the user the request was not treated as a Tribunal request.
- Narrator (`status-narrator.ts:39`): the baseline condition is `previous.size === 0`, not "first observation". See M2.

### 2. What user action produces unexpected behaviour?

- Typing "run the race condition tests" or "the tribunal panel crashes on open" injects a Tribunal roster request, or is refused with "Start a Command Center session before requesting Tribunal". The spec bakes the first case in as expected (`command-center-tribunal-intent.spec.ts`: `'start a race condition investigation' -> true`).
- Releasing the send lock (Command Center page exit) on an idle root with queued text now sends that text immediately. This is the intended fix. Be aware that text queued while the lock was held is delivered at page exit, not at some later turn.

### 3. What input data produces a wrong answer?

- VAD: a mid-band stretch (0.008 <= rms <= 0.02) followed by a loud frame. See S1.
- Projection (`command-center-projection.source.ts:26-29`): a manifest `startedAt` in the future (clock skew, or a manifest from another machine) gives `now - startedAt < 0`, so it stays `'starting'` forever. This is the finding being fixed, in its mirror-image form.
- Projection: the 2-minute launch window is judged from `startedAt` alone. A run whose lanes legitimately take longer than 2 minutes to appear, for example a root turn queued behind a long turn, shows `'unknown'` until the first agent arrives. The state self-heals, so this is cosmetic.

### 4. What happens when a dependency fails?

- C1: a rejected `discoveryComplete()` leaves `discoveryCompleted` false and returns a retryable `discovery-failed`. A retry awaits discovery again, which is the same behaviour as before. Once discovery succeeds, createTask, writeManifest and sendLaunchTurn failures retry without re-awaiting. The `inFlight` entry is deleted on both fulfil and reject (`tribunal-run-coordinator.ts:136-139`). Correct.
- A3: `sendQueuedMessage` already handles a missing session, a failed send and a thrown send by restoring the queue (`message-dispatch.service.ts:277-306`). The new effect calls it with `void`, which is safe because the method catches internally.
- A1: `accessSync` throwing is caught by the existing `catch` and returns false, so the next argv candidate is tried.

### 5. What is missing that the requirements never mentioned?

- No spec for A1 (`bootstrap.ts`). The predicate is an inline closure and is untested, as it was before. Windows `X_OK` is equivalent to `F_OK`, so the check is only effective on POSIX.
- No VAD spec for a long mid-band stretch, or for onset after `end`.
- No intent-spec cases for common Tribunal phrasings beyond verb + move ("have a council", "race X against Y", "spin up a forge").
- No test that C5's `'starting'` to `'unknown'` flip is reactive (see M1).

## Failure modes

### VAD phantom onset after mid-band noise (regression from B1)

- Trigger: speech or a loud frame, followed by sustained noise with `noiseFloor <= rms <= speechThreshold`, followed by any single frame above `speechThreshold`.
- Symptom: `processFrame` returns `'start'` on that single frame. `speechSince` is the stale `aboveSince`, so the later `end` is computed over a bogus duration and a click or cough is classified as a valid utterance instead of `'discard'`. In `playbackMode` (barge-in), TTS echo that sits in the mid-band with an occasional peak triggers a false barge-in and cuts TTS.
- Evidence: `vad.ts:61-63` (`aboveSince ??=`), `vad.ts:73` (reset only when `rms < noiseFloor`), `vad.ts:79-83` (`end`/`discard` does not clear `aboveSince`), and `vad.spec.ts` (the new cases use a single mid-band frame at `onset/2`).
- Current handling: `aboveSince` survives indefinitely through mid-band frames, and survives the end of an utterance. Before the change, any below-threshold frame reset it, so the stale-state window was zero.
- Recommendation: bound the tolerance. Reset `aboveSince` once the contiguous below-speechThreshold run exceeds a small dip allowance (for example `min(onset / 2, 60ms)`, tracked via `belowSince`). Also set `aboveSince = null` in the `end`/`discard` branch. Add specs: (a) loud frame at 0, mid-band frames to 2000 ms, loud at 2000 means null; (b) after `end` through mid-band hangover, one loud frame means null.

### Narrator baseline is size-based, not observation-based

- Trigger: `observe(root, nodes)` where `nodes` does not yet contain the root (so `owned` is empty), or where the owned tree momentarily empties.
- Symptom: the next observation that contains root plus already-running children becomes the silent baseline, so genuinely new work that arrived in that gap is not narrated.
- Evidence: `status-narrator.ts:39-42`.
- Recommendation: use an explicit `baselined` boolean, set only once the root node has been observed. This also removes the dependence on `previous.size`.

### Projection state is a non-reactive clock read

- Trigger: a persisted manifest with no matching agents, and no other signal change after the window elapses.
- Symptom: the `tribunal:` node stays `'starting'` past 2 minutes until some unrelated dependency of the `projectOwnedWork` computed invalidates it.
- Evidence: `command-center-projection.source.ts:23-29` and `:186`, with `Date.now()` as a default parameter; the consuming `computed` at `command-center-page.controller.ts:~236` has no time signal.
- Recommendation: add a coarse clock signal (a 30 s timer or a `now` signal owned by the page) that the projection reads, or document the lazy semantics. Also clamp with `Math.max(0, ...)` or `Math.abs` for future `startedAt`.

### Tribunal intent false positives

- Trigger: "run the race condition tests", "launch the relay server", "start the forge build", "the tribunal panel crashes".
- Symptom: a roster request is injected, or the send is refused when there is no session.
- Evidence: `command-center-tribunal-intent.ts:4-9`. `\b(?:run|start|...)\s+(?:the\s+)?(?:race|...)\b` has no negative lookahead for a following noun, and the bare `\btribunal\b` alternative matches any mention. The spec fixes this in place (`'start a race condition investigation' -> true`).
- Recommendation: either accept this and say so, or require the move to be the head noun: no trailing `\s+(condition|server|build|...)`, or require a following preposition or end of clause.

### Tribunal intent false negatives

- Trigger: "have a council review this", "get a council on it", "race codex against claude", "kick off a forge", "spin up a crucible", "hold a council", "run 3 councils". Also "Review with Council", which the old regex matched and which the new spec asserts as `false`.
- Symptom: an ordinary send, with no proposal card.
- Evidence: `command-center-tribunal-intent.ts:4-9` (verb list is only run/start/launch/convene/begin; "running" does not match `\brun\b`).
- Recommendation: widen the verb list (kick off, spin up, hold, have, get, call, open, initiate, fire up, use, do, "let's") and allow a plural. A false negative is silent for the user, so lean on recall.

### A3 flush ordering window

- Trigger: lock release, then a user send before the effect runs (effects flush on the next change-detection tick).
- Symptom: the new text is sent directly because the tab is idle and unlocked, and then the older queued text is flushed afterwards, so order is inverted.
- Evidence: `message-dispatch.service.ts:130-152` and the `sendOrQueueMessage` branch at `:215-220`.
- Current handling: none. The window is one tick, so it is unlikely in practice. Rating Minor.
- Recommendation: acceptable as is. Optionally, `sendOrQueueMessage` could treat a non-empty `queuedContent` on an idle tab as "queue and flush".

### A3 same-tick engage and release is not observed

- Trigger: `engage` and `release` inside one tick, with queueing in between.
- Symptom: no flush, because the effect only sees the net state.
- Evidence: `message-dispatch.service.ts:129-135` (`previous` is only updated per effect run).
- Rating Minor. Not a realistic path: the lock is page-lifetime.

## Blocking issues

None.

## Serious issues

### S1. B1 introduces an unbounded onset tolerance and stale `speechSince` in the VAD

- File: `libs/frontend/command-center/src/lib/voice/vad.ts:73` (together with `:61-63` and `:79-83`)
- Scenario: the user finishes speaking, the room noise sits in the 0.008-0.02 band (typical office or fan noise; the default `noiseFloor` is only 0.008), and later one loud frame arrives (click, cough, TTS echo peak).
- Impact: a spurious `'start'` fires immediately. In `playbackMode` this is a false barge-in that interrupts the assistant's speech. Utterance timing is wrong because `speechSince` is the stale onset. The review item asked for tolerance to mid-band dips, not for onset that never expires.
- Fix: see "VAD phantom onset" above. Bound the dip length, clear `aboveSince` on `end`/`discard`, and add the two missing specs.

## Moderate and minor issues

- M1 (Moderate). `command-center-projection.source.ts:26-29`: non-reactive `Date.now()` inside a signal-derived projection, and negative-age handling. See "Projection state is a non-reactive clock read".
- M2 (Moderate). `status-narrator.ts:39`: `previous.size === 0` is used as "first observation". See above.
- M3 (Moderate). `command-center-tribunal-intent.ts:4-9`: both false positives and false negatives. The spec documents one false positive as correct and one recall regression ("Review with Council") as correct, so the spec cannot catch either.
- M4 (Moderate). `message-dispatch.service.ts:129-135`: the effect ignores same-tick transitions. Ordering caveat above. Both Minor on their own; grouped here.
- m1 (Minor). `apps/ptah-electron/src/activation/bootstrap.ts:210-214`: no spec; `X_OK` is a no-op on Windows.
- m2 (Minor). `chat-rpc.schema.ts:67-70`: `options: null` is now rejected by `z.object(...).optional()` (it used to pass through the passthrough root). Confirm no host sends `options: null`; the webview and CLI service callers I found send an object or omit it.
- m3 (Minor). `voice-provider-summary.ts:15`: an unrecognised provider id now maps to `'local'` and can read ready, where the removed inline rule treated it as not ready. Not reachable with the current config union.
- m4 (Minor). `chat-rpc.schema.spec.ts`: the diff includes a large prettier-style reflow of pre-existing tests. No assertion was weakened (I compared the reflowed `bounds %s systemPrompt` and resync-list cases), but it inflates the diff.

## Data flow

1. A1: argv candidate to `statSync.isDirectory` to `accessSync(R_OK|X_OK)` to workspace chosen. OK. On failure, `catch` returns false and the next candidate is tried.
2. A2: renderer `chat:start` params to `ChatStartParamsSchema.parse` (`options.systemPrompt` bounded at 16 KiB, passthrough kept). OK, and the schema spec covers the max length, max+1 and non-string cases.
3. A3: lock `state` signal to effect, which compares `previous` with `current`, requires `released.active && !isHeld(rootTabId)`, then looks up the tab across workspaces, requires non-blank `queuedContent` and not busy, then `sendQueuedMessage`. OK. That method re-checks the lock, clears the queue synchronously before awaiting, and restores on failure, so there is no double send.
4. B1: PCM frame to RMS to `active` / mid-band / silence. Gap: S1.
5. B2: `config.data.config` to `summarizeVoiceProviders` to `store.setProvider(summary)`, with `transcription`/`synthesis` read from the summary. OK. The spec asserts the full object including `stt`/`tts`.
6. B3: `observe` to owned-tree walk to silent baseline when empty, otherwise diff. Gap: M2.
7. C1: `confirm` to `confirmEntry`, with `discoveryCompleted` recorded after `await discoveryComplete()`. OK. Retry skips the wait; `writeManifest` is re-run with the same `runId` after the rollback; `sendLaunchTurn` is retried.
8. C3: `sendCommand` to `hasTribunalIntent` to either the ordinary send or the tagged request. Gap: M3.
9. C4: `confirmProposal` to `tribunal.confirm` to `pendingProposal` cleared on `ok || !retryable`. OK. The new spec confirms no repeated toast after a non-retryable failure.
10. C5: manifest to `runState(agents, startedAt)`. Gap: M1.

## Requirements fulfilment

| Requirement                                       | Status   | Gap                                                           |
| ------------------------------------------------- | -------- | ------------------------------------------------------------- |
| A1 argv access check                              | COMPLETE | No spec; Windows `X_OK` is a no-op                            |
| A2 16 KiB limit on chat:start                     | COMPLETE | None                                                          |
| A3 flush on idle lock release                     | COMPLETE | One-tick ordering window (Minor)                              |
| A4 unused helper removed                          | COMPLETE | None                                                          |
| B1 VAD onset survives mid-band dips               | PARTIAL  | Dips are now unbounded and the state is stale after `end` (S1) |
| B2 `summarizeVoiceProviders` in start             | COMPLETE | None                                                          |
| B3 silent baseline                                | COMPLETE | Size-based baseline (M2)                                      |
| C1 retry without second pulse                     | COMPLETE | The cancel-in-discovery spec was replaced by cancel-in-launch; cancel during the first discovery is still covered by the earlier cancel specs |
| C2 hint removed                                   | COMPLETE | None                                                          |
| C3 explicit Tribunal intent                       | PARTIAL  | False positives and negatives (M3)                            |
| C4 clear card on non-retryable failure            | COMPLETE | None                                                          |
| C5 stale manifest not `starting`                  | PARTIAL  | Non-reactive clock, future `startedAt` (M1)                   |

Implicit requirements not addressed: reactive time-based state, long-stretch VAD behaviour, and intent recall for natural phrasings.

## Edge cases

| Case                                                       | Handled | How                                                         | Concern                                   |
| ---------------------------------------------------------- | ------- | ----------------------------------------------------------- | ----------------------------------------- |
| Single mid-band frame inside onset                         | YES     | `aboveSince` kept                                           | Spec covers this case only                |
| Long mid-band stretch then a loud frame                    | NO      | Immediate `'start'`                                         | S1                                        |
| Loud frame after an utterance ended in mid-band hum        | NO      | Stale `aboveSince` and `speechSince`                        | S1                                        |
| Lock rekey while queued text exists                        | YES     | `isHeld(rootTabId)` stays true, effect returns              | None                                      |
| Lock released, tab streaming                               | YES     | `isTabBusyGenerating` returns early, turn-end flush later   | None                                      |
| Lock cleared because the root tab was closed               | YES     | `findTabByIdAcrossWorkspaces` is undefined, no flush        | None                                      |
| Lock replaced by another owner on the same root            | YES     | `isHeld` true for the new owner                             | None                                      |
| Queued text but no `claudeSessionId` at release            | YES     | `sendQueuedMessage` warns and keeps the text queued         | Message stays until the next trigger      |
| Confirm retry after launch-send failure                    | YES     | Skips discovery, reuses `runId`                             | None                                      |
| Confirm retry after discovery failure                      | YES     | Re-awaits discovery (unchanged)                             | Could wait on a pulse that never comes    |
| Non-retryable confirm failure                              | YES     | Card cleared, no repeat toast                               | None                                      |
| First narrator observation with root present               | YES     | Silent baseline                                             | None                                      |
| First narrator observation with root absent                | NO      | Next observation is swallowed                               | M2                                        |
| Manifest with future `startedAt`                           | NO      | Stays `starting`                                            | M1                                        |
| "run the race condition tests"                             | NO      | Treated as a Tribunal request                               | M3                                        |
| "have a council review this"                               | NO      | Ordinary send                                               | M3                                        |

## Verdict

- Recommendation: REVISE (NEEDS_REVISION)
- Confidence: HIGH on S1 (traced by hand over concrete frame sequences), MEDIUM on M1 (depends on how often other signals invalidate the computed), HIGH on M3.
- Top risk: the B1 fix swaps one VAD bug for another. Onset no longer requires contiguous energy, and `aboveSince` is not cleared when an utterance ends, so noisy rooms get phantom starts and false barge-ins.
- What a robust implementation would add: a bounded dip tolerance and `aboveSince` cleared on `end`/`discard`, with the two missing VAD specs; an explicit `baselined` flag in the narrator; a reactive clock (or documented laziness) plus negative-age clamp for the run launch window; a broader verb list and a head-noun check for the intent matcher, with recall specs; a unit test for the A1 predicate.
