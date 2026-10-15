# Code Logic Review — Phase C (voice) — `TASK_2026_678_9083`

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 1 |
| Moderate issues | 3 |
| Minor issues | 0 |
| Failure modes found | 4 |
| Reviewer family | grok |
| Implementer family | codex |
| Range | `0c9ca43a9..48d2fafee` (voice files only) |

The score is 6 because barge-in, the roster gate, spoken-text limits, TTS revocation, and narrator dedupe hold on the paths the batch tests, and a 7 would require the turn serializer to survive mute, stop, and exit. A 5 would require the playback or Amendment A1 path itself to be wrong. Orchestrator evidence used as given: scoped test, typecheck, and lint for `@ptah-extension/command-center` (102 tests) and a degradation audit exit 0. This review did not re-run them.

## Five logic questions

### 1. How does this fail silently?

`finishTurn` after a failed in-flight `coordinator.send` writes `listening` even when `stop` or `exit` already released the microphone (`command-voice-loop.ts:335`, `command-voice-loop.ts:404-407`). The page shows a live voice state with no capture. A discarded utterance still produces a clip (`pcm-capture.ts:132-136`, `pcm-capture.ts:104-112`), so a short burst can open a transcribe the VAD meant to drop.

### 2. What user action produces unexpected behaviour?

Mute or stop while `coordinator.send` is in flight, then start voice again before that turn settles. `onTurnBoundary` speaks the pre-mute answer into the new session and clears `busy` under the new utterance (`command-voice-loop.ts:349-356`, `command-voice-loop.ts:396-407`).

### 3. What input data produces a wrong answer?

A second owned-node transition to `running` after `starting` was already drained. Both states are spoken as "started" (`status-narrator.ts:59-62`). A one-quantum tail after `discardUtterance` is a legal `PcmClip` and is transcribed (`command-voice-loop.ts:185-186`).

### 4. What happens when a dependency fails?

Transcription, synth, and playback failures toast and do not send a turn (`command-voice-loop.ts:294-300`, `tts-playback-queue.ts:101-106`, `tts-playback-queue.ts:131-140`). The failure that is mishandled is a `send` that returns false after `stop`/`exit`: the catch and the false branch call `finishTurn`, which overwrites the stopped state. Synth failure on the first chunk also deletes the only latency origin (`command-voice-loop.ts:87-91`).

### 5. What is missing that the requirements never mentioned?

Nothing material inside the voice units beyond the generation token on asynchronous tails. Page lifecycle wiring is Task 14.2 (D35) and is not a defect here.

## Findings

### Serious

#### S1 — Turn generation does not cover send, the turn boundary, or finishTurn

- File: `libs/frontend/command-center/src/lib/voice/command-voice-loop.ts:288-293`, `command-voice-loop.ts:335`, `command-voice-loop.ts:349-356`, `command-voice-loop.ts:396-407`, `command-voice-loop.ts:410-414`, `command-voice-loop.ts:438-441`
- Scenario: Voice is active and `onClip` has passed the generation check and is inside `await this.coordinator.send(transcript)` (`command-voice-loop.ts:335`). The user mutes. `mute` bumps `generation`, sets `busy` and `active` false, and releases the send lock (`command-voice-loop.ts:410-414`, `session-coordinator.ts:187-190`). The user starts voice again (`generation` advances, `active` is true) and speaks a new command, so a second `onClip` sets `busy` and awaits transcribe. The first `send` then settles. If it returns true, the loop leaves `busy` set and waits for the page. When the page calls `onTurnBoundary(oldReply)` — the contract for that in-flight turn — the method only checks `this.active` (`command-voice-loop.ts:350`). The new session is active, so the loop speaks the pre-mute reply with `currentReplyOrigin` from the new utterance, then `finishTurn` sets `busy` false and may start `queuedClip` while the new transcribe or send is still running. Two `coordinator.send` calls overlap. If the first `send` returns false instead, `finishTurn` still runs with no generation check. After `stop`, `release` has set `active` false and `coordinator.stop` has set `stopped` (`command-voice-loop.ts:454`, `session-coordinator.ts:210-212`); `finishTurn` then executes `setVoiceState(this.muted ? 'muted' : 'listening')` because `stop`/`exit` leave `this.muted` false (`command-voice-loop.ts:404-407`). The UI returns to listening after the mic was released.
- Fix: Stamp `turnGeneration` when a clip is accepted and pass it through `send`. After every await, return without `finishTurn` when `generation` has moved. Ignore `onTurnBoundary` unless `active` and `turnGeneration === this.generation`. Make `finishTurn` return immediately when `!this.active`, and do not write `listening` over `idle`/`stopped`.

