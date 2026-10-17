# Code Logic Review, Round 2 - `TASK_2026_686_eb9e`

Review family: Anthropic (reviewer); implementers: codex lanes + orchestrator

Scope: re-review of the round-1 findings S1, M1, M2, M3 only (M4 recorded, not fixed, per `decisions.md` row 6). Read-only. I read the whole of `vad.ts`, `status-narrator.ts`, `command-center-clock.ts`, `command-center-tribunal-intent.ts`, the diffs of the projection source and controller, and the new or changed specs. I did not run Nx, Jest or tsc. The orchestrator's typecheck, lint and 378/378 test results are taken as given.

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 0        |
| Minor issues (new)  | 4        |

Why 8 and not 9: the four round-1 items are closed with evidence, but M3 is a syntactic heuristic with known residual false positives and negatives (accepted in decisions row 7, bounded by the on-page Confirm gate). There is also no spec for a dip that exceeds the allowance but ends well before 2 s.

## Per-item status

### S1 - VAD unbounded onset tolerance: CLOSED

- `vad.ts:66` sets `dipAllowance = min(onset / 2, 60)`: 60 ms in both modes (onset 120 ms, or 300 ms in `playbackMode`).
- A mid-band frame (`noiseFloor <= rms <= speechThreshold`) starts `dipSince` (`vad.ts:84`) and clears `aboveSince` once the dip runs longer than the allowance (`vad.ts:85`).
- The next active frame re-checks the dip (`vad.ts:68-70`). The stale onset is therefore dropped even when no mid-band frame was seen after the allowance expired. This covers the round-1 scenario: loud at 0, mid-band to 2000 ms, one loud frame returns null.
- A frame below the noise floor resets `aboveSince` and `dipSince` (`vad.ts:80-82`), which restores the pre-B1 behaviour for silence.
- `end` and `discard` now clear `aboveSince` and `dipSince` (`vad.ts:94-95`). A loud frame right after an utterance therefore needs a fresh onset.
- `reset()` clears `dipSince` (`vad.ts:40`).
- Frame cadence is not a problem. The worklet posts 128-sample frames (about 3 ms, `pcm-capture.worklet.js` `process`), so a 60 ms allowance spans many frames.
- Spec coverage in `vad.spec.ts` (diff):
  - A dip within the allowance is kept, in both modes.
  - Sustained mid-band noise followed by a loud frame at 2000 ms returns null, in both modes.
  - An utterance that ends through a mid-band hangover, followed by a loud frame at 1110 ms, returns null.
  - A below-floor frame resets the onset.
- Residual (Minor, not blocking): there is no spec for a dip just over the allowance, for example 100 ms. The logic handles it at `vad.ts:68`.

### M2 - Narrator baseline is size-based: CLOSED

- `baselined` is set only when `rootNode` is present (`status-narrator.ts:41-46`). If the root is absent the function returns without touching `previous`, so a child-only first snapshot is not taken as the baseline.
- The flag is reset on a root change (`:25`) and in `clear()` (`:110`).
- The projection always emits the root node, both in the no-session branch (`controller.ts:219-230`) and through `projectOwnedWork`. The "root never appears" path therefore only delays narration and does not suppress it permanently.
- Specs cover:
  - A root-less first snapshot is not baselined.
  - The first observation is a silent baseline, and a later transition is narrated once.
  - A root change gives a silent baseline.
  - A baseline after `clear()` is silent.
- The existing transition spec was updated so that `starting` to `running` now narrates only after the baseline observation. That matches the intended semantics.
- No regression: `drain` and the `delivered` keying are unchanged.

### M1 - Non-reactive launch-window clock: CLOSED

- `command-center-clock.ts` creates a signal and ticks it every 30 s with `setInterval` inside `NgZone.runOutsideAngular`. The interval is cleared through `DestroyRef.onDestroy`.
  - The controller is provided in the page component's `providers` (`command-center-page.component.ts:39-44`), so teardown follows the component.
  - In a zoneless app `NgZone` is a no-op zone and `runOutsideAngular` still works. In a zone app the signal write still schedules change detection. The pending interval cannot hold `whenStable()` open.
- `controller.ts:62` creates the clock as a field initializer, inside an injection context. `controller.ts:238-241` reads `this.now()` inside the projection `computed`. The `starting` to `unknown` flip is therefore reactive, as the round-1 finding required.
  - The early-return branches before that read take no clock dependency. Those branches never reach `runState`, so this is fine.
