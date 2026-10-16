# Lane B fix round

## S1 — VAD phantom onset

- **Change:** `vad.ts` now tracks the start of a mid-band dip separately from the existing hangover timer. It drops a pending onset when the dip exceeds `Math.min(onset / 2, 60)` ms, including when the next frame is loud; a frame below `noiseFloor` still resets onset immediately. The `end` and `discard` path clears onset and dip state. The hangover calculation is unchanged.
- **Specs added:** `vad.spec.ts` covers sustained mid-band noise followed by one loud frame in normal and playback modes, plus a single loud frame after an utterance ends through mid-band hangover. The short-dip case now uses a dip within the 60 ms allowance in playback mode.

## M2 — Narrator baseline state

- **Change:** `status-narrator.ts` now uses an explicit `baselined` flag. An observation without the root queues nothing and cannot establish the baseline. The first observation containing the root records owned states silently. Root changes and `clear()` reset the flag.
- **Spec added:** `status-narrator.spec.ts` observes a child without its root, then takes a silent baseline when the root and running child arrive, and narrates the child's later completion. The orchestrator's existing starting-to-running expectation was kept.

## Files changed

- `libs/frontend/command-center/src/lib/voice/vad.ts`
- `libs/frontend/command-center/src/lib/voice/vad.spec.ts`
- `libs/frontend/command-center/src/lib/voice/status-narrator.ts`
- `libs/frontend/command-center/src/lib/voice/status-narrator.spec.ts`
- `.ptah/specs/TASK_2026_686_eb9e/reports/lane-b-fix-report.md`

## Decisions

- Used a dedicated dip timer so onset tolerance does not alter the existing silence hangover timer.
- Did not run Nx, Jest, TypeScript, build, serve, e2e, or package commands as instructed. `git diff --check` passed for the four scoped source and spec files. Executable verification remains with the orchestrator.
