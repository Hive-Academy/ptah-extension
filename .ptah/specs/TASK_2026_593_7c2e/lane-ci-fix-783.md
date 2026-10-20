# PR #783 CI fixes

## Root cause per failure

1. `apps/ptah-extension-webview/src/app/app.config.ts:107-115` had two `@ptah-extension/git-ui/services` imports. `review-shell-message-handlers.spec.ts:91` reads the first import, which contained only `provideGitStatusAttention`, so it missed the required service symbols.
2. `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:275-287` sent the stale-cursor guidance through `ActionBannerService`, but phase C removed the inline error rendering from `chat-view.component.html` (the `origin/main...HEAD` diff at its former line 81). The canvas tile therefore had no `role="alert"` for `tile-load-older-history.spec.ts:383`, although the button disappeared.

## Changes

- `apps/ptah-extension-webview/src/app/app.config.ts` — merged `provideGitStatusAttention` into the existing services-only import.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts` — retained the attention notice and tracked stale paging guidance for the affected tab, clearing it on a new load attempt.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.html` — restored the stale-cursor text as a scoped inline `role="alert"` in the tile's session controls.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts` — asserted the scoped stale message and clearing behavior.

## Decisions

- **Stale cursor location:** Keep the attention notice and restore the inline tile alert. Options were tile plus notice or bell only. `decisions.md:11` (#8) includes ActionBanner errors in notice migration, while `context.md:47-50` says to preserve in-context errors; the unchanged e2e at `tile-load-older-history.spec.ts:370-384` requires visible guidance in the tile. No task decision explicitly moves this per-tile paging state to the bell alone. Reversible: yes.
- **Import surface:** Use the existing `@ptah-extension/git-ui/services` statement. The failing spec at `review-shell-message-handlers.spec.ts:91` and the bundle constraint both require that entry. Reversible: yes.

## Projects to check

- `ptah-extension-webview`
- `@ptah-extension/chat`

No test commands were run, as instructed. Scoped `ptah_get_diagnostics` was attempted twice after edits; the TypeScript compiler check timed out both times and reported the three TypeScript files unchecked. The HTML file is not recognized by that checker. The orchestrator owns verification, including the unchanged Electron e2e.

## Revision 1

- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:262-306` — changed the inline alert to a computed view of the stale tab snapshot. It appears only while that tab still exists with the same session ID, null cursor, and messages array. `TabManagerService.applyResumingSession` resets the cursor to `undefined` and replaces the messages array (`tab-manager.service.ts:2930-2945`), so reopening clears the alert even when the session ID is unchanged. Closing the tab also removes it from the computed lookup. The messages-array identity prevents an old alert from reappearing when a later page naturally ends with a null cursor. No paging-service API change was needed.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.spec.ts:645-711` — simulated stale paging, reopening with a fresh cursor, a later null cursor, and tab closure; asserted the alert disappears and stays hidden.
- **Decision:** Keep the inline `role="alert"` at `chat-view.component.html:86` and the existing attention notice. Decision #8 in `decisions.md:11` includes ActionBanner errors in notice history; `context.md:47-50` keeps in-context errors inline. The tile alert is the only live region for this text inside the tile, and the notice path remains unchanged. Options were both surfaces or inline only; this is reversible.
- **Verification:** No tests were run under the lane restriction. Scoped Ptah diagnostics completed for the chat files and reported no errors in the revised component or the new spec lines; they also reported existing errors elsewhere in the chat project and existing spec errors at later lines.

## Orchestrator follow-up (after re-review)

- R1 (Moderate) fixed by the orchestrator: the stale snapshot and the `olderHistoryAlert`
  computed now use `TabManagerService.findTabByIdAcrossWorkspaces` (as `hasOlderHistory` does),
  so a tile whose tab is in a background workspace also gets the inline alert.
  `chat-view.component.spec.ts` routes that lookup through `tabsSig` in both stale tests.
- R2 (Moderate) accepted for now: the alert is keyed on the `messages` array identity, so an
  appended live event hides it while the load-older button stays hidden. The bell notice stays.
  Listed as a later task.