- `runState` (`projection.source.ts:23-32`): with no agents, the state is `starting` only if `startedAt - now <= 120 s` and `max(0, now - startedAt) < 120 s`. Otherwise it is `unknown`.
  - A future `startedAt` (clock skew) is tolerated for up to 2 min and is then bounded. The worst case is about 4 min of `starting`. Beyond that it is `unknown` immediately. This closes the mirror-image defect.
  - `startedAt` is NaN or undefined: both comparisons are false, so the result is `unknown`. That is a safe default.
- The controller is 695 lines, within the 700 limit (`wc -l`).
- Specs: `runState` boundaries at 119 999 ms, 120 000 ms and a future `startedAt` (`projection.source.spec.ts:23-25`). A computed projection that changes when only the clock signal advances (`:355`). The clock tick and teardown (`command-center-clock.spec.ts`).
- Another `runState` exists in the `model/work-state` spec. It is a different function and still has its own single-argument signature, so there is no call-site break.

### M3 - Tribunal intent precision and recall: CLOSED (within the rule in decisions row 7)

- `command-center-tribunal-intent.ts` requires a launch verb plus an optional article or number and a plural-tolerant move, or `with`, `via` or `using` plus a move. A bare `tribunal` word also qualifies.
- A move or `tribunal` directly followed by a common compound noun is excluded through a negative lookahead (`:4-14`). The regexes have no nested quantifiers, so there is no ReDoS risk.
- The spec covers 25 phrases, including all the round-1 false-positive and false-negative examples that the rule targets:
  - 'run the race condition tests' is false.
  - 'launch the relay server' is false.
  - 'the tribunal panel crashes' is false.
  - 'have a council review this' is true.
  - 'spin up a crucible' is true.
  - 'Review with Council' is true.
- The controller delegates through `hasTribunalIntent` (`controller.ts:552`). The old `TRIBUNAL_MOVES` regex and import are gone.
- Risk bound: a false positive only requests a roster. The launch still needs the on-page Confirm (decisions row 7, Amendment A1).

## New findings (all Minor, none blocking)

1. Intent: a bare `tribunal` word anywhere qualifies (`tribunal-intent.ts:15`, `tribunalPattern`). A sentence such as "the tribunal ran fine" or "summarise the tribunal results" triggers a roster request. It also needs no launch verb. The Confirm gate bounds the impact.
2. Intent: hyphenated compounds are not excluded. The lookahead is `(?!\s+compound)`, so "run race-condition tests" or "start forge-build" match as intent. The same lookahead does not cover phrases such as "race codex against claude" (no launch verb), which is still a false negative, since the decision did not add it. Both are accepted, recorded heuristic limits.
3. Clock: the 30 s tick (`command-center-clock.ts`) recomputes the whole projection every 30 s whether or not anything changed, because `Date.now()` always yields a new value. The cost is small, and downstream consumers such as the narrator are idempotent. A cheaper variant would only tick while a run with no agents exists.
4. `projection.source.ts:27`: `Math.max(0, now - startedAt)` is redundant given the first clause. This is clarity only, not a logic problem.

## Five logic questions (scoped to the fixes)

1. Silent failure: none new. Stale VAD onset, premature narrator baseline and the frozen `starting` state are all closed.
2. Unexpected user action: typing a sentence that merely contains the word "tribunal" is read as intent (new finding 1). The Confirm gate bounds it.
3. Wrong-answer input: a future `startedAt` or NaN gives a bounded or safe result. A mid-band stretch longer than 60 ms no longer yields a stale start.
4. Dependency failure: the clock has no external dependency. `NgZone` and `DestroyRef` are always available in the component injection context.
5. Missing: a spec for a dip just over the allowance, and a spec for the clock inside a real component fixture (`whenStable`). The orchestrator's 378/378 run is the evidence there.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH for S1 and M2 (logic traced in full), MEDIUM-HIGH for M1 (the zone behaviour is reasoned from Angular semantics and the orchestrator's passing run, not executed by me), MEDIUM for M3 (a heuristic, accepted by decision)
- Top risk: the intent heuristic still has known false positives and negatives, bounded by the Confirm gate.
- Review family: Anthropic (reviewer); implementers: codex lanes + orchestrator
