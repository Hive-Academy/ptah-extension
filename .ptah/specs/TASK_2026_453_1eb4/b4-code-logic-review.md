# Code Logic Review — `TASK_2026_453_1eb4` Batch 4 (Task 4.1, C1 replay motion gate)

Reviewed against: `batches.md` Task 4.1 (ACs 1-8, amended AC 6), Batch 3 outcome, `implementation-plan.md`
"### 1. C1" + "#### 1a. C1 scope decision", `b4-codex-report.md`. Scope: uncommitted `git diff` on top
of `b9cc2f193`, plus untracked `chat-transcript.replay-motion.spec.ts`. Independent review (codex was
the implementer).

## Summary

| Metric              | Value                     |
| -------------------- | ------------------------- |
| Overall score        | 7/10                      |
| Assessment           | NEEDS_REVISION            |
| Blocking issues      | 0                         |
| Serious issues       | 1                         |
| Moderate issues      | 3                         |
| Failure modes found  | 2                         |

## Five logic questions

### 1. How does this fail silently?

- If `SessionHistoryReplayer.replay()`'s `finally` ever ran without the `markReplayFinished` claim
  check matching, motion would stay suppressed forever for that tab with no error, no log, no visible
  crash — just a tile whose bubbles never fade or FLIP again. The claim-keyed guard at
  `session-history-replayer.service.ts:234-239` prevents this for every exit currently reachable from
  `replay()`, and `session-history-replayer.admission.spec.ts:397-420` pins the claim-keyed case
  directly. I did not find a live silent-failure path in the diff.
- `ChatViewComponent.isHistoryReplaying(tabId)` (`chat-view.component.ts:170-172`) returns `false` by
  construction if `tabId` does not match any replaying tab — including if the tab id passed to the
  template ever drifted from the id used in `claim()`/`replay()` (e.g. a resolved vs. requested tab id
  mismatch). Nothing asserts tab-id identity between `chat-view.component.html:69`'s `[tabId]` binding
  and the id `SessionLoaderService` claims with. A mismatch here would silently render with motion
  un-suppressed during a real replay — not caused by this diff, but nothing in this batch guards it either.

### 2. What user action produces unexpected behaviour?

- Opening several canvas tiles back-to-back (the scenario this whole task exists for) queues waiters
  behind the active replay's admission slot. A waiter's `historyReplaying` flag is `true` from the
  moment its own `replay()` is *called*, not from the moment it starts running its chunks
  (`session-history-replayer.service.ts:192-193`, before `acquireReplayAdmission`). So a tile that is
  still waiting in the FIFO queue — not yet touching the DOM — already reports `isReplaying(tabId) ===
  true`. That is intentional per AC 1 ("before admission") and is harmless because a queued tile has no
  rendered bubbles yet to suppress motion for; noted only because it is easy to misread as a bug and
  isn't spelled out in the CLAUDE.md bullet.

### 3. What input data produces a wrong answer?

- None found that this diff introduces. The Set-copy-on-write pattern in `markReplayStarted` /
  `markReplayFinished` (`:227-240`) is correct for concurrent tabs: two tabs replaying simultaneously
  each get their own entry, and `new Set(this._replayingTabIds())` never aliases the previous version,
  so a stale closure over an old Set can't accidentally observe a later mutation.

### 4. What happens when a dependency fails?

- A throwing `StreamingHandlerService.processStreamEvent` propagates out of `replay()`'s try block; the
  `finally` still runs `markReplayFinished` unconditionally, clearing the flag
  (`session-history-replayer.admission.spec.ts:397-420` pins this). Good.
- A rejected `yieldToMacrotask()` (channel post throws) behaves like a throwing chunk — same `finally`
  path, same result.
