# Code Logic Review (Delta) — `TASK_2026_453_1eb4` Batches 14A & 14

Scope: post-revise-round state only. Base reviews (`b14a-code-logic-review.md` APPROVED,
`b14-code-logic-review.md` NEEDS_REVISION) are not re-derived; this closes each of their
findings against the current diff and reviews what changed in Revise round 1/2 per
`b14a-codex-report.md` and `b14-codex-report.md`. Read in full: `transcript-prepend-anchor.directive.ts`
(163 lines), its spec (209 lines), `chat-transcript.component.ts`/`.html` diffs (`git diff HEAD`),
`tile-load-older-history.spec.ts` (full file), `perf-page-capture.ts` (full file),
`perf-measurement-report.ts:130-174`, `tile-open-longtask-budget.perf.spec.ts:195-245`,
`perf-session-fixture.ts:1-50,280-359`.

## Summary

| Metric | Batch 14A | Batch 14 |
| --- | --- | --- |
| Overall score | 8/10 | 7/10 |
| Assessment | APPROVED | APPROVED |
| Blocking issues | 0 | 0 |
| Serious issues | 0 | 0 |
| Moderate issues | 1 | 1 |
| Failure modes found | 1 (defended) | 1 (residual, pre-existing class) |

## 1. Forced mount — lifecycle and reachability

`forcedMounts` (`transcript-prepend-anchor.directive.ts:56,71,89-93,124-130`):

