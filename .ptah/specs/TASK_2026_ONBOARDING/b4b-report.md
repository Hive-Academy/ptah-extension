# B4b implementation report

Status: implementation written in the assigned worktree. Onboarding, harness, and Electron checks passed; the accepted webview lint cycle remains.

## Files

Created under `libs/frontend/onboarding/src/lib/proposal/`:
`proposal-flow.store.ts`, `proposal-flow.store.spec.ts`,
`new-project-intake.page.ts`, `new-project-intake.page.spec.ts`,
`team-builder-start.page.ts`, `team-builder-start.page.spec.ts`,
`proposal-workspace.page.ts`, `proposal-panel.component.ts`,
`proposal-section.component.ts`, `proposal-item.component.ts`,
`revision-history.component.ts`, `answer-dock.component.ts`,
`answer-dock.component.spec.ts`, `review-apply.page.ts`,
`review-apply.page.spec.ts`, `review-summary.component.ts`,
`apply-result.component.ts`.

Changed `libs/frontend/onboarding/src/lib/onboarding.routes.ts` and
`onboarding.routes.spec.ts`. No other library or application source was changed.
The pages have URL-only routes; no entry point targets them before B5a.

## Acceptance evidence

| Item | Implementation evidence | Covering spec test |
| --- | --- | --- |
| URL routes for both modes | `onboarding.routes.ts:54-64` has route-scoped mode/store providers and start, workspace, review children | `onboarding.routes.spec.ts`: `resolves %s before the fallback` |
| Intake validation and platform reset | `new-project-intake.page.ts:18-27,45-53`; team intent validation at `team-builder-start.page.ts:28-31` | `new-project-intake.page.spec.ts`: `validates required brief and other stack on submit`, `resets stack and custom stack when platform changes`; `team-builder-start.page.spec.ts`: `requires an intent and discards a new session when navigation is cancelled` |
| Three source panels; intake facts only for new project and absent after missing stack record | `proposal-panel.component.ts:14-17` separates configuration, From your intake, and generated document; `proposal-workspace.page.ts:54` and `review-apply.page.ts:38` gate facts on mode and persisted stack record | No focused template spec; guards are source checked |
| New/Changed from folded snapshots only | `proposal-flow.store.ts:18-35,49-53`; first revision has no tags; `proposal-panel.component.ts:21-31` maps field tags; created skills label at `proposal-item.component.ts:5` | `proposal-flow.store.spec.ts`: `marks new and changed fields only after comparing folded snapshots`, `writes user overrides when restoring a folded revision` |
| Review once initialized nonempty proposal exists | `proposal-flow.store.ts:54` checks hydration, config, session ID and pinned workspace; `proposal-workspace.page.ts:38` binds button | `proposal-flow.store.spec.ts`: `writes user overrides when restoring a folded revision` checks disabled before and enabled after session ID while busy |
| Restore earlier revision as user choices | `proposal-flow.store.ts:180-199` writes snapshot overrides and calls hydration.setSnapshot; confirmation at `proposal-workspace.page.ts:26-27,65-66` | `proposal-flow.store.spec.ts`: `writes user overrides when restoring a folded revision` |
| Reviewed revision pinned; newer banner; nonblocking completeness; Apply tied to revision | `review-apply.page.ts:17-23,32-41` uses URL rev, folded diff, merged user choices, exact reviewed config and receipt revision ID; shared apply section keeps its busy/preview checks and refreshes health at `builder-apply-section.component.ts:281-304` | `review-apply.page.spec.ts`: `keeps the reviewed revision pinned and exposes a newer-revision banner` |
| Apply result and Done | `apply-result.component.ts:8-12` shows paths, Copy, warnings, health status, destinations and Done; `review-apply.page.ts:46` calls markCompleted, which writes completedAt | No focused result spec; shared apply section has its existing tests |
| Cross-mode Save/Discard/Cancel and uncertain stop | `proposal-flow.store.ts:95-143` binds and stops the other mode before start, preserving pending request on uncertain/save failure; dialogs at `new-project-intake.page.ts:29`, `team-builder-start.page.ts:21`, `proposal-workspace.page.ts:42`; workspace leave at `proposal-workspace.page.ts:69-90` | `proposal-flow.store.spec.ts`: `stops a conflicting session before its first proposal exists` |
| Mobile answer sheet, inert background, focus, Escape, announcement | `answer-dock.component.ts:9-29` uses ≤720px bar, CDK trap, after-render focus, Escape, focus return and live status; `proposal-workspace.page.ts:18-19,38,49` supplies header, stepper and proposal pane as inert background | `answer-dock.component.spec.ts`: `traps sheet focus, Escape closes, and returns focus to the bar`, `announces a sent reply and closes the sheet` |
| Details log with brief and stats | `proposal-workspace.page.ts:30-33` includes Your brief, the shared tab log and stats inputs; Show full message reveals latest text in that region at `proposal-workspace.page.ts:57` | No focused template spec |
| Proposal unavailable recovery; cancelled navigation | `proposal-flow.store.ts:144-159` rebinds an active saved session so composer can retry; `proposal-workspace.page.ts:23,60-62` prefills without sending; `new-project-intake.page.ts:56-61` and `team-builder-start.page.ts:32-38` discard a freshly started session on navigation cancellation, consistent with B4a | `proposal-flow.store.spec.ts`: `rebinds a session with an unavailable proposal so the composer can retry`; `team-builder-start.page.spec.ts`: `requires an intent and discards a new session when navigation is cancelled` |

