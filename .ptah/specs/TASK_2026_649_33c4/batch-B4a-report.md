# B4a report — entry handoff and Setup Hub

## Files changed

- `libs/frontend/harness-builder/src/lib/services/harness-workflow-request.service.ts`: Replaced AppState workflow handoff with a builder-local tab adapter. It resumes a same-mode running tab or draft, holds one pinned cross-mode intent across Hub unmount, guards duplicate transitions, creates and tags a normal tab, installs the hidden first-message preamble, writes the New Project stack profile before sending the visible intake summary, and navigates with mode and tab ID. It exposes `pendingIntent`, `cancelPendingIntent()`, `completePendingIntent()`, `reportAbortFailure()`, `hubWarning`, `hubError`, and `entryErrors` for the page and Hub.
- `libs/frontend/harness-builder/src/lib/services/harness-workflow-message.handler.ts`: Validates relay mode, active workspace and New Project intake, reports malformed relay through the Hub error signal, delegates entry to the adapter, and forwards proposal pushes to the tab-scoped hydration service.
- `libs/frontend/harness-builder/src/lib/components/setup-hub.component.ts`: Routes both cards and New Project intake through the adapter. The existing conflict confirm now explains that it opens Save as draft / Discard / Cancel on the builder page; its handler only hands off the validated intake. Added dismissible persistent warning and relay error lines using the Hub's existing alert style.
- `libs/frontend/harness-builder/src/lib/services/harness-workflow-request.service.spec.ts`: Covers same-mode running tab and draft resume, both cross-mode directions, duplicate intent, Cancel, intake preservation, preamble, stack-profile-before-send ordering, nonfatal profile write failure, and abort warning.
- `libs/frontend/harness-builder/src/lib/services/harness-workflow-message.handler.spec.ts`: Covers relay validation, failed navigation reporting, and scoped proposal push forwarding.
- `libs/frontend/harness-builder/src/lib/components/setup-hub.component.spec.ts`: Covers card and intake delegation, conflict confirm and Cancel, resume, and dismissible Hub lines.

## Verification

All six changed TypeScript files returned `parseStatus: ok`, `errorNodeCount: 0` from `ptah_ast_analyze`. Prettier completed on the six assigned files. Nx, Jest, TypeScript, diagnostics, build, serve and e2e were not run, as instructed; the orchestrator owns those checks.

## Parity rows covered

B4a entry portions of rows 1–10, 16–18, 27–29, 43 and 59: ordinary tagged-tab entry, hidden preamble and one visible New Project intake turn, mode/draft resume, cross-mode leave handoff, cancellation, duplicate guard, relay validation and Hub feedback. Builder-page leave, route rendering and page notices remain integration work for B4b/B4c.

## Decisions

- **Keep the pending intent in the root-provided adapter.** Options were Hub-local state or adapter state. The plan requires it to survive Hub unmount, and the adapter already owns entry. Reversible: yes.
- **Use the existing Hub `alert alert-error` style for both new lines.** Options were a new warning style or the existing alert pattern. D10/D12 require the Hub's visual design and existing styles. Reversible: yes.
- **Send the New Project summary after the tab is registered visible.** Options were immediate dispatch or waiting for `visibleTabIds`. The entry sequence requires the embedded chat to register before first send; a 10-second bound reports a page-scoped entry error if registration fails. Reversible: yes.
- **Forward proposal pushes to `HarnessProposalHydrationService`.** Options were retaining legacy surface-scoped hydration or using B3c's tab-scoped store. B4c removes the old workflow transport and the plan requires session-scoped proposal ownership. Reversible: yes.

## Not done / integration handoff

- B4b owns the parameterized route. B4c must read `pendingIntent()` on the source builder page; on Cancel call `cancelPendingIntent()`. After Save or Discard and the old abort attempt have settled, call `reportAbortFailure(error)` if abort failed, then `completePendingIntent()`. It must surface `entryErrors()[tabId]` on an already-landed builder page and clear it with `clearEntryError(tabId)` when dismissed or retried.
- B4c owns saving/discarding the old tab, its snapshot/draft lifecycle, its leave dialog, and rendering the new page. This batch did not edit its files or the app routes.
- Static parsing is the only verification performed locally. Type, lint and test results are pending the orchestrator's checks.