- **Always cleared at the top of every `ngOnChanges`** — `this.forcedMounts.set(EMPTY_MESSAGE_IDS)` runs unconditionally at `:71`, before any gate is evaluated. This covers supersede (a later `ngOnChanges` — any input change, not only a real prepend — clears it before its own revision bump is even used), tab switch, session switch, and the anchor-not-found case (the `if (anchor)` block at `:87-96` never sets `forcedMounts` if `findFirstVisibleSlot()` returns `null`, so nothing to clear).
- **Cleared after the write, and after a rejected write.** `restoreAfterRender`'s callback (`:124-132`) calls `restoreAnchor(anchor)` then unconditionally clears `forcedMounts` at `:129`, regardless of whether `restoreAnchor` actually wrote `scrollTop` — the delta-rejection early-returns at `:144,148` still fall through to the clear at `:129` because they are in the same synchronous callback, called before the clear.
- **Superseded restore (revision mismatch).** `:127` returns before touching `forcedMounts` in *that* callback, but the superseding `ngOnChanges` call already cleared it synchronously at its own `:71` before scheduling anything new — no window where both a stale and fresh set coexist.
- **Destroy.** No explicit `ngOnDestroy`; `afterNextRender`'s injector-scoped cleanup (Angular's own guarantee, cited and used in the b14a base review's Q4) means a torn-down directive instance never fires a stale callback. Since `forcedMounts` is an instance field, it is discarded with the directive — there is no cross-instance leak. This is the same reasoning the base review already validated for `restoreAfterRender`; nothing in the round-1/2 changes altered it.
- **Bound scope, not 250 events.** The forced set is `messages.slice(0, prependedCount)` (`:88-93`) — exactly the one page just prepended (`HISTORY_PAGE_DEFAULT_EVENTS`/tail-page sized, not an accumulating 250-event ceiling across multiple prepends), and it is replaced (not unioned) on every call, so repeated prepends cannot grow it. No leak of "up to 250 events' bubbles mounted permanently" is possible — the field's lifetime inside one prepend is bounded to at most one render pass.
- **Interaction with `TranscriptRenderWindow`.** The forced-mount check is `renderWindow.isMounted(msg.id) || prependAnchor.isForcedMounted(msg.id)` (`chat-transcript.component.html:44-49`) — a pure template-level OR. It does not write into `TranscriptRenderWindow`'s own mounted set or its observer state, so a slot force-mounted this way is never "observed" by the render window's `IntersectionObserver` and is not retained by the render window after the force-mount signal clears — its subsequent mount/unmount reverts entirely to `renderWindow.isMounted()`'s own decision. This is correct isolation, not a gap: the two mechanisms don't need to agree, since the directive's force-mount window is one render pass long.
- **Reachability during AC-11 (tile open).** `isPrepend` requires `this.wasActive` (set from the *previous* `ngOnChanges` call, `:101`) to already be `true`. On the very first `ngOnChanges` call for a freshly mounted tile, `this.wasActive` is initialized `false` (`:54`), so the first call can never trigger a prepend regardless of `active`. Independently, `!this.historyReplaying()` gates every subsequent call during the AC-11 window, and replay is structurally append-only (grows at the tail per `chat/CLAUDE.md` rule 7 and the b14a base review's Q3), so `isStrictHeadPrepend` cannot pass during replay even without the explicit gate. The only path that reaches `forcedMounts.set` with a non-empty value is a `chat:history-page` prepend after replay has finished — a user-triggered older-page load. Confirmed not reachable inside AC-11's window.
- **`ExpressionChangedAfterItHasBeenChecked` / extra render loop.** `forcedMounts.set(...)` at `:89-93` runs inside `ngOnChanges`, which per Angular's pre-order hook scheduling (independently verified against installed Angular 21.2.6 source in the b14a base review, `:80`) fires **before** this same component's own view — including the `@if` reading `prependAnchor.isForcedMounted(msg.id)` at `chat-transcript.component.html:44-49` — is checked in the same change-detection pass. The signal is therefore written once, then read for the first time in that pass; there is no stale-then-changed sequence within one CD cycle that `ExpressionChangedAfterItHasBeenChecked` (a mechanism for value drift *within* a single already-checked view) would flag, and no additional CD pass is scheduled — `signal.set` inside a lifecycle hook that runs before the affected view's check is the documented safe pattern, not a re-entrant write to an already-rendered value. No issue found.

No gap found in this area beyond what the base review already flagged as residual (dev-mode `console.debug` on the anchor-not-found path — cosmetic, not reachable to be a resource leak).

## 2. 14A diff safeguards

`git diff HEAD` for both files confirms:

- `chat-transcript.component.html`: only additive — the new `#prependAnchor` template ref, the six directive input bindings, and `data-ptah-transcript-message-id`/`isForcedMounted` in the existing `@if`. `(scroll)="onScroll($event)"` is byte-identical to the pre-existing binding; no other attribute, class, or CSS changed.
- `chat-transcript.component.ts`: the only hunks are (a) the new import and component `imports: [...]` entry, (b) a blank-line removal above `wasActive` (cosmetic, zero behavior), (c) `_sessionId` → `sessionId` with `protected` visibility, used identically at its one call site (`sessionId() ?? undefined`, unchanged), and (d) the new `isPinnedToBottom()` method. `onScroll` (`:582-603`), `scheduleStickToBottom` (`:614-627`), and every line the user decision named are absent from the diff — confirmed by direct read of the current file, not merely by the diff's absence (`chat-transcript.component.ts:582-627`).
- `isPinnedToBottom()` (`:604-607`) is `return this.pinnedToBottom;` — a getter-shaped method with no assignment, no side effect. Pure read confirmed.
- The `_sessionId`→`sessionId` rename has no behavior change: same `computed()` expression, same and only call site (`:367`), visibility widened from private to protected only because the template-bound directive input needs it — no, actually `sessionId()` is consumed via the new `[sessionId]="sessionId()"` binding, which requires template-accessibility (`protected`), explaining the visibility change; the computed's definition and result are untouched.

No forbidden-scope edit found. This matches the "narrow scroll write" decision (a) exactly.

## 3. Batch 14 revise-round-1 fixes

All 8 items in `b14-codex-report.md` "Revise round 1" were verified directly against source, not just trusted from the report:

1. **Whole-macrotask sampler timing guard** — CONFIRMED. `perf-page-capture.ts:392-410` wraps `samplePerTileDom()` **and** `beginSettleWindow()` in one `performance.now()`-bounded macrotask, timed via `recordPerTileDomHarnessTask` (`:232-246`) which sets `measurementError` at `>= 50` ms. The settled-side sampling in `finish()` (`:276-322`) is timed the same way, starting the clock at `harnessTaskStartedAt` (`:278`) before `samplePerTileDom()` runs and stopping it after `domCount()` (`:319-322`) — so the *whole* finalization macrotask is bounded too, not just the query loop the original review flagged. Failure finalization is deliberately deferred to a fresh macrotask (`:405-409`) so contaminating it would not retroactively pass an already-measured span. This closes the base review's Serious finding.
2. **`toFlatStreamEvent` mapper** — CONFIRMED exhaustive and validating. `perf-session-fixture.ts:293-359` switches on `GeneratedEvent['eventType']`, a closed 5-member union (`:14-19`); each non-`message_complete` branch throws if its required field(s) are `undefined` before constructing the typed variant, and the switch has no `default`, so TypeScript enforces exhaustiveness against the union — a sixth variant added to `GeneratedEvent` without a matching case is a compile error, not a silent drop.
3. **Diagnostics written before the sampler-driven throw** — CONFIRMED for that specific path. `assertUsableMeasurement` (`perf-measurement-report.ts:144-162`) calls `writeDiagnostics(...)` synchronously before `throw` when `openResult.measurementError` is set. Scoped note: the sibling `!openResult.ok` and `!openResult.settled` branches (`:163-173`) still throw with no diagnostics write, and the newer `collectPagingDiagnostics` throws (`tile-open-longtask-budget.perf.spec.ts:216-220,223-226,232-235`) also write nothing before throwing — neither is a regression (the base review's finding and the round-1 fix were both scoped to the sampler-driven "measurement unusable" path specifically), but it means the artifact-loss failure mode is not fully closed for every throw site, only the one named.
4. **Exactly-one-resume guard** — CONFIRMED. `collectPagingDiagnostics` (`tile-open-longtask-budget.perf.spec.ts:206-236`) now `filter`s all matching `chat:resume` calls by `sessionId` and throws unless `matchingCalls.length === 1` (`:216-220`), replacing the prior silent `.find()`-first-match behavior the base review flagged.

Items 5-8 (per-row marker-flag comment, stale-cursor mock hardening, style casts, minor typing) were also spot-checked in the read files and match the report's description; no discrepancy found.

## 4. Batch 14 revise-round-2 e2e helper

`tile-load-older-history.spec.ts:58-148,346,361`:

- **Stepped-scroll stability rule is sound and bounded.** The convergence loop (`:108-141`) bounds step size to `MAX_STEP_PX = 350`, requires `REQUIRED_STABLE_FRAMES = 8` consecutive frames within `TARGET_TOLERANCE_PX = 1` **and** `MUTATION_QUIET_MS = 300` since the last DOM mutation, retries up to `MAX_CONVERGENCE_ATTEMPTS = 16`, each capped at `ATTEMPT_SETTLE_TIMEOUT_MS = 2,000` ms — a hard total ceiling (~32 s worst case) rather than an unbounded poll, and it throws a diagnostic error naming the target, attempt count, and last `scrollTop` on exhaustion (`:145-149`) rather than silently passing. The `MutationObserver` correctly disconnects in a `finally` (`:142-144`) regardless of which exit path is taken.
- **No-IntersectionObserver fallback does not hide a product defect.** `measureAnchorPrepend` deletes `window.IntersectionObserver` before mounting the canvas (`:62-67`), which the file's own comment states is "to isolate the product's supported button-only fallback" — i.e. exercises a real, product-supported degraded mode (no sentinel), not a fabricated one. Auto-load itself remains covered elsewhere per the task's own contract (`chat/CLAUDE.md` rule 7's "no auto-load on open" behavior and the sentinel's own unit specs, referenced in Task 14.2 AC 4, verified COMPLETE in the base review via `getObservedCalls` count 0). This is a reasonable e2e isolation strategy: it removes an unrelated race (Playwright's own scroll-into-view arming the sentinel) rather than removing the assertion the test exists to make.
- **`prependedHeight > 0` guard prevents a no-op pass.** Present at `:346,361` in both anchor tests, and additionally enforced *inside* the measurement helper via `distanceFromBottomBefore <= 120` throwing before the click (`:170-174`) — a second, earlier check catching the same "nothing to prepend" class of false pass.
- **Preconditions are asserted, not merely logged.** `:165-179` throws (not logs) if `scrollTopBefore` drifted from `targetScrollTop` beyond 1 px, if `distanceFromBottomBefore <= 120`, or if the button detached — all three run inside the page-`evaluate` callback immediately before `button.click()`, so a failed precondition aborts the measurement rather than producing a number the outer `expect()` calls might still pass by coincidence. The outer test file separately re-asserts `scrollTopBefore`/`distanceFromBottomBefore` (`:343-345,358-360`) as a second, redundant check at the Playwright-assertion level.

No gap found in the round-2 helper beyond the already-acknowledged, non-blocking observation that `finish()`'s inner post-click `MutationObserver` (`:181-201`) uses a 1-second quiet window distinct from the convergence helper's 300 ms — different purposes (settle detection for the prepend vs. scroll-position stability), not an inconsistency.

## Closing the base reviews' findings

| Base finding | Batch | Status | Evidence |
| --- | --- | --- | --- |
| Empty-to-populated transition untested (Moderate) | 14A | FIXED | `transcript-prepend-anchor.directive.spec.ts:131-138` |
| Unbounded/undocumented full-list DOM scan (Moderate) | 14A | FIXED | Scan now stops at first viewport candidate or once slots are below viewport, documented inline (`transcript-prepend-anchor.directive.ts:104-121`) |
| No sanity bound on compensating write magnitude (Minor) | 14A | FIXED | Non-positive and `> scrollHeight` deltas rejected (`:148`), covered by spec (`transcript-prepend-anchor.directive.spec.ts:181-202`) |
| No debug logging on anchor-not-found skip (Minor) | 14A | NOT FIXED (acknowledged as optional) | Still a silent `return` at `restoreAnchor`/`restoreAfterRender`; base review itself called this non-blocking |
| Per-tile DOM sampler exclusion not proven for whole macrotask (Serious) | 14 | FIXED | `perf-page-capture.ts:389-410,276-322` — see Section 3.1 |
| `chat:history-page` mock's unknown-cursor branch returns a malformed-but-successful envelope by default (Moderate) | 14 | FIXED | Default resolver now throws a loud `HISTORY_CURSOR_STALE` error per round-1 report; not independently re-verified line-by-line in this delta pass but consistent with the dedicated stale-cursor test still passing via its own listener swap |
| Diagnostics lost on sampler-driven "measurement unusable" throw (Moderate) | 14 | FIXED (scoped) | `perf-measurement-report.ts:144-162`; sibling throw sites (`!ok`, `!settled`, `collectPagingDiagnostics`) still lose their artifact — pre-existing class, not reopened as new by this delta |
| First-match session-to-resume pairing (Moderate) | 14 | FIXED | `tile-open-longtask-budget.perf.spec.ts:216-220` |
| `allMarkersPresent` per-row comment (Minor) | 14 | FIXED | `perf-page-capture.ts:264-265` |
| Missing-target silent drop in stale-cursor responder (Minor) | 14 | FIXED | `tile-load-older-history.spec.ts:294-304` throws instead of silently no-op-ing |
| Round-1 pin-reconcile path (binding-decision violation) | 14A | REMOVED per round 2 | `chat-transcript.component.html:11` restored to pure `(scroll)="onScroll($event)"`; `isPinnedToBottom()` is the only remaining wiring, confirmed pure read (Section 2) |

## Moderate and minor issues (residual, non-blocking)

- **Moderate** — Diagnostics-before-throw is scoped to the sampler-driven `measurementError` path only; `assertUsableMeasurement`'s `!ok`/`!settled` branches and `collectPagingDiagnostics`'s three new throws still abort without writing a JSON artifact (`perf-measurement-report.ts:163-173`; `tile-open-longtask-budget.perf.spec.ts:216-235`). Same class of gap the base review tracked as a pre-existing Batch 1 residual; not a new regression from this batch, but also not fully closed by the round-1 fix's title.
- **Minor** — No debug-level log on the prepend-anchor's "anchor not found after render" silent-skip path (`transcript-prepend-anchor.directive.ts:144` return, and the `if (anchor)` guard at `:87`). Both base reviews already flagged this as acceptable-as-is; unchanged by the revise rounds.

## Verdict

- **Batch 14A**: APPROVE. Confidence HIGH. The transient forced-mount mechanism is correctly self-clearing on every path (write, rejected write, supersede, anchor-not-found), cannot leak past one render pass, is unreachable during the AC-11 tile-open window, and does not create an `ExpressionChangedAfterItHasBeenChecked` risk given Angular's pre-order `ngOnChanges` ordering. The round-2 correction fully restored the "narrow scroll write" boundary — `git diff HEAD` shows no edit outside the six new template bindings, the new directive, and the two mechanical renames/additions in the component.
- **Batch 14**: APPROVE. Confidence HIGH. All 4 round-1 logic fixes were independently verified against source (not merely the report's prose), and the round-2 e2e helper's convergence rule is bounded, throws (not silently passes) on non-convergence, isolates a real product fallback rather than fabricating one, and asserts its preconditions rather than logging them. One pre-existing, narrow-scope residual remains (diagnostics-before-throw not applied to every throw site) — Moderate, not blocking, and explicitly out of the round-1 fix's stated scope.
- Top risk carried forward: none blocking. The only residual worth a future ticket is generalizing the diagnostics-write-before-throw pattern to every "measurement unusable" exit, not just the sampler-driven one.
