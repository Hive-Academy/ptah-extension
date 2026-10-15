# Lane report R9m

**Batch R9m of TASK_2026_629_c0b3 — Wave 4 deletion batch (parity rows 59–60 of `parity-inventory-layout.md`, decision 73/80).**

**Status: COMPLETE.** All six Grid-only files deleted. The importer check before deletion found matches only inside the six files themselves (zero external importers); the identical rg after deletion returns no matches. No other file was created or modified.

## Files deleted (6/6)

1. `libs/frontend/canvas/src/lib/canvas-grid-release.ts`
2. `libs/frontend/canvas/src/lib/canvas-grid-release.engine.spec.ts`
3. `libs/frontend/canvas/src/lib/tile-agent-mini-panel.component.ts`
4. `libs/frontend/canvas/src/lib/tile-agent-mini-panel.component.spec.ts`
5. `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-keyboard.ts`
6. `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-keyboard.spec.ts`

Deletion method: PowerShell `Remove-Item -ErrorAction Stop` (not `git rm`), followed by `Test-Path` on each path → `False` × 6.

## Exported symbols (listed before deletion)

**`canvas-grid-release.ts`** — 7 exported functions:
- `retainLiveViewConstraints`
- `nodesNeedingLayout`
- `geometryDriftCount`
- `pinLiveNodes`
- `restorePinnedNodes`
- `releaseStaleNodes`
- `staleGridNodes`

**`tile-agent-mini-panel.component.ts`** — 1 exported class:
- `TileAgentMiniPanelComponent`

**`canvas-detail-keyboard.ts`** — 1 exported function:
- `handleCanvasDetailKeydown`

## Importer check — rg BEFORE deletion (one rg, from W over `libs apps`, `.ptah` not searched)

Command:

```text
rg -n -e 'canvas-grid-release' -e 'tile-agent-mini-panel' -e 'canvas-detail-keyboard' -e 'retainLiveViewConstraints' -e 'nodesNeedingLayout' -e 'geometryDriftCount' -e 'pinLiveNodes' -e 'restorePinnedNodes' -e 'releaseStaleNodes' -e 'staleGridNodes' -e 'TileAgentMiniPanelComponent' -e 'handleCanvasDetailKeydown' libs apps
```

Output (exit 0 — every match is inside one of the six files; self-definitions, the component's own selector, and the specs' own imports):

