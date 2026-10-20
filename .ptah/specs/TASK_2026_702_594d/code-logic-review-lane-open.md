# Code Logic Review: lane Open parity (TASK_2026_702_594d)

Score 8/10. Verdict: APPROVED (no blocking or serious findings; 3 minor).
Scope: git diff plus the 3 untracked source files, read in full. Nothing was run (per brief).

## Answers to the review questions

1. Timing: OK. `NOTIFICATION_FOCUS_ROUTER.focus` resolves only after `OrchestraCanvasComponent.processFocusRequest`
   (orchestra-canvas.component.ts) has focused or adopted the tile and awaited `afterTileRender()`. `success`
   is only resolved by the mounted canvas, so its `CanvasDetailService` (component-level provider, line 70, registered in
   its constructor) exists and the tile is in `canvasStore.tiles()` when `open` runs. A workspace switch that
   leaves the canvas unmounted yields a 5s timeout with `missing`, which short-circuits before `open`. No
   deferred retry needed. The residual wait is the lane existence check (`monitor.agents()` filtered by
   `parentSessionId`). That is the same data the chip read at click time, so parity holds, and the fallback is session focus plus a warn.
2. Lane key: `cli:${agentId}` equals `laneKey('cli', agentId)` today (LANE_KEY_PREFIX.cli = 'cli'), and
   `parseLaneKey` accepts it. See minor finding M1.
3. Multiple detail services: only one `ptah-orchestra-canvas` exists, and `open` guards on
   `tiles().some(tabId)`, so ownership is checked per instance. Lifecycle: `register` returns an unregister
   function that is handed to `destroyRef.onDestroy`, which is correct. The Set is root-scoped and
   cleaned on destroy, so there is no leak. `open` returns `false` without side effects when it fails.
4. Targets: the dispatcher requires `target.kind === 'lane-permission'` and `item.tabId`. Items
   without `tabId` skip the opener (session focus only). Host-projected notices go through
   `host.openProjected` earlier and never reach this branch. This is safe.
5. Boundaries: core adds only a token with no canvas import. chat imports core. canvas imports core and chat
   (already does). The webview app imports the canvas root statically (app.config.ts:112) and nothing
   imports canvas dynamically (grep found no `import('@ptah-extension/canvas`), so the dynamic-dependency
   rule does not fire for `canvas/focus`. Bundle impact is one tiny file, which the root barrel already pulls in. The tsconfig.base.json path
   is added. Lint is not run, so this is by inspection (MEDIUM confidence).
6. Specs: the dispatcher spec covers an exact lane open (`openLane('tab','agent')`), the fallback when
   `open` returns false (session focus kept and a warn), and non-lane Open (opener not called). The canvas spec
   covers the bridge opening `cli:agent-1` and an unresolved agent returning false without `focusTile`. There is no
   spec for register/unregister on destroy and no integration test of provider wiring in app.config.

## Findings

- M1 (Minor) canvas-attention-lane-opener.service.ts, `open` method: hand-built `cli:${agentId}`. Use
  `laneKey('cli', agentId)` from `@ptah-extension/chat` (exported, chat/src/index.ts:35) so a prefix change can't drift. The
  chip used the helper.
- M2 (Minor) chat-attention-action-dispatcher.service.ts:59-65: `item.tabId` may be stale if the tab was closed and the
  router recreated the tile via `addTileFromSession` (new tabId). `open` then returns false and the user
  lands on session focus only. The chip had the same limitation. The router result doesn't expose the resolved tabId.
  Acceptable, but extending `NotificationFocusResult` with `tabId` would close the gap.
- M3 (Minor) The opener is `optional: true` and a missing provider is silent: nothing is logged, because
  `this.laneOpener?.open(...)` yields undefined and the warn fires with the same message. In practice that is acceptable because it still
  warns. Add a registration/unregistration spec for `CanvasAttentionLaneOpener` (destroy removes the service).

Side effects: `open` also sets `_detailTabId` to null (closes any overlay), which matches the removed chip.

No data loss, silent-success, or race findings. Residual uncertainty: lint and tests were not executed.

## Orchestrator follow-up

- Lane key minor fixed: `canvas-attention-lane-opener.service.ts` now calls `laneKey('cli', agentId)`
  from `@ptah-extension/chat` (no bundle change: `canvas-detail.service.ts` already imports that
  barrel, and `app.config.ts` loads it statically).
- Stale tab id minor: accepted, same limit as the removed chip.
- Unregister spec minor: accepted for now.
