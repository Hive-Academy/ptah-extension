# Batch CV-1 report - chat-view shell + inspector host (TASK_2026_677_efcd, W5)

Status: DONE (executor side; resumed after a 429 interruption, no work repeated or lost). Not committed.

## Files changed

All paths under `D:\projects\ptah-extension\.claude-worktrees\clean-session-view\libs\frontend\chat\src\`.

- CREATED `lib\tokens\session-embed-chrome.token.ts` - byte-identical to the batches.md brief (decisions row 85).
- MODIFIED `index.ts` - appended `injectSessionStatsSource` + `SessionStatsHost` / `SessionStatsSource` types and
  the exact `SESSION_EMBED_CHROME` line from the brief (append-only).
- CREATED `lib\services\session-stats\session-stats-source.ts` - `injectSessionStatsSource` (Delta 3 D3-8); the
  bodies of `resolvedSessionStats` / `resolvedLiveModelStats` / `resolvedCompactionCount` / `sessionLaneRuns` /
  `sessionRunOwnerKeys` / `resolvedStatsLimits` / `_limitTime` and the helpers `toStatsLimitLaneRun`,
  `recordedOwnerKeys`, `sameStrings`, `CLI_LABELS` MOVED verbatim from chat-view. No scope, no timer.
- MODIFIED `lib\services\session-inspector\session-inspector.store.ts` - `reportAnswerMiss(requestId)`,
  `clearAnswerMiss(requestId)`, `answerMissed(requestId)` over one transient `signal<ReadonlySet<string>>`.
- MODIFIED `lib\components\organisms\session-inspector\inspector-request-panel.component.ts` -
  `InspectorRequestLinesComponent`: a question row whose answer missed renders `role="alert"` "Could not find this
  question in the chat" + `Retry` (clears the miss, re-emits `answerRequested`); `Answer` also clears a stale miss.
- MODIFIED `lib\components	emplates\chat-view.component.ts` - `providers: [InspectorShellController]`;
  `SessionInspectorComponent` import (only in `imports` + `@defer`); `bareChrome` (SESSION_EMBED_CHROME read once),
  `hostsInspector`, `hasLaneSurface`, `shell`, `stats = injectSessionStatsSource(...)`, `wireInspectorShell()`
  (`bindTab`, session-switch effect -> `onTabChanged()`, `attach(...)` in `afterNextRender` with lazy opener /
  title getters), `openLaneFromInspector`, `focusQuestionCard` (1 s wait -> `reportAnswerMiss`), timer cleared in
  `ngOnDestroy`; strip / tray members and helpers removed (moved into the stats source); scope effect reads
  `stats.runOwnerKeys()`; `_planLimitsScope`, `resolvedSessionBudget`, `StatsTileExpansionState` kept.
- MODIFIED `lib\components	emplates\chat-view.component.html` - root `#inspectorShell .cs-shell`; main column
  `[attr.inert]`; strip and tray blocks deleted; `[attr.data-request-id]` on `ptah-question-card`; inspector block
  (`hostsInspector() && shell.isOpen() && shell.tab()`, scrim when modal, `@defer (on immediate)`
  `<ptah-session-inspector id="inspector">` with `[stats]="stats.inputs()"`, sheet keydown -> controller).
- MODIFIED `lib\components	emplates\chat-view.component.css` - `.cs-shell` (`container-type: inline-size`),
  `.cs-inspector` (336 px docked), `--sheet` (absolute, `min(336px,100%)`, `--elev-shadow-raised`), `--full`,
  `.cs-scrim` (`rgb(0 0 0 / .3)`), 220 ms slide-in (none under reduced motion).
- MODIFIED `lib\components\index.ts` - dropped `export * from './organisms/background-agent-tray.component'`
  (the deleted file; see Deviations).
