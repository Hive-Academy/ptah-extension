# B3b Phase 2 implementation report

## Files and key logic

- `libs/frontend/onboarding/src/lib/analyze/generate-agents.page.ts:134`: A3 binding, reload, checkpoint discovery; lifecycle and result rendering at lines 24–78; handoff routing at line 183.
- `libs/frontend/onboarding/src/lib/analyze/generate-agents.page.spec.ts:62`: A3 lifecycle, countdown, result, mismatch, handoff, lookup tests.
- `libs/frontend/onboarding/src/lib/analyze/project-guidance.page.ts:100`: confirmed section summary visibility; rebind order and auto-start guard at lines 124–166; saved guidance actions at lines 190–211.
- `libs/frontend/onboarding/src/lib/analyze/project-guidance.page.spec.ts:59`: A4 rebind, auto-start, summary and recovery tests.
- `libs/frontend/onboarding/src/lib/analyze/analyze-done.page.ts:61`: terminal facts and completion flag; Open chat message and host view at line 79.
- `libs/frontend/onboarding/src/lib/analyze/analyze-done.page.spec.ts:32`: A5 completion, facts and link tests.
- `libs/frontend/onboarding/src/lib/onboarding.routes.ts:45` and `libs/frontend/onboarding/src/lib/onboarding.routes.spec.ts:81`: A3, A4, A5 and guidance-only routes and their route test.
- `libs/frontend/onboarding/src/lib/shell/onboarding-step-link.ts:122` and `libs/frontend/onboarding/src/lib/shell/onboarding-step-link.spec.ts:76`: caller-supplied guidance run identity and mapping test.
- `libs/frontend/setup-wizard/src/lib/services/generation-workflow.store.ts:48`: `lookupExhausted`, set after the fourth failed expected-run lookup at line 320 and reset on bind or successful lookup; spec at line 111.

## Acceptance to test mapping

| Acceptance | Test name |
| --- | --- |
| A3 reload: starting, running, cancelling, cancelled, failed, timed-out, completed, no state; Stop during starting | `reload renders the %s lifecycle` |
| Completed cards use `fileName` and counts | `renders completed cards from fileName and facts from counts` |
| Failed agent retry uses the bound run | `retries a failed completed agent against its bound run` |
| Countdown Start now and Skip | `starts the countdown now and skips guidance on request` |
| Handoff route identity | `routes a handoff run with the guidance tab and agent tab` |
| Mismatched A3/A4 run recovery | `shows a no longer current recovery for a mismatched run`; `shows mismatched run recovery` |
| A4 URL, matching handoff, authoritative rebind order | `rebinds URL run before a different handoff run`; `rebinds a matching handoff-started run without a second runWizard`; `uses the authoritative run after a handoff for another tab` |
| Auto-start and manual recovery/in-flight guard | `auto-starts only a pending handoff with no run`; `does not auto-start after manual recovery`; `does not double-start while manualContinue has cleared started` |
| A4 summary four word-count rows and no removed fields | `shows four confirmed section rows and no token or fallback copy` |
| A4 hidden counts | `hides counts for %s` (no capture, disabled, different run, active run) |
| A4 Skip and Retry | `skips to Done and retries failure` |
| A4 Stop, owner conflict, detected stack, Continue | `keeps Stop, owner conflict and detected stack available on reload`; `continues to Done after completion` |
| Saved guidance enable, view, download, unchanged | `wires saved guidance enable, view, download and unchanged notice` |
| A5 completion, facts, Open chat | `sets completedAt and renders facts from two terminal runs`; `posts SETUP_WIZARD_COMPLETE when Open chat is clicked` |
| A5 next-step links | `offers Command center, Tribunal and Run again links` |
| Lookup exhaustion and recovery | `exposes lookupExhausted after the fourth failed expected-run lookup and clears it on recovery`; `shows lookup exhaustion with Retry calling refresh`; `shows lookup exhaustion with Retry` |
| Routes and step-link identity | `resolves %s before the fallback`; `writes a handoff-started guidance run without copying the agent run` |

## Data test IDs

- A3: `generate-agents-page`, `generate-state-chip`, `generate-stop-starting`, `generate-facts`, `generate-agent-card`, `generate-agent-file`, `generate-agent-cards`, `generate-countdown`, `generate-start-now`, `generate-skip`, `generate-recovery-panel`, `generate-lookup-exhausted`.
- A4: `project-guidance-page`, `guidance-state-chip`, `guidance-start`, `guidance-owner-conflict`, `guidance-detected-stack`, `guidance-summary-card`, `guidance-summary-row`, `guidance-unchanged`, `guidance-content`, `guidance-skip`, `guidance-recovery-panel`, `guidance-lookup-exhausted`.
- A5: `analyze-done-page`, `analyze-done-facts`, `done-open-chat`, `done-command-center`, `done-tribunal`, `done-run-again`.

## Verify NX summary lines

- Final project verify: `NX 9 tasks: 8 succeeded, 5 cached, 1 failed`; the sole failure was `ptah-extension-webview:lint`. Its log shows the existing `app.routes.ts` → `@ptah-extension/command-center` → `ptah-extension-webview` cycle.
- Electron verify: `NX 2 tasks: 2 succeeded` (`ptah-electron` lint and typecheck).

## Decisions

- A2 already forwards `tab` and `run` to A3, so no A2 edit was needed. Reversible: yes.
- A3 uses the checkpoint only when its run ID equals the bound run, and terminal cards use authoritative `result.agentOutcomes` / `counts`. Reversible: yes.
- A4 auto-starts only from a matching pending handoff. A cleared `started()` with no pending handoff is treated as potentially in-flight `manualContinue`; this prevents a second run. Reversible: yes.
- A5 Tribunal opens chat because the former Tribunal view is retired and has no current route; the chat prompt catalogue still offers a Tribunal skill. Reversible: yes.
- No skill-loading tool was listed for this lane, so `angular-frontend-patterns` and `impeccable` could not be loaded. Ptah diagnostics timed out three times after edits. The user prohibited opening a browser.
