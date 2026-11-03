# Code Logic Review: e2e hunk-revert RCA, Fix A and Fix B

Implementer family: codex
Review family: Claude subagent (lanes at limit)
Verdict: APPROVED

Scope read: the full diff of `cli-detection.service.ts`, its spec and `hunk-revert-top-layer.spec.ts`; `detectAll`/`doDetectAll` in full; `agent:getConfig` (`agent-rpc.handlers.ts:474-483`); the `AppShellComponent` auth redirect (`app-shell.component.ts:275-305`); `UiDriver.pushEvent`/`goto` (`ui-driver.ts:345-375`); the author's RCA. Nothing was executed (read-only brief).

## Findings

1. **Moderate - Fix B narrows the race window but does not close it.**
   `hunk-revert-top-layer.spec.ts:192-196`. `pushEvent` switches to Chat once. If `loadAuthStatus()` resolves after that push (the auth probe is 2-5s, per the comment at `app-shell.component.ts:281`), `setCurrentView('settings')` still fires and the later canvas-heading and hit-test assertions fail. The `authCheckDone` effect only triggers once per app instance, so a deterministic fix would wait for the auth state to settle first. Options: wait until the redirect has landed (Settings visible) before opening the dialog, or seed auth in the fixture home. Residual flake risk is lower than before but not zero. Not blocking, because the heading assertion that follows retries and the previous failure window was the long one.

2. **Moderate - the RCA's causal link to detection speed is unproven, and Fix A does not shorten Codex's own latency.**
   `doDetectAll` is on the `agent:getConfig` critical path (`agent-rpc.handlers.ts:481`), and that was already true before this branch. The only branch regression is the added Codex `--version` probes inside `codex.detect()`. Fix A overlaps them with the other adapters, so the worst case drops from the sum of all adapters to the slowest one. It does nothing for Codex's own serial probes (up to 7s each). The RCA admits it cannot show that detection delayed `auth:getAuthStatus`. Fix A is a sound, low-risk improvement independent of the e2e failure. The e2e fix really rests on Fix B. I found no more direct regression in the diff. Whether detection should stay on the `agent:getConfig` path is a design question beyond this task.

3. **Minor - formatting.** `cli-detection.service.ts` (the `return [name, {...}]` block) and the new spec test (`cli-detection.service.spec.ts:234-254`, long one-line objects and `.map` lines) are not Prettier-shaped. lint-staged will probably rewrite them on commit. Run prettier on the three files.

4. **Minor - the new spec checks that peers have started and that order is preserved, but not that one adapter's rejection leaves the others intact.** The existing error-branch test (`mockRejectedValue` for codex) covers a single rejection, and with `Promise.all` plus a per-adapter try/catch it still holds. A test with a rejection alongside a still-pending peer would pin the "no whole-call rejection" property. Optional.

## Check results

1. **Fix A correctness: OK.**
   - Order: `Promise.all` over `[...this.adapters]` returns entries in map insertion order. `new Map(entries)` and `Array.from(values())` keep that order, so the Claude-last fallback order is unchanged.
   - Rejection isolation: the try/catch is inside each mapped async function and returns a fallback row, so `Promise.all` cannot reject from `adapter.detect()`. The Sentry capture and the error-row shape are unchanged. A throw from `adapter.capabilities()` inside the catch would reject the whole call, and it would have done the same in the old loop.
   - In-flight and cache: `detectAll` (lines 146-163) is untouched, and `detectionCache` is still set once at the end. Concurrent callers share `detectionInFlight`. `invalidateCache` during an in-flight run has the same pre-existing semantics: the stale result is written when the run finishes, as before.
   - Fan-out is bounded by the fixed adapter count (about 9, including claude). It is a one-off at startup and on invalidation, so the peak is a handful of short-lived child processes at once.
   - Serial side effects: I found no adapter that relies on the previous adapter having finished. Adapters get independent constructor dependencies. The shared `spawner` is used per call. Log line order is now nondeterministic, which is harmless.

2. **RCA: plausible and cited.** The redirect code is exactly as described (`app-shell.component.ts:288-303`: the no-auth branch calls `setCurrentView('settings')` after the guard checks). The snapshot showing Settings behind the dialog is consistent with it. Product behaviour is unchanged: that redirect is existing onboarding behaviour. See finding 2 for the unproven timing link.

3. **Fix B and intent: acceptable.**
   - The test still asserts the canvas heading and geometry overlap, the unforced mouse click on Cancel, and an unchanged worktree diff after the switch. `switchView` goes through the same `setCurrentView` path the app uses, and `UiDriver.goto` already uses it (`ui-driver.ts:362`).
   - Product bug check: only an installed-but-unauthenticated user sees Settings appear over Chat late at startup. That user was already redirected, only at an earlier point. The `pendingSurface` guard (`:296-297`) prevents the redirect from overriding a click in progress. I see no new product exposure. Detection speed affects user-visible redirect timing only as much as `auth:getAuthStatus` does, and Fix A only makes it earlier.

4. **Hygiene: clean.** No `any`, `as unknown as`, non-null `!` or `console.*` is added in the diff. `catch (error: unknown)` is used, the error is reported to Sentry and logged, and the `degradation-audit` comment is retained. In the spec, the `if (!releaseCodex) throw` guard is fine.