- DELETED `lib\components\organisms\background-agent-tray.component.ts` (R2, decisions row 64).
- MOVED (file move, no git) `lib\components\organisms\background-agent-tray.component.spec.ts` ->
  `lib\services\session-agents\session-agent-tray.service.spec.ts`; harness is now
  `TestBed.inject(SessionAgentTrayService).contextsFor('session-a')` (every record is unattributed, so visible in a
  resolved scope); same 13 `it` + 1 `it.each` (3 rows) = 15 tests.
- MOVED (file move, no git) `lib\components\organisms\background-agent-tray.scope.spec.ts` ->
  `lib\services\session-agents\session-agent-tray.spec.ts`; harness is now the pure
  `buildTrayContexts(map, [], scope)`; same 3 cases, same expectations.
- MODIFIED `lib\components\templates\chat-view.component.spec.ts`, `chat-view.dock.spec.ts`,
  `chat-view.keepalive.spec.ts` (see Spec edits). `chat-view.memo.spec.ts` unchanged (it mounts
  `ChatTranscriptComponent`, not the chat view).

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Inspector guard `hostsInspector() && shell.isOpen() && shell.tab(); as inspectorTab`, `[tabId]="inspectorTab.tabId"` | plan B §7(c) `resolvedActiveTab(); as tab` | the controller's `tab()` is the tab it binds (`bindTab(resolvedTabId)`), so open state and the shown tab cannot disagree; `isOpen()` is already false without a tab | yes |
| `id="inspector"` on the `ptah-session-inspector` host, not on an inner aside | add an id input to B-4's component | B-4's template renders the `<aside>` / `role="dialog"` itself with no id; the header toggle's `aria-controls="inspector"` then points at the element containing it; no B-4 API change | yes |
| Sheet focus trap: `(keydown)="shell.onSheetKeydown($event)"` on the inspector host | trap inside B-4 | the controller's handler uses `event.currentTarget` as the sheet and returns early when not modal | yes |
| Close button and scrim call `shell.closeInsp('opener')` | `closeInsp()` | same focus result (remembered opener -> opener -> title); matches the controller's own Esc path | yes |
| Layout in component CSS (`.cs-inspector`, `--sheet`, `--full`, `.cs-scrim`) with `[class.x]` toggles | Tailwind classes through one `[class]` binding | design-spec 2.1 values (336 px, `min(336px,100%)`, `--elev-shadow-raised`, `bg-black/30`); `class` + `[class.x]` only, never `class` + `[class]`; the 220 ms slide-in animates only `transform` / `opacity` and is off under reduced motion | yes |
| Specs keep the inspector closed (`InspectorOpenStateService.dockedOpen` stub -> false) and stub `SessionInspectorStore` | provide the real services | both real services call `tabManager.onTabClosed`, which the spec stubs lack; the real store also pulls the roster graph. `InspectorShellController` stays real (component provider) | yes |
| Plan-limits cases read `stats.inputs()?.limits` through a local `StatsView` cast | make `stats` public | the spec already uses this cast pattern (`BudgetView`); `stats` stays `protected` as the brief writes it | yes |

## Deviations

- `lib\components\index.ts` is not in CV-1's file list (B-4 single owner), but deleting the tray component requires
  dropping its star export or the barrel no longer compiles. One line removed, nothing else touched; no other W5 batch
  owns that file.
- The brief calls the renamed component spec "action cases against `SessionAgentTrayService`"; its cases are
  entry-mapping cases (name / summary / origin / background status). They are kept verbatim and run against the
  service's `contextsFor`, the service's mapping path. No case added or dropped.
- B §7(d) `inspectorInitialOpen` input not added: B-3's controller already derives `initialOpen` from
  `sessionWorkflowKind(tab)`, so an input would be a second source.

## Spec edits (existing specs, to keep cases green)

