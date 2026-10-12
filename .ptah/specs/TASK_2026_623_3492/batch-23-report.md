# Frontend implementation — `TASK_2026_623_3492`, batch 23

**Tasks completed** (in the order run): 23.4, 23.1, 23.5, 23.2, 23.3

**Files** (worktree root `W` = `D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel`):

- MODIFIED `W\libs\frontend\chat-ui\src\index.ts`: main-barrel export of the dock ports, plus the type-only `DisplaySurface` export (Task 23.4)
- CREATED `W\libs\frontend\chat\src\lib\services\display-dock\display-dock.state.ts`: `DisplayDockState` (Task 23.1)
- CREATED `W\libs\frontend\chat\src\lib\services\display-dock\display-dock.state.spec.ts`: 23 tests
- MODIFIED `W\libs\frontend\chat-ui\src\display-panel.ts`: the lazy entry now exports the panel (Task 23.5)
- DELETED `W\libs\frontend\chat-ui\src\lib\organisms\display-panel\_files.html` (untracked scratch file)
- DELETED `W\libs\frontend\chat-ui\src\lib\organisms\display-panel\_tests.html` (untracked scratch file)
- CREATED `W\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-ptah-ui-host-sources.ts` (Task 23.2)
- CREATED `W\libs\frontend\chat\src\lib\components\organisms\transcript\transcript-ptah-ui-host-sources.spec.ts`: 9 tests
- MODIFIED `W\libs\frontend\chat-ui\src\lib\atoms\sidebar-tab.component.ts`: adds the `newCount` input with its text badge and accessible name, and `aria-expanded` (Task 23.3)
- MODIFIED `W\libs\frontend\chat-ui\src\lib\atoms\sidebar-tab.component.spec.ts`: 3 new tests (8 in total)

## Task evidence

### 23.4: main-barrel export of the dock port

`grep -n "^import" libs/frontend/chat-ui/src/lib/services/ptah-ui-display-dock.ts` printed:

```
1:import { InjectionToken } from '@angular/core';
2:import type { DisplaySurface } from '../organisms/display-panel/display-surfaces';
```

- The only runtime import is `@angular/core`. Line 2 is `import type`, as decision #76 requires.
- The new exports in `src/index.ts` are:
  - values: `PTAH_UI_DISPLAY_DOCK`, `PTAH_UI_DISPLAY_DOCK_SYNC` and `displayFenceKey`;
  - types: `PtahUiDisplayDock`, `PtahUiDisplayDockSync`, `PtahUiDisplayFenceState`, `PtahUiDisplayFenceStatus` and `PtahUiDisplaySurfacesPublication`;
  - `export type { DisplaySurface }` from `organisms/display-panel/display-surfaces`, type-only and erased.
- Nothing is exported from `./ptah-ui` or `./display-panel`.

### 23.1: `DisplayDockState`

`DisplayDockState` is `@Injectable()`, not root, so ChatView provides it. It implements both `PtahUiDisplayDock` and `PtahUiDisplayDockSync`, and imports them type-only from the main barrel `@ptah-extension/chat-ui`.

**Per-tab state.** Each tab has its own state signal: `open`, `pinned`, `activeTab`, `widthPx`, `liveTurnKey`, `userClosedTurnKey`, `newCount`, `agentsUserClosed`, `selection`, `summaryTurnKey`, `surfaces`, `statuses`, `viewStates` and `summaries`.
- The registry signal changes only when a tab is first written. Because of that, a `computed` that read an unknown tab still re-runs when the tab is created (spec: "re-runs a computed read … tab first written later").

**Read port.**
- `fenceStatus(tabId, key)` is an O(1) `Map.get` on the tab's signal. It returns `null` for an unknown tab or key.
- `openSurface` opens the dock on the Displays tab and selects the surface.

**Write port (all five methods).**
- `surfaces(tabId)` is an untracked read and returns `[]` for an unknown tab.
- `setSurfaces` applies D10.
- `hasSeen` / `markSeen` work on plain per-tab `Set`s.
- `requestAutoOpen` follows D12.

**Decision #81 hard checks.**
- (a) `hasSeen` and `markSeen` are synchronous and per tab: a plain `Map<tabId, Set<fenceKey>>` with no signal, promise or await. The spec covers a remounted sync republishing a seen fence: no open and no `newCount`.
- (b) `setSurfaces` drops the view state of surface keys that are gone. For each surface it keeps only the `components` and `drafts` entries whose id is in `retainedViewStateIds`. When nothing is dropped the object is returned unchanged, so the renderer still sees its own echo. When nothing is left the entry is removed. The spec covers both rules.
- (c) The per-transcript provider is built by Task 23.2 (see below). Batch 24 mounts it.

