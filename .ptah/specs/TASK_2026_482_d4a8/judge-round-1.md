# Judge Round 1 — TASK_2026_482_d4a8

VERDICT: PASS

Scope judged: `git diff` + `git status` in
`D:\projects\ptah-extension\.claude-worktrees\perf-task-478-process-and-retention-fleet-5891e3e00c97`.
Files read in full: `streaming-quotes.component.ts`, `streaming-quotes.component.spec.ts`,
`background-agent.store.ts` (diff), `background-agent.store.spec.ts` (diff),
`turn-end-handler.rekey.spec.ts` (diff), both barrels, `chat-ui/CLAUDE.md`,
`chat-ui/jest.config.ts`, `chat-ui/src/test-setup.ts`. No test suite was run; no source edited.

---

## 1. THE CENTRAL CLAIM — does the animation still paint? YES, and it does not depend on change detection at all.

The implementer did **not** rely on "signal write out of zone still reaches the DOM". That
would have been the trap the instruction warned about. Instead the signal was removed from
the render path entirely:

- `streaming-quotes.component.ts:28-31` — the template span is now an empty, binding-free
  element carrying only `#textElement`. There is no `{{ displayedText() }}` interpolation
  left, so no change-detection pass is needed to paint it.
- `streaming-quotes.component.ts:142-146` —
  `this.textElement().nativeElement.textContent = text;` writes the DOM **imperatively**.
  This is a direct `Node.textContent` assignment; it is not scheduled, not queued and not
  mediated by Angular. It lands whether or not `ApplicationRef.tick()` ever runs again.
- `streaming-quotes.component.ts:103-132` — the interval is created inside
  `ngZone.runOutsideAngular(...)`, so the tick does not go through the zone's
  `onMicrotaskEmpty` → `ApplicationRef.tick()` path.

So the failure mode the instruction asked me to hunt — "OnPush component marked dirty by the
signal graph but nothing schedules the refresh, animation silently freezes" — **cannot occur
here**, because nothing in this component is scheduled any more. The paint is synchronous
inside the timer callback.

Supporting evidence that this is real and not comment-deep, from the test environment:
`libs/frontend/chat-ui/src/test-setup.ts:1-6` uses
`setupZoneTestEnv(...)` — the chat-ui suite runs **Zone-based**, the same mode as the
webview shell. That makes the two assertions in
`streaming-quotes.component.spec.ts:48-54` load-bearing rather than vacuous:
`zoneStates` is `[false]` (callback genuinely outside the Angular zone) and the DOM reads
`'L'` **with no `detectChanges()` between the timer advance and the assertion**
(`spec.ts:44-46`). In a zoneless env `isInAngularZone()` would be trivially `false`; it is
not zoneless here, so the assertion discriminates.

Secondary check I made: `applicationTicks === 0` (`spec.ts:49`) is not trivially true either.
Angular's `ChangeDetectionSchedulerImpl` schedules via `setTimeout`/`rAF`, both of which
`jest.advanceTimersByTime(50)` would flush. A scheduled tick would have been observed.

Side benefit worth naming: because the span has no binding, an unrelated parent-driven CD
pass will not overwrite the imperative text. No flicker regression.

**Verdict on point 1: the claim holds. Not a fail.**

## 2. Period re-arm — FIXED, verified by control flow, not comments.

`startTyping()` reads `this.isDeleting` at the moment of call to pick the delay
(`streaming-quotes.component.ts:131`). Trace of every transition:

- Mount: `ngAfterViewInit` (`:83-85`) → `isDeleting === false` → **50 ms**.
- Type complete: `:112` `clearTypingInterval()`, `:113-117` pause timeout sets
  `isDeleting = true` **before** calling `startTyping()` → **30 ms**.
- Delete complete (this is the bug that existed): `:124` `clearTypingInterval()`,
  `:125` `isDeleting = false`, `:126-127` advance quote index, `:128` `startTyping()`
  → **50 ms**. The old code (context.md:42-45) fell off the end of this branch with no
  re-arm and stayed at 30 ms forever.

