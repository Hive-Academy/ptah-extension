# Lane report R9f

Status: Implementation complete in the eight assigned source/spec files. Four targeted specs pass. Direct Rail dock display-update integration and reduced-motion rendering remain for the team's broader integration pass.

## Changes

- `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.ts:46-66`: keep the ChatView child injector stable, gate activity with the parent surface and lane visibility, remove the sidebar suppression, provide Rail retention and card actions using the parent tab id.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail-transcript.component.spec.ts:10`: assert retention, absence of sidebar suppression, and sub-lane selection from a Rail tile; retain visibility and override tests.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.ts:50-72,188-205,299-307,331,417-435`: keep the orchestrator transcript outside the keyed lane block; resolve live nested agent nodes; render full ExecutionNode with tile mode false; use the labelled RPC viewer only when the live node is absent; add Back/Escape; fade focus and lane changes for 180 ms with reduced-motion disabled.
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.spec.ts:120,164,199,216,229`: cover stop, permission answer, live depth-2 node, Escape, labelled fallback/Refresh, and background live lane.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.ts:53-59`: bind one persistent lane view to the focused tab rather than keying it by tab id.
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-focus-area.component.spec.ts:173-235`: verify the lane component instance and header survive focus swaps.
- `libs/frontend/canvas/src/lib/canvas-session-overrides.ts:12,26`: track tab-id changes before untracked default reads, so each tab freezes its own defaults.
- `libs/frontend/canvas/src/lib/canvas-session-overrides.spec.ts:8`: verify A/B/A model and effort retention across Open/Back and tab switches.

## Contract

1. Rail's child injector no longer provides `HIDE_AGENT_SIDEBAR`; existing ChatView dock owns Displays/Agents, DISPLAY, pin, close, Turn summary and display updates.
2. The same child injector provides `RAIL_TRANSCRIPT_RETENTION: true`; one persistent transcript host owns one ChatView.
3. `SESSION_CARD_ACTIONS.openLane` routes the tile-supplied `sub:` or `bg:` key to `selectLaneFor(parentTabId, key)`.
4. The focus area no longer keys the lane view on the focused tab. The orchestrator transcript is outside the keyed non-orchestrator block.
5. Covered transcript remains mounted; `SESSION_VISIBLE` and `SURFACE_ACTIVE` receive the combined visibility signal.
6. Open/Back retains the ChatView and composer DOM; the override helper now follows the tab signal while preserving already-set model/effort values.
7. Live sub-agents render `ptah-execution-node` with `agentTileMode=false`; saved RPC transcript has a visible fallback label and Refresh.
8. Focus and lane changes fade opacity/transform for 180 ms; the CSS runs only under `prefers-reduced-motion: no-preference`.

## Named specs and evidence

- Passed: Rail tile click selects `sub:` lane and does not mount SingleChatSubagentView; Rail host does not set HIDE_AGENT_SIDEBAR; Rail host provides RAIL_TRANSCRIPT_RETENTION; focus host instance survives swaps; stop; background live lane; depth-2 live node; permission answer; fallback and Refresh; Escape; per-tab model/effort.
- The full ExecutionNode owns steer and copy controls. This lane spec verifies its live full-node mount; steer and copy were not exercised directly here.
- A fenced `ptah-ui display [id]` update in the actual Rail dock was not exercised in this isolated host spec. The existing chat dock and display integration specs exercise update in place, while this batch verifies the Rail host enables that dock. Browser-level reduced-motion rendering was not exercised.

## Checks

- `node .ptah/tmp/check-run.mjs r9f-transcript -- npx nx test @ptah-extension/canvas --testFile=canvas-detail-transcript.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: Tests: 6 passed, 6 total.
- `node .ptah/tmp/check-run.mjs r9f-lane -- npx nx test @ptah-extension/canvas --testFile=canvas-lane-view.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: Tests: 7 passed, 7 total. Emits NG0956 for the intentionally recreated single non-orchestrator keyed block.
- `node .ptah/tmp/check-run.mjs r9f-focus -- npx nx test @ptah-extension/canvas --testFile=canvas-focus-area.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: Tests: 6 passed, 6 total.
- `node .ptah/tmp/check-run.mjs r9f-overrides -- npx nx test @ptah-extension/canvas --testFile=canvas-session-overrides.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: Tests: 1 passed, 1 total.
- Scoped `ptah_get_diagnostics`: no errors in requested files; nine errors reported in sibling files outside this batch.

## Decisions

- **Persistent host location.** Kept the one lane view mounted in the focus area and moved its transcript outside the keyed lane block. The alternative was a separate transcript sibling in the focus area. The existing lane inputs and focus-area structure support the chosen path; reversible within these two components.
- **Live node lookup.** Reused the tab's finalized message trees and the same per-tab streaming tree builder used by ChatTranscript. The alternative was another RPC read. The existing ChatTranscript lookup establishes the local tree shape; reversible.
- **Dock ownership.** Removed the Rail suppression token and reused ChatView's dock. The alternative was a Rail-specific display store. The plan and ChatView source assign displays to the existing dock; reversible.
- **Lane key.** Passed through the `sub:`/`bg:` key produced by the existing chat tile helper instead of rebuilding it from an id. The `SessionCardActions` contract receives an already formed key; reversible.

## Clarifications Needed

None for implementation. The direct Rail dock display-update case and browser reduced-motion observation need integration coverage beyond these isolated component specs.
