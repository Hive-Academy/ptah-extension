# Batch 4 part 2 — sheet migration

## Changes

- `display-panel.component.ts`: the external-selection scroll effect now skips the first input read and scrolls only when a later external selection changes. The existing four scroll/pin tests are unchanged. This removes the mount-time scroll while preserving new/updated unpinned selection, pinned unread dots, scroll position and focus.
- `chat-view.dock.spec.ts`: its ChatView harness imports `DisplaySheetComponent`, stubs the sheet's deferred panel and targets the sheet bar/region. Kept the state-provider, tab cleanup, auto-open, agent isolation, Rail retention, and same-instance surface-update coverage.
- `chat-view.keepalive.spec.ts`: its Rail harness imports `DisplaySheetComponent`; the retained-transcript test remains. Removed the dock-width fixture inputs and replaced breakpoint assertions with sheet mounting at narrow and wide widths.
- `canvas-detail-transcript.component.spec.ts`: the fenced-display Rail host test now locates and overrides the sheet, then checks that the same panel instance receives the updated surface. The token/visibility tests remain.
- Deleted `libs/frontend/chat/src/lib/components/organisms/display-dock/display-dock.component.ts` and `display-dock.component.spec.ts`. A text search of `libs/` and `apps/` for `DisplayDockComponent`, its import path, `ptah-display-dock`, and its separator found no references after deletion. `DisplayDockState` and shared right-panel services remain because the sheet and VS Code paths still use them.

## Failing tests and fate

| Existing test | Fate |
| --- | --- |
| DisplayPanel: pinned update leaves selection, scroll and focus and shows new dot | Kept unchanged; mount-time external selection no longer schedules a scroll. |
| DisplayPanel: no dot or movement for content at mount | Kept unchanged; first external selection is treated as initial state. |
| DisplayPanel: unpinned newly created surface selects and scrolls | Kept unchanged; publication effect still selects and scrolls. |
| DisplayPanel: unpinned highest updatedSeq selects and scrolls without focus | Kept unchanged; publication effect still selects and scrolls. |
| ChatView: one panel beside chat at resized width | Rewritten as one sheet region above the composer with no agent panel. Width assertion removed with the right rail. |
| ChatView: breakpoint overlay, Escape and focus | Rewritten as sheet Escape collapse and focus return to the peek bar. Overlay assertion removed. |
| ChatView: Rail context round trip | Kept transcript identity, open and pin assertions; removed width and separator assertions; added peek-bar expansion assertion. |
| ChatView: fenced `display [id]` opens and updates in place | Kept with sheet selector and stable deferred panel instance. |
| ChatView: tab switch never auto-opens | Kept with bar `aria-expanded` and sheet region assertions. |
| ChatView: auto-open does not move focus | Kept with sheet region assertion. |
| ChatView: chunk failure alert | Rewritten for the deferred sheet panel error alert. |
| ChatView: Electron surfaces without Agents tab | Kept; uses the sheet panel and confirms no agent monitor. |
| ChatView: toggle opens/closes and names content; keyboard reachable | Rewritten as peek-bar open/collapse and keyboard/`aria-expanded` coverage. |
| ChatView: separator keyboard increments/Home/End/Enter | Deleted; separator was the removed right rail control. |
| ChatView: width per tab and restore | Deleted; right rail width persistence was explicitly removed. |
| ChatView: narrower-host width clamp | Deleted; right rail width persistence was explicitly removed. |
| CanvasDetailTranscript: fenced display in Rail host | Rewritten to locate the sheet and verify update in place. |
| Rail ChatView: 804/644 side versus overlay and 360 minimum | Replaced with sheet mounting at both widths. |
| Rail ChatView: 976/648 stacked side versus overlay | Replaced with sheet mounting at both widths. |
| Rail ChatView: 760/759 default 400 width breakpoint | Replaced with sheet mounting at both widths. |
| Rail ChatView: token absent old breakpoint | Deleted; the token's former dock breakpoint assertion is obsolete. |
| Rail ChatView: coordinator keeps dock mounted | Rewritten to require the sheet to remain mounted. |
| Rail ChatView: End at 804 retains side separator | Deleted; the separator and side mode were removed. |

Other provider, VS Code, agent-activity, tab cleanup, contextual-transcript and two-pane retention tests remain; references were adjusted where their premise was the sheet. No production Canvas files were edited.

## Verification

- `chat-view.component.ts`: **2082 lines before Batch 4 part 1; 2041 before and after part 2**, below the 2082-line limit.
- Tree-sitter analysis of the four modified TS files returned `parseStatus: ok`, zero parse errors.
- `ptah_get_diagnostics` for those four files returned **unavailable after 45 seconds** (TypeScript check still running), so there is no compiler verdict. No tests, typecheck, lint, build or other heavy command was run in this part, per task instruction.

## Decisions

- **Keep the dock state model.** Options were delete it or retain it for the sheet and existing ports. The sheet, ChatView providers and display feed still depend on it; retained. Reversible after a separate state migration.
- **Replace rail geometry coverage with host presence and interaction coverage.** Options were port width assertions or test the sheet. The binding context approves removal of the right rail, toggle, width persistence, separator and overlay; sheet assertions follow that scope. Reversible if the UI contract changes.
- **Preserve the Rail minimum-width token outside the old fixture.** Options were remove it globally or leave its current consumers. Canvas and session embed still provide/assert the token, and this batch does not own those components; left it in production. Reversible after coordinated cleanup.

## Not done

- Runtime test results and TypeScript diagnostics remain unverified because the task forbids heavy commands and the scoped diagnostic service timed out.
- Rendered geometry and focus behavior require a later scoped test/visual pass.
