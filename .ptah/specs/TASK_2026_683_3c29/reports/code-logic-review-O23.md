# Code Logic Review O23 (no-skip log) - TASK_2026_683

Review family: Claude reviewer, codex implementer.

## O23

Score: 6/10. Verdict: REVISE (0 blocking, 1 serious, 2 moderate, 2 minor).

Scope: surface-view-transitions.ts (:100-122), its spec diff, styles.css:755-764, Angular router chunk :3685-3703. No browser run; behaviour below is from the View Transitions spec and code reading, so the ready-resolves claim (1) is unverified in a real browser.

### Answers
1. Zero named elements: per spec, capture with an empty set of named elements is valid and `ready` fulfils; AbortError comes only from skipTransition / a superseding transition / hidden document. The CSS clears the implicit `:root` name too, since `html.ptah-vt-none` is in the first selector list (styles.css:755-756) and author `!important` beats the UA rule. The class is added synchronously inside onViewTransitionCreated, before the next-frame capture, so ordering is right. Plausible but needs one real-browser check (Electron dev console) before trusting.
2. Overlap loses the capture (finding S1).
3. `::view-transition` input and rendering pause: see M1.
4. Reduced motion: still instant (no animations, no names, shouldAnimate false path, spec at :214-228). OK.
5. Counter: decrement runs once per transition on both fulfil and reject (surface-view-transitions.ts:111-118); spec covers reject and overlap. Gap: nothing resets on injector destroy (M2).
6. Spec quality: stub-based, so it proves class bookkeeping only, not that `ready` resolves or that cross-surface capture survives. Missing the S1 case.

### Serious
- S1 surface-view-transitions.ts:107-118 with the tracker at :65-66 and styles.css:755-757: a same-surface navigation leaves `ptah-vt-none` set until its `finished` settles. If a cross-surface navigation starts first (rapid session click then Settings), `startViewTransition` supersedes the old transition, but the old `finished` only settles after its update callback and render promise, which can be after the new capture frame. The new tracked transition adds `ptah-vt-active`, yet `html.ptah-vt-none * { view-transition-name: none !important }` overrides `.ptah-vt-surface { view-transition-name: ptah-surface }`. Result: the surface animation silently becomes an instant swap while the tracker reports busy (also a probable dev AbortError from the superseded transition's `ready`). Fix: in the animate branch, force-clear the class and reset the counter (or use an epoch so stale finishers cannot remove/leave it) before `track`; add a spec for none-then-cross-surface.

### Moderate
- M1 surface-view-transitions.ts:108-110: unlike skipTransition, a real transition suspends rendering until the update callback (`createRenderPromise`) finishes and creates the `::view-transition` overlay, which in Chromium can swallow pointer input for those frames. Every session switch now pays this; the old path did not. Low per switch, but a slow render or lazy route stretches the frozen frame. Verify with the perf probe (frame gaps and a click during the switch window) before accepting.
- M2 surface-view-transitions.ts:101,111-118: the class lives on shared `documentElement` while the counter is per-injector. If the app is destroyed (HMR, tests, extension reload) with `finished` pending, the class is never removed and a new instance starts at 0, permanently disabling surface transitions. Add a DestroyRef cleanup that removes the class.

### Minor
- m1 styles.css:760-764: the pseudo `animation: none` rule is redundant when no names exist; harmless but dead.
- m2 spec :186-202 asserts `finished.then` ordering with a single `await Promise.resolve()`, microtask-fragile.

## Re-review

Review family: Claude reviewer, codex implementer. Score: 8/10. Verdict: APPROVED (no open blocking or serious findings; 2 minor).

Verified against surface-view-transitions.ts:100-137, the spec diff and styles.css.

- S1 fixed. The cross-surface branch bumps `generation`, zeroes the count and removes `ptah-vt-none` before `track` (ts:131-134). Every no-snapshot handler captures `transitionGeneration` at creation and returns early on mismatch (ts:121-122), so a stale `finished` (fulfil or reject) can no longer decrement, drive the count negative, or remove the class. It cannot add the class either, since only the creation path adds it. A same-surface navigation after the cross-surface one captures the new generation and works normally. Spec "restores cross-surface capture before tracking and ignores the old finish" checks the class is false at `track` time and stays false after the old finish. Residual: the new tracked transition's own capture is protected only by the class removal; correct since the class is cleared synchronously before the capture frame.
- M2 fixed. `inject(DestroyRef)` runs inside the router's `runInInjectionContext(injector, ...)` (Angular chunk :3705-3710), so it is the router's environment injector, the same lifetime as the feature closure. One registration per feature instance (`cleanupRegistered`); on destroy it bumps generation, zeroes count and removes the class, so late finishers are inert. Spec uses `TestBed.resetTestingModule()` then a late finish. Minor: `root` is captured from the first call; fine since DOCUMENT is constant per app.
- M1 evidence accepted: `::view-transition { pointer-events: none; }` exists at styles.css:773-774, so the overlay does not swallow input. The rendering pause during the update callback versus the old skip remains unmeasured (open, low risk; check with the perf probe frame gaps).
- m1 fixed (pseudo animation rule removed; styles.css:755-758 only clears names). m2 fixed (specs await the stub `finished` promises instead of a bare microtask).

Minor remaining
- r1 Real-browser confirmation that `ready` resolves with no named elements (no AbortError in dev) is still not evidenced; stubs cannot show it. One Electron dev-console check closes it.
- r2 A same-surface navigation arriving while a tracked cross-surface transition is mid-animation sets `ptah-vt-none` (ts:124-126), which would clear `ptah-surface` names for the running capture. Browsers supersede the old transition at that point anyway, so the effect is the already-skipped animation; no spec covers it.
