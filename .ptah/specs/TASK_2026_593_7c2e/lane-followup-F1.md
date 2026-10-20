# F1 attention follow-ups

## Fix 1 — stale older-history alert

Root cause: `olderHistoryAlert` compared the current `messages` array with the array saved at the stale paging outcome. Appending a live event replaced the array and hid the alert even though the cursor was still `null`.

Changes: `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:262-275,1158-1167` now keeps the alert while the same tab and session have a null cursor. A tracked effect clears the stale snapshot when the tab closes, its session changes, or its cursor leaves null during reopen. `chat-view.component.spec.ts:656-727` covers message append, reopen through undefined, later null, and tab close/reappearance.

## Fix 2 — Apps focus target lifetime

Root cause: `AppsFocusTarget.register` kept the last source after its `AppsSessionService` injector was destroyed.

Changes: `libs/frontend/mcp-apps-page/src/lib/services/apps-focus-target.ts:11-13` unregisters only the matching source. `apps-session.service.ts:188` unregisters on `DestroyRef.onDestroy`. `apps-focus-router.service.spec.ts:51-61` covers replacement registration and identity-safe unregister; `apps-session.service.spec.ts:248-258` checks cleanup after injector reset.

## Fix 3 — cross-workspace surface focus

Root cause: setup and harness `canFocus` required the owner tab's workspace to be active, disabling Open for an owned session in another workspace.

Changes: `libs/frontend/setup-wizard/src/lib/services/setup-wizard-focus-router.service.ts:10-33` and `libs/frontend/harness-builder/src/lib/services/harness-builder-focus-router.service.ts:10-30` accept any owned session with a workspace path and use `WORKSPACE_COORDINATOR` to switch before existing route navigation. Both still re-check ownership and map a navigation that does not land to `missing`. Their specs (`setup-wizard-focus-router.service.spec.ts:14-50`, `harness-builder-focus-router.service.spec.ts:14-50`) cover unknown sessions and the switch-before-navigation order.

## Decisions

- Use a tracked effect to invalidate the stale alert snapshot. Alternatives: message-array identity or a new shared `TabState` resume generation. Evidence: appends replace messages, while `applyResumingSession` atomically sets the cursor to `undefined`; the effect observes that transition and clears the stored snapshot. Reversible: yes. No shared `TabState` field was added.
- Use the existing `WORKSPACE_COORDINATOR` core token. Alternatives: direct `TabManagerService.switchWorkspace` or importing the chat feature service. Evidence: `NotificationFocusCoordinator` calls the same coordinator and the core token exists to cross feature boundaries. Reversible: yes.
- Keep Apps registration last-writer-wins but make unregister identity-safe. Alternative: multi-registration stack. Evidence: the holder has one current source, and a destroyed older service must not remove a newer registrant. Reversible: yes.

## Projects to check

- `@ptah-extension/chat`
- `@ptah-extension/mcp-apps-page`
- `@ptah-extension/setup-wizard`
- `@ptah-extension/harness-builder`

No Nx, Jest, build, or test command was run, per instruction. Scoped `ptah_get_diagnostics` completed after the edit: 259 existing project errors, with no error in the changed lines or the changed production files. Existing errors remain in unrelated chat specs and other sibling files; verification should run through the orchestrator's project checks.
