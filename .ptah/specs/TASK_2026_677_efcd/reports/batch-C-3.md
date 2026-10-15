# Batch C-3 report

`ptah-canvas-lane-tabs` is now the agent dock: one selected pill, avatar chips, a hover card, and an `N agents` menu. Lane ownership goes through `@ptah-extension/chat`. `lane-owner.ts` is deleted.

## Files

- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts` — REWRITE — dock shell: roster, rank overflow, tablist keys, hover card, one clock.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.spec.ts` — REWRITE — tab id, roster providers, status in `aria-label`, 400 px overflow, menu and card.
- `libs/frontend/canvas/src/lib/canvas-detail/agent-dock-card.component.ts` — CREATE — `role="tooltip"` card, no controls.
- `libs/frontend/canvas/src/lib/canvas-detail/agent-dock-menu.component.ts` — CREATE — `N agents` menu over `ptah-native-dropdown`.
- `libs/frontend/canvas/src/lib/canvas-detail/dock-overflow.ts` — CREATE — capacity, rank plan, duration and status ink.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.ts` — MODIFY — lane tabs bind `[tabId]="id"`.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.spec.ts` — MODIFY — tabs stub input `sessionId` → `tabId`.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts` — MODIFY — `ownedBySession` imported from `@ptah-extension/chat`.
- `libs/frontend/canvas/src/lib/canvas-needs-you-queue.ts` — MODIFY — same import re-point.
- `libs/frontend/canvas/src/lib/canvas-detail/lane-owner.ts` — DELETE — helper now lives in chat.

`canvas-rail-board.component.spec.ts` was not edited. `canvas-lane-view.component.spec.ts` and the needs-you spec were not edited.

## Acceptance

- No file imports `lane-owner`. The canvas helper file is gone. `canvas-lane-view.component.ts:20` and `canvas-needs-you-queue.ts:6` import `ownedBySession` from `@ptah-extension/chat`. The chat-ui `data-testid="lane-owner-text"` is untouched.
- A narrow dock keeps a `waiting` agent and hides a `done` one. Rank is Orchestrator, selected, `waiting`, `failed`, `running`, rest (`dock-overflow.ts:49-60`). Slots are `capacity + 1` (`dock-overflow.ts:69-73`). `dockCapacity(400)` is 3 (`dock-overflow.ts:35-42`), so four agents stay and a finished one drops. The spec drives a 400 px measurement and expects `Waiter` on a tab and `Finished` absent (`canvas-lane-tabs.component.spec.ts:392-397`).
- WCAG 1.4.13: the card emits `hovered` (`agent-dock-card.component.ts:32-33`). The dock opens it after 220 ms for a non-touch pointer, keeps the same timer to close only when the pointer has left the tab and the card and the tab is not focused, and Escape closes it without moving selection (`canvas-lane-tabs.component.ts:34`, `:327-367`, `:79`). The tab's `aria-describedby` points at the open card (`canvas-lane-tabs.component.ts:107` and the matching chip binding).
- One `ResizeObserver` on the dock root, `disconnect()` on destroy (`canvas-lane-tabs.component.ts:286-294`). The spec expects `disconnect` once (`canvas-lane-tabs.component.spec.ts:415-416`).
- No per-id template branch. Chips differ by `chip.selected`, not by agent id (`canvas-lane-tabs.component.ts:96-160`). Kind order is the dock list `DOCK_KINDS` (`canvas-lane-tabs.component.ts:35-38`, `:249`).
- Dock avatars are size 28 (`canvas-lane-tabs.component.ts:118` and `:155`). The card uses 32 (`agent-dock-card.component.ts:39`). Menu and pile avatars are 24 (`agent-dock-menu.component.ts:60`, `:114`).
- Hover card placement calls `FloatingUIService.position` with `bottom-start` (`canvas-lane-tabs.component.ts:385-394`). Flip and shift stay at that service's defaults (on, 8 px padding), which is what clamps the card inside a short pane. This lane did not run the 400 / 760 px visual audit; that remains the designer's `capture-delta2.mjs` check.
- Selector, tablist label, roving tabindex, arrow / Home / End on visible tabs, and the sub ↔ background key correction stay (`canvas-lane-tabs.component.ts:84-85`, `:205-215`, `:300-324`).
- Menu: `aria-haspopup="menu"`, panel `role="menu"`, rows `role="menuitemradio"`, Up / Down / Home / End, Enter / Space select, Escape closes and focuses the trigger, Tab closes without `preventDefault` (`agent-dock-menu.component.ts:50-51`, `:91-96`, `:108`, `:232-253`). Hidden `waiting` / `failed` counts are in the button name (`agent-dock-menu.component.ts:136-148`). Spec expects `5 agents, 1 waiting, needs you, 1 failed` at width 0 (`canvas-lane-tabs.component.spec.ts:407-414`).

## Spec changes

- `canvas-lane-tabs.component.spec.ts` — providers are the real roster's stores plus `TabManagerService` (`findTabByIdAcrossWorkspaces`, `findTabBySessionIdAcrossWorkspaces`) and `PermissionHandlerService` (`permissionRequests`, `questionRequests`, `targetTabsFor`, `questionTargetTabsFor`, `routingTargetRevision`) (`:102-125`). Every `setInput('sessionId')` is `setInput('tabId', TAB_ID)` with `claudeSessionId: 'owner'`. Completed lanes assert the status word `done` in `aria-label`, not a `title` (`:168-176`). Orchestrator word follows `tab.status` (`loaded` → `done`, `streaming` → `running`) (`:178-180`). Group order is dividers plus menu headings (`:174`, `:185-191`). Resize cases no longer expect `scrollIntoView`; they recompute capacity, keep the selected tab, and disconnect the observer (`:392-416`, `:457-471`). CLI fixtures include `permissionQueue` and `segments` because the roster reads them. `displayName: 'Codex'` with `cli: 'codex'` checks D-C-2 through the roster name (`:146-151`, `:171`).
- `canvas-focus-area.component.spec.ts:66` — tabs stub input is `tabId`. The lane-view stub still takes `sessionId`.

## Diagnostics

`ptah_get_diagnostics` is not connected in this session. `search_tool` only listed the `tasks` server. Calls to `ptah_get_diagnostics` and `ptah__ptah_get_diagnostics` returned not-found. No nx, Jest, typecheck, or lint run was started (parallel-wave rule). Scoped checks stay with the team-leader.

## Decisions

- Dock text uses `SessionAgent.name` and does not re-derive a CLI label. Options: format `displayName || cli` again in the dock, or show the roster name. Evidence: `buildSessionAgentRoster` already sets `name: a.displayName || a.cli` (D-C-2, `compact-lane-rows.ts` rule). Reversible: yes, one binding.
- The single 220 ms timer both opens the card and, after the pointer leaves, waits before close so the pointer can reach the card. Options: close on tab `pointerleave` immediately, or reuse that handle as the grace. Evidence: plan allows one timeout handle; WCAG 1.4.13 requires the card to stay hoverable across the gap. Placement uses `offset: 0` and the card's `pt-2` so the hit area touches the tab. Reversible: yes.
- The decorative pile renders at most three hidden avatars. Options: every hidden avatar, or three. Evidence: the pile is `aria-hidden`; the menu still lists everyone; a 38 px chip cannot hold an unbounded stack without covering another target (D40). Reversible: yes, the `slice(0, 3)` in `agent-dock-menu.component.ts`.
- At capacity 0 the one slot is the best rank (the Orchestrator), not a force-inserted selected agent. Options: always paint the selected agent even if that hides the Orchestrator, or take `capacity + 1` by rank. Evidence: plan rank order and "a lower rank is never visible while a higher rank is hidden" (`dock-overflow.ts:64-73`). A selected non-orchestrator agent is on the dock once capacity is at least 1 (two slots). Reversible: yes.
- The duration clock is one `setInterval` inside an `effect` whose `onCleanup` clears it, including on destroy. Options: a field plus `DestroyRef.onDestroy` only, or the effect cleanup the inspector section uses. Evidence: `canvas-lane-tabs.component.ts:276-284`; the interval runs only while some agent is `running` with a numeric `startedAt`. Reversible: yes.

## Proposed Removals

none. The edge fade and `scrollIntoView` reveal are deleted because the plan replaces them with rank overflow. Every lane is still listed in the menu, still selectable, and still exposes its status word. The old `title` tooltip is replaced by `aria-label`.

## Clarifications Needed

none.
