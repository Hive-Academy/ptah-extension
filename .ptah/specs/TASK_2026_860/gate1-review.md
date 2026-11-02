# Gate 1 requirements review

**Verdict: REVISE**

The cited components are correct. The eight local rotation citations also match the source. The four user asks have scope entries, but the dock and parity criteria need revision.

1. **Blocking — Running-first display order is not required or testable.** `.ptah/specs/TASK_2026_860/task-description.md:51-53` requires running-first slot allocation only. `libs/frontend/canvas/src/lib/canvas-detail/dock-overflow.ts:132-136` restores roster order after ranking, and `canvas-lane-tabs.component.ts:353-378` regroups chips by kind. An implementation can pass the stated criterion while waiting chips remain left of running chips. Require left-to-right running-first order, define any selected-agent exception, and add a rendered-order test.
2. **Serious — The five-chip cap has unaddressed rendered-path bypasses.** `libs/frontend/canvas/src/lib/canvas-detail/dock-overflow.ts:110-115` returns every eligible agent for non-finite capacity. `canvas-lane-tabs.component.ts:338-346` replaces the planner result during keyboard focus and adds every waiting or failed agent without a cap. `.ptah/specs/TASK_2026_860/parity-inventory.md:27` names planner tests only. Add component-level cases for initial or unavailable `ResizeObserver`, focused-dock status changes, and resize.
3. **Serious — Keyboard parity is incomplete.** Visible-chip arrow selection and focus freezing exist at `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts:463-487,529-560`. Rail keyboard focus uses displayed order at `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts:500-516`. `.ptah/specs/TASK_2026_860/parity-inventory.md:14,25-29` covers menu keyboard behavior only. Add keep/adapt rows and tests so grouping and capping do not strand focus or change selection silently.
4. **Serious — Stop needs an explicit asynchronous target test.** `libs/frontend/chat/src/lib/services/chat.store.ts:381-382` accepts no target. `libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts:566-621` reads the active tab, awaits the agent query and confirmation, then calls an abort path that re-reads the active tab at `conversation.service.ts:412-424`. The task names the risk, but `.ptah/specs/TASK_2026_860/parity-inventory.md:21` must also require an active-tab change before confirmation and during the RPC-failure fallback. Require the inspector tab or session to remain fixed through every path.
5. **Minor — Three groups can obscure five existing jump actions.** `libs/frontend/canvas/src/lib/canvas-rail/canvas-rail.component.ts:141-175` exposes separate needs, error, running, done, and idle counts. `.ptah/specs/TASK_2026_860/task-description.md:57` permits three group headings, while `parity-inventory.md:8` requires each status count to jump correctly. Specify where the individual needs, error, and idle jump actions remain available and accessible.

## Five logic questions

- **Silent failure:** Planner-only tests can pass while the focused dock exceeds the cap. See finding 2.
- **Unexpected user action:** Keyboard navigation can lose focus, and an active-tab change can redirect Stop. See findings 3 and 4.
- **Wrong input:** Non-finite widths and mixed rosters above five expose the cap and order gaps. See findings 1 and 2.
- **Dependency failure:** The running-agents RPC fallback must not abort a newly active session. See finding 4.
- **Missing requirement:** Keyboard behavior and individual status jumps need explicit parity coverage. See findings 3 and 5.
