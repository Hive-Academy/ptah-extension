# Batch 9 report

## Implementation

- **9.1 VAD:** `vad.ts:13,42` implements frame-driven RMS onset, playback onset, hangover, minimum utterance and noise floor. Adapted property-hub's energy thresholds and onset/offset state machine; removed its Angular injection token, AudioContext and timer because Batch 9 requires a pure frame-driven unit. `vad.spec.ts:6` covers silence/noise, a real utterance, a short click and sustained playback onset.
- **9.2 Sentence chunker:** `sentence-chunker.ts:13,32` adapts property-hub's incremental buffer and markdown cleanup. It adds abbreviation and decimal handling across token boundaries, Unicode sentence endings and a hard maximum chunk size. `sentence-chunker.spec.ts:3` adapts the source scenarios for progressive delivery, short fragments, Arabic/Urdu punctuation, forced splitting, flushing and markdown; it adds abbreviation/decimal coverage.
- **9.3 Playback queue:** `tts-playback-queue.ts:36,71,97,113` adapts property-hub's ordered playback and stop behavior. Synthesis now belongs to the queue, with two requests in flight, generation invalidation, injected synth/audio factories, object URL cleanup and a failure callback that receives the original text. `tts-playback-queue.spec.ts:13` covers out-of-order synthesis, the concurrency cap, all four invalidation paths, URL revocation and playback failure.
- **9.4 Spoken-text filter:** `spoken-text.ts:6` is a pure helper following the no-transport helper style of `voice-input.service.ts`. It strips fenced code, diffs, tool text, raw links and secret-shaped tokens, then caps reply/status speech with the required cue. `spoken-text.spec.ts:3` covers a code-heavy reply, a secret-shaped token and both caps.

## Files created

- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/vad.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/vad.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/sentence-chunker.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/sentence-chunker.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/tts-playback-queue.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/tts-playback-queue.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/spoken-text.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/voice/spoken-text.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/.ptah/specs/TASK_2026_678_9083/reports/batch-9-report.md`

## Verification and degradation audit

- `npx prettier --check` output: **All matched files use Prettier code style!**
- Scoped `ptah_get_diagnostics`: no diagnostics in the eight requested files. Seven existing sibling errors were reported in `tribunal-run-coordinator.spec.ts` and `capability-id-codec.ts`; those files are outside batch ownership.
- Jest/Nx were intentionally not run in this lane; the orchestrator owns the scoped check.
- `tts-playback-queue.ts:101` catch: `degradation-audit: reported` marker; current-generation synthesis failures call `onFailure` with text and error. A superseded generation is discarded.
- `tts-playback-queue.ts:139` catch: `degradation-audit: reported` marker; audio factory failures call `onFailure` with text and error, then revoke the URL.
- Playback promise rejection and audio-element error use explicit callbacks in `tts-playback-queue.ts:128-141`, call `onFailure`, and revoke the URL. There are no other non-spec catch sites.

## Decisions

- **VAD seam:** chose a caller-fed `Float32Array` and timestamp over the property-hub AudioContext timer. Batch 9 explicitly requires a pure frame-driven detector; reversible when the Task 10 capture layer integrates it.
- **Queue contract:** chose `enqueue(text)` with injected synthesis and audio factory over property-hub's `enqueue(blob)`. Batch 9 requires the queue to bound synthesis and preserve submission order; reversible at the Task 10 integration seam.
- **Speech filter:** chose `toSpokenText(text, kind)` over transport-specific filtering. AC24 and Batch 9 require a pure assistant-text boundary; reversible by changing only Task 10's call site.

## Outstanding

- Orchestrator scoped Jest/Nx verification remains to be run.

## Orchestrator fix round

- **Interrupted playback and duplicate failures:** `tts-playback-queue.ts:124-143` routes audio error, play rejection and factory failure through one guarded `fail(error)`. It reports only for an unsettled clip in the current generation, then finishes and advances the queue. `tts-playback-queue.spec.ts:114,134,158` covers a pending play rejected after `stopAll()`, an error event plus rejection reported once, and a current rejection reported once while the next clip starts.
- **Markdown bullets versus diff hunks:** `spoken-text.ts:5-25,33` tracks an unfenced unified diff from a header through its metadata and hunk lines, stopping at a blank or unrelated line. Ordinary `-` and `+` prose remains eligible for speech. `spoken-text.spec.ts:20,26` covers retained markdown bullets and an unfenced diff between two prose passages.
- **Short VAD burst closure:** `vad.ts:1-2,83` adds `discard` and documents that each `start` has one closing transition unless reset. `vad.spec.ts:23` now expects `start` followed by `discard`; `vad.spec.ts:14` continues to verify `start` followed by `end` for a valid utterance.
- Prettier check: **All matched files use Prettier code style!** Scoped diagnostics found no errors in the changed voice files; seven errors remain in sibling files outside this batch. Per lane rule, Jest/Nx were not run.