Sequence is 50 → 30 → 50 → 30 …, correct. Pinned by
`streaming-quotes.component.spec.ts:83-87`, which asserts the observed `setInterval` delays
equal `[50, 30, 50]`. Against the pre-fix code that array would have been `[50, 30]`, so the
test can fail. It is a real regression test.

## 3. Dangling `typingInterval` handle — NULLED ON EVERY PATH.

- `clearTypingInterval()` (`:135-140`) clears **and** nulls; it is the only clear site for
  the interval and is used on both the pause path (`:112`) and the delete-end path (`:124`).
- `ngOnDestroy` (`:87-96`) nulls `typingInterval` (`:90`) and `pauseTimeout` (`:94`).
- The pause handle is additionally nulled when it fires (`:114`), so it is not left dangling
  during the subsequent delete run.

No remaining path clears a handle without nulling it. The spec asserts the pause-window null
directly at `streaming-quotes.component.spec.ts:72-78`.

## 4. Termination — NO. The timer still runs forever while mounted. State this to the user.

There is no terminating branch. `startTyping()` is unconditionally re-entered at `:116` and
`:128`; the only exit is `ngOnDestroy` (`:87`). The brief did not require termination
(context.md:63-69 asks only to stop the amplification and fix the period/handle), so this is
**acceptable but must be communicated**: a stranded streaming bubble will still wake its
timer at 20 Hz / 33 Hz indefinitely. What changed is the cost per wake — one `String.slice`
plus one `textContent` assignment, and **zero** application ticks, instead of a full
`ApplicationRef.tick()` across every open tile. The residual-risk section of the
implementer's report (agent-output-root.md:74-80) states this honestly and matches the code.

User-facing expectation: CPU should drop sharply, but it will not drop to zero while bubbles
are stranded. The true fix is the out-of-scope TASK_2026_382 B5 lifecycle work.

## 5. SCOPE — CLEAN. No forbidden file touched. The rekey-spec edit is legitimate.

`git diff --name-only` contains **no** `message-bubble.component.html`, no
`streaming-handler.*`, no `tab-manager`, no `accumulator`. `isStreaming()` and the stranded
`streamingState` lifecycle are untouched. `ptah-streaming-quotes` is still rendered from
`message-bubble.component.html:184`, unchanged.

The only chat-streaming file touched is `background-agent.store.ts`, which is explicitly in
scope (context.md:71-72).

`turn-end-handler.rekey.spec.ts` — **not a test fudge**, it is compile-forced:

- The diff removes exactly two things: `jest.useFakeTimers()` / `jest.useRealTimers()`
  (`rekey.spec.ts:94` and `:125` pre-image) and `store.ngOnDestroy()` (`:124` pre-image).
- `store` is the **real** `BackgroundAgentStore` (`rekey.spec.ts:31`, `:90`, `:111`, `:120`).
- `background-agent.store.ts` no longer implements `OnDestroy` and no longer declares
  `ngOnDestroy` (removed at store diff lines around `:69` and `:156-180`). A call to
  `store.ngOnDestroy()` would therefore be a TypeScript error. Removal is mandatory, not
  cosmetic.
- I grepped the whole rekey spec for `Timer|setTimeout|setInterval|advanceTimers|await|Promise`
  — **zero hits**. The spec has no timer-dependent assertion, so dropping fake timers changes
  nothing it exercises. It was installed solely to contain the store's deleted 1 s interval.

No assertion was weakened or deleted in that file. Not a fail.

## 6. DELETION SAFETY — both deletions verified independently. CLEAN.

`StreamingTextRevealComponent` — repository-wide grep (case-insensitive, whole worktree,
excluding `.git`/`node_modules`/`dist`) for both `StreamingTextReveal` and
`streaming-text-reveal` returns **only markdown**: `TASK_2026_480_c2d8/renderer-analysis.md`
(lines 98, 240, 247, 269-270, 274), this task's `context.md` (51-52, 70) and
`agent-output-root.md` (23, 47-48). **Zero** hits in `.ts`, `.html`, or any barrel. Both
barrel exports are gone (`chat-ui/src/index.ts` line removed after `StreamingQuotesComponent`;
`chat/src/lib/components/index.ts` line removed after `StreamingQuotesComponent`). The
`chat-ui/CLAUDE.md` Public API list was updated in the same diff. No dangling import.

