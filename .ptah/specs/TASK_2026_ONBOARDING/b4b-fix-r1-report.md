# B4b code logic fixes, round 1

| Finding | Fix | File:line | Covering spec |
| --- | --- | --- | --- |
| 1 | Compare canonical workspace roots for Review and restore; expose canonicalizer through the harness-builder entry point. | `proposal/proposal-flow.store.ts:56,166`; `harness-builder/src/index.ts:25` | `compares canonical Windows and trailing-slash workspace roots for review and restore` |
| 2 | Capture the revision at the Apply click, hold Update review during apply, save the captured ID, and show receipts only for the viewed revision. | `proposal/review-apply.page.ts:18,23-24,44,53-54` | `records the revision captured when apply starts and hides its receipt after review changes`; `renders the newer banner and an old receipt note without showing the stale result` |
| 3 | Merge restored values with existing overrides and metadata; tag only values different from the current folded revision and retain `lastApplied`. | `proposal/proposal-flow.store.ts:202-218` | `merges a restored revision with existing overrides and marks only changed fields` |
| 4 | Stop through the controller before marking Save draft; surface uncertain and failed stops. | `proposal/proposal-workspace.page.ts:71` | `stops the session before saving a draft and reports an uncertain stop` |
| 5 | Catch discard failures and publish an Electron notification that survives the start page; preserve a local action error. | `proposal/proposal-flow.store.ts:70-79,187-196` | `reports an uncertain or throwing cancelled stop through notifications`; `starts a valid brief and discards its new session when navigation is cancelled` |
| 6 | Close the answer sheet when the viewport crosses above 720px, releasing inert. | `proposal/answer-dock.component.ts:22` | `releases inert background when the viewport widens and Escape works during send` |
| 7 | Require a current revision before enabling Review. | `proposal/proposal-flow.store.ts:56` | `compares canonical Windows and trailing-slash workspace roots for review and restore` |
| 8 | Show receipt-write errors and Done after a failed save; show detailed paths once per apply while retaining them on a later visit. | `proposal/review-apply.page.ts:23-26,54`; `proposal/apply-result.component.ts:8-12` | `keeps Done available and exposes the error when receipt persistence fails`; `renders the newer banner and an old receipt note without showing the stale result` |
| 9 | Accept and stop a freshly started cross-mode rebind; catch errors in the dialog retry branch and reset its saving state. | `proposal/proposal-flow.store.ts:119-150` | `stops a conflicting started session before its first proposal exists`; `stops a conflicting reused session before its first proposal exists` |
| 10 | Subscribe to query parameters, serialize tab restores, and update the pinned review when the revision parameter changes. | `proposal/proposal-workspace.page.ts:55-56`; `proposal/review-apply.page.ts:49` | `restores a new tab when query parameters change on the same component`; `updates the pinned revision on same-component query changes` |
| 11 | Cover the newer banner, stale receipt, route providers, intake cancellation, viewport change, and Escape during send. | `proposal/review-apply.page.spec.ts`; `proposal/new-project-intake.page.spec.ts`; `proposal/answer-dock.component.spec.ts`; `onboarding.routes.spec.ts:47` | `renders the newer banner and an old receipt note without showing the stale result`; `provides a separate flow store at each proposal parent route`; `starts a valid brief and discards its new session when navigation is cancelled`; `releases inert background when the viewport widens and Escape works during send` |

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Save draft stops the session before writing the draft marker. | Stop first; retain a live session in cross-mode detection. | B4a `HarnessSessionController.leave` stops before `replaceDraft`; `activeSessionIn` excludes draft tabs. | Yes |
| Publish failed cancelled stops through `NotificationService`. | Notification; route-scoped store state. | Cancelled navigation can destroy the route-scoped store. The shared notification center reads root-scoped notices. | Yes |
| Capture Apply start at the page wrapper's button click. | Page click capture; add an output to the read-only B4a apply section. | The apply section emits only the completed response. The page can identify the Apply button before its asynchronous RPC settles, within the allowed edit scope. | Yes |
| Keep persisted receipt details on revisits while avoiding duplicate details immediately after apply. | Always show both sections; show only next steps after a current-page apply. | The shared apply section renders its own paths and warnings immediately, but its transient result is absent on a later visit. | Yes |

## Not fixed

- No local review finding was intentionally left open.
- The 12 Ptah diagnostic errors in sibling specs and shared TypeScript files are outside the permitted edit scope; none points to a changed file.
- Independent review was attempted with Codex and Kimi lanes. Both exited before Ptah MCP handshake (`lane-exited-before-handshake`), so an independent verdict was unavailable.
- No new visual capture was made. The task prohibits launching an app or browser target. Design-spec §3.3 was checked in the template and interaction code for the ≤720px dock/inert transition, the newer-revision banner, revision-pinned receipt, and Save draft behavior; visual quality remains unverified.

## Verification

1. `npm run verify -- -p @ptah-extension/onboarding,ptah-extension-webview,@ptah-extension/harness-builder` — first run: `NX 9 tasks: 7 succeeded, 2 failed`. Onboarding tests exposed two asynchronous query-change assertions that waited too few microtasks; those assertions were corrected. Rerun: `NX 9 tasks: 8 succeeded, 5 cached, 1 failed`. The sole remaining failure is the accepted `ptah-extension-webview:lint` circular dependency in `app.routes.ts` ↔ `@ptah-extension/command-center`.
2. `npm run verify -- -t lint,typecheck -p ptah-electron` — `NX 2 tasks: 2 succeeded`.

The scoped `ptah_get_diagnostics` request for 12 changed TypeScript files initially timed out; its cached result then returned **0 diagnostics in requested files** and 12 errors in sibling files outside this task's edit scope (older harness-builder/onboarding specs and shared BigInt target errors). These sibling errors are not claimed as fixed by the Nx checks, whose configured typecheck targets passed.
