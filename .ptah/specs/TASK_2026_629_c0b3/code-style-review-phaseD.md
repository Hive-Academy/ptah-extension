# Code Style Review, Phase D — TASK_2026_629_c0b3

Scope: f5fe143b9 (B6), be6dc1744 (B7a), b9c12a173 (B7b), 1ddb4f705 (B7c), 110fdc635 (B8a), d1cf223d7 (B8b). Read-only review; no tests, typecheck or lint were run.

Score: 7/10. Verdict: REVISE (no blocking violations; two Moderate items worth fixing before merge).

## Checks that pass

- Angular conventions: all new components are OnPush, signal `input()`/`output()`, `inject()`, `host: {}` object (no `@HostBinding`).
- Barrel imports only: `@ptah-extension/chat`, `chat-streaming`, `chat-ui`. `SubagentUsageSummaryComponent` was added to the chat barrel (chat/.../components/index.ts), not deep-imported.
- Tag boundaries: callout lives in chat-ui and imports only its sibling types; chat does not import canvas; canvas imports chat and chat-ui.
- Colors: DaisyUI semantic only (`warning`, `error`, `primary`, `base-*`, `success`). No raw hex or Tailwind palette classes found in the new files.
- No `as any` in production files; the `any` use is spec-only (see Minor).
- Return types on public methods are explicit (`loadTranscript`, `stop`, `respond`, `canvasDetailGeometry`).

## Moderate

1. **Owner filtering reimplemented three times, bypassing the store helper.**
   `AgentMonitorStore.agentsOwnedBySession(sessionId)` exists (chat-streaming/src/lib/agent-monitor.store.ts:869) and the card callout uses it. canvas-lane-tabs.component.ts:78-86 and canvas-lane-view.component.ts:186-220 re-filter with raw `a.parentSessionId === sessionId`; canvas-needs-you-queue.ts:89 does the same by tile. The guards differ (tabs use `!!sessionId &&`; the lane view compares directly, so a null session id can match an agent whose `parentSessionId` is also null/undefined). The card, queue and detail can drift on which lanes a session owns. Use the store helper (or one shared selector) in tabs and lane view.

2. **Deny reason string and decision plumbing copied in three places.**
   `decision === 'deny' ? 'User denied' : undefined` appears in canvas-lane-view.component.ts:300-306 and canvas-needs-you-queue.component.ts:165-170, and the literal `'User denied'` again in tile-agent-mini-panel.component.ts (B8b, `denyPermission`). The new `AgentPermissionResponder.respondLane` is the right shared boundary, but the default reason belongs inside it (default when `decision === 'deny'` and no reason given). Today a fourth caller will diverge.

3. **Lane-view template and class are over-large for one responsibility and duplicate the card's permission UI.**
   canvas-lane-view.component.ts (309 lines, not near the limit) holds a hand-written permission block (lines 50-74: Allow/Deny buttons, `bg-warning/10`) that duplicates `CompactSessionCalloutComponent`'s markup, plus two near-identical `subagent` and `background` branches (lines 85-169: usage summary, Stop button, transcript viewer). Extract a `CanvasSubagentLaneComponent` (or reuse the callout) so Stop/transcript logic exists once. Also the transcript loading exists twice with different race guards: the `effect` at 243-271 guards with `active`, `loadTranscript` at 274-285 does not, so a slow manual refresh can overwrite a newer lane's messages.

4. **Accessibility of the tab pattern is incomplete.**
   canvas-lane-tabs.component.ts:30-67: `role="tablist"` directly contains non-tab `<span>` group labels (invalid child role; use `role="presentation"` or `aria-hidden`/group wrappers). Tabs have no `id`, and the tabpanel (canvas-lane-view.component.ts:40) has hard-coded `id="canvas-lane-panel"` with no `aria-labelledby`. The tablist is wrapped in `<nav aria-label="Session lanes">` (canvas-detail-panel.component.ts:~37), which gives a navigation landmark to a widget. `aria-controls` is hard-coded in every tab and breaks if two panels render (the id would duplicate). Compare existing tablists in chat (display-dock.component.ts, electron-shell.component.ts), which are the sibling pattern.

## Minor