- `chat-view.component.spec.ts`: `toStatsLimitLaneRun` import re-pointed to
  `../../services/session-stats/session-stats-source` (Delta 3, `:68`); the harness gains `messagesSig` (chat store
  `messages`) and `sessionStats` / `liveModelStats` / `compactionCount` stub signals (read by the stats source), plus
  the two inspector stubs; the plan-limits `harness()` seeds one message (stats show from the first message on) and
  its 7 `resolvedStatsLimits()` reads become `statsLimits(h)`; the `showBackgroundStrip() / traySessionId()` describe
  (3 cases) and its header comment are removed (strip / tray mount assertions, per the brief). The panel-resize suite
  still reads `resizeCallbacks[0]` = the host observer (created in the constructor, before the controller's
  `afterNextRender` attach); "disconnects on destroy" asserts before any render, so the controller's `disconnect()`
  inside `attach` cannot trip its `not.toHaveBeenCalled()`.
- `chat-view.dock.spec.ts`, `chat-view.keepalive.spec.ts`: the two inspector stubs + their import only. Their
  `emitHostWidth` feeds every observer, so the controller also sees the width; with the sheet closed that only moves
  its band (no rendered change).

## Scoped diagnostics

`ptah_get_diagnostics` (TypeScript compiler) on the 11 changed `.ts` files: 0 errors in every non-spec file
(`chat-view.component.ts`, `session-stats-source.ts`, `session-inspector.store.ts`,
`inspector-request-panel.component.ts`, both barrels), in the two moved tray specs and in the dock / keepalive specs.
`chat-view.component.spec.ts` reports only pre-existing errors outside my edits (`:1332-1359` SubagentRecord casts,
`:1502-1525` protected `resolvedResumableSubagents`, `:1958-2057` private `panelResizeService`); sibling spec errors are
in files this batch did not touch. Templates are outside this tool: template members checked by hand (`shell`,
`hostsInspector`, `hasLaneSurface`, `stats`, `openLaneFromInspector`, `focusQuestionCard`, `#inspectorShell` <->
`viewChild('inspectorShell')`). No nx / jest check was run (decisions row 59); MODE 2 runs `cv1-test` /
`cv1-typecheck` / `cv1-lint`.

## tasks-ui/presentation resolution in chat Jest (decisions row 84)

Now exercised at module load: `chat-view.component.ts` statically imports `SessionInspectorComponent` ->
`inspector-task-section` / `session-task-reader` -> `@ptah-extension/tasks-ui/presentation`, so every chat-view spec
resolves that path (mapped in `tsconfig.base.json:109`). Mounting stays unexercised (the specs keep the inspector
closed). If `cv1-test` fails with "Cannot find module '@ptah-extension/tasks-ui/presentation'", that is this
assumption, not the CV-1 logic.

## Open items

- E2E / showcase locators still target the removed chat-view strip (`ptah-session-stats-summary`):
  `apps/ptah-electron-e2e/src/showcase/canvas-orchestra.scene.ts:154`, `chat-code-edit.scene.ts:121`,
  `apps/ptah-electron-e2e/src/specs/chat/compaction-duplicate-session.spec.ts:282`,
  `libs/frontend/webview-e2e-harness/src/lib/scenarios/plan-limits/plan-limits-visual.e2e.spec.ts:117`. Outside this
  batch's ownership and not run here; they need the inspector SESSION section instead.
  (`harness-builder-view.component.ts:400` uses the chat-ui component directly and is unaffected.)
- `libs/frontend/chat-streaming/src/lib/session-scope.spec.ts:5` still names `background-agent-tray` in a comment
  (history note, not a file reference; other project).
- The header toggle (`aria-controls="inspector"`) and the `h1[tabindex="-1"]` title arrive with CV-2; until then the
  main panel shows the inspector docked by default (D36) and the lazy opener / title getters return `null` (focus falls
  back as the controller defines).
- Not CV-1's files on disk: A1-3's `message-bubble.component.ts`, `inline-agent-bubble.component.ts`,
  `reports/batch-A1-3.md`; orchestrator edits to `batches.md`, `decisions.md`, `handoff-6.md`.
