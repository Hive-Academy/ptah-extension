# Batch 18 report: C3 display chip and message text

Executor: frontend-developer. No git commands were run.

## Task 18.1: display chip (done)

Files:

- CREATE `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-display-chip.component.ts`
- CREATE `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-display-chip.component.spec.ts`
- CREATE `libs/frontend/chat-ui/src/lib/services/ptah-ui-display-dock.ts` (not in the batch file list; see Plan gap 1)

Behaviour (plan 630-673, decisions #7 and #9, R1.11, R1.12, R2.10, R9):

- The chip reads its status from the dock store, keyed `messageId:nodeId:ordinal` (`displayFenceKey`), for the tab in
  `PTAH_UI_HOST_SOURCES.tabId()`. It does one O(1) lookup in a `computed`, and it never runs the fence pipeline. The
  spec provides a spy `PTAH_UI_BLOCK_PIPELINE` and asserts zero compile and resolve calls.
- `applied`: title (or "Display"), the "Live" badge with a pulse dot (opacity only, `motion-safe:` only), and "Open in
  display". The button calls `openSurface(tabId, surfaceKey)`.
- `superseded`: the "Updated later" badge, a dashed border, the note "A newer version exists", and "Open latest"
  (design-spec section 5 and the prototype `displayChip(true)`).
- `evicted`: the "No longer in display" badge and note. It has no action, so it stays a plain chip (R1.12).
- `invalid`: the 610 fallback. The raw fence goes through `<markdown>` + `surfaceMarkdown`, and `Not rendered:
  {reason}` sits outside the code, linked by `aria-describedby`.
- No status yet: the raw fence as plain markdown.
- No dock store, or no host sources: the chip shows "Display panel unavailable", and the open action is disabled, with
  `aria-describedby` pointing at that text.
- Collapsible (R9): the toggle is a native `<button type="button">` with `aria-expanded` and `aria-controls`. The region
  has `role="region"` and `aria-labelledby`. When collapsed it is `inert` and `visibility:hidden`. The chip starts
  collapsed.
  - Enter and Space use native button activation.
  - Escape inside an expanded chip collapses it, refocuses the toggle and stops propagation.
  - Escape on a collapsed chip bubbles to the host.
- Responsive: `min-w-0` on the root, a `flex-wrap` head and a `break-words` title and description, so nothing is clipped
  or truncated.
- Styling: theme tokens only (`bg-base-200`, `border-base-300`, `text-base-content-muted`, DaisyUI `badge` and `btn`,
  `info` tints).
  - The icons are lucide `LayoutDashboard`, `ChevronDown`, `Info` and `PanelRight`, each confirmed in
    `node_modules/lucide-angular/icons`.
  - The collapse CSS repeats `surface-layout.component.ts` `COLLAPSE_STYLES` locally, because that constant is not
    exported.

Spec cases (28, including 10 axe runs):

- Lookup key and tab.
- Collapsed line.
- Default collapsed ARIA and inert.
- Expand, with focus staying on the toggle.
- Repeated activation.
- Open calls the dock.
- Escape collapses and refocuses.
- Escape bubbles when collapsed.
- Chip only: no renderer, no code, no fence body, no pipeline run.
- Wrap classes.
- Untitled block reads "Display".
- Superseded.
- Evicted.
- Invalid fallback.
- Pending as markdown.
- In-place status changes on the same instance.
- Unavailable, without a dock and without host sources.
- axe, with no serious or critical violations, in the light and dark themes for: applied, applied expanded, superseded
  expanded, unavailable expanded, and invalid.

Copy (R2.10): the chip writes nothing into the node text, and copy reads node text. The spec asserts that the chip DOM
holds no fence text and no code element.

## Task 18.2: message text renders the chip for display fences (done)

Files:

- MODIFY `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-message-text.component.ts`. A new `display` part
  kind exists, chosen only when `segment.target === 'display'`. An absent `target` stays an inline block, and
  `displayId` is not read. The key is `ui:<ordinal>`, as today.
- MODIFY `libs/frontend/chat-ui/src/lib/organisms/ptah-ui/ptah-ui-message-text.component.spec.ts`. It adds 5 cases:
  - chip instead of block, with `ui:<ordinal>`;
  - a display fence without an id;
  - a shared ordinal sequence with inline fences, where an absent target is inline;
  - an open display fence stays code, then becomes one chip on close;
  - the same chip instance across 20 streamed chunks.
- MODIFY `libs/frontend/chat-ui/src/ptah-ui.ts`. It exports `PtahUiDisplayChipComponent`, `PTAH_UI_DISPLAY_DOCK`,
  `displayFenceKey` and the status types, all from the lazy entry only.
- `libs/shared/src/mcp-apps-contracts/surface.index.ts`: not touched. The task needs no new `ptah-ui.types` export,
  because `segmentPtahUi` already returns `target` and `displayId`.
- `libs/frontend/chat-ui/src/index.ts` (the main barrel): not touched.

## Verification (worktree, mapper override on the command line only)

- `npx jest -c libs/frontend/chat-ui/jest.config.ts …/ptah-ui-display-chip.component.spec.ts …/ptah-ui-message-text.component.spec.ts --coverage=false --maxWorkers=2 --moduleNameMapper='{…}'`
  → `Test Suites: 2 passed, 2 total; Tests: 40 passed, 40 total`.
- `npx nx typecheck @ptah-extension/chat-ui --parallel=1` → `Successfully ran target typecheck`.
- `npx nx lint @ptah-extension/chat-ui --parallel=1` → `0 errors, 10 warnings`, which is the baseline. The warnings
  are in `copy-button`, `agent-card-output`, `compact-session-activity`, `plan-limit-tiles`, `plugin-catalog-panel`,
  `subagent-transcript-viewer`, `code-output`, `diff-display` and `ptah-ui-live-window`. None is in a batch file.
- No TODO markers or timers in the batch files.

## Plan gaps (flagged, for the team-leader)

1. **The dock store is not reachable from chat-ui as planned.**
   - The plan says the chip reads `DisplayDockState` (injected optional). That class is created in Batch 23 under
     `libs/frontend/chat`, and chat-ui cannot import the `chat` library: `chat` depends on chat-ui, and both are
     `type:feature`.
   - Following the `PTAH_UI_HOST_SOURCES` precedent, I added a chat-ui-owned contract:
     `lib/services/ptah-ui-display-dock.ts`.
     - It holds `PTAH_UI_DISPLAY_DOCK`, an optional `InjectionToken`.
     - It holds `PtahUiDisplayDock`, with `fenceStatus(tabId, fenceKey)` and `openSurface(tabId, surfaceKey)`. Both
       match the plan's call shapes.
     - It holds `PtahUiDisplayFenceStatus`: `applied | superseded | evicted` with `surfaceKey`, `title` and
       `description`, or `invalid` with `reason`.
     - It holds `displayFenceKey(messageId, nodeId, ordinal)`.
   - The file imports only `@angular/core`, so it is eager-light.
   - Batch 23 needs to act on this:
     - `DisplayDockState` should implement `PtahUiDisplayDock`.
     - The ChatView should add `{ provide: PTAH_UI_DISPLAY_DOCK, useExisting: DisplayDockState }`.
     - The sync (Batch 20) should key statuses with `displayFenceKey` and publish `title` and `description` for each
       valid fence.
   - An eager provider needs a **main-barrel export of this file** (as `PTAH_UI_HOST_SOURCES` has). Importing it
     through `@ptah-extension/chat-ui/ptah-ui` would make the lazy entry eager.
     - I did not widen `index.ts`, as instructed.
     - Batch 23 (whose verification already lints chat-ui) should add that export, or the team-leader should reassign
       it.
2. **The plan and the requirement disagree on the evicted action.**
   - Plan 645-646 gives `evicted` an "Open in display" button.
   - R1.12 says evicted chips "stay as plain chips", and design section 5 gives no action for that state.
   - I followed R1.12 and the design: the evicted chip has no open action.
3. **Superseded label.**
   - The plan names one button label, "Open in display".
   - Design-spec section 5 and the prototype use "Open latest" for superseded chips.
   - I followed the design, which is the visual source of truth. The "Updated later" state text matches decision #7.
4. **Chip details beyond title and description.**
   - The prototype's expanded chip shows item counts and totals ("3 agents · 184.2k tokens").
   - The chip never runs the pipeline (plan 650), and the planned status carries no such data. So the expanded chip
     shows the description and the state note only, which is what R9.3 asks for.
   - Showing counts would need the sync to publish them. That is not planned.

## Risks and edge cases handled

- Unclosed or streaming display fence: it stays an ordinary code block until it closes, then mounts one chip that
  survives later streaming. Both are covered in the message-text spec.
- Inline and display ordinals stay one sequence, so `ui:<ordinal>` keys and the `messageId:nodeId:ordinal` status key
  remain stable.
- Eager bundle growth (HIGH risk): every new runtime import (lucide icons, markdown, the chip) is reached only through
  the lazy `ptah-ui` entry. The main barrel is unchanged, and the token file is `@angular/core` only.
- `/3` and 610 regression: an inline `ptah-ui` fence (absent `target`) takes the unchanged block path. All existing
  message-text cases pass.
- VS Code (R1.14): the ptah-ui host is mounted only on Electron (`execution-node.component.ts:442-446,556-561`), so a
  VS Code display fence never reaches the chip. No change was needed here.