```text
libs\frontend\canvas\src\lib\tile-agent-mini-panel.component.ts:2: * TileAgentMiniPanelComponent
libs\frontend\canvas\src\lib\tile-agent-mini-panel.component.ts:24:  selector: 'ptah-tile-agent-mini-panel',
libs\frontend\canvas\src\lib\tile-agent-mini-panel.component.ts:115:export class TileAgentMiniPanelComponent {
libs\frontend\canvas\src\lib\tile-agent-mini-panel.component.spec.ts:4:import { TileAgentMiniPanelComponent } from './tile-agent-mini-panel.component';
libs\frontend\canvas\src\lib\tile-agent-mini-panel.component.spec.ts:6:describe('TileAgentMiniPanelComponent', () => {
libs\frontend\canvas\src\lib\tile-agent-mini-panel.component.spec.ts:21:      imports: [TileAgentMiniPanelComponent],
libs\frontend\canvas\src\lib\tile-agent-mini-panel.component.spec.ts:29:    const fixture = TestBed.createComponent(TileAgentMiniPanelComponent);
libs\frontend\canvas\src\lib\canvas-grid-release.ts:7:export function retainLiveViewConstraints(
libs\frontend\canvas\src\lib\canvas-grid-release.ts:14:export function nodesNeedingLayout<T extends Position>(
libs\frontend\canvas\src\lib\canvas-grid-release.ts:43:export function geometryDriftCount(
libs\frontend\canvas\src\lib\canvas-grid-release.ts:64:export function pinLiveNodes(
libs\frontend\canvas\src\lib\canvas-grid-release.ts:78:export function restorePinnedNodes(
libs\frontend\canvas\src\lib\canvas-grid-release.ts:85:export function releaseStaleNodes(
libs\frontend\canvas\src\lib\canvas-grid-release.ts:89:  const stale = staleGridNodes(grid.engine.nodes, liveIds);
libs\frontend\canvas\src\lib\canvas-grid-release.ts:98:export function staleGridNodes(
libs\frontend\canvas\src\lib\canvas-grid-release.engine.spec.ts:6:  pinLiveNodes,
libs\frontend\canvas\src\lib\canvas-grid-release.engine.spec.ts:7:  restorePinnedNodes,
libs\frontend\canvas\src\lib\canvas-grid-release.engine.spec.ts:8:  staleGridNodes,
libs\frontend\canvas\src\lib\canvas-grid-release.engine.spec.ts:9:} from './canvas-grid-release';
libs\frontend\canvas\src\lib\canvas-grid-release.engine.spec.ts:77:  const pinned = pin ? pinLiveNodes(grid.engine.nodes, liveIds) : [];
libs\frontend\canvas\src\lib\canvas-grid-release.engine.spec.ts:79:    for (const node of staleGridNodes(grid.engine.nodes, liveIds)) {
libs\frontend\canvas\src\lib\canvas-grid-release.engine.spec.ts:88:  restorePinnedNodes(pinned);
libs\frontend\canvas\src\lib\canvas-grid-release.engine.spec.ts:128:  const pinned = pin ? pinLiveNodes(grid.engine.nodes, liveIds) : [];
libs\frontend\canvas\src\lib\canvas-grid-release.engine.spec.ts:130:    for (const node of staleGridNodes(grid.engine.nodes, liveIds)) {
libs\frontend\canvas\src\lib\canvas-grid-release.engine.spec.ts:139:  restorePinnedNodes(pinned);
libs\frontend\canvas\src\lib\canvas-detail\canvas-detail-keyboard.ts:3:export function handleCanvasDetailKeydown(
libs\frontend\canvas\src\lib\canvas-detail\canvas-detail-keyboard.spec.ts:2:import { handleCanvasDetailKeydown } from './canvas-detail-keyboard';
libs\frontend\canvas\src\lib\canvas-detail\canvas-detail-keyboard.spec.ts:4:describe('handleCanvasDetailKeydown', () => {
libs\frontend\canvas\src\lib\canvas-detail\canvas-detail-keyboard.spec.ts:20:      handleCanvasDetailKeydown(event, true, 'tile-1', detail),
```

→ No other source file (`.ts`, `.html`, barrel `index.ts`) in `libs`/`apps` imports or references any basename or exported symbol. No stop condition triggered; all six deletions proceeded.

## Zero-importer proof — rg AFTER deletion

Same command re-run from W:

```text
(no output — rg exit 1, no matches)
RG_EXIT_1_NO_MATCHES
```

## mcp-bench mentions (benchmark data — recorded, not edited)

Non-source mentions outside `libs`/`apps`, all pointing at `tile-agent-mini-panel.component.ts` / `TileAgentMiniPanelComponent`:

- `tools/mcp-bench/baseline/gate-baseline.json` — lines 1052, 1816 (file path in benchmark baseline lists)
- `tools/mcp-bench/questions/7910f34cf/references.json` — lines 368–372 (query `TileAgentMiniPanelComponent`, file path, location reference `tile-agent-mini-panel.component.ts:119`)
- `tools/mcp-bench/questions/7910f34cf/relevance.json` — line 1947 (file path)
- `tools/mcp-bench/questions/7910f34cf/file-tools.json` — line 9282 (file path)

These are benchmark data, not source imports; left untouched per instructions.

## Decisions

- Deleted exactly the six assigned files with `Remove-Item` (not `git rm`); no other file was created, modified or deleted.
- No stop condition: the pre-deletion rg found zero importers outside the six files, so no deletion was halted.
- No test/typecheck/lint run: pure deletion with zero importers, per batch step 5 (the team-leader runs the suites).
- `tools/mcp-bench` JSON mentions recorded as benchmark data; not edited.

## Clarifications Needed

None — no live importer was found; every planned deletion was safe and completed.