- A rejected admission hand-off (`handoffReplayAdmission`'s `next.reject(...)`) surfaces as a rejected
  `admission` promise inside `replay()`'s `await admission;` — the `try/finally` still clears the
  waiting tab's own flag (`admission.spec.ts:442-475`, `b4-codex-report.md` AC-evidence table). Correct,
  and it does not corrupt the *other*, already-successful replay's outcome (`admission.spec.ts:"keeps
  the finished replay successful..."`).

### 5. What is missing that the requirements never mentioned?

- See Serious-1 below: nothing in the codebase or in this batch's tests exercises the actual
  `SessionHistoryReplayer` → `SessionLoaderService.setStatus('loaded')` handoff that AC 7's "first
  finalized render already suppressed (A3)" depends on. The requirement assumes continuity is
  guaranteed by "same synchronous task as finalize + closeFence" for the *flag*, but doesn't ask anyone
  to verify continuity with the *next* signal in the OR-gate (`isFinalizingTransition`), which is
  written by a different service on a later microtask.

## Failure modes

### Motion un-suppression gap is real in principle, papered over by an unverified Zone assumption

- Trigger: a tile finishes a full history replay (`replay()` resolves `'replayed'`).
- Symptom: theoretically, one Angular change-detection pass could render with `historyReplaying() ===
  false` (already cleared, synchronously, inside `replay()`'s `finally`,
  `session-history-replayer.service.ts:221-223`) while the tab's status is still `'resuming'`
  — before `SessionLoaderService.switchSession` reaches `this.sessionManager.setStatus('loaded')`
  (`session-loader.service.ts:803`), which is the only thing that flips `vm().isStreaming` false and
  arms `isFinalizingTransition` (`chat-transcript.component.ts:463-484`). In that window
  `motionSuppressed = historyReplaying() || isFinalizingTransition() = false || false = false` — exactly
  the "first finalized render" moment AC 7 requires to stay suppressed.
- Evidence: `session-history-replayer.service.ts:218-223` (flag clears synchronously, no `await`, right
  after `finalizeSessionHistory`/`closeFence`); `session-loader.service.ts:782-803` (`setStatus('loaded')`
  runs only *after* `await this.historyReplayer.replay(...)` resolves — a separate microtask
  continuation of the *caller*, not part of the replayer's own synchronous `finally`).
- Current handling: the gap does not manifest today only because `apps/ptah-extension-webview` bootstraps
  with `provideZoneChangeDetection({ eventCoalescing: true })` (`app.config.ts:117`), so Zone.js coalesces
  the flag-clear microtask and the `setStatus('loaded')` continuation microtask into one
  `ApplicationRef.tick()` as long as no macrotask is interposed between them — which holds today because
  every chunk boundary (including the last) already yields via `yieldToMacrotask()`
  (`session-history-replayer.service.ts:211-212`), so the finalize+flag-clear+status-set sequence all
  runs inside that macrotask's microtask queue before Zone considers itself stable.
- The new spec does not pin this ordering: `chat-transcript.replay-motion.spec.ts:139-149` sets
  `tabs.set([...status:'loaded'])` and `fixture.componentRef.setInput('historyReplaying', false)`
  **together**, then calls `detectChanges()` once — a hand-synchronized double-write, not the real
  `SessionHistoryReplayer` + `SessionLoaderService` sequence. It proves A3 ("effects run before the
  template in the same CD pass") for a single already-coalesced tick; it does not prove the two writes
  are actually coalesced into that one tick in production.
- Recommendation: either (a) add an integration-level spec that drives the real
  `SessionHistoryReplayer.replay()` promise through a fake `SessionLoaderService`-like awaiter and
  asserts no intermediate render has `motionSuppressed() === false` between flag-clear and
  `setStatus('loaded')`, or (b) make the invariant explicit and load-bearing instead of relying on Zone
  coalescing — e.g. have the replayer clear the flag only after being told the caller has settled status,
  or have `SessionLoaderService` set `'loaded'` before releasing the replay's flag ownership. Given
  CLAUDE.md's own architecture line ("zoneless in libs / Zone in webview shell"), a future zoneless
  migration of the webview shell would silently reopen this gap with no test to catch it. Severity:
  Serious (a plausible, if today-latent, defect whose only guard is an unstated cross-service timing
  assumption, on the exact behaviour C1 exists to fix).

### Weak positive-path coverage for the enabled-motion branches (jsdom limitation, disclosed but real)

- Trigger: `isFinalizing() === false` on `message-bubble` badges.
- Symptom: the spec added for this case (`message-bubble.component.spec.ts:230-289`, the `expectsAnimation
  === true` branch) only asserts the badge renders and `isFinalizing()` reads `false` — it does not assert
  `bubble-fade-enter`/`bubble-fade-leave` is actually the bound value, because jsdom lacks the Web
  Animations API that Angular's `animate.enter/leave` needs to do anything observable. AC 7's "false: the
  class is added" is therefore only exercised by an AOT compile check (`build:production`), which proves
  the binding syntax is legal, not that the enabled branch evaluates to the fade class rather than `''`
  by some inverted condition.
- Evidence: `message-bubble.component.spec.ts:255-264` (comment explaining the jsdom gap);
  `message-bubble.component.html:129-130,159-160` (the actual ternaries, which read correctly by
  inspection: `isFinalizing() ? '' : 'bubble-fade-enter'`).
- Current handling: disclosed in the spec's own comment; not a defect in the shipped code (I read the
  ternaries and they are correct), but it means a future accidental swap of the ternary branches (e.g.
  `isFinalizing() ? 'bubble-fade-enter' : ''`) would pass every test in this diff and only be caught by a
  visual/production regression. Severity: Moderate (test-coverage gap on a real behavioural condition, not
  a defect in current code).

## Blocking issues

None.

## Serious issues

### S1 — Flag-clear vs. `setStatus('loaded')` continuity is untested and depends on an implicit Zone assumption

- File: `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts:218-223`
  (flag clears synchronously) vs. `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:782-803`
  (`setStatus('loaded')` runs in the caller's `await` continuation)
- Scenario: see "Failure modes" above. Manifests only if a macrotask is ever interposed between
  `replay()` resolving and `SessionLoaderService` calling `setStatus('loaded')` (e.g. an added `await`,
  a microtask-vs-macrotask scheduling change, or the "zoneless in libs" direction reaching this app).
- Impact: bubbles created by the finalize burst — the exact case AC 7 calls out — would briefly render
  with motion enabled (badge fade, agent auto-animate) before `isFinalizingTransition` arms 300 ms later,
  reintroducing the flicker C1 exists to remove, with no test failing to flag the regression.
- Fix: add an end-to-end-style spec (real `SessionHistoryReplayer` + a stand-in that mimics
  `SessionLoaderService`'s `await replay(); setStatus('loaded');` ordering) asserting no observable frame
  has `motionSuppressed() === false` between the two writes; or remove the dependency on coalescing by
  having the replayer and loader agree on a single, ordered write (e.g. loader sets `'loaded'` from inside
  a callback the replayer invokes before its own `finally` clears the flag).

## Moderate and minor issues

- M1: `message-bubble.component.spec.ts` enabled-motion branch only asserts absence of the finalizing
  gate, not presence of the fade class binding value — see "Failure modes" above (`message-bubble.component.spec.ts:255-289`).
- M2: `inline-agent-bubble.component.spec.ts:139-152` only tests the negative case ("does not create a
  controller while finalizing"); no companion assertion that the controller *is* created once
  `isFinalizing` flips back to `false` after mount (the exact "autoAnimateDisabled flips true→false"
  scenario named in the review brief). By inspection of `auto-animate.directive.ts:72-80` this works
  correctly (the `effect` reruns, `viewInited` is already `true`, `ensureController()` fires), and
  `@formkit/auto-animate` does not animate the pre-existing children on first `autoAnimate()` call (no
  settle burst) — but this is verified by reading library semantics, not by a spec in this batch.
- M3: `ChatViewComponent.isHistoryReplaying(tabId)` (`chat-view.component.ts:170-172`) has no spec of its
  own in this diff (no `chat-view.component.spec.ts` changes). It is a one-line passthrough, but it is
  also the only place a tab-id mismatch between the claimed tab and the rendered transcript could hide
  (see logic question 1). Low risk, zero cost to add one assertion.
- Minor: the CLAUDE.md rule 7 bullet (`libs/frontend/chat/CLAUDE.md:76`) correctly states the "never infer
  from `resuming`" rule but doesn't mention the Zone-coalescing dependency called out in S1 — worth a
  follow-up note once S1 is resolved either way.

## Data flow

1. `SessionLoaderService.switchSession` calls `historyReplayer.claim(tabId, sessionId)` then, if events
   exist, `historyReplayer.replay(events, claim, sessionId, resumableSubagents)` — OK, unchanged by this
   diff (Batch 3 territory).
2. `replay()` entry: `markReplayStarted(claim)` adds `tabId` to `_replayingTabIds` and records the owning
   claim in `replayingClaims`, before admission is requested — OK, matches AC 1/2.
3. Chunks stream via `processStreamEvent`; on success, `finalizeSessionHistory` + `closeFence` run
   synchronously, then `finally` → `markReplayFinished` clears the flag only if the stored claim still
   matches — OK for the flag itself; see S1 for what happens to the *combined* gate the transcript reads.
4. `ChatViewComponent.isHistoryReplaying(tabId)` reads `sessionHistoryReplayer.isReplaying(tabId)` and
   binds `[historyReplaying]` per transcript instance — OK, one line, correctly scoped per tab.
5. `ChatTranscriptComponent.motionSuppressed` ORs `historyReplaying()` with the existing
   `isFinalizingTransition()` signal and rebinds `[isFinalizing]` on the per-message `<ptah-message-bubble>`
   in place of the old `isFinalizingTransition()` read — OK, minimal and correctly scoped; `execution-node.component.ts`
   is untouched as required (verified: no diff hunk for that file).
6. `message-bubble.component.html` and `inline-agent-bubble.component.ts` gate their `animate.enter/leave`
   and `autoAnimateDisabled` off the same propagated `isFinalizing()` input — OK, bound-value semantics
   (`''` not `null`) match AC 5/6 exactly by inspection.
7. Gap: step 3's flag-clear and the later `sessionManager.setStatus('loaded')` (in `SessionLoaderService`,
   a sibling service, not the replayer) are two separate writes with no shared transaction — the combined
   `motionSuppressed` gate is only as continuous as those two writes' actual scheduling, which this batch
   does not test end-to-end (S1).

## Requirements fulfilment

| Requirement                                                                 | Status  | Gap                                                                 |
| ---------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------- |
| AC 1 — signal set on entry before admission, claim-keyed `finally` clear    | COMPLETE | None found; well-specced in `admission.spec.ts`                     |
| AC 2 — never derives from tab `resuming`                                    | COMPLETE | None                                                                 |
| AC 3 — `ChatViewComponent` binds `[historyReplaying]` per transcript        | COMPLETE | None                                                                 |
| AC 4 — transcript `motionSuppressed` computed, template rebind             | COMPLETE | Continuity across the OR-gate's two operands unverified (S1)        |
| AC 5 — bound `animate.enter/leave` with `''` on message-bubble badges      | COMPLETE | Enabled branch weakly asserted (M1)                                  |
| AC 6 — inline-agent-bubble `autoAnimateDisabled` + bound footer enter/leave | COMPLETE | Positive (enabled) branch untested (M2), correct by inspection       |
| AC 7 — required specs present and passing                                  | PARTIAL | Present and passing, but the "first finalized render suppressed" case is asserted only under manually-coalesced signal writes, not the real cross-service sequencing (S1) |
| AC 8 — CLAUDE.md rule 7 bullet                                              | COMPLETE | None                                                                 |
| `execution-node.component.ts` unchanged, no scroll/CSS/content-visibility  | COMPLETE | Confirmed via `git diff --stat` — file absent from the changed list |

Implicit requirements not addressed: an integration-level guarantee that the replay-flag clear and the
session-status transition that arms `isFinalizingTransition` cannot ever be observed apart by Angular's
renderer, independent of the current Zone/event-coalescing configuration.

## Edge cases

| Case                                                                 | Handled | How                                                                 | Concern                                             |
| --------------------------------------------------------------------- | ------- | -------------------------------------------------------------------- | ---------------------------------------------------- |
| Claim-keyed removal, superseding replay finishing after being superseded | YES | `session-history-replayer.service.ts:234-239`, pinned by `admission.spec.ts:397-420` | None |
| Newer replay of the same tab queued as a waiter behind another tab   | YES     | `admission.spec.ts:"does not let an older replay's finally clear..."` uses a contended newer claim | None |
| Throw mid-chunk                                                      | YES     | `finally` unconditional; `admission.spec.ts` throw case             | None |
| Rejected admission hand-off                                          | YES     | `admission.spec.ts:"keeps the finished replay successful and reports a failed handoff..."` | None |
| Live `markResuming` continuation (status `resuming` without a replay)| YES     | Flag is service-owned, never reads tab status                       | None |
| Reduced motion                                                       | YES     | `auto-animate.directive.ts` unchanged, still honours `prefers-reduced-motion` | None |
| `autoAnimateDisabled` true→false after mount                        | YES (by inspection) | `auto-animate.directive.ts:72-80` effect re-runs, `ensureController()` fires, no settle burst per library semantics | Not pinned by a spec (M2) |
| Flag-clear vs. session status-set continuity (first finalized render) | PARTIAL | Works today via Zone coalescing (`app.config.ts:117`) | Unverified as an explicit contract (S1) |

## Verdict

- Recommendation: REVISE
- Confidence: MEDIUM (the Serious finding is a reasoned timing analysis grounded in reading both services
  and the app's Zone configuration, not an observed failure — I did not run the suite)
- Top risk: the "first finalized render already suppressed" guarantee that C1 exists to deliver is real
  only because of an unstated, untested dependency on this app's Zone-based change-detection coalescing;
  nothing pins it, and nothing would fail if it broke.
- What a robust implementation would add: (1) an integration spec driving the real replayer-to-loader
  hand-off and asserting no intermediate frame un-suppresses motion; (2) a positive-path assertion for
  `inline-agent-bubble`'s auto-animate controller being created once `isFinalizing` clears; (3) a
  same-value assertion (not just presence/absence) for the message-bubble enabled branch, even if it has
  to inspect the bound expression via a template-driven helper rather than the rendered class list.
