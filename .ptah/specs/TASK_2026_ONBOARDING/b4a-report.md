# B4a harness services report

## Acceptance evidence

| Requirement | Source evidence | Covering spec |
| --- | --- | --- |
| Headless first send for New Project and team builder | `libs/frontend/harness-builder/src/lib/services/harness-session.controller.ts:138`, `:162`, `:184`, `:195`, `:214` create the workflow tab and send through `ChatStore` before view attachment. | `harness-session.controller.spec.ts:83` — `starts %s and sends without a mounted transcript` (both modes). |
| Idempotence per tab and intake hash, with same-mode reuse and cross-mode conflict | `harness-session.controller.ts:146`, `:148`, `:151`, `:195`, `:201`, `:203` hash the first brief, reuse a matching record, and guard in-flight sends. | `harness-session.controller.spec.ts:94` — `reuses the same tab and intake hash without sending again`; `:113` — `reports a cross-mode conflict before creating or sending`. |
| Ten-second readiness timeout and Retry send | `harness-session.controller.ts:207`, `:236`, `:270` wait for a usable tab, mark failure, and expose `retrySend`. | `harness-session.controller.spec.ts:120` — `fails after the ten second readiness timeout and exposes Retry send`. |
| Reconcile before Retry | `harness-session.controller.ts:247`, `:270` check acknowledged send, SDK session ID, stream status, and accepted user message before retry. | `harness-session.controller.spec.ts:134` — `reconciles an accepted first turn before Retry and does not duplicate it`. |
| Stop failure is uncertain; leave does nothing else | `harness-session.controller.ts:125`, `:129`, `:338` abort before save/discard, preserve record/tab on failure or while a busy tab has no session ID, and show generic error. `harness-builder-leave-dialog.component.ts:76`, `:139`, `:143` expose Retry stop and Keep current only in uncertain mode. | `harness-session.controller.spec.ts:144` — `returns uncertain on abort failure and leaves the draft and tab intact`; `:155` — `keeps a busy tab when the SDK session ID has not arrived yet`; `harness-builder-leave-dialog.component.spec.ts:120` — `offers Retry stop and Keep current without a save or discard choice`. |
| Session record validates and clears with tab | `harness-builder-records.service.ts:109`, `:159`, `:165`, `:279`, `:291` add strict `session` schema, round-trip storage, clear, and orphan sweep. `harness-session.controller.ts:102` persists the resolved SDK session ID. | `harness-builder-records.service.spec.ts:155` — `round trips through strict zod validation and clears with the tab`; `harness-session.controller.spec.ts:102` — `persists the resolved SDK session ID for proposal restore`. |
| Ordered folded revisions without user overrides | `harness-proposal-hydration.service.ts:150`, `:408`, `:410`, `:416`, `:424`, `:438` maintain separate cumulative revision snapshots before applying user choices to the live config. | `harness-proposal-hydration.service.spec.ts:274` — `exposes ordered cumulative snapshots without user overrides`; `:239` — `merges list entries by stable id when a later revision omits them`. |
| Request delegates and preserves old navigation target | `harness-workflow-request.service.ts:116`, `:259`, `:279` delegate start/retry and call `navigateToSurface('harness-builder', [mode, tabId])`; no `visibleTabIds` wait remains. | `harness-workflow-request.service.spec.ts:46` — `delegates first start before navigating to the unchanged harness-builder target`; `:59` — `offers the old builder retry UI after a failed first send`. |
| Restore outcomes (all six) | `harness-session.controller.ts:289` distinguishes ready, draft, missing, workspace mismatch, wrong mode, and unavailable proposal. | `harness-session.controller.spec.ts:164` — `restores ready, draft, missing, workspace mismatch, wrong mode and unavailable proposal`. |
| Apply component contract and public exports | `builder-apply-section.component.ts:202`, `:203`, `:300` accept `config` and emit `applied` after success. `index.ts:20`, `:24`; `services.ts:29` add requested exports. | `builder-apply-section.component.spec.ts:56` — `uses config input and emits applied response after a successful apply`. |

## Files changed

- `libs/frontend/harness-builder/src/lib/services/harness-session.controller.ts` and `.spec.ts` (new)
- `libs/frontend/harness-builder/src/lib/services/harness-builder-records.service.ts` and `.spec.ts`
- `libs/frontend/harness-builder/src/lib/services/harness-proposal-hydration.service.ts` and `.spec.ts`
- `libs/frontend/harness-builder/src/lib/services/harness-workflow-request.service.ts` and `.spec.ts`
- `libs/frontend/harness-builder/src/lib/components/sidebar/builder-apply-section.component.ts` and `.spec.ts`
- `libs/frontend/harness-builder/src/lib/components/harness-builder-leave-dialog.component.ts` and `.spec.ts`
- `libs/frontend/harness-builder/src/index.ts` and `src/services.ts`
- `.ptah/specs/TASK_2026_ONBOARDING/b4a-report.md`

## Decisions

- **Keep the old builder target:** The B4a plan requires it, and the existing route remains `harness-builder`. Reversible when B5b replaces the surface; evidence: `harness-workflow-request.service.ts:259`.
- **Keep the old team-builder entry without an automatic first turn:** Its request has no user intent; the controller sends when B4b supplies intent. Reversible; evidence: `harness-workflow-request.service.ts:279` and `harness-session.controller.ts:146`, `:184`.
- **Leave the workflow message handler unchanged:** Its current generic copy does not mention the hub, so B4a's conditional copy change was unnecessary. Reversible; source reviewed before implementation.

## Verification

- `npm run verify -- -p @ptah-extension/harness-builder,@ptah-extension/onboarding,ptah-extension-webview` — `NX   9 tasks: 8 succeeded, 1 failed`. Sole failed target: `nx run ptah-extension-webview:lint`; its log reports the accepted circular dependency at `apps/ptah-extension-webview/src/app/app.routes.ts:232` with `@ptah-extension/command-center`. All harness-builder and onboarding lint/test/typecheck tasks succeeded.
- `npm run verify -- -t lint,typecheck -p ptah-electron` — `NX   2 tasks: 2 succeeded`.

## Not done / limits

- The existing builder view still owns its pre-B4a leave handler and may continue after an abort failure; that view is outside B4a file ownership. The new controller and dialog implement the required uncertain-stop behavior for the new flow.
- No rendered visual review: the user limits visual reviews to Electron and prohibits launching application targets for this batch.
- The `angular-frontend-patterns` skill was unavailable through skill discovery; repository conventions and the task plan were used.