`BackgroundAgentStore.tick` — word-scoped grep for `\.tick\b` across `libs/frontend` and
`apps/*/src`. Every production (non-spec) hit is one of:
- `libs/frontend/chat/src/lib/components/molecules/agent-card/agent-card.component.ts:170`
  `this.store.tick()` — `store` is `AgentMonitorStore`, not `BackgroundAgentStore`
  (`agent-card.component.ts:20` import, `:154` `inject(AgentMonitorStore)`). **Different
  store, still intact** — `agent-monitor.store.ts:547` still owns its own `tick.update(...)`.
- `libs/frontend/chat-streaming/src/lib/agent-monitor.store.ts:547` — the surviving store.

All other hits are `ApplicationRef.tick()` / `TestBed.tick()` in spec files, unrelated. I also
checked the two components that do consume `BackgroundAgentStore`
(`background-agent-tray.component.ts`, `inline-agent-bubble.component.ts`) — neither appears
in the `.tick` result set. Deletion is safe.

No other caller of the removed `BackgroundAgentStore.ngOnDestroy` exists: grep across
`turn-end-handler.background.spec.ts`, `turn-end-handler.service.spec.ts`,
`turn-end-handler.spinner.spec.ts` returns nothing.

## 7. SPEC QUALITY — two strong tests, one weak one.

- `spec.ts:14-56` **strong and new-behaviour-specific.** Asserts (a) callback is outside the
  Angular zone, (b) `ApplicationRef.afterTick` fired zero times, (c) the DOM text advanced to
  `'L'` with **no** `detectChanges()`. Against the pre-fix implementation (b) and (c)-without-CD
  both fail. It cannot pass vacuously because the env is Zone-based
  (`chat-ui/src/test-setup.ts:1-6`).
- `spec.ts:58-88` **strong.** `[50, 30, 50]` is exactly the assertion the old code fails
  (`[50, 30]`), plus a direct null-handle check at `:72-78`. This is the test the brief's
  defect list demanded.
- `spec.ts:90-101` **weak — report it.** `expect(() => fixture.destroy()).not.toThrow()` is
  nearly unfalsifiable: `ngOnDestroy` (`:87-96`) contains no throwing statement, so this test
  would pass even if both handles leaked. It adds no coverage that `:72-78` does not already
  give. Not a fail, but it is decorative.

Gap not covered by any test: destruction **during the 2 s pause window** (only
`pauseTimeout` is live). Low risk — `ngOnDestroy:92-95` handles it — but unasserted.

---

## Non-blocking findings (do not gate the commit)

1. **Stale doc comment.** `streaming-quotes.component.ts:16` still reads
   `Patterns: CSS typewriter animation, Signal-based state, OnPush change detection`. There is
   no signal-based state in this component any more. Fix the comment.
2. **Documented convention deviation.** `libs/frontend/chat-ui/CLAUDE.md` guideline 4 says
   "Signal-first. All local component state uses Angular signals." This component is now
   deliberately imperative for a measured performance reason. That is the right call, but the
   exception is undocumented — it reads as a violation to the next reader. One sentence in
   `chat-ui/CLAUDE.md` naming this atom as the standing exception would pay for itself.
3. **Foreign changes present in the worktree.** `git status` shows `package.json` (added
   `db:drain-observations` script) and untracked `scripts/drain-observation-queue.ts`. These
   belong to a sibling task in this shared worktree (`perf-task-478…`), **not** to
   TASK_2026_482. Do not stage them under this task's commit.
4. `ngOnInit` → `ngAfterViewInit` (`:83`) is correct and required — `viewChild.required`
   is not resolvable in `ngOnInit`. Verified, not a defect.

## Residual uncertainty

- I did not run the suite (instructed not to). The implementer's reported
  131/131 suites green is unverified by me; CI owns it.
- I did not measure actual renderer CPU on a live host. The mechanism is sound by
  inspection, but the 94%-of-a-core figure from `context.md:11` has not been re-measured
  post-fix. Expect a large drop, not elimination — see point 4.
