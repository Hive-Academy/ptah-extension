# Fix round FC

## Findings

- **S1:** `provider-readiness.store.ts:92-102` clears the shared mount promise after each cycle. Concurrent mounts share one promise; a later mount starts fresh reads. Spec: `provider-readiness.store.spec.ts:72`. Residual risk: unexecuted in this lane.
- **S2:** `provider-readiness.store.ts:77-84` uses the boolean returned by `refreshAuthStatus()` before clearing `notConfirmed`. `connection-choice.store.ts` already maps false to notice 12. Specs: `provider-readiness.store.spec.ts:85`, `connection-choice.store.spec.ts:49`. Residual risk: unexecuted in this lane.
- **S3:** `chat-view.component.ts:297-298,1418-1427` resets re-auth state when banner identity changes; `chat-view.component.html:163` renders only for the initiating banner. Specs: `chat-view.component.spec.ts:845,859`. Carry-over state was untouched. Residual risk: visual behavior was not rendered in Electron because application targets were prohibited.
- **M1:** `provider-readiness.store.ts:159-175` keeps retrying active through both follow-up reads and checks raw timeout facts for the next attempt; `provider-readiness.derive.ts:56,89` retains slow while a core read reports checking. Spec: `provider-readiness.store.spec.ts:93` covers slow during an in-flight follow-up and the terminal timeout after two 5 s delays. Residual risk: unexecuted in this lane.
- **M3:** `provider-readiness.store.ts:27-50,124-139` sets a provider-local terminal error on a rejected read and clears it at the next cycle. Spec: `provider-readiness.store.spec.ts:112`. Residual risk: unexecuted in this lane.

## Decisions

- Kept `connection-choice.store.ts` unchanged: it already sets notice 12 on a false retry result. Evidence: `retry()` at lines 66-70. Reversible.
- Kept decision 21 timing: two mount follow-ups at 5 s; recheck remains a single read. Evidence: `MAX_FOLLOW_UPS` and `run()` branch. Reversible.
- Used provider-local failure signals so a rejected read reaches a terminal state even when a core service leaves its view checking. The signal resets on the next provider cycle. Reversible.

## Verification and remaining work

- Read the full Phase C review and the requested Angular skill. Reviewed the edited control flow and spec assertions.
- Scoped Ptah diagnostics were attempted twice; its TypeScript check remained in progress and returned all six TypeScript files as unchecked. The HTML file was unrecognised. No clean diagnostics claim is made.
- No tests, build, browser, Nx, npm verify, Jest, TypeScript CLI, Playwright, application target, or git command was run, per task rules. CI must execute the added specs.
- M2, M4, m1 and m2 were left outside scope as requested.