### Moderate

#### M1 — discardUtterance still publishes a clip

- File: `libs/frontend/command-center/src/lib/voice/pcm-capture.ts:41-44`, `pcm-capture.ts:104-112`, `pcm-capture.ts:132-136`, `pcm-capture.ts:138-144`; `command-voice-loop.ts:185-186`, `command-voice-loop.ts:268-273`
- Scenario: VAD returns `discard`, or `end` while `bargeInCandidateAt` is set, and the loop calls `discardUtterance`. That clears `chunks` and posts `'end'`. The worklet posts `frame` before `samples` in the same quantum (`pcm-capture.ts:41-44`), and the discard runs inside the `frame` handler, so the matching `samples` message is still queued. The handler appends it (`pcm-capture.ts:104-107`). The later `end` message calls `finishClip`, `sampleCount` is 128 or more, and `onClip` receives a WAV. The loop transcribes every non-null clip (`command-voice-loop.ts:185-186`). A provider error toasts "Transcription failed" for a burst playback was required to ignore. A non-empty hallucination calls `coordinator.send` or, if a turn is already `busy`, occupies the single `queuedClip` slot (`command-voice-loop.ts:282-284`).
- Fix: Give each utterance an id. `discardUtterance` bumps it and posts `'end'` with that id. Ignore `samples` and `end` whose id was discarded, and call `onClip(null)`.

#### M2 — First-chunk synth failure drops the only latency origin

- File: `libs/frontend/command-center/src/lib/voice/command-voice-loop.ts:87-91`, `command-voice-loop.ts:387-390`, `command-voice-loop.ts:96-110`
- Scenario: A reply splits into two chunks. `speak` stores `ReplyOrigin` only on the first mark. `voice:synthesize` throws for that chunk. The catch splices the first mark whose `text` matches, which is the origin, and rethrows. The second chunk plays with `origin: null`, so `getLatencyMarks()` gains no sample for audio the user heard. B18's end-of-utterance to first-play series misses that reply. If two chunks share the same text, `findIndex` removes the earlier mark.
- Fix: Key marks by an id returned from `enqueue`, and on failure of chunk N move `origin` to the next unplayed mark of that reply. Record the sample on the first `play()` that resolves.

#### M3 — starting and running are both spoken as "started" once a boundary has drained the first

- File: `libs/frontend/command-center/src/lib/voice/status-narrator.ts:39-41`, `status-narrator.ts:53-68`, `status-narrator.ts:74-80`
- Scenario: An owned `child:`, `cli:`, `sdk:`, or `lane:` node moves to `starting`. `onTurnBoundary` runs `drain` before the node reaches `running`, so the key `root\0id\0starting` is stored in `delivered` and the user hears "Worker started." A later projection sets `running`. The pending filter only keeps items whose state still matches (`status-narrator.ts:39-41`), so it does not apply to a key already delivered. The new key differs by state, and the spoken action for both states is `started` (`status-narrator.ts:59-62`). The next boundary speaks "Worker started." again for the same work item. AC12 says a duplicate notification is not narrated. Transitions that arrive before any drain collapse to one item; the defect is the boundary between the two states.
- Fix: Dedupe the spoken start on `{root, workId}` for `starting` and `running`, and reserve a new utterance for `completed` and `failed`.

## Checked and not filed

