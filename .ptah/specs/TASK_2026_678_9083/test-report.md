# Test report - TASK_2026_678_9083

## Preimplementation baseline

Status: WAIVED by the user on 2026-10-15 (Decision D34 in `batches.md`).

No values were measured, and none are recorded here. The plan forbids invented numbers
(`implementation-plan.md:60`).

Until Batch 18, code and specs use the plan's fixed scene targets:

- p95 draw time at most 8 ms at N=24 mixed nodes
- sustained frame rate at least 30 FPS

Voice latency marks (cold worker and post-barge-in) are recorded by the voice loop, with no pass/fail bound.

Batch 18 (the Electron Scene and Voice Gate, user-run) takes the baseline and the gate in one session:

- display refresh interval at 1280x720 on an integrated GPU
- the selected provider pair (STT, TTS)
- at least 30 end-of-utterance to first-audio samples, cold worker and post-barge-in reported separately
- the selected-provider p95 bound (measured p95 plus the declared tolerance)
- hardware, date and measurement method
