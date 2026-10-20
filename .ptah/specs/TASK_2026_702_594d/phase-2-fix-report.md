# Phase 2 code logic fix report

| Finding | Fix | File:line | Covering spec |
| --- | --- | --- | --- |
| S1 | Added the interactive marker to the board wrapper. | `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:103` | `orchestra-canvas.component.spec.ts:862` checks the marker contains the board. |
| S2 | Updated both empty-board heading assertions; a final search found no old heading in `apps/**/*.spec.ts`. | `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts:71`; `apps/ptah-electron-e2e/src/specs/git/hunk-revert-top-layer.spec.ts:193` | The two updated e2e assertions. |
| S3 | Split non-focusing close from cancel; the tile-bound effect uses close, and cancel focuses the anchor only if the popover was open. | `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:389,582-591` | `orchestra-canvas.component.spec.ts:373` keeps composer focus when the bound is reached. |
| S4, M4 | Load only on entry to a visible zero-tile board, with the call inside `untracked`. | `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:439-443` | `canvas-rail-board.component.spec.ts:1139` checks 1-to-0 and repeated entry. |
| M1 | Retain confirmed rows during a same-workspace reload; clear them on workspace change. | `libs/frontend/chat/src/lib/services/session-list/recent-sessions.store.ts:37-43` | `recent-sessions.store.spec.ts:120` checks both transitions. |
| M2 | Each blocked popover attempt advances the notice revision. | `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts:547` | `orchestra-canvas.component.spec.ts:391` checks a dismissed repeated reason reappears. |
| M3 | Render one rail outside the tile branches and use CSS order for the empty main. | `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.ts:109-143,202-209` | `canvas-rail-board.component.spec.ts:1139` checks DOM instance identity across transitions. |
| M5 | Changed the stub and expectation to Open Library. | `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail-board.component.spec.ts:204,1136` | Existing empty-board contract assertion. |
| Phase 1 N1 | Widened the moving layer and switched to eased alternating travel; at either end the layer still covers the host. Reduced-motion and pause rules remain. | `libs/frontend/ui/src/lib/native/aurora/aurora-effect.component.ts:59-79` | `aurora-effect.component.spec.ts:50` checks width, direction, keyframes, static reduced motion. |
| Phase 1 N3 | Covered the disconnected external anchor and projected trigger fallback. | `libs/frontend/ui/src/lib/native/popover/native-popover.component.spec.ts:128` | New spec checks visible, focused, unpositioned panel and `opened`. |

## Decisions

- M2 write-failure refresh: `CanvasLayoutPersistenceService.writeFailed` is a boolean and exposes no failure counter. A second failed write while it remains true cannot be distinguished in the permitted files. Repeated blocked-create notices are refreshed; repeated write-failure notices remain a known limit. Adding a write-attempt revision in the persistence service is reversible and belongs to a later owned batch.
- Minor m1: the needs-you chip row remains inside the measured viewport until Phase 3 removes it. Phase 3 should recheck viewport geometry after removal.
- Minor m2: the shell may already own a `main` landmark. Duplicate-landmark checking belongs in the orchestrator's e2e/accessibility pass; no semantic markup change was requested for this round.
- Minor m3: the cap wording is acceptable per review; no change was requested.

## Verification and remaining work

- No Nx, Jest, TypeScript command, build or e2e run was started, per task instruction. Scoped `ptah_get_diagnostics` was attempted after edits but reported TypeScript coverage unavailable after its internal timeout; it did not return errors or a pass.
- The orchestrator owns the canvas, chat, ui and e2e type checks. The repeated write-failure revision and Phase 3 viewport/landmark checks remain outstanding as described above.