- Barge-in default. With no `isIndependentSpeech`, independence is true and playback onset uses `playbackStartMs` (300) plus the 250 ms RMS gate (`vad.ts:64-66`, `command-voice-loop.ts:221-239`). A burst that ends before that gate does not call `bargeIn` (`command-voice-loop.ts:252-258`). The spec pins stop at t=552 and no stop for the short burst. This matches the Batch 10 fix round. The extra 250 ms after VAD `start` is the sustained-onset rule the tests lock.
- Echo request. `getUserMedia` asks for `echoCancellation`, `noiseSuppression`, and `autoGainControl` (`pcm-capture.ts:76-81`). The worklet does not copy input to the output buffer.
- One queued utterance. A clip that arrives while `busy` is stored with `??=` and later clips are dropped (`command-voice-loop.ts:282-284`). That is the batch rule.
- Amendment A1. `pendingRoster` returns before `answerOrdinaryQuestion` and `coordinator.send` (`command-voice-loop.ts:307-313`). The loop never posts the answer `"Confirm"`. `onRosterResolved` clears the flag (`command-voice-loop.ts:371-373`). Tool approval returns without `send` (`command-voice-loop.ts:327-333`). Calling these methods is the page's Task 14.2 work (D35); the methods themselves honor the gate.
- TTS queue. Submission order waits on `pending[0]` (`tts-playback-queue.ts:113-118`). `inFlight` stops at 2 (`tts-playback-queue.ts:81-82`). `stopAll` bumps `generation` and revokes the current object URL (`tts-playback-queue.ts:71-78`, `tts-playback-queue.ts:147-149`). `fail` is one-shot per clip via `settled` (`tts-playback-queue.ts:122-135`). A synth rejection after `stopAll` does not call `onFailure` (`tts-playback-queue.ts:103-106`).
- Spoken text. Fences, tool-call lines, raw links, `sk_live_` / `ghp_` / `AKIA` shapes, and 32-character tokens are removed (`spoken-text.ts:33-44`). Four sentences or 600 characters, status 180, and the cue match `spoken-text.spec.ts`. A bullet outside an open diff is kept (`spoken-text.ts:14-22`).
- Narrator scope. Ownership is the parent walk from the root (`status-narrator.ts:25-38`). The root row is skipped (`status-narrator.ts:44`). Prefixes outside `phase:`, `tribunal:`, `child:`, `cli:`, `sdk:`, and `lane:` are ignored (`status-narrator.ts:45-51`). `drain` runs from `onTurnBoundary` (`command-voice-loop.ts:354`). A changed state drops a still-pending line (`status-narrator.ts:39-41`). `mute` leaves `active` false, so a boundary during mute does not drain (`command-voice-loop.ts:350`).
- Resource release on a single call. `PcmCapture.stop` closes the port, disconnects, stops tracks, closes the context, and revokes the module URL (`pcm-capture.ts:185-198`). `mute` / `release` call it (`command-voice-loop.ts:423-424`, `command-voice-loop.ts:452-453`). Oversize audio fails the 18 MB check and becomes a null clip (`pcm-capture.ts:106-111`, `pcm-capture.ts:139-144`).
- Degradation audit shape. The voice catches rethrow (`pcm-capture.ts:116-118`, `command-voice-loop.ts:86-92`) or carry a `degradation-audit: reported` marker and a user-visible toast (`command-voice-loop.ts:146-152`, `command-voice-loop.ts:191-198`, `command-voice-loop.ts:336-343`, `tts-playback-queue.ts:101-106`, `tts-playback-queue.ts:141-143`).
- `AudioContext.resume` is not required on this host. `BrowserWindow` does not set `autoplayPolicy` (`apps/ptah-electron/src/windows/main-window.ts:123-129`). Electron's default is `no-user-gesture-required` (`node_modules/electron/electron.d.ts:19419-19422`).

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| The 550 ms playback gate is intended sustained onset, so it is not a finding | (a) accept the spec timing; (b) file the extra 250 ms as late barge-in | `command-voice-loop.spec.ts` expects no `bargeIn` at t=301 and one call at t=552; Batch 10 verification describes this default | yes |
| Missing `AudioContext.resume` is not a finding on Electron | (a) follow Electron's default autoplay policy; (b) file a suspended-context failure | `electron.d.ts:19420`; `main-window.ts:123-129` | yes |
| Page-not-wired behaviour is out of this review | (a) follow D35; (b) file every unwired call | `batches.md` D35 and Batch 10 verification | yes |

## Verdict

- Recommendation: REVISE
- Confidence: HIGH on S1 (sequential mute, restart, and a late `onTurnBoundary` / failed `send`). MEDIUM on M1's user-visible toast, because a one-quantum silence clip may transcribe as empty. HIGH on the code path that emits the clip.
- Top risk: After mute or stop, an in-flight turn still speaks, clears `busy`, or paints `listening`, so the next utterance is not serialized and stop looks like it did not stick.

Verdict: NEEDS_REVISION
