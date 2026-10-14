# Lane R9 phase fix B report (F2, decision row 77(d))

Writer: Claude. Scope: F2 in `code-logic-review-R9-phase.md` ("Row 77(d) conductor tile"). I did not touch `libs/frontend/canvas/src/lib/canvas-rail/*`.

## Changes

| Change | File:line | Spec case (file:line) | Result |
| --- | --- | --- | --- |
| The `DisplayDockState` factory checks only `isElectron`. `HIDE_AGENT_SIDEBAR` no longer removes the dock. Provider comment updated. | `libs/frontend/chat/src/lib/components/templates/chat-view.component.ts:256-264` | `chat-view.dock.spec.ts:506` "HIDE_AGENT_SIDEBAR keeps the display dock and empties only its Agents list (decision 77)": the store and both ports resolve, and the toggle reads "Toggle Display panel" | pass |
| `sessionAgents` returns `[]` when `hideAgentSidebar` is set. This keeps `agentBadgeType` null, the agent auto-open effect (`:1393`) inert and the dock's Agents tab at "Agents (0)". | `chat-view.component.ts:571-576` | `chat-view.dock.spec.ts:506`: a running agent leaves `sessionAgents()` at `[]`, the badge null and the dock closed. A fenced `ptah-ui display [id]` (`setSurfaces` + `requestAutoOpen`) opens the dock and updates in place on the same panel instance. Exactly one `ptah-display-dock` renders, and its Agents tab shows `Agents (0)`. | pass |
| The `hideAgentSidebar` field doc now means "hide the Agents list". The `displayDock` doc no longer mentions the hidden sidebar. | `chat-view.component.ts:292-297`, `:454` | n/a (docs) | n/a |
| Token doc: hides the session's Agents list; the display dock stays | `libs/frontend/chat/src/lib/tokens/session-context.token.ts:13-21` | n/a (docs) | n/a |
| Conductor provider comment updated; the provider is unchanged | `libs/frontend/tribunal-panel/src/lib/components/conductor-tile.component.ts:219-222` | `conductor-tile.component.spec.ts:136` "keeps the display dock in the conductor ChatView in Electron (decision 77)": through the conductor's own outlet and child injector, `HIDE_AGENT_SIDEBAR` is true, `SESSION_CONTEXT()` is `'tab-c'` and ChatView's real dock provider resolves a non-null `PTAH_UI_DISPLAY_DOCK`. `:147`: in VS Code it resolves null. `:132`: guard that the providers were found. | pass |

## Tests

- `node .ptah/tmp/check-run.mjs phaseB-1 -- npx nx test @ptah-extension/chat --testFile=chat-view.dock.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - `Test Suites: 1 passed, 1 total`
  - `Tests:       26 passed, 26 total`
- `node .ptah/tmp/check-run.mjs phaseB-2 -- npx nx test @ptah-extension/tribunal-panel --testFile=conductor-tile.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`
  - `Test Suites: 1 passed, 1 total`
  - `Tests:       3 passed, 3 total`
- `node .ptah/tmp/check-run.mjs phaseB-3 -- npx nx test @ptah-extension/chat --testFile=chat-view.keepalive.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache` (dock in Rail hosts)
  - `Test Suites: 1 passed, 1 total`
  - `Tests:       9 passed, 9 total`

I did not run typecheck or lint, as the brief scoped them out.

## Decisions

1. **The token now has only the "hide the Agents list" meaning.** ChatView reads the flag in four places:
   - the dock factory: removed;
   - `sessionAgents`: now `[]`;
   - the field itself;
   - template `chat-view.component.html:323`, the VS Code `@else if (!hideAgentSidebar ...)` branch, which hides the Agents sidebar and monitor.

   The HTML read already means "hide the Agents list" (VS Code has no dock), so I left it as it is. It is also outside my file scope.
2. **The `sessionLaneRuns` stay unfiltered.** `sessionLaneRuns` (`chat-view.component.ts:~1065`) feeds the `$agents`/`$limits` lane display tiles, not the Agents list. Emptying it would degrade the protected `$agents` display surface, which decision 77 forbids.
3. **The early `[]` return uses the existing field.** `sessionAgents` does `if (this.hideAgentSidebar) return [];` and reads the existing `hideAgentSidebar` field (declared earlier, at `:296`). I added no new injection. The computed's inferred type is unchanged, so the `[agents]` and `[embeddedAgents]` bindings type the same as before.
4. **The conductor spec uses a probe, not the real ChatView.** Mounting the real ChatView in the tribunal-panel spec needs its whole dependency graph (about 28 injections plus component-level services). The chat dock spec already stubs that graph and cannot be imported across libs. So the conductor spec:
   - renders a probe component through the conductor's real `NgComponentOutlet` and real `createEnvironmentInjector` child injector (it swaps `chatViewComponent` before the first change detection);
   - gives the probe ChatView's own Display dock providers, read from ChatView's decorator metadata (`__annotations__[0].providers`). It locates them by the `PTAH_UI_DISPLAY_DOCK` port's `useExisting` target, because `DisplayDockState` is not exported from `@ptah-extension/chat`.

   With the pre-fix factory, the Electron case would resolve null and fail. A guard case (`:132`) fails if the metadata cannot be read, so the test cannot pass vacuously. Trade-off: `__annotations__` is an Angular JIT detail. If the jest transform ever stops emitting it, the guard fails loudly. `chat-view.dock.spec.ts:506` covers the rendered dock under the token.
5. **Other hosts keep their behaviour.** Only the conductor provides the token. For every other host the factory result is unchanged (`isElectron && !false`), and `sessionAgents` is unchanged when the flag is false. The keepalive and dock Rail cases pass.

## Clarifications Needed

None.

## Changed files

- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\chat\src\lib\components\templates\chat-view.component.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\chat\src\lib\components\templates\chat-view.dock.spec.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\chat\src\lib\tokens\session-context.token.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\tribunal-panel\src\lib\components\conductor-tile.component.ts
- D:\projects\ptah-extension\.claude-worktrees\feat-task-629-canvas-board-697f422f00f5\libs\frontend\tribunal-panel\src\lib\components\conductor-tile.component.spec.ts (created)
