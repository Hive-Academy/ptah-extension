# Code Logic Review — Round 2 — `TASK_2026_526_aa0e`

## Verdict

**APPROVE WITH FIXES** — all four round-1 defects are genuinely fixed with substantive tests, but the orchestrator's collapsed-`<details>` change hides the only content a stdout-only agent has, which is a moderate defect proven by a failing test.

## Score

**80/100** — up from 60/100. The two major defects are fixed correctly and the cache design is now sound (verified against the store's mutation contract, not taken on the author's word). The remaining 20 points come from one moderate defect in the orchestrator's change, a test-assertion gap that hides it, and one minor remount note.

## Defect status

| # | Original defect | Status | Evidence |
| - | --------------- | ------ | -------- |
| 1 | Side effect inside `computed()` defeats the cache and deletes sibling state | **FIXED** | `clearAgentCache` is gone from the component (`cli-agent-output.component.ts:152-167` — pure read of `streamRevision()`, `buildTree`/`buildTreeFromSegments`, `finalizeOrphanedTools`). The builder cache is now keyed by array identity and length (`agent-monitor-tree-builder.service.ts` — `cached.segments === segments && cached.count === segments.length`), verified by direct cache-key tests at `agent-card-unified.spec.ts:97-115` (same array reuses, same-count replacement rebuilds, same-array append invalidates via length). **I verified the identity assumption myself in the store:** every `segments` writer creates a new array — coalesced merge at `agent-monitor.store.ts:806-814`, append spread at `:816`, restore paths at `:1081` and `:1169` all spread or replace; `capSegments` returns the same array under the cap without mutating it (`agent-output-retention.ts:211`) and that array is already fresh at every call site; over cap it returns a new array. No in-place mutation of a `MonitoredAgent.segments` array exists anywhere in `chat-streaming` (the `segments.push` hits in `agent-card.utils.ts` are local arrays inside `parseAgentOutput`). The event-path `buildTree` and its `eventStateMap` are untouched — the git diff of the service shows only the segment cache changed. |
| 2 | Mid-run renderer flip drops already-rendered stdout | **FIXED** (author's fix); the orchestrator's follow-up change then introduced a new, narrower visibility defect (see below) | The card mounts exactly one `ptah-cli-agent-output` unconditionally inside the output guard (`agent-card.component.ts:87-97`); `parsedOutput()` (`:128-131`) feeds stdout through the new `stdoutSegments` input, so no branch can swap the component or scroller. Regression test at `agent-card-unified.spec.ts:117-188` retains the exact DOM node references and `scrollTop = 37` across a first text **and** first error segment, for both the flat child and the scroller. The flat renderer's `embedded` input correctly cedes scroll ownership (`agent-card-output.component.ts:39` input, `:314` class swap, `:330` effect early-return). |
| 3 | `totalTokens` silently hidden once a split is ever reported | **FIXED** | `cli-agent-output.component.ts:59-63` renders any defined total with the label **"Reported total: N tokens"**, independent of split availability. No double-count in the display: the total is a separate accumulation (`stats-bar.utils.ts:57-60`), never `inputTokens + outputTokens`; the label makes the 1.5k-vs-500 difference a reported value, not a sum. Rendered proof: `stats-accumulation.spec.ts:98-142` (total 1500 shown as 1.5k, `2.0k` absent), `agent-card-unified.spec.ts:190-223`, and the zero-values case `cli-agent-output.component.spec.ts:298-318`. |
| 4 | Test locks in defect 1's workaround | **FIXED** | The rewrite at `cli-agent-output.component.spec.ts:263-280` asserts only rendered DOM text after a same-count replacement — no cache key, no `clearAgentCache` spy, no computed internals. The cache contract is now covered by dedicated, separate tests (`agent-card-unified.spec.ts:97-115`). |

Additional round-1 confirmations, re-verified:

- `isUsageSegment` guard is `type === 'info' && segment.usage !== undefined` (`stats-bar.utils.ts:33-35`); three content-bearing types are pinned as not-filtered (`stats-bar.utils.spec.ts:4-15`) and a rendered text-with-usage case proves the tree keeps the content while the stats bar reads the metadata (`cli-agent-output.component.spec.ts:159-179`).
- The converted specs are **not softened**. `agent-card-unified.spec.ts` converted all three defect assertions to fixed-behaviour form and was *strengthened* (an error-only transition via `it.each`, and direct cache-key semantics). `stats-accumulation.spec.ts` keeps all five scenarios with explicit typed-contract expectations; the removed legacy-extractor copies were comparison harnesses whose results stand recorded in round 1. The one earlier focused-test failure in the author's report was a real harness bug (rAF stub blocking paint), and the fix reorders assertions rather than removing any — confirmed by reading the test: retention assertions run before the frame flush, content assertions after (`agent-card-unified.spec.ts:164-183`).

## Review of the orchestrator's change

**Verdict: the direction is right, the default is wrong. Keep the `<details>`, but open it while it is the only content.**

What the change gets right, with evidence:

1. **The duplication rationale is real.** Every current adapter pairs its stdout with structured segments: opencode emits both or neither (`opencode-cli.adapter.ts:505-532` — non-JSON lines are dropped from *both* channels at `:597-602`), and every adapter error path emits an error segment beside the output text (`antigravity-cli.adapter.ts:658-663`, `opencode-cli.adapter.ts:550-553` and `:558-566`). So for live lanes the details holds a near-duplicate of the visible tree, and always-open rendering (the author's round-1 version) showed everything twice.
2. **The specific crash worry is refuted.** The opencode early-death explanation is an error *segment* (`opencode-cli.adapter.ts:550-553`), which renders in the always-visible tree region, not inside the details. I added a guard test proving the error node renders outside the details — it passes (see Verification). What sits collapsed is only the duplicated raw copy of output the user can already see as nodes.
3. **It is strictly more than HEAD.** Pre-refactor, any agent with segments or stream events dropped stdout from the view entirely. The collapsed details preserves it where HEAD threw it away.

Where it fails:

**The stdout-only state — the exact state defect 2 was about — now renders an empty-looking card.** An agent whose adapter has emitted stdout but no segments and no events mounts the output component, which shows a collapsed "Raw stdout" summary row and an empty tree region. The user watching a fresh agent start sees no agent activity unless they know to click. My original defect statement was DOM-level ("vanishes from the DOM"), so the letter of defect 2 is met; this is a new, narrower defect introduced by the change, not defect 2 surviving. But it is the same user moment: pre-segment output. No current adapter persists in that state (all pair their emissions), yet the component's own tests construct it (`cli-agent-output.component.spec.ts:198` builds exactly this agent and its title claims "visible"), which makes the state part of the component's designed input, not a hypothetical.

**On the defect-2 test: the orchestrator's suspicion is confirmed.** `<details>` keeps its children in the DOM when closed, and the template renders the flat child unconditionally (`cli-agent-output.component.ts:80-97` — no `@if` inside the details). So the `textContent` assertions at `agent-card-unified.spec.ts:143` and `:170-183`, and at `cli-agent-output.component.spec.ts:214-216`, prove DOM presence only and pass whether the block is open or closed. The test should be strengthened: keep the textContent assertions (they prove retention), and add explicit state assertions — while segments are empty assert the stdout is presented open, and after the first segment arrives assert the details state explicitly. Under the current code an honest state assertion fails, which is the point.

**Recommended rule, with costs.** Open while the details is the only content; auto-collapse once when rich content arrives; hands off to the user after that:

```ts
readonly rawStdoutOpen = signal(true);
private readonly autoCollapsed = signal(false);

constructor() {
  effect(() => {
    const hasRich =
      this.executionNodes().length > 0 ||
      this.stderrSegments().length > 0;
    if (hasRich && !this.autoCollapsed()) {
      this.autoCollapsed.set(true);
      this.rawStdoutOpen.set(false);
    }
  });
}
```

Template: `<details [open]="rawStdoutOpen()" (toggle)="rawStdoutOpen.set(($event.target as HTMLDetailsElement).open)">`.

- Stdout-only phase: open, content visible. Fixes the failing test.
- First segment/event/stderr arrives: collapses once, in the same change-detection cycle that introduces the tree content, so the duplication window is zero — the collapse fires exactly when duplication would begin.
- User toggle handling: the `(toggle)` handler is mandatory, not optional. Without it, Angular's `[open]` binding resets the user's click on the next change detection; with it, the signal and the DOM agree and manual state survives every later render. The `autoCollapsed` latch means the auto-collapse never fights the user again.
- Cost: about ten lines, two signals, one template binding, one event handler. Cheaper alternative rejected: binding `[open]` directly to a computed `executionNodes().length === 0` re-collapses and re-opens on every tree change and overrides the user's toggle with no latch.

**Scroller/rAF interaction: no defect.** The follow-output effect tracks signals, not DOM events (`cli-agent-output.component.ts:175-187`). Expanding the details fires nothing, so expansion never fights the effect; the revealed content renders at the summary's position, in view without scrolling. The next stream delta then auto-scrolls to the new bottom — identical to the pre-existing behaviour for any content change, not made worse by the details.

**Accessibility: an improvement, not a regression.** Native `<details>/<summary>` gives a keyboard-operable disclosure with a button-role summary whose accessible name is "Raw stdout". That is stronger than the author's `aria-label` on a `<section>`, which labelled a region but did not make it operable. No accessibility objection.

**One minor cost to accept or fix later:** `@if (agent().expanded)` at `agent-card.component.ts:53` unmounts the output component on card collapse, so the user's manual details state (and scroll position) resets on every card toggle. That is native remount behaviour, consistent with the old components, and not worth lifting state above the card today — but it means a user monitoring raw stdout must re-open the details after each card toggle. Say so in the PR description or fix it with the same signal lifted to the card.

## New defects

### 1. A stdout-only agent renders an empty-looking card

- **File:** `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-agent-output.component.ts:81` (details with no `[open]` binding or open-by-default rule), mounted by `agent-card.component.ts:81-98`.
- **Scenario:** Agent state `{stdout: 'Initializing sandbox…', segments: [], streamEvents: []}` — pre-segment output, the state defect 2 described. The card shows one collapsed summary row and an empty tree region. The user sees no agent activity.
- **Impact:** No data loss (one click away), but the card looks dead at the moment the user is watching a fresh agent start. Also undermines the fallback test's own claim: `cli-agent-output.component.spec.ts:198` is titled "keeps no-segment raw stdout … visible" while its assertions prove presence only.
- **Severity:** moderate.
- **Evidence:** `stdout-visibility.review.spec.ts:76` fails — `Expected: true / Received: false` on `details.open` for a stdout-only agent (see Verification). The paired crash-visibility test passes, proving the error-node path is unaffected.

### 2. Regression tests cannot distinguish open from collapsed

- **File:** `agent-card-unified.spec.ts:143`, `:170-183`; `cli-agent-output.component.spec.ts:214-216`.
- **Scenario:** Any future change that renders the details permanently closed (or removes its open affordance) passes all current assertions, because `<details>` children stay in the DOM when closed.
- **Impact:** The defect-2 regression suite proves DOM retention, not presentation — which is exactly why defect 1 above was invisible to the author's green run.
- **Severity:** minor (test coverage), but it is the mechanism that let the moderate defect through.
- **Fix:** Add explicit `details.open` state assertions at both points (initial stdout-only state, and post-first-segment state), per the recommendation above.

### 3. Manual details state resets on every card toggle

- **File:** `agent-card.component.ts:53` (`@if (agent().expanded)` unmounts the output component).
- **Scenario:** User opens "Raw stdout", collapses the card, expands it again — details is collapsed again.
- **Impact:** Minor repeated friction for users who monitor raw output across card toggles. Consistent with pre-existing remount behaviour (scroll position also resets).
- **Severity:** minor. No failing test written — it is remount semantics, not a logic error; fix by lifting the open state to the card only if users complain.

## Verification

Defect proof (new review spec, run focused):

```text
npx nx test chat --skip-nx-cache --testPathPatterns=stdout-visibility.review.spec.ts --runInBand

Test Suites: 1 failed, 1 total
Tests:       1 failed, 1 passed, 2 total
```

Failure detail (clean jest run):

```text
expect(received).toBe(expected) // Object.is equality

Expected: true
Received: false

  74 |       output.querySelector('details');
  75 |     expect(details).not.toBeNull();
> 76 |     expect(details!.open).toBe(true);
        |                           ^
  77 |   });

  at src/lib/components/molecules/agent-card/stdout-visibility.review.spec.ts:76:27
```

The passing test in the same file ("keeps crash error segments visible outside the collapsed details") confirms the opencode crash path: the error segment renders as an execution node outside the details.

Full required suite (the single failure is the review spec above; everything the author and orchestrator wrote passes):

```text
npx nx run-many -t test,lint,typecheck -p chat,chat-ui,shared,cli-agent-runtime --skip-nx-cache

Test Suites: 1 failed, 90 passed, 91 total
Tests:       1 failed, 2 skipped, 1378 passed, 1381 total
√  nx run @ptah-extension/shared:test
√  nx run @ptah-extension/shared:lint
√  nx run @ptah-extension/shared:typecheck
√  nx run @ptah-extension/chat-ui:test
√  nx run @ptah-extension/chat-ui:lint
√  nx run @ptah-extension/chat-ui:typecheck
√  nx run @ptah-extension/cli-agent-runtime:test
√  nx run @ptah-extension/cli-agent-runtime:lint
√  nx run @ptah-extension/cli-agent-runtime:typecheck
√  nx run @ptah-extension/chat:typecheck
√  nx run @ptah-extension/chat:lint
X  nx run @ptah-extension/chat:test   (fails only on stdout-visibility.review.spec.ts)

NX   Running targets test, lint, typecheck for 4 projects failed
Failed tasks:
- @ptah-extension/chat:test
Run duration:      1m 10s
Cache:             Skipped (--skip-nx-cache)
```

## Temporary test files

- `libs/frontend/chat/src/lib/components/molecules/agent-card/stdout-visibility.review.spec.ts` — added by this review; test 1 proves new defect 1 (delete or convert to the fixed behaviour once the open-while-only-content rule lands); test 2 is a permanent-grade guard for the crash path and should be kept in the converted suite.

## Verdict

- Recommendation: **APPROVE WITH FIXES** — apply the open-while-only-content rule (or an explicitly accepted empty-card state), then convert the review spec and add the `details.open` state assertions.
- Confidence: HIGH.
- Top risk: a user watching a fresh stdout-only agent sees a card that appears frozen, with the activity hidden behind a collapsed toggle they have no signal to look for.