# Lane report R9h

Status: Complete for the assigned files. Three scoped Jest suites passed. `ptah_get_diagnostics` reported no errors in requested files; it reported errors in sibling files outside this batch.

## Files

- `libs/frontend/chat/src/lib/tokens/session-context.token.ts:71`: added the optional Rail retention token.
- `libs/frontend/chat/src/index.ts:45`: exported the token through the chat public API.
- `libs/frontend/chat/src/lib/services/transcript-retention.service.ts:19`: kept the default cap at 8 and added a Rail cap of 4. Lines 39-45 inject the opt-in and track shared tree-cache owners. Lines 67-110 follow contextual tab changes only for opt-in hosts, and release retained tabs on destroy, close, and workspace removal. Lines 116-156 implement ownership-aware disposal and LRU eviction.
- `libs/frontend/chat/src/lib/services/transcript-retention.service.spec.ts:253`: added Rail fifth-tab eviction, shared tree-cache ownership, and Rail close/workspace release cases; existing default-cap 8 coverage remains.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:543`: made `sessionAgents` strict when `SESSION_CONTEXT` exists and tolerant otherwise. Lines 813-841 let an opted-in contextual view render its retained tab ids while using the contextual tab as active. Lines 915-918 remove the stale `compactHeightUnits` comment.
- `libs/frontend/chat/src/lib/components/templates/chat-view.keepalive.spec.ts:234`: verified contextual retention across tab changes and preservation of per-tab dock open, pin, and width state.
- `libs/frontend/chat/src/lib/components/templates/chat-view.dock.spec.ts:827`: added the two required strict/tolerant named cases and a named display update case. The latter checks that the same dock panel instance receives the updated surface without a second dock.
- `libs/frontend/chat/src/lib/components/templates/chat-view.component.html`: no edit needed; lines 80-93 already track transcript nodes by tab id and mark only the resolved contextual tab active.

## Contract coverage

1. `RAIL_TRANSCRIPT_RETENTION` opts a host into cap 4; absent token retains cap 8.
2. Opted-in contextual retention observes `SESSION_CONTEXT`, while the template and ChatView use `resolvedTabId()` for the active transcript.
3. Fifth-tab LRU eviction releases a tab's tree cache only when its last retention owner releases it. Destroy, tab close, and workspace removal release retained ids.
4. Without the opt-in, contextual tiles retain no extra transcripts and the main panel keeps its existing cap and active-tab behavior.
5. `sessionAgents` uses `agentsOwnedBySession` only with `SESSION_CONTEXT`; `SESSION_CARD_ACTIONS` alone stays tolerant. Its existing badge and dock auto-open consumers receive this filtered value.
6. The existing `DisplayDockState` and `panelKey` already key open, pin, selection, and width by resolved tab id; the keepalive and dock specs cover tab switching.
7. Removed the stale `compactHeightUnits` comment.
8. No `HIDE_AGENT_SIDEBAR: true` provider was added. The existing dock, toggle, pin, close, Turn summary, and display sync paths remain wired. The named display case verifies one panel instance on same-id update.
9. No split coordinator or additional ChatView was added. One view may retain four transcript nodes, of which only the contextual tab is active.

## Named specs

- `Rail host (SESSION_CONTEXT) counts only owned agents: an unresolved running agent adds no badge or auto-open`
- `single chat view that provides SESSION_CARD_ACTIONS without SESSION_CONTEXT keeps unresolved agents`
- `a fenced ptah-ui display [id] opens in the single chat view dock and updates in place`
- `Rail opt-in retains four contextual tabs and evicts the fifth least recently used tab`
- `Rail host retains by SESSION_CONTEXT tab id and per-tab dock state survives a tab change`

## Checks

- `node .ptah/tmp/check-run.mjs r9h-ret -- npx nx test @ptah-extension/chat --testFile=transcript-retention.service.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: `Test Suites: 1 passed, 1 total`; `Tests: 16 passed, 16 total`.
- `node .ptah/tmp/check-run.mjs r9h-keep -- npx nx test @ptah-extension/chat --testFile=chat-view.keepalive.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: `Test Suites: 1 passed, 1 total`; `Tests: 2 passed, 2 total`. The log also printed Angular NG0101 recursive-tick errors during the harness run despite passing assertions.
- `node .ptah/tmp/check-run.mjs r9h-dock-final -- npx nx test @ptah-extension/chat --testFile=chat-view.dock.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: `Test Suites: 1 passed, 1 total`; `Tests: 22 passed, 22 total`. This final run followed the stronger in-place display assertion. The mock SessionLoader logged restore failures and Angular NG0956 tracking warnings during passing tests.
- `ptah_get_diagnostics` after edits: no diagnostics in the seven requested TypeScript files; sibling-file diagnostics remain and were not changed in this batch.

## Decisions

- **Opt-in boolean token.** Options were a token or changing the global cap. The batch explicitly requires ordinary hosts to keep cap 8, and existing tiles bypass retention when contextual. The token scopes the four-tab behavior to Rail and is reversible by removing its provider.
- **Tree-cache reference counts per builder instance.** Options were eager clearing or tracking owners. The same `ExecutionTreeBuilderService` cache may be held by two retention service instances; eager clearing would invalidate the other. The WeakMap keyed by builder and tab id preserves it until the last release. This can be replaced with a shared cache owner service later without changing the public token.
- **Reuse the existing dock state.** Options were new state or the current `DisplayDockState`. `ChatViewComponent.panelKey` already uses the resolved tab id for the display dock, and `DisplayDockState` stores pin, width, and open per tab. No extra state or ChatView instance was needed; later dock changes stay local to the existing store.
