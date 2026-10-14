**Score: 6/10. Verdict: REVISE.**
Review family: codex; implementer family: Claude

## Findings

1. **Serious — Escape does not close the header menu from its trigger.** `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-header.component.ts:38-42,94-99`: activating the menu trigger keeps keyboard focus on that button; only the descendant `role="menu"` handles Escape. Pressing Escape immediately after opening the menu therefore leaves it expanded, contrary to the R9x Escape contract. The spec at `canvas-focus-header.component.spec.ts:84-94` first focuses a menu item, and so cannot detect this path. Handle Escape on the header or trigger whenever `menuOpen()` is true, consume it once, return focus to the trigger, and add a spec that opens by keyboard then sends Escape from the still-focused trigger.
2. **Moderate — the stacked e2e case can skip its only assertion.** `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:186-197`: the case uses the current viewport, then calls `test.skip(!stacked, ...)`. On a viewport at least 1440 px wide, it reports a skip and never checks Rail-to-visual-top Tab order. Set a narrow viewport before opening the split and assert `flex-col` before the Tab assertion. This also makes the named stacked case meaningful when Mode 2 checks the e2e TypeScript and the later Electron run executes it.
3. **Moderate — the “drafts and docks unchanged after swap” evidence is only indirect.** `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts:87-103,1253-1269` replaces the lane view with an empty stub and checks that wrapper and stub nodes survive a swap; `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.spec.ts:420-432` reconstructs composers but never invokes a board swap. These tests pass even if a real lane view remounts its `ChatView`, draft, or dock below the stub after `visualOrder` changes. Add one integration assertion in `canvas-rail-board.component.spec.ts` using the real lane view or a stateful child that represents its draft and dock lifecycle, and check the same child instances and values before and after `swapPanes()`; keep the per-tab F5 test for draft lookup itself.

## Contract audit

| Contract | Evidence and result |
| --- | --- |
| Header outputs, forwarding with stable pane id, board consumption | `canvas-focus-header.component.ts:75-79`, `canvas-focus-area.component.ts:49-52,92-96`, `canvas-rail-board.component.ts:153-158`; wired. Specs `canvas-focus-area.component.spec.ts:263-297` and `canvas-rail-board.component.spec.ts:1102-1129` exercise each output. |
| Menu keyboard reachability and Escape before close | Header menu items are buttons at `canvas-focus-header.component.ts:38-50`; Escape handles descendants at `:41-42` only. Finding 1. No Escape path closes a pane (`canvas-rail-board.component.ts:567-579`). |
| Close active/inactive pane, Close split, focus return, survivor host | `canvas-rail-board.component.ts:546-579,760-765`; named specs `canvas-rail-board.component.spec.ts:1132-1197` assert the surviving host, store focus, and header focus. |
| Swap only visual order; labels follow it; at most two hosts | `canvas-rail-board.component.ts:140-167,486-505,585-592`; the handler changes only `visualOrder`. Stable `@for` side keys and `panelId` from `canvas-focus-area.component.ts:88` preserve pane identity. Stubbed subtree checks at `canvas-rail-board.component.spec.ts:1245-1279` cannot establish real ChatView/draft/dock preservation (finding 3). |
| B3 stacked Tab and side-by-side trade-off | `canvas-rail-board.component.ts:36-51,775-802` filters hidden and overlay descendants, and returns early for default or side-by-side order. Synthetic focus-target checks at `canvas-rail-board.component.spec.ts:1280-1348` cover boundaries and no intercept in side-by-side; the stacked e2e may skip (finding 2). The stub does not create an open menu or dock overlay, so their exclusion remains code-traced rather than independently exercised. |
| Collapse reset, C2, C3 | `canvas-rail-board.component.ts:348-369,546-550,390-393` resets order, retains the split survivor when hidden, and uses a neutral visible-board failure message. Specs `canvas-rail-board.component.spec.ts:937-950,1079-1100,1214-1243` cover these. No `reorderPending` branch remains in the board. |
| C1 production surface gate | `libs/frontend/chat/src/lib/components/templates/app-shell.component.html:794-802` places the canvas under `ptahSurfaceActive="canvas"`; `libs/frontend/core/src/lib/routing/surface-active.directive.ts:9-27` provides `SURFACE_ACTIVE` from route and `layoutMode() === 'grid'`; `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:237-242` nests the Rail board there. Thus `canvas-rail-board.component.ts:247-253,334-367` receives a false signal in single-chat mode and repairs on activation. Specs `canvas-rail-board.component.spec.ts:1028-1077` check no hidden write and one activation write. The optional `signal(true)` fallback does not apply on this production path. |
| NEW-3, NEW-6, decision 77/86 | Details is an in-flow header button at `canvas-focus-header.component.ts:34-37`; Close split is in the header menu at `:44-50`; Details overlay opens without layout width at `canvas-rail-board.component.ts:159-164,594-616`. Single-focus selectors use `activeSide()` at `:760-765,803-813`; spec `canvas-rail-board.component.spec.ts:1156-1178` covers a surviving right pane. No `HIDE_AGENT_SIDEBAR: true` or split persistence write appears in the eight-file diff; these are scoped regression observations, not a full repository proof. |
| Contextual F5 drafts | `chat-input.component.spec.ts:384-432` checks per-`SESSION_CONTEXT` draft isolation, replacement, and reconstruction; the swap part is indirect (finding 3). |

