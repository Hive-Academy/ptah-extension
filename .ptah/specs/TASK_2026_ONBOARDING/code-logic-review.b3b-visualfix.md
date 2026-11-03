# Code Logic Review — TASK_2026_ONBOARDING (b3b visual fixes)

Scope: `git diff bc924a31b -- libs/` (generate-agents, project-guidance, analyze-done pages and specs, onboarding-stepper and spec, onboarding-generate-visual e2e spec). Static review only; verify/build/e2e were not run (coordinator owns verify).

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 7.5/10 |
| Assessment | APPROVE (with follow-ups) |
| Blocking | 0 |
| Serious | 0 |
| Moderate | 3 |
| Minor | 5 |

## Checks requested

**Run-state copy (generate-agents.page.ts:127-137).** Covers failed, timed-out, cancelled, cancelling/stop-unconfirmed/stop-unknown, start error, completed (with and without failed agents), idle, and a generic fallback for starting/running/quiet. Raw provider text only reaches the UI through `safeFailureCopy` (failed, timed-out, startError). The completed-with-failures branch uses fixed copy and the card shows only `agentId`/`fileName`/status, so `agent.error` never renders. The spec (`EACCES /private/key` becomes "permission denied", path absent) asserts this. OK. Gap: `quiet`/`starting` fall to "The run continues in its bound session." (M1).

**A3 partial failure.** `panelState` comes from `chipStateFor(state)`, so a completed run still maps to `done` and `run-panel.component.ts:34-35` keeps the "Continue to guidance" button. The `has-failed-agents` ::ng-deep rule (generate-agents.page.ts:21) hides the green "Done" chip. A "Needs attention" badge (l.45), a "Some agents failed" title, red per-card status and a "Retry this agent" button replace it. Spec asserts title, badge, `text-state-err` and Continue present. Correct. Caveat: Continue is deliberately not gated, which is acceptable. The message says "retry them before continuing", so this is advisory copy.

**Done page link (analyze-done.page.ts:36, 56-58).** `onboardingStepLink('guidance','generate',{gen})` gives `['/onboarding','analyze','generate']` with query `{tab: gen}` (onboarding-step-link.ts, guidance to generate branch). This matches the `analyze/generate` route (onboarding.routes.ts:45) and the generate page's `tab` param. `gen` is present because guidance to done carries `tab` and `gen` (step-link `pickKeys`). `identityValue` handles a null `gen`. Correct. Gap: if `gen` is absent, the query is `{}`, the link still renders, and the click lands on the generate page's missing-tab recovery (M2). The spec asserts `queryParams` only, not `commands` (m3).

**Stepper current-complete (onboarding-stepper.component.ts).** The union keeps `link?: never` for current-complete, so type safety holds. The `<li>` gets `aria-current="step"`, a check icon (aria-hidden) and an sr-only ", completed". It reads "Done, completed" once and is not a link. Layout classes are mirrored from `current`. OK. Dropping `truncate` (previously on the label) means a long label at a very narrow width can overflow, because `whitespace-nowrap` and `min-w-0` remain (m1). `px-1` vs `min-[720px]:px-3` resolves correctly by variant order.

**Other stepper users.** choose-agents.page.ts:143-147, generate-agents, project-guidance:134-138, analyze-done. Only analyze-done uses the new state. The remaining pages pass only existing states, and only `completed` carries a link. The shrink and padding changes apply to all of them. The shrink change relies on `li` `shrink` plus `min-w-0`, which is fine. No type regression. The stepper spec covers the new state.

**Capture spec (e2e spec:154-176).** `shoot()` runs `captureOnboarding`, which takes a viewport screenshot and then axe, and writes `${view}-${theme}-${w}x${h}.png` (onboarding-ready-capture.ts:101-109). The added `fullPage` screenshot reuses the same name (`${prefix}guidance-completed-...`), so it overwrites after axe, as intended. Axe therefore ran on the live state before the overwrite. The path is hand-duplicated instead of calling `onboardingCapturePath` (m4). It matches only while the viewport equals the `captureOnboarding` width/height. No `page.mouse` or settle step is repeated, which is fine because the page is unchanged.

**Specs assert claimed behaviour.** Generate: it.each per state, safe copy, partial failure, owner-conflict label. Done: current-complete, failed count, link queryParams. Stepper: aria-current, "Done, completed", icon. Good. Weak spots are listed in m3 and m5.

**Angular conventions.** All standalone and OnPush, signals, `DestroyRef`-based `destroyed` flag, effect cleanup clears the interval. `generateLink` is a plain arrow called twice per change detection (cheap, but `computed` would be conventional) (m2).

## Findings

### Moderate
- **M1** generate-agents.page.ts:136 and :126. `starting`, `running`, `quiet` share one generic message. `quiet` ("Checking run state") shows "The run continues in its bound session." Slightly misleading but not harmful; add specific copy.
- **M2** analyze-done.page.ts:36, 56-58. "Review failed agents" is rendered even when `gen` is absent. The link then goes to a recovery screen. Hide it or fall back to `/onboarding/analyze/agents` when `gen` is missing.
- **M3** project-guidance.page.ts. Many no-op `if (this.destroyed) return;` guards were added at the end of void functions (for example the `navigate(...); if (this.destroyed) return; return;` forms). They are dead code and add noise. The few that precede further awaits are valid. Prune.

### Minor
- **m1** onboarding-stepper.component.ts:50. `truncate` removed; very narrow overflow is possible.
- **m2** analyze-done.page.ts:56. Prefer `computed` over a method called from the template.
- **m3** analyze-done.page.spec.ts: add an assertion on the `commands` / rendered `href` (`/onboarding/analyze/generate?tab=agent-tab`) and a no-`gen` case.
- **m4** e2e spec:171-175. Use `onboardingCapturePath` rather than rebuilding the filename.
- **m5** The done-page text "needs attention" colours the paragraph with `text-state-need`. Check contrast in both themes in the next capture. Colour is not the sole carrier (text and badge), so there is no a11y failure.

## Five logic questions
1. Silent failure: none new. Failed agents are surfaced on A3 and Done. A retry with an empty checkpoint (`rows()` empty, pre-existing) could do nothing silently; out of scope.
2. Unexpected action: Continue with failed agents proceeds to guidance (intended, advisory). A Done link with no `gen` dead-ends (M2).
3. Wrong-answer input: `counts` absent gives `?? 0`, so no false warning. A failed outcome with `counts.failed === 0` shows no warning (relies on the producer's counts being consistent).
4. Dependency failure: provider errors are sanitized. A status lookup failure in Done is still swallowed by design.
5. Missing: specific copy for `quiet`/`starting`; the link fallback.

## Verdict
APPROVE, score 7.5/10, confidence MEDIUM-HIGH (static review, no tests executed). No blocking issues; address M2 and M3 when convenient.
