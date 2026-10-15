Verdict: APPROVED

## Review state

Reviewer: grok. Author: codex. Side: same-side CLI lane, because in-process reviewers are not available today; different family. Round 1 re-review of the revised `implementation-plan.md` (revision log at lines 170-179) against the six findings in `implementation-plan-review.md`. Read-only. No code or plan edits.

## Findings status

| # | Severity | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Serious | RESOLVED | Plan lines 13, 25, 34-35, 48, 106-107. |
| 2 | Serious | RESOLVED | Plan lines 9, 32-33, 60, 77. |
| 3 | Serious | RESOLVED | Plan line 60. |
| 4 | Serious | RESOLVED | Plan lines 44, 48, 56, 60. |
| 5 | Moderate | RESOLVED | Plan lines 33, 40, 79, 108. |
| 6 | Minor | RESOLVED | Plan lines 44 and 52. |

**Finding 1 (D9).** The capture seam matches the code. `tools/call` runs inside one `AsyncLocalStorage` context (`protocol-dispatcher.ts:349-365`) whose payload is caller session, workspace, agent, profile, and abort signal (`mcp-request-context.ts:21-49`). That context has no turn id. `proposeConfig` resolves `getCallerSdkSessionId()` and only then awaits `saveProposal` (`harness-namespace.builder.ts:1084-1108`). The resolver is synchronous and reads that ALS session (`ptah-api-builder.service.ts:862-887`, `1048-1075`). A local constant taken before the await at line 1104 stays T1 when T3's `UserPromptSubmit` arrives during `save`. The store is forbidden from reading a mutable latest-turn slot (plan line 35). If two retained callbacks could own the call, or the tool request arrives after callbacks that cannot be correlated, the plan passes `undefined` and never the latest timestamp. Absent loses to the user (plan lines 13 and 35). Revisions order by `turnStartedAt`; an unattributed revision does not sort after a newer attributed one and does not take unchosen fields (plan lines 34 and 106-107). Acceptance names both regressions (plan line 48).

**Finding 2.** Both cross-mode directions navigate to the running builder and open the builder leave dialog. New Project may use today's Hub confirm, and `confirmDiscardAndStart` does not abort or call `startNewProject`. The AI Team Builder card goes straight to the same handoff (plan line 32; today's card has no confirm at `setup-hub.component.ts:1298-1300`). Pending intent holds mode, workspace, and validated intake outside the Hub (plan lines 9 and 32). One synchronous in-flight guard ignores a second click. Cancel clears intent and does not call `harness:start-new-project`. Save or Discard finishes, including abort settle, before the new builder URL; intent is cleared before that navigation (plan line 33). Proof row 8 states both directions. No Hub template or style change in the batch.

**Finding 3.** Jest asserts structure at widths 360, 400, 720, and 960 and height 480: builder `:host` is `min-height:0; overflow:hidden` with `height:100%`, the page host is `overflow-hidden`, the strip is `shrink-0` and outside the only `flex-1 min-h-0 overflow-y-auto` body, for the docked aside and the narrow `absolute inset-0` sheet, and the Electron outer row and configuration host gain `min-h-0`. The plan rejects jsdom `scrollHeight` as pixel proof and names visual-reviewer screenshots for real scrolling. Verify commands still exclude e2e.

**Finding 4.** Public barrels `index.ts` and `services.ts` belong only to B4. B3 does not edit them and does remove `registerWorkflowSurface`. Edges are explicit: B2 may run with B1; B3 after B1; B4 after B2 and B3 (plan line 44). File lists do not overlap.

**Finding 5.** Row 39 is one sidebar Apply (plan line 108). Stack-profile write failure still navigates and sends, then shows the unavailable fallback (plan lines 33 and 40). Relay errors use the builder page notice when the route lands, and today's Hub intake error only on the path that already renders it (`setup-hub.component.ts:1440-1456`). A malformed relay that stays on the Hub is decision (c), not a new element.

**Finding 6.** Verify is `npx nx run-many -t typecheck|lint|test -p <changed> --parallel=1`, with `--maxWorkers=2` on test, changed projects only, no build, serve, dev, e2e, or workspace-wide run (plan line 44). D8 cites `decisions.md:19-32` and the barrel line at `:35` (plan line 52).

## New findings

None at Blocking or Serious.

1. **Minor.** Plan line 33. The pending-intent object is also where `validatedIntake` lives (plan line 9), and the same paragraph clears that intent before the destination navigation that starts the new mode. Copy the intake into the entry arguments, then null the intent slot, so the clear that stops a remounted dialog does not drop the intake the start still has to consume once.

## Decisions for the user

All three items are sound and complete. Each names the constraint, the options, a recommendation, and a B4 step that waits for the choice. The migration does not depend on them (plan lines 165-167).

1. **(a) Abort warning.** Recommendation to amend D10 for the one withdrawn persistent Hub status line is right. `ActionBannerService.showWarning` auto-clears at 8 seconds and renders in ChatView (`action-banner.service.ts:90-96`, `chat-view.component.ts:374-409`). The ledger has no arbitrary persistent warning (`notification-ledger.service.ts:121-163`). The third option, a new host surface for VS Code and Electron, is correctly out of this batch. Until the user picks, B4 must not add a Hub element or claim the warning persists.

2. **(b) Hub confirm copy.** The existing title and body promise an immediate discard (`setup-hub.component.ts:1107-1131`) while the handler must not abort. Recommending a copy-only D10 amendment is the option that keeps the button truthful. Retaining today's words, or skipping the confirm and opening the builder dialog directly, are both stated, and every option keeps `confirmDiscardAndStart` free of abort and `startNewProject`.

3. **(c) Malformed relay still on the Hub.** `workflow.setError` (`harness-workflow-message.handler.ts:49-86`) goes away with `HarnessWorkflowService`. Recommending a minimal Hub error element is the option that keeps the failure visible. Logging until a builder page opens, or routing only when a safe builder card exists, are stated. No option adds that element before the user chooses.