## Named-case audit

| Named case | Result |
| --- | --- |
| Each header output reaches board state | Exercised by `canvas-focus-area.component.spec.ts:263-297` and `canvas-rail-board.component.spec.ts:1102-1129`. |
| Escape before close | Menu-item Escape covered at `canvas-focus-header.component.spec.ts:84-94`; immediate Escape at trigger missing and fails in production (finding 1). |
| Close active and inactive pane; Close split | `canvas-rail-board.component.spec.ts:1132-1197` checks survivor, store focus, stable host, and focus return. |
| Stacked swap keeps hosts and top-before-bottom Tab order | Unit assertion `canvas-rail-board.component.spec.ts:1245-1300` is sensitive to removal of the board Tab handler. E2e at `canvas.spec.ts:186-197` can skip (finding 2). |
| Side-by-side swap keeps DOM Tab order | `canvas-rail-board.component.spec.ts:1329-1348` checks no preventDefault; code returns at `canvas-rail-board.component.ts:778`. |
| Collapse resets visualOrder | `canvas-rail-board.component.spec.ts:1214-1243` covers both actions and external removal. |
| Swap preserves real ChatView, zero transcript transfers, drafts and docks | The changed board mutates only `visualOrder` (`canvas-rail-board.component.ts:585-592`), and the e2e host marker at `canvas.spec.ts:161-174` would catch a host replacement when run. Unit subtree/draft assertions do not test the real descendants (finding 3); transcript-transfer and cold-mount counters are not directly asserted here. |
| Unique panel ids; selected card; <= 2 hosts | `canvas-focus-area.component.ts:88`, `canvas-rail-board.component.spec.ts:1269-1278`, and existing board spec `:717` cover these at board level. |
| Contextual F5 drafts | `chat-input.component.spec.ts:384-432` covers keyed draft recovery; actual swap remains untested. |

## Five logic questions

1. **Silent failure:** `canvas-rail-board.component.ts:390-393` announces a new write failure only when `writeFailed()` changes; if it is already true, another failure has no new announcement (previously recorded C4). This batch retains the neutral visible-board message. A more immediate silent gap is a skipped stacked e2e check (`canvas.spec.ts:190-197`).
2. **Unexpected user action:** open the header menu with Enter and press Escape while focus remains on the trigger; the menu remains open (`canvas-focus-header.component.ts:38-42,94-99`; finding 1).
3. **Wrong answer from data:** after a visual swap, pane labels derive their position from `visualOrder()` (`canvas-rail-board.component.ts:500-505`), so no wrong label was found for ordinary split data. With null focus, `activeId()` uses a valid `lastFocusedId` and the effect repairs a visible board (`:334-379,479-498`); specs `:1028-1077` cover the hidden-to-visible case. Real draft/dock state after swap remains insufficiently observed (finding 3).
4. **Dependency failure or malformed state:** a persistence failure sets the neutral live-region text when the board is visible (`canvas-rail-board.component.ts:390-393`); repeated failures while the signal stays true remain silent. A removed split tab collapses to a valid survivor or repairs after activation (`:348-369`), covered by specs `:1058-1100`.
5. **Missing from requirements:** the menu contract did not specify focus placement on open. The implementation keeps focus on its trigger (`canvas-focus-header.component.ts:38-42`), making Escape at the trigger a required real path. The test's menu-item-only setup (`canvas-focus-header.component.spec.ts:84-94`) missed it.

## Verification and score

I read the R9x contract, decisions 105-106, writer report, prior C1-C3 reviews, the three changed production components, the changed specs and e2e selectors, plus the app-shell surface provider path. The writer report records passing targeted specs: header 12, board 66, focus area 9, chat input 78; I did not rerun them. Scoped `ptah_get_diagnostics` found no diagnostics in the requested production/e2e files, but reported seven errors in sibling files (`orchestra-canvas.rail.spec.ts`, `mock-rpc-service.ts`, `capability-id-codec.ts`); this is not a clean project typecheck. E2e was not run by rule. The score is below 7-8 because the keyboard defect affects a likely path and two named checks do not conclusively exercise their behavior; it stays above 3-4 because the split state paths, C1 production wiring, host identity design, and core boundary checks are implemented and targeted specs pass.

## Decisions

- Keep the documented side-by-side DOM Tab order after swap (`canvas-rail-board.component.ts:778`, contract `batches-rail-r9.md:622-626`).
- Fix finding 1 in the header and its spec; make finding 2 deterministic in e2e; strengthen finding 3 in a changed spec. No source was edited during this review.
