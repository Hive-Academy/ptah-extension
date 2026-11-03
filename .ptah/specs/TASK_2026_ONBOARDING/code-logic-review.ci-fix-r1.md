# Code Logic Review — CI fix r1

Review family: claude (reviewer) / codex (implementer)

Score: 7/10. Verdict: REVISE (small, non-blocking fixes; the degradation claims are mostly true).

## Checks

1. Degradation annotations: baseline.json and tools/ untouched (no diff). 9 onboarding + 4 harness-builder markers.
   Claims verified true: analysis-step.store.ts:81 (choose-agents.page.ts and analyze-workspace.page.ts useSaved map 'failed' to a visible message),
   analyze-workspace.page.ts:131 (savedError rendered, line 71), project-guidance.page.ts:177 (lookupError rendered, line 35),
   choose-agents.page.ts:218 (loadError), generate-agents.page.ts (continueError), proposal-flow.store.ts:238 (actionError),
   onboarding-flag.service.ts:178 (logger.warn), harness-session.controller.ts (phase/error signals set + log).
2. state.spec.ts: key `ptah.onboarding.v1` and `{ shownAt: ISO }` match ONBOARDING_FLAG_KEY and the zod schema (`z.iso.datetime().optional()`). Reload is awaited before the poll; set-state happens after the poll, so no race with later assertions.
3. CI themes: detection `process.env['CI']` is consistent with playwright.config.ts:18. No test bodies dropped, but see D1.
4. settings.component.html: only the order of the two blocks and `mb-3`->`mt-3` changed; spec asserts order. No behaviour change.

## Defects

1. onboarding-ready-visual.e2e.spec.ts:326 and :373 (via onboarding-ready.fixtures.ts:38-39): under CI only `ptah-glass` runs.
   The reduced-transparency capture and the 30-case contrast sweep filter GLASS_THEMES by the CI list, so `ptah-glass-light` is silently dropped
   from CI, and every light theme (ptah-glass-light, anubis-light) loses CI visual/contrast coverage. The fixtures comment "every assertion" is wrong.
   Fix: in CI use one dark and one light theme, e.g. `[ONBOARDING_THEMES[0], ONBOARDING_THEMES[1]]`, or keep the contrast sweep on all GLASS_THEMES
   and trim only the capture matrix; fix the comment to state which themes are skipped.
2. onboarding.spec.ts:~35 (`onboarding-back-to-chat` step): `expect(onboarding-shell).toHaveCount(0)` only proves the shell left; it would pass on a blank/error page.
   Fix: also assert a chat-surface element (for example the chat input or `[data-test="config-menu-item-setup-hub"]` visible) before clicking the menu item.
3. onboarding.spec.ts (removed `page.reload()` after skip): the check "reload after skipping does not redirect back to Ready" is gone with no replacement.
   Fix: after skipping, reload and assert `ready-claude-step` is not visible (the URL is not needed), or note it is covered by a unit test of the tracker.
4. onboarding-first-run.tracker.ts:~121: marker says `optional-capability`, but a failed parse silently drops the first-run commit (flag never marked shown, user is re-redirected).
   Not wrong enough to block; fix by logging via the tracker logger (or narrow the reason text to "unparseable URL leaves first-run unmarked; harmless re-show").
5. state.spec.ts:30 `skipFirstRun`: does not verify the record persisted; if the first-load tracker rewrites the record it could race. Fix: after `setItem`, assert
   `localStorage.getItem('ptah.onboarding.v1')` contains `shownAt` after the reload (one extra `expect.poll`).

## Round 1 re-review

Verdict: APPROVE (no blocking defects).

- D1 fixed: onboarding-ready.fixtures.ts:37-41 uses `[ONBOARDING_THEMES[0], ONBOARDING_THEMES[1]]` = `ptah-glass`, `ptah-glass-light`; both glass themes stay in the CI reduced-transparency and contrast sweeps (the `GLASS_THEMES.filter` still yields both). Only the anubis themes are skipped in CI, and the comment now says so.
- D2/D3 fixed: onboarding.spec.ts now reloads after skip and asserts `ptah-chat-view` visible plus `ready-claude-step` count 0, reopens Home via the menu, and asserts `ptah-chat-view` after back-to-chat. `ptah-chat-view` exists as a selector (chat-view.component.ts:169). Sequence is coherent given Home/Ready are not persisted; it relies on the reload landing on chat, which I could not run to confirm.
- D4 fixed: tracker injects `LoggingService` (providedIn root, same import as onboarding-flag.service.ts:2), so the tracker spec's TestBed (onboarding-first-run.tracker.spec.ts:49-59, no explicit provider) resolves it. The marker is now truthful (logged).
- D5 fixed: state.spec.ts skipFirstRun polls localStorage for `"shownAt"` after reload.

Residual (minor, no fix required): onboarding-first-run.tracker.spec.ts has no test that the parse-failure branch logs; optional.

## Round 2 re-review

Verdict: APPROVE.

`ptah-orchestra-canvas` (orchestra-canvas.component.ts:62) is the Chat-route surface and is referenced by no onboarding code, so it cannot appear on the onboarding shell. Together with `onboarding-shell` count 0 (onboarding.spec.ts:43), the back-to-chat assertion is meaningful. It is used at :34 (post-reload lands on chat) and :43. The live rerun passed 1/1. No new defects.