## Capture states

No optional `onboarding-proposal-visual.e2e.spec.ts` or fixtures were added. No Electron screenshot was inspected because this lane was forbidden to launch an app or e2e target; visual quality remains unverified.

## Decisions

- **Route-scoped store for both modes.** Options were separate stores or one mode-injected store. C6 and A2 specify one `ProposalFlowStore` on each parent route; `onboarding.routes.ts:54-64` follows that. Reversible: yes.
- **Review while the agent continues generating.** C6's sketch mentions a busy gate; the specific B4b acceptance and design-spec §3.3 say Review becomes available with an initialized nonempty proposal. The implementation follows that explicit acceptance; Apply retains the shared section's busy gate. Reversible: yes.
- **Rebind active saved sessions without requiring a proposal.** Controller `restore` returns proposal-unavailable before setting its record; controller `start` reuses the matching saved tab. `proposal-flow.store.ts:113-126,144-159` uses reuse for conflict stop and recovery. Reversible: yes.
- **Preserve explicit user choices on the reviewed configuration.** Hydration folds revisions without overrides; the persisted snapshot contains choices. `review-apply.page.ts:33` merges the selected revision with those choices while the diff uses folded revisions only. Reversible: yes.
- **Cancelled navigation discards only a just-created session.** This follows the B4a decision; reused/draft tabs stay. `proposal-flow.store.ts:59,76-93`, both start pages' `open` methods. Reversible: yes.

## Verification

Requested exact commands:

1. `npm run verify -- -p @ptah-extension/onboarding,@ptah-extension/webview-e2e-harness,ptah-extension-webview` — first run started 2026-10-30 23:22:11 UTC; waited for the machine-wide lock, then ended at 2026-10-31 00:02:48 UTC: `NX 8 tasks: 6 succeeded, 2 cached, 2 failed`. The failed tasks were onboarding lint (`@Injectable` lacked the configured `providedIn` property) and the accepted webview lint circular dependency (`app.routes.ts` ↔ command-center). A second run at 00:08:43 UTC gave the same summary: `NX 8 tasks: 6 succeeded, 2 cached, 2 failed`; its onboarding lint confirmed `providedIn: null` does not satisfy the repository rule. I changed it to `providedIn: 'root'`; each parent route still provides its own store instance. The final run ended at 00:15:37 UTC: `NX 8 tasks: 7 succeeded, 2 cached, 1 failed`. Only the accepted `ptah-extension-webview:lint` circular dependency (`app.routes.ts` ↔ command-center) remains. Onboarding lint, tests and typecheck, webview-e2e-harness checks, and webview tests/typecheck passed.
2. `npm run verify -- -t lint,typecheck -p ptah-electron` — ended at 2026-10-31 00:17:23 UTC: `NX 2 tasks: 2 succeeded`.

`ptah_get_diagnostics` was called after the final source edit for five affected files. It returned `Unavailable` because its TypeScript worker was still running after 45 seconds; all five files were reported unchecked by that tool. The exact scoped verify typechecks passed after the final edit.

The `angular-frontend-patterns` skill loader was not exposed in this lane; repository instructions and nearby Angular pages were used. Two independent review lanes timed out before producing findings.

## Outstanding

Independent review and visual inspection remain outstanding. Optional capture spec was not added. All requested scoped checks passed except the accepted webview lint cycle.