**R1.8 sequence through the real store.** Open, then user close (records `u1`), then a second block in `u1` keeps the dock closed with `newCount` 1, then a `u2` block opens it with `newCount` 0.

**Other behaviour.**
- Closing unpins the dock (R1.6).
- A pinned dock keeps its selection on auto-open.
- `requestAutoOpen` never touches focus.
- Agents auto-open follows the existing `_userExplicitlyClosed` rule, now per tab.

### 23.5: display-panel lazy entry

- `src/display-panel.ts` now exports `DisplayPanelComponent`, `DISPLAY_PANEL_SUMMARY_KEY` and `type DisplayPanelViewStateChange`. Nothing was added to `src/index.ts` for these, and `TurnSummaryComponent` and its children stay unexported.
- Both scratch files are deleted. `grep -rn "_files.html\|_tests.html" libs/frontend/chat-ui/src` finds nothing (exit code 1).

### 23.2: transcript host-sources provider

`createTranscriptPtahUiHostSources({ tabId, sessionId, slots, liveModelStats })` returns a `PtahUiHostSources`. It is pure signal wiring: no injection context and no module-level state.

- **Current records (#94).** The provider takes the slots, not messages, and reads `slots().map((slot) => slot.record())` inside a `computed`. So a content-only write to a record reaches `turnFacts` (spec: "reflects a content-only write …"). `vm().messages` cannot be passed.
- **Turn rule.** `turnFacts` is `collectTurnAgentFacts(records)`. `turnIndexOf` is an O(1) lookup in a computed map:
  - index `i` is the turn opened by the `i`-th user message, counting from 0;
  - a message before the first user message, or an unknown id, returns `null`;
  - it reads a signal, so a reactive caller re-runs.
- **Spec coverage.**
  - a message before the first user message returns `null`;
  - a second-turn message returns `1` and addresses `turnFacts()[1]`;
  - the index agrees with `collectDisplayCandidates(...).turnKey`.
- **`capacities` (#54).** It is `[liveModelStats.contextCapacity]` when present and `[]` otherwise. Both cases are covered, including stats that have no capacity.

### 23.3: sidebar tab atom

- There is a new optional input `newCount` (default 0). Above 0 it shows the visible text badge "n new", which is `aria-hidden` because the name carries it. The accessible name becomes "Toggle Display panel, 1 new".
- `aria-expanded` now follows `isOpen`.
- The existing call sites are unchanged (with `newCount` at 0 the name is still "Toggle X panel").

## Verification

All runs were in bash, from the worktree, with the command-line override `--moduleNameMapper='{"^vscode$":"<rootDir>/../../../__mocks__/vscode.ts","^marked$":"D:/projects/ptah-extension/node_modules/marked/lib/marked.umd.js"}'`. They ran one at a time with `--maxWorkers=2` / `--parallel=1`.

| Command | Result |
| --- | --- |
| `npx jest -c libs/frontend/chat/jest.config.ts libs/frontend/chat/src/lib/services/display-dock libs/frontend/chat/src/lib/components/organisms/transcript/transcript-ptah-ui-host-sources.spec.ts --coverage=false --maxWorkers=2 <mapper>` | 2 suites, 32 tests passed |
| `npx jest -c libs/frontend/chat-ui/jest.config.ts libs/frontend/chat-ui/src/lib/atoms/sidebar-tab.component.spec.ts --coverage=false --maxWorkers=2 <mapper>` | 1 suite, 8 tests passed |
| `npx nx typecheck @ptah-extension/chat --parallel=1` | Successfully ran target typecheck (the template warnings printed are pre-existing, not in batch files) |
| `npx nx lint @ptah-extension/chat --parallel=1` | 0 errors, 34 warnings (the Batch 22 baseline); grep for the batch file names in the output finds none |
| `npx nx typecheck @ptah-extension/chat-ui --parallel=1` | Successfully ran target typecheck |
| `npx nx lint @ptah-extension/chat-ui --parallel=1` | 0 errors, 10 warnings (the baseline, #82); none in a batch file |

## Deviations (numbered for a ruling)

1. **`setLiveTurn(tabId, turnKey | null)` added to `DisplayDockState`; Batch 24 must call it.**
   - Why: R1.8 says "user closed the panel during the current turn (user send until terminal state)". The store can only learn the live turn from `requestAutoOpen`, which fires only when a display fence arrives. Consider a dock left open from an earlier turn that the user closes in turn T before T's first display: `close` would record the wrong turn, and T's display would reopen the dock.
   - What was built: `close` records `liveTurnKey`, and `requestAutoOpen` also sets it as a fallback.
   - Follow-on for Task 24.1: the transcript calls `dock.setLiveTurn(tabId, turnKeyOfOpenTurn)` while the tab streams (the id of the last user message), and `null` when the turn reaches a terminal state.
   - The spec pins the case: "a close during the live turn before any display holds that turn back".
2. **Agents auto-open API: `requestAgentsOpen(tabId)` plus `releaseAgentsUserClose(tabId)`.**
   - `requestAgentsOpen` does nothing while the dock is open (the user's tab stays) or after a user close.
   - `releaseAgentsUserClose` is the per-tab version of ChatView's "reset `_userExplicitlyClosed` when all agents complete" (`chat-view.component.ts:1194-1210`).
   - For Batch 25: an explicit agent-chip request (`panelOpenRequest`) should call `selectTab(tabId, 'agents')` + `open(tabId)` + `releaseAgentsUserClose(tabId)`.
3. **Selection model.** D4 lists `selectedSurfaceKey` / `selectedSummaryTurnKey`. The store instead holds:
   - `selection: { kind: 'summary' } | { kind: 'surface', surfaceKey } | null`, mapped by the dock to the panel's `selectedKey`: summary maps to `DISPLAY_PANEL_SUMMARY_KEY`, and the store cannot import that lazy value;
   - `summaryTurnKey`, the turn whose summary is shown (`null` means the latest; read through `summaryFor(tabId)`).
   - A strip pick goes through `select(tabId, selection)`.
   - Same information, but the panel's single `selectedKey` needs one discriminated selection.
4. **Summary entry shape.** `setSummaries` takes `ReadonlyMap<turnKey, { model: TurnSummaryModel; changeSet: TurnChangeSet | null }>` in turn order.
   - Task 25.1's `openFile(changeSet, path)` / `review(changeSet)` need the change set beside the model.
   - The plan names no shape.
5. **No `setCandidates`.** Plan component 8 lists `setCandidates`, but Task 24.1 binds candidates straight to the sync's `[candidates]` input, so nothing in the store would read them. Leaving it out follows the no-speculative-API rule.
6. **The `SurfaceViewState` type comes from `@ptah-extension/declarative-dashboard`, with `import type` (erased).**
   - This is a new type-only edge chat → declarative-dashboard. Both libraries are `scope:webview`, and lint is clean.
   - The type's owner is the renderer library, so using it avoids a second copy of the view-state shape.
   - Alternative: `DisplayPanelViewStateChange['viewState']` imported type-only from `@ptah-extension/chat-ui/display-panel`.
7. **The host-sources provider is a factory function, `createTranscriptPtahUiHostSources(input)`, not an `@Injectable` class.**
   - Why: the transcript's providers cannot read the component's own inputs.
   - Batch 24 wiring: build it in a field from `tabId`, `sessionId`, `computed(() => this.vm().slots)` and `computed(() => this._tab()?.liveModelStats ?? null)`. Then provide `{ provide: PTAH_UI_HOST_SOURCES, useFactory: () => inject(ChatTranscriptComponent).<field> }`, or the `forwardRef` equivalent.
   - The provider owns `turnFacts`, so Task 24.1 needs `collectTurnAgentFacts` only through it.
8. **Two additions beyond the plan line for the sidebar tab.**
   - Task 23.3 also adds `aria-expanded` and extends the existing `sidebar-tab.component.spec.ts`. That spec file is not listed in the batch, but the batch verification line anticipates a sidebar-tab spec.
   - The accessible name follows the plan ("Toggle Display panel, 1 new"). design-spec.md:63 says "Displays, 1 new"; the plan text was followed because it matches the existing "Toggle X panel" names.

## Risks handled

- **Eager bundle.**
  - Every non-`@angular/core` import in `display-dock.state.ts` and `transcript-ptah-ui-host-sources.ts` is `import type`, except `collectTurnAgentFacts`, which is local and eager-safe.
  - The main barrel gained only the eager-light dock file and a type-only `DisplaySurface` re-export.
- **Cross-tab leaks.** All dock state, including the seen sets, is keyed by tab id. Each transcript builds its own host sources from its own signals.
- **State loss.** `setSurfaces` keeps unchanged view-state objects identical, and `setViewState` ignores keys the tab does not hold.

## Out-of-scope observations

- `DisplayDockState` keeps per-tab state, and its seen sets, for the ChatView's lifetime. A closed tab's entry stays until the ChatView is destroyed. A `forgetTab` call from ChatView on tab close would bound this; it was not added because no caller needs it yet.