- canvas-lane-view.component.ts:41 `@for (key of [laneKey()]; track key)` is a re-create-on-change trick; it allocates an array every evaluation and reads as a bug. Comment it or use `@if` with a key signal.
- canvas-lane-view.component.ts:99,113,133,147 four `sub.parentSessionId!` non-null assertions inside templates. The component already has the value in the `effect` (line 246); expose a narrowed computed instead.
- canvas-lane-view.component.ts:238-241 `effect` writes to a store (`toggleAgentExpanded`) as a side effect of selection; fragile (toggle, not set) and not self-explanatory.
- canvas-lane-view.component.ts `stop()` uses try/finally with no catch, so a rejected `stopAgent` surfaces as an unhandled rejection from a click handler.
- canvas-lane-tabs.component.ts:91 hard-coded `status: 'running'` for Orchestrator, and 'Orchestrator' string compared at line 37 to hide the group label; use a `showLabel` flag.
- canvas-lane-tabs.component.ts:149-171 `onKeydown` uses `event.currentTarget` DOM querying to move focus; roving focus is acceptable, but the nested ternary should be a small lookup.
- canvas-lane-tabs.component.ts:51 `[class.text-base-content/60]` is a class name containing `/` bound via `[class.x]`; it works with Angular but is unusual. Prefer `ngClass` or a computed class string.
- compact-session-callout.component.ts: `standalone: true` is omitted while the canvas-detail components and canvas-tile set it. Pick one (Angular 22 default makes it redundant, so the canvas files are the outliers) and be consistent.
- compact-session-callout.component.ts:34-60 vs 62-83: the permission and question branches duplicate the same header row (text + "+N more"). Extract one `ng-template` or a shared row.
- compact-session-card openRequest (1ddb4f705): a session-source permission opens `openFullView()`, while the needs-you queue opens the Orchestrator lane (`'orchestrator'`, canvas-needs-you-queue.component.ts:200-204). Two different destinations for the same intent; consider one `laneKeyForRequest()` helper next to `laneKey` in chat's compact-lane-rows.
- Lane-key building: `laneKey('cli', id)` appears in the card (openRequest), queue (line 202) and tabs (lines 99,108,119,128), each correct, but the `item.kind === 'lane-permission' && item.agentId ? laneKey('cli', item.agentId) : 'orchestrator'` mapping belongs in a single shared function.
- canvas-detail-geometry.ts and canvas-workspace-grid.styles.ts live in canvas/src/lib/ root while the other detail files live in canvas-detail/. Geometry is grid-specific so root is defensible; `canvasDetailStyles` placed in the grid styles file mixes two concerns (`canvasDetailStyles` + `canvasWorkspaceGridStyles`). Name consistent (`canvas-*.ts`), fine.
- canvas-detail-geometry.ts:35 magic numbers `12` (grid columns), `320`, `16`. Name them or import the grid column constant.
- canvas-workspace-grid.styles.ts uses `::ng-deep` and `canvasDetailStyles` uses `:host ::ng-deep`; already the pattern in the file, so consistent, but it should be tracked as debt.
- Specs: 6 `any` uses. canvas-lane-tabs.component.spec.ts:10-12 and canvas-lane-view.component.spec.ts:15-17 (`signal<any[]>`, `Map<string, any>`). Warnings only; type them with `Partial<MonitoredAgent>` / `Partial<SubagentRecord>` cast through a typed factory.

## File size (700-line `max-lines`, blanks and comments skipped)

- canvas-workspace-grid.component.ts: 873 raw lines (881 before B6, so B6 reduced it by moving styles out; still over the limit).
- canvas-tile.component.ts: 863 raw (820 before this phase, +43; over the limit and growing).
- orchestra-canvas.component.ts: 701 raw (652 before, +49; right at the edge).
- All new canvas-detail files are under 320 lines; none near the limit.
The three large files were already over or near before Phase D; B7b added the detail glue (keyboard handler, `detailTabId` computed, card click/keydown/`isInteractiveTarget`) into them rather than into new units. Moving `onDetailKeydown` and the card-activation helpers into small services/utilities would stop the growth.

## Consistency with existing canvas components

- Host classes (`block h-full min-h-0`) and OnPush match canvas siblings. The detail panel uses the same `rounded-box border bg-base-100` vocabulary.
- Positive: `role="button"` host on the card mode with `isInteractiveTarget` guarding nested controls is documented.
- `CanvasDetailService` is provided at the canvas host and injected `{ optional: true }` in tile and queue; this matches the `CanvasStore` optional pattern used in the tile.

## Summary

Structure and boundaries are sound and consistent with the repo. Fix the two shared-helper items (owner filtering, deny reason) and the lane-view/tablist accessibility before merge; the rest can follow.
