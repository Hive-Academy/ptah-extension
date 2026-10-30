# B3b visual fix report

## Changes and evidence

1. **Run-state copy:** `libs/frontend/onboarding/src/lib/analyze/generate-agents.page.ts:127` and `project-guidance.page.ts:115` now distinguish failed, timed-out, cancelling, stop-unknown, cancelled, completed, and active states. Failure text uses `safeFailureCopy` and a fallback without raw provider detail. Specs: `GenerateAgentsPage shows state-specific copy for %s`, `uses safe failure copy for a failed run and gives owner retry a clear label`; `ProjectGuidancePage shows state-specific copy for %s`, `sanitizes a guidance failure reason`.
2. **Done facts and final step:** `analyze-done.page.ts:16,31-36,56-58` marks Done current and complete, warns when agents failed, and links to A3 with the agent tab identity. `shared/onboarding-stepper.component.ts:13,26-50` renders the current-complete check. Specs: `AnalyzeDonePage marks Done complete and links failed agent facts back to Generate agents`; `OnboardingStepperComponent shows the final current step with a completion icon and label`.
3. **A3 partial completion:** `generate-agents.page.ts:37-45,59-67,124-135` uses a warning title/badge, hides the green Done chip for partial success, keeps Continue to guidance, and gives failed agent badges error color. The completed card no longer uses the invalid `role="listitem"` on `article`, addressing `aria-allowed-role`. Spec: `GenerateAgentsPage uses safe failure copy and highlights a failed completed agent`.
4. **Narrow stepper:** `shared/onboarding-stepper.component.ts:25-50` lets the current pill grow, lets other dots shrink, reduces narrow dot padding, and removes current-label truncation. Spec: `OnboardingStepperComponent collapses noncurrent labels in the narrow strip`.
5. **A4 saved guidance:** `project-guidance.page.ts:20-22,79-84` places the child in a spaced `rounded-[22px] border border-base-300 p-5` content surface, with its old inner background/border removed by scoped styling. Spec: `ProjectGuidancePage keeps the saved guidance surface separate from the owner banner`.
6. **Recovery actions:** `generate-agents.page.ts:20-21,32-34` and `project-guidance.page.ts:20-22,31-39` give sole Retry actions primary color, `mt-3`, and 36px minimum height; scoped styles give the shared run-panel and saved-guidance action buttons 36px minimum height. Specs: existing `GenerateAgentsPage shows lookup exhaustion with Retry calling refresh`, `ProjectGuidancePage shows rejected authoritative lookup as an error and retries binding` and `shows lookup exhaustion with Retry`.
7. **A5 labels:** `analyze-done.page.ts:45-46` says “Get a second opinion in chat” and “Run setup again” while retaining `done-tribunal`. Spec: `AnalyzeDonePage offers Command center, Tribunal and Run again links`.
9. **A5 narrow actions:** `analyze-done.page.ts:42-47` stacks full-width actions below 480px. Spec: `AnalyzeDonePage offers Command center, Tribunal and Run again links` covers the labels and actions; responsive layout awaits coordinator capture.
10. **Owner conflict:** `generate-agents.page.ts:52-56` and `project-guidance.page.ts:50-54` use error borders, “Check again,” and text-first stacked layouts on narrow screens. Specs: `GenerateAgentsPage uses safe failure copy for a failed run and gives owner retry a clear label`; `ProjectGuidancePage keeps the saved guidance surface separate from the owner banner`.
13. **Capture:** `libs/frontend/webview-e2e-harness/src/lib/scenarios/onboarding/onboarding-generate-visual.e2e.spec.ts:170-175` overwrites the guidance-completed viewport PNG with a full-page PNG after the normal axe capture. The coordinator will recapture; browser and e2e were not run as instructed.

Minors 8, 11, 12 and 14 were left untouched as requested. The page roots remain `<section aria-labelledby>`. The pages remain standalone, OnPush and signal-based; DestroyRef guards follow asynchronous work.

## Verification

Command: `npm run verify -- -p @ptah-extension/onboarding,@ptah-extension/webview-e2e-harness` (45-minute timeout). Final run exited 0: **`NX   5 tasks: 5 succeeded, 2 cached`**. Earlier attempts were interrupted by a queue `SIGTERM`, an `ENOSPC` error, and two failing versions of the new A5 link assertion; both test failures were fixed before the passing run. No browser, build, serve, dev, e2e or package target was run. Scoped `ptah_get_diagnostics` returned unavailable after its TypeScript check timed out; the passing verify supplies the lint, test, and typecheck evidence.

## Decisions

- Kept A3's completed action semantics when some agents failed so Continue to guidance remains available; a warning title and badge replace the visible green Done chip. Reversible; evidence is the existing completed-run flow and review's partial-failure capture.
- Used page-scoped styling and local owner banners because this batch permits edits only to the named pages, their specs, the stepper, and the capture spec. Reversible; evidence is the supplied touch-only rule.
- Routed the A5 failure link through the existing `guidance` to `generate` transition, passing `gen` from `queryParamMap` so it becomes the A3 `tab` query. Reversible; evidence is `onboarding-step-link.ts` and the passing A5 spec.

## Limits

Rendered recapture and axe remain with the coordinator, as requested. The full-page guidance capture and responsive changes were not browser checked in this lane.
